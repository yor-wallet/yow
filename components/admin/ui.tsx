import type { ReactNode } from 'react';
import type { OrderStatus, ProductStatus } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/layout/BackButton';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { withParams, type SearchParams } from '@/lib/admin/table';
import { cn } from '@/lib/cn';

/** Small, server-friendly building blocks shared by every admin page. */

/** Page title with a visible Back button on secondary pages (`backHref` = where Back goes with no history). */
export function AdminPageHeader({ title, subtitle, actions, backHref }: { title: string; subtitle?: ReactNode; actions?: ReactNode; backHref?: string }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {backHref ? <BackButton fallbackHref={backHref} variant="text" className="-ms-3 mb-1" /> : null}
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl" data-testid="admin-title">
          {title}
        </h1>
        {subtitle ? <p className="mt-1 max-w-prose text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn('rounded-card border border-border bg-surface p-4 shadow-card sm:p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-lg font-bold">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint, testId, href }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string; href?: string }) {
  const body = (
    <>
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums [unicode-bidi:isolate] sm:text-3xl" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </>
  );
  const cls = 'block rounded-card border border-border bg-surface p-4 shadow-card';
  return href ? (
    <Link href={href} className={cn(cls, 'transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring')} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

const PRODUCT_BADGE: Record<ProductStatus, BadgeVariant> = { DRAFT: 'neutral', ACTIVE: 'success', ARCHIVED: 'warning' };
const ORDER_BADGE: Record<OrderStatus, BadgeVariant> = {
  PENDING_PAYMENT: 'warning',
  PAID: 'info',
  PROCESSING: 'info',
  PACKED: 'info',
  SHIPPED: 'info',
  OUT_FOR_DELIVERY: 'primary',
  DELIVERED: 'success',
  CANCELLED: 'error',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'neutral',
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const t = useTranslations('admin.products.status');
  return <Badge variant={PRODUCT_BADGE[status]}>{t(status)}</Badge>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('orders.status');
  return <Badge variant={ORDER_BADGE[status]}>{t(status)}</Badge>;
}

/** Previous / next links for a server-rendered list; filters stay in the URL. */
export function Pagination({ page, pageSize, total, basePath, sp }: { page: number; pageSize: number; total: number; basePath: string; sp: SearchParams }) {
  const t = useTranslations('admin.pagination');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => `${basePath}${withParams(sp, { page: p <= 1 ? undefined : p })}`;
  const pill = 'inline-flex min-h-11 items-center rounded-xl border border-border-strong px-4 text-sm font-semibold';
  return (
    <nav aria-label={t('label')} className="mt-4 flex items-center justify-between gap-3" data-testid="pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className={cn(pill, 'hover:bg-surface-2')} rel="prev">
          {t('previous')}
        </Link>
      ) : (
        <span className={cn(pill, 'opacity-50')} aria-disabled="true">
          {t('previous')}
        </span>
      )}
      <span className="text-sm text-muted tabular-nums">{t('page', { page, pages })}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className={cn(pill, 'hover:bg-surface-2')} rel="next">
          {t('next')}
        </Link>
      ) : (
        <span className={cn(pill, 'opacity-50')} aria-disabled="true">
          {t('next')}
        </span>
      )}
    </nav>
  );
}
