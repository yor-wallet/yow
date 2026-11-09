import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale routing only (`/` → `/ar` etc., NEXT_LOCALE cookie, Accept-Language).
 * Auth/RBAC is enforced server-side in pages, actions and route handlers
 * (lib/auth), never in middleware.
 */
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals, media served by route handlers and any file with an extension.
  matcher: ['/((?!api|_next|_vercel|media|.*\\..*).*)'],
};
