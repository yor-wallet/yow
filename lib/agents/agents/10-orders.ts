import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, HOUR, top } from '../util';

/**
 * 10 · Orders — PAID orders not picked up for processing within 24h, cancelled orders
 * whose stock reservations are still ACTIVE, and unpaid orders older than 24h.
 */
export default defineAgent({
  key: 'orders',
  number: 10,
  nameKey: 'orders',
  scopes: ['order', 'stockReservation'],
  schedule: { everyMinutes: AGENT_INTERVALS.orders },
  async run(ctx) {
    const stuckPaid = await ctx.db.order.findMany({
      where: { status: 'PAID', paidAt: { lt: ago(ctx.now, DAY) } },
      select: { id: true, number: true, paidAt: true, totalBaisa: true, deliveryType: true },
      orderBy: { paidAt: 'asc' },
      take: 200,
    });
    ctx.metric('stuckPaid', stuckPaid.length);
    if (stuckPaid.length) {
      ctx.propose({
        severity: stuckPaid.some((o) => o.deliveryType === 'EXPRESS') || stuckPaid.length > 5 ? 'HIGH' : 'MEDIUM',
        titleKey: 'orders.stuckPaid',
        params: { count: stuckPaid.length },
        title: `${stuckPaid.length} paid order(s) not processed after 24h`,
        details: {
          items: top(
            stuckPaid.map((o) => ({
              orderId: o.id,
              number: o.number,
              paidAt: o.paidAt?.toISOString() ?? null,
              hours: o.paidAt ? Math.round((ctx.now.getTime() - o.paidAt.getTime()) / HOUR) : null,
              totalBaisa: o.totalBaisa,
              deliveryType: o.deliveryType,
            })),
            50,
          ),
        },
        fingerprint: 'stuck-paid',
      });
    }

    const leaked = await ctx.db.stockReservation.findMany({
      where: { status: 'ACTIVE', order: { status: { in: ['CANCELLED', 'REFUNDED'] } } },
      select: { id: true, qty: true, variantId: true, expiresAt: true, order: { select: { id: true, number: true, status: true } } },
      take: 500,
    });
    ctx.metric('cancelledWithReservations', leaked.length);
    if (leaked.length) {
      const expired = leaked.filter((r) => r.expiresAt < ctx.now).length;
      ctx.propose({
        severity: 'HIGH',
        titleKey: 'orders.cancelledReservations',
        params: { count: leaked.length },
        title: `${leaked.length} reservation(s) still active on cancelled orders`,
        details: {
          expired,
          items: top(leaked.map((r) => ({ reservationId: r.id, variantId: r.variantId, qty: r.qty, order: r.order?.number, orderStatus: r.order?.status })), 50),
        },
        action: expired > 0 ? { type: 'reservations.releaseExpired', params: {} } : undefined,
        fingerprint: 'cancelled-reservations',
      });
    }

    const unpaid = await ctx.db.order.count({ where: { status: 'PENDING_PAYMENT', placedAt: { lt: ago(ctx.now, DAY) } } });
    ctx.metric('unpaidOver24h', unpaid);
    if (unpaid > 0) {
      ctx.propose({
        severity: 'LOW',
        titleKey: 'orders.unpaid',
        params: { count: unpaid },
        title: `${unpaid} order(s) awaiting payment for more than 24h`,
        details: { count: unpaid },
        fingerprint: 'unpaid',
      });
    }
  },
});
