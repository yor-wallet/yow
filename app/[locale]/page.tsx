import { PackageSearch, Search } from 'lucide-react';
import { asLocale } from '@/i18n/routing';
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getNavCategories } from '@/lib/nav';
import { localize } from '@/lib/localized';
import { buttonClasses } from '@/components/ui/Button';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { Reveal } from '@/components/ui/Reveal';

/**
 * Placeholder home (foundation). The storefront module replaces this with the full
 * home (hero ads, deals, brand rows, FLEX, EXPRESS, reviews…) and may move it into (shop).
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const [t, categories, currentLocale] = await Promise.all([getTranslations('home'), getNavCategories(), getLocale()]);

  return (
    <div className="pb-8">
      <section className="page-container pt-4 lg:pt-8" aria-labelledby="home-hero-title">
        <div data-theme="dark" className="relative overflow-hidden rounded-[28px] border border-border bg-gradient-premium px-5 py-10 text-white shadow-float sm:px-10 sm:py-14 lg:px-14 lg:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -end-24 -top-24 size-80 rounded-full opacity-60 blur-3xl"
            style={{ background: 'radial-gradient(circle, rgb(0 217 255 / 0.55), transparent 65%)' }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 -start-20 size-72 rounded-full opacity-50 blur-3xl"
            style={{ background: 'radial-gradient(circle, rgb(255 121 0 / 0.5), transparent 65%)' }}
          />
          <div className="relative max-w-2xl">
            <p className="text-sm font-semibold text-cyan">{t('hero.eyebrow')}</p>
            <h1 id="home-hero-title" className="mt-3 text-[clamp(1.85rem,5vw,3.4rem)] font-extrabold leading-[1.1]">
              {t('hero.title')}
            </h1>
            <p className="mt-4 max-w-xl text-base text-mist sm:text-lg">{t('hero.subtitle')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/categories" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
                {t('hero.ctaCategories')}
              </Link>
              <Link
                href="/search"
                className={buttonClasses({ variant: 'outline', size: 'lg' })}
              >
                <Search size={18} aria-hidden="true" />
                {t('hero.ctaSearch')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {categories.length > 0 ? (
        <section className="page-container mt-12" aria-labelledby="home-categories-title">
          <h2 id="home-categories-title" className="text-xl font-bold sm:text-2xl">
            {t('categories.title')}
          </h2>
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {categories.map((c, i) => (
              <li key={c.id}>
                <Reveal delay={i * 0.06}>
                  <Link
                    href={`/category/${c.slug}`}
                    className="group flex h-full min-h-32 flex-col justify-between gap-4 rounded-card border border-border bg-surface p-4 shadow-card transition-[transform,border-color,box-shadow] duration-(--dur-card) ease-premium hover:-translate-y-0.5 hover:border-border-strong hover:shadow-glow-blue sm:p-5"
                  >
                    <span className="grid size-12 place-items-center rounded-2xl bg-gradient-premium text-cyan">
                      <CategoryIcon name={c.icon} size={22} />
                    </span>
                    <span>
                      <span className="block font-bold text-fg">{localize(c.name, currentLocale)}</span>
                      <span className="mt-0.5 block text-xs text-muted">{t('categories.subcategories', { count: c.children.length })}</span>
                    </span>
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="page-container mt-12">
        <EmptyState
          icon={<PackageSearch size={26} />}
          title={t('catalogue.emptyTitle')}
          description={t('catalogue.emptyText')}
          action={
            <Link href="/categories" className={buttonClasses({ variant: 'secondary' })}>
              {t('hero.ctaCategories')}
            </Link>
          }
        />
      </section>
    </div>
  );
}
