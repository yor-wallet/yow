import { isBaisa } from '@/lib/money';
import {
  ProviderError,
  WebhookSignatureError,
  type CreatePaymentResult,
  type ProviderAdapter,
  type ProviderPaymentInput,
  type ProviderStatus,
  type RefundResult,
  type WebhookEvent,
} from '../types';
import { bodyEventId, pick, providerFetch, safeJsonParse, str, verifyHmacHex } from '../util';

/**
 * CARD payments (Visa / Mastercard / local debit cards) through **Thawani Pay**, an Omani
 * payment gateway licensed by the Central Bank of Oman. Amounts are integer baisa.
 *
 * Env:
 *   THAWANI_SECRET_KEY        secret API key (header `thawani-api-key`)
 *   THAWANI_PUBLISHABLE_KEY   publishable key (hosted checkout redirect `?key=`)
 *   THAWANI_BASE_URL          UAT `https://uatcheckout.thawani.om` | prod `https://checkout.thawani.om`
 *   THAWANI_WEBHOOK_SECRET    (optional) webhook signing secret — enables signature checks
 *
 * API (Thawani Checkout v1):
 *   POST {base}/api/v1/checkout/session            create a session (client_reference_id = intent id)
 *   GET  {base}/api/v1/checkout/session/{id}       retrieve → `payment_status` = paid | unpaid | cancelled
 *   redirect {base}/pay/{session_id}?key={publishable_key}
 *   GET  {base}/api/v1/payments?checkout_invoice=… list payments of a session (for refunds)
 *   POST {base}/api/v1/refunds                      refund a payment (full amount)
 *
 * A payment is NEVER confirmed from a redirect or a webhook payload: the core re-fetches
 * the session and requires `payment_status = paid` AND `total_amount` = intent amount.
 */

export const THAWANI_UAT_URL = 'https://uatcheckout.thawani.om';
export const THAWANI_MIN_AMOUNT_BAISA = 100;

type ThawaniEnvelope<T> = { success?: boolean; code?: number; description?: string; data?: T };
type ThawaniSession = {
  session_id?: string;
  client_reference_id?: string;
  total_amount?: number;
  payment_status?: string;
  invoice?: string;
  expire_at?: string;
  currency?: string;
};
type ThawaniPayment = { payment_id?: string; amount?: number; status?: string };
type ThawaniRefund = { refund_id?: string; status?: string };

function env() {
  return {
    secret: process.env.THAWANI_SECRET_KEY?.trim() || '',
    publishable: process.env.THAWANI_PUBLISHABLE_KEY?.trim() || '',
    base: (process.env.THAWANI_BASE_URL?.trim() || '').replace(/\/+$/, ''),
    webhookSecret: process.env.THAWANI_WEBHOOK_SECRET?.trim() || '',
  };
}

function requireEnv() {
  const e = env();
  if (!e.secret || !e.publishable || !e.base) throw new ProviderError('thawani', 'not_configured', 'Thawani Pay is not configured');
  return e;
}

function headers(secret: string) {
  return { 'thawani-api-key': secret };
}

function assertSuccess<T>(body: ThawaniEnvelope<T> | null, what: string): T {
  if (!body || body.success === false || !body.data) {
    throw new ProviderError('thawani', 'api_error', `Thawani ${what} failed: ${body?.description ?? 'empty response'} (code ${body?.code ?? '?'})`);
  }
  return body.data;
}

