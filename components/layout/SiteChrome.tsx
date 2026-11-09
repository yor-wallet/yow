'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/i18n/navigation';

/** Routes rendered WITHOUT the storefront chrome (they provide their own shell). */
const BARE_ROUTES = [/^\/admin(\/|$)/];

/**
 * Wraps page content with the storefront header/footer/bottom nav, except on bare
 * routes (admin centre builds its own shell in app/[locale]/admin/layout.tsx).
 */
export function SiteChrome({
  header,
  footer,
  bottomNav,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  bottomNav: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.some((r) => r.test(pathname));
  return (
    <>
      {bare ? null : header}
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      {bare ? null : footer}
      {bare ? null : bottomNav}
    </>
  );
}
