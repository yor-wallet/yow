'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Marks its content with `data-inview="true"` the first time it enters the viewport, so CSS can play an
 * entrance once (see `.promo-enter` in globals.css). The server HTML is already visible: without
 * JavaScript, or with reduced motion, nothing is ever hidden.
 */
export function InView({ children, className, delayMs = 0 }: { children: ReactNode; className?: string; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'ssr' | 'waiting' | 'in'>('ssr');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setState('in');
      return;
    }
    setState('waiting');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('in');
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} data-inview={state === 'in' ? 'true' : state === 'waiting' ? 'false' : undefined} style={delayMs ? { ['--promo-delay' as string]: `${delayMs}ms` } : undefined}>
      {children}
    </div>
  );
}
