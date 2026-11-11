import type { Metadata } from 'next';
import { Bike } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { listAdminCouriers } from '@/lib/admin/couriers';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminForm, FInput } from '@/components/admin/AdminForm';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { AdminPageHeader, Section, StatusBadge } from '@/components/admin/ui';
import { createCourierAction, setCourierActiveAction } from './actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('couriers.title'), robots: { index: false } };
}

export default async function AdminCouriersPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireAdmin('delivery:read', '/admin/logistics/couriers');
  const [t, couriers] = await Promise.all([getTranslations('admin'), listAdminCouriers()]);
  const canWrite = ctx.can('couriers:write');

  return (
    <>
      <AdminPageHeader title={t('couriers.title')} subtitle={t('couriers.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          {couriers.length === 0 ? (
            <EmptyState icon={<Bike size={28} aria-hidden="true" />} title={t('couriers.empty')} description={t('couriers.emptyText')} />
          ) : (
            <ul className="flex flex-col gap-3" data-testid="courier-list">
              {couriers.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4" data-testid="courier-row">
                  <div className="min-w-0">
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-muted">
                      <span dir="ltr" className="[unicode-bidi:isolate]">
                        {c.phone}
                      </span>
                      {c.vehicle ? ` · ${c.vehicle}` : ''}
                    </p>
                    <p className="text-xs text-muted">
                      {c.accountEmail ? (
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {c.accountEmail}
                        </span>
                      ) : (
                        t('couriers.noAccount')
                      )}{' '}
                      · {t('couriers.open', { count: c.openShipments })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={c.isActive ? 'ACTIVE' : 'ARCHIVED'} label={t(c.isActive ? 'couriers.active' : 'couriers.inactive')} testId="courier-status" />
                    {canWrite ? (
                      <ConfirmAction
                        action={setCourierActiveAction}
                        fields={{ id: c.id, isActive: c.isActive ? 'false' : 'true' }}
                        label={t(c.isActive ? 'couriers.deactivate' : 'couriers.activate')}
                        title={t(c.isActive ? 'couriers.deactivateConfirm' : 'couriers.activateConfirm', { name: c.name })}
                        text={c.isActive ? t('couriers.deactivateText') : undefined}
                        confirmLabel={t(c.isActive ? 'couriers.deactivate' : 'couriers.activate')}
                        testId="courier-toggle"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canWrite ? (
          <Section id="new-courier" title={t('couriers.add')} description={t('couriers.addText')}>
            <AdminForm action={createCourierAction} submitLabel={t('couriers.add')} testId="courier-form" resetOnSuccess className="flex flex-col gap-4">
              <FInput name="name" label={t('couriers.name')} maxLength={80} required autoComplete="off" />
              <FInput name="phone" type="tel" inputMode="tel" dir="ltr" label={t('couriers.phone')} hint={t('couriers.phoneHint')} required autoComplete="off" />
              <FInput name="vehicle" label={t('couriers.vehicle')} maxLength={80} autoComplete="off" />
              <FInput name="accountEmail" type="email" dir="ltr" label={t('couriers.account')} hint={t('couriers.accountHint')} autoComplete="off" />
            </AdminForm>
          </Section>
        ) : null}
      </div>
    </>
  );
}