/** Product names are limited by the gateway; keep ASCII-safe and short. */
function productName(description: string): string {
  const clean = description.replace(/[^\p{L}\p{N} .,'#:/()-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return (clean || 'DOOM payment').slice(0, 40);
}

export const thawaniAdapter: ProviderAdapter = {
  id: 'CARD',
  slug: 'thawani',
  displayName: 'Thawani Pay',
  unavailableReason: 'not_configured',
  minAmountBaisa: THAWANI_MIN_AMOUNT_BAISA,

  isConfigured() {
    const e = env();
    return !!(e.secret && e.publishable && e.base);
  },

  async createPayment(input: ProviderPaymentInput): Promise<CreatePaymentResult> {
    const e = requireEnv();
    if (!isBaisa(input.amountBaisa) || input.amountBaisa < THAWANI_MIN_AMOUNT_BAISA) {
      throw new ProviderError('thawani', 'amount_too_small', `Thawani requires at least ${THAWANI_MIN_AMOUNT_BAISA} baisa`);
    }
    const { data } = await providerFetch<ThawaniEnvelope<ThawaniSession>>('thawani', `${e.base}/api/v1/checkout/session`, {
      method: 'POST',
      headers: headers(e.secret),
      body: {
        client_reference_id: input.intentId,
        mode: 'payment',
        products: [{ name: productName(input.description), quantity: 1, unit_amount: input.amountBaisa }],
        success_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        metadata: { intent_id: input.intentId, purpose: input.purpose, customer_id: input.customer.id },
      },
    });
    const session = assertSuccess(data, 'session creation');
    if (!session.session_id) throw new ProviderError('thawani', 'api_error', 'Thawani returned no session_id');
    if (typeof session.total_amount === 'number' && session.total_amount !== input.amountBaisa) {
      throw new ProviderError('thawani', 'amount_mismatch', `Session amount ${session.total_amount} != ${input.amountBaisa}`);
    }
    const expiresAt = session.expire_at ? new Date(session.expire_at) : undefined;
    return {
      providerRef: session.session_id,
      redirectUrl: `${e.base}/pay/${encodeURIComponent(session.session_id)}?key=${encodeURIComponent(e.publishable)}`,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : undefined,
    };
  },

  async fetchStatus(providerRef: string): Promise<ProviderStatus> {
    const e = requireEnv();
    const { data } = await providerFetch<ThawaniEnvelope<ThawaniSession>>(
      'thawani',
      `${e.base}/api/v1/checkout/session/${encodeURIComponent(providerRef)}`,
      { headers: headers(e.secret) },
    );
    const s = assertSuccess(data, 'session retrieval');
    if (s.session_id && s.session_id !== providerRef) {
      throw new ProviderError('thawani', 'ref_mismatch', 'Thawani returned another session');
    }
    const ps = (s.payment_status ?? '').toLowerCase();
    const amount = typeof s.total_amount === 'number' && isBaisa(s.total_amount) ? s.total_amount : undefined;
    const base = { clientReference: s.client_reference_id ?? null, raw: s };
    if (ps === 'paid') {
      if (s.currency && s.currency.toUpperCase() !== 'OMR') return { status: 'failed', ...base };
      return { status: 'paid', amountBaisa: amount, ...base };
    }
    if (ps === 'cancelled' || ps === 'canceled') return { status: 'cancelled', ...base };
    if (s.expire_at && new Date(s.expire_at).getTime() < Date.now()) return { status: 'expired', ...base };
    return { status: 'pending', ...base };
  },

  async verifyWebhook({ headers: h, rawBody }): Promise<WebhookEvent> {
    const { webhookSecret } = env();
    const signature = h.get('thawani-signature');
    const timestamp = h.get('thawani-timestamp');
    let verified = false;
    if (webhookSecret) {
      // Thawani signs `${rawBody}-${timestamp}` with HMAC-SHA256 (hex).
      if (!signature || !timestamp || !verifyHmacHex(webhookSecret, `${rawBody}-${timestamp}`, signature)) {
        throw new WebhookSignatureError('thawani');
      }
      const ts = Number(timestamp);
      if (Number.isFinite(ts)) {
        const ms = ts > 1e12 ? ts : ts * 1000;
        if (Math.abs(Date.now() - ms) > 15 * 60_000) throw new WebhookSignatureError('thawani', 'Stale webhook timestamp');
      }
      verified = true;
    }
    const payload = safeJsonParse(rawBody);
    const providerRef =
      str(pick(payload, 'data', 'session_id')) ??
      str(pick(payload, 'session_id')) ??
      str(pick(payload, 'data', 'checkout_session_id')) ??
      null;
    const eventId = str(pick(payload, 'id')) ?? str(pick(payload, 'event_id')) ?? str(pick(payload, 'data', 'id')) ?? bodyEventId(rawBody);
    const type = str(pick(payload, 'event_type')) ?? str(pick(payload, 'type'));
    return { eventId: `thawani:${eventId}`, type, providerRef, signatureVerified: verified, payload };
  },

  supportsRefund() {
    return this.isConfigured();
  },

  /** Full refund of a paid session (Thawani refunds whole payments). */
  async refund({ providerRef, amountBaisa, reason }): Promise<RefundResult> {
    const e = requireEnv();
    const session = await providerFetch<ThawaniEnvelope<ThawaniSession>>(
      'thawani',
      `${e.base}/api/v1/checkout/session/${encodeURIComponent(providerRef)}`,
      { headers: headers(e.secret) },
    );
    const s = assertSuccess(session.data, 'session retrieval');
    if ((s.payment_status ?? '').toLowerCase() !== 'paid' || !s.invoice) {
      throw new ProviderError('thawani', 'not_refundable', 'Session is not paid');
    }
    if (s.total_amount !== amountBaisa) throw new ProviderError('thawani', 'partial_refund_unsupported', 'Only full refunds are supported');
    const payments = await providerFetch<ThawaniEnvelope<ThawaniPayment[]>>(
      'thawani',
      `${e.base}/api/v1/payments?limit=10&skip=0&checkout_invoice=${encodeURIComponent(s.invoice)}`,
      { headers: headers(e.secret) },
    );
    const list = assertSuccess(payments.data, 'payment lookup');
    const payment = list.find((p) => (p.status ?? '').toLowerCase() === 'successful' || (p.status ?? '').toLowerCase() === 'paid') ?? list[0];
    if (!payment?.payment_id) throw new ProviderError('thawani', 'not_refundable', 'No payment found for the session');
    const res = await providerFetch<ThawaniEnvelope<ThawaniRefund>>('thawani', `${e.base}/api/v1/refunds`, {
      method: 'POST',
      headers: headers(e.secret),
      body: { payment_id: payment.payment_id, reason: reason.slice(0, 200) || 'Refund', metadata: { session_id: providerRef } },
    });
    const refund = assertSuccess(res.data, 'refund');
    return { providerRef: refund.refund_id ?? payment.payment_id };
  },
};
