import { Prisma, type Campaign, type CampaignMediaType } from '@prisma/client';
import { z } from 'zod';
import { prisma, isUniqueViolation } from '@/lib/db';
import { idSchema } from '@/lib/validation';
import { localize } from '@/lib/localized';
import { getStorage, mediaUrl } from '@/lib/storage';
import { PLACEMENTS, resolveCampaignHref, type CampaignSlide, type CampaignTheme } from '@/lib/catalog/campaigns';
import { assertCan, NotFoundError, ValidationError, type Actor } from './actor';
import { changedFields, defineMutation } from './mutation';
import { deleteImageFamily, storeOptimisedImage, storeRawMedia, validateMedia, type MediaKind } from './media';
import { enumParam, parseTableQuery, type SearchParams } from './table';
import { zBool, zDateOpt, zIdList, zInt, zLink, zLocalized, zLocalizedOpt, zSlug, zText } from './zod';

/**
 * Campaign manager (ads): texts per locale, media (validated by magic bytes / Lottie structure,
 * images optimised to WebP/AVIF), dates, linked products, placements, priority, activation and
 * the server-side statistics recorded by the storefront (`CampaignStat`).
 */

export const CAMPAIGN_PLACEMENTS = PLACEMENTS;
export const CAMPAIGN_THEMES = ['primary', 'secondary', 'premium'] as const;
export const MEDIA_TYPES: readonly CampaignMediaType[] = ['IMAGE', 'VIDEO', 'LOTTIE', 'SCENE_3D'];
export const SCENE_KINDS = ['PHONE', 'LAPTOP', 'EARBUDS', 'NONE'] as const;

export const campaignSchema = z
  .object({
    id: idSchema.optional(),
    slug: zSlug,
    internalName: zText(120),
    title: zLocalized(160),
    subtitle: zLocalizedOpt(300),
    cta: zLocalizedOpt(40),
    mediaType: z.enum(['IMAGE', 'VIDEO', 'LOTTIE', 'SCENE_3D']),
    sceneKind: z.enum(SCENE_KINDS),
    placements: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.enum(PLACEMENTS)).min(1, 'placement_required')),
    productIds: zIdList(12),
    linkUrl: zLink,
    priority: zInt(0, 1000),
    startsAt: zDateOpt(),
    endsAt: zDateOpt(),
    isActive: zBool,
    theme: z.enum(CAMPAIGN_THEMES),
    removeMedia: zBool,
  })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'end_before_start' });
    if (v.mediaType === 'SCENE_3D' && v.sceneKind === 'NONE') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sceneKind'], message: 'scene_required' });
  });

type MediaPatch = { mediaKey?: string | null; mediaKeyMobile?: string | null; posterKey?: string | null };

const writeCampaign = defineMutation({
  name: 'campaign.save',
  permission: 'campaigns:write',
  schema: campaignSchema.and(z.object({ media: z.custom<MediaPatch>((v) => v === undefined || (typeof v === 'object' && v !== null)).optional() })),
  async run({ tx, actor, input, audit }) {
    const { id, subtitle, cta, removeMedia, media, ...rest } = input;
    // Only real products can be linked (unknown ids are dropped, order kept).
    const found = rest.productIds.length ? await tx.product.findMany({ where: { id: { in: rest.productIds } }, select: { id: true } }) : [];
    const productIds = rest.productIds.filter((pid) => found.some((f) => f.id === pid));
    const patch: MediaPatch = removeMedia ? { mediaKey: null, mediaKeyMobile: null, posterKey: null, ...(media ?? {}) } : (media ?? {});
    const data = { ...rest, productIds, subtitle: subtitle ?? Prisma.DbNull, cta: cta ?? Prisma.DbNull, ...patch };
    try {
      if (!id) {
        if (rest.mediaType === 'VIDEO' && (!patch.mediaKey || !patch.posterKey)) throw new ValidationError(patch.mediaKey ? { poster: ['poster_required'] } : { media: ['required'] });
        if ((rest.mediaType === 'IMAGE' || rest.mediaType === 'LOTTIE') && !patch.mediaKey) {
          // A campaign without media renders as a typographic gradient banner (allowed for IMAGE only).
          if (rest.mediaType === 'LOTTIE') throw new ValidationError({ media: ['required'] });
        }
        const c = await tx.campaign.create({ data: { ...data, createdById: actor.id } });
        await audit({ action: 'campaign.create', entity: 'Campaign', entityId: c.id, after: { ...rest, productIds, ...patch } });
        return { id: c.id, oldKeys: [] as string[] };
      }
      const before = await tx.campaign.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Campaign');
      const next = { mediaKey: 'mediaKey' in patch ? patch.mediaKey : before.mediaKey, posterKey: 'posterKey' in patch ? patch.posterKey : before.posterKey };
      if (rest.mediaType === 'VIDEO' && (!next.mediaKey || !next.posterKey)) throw new ValidationError(next.mediaKey ? { poster: ['poster_required'] } : { media: ['required'] });
      if (rest.mediaType === 'LOTTIE' && !next.mediaKey) throw new ValidationError({ media: ['required'] });
      const after = await tx.campaign.update({ where: { id }, data });
      const diff = changedFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
      await audit({ action: 'campaign.update', entity: 'Campaign', entityId: id, before: diff.before, after: diff.after });
      const oldKeys = (['mediaKey', 'mediaKeyMobile', 'posterKey'] as const).filter((k) => before[k] && before[k] !== after[k]).map((k) => before[k]!);
      return { id, oldKeys };
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) throw new ValidationError({ slug: ['slug_taken'] });
      throw err;
    }
  },
});

