'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { markNotificationsRead } from '@/lib/notifications';

const idsSchema = z.array(z.string().min(1).max(64)).max(100);

/** Mark the given notifications (or all when omitted) of the signed-in user as read. */
export async function markNotificationsReadAction(ids?: string[]): Promise<{ ok: boolean; count: number }> {
  const session = await getSession();
  if (!session) return { ok: false, count: 0 };
  const parsed = ids === undefined ? { success: true as const, data: undefined } : idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, count: 0 };
  const count = await markNotificationsRead(session.user.id, parsed.data);
  revalidatePath('/[locale]', 'layout');
  return { ok: true, count };
}
