/**
 * In-app history depth tracking (client only).
 *
 * Every history entry created by this tab while on the site carries an index in
 * `history.state.__doomIdx` (0 = first page of the visit). We wrap
 * `history.pushState/replaceState` so EVERY entry — Next.js navigations, modal
 * entries — gets `previous + 1` on push and keeps its index on replace. Because the
 * index lives in the history entry itself it survives reloads and back/forward.
 * The current depth is mirrored to sessionStorage (`doom:nav-depth`) for debugging
 * and for code that cannot read history.state.
 *
 * `canGoBackInApp()` is true only when the previous entry belongs to this site,
 * so `router.back()` never leaves the site when a page was opened directly.
 */

export const HISTORY_INDEX_KEY = '__doomIdx';
export const SESSION_DEPTH_KEY = 'doom:nav-depth';

type HistoryState = Record<string, unknown> | null | undefined;

function readIndex(state: HistoryState = typeof window !== 'undefined' ? (window.history.state as HistoryState) : null): number {
  const v = state?.[HISTORY_INDEX_KEY];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function mirror(index: number) {
  try {
    window.sessionStorage.setItem(SESSION_DEPTH_KEY, String(index));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function getHistoryIndex(): number {
  if (typeof window === 'undefined') return 0;
  return readIndex();
}

export function canGoBackInApp(): boolean {
  return getHistoryIndex() > 0;
}

declare global {
  interface Window {
    __doomHistoryPatched?: boolean;
  }
}

/** Idempotent. Call once on the client (NavigationTracker does it). */
export function installHistoryTracking(): void {
  if (typeof window === 'undefined' || window.__doomHistoryPatched) return;
  window.__doomHistoryPatched = true;

  const h = window.history;
  const push = h.pushState;
  const replace = h.replaceState;

  h.pushState = function patchedPush(this: History, data: unknown, unused: string, url?: string | URL | null) {
    const next = readIndex() + 1;
    const state = { ...((data as Record<string, unknown>) ?? {}), [HISTORY_INDEX_KEY]: next };
    const r = push.call(this, state, unused, url);
    mirror(next);
    return r;
  };

  h.replaceState = function patchedReplace(this: History, data: unknown, unused: string, url?: string | URL | null) {
    const incoming = (data as Record<string, unknown>) ?? {};
    const idx = typeof incoming[HISTORY_INDEX_KEY] === 'number' ? (incoming[HISTORY_INDEX_KEY] as number) : readIndex();
    const r = replace.call(this, { ...incoming, [HISTORY_INDEX_KEY]: idx }, unused, url);
    mirror(idx);
    return r;
  };

  window.addEventListener('popstate', (e) => mirror(readIndex(e.state as HistoryState)));

  // Tag the entry we landed on (keeps an existing index after reload).
  replace.call(h, { ...((h.state as Record<string, unknown>) ?? {}), [HISTORY_INDEX_KEY]: readIndex() }, '');
  mirror(readIndex());
}
