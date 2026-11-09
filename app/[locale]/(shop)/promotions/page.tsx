import type { Metadata } from 'next';
import { Tag } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { getHomeRail, getPromotionViews } from '@/lib/catalog/cache';
import { favoriteIdsFor } from '@/lib/catalog/favorites';
import { formatBaisa } from '@/lib/money';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { CopyCodeButton } from '@/components/shop/CopyCodeButton';
import { ProductGrid } from '@/components/shop/ProductGrid';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'catalog.promotions' });
  return { title: t('metaTitle') };
}

/** Live promotions only (SPEC: never show an offer that does not exist) + the deals of the day. */
export default async function PromotionsPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const [t, tc, format, promotions, deals, session] = await Promise.all([
    getTranslations('catalog.promotions'),
    getTranslations('home.promoCard'),
    getFormatter(),
    getPromotionViews(locale),
    getHomeRail('deals', locale),
    getSession(),
  ]);
  const favoriteIds = await favoriteIdsFor(session?.user.id, deals.map((p) => p.id));

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/" />
      <div className="page-container pt-4 lg:pt-6">
        {promotions.length === 0 ? (
          <EmptyState icon={<Tag size={26} />} title={t('emptyTitle')} description={t('emptyText')} />
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="promotion-list">
            {promotions.map((p) => {
              const scope = [...p.scope.categories, ...p.scope.brands];
              return (
                <li key={p.id} className="min-w-0">
                  <Card tone="gradient" className="flex h-full flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="secondary">{p.type === 'PERCENT' ? tc('percent', { value: Number((p.value / 100).toFixed(2)) }) : tc('fixed', { amount: formatBaisa(p.value, locale) })}</Badge>
                      {p.code ? <Badge variant="neutral">{tc('code', { code: p.code })}</Badge> : <span className="text-xs text-muted">{tc('auto')}</span>}
                    </div>
                    <h2 className="text-lg font-bold">{p.name}</h2>
                    {p.description ? <p className="text-sm text-muted">{p.description}</p> : null}
                    <p className="text-sm">
                      <span className="text-muted">{t('appliesTo')} </span>
                      {p.scope.products > 0 ? t('productsCount', { count: p.scope.products }) : scope.length > 0 ? scope.join(' · ') : t('everything')}
                    </p>
                    <p className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      {p.endsAt ? <span>{tc('endsOn', { date: format.dateTime(new Date(p.endsAt), 'short') })}</span> : null}
                      {p.minSubtotalBaisa ? <span>{tc('minSpend', { amount: formatBaisa(p.minSubtotalBaisa, locale) })}</span> : null}
                      {p.maxDiscountBaisa ? <span>{t('maxDiscount', { amount: formatBaisa(p.maxDiscountBaisa, locale) })}</span> : null}
                    </p>
                    {p.code ? <CopyCodeButton code={p.code} /> : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <Card className="mt-6">
          <h2 className="font-bold">{t('howTitle')}</h2>
          <p className="mt-2 text-sm text-muted">{t('how')}</p>
        </Card>

        {deals.length > 0 ? (
          <section className="mt-10" aria-labelledby="deals-title">
            <h2 id="deals-title" className="mb-4 text-xl font-bold sm:text-2xl">
              {t('dealsTitle')}
            </h2>
            <ProductGrid products={deals} favoriteIds={favoriteIds} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
