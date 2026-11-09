import type { Promotion } from '@prisma/client';
import { prisma, type Db } from '@/lib/db';
import { isPromotionLive, lineMatches, type PromotionRule } from './promotions';

/** DB → rule. Dates stay Date objects (or ISO strings once cached). */
export function toRule(p: Promotion): PromotionRule {
  return {
    id: p.id,
    code: p.code,
    type: p.type,
    value: p.value,
    minSubtotalBaisa: p.minSubtotalBaisa,
    maxDiscountBaisa: p.maxDiscountBaisa,
    productIds: p.productIds,
    categoryIds: p.categoryIds,
    brandIds: p.brandIds,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    isActive: p.isActive,
    usageLimit: p.usageLimit,
    usageCount: p.usageCount,
  };
}

/** Promotions live right now (uncached — use inside order placement / checkout quotes). */
export async function loadLivePromotions(db: Db = prisma, now: Date = new Date()): Promise<PromotionRule[]> {
  const rows = await db.promotion.findMany({
    where: {
      isActive: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map(toRule).filter((r) => isPromotionLive(r, now));
}

/** Promotion ids a user may not use any more (perUserLimit reached on non-cancelled orders). */
export async function exhaustedPromotionsForUser(userId: string, promotions: readonly Promotion[] | readonly { id: string }[], db: Db = prisma): Promise<Set<string>> {
  const ids = promotions.map((p) => p.id);
  if (ids.length === 0) return new Set();
  const limits = await db.promotion.findMany({ where: { id: { in: ids }, perUserLimit: { not: null } }, select: { id: true, perUserLimit: true } });
  if (limits.length === 0) return new Set();
  const used = await db.order.groupBy({
    by: ['promotionId'],
    where: { userId, promotionId: { in: limits.map((l) => l.id) }, status: { notIn: ['CANCELLED'] } },
    _count: { _all: true },
  });
  const out = new Set<string>();
  for (const l of limits) {
    const n = used.find((u) => u.promotionId === l.id)?._count._all ?? 0;
    if (l.perUserLimit !== null && n >= l.perUserLimit) out.add(l.id);
  }
  return out;
}

/** Best automatic (code-less) promotion badge for a product. */
export function promoBadgeFor(
  rules: readonly PromotionRule[],
  product: { id: string; categoryId: string; parentCategoryId: string | null; brandId: string | null },
): { type: 'PERCENT' | 'FIXED'; value: number } | null {
  let best: PromotionRule | null = null;
  for (const r of rules) {
    if (r.code || r.minSubtotalBaisa) continue; // only unconditional automatic promotions get a card badge
    if (!lineMatches(r, { productId: product.id, categoryId: product.categoryId, parentCategoryId: product.parentCategoryId, brandId: product.brandId })) continue;
    if (!best || (r.type === best.type && r.value > best.value) || (r.type === 'PERCENT' && best.type === 'FIXED')) best = r;
  }
  return best ? { type: best.type, value: best.value } : null;
}
