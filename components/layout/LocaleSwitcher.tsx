'use client';

import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useHistoryModal } from '@/components/ui/useHistoryModal';
import { LOCALE_LABELS, locales, type Locale } from '@/i18n/routing';
import { cn } from '@/lib/cn';

type Props = { variant?: 'menu' | 'inline' | 'sheet'; className?: string };

/**
 * Language switcher keeping the current path and query.
 * `menu` (desktop header popover), `sheet` (mobile: history-backed bottom sheet), `inline` (footer).
 */
export function LocaleSwitcher(props: Props) {
  return (
    <Suspense fallback={<LocaleSwitcherInner {...props} query="" />}>
      <WithQuery {...props} />
    </Suspense>
  );
}

function WithQuery(props: Props) {
  const params = useSearchParams();
  return <LocaleSwitcherInner {...props} query={params.toString()} />;
}

function LocaleSwitcherInner({ variant = 'menu', className, query }: Props & { query: string }) {
  const pathname = usePathname();
  const current = useLocale() as Locale;
  const t = useTranslations('common.locale');
  const href = query ? `${pathname}?${query}` : pathname;

  if (variant === 'inline') {
    return (
      <ul className={cn('flex flex-wrap gap-2', className)} aria-label={t('label')}>
        {locales.map((l) => (
          <li key={l}>
            <Link
              href={href}
              locale={l}
              lang={l}
              hrefLang={l}
              aria-current={l === current ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-xl border px-3.5 text-sm font-medium transition-colors duration-(--dur-btn)',
                l === current ? 'border-cyan/60 text-fg' : 'border-border text-muted hover:border-border-strong hover:text-fg',
              )}
            >
              {LOCALE_LABELS[l]}
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  if (variant === 'sheet') return <LocaleSheet current={current} href={href} className={className} label={t('label')} />;
  return <LocaleMenu current={current} href={href} className={className} label={t('label')} />;
}

function LocaleSheet({ current, href, className, label }: { current: Locale; href: string; className?: string; label: string }) {
  const sheet = useHistoryModal('locale-sheet');
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        onClick={sheet.open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${LOCALE_LABELS[current]}`}
        data-testid="locale-switcher"
        className={cn(
          'inline-flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-fg transition-colors duration-(--dur-btn) hover:bg-surface-2',
          className,
        )}
      >
        <Globe size={18} aria-hidden="true" />
        <span className="uppercase">{current}</span>
      </button>
      <BottomSheet {...sheet.props} title={label}>
        <ul className="grid grid-cols-1 gap-2" data-testid="locale-sheet">
          {locales.map((l) => (
            <li key={l}>
              <Link
                href={href}
                locale={l}
                lang={l}
                hrefLang={l}
                aria-current={l === current ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (l === current) return sheet.close();
                  sheet.closeThen(() => router.replace(href, { locale: l }));
                }}
                className={cn(
                  'flex min-h-13 items-center justify-between rounded-2xl border px-4 text-base font-semibold',
                  l === current ? 'border-cyan/60 bg-surface-2' : 'border-border hover:bg-surface-2',
                )}
              >
                {LOCALE_LABELS[l]}
                {l === current ? <Check size={18} aria-hidden="true" className="text-accent" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}

function LocaleMenu({ current, href, className, label }: { current: Locale; href: string; className?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${label}: ${LOCALE_LABELS[current]}`}
        onClick={() => setOpen((v) => !v)}
        data-testid="locale-switcher"
        className="inline-flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-fg transition-colors duration-(--dur-btn) hover:bg-surface-2"
      >
        <Globe size={18} aria-hidden="true" />
        <span className="uppercase">{current}</span>
      </button>
      {open ? (
        <ul
          id={menuId}
          className="absolute end-0 top-full z-50 mt-2 w-44 animate-fade-in overflow-hidden rounded-2xl border border-border bg-surface p-1 shadow-float"
        >
          {locales.map((l) => (
            <li key={l}>
              <Link
                href={href}
                locale={l}
                lang={l}
                hrefLang={l}
                onClick={() => setOpen(false)}
                aria-current={l === current ? 'true' : undefined}
                className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-sm text-fg hover:bg-surface-2"
              >
                {LOCALE_LABELS[l]}
                {l === current ? <Check size={16} aria-hidden="true" className="text-accent" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
