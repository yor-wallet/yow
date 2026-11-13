import { apiHandler, json } from '@/lib/http';
import { assertCronAuth } from '@/lib/admin/cron';
import { runCleanup, runScheduledCleanup } from '@/lib/maintenance/cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Maintenance cron (Bearer CRON_SECRET). Removes temporary server data under the allow-list of
 * lib/maintenance/cleanup.ts.
 *   - `?dryRun=1` → preview: counts per target, deletes nothing (works whatever the setting);
 *   - otherwise  → real sweep, only when the setting `cleanup.enabled` is 1 (else `skipped: disabled`).
 */
async function handle(req: Request) {
  assertCronAuth(req);
  const preview = new URL(req.url).searchParams.get('dryRun') === '1';
  const report = preview ? await runCleanup({ dryRun: true }) : await runScheduledCleanup();
  return json({ ok: !('error' in report), report });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
