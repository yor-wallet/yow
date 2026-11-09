import { applyBasisPoints } from '@/lib/money';

/**
 * Promotion engine (pure). A promotion targets products, categories and/or brands
 * (all empty = the whole cart). Automatic promotions (no `code`) apply by themselves;
 * coded promotions apply only when the customer enters the code. Promotions do not
 * stack: the single best discount wins. All amounts are integer baisa.
 */

export type PromotionRule = {
  id: string;
  code: string | null;
  type: 'PERCENT' | 'FIXED';
  /** PERCENT: basis points (100 = 1 %). FIXED: baisa. */
  value: number;
  minSubtotalBaisa: number | null;
  maxDiscountBaisa: number | null;
  productIds: string[];
  categoryIds: string[];
  brandIds: string[];
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  isActive: boolean;
  usageLimit: number | null;
  usageCount: number;
};

export type PricedLine = {
  productId: string;
  categoryId: string;
  /** The category's parent (a promotion on "Smartphones" covers "Apple iPhone"). */
  parentCategoryId?: string | null;
  brandId: string | null;
  lineTotalBaisa: number;
};

export type AppliedPromotion = { promotionId: string; discountBaisa: number; eligibleSubtotalBaisa: number };

function toTime(v: Date | string | null): number | null {
  if (v === null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function isPromotionLive(p: PromotionRule, now: Date = new Date()): boolean {
  if (!p.isActive) return false;
  const start = toTime(p.startsAt);
  const end = toTime(p.endsAt);
  if (start !== null && now.getTime() < start) return false;
  if (end !== null && now.getTime() >= end) return false;
  if (p.usageLimit !== null && p.usageCount >= p.usageLimit) return false;
  return true;
}

export function lineMatches(p: Pick<PromotionRule, 'productIds' | 'categoryIds' | 'brandIds'>, line: Omit<PricedLine, 'lineTotalBaisa'>): boolean {
  const scoped = p.productIds.length + p.categoryIds.length + p.brandIds.length > 0;
  if (!scoped) return true;
  return (
    p.productIds.includes(line.productId) ||
    p.categoryIds.includes(line.categoryId) ||
    (!!line.parentCategoryId && p.categoryIds.includes(line.parentCategoryId)) ||
    (!!line.brandId && p.brandIds.includes(line.brandId))
  );
}

export function discountFor(p: PromotionRule, lines: readonly PricedLine[]): AppliedPromotion | null {
  const eligible = lines.filter((l) => lineMatches(p, l)).reduce((s, l) => s + l.lineTotalBaisa, 0);
  if (eligible <= 0) return null;
  if (p.minSubtotalBaisa !== null && eligible < p.minSubtotalBaisa) return null;
  let discount = p.type === 'PERCENT' ? applyBasisPoints(eligible, Math.min(p.value, 10_000)) : Math.min(p.value, eligible);
  if (p.maxDiscountBaisa !== null) discount = Math.min(discount, p.maxDiscountBaisa);
  discount = Math.max(0, Math.min(discount, eligible));
  return discount > 0 ? { promotionId: p.id, discountBaisa: discount, eligibleSubtotalBaisa: eligible } : null;
}

/**
 * Best applicable promotion. `code` (case-insensitive) unlocks the coded promotion
 * with that code; automatic ones are always considered. `excluded` = promotion ids the
 * customer may not use any more (per-user limit reached).
 */
export function bestPromotion(
  promotions: readonly PromotionRule[],
  lines: readonly PricedLine[],
  opts: { code?: string | null; now?: Date; excluded?: ReadonlySet<string> } = {},
): AppliedPromotion | null {
  const code = opts.code?.trim().toUpperCase() || null;
  let best: AppliedPromotion | null = null;
  for (const p of promotions) {
    if (opts.excluded?.has(p.id)) continue;
    if (p.code && p.code.toUpperCase() !== code) continue;
    if (!isPromotionLive(p, opts.now)) continue;
    const applied = discountFor(p, lines);
    if (applied && (!best || applied.discountBaisa > best.discountBaisa)) best = applied;
  }
  return best;
}

/** Short label for a promotion value ("-10%" / "-5.000 OMR" is built by the UI). */
export function percentFromBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}
