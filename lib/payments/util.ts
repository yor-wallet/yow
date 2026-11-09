import { createHmac } from 'node:crypto';
import { sha256Hex, timingSafeEqualString } from '@/lib/crypto';
import { ProviderError } from './types';

/** Public base URL of the site (no trailing slash) for provider return/webhook URLs. */
export function appBaseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function payReturnUrl(locale: string, intentId: string, extra = ''): string {
  return `${appBaseUrl()}/${locale}/pay/${encodeURIComponent(intentId)}${extra}`;
}

export function webhookUrl(slug: string): string {
  return `${appBaseUrl()}/api/webhooks/${slug}`;
}

export function hmacSha256Hex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

/** Constant-time compare of a hex HMAC (accepts an optional `sha256=` prefix, case-insensitive). */
export function verifyHmacHex(secret: string, data: string, provided: string | null | undefined): boolean {
  if (!provided) return false;
  const clean = provided.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) return false;
  return timingSafeEqualString(hmacSha256Hex(secret, data), clean);
}

/** Replay key for providers that do not send an event id. */
export function bodyEventId(rawBody: string): string {
  return `sha256:${sha256Hex(rawBody)}`;
}

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function pick(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null;
}

/** fetch() with timeout, JSON in/out, and ProviderError on network/HTTP failures. */
export async function providerFetch<T = unknown>(
  provider: string,
  url: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
      cache: 'no-store',
    });
  } catch (err) {
    throw new ProviderError(provider, 'network_error', err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  const data = (text ? safeJsonParse(text) : null) as T;
  if (!res.ok) {
    const desc = str(pick(data, 'description')) ?? str(pick(data, 'message')) ?? str(pick(data, 'error')) ?? res.statusText;
    throw new ProviderError(provider, 'http_error', `${provider} HTTP ${res.status}: ${desc}`, res.status);
  }
  return { status: res.status, data };
}
