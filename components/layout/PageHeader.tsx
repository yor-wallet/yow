import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { BackButton } from './BackButton';

/**
 * Header for every secondary page: back arrow (mirrored in RTL) + title.
 * Mobile/tablet: sticky glass bar at the top. Desktop (lg+): inline title with a text back button.
 * Renders siblings (a fragment) so the sticky bar sticks for the whole page: place it as
 * a DIRECT child of the page's top-level element.
 *
 *   <PageHeader title={t('title')} fallbackHref="/account" />
 */
export function PageHeader({
  title,
  subtitle,
  fallbackHref = '/',
  actions,
  className,
  mobileOnly = false,
}: {
  title: string;
  subtitle?: ReactNode;
  fallbackHref?: string;
  actions?: ReactNode;
  className?: string;
  /** Render only the mobile sticky bar (the page shows its own desktop heading). */
  mobileOnly?: boolean;
}) {
  return (
    <>
      <div
        className={cn('sticky top-0 z-30 border-b border-border lg:hidden', className)}
        style={{ paddingTop: 'var(--safe-top)', background: 'var(--doom-header)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        data-testid="page-header-mobile"
      >
        <div className="flex min-h-14 items-center gap-1 ps-[max(8px,var(--safe-left))] pe-[max(8px,var(--safe-right))]">
          <BackButton fallbackHref={fallbackHref} variant="icon" />
          <h1 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h1>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      </div>
      {subtitle ? <p className="page-container mt-3 text-sm text-muted lg:hidden">{subtitle}</p> : null}
      {mobileOnly ? null : (
      <div className={cn('page-container hidden items-end justify-between gap-4 pt-8 lg:flex', className)}>
        <div className="min-w-0">
          <BackButton fallbackHref={fallbackHref} variant="text" className="-ms-3 mb-2" />
          <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      )}
    </>
  );
}
