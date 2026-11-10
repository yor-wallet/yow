import 'server-only';
import { prisma } from '@/lib/db';
import { hydrateCards } from './listing';
import { loadLivePromotions } from './promotions-db';
import { specRows, type SpecRow } from './queries';
import type { ProductCardData } from './types';

/**
 * Product comparison (per signed-in user, up to MAX_COMPARE products). Everything shown comes from
 * the catalogue rows: a value that is not recorded is reported as missing, never filled in.
 */

export const MAX_COMPARE = 4;

export type ToggleCompareResult = { ok: true; compared: boolean; count: number } | { ok: false; error: 'not_found' | 'limit_reached' };

export async function toggleCompare(userId: string, productId: string): Promise<ToggleCompareResult> {
  const existing = await prisma.compareItem.findUnique({ where: { userId_productId: { userId, productId } }, select: { id: true } });
  if (existing) {
    await prisma.compareItem.deleteMany({ where: { userId, productId } });
    return { ok: true, compared: false, count: await prisma.compareItem.count({ where: { userId } }) };
  }
  const product = await prisma.product.findFirst({ where: { id: productId, status: 'ACTIVE' }, select: { id: true } });
  if (!product) return { ok: false, error: 'not_found' };
  if ((await prisma.compareItem.count({ where: { userId } })) >= MAX_COMPARE) return { ok: false, error: 'limit_reached' };
  // Concurrent double-taps hit the unique index: treat that as "already compared".
  await prisma.compareItem.createMany({ data: [{ userId, productId }], skipDuplicates: true });
  return { ok: true, compared: true, count: await prisma.compareItem.count({ where: { userId } }) };
}

export async function removeCompare(userId: string, productId: string): Promise<void> {
  await prisma.compareItem.deleteMany({ where: { userId, productId } });
}

export async function clearCompare(userId: string): Promise<void> {
  await prisma.compareItem.deleteMany({ where: { userId } });
}

export type CompareProduct = {
  card: ProductCardData;
  warrantyMonths: number | null;
  /** Distinct capacities / colours of the active variants (empty when the product has none). */
  capacities: string[];
  colors: string[];
  specs: SpecRow[];
};

/** The user's comparison, oldest first (only ACTIVE products). */
export async function listCompare(userId: string, locale: string): Promise<CompareProduct[]> {
  const rows = await prisma.compareItem.findMany({
    where: { userId, product: { status: 'ACTIVE' } },
    orderBy: { createdAt: 'asc' },
    take: MAX_COMPARE,
    select: {
      productId: true,
      product: { select: { warrantyMonths: true, specs: true, variants: { where: { isActive: true }, select: { capacity: true, color: true } } } },
    },
  });
  if (rows.length === 0) return [];
  const cards = await hydrateCards(
    rows.map((r) => r.productId),
    locale,
    await loadLivePromotions(),
  );
  const byId = new Map(cards.map((c) => [c.id, c]));
  const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))];
  return rows.flatMap((r) => {
    const card = byId.get(r.productId);
    if (!card) return [];
    return [
      {
        card,
        warrantyMonths: r.product.warrantyMonths,
        capacities: distinct(r.product.variants.map((v) => v.capacity)),
        colors: distinct(r.product.variants.map((v) => v.color)),
        specs: specRows(r.product.specs, locale),
      },
    ];
  });
}

/** Rows of the comparison table for the specifications: the union of labels, in first-seen order. */
export function specMatrix(products: readonly CompareProduct[]): { label: string; values: (string | null)[] }[] {
  const labels: string[] = [];
  for (const p of products) for (const s of p.specs) if (!labels.includes(s.label)) labels.push(s.label);
  return labels.map((label) => ({ label, values: products.map((p) => p.specs.find((s) => s.label === label)?.value ?? null) }));
}
