'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { removeCompareAction } from '@/app/[locale]/(shop)/actions';

/** Remove one product from the comparison (`productId`), or clear it (`null`). */
export function CompareRemove({ productId, label, variant }: { productId: string | null; label: string; variant: 'icon' | 'text' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={variant === 'icon' ? label : undefined}
      data-testid={productId ? 'compare-remove' : 'compare-clear'}
      onClick={() =>
        start(async () => {
          await removeCompareAction(productId);
          router.refresh();
        })
      }
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
        variant === 'icon' ? 'size-11' : 'min-w-11 px-3',
      )}
    >
      <Trash2 size={18} aria-hidden="true" />
      {variant === 'text' ? <span className="max-sm:sr-only">{label}</span> : null}
    </button>
  );
}
