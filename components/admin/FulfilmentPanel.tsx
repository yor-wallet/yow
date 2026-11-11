import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { ShipmentStatus } from '@prisma/client';
import { AdminForm, FInput, FSelect } from './AdminForm';
import { ConfirmAction } from './ConfirmAction';
import { Section, StatusBadge } from './ui';
import { assignCourierAction, shipmentStepAction } from '@/app/[locale]/admin/orders/[number]/actions';

type Props = {
  shipment: { id: string; status: ShipmentStatus; trackingCode: string; promisedBy: Date | null; failedReason: string | null; courier: { id: string; name: string; phone: string } | null } | null;
  couriers: { id: string; name: string; phone: string }[];
  canWrite: boolean;
};

const BADGE: Record<ShipmentStatus, string> = { CONFIRMED: 'DRAFT', PREPARING: 'DRAFT', PACKED: 'DRAFT', COURIER_ASSIGNED: 'ACTIVE', OUT_FOR_DELIVERY: 'ACTIVE', DELIVERED: 'ACTIVE', FAILED: 'ARCHIVED' };

/**
 * Preparation & delivery of one order: the next allowed step only (the rules live in
 * lib/delivery/shipments.ts). Hand-over to the customer is done by the courier in the courier
 * workspace with the customer's code — never from here.
 */
export async function FulfilmentPanel({ shipment, couriers, canWrite }: Props) {
  const [t, tStatus, format] = await Promise.all([getTranslations('admin.fulfilment'), getTranslations('delivery.status'), getFormatter()]);
  if (!shipment) {
    return (
      <Section id="fulfilment" title={t('title')}>
        <p className="text-sm text-muted" data-testid="fulfilment-none">
          {t('none')}
        </p>
      </Section>
    );
  }
  const s = shipment.status;
  const step = (to: 'PREPARING' | 'PACKED', label: string, title: string, testId: string) => (
    <ConfirmAction action={shipmentStepAction} fields={{ shipmentId: shipment.id, to }} label={label} title={title} confirmLabel={label} testId={testId} variant="primary" />
  );
  const failable = s !== 'DELIVERED' && s !== 'FAILED';

  return (
    <Section id="fulfilment" title={t('title')} actions={<StatusBadge status={BADGE[s]} label={tStatus(s)} testId="shipment-status" />}>
      <dl className="mb-4 grid grid-cols-1 gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t('tracking')}</dt>
          <dd dir="ltr" className="font-semibold [unicode-bidi:isolate]">
            {shipment.trackingCode}
          </dd>
        </div>
        {shipment.promisedBy ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('promisedBy')}</dt>
            <dd className="font-semibold">{format.dateTime(shipment.promisedBy, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' })}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t('courier')}</dt>
          <dd className="font-semibold" data-testid="shipment-courier">
            {shipment.courier ? shipment.courier.name : t('noCourier')}
          </dd>
        </div>
        {s === 'FAILED' && shipment.failedReason ? (
          <div className="rounded-xl border border-error/40 bg-error/10 p-2 text-sm">
            <dt className="font-semibold">{t('failedReason')}</dt>
            <dd>{shipment.failedReason}</dd>
          </div>
        ) : null}
      </dl>

      {!canWrite ? (
        <p className="text-sm text-muted">{t('readOnly')}</p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="fulfilment-actions">
          {s === 'CONFIRMED' ? step('PREPARING', t('startPreparing'), t('startPreparingConfirm'), 'step-preparing') : null}
          {s === 'PREPARING' ? step('PACKED', t('markPacked'), t('markPackedConfirm'), 'step-packed') : null}
          {s === 'FAILED' ? step('PACKED', t('redispatch'), t('redispatchConfirm'), 'step-redispatch') : null}
          {s === 'COURIER_ASSIGNED' ? step('PACKED', t('unassign'), t('unassignConfirm'), 'step-unassign') : null}

          {s === 'CONFIRMED' || s === 'PREPARING' || s === 'PACKED' || s === 'COURIER_ASSIGNED' ? (
            couriers.length === 0 ? (
              <p className="text-sm text-muted" data-testid="no-couriers">
                {t('noCouriers')}{' '}
                <Link href="/admin/logistics/couriers" className="font-semibold text-accent underline-offset-4 hover:underline">
                  {t('addCourier')}
                </Link>
              </p>
            ) : (
              <AdminForm action={assignCourierAction} hidden={{ shipmentId: shipment.id }} submitLabel={shipment.courier ? t('changeCourier') : t('assign')} testId="assign-form" className="flex flex-col gap-3">
                <FSelect
                  name="courierId"
                  label={t('chooseCourier')}
                  hint={s === 'PACKED' ? t('assignHintPacked') : t('assignHintEarly')}
                  defaultValue={shipment.courier?.id ?? ''}
                  required
                  options={[{ value: '', label: '—' }, ...couriers.map((c) => ({ value: c.id, label: `${c.name} · ${c.phone}` }))]}
                />
              </AdminForm>
            )
          ) : null}

          {s === 'OUT_FOR_DELIVERY' ? <p className="text-sm text-muted">{t('withCourier')}</p> : null}
          {s === 'DELIVERED' ? <p className="text-sm font-medium text-success">{t('delivered')}</p> : null}

          {failable ? (
            <details className="rounded-xl border border-border p-3">
              <summary className="cursor-pointer text-sm font-semibold">{t('markFailed')}</summary>
              <AdminForm action={shipmentStepAction} hidden={{ shipmentId: shipment.id, to: 'FAILED' }} submitLabel={t('markFailed')} submitVariant="danger" testId="fail-form" className="mt-3 flex flex-col gap-3">
                <FInput name="note" label={t('failReason')} hint={t('failHint')} maxLength={300} required />
              </AdminForm>
            </details>
          ) : null}
        </div>
      )}
    </Section>
  );
}
