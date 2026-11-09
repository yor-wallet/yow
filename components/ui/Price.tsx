import { useLocale, useTranslations } from 'next-intl';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';

type PriceProps = {
  /** Integer baisa. `null`/`undefined` → "Price unavailable" (never invent a price). */
  baisa: number | null | undefined;
  /** Previous price (strike-through) when higher than `baisa`. */
  compareAtBaisa?: number | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSavings?: boolean;
  className?: string;
};

const sizes = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
  xl: 'text-2xl sm:text-3xl',
} as const;

/**
 * Formats a baisa amount for the current locale (Latin digits, 3 decimals, OMR / ر.ع.).
 * Works in server and client components.
 */
export function Price({ baisa, compareAtBaisa, size = 'md', showSavings = false, className }: PriceProps) {
  const locale = useLocale();
  const t = useTranslations('common.price');
  if (baisa === null || baisa === undefined) {
    return (
      <span className={cn('font-medium text-muted', size === 'sm' ? 'text-xs' : 'text-sm', className)} data-price="unavailable">
        {t('unavailable')}
      </span>
    );
  }
  const hasCompare = typeof compareAtBaisa === 'number' && compareAtBaisa > baisa;
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)} data-price={baisa}>
      <span className={cn('font-bold tabular-nums [unicode-bidi:isolate]', sizes[size])}>{formatBaisa(baisa, locale)}</span>
      {hasCompare ? (
        <>
          <span className="sr-only">{t('was', { price: formatBaisa(compareAtBaisa, locale) })}</span>
          <s aria-hidden="true" className="text-sm tabular-nums text-muted [unicode-bidi:isolate]">
            {formatBaisa(compareAtBaisa, locale)}
          </s>
          {showSavings ? (
            <span className="text-xs font-semibold text-success">
              {t('save', { amount: formatBaisa(compareAtBaisa - baisa, locale) })}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}
