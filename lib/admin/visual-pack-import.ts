import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { assertCan, AdminError, type Actor } from './actor';
import { storeOptimisedImage } from './media';
import { bundledPhotoKey } from '@/lib/bundled-photo';
import type { ImportMeta } from './catalogue-import';
import { capacityLabel, variantSku } from './catalogue-verified';
import { CATEGORIES } from '@/prisma/seed-data';

/**
 * Visual packs shipped with the code (data/catalogue/<key>): models with their finishes, the
 * capacities sold for each model and one studio image per finish.
 *
 * Importing a pack model creates (or completes) a DRAFT product with one variant per finish ×
 * capacity and one image per finish. It never sets a price or a stock quantity and never publishes:
 * a variant without a price cannot be bought, and the product stays a draft until staff price it,
 * stock it and publish it. Idempotent: existing variants (by SKU) and images are left untouched.
 * SKUs, capacity labels and `storageGb` follow the verified catalogue (lib/admin/catalogue-verified.ts),
 * so the two imports converge on the same variants whichever runs first.
 * One model per call, so a long import can be driven step by step with a progress bar.
 *
 * A model without capacities (watches, earbuds, speakers, or a phone whose colour × capacity matrix is
 * not confirmed) gets NO variant: its photos are attached to the draft product itself, one per finish,
 * and staff create the variants. A model may name its own brand and category (packs that span brands).
 */

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .min(2)
  .max(80);

const packSchema = z.object({
  title: z.string().max(120).optional(),
  verified_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sources: z.record(z.string().url()).optional().default({}),
  models: z
    .array(
      z.object({
        id: slug,
        name: z.string().trim().min(1).max(120),
        year: z.number().int().min(2000).max(2100).nullable(),
        storage_fr: z.array(z.string().trim().min(2).max(12)).max(12),
        brand: z.object({ slug, name: z.string().trim().min(1).max(60) }).optional(),
        category: slug.optional(),
        /** What the pack's author could not confirm; shown to staff in the import notes. */
        to_verify: z.string().trim().max(400).optional(),
        /** A model sold as shown (no size or capacity to choose): one variant per finish, without price or stock. */
        single_variant: z.boolean().optional(),
        variants: z
          .array(
            z.object({
              id: slug,
              color_en: z.string().trim().min(1).max(60),
              /** What the photo shows when a finish has more than one (e.g. "back and front"): keeps each alt text distinct. */
              view: z.object({ ar: z.string().trim().min(1).max(60), en: z.string().trim().min(1).max(60), fr: z.string().trim().min(1).max(60) }).optional(),
              // Relative to the pack folder; checked again against path traversal when read.
              webp: z.string().regex(/^images\/webp\/[a-z0-9-]+\/[a-z0-9-]+\.webp$/),
            }),
          )
          .min(1)
          .max(40),
      }),
    )
    .min(1)
    .max(200),
});

export type VisualPack = z.infer<typeof packSchema>;

type PackDef = {
  key: string;
  /** Defaults for models that do not name their own brand / category. */
  brand: { slug: string; name: string } | null;
  categorySlug: string | null;
  /** Who checked the finishes: the pack's author, or the owner who supplied the photos. */
  origin: 'author' | 'owner';
};

/** Packs available to the admin import screen (key = folder under data/catalogue). */
export const VISUAL_PACKS = [
  { key: 'iphone-visuals-2026', brand: { slug: 'apple', name: 'Apple' }, categorySlug: 'smartphones-apple', origin: 'author' },
  { key: 'doom-photos-2026-11', brand: null, categorySlug: null, origin: 'owner' },
] as const satisfies readonly PackDef[];
export type VisualPackKey = (typeof VISUAL_PACKS)[number]['key'];

/** Finds a category by slug, creating it (and its parent) from the seed definitions when the database predates them. */
async function ensureCategory(categorySlug: string): Promise<string> {
  const found = await prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true } });
  if (found) return found.id;
  const parentDef = CATEGORIES.find((c) => c.slug === categorySlug || c.children.some((ch) => ch.slug === categorySlug));
  if (!parentDef) throw new AdminError('not_found', 'Category missing');
  const parent = await prisma.category.upsert({
    where: { slug: parentDef.slug },
    update: {},
    create: { slug: parentDef.slug, name: parentDef.name, icon: parentDef.icon, sort: CATEGORIES.indexOf(parentDef) },
    select: { id: true },
  });
  if (parentDef.slug === categorySlug) return parent.id;
  const childDef = parentDef.children.find((ch) => ch.slug === categorySlug)!;
  const child = await prisma.category.upsert({
    where: { slug: childDef.slug },
    update: {},
    create: { slug: childDef.slug, name: childDef.name, icon: childDef.icon, sort: parentDef.children.indexOf(childDef), parentId: parent.id },
    select: { id: true },
  });
  return child.id;
}

