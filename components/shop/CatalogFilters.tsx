'use client';

import { useCallback, useEffect, useOptimistic, useState, useTransition } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { useHistoryModal } from '@/components/ui/useHistoryModal';
import { cn } from '@/lib/cn';
import { Ltr } from '@/components/ui/Ltr';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  SORT_KEYS,
  serializeCatalogParams,
  toggleValue,
  type CatalogFilters as Filters,
} from '@/lib/catalog/filters';
import type { Facets } from '@/lib/catalog/types';

type Sub = { slug: string; name: string };

type CatalogProps = {
  facets: Facets | null;
  filters: Filters;
  q?: string | null;
  subcategories?: Sub[];
};

/**
 * Applies a filter change by replacing the URL (the server page re-renders with the new data).
 * `shown` is the optimistic filter state: checkboxes and chips react at once, while the
 * server round trip is still in flight, and fall back to the real URL state when it lands.
 */
function useApply(filters: Filters, q?: string | null) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(filters, (current: Filters, next: Partial<Filters>) => ({ ...current, ...next }));
  const apply = useCallback(
    (next: Partial<Filters>) => {
      const merged: Filters = { ...filters, ...next, n: DEFAULT_FILTERS.n };
      const sp = serializeCatalogParams(merged, { q: q ?? null });
      const query: Record<string, string> = {};
      sp.forEach((v, k) => (query[k] = v));
      start(() => {
        setShown(next);
        router.replace({ pathname, query }, { scroll: false });
      });
    },
    [filters, pathname, q, router, setShown],
  );
  const clear = useCallback(() => apply({ ...DEFAULT_FILTERS, sort: filters.sort }), [apply, filters.sort]);
  return { apply, clear, pending, shown };
}

/**
 * Mobile/tablet filter button, sort select and active filter chips. The state lives in the URL
 * (SPEC: filters in search params). On < lg the filters open in a history-backed bottom sheet
 * (Back closes it); on lg+ the same filters are shown by <CatalogSidebar />.
 *
 * Inside the sheet the choices are a DRAFT, applied when "Show N results" is pressed: the sheet's
 * history entry is popped first and only then is the URL replaced. (Replacing the URL while the
 * sheet's entry is on top of the history lost the filter when the sheet was closed right after.)
 */
