/**
 * Order placement & lifecycle against PostgreSQL (doom_test): idempotency, stock race with
 * concurrent placements, explicit-items orders (DOOM FLEX), markOrderPaid, cancellation and
 * reservation expiry.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, serializable } from '@/lib/db';
import { placeOrder, markOrderPaid, cancelOrder, releaseExpiredReservations, OrderError, isOrderNumber, quoteCheckout } from '@/lib/orders';
import { addToUserCart, cleanup, createAddress, createDeliveryArea, createProduct, createPromotion, createUser, RUN } from './fixtures';

let area: Awaited<ReturnType<typeof createDeliveryArea>>;

beforeAll(async () => {
  area = await createDeliveryArea();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const key = () => randomUUID().replace(/-/g, '');

async function setup(opts: { stock: number; priceBaisa?: number; qty?: number }) {
  const user = await createUser();
  const address = await createAddress(user.id, area);
  const product = await createProduct({ variants: [{ priceBaisa: opts.priceBaisa ?? 120_500, stock: opts.stock }] });
  const variant = product.variants[0]!;
  if (opts.qty) await addToUserCart(user.id, variant.id, opts.qty);
  return { user, address, product, variant };
}

describe('placeOrder', () => {
  it('creates a PENDING_PAYMENT order with snapshots, reservation and cleared cart', async () => {
    const { user, address, variant } = await setup({ stock: 5, qty: 2 });
    const res = await placeOrder({ userId: user.id, idempotencyKey: key(), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'WALLET', locale: 'en' });
    expect(res.replayed).toBe(false);
    expect(isOrderNumber(res.number)).toBe(true);
    expect(res.totalBaisa).toBe(2 * 120_500 + 1500);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { items: true, reservations: true, events: true } });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.subtotalBaisa).toBe(241_000);
    expect(order.deliveryFeeBaisa).toBe(1500);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ qty: 2, unitPriceBaisa: 120_500, lineTotalBaisa: 241_000, variantId: variant.id });
    expect((order.addressSnapshot as Record<string, unknown>).wilayaId).toBe(area.wilaya.id);
    expect(order.reservations).toHaveLength(1);
    expect(order.reservations[0]!.status).toBe('ACTIVE');
    const minutes = (order.reservations[0]!.expiresAt.getTime() - order.placedAt.getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(15);
    expect(order.events.map((e) => e.toStatus)).toEqual(['PENDING_PAYMENT']);

    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(v.stock).toBe(5);
    expect(v.reserved).toBe(2);
    expect(await prisma.cartItem.count({ where: { cart: { userId: user.id } } })).toBe(0);
  });

  it('is idempotent: the same key returns the same order without reserving twice', async () => {
    const { user, address, variant } = await setup({ stock: 5, qty: 1 });
    const k = key();
    const input = { userId: user.id, idempotencyKey: k, addressId: address.id, deliveryType: 'STANDARD' as const, paymentMethod: 'CARD' as const, locale: 'en' as const };
    const first = await placeOrder(input);
    // Cart is now empty, a naive retry would fail with cart_empty — the key short-circuits.
    const second = await placeOrder(input);
    expect(second.orderId).toBe(first.orderId);
    expect(second.replayed).toBe(true);
    expect(await prisma.order.count({ where: { idempotencyKey: k } })).toBe(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reserved).toBe(1);
  });

  it('collapses concurrent submissions with the same key onto one order', async () => {
    const { user, address, variant } = await setup({ stock: 5, qty: 1 });
    const k = key();
    const input = { userId: user.id, idempotencyKey: k, addressId: address.id, deliveryType: 'STANDARD' as const, paymentMethod: 'CARD' as const, locale: 'en' as const };
    const results = await Promise.allSettled([placeOrder(input), placeOrder(input), placeOrder(input)]);
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrder>>> => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.value.orderId)).size).toBe(1);
    expect(await prisma.order.count({ where: { idempotencyKey: k } })).toBe(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reserved).toBe(1);
  });

  it('never oversells: concurrent placements for the last units', async () => {
    const product = await createProduct({ variants: [{ priceBaisa: 50_000, stock: 3 }] });
    const variant = product.variants[0]!;
    const buyers = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const u = await createUser();
        const a = await createAddress(u.id, area);
        await addToUserCart(u.id, variant.id, 1);
        return { u, a };
      }),
    );
    const results = await Promise.allSettled(
      buyers.map(({ u, a }) => placeOrder({ userId: u.id, idempotencyKey: key(), addressId: a.id, deliveryType: 'STANDARD', paymentMethod: 'CARD', locale: 'ar' })),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(OrderError);
      expect(['out_of_stock', 'cart_changed']).toContain((r.reason as OrderError).code);
    }
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(v.reserved).toBe(3);
    expect(v.stock).toBe(3);
    expect(await prisma.stockReservation.aggregate({ where: { variantId: variant.id, status: 'ACTIVE' }, _sum: { qty: true } })).toMatchObject({ _sum: { qty: 3 } });
  });

  it('rejects an empty cart, an unconfigured delivery type and a stale expected total', async () => {
    const { user, address, variant } = await setup({ stock: 2 });
    const base = { userId: user.id, addressId: address.id, paymentMethod: 'CARD' as const, locale: 'fr' as const };
    await expect(placeOrder({ ...base, idempotencyKey: key(), deliveryType: 'STANDARD' })).rejects.toMatchObject({ code: 'cart_empty' });
    await addToUserCart(user.id, variant.id, 1);
    // Express in this test zone needs capacity (configured) — but an unconfigured zone must refuse.
    const bare = await createDeliveryArea({ standardFeeBaisa: null, expressFeeBaisa: null, expressAvailable: false });
    const bareAddress = await createAddress(user.id, bare);
    await expect(placeOrder({ ...base, idempotencyKey: key(), addressId: bareAddress.id, deliveryType: 'STANDARD' })).rejects.toMatchObject({
      code: 'delivery_unavailable',
    });
    await expect(placeOrder({ ...base, idempotencyKey: key(), deliveryType: 'STANDARD', expectedTotalBaisa: 1 })).rejects.toMatchObject({
      code: 'price_changed',
    });
    // Nothing was reserved by the failed attempts.
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reserved).toBe(0);
  });

  it('prices EXPRESS as base + surcharge and applies the best live promotion', async () => {
    const { user, address, product } = await setup({ stock: 4, priceBaisa: 100_000, qty: 2 });
    await createPromotion({
      name: { ar: 'خصم', en: `${RUN} promo`, fr: 'Remise' },
      type: 'PERCENT',
      value: 1000, // 10 %
      productIds: [product.id],
      isActive: true,
    });
    const q = await quoteCheckout({ userId: user.id, locale: 'en', addressId: address.id, deliveryType: 'EXPRESS' });
    expect(q.discountBaisa).toBe(20_000);
    expect(q.delivery?.EXPRESS).toMatchObject({ available: true, feeBaisa: 3500 });
    const res = await placeOrder({ userId: user.id, idempotencyKey: key(), addressId: address.id, deliveryType: 'EXPRESS', paymentMethod: 'CARD', locale: 'en', expectedTotalBaisa: q.totalBaisa });
    expect(res.totalBaisa).toBe(200_000 - 20_000 + 3500);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.discountBaisa).toBe(20_000);
    expect(order.promotionId).not.toBeNull();
  });

  it('orders explicit items (DOOM FLEX) without touching the cart', async () => {
    const { user, address, variant } = await setup({ stock: 3, priceBaisa: 360_000 });
    const other = await createProduct({ variants: [{ priceBaisa: 10_000, stock: 9 }] });
    await addToUserCart(user.id, other.variants[0]!.id, 2);
    const res = await placeOrder({
      userId: user.id,
      idempotencyKey: key(),
      addressId: address.id,
      deliveryType: 'STANDARD',
      paymentMethod: 'FLEX',
      locale: 'en',
      items: [{ variantId: variant.id, qty: 1 }],
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { items: true } });
    expect(order.paymentMethod).toBe('FLEX');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.variantId).toBe(variant.id);
    expect(order.totalBaisa).toBe(360_000 + 1500);
    // The cart line of the other product is still there.
    expect(await prisma.cartItem.count({ where: { cart: { userId: user.id } } })).toBe(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reserved).toBe(1);
    // Unknown / out-of-stock explicit items are refused.
    await expect(
      placeOrder({ userId: user.id, idempotencyKey: key(), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'FLEX', locale: 'en', items: [{ variantId: variant.id, qty: 5 }] }),
    ).rejects.toMatchObject({ code: 'out_of_stock' });
  });
});

describe('order lifecycle', () => {
  it('markOrderPaid converts reservations into a stock decrement, creates the shipment, and is idempotent', async () => {
    const { user, address, variant } = await setup({ stock: 4, qty: 3 });
    const placed = await placeOrder({ userId: user.id, idempotencyKey: key(), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'CARD', locale: 'en' });
    const first = await serializable((tx) => markOrderPaid(placed.orderId, null, tx));
    expect(first).toMatchObject({ ok: true, alreadyPaid: false });
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(v.stock).toBe(1);
    expect(v.reserved).toBe(0);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { shipment: true, reservations: true } });
    expect(order.status).toBe('PAID');
    expect(order.paidAt).not.toBeNull();
    expect(order.shipment?.status).toBe('CONFIRMED');
    expect(order.reservations.every((r) => r.status === 'CONSUMED')).toBe(true);
    const sale = await prisma.stockMovement.findFirst({ where: { orderId: placed.orderId, type: 'SALE' } });
    expect(sale).toMatchObject({ qty: -3, stockAfter: 1 });

    const again = await serializable((tx) => markOrderPaid(placed.orderId, null, tx));
    expect(again).toMatchObject({ ok: true, alreadyPaid: true });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(1);
  });

  it('cancelOrder releases the reservation; paid orders cannot be cancelled here', async () => {
    const { user, address, variant } = await setup({ stock: 2, qty: 2 });
    const placed = await placeOrder({ userId: user.id, idempotencyKey: key(), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'CARD', locale: 'en' });
    const other = await createUser();
    expect(await cancelOrder(placed.orderId, { reason: 'test', userId: other.id })).toEqual({ ok: false, reason: 'not_found' });
    expect(await cancelOrder(placed.orderId, { reason: 'customer', userId: user.id, actorId: user.id })).toEqual({ ok: true, alreadyCancelled: false });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reserved).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } })).status).toBe('CANCELLED');
    expect(await cancelOrder(placed.orderId, { reason: 'again' })).toEqual({ ok: true, alreadyCancelled: true });
  });

  it('releaseExpiredReservations cancels unpaid orders; a late payment re-takes stock or reports stock_unavailable', async () => {
    const { user, address, variant } = await setup({ stock: 1, qty: 1 });
    const placed = await placeOrder({ userId: user.id, idempotencyKey: key(), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'CARD', locale: 'en' });
    const future = new Date(Date.now() + 16 * 60_000);
    const res = await releaseExpiredReservations(future);
    expect(res.orders).toBeGreaterThanOrEqual(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { reservations: true } });
    expect(order.status).toBe('CANCELLED');
    expect(order.reservations[0]!.status).toBe('EXPIRED');
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reserved).toBe(0);

    // Stock still there → late confirmation succeeds.
    const late = await serializable((tx) => markOrderPaid(placed.orderId, null, tx));
    expect(late).toMatchObject({ ok: true, alreadyPaid: false });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(0);

    // Another expired order for the now sold-out variant → stock_unavailable, nothing changed.
    await prisma.productVariant.update({ where: { id: variant.id }, data: { stock: 1 } });
    await addToUserCart(user.id, variant.id, 1);
    const placed2 = await placeOrder({ userId: user.id, idempotencyKey: key(), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'CARD', locale: 'en' });
    await releaseExpiredReservations(new Date(Date.now() + 16 * 60_000));
    await prisma.productVariant.update({ where: { id: variant.id }, data: { stock: 0 } });
    const refused = await serializable((tx) => markOrderPaid(placed2.orderId, null, tx));
    expect(refused).toEqual({ ok: false, reason: 'stock_unavailable' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed2.orderId } })).status).toBe('CANCELLED');
  });
});
