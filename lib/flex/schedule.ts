import { assertBaisa } from '@/lib/money';

/**
 * DOOM FLEX schedule (pure). 0% interest, no fees: the instalments sum EXACTLY to the
 * principal (= cash price, delivery included once the order is placed).
 *
 * Owner's rule (18 Nov 2026): the customer pays only the FIRST instalment when confirming the plan, never
 * the full price, and that first instalment is a little higher than the others.
 *   - first instalment: due at confirmation (the order is prepared once it is paid);
 *   - the others: all equal, one per month after the confirmation day, on the same Muscat calendar day
 *     (clamped to the month's last day, e.g. 31 Jan → 28/29 Feb);
 *   - the first is about FLEX_FIRST_EXTRA_PCT % higher than each of the others. The others are rounded down
 *     to a whole 0.100 OMR when they are at least 1 OMR, and the first carries the rest, so the sum is the
 *     principal to the baisa.
 *   360.000 OMR → 3: 135.000 + 2 × 112.500 | 6: 70.000 + 5 × 58.000 | 12: 35.500 + 11 × 29.500
 */

export const FLEX_MONTHS = [3, 6, 12] as const;
export type FlexMonths = (typeof FLEX_MONTHS)[number];

/** How much higher (percent) the first instalment is than each of the following ones. */
export const FLEX_FIRST_EXTRA_PCT = 20;

export type ScheduledInstallment = {
  sequence: number;
  /** Calendar date (YYYY-MM-DD, Asia/Muscat). The first one is the confirmation day. */
  dueDate: string;
  amountBaisa: number;
};

export type FlexScheduleResult = {
  months: FlexMonths;
  principalBaisa: number;
  totalBaisa: number;
  interestBaisa: 0;
  feesBaisa: 0;
  /** First instalment, paid when the plan is confirmed. */
  firstBaisa: number;
  /** Each of the following monthly instalments (all equal). */
  monthlyBaisa: number;
  /** Last instalment (equal to `monthlyBaisa`). */
  lastBaisa: number;
  installments: ScheduledInstallment[];
};

export function isFlexMonths(v: unknown): v is FlexMonths {
  return typeof v === 'number' && (FLEX_MONTHS as readonly number[]).includes(v);
}

/**
 * Split `principalBaisa` into `count` instalments: the first about `extraPct` % higher than the others, the
 * others equal (whole 0.100 OMR from 1 OMR up), the first carrying the remainder. Sum = principal, to the baisa.
 */
export function flexAmounts(principalBaisa: number, count: number, extraPct: number = FLEX_FIRST_EXTRA_PCT): number[] {
  assertBaisa(principalBaisa, 'principalBaisa');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
  if (!Number.isInteger(extraPct) || extraPct < 0 || extraPct > 100) throw new RangeError('extraPct must be an integer from 0 to 100');
  if (principalBaisa < count) throw new RangeError('principal too small for this duration');
  if (count === 1) return [principalBaisa];
  let rest = Math.floor((principalBaisa * 100) / (count * 100 + extraPct));
  if (rest >= 1000) rest -= rest % 100;
  rest = Math.max(1, rest);
  const first = principalBaisa - rest * (count - 1);
  return [first, ...Array.from({ length: count - 1 }, () => rest)];
}

const MUSCAT_OFFSET_MS = 4 * 3600_000;

/** Muscat calendar date of an instant. */
export function muscatDate(d: Date): { y: number; m: number; d: number } {
  const local = new Date(d.getTime() + MUSCAT_OFFSET_MS);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
}

function addMonthsClamped(base: { y: number; m: number; d: number }, months: number): string {
  const total = base.m + months;
  const y = base.y + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(base.d, lastDay);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The plan for `principalBaisa` over `months` instalments, confirmed on `startDate` (the first instalment's day). */
export function computeSchedule(principalBaisa: number, months: FlexMonths, startDate: Date = new Date()): FlexScheduleResult {
  assertBaisa(principalBaisa, 'principalBaisa');
  if (principalBaisa <= 0) throw new RangeError('principalBaisa must be > 0');
  if (!isFlexMonths(months)) throw new RangeError('months must be 3, 6 or 12');
  if (principalBaisa < months) throw new RangeError('principal too small for this duration');
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) throw new RangeError('invalid startDate');
  const amounts = flexAmounts(principalBaisa, months);
  const base = muscatDate(startDate);
  const installments = amounts.map((amountBaisa, i) => ({ sequence: i + 1, dueDate: addMonthsClamped(base, i), amountBaisa }));
  return {
    months,
    principalBaisa,
    totalBaisa: principalBaisa,
    interestBaisa: 0,
    feesBaisa: 0,
    firstBaisa: amounts[0]!,
    monthlyBaisa: amounts[1]!,
    lastBaisa: amounts[amounts.length - 1]!,
    installments,
  };
}

/** `YYYY-MM-DD` → Date at UTC midnight (Prisma `@db.Date`). */
export function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Today's Muscat calendar date as a UTC-midnight Date (compare with `@db.Date` columns). */
export function muscatToday(now: Date = new Date()): Date {
  const { y, m, d } = muscatDate(now);
  return new Date(Date.UTC(y, m, d));
}
