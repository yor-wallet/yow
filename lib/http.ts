import { NextResponse } from 'next/server';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { IdempotencyError } from './idempotency';
import { fieldErrorsOf, idempotencyKeySchema } from './validation';

/**
 * JSON API helpers for route handlers (`app/api/**`). Prefer server actions for
 * first-party UI mutations; use API routes for webhooks, cron, file downloads and
 * client-side fetches.
 *
 *   export const POST = apiHandler(async (req) => {
 *     const body = await parseJson(req, schema);
 *     return json({ ok: true });
 *   }, { sameOrigin: true });
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(data, init);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function jsonError(status: number, code: string, message?: string, details?: unknown): NextResponse {
  return json({ ok: false, error: { code, message: message ?? code, ...(details !== undefined ? { details } : {}) } }, { status });
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function allowedOrigins(req: Request): Set<string> {
  const set = new Set<string>();
  if (process.env.APP_URL) {
    try {
      set.add(new URL(process.env.APP_URL).origin);
    } catch {
      /* ignore */
    }
  }
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
    set.add(`${proto}://${host}`);
  }
  set.add(new URL(req.url).origin);
  return set;
}

/**
 * CSRF defence for cookie-authenticated API mutations: the `Origin` header must be
 * our own origin (or `Sec-Fetch-Site: same-origin` when Origin is absent).
 * Do NOT use on webhooks (server-to-server; verify signatures instead).
 * Server actions already get an equivalent built-in check from Next.js.
 */
export function assertSameOrigin(req: Request): void {
  if (!MUTATING.has(req.method.toUpperCase())) return;
  const origin = req.headers.get('origin');
  if (origin) {
    if (!allowedOrigins(req).has(origin)) throw new HttpError(403, 'bad_origin', 'Cross-origin request rejected');
    return;
  }
  const site = req.headers.get('sec-fetch-site');
  if (site === 'same-origin') return;
  throw new HttpError(403, 'bad_origin', 'Missing Origin header');
}

/** Parse and validate a JSON body. 400 on malformed JSON, 422 with field errors on validation failure. */
export async function parseJson<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(422, 'validation_failed', 'Validation failed', fieldErrorsOf(r.error));
  return r.data;
}

/** Read and validate the `Idempotency-Key` header (required on payment/order mutations). */
export function requireIdempotencyKey(req: Request): string {
  const r = idempotencyKeySchema.safeParse(req.headers.get('idempotency-key') ?? '');
  if (!r.success) throw new HttpError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required');
  return r.data;
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) return jsonError(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) return jsonError(422, 'validation_failed', 'Validation failed', fieldErrorsOf(err));
  if (err instanceof IdempotencyError) return jsonError(409, `idempotency_${err.code}`);
  console.error('[api] unhandled error', err);
  return jsonError(500, 'internal_error', 'Internal error');
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response> | Response;

/** Wrap a route handler: optional same-origin check, uniform JSON errors, no-store. */
export function apiHandler<C = { params: Promise<Record<string, string | string[]>> }>(
  handler: Handler<C>,
  opts: { sameOrigin?: boolean } = {},
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    try {
      if (opts.sameOrigin) assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
