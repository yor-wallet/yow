import { CalendarClock, MessageCircle, PackageSearch, Search, ShieldCheck, Star, Tag, Truck, Zap } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Reveal } from '@/components/ui/Reveal';
import type { PromotionView } from '@/lib/catalog/cache';
import { computeSchedule, FLEX_MONTHS } from '@/lib/catalog/flex-preview';
import { productPath } from '@/lib/catalog/paths';
import { Stars } from './Stars';
import type { ReviewView } from '@/lib/catalog/queries';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';

/** Static hero shown only when no campaign is live (the carousel replaces it otherwise). */
export function StaticHero() {
  const t = useTranslations('home');
  return (
    <div data-theme="dark" className="relative overflow-hidden rounded-[28px] border border-border bg-gradient-premium px-5 py-10 text-white shadow-float sm:px-10 sm:py-14 lg:px-14 lg:py-20">
      <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 size-80 rounded-full opacity-60 blur-3xl" style={{ background: 'radial-gradient(circle, rgb(0 217 255 / 0.55), transparent 65%)' }} />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -start-20 size-72 rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle, rgb(255 121 0 / 0.5), transparent 65%)' }} />
      <div className="relative max-w-2xl">
        <p className="text-sm font-semibold text-cyan">{t('hero.eyebrow')}</p>
        <p className="mt-3 text-[clamp(1.85rem,5vw,3.4rem)] font-extrabold leading-[1.1]">{t('hero.title')}</p>
        <p className="mt-4 max-w-xl text-base text-mist sm:text-lg">{t('hero.subtitle')}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/categories" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
            {t('hero.ctaCategories')}
          </Link>
          <Link href="/search" className={buttonClasses({ variant: 'outline', size: 'lg' })}>
            <Search size={18} aria-hidden="true" />
            {t('hero.ctaSearch')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Live promotions only (loaded from the database; nothing is ever invented). */
export function PromotionStrip({ promotions }: { promotions: readonly PromotionView[] }) {
  const t = useTranslations('home.promoCard');
  const locale = useLocale();
  const format = useFormatter();
  if (promotions.length === 0) return null;
  return (
    <ul className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="promotion-strip">
      {promotions.slice(0, 3).map((p) => (
        <li key={p.id} className="min-w-0">
          <Card tone="gradient" className="flex h-full flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="secondary">
                <Tag size={12} aria-hidden="true" />
                {p.type === 'PERCENT' ? t('percent', { value: Number((p.value / 100).toFixed(2)) }) : t('fixed', { amount: formatBaisa(p.value, locale) })}
              </Badge>
              {p.code ? <Badge variant="neutral">{t('code', { code: p.code })}</Badge> : <span className="text-xs text-muted">{t('auto')}</span>}
            </div>
            <p className="font-semibold">{p.name}</p>
            {p.description ? <p className="line-clamp-2 text-sm text-muted">{p.description}</p> : null}
            <p className="mt-auto flex flex-wrap gap-x-3 text-xs text-muted">
              {p.endsAt ? <span>{t('endsOn', { date: format.dateTime(new Date(p.endsAt), 'short') })}</span> : null}
              {p.minSubtotalBaisa ? <span>{t('minSpend', { amount: formatBaisa(p.minSubtotalBaisa, locale) })}</span> : null}
            </p>
            <Link href="/promotions" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline">
              {t('view')}
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
    <section className="page-container mt-12" aria-labelledby="home-flex-title" data-testid="home-flex">
      <Reveal>
        <div data-theme="dark" className="relative overflow-hidden rounded-[28px] border border-border bg-[linear-gradient(135deg,#10052E_0%,#3A1A5E_50%,#FF7900_160%)] p-6 text-white shadow-float sm:p-10">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber">{t('eyebrow')}</p>
              <h2 id="home-flex-title" className="mt-2 text-[clamp(1.6rem,4vw,2.6rem)] font-extrabold leading-tight">
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
            <div className="min-w-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mist">{t('example')}</p>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={t('example')}>
                {FLEX_MONTHS.map((m) => {
                  const s = computeSchedule(ILLUSTRATION_BAISA, m);
                  return (
                    <li key={m} className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
                      <p className="text-sm text-mist">{t('months', { count: m })}</p>
                      <p className="mt-1 text-lg font-bold tabular-nums [unicode-bidi:isolate]">{t('perMonth', { amount: formatBaisa(s.monthlyBaisa, locale) })}</p>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-mist">{t('exampleCaption')}</p>
            </div>
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
        <div className="grid items-center gap-6 rounded-[28px] border border-border bg-surface p-6 shadow-card sm:p-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-accent">{t('eyebrow')}</p>
            <h2 id="home-express-title" className="mt-2 text-[clamp(1.5rem,3.6vw,2.3rem)] font-extrabold leading-tight">
              {t('title')}
            </h2>
            <p className="mt-3 text-muted">{t('lead')}</p>
            <p className="mt-4 flex items-center gap-2 text-sm font-medium">
              <CalendarClock size={18} aria-hidden="true" className="text-accent" />
              {t('tracking')}
            </p>
            <p className="mt-2 text-xs text-muted">{t('note')}</p>
            <Link href="/delivery" className={cn(buttonClasses({ variant: 'primary', size: 'md' }), 'mt-5')}>
              {t('cta')}
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-surface-2 p-4">
              <dt className="flex items-center gap-2 text-sm text-muted">
                <Truck size={16} aria-hidden="true" />
                {t('standard')}
              </dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums">{t('standardTime')}</dd>
            </div>
            <div className="gradient-border rounded-2xl p-4">
              <dt className="flex items-center gap-2 text-sm text-muted">
                <Zap size={16} aria-hidden="true" className="text-amber" />
                {t('expressLabel')}
              </dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums">{t('expressTime')}</dd>
            </div>
          </dl>
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
    <section className="page-container mt-12" aria-labelledby="home-reviews-title" data-testid="home-reviews">
      <Reveal>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t('eyebrow')}</p>
        <h2 id="home-reviews-title" className="text-xl font-bold sm:text-2xl">
          {t('title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        {reviews.length === 0 ? (
          <EmptyState compact className="mt-4" icon={<Star size={24} />} title={t('emptyTitle')} description={t('emptyText')} />
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="min-w-0">
                <Card className="flex h-full flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Stars rating={r.rating} label={t('rating', { rating: r.rating })} />
                    <Badge variant="success">{t('verified')}</Badge>
                  </div>
                  {r.title ? <p className="font-semibold">{r.title}</p> : null}
                  <p className="line-clamp-4 text-sm text-muted">{r.text}</p>
                  <p className="mt-auto text-xs text-muted">
                    {r.author} · {format.dateTime(new Date(r.createdAt), 'short')}
                  </p>
                  {r.product ? (
                    <Link href={productPath(r.product.slug)} className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
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

export function SupportSection() {
  const t = useTranslations('home.support');
  const items = [
    { href: '/account/support', icon: MessageCircle, title: t('ticket'), text: t('ticketText') },
    { href: '/orders', icon: PackageSearch, title: t('orders'), text: t('ordersText') },
    { href: '/delivery', icon: Truck, title: t('delivery'), text: t('deliveryText') },
  ] as const;
  return (
    <section className="page-container mt-12" aria-labelledby="home-support-title" data-testid="home-support">
      <Reveal>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t('eyebrow')}</p>
        <h2 id="home-support-title" className="text-xl font-bold sm:text-2xl">
          {t('title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {items.map(({ href, icon: Icon, title, text }) => (
            <li key={href} className="min-w-0">
              <Link href={href} className="group flex h-full items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-card transition-[transform,border-color,box-shadow] duration-(--dur-card) ease-premium hover:-translate-y-0.5 hover:border-border-strong hover:shadow-glow-blue">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-premium text-cyan">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{title}</span>
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
