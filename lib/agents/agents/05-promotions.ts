import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, nameOf, ratioBps, top } from '../util';

/**
 * 5 · Promotions — expired-but-active promotions, overlapping active promotions on the
 * same product/category/brand, campaigns ended but still active, and low-CTR campaigns.
 */
export default defineAgent({
  key: 'promotions',
  number: 5,
  nameKey: 'promotions',
  scopes: ['promotion', 'campaign', 'campaignStat'],
  schedule: { everyMinutes: AGENT_INTERVALS.promotions },
  async run(ctx) {
    const now = ctx.now;
    const promos = await ctx.db.promotion.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, startsAt: true, endsAt: true, productIds: true, categoryIds: true, brandIds: true, usageLimit: true, usageCount: true },
    });
    ctx.metric('activePromotions', promos.length);
    for (const p of promos) {
      const label = p.code ?? nameOf(p.name);
      if (p.endsAt && p.endsAt < now) {
        ctx.propose({
          severity: 'MEDIUM',
          titleKey: 'promotions.expiredActive',
          params: { name: label },
          title: `Promotion "${label}" ended but is still active`,
          details: { promotionId: p.id, endsAt: p.endsAt.toISOString() },
          action: { type: 'promotion.deactivate', params: { promotionId: p.id } },
          fingerprint: `promo-expired:${p.id}`,
        });
      } else if (p.usageLimit != null && p.usageCount >= p.usageLimit) {
        ctx.propose({
          severity: 'LOW',
          titleKey: 'promotions.exhausted',
          params: { name: label },
          title: `Promotion "${label}" reached its usage limit`,
          details: { promotionId: p.id, usageCount: p.usageCount, usageLimit: p.usageLimit },
          action: { type: 'promotion.deactivate', params: { promotionId: p.id } },
          fingerprint: `promo-exhausted:${p.id}`,
        });
      }
    }

    // Overlaps: two running promotions targeting the same product/category/brand id.
    const running = promos.filter((p) => (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt >= now));
    const overlaps: { a: string; b: string; target: string }[] = [];
    for (let i = 0; i < running.length; i++) {
      for (let j = i + 1; j < running.length; j++) {
        const a = running[i]!;
        const b = running[j]!;
        const shared = [
          ...a.productIds.filter((x) => b.productIds.includes(x)).map((x) => `product:${x}`),
          ...a.categoryIds.filter((x) => b.categoryIds.includes(x)).map((x) => `category:${x}`),
          ...a.brandIds.filter((x) => b.brandIds.includes(x)).map((x) => `brand:${x}`),
        ];
        const bothGlobal = !a.productIds.length && !a.categoryIds.length && !a.brandIds.length && !b.productIds.length && !b.categoryIds.length && !b.brandIds.length && !a.code && !b.code;
        if (shared.length || bothGlobal) overlaps.push({ a: a.code ?? nameOf(a.name), b: b.code ?? nameOf(b.name), target: shared[0] ?? 'all' });
      }
    }
    if (overlaps.length) {
      ctx.propose({
        severity: 'LOW',
        titleKey: 'promotions.overlap',
        params: { count: overlaps.length },
        title: `${overlaps.length} overlapping promotion pair(s)`,
        details: { items: top(overlaps) },
        fingerprint: 'overlap',
      });
    }

    const campaigns = await ctx.db.campaign.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, internalName: true, endsAt: true },
    });
    for (const c of campaigns) {
      if (c.endsAt && c.endsAt < now) {
        ctx.propose({
          severity: 'MEDIUM',
          titleKey: 'promotions.campaignEnded',
          params: { name: c.internalName },
          title: `Campaign "${c.internalName}" ended but is still active`,
          details: { campaignId: c.id, slug: c.slug, endsAt: c.endsAt.toISOString() },
          action: { type: 'campaign.deactivate', params: { campaignId: c.id } },
          fingerprint: `campaign-ended:${c.id}`,
        });
      }
    }

    // Low CTR over the last 14 days (needs enough impressions to be meaningful).
    const stats = await ctx.db.campaignStat.groupBy({
      by: ['campaignId'],
      where: { date: { gte: ago(now, 14 * DAY) }, campaignId: { in: campaigns.map((c) => c.id) } },
      _sum: { impressions: true, clicks: true },
    });
    const low = stats
      .map((s) => ({ id: s.campaignId, impressions: s._sum.impressions ?? 0, clicks: s._sum.clicks ?? 0 }))
      .filter((s) => s.impressions >= 1000 && ratioBps(s.clicks, s.impressions) < 30);
    if (low.length) {
      const names = new Map(campaigns.map((c) => [c.id, c.internalName]));
      ctx.propose({
        severity: 'LOW',
        titleKey: 'promotions.lowCtr',
        params: { count: low.length },
        title: `${low.length} campaign(s) with CTR below 0.3%`,
        details: { items: low.map((l) => ({ campaignId: l.id, name: names.get(l.id), impressions: l.impressions, clicks: l.clicks, ctrBps: ratioBps(l.clicks, l.impressions) })) },
        fingerprint: 'low-ctr',
      });
    }
  },
});
