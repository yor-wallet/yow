import { requireApiUser } from '@/lib/auth';
import { apiHandler, HttpError, json } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';
import { getPaymentIntentView, refreshPaymentIntent } from '@/lib/payments/core';

/**
 * GET /api/payments/:intentId — payment status for the owner (or `payments:read` staff).
 * Polled by /[locale]/pay/[intentId]. While pending, the server asks the provider for the
 * current status (at most every 4 s per intent) — the browser never confirms anything.
 */
export const dynamic = 'force-dynamic';

const PENDING = new Set(['CREATED', 'PENDING', 'REQUIRES_ACTION']);

export const GET = apiHandler<{ params: Promise<{ intentId: string }> }>(async (_req, ctx) => {
  const session = await requireApiUser();
  const { intentId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(intentId)) throw new HttpError(404, 'not_found');
  const viewer = { id: session.user.id, role: session.user.role };
  let view = await getPaymentIntentView(intentId, viewer);
  if (!view) throw new HttpError(404, 'not_found');
  if (PENDING.has(view.status) && view.provider !== 'WALLET' && (await rateLimit(`pi-refresh:${intentId}`, 1, 4_000)).ok) {
    try {
      await refreshPaymentIntent(intentId, 'poll');
      view = (await getPaymentIntentView(intentId, viewer)) ?? view;
    } catch (err) {
      console.error('[payments] status refresh failed', intentId, err instanceof Error ? err.message : err);
    }
  }
  return json({ ok: true, payment: view });
});
