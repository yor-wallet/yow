/**
 * Admin catalogue mutations against PostgreSQL (TEST_DATABASE_URL → doom_test): RBAC, validation, publishing rules,
 * price parsing, stock movements, images and the audit trail. Everything it creates carries RUN and is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { createUser } from '@/lib/auth/service';
import { AdminError, ForbiddenError, ValidationError, type Actor } from '@/lib/admin/actor';
import {
  addProductImage,
  createProduct,
  deleteProductImage,
  deleteVariant,
  getAdminProduct,
  listAdminProducts,
  saveVariant,
  setProductStatus,
  slugify,
  updateProduct,
} from '@/lib/admin/products';
import { getProductDetail } from '@/lib/catalog/queries';

const RUN = `ap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let catalogActor: Actor;
let supportActor: Actor;
let categoryId: string;
let brandId: string;
const userIds: string[] = [];

async function staff(role: Actor['role'], tag: string): Promise<Actor> {
  const res = await createUser({ fullName: `Staff ${tag}`, email: `${RUN}-${tag}@test.doom.local`, phone: `9${String(Date.now() % 10_000_000).padStart(7, '0')}`, password: 'Password1234', confirmPassword: 'Password1234', acceptTerms: true, locale: 'en' });
  if (!res.ok) throw new Error(`staff fixture: ${res.error}`);
  await prisma.user.update({ where: { id: res.user.id }, data: { role } });
  userIds.push(res.user.id);
  return { id: res.user.id, role };
}

const base = (over: Record<string, unknown> = {}) => ({
  sku: `${RUN}-p1`,
  name: { en: `${RUN} Test Phone`, ar: `${RUN} هاتف اختبار` },
  categoryId,
  ...over,
});

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'smartphones-apple' } })).id;
  brandId = (await prisma.brand.findFirstOrThrow({ where: { slug: 'apple' } })).id;
  catalogActor = await staff('CATALOG', 'cat');
  supportActor = await staff('SUPPORT', 'sup');
});

afterAll(async () => {
  const products = await prisma.product.findMany({ where: { sku: { startsWith: RUN.toUpperCase() } }, select: { id: true, images: { select: { key: true } } } });
  const ids = products.map((p) => p.id);
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('access control', () => {
  it('only staff with catalog:write may change the catalogue', async () => {
    for (const actor of [supportActor, { id: 'x', role: 'CUSTOMER' as const }, null, undefined]) {
      await expect(createProduct(actor as Actor, base())).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await prisma.product.count({ where: { sku: { startsWith: RUN.toUpperCase() } } })).toBe(0);
  });
});

describe('products', () => {
  it('creates a DRAFT with a slug from the English name, a normalised SKU and an audit row', async () => {
    const res = await createProduct(catalogActor, base({ brandId, warrantyMonths: 12, highlights: { en: ['One', 'Two'] } }));
    expect(res.slug).toBe(slugify(`${RUN} Test Phone`));
    const p = await prisma.product.findUniqueOrThrow({ where: { id: res.id } });
    expect(p).toMatchObject({ status: 'DRAFT', sku: `${RUN}-p1`.toUpperCase(), brandId, warrantyMonths: 12, createdById: catalogActor.id });
    expect((p.highlights as { en: string[] }).en).toEqual(['One', 'Two']);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: catalogActor.id, action: 'product.create', entityId: res.id } });
    expect(audit).not.toBeNull();
  });

  it('is invisible to customers until published, and publishing needs a variant', async () => {
    const created = await createProduct(catalogActor, base({ sku: `${RUN}-p2`, name: { en: `${RUN} Second Phone` } }));
    expect(await getProductDetail(created.slug, 'en')).toBeNull(); // DRAFT
    await expect(setProductStatus(catalogActor, { id: created.id, status: 'ACTIVE' })).rejects.toMatchObject({ code: 'product_needs_variant' });
    await saveVariant(catalogActor, { productId: created.id, sku: `${RUN}-p2-v`, price: '329.5', stock: 4, isDefault: true });
    await setProductStatus(catalogActor, { id: created.id, status: 'ACTIVE' });
    const live = await getProductDetail(created.slug, 'en');
    expect(live?.variants[0]).toMatchObject({ priceBaisa: 329_500, available: 4, availability: 'in_stock' });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).publishedAt).not.toBeNull();
    await setProductStatus(catalogActor, { id: created.id, status: 'ARCHIVED' });
    expect(await getProductDetail(created.slug, 'en')).toBeNull();
  });

  it('validates input and reports every field problem', async () => {
    const err = await createProduct(catalogActor, { sku: 'bad sku!', name: { en: '  ', ar: '', fr: '' }, categoryId: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys((err as ValidationError).fieldErrors ?? {}).sort()).toEqual(['categoryId', 'name', 'sku']);
    await expect(createProduct(catalogActor, base({ sku: `${RUN}-p3`, categoryId: 'no-such-category' }))).rejects.toMatchObject({ fieldErrors: { categoryId: ['invalid'] } });
    await expect(createProduct(catalogActor, base({ sku: `${RUN}-p3`, brandId: 'no-such-brand' }))).rejects.toMatchObject({ fieldErrors: { brandId: ['invalid'] } });
  });

  it('refuses a duplicate SKU or slug with a field error (not a 500)', async () => {
    await expect(createProduct(catalogActor, base({ sku: `${RUN}-p1`, name: { en: `${RUN} Another Name` } }))).rejects.toMatchObject({ fieldErrors: { sku: ['sku_taken'] } });
    await expect(createProduct(catalogActor, base({ sku: `${RUN}-p4`, name: { en: `${RUN} Test Phone` } }))).rejects.toMatchObject({ fieldErrors: { slug: ['slug_taken'] } });
  });

  it('updates fields and records only what changed', async () => {
    const created = await createProduct(catalogActor, base({ sku: `${RUN}-p5`, name: { en: `${RUN} Fifth Phone` } }));
    await updateProduct(catalogActor, { ...base({ sku: `${RUN}-p5`, name: { en: `${RUN} Fifth Phone` }, isFeatured: true, model: 'M5' }), id: created.id });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'product.update', entityId: created.id }, orderBy: { createdAt: 'desc' } });
    const after = audit?.after as Record<string, unknown>;
    expect(after).toMatchObject({ isFeatured: true, model: 'M5' });
    expect(Object.keys(after)).not.toContain('sku');
  });
});

describe('variants: prices and stock', () => {
  let productId: string;
  beforeAll(async () => {
    productId = (await createProduct(catalogActor, base({ sku: `${RUN}-v1`, name: { en: `${RUN} Variant Phone` } }))).id;
  });

  it('stores prices as integer baisa; an empty price means "no price" (never a default)', async () => {
    const priced = await saveVariant(catalogActor, { productId, sku: `${RUN}-v1-a`, price: '1,250.125', compareAt: '1300', cost: '1000', stock: 3, isDefault: true, capacity: '256GB', color: 'Black', colorHex: '#111111' });
    expect(await prisma.productVariant.findUniqueOrThrow({ where: { id: priced.id } })).toMatchObject({ priceBaisa: 1_250_125, compareAtBaisa: 1_300_000, costBaisa: 1_000_000, colorHex: '#111111' });
    const unpriced = await saveVariant(catalogActor, { productId, sku: `${RUN}-v1-b`, price: '', stock: 9 });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: unpriced.id } })).priceBaisa).toBeNull();
  });

  it('rejects malformed money, an inverted compare-at price and bad colours', async () => {
    for (const price of ['12.3456', '-5', 'abc', '99999999999']) {
      await expect(saveVariant(catalogActor, { productId, sku: `${RUN}-v1-x`, price, stock: 1 })).rejects.toMatchObject({ fieldErrors: { price: ['amount_invalid'] } });
    }
    await expect(saveVariant(catalogActor, { productId, sku: `${RUN}-v1-x`, price: '100', compareAt: '90', stock: 1 })).rejects.toMatchObject({ fieldErrors: { compare: ['compare_not_higher'] } });
    await expect(saveVariant(catalogActor, { productId, sku: `${RUN}-v1-x`, price: '100', stock: 1, colorHex: 'red' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps a single default variant and unique SKUs', async () => {
    const second = await saveVariant(catalogActor, { productId, sku: `${RUN}-v1-c`, price: '10', stock: 1, isDefault: true });
    const variants = await prisma.productVariant.findMany({ where: { productId } });
    expect(variants.filter((v) => v.isDefault).map((v) => v.id)).toEqual([second.id]);
    await expect(saveVariant(catalogActor, { productId, sku: `${RUN}-v1-c`, price: '10', stock: 1 })).rejects.toMatchObject({ fieldErrors: { sku: ['sku_taken'] } });
  });

  it('writes a stock movement for the initial stock and for every adjustment', async () => {
    const v = await saveVariant(catalogActor, { productId, sku: `${RUN}-v1-d`, price: '5', stock: 10 });
    await saveVariant(catalogActor, { id: v.id, productId, sku: `${RUN}-v1-d`, price: '5', stock: 7 });
    const moves = await prisma.stockMovement.findMany({ where: { variantId: v.id }, orderBy: { createdAt: 'asc' } });
    expect(moves.map((m) => [m.type, m.qty, m.stockAfter, m.actorId])).toEqual([
      ['RECEIPT', 10, 10, catalogActor.id],
      ['ADJUSTMENT', -3, 7, catalogActor.id],
    ]);
    // Editing something else does not touch the stock log.
    await saveVariant(catalogActor, { id: v.id, productId, sku: `${RUN}-v1-d`, price: '6', stock: 7 });
    expect(await prisma.stockMovement.count({ where: { variantId: v.id } })).toBe(2);
  });

  it('never lets stock drop below what is reserved for unpaid orders', async () => {
    const v = await saveVariant(catalogActor, { productId, sku: `${RUN}-v1-e`, price: '5', stock: 5 });
    await prisma.productVariant.update({ where: { id: v.id }, data: { reserved: 3 } });
    await expect(saveVariant(catalogActor, { id: v.id, productId, sku: `${RUN}-v1-e`, price: '5', stock: 2 })).rejects.toMatchObject({ fieldErrors: { stock: ['below_reserved'] } });
    await saveVariant(catalogActor, { id: v.id, productId, sku: `${RUN}-v1-e`, price: '5', stock: 3 });
  });

  it('deletes unused variants but protects ones that were ordered', async () => {
    const used = await saveVariant(catalogActor, { productId, sku: `${RUN}-v1-f`, price: '5', stock: 1 });
    const customer = userIds[0]!;
    await prisma.order.create({
      data: {
        number: `DM-000000-${RUN.slice(-5).toUpperCase().replace(/[01OIL]/g, '2')}`,
        userId: customer,
        subtotalBaisa: 5000,
        totalBaisa: 5000,
        addressSnapshot: {},
        idempotencyKey: `${RUN}-order-key-0001`,
        items: { create: [{ variantId: used.id, sku: `${RUN}-v1-f`, nameSnapshot: { en: 'x', ar: 'x', fr: 'x' }, unitPriceBaisa: 5000, qty: 1, lineTotalBaisa: 5000 }] },
      },
    });
    await expect(deleteVariant(catalogActor, { id: used.id })).rejects.toMatchObject({ code: 'variant_in_use' });
    const free = await saveVariant(catalogActor, { productId, sku: `${RUN}-v1-g`, price: '5', stock: 1 });
    await expect(deleteVariant(catalogActor, { id: free.id })).resolves.toMatchObject({ id: free.id });
    expect(await prisma.productVariant.findUnique({ where: { id: free.id } })).toBeNull();
  });
});

describe('images', () => {
  it('optimises a real image (WebP + AVIF + sizes), attaches it and removes it again', async () => {
    const productId = (await createProduct(catalogActor, base({ sku: `${RUN}-img`, name: { en: `${RUN} Image Phone` } }))).id;
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2255cc' } }).png().toBuffer();
    const added = await addProductImage(catalogActor, { productId, file: png, alt: { en: 'Front view' } });
    const img = await prisma.productImage.findUniqueOrThrow({ where: { id: added.id } });
    expect(img).toMatchObject({ width: 1200, height: 800, sort: 0 });
    expect(img.key.endsWith('.webp')).toBe(true);
    const detail = await getAdminProduct(productId);
    expect(detail?.images[0]?.url).toContain(img.key);
    const second = await addProductImage(catalogActor, { productId, file: png });
    expect((await prisma.productImage.findUniqueOrThrow({ where: { id: second.id } })).sort).toBe(1);
    await deleteProductImage(catalogActor, { id: added.id });
    await deleteProductImage(catalogActor, { id: second.id });
    expect(await prisma.productImage.count({ where: { productId } })).toBe(0);
  });

  it('rejects anything that is not really an image (the type comes from the bytes, not the name)', async () => {
    const productId = (await createProduct(catalogActor, base({ sku: `${RUN}-img2`, name: { en: `${RUN} Image Phone 2` } }))).id;
    await expect(addProductImage(catalogActor, { productId, file: Buffer.from('<?php echo 1; ?>') })).rejects.toMatchObject({ fieldErrors: { file: ['bad_type'] } });
    await expect(addProductImage(catalogActor, { productId, file: Buffer.alloc(0) })).rejects.toMatchObject({ fieldErrors: { file: ['empty'] } });
    await expect(addProductImage(supportActor, { productId, file: Buffer.from('x') })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('listing', () => {
  it('searches by SKU / name, filters by status and aggregates price and stock', async () => {
    const all = await listAdminProducts({ q: RUN });
    expect(all.total).toBeGreaterThanOrEqual(5);
    const bySku = await listAdminProducts({ q: `${RUN}-v1` });
    expect(bySku.items).toHaveLength(1);
    expect(bySku.items[0]).toMatchObject({ variants: expect.any(Number), priceMinBaisa: 5_000 });
    const drafts = await listAdminProducts({ q: RUN, status: 'DRAFT' });
    expect(drafts.items.every((p) => p.status === 'DRAFT')).toBe(true);
    const byArabic = await listAdminProducts({ q: 'هاتف اختبار' });
    expect(byArabic.items.some((p) => p.sku.startsWith(RUN.toUpperCase()))).toBe(true);
    const paged = await listAdminProducts({ q: RUN, size: '10', page: '2' });
    expect(paged.query).toMatchObject({ page: 2, pageSize: 10 });
  });
});
