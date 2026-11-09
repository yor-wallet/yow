import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { favoriteIdsFor } from '@/lib/catalog/favorites';
import { parseCatalogParams, type SearchParamsInput } from '@/lib/catalog/filters';
import { loadListing } from '@/lib/catalog/page-data';
import { categoryPath } from '@/lib/catalog/paths';
import { getCategoryBySlug } from '@/lib/catalog/queries';
import { PageHeader } from '@/components/layout/PageHeader';
import { Breadcrumb } from '@/components/shop/Breadcrumb';
import { CatalogPage } from '@/components/shop/CatalogPage';

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Exclude<SearchParamsInput, URLSearchParams>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const category = await getCategoryBySlug(slug, asLocale(locale));
  if (!category) return { title: '404', robots: { index: false } };
  return { title: category.name, description: category.description ?? undefined };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const category = await getCategoryBySlug(slug, locale);
  if (!category) notFound();

  const t = await getTranslations('catalog.category');
  const filters = parseCatalogParams(await searchParams);
  const { list, facets } = await loadListing({ locale, scope: { kind: 'category', category }, filters, limit: filters.n });
  const session = await getSession();
  const favoriteIds = [...(await favoriteIdsFor(session?.user.id, list.items.map((p) => p.id)))];

  const crumbs = [
    { label: t('home'), href: '/' },
    ...(category.parent ? [{ label: category.parent.name, href: categoryPath(category.parent.slug) }] : []),
    { label: category.name },
  ];

  return (
    <div>
      <PageHeader title={category.name} subtitle={category.description ?? undefined} fallbackHref={category.parent ? categoryPath(category.parent.slug) : '/categories'} />
      <Breadcrumb items={crumbs} />
      <CatalogPage
        list={list}
        facets={facets}
        filters={filters}
        favoriteIds={favoriteIds}
        scope={`category:${category.slug}`}
        subcategories={category.children.map((c) => ({ slug: c.slug, name: c.name }))}
      />
    </div>
  );
}
