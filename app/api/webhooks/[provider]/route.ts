import { Prisma } from '@prisma/client';
import { prisma, isUniqueViolation } from '@/lib/db';
import { json, jsonError } from '@/lib/http';
import { handleProviderWebhook } from '@/lib/payments/webhooks';
import { WebhookSignatureError } from '@/lib/payments/types';
import { applyPartnerDecision, isFlexPartnerConfigured, verifyPartnerWebhook } from '@/lib/flex';

/**
 * Provider webhooks (server-to-server, NO origin check — signatures are verified instead):
 *   POST /api/webhooks/thawani | ooredoo | omantel | crypto   payment notifications
 *   POST /api/webhooks/flex-partner                          FLEX finance partner decisions
 * The raw event is stored (PaymentProviderEvent, replay-safe) and the payment is re-fetched
 * from the provider before anything is confirmed. See docs/PAYMENTS.md.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY = 256 * 1024;

async function flexPartner(req: Request, rawBody: string): Promise<Response> {
  if (!isFlexPartnerConfigured()) return jsonError(503, 'provider_not_configured');
  let event;
  try {
    event = verifyPartnerWebhook(req.headers, rawBody);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return jsonError(401, 'invalid_signature');
    throw err;
  }
  try {
    await prisma.paymentProviderEvent.create({
      data: { provider: 'FLEX', eventId: event.eventId.slice(0, 190), type: event.decision, payload: (event.payload ?? {}) as Prisma.InputJsonValue, signatureVerified: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return json({ ok: true, replayed: true });
    throw err;
  }
  const res = await applyPartnerDecision(event);
  await prisma.paymentProviderEvent.updateMany({
    where: { provider: 'FLEX', eventId: event.eventId.slice(0, 190) },
    data: { processedAt: new Date(), processingError: res.applied ? null : res.reason },
  });
  return json({ ok: true, processed: res.applied });
}

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await ctx.params;
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_BODY) return jsonError(413, 'payload_too_large');
  try {
    const rawBody = await req.text();
    if (provider === 'flex-partner') return await flexPartner(req, rawBody);
    const out = await handleProviderWebhook(provider, req.headers, rawBody);
    return json(out.body, { status: out.status });
  } catch (err) {
    console.error(`[webhooks] ${provider} failed`, err);
    return jsonError(500, 'internal_error');
  }
}
