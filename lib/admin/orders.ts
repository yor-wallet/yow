import type { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { enumParam, parseTableQuery, type SearchParams } from './table';

/** Read side of the admin order screens. Order state changes (fulfilment, refunds) get their own mutations later. */

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const satisfies readonly OrderStatus[];

export const ORDER_SORTS = ['placedAt', 'totalBaisa'] as const;

export type AdminOrderRow = {
  id: string;
  number: string;
  status: OrderStatus;
  placedAt: Date;
  totalBaisa: number;
  items: number;
  customerName: string;
  customerEmail: string;
};

/** Filters live in the URL: `?q=` (order number, customer name or email), `?status=`, `?sort=`, `?dir=`, `?page=`. */
export async function listAdminOrders(sp: SearchParams) {
  const t = parseTableQuery(sp, { sortable: ORDER_SORTS, defaultSort: 'placedAt' });
  const status = enumParam(sp, 'status', ORDER_STATUSES);
  const where: Prisma.OrderWhereInput = {
    ...(status ? { status } : {}),
    ...(t.q
      ? {
          OR: [
            { number: { contains: t.q, mode: 'insensitive' } },
            { user: { email: { contains: t.q, mode: 'insensitive' } } },
            { user: { fullName: { contains: t.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ [t.sort]: t.dir }, { id: 'desc' }],
      skip: t.skip,
      take: t.take,
      select: { id: true, number: true, status: true, placedAt: true, totalBaisa: true, _count: { select: { items: true } }, user: { select: { fullName: true, email: true } } },
    }),
  ]);
  const items: AdminOrderRow[] = rows.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    placedAt: o.placedAt,
    totalBaisa: o.totalBaisa,
    items: o._count.items,
    customerName: o.user.fullName,
    customerEmail: o.user.email,
  }));
  return { items, total, query: t, status };
}

export async function getAdminOrder(number: string) {
  return prisma.order.findUnique({
    where: { number },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true } },
      items: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
      paymentIntents: { orderBy: { createdAt: 'desc' } },
      refunds: { orderBy: { createdAt: 'desc' } },
      shipment: { select: { id: true, status: true, trackingCode: true, promisedBy: true, failedReason: true, courier: { select: { id: true, name: true, phone: true } } } },
    },
  });
}