const packDir = (key: VisualPackKey) => path.join(process.cwd(), 'data', 'catalogue', key);

export async function loadVisualPack(key: VisualPackKey): Promise<VisualPack> {
  const raw = await fs.readFile(path.join(packDir(key), 'catalogue.json'), 'utf8');
  return packSchema.parse(JSON.parse(raw.replace(/^﻿/, '')));
}

export async function visualPackSummary(key: VisualPackKey): Promise<{ key: VisualPackKey; models: number; images: number; verifiedOn: string; origin: 'author' | 'owner' }> {
  const pack = await loadVisualPack(key);
  const origin = VISUAL_PACKS.find((p) => p.key === key)!.origin;
  return { key, models: pack.models.length, images: pack.models.reduce((n, m) => n + m.variants.length, 0), verifiedOn: pack.verified_on, origin };
}

/** "128 Go" / "1 To" / "256 GB" → capacity in GB (128 / 1024 / 256); null when it is not a capacity. */
export function capacityGb(value: string): number | null {
  const m = /^(\d{1,4})\s*(go|gb|to|tb)$/i.exec(value.trim());
  if (!m) return null;
  return /^t/i.test(m[2]!) ? Number(m[1]) * 1024 : Number(m[1]);
}

/**
 * Swatch colour of a finish, sampled on the back of the device in the pack image: the renders show
 * the back on the left, so the patch is taken just inside the device's left edge, in its lower part
 * (below the camera, away from the logo). An approximation for the colour dot only.
 */
