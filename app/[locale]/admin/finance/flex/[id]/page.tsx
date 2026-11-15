import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { flexCustomerHistory, getFlexForAdmin } from '@/lib/admin/flex';
import { computeSchedule, isFlexMonths } from '@/lib/flex/schedule';
import { localize } from '@/lib/localized';
import { formatBaisa } from '@/lib/money';
import { AdminForm, FSelect, FTextarea } from '@/components/admin/AdminForm';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';
import { decideFlexAction } from '../actions';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('flex.detailTitle'), robots: { index: false } };
}

const BADGE: Record<string, string> = { SUBMITTED: 'DRAFT', UNDER_REVIEW: 'DRAFT', APPROVED: 'ACTIVE', ACCEPTED: 'ACTIVE', ACTIVE: 'ACTIVE', COMPLETED: 'ARCHIVED', REJECTED: 'CLOSED', CANCELLED: 'CLOSED', DEFAULTED: 'CLOSED' };
const INST_BADGE: Record<string, string> = { PENDING: 'DRAFT', PAID: 'ACTIVE', OVERDUE: 'CLOSED', CANCELLED: 'ARCHIVED' };

export default async function AdminFlexDetailPage({ params }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  const ctx = await requireAdmin('flex:read', `/admin/finance/flex/${id}`);
  const app = await getFlexForAdmin(id);
  if (!app) notFound();
  const [tt, tk, format, history] = await Promise.all([getTranslations('admin.flex'), getTranslations('admin.kyc'), getFormatter(), flexCustomerHistory(app.user.id, app.id)]);
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;
  const kycLabel = tk as unknown as (key: string) => string;
  const date = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' });
  const day = (d: Date) => format.dateTime(new Date(`${d.toISOString().slice(0, 10)}T00:00:00+04:00`), { dateStyle: 'medium' });
  const pending = app.status === 'SUBMITTED' || app.status === 'UNDER_REVIEW';
  const ownApplication = app.user.id === ctx.actor.id;
  const canDecide = ctx.can('flex:decide') && pending && !ownApplication;
  const identityOk = app.user.kycStatus === 'VERIFIED';
  // Before the customer accepts, show what the schedule WILL be (same computation as the customer's screen).
  const preview = app.installments.length === 0 && isFlexMonths(app.months) ? computeSchedule(app.principalBaisa, app.months) : null;
  const otherOpen = (history.plans.ACTIVE ?? 0) + (history.plans.APPROVED ?? 0) + (history.plans.ACCEPTED ?? 0);
  const productName = app.product ? localize(app.product.name, locale) : t('productGone');

  return (
    <>
      <AdminPageHeader title={productName} subtitle={t('detailTitle')} backHref="/admin/finance/flex" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4" data-testid="flex-application">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold">{t('application')}</h2>
              <StatusBadge status={BADGE[app.status] ?? 'DRAFT'} label={t(`status.${app.status}`)} testId="flex-status" />
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">{t('product')}</dt><dd className="font-semibold">{productName}</dd>{app.variant ? <dd className="text-xs text-muted" dir="ltr">{app.variant.sku}</dd> : null}</div>
              <div><dt className="text-muted">{t('amount')}</dt><dd className="font-semibold">{formatBaisa(app.principalBaisa, locale)}</dd></div>
              <div><dt className="text-muted">{t('duration')}</dt><dd className="font-semibold">{t('months', { count: app.months })}</dd></div>
              <div><dt className="text-muted">{t('sentLabel')}</dt><dd>{date(app.createdAt)}</dd></div>
              {app.order ? (
                <div><dt className="text-muted">{t('order')}</dt><dd><Link href={`/admin/orders/${app.order.number}`} className="font-semibold text-accent underline-offset-4 hover:underline" dir="ltr">{app.order.number}</Link></dd></div>
              ) : null}
              {app.termsAcceptedAt ? <div><dt className="text-muted">{t('termsAccepted')}</dt><dd>{date(app.termsAcceptedAt)}</dd></div> : null}
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4" data-testid="flex-customer">
            <h2 className="text-base font-bold">{t('customer')}</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">{t('name')}</dt><dd className="font-semibold">{app.user.fullName}</dd></div>
              <div><dt className="text-muted">{t('email')}</dt><dd className="break-all font-semibold" dir="ltr">{app.user.email}</dd></div>
              <div><dt className="text-muted">{t('phone')}</dt><dd className="font-semibold" dir="ltr">{app.user.phone ?? '—'}</dd></div>
              <div><dt className="text-muted">{t('identity')}</dt><dd className="font-semibold" data-testid="flex-identity">{kycLabel(`status.${app.user.kycStatus}`)}</dd></div>
              <div><dt className="text-muted">{t('accountSince')}</dt><dd>{date(app.user.createdAt)}</dd></div>
              <div><dt className="text-muted">{t('otherPlans')}</dt><dd>{t('otherPlansValue', { open: otherOpen, done: history.plans.COMPLETED ?? 0 })}</dd></div>
              <div><dt className="text-muted">{t('lateInstalments')}</dt><dd className={history.overdue > 0 ? 'font-semibold text-error' : undefined}>{history.overdue}</dd></div>
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="text-base font-bold">{app.installments.length > 0 ? t('schedule') : t('schedulePreview')}</h2>
            <ol className="mt-3 flex flex-col divide-y divide-border text-sm" data-testid="flex-schedule">
              {app.installments.length > 0
                ? app.installments.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-semibold">{t('instalmentN', { n: i.sequence })}</span>
                        <span className="ms-2 text-muted">{day(i.dueDate)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{formatBaisa(i.amountBaisa, locale)}</span>
                        <StatusBadge status={INST_BADGE[i.status] ?? 'DRAFT'} label={t(`instStatus.${i.status}`)} />
                      </span>
                    </li>
                  ))
                : (preview?.installments ?? []).map((i) => (
                    <li key={i.sequence} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-semibold">{t('instalmentN', { n: i.sequence })}</span>
                      <span className="font-semibold">{formatBaisa(i.amountBaisa, locale)}</span>
                    </li>
                  ))}
            </ol>
            {app.installments.length === 0 ? <p className="mt-3 text-xs text-muted">{t('schedulePreviewNote')}</p> : null}
          </div>
        </section>

        <aside className="self-start rounded-card border border-border bg-surface p-4" data-testid="flex-decision">
          <h2 className="text-base font-bold">{t('decision')}</h2>
          <p className="mt-2 text-sm text-muted">{t('terms')}</p>
          {canDecide ? (
            <>
              {!identityOk ? <p className="mt-3 rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-medium" data-testid="flex-identity-warning">{t('identityMissing')}</p> : null}
              <AdminForm action={decideFlexAction} hidden={{ id: app.id }} submitLabel={t('save')} testId="flex-form" className="mt-3 flex flex-col gap-4">
                <FSelect
                  name="decision"
                  label={t('decisionLabel')}
                  defaultValue={identityOk ? 'APPROVED' : 'REJECTED'}
                  options={[
                    ...(identityOk ? [{ value: 'APPROVED', label: t('decide.APPROVED') }] : []),
                    { value: 'REJECTED', label: t('decide.REJECTED') },
                    ...(app.status === 'SUBMITTED' ? [{ value: 'UNDER_REVIEW', label: t('decide.UNDER_REVIEW') }] : []),
                  ]}
                />
                <FTextarea name="notes" label={t('notes')} hint={t('notesHint')} rows={3} maxLength={1000} />
              </AdminForm>
            </>
          ) : pending ? (
            <p className="mt-3 text-sm text-muted" data-testid="flex-cannot-decide">{ownApplication ? t('ownApplication') : t('noDecideRight')}</p>
          ) : (
            <dl className="mt-3 flex flex-col gap-2 text-sm" data-testid="flex-outcome">
              {app.decidedAt ? <div><dt className="text-muted">{t('decided')}</dt><dd>{date(app.decidedAt)}{app.decidedBy ? ` — ${app.decidedBy.fullName}` : app.partnerRef ? ` — ${t('byPartner')}` : ''}</dd></div> : null}
              {app.decisionNote ? <div><dt className="text-muted">{t('notes')}</dt><dd>{app.decisionNote}</dd></div> : null}
              <p className="text-muted">{t('alreadyDecided')}</p>
            </dl>
          )}
        </aside>
      </div>
    </>
  );
}
