import 'server-only';
import { prisma } from '@/lib/db';
import { hydrateCards } from './listing';
import { loadLivePromotions } from './promotions-db';
import type { ProductCardData } from './types';

/**
 * Favourites (wishlist). Stored per user; products that stop being ACTIVE simply
 * disappear from the list (they are filtered at read time, the row is kept).
 */

export const MAX_FAVORITES = 200;

/** Which of `productIds` the user has favourited (empty for visitors). */
export async function favoriteIdsFor(userId: string | null | undefined, productIds: readonly string[]): Promise<Set<string>> {
  if (!userId || productIds.length === 0) return new Set();
  const rows = await prisma.favorite.findMany({
    where: { userId, productId: { in: [...productIds] } },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

export type ToggleFavoriteResult = { ok: true; favorited: boolean } | { ok: false; error: 'not_found' | 'limit_reached' };

/** Adds the product to the user's favourites, or removes it when it is already there. */
export async function toggleFavorite(userId: string, productId: string): Promise<ToggleFavoriteResult> {
  const existing = await prisma.favorite.findUnique({ where: { userId_productId: { userId, productId } }, select: { id: true } });
  if (existing) {
    await prisma.favorite.deleteMany({ where: { userId, productId } });
    return { ok: true, favorited: false };
  }
  const product = await prisma.product.findFirst({ where: { id: productId, status: 'ACTIVE' }, select: { id: true } });
  if (!product) return { ok: false, error: 'not_found' };
  if ((await prisma.favorite.count({ where: { userId } })) >= MAX_FAVORITES) return { ok: false, error: 'limit_reached' };
  // Concurrent double-taps hit the unique index: treat that as "already favourited".
  await prisma.favorite.createMany({ data: [{ userId, productId }], skipDuplicates: true });
  return { ok: true, favorited: true };
}

/** The user's favourites as product cards, newest first (only ACTIVE products). */
export async function listFavoriteCards(userId: string, locale: string): Promise<ProductCardData[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId, product: { status: 'ACTIVE' } },
    orderBy: { createdAt: 'desc' },
    take: MAX_FAVORITES,
    select: { productId: true },
  });
  if (rows.length === 0) return [];
  const promotions = await loadLivePromotions();
  const cards = await hydrateCards(
    rows.map((r) => r.productId),
    locale,
    promotions,
  );
  const order = new Map(rows.map((r, i) => [r.productId, i]));
  return cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
