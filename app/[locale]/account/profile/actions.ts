'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { prisma, isUniqueViolation } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { fieldErrorsOf, fullNameSchema, localeSchema, omanPhoneSchema, type FieldErrors } from '@/lib/validation';

export type ProfileFormState = {
  status: 'idle' | 'ok' | 'error';
  error?: 'generic' | 'phone_taken' | 'unauthenticated';
  fieldErrors?: FieldErrors;
  values?: { fullName?: string; phone?: string };
};

const profileSchema = z.object({ fullName: fullNameSchema, phone: omanPhoneSchema });

export async function updateProfileAction(_prev: ProfileFormState, fd: FormData): Promise<ProfileFormState> {
  const session = await getSession();
  if (!session) return { status: 'error', error: 'unauthenticated' };
  const values = { fullName: String(fd.get('fullName') ?? ''), phone: String(fd.get('phone') ?? '') };
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) return { status: 'error', fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { fullName: true, phone: true } });
    const phoneChanged = before.phone !== parsed.data.phone;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.user.id },
        data: { fullName: parsed.data.fullName, phone: parsed.data.phone, ...(phoneChanged ? { phoneVerifiedAt: null } : {}) },
      });
      await logAudit(
        { actorId: session.user.id, actorRole: session.user.role, action: 'user.profile.update', entity: 'User', entityId: session.user.id, before, after: parsed.data },
        tx,
      );
    });
  } catch (err) {
    if (isUniqueViolation(err, 'phone')) return { status: 'error', error: 'phone_taken', fieldErrors: { phone: ['phone_taken'] }, values };
    console.error('[profile] update failed', err);
    return { status: 'error', error: 'generic', values };
  }
  revalidatePath('/[locale]', 'layout');
  return { status: 'ok' };
}

/** Persist the preferred language (notifications/receipts); the client then switches the URL locale. */
export async function setPreferredLocaleAction(locale: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const parsed = localeSchema.safeParse(locale);
  if (!parsed.success) return { ok: false };
  await prisma.user.update({ where: { id: session.user.id }, data: { locale: parsed.data } });
  await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'user.locale.update', entity: 'User', entityId: session.user.id, after: { locale: parsed.data } });
  return { ok: true };
}
