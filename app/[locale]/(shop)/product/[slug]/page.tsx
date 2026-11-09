import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Star } from 'lucide-react';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { favoriteIdsFor } from '@/lib/catalog/favorites';
import { categoryPath, productPath } from '@/lib/catalog/paths';
import { getProductDetail, getProductReviews, type ProductDetail } from '@/lib/catalog/queries';
import { BackButton } from '@/components/layout/BackButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Breadcrumb } from '@/components/shop/Breadcrumb';
import { ProductHero } from '@/components/shop/ProductHero';
import { Stars } from '@/components/shop/Stars';
import { getFormatter } from 'next-intl/server';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await getProductDetail(slug, asLocale(locale));
  if (!product) return { title: '404', robots: { index: false } };
  const description = product.seoDescription ?? product.description?.slice(0, 160) ?? undefined;
  const image = product.images[0];
  return {
    title: product.seoTitle ?? product.name,
    description,
    alternates: { canonical: `/${locale}${productPath(product.slug)}` },
    openGraph: {
      type: 'website',
      title: product.seoTitle ?? product.name,
      description,
      images: image ? [{ url: image.src, width: image.width, height: image.height, alt: image.alt }] : undefined,
    },
  };
}

/** schema.org Product — only facts that exist: a price/availability appear only for a priced, sellable variant. */
function jsonLd(product: ProductDetail, url: string, average: number | null, count: number) {
  const priced = product.variants.filter((v) => v.priceBaisa !== null);
  const sellable = product.isSellable ? priced : [];
  const lowest = sellable.length ? Math.min(...sellable.map((v) => v.priceBaisa as number)) : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.sku,
    url,
    ...(product.description ? { description: product.description } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand.name } } : {}),
    ...(product.images.length ? { image: product.images.map((i) => i.src) } : {}),
    ...(lowest !== null
      ? {
          offers: {
            '@type': 'Offer',
            priceCurrency: 'OMR',
            price: (lowest / 1000).toFixed(3),
            availability: sellable.some((v) => v.availability === 'in_stock' || v.availability === 'low_stock') ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url,
          },
        }
      : {}),
    ...(average !== null && count > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: average.toFixed(1), reviewCount: count } } : {}),
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const product = await getProductDetail(slug, locale);
  if (!product) notFound();

  const [t, tc, format, session, reviewData] = await Promise.all([
    getTranslations('product'),
    getTranslations('catalog.category'),
    getFormatter(),
    getSession(),
    getProductReviews(product.id, 20),
  ]);
  const favorite = (await favoriteIdsFor(session?.user.id, [product.id])).has(product.id);
  const base = process.env.APP_URL || 'http://localhost:3000';
  const ld = jsonLd(product, `${base}/${locale}${productPath(product.slug)}`, reviewData.average, reviewData.count);

  const crumbs = [
    { label: tc('home'), href: '/' },
    ...(product.category.parent ? [{ label: product.category.parent.name, href: categoryPath(product.category.parent.slug) }] : []),
    { label: product.category.name, href: categoryPath(product.category.slug) },
    { label: product.name },
  ];

  return (
    <div className="pb-14">
      <PageHeader title={product.name} fallbackHref={categoryPath(product.category.slug)} mobileOnly mobileHeading="div" />
      <div className="page-container hidden pt-6 lg:block">
        <BackButton fallbackHref={categoryPath(product.category.slug)} variant="text" className="-ms-3" />
      </div>
      <Breadcrumb items={crumbs} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />

      <div className="page-container pt-4">
        <ProductHero product={product} favorite={favorite} />
      </div>

      {(product.description || product.highlights.length > 0) ? (
        <section className="page-container mt-12" aria-labelledby="product-overview" data-testid="product-overview">
          <h2 id="product-overview" className="text-xl font-bold sm:text-2xl">
            {t('tabs.overview')}
          </h2>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            {product.highlights.length > 0 ? (
              <Card>
                <h3 className="font-semibold">{t('highlights')}</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {product.highlights.map((h) => (
                    <li key={h} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {product.description ? (
              <Card>
                <h3 className="font-semibold">{t('description')}</h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">{product.description}</p>
              </Card>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="page-container mt-12" aria-labelledby="product-specs" data-testid="product-specs">
        <h2 id="product-specs" className="text-xl font-bold sm:text-2xl">
          {t('specs.title')}
        </h2>
        {product.specs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('specs.empty')}</p>
        ) : (
          <dl className="mt-4 overflow-hidden rounded-card border border-border">
            {product.specs.map((s, i) => (
              <div key={s.key} className={`grid grid-cols-1 gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4 ${i % 2 === 0 ? 'bg-surface' : 'bg-surface-2'}`}>
                <dt className="font-semibold">{s.label}</dt>
                <dd className="min-w-0 text-muted [overflow-wrap:anywhere]">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="page-container mt-12" aria-labelledby="product-reviews" data-testid="product-reviews">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="product-reviews" className="text-xl font-bold sm:text-2xl">
            {t('reviews.title')}
          </h2>
          {reviewData.average !== null ? (
            <p className="flex items-center gap-2 text-sm">
              <Stars rating={reviewData.average} label={t('reviews.average', { rating: reviewData.average.toFixed(1) })} />
              <span className="font-semibold tabular-nums">{t('reviews.average', { rating: reviewData.average.toFixed(1) })}</span>
              <span className="text-muted">· {t('reviews.count', { count: reviewData.count })}</span>
            </p>
          ) : null}
        </div>
        {reviewData.reviews.length === 0 ? (
          <EmptyState compact className="mt-4" icon={<Star size={24} />} title={t('reviews.empty')} description={t('reviews.emptyText')} />
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {reviewData.reviews.map((r) => (
              <li key={r.id} className="min-w-0">
                <Card className="flex h-full flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Stars rating={r.rating} label={t('reviews.average', { rating: r.rating })} />
                    <Badge variant="success">{t('reviews.verified')}</Badge>
                  </div>
                  {r.title ? <p className="font-semibold">{r.title}</p> : null}
                  <p className="text-sm text-muted">{r.text}</p>
                  <p className="mt-auto text-xs text-muted">
                    {t('reviews.by', { name: r.author })} · {format.dateTime(new Date(r.createdAt), 'short')}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
