import type { Metadata } from 'next';
import { CalendarClock } from 'lucide-react';
import type { FlexStatus } from '@prisma/client';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { FLEX_ADMIN_TABS, flexCounts, listFlexForAdmin } from '@/lib/admin/flex';
import { isEmailConfigured } from '@/lib/email';
import { localize } from '@/lib/localized';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('flex.title'), robots: { index: false } };
}

const BADGE: Record<string, string> = { SUBMITTED: 'DRAFT', UNDER_REVIEW: 'DRAFT', APPROVED: 'ACTIVE', ACCEPTED: 'ACTIVE', ACTIVE: 'ACTIVE', COMPLETED: 'ARCHIVED', REJECTED: 'CLOSED', CANCELLED: 'CLOSED', DEFAULTED: 'CLOSED' };

export default async function AdminFlexPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('flex:read', '/admin/finance/flex');
  const raw = (await searchParams).status;
  const status: FlexStatus = FLEX_ADMIN_TABS.includes(raw as FlexStatus) ? (raw as FlexStatus) : 'SUBMITTED';
  const [tt, format, apps, counts] = await Promise.all([getTranslations('admin.flex'), getFormatter(), listFlexForAdmin(status), flexCounts()]);
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;

  return (
    <>
      <AdminPageHeader title={t('title')} subtitle={t('subtitle')} />
      {!isEmailConfigured() ? (
        <p className="mb-4 rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted" data-testid="flex-email-off">
          {t('emailOff')}
        </p>
      ) : null}
      <nav aria-label={t('tabsLabel')} className="mb-4 flex flex-wrap gap-2" data-testid="flex-tabs">
        {FLEX_ADMIN_TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/finance/flex?status=${s}`}
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
      {apps.length === 0 ? (
        <EmptyState icon={<CalendarClock size={28} aria-hidden="true" />} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="flex-list">
          {apps.map((a) => {
            const paid = a.installments.filter((i) => i.status === 'PAID').length;
            const late = a.installments.filter((i) => i.status === 'OVERDUE').length;
            return (
              <li key={a.id}>
                <Link href={`/admin/finance/flex/${a.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 hover:bg-surface-2" data-testid="flex-row">
                  <span className="min-w-0">
                    <span className="block font-semibold">{a.product ? localize(a.product.name, locale) : t('productGone')}</span>
                    <span className="block text-sm">
                      {formatBaisa(a.principalBaisa, locale)} · {t('months', { count: a.months })}
                      {a.installments.length > 0 ? ` · ${t('paidOf', { paid, total: a.installments.length })}` : ''}
                      {late > 0 ? ` · ${t('late', { count: late })}` : ''}
                    </span>
                    <span className="block text-xs text-muted">
                      {a.user.fullName} · <span dir="ltr">{a.user.email}</span>
                    </span>
                    <span className="block text-xs text-muted">{t('sentAt', { date: format.dateTime(a.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
                  </span>
                  <StatusBadge status={BADGE[a.status] ?? 'DRAFT'} label={t(`status.${a.status}`)} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