export function CatalogToolbar({ facets, filters, total, q, subcategories = [], scope }: CatalogProps & { total: number; scope: string }) {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const sheet = useHistoryModal('catalog-filters');
  const { apply, clear, pending, shown } = useApply(filters, q);
  const count = activeFilterCount(shown);
  const [draft, setDraft] = useState<Filters>(filters);
  const [draftTotal, setDraftTotal] = useState(total);

  const openSheet = () => {
    setDraft(filters);
    setDraftTotal(total);
    sheet.open();
  };
  const draftCount = activeFilterCount(draft);
  // Compare the serialised query strings (JSON.stringify(URLSearchParams) is always "{}").
  const dirty = serializeCatalogParams(draft, { q: q ?? null }).toString() !== serializeCatalogParams(filters, { q: q ?? null }).toString();

  // Live number of matches for the draft (debounced, cancelled when the draft changes again).
  useEffect(() => {
    if (!sheet.isOpen) return;
    if (!dirty) {
      setDraftTotal(total);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const sp = serializeCatalogParams({ ...draft, n: DEFAULT_FILTERS.n }, { q: q ?? null });
        sp.set('scope', scope);
        sp.set('locale', locale);
        sp.set('countOnly', '1');
        const res = await fetch(`/api/catalog/list?${sp.toString()}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (res.ok) setDraftTotal(((await res.json()) as { total: number }).total);
      } catch {
        /* keep the previous number: the apply button still works */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [draft, dirty, locale, q, scope, sheet.isOpen, total]);

  return (
    <div data-testid="catalog-toolbar" aria-busy={pending || undefined}>
      <div className="flex flex-wrap items-end gap-3">
        <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={openSheet} leadingIcon={<SlidersHorizontal size={18} aria-hidden="true" />} data-testid="open-filters">
          {count > 0 ? t('filters.openCount', { count }) : t('filters.open')}
        </Button>
        <Select
          label={t('sort.label')}
          value={shown.sort}
          onChange={(e) => apply({ sort: e.target.value as Filters['sort'] })}
          containerClassName="min-w-44 flex-1 sm:flex-none"
          data-testid="sort-select"
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`sort.${k}`)}
            </option>
          ))}
        </Select>
      </div>

      <ActiveChips facets={facets} filters={shown} subcategories={subcategories} apply={apply} clear={clear} />

      <BottomSheet {...sheet.props} title={t('filters.title')}>
        <div className="flex flex-col gap-5 pb-2">
          <FilterPanel facets={facets} filters={draft} subcategories={subcategories} apply={(next) => setDraft((d) => ({ ...d, ...next }))} idPrefix="m" />
          <div className="sticky bottom-0 -mx-1 flex gap-3 bg-bg px-1 pb-1 pt-3">
            {draftCount > 0 ? (
              <Button type="button" variant="outline" onClick={() => setDraft({ ...DEFAULT_FILTERS, sort: draft.sort })} className="flex-1" data-testid="clear-draft">
                {t('filters.clear')}
              </Button>
            ) : null}
            <Button type="button" onClick={() => sheet.closeThen(() => apply({ ...draft }))} className="flex-[2]" data-testid="show-results">
              {t('filters.showResults', { count: draftTotal })}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

/** Desktop (lg+) side panel with the same filters as the mobile sheet. */
export function CatalogSidebar({ facets, filters, q, subcategories = [] }: CatalogProps) {
  const t = useTranslations('catalog');
  const { apply, clear, shown } = useApply(filters, q);
  const count = activeFilterCount(shown);
  return (
    <aside className="hidden lg:block" aria-label={t('filters.title')} data-testid="catalog-sidebar">
      <div className="sticky top-24 flex flex-col gap-5 rounded-card border border-border bg-surface p-4">
        <h2 className="text-base font-bold">{t('filters.title')}</h2>
        <FilterPanel facets={facets} filters={shown} subcategories={subcategories} apply={apply} idPrefix="d" />
        {count > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            {t('filters.clear')}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

function FilterPanel({
  facets,
  filters,
  subcategories,
  apply,
  idPrefix,
}: {
  facets: Facets | null;
  filters: Filters;
  subcategories: Sub[];
  apply: (next: Partial<Filters>) => void;
  idPrefix: string;
}) {
  const t = useTranslations('catalog.filters');
  const tCategory = useTranslations('catalog.category');
  const [min, setMin] = useState(filters.minOmr?.toString() ?? '');
  const [max, setMax] = useState(filters.maxOmr?.toString() ?? '');
  useEffect(() => {
    setMin(filters.minOmr?.toString() ?? '');
    setMax(filters.maxOmr?.toString() ?? '');
  }, [filters.minOmr, filters.maxOmr]);

  if (!facets || (facets.brands.length === 0 && facets.series.length === 0 && facets.priceMinOmr === null && subcategories.length === 0)) {
    return <p className="text-sm text-muted">{t('none')}</p>;
  }

  const parse = (v: string): number | null => (/^\d{1,7}$/.test(v.trim()) ? Number(v.trim()) : null);
  const submitPrice = () => apply({ minOmr: parse(min), maxOmr: parse(max) });

  return (
    <div className="flex flex-col gap-5">
      {subcategories.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{tCategory('subcategories')}</legend>
          <ul className="flex flex-wrap gap-2">
            {subcategories.map((s) => (
              <li key={s.slug}>
                <Chip pressed={filters.sub === s.slug} onClick={() => apply({ sub: filters.sub === s.slug ? null : s.slug })}>
                  {s.name}
                </Chip>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {facets.brands.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">{t('brand')}</legend>
          {facets.brands.map((b) => (
            <label key={b.slug} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={filters.brands.includes(b.slug)}
                onChange={() => apply({ brands: toggleValue(filters.brands, b.slug) })}
                className="size-5 shrink-0 accent-[var(--color-blue)]"
              />
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className="text-xs text-muted tabular-nums">{b.count}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {facets.series.length > 1 ? (
        <fieldset className="flex flex-col gap-2" data-testid="filter-series">
          <legend className="mb-1 text-sm font-semibold">{t('series')}</legend>
          <ul className="flex flex-wrap gap-2">
            {facets.series.map((x) => (
              <li key={x.value}>
                <Chip pressed={filters.series.includes(x.value)} onClick={() => apply({ series: toggleValue(filters.series, x.value) })}>
                  <Ltr>{x.value}</Ltr>
                </Chip>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {facets.years.length > 1 ? (
        <fieldset className="flex flex-col gap-2" data-testid="filter-year">
          <legend className="mb-1 text-sm font-semibold">{t('year')}</legend>
          <ul className="flex flex-wrap gap-2">
            {facets.years.map((y) => (
              <li key={y.value}>
                <Chip
                  pressed={filters.years.includes(y.value)}
                  onClick={() => apply({ years: filters.years.includes(y.value) ? filters.years.filter((v) => v !== y.value) : [...filters.years, y.value].sort((a, b) => a - b) })}
                >
                  <Ltr>{y.value}</Ltr>
                </Chip>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {facets.priceMinOmr !== null && facets.priceMaxOmr !== null ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('price')}</legend>
          <p className="text-xs text-muted">{t('priceRange', { min: facets.priceMinOmr, max: facets.priceMaxOmr })}</p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              id={`${idPrefix}-min`}
              label={t('min')}
              inputMode="numeric"
              pattern="[0-9]*"
              value={min}
              onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && submitPrice()}
            />
            <Input
              id={`${idPrefix}-max`}
              label={t('max')}
              inputMode="numeric"
              pattern="[0-9]*"
              value={max}
              onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && submitPrice()}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={submitPrice}>
            {t('applyPrice')}
          </Button>
        </fieldset>
      ) : null}

      {facets.capacities.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('capacity')}</legend>
          <ul className="flex flex-wrap gap-2">
            {facets.capacities.map((c) => (
              <li key={c.value}>
                <Chip pressed={filters.capacities.includes(c.value)} onClick={() => apply({ capacities: toggleValue(filters.capacities, c.value) })}>
                  <Ltr>{c.value}</Ltr>
                </Chip>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {facets.colors.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('color')}</legend>
          <ul className="flex flex-wrap gap-2">
            {facets.colors.map((c) => (
              <li key={c.value}>
                <Chip pressed={filters.colors.includes(c.value)} onClick={() => apply({ colors: toggleValue(filters.colors, c.value) })}>
                  {c.hex ? <span aria-hidden="true" className="size-3.5 rounded-full border border-border-strong" style={{ backgroundColor: c.hex }} /> : null}
                  <Ltr>{c.value}</Ltr>
                </Chip>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={filters.inStock} onChange={(e) => apply({ inStock: e.target.checked })} className="size-5 shrink-0 accent-[var(--color-blue)]" />
        {t('inStock')}
      </label>
    </div>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        pressed ? 'border-transparent bg-gradient-primary text-on-accent' : 'border-border-strong bg-transparent text-fg hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}

function ActiveChips({
  facets,
  filters,
  subcategories,
  apply,
  clear,
}: {
  facets: Facets | null;
  filters: Filters;
  subcategories: Sub[];
  apply: (next: Partial<Filters>) => void;
  clear: () => void;
}) {
  const t = useTranslations('catalog.filters');
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.sub) {
    const name = subcategories.find((s) => s.slug === filters.sub)?.name ?? filters.sub;
    chips.push({ key: 'sub', label: name, remove: () => apply({ sub: null }) });
  }
  for (const slug of filters.brands) {
    const name = facets?.brands.find((b) => b.slug === slug)?.name ?? slug;
    chips.push({ key: `brand:${slug}`, label: name, remove: () => apply({ brands: filters.brands.filter((b) => b !== slug) }) });
  }
  if (filters.minOmr !== null || filters.maxOmr !== null) {
    const label =
      filters.minOmr !== null && filters.maxOmr !== null
        ? t('priceChip', { min: filters.minOmr, max: filters.maxOmr })
        : filters.minOmr !== null
          ? t('priceMinChip', { min: filters.minOmr })
          : t('priceMaxChip', { max: filters.maxOmr as number });
    chips.push({ key: 'price', label, remove: () => apply({ minOmr: null, maxOmr: null }) });
  }
  for (const x of filters.series) chips.push({ key: `ser:${x}`, label: x, remove: () => apply({ series: filters.series.filter((v) => v !== x) }) });
  for (const y of filters.years) chips.push({ key: `yr:${y}`, label: String(y), remove: () => apply({ years: filters.years.filter((v) => v !== y) }) });
  for (const c of filters.capacities) chips.push({ key: `cap:${c}`, label: c, remove: () => apply({ capacities: filters.capacities.filter((x) => x !== c) }) });
  for (const c of filters.colors) chips.push({ key: `color:${c}`, label: c, remove: () => apply({ colors: filters.colors.filter((x) => x !== c) }) });
  if (filters.inStock) chips.push({ key: 'stock', label: t('inStock'), remove: () => apply({ inStock: false }) });
  if (chips.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label={t('active')} data-testid="active-filters">
      {chips.map((c) => (
        <li key={c.key}>
          <button
            type="button"
            onClick={c.remove}
            aria-label={t('remove', { name: c.label })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-border-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Ltr>{c.label}</Ltr>
            <X size={14} aria-hidden="true" />
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={clear} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent underline-offset-4 hover:underline">
          {t('clear')}
        </button>
      </li>
    </ul>
  );
}
