import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { getNavCategories } from '@/lib/nav';
import { categoryPath } from '@/lib/catalog/paths';
import { favoriteIdsFor } from '@/lib/catalog/favorites';
import { getCachedCampaigns, getCachedLatestReviews, getHomeRail, getPromotionViews, type RailKey } from '@/lib/catalog/cache';
import { HeroCarousel } from '@/components/ads/HeroCarousel';
import { PromoBanner } from '@/components/ads/PromoBanner';
import {
  CategoryStrip,
  ExpressSection,
  FlexSection,
  HeroSkeleton,
  PromotionStrip,
  ReviewsSection,
  ReviewsSkeleton,
  StaticHero,
  SupportSection,
} from '@/components/shop/HomeSections';
import { ProductRail, RailSkeleton } from '@/components/shop/ProductRail';
import { ServiceChips } from '@/components/shop/ServiceChips';
import { getDeliveryHighlights } from '@/lib/delivery/area';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'home' });
  return {
    title: { absolute: `DOOM | دوم — ${t('metaTitle')}` },
    description: t('hero.subtitle'),
    openGraph: { title: `DOOM | دوم — ${t('metaTitle')}`, description: t('hero.subtitle') },
  };
}

/** Where each rail's "See all" link goes (locale-less). Brand rails use the search page. */
const SEE_ALL: Record<RailKey, string> = {
  deals: '/promotions',
  smartphones: categoryPath('smartphones'),
  apple: '/search?brand=apple',
  samsung: '/search?brand=samsung',
  honor: '/search?brand=honor',
  computers: categoryPath('computers'),
  audio: categoryPath('audio'),
  recommended: '/search',
};

/**
 * Home (SPEC → Home page sections): hero ads → delivery promises → categories → recommended → deals → smartphones → Apple → Samsung →
 * HONOR → computers → audio & accessories → DOOM FLEX → DOOM EXPRESS →
 * verified reviews → support (footer from the layout). The hero renders first; every data
 * section streams in behind a same-size skeleton (Suspense). Product sections show an honest
 * empty state until an administrator publishes real products.
 */
export default async function HomePage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const [t, categories] = await Promise.all([getTranslations('home'), getNavCategories()]);

  return (
    <div className="pb-10">
      <h1 id="home-hero-title" className="sr-only">
        {t('hero.title')}
      </h1>

      <section className="page-container pt-1 lg:pt-8" aria-labelledby="home-hero-title">
        <Suspense fallback={<HeroSkeleton />}>
          <Hero locale={locale} />
        </Suspense>
      </section>

      <Suspense fallback={null}>
        <Chips />
      </Suspense>

      <CategoryStrip categories={categories} locale={locale} />

      {/* Approved phone design: "Picks for you" comes right after the categories. */}
      <Suspense fallback={<RailSkeleton id="recommended" />}>
        <Rail railKey="recommended" locale={locale} />
      </Suspense>

      <Suspense fallback={<RailSkeleton id="deals" />}>
        <Deals locale={locale} />
      </Suspense>
      {(['smartphones', 'apple', 'samsung', 'honor'] as const).map((k) => (
        <Suspense key={k} fallback={<RailSkeleton id={k} />}>
          <Rail railKey={k} locale={locale} />
        </Suspense>
      ))}

      <Suspense fallback={null}>
        <PromoBanner placement="home_mid" locale={locale} className="page-container mt-14" />
      </Suspense>

      {(['computers', 'audio'] as const).map((k) => (
        <Suspense key={k} fallback={<RailSkeleton id={k} />}>
          <Rail railKey={k} locale={locale} />
        </Suspense>
      ))}
      <FlexSection />
      <ExpressSection />
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews locale={locale} />
      </Suspense>
      <SupportSection />
    </div>
  );
}

async function Hero({ locale }: { locale: string }) {
  const slides = await getCachedCampaigns('home_hero', locale);
  return slides.length > 0 ? <HeroCarousel slides={slides} /> : <StaticHero />;
}

/** Delivery promises under the hero: only what the configured zones can actually deliver. */
async function Chips() {
  const hours = await getDeliveryHighlights().catch(() => ({ standardHours: null, expressHours: null }));
  return (
    <div className="page-container mt-4 empty:hidden">
      <ServiceChips expressHours={hours.expressHours} standardHours={hours.standardHours} />
    </div>
  );
}

async function Rail({ railKey, locale, children }: { railKey: RailKey; locale: string; children?: React.ReactNode }) {
  const [t, products, session] = await Promise.all([getTranslations('home'), getHomeRail(railKey, locale), getSession()]);
  const favoriteIds = await favoriteIdsFor(session?.user.id, products.map((p) => p.id));
  return (
    <>
      {children}
      <ProductRail
        id={railKey}
        eyebrow={t(`sections.${railKey}.eyebrow`)}
        title={t(`sections.${railKey}.title`)}
        subtitle={t(`sections.${railKey}.subtitle`)}
        seeAllHref={SEE_ALL[railKey]}
        seeAllLabel={t('sections.seeAll')}
        emptyTitle={t(`sections.${railKey}.emptyTitle`)}
        emptyText={t(`sections.${railKey}.emptyText`)}
        products={products}
        favoriteIds={favoriteIds}
        priorityImages={false}
      />
    </>
  );
}

/** Deals of the day: live promotions (real rows) above the products flagged as deals. */
async function Deals({ locale }: { locale: string }) {
  const promotions = await getPromotionViews(locale);
  return (
    <Rail railKey="deals" locale={locale}>
      {promotions.length > 0 ? (
        <div className="page-container mt-14 -mb-8">
          <PromotionStrip promotions={promotions} />
        </div>
      ) : null}
    </Rail>
  );
}

async function Reviews({ locale }: { locale: string }) {
  return <ReviewsSection reviews={await getCachedLatestReviews(locale)} />;
}
