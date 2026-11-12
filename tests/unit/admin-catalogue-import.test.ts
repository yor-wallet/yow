/**
 * Catalogue import against PostgreSQL (doom_test): drafts only, no variant / price / stock / image,
 * idempotent, never overwrites staff edits, audited, RBAC — and the shipped 2026 pack parses.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, ValidationError, type Actor } from '@/lib/admin/actor';
import { catalogueImportSchema, importCatalogue, parseCataloguePack, readImportMeta } from '@/lib/admin/catalogue-import';
import { listProducts } from '@/lib/catalog/listing';
import { cleanup, createUser, RUN } from './shop/fixtures';

const run = RUN.toLowerCase();
const batch = `${RUN}-batch`;
let catalog: Actor;
let support: Actor;
const brandSlug = `${run}brand`.replace(/[^a-z0-9]/g, '');

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  return { id: u.id, role };
}

const item = (n: number, over: Record<string, unknown> = {}) => ({
  id: `${run}-model-${n}`,
  brand: 'Apple',
  series: 'Test series',
  model: `Test Model ${n}`,
  year: 2025,
  colors: ['Black', 'Blue', 'Blue'],
  storage_gb: [512, 128, 256],
  specs_status: 'To verify',
  source_officielle: 'https://www.apple.com/iphone/compare/',
  price_omr: null,
  stock: null,
  images: [],
  published: false,
  ...over,
});

beforeAll(async () => {
  catalog = await staff('CATALOG');
  support = await staff('SUPPORT');
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { action: 'catalogue.import', actorId: catalog.id } });
  await prisma.product.deleteMany({ where: { slug: { startsWith: `${run}-model-` } } });
  await prisma.brand.deleteMany({ where: { slug: brandSlug } });
  await cleanup();
  await prisma.$disconnect();
});

describe('importCatalogue', () => {
  it('needs catalog:write', async () => {
    await expect(importCatalogue(support, { batch, items: [item(90)] })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.product.count({ where: { slug: `${run}-model-90` } })).toBe(0);
  });

  it('creates drafts with notes only: no variant, price, stock or image, and nothing reaches the storefront', async () => {
    const res = await importCatalogue(catalog, { batch, items: [item(1), item(2, { brand: brandSlug.toUpperCase(), colors: [], storage_gb: [] })] });
    expect(res).toMatchObject({ created: 2, refreshed: 0, total: 2, brandsCreated: [brandSlug.toUpperCase()] });

    const p = await prisma.product.findUniqueOrThrow({ where: { slug: `${run}-model-1` }, include: { variants: true, images: true, brand: true, category: true } });
    expect(p.status).toBe('DRAFT');
    expect(p.publishedAt).toBeNull();
    expect(p.variants).toHaveLength(0);
    expect(p.images).toHaveLength(0);
    expect(p.brand?.slug).toBe('apple');
    expect(p.category.slug).toBe('smartphones-apple');
    expect(p.createdById).toBe(catalog.id);
    expect(readImportMeta(p.importMeta)).toMatchObject({ batch, externalId: `${run}-model-1`, year: 2025, candidateColors: ['Black', 'Blue'], candidateStorageGb: [128, 256, 512], sourceUrl: 'https://www.apple.com/iphone/compare/' });

    // A brand without its own smartphone category falls back to "other brands".
    const other = await prisma.product.findUniqueOrThrow({ where: { slug: `${run}-model-2` }, include: { category: true } });
    expect(other.category.slug).toBe('smartphones-other');

    const listed = await listProducts({ locale: 'en', filters: { sort: 'newest' }, limit: 100, withTotal: false, promotions: [] });
    expect(listed.items.some((x) => x.slug.startsWith(`${run}-model-`))).toBe(false);
    expect(await prisma.auditLog.count({ where: { actorId: catalog.id, action: 'catalogue.import', entityId: batch } })).toBe(1);
  });

  it('is idempotent and never overwrites what staff edited', async () => {
    await importCatalogue(catalog, { batch, items: [item(3)] });
    const before = await prisma.product.findUniqueOrThrow({ where: { slug: `${run}-model-3` } });
    await prisma.product.update({ where: { id: before.id }, data: { name: { ar: 'اسم محرَّر', en: 'Edited name', fr: 'Nom modifié' }, warrantyMonths: 24 } });

    const res = await importCatalogue(catalog, { batch: `${batch}-2`, items: [item(3, { model: 'Changed In File', colors: ['Green'] }), item(4)] });
    expect(res).toMatchObject({ created: 1, refreshed: 1 });
    expect(await prisma.product.count({ where: { slug: `${run}-model-3` } })).toBe(1);
    const after = await prisma.product.findUniqueOrThrow({ where: { slug: `${run}-model-3` } });
    expect(after.name).toEqual({ ar: 'اسم محرَّر', en: 'Edited name', fr: 'Nom modifié' });
    expect(after.model).toBe('Test Model 3');
    expect(after.warrantyMonths).toBe(24);
    expect(readImportMeta(after.importMeta)).toMatchObject({ batch: `${batch}-2`, candidateColors: ['Green'] });
  });

  it('rejects a bad file as a whole (nothing is half-imported)', async () => {
    for (const items of [[item(5), item(5)], [item(6), item(7, { id: 'Bad Id!' })], [item(8, { storage_gb: [-1] })], [item(9, { source_officielle: 'javascript:alert(1)' })], []]) {
      await expect(importCatalogue(catalog, { batch, items })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await prisma.product.count({ where: { slug: { in: [5, 6, 7, 8, 9].map((n) => `${run}-model-${n}`) } } })).toBe(0);
  });
});

describe('the 2026 pack shipped in data/catalogue', () => {
  const text = readFileSync(path.resolve(__dirname, '../../data/catalogue/doom-pack-catalogue-2026.json'), 'utf8');

  it('parses, validates, and carries no price, stock, image or published flag', () => {
    const items = parseCataloguePack(text);
    expect(items).toHaveLength(48);
    const parsed = catalogueImportSchema.safeParse({ batch: 'doom-pack-2026', items });
    expect(parsed.success).toBe(true);
    for (const raw of items as Record<string, unknown>[]) {
      expect(raw.price_omr).toBeNull();
      expect(raw.stock).toBeNull();
      expect(raw.images).toEqual([]);
      expect(raw.published).toBe(false);
    }
  });

  it('parseCataloguePack accepts { items } and refuses anything else', () => {
    expect(parseCataloguePack('{"items":[{"id":"a"}]}')).toEqual([{ id: 'a' }]);
    expect(parseCataloguePack('{"nope":1}')).toBeNull();
    expect(parseCataloguePack('not json')).toBeNull();
  });
});
