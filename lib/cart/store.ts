import { prisma, isUniqueViolation, type Db } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';
import { availableQty, MAX_QTY_PER_LINE } from '@/lib/catalog/stock';
import { clampQty, mergeQty } from './math';

/**
 * Cart persistence, keyed by an explicit owner (no cookies here — unit-testable).
 * Logged-in users own one cart (`Cart.userId`); visitors own one through the
 * `doom_cart` cookie token (`Cart.anonTokenHash = sha256Hex(token)`).
 */

export type CartOwner = { userId: string } | { anonTokenHash: string };

export const ANON_CART_TTL_DAYS = 60;

function whereOwner(owner: CartOwner) {
  return 'userId' in owner ? { userId: owner.userId } : { anonTokenHash: owner.anonTokenHash };
}

export async function findCartId(owner: CartOwner, db: Db = prisma): Promise<string | null> {
  const c = await db.cart.findUnique({ where: whereOwner(owner), select: { id: true } });
  return c?.id ?? null;
}

export async function getOrCreateCartId(owner: CartOwner, db: Db = prisma): Promise<string> {
  const where = whereOwner(owner);
  const expiresAt = 'anonTokenHash' in owner ? new Date(Date.now() + ANON_CART_TTL_DAYS * 86_400_000) : null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await db.cart.upsert({ where, create: { ...where, expiresAt }, update: expiresAt ? { expiresAt } : {}, select: { id: true } });
      return c.id;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 1) throw err;
    }
  }
  throw new Error('unreachable');
}

export type CartMutationError = 'not_found' | 'unavailable' | 'out_of_stock' | 'invalid_qty';
export type CartMutationResult = { ok: true; qty: number; capped: boolean } | { ok: false; error: CartMutationError };

async function loadSellableVariant(variantId: string, db: Db) {
  const v = await db.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, isActive: true, priceBaisa: true, stock: true, reserved: true, product: { select: { status: true, isSellable: true } } },
  });
  if (!v) return { error: 'not_found' as const };
  if (!v.isActive || v.priceBaisa === null || v.product.status !== 'ACTIVE' || !v.product.isSellable) return { error: 'unavailable' as const };
  return { variant: v, available: availableQty(v.stock, v.reserved) };
}

/** Add `qty` units (merged with an existing line), capped by available stock and MAX_QTY_PER_LINE. */
export async function addItem(owner: CartOwner, variantId: string, qty: number): Promise<CartMutationResult> {
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) return { ok: false, error: 'invalid_qty' };
  const loaded = await loadSellableVariant(variantId, prisma);
  if ('error' in loaded) return { ok: false, error: loaded.error! };
  if (loaded.available <= 0) return { ok: false, error: 'out_of_stock' };
  const cartId = await getOrCreateCartId(owner);
  const existing = await prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } }, select: { qty: true } });
  const wanted = (existing?.qty ?? 0) + qty;
  const next = clampQty(wanted, loaded.available);
  if (next <= 0) return { ok: false, error: 'out_of_stock' };
  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId, variantId } },
    create: { cartId, variantId, qty: next },
    update: { qty: next },
  });
  await prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
  return { ok: true, qty: next, capped: next < wanted };
}

/** Set a line quantity (0 removes it). */
export async function setItemQty(owner: CartOwner, itemId: string, qty: number): Promise<CartMutationResult> {
  if (!Number.isInteger(qty) || qty < 0 || qty > 99) return { ok: false, error: 'invalid_qty' };
  const cartId = await findCartId(owner);
  if (!cartId) return { ok: false, error: 'not_found' };
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId }, select: { id: true, variantId: true } });
  if (!item) return { ok: false, error: 'not_found' };
  if (qty === 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
    return { ok: true, qty: 0, capped: false };
  }
  const loaded = await loadSellableVariant(item.variantId, prisma);
  if ('error' in loaded) return { ok: false, error: loaded.error! };
  if (loaded.available <= 0) return { ok: false, error: 'out_of_stock' };
  const next = clampQty(qty, loaded.available);
  await prisma.cartItem.update({ where: { id: item.id }, data: { qty: next } });
  return { ok: true, qty: next, capped: next < qty };
}

