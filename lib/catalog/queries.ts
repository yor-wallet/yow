import { prisma } from '@/lib/db';
import { localize } from '@/lib/localized';
import { mediaUrl } from '@/lib/storage';
import { availableQty, variantAvailability, type Availability } from './stock';
import { brandLabel } from './listing';

/** Category, product detail, reviews and delivery-info queries (uncached, live stock). */

export type CategoryNode = { id: string; slug: string; name: string; icon: string | null };
export type CategoryDetail = CategoryNode & {
  description: string | null;
  parent: CategoryNode | null;
  children: CategoryNode[];
  /** This category + all descendants (listing scope). */
  scopeIds: string[];
};

export async function getCategoryBySlug(slug: string, locale: string): Promise<CategoryDetail | null> {
  const c = await prisma.category.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      icon: true,
      parent: { select: { id: true, slug: true, name: true, icon: true, isActive: true } },
      children: {
        where: { isActive: true },
        orderBy: { sort: 'asc' },
        select: { id: true, slug: true, name: true, icon: true, children: { where: { isActive: true }, select: { id: true } } },
      },
    },
  });
  if (!c) return null;
  const node = (n: { id: string; slug: string; name: unknown; icon: string | null }): CategoryNode => ({
    id: n.id,
    slug: n.slug,
    name: localize(n.name, locale, n.slug),
    icon: n.icon,
  });
  return {
    ...node(c),
    description: c.description ? localize(c.description, locale) || null : null,
    parent: c.parent && c.parent.isActive ? node(c.parent) : null,
    children: c.children.map(node),
    scopeIds: [c.id, ...c.children.flatMap((ch) => [ch.id, ...ch.children.map((g) => g.id)])],
  };
}

/** Ids of the given category slugs and all their descendants (2 levels). */
export async function categoryScopeIds(slugs: string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const rows = await prisma.category.findMany({
    where: { slug: { in: slugs }, isActive: true },
    select: { id: true, children: { where: { isActive: true }, select: { id: true, children: { where: { isActive: true }, select: { id: true } } } } },
  });
  return [...new Set(rows.flatMap((r) => [r.id, ...r.children.flatMap((c) => [c.id, ...c.children.map((g) => g.id)])]))];
}

export type VariantView = {
  id: string;
  sku: string;
  label: string | null;
  color: string | null;
  colorHex: string | null;
  capacity: string | null;
  priceBaisa: number | null;
  compareAtBaisa: number | null;
  available: number;
  availability: Availability;
  isDefault: boolean;
};

export type ImageView = { id: string; src: string; width: number; height: number; alt: string; variantId: string | null };
export type SpecRow = { key: string; label: string; value: string };

export type ProductDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  highlights: string[];
  specs: SpecRow[];
  model: string | null;
  sku: string;
  warrantyMonths: number | null;
  isSellable: boolean;
  expressEligible: boolean;
  weightGrams: number | null;
  brand: { id: string; slug: string; name: string } | null;
  category: { id: string; slug: string; name: string; icon: string | null; parentId: string | null; parent: { slug: string; name: string } | null };
  images: ImageView[];
  variants: VariantView[];
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
};

function localizedList(value: unknown, locale: string): string[] {
  if (!value || typeof value !== 'object') return [];
  const v = value as Record<string, unknown>;
  for (const l of [locale, 'en', 'ar', 'fr']) {
    const arr = v[l];
    if (Array.isArray(arr) && arr.length) return arr.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 12);
  }
  return [];
}

export function specRows(value: unknown, locale: string): SpecRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row, i): SpecRow | null => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const label = localize(r.label, locale) || (typeof r.key === 'string' ? r.key : '');
      const val = localize(r.value, locale);
      if (!label || !val) return null;
      return { key: typeof r.key === 'string' ? r.key : `spec-${i}`, label, value: val };
    })
    .filter((x): x is SpecRow => x !== null)
    .slice(0, 60);
}

export async function getProductDetail(slug: string, locale: string): Promise<ProductDetail | null> {
  const p = await prisma.product.findFirst({
    where: { slug, status: 'ACTIVE' },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      highlights: true,
      specs: true,
      model: true,
      sku: true,
      warrantyMonths: true,
      isSellable: true,
      expressEligible: true,
      weightGrams: true,
      seoTitle: true,
      seoDescription: true,
      updatedAt: true,
      brand: { select: { id: true, slug: true, name: true, nameAr: true } },
      category: { select: { id: true, slug: true, name: true, icon: true, parentId: true, parent: { select: { slug: true, name: true } } } },
      images: { orderBy: { sort: 'asc' }, select: { id: true, key: true, width: true, height: true, alt: true, variantId: true } },
      variants: {
        where: { isActive: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          sku: true,
          name: true,
          color: true,
          colorHex: true,
          capacity: true,
          priceBaisa: true,
          compareAtBaisa: true,
          stock: true,
          reserved: true,
          lowStockThreshold: true,
          isActive: true,
          isDefault: true,
        },
      },
    },
  });
  if (!p) return null;
  const name = localize(p.name, locale, p.sku);
  return {
    id: p.id,
    slug: p.slug,
    name,
    description: localize(p.description, locale) || null,
    highlights: localizedList(p.highlights, locale),
    specs: specRows(p.specs, locale),
    model: p.model,
    sku: p.sku,
    warrantyMonths: p.warrantyMonths,
    isSellable: p.isSellable,
    expressEligible: p.expressEligible,
    weightGrams: p.weightGrams,
    brand: p.brand ? { id: p.brand.id, slug: p.brand.slug, name: brandLabel(p.brand, locale)! } : null,
    category: {
      id: p.category.id,
      slug: p.category.slug,
      name: localize(p.category.name, locale, p.category.slug),
      icon: p.category.icon,
      parentId: p.category.parentId,
      parent: p.category.parent ? { slug: p.category.parent.slug, name: localize(p.category.parent.name, locale) } : null,
    },
    images: p.images.map((img) => ({
      id: img.id,
      src: mediaUrl(img.key)!,
      width: img.width,
      height: img.height,
      alt: localize(img.alt, locale, name),
      variantId: img.variantId,
    })),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      label: localize(v.name, locale) || null,
      color: v.color,
      colorHex: v.colorHex && /^#[0-9a-fA-F]{6}$/.test(v.colorHex) ? v.colorHex : null,
      capacity: v.capacity,
      priceBaisa: p.isSellable ? v.priceBaisa : null,
      compareAtBaisa: v.compareAtBaisa,
      available: availableQty(v.stock, v.reserved),
      availability: variantAvailability(v, p.isSellable),
      isDefault: v.isDefault,
    })),
    seoTitle: localize(p.seoTitle, locale) || null,
    seoDescription: localize(p.seoDescription, locale) || null,
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ───────────── Reviews (verified purchases only, published by moderation) ─────────────

