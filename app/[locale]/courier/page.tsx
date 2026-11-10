import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChevronRight, Navigation, Phone, Bike, Zap } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { localize } from '@/lib/localized';
import { getCourierContext, listCourierShipments } from '@/lib/delivery/courier';
import { navigationLink } from '@/lib/delivery/addresses';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { HudCorners } from '@/components/ui/HudCorners';
import { buttonClasses } from '@/components/ui/Button';
import { ShipmentStatusBadge } from '@/components/delivery/StatusBadges';
import { cn } from '@/lib/cn';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ view?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'delivery.courier' });
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Courier workspace (mobile-first): assigned deliveries; logistics staff see every active delivery. */
export default async function CourierPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const view = (await searchParams).view === 'done' ? 'done' : 'active';
  const { user } = await requireUser({ next: '/courier' });
  const ctx = await getCourierContext(user);
  if (!ctx) notFound();
  const [t, td, format, shipments] = await Promise.all([
    getTranslations('delivery.courier'),
    getTranslations('delivery'),
    getFormatter(),
    listCourierShipments(ctx, view),
  ]);

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={ctx.isStaff && !ctx.courier ? t('staffSubtitle') : t('subtitle')} fallbackHref="/account" />
      <div className="page-container mt-5 max-w-3xl lg:mt-6">
        <nav data-scroll-x className="scrollbar-none mb-4 flex gap-2 overflow-x-auto py-1" aria-label={t('title')}>
          {(['active', 'done'] as const).map((v) => (
            <Link
              key={v}
              href={v === 'done' ? '/courier?view=done' : '/courier'}
              aria-current={view === v ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center rounded-pill border px-4 text-sm font-semibold transition-colors duration-(--dur-btn)',
                view === v ? 'border-transparent bg-gradient-primary text-on-accent shadow-glow-blue' : 'border-border bg-surface text-muted hover:text-fg',
              )}
            >
              {t(`tabs.${v}`)}
            </Link>
          ))}
        </nav>

        {shipments.length === 0 ? (
          <EmptyState
            icon={<Bike size={26} />}
            title={view === 'done' ? t('emptyDoneTitle') : t('emptyTitle')}
            description={view === 'done' ? t('emptyDoneText') : t('emptyText')}
          />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="courier-list">
            {shipments.map((s) => {
              const a = s.address;
              return (
                <li key={s.id} className="relative rounded-card border border-border bg-surface/85 p-4 shadow-card backdrop-blur" data-testid="courier-shipment">
                  {s.deliveryType === 'EXPRESS' ? <HudCorners size={10} className="text-orange/70" /> : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold" dir="ltr">
                        {s.order.number}
                      </span>
                      {s.deliveryType === 'EXPRESS' ? (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-gradient-secondary px-2 text-[11px] font-bold leading-5 text-on-accent">
                          <Zap size={12} aria-hidden="true" />
                          {td('type.EXPRESS')}
                        </span>
                      ) : null}
                    </span>
                    <ShipmentStatusBadge status={s.status} />
                  </div>
                  {a ? (
                    <p className="mt-2 text-sm">
                      <span className="font-semibold">{a.recipientName}</span>
                      <span className="block text-muted">
                        {[a.building, a.area, a.wilayaName ? localize(a.wilayaName, locale) : null, a.governorateName ? localize(a.governorateName, locale) : null]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">
                    {t('items', { count: s.order._count.items })}
                    {s.promisedBy ? ` · ${t('promised', { time: format.dateTime(s.promisedBy, 'long') })}` : ''}
                    {ctx.isStaff && s.courier ? ` · ${t('assignedTo', { name: s.courier.name })}` : ''}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/courier/${s.id}`} className={buttonClasses({ variant: 'primary', size: 'sm' })} data-testid="courier-open">
                      {t('open')}
                      <ChevronRight size={16} aria-hidden="true" className="flip-rtl" />
                    </Link>
                    {a?.lat != null && a?.lng != null && view === 'active' ? (
                      <a href={navigationLink(a.lat, a.lng)} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                        <Navigation size={16} aria-hidden="true" />
                        {t('navigate')}
                      </a>
                    ) : null}
                    {a?.phone && view === 'active' ? (
                      <a href={`tel:${a.phone}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                        <Phone size={16} aria-hidden="true" />
                        {t('call')}
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
