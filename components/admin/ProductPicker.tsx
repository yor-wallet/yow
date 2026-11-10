'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { controlClasses } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

export type PickedProduct = { id: string; sku: string; name: string };

/**
 * Searchable multi-select of real products (admin search API). Selected ids are posted as
 * repeated hidden `name` inputs, in the chosen order (the first one feeds the ad's product block).
 */
export function ProductPicker({ name, label, initial, max = 12, hint }: { name: string; label: string; initial: PickedProduct[]; max?: number; hint?: string }) {
  const t = useTranslations('admin.picker');
  const locale = useLocale();
  const id = useId();
  const [picked, setPicked] = useState<PickedProduct[]>(initial);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/products/search?q=${encodeURIComponent(q.trim())}&locale=${locale}`, { signal: ctrl.signal, cache: 'no-store' });
        const body = (await res.json()) as { items?: PickedProduct[] };
        setResults(body.items ?? []);
      } catch {
        /* aborted / offline: keep the previous results */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => ctrl.abort();
  }, [q, locale]);

  const add = (p: PickedProduct) => {
    setPicked((list) => (list.some((x) => x.id === p.id) || list.length >= max ? list : [...list, p]));
    setQ('');
    setResults([]);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="product-picker">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {picked.map((p) => (
        <input key={p.id} type="hidden" name={name} value={p.id} />
      ))}
      {picked.length ? (
        <ul className="flex flex-wrap gap-2">
          {picked.map((p) => (
            <li key={p.id} className="inline-flex max-w-full items-center gap-1 rounded-pill border border-border-strong bg-surface-2 ps-3 text-sm">
              <span className="truncate">{p.name}</span>
              <span className="font-mono text-xs text-muted" dir="ltr">
                {p.sku}
              </span>
              <button type="button" onClick={() => setPicked((l) => l.filter((x) => x.id !== p.id))} className="grid size-9 place-items-center rounded-pill text-muted hover:text-fg" aria-label={t('remove', { name: p.name })}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('placeholder')}
        className={cn(controlClasses, 'border-border')}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        disabled={picked.length >= max}
      />
      <p id={`${id}-hint`} className="text-xs text-muted">
        {loading ? t('searching') : (hint ?? t('hint', { max }))}
      </p>
      {results.length ? (
        <ul className="max-h-60 overflow-y-auto rounded-xl border border-border bg-surface" role="listbox" aria-label={label}>
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => add(r)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-start text-sm hover:bg-surface-2" data-testid="picker-option">
                <span className="truncate">{r.name}</span>
                <span className="font-mono text-xs text-muted" dir="ltr">
                  {r.sku}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
