import { apiHandler, json } from '@/lib/http';
import { assertCronAuth } from '@/lib/admin/cron';
import { releaseExpiredReservations } from '@/lib/orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Reservations cron (Bearer CRON_SECRET): cancels unpaid orders whose stock reservation
 * expired and returns the stock (storefront `releaseExpiredReservations`).
 */
async function handle(req: Request) {
  assertCronAuth(req);
  const result = await releaseExpiredReservations(new Date());
  return json({ ok: true, ...result });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
