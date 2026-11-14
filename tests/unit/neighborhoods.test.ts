/**
 * Address reference data: governorate → wilaya → neighbourhood (Arabic + English), and the address
 * book using it. Runs against the seeded doom_test database; everything created is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createAddress, neighborhoodLabel, updateAddress } from '@/lib/delivery/addresses';
import { getGovernorateOptions } from '@/lib/delivery/geo';
import { GOVERNORATES } from '@/prisma/seed-data';
import { NEIGHBORHOODS } from '@/prisma/neighborhoods';
import { cleanup, createUser } from './shop/fixtures';

const ARABIC = /[؀-ۿ]/;
let userId: string;
let seeb: { id: string; governorateId: string };
let bawshar: { id: string };
let mabelah: { id: string };

beforeAll(async () => {
  // Same upsert as prisma/seed.ts (seedNeighborhoods), so the test also runs on a database seeded before the lists.
  for (const [wilayaSlug, list] of Object.entries(NEIGHBORHOODS)) {
    const wilaya = await prisma.wilaya.findUnique({ where: { slug: wilayaSlug }, select: { id: true } });
    if (!wilaya) continue;
    for (const [i, n] of list.entries()) {
      const name = { ar: n.ar, en: n.en, fr: n.en };
      await prisma.neighborhood.upsert({
        where: { wilayaId_slug: { wilayaId: wilaya.id, slug: n.slug } },
        update: { name, sort: i },
        create: { wilayaId: wilaya.id, slug: n.slug, name, sort: i },
      });
    }
  }
  userId = (await createUser()).id;
  seeb = await prisma.wilaya.findUniqueOrThrow({ where: { slug: 'ma-as-seeb' }, select: { id: true, governorateId: true } });
  bawshar = await prisma.wilaya.findUniqueOrThrow({ where: { slug: 'ma-bawshar' }, select: { id: true } });
  mabelah = await prisma.neighborhood.findUniqueOrThrow({ where: { wilayaId_slug: { wilayaId: seeb.id, slug: 'al-mabelah-south' } }, select: { id: true } });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('neighbourhood reference data', () => {
  it('every list belongs to a real wilaya, with unique slugs and names in Arabic and English', () => {
    const wilayaSlugs = new Set(GOVERNORATES.flatMap((g) => g.wilayas.map((w) => `${g.code.toLowerCase()}-${w.slug}`)));
    for (const [wilaya, list] of Object.entries(NEIGHBORHOODS)) {
      expect(wilayaSlugs.has(wilaya), wilaya).toBe(true);
      expect(list.length, wilaya).toBeGreaterThan(3);
      expect(new Set(list.map((n) => n.slug)).size, wilaya).toBe(list.length);
      for (const n of list) {
        expect(n.ar, n.slug).toMatch(ARABIC);
        expect(n.en, n.slug).toMatch(/^[A-Z][A-Za-z' -]+$/);
      }
    }
    // The six wilayas of Muscat all have a list.
    expect(Object.keys(NEIGHBORHOODS).filter((k) => k.startsWith('ma-'))).toHaveLength(6);
  });

  it('reaches the address form as governorate → wilaya → neighbourhood', async () => {
    const muscat = (await getGovernorateOptions()).find((g) => g.code === 'MA')!;
    const asSeeb = muscat.wilayas.find((w) => w.slug === 'ma-as-seeb')!;
    expect(asSeeb.neighborhoods.map((n) => n.slug)).toContain('al-mabelah-south');
    expect(asSeeb.neighborhoods[0]!.name).toMatchObject({ ar: expect.stringMatching(ARABIC), en: expect.any(String) });
    // A wilaya without a list keeps the free-text area.
    const withoutList = muscat.wilayas.length === 6 ? null : muscat.wilayas.find((w) => w.neighborhoods.length === 0);
    if (withoutList) expect(withoutList.neighborhoods).toEqual([]);
  });

  it('labels a neighbourhood in both languages, without repeating identical names', () => {
    expect(neighborhoodLabel({ ar: 'المعبيلة الجنوبية', en: 'Al Mabelah South' })).toBe('المعبيلة الجنوبية · Al Mabelah South');
    expect(neighborhoodLabel({ ar: 'غلا', en: 'غلا' })).toBe('غلا');
    expect(neighborhoodLabel(null)).toBe('');
  });
});

describe('address book with a neighbourhood', () => {
  const base = { recipientName: 'Neighbourhood Tester', phone: '91234567', building: 'Villa 12' };

  it('stores the chosen neighbourhood and writes the official names into the area, whatever the client sent', async () => {
    const a = await createAddress(userId, { ...base, governorateId: seeb.governorateId, wilayaId: seeb.id, neighborhoodId: mabelah.id, area: 'anything' });
    expect(a.neighborhoodId).toBe(mabelah.id);
    expect(a.area).toBe('المعبيلة الجنوبية · Al Mabelah South');
  });

  it('refuses a neighbourhood of another wilaya', async () => {
    await expect(
      createAddress(userId, { ...base, governorateId: seeb.governorateId, wilayaId: bawshar.id, neighborhoodId: mabelah.id, area: 'x x' }),
    ).rejects.toMatchObject({ code: 'neighborhood_mismatch' });
  });

  it('still accepts a typed area ("Other"), and clears the neighbourhood when the customer switches to it', async () => {
    const a = await createAddress(userId, { ...base, governorateId: seeb.governorateId, wilayaId: seeb.id, neighborhoodId: mabelah.id, area: 'x x' });
    const typed = await updateAddress(userId, a.id, { ...base, governorateId: seeb.governorateId, wilayaId: seeb.id, area: 'Al Khoud Street 18' });
    expect(typed.neighborhoodId).toBeNull();
    expect(typed.area).toBe('Al Khoud Street 18');
  });
});
