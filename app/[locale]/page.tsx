import type { Metadata } from 'next';
import { asLocale } from '@/i18n/routing';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { getNavCategories } from '@/lib/nav';
import { localize } from '@/lib/localized';
import { categoryPath } from '@/lib/catalog/paths';
import { favoriteIdsFor } from '@/lib/catalog/favorites';
import { getCachedCampaigns, getCachedLatestReviews, getHomeRail, getPromotionViews, type RailKey } from '@/lib/catalog/cache';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Reveal } from '@/components/ui/Reveal';
import { HeroCarousel } from '@/components/shop/HeroCarousel';
import { ExpressSection, FlexSection, PromotionStrip, ReviewsSection, StaticHero, SupportSection } from '@/components/shop/HomeSections';
import { ProductRail } from '@/components/shop/ProductRail';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'home' });
  return { title: { absolute: `DOOM | دوم — ${t('metaTitle')}` } };
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
 * Home (SPEC → Home page sections): hero ads → deals → smartphones → Apple → Samsung →
 * HONOR → computers → audio & accessories → DOOM FLEX → DOOM EXPRESS → recommended →
 * verified reviews → support. Every product section shows an honest empty state until an
 * administrator publishes real products.
 */
export default async function HomePage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('home');

  const keys: RailKey[] = ['deals', 'smartphones', 'apple', 'samsung', 'honor', 'computers', 'audio', 'recommended'];
  const [categories, slides, promotions, reviews, session, ...rails] = await Promise.all([
    getNavCategories(),
    getCachedCampaigns('home_hero', locale),
    getPromotionViews(locale),
    getCachedLatestReviews(locale),
    getSession(),
    ...keys.map((k) => getHomeRail(k, locale)),
  ]);
  const byKey = Object.fromEntries(keys.map((k, i) => [k, rails[i] ?? []])) as Record<RailKey, (typeof rails)[number]>;
  const favoriteIds = await favoriteIdsFor(session?.user.id, [...new Set(rails.flatMap((r) => r.map((p) => p.id)))]);

  const rail = (key: RailKey, headingLevel: 2 | 3 = 2) => (
    <ProductRail
      id={key}
      eyebrow={t(`sections.${key}.eyebrow`)}
      title={t(`sections.${key}.title`)}
      subtitle={t(`sections.${key}.subtitle`)}
      seeAllHref={SEE_ALL[key]}
      seeAllLabel={t('sections.seeAll')}
      emptyTitle={t(`sections.${key}.emptyTitle`)}
      emptyText={t(`sections.${key}.emptyText`)}
      products={byKey[key]}
      favoriteIds={favoriteIds}
      headingLevel={headingLevel}
    />
  );

  return (
    <div className="pb-10">
      <h1 className="sr-only">{t('hero.title')}</h1>

      <section className="page-container pt-4 lg:pt-8" aria-label={t('carousel.label')}>
        {slides.length > 0 ? <HeroCarousel slides={slides} /> : <StaticHero />}
      </section>

      {categories.length > 0 ? (
        <section className="page-container mt-10" aria-labelledby="home-categories-title">
          <h2 id="home-categories-title" className="text-xl font-bold sm:text-2xl">
            {t('categories.title')}
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {categories.map((c, i) => (
              <li key={c.id} className="min-w-0">
                <Reveal delay={i * 0.06}>
                  <Link
                    href={categoryPath(c.slug)}
                    className="group flex h-full min-h-32 flex-col justify-between gap-4 rounded-card border border-border bg-surface p-4 shadow-card transition-[transform,border-color,box-shadow] duration-(--dur-card) ease-premium hover:-translate-y-0.5 hover:border-border-strong hover:shadow-glow-blue sm:p-5"
                  >
                    <span className="grid size-12 place-items-center rounded-2xl bg-gradient-premium text-cyan">
                      <CategoryIcon name={c.icon} size={22} />
                    </span>
                    <span>
                      <span className="block font-bold text-fg">{localize(c.name, locale)}</span>
                      <span className="mt-0.5 block text-xs text-muted">{t('categories.subcategories', { count: c.children.length })}</span>
                    </span>
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {promotions.length > 0 ? (
        <div className="page-container mt-12">
          <PromotionStrip promotions={promotions} />
        </div>
      ) : null}
      {rail('deals')}
      {rail('smartphones')}
      {rail('apple')}
      {rail('samsung')}
      {rail('honor')}
      {rail('computers')}
      {rail('audio')}
      <FlexSection />
      <ExpressSection />
      {rail('recommended')}
      <ReviewsSection reviews={reviews} />
      <SupportSection />
    </div>
  );
}
