'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export type ToastVariant = 'success' | 'error' | 'info';
export type ToastInput = { title: string; description?: string; variant?: ToastVariant; durationMs?: number };
type ToastItem = Required<Pick<ToastInput, 'title' | 'variant' | 'durationMs'>> & { id: number; description?: string };

type ToastApi = { toast: (t: ToastInput) => number; dismiss: (id: number) => void };

const ToastContext = createContext<ToastApi | null>(null);

/**
 * `const { toast } = useToast(); toast({ title: t('saved'), variant: 'success' })`
 * Messages must already be translated. Errors are announced assertively.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback((input: ToastInput) => {
    const id = nextId++;
    const item: ToastItem = {
      id,
      title: input.title,
      description: input.description,
      variant: input.variant ?? 'info',
      durationMs: input.durationMs ?? (input.variant === 'error' ? 7000 : 4500),
    };
    setItems((list) => [...list.slice(-3), item]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster items={items} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function Toaster({ items, dismiss }: { items: ToastItem[]; dismiss: (id: number) => void }) {
  const polite = items.filter((t) => t.variant !== 'error');
  const assertive = items.filter((t) => t.variant === 'error');
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex flex-col items-center gap-2 px-4 lg:items-end lg:px-6"
      style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}
    >
      <div aria-live="polite" role="status" className="flex w-full max-w-sm flex-col gap-2">
        {polite.map((t) => (
          <ToastCard key={t.id} item={t} dismiss={dismiss} />
        ))}
      </div>
      <div aria-live="assertive" role="alert" className="flex w-full max-w-sm flex-col gap-2">
        {assertive.map((t) => (
          <ToastCard key={t.id} item={t} dismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

const icons = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const accents = { success: 'text-success', error: 'text-error', info: 'text-accent' } as const;

function ToastCard({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  const t = useTranslations('common.a11y');
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.durationMs);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, dismiss, item.id]);

  const Icon = icons[item.variant];
  return (
    <div
      className="pointer-events-auto flex w-full animate-toast-in items-start gap-3 rounded-2xl glass p-3.5 shadow-float"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="toast"
    >
      <Icon size={20} aria-hidden="true" className={cn('mt-0.5 shrink-0', accents[item.variant])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{item.title}</p>
        {item.description ? <p className="mt-0.5 text-sm text-muted">{item.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label={t('dismiss')}
        className="-m-1.5 grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:text-fg"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
