/**
 * Admin overview and order screens (lib/admin/overview.ts, lib/admin/orders.ts) against PostgreSQL.
 * The database may hold other rows, so every assertion is a DELTA against a reading taken just before the
 * fixtures are created. Everything created here carries RUN and is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { adminOverview } from '@/lib/admin/overview';
import { getAdminOrder, listAdminOrders } from '@/lib/admin/orders';

const RUN = `ov${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let userId: string;
let categoryId: string;
let seq = 0;

async function order(over: Partial<Prisma.OrderUncheckedCreateInput> & { totalBaisa: number }) {
  seq += 1;
  const { totalBaisa, ...rest } = over;
  return prisma.order.create({
    data: {
      number: `DM-${RUN}-${seq}`.toUpperCase(),
      userId,
      status: 'PAID',
      subtotalBaisa: totalBaisa,
      totalBaisa,
      addressSnapshot: {},
      idempotencyKey: `${RUN}-key-${seq}`,
      paidAt: new Date(),
      ...rest,
    },
  });
}

async function product(tag: string, status: 'ACTIVE' | 'DRAFT', stock: number, reserved = 0, threshold = 2) {
  return prisma.product.create({
    data: {
      slug: `${RUN}-${tag}`,
      sku: `${RUN}-${tag}`.toUpperCase(),
      categoryId,
      name: { en: `${RUN} ${tag}`, ar: `${RUN} ${tag}`, fr: `${RUN} ${tag}` },
      status,
      variants: { create: [{ sku: `${RUN}-${tag}-V`.toUpperCase(), priceBaisa: 10_000, stock, reserved, lowStockThreshold: threshold, isDefault: true }] },
    },
  });
}

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'power-banks' } })).id;
  const u = await prisma.user.create({ data: { email: `${RUN}@test.doom.local`, passwordHash: 'x', fullName: `Overview ${RUN}` } });
  userId = u.id;
});

afterAll(async () => {
  await prisma.refund.deleteMany({ where: { userId } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.product.deleteMany({ where: { slug: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('adminOverview', () => {
  it('counts revenue, orders and unpaid orders from real rows only', async () => {
    const before = await adminOverview();
    const day = 86_400_000;
    await order({ totalBaisa: 100_000 }); // counted
    await order({ totalBaisa: 50_000, status: 'DELIVERED' }); // counted
    await order({ totalBaisa: 70_000, status: 'PENDING_PAYMENT', paidAt: null }); // unpaid: not revenue
    await order({ totalBaisa: 40_000, status: 'CANCELLED' }); // cancelled: not revenue
    await order({ totalBaisa: 30_000, status: 'REFUNDED' }); // fully refunded: not revenue
    await order({ totalBaisa: 20_000, paidAt: new Date(Date.now() - 40 * day) }); // paid 40 days ago: outside the 30-day window
    const partial = await order({ totalBaisa: 90_000, status: 'PARTIALLY_REFUNDED' }); // counted, minus its completed refund
    await prisma.refund.create({ data: { orderId: partial.id, userId, amountBaisa: 25_000, reason: 'test', status: 'COMPLETED', idempotencyKey: `${RUN}-refund-1`, processedAt: new Date() } });
    await prisma.refund.create({ data: { orderId: partial.id, userId, amountBaisa: 5_000, reason: 'test', status: 'REQUESTED', idempotencyKey: `${RUN}-refund-2` } }); // not completed: ignored

    const after = await adminOverview();
    expect(after.revenueBaisa - before.revenueBaisa).toBe(100_000 + 50_000 + (90_000 - 25_000));
    expect(after.paidOrders - before.paidOrders).toBe(3);
    expect(after.unpaidOrders - before.unpaidOrders).toBe(1);
    expect(after.ordersToday - before.ordersToday).toBe(7);
    expect(after.recentOrders.length).toBeLessThanOrEqual(8);
    expect(Number.isInteger(after.revenueBaisa)).toBe(true);
  });

  it('counts products by status and flags low and sold-out stock of published products only', async () => {
    const before = await adminOverview();
    await product('active-ok', 'ACTIVE', 10);
    await product('active-low', 'ACTIVE', 3, 1); // available 2 <= threshold 2 → low
    await product('active-out', 'ACTIVE', 4, 4); // everything reserved → sold out
    await product('active-zero', 'ACTIVE', 0); // sold out
    await product('draft-low', 'DRAFT', 1); // drafts are not published: not counted as stock problems

    const after = await adminOverview();
    expect(after.products.active - before.products.active).toBe(4);
    expect(after.products.draft - before.products.draft).toBe(1);
    expect(after.products.total - before.products.total).toBe(5);
    expect(after.stock.low - before.stock.low).toBe(1);
    expect(after.stock.out - before.stock.out).toBe(2);
    const mine = after.stock.rows.filter((r) => r.sku.startsWith(RUN.toUpperCase()));
    expect(mine.every((r) => r.available <= r.threshold)).toBe(true);
    expect(mine.some((r) => r.sku.includes('DRAFT'))).toBe(false);
  });
});

describe('admin orders', () => {
  it('lists orders newest first, filters by status and searches by number, name and e-mail', async () => {
    const a = await order({ totalBaisa: 11_000, status: 'PENDING_PAYMENT', paidAt: null, placedAt: new Date(Date.now() - 2000) });
    const b = await order({ totalBaisa: 22_000, status: 'DELIVERED', placedAt: new Date(Date.now() - 1000) });

    const byNumber = await listAdminOrders({ q: a.number.toLowerCase() });
    expect(byNumber.total).toBe(1);
    expect(byNumber.items[0]).toMatchObject({ number: a.number, status: 'PENDING_PAYMENT', totalBaisa: 11_000, items: 0, customerEmail: `${RUN}@test.doom.local` });

    const byName = await listAdminOrders({ q: `Overview ${RUN}` });
    expect(byName.items.map((o) => o.number)).toContain(b.number);
    const byEmail = await listAdminOrders({ q: `${RUN}@test` });
    expect(byEmail.total).toBe(byName.total);

    const delivered = await listAdminOrders({ q: RUN, status: 'DELIVERED' });
    expect(delivered.items.every((o) => o.status === 'DELIVERED')).toBe(true);
    expect(delivered.items.map((o) => o.number)).toContain(b.number);
    expect(delivered.items.map((o) => o.number)).not.toContain(a.number);

    // Unknown status values in the URL are ignored (never injected into the query).
    const bogus = await listAdminOrders({ q: RUN, status: 'NOT_A_STATUS' });
    expect(bogus.status).toBeUndefined();
    expect(bogus.total).toBe(byName.total);

    const newestFirst = await listAdminOrders({ q: RUN });
    const numbers = newestFirst.items.map((o) => o.number);
    expect(numbers.indexOf(b.number)).toBeLessThan(numbers.indexOf(a.number));
  });

  it('paginates and loads one order with its customer, or null', async () => {
    const page1 = await listAdminOrders({ q: RUN, size: '10', page: '1' });
    expect(page1.query).toMatchObject({ page: 1, pageSize: 10 });
    expect(page1.items.length).toBeLessThanOrEqual(10);

    const first = page1.items[0]!;
    const detail = await getAdminOrder(first.number);
    expect(detail?.user.email).toBe(`${RUN}@test.doom.local`);
    expect(detail?.items).toEqual([]);
    expect(await getAdminOrder('DM-DOES-NOT-EXIST')).toBeNull();
  });
});
