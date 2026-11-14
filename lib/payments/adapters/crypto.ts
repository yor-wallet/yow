import { randomInt } from 'node:crypto';
import type { PaymentIntent } from '@prisma/client';
import { prisma } from '@/lib/db';
import { OFFSET_SLOTS, baseCents, expectedMicro, formatUsdt } from '../onchain/amount';
import { configuredNetworks, type NetworkId } from '../onchain/networks';
import { verifyTransfer, type VerifyResult } from '../onchain/verify';
import { readCryptoMeta, type CryptoCheck, type CryptoPaymentMeta } from '../crypto-meta';
import {
  ProviderError,
  WebhookSignatureError,
  type CreatePaymentResult,
  type ProviderAdapter,
  type ProviderPaymentInput,
  type ProviderStatus,
  type WebhookEvent,
} from '../types';

/**
 * Cryptocurrency: USDT sent straight to the shop's own wallet addresses (Tron TRC20, BNB Smart Chain BEP20,
 * Ethereum ERC20). No processor and no custody by the site: it only knows PUBLIC receiving addresses and
 * reads the blockchain to prove a transfer (lib/payments/onchain). See docs/PAYMENTS.md.
 *
 * Flow: the customer gets the exact amount (unique per open payment) and the addresses → sends USDT from
 * their own wallet → pastes the transaction id → the server verifies it on chain → once final, the order is
 * paid / the wallet credited. Credit happens only for a transfer that matches THIS payment.
 *
 * Env: CRYPTO_ADDRESS_TRON / CRYPTO_ADDRESS_BSC / CRYPTO_ADDRESS_ETH (see onchain/networks.ts).
 */
export const CRYPTO_ASSETS = ['USDT'] as const;
/** Time the customer has to SEND the transfer (the window a transfer must have been mined in). */
export const PAYMENT_WINDOW_MS = 60 * 60_000;
/** Time the payment stays open for the customer to GIVE the transaction id after that (a transfer sent in time is never lost). */
export const CLAIM_WINDOW_MS = 24 * 60 * 60_000;
/** Once a matching transfer is found, the payment stays open this long so it can reach finality. */
export const BIND_EXTENSION_MS = 6 * 60 * 60_000;
export const CLOCK_SKEW_MS = 5 * 60_000;
/** A transfer mined a little after the window (slow blocks) still counts. */
export const LATE_GRACE_MS = 30 * 60_000;

/** Persist the latest verification result for the pay page (atomic partial update of the JSON). */
export async function saveCheck(intentId: string, check: CryptoCheck): Promise<void> {
  await prisma.$executeRaw`UPDATE "PaymentIntent" SET "metadata" = jsonb_set("metadata", '{crypto,check}', ${JSON.stringify(check)}::jsonb, true) WHERE "id" = ${intentId} AND "metadata" ? 'crypto'`;
}

export function checkOf(res: VerifyResult): CryptoCheck {
  const base = { state: res.state, at: new Date().toISOString() };
  switch (res.state) {
    case 'pending':
    case 'confirmed':
      return { ...base, confirmations: res.confirmations, required: res.required, receivedMicro: res.receivedMicro };
    case 'mismatch':
      return { ...base, reason: res.reason, ...(res.receivedMicro !== undefined ? { receivedMicro: res.receivedMicro } : {}) };
    default:
      return base;
  }
}

/** Ask the chain about one transfer for this payment. */
export async function checkTransfer(intent: Pick<PaymentIntent, 'createdAt'>, meta: CryptoPaymentMeta, network: NetworkId, hash: string): Promise<VerifyResult> {
  const toAddress = meta.addresses[network];
  if (!toAddress) return { state: 'mismatch', reason: 'wrong_recipient' };
  return verifyTransfer({
    network,
    txHash: hash,
    toAddress,
    expectedMicro: meta.expectedMicro,
    notBefore: new Date(intent.createdAt.getTime() - CLOCK_SKEW_MS),
    notAfter: new Date(new Date(meta.paymentExpiresAt).getTime() + LATE_GRACE_MS),
  });
}

const OPEN = ['CREATED', 'PENDING', 'REQUIRES_ACTION'] as const;

export const cryptoAdapter: ProviderAdapter = {
  id: 'CRYPTO',
  slug: 'crypto',
  displayName: 'Crypto (USDT)',
  unavailableReason: 'not_configured',
  minAmountBaisa: 1_000,
  webhooks: false,

  isConfigured() {
    return configuredNetworks().length > 0;
  },

  async createPayment(input: ProviderPaymentInput): Promise<CreatePaymentResult> {
    const networks = configuredNetworks();
    if (networks.length === 0) throw new ProviderError('crypto', 'not_configured', 'No receiving address is configured');
    const cents = baseCents(input.amountBaisa);

    // Pick an offset nobody else has open for the same price: one amount = one payment.
    const open = await prisma.paymentIntent.findMany({
      where: {
        provider: 'CRYPTO',
        status: { in: [...OPEN] },
        id: { not: input.intentId },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        metadata: { path: ['crypto', 'baseCents'], equals: cents },
      },
      select: { metadata: true },
    });
    // An amount is "taken" while a transfer could still arrive for it (its send window + grace) or once a transfer is bound.
    const now = Date.now();
    const taken = new Set<number>();
    for (const i of open) {
      const m = readCryptoMeta(i.metadata);
      if (m && (m.tx || new Date(m.paymentExpiresAt).getTime() + LATE_GRACE_MS > now)) taken.add(m.slot);
    }
    const free = Array.from({ length: OFFSET_SLOTS }, (_, i) => i).filter((i) => !taken.has(i));
    if (free.length === 0) throw new ProviderError('crypto', 'no_free_amount', 'Too many open payments for this amount');
    const slot = free[randomInt(free.length)]!;

    const expected = expectedMicro(input.amountBaisa, slot);
    const sendUntil = new Date(Date.now() + PAYMENT_WINDOW_MS);
    const expiresAt = new Date(sendUntil.getTime() + CLAIM_WINDOW_MS);
    const meta: CryptoPaymentMeta = {
      token: 'USDT',
      baseCents: cents,
      slot,
      expectedMicro: expected,
      amountUsdt: formatUsdt(expected),
      addresses: Object.fromEntries(networks.map((n) => [n.id, n.address])),
      paymentExpiresAt: sendUntil.toISOString(),
    };
    return { providerRef: `crypto:${input.intentId}`, expiresAt, metadata: { crypto: meta } };
  },

  /** The provider never calls us: the customer gives the transaction id and the server reads the chain. */
  async verifyWebhook(): Promise<WebhookEvent> {
    throw new WebhookSignatureError('crypto', 'Crypto payments have no webhooks');
  },

  async fetchStatus(providerRef: string): Promise<ProviderStatus> {
    const intent = await prisma.paymentIntent.findUnique({ where: { providerRef } });
    return intent ? this.fetchIntentStatus!(intent) : { status: 'pending' };
  },

  async fetchIntentStatus(intent: PaymentIntent): Promise<ProviderStatus> {
    const meta = readCryptoMeta(intent.metadata);
    if (!meta?.tx) return { status: 'pending' }; // nothing to check until the customer gives a transaction id
    const res = await checkTransfer(intent, meta, meta.tx.network, meta.tx.hash);
    await saveCheck(intent.id, checkOf(res)).catch(() => undefined);
    // Only a final transfer that matches this payment pays it; everything else keeps waiting (or expires).
    return res.state === 'confirmed' ? { status: 'paid', amountBaisa: intent.amountBaisa, raw: res } : { status: 'pending', raw: res };
  },

  supportsRefund: () => false,
};
