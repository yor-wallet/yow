'use client';

import { usePathname } from '@/i18n/navigation';
import { BackButton } from './BackButton';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useBackTarget } from './back-target';

/** Start slot of the phone band: language on the home page, the back arrow on every other page. */
export function MobileHeaderStart() {
  const pathname = usePathname();
  const target = useBackTarget();
  if (pathname === '/') return <LocaleSwitcher variant="sheet" />;
  return <BackButton fallbackHref={target ?? '/'} variant="icon" />;
}
