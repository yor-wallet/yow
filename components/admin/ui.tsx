import type { ReactNode } from 'react';
import type { OrderStatus, ProductStatus } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/layout/BackButton';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { HudCorners } from '@/components/ui/HudCorners';
import { Link } from '@/i18n/navigation';
import { withParams, type SearchParams } from '@/lib/admin/table';
import { cn } from '@/lib/cn';

/** Small, server-friendly building blocks shared by every admin page. */

/** Page title with a visible Back button on secondary pages (`backHref` = where Back goes with no history). */
export function AdminPageHeader({
  title,
  subtitle,
  actions,
  backHref,
  eyebrow,
  crumbs,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  /** HUD label above the title (section name). */
  eyebrow?: string;
  /** Breadcrumbs (last one = current page, no href). */
  crumbs?: { label: string; href?: string }[];
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {backHref ? <BackButton fallbackHref={backHref} variant="text" className="-ms-3 mb-1" /> : null}
        {crumbs?.length ? <Breadcrumbs items={crumbs} /> : null}
        {eyebrow ? <span className="hud-label mb-2 flex">{eyebrow}</span> : null}
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl" data-testid="admin-title">
          {title}
        </h1>
        <span aria-hidden="true" className="circuit-rule mt-2 block max-w-xs" />
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
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn('glass relative min-w-0 rounded-card p-4 shadow-card sm:p-5', className)}>
      <HudCorners className="text-cyan/40" size={12} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-lg font-bold">
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

export function StatCard({
  label,
  value,
  hint,
  testId,
  href,
  tone = 'cyan',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
  href?: string;
  tone?: 'cyan' | 'orange' | 'success' | 'error';
}) {
  const tones = { cyan: 'text-cyan', orange: 'text-amber', success: 'text-success', error: 'text-error' } as const;
  const body = (
    <>
      <HudCorners className="text-cyan/50" size={10} />
      <p className="hud-label text-[11px]">{label}</p>
      <p className={cn('neon font-display mt-2 text-2xl font-extrabold tabular-nums [unicode-bidi:isolate] sm:text-3xl', tones[tone])} data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </>
  );
  const cls = 'holo-border relative block min-w-0 rounded-card p-4 shadow-card';
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

/** Breadcrumb trail (locale-less hrefs); the last item is the current page. */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? <span aria-hidden="true" className="flip-rtl text-border-strong">/</span> : null}
            {c.href && i < items.length - 1 ? (
              <Link href={c.href} className="hover:text-fg">
                {c.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined} className={i === items.length - 1 ? 'text-fg' : undefined}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const TONE_BADGE: Record<string, BadgeVariant> = {
  // generic statuses → badge colours
  ACTIVE: 'success', VERIFIED: 'success', SUCCEEDED: 'success', COMPLETED: 'success', DELIVERED: 'success', APPROVED: 'success', PAID: 'success', RESOLVED: 'success', APPLIED: 'success', ACCEPTED: 'success',
  PENDING: 'warning', SUBMITTED: 'warning', UNDER_REVIEW: 'info', REQUIRES_ACTION: 'warning', CREATED: 'neutral', OPEN: 'warning', IN_PROGRESS: 'info', WAITING_CUSTOMER: 'neutral', REQUESTED: 'warning', PROCESSING: 'info', DOCUMENTS_REQUESTED: 'warning', RUNNING: 'info',
  FAILED: 'error', REJECTED: 'error', CANCELLED: 'neutral', EXPIRED: 'neutral', OVERDUE: 'error', DEFAULTED: 'error', CLOSED: 'neutral', FROZEN: 'warning', UNVERIFIED: 'neutral',
  CRITICAL: 'error', HIGH: 'secondary', MEDIUM: 'warning', LOW: 'info', INFO: 'neutral', URGENT: 'error', NORMAL: 'neutral',
  CONFIRMED: 'info', PREPARING: 'info', PACKED: 'info', COURIER_ASSIGNED: 'info', OUT_FOR_DELIVERY: 'primary',
};

/** Badge for any enum status; `label` is the translated text. */
export function StatusBadge({ status, label, testId }: { status: string; label: string; testId?: string }) {
  return (
    <Badge variant={TONE_BADGE[status] ?? 'neutral'} data-testid={testId}>
      {label}
    </Badge>
  );
}

/** Definition list of label/value pairs (detail pages). */
export function KeyValues({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-3 text-sm sm:grid-cols-2', className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words font-medium">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Empty list message inside a table/section. */
export function EmptyRow({ text, testId }: { text: string; testId?: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-muted" data-testid={testId}>
      {text}
    </p>
  );
}
