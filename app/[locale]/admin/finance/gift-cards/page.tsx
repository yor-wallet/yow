import type { Metadata } from 'next';
import { Gift } from 'lucide-react';
import type { GiftCardStatus } from '@prisma/client';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { GIFT_CARD_ADMIN_TABS, formatDeclaredValue, giftCardCounts, listGiftCardsForAdmin } from '@/lib/admin/gift-cards';
import { isEmailConfigured } from '@/lib/email';
import { formatBaisa } from '@/lib/money';
import { giftCardBrandLabel } from '@/lib/payments/giftcard-brands';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('giftCards.title'), robots: { index: false } };
}

const BADGE: Record<string, string> = { SUBMITTED: 'DRAFT', UNDER_REVIEW: 'DRAFT', VERIFIED: 'ACTIVE', REJECTED: 'ARCHIVED' };

export default async function AdminGiftCardsPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('giftcards:review', '/admin/finance/gift-cards');
  const raw = (await searchParams).status;
  const status: GiftCardStatus = GIFT_CARD_ADMIN_TABS.includes(raw as GiftCardStatus) ? (raw as GiftCardStatus) : 'SUBMITTED';
  const [tt, format, cards, counts] = await Promise.all([getTranslations('admin.giftCards'), getFormatter(), listGiftCardsForAdmin(status), giftCardCounts()]);
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;

  return (
    <>
      <AdminPageHeader title={t('title')} subtitle={t('subtitle')} />
      {!isEmailConfigured() ? (
        <p className="mb-4 rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted" data-testid="giftcards-email-off">
          {t('emailOff')}
        </p>
      ) : null}
      <nav aria-label={t('tabsLabel')} className="mb-4 flex flex-wrap gap-2" data-testid="giftcards-tabs">
        {GIFT_CARD_ADMIN_TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/finance/gift-cards?status=${s}`}
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
      {cards.length === 0 ? (
        <EmptyState icon={<Gift size={28} aria-hidden="true" />} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="giftcards-list">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/finance/gift-cards/${c.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 hover:bg-surface-2"
                data-testid="giftcards-row"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">
                    {giftCardBrandLabel(c.brand, t('otherBrand'))}
                    <span className="ms-2 font-mono text-sm text-muted" dir="ltr">
                      {c.codeLast4 ? `•••• ${c.codeLast4}` : ''}
                    </span>
                  </span>
                  <span className="block text-sm" dir="ltr">
                    {formatDeclaredValue(c.declaredValue, c.declaredCurrency)}
                    {c.encashedValueBaisa !== null ? ` → ${formatBaisa(c.encashedValueBaisa, locale)}` : ''}
                  </span>
                  <span className="block text-xs text-muted">
                    {c.user.fullName} · <span dir="ltr">{c.user.email}</span>
                  </span>
                  <span className="block text-xs text-muted">{t('sentAt', { date: format.dateTime(c.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
                </span>
                <StatusBadge status={BADGE[c.status] ?? 'DRAFT'} label={t(`status.${c.status}`)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
