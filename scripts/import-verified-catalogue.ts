/**
 * Applies the verified 2026 catalogue (data/catalogue/verified-catalogue-2026.json) to the database.
 *
 *   npm run catalogue:import                 # products as DRAFT (+ variants without price/stock when confirmed)
 *   npm run catalogue:import -- --publish    # also activate the fully verified models (no price → "price coming soon")
 *   npm run catalogue:import -- --file path.json
 *
 * Runs as the first SUPERADMIN (ADMIN_EMAIL), so the audit log shows who applied it.
 * Idempotent: safe to run again; staff edits, prices and stock are never overwritten.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { importVerifiedCatalogue } from '@/lib/admin/catalogue-verified';

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

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const actor = await prisma.user.findFirst({
    where: email ? { email, role: { in: ['SUPERADMIN', 'ADMIN'] } } : { role: 'SUPERADMIN' },
    select: { id: true, role: true },
  });
  if (!actor) throw new Error('No ADMIN/SUPERADMIN user found: run `npm run db:seed` with ADMIN_EMAIL / ADMIN_PASSWORD first.');

  const res = await importVerifiedCatalogue(actor, { models: doc.models, publish });
  console.log('[catalogue]', JSON.stringify(res));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
