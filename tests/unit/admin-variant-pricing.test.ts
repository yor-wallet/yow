/**
 * Bulk price & stock entry: pure planner / CSV parser, then the grid and the CSV import against PostgreSQL.
 * Prices are integer baisa; nothing is ever defaulted; every change is audited; stock changes leave a movement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, ValidationError, type Actor } from '@/lib/admin/actor';
import { applyVariantImport, parseOmrCell, parseVariantCsv, planVariantChanges, previewVariantImport, saveVariantGrid, type CurrentVariant } from '@/lib/admin/variant-pricing';
import { cleanup, createProduct, createUser } from './shop/fixtures';

const cur = (over: Partial<CurrentVariant> = {}): CurrentVariant => ({ id: 'v1', sku: 'SKU-1', productId: 'p1', priceBaisa: null, compareAtBaisa: null, costBaisa: null, stock: 0, reserved: 0, ...over });

describe('planVariantChanges (pure)', () => {
  it('plans a first price and stock, leaves absent fields alone, and flags rule breaks', () => {
    const [a] = planVariantChanges([cur()], [{ id: 'v1', price: 399_000, stock: 5 }], 'CATALOG');
    expect(a).toMatchObject({ status: 'change', priceChanged: true, stockChanged: true, errors: [] });
    expect(a!.after).toEqual({ price: 399_000, compareAt: null, cost: null, stock: 5 });

    expect(planVariantChanges([cur({ priceBaisa: 100_000 })], [{ id: 'v1' }], 'CATALOG')[0]!.status).toBe('unchanged');
    expect(planVariantChanges([cur()], [{ id: 'v1', price: 100_000, compareAt: 90_000 }], 'CATALOG')[0]!.errors).toContain('compare_not_higher');
    expect(planVariantChanges([cur()], [{ id: 'v1', compareAt: 90_000 }], 'CATALOG')[0]!.errors).toContain('compare_without_price');
    expect(planVariantChanges([cur({ stock: 10, reserved: 4 })], [{ id: 'v1', stock: 3 }], 'CATALOG')[0]!.errors).toContain('below_reserved');
    expect(planVariantChanges([cur()], [{ id: 'v1', price: -1 }], 'CATALOG')[0]!.errors).toContain('negative');
    expect(planVariantChanges([cur()], [{ id: 'nope' }], 'CATALOG')[0]!.errors).toEqual(['unknown_sku']);
    expect(planVariantChanges([cur()], [{ id: 'v1', price: 1 }, { id: 'v1', price: 2 }], 'CATALOG')[1]!.errors).toContain('duplicate_sku');
  });

  it('respects fine-grained permissions: support can change neither price nor stock', () => {
    const plan = planVariantChanges([cur()], [{ id: 'v1', price: 1000, stock: 1 }], 'SUPPORT');
    expect(plan[0]!.errors).toEqual(expect.arrayContaining(['forbidden_prices', 'forbidden_stock']));
  });
});

describe('CSV parsing (pure)', () => {
  it('reads OMR cells exactly (no float maths) and refuses malformed ones', () => {
    expect(parseOmrCell('329.000')).toEqual({ value: 329_000 });
    expect(parseOmrCell('0,5')).toEqual({ value: 500 });
    expect(parseOmrCell('12')).toEqual({ value: 12_000 });
    expect(parseOmrCell('')).toEqual({});
    expect(parseOmrCell('-3')).toEqual({ code: 'negative' });
    expect(parseOmrCell('1.2345')).toEqual({ code: 'amount_invalid' });
    expect(parseOmrCell('abc')).toEqual({ code: 'amount_invalid' });
  });

  it('accepts comma or semicolon files, ignores unknown columns, and refuses unusable files', () => {
    const ok = parseVariantCsv('sku;priceOmr;note\r\nabc-1;10,5;x\r\n');
    expect(ok.ok && ok.rows[0]).toMatchObject({ line: 2, sku: 'ABC-1', price: 10_500 });
    expect(parseVariantCsv('')).toEqual({ ok: false, code: 'empty' });
    expect(parseVariantCsv('priceOmr\n1')).toEqual({ ok: false, code: 'missing_sku_column' });
    expect(parseVariantCsv('sku,note\na,b')).toEqual({ ok: false, code: 'no_value_column' });
  });
});

describe('grid and CSV import (PostgreSQL)', () => {
  let catalog: Actor;
  let support: Actor;
  let productId: string;
  let variants: { id: string; sku: string }[];

  beforeAll(async () => {
    const u1 = await createUser();
    await prisma.user.update({ where: { id: u1.id }, data: { role: 'CATALOG' } });
    catalog = { id: u1.id, role: 'CATALOG' };
    const u2 = await createUser();
    await prisma.user.update({ where: { id: u2.id }, data: { role: 'SUPPORT' } });
    support = { id: u2.id, role: 'SUPPORT' };
    const p = await createProduct({ variants: [{ priceBaisa: null, stock: 0, capacity: '256 GB' }, { priceBaisa: null, stock: 0, capacity: '512 GB' }] });
    productId = p.id;
    // Admin SKUs are upper-case (the CSV import upper-cases what it reads): normalise the fixture's.
    for (const v of p.variants) await prisma.productVariant.update({ where: { id: v.id }, data: { sku: v.sku.toUpperCase() } });
    variants = p.variants.map((v) => ({ id: v.id, sku: v.sku.toUpperCase() }));
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [catalog.id, support.id] }, action: { startsWith: 'variant.' } } });
    await cleanup();
    await prisma.$disconnect();
  });

  it('saves prices and stock in one audited transaction, with a stock movement', async () => {
    const res = await saveVariantGrid(catalog, {
      productId,
      reason: 'first delivery',
      rows: [
        { id: variants[0]!.id, price: 399_000, compareAt: 429_000, cost: 350_000, stock: 7 },
        { id: variants[1]!.id, price: 459_500 },
      ],
    });
    expect(res).toMatchObject({ prices: 2, stocks: 1 });
    const v = await prisma.productVariant.findMany({ where: { productId }, orderBy: { sort: 'asc' } });
    expect(v.map((x) => [x.priceBaisa, x.compareAtBaisa, x.costBaisa, x.stock])).toEqual([[399_000, 429_000, 350_000, 7], [459_500, null, null, 0]]);
    expect(await prisma.stockMovement.findFirst({ where: { variantId: v[0]!.id, actorId: catalog.id } })).toMatchObject({ qty: 7, stockAfter: 7, reason: 'first delivery' });
    expect(await prisma.auditLog.count({ where: { actorId: catalog.id, action: 'variant.price.update', entityId: { in: v.map((x) => x.id) } } })).toBe(2);
  });

  it('is all-or-nothing: one bad row changes nothing', async () => {
    const before = await prisma.productVariant.findMany({ where: { productId }, orderBy: { sort: 'asc' } });
    await expect(
      saveVariantGrid(catalog, { productId, rows: [{ id: variants[0]!.id, price: 500_000 }, { id: variants[1]!.id, price: 100_000, compareAt: 50_000 }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await prisma.productVariant.findMany({ where: { productId }, orderBy: { sort: 'asc' } });
    expect(after.map((x) => x.priceBaisa)).toEqual(before.map((x) => x.priceBaisa));
  });

  it('refuses a stock below what orders reserved, and a role without the permission', async () => {
    await prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { reserved: 5 } });
    await expect(saveVariantGrid(catalog, { productId, rows: [{ id: variants[0]!.id, stock: 2 }] })).rejects.toBeInstanceOf(ValidationError);
    await prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { reserved: 0 } });
    await expect(saveVariantGrid(support, { productId, rows: [{ id: variants[0]!.id, price: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('CSV: the dry run writes nothing; apply writes the whole clean file once (idempotent key)', async () => {
    const csv = `sku,priceOmr,stock\n${variants[0]!.sku},410.250,9\n${variants[1]!.sku},,3\n`;
    const preview = await previewVariantImport(catalog, { csv });
    expect(preview).toMatchObject({ ok: true, total: 2, changes: 2, errors: 0 });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id } })).priceBaisa).toBe(399_000);

    const key = `${Date.now()}-csv-test-key-1`;
    const applied = await applyVariantImport(catalog, { csv, idempotencyKey: key });
    expect(applied).toMatchObject({ changes: 2 });
    const v = await prisma.productVariant.findMany({ where: { productId }, orderBy: { sort: 'asc' } });
    expect(v.map((x) => [x.priceBaisa, x.stock])).toEqual([[410_250, 9], [459_500, 3]]);
  });

  it('CSV: a file with one refused row is not applied at all', async () => {
    const csv = `sku,priceOmr\n${variants[0]!.sku},400\nUNKNOWN-SKU,10\n`;
    const preview = await previewVariantImport(catalog, { csv });
    expect(preview).toMatchObject({ ok: false, errors: 1 });
    await expect(applyVariantImport(catalog, { csv })).rejects.toThrow();
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id } })).priceBaisa).toBe(410_250);
  });
});
