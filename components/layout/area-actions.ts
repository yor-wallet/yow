'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { AREA_COOKIE, AREA_COOKIE_MAX_AGE } from '@/lib/delivery/area';

/**
 * Remembers the governorate the shopper wants delivery information for. Only a code that exists is stored;
 * anything else clears the choice. It is display state, not an address: orders always use a real address.
 */
export async function setDeliveryAreaAction(code: string | null): Promise<{ ok: boolean }> {
  const jar = await cookies();
  const valid = typeof code === 'string' && /^[A-Z]{2,3}$/.test(code) ? await prisma.governorate.findUnique({ where: { code }, select: { code: true } }) : null;
  if (!valid) {
    jar.delete(AREA_COOKIE);
    return { ok: code === null };
  }
  jar.set(AREA_COOKIE, valid.code, { path: '/', maxAge: AREA_COOKIE_MAX_AGE, sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  revalidatePath('/', 'layout');
  return { ok: true };
}
