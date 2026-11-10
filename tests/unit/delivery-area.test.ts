/**
 * Delivery area facts shown by the storefront (doom_test): what a governorate's configured zone
 * promises, and nothing when it is not configured (SPEC: promised times must match configuration).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getAreaInfo } from '@/lib/delivery/area';

const created: string[] = [];
const letters = () => Array.from({ length: 2 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

async function governorate(zone: null | { standardFeeBaisa: number | null; expressFeeBaisa: number | null; expressAvailable: boolean; dailyCapacityExpress: number | null; standardHours?: number; expressHours?: number; isActive?: boolean }) {
  // Real governorates use two-letter codes; "Q" + two letters never collides with them.
  const code = `Q${letters()}`;
  const gov = await prisma.governorate.create({ data: { code, name: { ar: 'محافظة اختبار', en: 'Test area', fr: 'Zone test' }, sort: 950 } });
  created.push(gov.id);
  if (zone) {
    await prisma.deliveryZone.create({ data: { governorateId: gov.id, wilayaSlugs: [], name: { ar: 'منطقة اختبار', en: 'Test zone', fr: 'Zone test' }, sort: 950, ...zone } });
  }
  return gov;
}

afterAll(async () => {
  await prisma.deliveryZone.deleteMany({ where: { governorateId: { in: created } } });
  await prisma.governorate.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe('getAreaInfo', () => {
  it('rejects malformed codes without touching the database', async () => {
    expect(await getAreaInfo('ma')).toBeNull();
    expect(await getAreaInfo("MA'; --")).toBeNull();
    expect(await getAreaInfo('')).toBeNull();
  });

  it('returns the configured promises of the area', async () => {
    const gov = await governorate({ standardFeeBaisa: 1500, expressFeeBaisa: 1000, expressAvailable: true, dailyCapacityExpress: 20, standardHours: 24, expressHours: 6 });
    const info = await getAreaInfo(gov.code);
    expect(info).toMatchObject({
      governorateId: gov.id,
      code: gov.code,
      standard: { configured: true, hours: 24, feeBaisa: 1500 },
      express: { configured: true, hours: 6, surchargeBaisa: 1000 },
    });
  });

  it('promises nothing when the standard fee is not configured', async () => {
    const gov = await governorate({ standardFeeBaisa: null, expressFeeBaisa: 1000, expressAvailable: true, dailyCapacityExpress: 20 });
    const info = await getAreaInfo(gov.code);
    expect(info?.standard.configured).toBe(false);
    expect(info?.express.configured).toBe(false);
  });

  it('does not promise express without availability, fee and daily capacity', async () => {
    for (const zone of [
      { standardFeeBaisa: 1500, expressFeeBaisa: 1000, expressAvailable: false, dailyCapacityExpress: 20 },
      { standardFeeBaisa: 1500, expressFeeBaisa: null, expressAvailable: true, dailyCapacityExpress: 20 },
      { standardFeeBaisa: 1500, expressFeeBaisa: 1000, expressAvailable: true, dailyCapacityExpress: null },
    ]) {
      const info = await getAreaInfo((await governorate(zone)).code);
      expect(info?.standard.configured).toBe(true);
      expect(info?.express.configured).toBe(false);
    }
  });

  it('treats an area without an active zone as not configured', async () => {
    const none = await getAreaInfo((await governorate(null)).code);
    expect(none?.standard.configured).toBe(false);
    const paused = await getAreaInfo((await governorate({ standardFeeBaisa: 1500, expressFeeBaisa: 1000, expressAvailable: true, dailyCapacityExpress: 20, isActive: false })).code);
    expect(paused?.standard.configured).toBe(false);
    expect(paused?.express.configured).toBe(false);
  });
});
