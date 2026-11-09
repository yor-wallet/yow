import { useTranslations } from 'next-intl';
import { PAGE_SIZE, type CatalogFilters as Filters } from '@/lib/catalog/filters';
import type { Facets, ListResult } from '@/lib/catalog/types';
import { CatalogSidebar, CatalogToolbar } from './CatalogFilters';
import { ProductListing } from './ProductListing';

/**
 * Body shared by the category and search pages: side filters (lg+), toolbar (filters button,
 * sort, active chips) and the paginated product grid. The caller supplies a header above it.
 */
export function CatalogPage({
  list,
  facets,
  filters,
  favoriteIds,
  scope,
  q,
  subcategories,
  emptyOverride,
  intro,
}: {
  list: ListResult;
  facets: Facets | null;
  filters: Filters;
  favoriteIds: string[];
  /** `category:<slug>` or `search`. */
  scope: string;
  q?: string | null;
  subcategories?: { slug: string; name: string }[];
  emptyOverride?: { title: string; text: string };
  intro?: React.ReactNode;
}) {
  const t = useTranslations('catalog.category');
  const narrowed = filters.sub !== null || filters.brands.length > 0 || filters.minOmr !== null || filters.maxOmr !== null || filters.capacities.length > 0 || filters.colors.length > 0 || filters.inStock;
  const resetKey = JSON.stringify([scope, q ?? '', filters]);
  return (
    <div className="page-container grid gap-6 pb-12 pt-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8">
      <CatalogSidebar facets={facets} filters={filters} q={q} subcategories={subcategories} />
      <div className="min-w-0">
        {intro}
        <CatalogToolbar facets={facets} filters={filters} total={list.total} q={q} subcategories={subcategories} scope={scope} />
        <p className="mt-4 text-sm text-muted" aria-live="polite" data-testid="result-count">
          {t('results', { count: list.total })}
        </p>
        <div className="mt-4">
          <ProductListing
            initialItems={list.items}
            initialCursor={list.nextCursor}
            total={list.total}
            favoriteIds={favoriteIds}
            scope={scope}
            q={q}
            resetKey={resetKey}
            filtered={narrowed || !!q}
            emptyOverride={emptyOverride}
          />
        </div>
      </div>
    </div>
  );
}

export { PAGE_SIZE };
