'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PackageSearch } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClasses, Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PAGE_SIZE } from '@/lib/catalog/filters';
import type { ProductCardData } from '@/lib/catalog/types';
import { ProductGrid } from './ProductGrid';

type PageResponse = { ok: true; items: ProductCardData[]; nextCursor: string | null; total: number; favorites: string[] };

/**
 * Product grid with cursor-based "Load more". The first page is rendered by the server (SEO,
 * no spinner); later pages come from `/api/catalog/list`. The number of loaded items is kept in
 * the URL (`n`) with `replaceState`, so Back restores the same listing (SPEC: preserve filters).
 * `resetKey` changes when filters/search change, which resets the list to the server data.
 */
export function ProductListing({
  initialItems,
  initialCursor,
  total,
  favoriteIds,
  scope,
  q,
  resetKey,
  filtered,
  emptyOverride,
}: {
  initialItems: ProductCardData[];
  initialCursor: string | null;
  total: number;
  favoriteIds: string[];
  /** `category:<slug>` or `search`. */
  scope: string;
  q?: string | null;
  resetKey: string;
  filtered: boolean;
  /** Replaces the default empty state copy (e.g. "No result for “iphone”"). */
  emptyOverride?: { title: string; text: string };
}) {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [favs, setFavs] = useState(() => new Set(favoriteIds));
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const lastKey = useRef(resetKey);

  // New server data (filters changed, Back restored a different `n`): start from it.
  useEffect(() => {
    // Only a change of the listing itself (scope, query, filters, restored `n`) resets the list:
    // other server refreshes (cart badge, favourites) must not drop the pages already loaded.
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setItems(initialItems);
    setCursor(initialCursor);
    setFavs(new Set(favoriteIds));
    setState('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, initialItems, initialCursor, favoriteIds]);

  const loadMore = useCallback(async () => {
    if (!cursor || state === 'loading') return;
    setState('loading');
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.set('cursor', cursor);
      sp.set('scope', scope);
      sp.set('locale', locale);
      if (q) sp.set('q', q);
      sp.delete('n');
      const res = await fetch(`/api/catalog/list?${sp.toString()}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as PageResponse;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const next = [...prev, ...data.items.filter((p) => !seen.has(p.id))];
        // Remember how many items are loaded so Back restores them.
        const url = new URL(window.location.href);
        url.searchParams.set('n', String(Math.min(240, Math.ceil(next.length / PAGE_SIZE) * PAGE_SIZE)));
        window.history.replaceState(window.history.state, '', url);
        return next;
      });
      setFavs((prev) => new Set([...prev, ...data.favorites]));
      setCursor(data.nextCursor);
      setState('idle');
    } catch {
      setState('error');
    }
  }, [cursor, locale, q, scope, state]);

  if (items.length === 0) {
    if (emptyOverride) {
      return (
        <EmptyState
          icon={<PackageSearch size={26} />}
          title={emptyOverride.title}
          description={emptyOverride.text}
          action={
            <Link href="/categories" className={buttonClasses({ variant: 'secondary' })}>
              {t('empty.browse')}
            </Link>
          }
        />
      );
    }
    return filtered ? (
      <EmptyState icon={<PackageSearch size={26} />} title={t('empty.filteredTitle')} description={t('empty.filteredText')} />
    ) : (
      <EmptyState
        icon={<PackageSearch size={26} />}
        title={t('empty.title')}
        description={t('empty.text')}
        action={
          <Link href="/categories" className={buttonClasses({ variant: 'secondary' })}>
            {t('empty.browse')}
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <ProductGrid products={items} favoriteIds={favs} className="xl:grid-cols-3 2xl:grid-cols-4" />
      <div className="mt-8 flex flex-col items-center gap-3" aria-live="polite">
        <p className="text-sm text-muted" data-testid="list-count">
          {t('list.showing', { shown: items.length, total })}
        </p>
        {cursor ? (
          <Button type="button" variant="secondary" onClick={loadMore} loading={state === 'loading'} loadingLabel={t('list.loading')} data-testid="load-more">
            {t('list.loadMore')}
          </Button>
        ) : (
          <p className="text-sm text-muted">{t('list.end')}</p>
        )}
        {state === 'error' ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-error">
            <Loader2 size={16} aria-hidden="true" className="hidden" />
            {t('list.error')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
