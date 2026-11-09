import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { localize } from '@/lib/localized';
import { mediaUrl } from '@/lib/storage';
import { decodeCursor, encodeCursor, type CatalogFilters, type SortKey } from './filters';
import { ARABIC_FROM, ARABIC_STRIP, ARABIC_TO, escapeLike, type ParsedQuery } from './search-query';
import { productAvailability, variantAvailability, availableQty } from './stock';
import { loadLivePromotions, promoBadgeFor } from './promotions-db';
import type { PromotionRule } from './promotions';
import type { Facets, ListResult, ProductCardData } from './types';

/**
 * Product listings (category, search, home rails) with keyset ("cursor") pagination.
 * One raw SQL query computes the per-product aggregates (min price, sellable stock,
 * variant SKUs), applies every filter and a single bigint sort key; a second Prisma
 * query hydrates the page of products into card data.
 */

export type ListFlag = 'featured' | 'deal' | 'recommended' | 'new';

export type ListOptions = {
  locale: string;
  categoryIds?: string[] | null;
  brandSlugs?: string[] | null;
  /** Any of these flags (OR). */
  flags?: ListFlag[] | null;
  productIds?: string[] | null;
  filters?: Partial<CatalogFilters>;
  search?: ParsedQuery | null;
  cursor?: string | null;
  limit: number;
  /** Skip the COUNT query (home rails). */
  withTotal?: boolean;
  promotions?: PromotionRule[];
};

const DIGITS_AR = '٠١٢٣٤٥٦٧٨٩';
const DIGITS_LATIN = '0123456789';
const NORM_FROM = ARABIC_FROM + DIGITS_AR + ARABIC_STRIP;
const NORM_TO = ARABIC_TO + DIGITS_LATIN;

/** SQL twin of normalizeSearchText(): lower + Arabic folding + Latin digits + strip diacritics. */
function normSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`translate(lower(${expr}), ${NORM_FROM}, ${NORM_TO})`;
}

const HAYSTACK = Prisma.sql`(coalesce(p.name->>'ar','') || ' ' || coalesce(p.name->>'en','') || ' ' || coalesce(p.name->>'fr','') || ' ' || coalesce(b.name,'') || ' ' || coalesce(b."nameAr",'') || ' ' || coalesce(p.model,'') || ' ' || p.sku || ' ' || coalesce(v.skus,''))`;
const NAMES = Prisma.sql`(coalesce(p.name->>'ar','') || ' ' || coalesce(p.name->>'en','') || ' ' || coalesce(p.name->>'fr',''))`;
const EPOCH = Prisma.sql`(EXTRACT(EPOCH FROM COALESCE(p."publishedAt", p."createdAt")) * 1000)::bigint`;
const TEN13 = Prisma.sql`10000000000000::bigint`;

function sortExpr(sort: SortKey, search: ParsedQuery | null): { expr: Prisma.Sql; dir: 'ASC' | 'DESC' } {
  switch (sort) {
    case 'newest':
      return { expr: EPOCH, dir: 'DESC' };
    case 'price_asc':
      return { expr: Prisma.sql`COALESCE(v.min_price, 999999999999)::bigint`, dir: 'ASC' };
    case 'price_desc':
      return { expr: Prisma.sql`COALESCE(v.min_price, -1)::bigint`, dir: 'DESC' };
    case 'relevance':
    default: {
      const base = Prisma.sql`(CASE WHEN COALESCE(v.available, 0) > 0 THEN 8 ELSE 0 END + CASE WHEN p."isFeatured" THEN 4 ELSE 0 END + CASE WHEN p."isRecommended" THEN 2 ELSE 0 END)`;
      if (search && search.tokens.length) {
        const whole = `%${escapeLike(search.text)}%`;
        const prefix = `${escapeLike(search.text)}%`;
        const exact = search.text;
        const score = Prisma.sql`(
          CASE WHEN lower(p.sku) = ${exact} OR (' ' || coalesce(v.skus,'') || ' ') LIKE ${`% ${escapeLike(exact)} %`} THEN 64 ELSE 0 END +
          CASE WHEN ${normSql(Prisma.sql`coalesce(p.name->>'ar','')`)} LIKE ${prefix} OR ${normSql(Prisma.sql`coalesce(p.name->>'en','')`)} LIKE ${prefix} OR ${normSql(Prisma.sql`coalesce(p.name->>'fr','')`)} LIKE ${prefix} THEN 32 ELSE 0 END +
          CASE WHEN ${normSql(NAMES)} LIKE ${whole} THEN 16 ELSE 0 END +
          ${base}
        )`;
        return { expr: Prisma.sql`(${score})::bigint * ${TEN13} + ${EPOCH}`, dir: 'DESC' };
      }
      return { expr: Prisma.sql`(${base})::bigint * ${TEN13} + ${EPOCH}`, dir: 'DESC' };
    }
  }
}

