import { splitInstallments } from '@/lib/money';

/**
 * DOOM FLEX preview (pure). 0% interest, no fees: the total always equals the cash
 * price. Every instalment is floor(total / months); the LAST one absorbs the baisa
 * remainder (SPEC). Used on product cards/pages before the money module's FLEX flow.
 */

export const FLEX_MONTHS = [3, 6, 12] as const;
export type FlexMonths = (typeof FLEX_MONTHS)[number];

export type FlexSchedule = {
  months: FlexMonths;
  totalBaisa: number;
  installments: number[];
  /** First (= regular) monthly amount. */
  monthlyBaisa: number;
  /** Last instalment (may be a few baisa higher). */
  lastBaisa: number;
};

export function computeSchedule(totalBaisa: number, months: FlexMonths): FlexSchedule {
  if (!(FLEX_MONTHS as readonly number[]).includes(months)) throw new RangeError('months must be 3, 6 or 12');
  const installments = splitInstallments(totalBaisa, months);
  return {
    months,
    totalBaisa,
    installments,
    monthlyBaisa: installments[0]!,
    lastBaisa: installments[installments.length - 1]!,
  };
}

/** "From X / month" on product cards: the regular 12-month instalment. */
export function flexMonthlyFrom(priceBaisa: number | null | undefined): number | null {
  if (priceBaisa === null || priceBaisa === undefined || priceBaisa <= 0) return null;
  return computeSchedule(priceBaisa, 12).monthlyBaisa;
}
