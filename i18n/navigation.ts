import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation. ALWAYS import Link/useRouter/usePathname/redirect from
 * here (never from next/link or next/navigation) so the locale prefix is kept.
 * Paths are written without locale: <Link href="/cart">.
 */
export const { Link, redirect, usePathname, useRouter, getPathname, permanentRedirect } = createNavigation(routing);
