'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession, hashPassword, verifyPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { notifyTemplate } from '@/lib/notifications';
import { ACCOUNT_DELETION_SUBJECT, createTicket } from '@/lib/support';
import { fieldErrorsOf, passwordSchema, type FieldErrors } from '@/lib/validation';

export type PasswordFormState = {
  status: 'idle' | 'ok' | 'error';
  error?: 'wrong_password' | 'password_same' | 'rate_limited' | 'generic';
  fieldErrors?: FieldErrors;
};

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, 'required').max(128, 'too_long'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'required'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'password_mismatch' });

/** Change password: verify the current one, hash the new one (bcrypt 12), sign out every OTHER session. */
export async function changePasswordAction(_prev: PasswordFormState, fd: FormData): Promise<PasswordFormState> {
  const session = await getSession();
  if (!session) return { status: 'error', error: 'generic' };
  const parsed = changeSchema.safeParse({
    currentPassword: fd.get('currentPassword') ?? '',
    newPassword: fd.get('newPassword') ?? '',
    confirmPassword: fd.get('confirmPassword') ?? '',
  });
  if (!parsed.success) return { status: 'error', fieldErrors: fieldErrorsOf(parsed.error) };
  const rl = await rateLimit(`password-change:${session.user.id}`, 5, 15 * 60 * 1000);
  if (!rl.ok) return { status: 'error', error: 'rate_limited' };
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'user.password.change.failed', entity: 'User', entityId: session.user.id });
    return { status: 'error', error: 'wrong_password', fieldErrors: { currentPassword: ['wrong_password'] } };
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return { status: 'error', error: 'password_same', fieldErrors: { newPassword: ['password_same'] } };
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.user.id }, data: { passwordHash } });
    await tx.session.updateMany({
      where: { userId: session.user.id, revokedAt: null, id: { not: session.sessionId } },
      data: { revokedAt: new Date() },
    });
    await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'user.password.change', entity: 'User', entityId: session.user.id }, tx);
    await notifyTemplate(session.user.id, 'passwordChanged', {}, '/account/security', tx);
  });
  revalidatePath('/[locale]/account/security', 'page');
  return { status: 'ok' };
}

const idSchema = z.string().min(1).max(64);

/** Revoke one of the user's own sessions (not the current one — use sign out for that). */
export async function revokeSessionAction(sessionId: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const parsed = idSchema.safeParse(sessionId);
  if (!parsed.success || parsed.data === session.sessionId) return { ok: false };
  const { count } = await prisma.session.updateMany({
    where: { id: parsed.data, userId: session.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count) {
    await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'user.session.revoke', entity: 'Session', entityId: parsed.data });
  }
  revalidatePath('/[locale]/account/security', 'page');
  return { ok: count === 1 };
}

export async function revokeOtherSessionsAction(): Promise<{ ok: boolean; count: number }> {
  const session = await getSession();
  if (!session) return { ok: false, count: 0 };
  const { count } = await prisma.session.updateMany({
    where: { userId: session.user.id, revokedAt: null, id: { not: session.sessionId } },
    data: { revokedAt: new Date() },
  });
  await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'user.session.revoke_others', entity: 'User', entityId: session.user.id, after: { count } });
  revalidatePath('/[locale]/account/security', 'page');
  return { ok: true, count };
}

/**
 * Account deletion REQUEST (PDPL right to erasure): opens a HIGH-priority support ticket for
 * staff, who check legal retention (invoices, payments) and pending orders/balance before
 * anything is deleted. Idempotent: an open request is returned instead of a new one.
 */
export async function requestAccountDeletionAction(): Promise<{ ok: boolean; number?: string }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const existing = await prisma.supportTicket.findFirst({
    where: { userId: session.user.id, subject: ACCOUNT_DELETION_SUBJECT, status: { notIn: ['CLOSED', 'RESOLVED'] } },
    select: { number: true },
  });
  if (existing) return { ok: true, number: existing.number };
  try {
    const ticket = await createTicket({
      userId: session.user.id,
      subject: ACCOUNT_DELETION_SUBJECT,
      message: `The customer requested the deletion of their account (user ${session.user.id}, ${session.user.email}). Check pending orders, wallet balance, FLEX plans and legal retention before deleting personal data.`,
      priority: 'HIGH',
    });
    await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'user.deletion.request', entity: 'User', entityId: session.user.id, after: { ticket: ticket.number } });
    await notifyTemplate(session.user.id, 'deletionRequested', { number: ticket.number }, `/account/support/${ticket.number}`);
    revalidatePath('/[locale]/account/security', 'page');
    return { ok: true, number: ticket.number };
  } catch (err) {
    console.error('[security] deletion request failed', err);
    return { ok: false };
  }
}
