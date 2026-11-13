import { apiHandler, json } from '@/lib/http';
import { assertCronAuth } from '@/lib/admin/cron';
import { releaseExpiredReservations } from '@/lib/orders';
import { runScheduledCleanup } from '@/lib/maintenance/cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Reservations cron (Bearer CRON_SECRET): cancels unpaid orders whose stock reservation
 * expired and returns the stock (storefront `releaseExpiredReservations`). It then runs the maintenance
 * sweep, which does nothing until the setting `cleanup.enabled` is 1 (the nightly schedule is shared:
 * the hosting plan limits scheduled jobs). The sweep never throws, so it cannot break the release of stock.
 */
async function handle(req: Request) {
  assertCronAuth(req);
  const result = await releaseExpiredReservations(new Date());
  const cleanup = await runScheduledCleanup();
  return json({ ok: true, ...result, cleanup });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
