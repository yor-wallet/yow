'use client';

import { useEffect } from 'react';

/**
 * Feeds the pointer position to the hovered `[data-spotlight]` element as CSS variables
 * (--mx / --my) for the `spotlight` utility, and a small 3D tilt (--rx / --ry, degrees) to the
 * hovered `[data-tilt]` element for the `tilt-3d` utility. One passive delegated listener,
 * rAF-throttled, fine pointers only (no work at all on touch devices), no tilt with reduced motion.
 */
export function SpotlightTracker() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const tiltAllowed = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const MAX_TILT = 5; // degrees
    let tilted: HTMLElement | null = null;
    const untilt = () => {
      if (!tilted) return;
      tilted.style.removeProperty('--rx');
      tilted.style.removeProperty('--ry');
      tilted = null;
    };
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const target = e.target as Element | null;
      const el = target?.closest?.('[data-spotlight]') as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
      const tilt = tiltAllowed ? ((target?.closest?.('[data-tilt]') as HTMLElement | null) ?? null) : null;
      if (tilt !== tilted) untilt();
      if (tilt) {
        const r = tilt.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty('--ry', `${(px * 2 * MAX_TILT).toFixed(2)}deg`);
        tilt.style.setProperty('--rx', `${(-py * 2 * MAX_TILT).toFixed(2)}deg`);
        tilted = tilt;
      }
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', untilt);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', untilt);
      untilt();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