async function cleanup(keys: readonly string[]) {
  const storage = getStorage();
  for (const k of keys) {
    if (k.endsWith('.webp')) await deleteImageFamily(k);
    else await storage.delete('public', k).catch(() => undefined);
  }
}

function kindFor(mediaType: string): MediaKind | null {
  if (mediaType === 'VIDEO') return 'video';
  if (mediaType === 'LOTTIE') return 'lottie';
  if (mediaType === 'IMAGE') return 'image';
  return null; // SCENE_3D: lightweight CSS scene, optional poster only
}

/**
 * Save with optional uploads: validate each file for the chosen media type, optimise images
 * (desktop ≤ 1920 px, mobile ≤ 828 px, poster), then write the record. New files are removed if
 * the write fails; replaced files are removed after it succeeds.
 */
export async function saveCampaign(
  actor: Actor | null | undefined,
  input: Record<string, unknown>,
  files: { media?: Buffer | null; mediaMobile?: Buffer | null; poster?: Buffer | null } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'campaigns:write');
  const mediaType = typeof input.mediaType === 'string' ? input.mediaType : 'IMAGE';
  const kind = kindFor(mediaType);
  const created: string[] = [];
  const media: MediaPatch = {};
  try {
    for (const field of ['media', 'mediaMobile'] as const) {
      const buf = files[field];
      if (!buf) continue;
      if (!kind) throw new ValidationError({ [field]: ['media_bad_type'] });
      const check = validateMedia(buf, kind);
      if (!check.ok) throw new ValidationError({ [field]: [`media_${check.code}`] });
      if (kind === 'image') {
        const desktop = field === 'media';
        let stored;
        try {
          stored = await storeOptimisedImage(buf, 'campaigns', desktop ? { maxWidth: 1920, widths: [960, 1280] } : { maxWidth: 828, widths: [480] });
        } catch {
          throw new ValidationError({ [field]: ['media_bad_image'] });
        }
        created.push(...stored.keys);
        media[desktop ? 'mediaKey' : 'mediaKeyMobile'] = stored.key;
      } else {
        const key = await storeRawMedia(buf, 'campaigns', check.mime);
        created.push(key);
        media[field === 'media' ? 'mediaKey' : 'mediaKeyMobile'] = key;
      }
    }
    if (files.poster) {
      const check = validateMedia(files.poster, 'image');
      if (!check.ok) throw new ValidationError({ poster: [`media_${check.code}`] });
      let stored;
      try {
        stored = await storeOptimisedImage(files.poster, 'campaigns', { maxWidth: 1920, widths: [828] });
      } catch {
        throw new ValidationError({ poster: ['media_bad_image'] });
      }
      created.push(...stored.keys);
      media.posterKey = stored.key;
    }
    const res = await writeCampaign(actor, { ...input, media });
    await cleanup(res.oldKeys);
    return { id: res.id };
  } catch (err) {
    await cleanup(created);
    throw err;
  }
}

export const deleteCampaign = defineMutation({
  name: 'campaign.delete',
  permission: 'campaigns:write',
  schema: z.object({ id: idSchema }),
  async run({ tx, input, audit }) {
    const c = await tx.campaign.findUnique({ where: { id: input.id } });
    if (!c) throw new NotFoundError('Campaign');
    await tx.campaign.delete({ where: { id: input.id } });
    await audit({ action: 'campaign.delete', entity: 'Campaign', entityId: input.id, before: { slug: c.slug, internalName: c.internalName, placements: c.placements } });
    return { id: input.id, keys: [c.mediaKey, c.mediaKeyMobile, c.posterKey].filter((k): k is string => !!k) };
  },
});

