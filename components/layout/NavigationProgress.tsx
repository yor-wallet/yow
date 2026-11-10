'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

type Phase = 'idle' | 'loading' | 'done';

/** Wait this long before showing the bar, so instant navigations never flash it. */
const SHOW_AFTER_MS = 120;
/** Never leave the bar on screen if a navigation is cancelled or fails. */
const GIVE_UP_AFTER_MS = 10_000;

/**
 * Thin progress bar at the very top while a page is loading. It starts when an in-site link is
 * activated and completes when the URL has changed. Decorative (aria-hidden): the page title and
 * focus management announce the navigation itself.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);
  const pending = useRef(false);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download') || a.getAttribute('aria-disabled') === 'true') return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      clearTimers();
      pending.current = true;
      timers.current.push(window.setTimeout(() => pending.current && setPhase('loading'), SHOW_AFTER_MS));
      timers.current.push(
        window.setTimeout(() => {
          pending.current = false;
          setPhase('idle');
        }, GIVE_UP_AFTER_MS),
      );
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      clearTimers();
    };
  }, []);

  // The URL changed: the new page is on screen.
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    clearTimers();
    setPhase((p) => (p === 'loading' ? 'done' : 'idle'));
    timers.current.push(window.setTimeout(() => setPhase('idle'), 320));
  }, [pathname, search]);

  if (phase === 'idle') return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[95] h-[3px]" data-testid="nav-progress" data-phase={phase}>
      <div className={phase === 'loading' ? 'nav-progress-run' : 'nav-progress-done'} />
    </div>
  );
}
