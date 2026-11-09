import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, nameOf, ratioBps, top } from '../util';

/**
 * 14 · Optimisation — slow-moving stock (in stock, listed > 60 days, no sale in 60 days)
 * and campaigns worth boosting (CTR ≥ 2× the average of active campaigns).
 * Search terms with no results are not logged by the platform, so that analysis is
 * reported as unavailable in the run summary instead of being guessed.
 */
export default defineAgent({
  key: 'optimisation',
  number: 14,
  nameKey: 'optimisation',
  scopes: ['product', 'productVariant', 'orderItem', 'campaign', 'campaignStat'],
  schedule: { everyMinutes: AGENT_INTERVALS.optimisation },
  async run(ctx) {
    const cutoff = ago(ctx.now, 60 * DAY);
    const candidates = await ctx.db.product.findMany({
      where: { status: 'ACTIVE', createdAt: { lt: cutoff }, variants: { some: { stock: { gt: 0 }, isActive: true } } },
      select: { id: true, sku: true, name: true, variants: { select: { stock: true, reserved: true } } },
      take: 5000,
    });
    const sold = await ctx.db.orderItem.groupBy({
      by: ['productId'],
      where: { productId: { in: candidates.map((c) => c.id) }, createdAt: { gte: cutoff } },
      _sum: { qty: true },
    });
    const soldIds = new Set(sold.filter((s) => (s._sum.qty ?? 0) > 0).map((s) => s.productId));
    const slow = candidates.filter((c) => !soldIds.has(c.id));
    ctx.metric('slowMoving', slow.length);
    if (slow.length) {
      ctx.propose({
        severity: 'LOW',
        titleKey: 'optimisation.slowMoving',
        params: { count: slow.length },
        title: `${slow.length} product(s) without a sale in 60 days`,
        details: {
          items: top(slow.map((p) => ({ productId: p.id, sku: p.sku, name: nameOf(p.name), units: p.variants.reduce((s, v) => s + v.stock - v.reserved, 0) })), 50),
        },
        fingerprint: 'slow-moving',
      });
    }

    const campaigns = await ctx.db.campaign.findMany({ where: { isActive: true }, select: { id: true, internalName: true, priority: true } });
    const stats = await ctx.db.campaignStat.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaigns.map((c) => c.id) }, date: { gte: ago(ctx.now, 14 * DAY) } },
      _sum: { impressions: true, clicks: true },
    });
    const rows = stats
      .map((s) => ({ id: s.campaignId, impressions: s._sum.impressions ?? 0, clicks: s._sum.clicks ?? 0 }))
      .filter((s) => s.impressions >= 500);
    const totalImp = rows.reduce((s, r) => s + r.impressions, 0);
    const avg = ratioBps(rows.reduce((s, r) => s + r.clicks, 0), totalImp);
    const maxPriority = Math.max(0, ...campaigns.map((c) => c.priority));
    const byId = new Map(campaigns.map((c) => [c.id, c]));
    const boost = rows.filter((r) => avg > 0 && ratioBps(r.clicks, r.impressions) >= avg * 2 && (byId.get(r.id)?.priority ?? 0) < maxPriority);
    if (boost.length) {
      ctx.propose({
        severity: 'INFO',
        titleKey: 'optimisation.boostCampaigns',
        params: { count: boost.length },
        title: `${boost.length} campaign(s) outperform the average CTR`,
        details: {
          averageCtrBps: avg,
          items: boost.map((b) => ({ campaignId: b.id, name: byId.get(b.id)?.internalName, ctrBps: ratioBps(b.clicks, b.impressions), priority: byId.get(b.id)?.priority })),
        },
        fingerprint: 'boost-campaigns',
      });
    }
    ctx.metric('searchTermsWithoutResults', 'not_logged');
  },
});
