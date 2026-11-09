import { Prisma, type DeliveryType, type PaymentProvider, type AppLocale } from '@prisma/client';
import { prisma, serializable, isUniqueViolation } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { priceItems } from '@/lib/cart/pricing';
import { cartItems } from '@/lib/cart/store';
import { toAddressSnapshot } from '@/lib/delivery/addresses';
import { generateOrderNumber } from './number';
import { OrderError } from './errors';
import { quoteLines } from './quote';

/**
 * placeOrder — ONE SERIALIZABLE transaction that:
 *   1. re-prices the user's server cart (live prices, stock, promotions, delivery fee),
 *   2. reserves stock atomically (`reserved += qty` only while `stock - reserved >= qty`),
 *   3. creates the Order (PENDING_PAYMENT) with item + address snapshots, a unique human
 *      number, StockReservation rows (expire after RESERVATION_MINUTES), bookkeeping
 *      StockMovement rows, the first OrderStatusEvent and an audit record,
 *   4. removes the ordered lines from the cart.
 * Idempotent on `idempotencyKey` (Order.idempotencyKey is UNIQUE): replays return the
 * existing order, concurrent duplicates collapse onto one order.
 */

export const RESERVATION_MINUTES = 15;

export type PlaceOrderInput = {
  userId: string;
  idempotencyKey: string;
  addressId: string;
  deliveryType: DeliveryType;
  paymentMethod: PaymentProvider;
  locale: AppLocale;
  promoCode?: string | null;
  notes?: string | null;
  /** Total the customer saw on the review step; a different server total aborts with `price_changed`. */
  expectedTotalBaisa?: number | null;
};

export type PlacedOrder = {
  orderId: string;
  number: string;
  totalBaisa: number;
  reservationExpiresAt: string;
  replayed: boolean;
};

class DuplicateKeyError extends Error {
  constructor() {
    super('duplicate idempotency key');
  }
}

async function existingByKey(userId: string, idempotencyKey: string): Promise<PlacedOrder | null> {
  const o = await prisma.order.findUnique({
    where: { idempotencyKey },
    select: { id: true, number: true, userId: true, totalBaisa: true, placedAt: true, reservations: { select: { expiresAt: true }, take: 1 } },
  });
  if (!o) return null;
  if (o.userId !== userId) throw new OrderError('idempotency_conflict');
  const exp = o.reservations[0]?.expiresAt ?? new Date(o.placedAt.getTime() + RESERVATION_MINUTES * 60_000);
  return { orderId: o.id, number: o.number, totalBaisa: o.totalBaisa, reservationExpiresAt: exp.toISOString(), replayed: true };
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
  const replay = await existingByKey(input.userId, input.idempotencyKey);
  if (replay) return replay;

  for (let attempt = 0; ; attempt++) {
    try {
      return await serializable((tx) => placeInTx(tx, input), { maxRetries: 10, timeoutMs: 20_000 });
    } catch (err) {
      if (err instanceof DuplicateKeyError || isUniqueViolation(err, 'idempotencyKey')) {
        const again = await existingByKey(input.userId, input.idempotencyKey);
        if (again) return again;
      }
      // Astronomically rare order-number collision: retry with a fresh number.
      if (isUniqueViolation(err, 'number') && attempt < 3) continue;
      throw err;
    }
  }
}

