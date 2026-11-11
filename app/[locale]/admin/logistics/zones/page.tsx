import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { listAdminZones } from '@/lib/admin/zones';
import { formatBaisa, formatOmrNumber } from '@/lib/money';
import { localize } from '@/lib/localized';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminForm, FCheckbox, FInput, FMoney } from '@/components/admin/AdminForm';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';
import { updateZoneAction } from './actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('zones.title'), robots: { index: false } };
}

/** Baisa → the plain OMR number a staff member edits ("1.500"); empty when not set. */
const omr = (baisa: number | null) => (baisa === null ? '' : formatOmrNumber(baisa, 'en'));

export default async function AdminZonesPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireAdmin('delivery:read', '/admin/logistics/zones');
  const [t, zones] = await Promise.all([getTranslations('admin'), listAdminZones()]);
  const canWrite = ctx.can('zones:write');

  return (
    <>
      <AdminPageHeader title={t('zones.title')} subtitle={t('zones.subtitle')} />
      {canWrite ? null : (
        <p className="mb-4 rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted" data-testid="zones-readonly">
          {t('zones.readOnly')}
        </p>
      )}
      {zones.length === 0 ? (
        <EmptyState icon={<MapPin size={28} aria-hidden="true" />} title={t('zones.empty')} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="zone-list">
          {zones.map((z) => {
            const configured = z.standardFeeBaisa !== null;
            const express = configured && z.expressAvailable && z.expressFeeBaisa !== null && z.dailyCapacityExpress !== null;
            const state = !z.isActive ? 'paused' : configured ? 'configured' : 'notConfigured';
            return (
              <li key={z.id} className="rounded-card border border-border bg-surface" data-testid="zone-row" data-state={state}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="block font-semibold">{localize(z.governorateName, locale)}</span>
                      <span className="block text-xs text-muted">
                        {localize(z.name, locale)} · {z.wilayaCount === 0 ? t('zones.wholeGovernorate') : t('zones.wilayas', { count: z.wilayaCount })}
                      </span>
                      <span className="mt-1 block text-sm text-muted [unicode-bidi:plaintext]">
                        {configured ? t('zones.summaryStandard', { fee: formatBaisa(z.standardFeeBaisa!, locale), hours: z.standardHours }) : t('zones.notConfigured')}
                        {configured ? ` · ${express ? t('zones.summaryExpress', { fee: formatBaisa(z.expressFeeBaisa!, locale), hours: z.expressHours }) : t('zones.summaryNoExpress')}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <StatusBadge status={state === 'configured' ? 'ACTIVE' : state === 'paused' ? 'ARCHIVED' : 'DRAFT'} label={t(`zones.${state}`)} testId="zone-status" />
                      {canWrite ? <span className="text-sm font-semibold text-accent group-open:hidden">{t('zones.edit')}</span> : null}
                    </span>
                  </summary>
                  {canWrite ? (
                    <div className="border-t border-border p-4">
                      <AdminForm action={updateZoneAction} hidden={{ id: z.id }} submitLabel={t('zones.save')} testId="zone-form" className="flex flex-col gap-5">
                        <FCheckbox name="isActive" label={t('zones.active')} defaultChecked={z.isActive} />
                        <fieldset className="grid gap-4 sm:grid-cols-2">
                          <legend className="mb-2 text-sm font-bold">{t('zones.standard')}</legend>
                          <FMoney name="standardFeeBaisa" label={t('zones.standardFee')} hint={t('zones.standardFeeHint')} defaultValue={omr(z.standardFeeBaisa)} />
                          <FInput name="standardHours" type="number" inputMode="numeric" min={1} max={240} label={t('zones.standardHours')} defaultValue={z.standardHours} required />
                          <FMoney name="freeStandardFromBaisa" label={t('zones.freeFrom')} hint={t('zones.freeFromHint')} defaultValue={omr(z.freeStandardFromBaisa)} />
                          <FInput name="dailyCapacityStandard" type="number" inputMode="numeric" min={0} label={t('zones.capacityStandard')} hint={t('zones.capacityHint')} defaultValue={z.dailyCapacityStandard ?? ''} />
                        </fieldset>
                        <fieldset className="grid gap-4 sm:grid-cols-2">
                          <legend className="mb-2 text-sm font-bold">{t('zones.express')}</legend>
                          <div className="sm:col-span-2">
                            <FCheckbox name="expressAvailable" label={t('zones.expressAvailable')} defaultChecked={z.expressAvailable} />
                          </div>
                          <FMoney name="expressFeeBaisa" label={t('zones.expressFee')} hint={t('zones.expressFeeHint')} defaultValue={omr(z.expressFeeBaisa)} />
                          <FInput name="expressHours" type="number" inputMode="numeric" min={1} max={72} label={t('zones.expressHours')} defaultValue={z.expressHours} required />
                          <FInput name="dailyCapacityExpress" type="number" inputMode="numeric" min={0} label={t('zones.capacityExpress')} hint={t('zones.capacityExpressHint')} defaultValue={z.dailyCapacityExpress ?? ''} />
                        </fieldset>
                        <fieldset className="grid gap-4 sm:grid-cols-2">
                          <legend className="mb-2 text-sm font-bold">{t('zones.weight')}</legend>
                          <FMoney name="perKgBaisa" label={t('zones.perKg')} hint={t('zones.weightHint')} defaultValue={omr(z.perKgBaisa)} />
                          <FMoney name="perLitreBaisa" label={t('zones.perLitre')} defaultValue={omr(z.perLitreBaisa)} />
                        </fieldset>
                      </AdminForm>
                    </div>
                  ) : null}
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
