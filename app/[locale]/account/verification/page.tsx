import type { Metadata } from 'next';
import { BadgeCheck, Clock, FileWarning, Lock, ShieldCheck, ShieldX, ShieldQuestion, Eye, Trash2, Scale } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import type { KycDocumentType, KycStatus } from '@prisma/client';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { localize } from '@/lib/localized';
import { getKycOverview, KYC_DOCUMENT_TYPES } from '@/lib/kyc';
import { getDefaultAddress } from '@/lib/delivery/addresses';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { buttonClasses } from '@/components/ui/Button';
import { KycStatusBadge } from '@/components/delivery/StatusBadges';
import { KycFlow } from '@/components/account/KycFlow';
import { cn } from '@/lib/cn';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'kyc' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const STATUS_ICON: Record<KycStatus, typeof ShieldCheck> = {
  UNVERIFIED: ShieldQuestion,
  PENDING: Clock,
  DOCUMENTS_REQUESTED: FileWarning,
  VERIFIED: BadgeCheck,
  REJECTED: ShieldX,
};

const STATUS_TONE: Record<KycStatus, string> = {
  UNVERIFIED: 'text-cyan',
  PENDING: 'text-cyan',
  DOCUMENTS_REQUESTED: 'text-amber',
  VERIFIED: 'text-success',
  REJECTED: 'text-error',
};

export default async function VerificationPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: '/account/verification' });
  const [t, format, overview, address] = await Promise.all([
    getTranslations('kyc'),
    getFormatter(),
    getKycOverview(user.id),
    getDefaultAddress(user.id),
  ]);
  const status = overview.status;
  const sub = overview.submission;
  const Icon = STATUS_ICON[status];
  const showFlow = status === 'UNVERIFIED' || status === 'REJECTED' || status === 'DOCUMENTS_REQUESTED';
  const required: KycDocumentType[] =
    status === 'DOCUMENTS_REQUESTED' && sub?.requestedDocs.length ? sub.requestedDocs : [...KYC_DOCUMENT_TYPES];
  const addressLine = address
    ? [address.building, address.area, localize(address.wilaya.name, locale), localize(address.governorate.name, locale)].filter(Boolean).join(', ')
    : null;

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/account" />
      <div className="page-container mt-5 grid grid-cols-1 gap-5 lg:mt-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <Card tone={status === 'VERIFIED' ? 'gradient' : 'surface'} data-testid="kyc-status" data-status={status}>
            <div className="flex items-start gap-4">
              <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-premium', STATUS_TONE[status])}>
                <Icon size={24} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">{t(`statusCard.${status}.title`)}</h2>
                  <KycStatusBadge status={status} />
                </div>
                <p className="mt-1 text-sm text-muted">{t(`statusCard.${status}.text`)}</p>
                {sub && status !== 'UNVERIFIED' ? (
                  <p className="mt-2 text-xs text-muted">
                    {t('submittedOn', { date: format.dateTime(sub.submittedAt, 'long') })}
                    {sub.reviewedAt ? ` · ${t('reviewedOn', { date: format.dateTime(sub.reviewedAt, 'long') })}` : ''}
                  </p>
                ) : null}
              </div>
            </div>
            {status === 'REJECTED' && sub?.rejectionReason ? (
              <div className="mt-4 rounded-xl border border-error/40 bg-error/10 p-3 text-sm" data-testid="kyc-reason">
                <p className="font-semibold">{t('rejectionReason')}</p>
                <p className="mt-0.5 whitespace-pre-line">{sub.rejectionReason}</p>
              </div>
            ) : null}
            {status === 'DOCUMENTS_REQUESTED' && sub ? (
              <div className="mt-4 rounded-xl border border-amber/50 bg-amber/10 p-3 text-sm" data-testid="kyc-requested">
                {sub.reviewNote ? (
                  <>
                    <p className="font-semibold">{t('reviewerNote')}</p>
                    <p className="mt-0.5 whitespace-pre-line">{sub.reviewNote}</p>
                  </>
                ) : null}
                <p className="mt-2 font-semibold">{t('requested')}</p>
                <ul className="mt-1 list-inside list-disc">
                  {required.map((d) => (
                    <li key={d}>{t(`docs.${d}`)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {status === 'PENDING' && sub ? (
              <div className="mt-4 text-sm">
                <p className="font-semibold">{t('received')}</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {sub.documents.map((d) => (
                    <li key={d.id} className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-2 px-3 py-1 text-xs font-medium">
                      <Lock size={12} aria-hidden="true" className="text-success" />
                      {t(`docs.${d.type}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {status === 'VERIFIED' ? (
              <Link href="/flex" className={buttonClasses({ variant: 'primary', size: 'sm', className: 'mt-4' })}>
                {t('flexCta')}
              </Link>
            ) : null}
          </Card>

          {showFlow ? (
            <Card>
              <KycFlow
                mode={status === 'DOCUMENTS_REQUESTED' ? 'requested' : 'new'}
                required={required}
                initialName={sub?.fullName ?? user.fullName}
                email={user.email}
                phone={user.phone}
                addressLine={addressLine}
              />
            </Card>
          ) : null}
        </div>

        <aside className="min-w-0 lg:col-span-4">
          <Card tone="premium" data-theme="dark" className="lg:sticky lg:top-28">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <ShieldCheck size={20} aria-hidden="true" className="text-cyan" />
              {t('privacy.title')}
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              <li className="flex gap-2.5">
                <Lock size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-cyan" />
                {t('privacy.encrypted')}
              </li>
              <li className="flex gap-2.5">
                <Eye size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-cyan" />
                {t('privacy.access')}
              </li>
              <li className="flex gap-2.5">
                <Trash2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-cyan" />
                {t('privacy.minimal')}
              </li>
              <li className="flex gap-2.5">
                <Scale size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-cyan" />
                {t('privacy.law')}
              </li>
            </ul>
            <Link href="/legal/privacy" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-cyan underline-offset-4 hover:underline">
              {t('review.privacyLink')}
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
