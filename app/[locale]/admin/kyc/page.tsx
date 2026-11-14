import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import type { KycStatus } from '@prisma/client';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { KYC_ADMIN_TABS, kycCounts } from '@/lib/admin/kyc';
import { listKycQueue } from '@/lib/kyc';
import { isEmailConfigured } from '@/lib/email';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('kyc.title'), robots: { index: false } };
}

const BADGE: Record<string, string> = { PENDING: 'DRAFT', DOCUMENTS_REQUESTED: 'DRAFT', VERIFIED: 'ACTIVE', REJECTED: 'ARCHIVED' };

export default async function AdminKycPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('kyc:read', '/admin/kyc');
  const raw = (await searchParams).status;
  const status: KycStatus = KYC_ADMIN_TABS.includes(raw as KycStatus) ? (raw as KycStatus) : 'PENDING';
  const [tt, format, queue, counts] = await Promise.all([getTranslations('admin.kyc'), getFormatter(), listKycQueue({ statuses: [status], take: 100 }), kycCounts()]);
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;

  return (
    <>
      <AdminPageHeader title={t('title')} subtitle={t('subtitle')} />
      {!isEmailConfigured() ? (
        <p className="mb-4 rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted" data-testid="kyc-email-off">
          {t('emailOff')}
        </p>
      ) : null}
      <nav aria-label={t('tabsLabel')} className="mb-4 flex flex-wrap gap-2" data-testid="kyc-tabs">
        {KYC_ADMIN_TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/kyc?status=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors duration-(--dur-btn)',
              s === status ? 'border-night bg-yellow' : 'border-border-strong bg-surface hover:bg-surface-2',
            )}
          >
            {t(`status.${s}`)}
            <span className="rounded-full bg-surface-2 px-2 text-xs">{counts[s] ?? 0}</span>
          </Link>
        ))}
      </nav>
      {queue.items.length === 0 ? (
        <EmptyState icon={<ShieldCheck size={28} aria-hidden="true" />} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="kyc-list">
          {queue.items.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/kyc/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 hover:bg-surface-2" data-testid="kyc-row">
                <span className="min-w-0">
                  <span className="block font-semibold">{s.fullName}</span>
                  <span className="block break-all text-xs text-muted" dir="ltr">
                    {s.user.email}
                  </span>
                  <span className="block text-xs text-muted">{t('submittedAt', { date: format.dateTime(s.submittedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
                </span>
                <StatusBadge status={BADGE[s.status] ?? 'DRAFT'} label={t(`status.${s.status}`)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
