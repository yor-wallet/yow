import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { BackButton } from './BackButton';
import { BackTarget } from './back-target';

/**
 * Header for every secondary page.
 * Mobile/tablet: centred title row (the back arrow lives in the sticky violet band, which reads this
 * page's `fallbackHref` through <BackTarget>). Desktop (lg+): inline title with a text back button.
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
  mobileHeading = 'h1',
}: {
  title: string;
  subtitle?: ReactNode;
  fallbackHref?: string;
  actions?: ReactNode;
  className?: string;
  /** Render only the mobile title row (the page shows its own desktop heading). */
  mobileOnly?: boolean;
  /** `div` when the page body already has its own <h1> (avoids two headings of level 1 on phones). */
  mobileHeading?: 'h1' | 'div';
}) {
  const MobileTitle = mobileHeading;
  return (
    <>
      <BackTarget href={fallbackHref} />
      <div className={cn('page-container lg:hidden', className)} data-testid="page-header-mobile">
        <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span aria-hidden="true" />
          <MobileTitle className="line-clamp-2 min-w-0 text-center text-xl font-extrabold leading-tight">{title}</MobileTitle>
          <div className="flex shrink-0 items-center gap-1 justify-self-end">{actions}</div>
        </div>
        {subtitle ? <p className="mt-1 text-center text-sm text-muted">{subtitle}</p> : null}
      </div>
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
