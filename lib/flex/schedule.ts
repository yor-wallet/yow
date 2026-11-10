import { assertBaisa, splitInstallments } from '@/lib/money';

/**
 * DOOM FLEX schedule (pure). 0% interest, no fees: the instalments sum EXACTLY to the
 * principal (= cash price). Every instalment is floor(principal / months); the LAST one
 * absorbs the baisa remainder (lib/money `splitInstallments`).
 *   360.000 OMR → 3 × 120.000 | 6 × 60.000 | 12 × 30.000
 * Due dates: one per month after `startDate`, on the same Muscat calendar day (clamped to
 * the month's last day, e.g. 31 Jan → 28/29 Feb).
 */

export const FLEX_MONTHS = [3, 6, 12] as const;
export type FlexMonths = (typeof FLEX_MONTHS)[number];

export type ScheduledInstallment = {
  sequence: number;
  /** Calendar date (YYYY-MM-DD, Asia/Muscat). */
  dueDate: string;
  amountBaisa: number;
};

export type FlexScheduleResult = {
  months: FlexMonths;
  principalBaisa: number;
  totalBaisa: number;
  interestBaisa: 0;
  feesBaisa: 0;
  monthlyBaisa: number;
  lastBaisa: number;
  installments: ScheduledInstallment[];
};

export function isFlexMonths(v: unknown): v is FlexMonths {
  return typeof v === 'number' && (FLEX_MONTHS as readonly number[]).includes(v);
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

export function computeSchedule(principalBaisa: number, months: FlexMonths, startDate: Date = new Date()): FlexScheduleResult {
  assertBaisa(principalBaisa, 'principalBaisa');
  if (principalBaisa <= 0) throw new RangeError('principalBaisa must be > 0');
  if (!isFlexMonths(months)) throw new RangeError('months must be 3, 6 or 12');
  if (principalBaisa < months) throw new RangeError('principal too small for this duration');
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) throw new RangeError('invalid startDate');
  const amounts = splitInstallments(principalBaisa, months);
  const base = muscatDate(startDate);
  const installments = amounts.map((amountBaisa, i) => ({ sequence: i + 1, dueDate: addMonthsClamped(base, i + 1), amountBaisa }));
  return {
    months,
    principalBaisa,
    totalBaisa: principalBaisa,
    interestBaisa: 0,
    feesBaisa: 0,
    monthlyBaisa: amounts[0]!,
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