function whereClauses(opts: ListOptions): Prisma.Sql[] {
  const f = opts.filters ?? {};
  const conds: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`];
  if (opts.categoryIds) {
    if (opts.categoryIds.length === 0) conds.push(Prisma.sql`FALSE`);
    else conds.push(Prisma.sql`p."categoryId" IN (${Prisma.join(opts.categoryIds)})`);
  }
  if (opts.productIds) {
    if (opts.productIds.length === 0) conds.push(Prisma.sql`FALSE`);
    else conds.push(Prisma.sql`p.id IN (${Prisma.join(opts.productIds)})`);
  }
  const brands = [...(opts.brandSlugs ?? []), ...(f.brands ?? [])];
  if (opts.brandSlugs?.length && f.brands?.length) {
    // Both a fixed brand scope and a brand filter: intersection.
    const inter = opts.brandSlugs.filter((b) => f.brands!.includes(b));
    conds.push(inter.length ? Prisma.sql`b.slug IN (${Prisma.join(inter)})` : Prisma.sql`FALSE`);
  } else if (brands.length) {
    conds.push(Prisma.sql`b.slug IN (${Prisma.join(brands)})`);
  }
  if (opts.flags?.length) {
    const map: Record<ListFlag, Prisma.Sql> = {
      featured: Prisma.sql`p."isFeatured"`,
      deal: Prisma.sql`p."isDealOfDay"`,
      recommended: Prisma.sql`p."isRecommended"`,
      new: Prisma.sql`p."isNewArrival"`,
    };
    conds.push(Prisma.sql`(${Prisma.join(opts.flags.map((fl) => map[fl]), ' OR ')})`);
  }
  // Variant-level filters must hold on the SAME variant (e.g. 256 GB AND Black AND in stock).
  const vconds: Prisma.Sql[] = [];
  if (f.capacities?.length) vconds.push(Prisma.sql`x.capacity IN (${Prisma.join(f.capacities)})`);
  if (f.colors?.length) vconds.push(Prisma.sql`x.color IN (${Prisma.join(f.colors)})`);
  if (f.minOmr !== null && f.minOmr !== undefined) vconds.push(Prisma.sql`x."priceBaisa" >= ${f.minOmr * 1000}`);
  if (f.maxOmr !== null && f.maxOmr !== undefined) vconds.push(Prisma.sql`x."priceBaisa" <= ${f.maxOmr * 1000 + 999}`);
  if (f.inStock) vconds.push(Prisma.sql`x."priceBaisa" IS NOT NULL AND x.stock - x.reserved > 0 AND p."isSellable"`);
  if (vconds.length) {
    conds.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "ProductVariant" x WHERE x."productId" = p.id AND x."isActive" AND ${Prisma.join(vconds, ' AND ')})`,
    );
  }
  if (opts.search?.tokens.length) {
    for (const tok of opts.search.tokens) {
      conds.push(Prisma.sql`${normSql(HAYSTACK)} LIKE ${`%${escapeLike(tok)}%`}`);
    }
  }
  return conds;
}

const V_CTE = Prisma.sql`v AS (
  SELECT pv."productId",
         MIN(pv."priceBaisa") AS min_price,
         SUM(CASE WHEN pv."priceBaisa" IS NOT NULL THEN GREATEST(pv.stock - pv.reserved, 0) ELSE 0 END)::int AS available,
         string_agg(lower(pv.sku), ' ') AS skus
  FROM "ProductVariant" pv
  WHERE pv."isActive" = true
  GROUP BY pv."productId"
)`;

