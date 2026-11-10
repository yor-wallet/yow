import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ExternalLink, MapPin, Navigation, Package, Phone, ShieldAlert, Siren, History, CircleCheck } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { localize } from '@/lib/localized';
import { getCourierContext, getCourierShipment } from '@/lib/delivery/courier';
import { navigationLink, osmLink } from '@/lib/delivery/addresses';
import { OTP_MAX_ATTEMPTS } from '@/lib/delivery/otp';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { HudCorners } from '@/components/ui/HudCorners';
import { Badge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { ShipmentStatusBadge } from '@/components/delivery/StatusBadges';
import { FailDeliveryButton, HandoverForm, IncidentForm, StartDeliveryButton } from '@/components/delivery/CourierPanels';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'delivery.courier' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function CourierShipmentPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: `/courier/${id}` });
  const ctx = await getCourierContext(user);
  if (!ctx) notFound();
  const s = await getCourierShipment(ctx, id.slice(0, 64));
  if (!s) notFound();
  const [t, td, format] = await Promise.all([getTranslations('delivery.courier'), getTranslations('delivery'), getFormatter()]);
  const a = s.address;
  const active = s.status === 'COURIER_ASSIGNED' || s.status === 'OUT_FOR_DELIVERY';
  const locked = s.status === 'OUT_FOR_DELIVERY' && s.otpAttempts >= OTP_MAX_ATTEMPTS;

  return (
    <div className="pb-14">
      <PageHeader title={t('order', { number: s.order.number })} subtitle={s.trackingCode} fallbackHref="/courier" actions={<ShipmentStatusBadge status={s.status} />} />
      <div className="page-container mt-5 grid max-w-5xl grid-cols-1 gap-5 lg:mt-6 lg:grid-cols-2" data-testid="courier-detail" data-status={s.status}>
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <MapPin size={20} aria-hidden="true" className="text-accent" />
              {t('address')}
            </h2>
            {a ? (
              <>
                <address className="mt-2 text-sm not-italic leading-relaxed">
                  <span className="block text-xs text-muted">{t('recipient')}</span>
                  <span className="block text-base font-semibold">{a.recipientName}</span>
                  <span className="mt-1 block">
                    {a.building}
                    {a.street ? `, ${a.street}` : ''}
                  </span>
                  <span className="block">
                    {[a.area, a.wilayaName ? localize(a.wilayaName, locale) : null, a.governorateName ? localize(a.governorateName, locale) : null].filter(Boolean).join(', ')}
                  </span>
                </address>
                {a.instructions ? (
                  <p className="mt-2 rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm">
                    <span className="font-semibold">{t('instructions')}: </span>
                    {a.instructions}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.lat != null && a.lng != null ? (
                    <>
                      <a href={navigationLink(a.lat, a.lng)} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
                        <Navigation size={16} aria-hidden="true" />
                        {t('navigate')}
                      </a>
                      <a href={osmLink(a.lat, a.lng)} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                        OSM
                        <ExternalLink size={14} aria-hidden="true" className="flip-rtl" />
                      </a>
                    </>
                  ) : (
                    <p className="text-sm text-muted">{t('noGps')}</p>
                  )}
                  {a.phone ? (
                    <a href={`tel:${a.phone}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                      <Phone size={16} aria-hidden="true" />
                      <span dir="ltr">{a.phone}</span>
                    </a>
                  ) : null}
                </div>
              </>
            ) : null}
            {s.order.notes ? (
              <p className="mt-3 text-sm">
                <span className="font-semibold">{t('orderNotes')}: </span>
                {s.order.notes}
              </p>
            ) : null}
          </Card>

          <Card>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Package size={20} aria-hidden="true" className="text-accent" />
              {t('contents')}
            </h2>
            <ul className="mt-2 divide-y divide-border text-sm">
              {s.order.items.map((it) => (
                <li key={it.id} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0">
                    {localize(it.nameSnapshot, locale)}
                    {it.variantLabel ? <span className="block text-xs text-muted">{it.variantLabel}</span> : null}
                  </span>
                  <span className="font-display shrink-0 font-bold">×{it.qty}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {s.status === 'COURIER_ASSIGNED' ? (
            <Card tone="holo" className="relative">
              <HudCorners />
              <StartDeliveryButton shipmentId={s.id} />
            </Card>
          ) : null}

          {s.status === 'OUT_FOR_DELIVERY' ? (
            <Card tone="holo" className="relative">
              <HudCorners />
              <h2 className="text-lg font-bold">{t('handoverTitle')}</h2>
              <p className="mb-4 text-sm text-muted">{t('handoverText')}</p>
              {locked ? (
                <p className="flex gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-medium" role="alert">
                  <ShieldAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
                  {t('otpLocked')}
                </p>
              ) : (
                <HandoverForm shipmentId={s.id} />
              )}
            </Card>
          ) : null}

          {s.status === 'DELIVERED' ? (
            <Card className="border-success/50">
              <p className="flex items-center gap-2 font-semibold text-success">
                <CircleCheck size={20} aria-hidden="true" />
                {s.proofName ? t('deliveredTo', { name: s.proofName }) : td('status.DELIVERED')}
              </p>
              {s.deliveredAt ? <p className="mt-1 text-sm text-muted">{format.dateTime(s.deliveredAt, 'long')}</p> : null}
            </Card>
          ) : null}
          {s.status === 'FAILED' && s.failedReason ? (
            <Card className="border-error/50">
              <p className="text-sm font-medium">{t('failedReason', { reason: s.failedReason })}</p>
            </Card>
          ) : null}

          {active ? <FailDeliveryButton shipmentId={s.id} /> : null}

          {active ? (
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <Siren size={20} aria-hidden="true" className="text-orange" />
                {t('incidentTitle')}
              </h2>
              <IncidentForm shipmentId={s.id} />
            </Card>
          ) : null}

          {s.incidents.length ? (
            <Card>
              <h2 className="text-base font-bold">{t('incidents')}</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {s.incidents.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-semibold">{td(`incident.types.${i.type}`)}</span>
                      <span className="block text-muted">{i.description}</span>
                    </span>
                    <Badge variant={i.status === 'OPEN' ? 'warning' : 'success'}>{t(`incidentStatus.${i.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <h2 className="flex items-center gap-2 text-base font-bold">
              <History size={18} aria-hidden="true" className="text-accent" />
              {t('history')}
            </h2>
            <ol className="mt-2 space-y-1.5 text-sm">
              {s.events.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-x-3">
                  <span className="font-medium">{td(`status.${e.status}`)}</span>
                  <span className="text-muted">{format.dateTime(e.createdAt, 'long')}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
