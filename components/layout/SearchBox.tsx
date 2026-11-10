'use client';

import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { getPathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Product search → `/{locale}/search?q=…`. A real GET form (works without JS),
 * upgraded to client-side navigation.
 */
export function SearchBox({
  className,
  defaultValue = '',
  autoFocus,
  variant = 'default',
}: {
  className?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  /** `pill`: the phone layout — taller rounded field with an icon-only submit button at the start. */
  variant?: 'default' | 'pill';
}) {
  const t = useTranslations('nav.search');
  const locale = useLocale();
  const router = useRouter();
  const [q, setQ] = useState(defaultValue);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  return (
    <form
      role="search"
      action={getPathname({ href: '/search', locale })}
      method="get"
      onSubmit={onSubmit}
      className={cn('relative w-full', className)}
    >
      <label htmlFor={`search-${locale}`} className="sr-only">
        {t('label')}
      </label>
      <input
        id={`search-${locale}`}
        name="q"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={variant === 'pill' ? t('placeholderShort') : t('placeholder')}
        maxLength={120}
        className={cn(
          'block w-full min-w-0 border border-border bg-surface text-base text-fg placeholder:text-muted/80 transition-[border-color,box-shadow] duration-(--dur-btn) focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/35 [&::-webkit-search-cancel-button]:hidden',
          variant === 'pill' ? 'h-13 rounded-2xl ps-16 pe-4 shadow-card' : 'h-11 rounded-xl ps-11 pe-24',
        )}
      />
      {variant === 'pill' ? null : <Search size={18} aria-hidden="true" className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" />}
      <button
        type="submit"
        aria-label={variant === 'pill' ? t('submit') : undefined}
        className={cn(
          'absolute bg-gradient-primary font-semibold text-on-accent transition-transform duration-(--dur-btn) active:scale-[0.98]',
          variant === 'pill' ? 'inset-y-2 start-2 grid w-11 place-items-center rounded-xl' : 'inset-y-1 end-1 rounded-lg px-4 text-sm',
        )}
      >
        {variant === 'pill' ? <Search size={20} aria-hidden="true" /> : t('submit')}
      </button>
    </form>
  );
}
