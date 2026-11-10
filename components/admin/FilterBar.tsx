'use client';

import Form from 'next/form';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { controlClasses } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

export type FilterSelect = { name: string; label: string; value?: string; options: { value: string; label: string }[] };

/**
 * URL-driven filters for server-rendered admin lists (filters live in search params, so Back,
 * reload and shared links keep them). Selects apply immediately; the search box on submit.
 */
export function FilterBar({
  q,
  searchLabel,
  selects = [],
  dates,
  testId = 'filter-bar',
}: {
  q?: string;
  searchLabel?: string;
  selects?: FilterSelect[];
  dates?: { from: string; to: string; fromLabel: string; toLabel: string };
  testId?: string;
}) {
  const t = useTranslations('admin.filters');
  const action = usePathname();
  return (
    <Form action={action} className="mb-4 flex flex-wrap items-end gap-3" data-testid={testId} role="search">
      {searchLabel !== undefined ? (
        <label className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1.5 text-sm font-medium">
          <span>{searchLabel}</span>
          <span className="relative">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" name="q" defaultValue={q ?? ''} className={cn(controlClasses, 'border-border ps-9')} maxLength={120} />
          </span>
        </label>
      ) : null}
      {selects.map((s) => (
        <label key={s.name} className="flex min-w-0 flex-[0_1_12rem] flex-col gap-1.5 text-sm font-medium">
          <span>{s.label}</span>
          <select
            name={s.name}
            defaultValue={s.value ?? ''}
            className={cn(controlClasses, 'border-border')}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            <option value="">{t('all')}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {dates ? (
        <>
          <label className="flex flex-[0_1_10rem] flex-col gap-1.5 text-sm font-medium">
            <span>{dates.fromLabel}</span>
            <input type="date" name="from" defaultValue={dates.from} className={cn(controlClasses, 'border-border')} dir="ltr" />
          </label>
          <label className="flex flex-[0_1_10rem] flex-col gap-1.5 text-sm font-medium">
            <span>{dates.toLabel}</span>
            <input type="date" name="to" defaultValue={dates.to} className={cn(controlClasses, 'border-border')} dir="ltr" />
          </label>
        </>
      ) : null}
      <Button type="submit" variant="outline" data-testid={`${testId}-apply`}>
        {t('apply')}
      </Button>
    </Form>
  );
}
