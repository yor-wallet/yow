import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CircleCheck, Info, MapPin } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { osmLink } from '@/lib/delivery/addresses';
import { getCustomerOrder, TIMELINE_STEPS } from '@/lib/delivery/tracking';
import { localize } from '@/lib/localized';
import { ORDER_NUMBER_RE } from '@/lib/orders/number';
import { getPaymentPort } from '@/lib/orders/payments';
import { mediaUrl } from '@/lib/storage';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Price } from '@/components/ui/Price';
import { HandoverCode } from '@/components/delivery/HandoverCode';
import { ShipmentTimeline } from '@/components/delivery/ShipmentTimeline';
import { OrderStatusBadge } from '@/components/delivery/StatusBadges';
import { CancelOrderButton } from '@/components/shop/CancelOrderButton';
import { PayOrderPanel } from '@/components/shop/PayOrderPanel';
import { ShopImage } from '@/components/shop/ShopImage';

type Props = { params: Promise<{ locale: string; number: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, number } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'orders.detail' });
  return { title: t('metaTitle', { number }), robots: { index: false } };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PAY_ERRORS = new Set(['invalid_input', 'invalid_amount', 'amount_below_minimum', 'amount_above_maximum', 'method_unavailable', 'idempotency_key_reused', 'idempotency_conflict', 'insufficient_balance', 'wallet_frozen', 'not_found', 'forbidden', 'order_not_payable', 'order_already_paid', 'provider_unavailable', 'provider_error']);

