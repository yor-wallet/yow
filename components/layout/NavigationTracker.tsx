'use client';

import { useEffect } from 'react';
import { installHistoryTracking } from '@/lib/history';
import { MODAL_STATE_KEY } from '@/components/ui/useHistoryModal';

/** Mount once in the root layout: enables in-app history depth tracking (BackButton). */
export function NavigationTracker() {
  useEffect(() => {
    installHistoryTracking();
    // Marker for tests/monitoring: client is hydrated and interactive.
    document.documentElement.dataset.hydrated = 'true';
    // A modal entry left on top after a reload: step back so Back is never a no-op.
    const state = window.history.state as Record<string, unknown> | null;
    if (state?.[MODAL_STATE_KEY]) window.history.back();
  }, []);
  return null;
}
