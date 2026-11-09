import type { Role, User } from '@prisma/client';
import { prisma, isUniqueViolation } from '../db';
import { logAudit } from '../audit';
import { rateLimit } from '../rate-limit';
import { fieldErrorsOf, loginSchema, registerSchema, type FieldErrors } from '../validation';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';

/**
 * Pure auth business logic (DB only, no cookies) — unit-testable.
 * Cookie/session handling lives in ./session.ts; UI-facing helpers in ./index.ts.
 */

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES_PER_ACCOUNT = 5;
export const LOGIN_MAX_FAILURES_PER_IP = 20;
export const REGISTER_MAX_PER_IP_PER_HOUR = 10;

export type AuthErrorCode =
  | 'validation'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'account_suspended'
  | 'email_taken'
  | 'phone_taken';

export type AuthFailure = { ok: false; error: AuthErrorCode; fieldErrors?: FieldErrors; retryAfterSec?: number };
export type AuthSuccess = { ok: true; user: Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'locale'> };
export type AuthResult = AuthSuccess | AuthFailure;

type Meta = { ip?: string | null; userAgent?: string | null };

const PUBLIC_USER = { id: true, email: true, fullName: true, role: true, locale: true } as const;

export async function createUser(input: unknown, meta: Meta = {}): Promise<AuthResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error) };

  if (meta.ip) {
    const rl = await rateLimit(`register:ip:${meta.ip}`, REGISTER_MAX_PER_IP_PER_HOUR, 60 * 60 * 1000);
    if (!rl.ok) return { ok: false, error: 'rate_limited', retryAfterSec: rl.retryAfterSec };
  }

  const { fullName, email, phone, password, locale } = parsed.data;
  const passwordHash = await hashPassword(password);
  try {
    const user = await prisma.user.create({
      data: { fullName, email, phone, passwordHash, locale, role: 'CUSTOMER' },
      select: PUBLIC_USER,
    });
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'user.register',
      entity: 'User',
      entityId: user.id,
      after: { email, phone, locale },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { ok: true, user };
  } catch (err) {
    if (isUniqueViolation(err, 'email')) return { ok: false, error: 'email_taken', fieldErrors: { email: ['email_taken'] } };
    if (isUniqueViolation(err, 'phone')) return { ok: false, error: 'phone_taken', fieldErrors: { phone: ['phone_taken'] } };
    throw err;
  }
}

/** Verify credentials with per-account and per-IP failure limits. Records every attempt. */
export async function authenticate(input: unknown, meta: Meta = {}): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error) };
  const { email, password } = parsed.data;
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);

  const [accountFailures, ipFailures] = await Promise.all([
    prisma.loginAttempt.count({ where: { identifier: email, success: false, createdAt: { gte: since } } }),
    meta.ip
      ? prisma.loginAttempt.count({ where: { ip: meta.ip, success: false, createdAt: { gte: since } } })
      : Promise.resolve(0),
  ]);
  if (accountFailures >= LOGIN_MAX_FAILURES_PER_ACCOUNT || ipFailures >= LOGIN_MAX_FAILURES_PER_IP) {
    const oldest = await prisma.loginAttempt.findFirst({
      where: { success: false, createdAt: { gte: since }, OR: [{ identifier: email }, ...(meta.ip ? [{ ip: meta.ip }] : [])] },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const retryAfterSec = oldest
      ? Math.max(1, Math.ceil((oldest.createdAt.getTime() + LOGIN_WINDOW_MS - Date.now()) / 1000))
      : Math.ceil(LOGIN_WINDOW_MS / 1000);
    return { ok: false, error: 'rate_limited', retryAfterSec };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  let valid = false;
  if (user) valid = await verifyPassword(password, user.passwordHash);
  else await burnPasswordCheck(password);

  await prisma.loginAttempt.create({ data: { identifier: email, ip: meta.ip ?? null, success: valid } });

  if (!user || !valid) return { ok: false, error: 'invalid_credentials' };
  if (user.status !== 'ACTIVE') return { ok: false, error: 'account_suspended' };

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ok: true, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role as Role, locale: user.locale } };
}
