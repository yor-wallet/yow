import type { Role } from '@prisma/client';

/**
 * Role-based access control. Check PERMISSIONS, never raw roles, in feature code:
 *   can(session.user.role, 'catalog:write')
 * Add a permission here (and to the roles that need it) when a new module needs one.
 */
export const PERMISSIONS = [
  'admin:access',
  'dashboard:read',
  // commerce
  'catalog:read',
  'catalog:write',
  'prices:write',
  'stock:write',
  'promotions:write',
  'campaigns:write',
  'reviews:moderate',
  // orders & customers
  'orders:read',
  'orders:write',
  'orders:cancel',
  'customers:read',
  'customers:write',
  'support:read',
  'support:write',
  // KYC (documents = decrypt/view files)
  'kyc:read',
  'kyc:documents',
  'kyc:decide',
  // finance
  'payments:read',
  'payments:write',
  'wallets:read',
  'wallets:adjust',
  'refunds:request',
  'refunds:approve',
  'giftcards:review',
  'flex:read',
  'flex:decide',
  'reports:read',
  // logistics
  'delivery:read',
  'delivery:write',
  'couriers:write',
  'zones:write',
  'incidents:write',
  // site & governance
  'settings:write',
  'translations:write',
  'notifications:send',
  'users:read',
  'users:roles',
  'audit:read',
  'agents:read',
  'agents:run',
  'agents:decide',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  CUSTOMER: [],
  SUPPORT: [
    'admin:access', 'dashboard:read', 'orders:read', 'customers:read', 'support:read', 'support:write',
    'kyc:read', 'refunds:request', 'delivery:read', 'reviews:moderate', 'flex:read', 'payments:read',
  ],
  LOGISTICS: [
    'admin:access', 'dashboard:read', 'catalog:read', 'orders:read', 'orders:write', 'delivery:read',
    'delivery:write', 'couriers:write', 'zones:write', 'incidents:write',
  ],
  FINANCE: [
    'admin:access', 'dashboard:read', 'orders:read', 'customers:read', 'kyc:read', 'payments:read',
    'payments:write', 'wallets:read', 'wallets:adjust', 'refunds:request', 'refunds:approve',
    'giftcards:review', 'flex:read', 'flex:decide', 'reports:read', 'agents:read',
  ],
  CATALOG: [
    'admin:access', 'dashboard:read', 'catalog:read', 'catalog:write', 'prices:write', 'stock:write',
    'promotions:write', 'campaigns:write', 'reviews:moderate', 'agents:read',
  ],
  ADMIN: ALL.filter((p) => p !== 'users:roles'),
  SUPERADMIN: ALL,
};

export const STAFF_ROLES: readonly Role[] = ['SUPPORT', 'LOGISTICS', 'FINANCE', 'CATALOG', 'ADMIN', 'SUPERADMIN'];

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAll(role: Role | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => can(role, p));
}

export function isStaff(role: Role | null | undefined): boolean {
  return !!role && role !== 'CUSTOMER';
}

/** "May `actor` give `target` role to someone?" Only SUPERADMIN can grant ADMIN/SUPERADMIN. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!can(actor, 'users:roles')) return false;
  if (actor === 'SUPERADMIN') return true;
  return target !== 'ADMIN' && target !== 'SUPERADMIN';
}
