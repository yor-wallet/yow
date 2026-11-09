import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** Extract the client IP from proxy headers (Vercel sets x-forwarded-for / x-real-ip). */
export function ipFromHeaders(h: Headers): string | null {
  const fwd = h.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = h.get('x-real-ip');
  return real ? real.trim().slice(0, 64) : null;
}

export function metaFromHeaders(h: Headers): RequestMeta {
  return { ip: ipFromHeaders(h), userAgent: h.get('user-agent')?.slice(0, 512) ?? null };
}

/** IP + user agent of the current request (server components, actions, route handlers). Safe outside a request: returns nulls. */
export async function getRequestMeta(): Promise<RequestMeta> {
  try {
    return metaFromHeaders(await headers());
  } catch (err) {
    unstable_rethrow(err);
    return { ip: null, userAgent: null };
  }
}
