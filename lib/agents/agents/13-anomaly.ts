import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, top } from '../util';

const PAID = ['PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

/**
 * 13 · Anomaly detection — velocity checks (top-ups / gift cards per user in 24h),
 * the same gift-card code submitted by several accounts, unusually large orders
 * (> mean + 3σ over 90 days) and phone numbers shared by several accounts.
 */
export default defineAgent({
  key: 'anomaly',
  number: 13,
  nameKey: 'anomaly',
  scopes: ['paymentIntent', 'giftCardSubmission', 'order', 'address'],
  schedule: { everyMinutes: AGENT_INTERVALS.anomaly },
  async run(ctx) {
    const day = ago(ctx.now, DAY);

    const topups = await ctx.db.paymentIntent.groupBy({
      by: ['userId'],
      where: { purpose: 'TOPUP', createdAt: { gte: day } },
      _count: { _all: true },
      _sum: { amountBaisa: true },
    });
    for (const t of topups.filter((x) => x._count._all > 5)) {
      ctx.propose({
        severity: t._count._all > 15 ? 'HIGH' : 'MEDIUM',
        titleKey: 'anomaly.topupVelocity',
        params: { count: t._count._all },
        title: `${t._count._all} top-up attempts by one customer in 24h`,
        details: { userId: t.userId, attempts: t._count._all, totalBaisa: t._sum.amountBaisa ?? 0 },
        fingerprint: `topups:${t.userId}`,
      });
    }

    const cards = await ctx.db.giftCardSubmission.groupBy({ by: ['userId'], where: { createdAt: { gte: day } }, _count: { _all: true } });
    for (const c of cards.filter((x) => x._count._all > 3)) {
      ctx.propose({
        severity: 'HIGH',
        titleKey: 'anomaly.giftCardVelocity',
        params: { count: c._count._all },
        title: `${c._count._all} gift cards submitted by one customer in 24h`,
        details: { userId: c.userId, submissions: c._count._all },
        fingerprint: `giftcards:${c.userId}`,
      });
    }

    // Same code fingerprint across different accounts (possible stolen / resold codes).
    const fps = await ctx.db.giftCardSubmission.groupBy({
      by: ['codeFingerprint'],
      where: { createdAt: { gte: ago(ctx.now, 90 * DAY) } },
      _count: { _all: true },
      having: { codeFingerprint: { _count: { gt: 1 } } },
    });
    for (const f of fps) {
      const subs = await ctx.db.giftCardSubmission.findMany({
        where: { codeFingerprint: f.codeFingerprint },
        select: { id: true, userId: true, status: true, codeLast4: true },
        take: 20,
      });
      const users = new Set(subs.map((s) => s.userId));
      if (users.size < 2) continue;
      ctx.propose({
        severity: 'CRITICAL',
        titleKey: 'anomaly.sharedGiftCard',
        params: { accounts: users.size },
        title: `One gift-card code submitted by ${users.size} accounts`,
        details: { submissions: subs.map((s) => ({ id: s.id, userId: s.userId, status: s.status, last4: s.codeLast4 })) },
        fingerprint: `shared-card:${f.codeFingerprint.slice(0, 16)}`,
      });
    }

    // Unusual order sizes: z-score over the last 90 days of paid orders.
    const recent = await ctx.db.order.findMany({
      where: { status: { in: [...PAID] }, paidAt: { gte: ago(ctx.now, 90 * DAY) } },
      select: { id: true, number: true, totalBaisa: true, userId: true, paidAt: true },
      take: 20_000,
    });
    ctx.metric('ordersSampled', recent.length);
    if (recent.length >= 20) {
      const mean = recent.reduce((s, o) => s + o.totalBaisa, 0) / recent.length;
      const sd = Math.sqrt(recent.reduce((s, o) => s + (o.totalBaisa - mean) ** 2, 0) / recent.length);
      const limit = mean + 3 * sd;
      const big = recent.filter((o) => sd > 0 && o.totalBaisa > limit && o.paidAt && o.paidAt >= day);
      if (big.length) {
        ctx.propose({
          severity: 'MEDIUM',
          titleKey: 'anomaly.largeOrders',
          params: { count: big.length },
          title: `${big.length} unusually large order(s) in 24h`,
          details: { thresholdBaisa: Math.round(limit), meanBaisa: Math.round(mean), items: top(big.map((o) => ({ orderId: o.id, number: o.number, totalBaisa: o.totalBaisa, userId: o.userId }))) },
          fingerprint: `large-orders:${ctx.now.toISOString().slice(0, 10)}`,
        });
      }
    }

    // One phone number used by several accounts (addresses).
    const phones = await ctx.db.address.groupBy({
      by: ['phone', 'userId'],
      where: { deletedAt: null },
    });
    const byPhone = new Map<string, Set<string>>();
    for (const p of phones) {
      if (!byPhone.has(p.phone)) byPhone.set(p.phone, new Set());
      byPhone.get(p.phone)!.add(p.userId);
    }
    const shared = [...byPhone.entries()].filter(([, users]) => users.size >= 3);
    if (shared.length) {
      ctx.propose({
        severity: 'MEDIUM',
        titleKey: 'anomaly.sharedPhone',
        params: { count: shared.length },
        title: `${shared.length} phone number(s) used by 3+ accounts`,
        details: { items: top(shared.map(([phone, users]) => ({ phoneLast4: phone.slice(-4), accounts: users.size, userIds: [...users].slice(0, 10) }))) },
        fingerprint: 'shared-phone',
      });
    }
  },
});
