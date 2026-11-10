import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';

/**
 * Test-only data for the storefront unit tests (doom_test DB, shared with other modules):
 * every row is uniquely named with the `TEST-shop-` prefix and removed in `cleanup()`.
 * Delivery fees live on a dedicated test governorate/wilaya/zone so no seeded zone is touched.
 */

export const RUN = `TEST-shop-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slugBase = RUN.toLowerCase();
let seq = 0;
const next = () => `${++seq}`;

const created = { users: [] as string[], products: [] as string[], governorates: [] as string[], promotions: [] as string[] };

export async function createUser(): Promise<{ id: string; email: string }> {
  const n = next();
  const user = await prisma.user.create({
    data: {
      email: `${slugBase}-u${n}@test.doom.local`,
      fullName: 'Shop Tester',
      passwordHash: await hashPassword('ShopTester123'),
      phone: `+9687${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
    },
    select: { id: true, email: true },
  });
  created.users.push(user.id);
  return user;
}

export type VariantSpec = { priceBaisa: number | null; stock: number; color?: string; colorHex?: string; capacity?: string; isDefault?: boolean };

export async function createProduct(opts: {
  variants: VariantSpec[];
  categorySlug?: string;
  brandSlug?: string;
  name?: string;
  status?: 'ACTIVE' | 'DRAFT';
  isSellable?: boolean;
  expressEligible?: boolean;
  isDealOfDay?: boolean;
}) {
  const n = next();
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: opts.categorySlug ?? 'smartphones-apple' } });
  const brand = opts.brandSlug ? await prisma.brand.findUnique({ where: { slug: opts.brandSlug } }) : null;
  const name = opts.name ?? `Test Phone ${n}`;
  const product = await prisma.product.create({
    data: {
      slug: `${slugBase}-p${n}`,
      sku: `${RUN}-P${n}`,
      categoryId: category.id,
      brandId: brand?.id ?? null,
      name: { ar: `هاتف تجريبي ${n}`, en: name, fr: `${name} FR` },
      status: opts.status ?? 'ACTIVE',
      isSellable: opts.isSellable ?? true,
      expressEligible: opts.expressEligible ?? true,
      isDealOfDay: opts.isDealOfDay ?? false,
      warrantyMonths: 12,
      weightGrams: 400,
      volumeCm3: 1200,
      variants: {
        create: opts.variants.map((v, i) => ({
          sku: `${RUN}-P${n}-V${i + 1}`,
          priceBaisa: v.priceBaisa,
          stock: v.stock,
          color: v.color,
          colorHex: v.colorHex,
          capacity: v.capacity,
          isDefault: v.isDefault ?? i === 0,
          sort: i,
        })),
      },
    },
    include: { variants: { orderBy: { sort: 'asc' } } },
  });
  created.products.push(product.id);
  return product;
}

/** Isolated governorate + wilaya + zone with configured fees (standard 1.500, express +2.000). */
export async function createDeliveryArea(opts: { standardFeeBaisa?: number | null; expressFeeBaisa?: number | null; expressAvailable?: boolean } = {}) {
  const n = next();
  const code = `T${Date.now().toString(36).slice(-4).toUpperCase()}${n}`;
  const gov = await prisma.governorate.create({
    data: {
      code,
      name: { ar: 'محافظة اختبار', en: `Test governorate ${n}`, fr: `Gouvernorat test ${n}` },
      sort: 900,
      wilayas: { create: { slug: `${slugBase}-w${n}`, name: { ar: 'ولاية اختبار', en: `Test wilaya ${n}`, fr: `Wilaya test ${n}` } } },
    },
    include: { wilayas: true },
  });
  created.governorates.push(gov.id);
  const zone = await prisma.deliveryZone.create({
    data: {
      governorateId: gov.id,
      wilayaSlugs: [],
      name: { ar: 'منطقة اختبار', en: 'Test zone', fr: 'Zone test' },
      standardFeeBaisa: opts.standardFeeBaisa === undefined ? 1500 : opts.standardFeeBaisa,
      expressFeeBaisa: opts.expressFeeBaisa === undefined ? 2000 : opts.expressFeeBaisa,
      expressAvailable: opts.expressAvailable ?? true,
      dailyCapacityExpress: 1000,
      sort: 900,
    },
  });
  return { governorate: gov, wilaya: gov.wilayas[0]!, zone };
}

export async function createAddress(userId: string, area: Awaited<ReturnType<typeof createDeliveryArea>>) {
  return prisma.address.create({
    data: {
      userId,
      recipientName: 'Shop Tester',
      phone: '+96891234567',
      governorateId: area.governorate.id,
      wilayaId: area.wilaya.id,
      area: 'Test area',
      building: 'Building 1',
      isDefault: true,
    },
  });
}

export async function createPromotion(data: Parameters<typeof prisma.promotion.create>[0]['data']) {
  const p = await prisma.promotion.create({ data });
  created.promotions.push(p.id);
  return p;
}

export async function addToUserCart(userId: string, variantId: string, qty: number) {
  const cart = await prisma.cart.upsert({ where: { userId }, create: { userId }, update: {} });
  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    create: { cartId: cart.id, variantId, qty },
    update: { qty },
  });
}

export async function cleanup() {
  const orders = await prisma.order.findMany({ where: { userId: { in: created.users } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...orderIds, ...created.users] } }, { actorId: { in: created.users } }] } });
  await prisma.paymentIntent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.cart.deleteMany({ where: { OR: [{ userId: { in: created.users } }, { items: { some: { variant: { productId: { in: created.products } } } } }] } });
  await prisma.address.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.idempotencyRecord.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.product.deleteMany({ where: { id: { in: created.products } } });
  await prisma.promotion.deleteMany({ where: { id: { in: created.promotions } } });
  await prisma.deliveryZone.deleteMany({ where: { governorateId: { in: created.governorates } } });
  await prisma.governorate.deleteMany({ where: { id: { in: created.governorates } } });
}
