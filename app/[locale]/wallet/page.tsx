import type { Metadata } from 'next';
import { Wallet as WalletIcon } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { getBalance, getHistory, getWalletActivity } from '@/lib/wallet';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { BalanceCard, TrustCard } from '@/components/wallet/BalanceCard';
import { ActivityList, LedgerList } from '@/components/wallet/HistoryList';
import { WalletFilters, asWalletFilter } from '@/components/wallet/WalletFilters';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'wallet' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function WalletPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const sp = await searchParams;
  const filter = asWalletFilter(sp.filter);
  const cursor = typeof sp.cursor === 'string' ? sp.cursor : null;
  const { user } = await requireUser({ next: filter === 'all' ? '/wallet' : `/wallet?filter=${filter}` });
  const t = await getTranslations('wallet');

  const balance = await getBalance(user.id);
  const isLedger = filter === 'all' || filter === 'credits' || filter === 'debits';
  const [history, activity, pendingPreview] = await Promise.all([
    isLedger ? getHistory(user.id, cursor, { limit: 20, direction: filter === 'credits' ? 'credit' : filter === 'debits' ? 'debit' : 'all' }) : null,
    !isLedger ? getWalletActivity(user.id, filter === 'pending' ? 'pending' : 'rejected', { limit: 50 }) : null,
    filter === 'all' && !cursor && balance.pendingCount > 0 ? getWalletActivity(user.id, 'pending', { limit: 3 }) : null,
  ]);

  const moreHref = history?.nextCursor
    ? `/wallet?${new URLSearchParams({ ...(filter !== 'all' ? { filter } : {}), cursor: history.nextCursor }).toString()}`
    : null;

  return (
    <div className="pb-16">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/account" />
      <div className="page-container mt-4 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          <BalanceCard
            balanceBaisa={balance.balanceBaisa}
            pendingCount={balance.pendingCount}
            pendingBaisa={balance.pendingTopUpBaisa + balance.pendingGiftCardBaisa}
            frozen={balance.status !== 'ACTIVE'}
          />
          <TrustCard />
        </div>

        <section aria-labelledby="wallet-activity-title" className="min-w-0">
          <SectionHeading id="wallet-activity-title" eyebrow={t('history.eyebrow')} title={t('history.title')} />
          <WalletFilters active={filter} />

          {pendingPreview && pendingPreview.length > 0 ? (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-muted">{t('history.pendingTitle')}</h3>
                <Link href="/wallet?filter=pending" className="text-sm font-semibold text-accent hover:underline">
                  {t('history.seeAllPending')}
                </Link>
              </div>
              <ActivityList items={pendingPreview} />
            </div>
          ) : null}

          <div className="mt-5">
            {history ? (
              history.items.length > 0 ? (
                <LedgerList items={history.items} />
              ) : (
                <EmptyState
                  icon={<WalletIcon size={26} />}
                  title={t('history.empty')}
                  description={t('history.emptyText')}
                  action={
                    <Link href="/wallet/gift-card" className={buttonClasses({ variant: 'secondary' })}>
                      {t('actions.giftCard')}
                    </Link>
                  }
                />
              )
            ) : activity && activity.length > 0 ? (
              <ActivityList items={activity} />
            ) : (
              <EmptyState compact icon={<WalletIcon size={24} />} title={filter === 'pending' ? t('history.emptyPending') : t('history.emptyRejected')} />
            )}
          </div>

          {moreHref ? (
            <div className="mt-5 flex justify-center">
              <Link href={moreHref} scroll={false} className={buttonClasses({ variant: 'outline' })} data-testid="wallet-load-more">
                {t('history.loadMore')}
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
