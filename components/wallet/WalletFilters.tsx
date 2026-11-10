import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

export const WALLET_FILTERS = ['all', 'credits', 'debits', 'pending', 'rejected'] as const;
export type WalletFilter = (typeof WALLET_FILTERS)[number];

export function asWalletFilter(v: unknown): WalletFilter {
  return (WALLET_FILTERS as readonly string[]).includes(String(v)) ? (v as WalletFilter) : 'all';
}

/** Filter chips — state lives in the URL (`?filter=`), so Back/refresh keep it. */
export function WalletFilters({ active }: { active: WalletFilter }) {
  const t = useTranslations('wallet.filters');
  return (
    <nav aria-label={t('label')} data-scroll-x className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {WALLET_FILTERS.map((f) => (
        <Link
          key={f}
          href={f === 'all' ? '/wallet' : `/wallet?filter=${f}`}
          scroll={false}
          aria-current={f === active ? 'page' : undefined}
          data-testid={`wallet-filter-${f}`}
          className={cn(
            'inline-flex min-h-11 shrink-0 items-center rounded-pill border px-4 text-sm font-semibold transition-colors duration-(--dur-btn)',
            f === active ? 'border-transparent bg-gradient-primary text-on-accent shadow-glow-blue' : 'border-border bg-surface/60 text-muted hover:text-fg',
          )}
        >
          {t(f)}
        </Link>
      ))}
    </nav>
  );
}
