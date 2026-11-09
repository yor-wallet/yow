import 'server-only';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { redirect } from '@/i18n/navigation';
import { can, type Permission } from '../rbac';
import { HttpError } from '../http';
import { getRequestMeta } from '../request';
import { logAudit } from '../audit';
import { authenticate, createUser, type AuthResult } from './service';
import { createSession, destroySession, getSession, type Session } from './session';

export { getSession, createSession, destroySession, revokeAllSessions } from './session';
export type { Session, SessionUser } from './session';
export type { AuthResult, AuthErrorCode, AuthFailure, AuthSuccess } from './service';
export { hashPassword, verifyPassword } from './password';

/** Register + sign in. For server actions. */
export async function register(input: unknown): Promise<AuthResult> {
  const meta = await getRequestMeta();
  const res = await createUser(input, meta);
  if (res.ok) await createSession(res.user.id, meta);
  return res;
}

/** Verify credentials (rate limited) + sign in. For server actions. */
export async function login(input: unknown): Promise<AuthResult> {
  const meta = await getRequestMeta();
  const res = await authenticate(input, meta);
  if (res.ok) {
    await createSession(res.user.id, meta);
    await logAudit({ actorId: res.user.id, actorRole: res.user.role, action: 'user.login', entity: 'User', entityId: res.user.id, ...meta });
  }
  return res;
}

export async function logout(): Promise<void> {
  const session = await getSession();
  await destroySession();
  if (session) {
    await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'user.logout', entity: 'User', entityId: session.user.id });
  }
}

async function redirectToLogin(next?: string): Promise<never> {
  const locale = await getLocale();
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  return redirect({ href: `/login${query}`, locale });
}

/**
 * Pages/actions: the signed-in user, or redirect to `/{locale}/login?next=…`.
 * Pass `next` as the locale-less path of the current page (e.g. '/account').
 */
export async function requireUser(opts: { next?: string } = {}): Promise<Session> {
  const session = await getSession();
  if (!session) return redirectToLogin(opts.next);
  return session;
}

/** Pages: require one of `roles`. Not signed in → login; signed in without role → 404 (hides admin surface). */
export async function requireRole(roles: Role | readonly Role[], opts: { next?: string } = {}): Promise<Session> {
  const session = await requireUser(opts);
  const list = (Array.isArray(roles) ? roles : [roles]) as readonly Role[];
  if (!list.includes(session.user.role)) notFound();
  return session;
}

/** Pages: require a permission (see lib/rbac.ts). Not signed in → login; forbidden → 404. */
export async function requirePermission(permission: Permission, opts: { next?: string } = {}): Promise<Session> {
  const session = await requireUser(opts);
  if (!can(session.user.role, permission)) notFound();
  return session;
}

/** Route handlers: signed-in user or HttpError(401). */
export async function requireApiUser(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new HttpError(401, 'unauthenticated');
  return session;
}

/** Route handlers: permission or HttpError(401/403). */
export async function requireApiPermission(permission: Permission): Promise<Session> {
  const session = await requireApiUser();
  if (!can(session.user.role, permission)) throw new HttpError(403, 'forbidden');
  return session;
}
