/**
 * The owner's photo pack (data/catalogue/doom-photos-2026-11): photos only, no capacity. Each model
 * becomes a DRAFT product with one image per finish and NO variant (staff create them), in its own
 * brand and category; a category missing from an older database is created from the seed data.
 * Runs against PostgreSQL + local storage (doom_test); everything created is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { ForbiddenError, type Actor } from '@/lib/admin/actor';
import { readImportMeta } from '@/lib/admin/catalogue-import';
import { importVisualPackModel, loadVisualPack, visualPackSummary } from '@/lib/admin/visual-pack-import';
import { getProductDetail } from '@/lib/catalog/queries';
import { getStorage, mediaUrl } from '@/lib/storage';
import { BRANDS, CATEGORIES } from '@/prisma/seed-data';
import { cleanup, createUser } from './shop/fixtures';

const KEY = 'doom-photos-2026-11' as const;
const WATCH = 'apple-watch-series-11';
const BUDS = 'apple-airpods-pro-2';
const BUNDLE_BUDS = BUDS;
let catalog: Actor;
let support: Actor;
let watchIndex: number;
let createdCategories: string[] = [];

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  return { id: u.id, role };
}

async function removeProduct(slug: string) {
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
  const pack = await loadVisualPack(KEY);
  watchIndex = pack.models.findIndex((m) => m.id === 'watch-series-11');
  await removeProduct(WATCH);
  await removeProduct(BUDS);
  // Simulate a database seeded before the watch shelf existed (only when nothing else uses it).
  const shelf = await prisma.category.findUnique({ where: { slug: 'apple-watch' }, select: { id: true, _count: { select: { products: true } } } });
  if (shelf && shelf._count.products === 0) await prisma.category.delete({ where: { id: shelf.id } });
  const parent = await prisma.category.findUnique({ where: { slug: 'wearables' }, select: { id: true, _count: { select: { products: true, children: true } } } });
  if (parent && parent._count.products === 0 && parent._count.children === 0) await prisma.category.delete({ where: { id: parent.id } });
});

afterAll(async () => {
  await removeProduct(WATCH);
  await removeProduct(BUDS);
  for (const slug of createdCategories) {
    const c = await prisma.category.findUnique({ where: { slug }, select: { id: true, _count: { select: { products: true, children: true } } } });
    if (c && c._count.products === 0 && c._count.children === 0) await prisma.category.delete({ where: { id: c.id } });
  }
  await cleanup();
  await prisma.$disconnect();
});

describe('the owner photo pack', () => {
  it('is well-formed: 14 models, 15 photos, every file exists, brands and shelves are known', async () => {
    expect(await visualPackSummary(KEY)).toMatchObject({ models: 14, images: 15, origin: 'owner' });
    const pack = await loadVisualPack(KEY);
    const root = path.join(process.cwd(), 'data/catalogue', KEY);
    const shelves = new Set(CATEGORIES.flatMap((c) => [c.slug, ...c.children.map((ch) => ch.slug)]));
    for (const m of pack.models) {
      expect(m.storage_fr, m.id).toEqual([]);
      // A model sold as shown has exactly one finish; the others (sizes, bands) are for staff to define.
      if (m.single_variant) expect(m.variants, m.id).toHaveLength(1);
      expect(BRANDS.some((b) => b.slug === m.brand?.slug), m.id).toBe(true);
      expect(shelves.has(m.category ?? ''), m.id).toBe(true);
      expect(m.to_verify, m.id).toBeTruthy();
      for (const v of m.variants) await expect(fs.access(path.join(root, v.webp)), v.webp).resolves.toBeUndefined();
    }
    // The HONOR photo lands on the product of the verified catalogue (same slug).
    expect(pack.models.some((m) => `${m.brand!.slug}-${m.id}` === 'honor-magic8-pro')).toBe(true);
  });
});

describe('importing a photo-only model', () => {
  it('needs catalog:write', async () => {
    await expect(importVisualPackModel(support, KEY, watchIndex)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.product.count({ where: { slug: WATCH } })).toBe(0);
  });

  it('creates the missing shelf, a draft without variants and one photo per finish; a second run adds nothing', async () => {
    const hadShelf = !!(await prisma.category.findUnique({ where: { slug: 'apple-watch' } }));
    const hadParent = !!(await prisma.category.findUnique({ where: { slug: 'wearables' } }));
    const first = await importVisualPackModel(catalog, KEY, watchIndex);
    if (!hadShelf) createdCategories.push('apple-watch');
    if (!hadParent) createdCategories.push('wearables');
    expect(first).toMatchObject({ productCreated: true, variantsCreated: 0, imagesCreated: 2, total: 14 });

    const p = await prisma.product.findUniqueOrThrow({ where: { slug: WATCH }, include: { variants: true, images: true, brand: true, category: { include: { parent: true } } } });
    expect(p.status).toBe('DRAFT');
    expect(p.brand?.slug).toBe('apple');
    expect(p.category.slug).toBe('apple-watch');
    expect(p.category.parent?.slug).toBe('wearables');
    expect(p.variants).toHaveLength(0);
    expect(p.images).toHaveLength(2);
    expect(p.images.every((i) => i.variantId === null && i.width > 0 && i.width <= 960)).toBe(true);
    const meta = readImportMeta(p.importMeta);
    expect(meta?.batch).toBe(KEY);
    expect(meta?.specsStatus).toMatch(/supplied by the owner/);
    expect(meta?.toVerify).toMatch(/Tailles de boîtier/);
    expect(await getProductDetail(WATCH, 'en')).toBeNull();

    const again = await importVisualPackModel(catalog, KEY, watchIndex);
    expect(again).toMatchObject({ productCreated: false, variantsCreated: 0, imagesCreated: 0 });
    expect(await prisma.productImage.count({ where: { productId: p.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'catalogue.visuals.import', entityId: p.id } })).toBe(1);
  }, 120_000);
});

describe('importing a model sold as shown', () => {
  it('creates its single variant without price or stock, attaches the photo to it, and never twice', async () => {
    const pack = await loadVisualPack(KEY);
    const index = pack.models.findIndex((m) => m.id === 'airpods-pro-2');
    const first = await importVisualPackModel(catalog, KEY, index);
    expect(first).toMatchObject({ productCreated: true, variantsCreated: 1, imagesCreated: 1 });
    const p = await prisma.product.findUniqueOrThrow({ where: { slug: BUDS }, include: { variants: true, images: true } });
    expect(p.status).toBe('DRAFT');
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0]).toMatchObject({ priceBaisa: null, stock: 0, isDefault: true });
    expect(p.images).toHaveLength(1);
    expect(p.images[0]!.variantId).toBe(p.variants[0]!.id);
    const again = await importVisualPackModel(catalog, KEY, index);
    expect(again).toMatchObject({ productCreated: false, variantsCreated: 0, imagesCreated: 0 });
    expect(await prisma.productVariant.count({ where: { productId: p.id } })).toBe(1);
  }, 120_000);
});

describe('importing with the photos shipped in the application', () => {
  it('references public/photos without uploading anything, then serves them from the site itself', async () => {
    const pack = await loadVisualPack(KEY);
    const index = pack.models.findIndex((m) => m.id === 'airpods-pro-2');
    await removeProduct(BUNDLE_BUDS);
    const first = await importVisualPackModel(catalog, KEY, index, { bundled: true });
    expect(first).toMatchObject({ productCreated: true, variantsCreated: 1, imagesCreated: 1 });
    const p = await prisma.product.findUniqueOrThrow({ where: { slug: BUNDLE_BUDS }, include: { images: true } });
    expect(p.images[0]!.key).toBe(`bundled/${KEY}/airpods-pro-2/airpods-pro-2-white.webp`);
    expect(p.images[0]!.width).toBeGreaterThan(0);
    expect(mediaUrl(p.images[0]!.key)).toBe(`/photos/${KEY}/airpods-pro-2/airpods-pro-2-white.webp`);
    // The files the page asks for exist (main WebP + AVIF).
    for (const f of ['airpods-pro-2-white.webp', 'airpods-pro-2-white.avif']) await expect(fs.access(path.join(process.cwd(), 'public/photos', KEY, 'airpods-pro-2', f))).resolves.toBeUndefined();
    const again = await importVisualPackModel(catalog, KEY, index, { bundled: true });
    expect(again).toMatchObject({ productCreated: false, variantsCreated: 0, imagesCreated: 0 });
  }, 120_000);
});
