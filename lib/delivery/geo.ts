import { prisma } from '../db';
import type { LocalizedText } from '../localized';

/** Governorates → wilayas (seeded reference data: 11 governorates, 61 wilayas). */
export type WilayaOption = { id: string; slug: string; name: LocalizedText };
export type GovernorateOption = { id: string; code: string; name: LocalizedText; wilayas: WilayaOption[] };

export async function getGovernorateOptions(): Promise<GovernorateOption[]> {
  const rows = await prisma.governorate.findMany({
    orderBy: { sort: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      wilayas: { orderBy: { sort: 'asc' }, select: { id: true, slug: true, name: true } },
    },
  });
  return rows.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name as LocalizedText,
    wilayas: g.wilayas.map((w) => ({ id: w.id, slug: w.slug, name: w.name as LocalizedText })),
  }));
}
