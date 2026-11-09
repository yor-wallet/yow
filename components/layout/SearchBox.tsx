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
export function SearchBox({ className, defaultValue = '', autoFocus }: { className?: string; defaultValue?: string; autoFocus?: boolean }) {
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
        placeholder={t('placeholder')}
        maxLength={120}
        className="block h-11 w-full min-w-0 rounded-xl border border-border bg-surface ps-11 pe-24 text-base text-fg placeholder:text-muted/80 transition-[border-color,box-shadow] duration-(--dur-btn) focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/35 [&::-webkit-search-cancel-button]:hidden"
      />
      <Search size={18} aria-hidden="true" className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <button
        type="submit"
        className="absolute inset-y-1 end-1 rounded-lg bg-gradient-primary px-4 text-sm font-semibold text-on-accent transition-transform duration-(--dur-btn) active:scale-[0.98]"
      >
        {t('submit')}
      </button>
    </form>
  );
}
