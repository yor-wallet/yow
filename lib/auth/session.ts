import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import type { AppLocale, KycStatus, Role, UserStatus } from '@prisma/client';
import { prisma } from '../db';
import { randomToken, sha256Hex } from '../crypto';
import { SESSION_COOKIE, secureCookies } from '../cookies';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  kycStatus: KycStatus;
  locale: AppLocale;
};

export type Session = { sessionId: string; expiresAt: Date; user: SessionUser };

/**
 * Create a DB session and set the httpOnly cookie. Call only from a server action
 * or route handler (cookies are read-only in server components).
 * Cookie holds a random 32-byte token; the DB stores only its sha256.
 */
export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: sha256Hex(token), expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/** Current session (memoised per request). Null when absent, expired, revoked or user not active. */
export const getSession = cache(async (): Promise<Session | null> => {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch (err) {
    unstable_rethrow(err); // let Next.js mark the route dynamic during prerender
    return null; // outside a request scope (scripts, tests)
  }
  if (!token || token.length < 20 || token.length > 128) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: {
        select: { id: true, email: true, fullName: true, phone: true, role: true, status: true, kycStatus: true, locale: true },
      },
    },
  });
  if (!row || row.revokedAt || row.expiresAt <= new Date() || row.user.status !== 'ACTIVE') return null;
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return { sessionId: row.id, expiresAt: row.expiresAt, user: row.user };
});

/** Delete the current session row and clear the cookie (server action / route handler only). */
export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }
  jar.set(SESSION_COOKIE, '', { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', maxAge: 0 });
}

/** Revoke every session of a user (password change, suspension). */
export async function revokeAllSessions(userId: string) {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
