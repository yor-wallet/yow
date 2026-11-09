import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link, redirect } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { builtNavForRole } from '@/lib/admin/nav';
import { adminOverview } from '@/lib/admin/overview';
import { formatBaisa } from '@/lib/money';
import { localize } from '@/lib/localized';
import { buttonClasses } from '@/components/ui/Button';
import { AdminPageHeader, OrderStatusBadge, Section, StatCard } from '@/components/admin/ui';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('overview.title'), robots: { index: false } };
}

export default async function AdminOverviewPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireAdmin('admin:access', '/admin');
  const t = await getTranslations('admin');
  const format = await getFormatter();

  if (!ctx.can('dashboard:read')) {
    // Staff without the dashboard land on the first section they can open (or an honest "coming soon").
    const first = builtNavForRole(ctx.session.user.role)[0]?.items.find((i) => i.href !== '/admin');
    if (first) redirect({ href: first.href, locale });
    return (
      <>
        <AdminPageHeader title={t('overview.title')} />
        <p className="text-muted" data-testid="coming-soon">
          {t('shell.unavailableSoon')}
        </p>
      </>
    );
  }

  const data = await adminOverview();
  const canOrders = ctx.can('orders:read');
  const canCatalog = ctx.can('catalog:read');
  const when = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' });

  return (
    <>
      <AdminPageHeader title={t('overview.title')} subtitle={t('overview.subtitle')} />

      {canCatalog && ctx.can('catalog:write') && data.products.total === 0 ? (
        <Section id="start" title={t('overview.start')} description={t('overview.startText')} className="mb-6">
          <Link href="/admin/products/new" className={buttonClasses({ variant: 'primary' })} data-testid="start-add-product">
            {t('overview.startCta')}
          </Link>
        </Section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="stats">
        {canOrders ? (
          <>
            <StatCard testId="stat-revenue" label={t('overview.cards.revenue')} value={formatBaisa(data.revenueBaisa, locale)} hint={data.paidOrders === 0 ? t('overview.noData') : undefined} />
            <StatCard testId="stat-paid-orders" label={t('overview.cards.paidOrders')} value={format.number(data.paidOrders)} />
            <StatCard testId="stat-orders-today" label={t('overview.cards.ordersToday')} value={format.number(data.ordersToday)} />
            <StatCard testId="stat-unpaid" label={t('overview.cards.unpaid')} value={format.number(data.unpaidOrders)} href="/admin/orders?status=PENDING_PAYMENT" />
          </>
        ) : null}
        {canCatalog ? (
          <>
            <StatCard testId="stat-active-products" label={t('overview.cards.activeProducts')} value={format.number(data.products.active)} href="/admin/products?status=ACTIVE" />
            <StatCard testId="stat-draft-products" label={t('overview.cards.draftProducts')} value={format.number(data.products.draft)} href="/admin/products?status=DRAFT" />
            <StatCard testId="stat-low-stock" label={t('overview.cards.lowStock')} value={format.number(data.stock.low)} />
            <StatCard testId="stat-out-of-stock" label={t('overview.cards.outOfStock')} value={format.number(data.stock.out)} />
          </>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {canCatalog ? (
          <Section id="low-stock" title={t('overview.lowStockTitle')}>
            {data.stock.rows.length === 0 ? (
              <p className="text-sm text-muted" data-testid="low-stock-empty">
                {t('overview.lowStockEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-border" data-testid="low-stock-list">
                {data.stock.rows.map((r) => (
                  <li key={r.variantId} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/admin/products/${r.productId}`} className="block truncate font-semibold hover:underline">
                        {localize(r.productName, locale, r.sku)}
                      </Link>
                      <p className="text-xs text-muted [unicode-bidi:isolate]" dir="ltr">
                        {r.sku}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{t('overview.left', { count: r.available })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        {canOrders ? (
          <Section
            id="recent-orders"
            title={t('overview.recentOrders')}
            actions={
              <Link href="/admin/orders" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
                {t('overview.viewAll')}
              </Link>
            }
          >
            {data.recentOrders.length === 0 ? (
              <p className="text-sm text-muted" data-testid="recent-orders-empty">
                {t('overview.recentOrdersEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-border" data-testid="recent-orders">
                {data.recentOrders.map((o) => (
                  <li key={o.number} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0">
                      <Link href={`/admin/orders/${o.number}`} className="font-semibold hover:underline [unicode-bidi:isolate]" dir="ltr">
                        {o.number}
                      </Link>
                      <p className="truncate text-xs text-muted">
                        {o.customer} · {when(o.placedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <OrderStatusBadge status={o.status as Parameters<typeof OrderStatusBadge>[0]['status']} />
                      <span className="text-sm font-semibold tabular-nums [unicode-bidi:isolate]">{formatBaisa(o.totalBaisa, locale)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}
      </div>
    </>
  );
}
