import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { appUrl, isEmailConfigured, sendEmail, type SendResult } from '@/lib/email';
import { verifyEmailMessage } from '@/lib/email/templates';
import { signToken, verifyToken } from './tokens';

/**
 * Account confirmation by e-mail. The link carries a signed token (48 h) bound to the user AND to the address
 * it was sent to: if the e-mail changes, old links stop working. Confirming twice is harmless.
 */
const PURPOSE = 'email-verify';
const emailHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);

export async function emailVerificationUrl(user: { id: string; email: string; locale?: string | null }): Promise<string> {
  const token = await signToken({ eh: emailHash(user.email) }, { purpose: PURPOSE, expiresIn: '48h', subject: user.id });
  const locale = user.locale === 'ar' || user.locale === 'en' ? user.locale : 'ar';
  return appUrl(`/${locale}/verify-email?token=${encodeURIComponent(token)}`);
}

/** Send (or re-send) the confirmation e-mail. Never throws. */
export async function sendVerificationEmail(userId: string): Promise<SendResult | { ok: false; skipped: false; error: 'already_verified' | 'not_found' }> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, locale: true, emailVerifiedAt: true } });
    if (!user) return { ok: false, skipped: false, error: 'not_found' };
    if (user.emailVerifiedAt) return { ok: false, skipped: false, error: 'already_verified' };
    if (!isEmailConfigured()) return { ok: false, skipped: true };
    const url = await emailVerificationUrl(user);
    return await sendEmail(verifyEmailMessage({ locale: user.locale, name: user.fullName, email: user.email, url }));
  } catch (err) {
    console.error('[email] verification e-mail failed', err instanceof Error ? err.message : err);
    return { ok: false, skipped: false, error: 'network' };
  }
}

export type ConfirmEmailResult = { ok: true; alreadyConfirmed: boolean } | { ok: false; error: 'invalid' };

export async function confirmEmail(token: string): Promise<ConfirmEmailResult> {
  if (!token || token.length > 2_000) return { ok: false, error: 'invalid' };
  const payload = await verifyToken<{ eh?: string; sub?: string }>(token, PURPOSE);
  if (!payload?.sub || typeof payload.eh !== 'string') return { ok: false, error: 'invalid' };
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, role: true, emailVerifiedAt: true } });
  if (!user || emailHash(user.email) !== payload.eh) return { ok: false, error: 'invalid' };
  if (user.emailVerifiedAt) return { ok: true, alreadyConfirmed: true };
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  await logAudit({ actorId: user.id, actorRole: user.role, action: 'user.email.verify', entity: 'User', entityId: user.id, after: { emailVerified: true } }).catch(() => undefined);
  return { ok: true, alreadyConfirmed: false };
}

/** Is a confirmed e-mail required right now? Only when e-mails can actually be sent (otherwise nobody could ever comply). */
export const emailConfirmationRequired = (): boolean => isEmailConfigured();
