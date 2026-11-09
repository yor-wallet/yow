import 'server-only';
import { categoryScopeIds, type CategoryDetail } from './queries';
import { getFacets, listProducts } from './listing';
import { loadLivePromotions } from './promotions-db';
import { isEmptyQuery, type ParsedQuery } from './search-query';
import type { CatalogFilters } from './filters';
import type { Facets, ListResult } from './types';

/**
 * Shared data loader for the category and search listings (pages AND the "load more" API),
 * so both always apply exactly the same scope, filters and ordering.
 */

export type ListingScope =
  | { kind: 'category'; category: CategoryDetail }
  | { kind: 'search'; query: ParsedQuery }
  | { kind: 'all' };

/** Category ids the listing is restricted to (null = the whole catalogue). */
export async function scopeCategoryIds(scope: ListingScope, filters: CatalogFilters): Promise<string[] | null> {
  if (scope.kind !== 'category') return null;
  if (filters.sub) {
    const subIds = (await categoryScopeIds([filters.sub])).filter((id) => scope.category.scopeIds.includes(id));
    if (subIds.length > 0) return subIds;
  }
  return scope.category.scopeIds;
}

export async function loadListing(opts: {
  locale: string;
  scope: ListingScope;
  filters: CatalogFilters;
  cursor?: string | null;
  limit: number;
  withFacets?: boolean;
}): Promise<{ list: ListResult; facets: Facets | null }> {
  const { locale, scope, filters } = opts;
  const search = scope.kind === 'search' && !isEmptyQuery(scope.query) ? scope.query : null;
  const categoryIds = await scopeCategoryIds(scope, filters);
  const promotions = await loadLivePromotions();
  const [list, facets] = await Promise.all([
    listProducts({ locale, categoryIds, search, filters, cursor: opts.cursor ?? null, limit: opts.limit, withTotal: true, promotions }),
    opts.withFacets === false
      ? Promise.resolve(null)
      : getFacets({
          // Facets describe the category / search scope, not the user's own narrowing of it.
          categoryIds: scope.kind === 'category' ? scope.category.scopeIds : null,
          search,
          locale,
        }),
  ]);
  return { list, facets };
}