export type ReviewView = {
  id: string;
  rating: number;
  title: string | null;
  text: string;
  author: string;
  createdAt: string;
  locale: string;
  product?: { slug: string; name: string };
};

/** "Fatma Al-Balushi" → "Fatma A." (data minimisation). */
export function publicAuthorName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  const initial = last.replace(/^(al-|el-|bin|bint)/i, '').charAt(0) || last.charAt(0);
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

export async function getProductReviews(productId: string, take = 20): Promise<{ reviews: ReviewView[]; count: number; average: number | null }> {
  const where = { productId, status: 'PUBLISHED' as const };
  const [rows, agg] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, rating: true, title: true, text: true, createdAt: true, locale: true, user: { select: { fullName: true } } },
    }),
    prisma.review.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  return {
    reviews: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      text: r.text,
      author: publicAuthorName(r.user.fullName),
      createdAt: r.createdAt.toISOString(),
      locale: r.locale,
    })),
    count: agg._count._all,
    average: agg._avg.rating === null ? null : Math.round(agg._avg.rating * 10) / 10,
  };
}

export async function getLatestReviews(locale: string, take = 6): Promise<ReviewView[]> {
  const rows = await prisma.review.findMany({
    where: { status: 'PUBLISHED', product: { status: 'ACTIVE' } },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      rating: true,
      title: true,
      text: true,
      createdAt: true,
      locale: true,
      user: { select: { fullName: true } },
      product: { select: { slug: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    text: r.text,
    author: publicAuthorName(r.user.fullName),
    createdAt: r.createdAt.toISOString(),
    locale: r.locale,
    product: { slug: r.product.slug, name: localize(r.product.name, locale) },
  }));
}

/** First delivered, not-yet-reviewed order item of `productId` bought by `userId` (verified purchase). */
export async function reviewableOrderItem(userId: string, productId: string): Promise<{ id: string } | null> {
  return prisma.orderItem.findFirst({
    where: { productId, review: null, order: { userId, status: 'DELIVERED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}

export async function hasPendingReview(userId: string, productId: string): Promise<boolean> {
  return (await prisma.review.count({ where: { userId, productId, status: 'PENDING' } })) > 0;
}

// ───────────── Delivery info (from admin-configured zones; never invented) ─────────────

export type DeliveryInfo = {
  standard: { configured: boolean; hours: number | null };
  express: { configured: boolean; hours: number | null; areas: string[] };
};

export async function getDeliveryInfo(locale: string): Promise<DeliveryInfo> {
  const zones = await prisma.deliveryZone.findMany({
    where: { isActive: true },
    orderBy: { sort: 'asc' },
    select: {
      standardFeeBaisa: true,
      expressFeeBaisa: true,
      expressAvailable: true,
      standardHours: true,
      expressHours: true,
      governorate: { select: { name: true } },
    },
  });
  const std = zones.filter((z) => z.standardFeeBaisa !== null);
  const exp = zones.filter((z) => z.expressAvailable && z.expressFeeBaisa !== null);
  return {
    standard: { configured: std.length > 0, hours: std.length ? Math.min(...std.map((z) => z.standardHours)) : null },
    express: {
      configured: exp.length > 0,
      hours: exp.length ? Math.min(...exp.map((z) => z.expressHours)) : null,
      areas: [...new Set(exp.map((z) => localize(z.governorate.name, locale)))],
    },
  };
}

export async function getUserProductFlags(userId: string | null, productId: string): Promise<{ favorite: boolean; compared: boolean; compareCount: number }> {
  if (!userId) return { favorite: false, compared: false, compareCount: 0 };
  const [fav, cmp, count] = await Promise.all([
    prisma.favorite.findUnique({ where: { userId_productId: { userId, productId } }, select: { id: true } }),
    prisma.compareItem.findUnique({ where: { userId_productId: { userId, productId } }, select: { id: true } }),
    prisma.compareItem.count({ where: { userId } }),
  ]);
  return { favorite: !!fav, compared: !!cmp, compareCount: count };
}

export async function getFavoriteIds(userId: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await prisma.favorite.findMany({ where: { userId }, select: { productId: true }, take: 500 });
  return rows.map((r) => r.productId);
}
