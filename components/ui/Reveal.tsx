'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { LazyMotion, domAnimation, m } from 'motion/react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * `prefers-reduced-motion` that is hydration-safe: the server snapshot is always `false`, so the
 * first client render matches the server HTML exactly; React then re-renders with the real value
 * (no hydration mismatch, no element stuck at `opacity: 0`).
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Scroll reveal (fade + slide-up) using `motion/react` with lazy-loaded features.
 * Reduced motion → content rendered immediately with no transform. The server HTML carries the
 * hidden start state, so `[data-reveal]` is forced visible for reduced-motion users in globals.css
 * (before JavaScript has hydrated); after hydration the static branch below takes over.
 * Do NOT wrap the LCP element (hero image/title) — it would delay paint.
 * Stagger lists by passing `delay={index * 0.06}`.
 */
export function Reveal({
  children,
  delay = 0,
  y = 16,
  className,
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  const reduce = usePrefersReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        data-reveal=""
        className={className}
        initial={{ opacity: 0, y }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once, margin: '0px 0px -8% 0px' }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1], delay }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
