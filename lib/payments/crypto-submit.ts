import { prisma, isUniqueViolation } from '@/lib/db';
import { checkOf, checkTransfer, saveCheck, BIND_EXTENSION_MS } from './adapters/crypto';
import { readCryptoMeta } from './crypto-meta';
import { refreshPaymentIntent } from './core';
import { raisePaymentAlert } from './alerts';
import { NETWORK_IDS, type NetworkId } from './onchain/networks';
import { normalizeTxHash } from './onchain/verify';
import { formatUsdt } from './onchain/amount';

/**
 * The customer has paid from their own wallet and gives the transaction id. The server reads the chain; the
 * transfer is bound to this payment ONLY if it matches it (official USDT contract, our address, the exact
 * amount, inside the window) — so nobody can squat or reuse a transaction, and a stranger's transfer can
 * never pay someone else's order. Then the normal confirmation pipeline credits it once it is final.
 */
export type SubmitCryptoError =
  | 'invalid_input'
  | 'not_found'
  | 'not_payable'
  | 'network_unavailable'
  | 'already_has_transfer'
  | 'tx_not_found'
  | 'tx_failed'
  | 'wrong_recipient'
  | 'wrong_token'
  | 'wrong_amount'
  | 'too_early'
  | 'too_late'
  | 'tx_already_used'
  | 'node_unavailable';

export type SubmitCryptoResult =
  | { ok: true; state: 'confirmed' | 'pending'; confirmations?: number; required?: number }
  | { ok: false; error: SubmitCryptoError; details?: { sentUsdt?: string; expectedUsdt?: string } };

const OPEN = ['CREATED', 'PENDING', 'REQUIRES_ACTION'];

export async function submitCryptoTransaction(args: { intentId: string; userId: string; network: string; txHash: string }): Promise<SubmitCryptoResult> {
  const network = NETWORK_IDS.find((n) => n === args.network) as NetworkId | undefined;
  const hash = network ? normalizeTxHash(network, args.txHash) : null;
  if (!network || !hash) return { ok: false, error: 'invalid_input' };

  const intent = await prisma.paymentIntent.findUnique({ where: { id: args.intentId } });
  if (!intent || intent.userId !== args.userId || intent.provider !== 'CRYPTO') return { ok: false, error: 'not_found' };
  if (intent.status === 'SUCCEEDED') return { ok: true, state: 'confirmed' };
  if (!OPEN.includes(intent.status)) return { ok: false, error: 'not_payable' };
  const meta = readCryptoMeta(intent.metadata);
  if (!meta || !meta.addresses[network]) return { ok: false, error: 'network_unavailable' };

  if (meta.tx) {
    if (meta.tx.network !== network || meta.tx.hash !== hash) return { ok: false, error: 'already_has_transfer' };
    const fresh = await refreshPaymentIntent(intent.id, 'crypto.submit');
    return fresh.status === 'SUCCEEDED' ? { ok: true, state: 'confirmed' } : { ok: true, state: 'pending', ...stateOf(fresh.metadata) };
  }
  // No deadline on giving the id: what must fall inside the send window is the TRANSFER itself (checked on chain).

  const res = await checkTransfer(intent, meta, network, hash);
  switch (res.state) {
    case 'unavailable':
      return { ok: false, error: 'node_unavailable' };
    case 'not_found':
      return { ok: false, error: 'tx_not_found' };
    case 'failed':
      return { ok: false, error: 'tx_failed' };
    case 'mismatch': {
      const details = { expectedUsdt: meta.amountUsdt, ...(res.receivedMicro !== undefined ? { sentUsdt: formatUsdt(res.receivedMicro) } : {}) };
      // Money may have been sent that matches no payment: finance should know (never auto-credited).
      if (res.reason === 'wrong_amount' || res.reason === 'wrong_token' || res.reason === 'too_late') {
        await raisePaymentAlert({
          severity: 'MEDIUM',
          code: 'crypto_transfer_mismatch',
          title: `A customer submitted a USDT transfer that does not match payment ${intent.id} (${res.reason})`,
          details: { paymentIntentId: intent.id, network, txHash: hash, reason: res.reason, expectedUsdt: meta.amountUsdt, sentUsdt: details.sentUsdt ?? null },
        });
      }
      return { ok: false, error: res.reason, details };
    }
    default:
      break;
  }

  // Right transfer (final or not yet): bind it to this payment. A transaction can be bound only once, ever.
  try {
    await prisma.$transaction(async (tx) => {
      const bound = await tx.paymentIntent.updateMany({
        where: { id: intent.id, userId: intent.userId, status: { in: OPEN as ('CREATED' | 'PENDING' | 'REQUIRES_ACTION')[] }, providerRef: intent.providerRef },
        data: { providerRef: `${network}:${hash}`, expiresAt: new Date(Date.now() + BIND_EXTENSION_MS) },
      });
      if (bound.count !== 1) throw new Error('intent_changed');
      const txJson = JSON.stringify({ network, hash, boundAt: new Date().toISOString() });
      await tx.$executeRaw`UPDATE "PaymentIntent" SET "metadata" = jsonb_set("metadata", '{crypto,tx}', ${txJson}::jsonb, true) WHERE "id" = ${intent.id}`;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'tx_already_used' };
    if (err instanceof Error && err.message === 'intent_changed') return { ok: false, error: 'not_payable' };
    throw err;
  }
  await saveCheck(intent.id, checkOf(res)).catch(() => undefined);

  const fresh = await refreshPaymentIntent(intent.id, 'crypto.submit');
  return fresh.status === 'SUCCEEDED' ? { ok: true, state: 'confirmed' } : { ok: true, state: 'pending', ...stateOf(fresh.metadata) };
}

function stateOf(metadata: unknown): { confirmations?: number; required?: number } {
  const check = readCryptoMeta(metadata)?.check;
  return check?.confirmations !== undefined ? { confirmations: check.confirmations, ...(check.required !== undefined ? { required: check.required } : {}) } : {};
}
