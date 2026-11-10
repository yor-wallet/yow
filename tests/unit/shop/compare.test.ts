/**
 * Product comparison against PostgreSQL (doom_test): toggle, four-product limit, listing order,
 * hidden non-active products and the specification matrix.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { clearCompare, listCompare, MAX_COMPARE, removeCompare, specMatrix, toggleCompare, type CompareProduct } from '@/lib/catalog/compare';
import { cleanup, createProduct, createUser } from './fixtures';

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const product = (extra: Partial<Parameters<typeof createProduct>[0]> = {}) => createProduct({ variants: [{ priceBaisa: 90_000, stock: 3, capacity: '128GB', color: 'Black' }], ...extra });

describe('toggleCompare', () => {
  it('adds then removes a product and reports the count', async () => {
    const user = await createUser();
    const p = await product();
    expect(await toggleCompare(user.id, p.id)).toEqual({ ok: true, compared: true, count: 1 });
    expect(await toggleCompare(user.id, p.id)).toEqual({ ok: true, compared: false, count: 0 });
  });

  it(`stops at ${MAX_COMPARE} products and never adds a draft or unknown product`, async () => {
    const user = await createUser();
    for (let i = 0; i < MAX_COMPARE; i++) expect((await toggleCompare(user.id, (await product()).id)).ok).toBe(true);
    expect(await toggleCompare(user.id, (await product()).id)).toEqual({ ok: false, error: 'limit_reached' });
    expect(await prisma.compareItem.count({ where: { userId: user.id } })).toBe(MAX_COMPARE);

    const other = await createUser();
    expect(await toggleCompare(other.id, (await product({ status: 'DRAFT' })).id)).toEqual({ ok: false, error: 'not_found' });
    expect(await toggleCompare(other.id, 'does-not-exist')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('listCompare', () => {
  it('lists the products oldest first with their real options, and hides archived ones', async () => {
    const user = await createUser();
    const a = await product({ name: 'Compare A' });
    const b = await createProduct({ name: 'Compare B', variants: [{ priceBaisa: 70_000, stock: 1, capacity: '256GB', color: 'Blue' }, { priceBaisa: 80_000, stock: 1, capacity: '512GB', color: 'Blue' }] });
    await toggleCompare(user.id, a.id);
    await toggleCompare(user.id, b.id);

    const list = await listCompare(user.id, 'en');
    expect(list.map((p) => p.card.name)).toEqual(['Compare A', 'Compare B']);
    expect(list[0]).toMatchObject({ capacities: ['128GB'], colors: ['Black'], warrantyMonths: 12 });
    expect(list[1]!.capacities).toEqual(['256GB', '512GB']);
    expect(list[1]!.colors).toEqual(['Blue']);
    expect(list[1]!.card.priceBaisa).toBe(70_000);

    await prisma.product.update({ where: { id: a.id }, data: { status: 'ARCHIVED' } });
    expect((await listCompare(user.id, 'en')).map((p) => p.card.name)).toEqual(['Compare B']);

    await removeCompare(user.id, b.id);
    expect(await listCompare(user.id, 'en')).toEqual([]);
  });

  it('clears only the caller\'s comparison', async () => {
    const [u1, u2] = [await createUser(), await createUser()];
    const p = await product();
    await toggleCompare(u1.id, p.id);
    await toggleCompare(u2.id, p.id);
    await clearCompare(u1.id);
    expect(await prisma.compareItem.count({ where: { userId: u1.id } })).toBe(0);
    expect(await prisma.compareItem.count({ where: { userId: u2.id } })).toBe(1);
  });
});

describe('specMatrix', () => {
  it('builds the union of labels in first-seen order and marks missing values', () => {
    const p = (specs: [string, string][]) => ({ specs: specs.map(([label, value], i) => ({ key: `k${i}`, label, value })) }) as unknown as CompareProduct;
    expect(specMatrix([p([['Screen', '6.1"'], ['Battery', '4000 mAh']]), p([['Battery', '5000 mAh'], ['Weight', '190 g']])])).toEqual([
      { label: 'Screen', values: ['6.1"', null] },
      { label: 'Battery', values: ['4000 mAh', '5000 mAh'] },
      { label: 'Weight', values: [null, '190 g'] },
    ]);
    expect(specMatrix([])).toEqual([]);
  });
});
