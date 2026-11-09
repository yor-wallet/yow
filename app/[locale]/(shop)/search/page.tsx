import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Search } from 'lucide-react';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { favoriteIdsFor } from '@/lib/catalog/favorites';
import { parseCatalogParams, type SearchParamsInput } from '@/lib/catalog/filters';
import { loadListing } from '@/lib/catalog/page-data';
import { categoryPath } from '@/lib/catalog/paths';
import { isEmptyQuery, parseSearchQuery } from '@/lib/catalog/search-query';
import { localize } from '@/lib/localized';
import { getNavCategories } from '@/lib/nav';
import { PageHeader } from '@/components/layout/PageHeader';
import { CatalogPage } from '@/components/shop/CatalogPage';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Exclude<SearchParamsInput, URLSearchParams>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'catalog.search' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('catalog.search');
  const sp = await searchParams;
  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const query = parseSearchQuery(rawQ);
  const hasQuery = !isEmptyQuery(query);
  const filters = parseCatalogParams(sp);
  const [{ list, facets }, session, categories] = await Promise.all([
    loadListing({ locale, scope: hasQuery ? { kind: 'search', query } : { kind: 'all' }, filters, limit: filters.n }),
    getSession(),
    getNavCategories(),
  ]);
  const favoriteIds = [...(await favoriteIdsFor(session?.user.id, list.items.map((p) => p.id)))];
  const title = hasQuery ? t('resultsFor', { query: query.raw }) : t('browseTitle');

  return (
    <div>
      <PageHeader title={t('title')} subtitle={hasQuery ? t('resultsFor', { query: query.raw }) : t('promptText')} fallbackHref="/" />
      <div className="page-container pt-4">
        <h2 className="text-xl font-bold sm:text-2xl" data-testid="search-title">
          {title}
        </h2>
        {!hasQuery ? (
          <div className="mt-4 rounded-card border border-border bg-surface p-4">
            <p className="flex items-center gap-2 font-semibold">
              <Search size={18} aria-hidden="true" className="text-accent" />
              {t('promptTitle')}
            </p>
            <p className="mt-1 text-sm text-muted">{t('promptText')}</p>
            {categories.length > 0 ? (
              <>
                <p className="mt-4 text-sm font-semibold">{t('popular')}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <li key={c.id}>
                      <Link href={categoryPath(c.slug)} className="inline-flex min-h-11 items-center rounded-pill border border-border-strong px-4 text-sm font-medium transition-colors hover:bg-surface-2">
                        {localize(c.name, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <CatalogPage
        list={list}
        facets={facets}
        filters={filters}
        favoriteIds={favoriteIds}
        scope="search"
        q={hasQuery ? query.raw : null}
        emptyOverride={hasQuery ? { title: t('emptyTitle', { query: query.raw }), text: t('emptyText') } : undefined}
      />
    </div>
  );
}
