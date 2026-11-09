import type { Prisma, OrderStatus, Role } from '@prisma/client';
import { prisma, serializable, type Db } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { createShipmentForOrder } from '@/lib/delivery/shipments';

/**
 * Order lifecycle owned by the storefront:
 *   markOrderPaid(orderId, paymentIntentId, tx)   — called by the money module INSIDE its
 *       payment-confirmation transaction (verified webhook / provider check / admin verification).
 *   cancelOrder(orderId, opts)                     — customer/system cancellation of an unpaid order.
 *   releaseExpiredReservations(now)                — cron: cancels unpaid orders whose 15-minute
 *       stock reservation expired and returns the stock.
 */

const PAID_OR_LATER: readonly OrderStatus[] = ['PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export type MarkPaidResult =
  | { ok: true; alreadyPaid: boolean; orderNumber: string }
  /**
   * `stock_unavailable`: the order had been cancelled (reservation expired) and the stock is
   * gone — NOTHING was changed; the caller must refund the confirmed payment.
   */
  | { ok: false; reason: 'not_found' | 'stock_unavailable' | 'invalid_status' };

type LockedOrder = { id: string; status: OrderStatus; number: string; userId: string; promotionId: string | null };

async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<LockedOrder | null> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, status, number, "userId", "promotionId" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Convert the order's stock reservations into real stock decrements (StockMovement SALE),
 * mark it PAID (OrderStatusEvent + audit) and create its Shipment (CONFIRMED) through
 * lib/delivery. Idempotent: an already-paid order returns `{ ok: true, alreadyPaid: true }`.
 * MUST run inside the caller's transaction (`tx`) so payment success and order state commit
 * together. Never throws for business conditions — returns a result instead.
 */
export async function markOrderPaid(orderId: string, paymentIntentId: string | null, tx: Prisma.TransactionClient): Promise<MarkPaidResult> {
  const order = await lockOrder(tx, orderId);
  if (!order) return { ok: false, reason: 'not_found' };
  if (PAID_OR_LATER.includes(order.status)) return { ok: true, alreadyPaid: true, orderNumber: order.number };
  if (order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED') return { ok: false, reason: 'invalid_status' };

  const [reservations, items] = await Promise.all([
    tx.stockReservation.findMany({ where: { orderId, status: 'ACTIVE' }, select: { id: true, variantId: true, qty: true } }),
    tx.orderItem.findMany({ where: { orderId }, select: { variantId: true, qty: true } }),
  ]);

  const now = new Date();
  if (order.status === 'PENDING_PAYMENT' && reservations.length > 0) {
    // Normal path: consume the reservations (stock -= qty, reserved -= qty).
    for (const r of reservations) {
      const rows = await tx.$queryRaw<{ stock: number }[]>`
        UPDATE "ProductVariant" SET "stock" = "stock" - ${r.qty}, "reserved" = "reserved" - ${r.qty}, "updatedAt" = now()
        WHERE id = ${r.variantId} AND "reserved" >= ${r.qty} AND "stock" >= ${r.qty}
        RETURNING "stock"`;
      if (rows.length !== 1) throw new Error(`Reservation ${r.id} inconsistent with variant ${r.variantId}`);
      await tx.stockMovement.create({
        data: { variantId: r.variantId, type: 'SALE', qty: -r.qty, stockAfter: rows[0]!.stock, orderId, reason: `sale ${order.number}` },
      });
    }
    await tx.stockReservation.updateMany({ where: { id: { in: reservations.map((r) => r.id) } }, data: { status: 'CONSUMED' } });
  } else {
    // Late confirmation after the reservation expired/was released: take stock directly if it is still there.
    const wanted = new Map<string, number>();
    for (const it of items) if (it.variantId) wanted.set(it.variantId, (wanted.get(it.variantId) ?? 0) + it.qty);
    const ids = [...wanted.keys()];
    const locked = ids.length
      ? await tx.$queryRaw<{ id: string; stock: number; reserved: number }[]>`
          SELECT id, stock, reserved FROM "ProductVariant" WHERE id = ANY(${ids}::text[]) FOR UPDATE`
      : [];
    for (const [variantId, qty] of wanted) {
      const v = locked.find((x) => x.id === variantId);
      if (!v || v.stock - v.reserved < qty) return { ok: false, reason: 'stock_unavailable' };
    }
    for (const [variantId, qty] of wanted) {
      const rows = await tx.$queryRaw<{ stock: number }[]>`
        UPDATE "ProductVariant" SET "stock" = "stock" - ${qty}, "updatedAt" = now() WHERE id = ${variantId} RETURNING "stock"`;
      await tx.stockMovement.create({
        data: { variantId, type: 'SALE', qty: -qty, stockAfter: rows[0]!.stock, orderId, reason: `sale ${order.number} (late payment)` },
      });
    }
    if (order.status === 'CANCELLED' && order.promotionId) {
      await tx.$executeRaw`UPDATE "Promotion" SET "usageCount" = "usageCount" + 1 WHERE id = ${order.promotionId}`;
    }
  }

  const intent = paymentIntentId
    ? await tx.paymentIntent.findUnique({ where: { id: paymentIntentId }, select: { provider: true } })
    : null;
  await tx.order.update({
    where: { id: orderId },
    data: {
      status: 'PAID',
      paidAt: now,
      cancelledAt: null,
      cancelReason: null,
      ...(intent ? { paymentMethod: intent.provider } : {}),
    },
  });
  await tx.orderStatusEvent.create({
    data: { orderId, fromStatus: order.status, toStatus: 'PAID', note: paymentIntentId ? `payment ${paymentIntentId}` : 'payment confirmed' },
  });
  await createShipmentForOrder(orderId, tx);
  await logAudit(
    { actorId: null, action: 'order.paid', entity: 'Order', entityId: orderId, before: { status: order.status }, after: { status: 'PAID', paymentIntentId } },
    tx,
  );
  return { ok: true, alreadyPaid: false, orderNumber: order.number };
}

export type CancelOptions = {
  reason: string;
  /** When set, only this user's order can be cancelled (customer action). */
  userId?: string;
  actorId?: string | null;
  actorRole?: Role | null;
  /** Reservation status to record (EXPIRED for the cron, RELEASED otherwise). */
  expired?: boolean;
};

export type CancelResult = { ok: true; alreadyCancelled: boolean } | { ok: false; reason: 'not_found' | 'not_cancellable' };

/** Cancel an UNPAID order and release its reservations, inside an existing transaction. */
export async function cancelOrderTx(tx: Prisma.TransactionClient, orderId: string, opts: CancelOptions): Promise<CancelResult> {
  const order = await lockOrder(tx, orderId);
  if (!order || (opts.userId && order.userId !== opts.userId)) return { ok: false, reason: 'not_found' };
  if (order.status === 'CANCELLED') return { ok: true, alreadyCancelled: true };
  if (order.status !== 'PENDING_PAYMENT') return { ok: false, reason: 'not_cancellable' };

  const reservations = await tx.stockReservation.findMany({ where: { orderId, status: 'ACTIVE' }, select: { id: true, variantId: true, qty: true } });
  for (const r of reservations) {
    await tx.$executeRaw`
      UPDATE "ProductVariant" SET "reserved" = GREATEST("reserved" - ${r.qty}, 0), "updatedAt" = now() WHERE id = ${r.variantId}`;
    await tx.stockMovement.create({
      data: { variantId: r.variantId, type: 'RELEASE', qty: 0, orderId, reason: `release ${r.qty} (${opts.reason})`, actorId: opts.actorId ?? null },
    });
  }
  if (reservations.length) {
    await tx.stockReservation.updateMany({
      where: { id: { in: reservations.map((r) => r.id) } },
      data: { status: opts.expired ? 'EXPIRED' : 'RELEASED' },
    });
  }
  if (order.promotionId) {
    await tx.$executeRaw`UPDATE "Promotion" SET "usageCount" = GREATEST("usageCount" - 1, 0) WHERE id = ${order.promotionId}`;
  }
  const now = new Date();
  await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: opts.reason.slice(0, 200) } });
  await tx.orderStatusEvent.create({
    data: { orderId, fromStatus: 'PENDING_PAYMENT', toStatus: 'CANCELLED', note: opts.reason.slice(0, 200), actorId: opts.actorId ?? null },
  });
  await logAudit(
    {
      actorId: opts.actorId ?? null,
      actorRole: opts.actorRole ?? null,
      action: 'order.cancel',
      entity: 'Order',
      entityId: orderId,
      before: { status: 'PENDING_PAYMENT' },
      after: { status: 'CANCELLED', reason: opts.reason, released: reservations.length },
    },
    tx,
  );
  return { ok: true, alreadyCancelled: false };
}

