'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Horizontal scroller with snap points and Previous/Next buttons (md+; touch users swipe).
 * RTL-aware: scroll offsets are negative in RTL, so the sign is flipped.
 */
export function RailScroller({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const t = useTranslations('catalog.rail');
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    setEdges({ start: pos <= 2, end: max - pos <= 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div className={cn('relative', className)}>
      <ul
        ref={ref}
        data-scroll-x
        aria-label={label}
        onScroll={measure}
        className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-ps-4 px-4 pb-2 sm:gap-4 lg:mx-0 lg:scroll-ps-0 lg:px-0"
      >
        {children}
      </ul>
      <div className="pointer-events-none absolute inset-y-0 -inset-x-3 hidden items-center justify-between lg:flex">
        <button
          type="button"
          onClick={() => scroll(-1)}
          disabled={edges.start}
          aria-label={t('previous')}
          className="pointer-events-auto grid size-11 place-items-center rounded-full border border-border-strong bg-bg/90 text-fg shadow-float backdrop-blur transition-opacity hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft size={22} aria-hidden="true" className="flip-rtl" />
        </button>
        <button
          type="button"
          onClick={() => scroll(1)}
          disabled={edges.end}
          aria-label={t('next')}
          className="pointer-events-auto grid size-11 place-items-center rounded-full border border-border-strong bg-bg/90 text-fg shadow-float backdrop-blur transition-opacity hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronRight size={22} aria-hidden="true" className="flip-rtl" />
        </button>
      </div>
    </div>
  );
}
