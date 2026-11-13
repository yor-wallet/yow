/**
 * Applies the verified 2026 catalogue (data/catalogue/verified-catalogue-2026.json) to the database.
 *
 *   npm run catalogue:import                 # products as DRAFT (+ variants without price/stock when confirmed)
 *   npm run catalogue:import -- --publish    # also activate the fully verified models (no price → "price coming soon")
 *   npm run catalogue:import -- --file path.json
 *
 *   npm run catalogue:import -- --publish --system   # unattended (first deployment): see below
 *
 * Runs as the first SUPERADMIN (ADMIN_EMAIL), so the audit log shows who applied it.
 * With --system there is no staff account yet: the import is attributed to a dedicated system
 * account that can never sign in (suspended, unusable password, reserved .invalid address) and
 * that holds the catalogue role only while the import runs.
 * Idempotent: safe to run again; staff edits, prices and stock are never overwritten.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/admin/actor';
import { importVerifiedCatalogue } from '@/lib/admin/catalogue-verified';

const SYSTEM_EMAIL = 'catalogue-import@system.doom.invalid';

/** The system account: suspended (cannot sign in), random password nobody knows, CATALOG role during the run only. */
async function systemActor(): Promise<Actor> {
  const data = { role: 'CATALOG', status: 'SUSPENDED' } as const;
  const user = await prisma.user.upsert({
    where: { email: SYSTEM_EMAIL },
    update: data,
    create: { email: SYSTEM_EMAIL, fullName: 'DOOM System (catalogue import)', passwordHash: await bcrypt.hash(randomBytes(48).toString('base64'), 12), ...data },
    select: { id: true },
  });
  return { id: user.id, role: 'CATALOG' };
}

try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env: rely on the environment */
}

async function main() {
  const args = process.argv.slice(2);
  const publish = args.includes('--publish');
  const fileArg = args.indexOf('--file');
  const file = path.resolve(fileArg >= 0 ? args[fileArg + 1]! : 'data/catalogue/verified-catalogue-2026.json');
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { models: unknown[] };

  let actor: Actor | null;
  if (args.includes('--system')) {
    actor = await systemActor();
  } else {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    actor = await prisma.user.findFirst({
      where: email ? { email, role: { in: ['SUPERADMIN', 'ADMIN'] } } : { role: 'SUPERADMIN' },
      select: { id: true, role: true },
    });
  }
  if (!actor) throw new Error('No ADMIN/SUPERADMIN user found: run `npm run db:seed` with ADMIN_EMAIL / ADMIN_PASSWORD first, or pass --system.');

  try {
    const res = await importVerifiedCatalogue(actor, { models: doc.models, publish });
    console.log('[catalogue]', JSON.stringify(res));
  } finally {
    // The system account keeps no staff role once the import is over.
    if (args.includes('--system')) await prisma.user.update({ where: { id: actor.id }, data: { role: 'CUSTOMER' } });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
