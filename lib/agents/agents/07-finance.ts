import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, muscatDayStart, ratioBps } from '../util';

export const PAID_STATUSES = ['PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

/**
 * 7 · Financial analysis — yesterday's revenue / estimated profit summary (profit is
 * "partial" when some sold items have no recorded cost) and the 30-day refund ratio.
 */
export default defineAgent({
  key: 'finance',
  number: 7,
  nameKey: 'finance',
  scopes: ['order', 'orderItem', 'refund'],
  schedule: { everyMinutes: AGENT_INTERVALS.finance },
  async run(ctx) {
    const todayStart = muscatDayStart(ctx.now);
    const yStart = new Date(todayStart.getTime() - DAY);
    const paidWhere = { status: { in: [...PAID_STATUSES] }, paidAt: { gte: yStart, lt: todayStart } };
    const [agg, items] = await Promise.all([
      ctx.db.order.aggregate({ where: paidWhere, _sum: { totalBaisa: true, deliveryFeeBaisa: true, discountBaisa: true }, _count: { _all: true } }),
      ctx.db.orderItem.findMany({ where: { order: paidWhere }, select: { unitPriceBaisa: true, unitCostBaisa: true, qty: true } }),
    ]);
    let profit = 0;
    let missingCost = 0;
    for (const i of items) {
      if (i.unitCostBaisa == null) missingCost++;
      else profit += (i.unitPriceBaisa - i.unitCostBaisa) * i.qty;
    }
    const revenue = agg._sum.totalBaisa ?? 0;
    const date = new Date(yStart.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
    ctx.metric('revenueYesterdayBaisa', revenue);
    ctx.metric('ordersYesterday', agg._count._all);
    ctx.propose({
      severity: 'INFO',
      titleKey: 'finance.dailySummary',
      params: { date, orders: agg._count._all },
      title: `Daily summary ${date}: ${agg._count._all} paid order(s)`,
      details: {
        date,
        orders: agg._count._all,
        revenueBaisa: revenue,
        deliveryFeesBaisa: agg._sum.deliveryFeeBaisa ?? 0,
        discountsBaisa: agg._sum.discountBaisa ?? 0,
        estimatedProfitBaisa: profit,
        profitPartial: missingCost > 0,
        itemsWithoutCost: missingCost,
      },
      fingerprint: `daily:${date}`,
    });

    const since = ago(ctx.now, 30 * DAY);
    const [paid30, refunded30] = await Promise.all([
      ctx.db.order.aggregate({ where: { status: { in: [...PAID_STATUSES] }, paidAt: { gte: since } }, _sum: { totalBaisa: true } }),
      ctx.db.refund.aggregate({ where: { status: 'COMPLETED', processedAt: { gte: since } }, _sum: { amountBaisa: true }, _count: { _all: true } }),
    ]);
    const ratio = ratioBps(refunded30._sum.amountBaisa ?? 0, paid30._sum.totalBaisa ?? 0);
    ctx.metric('refundRatioBps30d', ratio);
    if ((paid30._sum.totalBaisa ?? 0) > 0 && ratio > 500) {
      ctx.propose({
        severity: ratio > 1500 ? 'HIGH' : 'MEDIUM',
        titleKey: 'finance.refundRatio',
        params: { pct: Math.round(ratio) / 100 },
        title: `Refunds are ${Math.round(ratio) / 100}% of revenue over 30 days`,
        details: { refundRatioBps: ratio, refundedBaisa: refunded30._sum.amountBaisa ?? 0, refunds: refunded30._count._all, revenueBaisa: paid30._sum.totalBaisa ?? 0 },
        fingerprint: 'refund-ratio',
      });
    }
  },
});
