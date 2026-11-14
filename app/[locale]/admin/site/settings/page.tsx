import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { getSettings } from '@/lib/admin/settings';
import { PAYMENT_SETTING_SECTIONS, toFormValue } from '@/lib/admin/payment-settings';
import { configuredNetworks, maskAddress, NETWORK_IDS } from '@/lib/payments/onchain/networks';
import { AdminForm, FCheckbox, FInput, FMoney } from '@/components/admin/AdminForm';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';
import { savePaymentSettingsAction } from './actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('paymentSettings.title'), robots: { index: false } };
}

export default async function AdminPaymentSettingsPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('settings:write', '/admin/site/settings');
  const [tt, settings] = await Promise.all([getTranslations('admin.paymentSettings'), getSettings()]);
  // Section and field keys are dynamic (`crypto.enabled` → fields.crypto.enabled.label).
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;
  const networks = configuredNetworks();

  return (
    <>
      <AdminPageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-5" data-testid="payment-settings">
        {PAYMENT_SETTING_SECTIONS.map((section) => (
          <section key={section.id} className="rounded-card border border-border bg-surface p-4 sm:p-5" aria-labelledby={`ps-${section.id}`} data-testid={`ps-section-${section.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={`ps-${section.id}`} className="text-lg font-bold">
                  {t(`${section.id}.title`)}
                </h2>
                <p className="mt-1 max-w-prose text-sm text-muted">{t(`${section.id}.description`)}</p>
              </div>
              {section.id === 'crypto' ? <StatusBadge status={networks.length > 0 ? 'ACTIVE' : 'DRAFT'} label={networks.length > 0 ? t('crypto.addressesOn', { count: networks.length }) : t('crypto.addressesOff')} testId="crypto-processor" /> : null}
            </div>
            {section.id === 'crypto' ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-3" data-testid="crypto-networks">
                {NETWORK_IDS.map((id) => {
                  const n = networks.find((x) => x.id === id);
                  return (
                    <li key={id} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm" data-state={n ? 'on' : 'off'} data-network={id}>
                      <span className="block font-semibold">{t(`crypto.networkNames.${id}`)}</span>
                      <code className="block break-all text-xs text-muted" dir="ltr">
                        {n ? maskAddress(n.address) : t('crypto.networkOff')}
                      </code>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {section.id === 'crypto' && networks.length === 0 ? <p className="mt-3 rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted">{t('crypto.addressesHint')}</p> : null}
            <AdminForm action={savePaymentSettingsAction} hidden={{ section: section.id }} submitLabel={t('save')} testId={`ps-form-${section.id}`} className="mt-4 flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {section.fields.map((f) => {
                  const value = settings[f.key] as number | null;
                  const label = t(`fields.${f.key}.label`);
                  const hint = t(`fields.${f.key}.hint`);
                  if (f.control === 'switch') {
                    return (
                      <div key={f.key} className="sm:col-span-2">
                        <FCheckbox name={f.key} label={label} hint={hint} defaultChecked={value === 1} />
                      </div>
                    );
                  }
                  if (f.control === 'omr') return <FMoney key={f.key} name={f.key} label={label} hint={hint} defaultValue={toFormValue('omr', value)} />;
                  return (
                    <FInput
                      key={f.key}
                      name={f.key}
                      label={label}
                      hint={hint}
                      inputMode={f.control === 'percent' ? 'decimal' : 'numeric'}
                      dir="ltr"
                      className="rtl:text-right"
                      autoComplete="off"
                      defaultValue={toFormValue(f.control, value)}
                      endAdornment={f.control === 'percent' ? <span className="pe-3 text-xs font-semibold text-muted">%</span> : undefined}
                    />
                  );
                })}
              </div>
            </AdminForm>
          </section>
        ))}
        <p className="text-sm text-muted" data-testid="ps-not-yet">
          {t('notYet')}
        </p>
      </div>
    </>
  );
}
