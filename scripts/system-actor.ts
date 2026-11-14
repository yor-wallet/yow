import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/admin/actor';

const SYSTEM_EMAIL = 'catalogue-import@system.doom.invalid';

/** The system account: suspended (cannot sign in), random password nobody knows, CATALOG role during the run only. */
export async function systemActor(): Promise<Actor> {
  const data = { role: 'CATALOG', status: 'SUSPENDED' } as const;
  const user = await prisma.user.upsert({
    where: { email: SYSTEM_EMAIL },
    update: data,
    create: { email: SYSTEM_EMAIL, fullName: 'DOOM System (catalogue import)', passwordHash: await bcrypt.hash(randomBytes(48).toString('base64'), 12), ...data },
    select: { id: true },
  });
  return { id: user.id, role: 'CATALOG' };
}

/** Staff account for an attended run (ADMIN_EMAIL, else the first SUPERADMIN). */
export async function staffActor(): Promise<Actor | null> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return prisma.user.findFirst({
    where: email ? { email, role: { in: ['SUPERADMIN', 'ADMIN'] } } : { role: 'SUPERADMIN' },
    select: { id: true, role: true },
  });
}
