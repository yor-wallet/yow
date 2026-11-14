import type { NetworkId } from './onchain/networks';

/**
 * What is stored in `PaymentIntent.metadata.crypto` for a payment made in USDT straight to the shop's
 * wallets. Everything the customer was shown is snapshotted here, so the verification always uses the
 * address and the amount the customer actually saw — even if the configuration changes afterwards.
 */
export type CryptoCheck = { state: string; at: string; reason?: string; confirmations?: number; required?: number; receivedMicro?: number };

export type CryptoPaymentMeta = {
  token: 'USDT';
  /** Whole US cents of the price (rounded up) and the per-payment offset slot (0–99). */
  baseCents: number;
  slot: number;
  /** Amount to send, micro-USDT, and as typed in a wallet ("38.4517"). */
  expectedMicro: number;
  amountUsdt: string;
  /** Receiving addresses shown to the customer, per network. */
  addresses: Partial<Record<NetworkId, string>>;
  /** End of the window to send the transfer (the intent's own expiry is pushed back once a transfer is found). */
  paymentExpiresAt: string;
  /** The transfer this payment is bound to (only a transfer that matches this payment is ever bound). */
  tx?: { network: NetworkId; hash: string; boundAt: string };
  check?: CryptoCheck;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function readCryptoMeta(metadata: unknown): CryptoPaymentMeta | null {
  if (!isRecord(metadata) || !isRecord(metadata.crypto)) return null;
  const c = metadata.crypto;
  if (c.token !== 'USDT' || typeof c.expectedMicro !== 'number' || typeof c.amountUsdt !== 'string' || !isRecord(c.addresses) || typeof c.paymentExpiresAt !== 'string') return null;
  return c as unknown as CryptoPaymentMeta;
}
