'use client';

import { useCallback, type MouseEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { canGoBackInApp } from '@/lib/history';
import { cn } from '@/lib/cn';

/**
 * Safe back navigation: `router.back()` when the previous history entry belongs to
 * this site, otherwise `router.replace(fallbackHref)` — never loops, never leaves the
 * site on a direct open. `fallbackHref` is locale-less (e.g. '/account').
 */
export function useSafeBack(fallbackHref: string) {
  const router = useRouter();
  return useCallback(() => {
    if (canGoBackInApp()) router.back();
    else router.replace(fallbackHref);
  }, [router, fallbackHref]);
}

type BackButtonProps = {
  fallbackHref?: string;
  /** Visible text next to the arrow (desktop). Defaults to "Back". */
  label?: string;
  /** `icon`: 44px icon button (mobile headers); `text`: arrow + label. */
  variant?: 'icon' | 'text';
  /** `onDark`: white arrow for the violet phone band. */
  tone?: 'auto' | 'onDark';
  className?: string;
};

/**
 * Back button. Renders a real link to `fallbackHref` (works without JS) and upgrades
 * to history-aware back on click. The arrow is mirrored in RTL.
 */
export function BackButton({ fallbackHref = '/', label, variant = 'icon', tone = 'auto', className }: BackButtonProps) {
  const t = useTranslations('common.actions');
  const goBack = useSafeBack(fallbackHref);
  const text = label ?? t('back');
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    goBack();
  };
  return (
    <Link
      href={fallbackHref}
      onClick={onClick}
      aria-label={variant === 'icon' ? text : undefined}
      data-testid="back-button"
      className={cn(
        'inline-flex shrink-0 items-center gap-2 rounded-xl transition-colors duration-(--dur-btn)',
        tone === 'onDark' ? 'text-white hover:bg-white/10' : 'text-fg hover:bg-surface-2',
        variant === 'icon' ? 'size-11 justify-center' : 'min-h-11 px-3 text-sm font-semibold',
        className,
      )}
    >
      <ArrowLeft size={20} aria-hidden="true" className="flip-rtl" />
      {variant === 'text' ? <span>{text}</span> : null}
    </Link>
  );
}
