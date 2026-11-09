import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '@/lib/db';
import { localize } from '@/lib/localized';
import { mediaUrl } from '@/lib/storage';
import { availableQty } from '@/lib/catalog/stock';
import { brandLabel } from '@/lib/catalog/listing';
import { bestPromotion, type PricedLine, type PromotionRule } from '@/lib/catalog/promotions';
import { computeTotals, evaluateLine, type CartTotals, type LineState } from './math';

/**
 * Server-side pricing of cart lines from CURRENT variant data (price, stock, status).
 * Shared by the cart page, the checkout quote and order placement, so the customer
 * always sees exactly what placeOrder() will charge.
 */

export const LINE_VARIANT_SELECT = {
  id: true,
  sku: true,
  name: true,
  color: true,
  capacity: true,
  priceBaisa: true,
  compareAtBaisa: true,
  costBaisa: true,
  stock: true,
  reserved: true,
  isActive: true,
  productId: true,
  product: {
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      isSellable: true,
      categoryId: true,
      brandId: true,
      warrantyMonths: true,
      expressEligible: true,
      weightGrams: true,
      volumeCm3: true,
      brand: { select: { name: true, nameAr: true } },
      category: { select: { parentId: true } },
      images: { orderBy: { sort: 'asc' }, take: 1, select: { key: true } },
    },
  },
  images: { orderBy: { sort: 'asc' }, take: 1, select: { key: true } },
} satisfies Prisma.ProductVariantSelect;

export type LineVariant = Prisma.ProductVariantGetPayload<{ select: typeof LINE_VARIANT_SELECT }>;

export type PricedCartLine = {
  itemId: string | null;
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  /** LocalizedText snapshot source. */
  nameJson: unknown;
  brand: string | null;
  variantLabel: string | null;
  sku: string;
  imageKey: string | null;
  image: string | null;
  qty: number;
  allowedQty: number;
  available: number;
  unitPriceBaisa: number | null;
  compareAtBaisa: number | null;
  unitCostBaisa: number | null;
  lineTotalBaisa: number;
  state: LineState;
  categoryId: string;
  parentCategoryId: string | null;
  brandId: string | null;
  warrantyMonths: number | null;
  expressEligible: boolean;
  weightGrams: number | null;
  volumeCm3: number | null;
};

export function variantLabel(v: Pick<LineVariant, 'name' | 'capacity' | 'color'>, locale: string): string | null {
  const named = localize(v.name, locale);
  if (named) return named;
  const parts = [v.capacity, v.color].filter((x): x is string => !!x && !!x.trim());
  return parts.length ? parts.join(' · ') : null;
}

export function priceLine(item: { id: string | null; qty: number }, v: LineVariant, locale: string): PricedCartLine {
  const sellable = v.isActive && v.product.status === 'ACTIVE' && v.product.isSellable;
  const available = availableQty(v.stock, v.reserved);
  const ev = evaluateLine({ qty: item.qty, priceBaisa: v.priceBaisa, available, sellable });
  const imageKey = v.images[0]?.key ?? v.product.images[0]?.key ?? null;
  return {
    itemId: item.id,
    variantId: v.id,
    productId: v.product.id,
    slug: v.product.slug,
    name: localize(v.product.name, locale, v.sku),
    nameJson: v.product.name,
    brand: brandLabel(v.product.brand, locale),
    variantLabel: variantLabel(v, locale),
    sku: v.sku,
    imageKey,
    image: mediaUrl(imageKey),
    qty: item.qty,
    allowedQty: ev.allowedQty,
    available,
    unitPriceBaisa: ev.unitPriceBaisa,
    compareAtBaisa: v.compareAtBaisa && v.priceBaisa !== null && v.compareAtBaisa > v.priceBaisa ? v.compareAtBaisa : null,
    unitCostBaisa: v.costBaisa,
    lineTotalBaisa: ev.lineTotalBaisa,
    state: ev.state,
    categoryId: v.product.categoryId,
    parentCategoryId: v.product.category.parentId,
    brandId: v.product.brandId,
    warrantyMonths: v.product.warrantyMonths,
    expressEligible: v.product.expressEligible,
    weightGrams: v.product.weightGrams,
    volumeCm3: v.product.volumeCm3,
  };
}

export async function priceItems(
  items: readonly { id: string | null; variantId: string; qty: number }[],
  locale: string,
  db: Db = prisma,
): Promise<PricedCartLine[]> {
  if (items.length === 0) return [];
  const variants = await db.productVariant.findMany({ where: { id: { in: items.map((i) => i.variantId) } }, select: LINE_VARIANT_SELECT });
  const byId = new Map(variants.map((v) => [v.id, v]));
  return items.flatMap((i) => {
    const v = byId.get(i.variantId);
    return v ? [priceLine(i, v, locale)] : [];
  });
}

export function toPromoLines(lines: readonly PricedCartLine[]): PricedLine[] {
  return lines
    .filter((l) => l.lineTotalBaisa > 0)
    .map((l) => ({
      productId: l.productId,
      categoryId: l.categoryId,
      parentCategoryId: l.parentCategoryId,
      brandId: l.brandId,
      lineTotalBaisa: l.lineTotalBaisa,
    }));
}

export type PricedCart = {
  lines: PricedCartLine[];
  totals: CartTotals;
  promotion: { id: string; discountBaisa: number } | null;
};

export function priceCart(
  lines: PricedCartLine[],
  promotions: readonly PromotionRule[],
  opts: { code?: string | null; excluded?: ReadonlySet<string>; deliveryFeeBaisa?: number; now?: Date } = {},
): PricedCart {
  const promo = bestPromotion(promotions, toPromoLines(lines), { code: opts.code, excluded: opts.excluded, now: opts.now });
  const totals = computeTotals(
    lines.map((l) => ({ state: l.state, allowedQty: l.allowedQty, unitPriceBaisa: l.unitPriceBaisa, lineTotalBaisa: l.lineTotalBaisa })),
    { discountBaisa: promo?.discountBaisa ?? 0, deliveryFeeBaisa: opts.deliveryFeeBaisa ?? 0 },
  );
  return { lines, totals, promotion: promo ? { id: promo.promotionId, discountBaisa: promo.discountBaisa } : null };
}
