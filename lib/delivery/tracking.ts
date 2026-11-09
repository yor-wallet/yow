import type { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { prisma } from '../db';
import { deriveHandoverOtp, OTP_MAX_ATTEMPTS } from './otp';
import { parseAddressSnapshot, type AddressSnapshot } from './addresses';

/**
 * Read models for the customer order pages (`/orders`, `/orders/[number]`).
 * Orders are created by the storefront module; this module only reads them and
 * owns the shipment side.
 */

export const ORDER_FILTERS = ['all', 'active', 'delivered', 'cancelled'] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number];

const FILTER_STATUSES: Record<Exclude<OrderFilter, 'all'>, OrderStatus[]> = {
  active: ['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'],
  delivered: ['DELIVERED'],
  cancelled: ['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
};

export function parseOrderFilter(v: unknown): OrderFilter {
  return (ORDER_FILTERS as readonly string[]).includes(String(v)) ? (v as OrderFilter) : 'all';
}

export async function listCustomerOrders(
  userId: string,
  opts: { filter?: OrderFilter; q?: string; cursor?: string; take?: number } = {},
) {
  const take = Math.min(Math.max(opts.take ?? 20, 1), 50);
  const where: Prisma.OrderWhereInput = { userId };
  if (opts.filter && opts.filter !== 'all') where.status = { in: FILTER_STATUSES[opts.filter] };
  const q = opts.q?.trim();
  if (q) where.number = { contains: q.toUpperCase() };
  const rows = await prisma.order.findMany({
    where,
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      number: true,
      status: true,
      totalBaisa: true,
      placedAt: true,
      deliveryType: true,
      _count: { select: { items: true } },
      items: { take: 3, orderBy: { createdAt: 'asc' }, select: { id: true, nameSnapshot: true, imageKey: true, qty: true } },
      shipment: { select: { status: true, promisedBy: true, deliveredAt: true } },
    },
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export type CustomerOrder = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

function loadOrder(userId: string, number: string) {
  return prisma.order.findFirst({
    where: { userId, number },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
      paymentIntents: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, provider: true, status: true, amountBaisa: true, createdAt: true, succeededAt: true },
      },
      shipment: {
        include: {
          events: { orderBy: { createdAt: 'asc' } },
          courier: { select: { name: true, phone: true, vehicle: true } },
        },
      },
      refunds: { select: { id: true, amountBaisa: true, status: true, createdAt: true } },
    },
  });
}

export type HandoverCode = { code: string; expiresAt: Date; attemptsLeft: number } | null;

/** The live handover code for the owner, when the shipment is out for delivery and the code is usable. */
export function handoverCodeFor(shipment: {
  id: string;
  status: ShipmentStatus;
  otpHash: string | null;
  otpExpiresAt: Date | null;
  otpAttempts: number;
}): HandoverCode {
  if (shipment.status !== 'OUT_FOR_DELIVERY' || !shipment.otpHash || !shipment.otpExpiresAt) return null;
  if (shipment.otpExpiresAt <= new Date() || shipment.otpAttempts >= OTP_MAX_ATTEMPTS) return null;
  return {
    code: deriveHandoverOtp(shipment.id, shipment.otpExpiresAt),
    expiresAt: shipment.otpExpiresAt,
    attemptsLeft: OTP_MAX_ATTEMPTS - shipment.otpAttempts,
  };
}

export async function getCustomerOrder(userId: string, number: string) {
  const order = await loadOrder(userId, number);
  if (!order) return null;
  const address: AddressSnapshot | null = parseAddressSnapshot(order.addressSnapshot);
  const handover = order.shipment ? handoverCodeFor(order.shipment) : null;
  const otpLocked =
    !!order.shipment && order.shipment.status === 'OUT_FOR_DELIVERY' && order.shipment.otpAttempts >= OTP_MAX_ATTEMPTS;
  return { order, address, handover, otpLocked };
}

/** Customer-facing timeline steps. */
export const TIMELINE_STEPS: readonly ShipmentStatus[] = [
  'CONFIRMED',
  'PREPARING',
  'PACKED',
  'COURIER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];
