/**
 * Maintenance sweep from the command line.
 *
 *   npm run maintenance:cleanup                 # preview: counts per target, deletes nothing
 *   npm run maintenance:cleanup -- --apply      # real sweep (same rules, lease and batches as the cron)
 *   npm run maintenance:cleanup -- --only=sessions,rate_limits
 */
import { CLEANUP_TARGETS, runCleanup, type CleanupTarget } from '@/lib/maintenance/cleanup';
import { prisma } from '@/lib/db';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env: rely on the environment */
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean) as CleanupTarget[] | undefined;
  if (only?.some((t) => !CLEANUP_TARGETS.includes(t))) throw new Error(`Unknown target. Allowed: ${CLEANUP_TARGETS.join(', ')}`);
  const report = await runCleanup({ dryRun: !args.includes('--apply'), ...(only ? { only } : {}) });
  console.log(`[cleanup] ${report.dryRun ? 'PREVIEW (nothing deleted)' : 'APPLIED'}${report.skipped ? ` — skipped: ${report.skipped}` : ''}${report.truncated ? ' — stopped at the batch limit, run again to continue' : ''}`);
  console.table(report.targets.map((t) => ({ target: t.target, retention: t.retention, candidates: t.candidates, deleted: t.deleted, error: t.error ?? '' })));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
