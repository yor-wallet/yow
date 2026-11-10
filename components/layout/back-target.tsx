'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Where the phone band's back arrow goes when there is no in-app history (page opened directly).
 * A page declares it by rendering <BackTarget href> (PageHeader does); the band reads it.
 * Module-level store: one page is mounted at a time and it is only ever written on the client.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(value: string | null) {
  if (current === value) return;
  current = value;
  for (const l of listeners) l();
}

export function useBackTarget(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

export function BackTarget({ href }: { href: string }) {
  useEffect(() => {
    set(href);
    return () => {
      if (current === href) set(null);
    };
  }, [href]);
  return null;
}
