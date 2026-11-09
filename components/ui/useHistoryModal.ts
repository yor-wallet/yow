'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

export const MODAL_STATE_KEY = '__doomModal';

export type HistoryModal = {
  isOpen: boolean;
  /** Opens and PUSHES a history entry (Back / Android back / iOS swipe will close it). */
  open: () => void;
  /** Closes; pops our history entry if it is on top. */
  close: () => void;
  /** Close, wait for the history pop, then run `fn` (e.g. router.push) — avoids stale entries. */
  closeThen: (fn: () => void) => void;
  /** Spread on <Modal>/<BottomSheet>: `{...modal.props}`. */
  props: { open: boolean; onClose: () => void };
};

/**
 * History-backed open state for modals and sheets (SPEC: Back closes the modal first).
 *
 *   const sheet = useHistoryModal('filters');
 *   <Button onClick={sheet.open}>Filters</Button>
 *   <BottomSheet {...sheet.props} title="Filters">…</BottomSheet>
 */
export function useHistoryModal(id?: string): HistoryModal {
  const autoId = useId();
  const modalId = id ?? autoId;
  const [isOpen, setOpen] = useState(false);
  const pushedRef = useRef(false);
  const afterCloseRef = useRef<(() => void) | null>(null);

  const runAfterClose = useCallback(() => {
    const fn = afterCloseRef.current;
    afterCloseRef.current = null;
    if (fn) setTimeout(fn, 0);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onPop = (e: PopStateEvent) => {
      const state = e.state as Record<string, unknown> | null;
      if (state?.[MODAL_STATE_KEY] !== modalId) {
        pushedRef.current = false;
        setOpen(false);
        runAfterClose();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isOpen, modalId, runAfterClose]);

  const open = useCallback(() => {
    if (!pushedRef.current) {
      const current = (window.history.state as Record<string, unknown> | null) ?? {};
      window.history.pushState({ ...current, [MODAL_STATE_KEY]: modalId }, '');
      pushedRef.current = true;
    }
    setOpen(true);
  }, [modalId]);

  const close = useCallback(() => {
    const state = window.history.state as Record<string, unknown> | null;
    if (pushedRef.current && state?.[MODAL_STATE_KEY] === modalId) {
      window.history.back(); // popstate listener closes the modal
    } else {
      pushedRef.current = false;
      setOpen(false);
      runAfterClose();
    }
  }, [modalId, runAfterClose]);

  const closeThen = useCallback(
    (fn: () => void) => {
      afterCloseRef.current = fn;
      close();
    },
    [close],
  );

  return { isOpen, open, close, closeThen, props: { open: isOpen, onClose: close } };
}
