'use client';

import type { ProductStatus } from '@prisma/client';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { Link } from '@/i18n/navigation';
import { ProductStatusBadge } from './ui';
import { useAdminAction } from './useAdminAction';
import { setProductStatusAction } from '@/app/[locale]/admin/products/actions';

/** One small form per transition, so each button posts exactly the status it names. */
function StatusButton({ productId, to, label, variant, disabled, testId }: { productId: string; to: ProductStatus; label: string; variant: 'primary' | 'outline' | 'ghost'; disabled?: boolean; testId: string }) {
  const { formAction } = useAdminAction(setProductStatusAction);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={productId} />
      <input type="hidden" name="status" value={to} />
      <SubmitButton variant={variant} size="sm" disabled={disabled} data-testid={testId}>
        {label}
      </SubmitButton>
    </form>
  );
}

/** Publish / back to draft / archive, plus a link to the live page once published. */
export function ProductStatusBar({ productId, slug, status, activeVariants }: { productId: string; slug: string; status: ProductStatus; activeVariants: number }) {
  const t = useTranslations('admin');
  const canPublish = activeVariants > 0;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-card" data-testid="status-bar" data-status={status}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted">{t('form.statusLabel', { status: t(`products.status.${status}`) })}</span>
        <ProductStatusBadge status={status} />
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {status !== 'ACTIVE' ? <StatusButton productId={productId} to="ACTIVE" label={t('form.publish')} variant="primary" disabled={!canPublish} testId="publish" /> : null}
        {status === 'ACTIVE' ? <StatusButton productId={productId} to="DRAFT" label={t('form.unpublish')} variant="outline" testId="unpublish" /> : null}
        {status === 'ARCHIVED' ? <StatusButton productId={productId} to="DRAFT" label={t('form.unpublish')} variant="outline" testId="unpublish" /> : null}
        {status !== 'ARCHIVED' ? <StatusButton productId={productId} to="ARCHIVED" label={t('form.archive')} variant="ghost" testId="archive" /> : null}
        {status === 'ACTIVE' ? (
          <Link href={`/product/${slug}`} target="_blank" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-accent underline-offset-4 hover:underline" data-testid="view-on-site">
            {t('products.viewOnSite')}
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {status !== 'ACTIVE' && !canPublish ? (
        <p className="basis-full text-sm text-muted" data-testid="needs-variant">
          {t('form.needsVariant')}
        </p>
      ) : null}
    </div>
  );
}
