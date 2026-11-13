'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, getPathname, useRouter } from '@/i18n/navigation';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';

type Suggestion = {
  slug: string;
  name: string;
  brand: string | null;
  priceBaisa: number | null;
  priceFrom: boolean;
  image: { src: string; width: number; height: number } | null;
};

/** Wait this long after the last keystroke before asking for suggestions (specification: ~250 ms). */
const SUGGEST_DELAY_MS = 250;

/**
 * Product search → `/{locale}/search?q=…`. A real GET form (works without JS), upgraded to client-side
 * navigation, with live suggestions (combobox pattern): debounced 250 ms, an answer is ignored as soon as
 * the text changes again (the pending request is aborted), keyboard: ↑ ↓ choose, Enter open, Esc close.
 */
export function SearchBox({
  className,
  defaultValue = '',
  autoFocus,
  variant = 'default',
}: {
  className?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  /** `pill`: the phone layout — taller rounded field with an icon-only submit button at the start. */
  variant?: 'default' | 'pill';
}) {
  const t = useTranslations('nav.search');
  const ts = useTranslations('catalog.search');
  const locale = useLocale();
  const router = useRouter();
  const [q, setQ] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false); // the current text has been answered (so "no suggestion" is true)
  const [active, setActive] = useState(-1);
  const listId = useId();
  const wrapper = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const text = q.trim();
    setActive(-1);
    setSettled(false);
    if (text.length < 2) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/suggest?q=${encodeURIComponent(text)}&locale=${locale}`, { signal: controller.signal });
        if (!res.ok) throw new Error('suggest');
        const data = (await res.json()) as { items: Suggestion[] };
        setItems(data.items);
        setSettled(true);
      } catch (err) {
        if ((err as DOMException)?.name !== 'AbortError') {
          setItems([]);
          setSettled(false);
        }
      }
    }, SUGGEST_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, locale]);

  const showList = open && q.trim().length >= 2 && settled;
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const onBlur = (e: FocusEvent<HTMLFormElement>) => {
    if (!wrapper.current?.contains(e.relatedTarget as Node | null)) close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // A search field clears itself on Escape by default: with the list open, Escape only closes the list.
      if (showList) e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' && items.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp' && items.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter' && showList && active >= 0 && items[active]) {
      e.preventDefault();
      close();
      router.push(`/product/${items[active]!.slug}`);
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = q.trim();
    close();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  return (
    <form
      role="search"
      action={getPathname({ href: '/search', locale })}
      method="get"
      onSubmit={onSubmit}
      onBlur={onBlur}
      ref={wrapper}
      className={cn('relative w-full', className)}
    >
      <label htmlFor={`search-${locale}`} className="sr-only">
        {t('label')}
      </label>
      <input
        id={`search-${locale}`}
        name="q"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={variant === 'pill' ? t('placeholderShort') : t('placeholder')}
        maxLength={120}
        className={cn(
          'block w-full min-w-0 border border-border bg-surface text-base text-fg placeholder:text-muted/80 transition-[border-color,box-shadow] duration-(--dur-btn) focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/35 [&::-webkit-search-cancel-button]:hidden',
          variant === 'pill' ? 'h-13 rounded-2xl ps-16 pe-4 shadow-card' : 'h-12 rounded-xl ps-11 pe-24',
        )}
      />
      {variant === 'pill' ? null : <Search size={18} aria-hidden="true" className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" />}
      <button
        type="submit"
        aria-label={variant === 'pill' ? t('submit') : undefined}
        className={cn(
          'absolute bg-gradient-primary font-semibold text-on-accent transition-transform duration-(--dur-btn) active:scale-[0.98]',
          variant === 'pill' ? 'inset-y-1 start-1 grid w-11 place-items-center rounded-xl' : 'inset-y-0.5 end-0.5 min-w-11 rounded-lg px-4 text-sm',
        )}
      >
        {variant === 'pill' ? <Search size={20} aria-hidden="true" /> : t('submit')}
      </button>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ts('suggestionsLabel')}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70dvh] animate-fade-in overflow-y-auto rounded-2xl border border-border bg-surface p-1 shadow-float"
          data-testid="search-suggestions"
        >
          {items.length === 0 ? (
            <li role="option" aria-selected="false" aria-disabled="true" className="px-3 py-3 text-sm text-muted">
              {ts('noSuggestion')}
            </li>
          ) : (
            items.map((p, i) => (
              <li key={p.slug} id={optionId(i)} role="option" aria-selected={i === active}>
                <Link
                  href={`/product/${p.slug}`}
                  onClick={close}
                  data-testid="search-suggestion"
                  className={cn('flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2', i === active && 'bg-surface-2')}
                >
                  <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.image ? <img src={p.image.src} width={44} height={44} alt="" loading="lazy" decoding="async" className="size-full object-contain" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <bdi className="line-clamp-1 text-sm font-semibold">{p.name}</bdi>
                    {p.brand ? <span className="block truncate text-xs text-muted">{p.brand}</span> : null}
                  </span>
                  {p.priceBaisa !== null ? (
                    <bdi className="shrink-0 text-sm font-bold tabular-nums text-price">{formatBaisa(p.priceBaisa, locale)}</bdi>
                  ) : null}
                </Link>
              </li>
            ))
          )}
          {items.length > 0 ? (
            <li role="presentation" className="border-t border-border p-1">
              <button type="submit" className="min-h-11 w-full rounded-xl px-3 text-start text-sm font-semibold text-accent hover:bg-surface-2">
                {ts('seeAll', { query: q.trim() })}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </form>
  );
}
