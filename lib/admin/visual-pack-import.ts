import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { assertCan, AdminError, type Actor } from './actor';
import { storeOptimisedImage } from './media';
import type { ImportMeta } from './catalogue-import';
import { capacityLabel, variantSku } from './catalogue-verified';

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
        year: z.number().int().min(2000).max(2100),
        storage_fr: z.array(z.string().trim().min(2).max(12)).min(1).max(12),
        variants: z
          .array(
            z.object({
              id: slug,
              color_en: z.string().trim().min(1).max(60),
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

/** Packs available to the admin import screen (key = folder under data/catalogue). */
export const VISUAL_PACKS = [{ key: 'iphone-visuals-2026', brandSlug: 'apple', brandName: 'Apple', categorySlug: 'smartphones-apple' }] as const;
export type VisualPackKey = (typeof VISUAL_PACKS)[number]['key'];

const packDir = (key: VisualPackKey) => path.join(process.cwd(), 'data', 'catalogue', key);

export async function loadVisualPack(key: VisualPackKey): Promise<VisualPack> {
  const raw = await fs.readFile(path.join(packDir(key), 'catalogue.json'), 'utf8');
  return packSchema.parse(JSON.parse(raw.replace(/^﻿/, '')));
}

export async function visualPackSummary(key: VisualPackKey): Promise<{ key: VisualPackKey; models: number; images: number; verifiedOn: string }> {
  const pack = await loadVisualPack(key);
  return { key, models: pack.models.length, images: pack.models.reduce((n, m) => n + m.variants.length, 0), verifiedOn: pack.verified_on };
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

export type VisualImportStep = { done: number; total: number; model: string; productId: string; variantsCreated: number; imagesCreated: number; productCreated: boolean };

export async function importVisualPackModel(actor: Actor | null | undefined, key: VisualPackKey, index: number): Promise<VisualImportStep> {
  assertCan(actor, 'catalog:write');
  const def = VISUAL_PACKS.find((p) => p.key === key);
  if (!def) throw new AdminError('not_found', 'Unknown pack');
  const pack = await loadVisualPack(key);
  const model = pack.models[index];
  if (!model) throw new AdminError('not_found', 'Unknown model');
  const parsed = model.storage_fr.map(capacityGb);
  if (parsed.some((c) => c === null)) throw new AdminError('validation', `Bad capacity in ${model.id}`);
  const capacities = (parsed as number[]).sort((a, b) => a - b);

  const category = await prisma.category.findUnique({ where: { slug: def.categorySlug }, select: { id: true } });
  if (!category) throw new AdminError('not_found', 'Category missing');
  const brand = await prisma.brand.upsert({ where: { slug: def.brandSlug }, update: {}, create: { slug: def.brandSlug, name: def.brandName }, select: { id: true } });

  const productSlug = `${def.brandSlug}-${model.id}`;
  const meta: ImportMeta = {
    batch: key,
    externalId: model.id,
    series: model.name,
    year: model.year,
    candidateColors: model.variants.map((v) => v.color_en),
    candidateStorageGb: capacities,
    specsStatus: `Finishes and capacities as listed in the pack (checked by its author on ${pack.verified_on}). Prices, stock and local availability are still to be set.`,
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
        categoryId: category.id,
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
  let variantsCreated = 0;
  let imagesCreated = 0;
  let sort = (await prisma.productVariant.aggregate({ where: { productId: product.id }, _max: { sort: true } }))._max.sort ?? -1;
  let hasDefault = (await prisma.productVariant.count({ where: { productId: product.id, isDefault: true } })) > 0;

  for (const finish of model.variants) {
    const file = path.resolve(root, finish.webp);
    if (!file.startsWith(root + path.sep)) throw new AdminError('validation', 'Bad image path');
    const buf = await fs.readFile(file);
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

    // One image per finish, attached to its first variant (the storefront shows it for every capacity of the finish).
    const already = await prisma.productImage.count({ where: { productId: product.id, variantId: { in: variantIds } } });
    if (already === 0) {
      const stored = await storeOptimisedImage(buf, `products/${product.id}`, { maxWidth: 960 });
      const last = await prisma.productImage.aggregate({ where: { productId: product.id }, _max: { sort: true } });
      const alt = `${model.name} — ${finish.color_en}`;
      await prisma.productImage.create({
        data: { productId: product.id, variantId: variantIds[0]!, key: stored.key, width: stored.width, height: stored.height, alt: { ar: alt, en: alt, fr: alt }, sort: (last._max.sort ?? -1) + 1 },
      });
      imagesCreated++;
    }
  }

  if (productCreated || variantsCreated > 0 || imagesCreated > 0) {
    await logAudit({ actorId: actor.id, actorRole: actor.role, action: 'catalogue.visuals.import', entity: 'Product', entityId: product.id, after: { pack: key, model: model.id, productCreated, variantsCreated, imagesCreated } });
  }
  return { done: index + 1, total: pack.models.length, model: model.name, productId: product.id, variantsCreated, imagesCreated, productCreated };
}
