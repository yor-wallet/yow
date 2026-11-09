import 'server-only';
import { notFound } from 'next/navigation';
import { requireRole, type Session } from '@/lib/auth';
import { can, STAFF_ROLES, type Permission } from '@/lib/rbac';
import type { Actor } from './actor';

export type AdminContext = { session: Session; actor: Actor; can: (p: Permission) => boolean };

/**
 * Admin pages: staff session (not signed in → login with `next`; customer → 404)
 * plus `permission` (missing → 404, the admin surface stays hidden).
 */
export async function requireAdmin(permission: Permission, next: string): Promise<AdminContext> {
  const session = await requireRole(STAFF_ROLES, { next });
  if (!can(session.user.role, 'admin:access') || !can(session.user.role, permission)) notFound();
  const role = session.user.role;
  return { session, actor: { id: session.user.id, role }, can: (p) => can(role, p) };
}
