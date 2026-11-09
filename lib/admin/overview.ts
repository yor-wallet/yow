import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { muscatDate } from './table';

/**
 * Live figures for the admin overview. Everything comes from real rows (orders, refunds, products, stock);
 * nothing is estimated, and an empty shop simply shows zeros.
 */

/** Orders whose payment counts as revenue (not cancelled, not fully refunded). */
export const REVENUE_STATUSES = ['PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PARTIALLY_REFUNDED'] as const;

export type LowStockRow = { variantId: string; productId: string; sku: string; productName: Prisma.JsonValue; available: number; threshold: number };

export type AdminOverview = {
  /** Paid in the last 30 days, minus completed partial refunds of those orders (integer baisa). */
  revenueBaisa: number;
  paidOrders: number;
  ordersToday: number;
  unpaidOrders: number;
  products: { active: number; draft: number; archived: number; total: number };
  stock: { low: number; out: number; rows: LowStockRow[] };
  recentOrders: { number: string; status: string; totalBaisa: number; placedAt: Date; customer: string }[];
};

export async function adminOverview(now: Date = new Date()): Promise<AdminOverview> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  // "Today" is a Muscat calendar day (UTC+4, no DST).
  const startOfToday = new Date(`${muscatDate(now)}T00:00:00+04:00`);
  const revenueWhere: Prisma.OrderWhereInput = { paidAt: { gte: since, lte: now }, status: { in: [...REVENUE_STATUSES] } };

  const [revenue, refunds, ordersToday, unpaidOrders, byStatus, stockCounts, stockRows, recent] = await Promise.all([
    prisma.order.aggregate({ where: revenueWhere, _sum: { totalBaisa: true }, _count: { _all: true } }),
    prisma.refund.aggregate({ where: { status: 'COMPLETED', order: { status: 'PARTIALLY_REFUNDED', paidAt: { gte: since, lte: now } } }, _sum: { amountBaisa: true } }),
    prisma.order.count({ where: { placedAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { status: 'PENDING_PAYMENT' } }),
    prisma.product.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.$queryRaw<{ low: bigint; out: bigint }[]>`
      SELECT count(*) FILTER (WHERE (v.stock - v.reserved) > 0) AS low,
             count(*) FILTER (WHERE (v.stock - v.reserved) <= 0) AS out
      FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
      WHERE p.status = 'ACTIVE' AND v."isActive" AND (v.stock - v.reserved) <= v."lowStockThreshold"`,
    prisma.$queryRaw<{ variantId: string; productId: string; sku: string; productName: Prisma.JsonValue; available: number; threshold: number }[]>`
      SELECT v.id AS "variantId", v."productId" AS "productId", v.sku AS sku, p.name AS "productName",
             (v.stock - v.reserved) AS available, v."lowStockThreshold" AS threshold
      FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
      WHERE p.status = 'ACTIVE' AND v."isActive" AND (v.stock - v.reserved) <= v."lowStockThreshold"
      ORDER BY (v.stock - v.reserved) ASC, v.sku ASC
      LIMIT 8`,
    prisma.order.findMany({
      orderBy: { placedAt: 'desc' },
      take: 8,
      select: { number: true, status: true, totalBaisa: true, placedAt: true, user: { select: { fullName: true } } },
    }),
  ]);

  const count = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
  const products = { active: count('ACTIVE'), draft: count('DRAFT'), archived: count('ARCHIVED'), total: byStatus.reduce((n, g) => n + g._count._all, 0) };

  return {
    revenueBaisa: (revenue._sum.totalBaisa ?? 0) - (refunds._sum.amountBaisa ?? 0),
    paidOrders: revenue._count._all,
    ordersToday,
    unpaidOrders,
    products,
    stock: { low: Number(stockCounts[0]?.low ?? 0), out: Number(stockCounts[0]?.out ?? 0), rows: stockRows.map((r) => ({ ...r, available: Number(r.available), threshold: Number(r.threshold) })) },
    recentOrders: recent.map((o) => ({ number: o.number, status: o.status, totalBaisa: o.totalBaisa, placedAt: o.placedAt, customer: o.user.fullName })),
  };
}
