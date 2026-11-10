import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { CalendarCheck, CheckCircle2, CircleX, Clock, MapPin, ShieldCheck, Truck } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { localize } from '@/lib/localized';
import { formatBaisa } from '@/lib/money';
import { mediaUrl } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { getBalance } from '@/lib/wallet';
import { listAddresses } from '@/lib/delivery/addresses';
import { FLEX_TERMS_VERSION, getFlexApplication, quoteFlexAcceptance } from '@/lib/flex';
import { PageHeader } from '@/components/layout/PageHeader';
import { Stepper } from '@/components/ui/Stepper';
import { Badge } from '@/components/ui/Badge';
import { Price } from '@/components/ui/Price';
import { HudCorners } from '@/components/ui/HudCorners';
import { buttonClasses } from '@/components/ui/Button';
import { ScheduleTable } from '@/components/flex/ScheduleTable';
import { AcceptFlexForm, CancelFlexButton, PayInstallmentButton } from '@/components/flex/FlexForms';
import { FLEX_STATUS_VARIANT } from '@/components/flex/status';

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ address?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'flex.detail' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const STEP: Record<string, number> = { SUBMITTED: 1, UNDER_REVIEW: 1, APPROVED: 2, ACCEPTED: 2, ACTIVE: 3, COMPLETED: 3 };

