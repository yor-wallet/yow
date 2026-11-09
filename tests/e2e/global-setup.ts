import { PrismaClient } from '@prisma/client';

/**
 * Storefront fixtures for the e2e suite. Runs once, AFTER the web server is up (so the database is
 * migrated and seeded) and BEFORE any test. The products are test-only (`e2e-sf-*`, obviously fake
 * names) and are removed again at the end, so the unit test that checks "the seed contains no
 * product" keeps passing on the same database.
 */
export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/doom_test';
export const E2E_SLUG_PREFIX = 'e2e-sf-';

const L = (en: string, ar: string, fr = en) => ({ en, ar, fr });

type VariantSeed = { sku: string; capacity?: string; color?: string; colorHex?: string; priceBaisa: number | null; stock: number; isDefault?: boolean };
const PRODUCTS: { key: string; sub: string; brand: string; name: ReturnType<typeof L>; variants: VariantSeed[] }[] = [
  {
    key: 'alpha',
    sub: 'smartphones-apple',
    brand: 'apple',
    name: L('E2E Alpha Phone', 'هاتف إي تو إي ألفا'),
    variants: [
      { sku: 'E2E-ALPHA-128', capacity: '128GB', color: 'Black', colorHex: '#111111', priceBaisa: 100_000, stock: 5, isDefault: true },
      { sku: 'E2E-ALPHA-256', capacity: '256GB', color: 'Black', colorHex: '#111111', priceBaisa: 130_000, stock: 3 },
    ],
  },
  { key: 'beta', sub: 'smartphones-samsung', brand: 'samsung', name: L('E2E Beta Phone', 'هاتف إي تو إي بيتا'), variants: [{ sku: 'E2E-BETA', priceBaisa: 200_000, stock: 4, isDefault: true }] },
  { key: 'soldout', sub: 'smartphones-apple', brand: 'apple', name: L('E2E Soldout Phone', 'هاتف إي تو إي نافد'), variants: [{ sku: 'E2E-SOLDOUT', priceBaisa: 50_000, stock: 0, isDefault: true }] },
  { key: 'noprice', sub: 'smartphones-samsung', brand: 'samsung', name: L('E2E Unpriced Phone', 'هاتف إي تو إي بلا سعر'), variants: [{ sku: 'E2E-NOPRICE', priceBaisa: null, stock: 3, isDefault: true }] },
];

export const PROMO_CODE = 'E2E10';
export const ZONE_FEES = { standard: 1_500, express: 3_000 };

/** Gives the Muscat governorate zone real fees (the seed leaves every fee NULL = "not configured"). */
async function configureZone(db: PrismaClient) {
  const gov = await db.governorate.findFirstOrThrow({ where: { code: 'MA' } });
  const zone = await db.deliveryZone.findFirstOrThrow({ where: { governorateId: gov.id }, orderBy: { sort: 'asc' } });
  const before = { standardFeeBaisa: zone.standardFeeBaisa, expressFeeBaisa: zone.expressFeeBaisa, expressAvailable: zone.expressAvailable, dailyCapacityStandard: zone.dailyCapacityStandard, dailyCapacityExpress: zone.dailyCapacityExpress };
  await db.deliveryZone.update({
    where: { id: zone.id },
    data: { standardFeeBaisa: ZONE_FEES.standard, expressFeeBaisa: ZONE_FEES.express, expressAvailable: true, dailyCapacityStandard: 500, dailyCapacityExpress: 500 },
  });
  return async () => {
    await db.deliveryZone.update({ where: { id: zone.id }, data: before });
  };
}

async function removeFixtures(db: PrismaClient) {
  await db.promotion.deleteMany({ where: { code: PROMO_CODE } });
  const products = await db.product.findMany({ where: { slug: { startsWith: E2E_SLUG_PREFIX } }, select: { id: true } });
  const ids = products.map((p) => p.id);
  if (ids.length === 0) return;
  // Carts created by the tests reference the variants.
  await db.cartItem.deleteMany({ where: { variant: { productId: { in: ids } } } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
}

export default async function globalSetup() {
  const db = new PrismaClient({ datasourceUrl: TEST_DB });
  await removeFixtures(db);
  const restoreZone = await configureZone(db);
  await db.promotion.create({
    data: { code: PROMO_CODE, name: L('E2E 10% off', 'خصم 10% للاختبار'), type: 'PERCENT', value: 1000, isActive: true },
  });
  for (const p of PRODUCTS) {
    const category = await db.category.findFirstOrThrow({ where: { slug: p.sub } });
    const brand = await db.brand.findFirstOrThrow({ where: { slug: p.brand } });
    await db.product.create({
      data: {
        slug: `${E2E_SLUG_PREFIX}${p.key}`,
        sku: `E2E-SF-${p.key.toUpperCase()}`,
        categoryId: category.id,
        brandId: brand.id,
        name: p.name,
        description: L('Test product used by the automated tests only.', 'منتج اختباري يُستخدم في الاختبارات الآلية فقط.', 'Produit de test utilisé uniquement par les tests automatisés.'),
        status: 'ACTIVE',
        publishedAt: new Date(),
        variants: { create: p.variants.map((v, i) => ({ ...v, sort: i })) },
      },
    });
  }
  return async () => {
    await removeFixtures(db);
    await restoreZone();
    await db.$disconnect();
  };
}