export async function removeCampaign(actor: Actor | null | undefined, input: unknown) {
  const res = await deleteCampaign(actor, input);
  await cleanup(res.keys);
  return { id: res.id };
}

export const toggleCampaign = defineMutation({
  name: 'campaign.toggle',
  permission: 'campaigns:write',
  schema: z.object({ id: idSchema, isActive: zBool }),
  async run({ tx, input, audit }) {
    const c = await tx.campaign.findUnique({ where: { id: input.id }, select: { isActive: true } });
    if (!c) throw new NotFoundError('Campaign');
    if (c.isActive === input.isActive) return { id: input.id };
    await tx.campaign.update({ where: { id: input.id }, data: { isActive: input.isActive } });
    await audit({ action: input.isActive ? 'campaign.activate' : 'campaign.deactivate', entity: 'Campaign', entityId: input.id, before: c, after: { isActive: input.isActive } });
    return { id: input.id };
  },
});

// ───────────── queries ─────────────

const DAY = 86_400_000;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function listCampaigns(sp: SearchParams) {
  const q = parseTableQuery(sp, { sortable: ['priority', 'updatedAt', 'startsAt'] as const, defaultSort: 'priority', pageSize: 25 });
  const placement = enumParam(sp, 'placement', PLACEMENTS);
  const state = enumParam(sp, 'state', ['active', 'inactive'] as const);
  const where: Prisma.CampaignWhereInput = {
    ...(placement ? { placements: { has: placement } } : {}),
    ...(state ? { isActive: state === 'active' } : {}),
    ...(q.q ? { OR: [{ internalName: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q.toLowerCase() } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({ where, orderBy: [{ [q.sort]: q.dir }, { createdAt: 'desc' }], skip: q.skip, take: q.take }),
  ]);
  const since = new Date(Date.now() - 14 * DAY);
  const stats = rows.length
    ? await prisma.campaignStat.findMany({ where: { campaignId: { in: rows.map((r) => r.id) }, date: { gte: since } }, orderBy: { date: 'asc' } })
    : [];
  const items = rows.map((r) => {
    const s = stats.filter((x) => x.campaignId === r.id);
    const impressions = s.reduce((a, x) => a + x.impressions, 0);
    const clicks = s.reduce((a, x) => a + x.clicks, 0);
    return {
      ...r,
      impressions,
      clicks,
      ctrBps: impressions ? Math.round((clicks * 10_000) / impressions) : null,
      ctrSeries: s.map((x) => (x.impressions ? x.clicks / x.impressions : 0)),
    };
  });
  return { ...q, total, items, placement, state };
}

export async function getCampaign(id: string) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) return null;
  const stats = await prisma.campaignStat.findMany({ where: { campaignId: id }, orderBy: { date: 'desc' }, take: 60 });
  const products = c.productIds.length
    ? await prisma.product.findMany({ where: { id: { in: c.productIds } }, select: { id: true, sku: true, name: true, status: true } })
    : [];
  return { campaign: c, stats: stats.map((s) => ({ date: ymd(s.date), impressions: s.impressions, clicks: s.clicks })), products };
}

/** Admin product search for the campaign product picker (catalog:read checked by the route). */
export async function searchProductsForPicker(q: string, take = 10) {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { sku: { contains: term.toUpperCase() } },
        { slug: { contains: term.toLowerCase() } },
        { name: { path: ['en'], string_contains: term } },
        { name: { path: ['ar'], string_contains: term } },
        { name: { path: ['fr'], string_contains: term } },
      ],
    },
    select: { id: true, sku: true, name: true, status: true },
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows;
}

/** A storefront slide for the live preview. Its id is NOT a campaign id, so preview views are never counted. */
export function previewSlide(c: Campaign, locale: string): CampaignSlide {
  const { href, external } = resolveCampaignHref(c.linkUrl, '/');
  const src = mediaUrl(c.mediaKey);
  const theme = (CAMPAIGN_THEMES as readonly string[]).includes(c.theme ?? '') ? (c.theme as CampaignTheme) : 'premium';
  return {
    id: `preview_${c.id}`,
    slug: c.slug,
    title: localize(c.title, locale, c.internalName),
    subtitle: localize(c.subtitle, locale) || null,
    cta: localize(c.cta, locale) || null,
    mediaType: c.mediaType,
    sceneKind: c.sceneKind,
    media: src ? { src, mobileSrc: mediaUrl(c.mediaKeyMobile), poster: mediaUrl(c.posterKey) } : null,
    href,
    external,
    theme,
    art: href.startsWith('/flex') ? 'flex' : href.startsWith('/delivery') ? 'express' : 'generic',
    product: null,
  };
}

