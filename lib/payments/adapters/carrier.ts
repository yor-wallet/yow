import { isBaisa } from '@/lib/money';
import {
  ProviderError,
  WebhookSignatureError,
  type CreatePaymentResult,
  type ProviderAdapter,
  type ProviderPaymentInput,
  type ProviderStatus,
  type WebhookEvent,
} from '../types';
import { bodyEventId, pick, providerFetch, safeJsonParse, str, verifyHmacHex } from '../util';

/**
 * Mobile carrier billing (Ooredoo Oman, Omantel) — "pay with your phone bill / balance".
 *
 * Carrier payment APIs are only issued with a signed merchant agreement, so this adapter
 * implements DOOM's integration contract; the field mapping is the only part to align with
 * the carrier's official specification once the agreement is signed (see docs/PAYMENTS.md).
 *
 * Env (per carrier, prefix OOREDOO_ / OMANTEL_):
 *   <P>_API_URL         base URL of the carrier merchant API
 *   <P>_MERCHANT_ID     merchant identifier issued by the carrier
 *   <P>_API_KEY         API key (sent as `Authorization: Bearer …`)
 *   <P>_WEBHOOK_SECRET  HMAC-SHA256 secret for payment notifications
 * Without all four, `isConfigured()` is false and the method is shown unavailable
 * ("requires a carrier merchant agreement") — never simulated.
 *
 * Contract:
 *   POST {api}/v1/payments              { merchantId, merchantReference, amount (baisa), currency: 'OMR', msisdn,
 *                                         description, returnUrl, callbackUrl } → { paymentId, status, redirectUrl?, instructions?, expiresAt? }
 *   GET  {api}/v1/payments/{paymentId}  → { paymentId, merchantReference, status, amount (baisa), currency }
 *   Webhook: header `X-Signature: sha256=<hex HMAC-SHA256(rawBody, WEBHOOK_SECRET)>`, body { eventId, type, paymentId, … }
 */

type CarrierConfig = { id: 'OOREDOO' | 'OMANTEL'; slug: string; displayName: string; envPrefix: string };

type CarrierPayment = {
  paymentId?: string;
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  merchantReference?: string;
  redirectUrl?: string;
  instructions?: string;
  expiresAt?: string;
};

const PAID = new Set(['SUCCEEDED', 'SUCCESS', 'PAID', 'COMPLETED', 'CHARGED']);
const FAILED = new Set(['FAILED', 'DECLINED', 'REJECTED', 'ERROR']);
const CANCELLED = new Set(['CANCELLED', 'CANCELED']);
const EXPIRED = new Set(['EXPIRED', 'TIMEOUT']);

export function mapCarrierStatus(raw: string | undefined): ProviderStatus['status'] {
  const s = (raw ?? '').toUpperCase();
  if (PAID.has(s)) return 'paid';
  if (FAILED.has(s)) return 'failed';
  if (CANCELLED.has(s)) return 'cancelled';
  if (EXPIRED.has(s)) return 'expired';
  return 'pending';
}

export function createCarrierAdapter(cfg: CarrierConfig): ProviderAdapter {
  const env = () => ({
    url: (process.env[`${cfg.envPrefix}_API_URL`]?.trim() || '').replace(/\/+$/, ''),
    merchantId: process.env[`${cfg.envPrefix}_MERCHANT_ID`]?.trim() || '',
    apiKey: process.env[`${cfg.envPrefix}_API_KEY`]?.trim() || '',
    webhookSecret: process.env[`${cfg.envPrefix}_WEBHOOK_SECRET`]?.trim() || '',
  });
  const requireEnv = () => {
    const e = env();
    if (!e.url || !e.merchantId || !e.apiKey || !e.webhookSecret) {
      throw new ProviderError(cfg.slug, 'not_configured', `${cfg.displayName} carrier billing is not configured`);
    }
    return e;
  };
  const authHeaders = (e: ReturnType<typeof env>) => ({ Authorization: `Bearer ${e.apiKey}`, 'X-Merchant-Id': e.merchantId });

  return {
    id: cfg.id,
    slug: cfg.slug,
    displayName: cfg.displayName,
    unavailableReason: 'carrier_agreement_required',
    minAmountBaisa: 100,

    isConfigured() {
      const e = env();
      return !!(e.url && e.merchantId && e.apiKey && e.webhookSecret);
    },

    async createPayment(input: ProviderPaymentInput): Promise<CreatePaymentResult> {
      const e = requireEnv();
      const { data } = await providerFetch<CarrierPayment>(cfg.slug, `${e.url}/v1/payments`, {
        method: 'POST',
        headers: { ...authHeaders(e), 'Idempotency-Key': input.intentId },
        body: {
          merchantId: e.merchantId,
          merchantReference: input.intentId,
          amount: input.amountBaisa,
          currency: 'OMR',
          msisdn: input.customer.phone,
          description: input.description.slice(0, 80),
          language: input.locale,
          returnUrl: input.returnUrl,
          callbackUrl: input.webhookUrl,
        },
      });
      const providerRef = str(data?.paymentId) ?? str(data?.id);
      if (!providerRef) throw new ProviderError(cfg.slug, 'api_error', `${cfg.displayName} returned no payment id`);
      if (typeof data?.amount === 'number' && data.amount !== input.amountBaisa) {
        throw new ProviderError(cfg.slug, 'amount_mismatch', 'Carrier echoed another amount');
      }
      const expiresAt = data?.expiresAt ? new Date(data.expiresAt) : undefined;
      return {
        providerRef,
        redirectUrl: str(data?.redirectUrl) ?? undefined,
        instructions: str(data?.instructions) ?? undefined,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : undefined,
      };
    },

    async fetchStatus(providerRef: string): Promise<ProviderStatus> {
      const e = requireEnv();
      const { data } = await providerFetch<CarrierPayment>(cfg.slug, `${e.url}/v1/payments/${encodeURIComponent(providerRef)}`, {
        headers: authHeaders(e),
      });
      const status = mapCarrierStatus(data?.status);
      if (status === 'paid' && data?.currency && data.currency.toUpperCase() !== 'OMR') {
        return { status: 'failed', clientReference: data?.merchantReference ?? null, raw: data };
      }
      return {
        status,
        amountBaisa: typeof data?.amount === 'number' && isBaisa(data.amount) ? data.amount : undefined,
        clientReference: data?.merchantReference ?? null,
        raw: data,
      };
    },

    async verifyWebhook({ headers, rawBody }): Promise<WebhookEvent> {
      const e = env();
      if (!e.webhookSecret || !verifyHmacHex(e.webhookSecret, rawBody, headers.get('x-signature'))) {
        throw new WebhookSignatureError(cfg.slug);
      }
      const payload = safeJsonParse(rawBody);
      const eventId = str(pick(payload, 'eventId')) ?? str(pick(payload, 'id')) ?? bodyEventId(rawBody);
      return {
        eventId: `${cfg.slug}:${eventId}`,
        type: str(pick(payload, 'type')) ?? str(pick(payload, 'event')),
        providerRef: str(pick(payload, 'paymentId')) ?? str(pick(payload, 'data', 'paymentId')),
        signatureVerified: true,
        payload,
      };
    },
  };
}

export const ooredooAdapter = createCarrierAdapter({ id: 'OOREDOO', slug: 'ooredoo', displayName: 'Ooredoo Oman', envPrefix: 'OOREDOO' });
export const omantelAdapter = createCarrierAdapter({ id: 'OMANTEL', slug: 'omantel', displayName: 'Omantel', envPrefix: 'OMANTEL' });
