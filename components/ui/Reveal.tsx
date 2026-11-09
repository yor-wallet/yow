'use client';

import type { ReactNode } from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';

/**
 * Scroll reveal (fade + slide-up) using `motion/react` with lazy-loaded features.
 * Reduced motion → content rendered immediately with no transform.
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
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
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
