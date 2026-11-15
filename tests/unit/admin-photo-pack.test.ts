/**
 * The owner's photo pack (data/catalogue/doom-photos-2026-11): photos only, no capacity. Each model
 * becomes a DRAFT product with one image per finish and NO variant (staff create them), in its own
 * brand and category; a category missing from an older database is created from the seed data.
 * When the product already sells the colour of a photo (verified catalogue, iPhone pack), the photo is
 * attached to that colour, whatever its spelling ("Silverblue" / "Silver Blue"); a second view of a
 * finish sits next to the studio image, whichever pack is imported first.
 * Runs against PostgreSQL + local storage (doom_test); everything created is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { ForbiddenError, type Actor } from '@/lib/admin/actor';
import { readImportMeta } from '@/lib/admin/catalogue-import';
import { importVisualPackModel, loadVisualPack, packImageAlt, sameColour, visualPackSummary } from '@/lib/admin/visual-pack-import';
import { importVerifiedCatalogue } from '@/lib/admin/catalogue-verified';
import { imagesForVariant } from '@/lib/catalog/images';
import { readFileSync } from 'node:fs';
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
  it('is well-formed: 17 models, 19 photos, every file exists, brands and shelves are known', async () => {
    expect(await visualPackSummary(KEY)).toMatchObject({ models: 17, images: 19, origin: 'owner' });
    const pack = await loadVisualPack(KEY);
    const root = path.join(process.cwd(), 'data/catalogue', KEY);
    const shelves = new Set(CATEGORIES.flatMap((c) => [c.slug, ...c.children.map((ch) => ch.slug)]));
    for (const m of pack.models) {
      expect(m.storage_fr, m.id).toEqual([]);
      // A model sold as shown has one variant per finish (colour only); sizes and bands are for staff to define.
      if (m.single_variant) expect(new Set(m.variants.map((v) => v.color_en)).size, m.id).toBe(m.variants.length);
      expect(BRANDS.some((b) => b.slug === m.brand?.slug), m.id).toBe(true);
      expect(shelves.has(m.category ?? ''), m.id).toBe(true);
      expect(m.to_verify, m.id).toBeTruthy();
      for (const v of m.variants) await expect(fs.access(path.join(root, v.webp)), v.webp).resolves.toBeUndefined();
    }
    // The HONOR photo lands on the product of the verified catalogue (same slug).
    expect(pack.models.some((m) => `${m.brand!.slug}-${m.id}` === 'honor-magic8-pro')).toBe(true);
  });

  it('keeps the original of every photo it ships', async () => {
    const root = path.join(process.cwd(), 'data/catalogue', KEY);
    const pack = await loadVisualPack(KEY);
    for (const m of pack.models) for (const v of m.variants) await expect(fs.access(path.join(root, 'originals', `${v.id}.jpg`)), v.id).resolves.toBeUndefined();
  });

  it('gives every photo of a product its own alt text, also against the iPhone pack (the English alt is the re-run key)', async () => {
    const owner = await loadVisualPack(KEY);
    const iphone = await loadVisualPack('iphone-visuals-2026');
    const seen = new Map<string, string>();
    const add = (productSlug: string, alt: string, origin: string) => {
      const k = `${productSlug}|${alt}`;
      expect(seen.has(k), `${k} (${origin} vs ${seen.get(k)})`).toBe(false);
      seen.set(k, origin);
    };
    for (const m of iphone.models) for (const v of m.variants) add(`apple-${m.id}`, packImageAlt(m.name, v.color_en, v.view).en, 'iphone pack');
    for (const m of owner.models) for (const v of m.variants) add(`${m.brand!.slug}-${m.id}`, packImageAlt(m.name, v.color_en, v.view).en, 'owner pack');
    // Arabic alt: describes the model and the colour shown.
    expect(packImageAlt('iPhone 17', 'Sage', { ar: 'الخلف والواجهة', en: 'back and front', fr: 'dos et face' })).toEqual({
      ar: 'صورة iPhone 17 — اللون: Sage (الخلف والواجهة)',
      en: 'iPhone 17 — Sage, back and front',
      fr: 'iPhone 17 — Sage, dos et face',
    });
    expect(sameColour('Titanium Silverblue', 'Titanium Silver Blue')).toBe(true);
    expect(sameColour('Space Grey', 'Space Gray')).toBe(false);
    expect(sameColour('', '')).toBe(false);
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
    expect(first).toMatchObject({ productCreated: true, variantsCreated: 0, imagesCreated: 2, total: 17 });

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
    // A photo re-cut after it was attached: the next run corrects the size recorded for it.
    const right = { width: p.images[0]!.width, height: p.images[0]!.height };
    await prisma.productImage.update({ where: { id: p.images[0]!.id }, data: { width: right.width + 68, height: right.height + 68 } });
    await importVisualPackModel(catalog, KEY, index, { bundled: true });
    expect(await prisma.productImage.findUniqueOrThrow({ where: { id: p.images[0]!.id }, select: { width: true, height: true } })).toEqual(right);
  }, 120_000);
});

describe('a photo of a colour the product already sells', () => {
  const S25 = 'samsung-galaxy-s25-ultra';
  const AIR = 'apple-iphone-air';

  it('is attached to that colour of the verified product, whatever the spelling (no variant created, product left as it is); a second run adds nothing', async () => {
    if (await prisma.product.findUnique({ where: { slug: S25 }, select: { id: true } })) return; // owned by another suite
    const verified = (JSON.parse(readFileSync(path.join(process.cwd(), 'data/catalogue/verified-catalogue-2026.json'), 'utf8')) as { models: { id: string }[] }).models;
    const pack = await loadVisualPack(KEY);
    const index = pack.models.findIndex((m) => m.id === 'galaxy-s25-ultra');
    try {
      await importVerifiedCatalogue(catalog, { models: verified.filter((m) => m.id === S25), publish: true });
      const before = await prisma.product.findUniqueOrThrow({ where: { slug: S25 }, include: { variants: { orderBy: { sort: 'asc' } } } });
      expect(before.status).toBe('ACTIVE');

      const step = await importVisualPackModel(catalog, KEY, index);
      expect(step).toMatchObject({ productCreated: false, variantsCreated: 0, imagesCreated: 1 });
      const after = await prisma.product.findUniqueOrThrow({ where: { slug: S25 }, include: { variants: { orderBy: { sort: 'asc' } }, images: true } });
      expect(after.status).toBe('ACTIVE');
      expect(after.name).toEqual(before.name);
      expect(after.variants.map((v) => v.sku)).toEqual(before.variants.map((v) => v.sku));
      expect(after.variants.every((v) => v.priceBaisa === null && v.stock === 0)).toBe(true);
      expect(after.images).toHaveLength(1);
      // The pack says "Titanium Silverblue", the verified catalogue "Titanium Silver Blue": same finish.
      expect(after.images[0]!.variantId).toBe(before.variants.find((v) => v.color === 'Titanium Silver Blue')!.id);
      expect((after.images[0]!.alt as { ar: string }).ar).toBe('صورة Galaxy S25 Ultra — اللون: Titanium Silverblue');

      // Storefront: the photo serves every capacity of that finish; the other finishes say "image not available".
      const detail = (await getProductDetail(S25, 'ar'))!;
      for (const v of detail.variants) {
        const sel = imagesForVariant(detail.images, v);
        if (v.color === 'Titanium Silver Blue') expect(sel.images, v.sku).toHaveLength(1);
        else expect(sel, v.sku).toEqual({ images: [], missingForColour: true });
      }

      expect(await importVisualPackModel(catalog, KEY, index)).toMatchObject({ productCreated: false, variantsCreated: 0, imagesCreated: 0 });
      expect(await prisma.productImage.count({ where: { productId: after.id } })).toBe(1);

      // A photo imported earlier as a general photo (no colour) is attached to its colour on the next run,
      // and its Arabic alt text is rewritten: what fixes the databases imported before this change.
      await prisma.productImage.updateMany({ where: { productId: after.id }, data: { variantId: null, alt: { ar: 'Galaxy S25 Ultra — Titanium Silverblue', en: 'Galaxy S25 Ultra — Titanium Silverblue', fr: 'Galaxy S25 Ultra — Titanium Silverblue' } } });
      expect(await importVisualPackModel(catalog, KEY, index)).toMatchObject({ imagesCreated: 0 });
      const fixed = await prisma.productImage.findFirstOrThrow({ where: { productId: after.id } });
      expect(fixed.variantId).toBe(before.variants.find((v) => v.color === 'Titanium Silver Blue')!.id);
      expect((fixed.alt as { ar: string }).ar).toBe('صورة Galaxy S25 Ultra — اللون: Titanium Silverblue');
    } finally {
      await removeProduct(S25);
    }
  }, 120_000);

  it('a second view from the owner sits next to the studio image of the same finish, whichever pack is imported first', async () => {
    if (await prisma.product.findUnique({ where: { slug: AIR }, select: { id: true } })) return; // owned by another suite
    const owner = await loadVisualPack(KEY);
    const iphone = await loadVisualPack('iphone-visuals-2026');
    const ownerIndex = owner.models.findIndex((m) => m.id === 'iphone-air');
    const iphoneIndex = iphone.models.findIndex((m) => m.id === 'iphone-air');
    const finishes = iphone.models[iphoneIndex]!.variants.length;
    try {
      // Owner's photo first: the product sells no colour yet, so the photo is general for now…
      expect(await importVisualPackModel(catalog, KEY, ownerIndex)).toMatchObject({ productCreated: true, variantsCreated: 0, imagesCreated: 1 });
      // …the studio pack still brings its own image for every finish, Sky Blue included…
      expect(await importVisualPackModel(catalog, 'iphone-visuals-2026', iphoneIndex)).toMatchObject({ productCreated: false, imagesCreated: finishes });
      // …and the next run attaches the owner's photo to Sky Blue.
      expect(await importVisualPackModel(catalog, KEY, ownerIndex)).toMatchObject({ imagesCreated: 0 });
      const p = await prisma.product.findUniqueOrThrow({ where: { slug: AIR }, include: { images: { include: { variant: true } } } });
      expect(p.images).toHaveLength(finishes + 1);
      expect(p.images.filter((i) => i.variantId === null)).toHaveLength(0);
      expect(p.images.filter((i) => i.variant?.color === 'Sky Blue')).toHaveLength(2);
      expect(await importVisualPackModel(catalog, 'iphone-visuals-2026', iphoneIndex)).toMatchObject({ variantsCreated: 0, imagesCreated: 0 });
      await removeProduct(AIR);

      // Studio pack first (the order of the automated import): the owner's view joins the Sky Blue finish at once.
      await importVisualPackModel(catalog, 'iphone-visuals-2026', iphoneIndex);
      expect(await importVisualPackModel(catalog, KEY, ownerIndex)).toMatchObject({ productCreated: false, variantsCreated: 0, imagesCreated: 1 });
      const q = await prisma.product.findUniqueOrThrow({ where: { slug: AIR }, include: { images: { orderBy: { sort: 'asc' }, include: { variant: true } }, variants: { orderBy: { sort: 'asc' } } } });
      const skyBlue = q.images.filter((i) => i.variant?.color === 'Sky Blue');
      expect(skyBlue.map((i) => (i.alt as { en: string }).en)).toEqual(['iPhone Air — Sky Blue', 'iPhone Air — Sky Blue, back and front']);
      const largest = q.variants.filter((v) => v.color === 'Sky Blue').at(-1)!; // largest capacity: same finish, same photos
      expect(imagesForVariant(q.images.map((i) => ({ id: i.id, variantId: i.variantId, color: i.variant?.color ?? null })), largest).images).toHaveLength(2);
    } finally {
      await removeProduct(AIR);
    }
  }, 240_000);
});
