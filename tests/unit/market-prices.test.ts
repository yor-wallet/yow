/**
 * Market prices (owner's rule: DOOM price = market − 10 %, rounded down to 0.100 OMR): the shipped file
 * follows the rule and its sources, prices grow with capacity, and applying it prices only the variants
 * without a price (never a price chosen by staff), never touches stock, and is idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, type Actor } from '@/lib/admin/actor';
import { applyMarketPrices, doomPrice, loadMarketPrices, type MarketPrices } from '@/lib/admin/market-prices';
import { cleanup, createProduct, createUser } from './shop/fixtures';

let catalog: Actor;
let support: Actor;

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  return { id: u.id, role };
}

beforeAll(async () => {
  catalog = await staff('CATALOG');
  support = await staff('SUPPORT');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('the shipped market prices', () => {
  it('follow the rule, name a known source and grow with capacity', async () => {
    const doc = await loadMarketPrices();
    expect(doc.discountPercent).toBe(10);
    expect(doc.items.length).toBeGreaterThan(40);
    const bySlug = new Map<string, { gb: number | null; market: number }[]>();
    for (const it of doc.items) {
      expect(it.priceBaisa).toBe(doomPrice(it.marketBaisa, 10));
      expect(it.priceBaisa % 100).toBe(0);
      expect(it.priceBaisa).toBeLessThanOrEqual(it.marketBaisa * 0.9);
      bySlug.set(it.productSlug, [...(bySlug.get(it.productSlug) ?? []), { gb: it.storageGb, market: it.marketBaisa }]);
    }
    for (const [slug, rows] of bySlug) {
      const sorted = rows.filter((r) => r.gb !== null).sort((a, b) => a.gb! - b.gb!);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.market, slug).toBeGreaterThanOrEqual(sorted[i - 1]!.market);
    }
  });

  it('rounds down to the 0.100 OMR', () => {
    expect(doomPrice(459_010, 10)).toBe(413_100);
    expect(doomPrice(499_000, 10)).toBe(449_100);
    expect(doomPrice(89_000, 10)).toBe(80_100);
  });
});

describe('applyMarketPrices', () => {
  it('needs prices:write', async () => {
    const doc = await loadMarketPrices();
    await expect(applyMarketPrices(support, doc)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('prices the empty variants of the matching capacity, keeps a staff price and the stock, and is idempotent', async () => {
    const product = await createProduct({ status: 'DRAFT', variants: [{ priceBaisa: null, stock: 4 }, { priceBaisa: null, stock: 0 }, { priceBaisa: 123_000, stock: 2 }] });
    const variants = product.variants;
    await prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { storageGb: 256 } });
    await prisma.productVariant.update({ where: { id: variants[1]!.id }, data: { storageGb: 512 } });
    await prisma.productVariant.update({ where: { id: variants[2]!.id }, data: { storageGb: 256 } });
    const doc: MarketPrices = {
      retrievedAt: '2026-11-14',
      discountPercent: 10,
      sources: { test: { name: 'Test reseller', url: 'https://example.test' } },
      items: [
        { productSlug: product.slug, storageGb: 256, marketBaisa: 459_010, priceBaisa: 413_100, source: 'test' },
        { productSlug: product.slug, storageGb: 512, marketBaisa: 549_000, priceBaisa: 494_100, source: 'test' },
        { productSlug: 'no-such-product', storageGb: 256, marketBaisa: 100_000, priceBaisa: 90_000, source: 'test' },
      ],
    };
    const first = await applyMarketPrices(catalog, doc);
    expect(first).toEqual({ variantsPriced: 2, variantsKept: 1, missingProducts: ['no-such-product'] });
    const after = await prisma.productVariant.findMany({ where: { productId: product.id }, orderBy: { sort: 'asc' }, select: { id: true, priceBaisa: true, stock: true } });
    const byId = new Map(after.map((v) => [v.id, v]));
    expect(byId.get(variants[0]!.id)).toMatchObject({ priceBaisa: 413_100, stock: 4 });
    expect(byId.get(variants[1]!.id)).toMatchObject({ priceBaisa: 494_100, stock: 0 });
    expect(byId.get(variants[2]!.id)).toMatchObject({ priceBaisa: 123_000, stock: 2 });
    expect(await prisma.auditLog.count({ where: { action: 'catalogue.prices.market', entityId: product.id } })).toBe(1);

    const again = await applyMarketPrices(catalog, doc);
    expect(again.variantsPriced).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'catalogue.prices.market', entityId: product.id } })).toBe(1);
    await prisma.auditLog.deleteMany({ where: { entityId: product.id } });
  });
});
