'use client';

import { useEffect } from 'react';

/**
 * Feeds the pointer position to the hovered `[data-spotlight]` element as CSS variables
 * (--mx / --my) for the `spotlight` utility. One passive delegated listener, rAF-throttled,
 * fine pointers only (no work at all on touch devices).
 */
export function SpotlightTracker() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const el = (e.target as Element | null)?.closest?.('[data-spotlight]') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