export async function removeItem(owner: CartOwner, itemId: string): Promise<boolean> {
  const cartId = await findCartId(owner);
  if (!cartId) return false;
  const { count } = await prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
  return count > 0;
}

/** Remove lines that can no longer be bought (inactive, unpriced, out of stock) and cap the others. */
export async function pruneUnavailable(owner: CartOwner): Promise<number> {
  const cartId = await findCartId(owner);
  if (!cartId) return 0;
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    select: {
      id: true,
      qty: true,
      variant: { select: { isActive: true, priceBaisa: true, stock: true, reserved: true, product: { select: { status: true, isSellable: true } } } },
    },
  });
  let changed = 0;
  for (const it of items) {
    const v = it.variant;
    const available = availableQty(v.stock, v.reserved);
    const sellable = v.isActive && v.priceBaisa !== null && v.product.status === 'ACTIVE' && v.product.isSellable;
    if (!sellable || available <= 0) {
      await prisma.cartItem.delete({ where: { id: it.id } });
      changed++;
    } else if (it.qty > clampQty(it.qty, available)) {
      await prisma.cartItem.update({ where: { id: it.id }, data: { qty: clampQty(it.qty, available) } });
      changed++;
    }
  }
  return changed;
}

export async function cartItems(owner: CartOwner, db: Db = prisma): Promise<{ id: string; variantId: string; qty: number }[]> {
  const cartId = await findCartId(owner, db);
  if (!cartId) return [];
  return db.cartItem.findMany({ where: { cartId }, orderBy: { createdAt: 'asc' }, select: { id: true, variantId: true, qty: true } });
}

export async function cartCount(owner: CartOwner | null): Promise<number> {
  if (!owner) return 0;
  const agg = await prisma.cartItem.aggregate({ where: { cart: whereOwner(owner) }, _sum: { qty: true } });
  return agg._sum.qty ?? 0;
}

/**
 * Merge the anonymous cart identified by its cookie `token` into the user's cart
 * (called right after login/registration). Quantities are summed and capped by
 * available stock; the anonymous cart is deleted. Idempotent.
 */
export async function mergeAnonymousCart(userId: string, token: string): Promise<{ merged: number }> {
  if (!token || token.length < 20 || token.length > 128) return { merged: 0 };
  const anonTokenHash = sha256Hex(token);
  return prisma.$transaction(async (tx) => {
    const anon = await tx.cart.findUnique({ where: { anonTokenHash }, select: { id: true, userId: true, items: { select: { variantId: true, qty: true } } } });
    if (!anon) return { merged: 0 };
    if (anon.items.length === 0) {
      await tx.cart.delete({ where: { id: anon.id } });
      return { merged: 0 };
    }
    const userCartId = await getOrCreateCartId({ userId }, tx);
    const [existing, variants] = await Promise.all([
      tx.cartItem.findMany({ where: { cartId: userCartId }, select: { variantId: true, qty: true } }),
      tx.productVariant.findMany({ where: { id: { in: anon.items.map((i) => i.variantId) } }, select: { id: true, stock: true, reserved: true } }),
    ]);
    let merged = 0;
    for (const item of anon.items) {
      const v = variants.find((x) => x.id === item.variantId);
      if (!v) continue;
      const have = existing.find((e) => e.variantId === item.variantId)?.qty ?? 0;
      const available = availableQty(v.stock, v.reserved);
      // Out-of-stock lines are kept (capped) so the customer sees the warning instead of a silent loss.
      const qty = available > 0 ? mergeQty(have, item.qty, available) : Math.min(Math.max(have, item.qty), MAX_QTY_PER_LINE);
      if (qty <= 0) continue;
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: userCartId, variantId: item.variantId } },
        create: { cartId: userCartId, variantId: item.variantId, qty },
        update: { qty },
      });
      merged++;
    }
    await tx.cart.delete({ where: { id: anon.id } });
    return { merged };
  });
}
