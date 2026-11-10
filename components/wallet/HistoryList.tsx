import { ArrowDownLeft, ArrowUpRight, ChevronRight, CreditCard, Gift, Layers, RotateCcw, ShoppingBag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';
import type { ActivityItem, HistoryItem } from '@/lib/wallet';
import { StatusBadge, displayStatus } from './StatusBadge';

const TYPE_ICON: Record<string, LucideIcon> = {
  TOPUP: ArrowDownLeft,
  GIFT_CARD_CREDIT: Gift,
  ORDER_PAYMENT: ShoppingBag,
  FLEX_DISBURSEMENT: Layers,
  INSTALLMENT_PAYMENT: Layers,
  REFUND: RotateCcw,
  ADJUSTMENT: ArrowUpRight,
  REVERSAL: RotateCcw,
};

const rowClasses =
  'group flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface/70 p-3 backdrop-blur transition-[border-color,box-shadow,transform] duration-(--dur-card) hover:-translate-y-px hover:border-border-strong hover:shadow-glow-blue sm:gap-4 sm:p-4';

function Icon({ icon: I, tone }: { icon: LucideIcon; tone: 'credit' | 'debit' | 'pending' | 'rejected' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-xl border',
        tone === 'credit' && 'border-success/40 bg-success/10 text-success',
        tone === 'debit' && 'border-blue/40 bg-blue/10 text-accent',
        tone === 'pending' && 'border-amber/40 bg-amber/10 text-amber',
        tone === 'rejected' && 'border-error/40 bg-error/10 text-error',
      )}
    >
      <I size={20} />
    </span>
  );
}

/** Confirmed ledger movements of the wallet. */
export function LedgerList({ items }: { items: HistoryItem[] }) {
  const t = useTranslations('wallet');
  const tp = useTranslations('payments');
  const locale = useLocale();
  const format = useFormatter();
  return (
    <ul className="grid grid-cols-1 gap-2.5" data-testid="wallet-history">
      {items.map((item) => {
        const credit = item.amountBaisa > 0;
        const method = item.provider ? tp(`methods.${item.provider as 'CARD'}.label`) : null;
        return (
          <li key={item.entryId}>
            <Link href={`/wallet/tx/${item.transactionId}`} className={rowClasses} data-testid="wallet-history-item" data-type={item.type}>
              <Icon icon={TYPE_ICON[item.type] ?? CreditCard} tone={credit ? 'credit' : 'debit'} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-semibold">{t(`types.${item.type}`)}</span>
                  <StatusBadge status="confirmed" />
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {format.dateTime(item.createdAt, 'long')}
                  {method ? ` · ${method}` : ''}
                  {item.orderNumber ? ` · ${t('item.order', { number: item.orderNumber })}` : ''}
                </span>
              </span>
              <span
                className={cn('shrink-0 font-display text-base font-bold tabular-nums [unicode-bidi:isolate] sm:text-lg', credit ? 'text-success' : 'text-fg')}
                data-baisa={item.amountBaisa}
              >
                {formatBaisa(item.amountBaisa, locale, { signed: true })}
              </span>
              <ChevronRight size={18} aria-hidden="true" className="flip-rtl hidden shrink-0 text-muted sm:block" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Pending / rejected top-ups and gift cards (not yet — or never — credited). */
export function ActivityList({ items }: { items: ActivityItem[] }) {
  const t = useTranslations('wallet');
  const tp = useTranslations('payments');
  const locale = useLocale();
  const format = useFormatter();
  return (
    <ul className="grid grid-cols-1 gap-2.5" data-testid="wallet-activity">
      {items.map((item) => {
        const status = displayStatus(item.rawStatus);
        const tone = item.status === 'rejected' ? 'rejected' : 'pending';
        if (item.kind === 'topup') {
          return (
            <li key={item.id}>
              <Link href={`/pay/${item.id}`} className={rowClasses} data-testid="wallet-activity-item" data-kind="topup">
                <Icon icon={ArrowDownLeft} tone={tone} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-semibold">{t('item.topupVia', { method: tp(`methods.${item.provider as 'CARD'}.label`) })}</span>
                    <StatusBadge status={status} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{format.dateTime(item.createdAt, 'long')}</span>
                </span>
                <span className="shrink-0 font-display text-base font-bold tabular-nums text-muted [unicode-bidi:isolate] sm:text-lg">
                  {formatBaisa(item.amountBaisa, locale)}
                </span>
              </Link>
            </li>
          );
        }
        const digits = item.declaredCurrency === 'OMR' ? 3 : 2;
        const value = (item.declaredValue / 10 ** digits).toFixed(digits);
        return (
          <li key={item.id}>
            <div className={rowClasses} data-testid="wallet-activity-item" data-kind="giftcard" data-status={item.rawStatus}>
              <Icon icon={Gift} tone={tone} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-semibold">
                    {t('item.giftCard', { brand: t(`giftCard.brands.${item.brand as 'APPLE'}`), last4: item.codeLast4 ?? '····' })}
                  </span>
                  <StatusBadge status={status} />
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {format.dateTime(item.createdAt, 'long')} · {t('item.declared', { value, currency: item.declaredCurrency })}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