/** Cancel an unpaid order (own SERIALIZABLE transaction). Paid orders go through refunds (money module). */
export async function cancelOrder(orderId: string, opts: CancelOptions): Promise<CancelResult> {
  return serializable((tx) => cancelOrderTx(tx, orderId, opts), { maxRetries: 6 });
}

/**
 * Cron (`/api/cron/*`): cancel unpaid orders whose reservation expired and return the
 * stock; expire orphan reservations. Returns counts. Safe to run concurrently.
 */
export async function releaseExpiredReservations(now: Date = new Date(), db: Db = prisma): Promise<{ orders: number; reservations: number }> {
  const expired = await db.stockReservation.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    select: { id: true, orderId: true, variantId: true, qty: true },
    take: 500,
  });
  let orders = 0;
  let reservations = 0;
  const orderIds = [...new Set(expired.map((r) => r.orderId).filter((x): x is string => !!x))];
  for (const orderId of orderIds) {
    const res = await serializable(
      async (tx) => {
        const o = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
        if (o?.status !== 'PENDING_PAYMENT') return null;
        // Only if EVERY active reservation of the order is past due.
        const live = await tx.stockReservation.count({ where: { orderId, status: 'ACTIVE', expiresAt: { gt: now } } });
        if (live > 0) return null;
        return cancelOrderTx(tx, orderId, { reason: 'reservation_expired', expired: true });
      },
      { maxRetries: 6 },
    );
    if (res?.ok && !res.alreadyCancelled) {
      orders++;
      reservations += expired.filter((r) => r.orderId === orderId).length;
    }
  }
  for (const r of expired.filter((x) => !x.orderId)) {
    await serializable(async (tx) => {
      const n = await tx.stockReservation.updateMany({ where: { id: r.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      if (n.count === 1) {
        await tx.$executeRaw`UPDATE "ProductVariant" SET "reserved" = GREATEST("reserved" - ${r.qty}, 0) WHERE id = ${r.variantId}`;
        await tx.stockMovement.create({ data: { variantId: r.variantId, type: 'RELEASE', qty: 0, reason: `expired reservation ${r.id}` } });
        reservations++;
      }
    });
  }
  return { orders, reservations };
}
