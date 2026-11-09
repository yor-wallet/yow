import { formatOmrNumber, parseOmrToBaisa } from '@/lib/money';
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
 * Crypto payments (BTC, ETH, USDT, USDC) through a LICENSED crypto payment processor using a
 * hosted-invoice model: the invoice is priced in OMR, the customer pays in crypto on the
 * processor's page, the processor converts and reports the settled OMR value.
 * DOOM never holds keys or custody, and credits ONLY the provider-confirmed settled OMR value.
 *
 * Env:
 *   CRYPTO_PROVIDER         processor name (shown to staff; required)
 *   CRYPTO_API_URL          processor API base URL
 *   CRYPTO_API_KEY          API key (`Authorization: Bearer …`)
 *   CRYPTO_WEBHOOK_SECRET   HMAC-SHA256 secret for notifications
 *
 * Contract (map to the processor's API when contracting):
 *   POST {api}/v1/invoices        { reference, amount: "12.345", currency: "OMR", acceptedAssets, description,
 *                                   successUrl, cancelUrl, notificationUrl } → { id, hostedUrl, expiresAt? }
 *   GET  {api}/v1/invoices/{id}   → { id, reference, status: new|pending|confirming|settled|expired|invalid,
 *                                     settledAmount: "12.345", settledCurrency: "OMR", asset, network, txHash }
 *   Webhook header `X-Signature: sha256=<hex HMAC-SHA256(rawBody)>`, body { id|eventId, type, invoiceId }
 */

export const CRYPTO_ASSETS = ['BTC', 'ETH', 'USDT', 'USDC'] as const;

type Invoice = {
  id?: string;
  reference?: string;
  status?: string;
  hostedUrl?: string;
  url?: string;
  expiresAt?: string;
  settledAmount?: string | number;
  settledCurrency?: string;
};

function env() {
  return {
    provider: process.env.CRYPTO_PROVIDER?.trim() || '',
    url: (process.env.CRYPTO_API_URL?.trim() || '').replace(/\/+$/, ''),
    apiKey: process.env.CRYPTO_API_KEY?.trim() || '',
    webhookSecret: process.env.CRYPTO_WEBHOOK_SECRET?.trim() || '',
  };
}

function requireEnv() {
  const e = env();
  if (!e.provider || !e.url || !e.apiKey || !e.webhookSecret) {
    throw new ProviderError('crypto', 'not_configured', 'No licensed crypto processor is configured');
  }
  return e;
}

export function mapCryptoStatus(raw: string | undefined): ProviderStatus['status'] {
  const s = (raw ?? '').toLowerCase();
  if (s === 'settled' || s === 'complete' || s === 'completed') return 'paid';
  if (s === 'expired') return 'expired';
  if (s === 'invalid' || s === 'failed' || s === 'refunded') return 'failed';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  return 'pending'; // new | pending | confirming | paid-but-unconfirmed
}

export const cryptoAdapter: ProviderAdapter = {
  id: 'CRYPTO',
  slug: 'crypto',
  displayName: 'Crypto (licensed processor)',
  unavailableReason: 'licensed_processor_required',
  minAmountBaisa: 1_000,

  isConfigured() {
    const e = env();
    return !!(e.provider && e.url && e.apiKey && e.webhookSecret);
  },

  async createPayment(input: ProviderPaymentInput): Promise<CreatePaymentResult> {
    const e = requireEnv();
    const { data } = await providerFetch<Invoice>('crypto', `${e.url}/v1/invoices`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${e.apiKey}`, 'Idempotency-Key': input.intentId },
      body: {
        reference: input.intentId,
        amount: formatOmrNumber(input.amountBaisa, 'en').replace(/,/g, ''),
        currency: 'OMR',
        acceptedAssets: CRYPTO_ASSETS,
        description: input.description.slice(0, 80),
        successUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        notificationUrl: input.webhookUrl,
      },
    });
    const providerRef = str(data?.id);
    const redirectUrl = str(data?.hostedUrl) ?? str(data?.url);
    if (!providerRef || !redirectUrl) throw new ProviderError('crypto', 'api_error', 'Processor returned no invoice id / hosted URL');
    const expiresAt = data?.expiresAt ? new Date(data.expiresAt) : undefined;
    return { providerRef, redirectUrl, expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : undefined };
  },

  async fetchStatus(providerRef: string): Promise<ProviderStatus> {
    const e = requireEnv();
    const { data } = await providerFetch<Invoice>('crypto', `${e.url}/v1/invoices/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Bearer ${e.apiKey}` },
    });
    const status = mapCryptoStatus(data?.status);
    const clientReference = data?.reference ?? null;
    if (status !== 'paid') return { status, clientReference, raw: data };
    // Credit only the provider-reported settled value in OMR.
    if ((data?.settledCurrency ?? '').toUpperCase() !== 'OMR' || data?.settledAmount === undefined) {
      return { status: 'pending', clientReference, raw: data };
    }
    const baisa = parseOmrToBaisa(String(data.settledAmount), 'en');
    if (baisa === null || baisa <= 0) return { status: 'pending', clientReference, raw: data };
    return { status: 'paid', amountBaisa: baisa, clientReference, raw: data };
  },

  async verifyWebhook({ headers, rawBody }): Promise<WebhookEvent> {
    const e = env();
    if (!e.webhookSecret || !verifyHmacHex(e.webhookSecret, rawBody, headers.get('x-signature'))) {
      throw new WebhookSignatureError('crypto');
    }
    const payload = safeJsonParse(rawBody);
    const eventId = str(pick(payload, 'eventId')) ?? str(pick(payload, 'id')) ?? bodyEventId(rawBody);
    return {
      eventId: `crypto:${eventId}`,
      type: str(pick(payload, 'type')),
      providerRef: str(pick(payload, 'invoiceId')) ?? str(pick(payload, 'data', 'id')),
      signatureVerified: true,
      payload,
    };
  },
};
