'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Shared dialog engine for Modal and BottomSheet: portal, overlay, focus trap,
 * Escape to close, scroll lock, focus restore. Pair with `useHistoryModal` so the
 * browser Back button closes it.
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let lockCount = 0;
function lockScroll() {
  lockCount += 1;
  if (lockCount === 1) {
    const sw = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = 'hidden';
    if (sw > 0) document.body.style.paddingInlineEnd = `${sw}px`;
  }
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.documentElement.style.overflow = '';
    document.body.style.paddingInlineEnd = '';
  }
}

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Hide the visual title (still announced). */
  hideTitle?: boolean;
  className?: string;
};

export function DialogFrame({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  hideTitle,
  className,
  variant,
}: DialogProps & { variant: 'modal' | 'sheet' }) {
  const t = useTranslations('common.actions');
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    lockScroll();
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    // Keep focused inputs visible above the on-screen keyboard.
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches('input,textarea,select')) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    };
    document.addEventListener('keydown', onKey, true);
    panel?.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      panel?.removeEventListener('focusin', onFocusIn);
      unlockScroll();
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!mounted || !open) return null;

  const isSheet = variant === 'sheet';

  return createPortal(
    <div
      className={cn('fixed inset-0 z-[80] flex justify-center', isSheet ? 'items-end' : 'items-center p-4 sm:p-6')}
      style={isSheet ? undefined : { paddingTop: 'max(1rem, var(--safe-top))', paddingBottom: 'max(1rem, var(--safe-bottom))' }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-fade-in bg-[var(--doom-overlay)] backdrop-blur-[2px]"
        onClick={onClose}
        data-testid="dialog-overlay"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex w-full flex-col overflow-hidden border border-border bg-surface text-fg shadow-float outline-none',
          isSheet
            ? 'max-h-[calc(100dvh-var(--safe-top)-24px)] max-w-2xl animate-sheet-in rounded-t-3xl'
            : 'max-h-full max-w-lg animate-modal-in rounded-card',
          className,
        )}
      >
        {isSheet ? <div aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-pill bg-border-strong" /> : null}
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <h2 id={titleId} className={cn('text-lg font-bold leading-snug', hideTitle && 'sr-only')}>
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="-me-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer ? (
          <div
            className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border px-5 pt-3"
            style={{ paddingBottom: isSheet ? 'max(12px, var(--safe-bottom))' : '12px' }}
          >
            {footer}
          </div>
        ) : isSheet ? (
          <div aria-hidden="true" style={{ height: 'var(--safe-bottom)' }} />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
