'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { addToCart, getCartCount, removeCartItem, removeUnavailableItems, updateCartItem } from '@/lib/cart';
import { getSession } from '@/lib/auth';
import { toggleFavorite } from '@/lib/catalog/favorites';
import { clearCompare, removeCompare, toggleCompare } from '@/lib/catalog/compare';
import { submitReview, type ReviewInput } from '@/lib/catalog/reviews';
import { getLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { MAX_QTY_PER_LINE } from '@/lib/catalog/stock';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestMeta } from '@/lib/request';
import { idSchema } from '@/lib/validation';

/**
 * Storefront server actions (cart + favourites). First-party UI mutations: Next.js
 * enforces the Origin check on actions. Every result is a plain serialisable object;
 * error codes are translated by the caller (`catalog.errors.*`).
 */

export type CartActionError = 'not_found' | 'unavailable' | 'out_of_stock' | 'invalid_qty' | 'rate_limited' | 'generic';
export type CartActionResult = { ok: true; count: number } | { ok: false; error: CartActionError };

const qtySchema = z.number().int().min(0).max(MAX_QTY_PER_LINE);

/** Cart writes create rows for anonymous visitors: cap them per IP (generous for real shoppers). */
async function allowed(): Promise<boolean> {
  const { ip } = await getRequestMeta();
  if (!ip) return true;
  return (await rateLimit(`cart:ip:${ip}`, 120, 60_000)).ok;
}

function refresh() {
  // Header cart count, bottom nav badge and cart page all read the cart on the server.
  revalidatePath('/', 'layout');
}

export async function addToCartAction(variantId: string, qty: number): Promise<CartActionResult> {
  const id = idSchema.safeParse(variantId);
  const q = qtySchema.safeParse(qty);
  if (!id.success || !q.success || q.data < 1) return { ok: false, error: 'invalid_qty' };
  try {
    if (!(await allowed())) return { ok: false, error: 'rate_limited' };
    const res = await addToCart(id.data, q.data);
    if (!res.ok) return { ok: false, error: res.error };
    refresh();
    return { ok: true, count: await getCartCount() };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[cart] add failed', err);
    return { ok: false, error: 'generic' };
  }
}

export async function updateCartItemAction(itemId: string, qty: number): Promise<CartActionResult> {
  const id = idSchema.safeParse(itemId);
  const q = qtySchema.safeParse(qty);
  if (!id.success || !q.success || q.data < 1) return { ok: false, error: 'invalid_qty' };
  try {
    if (!(await allowed())) return { ok: false, error: 'rate_limited' };
    const res = await updateCartItem(id.data, q.data);
    if (!res.ok) return { ok: false, error: res.error };
    refresh();
    return { ok: true, count: await getCartCount() };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[cart] update failed', err);
    return { ok: false, error: 'generic' };
  }
}

export async function removeCartItemAction(itemId: string): Promise<CartActionResult> {
  const id = idSchema.safeParse(itemId);
  if (!id.success) return { ok: false, error: 'not_found' };
  try {
    if (!(await allowed())) return { ok: false, error: 'rate_limited' };
    await removeCartItem(id.data);
    refresh();
    return { ok: true, count: await getCartCount() };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[cart] remove failed', err);
    return { ok: false, error: 'generic' };
  }
}

export type PruneResult = { ok: true; removed: number; count: number } | { ok: false; error: CartActionError };

/** Removes every line that is out of stock or no longer sold. */
export async function removeUnavailableItemsAction(): Promise<PruneResult> {
  try {
    if (!(await allowed())) return { ok: false, error: 'rate_limited' };
    const removed = await removeUnavailableItems();
    refresh();
    return { ok: true, removed, count: await getCartCount() };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[cart] prune failed', err);
    return { ok: false, error: 'generic' };
  }
}

export type FavoriteActionResult =
  | { ok: true; favorited: boolean }
  | { ok: false; error: 'signInRequired' | 'not_found' | 'limit_reached' | 'invalid' | 'generic' };

export async function toggleFavoriteAction(productId: string): Promise<FavoriteActionResult> {
  const id = idSchema.safeParse(productId);
  if (!id.success) return { ok: false, error: 'invalid' };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: 'signInRequired' };
    const res = await toggleFavorite(session.user.id, id.data);
    if (!res.ok) return { ok: false, error: res.error };
    revalidatePath('/[locale]/favorites', 'page');
    return { ok: true, favorited: res.favorited };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[favorites] toggle failed', err);
    return { ok: false, error: 'generic' };
  }
}

export type ReviewActionResult = { ok: true } | { ok: false; error: 'signInRequired' | 'invalid' | 'not_eligible' | 'rate_limited' | 'generic' };

/** Verified buyers only; the review is stored pending moderation (never published automatically). */
export async function submitReviewAction(productId: string, input: ReviewInput): Promise<ReviewActionResult> {
  const id = idSchema.safeParse(productId);
  if (!id.success) return { ok: false, error: 'invalid' };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: 'signInRequired' };
    if (!(await rateLimit(`review:user:${session.user.id}`, 5, 60 * 60_000)).ok) return { ok: false, error: 'rate_limited' };
    const res = await submitReview(session.user.id, id.data, input, asLocale(await getLocale()));
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[reviews] submit failed', err);
    return { ok: false, error: 'generic' };
  }
}

export type CompareActionResult =
  | { ok: true; compared: boolean; count: number }
  | { ok: false; error: 'signInRequired' | 'not_found' | 'limit_reached' | 'invalid' | 'generic' };

export async function toggleCompareAction(productId: string): Promise<CompareActionResult> {
  const id = idSchema.safeParse(productId);
  if (!id.success) return { ok: false, error: 'invalid' };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: 'signInRequired' };
    const res = await toggleCompare(session.user.id, id.data);
    if (!res.ok) return { ok: false, error: res.error };
    revalidatePath('/[locale]/compare', 'page');
    return res;
  } catch (err) {
    unstable_rethrow(err);
    console.error('[compare] toggle failed', err);
    return { ok: false, error: 'generic' };
  }
}

/** Remove one product from the comparison (`productId`) or empty it (`null`). */
export async function removeCompareAction(productId: string | null): Promise<{ ok: boolean }> {
  try {
    const session = await getSession();
    if (!session) return { ok: false };
    if (productId === null) await clearCompare(session.user.id);
    else {
      const id = idSchema.safeParse(productId);
      if (!id.success) return { ok: false };
      await removeCompare(session.user.id, id.data);
    }
    revalidatePath('/[locale]/compare', 'page');
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[compare] remove failed', err);
    return { ok: false };
  }
}
