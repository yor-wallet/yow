import { Prisma } from '@prisma/client';
import { prisma, isUniqueViolation } from '@/lib/db';
import { getAdapterBySlug } from './registry';
import { refreshPaymentIntent } from './core';
import { raisePaymentAlert } from './alerts';
import { WebhookSignatureError } from './types';

/**
 * Provider webhooks (`POST /api/webhooks/<slug>`):
 *  1. verify the signature (when the provider signs / a secret is configured) — invalid → 401;
 *  2. store the RAW event in PaymentProviderEvent (unique provider+eventId ⇒ replays are ignored);
 *  3. NEVER trust the payload: re-fetch the payment from the provider API and confirm only
 *     when the provider says paid AND the amount matches (refreshPaymentIntent → confirmPaymentIntent).
 */

export type WebhookOutcome = {
  status: number;
  body: { ok: boolean; replayed?: boolean; processed?: boolean; error?: string };
};

const MAX_BODY_BYTES = 256 * 1024;

export async function handleProviderWebhook(slug: string, headers: Headers, rawBody: string): Promise<WebhookOutcome> {
  const adapter = getAdapterBySlug(slug);
  if (!adapter) return { status: 404, body: { ok: false, error: 'unknown_provider' } };
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return { status: 413, body: { ok: false, error: 'payload_too_large' } };
  if (!adapter.isConfigured()) return { status: 503, body: { ok: false, error: 'provider_not_configured' } };

  let event;
  try {
    event = await adapter.verifyWebhook({ headers, rawBody });
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      console.warn(`[webhooks] ${slug}: rejected (${err.message})`);
      return { status: 401, body: { ok: false, error: 'invalid_signature' } };
    }
    throw err;
  }

  const intent = event.providerRef
    ? await prisma.paymentIntent.findFirst({ where: { providerRef: event.providerRef, provider: adapter.id }, select: { id: true } })
    : null;

  let stored: { id: string; processedAt: Date | null };
  try {
    stored = await prisma.paymentProviderEvent.create({
      data: {
        provider: adapter.id,
        eventId: event.eventId.slice(0, 190),
        type: event.type?.slice(0, 120) ?? null,
        paymentIntentId: intent?.id ?? null,
        payload: (event.payload ?? { raw: rawBody.slice(0, 10_000) }) as Prisma.InputJsonValue,
        signatureVerified: event.signatureVerified,
      },
      select: { id: true, processedAt: true },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.paymentProviderEvent.findUnique({
      where: { provider_eventId: { provider: adapter.id, eventId: event.eventId.slice(0, 190) } },
      select: { id: true, processedAt: true },
    });
    if (!existing || existing.processedAt) return { status: 200, body: { ok: true, replayed: true } };
    stored = existing; // stored earlier but processing failed: try again (confirmation is idempotent)
  }

  if (!intent) {
    await prisma.paymentProviderEvent.update({
      where: { id: stored.id },
      data: { processedAt: new Date(), processingError: event.providerRef ? 'unknown_payment' : 'no_reference' },
    });
    if (event.providerRef) {
      await raisePaymentAlert({
        severity: 'MEDIUM',
        code: 'webhook_unknown_payment',
        title: `${adapter.displayName} webhook for an unknown payment reference`,
        details: { provider: adapter.id, providerRef: event.providerRef, eventId: event.eventId },
      });
    }
    return { status: 200, body: { ok: true, processed: false } };
  }

  try {
    await refreshPaymentIntent(intent.id, 'webhook');
    await prisma.paymentProviderEvent.update({ where: { id: stored.id }, data: { processedAt: new Date(), processingError: null } });
    return { status: 200, body: { ok: true, processed: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhooks] ${slug}: processing failed`, message);
    await prisma.paymentProviderEvent.update({ where: { id: stored.id }, data: { processingError: message.slice(0, 500) } });
    // 500 → the provider retries; the stored event is re-processed on the retry.
    return { status: 500, body: { ok: false, error: 'processing_failed' } };
  }
}
