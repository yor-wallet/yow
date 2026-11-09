import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, HOUR, muscatDayStart, top } from '../util';

const OPEN_STATUSES = ['CONFIRMED', 'PREPARING', 'PACKED', 'COURIER_ASSIGNED', 'OUT_FOR_DELIVERY'] as const;

function governorateOf(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const g = (snapshot as Record<string, unknown>).governorateId;
  return typeof g === 'string' ? g : null;
}

/**
 * 11 · Delivery — late shipments vs the promised ETA, EXPRESS capacity saturation per
 * governorate (today's express shipments vs `dailyCapacityExpress`), failed deliveries
 * over 7 days and incidents left open for more than 48h.
 */
export default defineAgent({
  key: 'delivery',
  number: 11,
  nameKey: 'delivery',
  scopes: ['shipment', 'order', 'deliveryZone', 'deliveryIncident'],
  schedule: { everyMinutes: AGENT_INTERVALS.delivery },
  async run(ctx) {
    const now = ctx.now;
    const late = await ctx.db.shipment.findMany({
      where: { status: { in: [...OPEN_STATUSES] }, promisedBy: { lt: now } },
      select: { id: true, trackingCode: true, status: true, deliveryType: true, promisedBy: true, courierId: true, order: { select: { number: true } } },
      orderBy: { promisedBy: 'asc' },
      take: 500,
    });
    ctx.metric('late', late.length);
    if (late.length) {
      const express = late.filter((s) => s.deliveryType === 'EXPRESS').length;
      ctx.propose({
        severity: express > 0 || late.length > 10 ? 'HIGH' : 'MEDIUM',
        titleKey: 'delivery.late',
        params: { count: late.length, express },
        title: `${late.length} shipment(s) past their promised time (${express} express)`,
        details: {
          items: top(
            late.map((s) => ({
              shipmentId: s.id,
              trackingCode: s.trackingCode,
              order: s.order.number,
              status: s.status,
              deliveryType: s.deliveryType,
              lateMinutes: s.promisedBy ? Math.round((now.getTime() - s.promisedBy.getTime()) / 60_000) : null,
              courierAssigned: !!s.courierId,
            })),
            50,
          ),
        },
        fingerprint: 'late',
      });
    }

    // Express capacity saturation today, per governorate.
    const today = muscatDayStart(now);
    const [zones, todays] = await Promise.all([
      ctx.db.deliveryZone.findMany({
        where: { isActive: true, expressAvailable: true, dailyCapacityExpress: { not: null } },
        select: { id: true, governorateId: true, dailyCapacityExpress: true, name: true },
      }),
      ctx.db.shipment.findMany({
        where: { deliveryType: 'EXPRESS', createdAt: { gte: today } },
        select: { order: { select: { addressSnapshot: true } } },
        take: 20_000,
      }),
    ]);
    const used = new Map<string, number>();
    for (const s of todays) {
      const g = governorateOf(s.order.addressSnapshot);
      if (g) used.set(g, (used.get(g) ?? 0) + 1);
    }
    const capacityByGov = new Map<string, number>();
    for (const z of zones) capacityByGov.set(z.governorateId, (capacityByGov.get(z.governorateId) ?? 0) + (z.dailyCapacityExpress ?? 0));
    const saturated = [...capacityByGov.entries()]
      .map(([gov, cap]) => ({ governorateId: gov, capacity: cap, used: used.get(gov) ?? 0 }))
      .filter((x) => x.capacity > 0 && x.used / x.capacity >= 0.9);
    ctx.metric('expressToday', todays.length);
    if (saturated.length) {
      ctx.propose({
        severity: saturated.some((s) => s.used >= s.capacity) ? 'HIGH' : 'MEDIUM',
        titleKey: 'delivery.expressSaturation',
        params: { count: saturated.length },
        title: `Express capacity ≥ 90% in ${saturated.length} governorate(s) today`,
        details: { items: saturated },
        fingerprint: `express-saturation:${today.toISOString().slice(0, 10)}`,
      });
    }

    const failed = await ctx.db.shipment.findMany({
      where: { status: 'FAILED', updatedAt: { gte: ago(now, 7 * DAY) } },
      select: { id: true, trackingCode: true, failedReason: true, updatedAt: true },
      take: 200,
    });
    ctx.metric('failed7d', failed.length);
    if (failed.length) {
      ctx.propose({
        severity: failed.length >= 5 ? 'HIGH' : 'MEDIUM',
        titleKey: 'delivery.failed',
        params: { count: failed.length },
        title: `${failed.length} failed deliver(ies) in 7 days`,
        details: { items: top(failed.map((f) => ({ shipmentId: f.id, trackingCode: f.trackingCode, reason: f.failedReason, at: f.updatedAt.toISOString() }))) },
        fingerprint: 'failed',
      });
    }

    const oldIncidents = await ctx.db.deliveryIncident.count({ where: { status: 'OPEN', createdAt: { lt: ago(now, 48 * HOUR) } } });
    ctx.metric('incidentsOpenOver48h', oldIncidents);
    if (oldIncidents) {
      ctx.propose({
        severity: 'MEDIUM',
        titleKey: 'delivery.staleIncidents',
        params: { count: oldIncidents },
        title: `${oldIncidents} delivery incident(s) open for more than 48h`,
        details: { count: oldIncidents },
        fingerprint: 'stale-incidents',
      });
    }
  },
});
