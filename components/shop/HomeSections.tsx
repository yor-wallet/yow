import type { CSSProperties } from 'react';
import { ArrowRight, CalendarClock, MessageCircle, PackageSearch, Search, ShieldCheck, Star, Tag, Truck, Zap } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { HudCorners } from '@/components/ui/HudCorners';
import { Reveal } from '@/components/ui/Reveal';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Skeleton } from '@/components/ui/Skeleton';
import type { PromotionView } from '@/lib/catalog/cache';
import { computeSchedule, FLEX_MONTHS } from '@/lib/catalog/flex-preview';
import { categoryPath, productPath } from '@/lib/catalog/paths';
import type { ReviewView } from '@/lib/catalog/queries';
import type { NavCategory } from '@/lib/nav';
import { localize } from '@/lib/localized';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';
import { Stars } from './Stars';

/** Static hero shown only when no campaign is live (the carousel replaces it otherwise). */
export function StaticHero() {
  const t = useTranslations('home');
  return (
    <div data-theme="dark" className="holo-border relative overflow-hidden rounded-[28px] bg-gradient-premium px-5 py-6 text-white shadow-float md:px-10 md:py-14 lg:px-14 lg:py-20">
      <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 size-80 rounded-full opacity-60 blur-3xl" style={{ background: 'radial-gradient(circle, rgb(0 217 255 / 0.55), transparent 65%)' }} />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -start-20 size-72 rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle, rgb(255 121 0 / 0.5), transparent 65%)' }} />
      <HudCorners className="m-4" size={16} />
      <div className="relative max-w-2xl">
        <span className="hud-label">{t('hero.eyebrow')}</span>
        <p className="neon mt-3 font-display text-[1.5rem] font-extrabold leading-[1.15] md:mt-4 md:text-[clamp(1.85rem,5vw,3.4rem)] md:leading-[1.08]">{t('hero.title')}</p>
        <p className="mt-4 hidden max-w-xl text-base text-mist md:block md:text-lg">{t('hero.subtitle')}</p>
        <div className="mt-4 flex flex-wrap gap-3 md:mt-8">
          <Link href="/categories" className={buttonClasses({ variant: 'accent', size: 'md', className: 'md:min-h-13 md:px-7 md:text-base' })}>
            {t('hero.ctaCategories')}
          </Link>
          <Link href="/search" className={buttonClasses({ variant: 'outline', size: 'lg', className: 'hidden md:inline-flex' })}>
            <Search size={18} aria-hidden="true" />
            {t('hero.ctaSearch')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Fixed-size placeholder of the hero while campaigns stream in (no layout shift). */
export function HeroSkeleton() {
  return <Skeleton className="min-h-[36rem] w-full rounded-[28px] md:min-h-[30rem] lg:min-h-[33rem]" />;
}

/** Category shortcuts: glass tiles with a neon icon module. */
export function CategoryStrip({ categories, locale }: { categories: readonly NavCategory[]; locale: string }) {
  const t = useTranslations('home.categories');
  if (categories.length === 0) return null;
  return (
    <section className="page-container mt-4 md:mt-12" aria-labelledby="home-categories-title" data-testid="home-categories">
      <SectionHeading id="home-categories-title" title={t('title')} className="max-md:sr-only" />
      {/* Phones: four compact tiles in one row (icon + short label). */}
      <ul className="grid grid-cols-4 gap-2.5 md:hidden">
        {categories.slice(0, 4).map((c) => (
          <li key={c.id} className="min-w-0">
            <Link
              href={categoryPath(c.slug)}
              className="flex h-full flex-col items-center justify-start gap-1.5 rounded-2xl border border-border bg-surface px-1 py-2.5 text-center shadow-card transition-colors hover:border-border-strong"
            >
              <span className="grid size-10 place-items-center text-fg" aria-hidden="true">
                <CategoryIcon name={c.icon} size={26} />
              </span>
              <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-fg break-words xs:text-xs">{localize(c.name, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="hidden grid-cols-2 gap-3 sm:gap-4 md:grid lg:grid-cols-4">
        {categories.map((c, i) => (
          <li key={c.id} className="min-w-0">
            <Reveal delay={i * 0.06}>
              <Link
                href={categoryPath(c.slug)}
                data-spotlight=""
                className="spotlight holo-border-hover glass group relative flex h-full min-h-32 flex-col justify-between gap-4 rounded-card p-4 shadow-card transition-[transform,box-shadow] duration-(--dur-card) ease-premium hover:-translate-y-1 hover:shadow-glow-blue sm:p-5"
              >
                <span className="neon-box grid size-12 place-items-center rounded-2xl bg-gradient-premium text-cyan transition-transform duration-(--dur-card) ease-premium group-hover:scale-105">
                  <CategoryIcon name={c.icon} size={22} />
                </span>
                <span>
                  <span className="block font-display font-bold text-fg">{localize(c.name, locale)}</span>
                  <span className="mt-0.5 block text-xs text-muted">{t('subcategories', { count: c.children.length })}</span>
                </span>
                <ArrowRight
                  size={18}
                  aria-hidden="true"
                  className="flip-rtl absolute end-4 top-4 text-muted opacity-0 transition-[opacity,translate] duration-(--dur-card) group-hover:translate-x-0.5 group-hover:opacity-100 rtl:group-hover:-translate-x-0.5"
                />
              </Link>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Live promotions only (loaded from the database; nothing is ever invented). */
export function PromotionStrip({ promotions }: { promotions: readonly PromotionView[] }) {
  const t = useTranslations('home.promoCard');
  const locale = useLocale();
  const format = useFormatter();
  if (promotions.length === 0) return null;
  return (
    <ul className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="promotion-strip">
      {promotions.slice(0, 3).map((p) => (
        <li key={p.id} className="min-w-0">
          <Card tone="holo" className="relative flex h-full flex-col gap-2 overflow-hidden">
            <div aria-hidden="true" className="pointer-events-none absolute -end-10 -top-10 size-32 rounded-full opacity-50 blur-2xl" style={{ background: 'radial-gradient(circle, rgb(255 121 0 / 0.6), transparent 65%)' }} />
            <div className="relative flex items-center justify-between gap-2">
              <span className="font-display text-3xl font-extrabold text-gradient-secondary [unicode-bidi:isolate]">
                {p.type === 'PERCENT' ? t('percent', { value: Number((p.value / 100).toFixed(2)) }) : t('fixed', { amount: formatBaisa(p.value, locale) })}
              </span>
              {p.code ? (
                <Badge variant="neutral" className="font-display tracking-wider">
                  <Tag size={12} aria-hidden="true" />
                  {t('code', { code: p.code })}
                </Badge>
              ) : (
                <span className="hud-label text-[0.65rem]">{t('auto')}</span>
              )}
            </div>
            <p className="relative font-semibold">{p.name}</p>
            {p.description ? <p className="relative line-clamp-2 text-sm text-muted">{p.description}</p> : null}
            <p className="relative mt-auto flex flex-wrap gap-x-3 text-xs text-muted">
              {p.endsAt ? <span>{t('endsOn', { date: format.dateTime(new Date(p.endsAt), 'short') })}</span> : null}
              {p.minSubtotalBaisa ? <span>{t('minSpend', { amount: formatBaisa(p.minSubtotalBaisa, locale) })}</span> : null}
            </p>
            <Link href="/promotions" className="relative inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent underline-offset-4 hover:underline">
              {t('view')}
              <ArrowRight size={14} aria-hidden="true" className="flip-rtl" />
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** DOOM FLEX explainer with a computed illustration (360 OMR, labelled as not an offer). */
export function FlexSection() {
  const t = useTranslations('home.flex');
  const locale = useLocale();
  const ILLUSTRATION_BAISA = 360_000;
  const points = ['transparent', 'noFees', 'wallet'] as const;
  return (
    <section className="page-container mt-16" aria-labelledby="home-flex-title" data-testid="home-flex">
      <Reveal>
        <div
          data-theme="dark"
          className="holo-border relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,rgb(16_5_46/0.92)_0%,rgb(58_26_94/0.9)_52%,rgb(255_121_0/0.55)_160%)] p-6 text-white shadow-float sm:p-10"
        >
          <div aria-hidden="true" className="pointer-events-none absolute -end-20 -top-24 size-96 rounded-full opacity-45 blur-3xl" style={{ background: 'radial-gradient(circle, rgb(255 174 0 / 0.6), transparent 65%)' }} />
          <HudCorners className="m-4 text-amber/70" size={16} />
          <div className="relative grid items-center gap-8 lg:grid-cols-2">
            <div className="min-w-0">
              <span className="hud-label text-amber">{t('eyebrow')}</span>
              <h2 id="home-flex-title" className="neon mt-3 font-display text-[clamp(1.6rem,4vw,2.7rem)] font-extrabold leading-tight">
                {t('title')}
              </h2>
              <p className="mt-3 text-base text-mist sm:text-lg">{t('lead')}</p>
              <ul className="mt-5 space-y-2">
                {points.map((k) => (
                  <li key={k} className="flex items-start gap-2 text-sm">
                    <ShieldCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-amber" />
                    <span>{t(`points.${k}`)}</span>
                  </li>
                ))}
              </ul>
              <Link href="/flex" className={cn(buttonClasses({ variant: 'accent', size: 'lg' }), 'mt-6')}>
                {t('cta')}
              </Link>
              <p className="mt-3 text-xs text-mist">{t('conditions')}</p>
            </div>
            <figure className="min-w-0">
              <figcaption className="mb-3 flex items-center gap-2">
                <span className="rounded-pill border border-amber/60 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-amber rtl:tracking-normal">{t('example')}</span>
                <span className="text-xs text-mist">{t('exampleCaption')}</span>
              </figcaption>
              <ul className="grid grid-cols-3 items-end gap-2.5 sm:gap-4" aria-label={t('example')}>
                {FLEX_MONTHS.map((m) => {
                  const s = computeSchedule(ILLUSTRATION_BAISA, m);
                  // Bar height proportional to the monthly amount (the 3-month instalment is the tallest).
                  const height = `${Math.max(12, Math.round((s.monthlyBaisa / computeSchedule(ILLUSTRATION_BAISA, 3).monthlyBaisa) * 100))}%`;
                  return (
                    <li key={m} className="flex min-w-0 flex-col items-stretch">
                      <div className="flex h-40 items-end sm:h-48" aria-hidden="true">
                        <div
                          className="w-full rounded-t-2xl border border-b-0 border-white/25 bg-[linear-gradient(180deg,rgb(255_174_0/0.75),rgb(255_121_0/0.15))] shadow-[0_0_28px_-8px_rgb(255_121_0/0.9)]"
                          style={{ height } as CSSProperties}
                        />
                      </div>
                      <div className="rounded-b-2xl border border-white/20 bg-night/50 p-2.5 text-center backdrop-blur sm:p-3">
                        <p className="text-xs text-mist">{t('months', { count: m })}</p>
                        <p className="mt-0.5 font-display text-sm font-bold tabular-nums [unicode-bidi:isolate] sm:text-base">
                          {t('perMonth', { amount: formatBaisa(s.monthlyBaisa, locale) })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </figure>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** DOOM EXPRESS explainer. Targets only: availability and fees are confirmed at checkout. */
export function ExpressSection() {
  const t = useTranslations('home.express');
  return (
    <section className="page-container mt-12" aria-labelledby="home-express-title" data-testid="home-express">
      <Reveal>
        <div data-theme="dark" className="holo-border relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,rgb(16_5_46/0.92)_0%,rgb(11_42_107/0.88)_60%,rgb(8_123_255/0.6)_140%)] p-6 text-white shadow-float sm:p-10">
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-0 w-1/2 opacity-40 [background-image:repeating-linear-gradient(100deg,transparent_0_22px,rgb(0_217_255/0.18)_22px_23px)] [mask-image:linear-gradient(90deg,transparent,#000)] rtl:[mask-image:linear-gradient(270deg,transparent,#000)]" />
          <HudCorners className="m-4" size={16} />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="min-w-0">
              <span className="hud-label">{t('eyebrow')}</span>
              <h2 id="home-express-title" className="neon mt-3 font-display text-[clamp(1.5rem,3.8vw,2.5rem)] font-extrabold leading-tight">
                {t('title')}
              </h2>
              <p className="mt-3 text-mist">{t('lead')}</p>
              <p className="mt-4 flex items-center gap-2 text-sm font-medium">
                <CalendarClock size={18} aria-hidden="true" className="text-cyan" />
                {t('tracking')}
              </p>
              <p className="mt-2 text-xs text-mist">{t('note')}</p>
              <Link href="/delivery" className={cn(buttonClasses({ variant: 'primary', size: 'md' }), 'mt-5')}>
                {t('cta')}
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/20 bg-night/45 p-4 backdrop-blur">
                <dt className="flex items-center gap-2 text-sm text-mist">
                  <Truck size={16} aria-hidden="true" />
                  {t('standard')}
                </dt>
                <dd className="mt-1 font-display text-2xl font-extrabold tabular-nums sm:text-3xl">{t('standardTime')}</dd>
              </div>
              <div className="neon-box rounded-2xl border border-cyan/50 bg-night/55 p-4 backdrop-blur">
                <dt className="flex items-center gap-2 text-sm text-mist">
                  <Zap size={16} aria-hidden="true" className="text-amber" />
                  {t('expressLabel')}
                </dt>
                <dd className="neon mt-1 font-display text-2xl font-extrabold tabular-nums sm:text-3xl">{t('expressTime')}</dd>
              </div>
            </dl>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** Verified-purchase reviews only; an honest empty state when there are none. */
export function ReviewsSection({ reviews }: { reviews: readonly ReviewView[] }) {
  const t = useTranslations('home.reviews');
  const format = useFormatter();
  return (
    <section className="page-container mt-14" aria-labelledby="home-reviews-title" data-testid="home-reviews">
      <Reveal>
        <SectionHeading id="home-reviews-title" eyebrow={t('eyebrow')} title={t('title')} className="mb-2 sm:mb-2" />
        <p className="mb-5 max-w-2xl text-sm text-muted">{t('subtitle')}</p>
        {reviews.length === 0 ? (
          <EmptyState compact icon={<Star size={24} />} title={t('emptyTitle')} description={t('emptyText')} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="min-w-0">
                <Card tone="glass" interactive className="flex h-full flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Stars rating={r.rating} label={t('rating', { rating: r.rating })} className="drop-shadow-[0_0_6px_rgb(255_174_0/0.6)]" />
                    <Badge variant="success">{t('verified')}</Badge>
                  </div>
                  {r.title ? <p className="font-semibold">{r.title}</p> : null}
                  <p className="line-clamp-4 text-sm text-muted">{r.text}</p>
                  <p className="mt-auto text-xs text-muted">
                    {r.author} · {format.dateTime(new Date(r.createdAt), 'short')}
                  </p>
                  {r.product ? (
                    <Link href={productPath(r.product.slug)} className="relative z-10 text-sm font-semibold text-accent underline-offset-4 hover:underline">
                      {t('about', { product: r.product.name })}
                    </Link>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </section>
  );
}

export function ReviewsSkeleton() {
  return (
    <section className="page-container mt-14" aria-hidden="true">
      <Skeleton className="h-3 w-28 rounded-md" />
      <Skeleton className="mt-3 h-7 w-52 rounded-lg" />
      <Skeleton className="mb-5 mt-3 h-4 w-80 max-w-full rounded-md" />
      <Skeleton className="h-40 w-full rounded-card" />
    </section>
  );
}

export function SupportSection() {
  const t = useTranslations('home.support');
  const items = [
    { href: '/account/support', icon: MessageCircle, title: t('ticket'), text: t('ticketText') },
    { href: '/orders', icon: PackageSearch, title: t('orders'), text: t('ordersText') },
    { href: '/delivery', icon: Truck, title: t('delivery'), text: t('deliveryText') },
  ] as const;
  return (
    <section className="page-container mt-14" aria-labelledby="home-support-title" data-testid="home-support">
      <Reveal>
        <SectionHeading id="home-support-title" eyebrow={t('eyebrow')} title={t('title')} className="mb-2 sm:mb-2" />
        <p className="mb-5 max-w-2xl text-sm text-muted">{t('subtitle')}</p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {items.map(({ href, icon: Icon, title, text }) => (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                data-spotlight=""
                className="spotlight holo-border-hover glass group flex h-full items-start gap-3 rounded-card p-4 shadow-card transition-[transform,box-shadow] duration-(--dur-card) ease-premium hover:-translate-y-1 hover:shadow-glow-blue"
              >
                <span className="neon-box grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-premium text-cyan">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block font-display font-semibold">{title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