export async function sampleSwatch(buf: Buffer): Promise<string | null> {
  try {
    const { default: sharp } = await import('sharp');
    const { data, info } = await sharp(buf).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const at = (x: number, y: number) => (y * w + x) * 3;
    const isBackground = (i: number) => data[i]! > 244 && data[i + 1]! > 244 && data[i + 2]! > 244;
    const row = Math.round(h * 0.76);
    let edge = -1;
    for (let x = 0; x < w; x++) {
      if (!isBackground(at(x, row))) {
        edge = x;
        break;
      }
    }
    if (edge < 0) return null;
    const x0 = edge + Math.round(w * 0.015);
    const x1 = Math.min(w - 1, edge + Math.round(w * 0.035));
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = Math.round(h * 0.72); y < Math.round(h * 0.8); y++) {
      for (let x = x0; x <= x1; x++) {
        const i = at(x, y);
        if (isBackground(i)) continue;
        sum[0]! += data[i]!;
        sum[1]! += data[i + 1]!;
        sum[2]! += data[i + 2]!;
        n++;
      }
    }
    if (n === 0) return null;
    return `#${sum.map((c) => Math.round(c / n).toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return null;
  }
}

/**
 * Alt text of a pack image. The English text is also how an image is recognised on a re-run, so it
 * stays `<model> — <finish>` (plus the view when a finish has several photos). The Arabic text
 * describes the model and the colour shown; model and finish names keep their official spelling.
 */
export function packImageAlt(modelName: string, colorEn: string, view?: { ar: string; en: string; fr: string }): { ar: string; en: string; fr: string } {
  return {
    ar: `صورة ${modelName} — اللون: ${colorEn}${view ? ` (${view.ar})` : ''}`,
    en: `${modelName} — ${colorEn}${view ? `, ${view.en}` : ''}`,
    fr: `${modelName} — ${colorEn}${view ? `, ${view.fr}` : ''}`,
  };
}

/** Colour names compared without case, spaces or punctuation: "Titanium Silverblue" = "Titanium Silver Blue". */
export const sameColour = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const k = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return k(a) !== '' && k(a) === k(b);
};

/** Size of a photo shipped in public/photos: the pack image, at most 960 px wide (scripts/build-bundled-photos.mjs). */
async function bundledSize(buf: Buffer): Promise<{ width: number; height: number }> {
  const { default: sharp } = await import('sharp');
  const meta = await sharp(buf).metadata();
  const width = Math.min(960, meta.width ?? 960);
  return { width, height: Math.round(((meta.height ?? width) * width) / (meta.width ?? width)) };
}

export type VisualImportStep = { done: number; total: number; model: string; productId: string; variantsCreated: number; imagesCreated: number; productCreated: boolean };

/**
 * `bundled`: do not upload anything. The photos shipped with the application (public/photos, generated
 * by scripts/build-bundled-photos.mjs and served by the site itself) are referenced by their key instead —
 * for a deployment that has no storage credentials. The database rows are the same either way.
 */
export async function importVisualPackModel(actor: Actor | null | undefined, key: VisualPackKey, index: number, opts: { bundled?: boolean } = {}): Promise<VisualImportStep> {
  assertCan(actor, 'catalog:write');
  const def = VISUAL_PACKS.find((p) => p.key === key);
  if (!def) throw new AdminError('not_found', 'Unknown pack');
  const pack = await loadVisualPack(key);
  const model = pack.models[index];
  if (!model) throw new AdminError('not_found', 'Unknown model');
  const parsed = model.storage_fr.map(capacityGb);
  if (parsed.some((c) => c === null)) throw new AdminError('validation', `Bad capacity in ${model.id}`);
  const capacities = (parsed as number[]).sort((a, b) => a - b);
  const brandDef = model.brand ?? def.brand;
  const categorySlug = model.category ?? def.categorySlug;
  if (!brandDef || !categorySlug) throw new AdminError('validation', `Brand or category missing for ${model.id}`);

  const categoryId = await ensureCategory(categorySlug);
  const brand = await prisma.brand.upsert({ where: { slug: brandDef.slug }, update: {}, create: { slug: brandDef.slug, name: brandDef.name }, select: { id: true } });

  const productSlug = `${brandDef.slug}-${model.id}`;
  const checkedBy = def.origin === 'owner' ? `supplied by the owner on ${pack.verified_on}; names not checked by us` : `checked by its author on ${pack.verified_on}`;
  const meta: ImportMeta = {
    batch: key,
    externalId: model.id,
    series: model.name,
    year: model.year,
    candidateColors: model.variants.map((v) => v.color_en),
    candidateStorageGb: capacities,
    specsStatus:
      `Finishes${capacities.length ? ' and capacities' : ''} as listed in the pack (${checkedBy}).` +
      (capacities.length ? '' : model.single_variant ? ' One variant per finish, without price.' : ' No variant created: staff create them.') +
      ' Prices, stock and local availability are still to be set.',
    toVerify: model.to_verify ?? null,
    sourceUrl: pack.sources.compare ?? pack.sources.models_and_colors ?? null,
    importedAt: new Date().toISOString(),
  };

  let product = await prisma.product.findUnique({ where: { slug: productSlug }, select: { id: true, importMeta: true } });
  const productCreated = !product;
  if (!product) {
    product = await prisma.product.create({
      data: {
        slug: productSlug,
        sku: `IMP-${productSlug.toUpperCase()}`.slice(0, 64),
        brandId: brand.id,
        categoryId,
        model: model.name,
        name: { ar: model.name, en: model.name, fr: model.name },
        status: 'DRAFT',
        createdById: actor.id,
        importMeta: meta as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, importMeta: true },
    });
  } else if (product.importMeta === null) {
    // Notes written by another import (e.g. the verified catalogue) are kept as they are.
    await prisma.product.update({ where: { id: product.id }, data: { importMeta: meta as unknown as Prisma.InputJsonValue } });
  }

  const root = packDir(key);
  const putImage = async (buf: Buffer, modelId: string, finishId: string): Promise<{ key: string; width: number; height: number }> => {
    if (!opts.bundled) return storeOptimisedImage(buf, `products/${product!.id}`, { maxWidth: 960 });
    const bundledKey = bundledPhotoKey(key, modelId, finishId);
    const file = path.join(process.cwd(), 'public', 'photos', key, modelId, `${finishId}.webp`);
    await fs.access(file).catch(() => {
      throw new AdminError('validation', `Bundled photo missing: ${bundledKey} (run scripts/build-bundled-photos.mjs)`);
    });
    return { key: bundledKey, ...(await bundledSize(buf)) };
  };
  let variantsCreated = 0;
  let imagesCreated = 0;
  let sort = (await prisma.productVariant.aggregate({ where: { productId: product.id }, _max: { sort: true } }))._max.sort ?? -1;
  let hasDefault = (await prisma.productVariant.count({ where: { productId: product.id, isDefault: true } })) > 0;

  for (const finish of model.variants) {
    const file = path.resolve(root, finish.webp);
    if (!file.startsWith(root + path.sep)) throw new AdminError('validation', 'Bad image path');
    const buf = await fs.readFile(file);
    const alt = packImageAlt(model.name, finish.color_en, finish.view);
    // Images of this finish already attached (recognised by the English alt text): refresh their Arabic
    // alt text, written in English by earlier imports.
    const previous = await prisma.productImage.findMany({ where: { productId: product.id, alt: { path: ['en'], equals: alt.en } }, select: { id: true, alt: true, key: true, width: true, height: true } });
    for (const img of previous) {
      const data: Prisma.ProductImageUpdateInput = {};
      if ((img.alt as { ar?: string } | null)?.ar !== alt.ar) data.alt = alt;
      // A photo shipped with the application may have been re-cut since it was attached: keep its size right.
      if (opts.bundled && img.key === bundledPhotoKey(key, model.id, finish.id)) {
        const dims = await bundledSize(buf);
        if (dims.width !== img.width || dims.height !== img.height) Object.assign(data, dims);
      }
      if (Object.keys(data).length) await prisma.productImage.update({ where: { id: img.id }, data });
    }

    if (capacities.length === 0) {
      // Photos only: one product image per finish, recognised by its alt text on a re-run. When the product
      // already sells this colour (verified catalogue, iPhone pack), the photo belongs to that colour: it is
      // attached to its first variant and shown for every capacity of it, never for another colour.
      const variants = await prisma.productVariant.findMany({ where: { productId: product.id }, orderBy: { sort: 'asc' }, select: { id: true, color: true } });
      const ofColour = variants.find((v) => sameColour(v.color, finish.color_en)) ?? null;
      if (previous.length === 0) {
        const stored = await putImage(buf, model.id, finish.id);
        const last = await prisma.productImage.aggregate({ where: { productId: product.id }, _max: { sort: true } });
        await prisma.productImage.create({
          data: { productId: product.id, variantId: ofColour?.id ?? null, key: stored.key, width: stored.width, height: stored.height, alt, sort: (last._max.sort ?? -1) + 1 },
        });
        imagesCreated++;
      } else if (ofColour) {
        // Imported before the product sold this colour (or under another spelling of it): attach it now.
        await prisma.productImage.updateMany({ where: { productId: product.id, variantId: null, alt: { path: ['en'], equals: alt.en } }, data: { variantId: ofColour.id } });
      }
      if (model.single_variant) {
        // Sold as shown: the finish is the only choice, so the variant can exist before staff price it.
        const sku = `${productSlug}-${finish.id}`.toUpperCase().slice(0, 60);
        let variant = await prisma.productVariant.findUnique({ where: { sku }, select: { id: true, productId: true } });
        if (variant && variant.productId !== product.id) throw new AdminError('validation', `SKU of ${finish.id} belongs to another product`);
        if (!variant) {
          variant = await prisma.productVariant.create({
            data: {
              productId: product.id,
              sku,
              name: { ar: finish.color_en, en: finish.color_en, fr: finish.color_en },
              color: finish.color_en,
              colorHex: await sampleSwatch(buf),
              priceBaisa: null,
              stock: 0,
              isActive: true,
              isDefault: !hasDefault,
              sort: ++sort,
            },
            select: { id: true, productId: true },
          });
          hasDefault = true;
          variantsCreated++;
        }
        await prisma.productImage.updateMany({ where: { productId: product.id, variantId: null, alt: { path: ['en'], equals: alt.en } }, data: { variantId: variant.id } });
      }
      continue;
    }
    const skus = capacities.map((storageGb) => variantSku(productSlug, { color: finish.color_en, storageGb }));
    const existing = await prisma.productVariant.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true, productId: true, colorHex: true } });
    if (existing.some((v) => v.productId !== product.id)) throw new AdminError('validation', `SKU of ${finish.id} belongs to another product`);
    const colorHex = existing[0]?.colorHex ?? (await sampleSwatch(buf));

    const variantIds: string[] = [];
    for (const [i, storageGb] of capacities.entries()) {
      const label = capacityLabel(storageGb);
      const found = existing.find((v) => v.sku === skus[i]);
      if (found) {
        variantIds.push(found.id);
        continue;
      }
      const created = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: skus[i]!,
          name: { ar: `${label} · ${finish.color_en}`, en: `${label} · ${finish.color_en}`, fr: `${label} · ${finish.color_en}` },
          color: finish.color_en,
          colorHex,
          capacity: label,
          storageGb,
          // No price and no stock: staff set them. A variant without a price cannot be bought.
          priceBaisa: null,
          stock: 0,
          isActive: true,
          isDefault: !hasDefault,
          sort: ++sort,
        },
        select: { id: true },
      });
      hasDefault = true;
      variantIds.push(created.id);
      variantsCreated++;
    }

    // One image per finish, attached to its first variant (the storefront shows it for every capacity of the
    // finish). Recognised by its alt text, so a second view of the same finish (owner's pack) never takes its place.
    if (previous.length === 0) {
      const stored = await putImage(buf, model.id, finish.id);
      const last = await prisma.productImage.aggregate({ where: { productId: product.id }, _max: { sort: true } });
      await prisma.productImage.create({
        data: { productId: product.id, variantId: variantIds[0]!, key: stored.key, width: stored.width, height: stored.height, alt, sort: (last._max.sort ?? -1) + 1 },
      });
      imagesCreated++;
    }
  }

  if (productCreated || variantsCreated > 0 || imagesCreated > 0) {
    await logAudit({ actorId: actor.id, actorRole: actor.role, action: 'catalogue.visuals.import', entity: 'Product', entityId: product.id, after: { pack: key, model: model.id, productCreated, variantsCreated, imagesCreated } });
  }
  return { done: index + 1, total: pack.models.length, model: model.name, productId: product.id, variantsCreated, imagesCreated, productCreated };
}
