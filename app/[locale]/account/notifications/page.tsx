import type { Metadata } from 'next';
import { BellOff } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { localize } from '@/lib/localized';
import { listNotifications, unreadCount, type NotificationFilter } from '@/lib/notifications';
import { handoverCodeFor } from '@/lib/delivery/tracking';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { NotificationList, type NotificationView } from '@/components/account/NotificationList';
import { cn } from '@/lib/cn';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ filter?: string; cursor?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.notifications' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const ORDER_LINK = /^\/orders\/([A-Z0-9-]{3,40})$/;

export default async function NotificationsPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const sp = await searchParams;
  const filter: NotificationFilter = sp.filter === 'unread' ? 'unread' : 'all';
  const cursor = typeof sp.cursor === 'string' ? sp.cursor.slice(0, 64) : undefined;
  const { user } = await requireUser({ next: `/account/notifications${filter === 'unread' ? '?filter=unread' : ''}` });
  const [t, format, { items, nextCursor }, unread] = await Promise.all([
    getTranslations('account.notifications'),
    getFormatter(),
    listNotifications(user.id, { filter, cursor, take: 30 }),
    unreadCount(user.id),
  ]);

  // Live handover codes for "out for delivery" notifications (never stored in the notification itself).
  const otpNumbers = [
    ...new Set(
      items
        .filter((n) => n.type === 'delivery.otp' && n.link)
        .map((n) => ORDER_LINK.exec(n.link!)?.[1])
        .filter((x): x is string => !!x),
    ),
  ];
  const codes = new Map<string, string>();
  if (otpNumbers.length) {
    const orders = await prisma.order.findMany({
      where: { userId: user.id, number: { in: otpNumbers } },
      select: { number: true, shipment: { select: { id: true, status: true, otpHash: true, otpExpiresAt: true, otpAttempts: true } } },
    });
    for (const o of orders) {
      const h = o.shipment ? handoverCodeFor(o.shipment) : null;
      if (h) codes.set(o.number, h.code);
    }
  }
  const now = new Date();
  const views: NotificationView[] = items.map((n) => {
    const number = n.type === 'delivery.otp' && n.link ? ORDER_LINK.exec(n.link)?.[1] : undefined;
    return {
      id: n.id,
      type: n.type,
      title: localize(n.title, locale),
      body: n.body ? localize(n.body, locale) || null : null,
      link: n.link,
      time: now.getTime() - n.createdAt.getTime() < 7 * 24 * 3600 * 1000 ? format.relativeTime(n.createdAt, now) : format.dateTime(n.createdAt, 'long'),
      isoTime: n.createdAt.toISOString(),
      unread: !n.readAt,
      handoverCode: number ? (codes.get(number) ?? null) : null,
    };
  });

  const tab = (f: NotificationFilter, label: string, count?: number) => (
    <Link
      href={f === 'unread' ? '/account/notifications?filter=unread' : '/account/notifications'}
      aria-current={filter === f ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-pill border px-4 text-sm font-semibold transition-colors duration-(--dur-btn)',
        filter === f ? 'border-transparent bg-gradient-primary text-on-accent shadow-glow-blue' : 'border-border bg-surface text-muted hover:text-fg',
      )}
    >
      {label}
      {count ? <span className="font-display tabular-nums">{count}</span> : null}
    </Link>
  );

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/account" />
      <div className="page-container mt-5 max-w-3xl lg:mt-6">
        <nav aria-label={t('filterLabel')} data-scroll-x className="scrollbar-none mb-4 flex gap-2 overflow-x-auto py-1">
          {tab('all', t('all'))}
          {tab('unread', t('unread'), unread)}
        </nav>
        {views.length === 0 ? (
          <EmptyState
            icon={<BellOff size={26} />}
            title={filter === 'unread' ? t('emptyUnreadTitle') : t('emptyTitle')}
            description={filter === 'unread' ? t('emptyUnreadText') : t('emptyText')}
          />
        ) : (
          <NotificationList items={views} unreadTotal={unread} />
        )}
        {nextCursor ? (
          <div className="mt-6 flex justify-center">
            <Link
              href={`/account/notifications?${new URLSearchParams({ ...(filter === 'unread' ? { filter } : {}), cursor: nextCursor }).toString()}`}
              className={buttonClasses({ variant: 'outline' })}
            >
              {t('loadMore')}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
