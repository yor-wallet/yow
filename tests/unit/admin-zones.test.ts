/**
 * Delivery zone rates against PostgreSQL (doom_test): RBAC, validation (express needs fee + capacity),
 * money parsing, audit of changed fields only, and the effect on what the storefront may promise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, ValidationError, type Actor } from '@/lib/admin/actor';
import { listAdminZones, updateZone } from '@/lib/admin/zones';
import { quoteDeliveryOptions } from '@/lib/delivery/quote';
import { cleanup, createDeliveryArea, createUser } from './shop/fixtures';

let logistics: Actor;
let catalog: Actor;

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  return { id: u.id, role };
}

const form = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  isActive: 'on',
  standardFeeBaisa: '1.500',
  standardHours: '24',
  freeStandardFromBaisa: '',
  dailyCapacityStandard: '',
  expressAvailable: 'on',
  expressFeeBaisa: '1',
  expressHours: '6',
  dailyCapacityExpress: '20',
  perKgBaisa: '',
  perLitreBaisa: '',
  ...over,
});

beforeAll(async () => {
  logistics = await staff('LOGISTICS');
  catalog = await staff('CATALOG');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('updateZone', () => {
  it('is refused without zones:write', async () => {
    const { zone } = await createDeliveryArea();
    for (const actor of [catalog, { id: 'x', role: 'CUSTOMER' as const }, null]) {
      await expect(updateZone(actor as Actor, form(zone.id))).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('stores OMR amounts as integer baisa and audits only the changed fields', async () => {
    const { zone } = await createDeliveryArea({ standardFeeBaisa: 1500, expressFeeBaisa: 2000 });
    await updateZone(logistics, form(zone.id, { standardFeeBaisa: '2.250', expressFeeBaisa: '1.000', freeStandardFromBaisa: '50', dailyCapacityExpress: '15' }));
    const row = await prisma.deliveryZone.findUniqueOrThrow({ where: { id: zone.id } });
    expect(row).toMatchObject({ standardFeeBaisa: 2250, expressFeeBaisa: 1000, freeStandardFromBaisa: 50_000, dailyCapacityExpress: 15, expressAvailable: true, isActive: true });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actorId: logistics.id, action: 'zone.update', entityId: zone.id } });
    expect(Object.keys(audit.after as object).sort()).toEqual(['dailyCapacityExpress', 'expressFeeBaisa', 'freeStandardFromBaisa', 'standardFeeBaisa']);

    // Saving the same values again changes nothing and writes no second audit row.
    await updateZone(logistics, form(zone.id, { standardFeeBaisa: '2.250', expressFeeBaisa: '1.000', freeStandardFromBaisa: '50', dailyCapacityExpress: '15' }));
    expect(await prisma.auditLog.count({ where: { actorId: logistics.id, entityId: zone.id } })).toBe(1);
  });

  it('refuses express without a standard fee, a surcharge and a daily capacity, or slower than standard', async () => {
    const { zone } = await createDeliveryArea();
    for (const [over, field] of [
      [{ standardFeeBaisa: '' }, 'standardFeeBaisa'],
      [{ expressFeeBaisa: '' }, 'expressFeeBaisa'],
      [{ dailyCapacityExpress: '' }, 'dailyCapacityExpress'],
      [{ expressHours: '48' }, 'expressHours'],
    ] as const) {
      const err = await updateZone(logistics, form(zone.id, over)).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(Object.keys((err as ValidationError).fieldErrors ?? {})).toContain(field);
    }
    await expect(updateZone(logistics, form(zone.id, { standardFeeBaisa: '-1' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(updateZone(logistics, form(zone.id, { standardHours: '0' }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('clearing the standard fee makes the zone unavailable to shoppers; setting it makes it quotable', async () => {
    const { zone, governorate } = await createDeliveryArea();
    const quote = () => quoteDeliveryOptions({ governorateId: governorate.id, weightGrams: 400, volumeCm3: 900, subtotalBaisa: 10_000, expressEligible: true });

    await updateZone(logistics, form(zone.id, { standardFeeBaisa: '', expressAvailable: '', expressFeeBaisa: '' }));
    const off = await quote();
    expect(off.STANDARD.available).toBe(false);
    expect(off.EXPRESS.available).toBe(false);

    await updateZone(logistics, form(zone.id, { standardFeeBaisa: '1.200', expressAvailable: '', expressFeeBaisa: '' }));
    const on = await quote();
    expect(on.STANDARD).toMatchObject({ available: true, feeBaisa: 1200 });
    expect(on.EXPRESS.available).toBe(false);
  });
});

describe('listAdminZones', () => {
  it('lists every zone with its raw configuration', async () => {
    const { zone } = await createDeliveryArea({ standardFeeBaisa: null });
    const row = (await listAdminZones()).find((z) => z.id === zone.id);
    expect(row).toMatchObject({ standardFeeBaisa: null, isActive: true, wilayaCount: 0 });
  });
});
