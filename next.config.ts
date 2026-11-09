import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const isDev = process.env.NODE_ENV !== 'production';

/** Extra origins allowed for images/media (e.g. Supabase storage public URLs). */
function storageOrigins(): string[] {
  const out: string[] = [];
  if (process.env.SUPABASE_URL) {
    try {
      out.push(new URL(process.env.SUPABASE_URL).origin);
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

/**
 * Content-Security-Policy.
 * Next.js App Router injects inline bootstrap scripts, so `'unsafe-inline'` is
 * required for scripts unless a nonce-based middleware is introduced. Everything
 * else is locked to self. Payment providers that need redirects/iframes must be
 * added explicitly here (see docs/ARCHITECTURE.md → Security headers).
 */
function contentSecurityPolicy(): string {
  const media = storageOrigins().join(' ');
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': `'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    'style-src': "'self' 'unsafe-inline'",
    'img-src': `'self' data: blob: ${media}`.trim(),
    'media-src': `'self' blob: ${media}`.trim(),
    'font-src': "'self' data:",
    'connect-src': `'self'${isDev ? ' ws: wss:' : ''}`,
    'worker-src': "'self' blob:",
    'manifest-src': "'self'",
    'frame-src': "'self'",
    'frame-ancestors': "'none'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
  };
  const csp = Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');
  return isDev ? csp : `${csp}; upgrade-insecure-requests`;
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(self), geolocation=(self), microphone=(), payment=(self), usb=(), serial=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [320, 375, 430, 640, 768, 1024, 1280, 1600, 1920, 2560],
    imageSizes: [32, 48, 64, 96, 128, 160, 200, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: storageOrigins().map((origin) => {
      const u = new URL(origin);
      return { protocol: u.protocol.replace(':', '') as 'https' | 'http', hostname: u.hostname, pathname: '/storage/v1/object/public/**' };
    }),
  },
  experimental: {
    // KYC documents / campaign media are uploaded through server actions.
    serverActions: { bodySizeLimit: '12mb' },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/(brand|icons)/:path*',
        // Not `immutable`: file names are stable, so allow revalidation if the brand pipeline re-runs.
        headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000, stale-while-revalidate=86400' }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
