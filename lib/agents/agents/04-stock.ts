import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { nameOf, top } from '../util';

/**
 * 4 · Stock — low stock (available ≤ threshold), out-of-stock variants still wanted
 * in carts, and stale ACTIVE reservations past their expiry.
 * available = stock − reserved. Threshold = max(variant.lowStockThreshold, setting).
 */
export default defineAgent({
  key: 'stock',
  number: 4,
  nameKey: 'stock',
  scopes: ['productVariant', 'product', 'cartItem', 'stockReservation'],
  schedule: { everyMinutes: AGENT_INTERVALS.stock },
  async run(ctx) {
    const globalThreshold = ctx.settings['stock.lowThreshold'];
    const variants = await ctx.db.productVariant.findMany({
      where: { isActive: true, product: { status: 'ACTIVE' } },
      select: {
        id: true,
        sku: true,
        stock: true,
        reserved: true,
        lowStockThreshold: true,
        priceBaisa: true,
        product: { select: { id: true, name: true } },
      },
      take: 20_000,
    });
    const low: Record<string, unknown>[] = [];
    const outIds: string[] = [];
    for (const v of variants) {
      const available = v.stock - v.reserved;
      const threshold = Math.max(v.lowStockThreshold, globalThreshold);
      if (available <= 0) outIds.push(v.id);
      else if (available <= threshold) low.push({ variantId: v.id, sku: v.sku, product: nameOf(v.product.name), available, threshold });
    }
    ctx.metric('variants', variants.length);
    ctx.metric('lowStock', low.length);
    ctx.metric('outOfStock', outIds.length);

    if (low.length) {
      ctx.propose({
        severity: 'MEDIUM',
        titleKey: 'stock.low',
        params: { count: low.length },
        title: `${low.length} variant(s) are running low`,
        details: { items: top(low, 50) },
        fingerprint: 'low',
      });
    }

    // Out of stock but still in carts → lost demand.
    if (outIds.length) {
      const demand = await ctx.db.cartItem.groupBy({
        by: ['variantId'],
        where: { variantId: { in: outIds } },
        _sum: { qty: true },
        _count: { _all: true },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));
      for (const d of demand) {
        const v = byId.get(d.variantId);
        if (!v) continue;
        ctx.propose({
          severity: (d._count._all ?? 0) >= 5 ? 'HIGH' : 'MEDIUM',
          titleKey: 'stock.outWithDemand',
          params: { sku: v.sku, carts: d._count._all },
          title: `${v.sku} is out of stock but in ${d._count._all} cart(s)`,
          details: { variantId: v.id, sku: v.sku, product: nameOf(v.product.name), carts: d._count._all, qtyWanted: d._sum.qty ?? 0 },
          fingerprint: `out-demand:${v.id}`,
        });
      }
    }

    const stale = await ctx.db.stockReservation.aggregate({
      where: { status: 'ACTIVE', expiresAt: { lt: ctx.now } },
      _count: { _all: true },
      _sum: { qty: true },
      _min: { expiresAt: true },
    });
    const staleCount = stale._count._all;
    ctx.metric('staleReservations', staleCount);
    if (staleCount > 0) {
      ctx.propose({
        severity: staleCount > 20 ? 'HIGH' : 'MEDIUM',
        titleKey: 'stock.staleReservations',
        params: { count: staleCount },
        title: `${staleCount} expired reservation(s) still hold stock`,
        details: { reservations: staleCount, units: stale._sum.qty ?? 0, oldestExpiry: stale._min.expiresAt?.toISOString() ?? null },
        action: { type: 'reservations.releaseExpired', params: {} },
        fingerprint: 'stale-reservations',
      });
    }
  },
});
