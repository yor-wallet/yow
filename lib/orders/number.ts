import { randomInt } from 'node:crypto';

/**
 * Human order numbers: `DM-YYMMDD-XXXXX` (Muscat calendar date + 5 random chars from an
 * alphabet without ambiguous characters 0/O, 1/I/L). ~28.6M combinations per day; the
 * unique index on Order.number is the backstop (placement retries on collision).
 */

export const ORDER_NUMBER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORDER_NUMBER_RE = /^DM-\d{6}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;

export function muscatDateParts(d: Date): { yy: string; mm: string; dd: string } {
  // Oman is UTC+4 all year (no DST).
  const m = new Date(d.getTime() + 4 * 3600 * 1000);
  return {
    yy: String(m.getUTCFullYear() % 100).padStart(2, '0'),
    mm: String(m.getUTCMonth() + 1).padStart(2, '0'),
    dd: String(m.getUTCDate()).padStart(2, '0'),
  };
}

export function generateOrderNumber(now: Date = new Date(), rand: (max: number) => number = randomInt): string {
  const { yy, mm, dd } = muscatDateParts(now);
  let suffix = '';
  for (let i = 0; i < 5; i++) suffix += ORDER_NUMBER_ALPHABET[rand(ORDER_NUMBER_ALPHABET.length)];
  return `DM-${yy}${mm}${dd}-${suffix}`;
}

export function isOrderNumber(value: string): boolean {
  return ORDER_NUMBER_RE.test(value);
}
