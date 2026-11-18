import { FLEX_MONTHS, flexAmounts, type FlexMonths } from '@/lib/flex/schedule';

/**
 * DOOM FLEX preview (pure) for product cards, the home page and the product page, with the SAME amounts as
 * the plan itself (lib/flex/schedule `flexAmounts`): 0% interest, no fees, the total equals the cash price,
 * the first instalment (paid at confirmation) a little higher, the others equal.
 */

export { FLEX_MONTHS, type FlexMonths };

export type FlexSchedule = {
  months: FlexMonths;
  totalBaisa: number;
  installments: number[];
  /** First instalment, paid when the customer confirms the plan. */
  firstBaisa: number;
  /** Each following monthly instalment. */
  monthlyBaisa: number;
  /** Last instalment (= monthlyBaisa). */
  lastBaisa: number;
};

export function computeSchedule(totalBaisa: number, months: FlexMonths): FlexSchedule {
  if (!(FLEX_MONTHS as readonly number[]).includes(months)) throw new RangeError('months must be 3, 6 or 12');
  const installments = flexAmounts(totalBaisa, months);
  return {
    months,
    totalBaisa,
    installments,
    firstBaisa: installments[0]!,
    monthlyBaisa: installments[1]!,
    lastBaisa: installments[installments.length - 1]!,
  };
}

/** 12-month plan of a price ("from X / month" on product cards), or null without a usable price. */
export function flexPlanFrom(priceBaisa: number | null | undefined): { firstBaisa: number; monthlyBaisa: number } | null {
  if (priceBaisa === null || priceBaisa === undefined || !Number.isSafeInteger(priceBaisa) || priceBaisa < 12) return null;
  const s = computeSchedule(priceBaisa, 12);
  return { firstBaisa: s.firstBaisa, monthlyBaisa: s.monthlyBaisa };
}

/** "From X / month" on product cards: the regular 12-month instalment (after the first one). */
export function flexMonthlyFrom(priceBaisa: number | null | undefined): number | null {
  return flexPlanFrom(priceBaisa)?.monthlyBaisa ?? null;
}
