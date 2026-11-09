import type { Metadata } from 'next';
import { PackageSearch, Search } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth';
import { listCustomerOrders, ORDER_FILTERS, parseOrderFilter } from '@/lib/delivery/tracking';
import { localize } from '@/lib/localized';
import { mediaUrl } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Price } from '@/components/ui/Price';
import { OrderStatusBadge } from '@/components/delivery/StatusBadges';
import { ShopImage } from '@/components/shop/ShopImage';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'orders' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OrdersPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const session = await requireUser({ next: '/orders' });
  const sp = await searchParams;
  const [t, format] = await Promise.all([getTranslations('orders'), getFormatter()]);
  const filter = parseOrderFilter(one(sp.filter));
  const q = (one(sp.q) ?? '').trim().slice(0, 30);
  const cursor = one(sp.cursor);
  const { items, nextCursor } = await listCustomerOrders(session.user.id, { filter, q, cursor, take: 12 });

  const href = (over: { filter?: string; q?: string; cursor?: string | null }) => {
    const query: Record<string, string> = {};
    const f = over.filter ?? filter;
    const qq = over.q ?? q;
    if (f !== 'all') query.filter = f;
    if (qq) query.q = qq;
    if (over.cursor) query.cursor = over.cursor;
    return { pathname: '/orders', query };
  };

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/account" />
      <div className="page-container pt-4 lg:pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <nav aria-label={t('filters.label')}>
            <ul className="flex flex-wrap gap-2" data-testid="order-filters">
              {ORDER_FILTERS.map((f) => (
                <li key={f}>
                  <Link
                    href={href({ filter: f, cursor: null })}
                    aria-current={f === filter ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-pill border px-4 text-sm font-medium transition-colors',
                      f === filter ? 'border-transparent bg-gradient-primary text-on-accent' : 'border-border-strong hover:bg-surface-2',
                    )}
                  >
                    {t(`filters.${f}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <form role="search" action={`/${locale}/orders`} method="get" className="flex items-end gap-2">
            {filter !== 'all' ? <input type="hidden" name="filter" value={filter} /> : null}
            <label className="flex flex-col gap-1 text-sm font-medium">
              <span className="sr-only">{t('search.label')}</span>
              <input
                name="q"
                defaultValue={q}
                placeholder={t('search.placeholder')}
                autoCapitalize="characters"
                autoComplete="off"
                className="min-h-11 w-40 rounded-xl border border-border bg-surface px-3.5 text-base focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/35"
              />
            </label>
            <button type="submit" aria-label={t('search.submit')} className="grid size-11 place-items-center rounded-xl border border-border-strong hover:bg-surface-2">
              <Search size={18} aria-hidden="true" />
            </button>
          </form>
        </div>

        {items.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={<PackageSearch size={26} />}
            title={filter === 'all' && !q ? t('emptyTitle') : t('emptyFilteredTitle')}
            description={filter === 'all' && !q ? t('emptyText') : t('emptyFilteredText')}
            action={
              filter === 'all' && !q ? (
                <Link href="/categories" className={buttonClasses({ variant: 'primary' })}>
                  {t('shop')}
                </Link>
              ) : (
                <Link href="/orders" className={buttonClasses({ variant: 'secondary' })}>
                  {t('search.clear')}
                </Link>
              )
            }
          />
        ) : (
          <ul className="mt-6 flex flex-col gap-3" data-testid="order-list">
            {items.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/orders/${o.number}`}
                  aria-label={t('card.view', { number: o.number })}
                  data-testid="order-card"
                  className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-card transition-[transform,border-color,box-shadow] duration-(--dur-card) ease-premium hover:-translate-y-0.5 hover:border-border-strong hover:shadow-glow-blue sm:p-5"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold tabular-nums [unicode-bidi:isolate]">{o.number}</span>
                    <OrderStatusBadge status={o.status} />
                  </span>
                  <span className="flex items-center gap-2">
                    {o.items.map((it) => {
                      const src = mediaUrl(it.imageKey);
                      return (
                        <span key={it.id} className="block size-12 shrink-0 overflow-hidden rounded-lg bg-surface-2" title={localize(it.nameSnapshot, locale)}>
                          {src ? <ShopImage src={src} width={160} height={160} alt="" sizes="48px" className="size-full object-contain p-0.5" /> : null}
                        </span>
                      );
                    })}
                    {o._count.items > o.items.length ? <span className="text-sm text-muted">{t('card.more', { count: o._count.items - o.items.length })}</span> : null}
                  </span>
                  <span className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 text-sm text-muted">
                    <span>
                      {t('card.placed', { date: format.dateTime(o.placedAt, 'short') })} · {t('card.items', { count: o._count.items })}
                      {o.shipment?.deliveredAt ? <span className="block">{t('card.deliveredOn', { date: format.dateTime(o.shipment.deliveredAt, 'short') })}</span> : o.shipment?.promisedBy && o.status !== 'DELIVERED' ? <span className="block">{t('card.eta', { date: format.dateTime(o.shipment.promisedBy, 'short') })}</span> : null}
                    </span>
                    <span className="text-end">
                      <span className="block text-xs">{t('card.total')}</span>
                      <Price baisa={o.totalBaisa} size="lg" />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {nextCursor ? (
          <div className="mt-6 flex justify-center">
            <Link href={href({ cursor: nextCursor })} className={buttonClasses({ variant: 'secondary' })} data-testid="orders-older">
              {t('loadMore')}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
