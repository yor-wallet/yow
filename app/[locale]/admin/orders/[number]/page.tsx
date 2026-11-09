import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { getAdminOrder } from '@/lib/admin/orders';
import { parseAddressSnapshot } from '@/lib/delivery/addresses';
import { formatBaisa } from '@/lib/money';
import { localize } from '@/lib/localized';
import { DataTable, Td, Th, Tr } from '@/components/admin/DataTable';
import { AdminPageHeader, OrderStatusBadge, Section } from '@/components/admin/ui';

type Props = { params: Promise<{ locale: string; number: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, number } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'admin' });
  return { title: t('orders.detail', { number: decodeURIComponent(number) }), robots: { index: false } };
}

export default async function AdminOrderPage({ params }: Props) {
  const { locale: rawLocale, number: rawNumber } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const number = decodeURIComponent(rawNumber);
  await requireAdmin('orders:read', `/admin/orders/${number}`);
  const [t, tOrder, tDelivery, format, order] = await Promise.all([
    getTranslations('admin'),
    getTranslations('orders.detail'),
    getTranslations('checkout.delivery'),
    getFormatter(),
    getAdminOrder(number),
  ]);
  if (!order) notFound();

  const money = (b: number) => formatBaisa(b, locale);
  const when = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' });
  const address = parseAddressSnapshot(order.addressSnapshot);
  const tStatus = await getTranslations('orders.status');

  return (
    <>
      <AdminPageHeader
        title={t('orders.detail', { number: order.number })}
        subtitle={t('orders.placedOn', { date: when(order.placedAt) })}
        backHref="/admin/orders"
        actions={<OrderStatusBadge status={order.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section id="items" title={t('orders.items')}>
            <DataTable
              caption={t('orders.items')}
              testId="order-items"
              head={
                <>
                  <Th>{t('orders.columns.product')}</Th>
                  <Th>{t('orders.columns.qty')}</Th>
                  <Th>{t('orders.columns.unit')}</Th>
                  <Th className="text-end">{t('orders.columns.lineTotal')}</Th>
                </>
              }
            >
              {order.items.map((i) => (
                <Tr key={i.id} testId="order-item">
                  <Td primary>
                    <p className="font-semibold">{localize(i.nameSnapshot, locale, i.sku)}</p>
                    <p className="text-xs text-muted [unicode-bidi:isolate]" dir="ltr">
                      {i.sku}
                      {i.variantLabel ? ` · ${i.variantLabel}` : ''}
                    </p>
                  </Td>
                  <Td label={t('orders.columns.qty')} className="tabular-nums">
                    {i.qty}
                  </Td>
                  <Td label={t('orders.columns.unit')} className="tabular-nums [unicode-bidi:isolate]">
                    {money(i.unitPriceBaisa)}
                  </Td>
                  <Td label={t('orders.columns.lineTotal')} className="font-semibold tabular-nums [unicode-bidi:isolate] md:text-end">
                    {money(i.lineTotalBaisa)}
                  </Td>
                </Tr>
              ))}
            </DataTable>
          </Section>

          <Section id="history" title={t('orders.history')}>
            <ol className="flex flex-col gap-3" data-testid="order-history">
              {order.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-s-2 border-border ps-3">
                  <p className="font-medium">
                    {e.fromStatus ? `${tStatus(e.fromStatus)} → ` : ''}
                    {tStatus(e.toStatus)}
                  </p>
                  <p className="text-xs text-muted">{when(e.createdAt)}</p>
                  {e.note ? <p className="basis-full text-sm text-muted">{e.note}</p> : null}
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section id="summary" title={tOrder('summary')}>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label={tOrder('subtotal')} value={money(order.subtotalBaisa)} />
              <Row label={`${tOrder('delivery')} (${tDelivery(order.deliveryType)})`} value={order.deliveryFeeBaisa === 0 ? tOrder('free') : money(order.deliveryFeeBaisa)} />
              {order.discountBaisa > 0 ? <Row label={tOrder('discount')} value={`− ${money(order.discountBaisa)}`} /> : null}
              <div className="mt-1 border-t border-border pt-2">
                <Row label={tOrder('total')} value={money(order.totalBaisa)} strong testId="admin-order-total" />
              </div>
            </dl>
          </Section>

          <Section id="customer" title={t('orders.customer')}>
            <p className="font-semibold">{order.user.fullName}</p>
            <p className="text-sm text-muted [unicode-bidi:isolate]" dir="ltr">
              {order.user.email}
            </p>
            {order.contactPhone || order.user.phone ? (
              <p className="text-sm text-muted [unicode-bidi:isolate]" dir="ltr">
                {order.contactPhone ?? order.user.phone}
              </p>
            ) : null}
          </Section>

          <Section id="address" title={t('orders.address')}>
            {address ? (
              <>
                <p className="font-medium">{address.recipientName}</p>
                <p className="text-sm text-muted">
                  {[address.building, address.street, address.area, localize(address.wilayaName, locale), localize(address.governorateName, locale)].filter(Boolean).join(', ')}
                </p>
                {address.phone ? (
                  <p className="mt-1 text-sm text-muted [unicode-bidi:isolate]" dir="ltr">
                    {address.phone}
                  </p>
                ) : null}
                {address.instructions ? <p className="mt-1 text-sm text-muted">{address.instructions}</p> : null}
              </>
            ) : null}
          </Section>

          <Section id="payments" title={t('orders.payment')}>
            {order.paymentIntents.length === 0 ? (
              <p className="text-sm text-muted">{t('orders.noPayment')}</p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="order-payments">
                {order.paymentIntents.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="font-medium">{tOrder(`methods.${p.provider}`)}</span>
                    <span className="tabular-nums [unicode-bidi:isolate]">{money(p.amountBaisa)}</span>
                    <span className="basis-full text-xs text-muted">
                      {tOrder(`paymentStatus.${p.status}`)} · {when(p.succeededAt ?? p.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {order.refunds.length > 0 ? (
              <div className="mt-4 border-t border-border pt-3">
                <h3 className="mb-2 text-sm font-bold">{tOrder('refunds')}</h3>
                <ul className="flex flex-col gap-2 text-sm">
                  {order.refunds.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span>{tOrder(`refundStatus.${r.status}`)}</span>
                      <span className="tabular-nums [unicode-bidi:isolate]">{money(r.amountBaisa)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-bold' : 'text-muted'}>{label}</dt>
      <dd className={strong ? 'text-lg font-extrabold tabular-nums [unicode-bidi:isolate]' : 'tabular-nums [unicode-bidi:isolate]'} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
