import type { Metadata } from 'next';
import { BadgeCheck, CalendarClock, ChevronRight, Percent, ShieldCheck, Wallet } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { formatBaisa } from '@/lib/money';
import { localize } from '@/lib/localized';
import { computeSchedule, FLEX_MONTHS, flexPartnerName, getFlexEligibility, listFlexApplications } from '@/lib/flex';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { HudCorners } from '@/components/ui/HudCorners';
import { Badge } from '@/components/ui/Badge';
import { FLEX_STATUS_VARIANT } from '@/components/flex/status';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Price } from '@/components/ui/Price';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'flex' });
  return { title: t('metaTitle'), description: t('heroText') };
}


/** Spec example: 360.000 OMR → 120 / 60 / 30 per month (illustration, not a product price). */
const EXAMPLE_BAISA = 360_000;

export default async function FlexPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('flex');
  const session = await getSession();
  const [eligibility, apps] = await Promise.all([
    session ? getFlexEligibility(session.user.id) : null,
    session ? listFlexApplications(session.user.id) : null,
  ]);
  const partner = flexPartnerName();
  const facts = [
    { icon: Percent, text: t('facts.interest') },
    { icon: ShieldCheck, text: t('facts.fees') },
    { icon: BadgeCheck, text: t('facts.total') },
    { icon: CalendarClock, text: t('facts.rounding') },
  ];
  const steps = [t('how.s1'), t('how.s2'), t('how.s3'), t('how.s4'), t('how.s5')];

  return (
    <div className="pb-16">
      <PageHeader title={t('title')} mobileOnly fallbackHref="/" />
      <div className="page-container mt-6 lg:mt-10">
        <section className="relative overflow-hidden rounded-card holo-border p-6 shadow-float sm:p-10" data-testid="flex-hero">
          <HudCorners />
          <span aria-hidden="true" className="doom-hairline bottom-0" />
          <span className="hud-label">{t('eyebrow')}</span>
          <h1 className="mt-4 max-w-3xl font-display text-[clamp(1.75rem,1.2rem+2.6vw,3.25rem)] font-extrabold leading-tight">
            <span className="text-gradient-primary">{t('title')}</span>
            <span className="mt-2 block text-fg">{t('heroTitle')}</span>
          </h1>
          <p className="mt-4 max-w-2xl text-muted">{t('heroText')}</p>
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {facts.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card">
                <Icon size={20} aria-hidden="true" className="shrink-0 text-cyan" />
                <span className="text-sm font-semibold">{text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/categories" className={buttonClasses({ variant: 'accent', size: 'lg', className: 'sheen' })}>
              {t('browse')}
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted">{partner ? t('financing.partner', { name: partner }) : t('financing.self')}</p>
        </section>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section aria-labelledby="flex-example">
            <SectionHeading id="flex-example" eyebrow={t('example.title')} title={t('example.text', { amount: formatBaisa(EXAMPLE_BAISA, locale) })} />
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="flex-example">
              {FLEX_MONTHS.map((m) => {
                const s = computeSchedule(EXAMPLE_BAISA, m);
                return (
                  <li key={m} className="relative rounded-2xl border border-border bg-surface p-4 text-center shadow-card">
                    <p className="text-sm font-semibold text-muted">{t('example.months', { months: m })}</p>
                    <p className="mt-1 font-display" data-testid={`flex-example-${m}`} data-baisa={s.monthlyBaisa}>
                      <Price baisa={s.monthlyBaisa} size="lg" />
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted">{t('example.note')}</p>
          </section>

          <section aria-labelledby="flex-eligibility" className="relative rounded-card border border-border bg-surface p-5 shadow-card sm:p-6" data-testid="flex-eligibility">
            <HudCorners />
            <h2 id="flex-eligibility" className="text-lg font-bold">
              {t('eligibility.title')}
            </h2>
            {!session || !eligibility ? (
              <div className="mt-3">
                <p className="text-sm text-muted">{t('eligibility.signIn')}</p>
                <Link href="/login?next=%2Fflex" className={buttonClasses({ variant: 'outline', className: 'mt-4' })}>
                  {t('eligibility.signInCta')}
                </Link>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                <p className="flex items-center gap-2">
                  <Badge variant={eligibility.kycStatus === 'VERIFIED' ? 'success' : 'warning'} data-testid="flex-kyc">
                    {eligibility.kycStatus === 'VERIFIED' ? t('eligibility.kycVerified') : t('eligibility.kycRequired')}
                  </Badge>
                </p>
                <p className="text-sm text-muted">{t('eligibility.openCount', { count: eligibility.openCount })}</p>
                {eligibility.eligible ? (
                  <p className="text-sm font-medium text-success">{t('eligibility.eligible')}</p>
                ) : (
                  <ul className="grid gap-1 text-sm">
                    {eligibility.reasons.map((r) => (
                      <li key={r} className="text-fg">
                        · {t(`eligibility.reasons.${r}`)}
                      </li>
                    ))}
                  </ul>
                )}
                {eligibility.kycStatus !== 'VERIFIED' ? (
                  <Link href="/account/verification" className={buttonClasses({ variant: 'accent', className: 'self-start' })} data-testid="flex-kyc-cta">
                    {t('eligibility.kycCta')}
                  </Link>
                ) : null}
              </div>
            )}
          </section>
        </div>

        <section aria-labelledby="flex-how" className="mt-10">
          <SectionHeading id="flex-how" title={t('how.title')} />
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card md:flex-col">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-premium font-display font-bold text-cyan neon-box" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="text-sm">{s}</span>
              </li>
            ))}
          </ol>
        </section>

        {apps ? (
          <section aria-labelledby="flex-mine" className="mt-10">
            <SectionHeading id="flex-mine" eyebrow={t('eyebrow')} title={t('mine.title')} />
            {apps.length === 0 ? (
              <EmptyState compact icon={<Wallet size={24} />} title={t('mine.empty')} description={t('mine.emptyText')} />
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="flex-mine">
                {apps.map((a) => {
                  const paid = a.installments.filter((i) => i.status === 'PAID').length;
                  return (
                    <li key={a.id}>
                      <Link href={`/flex/${a.id}`} className="group flex min-h-20 items-center gap-4 rounded-card border border-border bg-surface p-4 shadow-card transition-[border-color,box-shadow] duration-(--dur-card) hover:border-blue/50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{localize(a.product?.name, locale, t('title'))}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                            <Badge variant={FLEX_STATUS_VARIANT[a.status] ?? 'neutral'}>{t(`statuses.${a.status}`)}</Badge>
                            <span>{t('detail.monthsValue', { months: a.months })}</span>
                            <Price baisa={a.principalBaisa} size="sm" />
                            {a.installments.length ? <span>{t('mine.progress', { paid, total: a.installments.length })}</span> : null}
                          </span>
                        </span>
                        <ChevronRight size={18} aria-hidden="true" className="flip-rtl shrink-0 text-muted" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        <section aria-labelledby="flex-faq" className="mt-10">
          <SectionHeading id="flex-faq" title={t('faq.title')} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {(['1', '2', '3', '4'] as const).map((n) => (
              <details key={n} className="group rounded-2xl border border-border bg-surface p-4 shadow-card open:border-blue/40">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                  {t(`faq.q${n}`)}
                  <ChevronRight size={18} aria-hidden="true" className="shrink-0 rotate-90 text-muted transition-transform duration-(--dur-btn) group-open:-rotate-90" />
                </summary>
                <p className="mt-2 text-sm text-muted">{t(`faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
