import { ProviderError, WebhookSignatureError } from '@/lib/payments/types';
import { bodyEventId, pick, providerFetch, safeJsonParse, str, verifyHmacHex } from '@/lib/payments/util';

/**
 * Optional DOOM FLEX finance partner (licensed instalment / consumer-finance company).
 *
 * Without a partner (default) DOOM self-finances: a FINANCE/ADMIN user approves or rejects
 * each application in the admin centre (`decideFlexApplication`). With a partner configured,
 * new applications are forwarded to the partner and its signed decision webhook
 * (`POST /api/webhooks/flex-partner`) records the decision; staff can still review.
 *
 * Env: FLEX_PARTNER_NAME, FLEX_PARTNER_API_URL, FLEX_PARTNER_API_KEY, FLEX_PARTNER_WEBHOOK_SECRET.
 * Contract (map to the partner's API when contracting):
 *   POST {api}/v1/applications  { reference, principalBaisa, currency: 'OMR', months, customer: { id, fullName, phone, email, kycVerified } }
 *        → { id, status }
 *   Webhook `X-Signature: sha256=<hex HMAC-SHA256(rawBody)>` body { eventId, reference, applicationId, decision: APPROVED|REJECTED, note? }
 */

function env() {
  return {
    name: process.env.FLEX_PARTNER_NAME?.trim() || '',
    url: (process.env.FLEX_PARTNER_API_URL?.trim() || '').replace(/\/+$/, ''),
    apiKey: process.env.FLEX_PARTNER_API_KEY?.trim() || '',
    webhookSecret: process.env.FLEX_PARTNER_WEBHOOK_SECRET?.trim() || '',
  };
}

export function isFlexPartnerConfigured(): boolean {
  const e = env();
  return !!(e.name && e.url && e.apiKey && e.webhookSecret);
}

export function flexPartnerName(): string | null {
  return isFlexPartnerConfigured() ? env().name : null;
}

export async function submitToPartner(app: {
  id: string;
  principalBaisa: number;
  months: number;
  customer: { id: string; fullName: string; phone: string | null; email: string; kycVerified: boolean };
}): Promise<{ partnerRef: string }> {
  const e = env();
  if (!isFlexPartnerConfigured()) throw new ProviderError('flex-partner', 'not_configured');
  const { data } = await providerFetch<{ id?: string }>('flex-partner', `${e.url}/v1/applications`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${e.apiKey}`, 'Idempotency-Key': app.id },
    body: { reference: app.id, principalBaisa: app.principalBaisa, currency: 'OMR', months: app.months, customer: app.customer },
  });
  const partnerRef = str(data?.id);
  if (!partnerRef) throw new ProviderError('flex-partner', 'api_error', 'Partner returned no application id');
  return { partnerRef };
}

export type PartnerDecisionEvent = {
  eventId: string;
  reference: string | null;
  partnerRef: string | null;
  decision: 'APPROVED' | 'REJECTED' | null;
  note: string | null;
  payload: unknown;
};

export function verifyPartnerWebhook(headers: Headers, rawBody: string): PartnerDecisionEvent {
  const e = env();
  if (!e.webhookSecret || !verifyHmacHex(e.webhookSecret, rawBody, headers.get('x-signature'))) {
    throw new WebhookSignatureError('flex-partner');
  }
  const payload = safeJsonParse(rawBody);
  const decision = (str(pick(payload, 'decision')) ?? '').toUpperCase();
  return {
    eventId: `flex-partner:${str(pick(payload, 'eventId')) ?? bodyEventId(rawBody)}`,
    reference: str(pick(payload, 'reference')),
    partnerRef: str(pick(payload, 'applicationId')),
    decision: decision === 'APPROVED' || decision === 'REJECTED' ? decision : null,
    note: str(pick(payload, 'note')),
    payload,
  };
}
