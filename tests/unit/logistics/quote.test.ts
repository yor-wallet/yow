/**
 * DOOM EXPRESS quote engine. Pure computation + DB-backed resolution/capacity, the latter
 * inside transactions that are ROLLED BACK (the shared doom_test seed is never modified).
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { aggregateParcel, computeQuote, quoteDelivery, volumetricWeightGrams, type ZoneConfig } from '@/lib/delivery/quote';
import { DELIVERY_SETTING_KEYS, getDeliverySettings, parseIntSetting } from '@/lib/delivery/settings';
import { muscatHour, startOfMuscatDay } from '@/lib/delivery/time';

const zone = (over: Partial<ZoneConfig> = {}): ZoneConfig => ({
  id: 'zone-test',
  isActive: true,
  standardFeeBaisa: 1_500,
  expressFeeBaisa: 2_000,
  expressAvailable: true,
  standardHours: 24,
  expressHours: 6,
  perKgBaisa: null,
  perLitreBaisa: null,
  freeStandardFromBaisa: null,
  dailyCapacityStandard: null,
  dailyCapacityExpress: 10,
  ...over,
});
// 2026-11-10 10:00 Muscat (06:00 UTC)
const MORNING = new Date('2026-11-10T06:00:00Z');
const ctx = (over: Partial<{ usedToday: number; cutoff: number | null; included: number; now: Date }> = {}) => ({
  now: over.now ?? MORNING,
  usedToday: over.usedToday ?? 0,
  settings: { expressCutoffHour: over.cutoff ?? null, includedWeightGrams: over.included ?? 0 },
});

describe('computeQuote — never invents a fee', () => {
  it('is unavailable when the zone has no fee configured', () => {
    const q = computeQuote(zone({ standardFeeBaisa: null, expressFeeBaisa: null }), { type: 'STANDARD', weightGrams: 500 }, ctx());
    expect(q).toMatchObject({ available: false, reason: 'not_configured' });
    expect(q.feeBaisa).toBeUndefined();
    const e = computeQuote(zone({ expressFeeBaisa: null }), { type: 'EXPRESS', weightGrams: 500 }, ctx());
    expect(e).toMatchObject({ available: false, reason: 'not_configured' });
  });

  it('is unavailable without a zone, for an inactive zone and for invalid parcels', () => {
    expect(computeQuote(null, { type: 'STANDARD' }, ctx()).reason).toBe('zone_not_found');
    expect(computeQuote(zone({ isActive: false }), { type: 'STANDARD' }, ctx()).reason).toBe('zone_inactive');
    expect(computeQuote(zone(), { type: 'STANDARD', weightGrams: -1 }, ctx()).reason).toBe('invalid_input');
    expect(computeQuote(zone(), { type: 'STANDARD', subtotalBaisa: 1.5 }, ctx()).reason).toBe('invalid_input');
  });

  it('never guesses a weight when a per-kg rate is configured', () => {
    expect(computeQuote(zone({ perKgBaisa: 300 }), { type: 'STANDARD' }, ctx()).reason).toBe('parcel_unknown');
    expect(computeQuote(zone({ perLitreBaisa: 50 }), { type: 'STANDARD', weightGrams: 100 }, ctx()).reason).toBe('parcel_unknown');
  });

  it('charges the base fee and promises exactly the configured hours', () => {
    const q = computeQuote(zone(), { type: 'STANDARD', weightGrams: 400 }, ctx());
    expect(q).toMatchObject({ available: true, feeBaisa: 1_500, etaHours: 24, zoneId: 'zone-test' });
    expect(q.promisedBy?.getTime()).toBe(MORNING.getTime() + 24 * 3600_000);
    expect(Number.isInteger(q.feeBaisa)).toBe(true);
  });
});

describe('computeQuote — weight & volume', () => {
  it('computes volumetric weight as volume / 5000 (kg)', () => {
    expect(volumetricWeightGrams(5_000)).toBe(1_000);
    expect(volumetricWeightGrams(30_000)).toBe(6_000);
    expect(volumetricWeightGrams(1)).toBe(1); // rounded up
  });

  it('bills the greater of actual and volumetric weight, per started kg beyond the included weight', () => {
    // actual 2 kg, volumetric 6 kg → 6 kg chargeable; 1 kg included → 5 started kg × 0.300
    const q = computeQuote(zone({ perKgBaisa: 300 }), { type: 'STANDARD', weightGrams: 2_000, volumeCm3: 30_000 }, ctx({ included: 1_000 }));
    expect(q.breakdown).toMatchObject({ chargeableWeightGrams: 6_000, weightBaisa: 1_500, baseBaisa: 1_500 });
    expect(q.feeBaisa).toBe(3_000);
    // heavy & small: actual wins; 2.1 kg over → 3 started kg
    const heavy = computeQuote(zone({ perKgBaisa: 300 }), { type: 'STANDARD', weightGrams: 3_100, volumeCm3: 1_000 }, ctx({ included: 1_000 }));
    expect(heavy.breakdown?.chargeableWeightGrams).toBe(3_100);
    expect(heavy.feeBaisa).toBe(1_500 + 3 * 300);
    // within the included weight: base fee only
    expect(computeQuote(zone({ perKgBaisa: 300 }), { type: 'STANDARD', weightGrams: 900 }, ctx({ included: 1_000 })).feeBaisa).toBe(1_500);
  });

  it('adds the optional per-litre bulky surcharge', () => {
    const q = computeQuote(zone({ perLitreBaisa: 100 }), { type: 'STANDARD', weightGrams: 100, volumeCm3: 2_500 }, ctx());
    expect(q.breakdown?.volumeBaisa).toBe(300); // 3 started litres
    expect(q.feeBaisa).toBe(1_800);
  });

  it('applies the free-standard threshold to STANDARD only', () => {
    const z = zone({ freeStandardFromBaisa: 100_000, perKgBaisa: 300 });
    expect(computeQuote(z, { type: 'STANDARD', weightGrams: 5_000, subtotalBaisa: 100_000 }, ctx()).feeBaisa).toBe(0);
    expect(computeQuote(z, { type: 'STANDARD', weightGrams: 5_000, subtotalBaisa: 99_999 }, ctx()).feeBaisa).toBe(1_500 + 5 * 300);
    expect(computeQuote(z, { type: 'EXPRESS', weightGrams: 5_000, subtotalBaisa: 500_000 }, ctx()).feeBaisa).toBe(1_500 + 5 * 300 + 2_000);
  });

  it('aggregates cart lines and refuses to guess unknown weights', () => {
    expect(aggregateParcel([{ weightGrams: 400, volumeCm3: 1_200, qty: 2 }, { weightGrams: 100, volumeCm3: 300, qty: 1 }])).toEqual({ weightGrams: 900, volumeCm3: 2_700 });
    expect(aggregateParcel([{ weightGrams: 400, volumeCm3: null, qty: 1 }])).toEqual({ weightGrams: 400, volumeCm3: null });
    expect(aggregateParcel([{ weightGrams: undefined, volumeCm3: 10, qty: 1 }]).weightGrams).toBeNull();
    expect(aggregateParcel([])).toEqual({ weightGrams: null, volumeCm3: null });
  });
});

describe('computeQuote — EXPRESS capacity and cut-off', () => {
  it('adds the express surcharge and promises the express hours', () => {
    const q = computeQuote(zone(), { type: 'EXPRESS', weightGrams: 400 }, ctx({ usedToday: 3 }));
    expect(q).toMatchObject({ available: true, feeBaisa: 3_500, etaHours: 6, remainingToday: 7 });
    expect(q.breakdown?.expressBaisa).toBe(2_000);
  });

  it('is unavailable when not offered, not eligible, capacity unset or full', () => {
    expect(computeQuote(zone({ expressAvailable: false }), { type: 'EXPRESS' }, ctx()).reason).toBe('express_not_offered');
    expect(computeQuote(zone(), { type: 'EXPRESS', expressEligible: false }, ctx()).reason).toBe('not_express_eligible');
    expect(computeQuote(zone({ dailyCapacityExpress: null }), { type: 'EXPRESS' }, ctx()).reason).toBe('capacity_not_configured');
    expect(computeQuote(zone(), { type: 'EXPRESS' }, ctx({ usedToday: 10 })).reason).toBe('capacity_full');
    expect(computeQuote(zone(), { type: 'EXPRESS' }, ctx({ usedToday: 9 })).available).toBe(true);
  });

  it('closes express at the cut-off hour (Muscat time)', () => {
    const at14 = new Date('2026-11-10T10:00:00Z'); // 14:00 Muscat
    expect(muscatHour(at14)).toBe(14);
    expect(computeQuote(zone(), { type: 'EXPRESS' }, ctx({ now: at14, cutoff: 14 })).reason).toBe('after_cutoff');
    expect(computeQuote(zone(), { type: 'EXPRESS' }, ctx({ now: at14, cutoff: 15 })).available).toBe(true);
    // the cut-off never affects STANDARD
    expect(computeQuote(zone(), { type: 'STANDARD' }, ctx({ now: at14, cutoff: 14 })).available).toBe(true);
  });

  it('applies the standard capacity when configured', () => {
    expect(computeQuote(zone({ dailyCapacityStandard: 2 }), { type: 'STANDARD' }, ctx({ usedToday: 2 })).reason).toBe('capacity_full');
    expect(computeQuote(zone({ dailyCapacityStandard: 2 }), { type: 'STANDARD' }, ctx({ usedToday: 1 })).remainingToday).toBe(1);
  });
});

describe('settings & time helpers', () => {
  it('parses integer settings defensively', () => {
    expect(parseIntSetting(14, 0, 23)).toBe(14);
    expect(parseIntSetting('9', 0, 23)).toBe(9);
    expect(parseIntSetting({ value: 20 }, 0, 23)).toBe(20);
    expect(parseIntSetting({ hour: 7 }, 0, 23)).toBe(7);
    expect(parseIntSetting(24, 0, 23)).toBeNull();
    expect(parseIntSetting('abc', 0, 23)).toBeNull();
    expect(parseIntSetting(1.5, 0, 23)).toBeNull();
    expect(parseIntSetting(null, 0, 23)).toBeNull();
  });

  it('computes the Muscat day start (UTC+4)', () => {
    expect(startOfMuscatDay(new Date('2026-11-10T19:30:00Z')).toISOString()).toBe('2026-11-09T20:00:00.000Z');
    expect(startOfMuscatDay(new Date('2026-11-10T20:30:00Z')).toISOString()).toBe('2026-11-10T20:00:00.000Z');
  });
});

// ───────────── DB-backed (rolled back) ─────────────

class Rollback extends Error {}
async function inRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  await prisma
    .$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('quoteDelivery (database)', () => {
  it('reports the seeded, fee-less zones as not configured', async () => {
    const gov = await prisma.governorate.findFirstOrThrow({ where: { code: 'DA' } });
    const q = await quoteDelivery({ governorateId: gov.id, type: 'STANDARD', weightGrams: 500 });
    expect(q.available).toBe(false);
    expect(['not_configured', 'zone_not_found']).toContain(q.reason);
  });

  it('resolves wilaya-specific zones first, applies settings and counts booked deliveries', async () => {
    await inRollback(async (tx) => {
      const gov = await tx.governorate.findFirstOrThrow({ where: { code: 'DA' }, include: { wilayas: { orderBy: { sort: 'asc' }, take: 2 } } });
      const [w1, w2] = gov.wilayas;
      const specific = await tx.deliveryZone.create({
        data: {
          governorateId: gov.id,
          wilayaSlugs: [w1!.slug],
          name: { ar: 'اختبار', en: 'TEST-logistics zone', fr: 'Zone test' },
          standardFeeBaisa: 2_000,
          expressFeeBaisa: 1_000,
          expressAvailable: true,
          perKgBaisa: 500,
          dailyCapacityExpress: 1,
        },
      });
      await tx.setting.upsert({
        where: { key: DELIVERY_SETTING_KEYS.includedWeightGrams },
        create: { key: DELIVERY_SETTING_KEYS.includedWeightGrams, value: 1_000 },
        update: { value: 1_000 },
      });
      await tx.setting.upsert({
        where: { key: DELIVERY_SETTING_KEYS.expressCutoffHour },
        create: { key: DELIVERY_SETTING_KEYS.expressCutoffHour, value: { value: 23 } },
        update: { value: { value: 23 } },
      });
      expect(await getDeliverySettings(tx)).toEqual({ expressCutoffHour: 23, includedWeightGrams: 1_000 });

      const at = new Date('2026-11-10T06:00:00Z');
      const q = await quoteDelivery({ wilayaId: w1!.id, type: 'STANDARD', weightGrams: 2_500, at }, tx);
      expect(q).toMatchObject({ available: true, zoneId: specific.id, feeBaisa: 2_000 + 2 * 500 });
      // another wilaya of the governorate falls back to the (unconfigured) governorate zone
      const other = await quoteDelivery({ wilayaId: w2!.id, type: 'STANDARD', weightGrams: 2_500, at }, tx);
      expect(other.zoneId).not.toBe(specific.id);
      expect(other.available).toBe(false);
      // a wilaya/governorate mismatch never resolves
      const wrongGov = await tx.governorate.findFirstOrThrow({ where: { code: 'MA' } });
      expect((await quoteDelivery({ wilayaId: w1!.id, governorateId: wrongGov.id, type: 'STANDARD' }, tx)).reason).toBe('zone_not_found');

      // express capacity 1: an unpaid order placed minutes ago for this wilaya holds the slot
      const user = await tx.user.create({
        data: { email: `test-logistics-q-${Date.now()}@test.doom.local`, fullName: 'Quote Tester', passwordHash: 'x' },
      });
      expect((await quoteDelivery({ wilayaId: w1!.id, type: 'EXPRESS', weightGrams: 500, at }, tx)).available).toBe(true);
      await tx.order.create({
        data: {
          number: `TEST-LG-Q-${Date.now()}`,
          userId: user.id,
          subtotalBaisa: 0,
          totalBaisa: 0,
          deliveryType: 'EXPRESS',
          addressSnapshot: { recipientName: 'Q', phone: '+96891234567', governorateId: gov.id, wilayaId: w1!.id, area: 'A', building: 'B' },
          idempotencyKey: `test-lg-q-${Date.now()}`,
          placedAt: new Date(at.getTime() - 5 * 60_000),
        },
      });
      expect((await quoteDelivery({ wilayaId: w1!.id, type: 'EXPRESS', weightGrams: 500, at }, tx)).reason).toBe('capacity_full');
      // …but it does not count against the governorate-wide zone (different zone)
      expect((await quoteDelivery({ wilayaId: w2!.id, type: 'EXPRESS', at }, tx)).reason).not.toBe('capacity_full');
    });
  });
});