export async function listProducts(opts: ListOptions): Promise<ListResult> {
  const f = opts.filters ?? {};
  const sort = f.sort ?? 'relevance';
  const { expr, dir } = sortExpr(sort, opts.search ?? null);
  const where = Prisma.join(whereClauses(opts), ' AND ');
  const cursor = decodeCursor(opts.cursor);
  const limit = Math.max(1, Math.min(opts.limit, 240));

  const cursorCond = cursor
    ? dir === 'DESC'
      ? Prisma.sql`WHERE (sort_a, id) < (${BigInt(cursor.a)}, ${cursor.id})`
      : Prisma.sql`WHERE (sort_a, id) > (${BigInt(cursor.a)}, ${cursor.id})`
    : Prisma.empty;
  const order = dir === 'DESC' ? Prisma.sql`ORDER BY sort_a DESC, id DESC` : Prisma.sql`ORDER BY sort_a ASC, id ASC`;

  const base = Prisma.sql`WITH ${V_CTE}, base AS (
      SELECT p.id, ${expr} AS sort_a
      FROM "Product" p
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      LEFT JOIN v ON v."productId" = p.id
      WHERE ${where}
    )`;

  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<{ id: string; sort_a: string }[]>`${base} SELECT id, sort_a::text AS sort_a FROM base ${cursorCond} ${order} LIMIT ${limit + 1}`,
    opts.withTotal === false ? Promise.resolve(null) : prisma.$queryRaw<{ n: bigint }[]>`${base} SELECT count(*)::bigint AS n FROM base`,
  ]);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor({ a: last.sort_a, id: last.id }) : null;
  const promotions = opts.promotions ?? (await loadLivePromotions());
  const items = await hydrateCards(
    page.map((r) => r.id),
    opts.locale,
    promotions,
  );
  return { items, nextCursor, total: totalRows ? Number(totalRows[0]?.n ?? 0) : items.length };
}

export const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  categoryId: true,
  brandId: true,
  isSellable: true,
  isNewArrival: true,
  brand: { select: { name: true, nameAr: true } },
  category: { select: { icon: true, parentId: true } },
  images: { orderBy: { sort: 'asc' }, take: 1, select: { key: true, width: true, height: true, alt: true } },
  variants: {
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { sort: 'asc' }],
    select: { id: true, priceBaisa: true, compareAtBaisa: true, stock: true, reserved: true, lowStockThreshold: true, isActive: true },
  },
} satisfies Prisma.ProductSelect;

export type CardRow = Prisma.ProductGetPayload<{ select: typeof CARD_SELECT }>;

export function brandLabel(brand: { name: string; nameAr: string | null } | null, locale: string): string | null {
  if (!brand) return null;
  return locale === 'ar' && brand.nameAr ? brand.nameAr : brand.name;
}

export function toCard(p: CardRow, locale: string, promotions: readonly PromotionRule[]): ProductCardData {
  const priced = p.variants.filter((v) => v.priceBaisa !== null);
  const cheapest = priced.reduce<(typeof priced)[number] | null>((m, v) => (!m || v.priceBaisa! < m.priceBaisa! ? v : m), null);
  const prices = new Set(priced.map((v) => v.priceBaisa));
  const purchasable = p.variants.filter((v) => {
    const a = variantAvailability(v, p.isSellable);
    return a === 'in_stock' || a === 'low_stock';
  });
  const img = p.images[0];
  const name = localize(p.name, locale);
  return {
    id: p.id,
    slug: p.slug,
    name,
    brand: brandLabel(p.brand, locale),
    categoryIcon: p.category.icon,
    image: img
      ? { src: mediaUrl(img.key)!, width: img.width, height: img.height, alt: localize(img.alt, locale, name) }
      : null,
    priceBaisa: p.isSellable ? (cheapest?.priceBaisa ?? null) : null,
    compareAtBaisa: p.isSellable && cheapest?.compareAtBaisa && cheapest.compareAtBaisa > cheapest.priceBaisa! ? cheapest.compareAtBaisa : null,
    priceFrom: prices.size > 1,
    availability: productAvailability(p.variants, p.isSellable),
    quickAddVariantId: p.variants.length === 1 && purchasable.length === 1 ? purchasable[0]!.id : null,
    variantCount: p.variants.length,
    isNew: p.isNewArrival,
    promo: promoBadgeFor(promotions, { id: p.id, categoryId: p.categoryId, parentCategoryId: p.category.parentId, brandId: p.brandId }),
  };
}

