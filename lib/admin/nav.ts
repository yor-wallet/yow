import type { Role } from '@prisma/client';
import { can, type Permission } from '@/lib/rbac';

/**
 * Admin centre navigation. Every item declares the permission needed to SEE it; the
 * page itself re-checks with `requireAdmin(permission)` (lib/admin/guard.ts).
 * `key` doubles as the i18n key under `admin.nav.*`.
 */
export type AdminNavItem = { key: string; href: string; icon: string; permission: Permission };
export type AdminNavGroup = { key: string; items: AdminNavItem[] };

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    key: 'main',
    items: [{ key: 'overview', href: '/admin', icon: 'dashboard', permission: 'dashboard:read' }],
  },
  {
    key: 'commerce',
    items: [
      { key: 'products', href: '/admin/products', icon: 'package', permission: 'catalog:read' },
      { key: 'categories', href: '/admin/categories', icon: 'folders', permission: 'catalog:read' },
      { key: 'brands', href: '/admin/brands', icon: 'tags', permission: 'catalog:read' },
      { key: 'promotions', href: '/admin/promotions', icon: 'percent', permission: 'promotions:write' },
      { key: 'campaigns', href: '/admin/campaigns', icon: 'megaphone', permission: 'campaigns:write' },
      { key: 'orders', href: '/admin/orders', icon: 'receipt', permission: 'orders:read' },
      { key: 'reviews', href: '/admin/reviews', icon: 'star', permission: 'reviews:moderate' },
    ],
  },
  {
    key: 'finance',
    items: [
      { key: 'wallets', href: '/admin/finance/wallets', icon: 'wallet', permission: 'wallets:read' },
      { key: 'ledger', href: '/admin/finance/ledger', icon: 'book', permission: 'wallets:read' },
      { key: 'payments', href: '/admin/finance/payments', icon: 'card', permission: 'payments:read' },
      { key: 'giftCards', href: '/admin/finance/gift-cards', icon: 'gift', permission: 'giftcards:review' },
      { key: 'refunds', href: '/admin/finance/refunds', icon: 'undo', permission: 'refunds:request' },
      { key: 'flex', href: '/admin/finance/flex', icon: 'calendar', permission: 'flex:read' },
      { key: 'reconciliation', href: '/admin/finance/reconciliation', icon: 'scale', permission: 'reports:read' },
    ],
  },
  {
    key: 'customers',
    items: [
      { key: 'customers', href: '/admin/customers', icon: 'users', permission: 'customers:read' },
      { key: 'kyc', href: '/admin/kyc', icon: 'shield', permission: 'kyc:read' },
      { key: 'support', href: '/admin/support', icon: 'lifebuoy', permission: 'support:read' },
    ],
  },
  {
    key: 'logistics',
    items: [
      { key: 'shipments', href: '/admin/logistics', icon: 'truck', permission: 'delivery:read' },
      { key: 'couriers', href: '/admin/logistics/couriers', icon: 'bike', permission: 'delivery:read' },
      { key: 'zones', href: '/admin/logistics/zones', icon: 'map', permission: 'delivery:read' },
      { key: 'incidents', href: '/admin/logistics/incidents', icon: 'siren', permission: 'delivery:read' },
    ],
  },
  {
    key: 'site',
    items: [
      { key: 'settings', href: '/admin/site/settings', icon: 'settings', permission: 'settings:write' },
      { key: 'notifications', href: '/admin/site/notifications', icon: 'bell', permission: 'notifications:send' },
      { key: 'translations', href: '/admin/site/translations', icon: 'languages', permission: 'translations:write' },
      { key: 'brand', href: '/admin/site/brand', icon: 'palette', permission: 'admin:access' },
    ],
  },
  {
    key: 'governance',
    items: [
      { key: 'agents', href: '/admin/agents', icon: 'bot', permission: 'agents:read' },
      { key: 'proposals', href: '/admin/agents/proposals', icon: 'inbox', permission: 'agents:read' },
      { key: 'audit', href: '/admin/audit', icon: 'scroll', permission: 'audit:read' },
    ],
  },
];

/** Navigation filtered to what `role` may see (empty groups removed). */
export function navForRole(role: Role | null | undefined): AdminNavGroup[] {
  return ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.permission)) })).filter((g) => g.items.length > 0);
}

/** First page a role can open (staff without dashboard access land on their first section). */
export function homeForRole(role: Role | null | undefined): string | null {
  return navForRole(role)[0]?.items[0]?.href ?? null;
}

/** The nav item matching a locale-less pathname (longest prefix wins). */
export function activeNavItem(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null;
  for (const g of ADMIN_NAV) {
    for (const i of g.items) {
      const match = i.href === '/admin' ? pathname === '/admin' : pathname === i.href || pathname.startsWith(`${i.href}/`);
      if (match && (!best || i.href.length > best.href.length)) best = i;
    }
  }
  return best;
}

/**
 * Sections that already have pages. The rest of `ADMIN_NAV` is declared (the plan is visible in one place) but
 * stays hidden from the menu until its screens exist, so nobody is sent to a dead link.
 */
export const BUILT_NAV_KEYS: ReadonlySet<string> = new Set(['overview', 'products', 'orders', 'reviews', 'agents', 'proposals', 'campaigns']);

/** `navForRole` limited to the sections that are built. */
export function builtNavForRole(role: Role | null | undefined): AdminNavGroup[] {
  return navForRole(role)
    .map((g) => ({ ...g, items: g.items.filter((i) => BUILT_NAV_KEYS.has(i.key)) }))
    .filter((g) => g.items.length > 0);
}