export default async function OrderPage({ params, searchParams }: Props) {
  const { locale: rawLocale, number } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  if (!ORDER_NUMBER_RE.test(number)) notFound();
  const session = await requireUser({ next: `/orders/${number}` });
  const data = await getCustomerOrder(session.user.id, number);
  if (!data) notFound();
  const { order, address, handover, otpLocked } = data;
  const sp = await searchParams;
  const [t, tp, td, format] = await Promise.all([getTranslations('orders.detail'), getTranslations('payments'), getTranslations('delivery'), getFormatter()]);

  // ── payment state ────────────────────────────────────────────
  const awaiting = order.status === 'PENDING_PAYMENT';
  const reservation = awaiting
    ? await prisma.stockReservation.findFirst({ where: { orderId: order.id, status: 'ACTIVE', expiresAt: { gt: new Date() } }, orderBy: { expiresAt: 'desc' }, select: { expiresAt: true } })
    : null;
  const methods = awaiting && reservation ? (await getPaymentPort().listPaymentMethods({ userId: session.user.id, amountBaisa: order.totalBaisa })).map((m) => ({ id: m.id, available: m.available, reason: m.reason ?? null })) : [];

  const paid = one(sp.paid) === '1';
  const payNote = one(sp.pay);

  // ── shipment timeline ────────────────────────────────────────
  const shipment = order.shipment;
  let current = -1;
  let failed = false;
  if (shipment) {
    failed = shipment.status === 'FAILED';
    const reached = shipment.events.filter((e) => e.status !== 'FAILED').map((e) => TIMELINE_STEPS.indexOf(e.status));
    current = failed ? Math.max(-1, ...reached) : TIMELINE_STEPS.indexOf(shipment.status);
  }
  const steps = TIMELINE_STEPS.map((status) => {
    const ev = shipment?.events.find((e) => e.status === status);
    return { status, label: td(`status.${status}`), hint: td(`statusHint.${status}`), at: ev ? format.dateTime(ev.createdAt, 'long') : null };
  });

  const methodLabel = (m: string) => (m in { WALLET: 1, CARD: 1, OOREDOO: 1, OMANTEL: 1, CRYPTO: 1, GIFT_CARD: 1, FLEX: 1 } ? t(`methods.${m as 'WALLET'}`) : m);
  const intents = order.paymentIntents;

  return (
    <div className="pb-14">
      <PageHeader title={t('title', { number })} fallbackHref="/orders" />
      <div className="page-container flex flex-col gap-6 pt-4 lg:pt-6">
        {paid ? (
          <p role="status" className="flex items-center gap-2 rounded-card border border-success/50 bg-success/10 p-4 font-semibold text-success" data-testid="paid-banner">
            <CircleCheck size={20} aria-hidden="true" />
            {tp('pay.succeeded')}
          </p>
        ) : null}
        {payNote === 'pending' && awaiting ? (
          <p role="status" className="flex items-center gap-2 rounded-card border border-border-strong bg-surface p-4 font-medium" data-testid="pay-pending-banner">
            <Info size={20} aria-hidden="true" className="text-accent" />
            {tp('pay.pending')}
          </p>
        ) : null}
        {payNote && payNote !== 'pending' && awaiting ? (
          <p role="alert" className="rounded-card border border-error/40 bg-error/10 p-4 font-medium text-error" data-testid="pay-failed-banner">
            {PAY_ERRORS.has(payNote) ? tp(`errors.${payNote as 'not_found'}`) : tp('errors.generic')}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{t('placedOn', { date: format.dateTime(order.placedAt, 'long') })}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums [unicode-bidi:isolate]" data-testid="order-number">
              {order.number}
            </p>
          </div>
          <OrderStatusBadge status={order.status} className="text-sm" />
        </div>

        {awaiting ? (
          <>
            <p className="text-sm text-muted">{t('awaitingPayment')}</p>
            {reservation ? (
              <>
                <PayOrderPanel number={order.number} totalBaisa={order.totalBaisa} methods={methods} expiresAt={reservation.expiresAt.toISOString()} />
                <div>
                  <CancelOrderButton number={order.number} />
                </div>
              </>
            ) : (
              <p role="status" className="rounded-card border border-border-strong bg-surface p-4 text-sm" data-testid="reservation-expired">
                {tp('pay.expired')}
              </p>
            )}
          </>
        ) : null}

        {order.status === 'CANCELLED' ? (
          <p role="status" className="rounded-card border border-border-strong bg-surface p-4 text-sm font-medium" data-testid="cancelled-notice">
            {t('cancelledNotice')}
          </p>
        ) : null}

        {shipment ? (
          <section aria-labelledby="tracking-title" className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]" data-testid="tracking">
            <Card>
              <h2 id="tracking-title" className="mb-4 text-lg font-bold">
                {t('tracking')}
              </h2>
              <ShipmentTimeline steps={steps} current={current} failed={failed} label={t('timelineLabel')} doneLabel={t('stepDone')} currentLabel={t('stepCurrent')} />
              {failed ? <p className="mt-4 text-sm font-medium text-error">{t('failedNotice')}</p> : null}
            </Card>
            <div className="flex flex-col gap-4">
              {handover ? (
                <HandoverCode
                  code={handover.code}
                  title={t('handover.title')}
                  text={t('handover.text')}
                  meta={`${t('handover.expires', { time: format.dateTime(handover.expiresAt, 'long') })} · ${t('handover.attempts', { count: handover.attemptsLeft })}`}
                  copyLabel={t('handover.copy')}
                  copiedLabel={t('handover.copied')}
                />
              ) : otpLocked ? (
                <p role="status" className="rounded-card border border-error/40 bg-error/10 p-4 text-sm font-medium text-error">
                  {t('handover.locked')}
                </p>
              ) : null}
              <Card>
                <dl className="flex flex-col gap-2 text-sm">
                  <Row label={t('trackingCode')} value={shipment.trackingCode} mono />
                  <Row label={t('type')} value={td(`type.${shipment.deliveryType}`)} />
                  {shipment.deliveredAt ? (
                    <Row label={t('deliveredOn', { date: '' }).replace(/\s*$/, '')} value={format.dateTime(shipment.deliveredAt, 'long')} />
                  ) : (
                    <Row label={t('eta')} value={shipment.promisedBy ? t('etaBy', { date: format.dateTime(shipment.promisedBy, 'long') }) : t('etaUnknown')} />
                  )}
                  {shipment.proofName ? <Row label={t('receivedBy', { name: shipment.proofName })} value="" /> : null}
                  {shipment.courier ? <Row label={t('courier')} value={shipment.courier.name} /> : null}
                </dl>
              </Card>
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <section aria-labelledby="items-title" className="flex flex-col gap-3">
            <h2 id="items-title" className="text-lg font-bold">
              {t('items')}
            </h2>
            <ul className="flex flex-col gap-3" data-testid="order-items">
              {order.items.map((it) => {
                const src = mediaUrl(it.imageKey);
                return (
                  <li key={it.id} className="flex gap-3 rounded-card border border-border bg-surface p-3 shadow-card sm:gap-4 sm:p-4">
                    <span className="block size-20 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                      {src ? <ShopImage src={src} width={240} height={240} alt="" sizes="80px" className="size-full object-contain p-1" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="line-clamp-2 font-semibold">{localize(it.nameSnapshot, locale, it.sku)}</span>
                      {it.variantLabel ? <span className="text-xs text-muted">{it.variantLabel}</span> : null}
                      <span className="text-xs text-muted">
                        {t('qty', { qty: it.qty })} · <span className="[unicode-bidi:isolate]">{t('unitPrice', { price: format.number(it.unitPriceBaisa / 1000, { minimumFractionDigits: 3, maximumFractionDigits: 3, numberingSystem: 'latn' }) })}</span>
                      </span>
                      {it.warrantyMonths ? <span className="text-xs text-muted">{t('warranty', { months: it.warrantyMonths })}</span> : null}
                      <span className="mt-auto self-end">
                        <Price baisa={it.lineTotalBaisa} size="md" />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className="flex flex-col gap-4">
            <Card>
              <h2 className="mb-3 text-lg font-bold">{t('summary')}</h2>
              <dl className="flex flex-col gap-2 text-sm">
                <Row label={t('subtotal')} price={order.subtotalBaisa} />
                {order.discountBaisa > 0 ? <Row label={t('discount')} price={-order.discountBaisa} tone="success" /> : null}
                <Row label={t('delivery')} value={order.deliveryFeeBaisa === 0 ? t('free') : undefined} price={order.deliveryFeeBaisa === 0 ? undefined : order.deliveryFeeBaisa} />
                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                  <dt className="text-base font-bold">{t('total')}</dt>
                  <dd className="text-xl font-extrabold">
                    <Price baisa={order.totalBaisa} size="lg" />
                  </dd>
                </div>
              </dl>
            </Card>
            {address ? (
              <Card>
                <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
                  <MapPin size={18} aria-hidden="true" className="text-accent" />
                  {t('address')}
                </h2>
                <p className="font-medium">{address.recipientName}</p>
                <p className="text-sm text-muted">
                  {[address.building, address.street, address.area, localize(address.wilayaName, locale), localize(address.governorateName, locale)].filter(Boolean).join(', ')}
                </p>
                {address.phone ? <p className="mt-1 text-sm text-muted [unicode-bidi:isolate]">{t('phone')}: {address.phone}</p> : null}
                {address.instructions ? <p className="mt-1 text-sm text-muted">{t('instructions')}: {address.instructions}</p> : null}
                {typeof address.lat === 'number' && typeof address.lng === 'number' ? (
                  <a href={osmLink(address.lat, address.lng)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline">
                    {t('viewMap')}
                  </a>
                ) : null}
              </Card>
            ) : null}
            <Card>
              <h2 className="mb-2 text-lg font-bold">{t('payment')}</h2>
              {intents.length === 0 ? (
                <p className="text-sm text-muted">{t('paymentNone')}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm" data-testid="payment-intents">
                  {intents.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3">
                      <span>
                        {methodLabel(p.provider)} · <span className="text-muted">{t(`paymentStatus.${p.status}`)}</span>
                      </span>
                      <Price baisa={p.amountBaisa} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
              {order.paidAt ? <p className="mt-2 text-xs text-muted">{t('paidOn', { date: format.dateTime(order.paidAt, 'long') })}</p> : null}
            </Card>
            {order.refunds.length > 0 ? (
              <Card>
                <h2 className="mb-2 text-lg font-bold">{t('refunds')}</h2>
                <ul className="flex flex-col gap-2 text-sm">
                  {order.refunds.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3">
                      <span className="text-muted">{t(`refundStatus.${r.status}`)}</span>
                      <Price baisa={r.amountBaisa} size="sm" />
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Link href={{ pathname: '/account/support', query: { order: order.number } }} className={buttonClasses({ variant: 'outline' })}>
              {t('support')}
            </Link>
          </aside>
        </div>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className="mb-3 text-lg font-bold">
            {t('history')}
          </h2>
          <ol className="flex flex-col gap-2 text-sm" data-testid="order-history">
            {[...order.events].reverse().map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <OrderStatusBadge status={e.toStatus} />
                <span className="text-muted">{format.dateTime(e.createdAt, 'long')}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, price, tone, mono }: { label: string; value?: string; price?: number; tone?: 'success'; mono?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${tone === 'success' ? 'text-success' : ''}`}>
      <dt className="text-muted">{label}</dt>
      <dd className={`font-semibold ${mono ? 'font-mono [unicode-bidi:isolate]' : ''}`}>{price !== undefined ? <Price baisa={price} size="md" /> : value}</dd>
    </div>
  );
}
