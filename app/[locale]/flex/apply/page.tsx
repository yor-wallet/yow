import type { Metadata } from 'next';
import Image from 'next/image';
import { PackageSearch, ShieldAlert } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { formatBaisa } from '@/lib/money';
import { localize } from '@/lib/localized';
import { mediaUrl } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { computeSchedule, FLEX_MONTHS, getFlexEligibility, getFlexProduct, isFlexMonths, type FlexMonths } from '@/lib/flex';
import { PageHeader } from '@/components/layout/PageHeader';
import { HudCorners } from '@/components/ui/HudCorners';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { Price } from '@/components/ui/Price';
import { ScheduleTable } from '@/components/flex/ScheduleTable';
import { ApplyFlexButton } from '@/components/flex/FlexForms';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'flex.apply' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.slice(0, 120) : undefined);

export default async function FlexApplyPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const sp = await searchParams;
  const productRef = one(sp.product);
  const variantId = one(sp.v);
  const monthsRaw = Number(one(sp.months));
  const months: FlexMonths = isFlexMonths(monthsRaw) ? monthsRaw : 12;
  const query = new URLSearchParams({ ...(productRef ? { product: productRef } : {}), ...(variantId ? { v: variantId } : {}), months: String(months) });
  const { user } = await requireUser({ next: `/flex/apply?${query.toString()}` });
  const [t, tf] = await Promise.all([getTranslations('flex.apply'), getTranslations('flex')]);

  const product = productRef ? await getFlexProduct(productRef, variantId) : null;
  const eligibility = await getFlexEligibility(user.id);

  const header = <PageHeader title={t('title')} fallbackHref={product ? `/product/${product.slug}` : '/flex'} />;
  if (!product) {
    return (
      <div className="pb-16">
        {header}
        <div className="page-container mt-6">
          <EmptyState
            icon={<PackageSearch size={26} />}
            title={t('productMissing')}
            description={t('productMissingText')}
            action={
              <Link href="/flex" className={buttonClasses({ variant: 'secondary' })}>
                {t('backToFlex')}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const name = localize(product.name, locale);
  const variantName = localize(product.variantName, locale);
  const schedule = product.priceBaisa && product.priceBaisa >= months ? computeSchedule(product.priceBaisa, months) : null;
  const kycMissing = eligibility.reasons.includes('kyc_required');
  const blocking = [...eligibility.reasons.filter((r) => r !== 'kyc_required'), ...(product.available ? [] : [product.reason!])];

  return (
    <div className="pb-16">
      {header}
      <div className="page-container mt-4 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside className="relative min-w-0 self-start rounded-card border border-border bg-surface p-5 shadow-card" data-testid="flex-product">
          <HudCorners />
          <div className="flex items-center gap-4">
            {product.imageKey ? (
              <Image src={mediaUrl(product.imageKey) ?? ''} alt="" width={96} height={96} className="size-20 shrink-0 rounded-xl bg-white/5 object-contain" />
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-semibold">{name}</p>
              {variantName ? <p className="truncate text-sm text-muted">{variantName}</p> : null}
              <p className="mt-1 text-sm text-muted">{t('cashPrice')}</p>
              <p className="font-display">
                <Price baisa={product.priceBaisa} size="xl" />
              </p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-border p-3">
              <dt className="text-muted">{t('interest')}</dt>
              <dd className="font-display font-bold text-success">0%</dd>
            </div>
            <div className="rounded-xl border border-border p-3">
              <dt className="text-muted">{t('fees')}</dt>
              <dd className="font-display font-bold text-success [unicode-bidi:isolate]">{formatBaisa(0, locale)}</dd>
            </div>
          </dl>
        </aside>

        <section className="min-w-0" aria-labelledby="flex-duration">
          {kycMissing ? (
            <div className="mb-6 flex flex-col gap-3 rounded-card border border-amber/50 bg-amber/10 p-5" data-testid="flex-kyc-required">
              <p className="flex items-center gap-2 font-bold">
                <ShieldAlert size={20} aria-hidden="true" className="text-amber" />
                {t('kycTitle')}
              </p>
              <p className="text-sm text-muted">{t('kycText')}</p>
              <Link href="/account/verification" className={buttonClasses({ variant: 'accent', className: 'self-start' })} data-testid="flex-kyc-link">
                {tf('eligibility.kycCta')}
              </Link>
            </div>
          ) : null}

          <h2 id="flex-duration" className="text-lg font-bold">
            {t('chooseDuration')}
          </h2>
          <p className="mt-1 text-sm font-semibold text-accent">{tf('facts.fees')}</p>
          <nav className="mt-3 flex flex-wrap gap-2" aria-label={t('chooseDuration')} data-testid="flex-months">
            {FLEX_MONTHS.map((m) => {
              const q = new URLSearchParams({ product: product.slug, v: product.variantId, months: String(m) });
              return (
                <Link
                  key={m}
                  href={`/flex/apply?${q.toString()}`}
                  replace
                  scroll={false}
                  aria-current={m === months ? 'true' : undefined}
                  data-testid={`flex-months-${m}`}
                  className={cn(
                    'inline-flex min-h-11 min-w-24 flex-1 items-center justify-center rounded-pill border px-4 font-display text-sm font-bold transition-[border-color,background-color,box-shadow] duration-(--dur-btn) sm:flex-none',
                    m === months ? 'border-transparent bg-gradient-primary text-on-accent shadow-glow-blue' : 'border-border bg-surface text-fg hover:border-blue/50',
                  )}
                >
                  {t('months', { months: m })}
                </Link>
              );
            })}
          </nav>
          {schedule ? (
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm text-muted" data-testid="flex-monthly">
              <Price baisa={schedule.monthlyBaisa} size="lg" />
              <span>{t('perMonthLabel')}</span>
            </p>
          ) : null}

          {schedule ? (
            <div className="mt-6">
              <h2 className="mb-3 text-lg font-bold">{t('schedule')}</h2>
              <ScheduleTable rows={schedule.installments} totalBaisa={schedule.totalBaisa} />
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3">
            {blocking.length > 0 ? (
              <div className="rounded-xl border border-error/40 bg-error/5 p-4" data-testid="flex-not-eligible">
                <p className="font-semibold">{t('notEligible')}</p>
                <ul className="mt-1 text-sm text-muted">
                  {blocking.map((r) => (
                    <li key={r}>· {tf(`eligibility.reasons.${r}`)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!kycMissing && blocking.length === 0 && schedule ? <ApplyFlexButton productId={product.productId} variantId={product.variantId} months={months} /> : null}
            <p className="text-xs text-muted">{t('notice')}</p>
            <p className="text-xs text-muted">{t('deliveryNote')}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
