import { analysePrice } from '@/lib/admin/price-engine';
import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { nameOf } from '../util';

/**
 * 3 · Price analysis — variants whose price deviates from the VERIFIED market average
 * beyond `pricing.deviationAlertBps`, and variants sold below cost (negative margin).
 * Proposes `variant.setPrice` with the price-engine recommendation (human approval).
 */
export default defineAgent({
  key: 'price-analysis',
  number: 3,
  nameKey: 'priceAnalysis',
  scopes: ['productVariant', 'product', 'marketPriceObservation'],
  schedule: { everyMinutes: AGENT_INTERVALS['price-analysis'] },
  async run(ctx) {
    const s = ctx.settings;
    const params = {
      targetMarginBps: s['pricing.targetMarginBps'],
      competitivenessBps: s['pricing.competitivenessBps'],
      roundingBaisa: s['pricing.roundingBaisa'],
    };
    const threshold = s['pricing.deviationAlertBps'];
    const variants = await ctx.db.productVariant.findMany({
      where: { isActive: true, priceBaisa: { not: null }, product: { status: 'ACTIVE' } },
      select: {
        id: true,
        sku: true,
        priceBaisa: true,
        costBaisa: true,
        product: { select: { id: true, name: true } },
        priceObservations: { select: { priceBaisa: true, verified: true } },
      },
      take: 10_000,
    });
    let analysed = 0;
    let deviating = 0;
    let negative = 0;
    for (const v of variants) {
      const a = analysePrice({ costBaisa: v.costBaisa, priceBaisa: v.priceBaisa, observations: v.priceObservations }, params);
      analysed++;
      const base = {
        variantId: v.id,
        productId: v.product.id,
        sku: v.sku,
        product: nameOf(v.product.name),
        priceBaisa: v.priceBaisa,
        costBaisa: v.costBaisa,
        verifiedAvgBaisa: a.verified?.avgBaisa ?? null,
        verifiedCount: a.verified?.count ?? 0,
        recommendedBaisa: a.recommendedBaisa,
        basis: a.basis,
      };
      const action =
        a.recommendedBaisa != null && a.recommendedBaisa !== v.priceBaisa
          ? { type: 'variant.setPrice' as const, params: { variantId: v.id, priceBaisa: a.recommendedBaisa, previousBaisa: v.priceBaisa } }
          : undefined;

      if (v.costBaisa != null && v.priceBaisa != null && v.priceBaisa < v.costBaisa) {
        negative++;
        ctx.propose({
          severity: 'HIGH',
          titleKey: 'price.negativeMargin',
          params: { sku: v.sku },
          title: `${v.sku} is priced below cost`,
          details: { ...base, marginBps: a.current.marginBps },
          action,
          fingerprint: `negative:${v.id}`,
        });
        continue;
      }
      const dev = a.current.deviationBps;
      if (dev != null && Math.abs(dev) > threshold) {
        deviating++;
        ctx.propose({
          severity: Math.abs(dev) > threshold * 2 ? 'HIGH' : 'MEDIUM',
          titleKey: dev > 0 ? 'price.aboveMarket' : 'price.belowMarket',
          params: { sku: v.sku, pct: Math.round(Math.abs(dev) / 100) },
          title: `${v.sku} is ${Math.round(Math.abs(dev) / 100)}% ${dev > 0 ? 'above' : 'below'} the verified market average`,
          details: { ...base, deviationBps: dev, thresholdBps: threshold },
          action,
          fingerprint: `deviation:${v.id}`,
        });
      }
    }
    ctx.metric('analysed', analysed);
    ctx.metric('deviating', deviating);
    ctx.metric('negativeMargin', negative);
  },
});
