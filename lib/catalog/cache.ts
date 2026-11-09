import 'server-only';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db';
import { localize } from '@/lib/localized';
import { getCampaignSlides, type CampaignSlide, type Placement } from './campaigns';
import { listProducts, type ListFlag } from './listing';
import { categoryScopeIds, getLatestReviews, type ReviewView } from './queries';
import { loadLivePromotions } from './promotions-db';
import { isPromotionLive, type PromotionRule } from './promotions';
import type { ProductCardData } from './types';

/**
 * Short-lived caches for PUBLIC storefront data (home rails, campaigns, promotions).
 * Product/category/search/cart/checkout pages always read live data (stock!).
 * Admin changes become visible within `revalidate` seconds, or immediately with
 * `revalidateTag(CATALOG_TAG | CAMPAIGNS_TAG | PROMOTIONS_TAG)`.
 */

export const CATALOG_TAG = 'catalog';
export const CAMPAIGNS_TAG = 'campaigns';
export const PROMOTIONS_TAG = 'promotions';
const REVALIDATE = 60;

export const RAIL_KEYS = ['deals', 'smartphones', 'apple', 'samsung', 'honor', 'computers', 'audio', 'recommended'] as const;
export type RailKey = (typeof RAIL_KEYS)[number];

type RailDef = { categorySlugs?: string[]; brandSlugs?: string[]; flags?: ListFlag[]; fallbackNewest?: boolean };

export const RAILS: Record<RailKey, RailDef> = {
  deals: { flags: ['deal'] },
  smartphones: { categorySlugs: ['smartphones'] },
  apple: { brandSlugs: ['apple'] },
  samsung: { brandSlugs: ['samsung'] },
  honor: { brandSlugs: ['honor'] },
  computers: { categorySlugs: ['computers'] },
  audio: { categorySlugs: ['audio', 'accessories'] },
  recommended: { flags: ['recommended', 'featured'], fallbackNewest: true },
};

/** Live promotions with dates serialised (cache-safe). */
const cachedPromotions = unstable_cache(
  async (): Promise<PromotionRule[]> =>
    (await loadLivePromotions()).map((p) => ({
      ...p,
      startsAt: p.startsAt ? new Date(p.startsAt).toISOString() : null,
      endsAt: p.endsAt ? new Date(p.endsAt).toISOString() : null,
    })),
  ['live-promotions-v1'],
  { revalidate: REVALIDATE, tags: [PROMOTIONS_TAG] },
);

export async function getCachedPromotions(): Promise<PromotionRule[]> {
  const now = new Date();
  return (await cachedPromotions()).filter((p) => isPromotionLive(p, now));
}

const cachedRail = unstable_cache(
  async (key: RailKey, locale: string): Promise<ProductCardData[]> => {
    const def = RAILS[key];
    const promotions = await getCachedPromotions();
    const categoryIds = def.categorySlugs ? await categoryScopeIds(def.categorySlugs) : null;
    const res = await listProducts({
      locale,
      categoryIds,
      brandSlugs: def.brandSlugs ?? null,
      flags: def.flags ?? null,
      filters: { sort: 'relevance' },
      limit: 12,
      withTotal: false,
      promotions,
    });
    if (res.items.length === 0 && def.fallbackNewest) {
      return (await listProducts({ locale, filters: { sort: 'newest' }, limit: 12, withTotal: false, promotions })).items;
    }
    return res.items;
  },
  ['home-rail-v1'],
  { revalidate: REVALIDATE, tags: [CATALOG_TAG] },
);

export function getHomeRail(key: RailKey, locale: string): Promise<ProductCardData[]> {
  return cachedRail(key, locale);
}

const cachedSlides = unstable_cache(
  async (placement: Placement, locale: string): Promise<CampaignSlide[]> => getCampaignSlides(placement, locale),
  ['campaign-slides-v1'],
  { revalidate: REVALIDATE, tags: [CAMPAIGNS_TAG, CATALOG_TAG] },
);

export function getCachedCampaigns(placement: Placement, locale: string): Promise<CampaignSlide[]> {
  return cachedSlides(placement, locale);
}

const cachedReviews = unstable_cache(async (locale: string): Promise<ReviewView[]> => getLatestReviews(locale, 6), ['home-reviews-v1'], {
  revalidate: REVALIDATE,
  tags: [CATALOG_TAG],
});

export function getCachedLatestReviews(locale: string): Promise<ReviewView[]> {
  return cachedReviews(locale);
}

export type PromotionView = {
  id: string;
  name: string;
  description: string | null;
  code: string | null;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotalBaisa: number | null;
  maxDiscountBaisa: number | null;
  endsAt: string | null;
  scope: { products: number; categories: string[]; brands: string[] };
};

const cachedPromotionViews = unstable_cache(
  async (locale: string): Promise<PromotionView[]> => {
    const rules = await loadLivePromotions();
    if (rules.length === 0) return [];
    const rows = await prisma.promotion.findMany({ where: { id: { in: rules.map((r) => r.id) } }, orderBy: [{ endsAt: 'asc' }, { createdAt: 'desc' }] });
    const catIds = [...new Set(rows.flatMap((r) => r.categoryIds))];
    const brandIds = [...new Set(rows.flatMap((r) => r.brandIds))];
    const [cats, brands] = await Promise.all([
      catIds.length ? prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }) : [],
      brandIds.length ? prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true, nameAr: true } }) : [],
    ]);
    return rows.map((r) => ({
      id: r.id,
      name: localize(r.name, locale),
      description: localize(r.description, locale) || null,
      code: r.code,
      type: r.type,
      value: r.value,
      minSubtotalBaisa: r.minSubtotalBaisa,
      maxDiscountBaisa: r.maxDiscountBaisa,
      endsAt: r.endsAt ? r.endsAt.toISOString() : null,
      scope: {
        products: r.productIds.length,
        categories: cats.filter((c) => r.categoryIds.includes(c.id)).map((c) => localize(c.name, locale)),
        brands: brands.filter((b) => r.brandIds.includes(b.id)).map((b) => (locale === 'ar' && b.nameAr ? b.nameAr : b.name)),
      },
    }));
  },
  ['promotion-views-v1'],
  { revalidate: REVALIDATE, tags: [PROMOTIONS_TAG] },
);

export async function getPromotionViews(locale: string): Promise<PromotionView[]> {
  const now = Date.now();
  return (await cachedPromotionViews(locale)).filter((p) => !p.endsAt || Date.parse(p.endsAt) > now);
}
