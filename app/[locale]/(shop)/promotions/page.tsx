import type { Metadata } from 'next';
import { Tag, Truck } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { getHomeRail, getPromotionViews } from '@/lib/catalog/cache';
import { favoriteIdsFor } from '@/lib/catalog/favorites';
import { freeStandardDeliveryFrom } from '@/lib/delivery/zones';
import { formatBaisa } from '@/lib/money';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InView } from '@/components/ui/InView';
import { PromotionTicket } from '@/components/shop/PromotionTicket';
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
  const [t, promotions, deals, session, freeFrom] = await Promise.all([
    getTranslations('catalog.promotions'),
    getPromotionViews(locale),
    getHomeRail('deals', locale),
    getSession(),
    freeStandardDeliveryFrom(),
  ]);
  const favoriteIds = await favoriteIdsFor(session?.user.id, deals.map((p) => p.id));

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/" />
      <div className="page-container pt-4 lg:pt-6">
        {freeFrom !== null ? (
          <InView className="promo-enter mb-5">
            <div className="flex items-center gap-4 rounded-card border border-night bg-yellow p-4 text-night sm:p-5" data-testid="free-delivery-banner">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-night text-yellow">
                <Truck size={24} aria-hidden="true" className="flip-rtl" />
              </span>
              <div className="min-w-0">
                <p className="text-lg font-extrabold leading-snug sm:text-xl">{t('freeDeliveryTitle', { amount: formatBaisa(freeFrom, locale, { trimWhole: true }) })}</p>
                <p className="text-sm">{t('freeDeliveryText')}</p>
              </div>
            </div>
          </InView>
        ) : null}

        {promotions.length === 0 ? (
          <EmptyState icon={<Tag size={26} />} title={t('emptyTitle')} description={t('emptyText')} />
        ) : (
          <section aria-labelledby="offers-title">
            <h2 id="offers-title" className="mb-3 text-xl font-bold sm:text-2xl">
              {t('offersTitle')}
            </h2>
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="promotion-list">
              {promotions.map((p, index) => (
                <li key={p.id} className="min-w-0">
                  <InView className="promo-enter h-full" delayMs={Math.min(index, 5) * 70}>
                    <PromotionTicket promotion={p} />
                  </InView>
                </li>
              ))}
            </ul>
          </section>
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
