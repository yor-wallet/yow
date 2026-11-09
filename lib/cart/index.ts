import 'server-only';
import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { CART_COOKIE, secureCookies } from '@/lib/cookies';
import { randomToken, sha256Hex } from '@/lib/crypto';
import { loadLivePromotions, exhaustedPromotionsForUser } from '@/lib/catalog/promotions-db';
import { priceCart, priceItems, type PricedCartLine } from './pricing';
import type { CartTotals } from './math';
import {
  addItem,
  ANON_CART_TTL_DAYS,
  cartCount,
  cartItems,
  mergeAnonymousCart,
  pruneUnavailable,
  removeItem,
  setItemQty,
  type CartMutationResult,
  type CartOwner,
} from './store';

/**
 * Request-bound cart API (session + `doom_cart` cookie). Read helpers are safe in
 * server components; mutations (which may set the cookie) only in server actions or
 * route handlers.
 */

export { mergeAnonymousCart } from './store';
export type { CartOwner, CartMutationResult } from './store';

export type CartLineView = Omit<PricedCartLine, 'nameJson' | 'unitCostBaisa' | 'imageKey' | 'categoryId' | 'parentCategoryId' | 'brandId' | 'weightGrams' | 'volumeCm3'>;

export type CartView = {
  lines: CartLineView[];
  totals: CartTotals;
  promotion: { id: string; discountBaisa: number } | null;
  signedIn: boolean;
};

async function readToken(): Promise<string | null> {
  try {
    const v = (await cookies()).get(CART_COOKIE)?.value;
    return v && v.length >= 20 && v.length <= 128 ? v : null;
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/** Current owner without creating anything (null = visitor without a cart). */
export async function currentCartOwner(): Promise<CartOwner | null> {
  const session = await getSession();
  if (session) return { userId: session.user.id };
  const token = await readToken();
  return token ? { anonTokenHash: sha256Hex(token) } : null;
}

/** Owner for a mutation; creates the anonymous cart cookie when needed (actions/route handlers only). */
export async function ensureCartOwner(): Promise<CartOwner> {
  const existing = await currentCartOwner();
  if (existing) return existing;
  const token = randomToken(32);
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: ANON_CART_TTL_DAYS * 86_400,
  });
  return { anonTokenHash: sha256Hex(token) };
}

export function toLineView(l: PricedCartLine): CartLineView {
  const { nameJson: _n, unitCostBaisa: _c, imageKey: _i, categoryId: _ca, parentCategoryId: _p, brandId: _b, weightGrams: _w, volumeCm3: _v, ...rest } = l;
  return rest;
}

export async function getCartView(locale: string): Promise<CartView> {
  const session = await getSession();
  const owner = await currentCartOwner();
  const items = owner ? await cartItems(owner) : [];
  const lines = await priceItems(items, locale);
  const promotions = lines.length ? await loadLivePromotions() : [];
  const excluded = session && promotions.length ? await exhaustedPromotionsForUser(session.user.id, promotions) : new Set<string>();
  const priced = priceCart(lines, promotions, { excluded });
  return { lines: priced.lines.map(toLineView), totals: priced.totals, promotion: priced.promotion, signedIn: !!session };
}

export async function getCartCount(): Promise<number> {
  return cartCount(await currentCartOwner());
}

export async function addToCart(variantId: string, qty: number): Promise<CartMutationResult> {
  return addItem(await ensureCartOwner(), variantId, qty);
}

export async function updateCartItem(itemId: string, qty: number): Promise<CartMutationResult> {
  const owner = await currentCartOwner();
  if (!owner) return { ok: false, error: 'not_found' };
  return setItemQty(owner, itemId, qty);
}

export async function removeCartItem(itemId: string): Promise<boolean> {
  const owner = await currentCartOwner();
  return owner ? removeItem(owner, itemId) : false;
}

export async function removeUnavailableItems(): Promise<number> {
  const owner = await currentCartOwner();
  return owner ? pruneUnavailable(owner) : 0;
}

/**
 * Called by the auth actions right after a successful login/registration: merges the
 * visitor cart (cookie) into the user's cart and clears the cookie. Never throws.
 */
export async function mergeAnonymousCartFromCookie(userId: string): Promise<void> {
  try {
    const token = await readToken();
    if (!token) return;
    await mergeAnonymousCart(userId, token);
    (await cookies()).set(CART_COOKIE, '', { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', maxAge: 0 });
  } catch (err) {
    unstable_rethrow(err);
    console.error('[cart] merge after login failed', err);
  }
}
