/**
 * Applies data/catalogue/market-prices-*.json (owner's rule: DOOM price = market − 10 %) to the variants
 * that have no price yet. A price chosen by staff is kept unless --overwrite. Stock is never touched.
 *
 *   npm run catalogue:prices                       # as the first SUPERADMIN (or ADMIN_EMAIL)
 *   npm run catalogue:prices -- --overwrite        # also replace existing prices
 *   npm run catalogue:prices -- --file market-prices-2026-11.json
 */
import { prisma } from '@/lib/db';
import { applyMarketPrices, loadMarketPrices } from '@/lib/admin/market-prices';
import { staffActor } from './system-actor';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env: rely on the environment */
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.indexOf('--file');
  const doc = await loadMarketPrices(fileArg >= 0 ? args[fileArg + 1] : undefined);
  const actor = await staffActor();
  if (!actor) throw new Error('No ADMIN/SUPERADMIN user found.');
  const res = await applyMarketPrices(actor, doc, { overwrite: args.includes('--overwrite') });
  console.log('[prices]', JSON.stringify(res));
}

main()
  .catch((e) => {
    console.error('[prices] failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
