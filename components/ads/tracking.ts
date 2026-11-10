'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Campaign statistics, recorded server-side (`POST /api/campaigns/[id]/track`).
 * - Impression: the ad was at least 50 % visible; counted ONCE per tab session per campaign.
 * - Click: every click on the ad's call to action.
 * Fire-and-forget: statistics never block navigation and never break the page.
 */

const IMPRESSION_KEY = (id: string) => `doom:ad-imp:${id}`;

export function trackCampaign(id: string, type: 'impression' | 'click'): void {
  try {
    if (type === 'impression') {
      if (sessionStorage.getItem(IMPRESSION_KEY(id))) return;
      sessionStorage.setItem(IMPRESSION_KEY(id), '1');
    }
    const url = `/api/campaigns/${encodeURIComponent(id)}/track`;
    const body = new Blob([JSON.stringify({ type })], { type: 'application/json' });
    if (!navigator.sendBeacon?.(url, body)) {
      void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
    }
  } catch {
    /* storage disabled / beacon refused: statistics are best effort */
  }
}

/** True while at least `threshold` of the element is inside the viewport (and the tab is visible). */
export function useVisibleRatio(ref: RefObject<Element | null>, threshold = 0.5): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let inView = false;
    const update = () => setVisible(inView && document.visibilityState === 'visible');
    const io = new IntersectionObserver(
      ([entry]) => {
        inView = !!entry && entry.isIntersecting && entry.intersectionRatio >= threshold - 0.001;
        update();
      },
      { threshold: [0, threshold, 1] },
    );
    io.observe(el);
    document.addEventListener('visibilitychange', update);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [ref, threshold]);
  return visible;
}

/** Records one impression when the element is ≥ 50 % visible (once per session per campaign). */
export function useCampaignImpression(ref: RefObject<Element | null>, campaignId: string, enabled = true): void {
  const visible = useVisibleRatio(ref, 0.5);
  useEffect(() => {
    if (enabled && visible) trackCampaign(campaignId, 'impression');
  }, [enabled, visible, campaignId]);
}

export type MotionPrefs = {
  /** `prefers-reduced-motion: reduce`. */
  reduced: boolean;
  /** Low-power mode: reduced motion, Save-Data, or a low-end device (≤ 4 logical cores). */
  lite: boolean;
  /** False during SSR / before the first client effect (render the static, complete state). */
  ready: boolean;
};

type NavigatorWithConnection = Navigator & { connection?: { saveData?: boolean } };

export function useMotionPrefs(): MotionPrefs {
  const [prefs, setPrefs] = useState<MotionPrefs>({ reduced: false, lite: false, ready: false });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const nav = navigator as NavigatorWithConnection;
    const apply = () => {
      const reduced = mq.matches;
      const saveData = !!nav.connection?.saveData;
      const lowEnd = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4;
      setPrefs({ reduced, lite: reduced || saveData || lowEnd, ready: true });
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return prefs;
}