export async function hydrateCards(ids: string[], locale: string, promotions: readonly PromotionRule[]): Promise<ProductCardData[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: CARD_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [toCard(r, locale, promotions)] : [];
  });
}

/** Filter options present in a category scope (only values that exist — never invented). */
export async function getFacets(opts: { categoryIds: string[] | null; search?: ParsedQuery | null; locale: string }): Promise<Facets> {
  const conds = whereClauses({ locale: opts.locale, categoryIds: opts.categoryIds, search: opts.search ?? null, limit: 1 });
  const where = Prisma.join(conds, ' AND ');
  const scope = Prisma.sql`WITH ${V_CTE}, scope AS (
      SELECT p.id, p."brandId" FROM "Product" p
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      LEFT JOIN v ON v."productId" = p.id
      WHERE ${where}
    )`;
  const [brands, caps, colors, bounds] = await Promise.all([
    prisma.$queryRaw<{ slug: string; name: string; nameAr: string | null; n: bigint }[]>`${scope}
      SELECT b.slug, b.name, b."nameAr", count(*)::bigint AS n FROM scope s JOIN "Brand" b ON b.id = s."brandId"
      GROUP BY b.slug, b.name, b."nameAr", b.sort ORDER BY b.sort, b.name`,
    prisma.$queryRaw<{ value: string; n: bigint }[]>`${scope}
      SELECT pv.capacity AS value, count(DISTINCT pv."productId")::bigint AS n FROM scope s
      JOIN "ProductVariant" pv ON pv."productId" = s.id AND pv."isActive" AND pv.capacity IS NOT NULL AND pv.capacity <> ''
      GROUP BY pv.capacity`,
    prisma.$queryRaw<{ value: string; hex: string | null; n: bigint }[]>`${scope}
      SELECT pv.color AS value, max(pv."colorHex") AS hex, count(DISTINCT pv."productId")::bigint AS n FROM scope s
      JOIN "ProductVariant" pv ON pv."productId" = s.id AND pv."isActive" AND pv.color IS NOT NULL AND pv.color <> ''
      GROUP BY pv.color ORDER BY pv.color`,
    prisma.$queryRaw<{ lo: number | null; hi: number | null }[]>`${scope}
      SELECT min(pv."priceBaisa")::int AS lo, max(pv."priceBaisa")::int AS hi FROM scope s
      JOIN "ProductVariant" pv ON pv."productId" = s.id AND pv."isActive" AND pv."priceBaisa" IS NOT NULL`,
  ]);
  const lo = bounds[0]?.lo ?? null;
  const hi = bounds[0]?.hi ?? null;
  return {
    brands: brands.map((b) => ({ slug: b.slug, name: opts.locale === 'ar' && b.nameAr ? b.nameAr : b.name, count: Number(b.n) })),
    capacities: caps
      .map((c) => ({ value: c.value, count: Number(c.n) }))
      .sort((a, b) => capacityRank(a.value) - capacityRank(b.value) || a.value.localeCompare(b.value)),
    colors: colors.map((c) => ({ value: c.value, hex: c.hex && /^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : null, count: Number(c.n) })),
    priceMinOmr: lo === null ? null : Math.floor(lo / 1000),
    priceMaxOmr: hi === null ? null : Math.ceil(hi / 1000),
  };
}

/** "64GB" < "128 GB" < "1TB" ordering for capacity chips. */
export function capacityRank(value: string): number {
  const m = /^(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)?/i.exec(value.trim());
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number(m[1]!.replace(',', '.'));
  const unit = (m[2] ?? 'GB').toUpperCase();
  return unit === 'TB' ? n * 1024 : unit === 'MB' ? n / 1024 : n;
}

export { availableQty };