async function placeInTx(tx: Prisma.TransactionClient, input: PlaceOrderInput): Promise<PlacedOrder> {
  const now = new Date();
  // Inside the transaction too: a concurrent duplicate may have committed meanwhile.
  const dup = await tx.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (dup) throw new DuplicateKeyError();

  const items = await cartItems({ userId: input.userId }, tx);
  if (items.length === 0) throw new OrderError('cart_empty');
  const lines = await priceItems(items, input.locale, tx);
  const quote = await quoteLines(lines, { userId: input.userId, locale: input.locale, addressId: input.addressId, deliveryType: input.deliveryType, promoCode: input.promoCode }, tx);

  if (!quote.ready) {
    throw new OrderError('cart_changed', { lines: lines.filter((l) => l.state !== 'ok').map((l) => ({ variantId: l.variantId, state: l.state })) });
  }
  if (!quote.address) throw new OrderError('address_not_found');
  if (input.promoCode && quote.promoStatus === 'invalid') throw new OrderError('promo_invalid');
  const option = quote.delivery?.[input.deliveryType];
  if (!option?.available || option.feeBaisa === undefined || quote.totalBaisa === null) {
    throw new OrderError('delivery_unavailable', { reason: option?.reason ?? 'not_configured' });
  }
  if (input.expectedTotalBaisa !== undefined && input.expectedTotalBaisa !== null && input.expectedTotalBaisa !== quote.totalBaisa) {
    throw new OrderError('price_changed', { totalBaisa: quote.totalBaisa });
  }

  // Atomic reservation: never more than `stock - reserved`.
  for (const l of lines) {
    const updated = await tx.$executeRaw`
      UPDATE "ProductVariant" SET "reserved" = "reserved" + ${l.allowedQty}, "updatedAt" = now()
      WHERE id = ${l.variantId} AND "isActive" = true AND "priceBaisa" IS NOT NULL AND "stock" - "reserved" >= ${l.allowedQty}`;
    if (updated !== 1) throw new OrderError('out_of_stock', { variantId: l.variantId });
  }

  if (quote.promotionId) {
    const used = await tx.$executeRaw`
      UPDATE "Promotion" SET "usageCount" = "usageCount" + 1, "updatedAt" = now()
      WHERE id = ${quote.promotionId} AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")`;
    if (used !== 1) throw new OrderError('promo_invalid');
  }

  const number = generateOrderNumber(now);
  const expiresAt = new Date(now.getTime() + RESERVATION_MINUTES * 60_000);
  const order = await tx.order.create({
    data: {
      number,
      userId: input.userId,
      status: 'PENDING_PAYMENT',
      subtotalBaisa: quote.subtotalBaisa,
      deliveryFeeBaisa: option.feeBaisa,
      discountBaisa: quote.discountBaisa,
      totalBaisa: quote.totalBaisa,
      paymentMethod: input.paymentMethod,
      deliveryType: input.deliveryType,
      addressSnapshot: toAddressSnapshot(quote.address) as unknown as Prisma.InputJsonValue,
      contactPhone: quote.address.phone,
      notes: input.notes?.trim().slice(0, 500) || null,
      locale: input.locale,
      promotionId: quote.promotionId,
      idempotencyKey: input.idempotencyKey,
      placedAt: now,
      items: {
        create: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          nameSnapshot: l.nameJson as Prisma.InputJsonValue,
          sku: l.sku,
          variantLabel: l.variantLabel,
          imageKey: l.imageKey,
          unitPriceBaisa: l.unitPriceBaisa!,
          qty: l.allowedQty,
          lineTotalBaisa: l.lineTotalBaisa,
          unitCostBaisa: l.unitCostBaisa,
          warrantyMonths: l.warrantyMonths,
        })),
      },
      events: { create: { fromStatus: null, toStatus: 'PENDING_PAYMENT', actorId: input.userId, note: 'order.placed' } },
    },
    select: { id: true, number: true, totalBaisa: true },
  });

  await tx.stockReservation.createMany({
    data: lines.map((l) => ({ variantId: l.variantId, qty: l.allowedQty, orderId: order.id, userId: input.userId, status: 'ACTIVE' as const, expiresAt })),
  });
  await tx.stockMovement.createMany({
    data: lines.map((l) => ({ variantId: l.variantId, type: 'RESERVATION' as const, qty: 0, reason: `reserve ${l.allowedQty} for ${number}`, orderId: order.id, actorId: input.userId })),
  });
  await tx.cartItem.deleteMany({ where: { cart: { userId: input.userId }, variantId: { in: lines.map((l) => l.variantId) } } });
  await logAudit(
    {
      actorId: input.userId,
      actorRole: 'CUSTOMER',
      action: 'order.place',
      entity: 'Order',
      entityId: order.id,
      after: { number, totalBaisa: order.totalBaisa, deliveryType: input.deliveryType, paymentMethod: input.paymentMethod, items: lines.length },
    },
    tx,
  );

  return { orderId: order.id, number: order.number, totalBaisa: order.totalBaisa, reservationExpiresAt: expiresAt.toISOString(), replayed: false };
}
