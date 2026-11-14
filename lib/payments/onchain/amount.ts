/**
 * What a customer must send. The Omani rial is pegged to the US dollar (1 OMR = 2.6008 USD) and USDT is a
 * dollar stablecoin, so the amount is exact arithmetic — no price feed, no volatility.
 *
 * Every open payment gets its own amount: the whole cents of the price (rounded UP) plus a per-payment
 * offset of 0.0000–0.0099 USDT (100 slots, four decimals shown). The transfer that arrives must match that
 * amount to the 4th decimal, so a transaction can only ever belong to ONE payment: nobody can claim
 * someone else's transfer with a different order, and two customers paying the same price never collide.
 */
/** USD per OMR × 10 000 (2.6008). */
export const USD_PER_OMR_E4 = 26_008;
export const OFFSET_SLOTS = 100;
/** 1 slot = 0.0001 USDT = 100 micro-USDT. */
export const SLOT_MICRO = 100;
/** A transfer is accepted from the expected amount up to (excluding) expected + one slot. */
export const WINDOW_MICRO = SLOT_MICRO;

/** Whole US cents for a price in baisa, rounded up (never less than the real value). */
export function baseCents(baisa: number): number {
  if (!Number.isSafeInteger(baisa) || baisa <= 0) throw new RangeError('baisa must be a positive integer');
  return Math.ceil((baisa * USD_PER_OMR_E4) / 100_000);
}

/** Amount to send, in micro-USDT (1e-6), for a price and an offset slot. */
export function expectedMicro(baisa: number, slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= OFFSET_SLOTS) throw new RangeError('slot out of range');
  return baseCents(baisa) * 10_000 + slot * SLOT_MICRO;
}

/** "38.4517": exactly the four decimals the customer types into their wallet. */
export function formatUsdt(micro: number): string {
  const units = Math.round(micro / SLOT_MICRO);
  return `${Math.floor(units / 10_000)}.${String(units % 10_000).padStart(4, '0')}`;
}

/** Is a received amount (micro-USDT) the one expected for this payment? */
export function matchesExpected(receivedMicro: number, expected: number): boolean {
  return receivedMicro >= expected && receivedMicro < expected + WINDOW_MICRO;
}
