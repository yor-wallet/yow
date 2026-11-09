import type { CampaignMediaType, SceneKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { localize } from '@/lib/localized';
import { mediaUrl } from '@/lib/storage';
import { productPath } from './paths';

/**
 * Campaigns (ads) for a placement: active, inside their date window, by priority.
 * Linked products contribute real data only (name, price if one exists, specs,
 * colours of the actual variants) — never invented.
 */

export const PLACEMENTS = ['home_hero', 'home_mid', 'home_flex', 'home_express', 'category_top', 'product_side'] as const;
export type Placement = (typeof PLACEMENTS)[number];

export type CampaignTheme = 'primary' | 'secondary' | 'premium';
export type CampaignArt = 'flex' | 'express' | 'generic';

export type CampaignProduct = {
  slug: string;
  name: string;
  /** Only when the product really has a price (else null ⇒ no price shown). */
  priceBaisa: number | null;
  specs: string[];
  colors: { name: string; hex: string }[];
  image: string | null;
};

export type CampaignSlide = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  cta: string | null;
  mediaType: CampaignMediaType;
  sceneKind: SceneKind;
  media: { src: string; mobileSrc: string | null; poster: string | null } | null;
  /** Locale-less internal path (`/category/x`) or absolute https URL. */
  href: string;
  external: boolean;
  theme: CampaignTheme;
  art: CampaignArt;
  product: CampaignProduct | null;
};

const THEMES: readonly CampaignTheme[] = ['primary', 'secondary', 'premium'];

/** Internal paths stay locale-less (rendered with the i18n Link); external must be https. */
export function resolveCampaignHref(linkUrl: string | null, fallback: string): { href: string; external: boolean } {
  const raw = (linkUrl ?? '').trim();
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') && raw.length <= 512) {
    // Strip a locale prefix if an admin pasted one.
    const m = /^\/(ar|en|fr)(\/.*|$)/.exec(raw);
    return { href: m ? m[2] || '/' : raw, external: false };
  }
  if (/^https:\/\/[^\s]+$/i.test(raw)) return { href: raw, external: true };
  return { href: fallback, external: false };
}

function artFor(href: string): CampaignArt {
  if (href.startsWith('/flex')) return 'flex';
  if (href.startsWith('/delivery')) return 'express';
  return 'generic';
}

function specLines(highlights: unknown, specs: unknown, locale: string): string[] {
  if (highlights && typeof highlights === 'object') {
    const h = highlights as Record<string, unknown>;
    for (const l of [locale, 'en', 'ar', 'fr']) {
      const arr = h[l];
      if (Array.isArray(arr) && arr.length) return arr.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 3);
    }
  }
  if (Array.isArray(specs)) {
    return specs
      .slice(0, 3)
      .map((s) => {
        if (!s || typeof s !== 'object') return '';
        const r = s as Record<string, unknown>;
        const val = localize(r.value, locale);
        return val ? `${localize(r.label, locale)} ${val}`.trim() : '';
      })
      .filter(Boolean);
  }
  return [];
}

export async function getCampaignSlides(placement: Placement, locale: string, now: Date = new Date(), take = 8): Promise<CampaignSlide[]> {
  const rows = await prisma.campaign.findMany({
    where: {
      isActive: true,
      placements: { has: placement },
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take,
  });
  const productIds = [...new Set(rows.flatMap((r) => r.productIds.slice(0, 1)))];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, status: 'ACTIVE' },
        select: {
          id: true,
          slug: true,
          name: true,
          isSellable: true,
          highlights: true,
          specs: true,
          images: { orderBy: { sort: 'asc' }, take: 1, select: { key: true } },
          variants: { where: { isActive: true }, select: { priceBaisa: true, color: true, colorHex: true } },
        },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  return rows.map((c) => {
    const p = c.productIds[0] ? byId.get(c.productIds[0]) : undefined;
    const product: CampaignProduct | null = p
      ? {
          slug: p.slug,
          name: localize(p.name, locale),
          priceBaisa: p.isSellable
            ? p.variants.reduce<number | null>((m, v) => (v.priceBaisa !== null && (m === null || v.priceBaisa < m) ? v.priceBaisa : m), null)
            : null,
          specs: specLines(p.highlights, p.specs, locale),
          colors: [
            ...new Map(
              p.variants
                .filter((v) => v.colorHex && /^#[0-9a-fA-F]{6}$/.test(v.colorHex))
                .map((v) => [v.colorHex!, { name: v.color ?? v.colorHex!, hex: v.colorHex! }] as const),
            ).values(),
          ].slice(0, 6),
          image: p.images[0] ? mediaUrl(p.images[0].key) : null,
        }
      : null;
    const fallback = product ? productPath(product.slug) : '/';
    const { href, external } = resolveCampaignHref(c.linkUrl, fallback);
    const src = mediaUrl(c.mediaKey);
    return {
      id: c.id,
      slug: c.slug,
      title: localize(c.title, locale, c.internalName),
      subtitle: localize(c.subtitle, locale) || null,
      cta: localize(c.cta, locale) || null,
      mediaType: c.mediaType,
      sceneKind: c.sceneKind,
      media: src ? { src, mobileSrc: mediaUrl(c.mediaKeyMobile), poster: mediaUrl(c.posterKey) } : null,
      href,
      external,
      theme: THEMES.includes(c.theme as CampaignTheme) ? (c.theme as CampaignTheme) : 'premium',
      art: artFor(href),
      product,
    };
  });
}
