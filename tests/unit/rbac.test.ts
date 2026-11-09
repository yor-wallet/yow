import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, can, canAssignRole, isStaff } from '@/lib/rbac';

describe('rbac', () => {
  it('customers have no admin permission', () => {
    expect(ROLE_PERMISSIONS.CUSTOMER).toEqual([]);
    expect(can('CUSTOMER', 'admin:access')).toBe(false);
    expect(isStaff('CUSTOMER')).toBe(false);
  });

  it('superadmin has every permission; admin all but role assignment', () => {
    for (const p of PERMISSIONS) expect(can('SUPERADMIN', p)).toBe(true);
    expect(can('ADMIN', 'users:roles')).toBe(false);
    expect(can('ADMIN', 'kyc:documents')).toBe(true);
  });

  it('least privilege per staff role', () => {
    expect(can('CATALOG', 'prices:write')).toBe(true);
    expect(can('CATALOG', 'wallets:adjust')).toBe(false);
    expect(can('FINANCE', 'wallets:adjust')).toBe(true);
    expect(can('FINANCE', 'catalog:write')).toBe(false);
    expect(can('LOGISTICS', 'zones:write')).toBe(true);
    expect(can('LOGISTICS', 'refunds:approve')).toBe(false);
    expect(can('SUPPORT', 'kyc:documents')).toBe(false);
    expect(can(null, 'admin:access')).toBe(false);
  });

  it('every staff role can open the admin centre', () => {
    for (const role of ['SUPPORT', 'LOGISTICS', 'FINANCE', 'CATALOG', 'ADMIN', 'SUPERADMIN'] as const) {
      expect(can(role, 'admin:access')).toBe(true);
    }
  });

  it('only superadmin grants admin roles', () => {
    expect(canAssignRole('SUPERADMIN', 'ADMIN')).toBe(true);
    expect(canAssignRole('ADMIN', 'SUPPORT')).toBe(false);
    expect(canAssignRole('FINANCE', 'CUSTOMER')).toBe(false);
  });
});