export default async function FlexApplicationPage({ params, searchParams }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const { user } = await requireUser({ next: `/flex/${id}` });
  const app = await getFlexApplication(id, { id: user.id, role: user.role });
  if (!app || app.userId !== user.id) notFound();
  const [t, tf, format] = await Promise.all([getTranslations('flex.detail'), getTranslations('flex'), getFormatter()]);

  const name = localize(app.product?.name, locale, tf('title'));
  const variantName = localize(app.variant?.name, locale);
  const image = app.product?.images[0]?.key ?? null;
  const awaitingTerms = app.status === 'APPROVED' || app.status === 'ACCEPTED';
  const active = app.status === 'ACTIVE' || app.status === 'COMPLETED';

  // Terms step: address + exact quote (same engine as checkout).
  let addresses: Awaited<ReturnType<typeof listAddresses>> = [];
  let selectedAddressId: string | null = null;
  let quote: Awaited<ReturnType<typeof quoteFlexAcceptance>> | null = null;
  if (awaitingTerms) {
    addresses = await listAddresses(user.id);
    const requested = (await searchParams).address;
    selectedAddressId = addresses.find((a) => a.id === requested)?.id ?? addresses[0]?.id ?? null;
    quote = await quoteFlexAcceptance({ applicationId: app.id, userId: user.id, addressId: selectedAddressId, locale });
  }

  // Instalments.
  const rows = app.installments.map((i) => ({
    sequence: i.sequence,
    dueDate: i.dueDate.toISOString().slice(0, 10),
    amountBaisa: i.amountBaisa,
    status: i.status,
    paidAt: i.paidAt,
  }));
  const paidBaisa = app.installments.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amountBaisa, 0);
  const next = app.status === 'ACTIVE' ? app.installments.find((i) => i.status === 'PENDING' || i.status === 'OVERDUE') : undefined;
  const balance = next ? await getBalance(user.id) : null;

  return (
    <div className="pb-16">
      <PageHeader title={t('title')} fallbackHref="/flex" />
      <div className="page-container mt-4 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside className="flex min-w-0 flex-col gap-5 self-start">
          <section className="relative rounded-card border border-border bg-surface p-5 shadow-card" data-testid="flex-plan" data-status={app.status}>
            <HudCorners />
            <div className="flex items-start gap-4">
              {image ? <Image src={mediaUrl(image) ?? ''} alt="" width={96} height={96} className="size-20 shrink-0 rounded-xl bg-bg object-contain" /> : null}
              <div className="min-w-0">
                <p className="text-xs text-muted">{t('product')}</p>
                <p className="truncate font-semibold">{name}</p>
                {variantName ? <p className="truncate text-sm text-muted">{variantName}</p> : null}
                <Badge variant={FLEX_STATUS_VARIANT[app.status] ?? 'neutral'} className="mt-2" data-testid="flex-status">
                  {tf(`statuses.${app.status}`)}
                </Badge>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-border p-3">
                <dt className="text-muted">{t('duration')}</dt>
                <dd className="font-display font-bold">{t('monthsValue', { months: app.months })}</dd>
              </div>
              <div className="rounded-xl border border-border p-3">
                <dt className="text-muted">{t('financed')}</dt>
                <dd className="font-display">
                  <Price baisa={app.principalBaisa} />
                </dd>
              </div>
            </dl>
            {app.order ? (
              <Link href={`/orders/${app.order.number}`} className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent hover:underline" data-testid="flex-order-link">
                <Truck size={16} aria-hidden="true" />
                {t('order', { number: app.order.number })}
              </Link>
            ) : null}
          </section>
          {STEP[app.status] !== undefined ? (
            <Stepper
              className="rounded-card border border-border bg-surface p-4 shadow-card"
              steps={[t('steps.application'), t('steps.decision'), t('steps.terms'), t('steps.instalments')]}
              current={app.status === 'COMPLETED' ? 3 : STEP[app.status]!}
            />
          ) : null}
        </aside>

        <section className="min-w-0" aria-live="polite">
          {app.status === 'SUBMITTED' || app.status === 'UNDER_REVIEW' ? (
            <div className="rounded-card border border-border bg-surface p-5 shadow-card sm:p-6" data-testid="flex-under-review">
              <p className="flex items-center gap-2 text-lg font-bold">
                <Clock size={20} aria-hidden="true" className="text-accent" />
                {t('submittedTitle')}
              </p>
              <p className="mt-2 text-sm text-muted">{t('submittedText')}</p>
              <div className="mt-4">
                <CancelFlexButton applicationId={app.id} />
              </div>
            </div>
          ) : null}

          {app.status === 'REJECTED' || app.status === 'CANCELLED' || app.status === 'DEFAULTED' ? (
            <div className="rounded-card border border-border bg-surface p-5 shadow-card sm:p-6" data-testid="flex-closed">
              <p className="flex items-center gap-2 text-lg font-bold">
                <CircleX size={20} aria-hidden="true" className="text-error" />
                {app.status === 'REJECTED' ? t('rejectedTitle') : app.status === 'CANCELLED' ? t('cancelledTitle') : tf('statuses.DEFAULTED')}
              </p>
              {app.status === 'REJECTED' ? <p className="mt-2 text-sm text-muted">{t('rejectedText')}</p> : null}
              <Link href="/flex" className={buttonClasses({ variant: 'outline', className: 'mt-4' })}>
                {tf('apply.backToFlex')}
              </Link>
            </div>
          ) : null}

          {awaitingTerms && quote ? (
            <div className="flex flex-col gap-5" data-testid="flex-accept">
              <div>
                <p className="flex items-center gap-2 text-lg font-bold">
                  <ShieldCheck size={20} aria-hidden="true" className="text-success" />
                  {t('approvedTitle')}
                </p>
                <p className="mt-1 text-sm text-muted">{t('approvedText')}</p>
              </div>

              <fieldset className="min-w-0">
                <legend className="mb-2 flex items-center gap-2 font-semibold">
                  <MapPin size={18} aria-hidden="true" className="text-accent" />
                  {t('address')}
                </legend>
                {addresses.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-4">
                    <p className="text-sm">{t('noAddress')}</p>
                    <Link href="/account/addresses" className={buttonClasses({ variant: 'primary', className: 'mt-3' })}>
                      {t('addAddress')}
                    </Link>
                  </div>
                ) : (
                  <ul className="grid grid-cols-1 gap-2">
                    {addresses.map((a) => {
                      const selected = a.id === selectedAddressId;
                      return (
                        <li key={a.id}>
                          <Link
                            href={`/flex/${app.id}?address=${a.id}`}
                            replace
                            scroll={false}
                            aria-current={selected ? 'true' : undefined}
                            className={cn(
                              'flex min-h-14 items-center gap-3 rounded-2xl border p-3 transition-[border-color,background-color] duration-(--dur-btn)',
                              selected ? 'border-blue bg-blue/10' : 'border-border bg-surface hover:border-blue/50',
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold">{a.label || a.recipientName}</span>
                              <span className="block truncate text-sm text-muted">
                                {[a.area, a.building, localize(a.wilaya.name, locale), localize(a.governorate.name, locale)].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            <span
                              aria-hidden="true"
                              className={cn('grid size-5 shrink-0 place-items-center rounded-full border-2', selected ? 'border-blue' : 'border-border-strong')}
                            >
                              {selected ? <span className="size-2.5 rounded-full bg-blue" /> : null}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>

              {quote.ready && quote.schedule && quote.totalBaisa !== null && selectedAddressId ? (
                <>
                  <dl className="grid grid-cols-1 divide-y divide-border rounded-2xl border border-border bg-surface px-4 text-sm shadow-card">
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-muted">{t('subtotal')}</dt>
                      <dd>
                        <Price baisa={quote.subtotalBaisa} size="sm" />
                      </dd>
                    </div>
                    {quote.discountBaisa > 0 ? (
                      <div className="flex justify-between gap-4 py-2.5">
                        <dt className="text-muted">{t('discount')}</dt>
                        <dd className="tabular-nums [unicode-bidi:isolate]">−<Price baisa={quote.discountBaisa} size="sm" /></dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-muted">{t('delivery')}</dt>
                      <dd>
                        <Price baisa={quote.deliveryFeeBaisa ?? 0} size="sm" />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5 font-semibold">
                      <dt>{t('financed')}</dt>
                      <dd data-testid="flex-financed" data-baisa={quote.totalBaisa}>
                        <Price baisa={quote.totalBaisa} />
                      </dd>
                    </div>
                  </dl>
                  <ScheduleTable rows={quote.schedule.installments} totalBaisa={quote.schedule.totalBaisa} />
                  <section className="rounded-2xl border border-border bg-surface p-4 shadow-card" aria-labelledby="flex-terms">
                    <h2 id="flex-terms" className="font-bold">
                      {t('terms.title')}
                    </h2>
                    <ul className="mt-2 grid gap-1.5 text-sm text-muted">
                      <li>· {t('terms.t1')}</li>
                      <li>· {t('terms.t2', { months: app.months })}</li>
                      <li>· {t('terms.t3')}</li>
                      <li>· {t('terms.t4')}</li>
                    </ul>
                    <p className="mt-2 text-xs text-muted">{t('terms.version', { version: FLEX_TERMS_VERSION })}</p>
                  </section>
                  <AcceptFlexForm applicationId={app.id} addressId={selectedAddressId} expectedTotalBaisa={quote.totalBaisa} termsVersion={FLEX_TERMS_VERSION} />
                </>
              ) : quote.reason && (quote.reason !== 'address_required' || addresses.length > 0) ? (
                <p className="rounded-xl border border-amber/50 bg-amber/10 p-3 text-sm" data-testid="flex-not-ready">
                  {t(`notReady.${quote.reason}`)}
                </p>
              ) : null}
              {app.status === 'APPROVED' ? <CancelFlexButton applicationId={app.id} /> : null}
            </div>
          ) : null}

          {active ? (
            <div className="flex flex-col gap-5" data-testid="flex-active">
              <p className="flex items-center gap-2 text-lg font-bold">
                {app.status === 'COMPLETED' ? <CheckCircle2 size={20} aria-hidden="true" className="text-success" /> : <CalendarCheck size={20} aria-hidden="true" className="text-accent" />}
                {app.status === 'COMPLETED' ? t('completedTitle') : t('activeTitle')}
              </p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
                  <dt className="text-muted">{t('paidTotal')}</dt>
                  <dd className="font-display" data-testid="flex-paid" data-baisa={paidBaisa}>
                    <Price baisa={paidBaisa} />
                  </dd>
                </div>
                <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
                  <dt className="text-muted">{t('remaining')}</dt>
                  <dd className="font-display" data-testid="flex-remaining">
                    <Price baisa={app.principalBaisa - paidBaisa} />
                  </dd>
                </div>
              </dl>
              {next && balance ? (
                <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
                  <p className="text-sm text-muted">
                    {t('due', { date: format.dateTime(new Date(`${next.dueDate.toISOString().slice(0, 10)}T00:00:00+04:00`), 'short') })}
                    {next.status === 'OVERDUE' ? (
                      <Badge variant="error" className="ms-2">
                        {t('instStatus.OVERDUE')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    {t('walletBalanceLabel')}
                    <Price baisa={balance.balanceBaisa} size="sm" />
                  </p>
                  {balance.balanceBaisa >= next.amountBaisa ? (
                    <PayInstallmentButton installmentId={next.id} label={t('pay', { amount: formatBaisa(next.amountBaisa, locale) })} />
                  ) : (
                    <div className="flex flex-col gap-2" data-testid="flex-low-balance">
                      <p className="text-sm font-medium text-fg">{t('lowBalance')}</p>
                      <Link href="/wallet/top-up" className={buttonClasses({ variant: 'accent', size: 'lg', fullWidth: true })}>
                        {t('topUp')}
                      </Link>
                    </div>
                  )}
                </div>
              ) : null}
              <div>
                <h2 className="mb-3 font-bold">{t('instalments')}</h2>
                <ScheduleTable rows={rows} totalBaisa={app.principalBaisa} showStatus />
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

