import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { prisma } from './db';
import { sha256Hex } from './crypto';
import { CART_COOKIE } from './cookies';
import { getSession } from './auth/session';
import type { LocalizedText } from './localized';

/** Data needed by the global chrome (header, mega-menu, footer, bottom nav). */

export type NavCategory = {
  id: string;
  slug: string;
  name: LocalizedText;
  icon: string | null;
  children: { id: string; slug: string; name: LocalizedText; icon: string | null }[];
};

/** Cache tag to revalidate after category changes: `revalidateTag(NAV_CATEGORIES_TAG)`. */
export const NAV_CATEGORIES_TAG = 'nav-categories';

const loadNavCategories = unstable_cache(
  async (): Promise<NavCategory[]> => {
    const rows = await prisma.category.findMany({
      where: { parentId: null, isActive: true },
      orderBy: { sort: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        icon: true,
        children: {
          where: { isActive: true },
          orderBy: { sort: 'asc' },
          select: { id: true, slug: true, name: true, icon: true },
        },
      },
    });
    return rows.map((r) => ({
      ...r,
      name: r.name as LocalizedText,
      children: r.children.map((c) => ({ ...c, name: c.name as LocalizedText })),
    }));
  },
  ['nav-categories-v1'],
  { revalidate: 300, tags: [NAV_CATEGORIES_TAG] },
);

/** Top-level categories with their active children (cached 5 min, tag NAV_CATEGORIES_TAG). Never throws. */
export const getNavCategories = cache(async (): Promise<NavCategory[]> => {
  try {
    return await loadNavCategories();
  } catch (err) {
    unstable_rethrow(err);
    console.error('[nav] categories unavailable', err);
    return [];
  }
});

export type HeaderCounts = { cart: number; notifications: number; signedIn: boolean; isStaff: boolean };

/** Cart item count (user cart or anonymous `doom_cart` cookie) and unread notifications. Never throws. */
export const getHeaderCounts = cache(async (): Promise<HeaderCounts> => {
  try {
    const session = await getSession();
    const jar = await cookies();
    const anon = jar.get(CART_COOKIE)?.value;
    const cartWhere = session
      ? { cart: { userId: session.user.id } }
      : anon
        ? { cart: { anonTokenHash: sha256Hex(anon) } }
        : null;
    const [cartAgg, notifications] = await Promise.all([
      cartWhere ? prisma.cartItem.aggregate({ where: cartWhere, _sum: { qty: true } }) : Promise.resolve(null),
      session ? prisma.notification.count({ where: { userId: session.user.id, readAt: null } }) : Promise.resolve(0),
    ]);
    return {
      cart: cartAgg?._sum.qty ?? 0,
      notifications,
      signedIn: !!session,
      isStaff: !!session && session.user.role !== 'CUSTOMER',
    };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[nav] counts unavailable', err);
    return { cart: 0, notifications: 0, signedIn: false, isStaff: false };
  }
});
