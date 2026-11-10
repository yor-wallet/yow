import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export type Crumb = { label: string; href?: string };

/** Breadcrumb trail (the last item is the current page). Arrows are mirrored in RTL. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  const t = useTranslations('catalog.category');
  return (
    <nav aria-label={t('breadcrumb')} className="page-container pt-4 max-lg:hidden">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={last ? 'hidden min-w-0 items-center gap-1 lg:flex' : 'flex min-w-0 items-center gap-1'}>
              {c.href && !last ? (
                <Link href={c.href} className="inline-flex min-h-11 items-center truncate underline-offset-4 hover:text-fg hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="truncate font-medium text-fg">
                  {c.label}
                </span>
              )}
              {!last ? <ChevronRight size={14} aria-hidden="true" className="shrink-0 flip-rtl" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
