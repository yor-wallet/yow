/**
 * Visual pack import against PostgreSQL + local storage (doom_test): one model of the shipped
 * iPhone pack becomes a DRAFT product with a variant per finish × capacity and an image per finish,
 * with no price and no stock; idempotent; RBAC. Everything created is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, type Actor } from '@/lib/admin/actor';
import { capacityGb, importVisualPackModel, loadVisualPack, sampleSwatch, visualPackSummary } from '@/lib/admin/visual-pack-import';
import { importVerifiedCatalogue, variantSku } from '@/lib/admin/catalogue-verified';
import { readFileSync } from 'node:fs';
import { getProductDetail } from '@/lib/catalog/queries';
import { getStorage } from '@/lib/storage';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cleanup, createUser } from './shop/fixtures';

const KEY = 'iphone-visuals-2026' as const;
let catalog: Actor;
let support: Actor;
let index: number;
let slug: string;

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  return { id: u.id, role };
}

async function removeImported() {
  const p = await prisma.product.findUnique({ where: { slug }, select: { id: true, images: { select: { key: true } } } });
  if (!p) return;
  const storage = getStorage();
  for (const img of p.images) {
    const base = img.key.replace(/\.webp$/, '');
    for (const k of [img.key, `${base}.avif`, `${base}-480.webp`, `${base}-480.avif`]) await storage.delete('public', k).catch(() => undefined);
  }
  await prisma.auditLog.deleteMany({ where: { entityId: p.id } });
  await prisma.product.delete({ where: { id: p.id } });
}

beforeAll(async () => {
  catalog = await staff('CATALOG');
  support = await staff('SUPPORT');
  // The smallest model of the pack keeps the test fast (each finish is optimised to WebP + AVIF).
  const pack = await loadVisualPack(KEY);
  index = pack.models.reduce((best, m, i) => (m.variants.length * m.storage_fr.length < pack.models[best]!.variants.length * pack.models[best]!.storage_fr.length ? i : best), 0);
  slug = `apple-${pack.models[index]!.id}`;
  await removeImported();
});

afterAll(async () => {
  await removeImported();
  await cleanup();
  await prisma.$disconnect();
});

describe('the shipped iPhone pack', () => {
  it('is well-formed: 26 models, 111 images, every image file exists, every capacity is understood', async () => {
    expect(await visualPackSummary(KEY)).toMatchObject({ models: 26, images: 111 });
    const pack = await loadVisualPack(KEY);
    const root = path.join(process.cwd(), 'data/catalogue', KEY);
    for (const m of pack.models) {
      for (const c of m.storage_fr) expect(capacityGb(c), `${m.id} ${c}`).not.toBeNull();
      for (const v of m.variants) await expect(fs.access(path.join(root, v.webp)), v.webp).resolves.toBeUndefined();
    }
    const ids = pack.models.flatMap((m) => m.variants.map((v) => v.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('normalises capacities and samples a swatch from the device, not the white background', async () => {
    expect(['128 Go', '1 To', '256GB', '2 TB'].map(capacityGb)).toEqual([128, 1024, 256, 2048]);
    expect(capacityGb('big')).toBeNull();
    const graphite = await fs.readFile(path.join(process.cwd(), 'data/catalogue', KEY, 'images/webp/iphone-13-pro/iphone-13-pro-graphite.webp'));
    const hex = await sampleSwatch(graphite);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex!.slice(i, i + 2), 16));
    expect(Math.max(r!, g!, b!)).toBeLessThan(110); // graphite is dark
  });
});

describe('importVisualPackModel', () => {
  it('needs catalog:write', async () => {
    await expect(importVisualPackModel(support, KEY, index)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.product.count({ where: { slug } })).toBe(0);
  });

  it('creates a draft with unpriced, unstocked variants and one image per finish; a second run adds nothing', async () => {
    const model = (await loadVisualPack(KEY)).models[index]!;
    const first = await importVisualPackModel(catalog, KEY, index);
    expect(first).toMatchObject({ productCreated: true, variantsCreated: model.variants.length * model.storage_fr.length, imagesCreated: model.variants.length, total: 26 });

    const p = await prisma.product.findUniqueOrThrow({ where: { slug }, include: { variants: true, images: true, brand: true, category: true } });
    expect(p.status).toBe('DRAFT');
    expect(p.brand?.slug).toBe('apple');
    expect(p.category.slug).toBe('smartphones-apple');
    expect(p.variants.every((v) => v.priceBaisa === null && v.stock === 0 && v.compareAtBaisa === null)).toBe(true);
    expect(p.variants.filter((v) => v.isDefault)).toHaveLength(1);
    expect(new Set(p.variants.map((v) => v.color))).toEqual(new Set(model.variants.map((v) => v.color_en)));
    // Same conventions as the verified catalogue: "128 GB" labels, storageGb and its SKU scheme.
    expect(p.variants.every((v) => /^\d+ (GB|TB)$/.test(v.capacity ?? '') && v.storageGb !== null && v.sku === variantSku(slug, { color: v.color!, storageGb: v.storageGb! }))).toBe(true);
    expect(p.variants.every((v) => /^#[0-9a-f]{6}$/.test(v.colorHex ?? ''))).toBe(true);
    expect(p.images).toHaveLength(model.variants.length);
    expect(p.images.every((i) => i.variantId && i.width === 960)).toBe(true);
    // A draft is invisible to shoppers.
    expect(await getProductDetail(slug, 'en')).toBeNull();

    const again = await importVisualPackModel(catalog, KEY, index);
    expect(again).toMatchObject({ productCreated: false, variantsCreated: 0, imagesCreated: 0 });
    expect(await prisma.productVariant.count({ where: { productId: p.id } })).toBe(p.variants.length);
    expect(await prisma.auditLog.count({ where: { action: 'catalogue.visuals.import', entityId: p.id } })).toBe(1);
  }, 120_000);

  it('never touches a price or a stock that staff set afterwards', async () => {
    const p = await prisma.product.findUniqueOrThrow({ where: { slug }, include: { variants: true } });
    const v = p.variants[0]!;
    await prisma.productVariant.update({ where: { id: v.id }, data: { priceBaisa: 199_000, stock: 7, colorHex: '#123456' } });
    await importVisualPackModel(catalog, KEY, index);
    expect(await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ priceBaisa: 199_000, stock: 7, colorHex: '#123456' });
  }, 60_000);

  it('converges with the verified catalogue: the same variants whichever import runs first', async () => {
    const verified = (JSON.parse(readFileSync(path.join(process.cwd(), 'data/catalogue/verified-catalogue-2026.json'), 'utf8')) as { models: { id: string }[] }).models;
    const pack = await loadVisualPack(KEY);
    // A model present in both sources (smallest one to keep the test fast).
    const shared = pack.models
      .map((m, i) => ({ i, m, slug: `apple-${m.id}` }))
      .filter((x) => verified.some((v) => v.id === x.slug))
      .sort((a, b) => a.m.variants.length - b.m.variants.length)[0]!;
    const before = await prisma.product.findUnique({ where: { slug: shared.slug }, select: { id: true } });
    if (before) return; // another suite owns this product in the shared test database: do not touch it
    try {
      const step = await importVisualPackModel(catalog, KEY, shared.i);
      const count = await prisma.productVariant.count({ where: { productId: step.productId } });
      await importVerifiedCatalogue(catalog, { models: verified.filter((v) => v.id === shared.slug), publish: false });
      expect(await prisma.productVariant.count({ where: { productId: step.productId } })).toBe(count);
      expect(await prisma.productImage.count({ where: { productId: step.productId } })).toBe(shared.m.variants.length);
    } finally {
      const p = await prisma.product.findUnique({ where: { slug: shared.slug }, select: { id: true, images: { select: { key: true } } } });
      if (p) {
        for (const img of p.images) {
          const base = img.key.replace(/\.webp$/, '');
          for (const k of [img.key, `${base}.avif`, `${base}-480.webp`, `${base}-480.avif`]) await getStorage().delete('public', k).catch(() => undefined);
        }
        await prisma.auditLog.deleteMany({ where: { entityId: p.id } });
        await prisma.product.delete({ where: { id: p.id } });
      }
    }
  }, 120_000);

  it('rejects unknown models', async () => {
    await expect(importVisualPackModel(catalog, KEY, 999)).rejects.toMatchObject({ code: 'not_found' });
  });
});
