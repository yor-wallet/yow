/**
 * Verified catalogue import (doom_test): facts only, variants only when the source confirms the matrix,
 * never a price / stock / image / review, idempotent, never overwrites staff edits, explicit publishing,
 * and the shipped 2026 file keeps its guarantees.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, ValidationError, type Actor } from '@/lib/admin/actor';
import { capacityLabel, displayName, importVerifiedCatalogue, variantSku, verifiedCatalogueSchema } from '@/lib/admin/catalogue-verified';
import { listProducts } from '@/lib/catalog/listing';
import { cleanup, createUser, RUN } from './shop/fixtures';

const run = RUN.toLowerCase();
let catalog: Actor;
let support: Actor;

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  return { id: u.id, role };
}

const model = (n: number, over: Record<string, unknown> = {}) => ({
  id: `${run}-vm-${n}`,
  verified: true,
  brand: 'Apple',
  series: 'Test series',
  model: `Test Phone ${n}`,
  year: 2025,
  sources: [{ label: 'Official page', url: 'https://support.apple.com/en-om/108044' }],
  checkedAt: '2026-11-12',
  colors: [
    { name: 'Black', hex: '#353839' },
    { name: 'Blue', hex: '#8ca6c9' },
  ],
  configs: [],
  variantMatrix: 'confirmed',
  variants: [
    { color: 'Black', storageGb: 256, ramGb: null, mpn: null },
    { color: 'Blue', storageGb: 256, ramGb: null, mpn: null },
    { color: 'Black', storageGb: 1024, ramGb: null, mpn: null },
    { color: 'Blue', storageGb: 1024, ramGb: null, mpn: null },
  ],
  specs: [{ key: 'display', label: { ar: 'الشاشة', en: 'Display', fr: 'Écran' }, value: { ar: '6.3″', en: '6.3″', fr: '6.3″' } }],
  ...over,
});

beforeAll(async () => {
  catalog = await staff('CATALOG');
  support = await staff('SUPPORT');
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { action: 'catalogue.import_verified', actorId: catalog.id } });
  await prisma.product.deleteMany({ where: { slug: { startsWith: `${run}-vm-` } } });
  await cleanup();
  await prisma.$disconnect();
});

describe('pure helpers', () => {
  it('formats capacities, names and SKUs', () => {
    expect(capacityLabel(128)).toBe('128 GB');
    expect(capacityLabel(1024)).toBe('1 TB');
    expect(capacityLabel(2048)).toBe('2 TB');
    expect(displayName('Apple', 'iPhone 17 Pro')).toBe('iPhone 17 Pro');
    expect(displayName('Samsung', 'Galaxy S25')).toBe('Samsung Galaxy S25');
    expect(displayName('HONOR', 'HONOR Magic8 Pro')).toBe('HONOR Magic8 Pro');
    expect(variantSku('apple-iphone-17', { color: 'Mist Blue', storageGb: 256 })).toBe('APPLE-IPHONE-17-MIST-BLUE-256');
    expect(variantSku('x', { color: 'Navy', storageGb: 128, mpn: 'sm-s931bdbimea' })).toBe('SM-S931BDBIMEA');
  });
});

describe('importVerifiedCatalogue', () => {
  it('needs catalog:write', async () => {
    await expect(importVerifiedCatalogue(support, { models: [model(90)] })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.product.count({ where: { slug: `${run}-vm-90` } })).toBe(0);
  });

  it('creates draft products with verified facts and variants WITHOUT price, stock, image or review', async () => {
    const res = await importVerifiedCatalogue(catalog, { models: [model(1)] });
    expect(res).toMatchObject({ productsCreated: 1, productsUpdated: 0, variantsCreated: 4, published: 0 });

    const p = await prisma.product.findUniqueOrThrow({ where: { slug: `${run}-vm-1` }, include: { variants: { orderBy: { sort: 'asc' } }, images: true, reviews: true } });
    expect(p).toMatchObject({ status: 'DRAFT', publishedAt: null, specsVerified: true, series: 'Test series', modelYear: 2025 });
    expect(p.sourceLinks).toEqual([{ label: 'Official page', url: 'https://support.apple.com/en-om/108044' }]);
    expect(p.sourceCheckedAt?.toISOString().slice(0, 10)).toBe('2026-11-12');
    expect(p.images).toHaveLength(0);
    expect(p.reviews).toHaveLength(0);
    expect(p.variants).toHaveLength(4);
    for (const v of p.variants) {
      expect(v.priceBaisa).toBeNull();
      expect(v.compareAtBaisa).toBeNull();
      expect(v.costBaisa).toBeNull();
      expect(v.stock).toBe(0);
      expect(v.isActive).toBe(true);
    }
    expect(p.variants.map((v) => [v.capacity, v.storageGb, v.color, v.colorHex])).toEqual([
      ['256 GB', 256, 'Black', '#353839'],
      ['256 GB', 256, 'Blue', '#8ca6c9'],
      ['1 TB', 1024, 'Black', '#353839'],
      ['1 TB', 1024, 'Blue', '#8ca6c9'],
    ]);
    expect(p.variants.filter((v) => v.isDefault)).toHaveLength(1);
    expect(await prisma.stockMovement.count({ where: { variantId: { in: p.variants.map((v) => v.id) } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorId: catalog.id, action: 'catalogue.import_verified' } })).toBeGreaterThanOrEqual(1);
  });

  it('keeps an unconfirmed colour x capacity matrix as admin notes: no variant is invented', async () => {
    const res = await importVerifiedCatalogue(catalog, {
      models: [model(2, { variantMatrix: 'unconfirmed', variants: [], configs: [{ ramGb: 12, storageGb: 512 }], colors: [{ name: 'Green', hex: null }] })],
    });
    expect(res).toMatchObject({ productsCreated: 1, variantsCreated: 0, draftsAwaitingMatrix: 1 });
    const p = await prisma.product.findUniqueOrThrow({ where: { slug: `${run}-vm-2` }, include: { variants: true } });
    expect(p.variants).toHaveLength(0);
    expect(p.specsVerified).toBe(true);
    expect(p.importMeta).toMatchObject({ candidateColors: ['Green'], candidateStorageGb: [512] });
  });

  it('an unverified model carries no specs and no variants', async () => {
    const res = await importVerifiedCatalogue(catalog, { models: [model(3, { verified: false, specs: [], variants: [], variantMatrix: 'unconfirmed', sources: [] })] });
    expect(res).toMatchObject({ productsCreated: 1, variantsCreated: 0, unverified: 1 });
    const p = await prisma.product.findUniqueOrThrow({ where: { slug: `${run}-vm-3` } });
    expect(p).toMatchObject({ specsVerified: false, status: 'DRAFT' });
    expect(p.specs).toEqual([]);
  });

  it('is idempotent and never touches prices, stock or edits entered by staff', async () => {
    await importVerifiedCatalogue(catalog, { models: [model(4)] });
    const p = await prisma.product.findUniqueOrThrow({ where: { slug: `${run}-vm-4` }, include: { variants: { orderBy: { sort: 'asc' } } } });
    const priced = p.variants[0]!;
    await prisma.productVariant.update({ where: { id: priced.id }, data: { priceBaisa: 399_000, stock: 5 } });
    await prisma.product.update({ where: { id: p.id }, data: { name: { ar: 'اسم', en: 'Edited name', fr: 'Nom' }, specs: [{ key: 'display', label: { ar: 'ا', en: 'Display', fr: 'É' }, value: { ar: 'تعديل', en: 'Edited', fr: 'Modifié' } }] } });

    const res = await importVerifiedCatalogue(catalog, { models: [model(4, { model: 'Changed in file', series: 'Other' }), model(5)] });
    expect(res).toMatchObject({ productsCreated: 1, productsUpdated: 1, variantsCreated: 4 });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: { variants: true } });
    expect(after.name).toEqual({ ar: 'اسم', en: 'Edited name', fr: 'Nom' });
    expect(after.model).toBe('Test Phone 4');
    expect(after.series).toBe('Test series');
    expect(after.specs).toEqual([{ key: 'display', label: { ar: 'ا', en: 'Display', fr: 'É' }, value: { ar: 'تعديل', en: 'Edited', fr: 'Modifié' } }]);
    expect(after.variants).toHaveLength(4);
    const same = after.variants.find((v) => v.id === priced.id)!;
    expect(same.priceBaisa).toBe(399_000);
    expect(same.stock).toBe(5);
  });

  it('publishes only on request, and only fully verified models with real variants', async () => {
    const models = [model(6), model(7, { variantMatrix: 'unconfirmed', variants: [] }), model(8, { verified: false, specs: [], variants: [], variantMatrix: 'unconfirmed' })];
    await importVerifiedCatalogue(catalog, { models });
    expect(await prisma.product.count({ where: { slug: { in: [6, 7, 8].map((n) => `${run}-vm-${n}`) }, status: 'ACTIVE' } })).toBe(0);

    const res = await importVerifiedCatalogue(catalog, { models, publish: true });
    expect(res.published).toBe(1);
    const status = Object.fromEntries((await prisma.product.findMany({ where: { slug: { in: [6, 7, 8].map((n) => `${run}-vm-${n}`) } }, select: { slug: true, status: true, publishedAt: true } })).map((p) => [p.slug, p]));
    expect(status[`${run}-vm-6`]).toMatchObject({ status: 'ACTIVE' });
    expect(status[`${run}-vm-6`]!.publishedAt).not.toBeNull();
    expect(status[`${run}-vm-7`]!.status).toBe('DRAFT');
    expect(status[`${run}-vm-8`]!.status).toBe('DRAFT');

    // A published product with unpriced variants is listed, but cannot be bought: price unavailable.
    const listed = await listProducts({ locale: 'en', filters: { sort: 'newest' }, limit: 200, withTotal: false, promotions: [] });
    const card = listed.items.find((x) => x.slug === `${run}-vm-6`);
    expect(card).toBeTruthy();
    expect(card!.priceBaisa).toBeNull();
    expect(card!.quickAddVariantId).toBeNull();
    expect(['unavailable', 'out_of_stock']).toContain(card!.availability);
  });

  it('rejects a bad file as a whole', async () => {
    for (const models of [[model(10), model(10)], [model(11), model(12, { id: 'Bad Id!' })], [model(13, { checkedAt: 'yesterday' })], [model(14, { sources: [{ label: 'x', url: 'javascript:alert(1)' }] })], []]) {
      await expect(importVerifiedCatalogue(catalog, { models })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await prisma.product.count({ where: { slug: { in: [10, 11, 12, 13, 14].map((n) => `${run}-vm-${n}`) } } })).toBe(0);
  });
});

describe('the verified 2026 catalogue shipped in data/catalogue', () => {
  const doc = JSON.parse(readFileSync(path.resolve(__dirname, '../../data/catalogue/verified-catalogue-2026.json'), 'utf8')) as { models: Record<string, any>[] };
  const parsed = verifiedCatalogueSchema.safeParse({ models: doc.models });

  it('validates and covers the 48 models of the pack once each', () => {
    expect(parsed.success).toBe(true);
    expect(doc.models).toHaveLength(48);
    expect(new Set(doc.models.map((m) => m.id)).size).toBe(48);
    expect(doc.models.filter((m) => !m.verified).map((m) => m.id).sort()).toEqual(['oppo-find-x6-pro', 'oppo-find-x7-ultra']);
  });

  it('never carries a price, stock, image or review anywhere', () => {
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/"(price|priceBaisa|price_omr|stock|images|reviews|rating)"\s*:/i);
  });

  it('only lists variants that the source confirms: colour and capacity exist for the model, no 128 GB invented', () => {
    for (const m of doc.models) {
      if (!m.verified) {
        expect(m.variants, m.id).toHaveLength(0);
        expect(m.specs, m.id).toHaveLength(0);
        continue;
      }
      if (m.variantMatrix !== 'confirmed') {
        expect(m.variants, m.id).toHaveLength(0);
        continue;
      }
      const colors = new Set(m.colors.map((c: { name: string }) => c.name));
      const seen = new Set<string>();
      for (const v of m.variants) {
        expect(colors.has(v.color), `${m.id} colour ${v.color}`).toBe(true);
        const key = `${v.color}|${v.storageGb}`;
        expect(seen.has(key), `${m.id} duplicate ${key}`).toBe(false);
        seen.add(key);
      }
      if (m.brand === 'Apple') {
        const storages = new Set(m.variants.map((v: { storageGb: number }) => v.storageGb));
        expect(m.variants.length, m.id).toBe(colors.size * storages.size);
      }
      if (m.brand === 'Samsung') {
        for (const v of m.variants) expect(v.mpn, m.id).toMatch(/^SM-[A-Z0-9]+MEA$/);
      }
    }
    const iphone14 = doc.models.find((m) => m.id === 'apple-iphone-14')!;
    expect(iphone14.variants.map((v: { storageGb: number }) => v.storageGb).sort((a: number, b: number) => a - b)[0]).toBe(128);
    const iphone17 = doc.models.find((m) => m.id === 'apple-iphone-17')!;
    expect(new Set(iphone17.variants.map((v: { storageGb: number }) => v.storageGb))).toEqual(new Set([256, 512])); // Apple sells no 128 GB iPhone 17
    const fold7 = doc.models.find((m) => m.id === 'samsung-galaxy-z-fold7')!;
    expect(fold7.variants).toHaveLength(8);
  });

  it('keeps every source on an official https page with a check date, and specs complete in three languages', () => {
    for (const m of doc.models) {
      expect(m.checkedAt).toBe('2026-11-12');
      expect(m.sources.length, m.id).toBeGreaterThan(0);
      for (const s of m.sources) expect(s.url).toMatch(/^https:\/\/(www\.|support\.)?(apple|samsung|honor|oppo)\.com\//);
      for (const sp of m.specs) for (const l of ['ar', 'en', 'fr']) expect(String(sp.value[l]).length, `${m.id} ${sp.key} ${l}`).toBeGreaterThan(0);
    }
  });
});
