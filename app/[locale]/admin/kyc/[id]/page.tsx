import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { getKycSubmissionForAdmin } from '@/lib/admin/kyc';
import { kycDocumentUrl, KYC_DOCUMENT_TYPES } from '@/lib/kyc';
import { AdminForm, FCheckbox, FSelect, FTextarea } from '@/components/admin/AdminForm';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';
import { decideKycAction } from '../actions';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('kyc.detailTitle'), robots: { index: false } };
}

const BADGE: Record<string, string> = { PENDING: 'DRAFT', DOCUMENTS_REQUESTED: 'DRAFT', VERIFIED: 'ACTIVE', REJECTED: 'ARCHIVED' };

export default async function AdminKycDetailPage({ params }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  const ctx = await requireAdmin('kyc:read', `/admin/kyc/${id}`);
  const sub = await getKycSubmissionForAdmin(id);
  if (!sub) notFound();
  const [tt, format] = await Promise.all([getTranslations('admin.kyc'), getFormatter()]);
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;
  const canSee = ctx.can('kyc:documents');
  const canDecide = ctx.can('kyc:decide') && sub.status === 'PENDING';
  const docs = canSee ? await Promise.all(sub.documents.map(async (d) => ({ ...d, url: await kycDocumentUrl(d.id, ctx.actor.id) }))) : [];
  const date = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <AdminPageHeader title={sub.fullName} subtitle={t('detailTitle')} backHref="/admin/kyc" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4" data-testid="kyc-customer">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold">{t('customer')}</h2>
              <StatusBadge status={BADGE[sub.status] ?? 'DRAFT'} label={t(`status.${sub.status}`)} testId="kyc-status" />
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">{t('nameOnDocuments')}</dt><dd className="font-semibold">{sub.fullName}</dd></div>
              <div><dt className="text-muted">{t('accountName')}</dt><dd className="font-semibold">{sub.user.fullName}</dd></div>
              <div><dt className="text-muted">{t('email')}</dt><dd className="break-all font-semibold" dir="ltr">{sub.user.email}</dd><dd className="text-xs text-muted">{sub.user.emailVerifiedAt ? t('emailConfirmed') : t('emailNotConfirmed')}</dd></div>
              <div><dt className="text-muted">{t('phone')}</dt><dd className="font-semibold" dir="ltr">{sub.user.phone ?? '—'}</dd></div>
              <div><dt className="text-muted">{t('accountSince')}</dt><dd>{date(sub.user.createdAt)}</dd></div>
              <div><dt className="text-muted">{t('submittedLabel')}</dt><dd>{date(sub.submittedAt)}</dd></div>
              {sub.reviewedAt ? (
                <div className="sm:col-span-2"><dt className="text-muted">{t('reviewed')}</dt><dd>{date(sub.reviewedAt)}{sub.reviewedBy ? ` — ${sub.reviewedBy.fullName}` : ''}{sub.reviewNote ? ` — ${sub.reviewNote}` : ''}</dd></div>
              ) : null}
            </dl>
          </div>
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="text-base font-bold">{t('documents')}</h2>
            {!canSee ? (
              <p className="mt-2 text-sm text-muted">{t('noDocumentAccess')}</p>
            ) : docs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{t('noDocuments')}</p>
            ) : (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="kyc-documents">
                {docs.map((d) => (
                  <li key={d.id} className="overflow-hidden rounded-xl border border-border">
                    <p className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-semibold">{t(`doc.${d.type}`)}</p>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={d.url} alt={t(`doc.${d.type}`)} referrerPolicy="no-referrer" loading="lazy" className="max-h-72 w-full bg-surface-2 object-contain" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {canSee ? <p className="mt-3 text-xs text-muted">{t('auditNote')}</p> : null}
          </div>
        </section>
        <aside className="rounded-card border border-border bg-surface p-4 self-start" data-testid="kyc-decision">
          <h2 className="text-base font-bold">{t('decision')}</h2>
          {canDecide ? (
            <AdminForm action={decideKycAction} hidden={{ submissionId: sub.id }} submitLabel={t('save')} testId="kyc-form" className="mt-3 flex flex-col gap-4">
              <FSelect
                name="decision"
                label={t('decisionLabel')}
                defaultValue="VERIFIED"
                options={[
                  { value: 'VERIFIED', label: t('decide.VERIFIED') },
                  { value: 'REJECTED', label: t('decide.REJECTED') },
                  { value: 'DOCUMENTS_REQUESTED', label: t('decide.DOCUMENTS_REQUESTED') },
                ]}
              />
              <FTextarea name="notes" label={t('notes')} hint={t('notesHint')} rows={3} maxLength={2000} />
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-semibold">{t('requestDocs')}</legend>
                {KYC_DOCUMENT_TYPES.map((d) => (
                  <FCheckbox key={d} name={`doc_${d}`} label={t(`doc.${d}`)} />
                ))}
              </fieldset>
            </AdminForm>
          ) : (
            <p className="mt-2 text-sm text-muted">{sub.status === 'PENDING' ? t('noDecideRight') : t('alreadyDecided')}</p>
          )}
        </aside>
      </div>
    </>
  );
}
