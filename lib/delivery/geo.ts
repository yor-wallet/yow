import { prisma } from '../db';
import type { LocalizedText } from '../localized';

/** Governorates → wilayas (seeded reference data: 11 governorates, 61 wilayas). */
export type NeighborhoodOption = { id: string; slug: string; name: LocalizedText };
/** `neighborhoods` is empty for wilayas without a list: the address form then keeps the free-text area. */
export type WilayaOption = { id: string; slug: string; name: LocalizedText; neighborhoods: NeighborhoodOption[] };
export type GovernorateOption = { id: string; code: string; name: LocalizedText; wilayas: WilayaOption[] };

export async function getGovernorateOptions(): Promise<GovernorateOption[]> {
  const rows = await prisma.governorate.findMany({
    orderBy: { sort: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      wilayas: {
        orderBy: { sort: 'asc' },
        select: { id: true, slug: true, name: true, neighborhoods: { orderBy: { sort: 'asc' }, select: { id: true, slug: true, name: true } } },
      },
    },
  });
  return rows.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name as LocalizedText,
    wilayas: g.wilayas.map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name as LocalizedText,
      neighborhoods: w.neighborhoods.map((n) => ({ id: n.id, slug: n.slug, name: n.name as LocalizedText })),
    })),
  }));
}
