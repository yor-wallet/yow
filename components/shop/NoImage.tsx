import { ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * "Image not available" (owner's specification §4): shown wherever a product, or the colour bought,
 * has no photo yet. No drawing and no photo of another colour stands in for it. Fills its parent.
 *   - `md`: icon and label (cards, compare table);
 *   - `sm`: icon only, the label stays available as a tooltip and to assistive technology (thumbnails).
 * Works in server and client components.
 */
export function NoImage({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const t = useTranslations('common');
  const label = t('noImage');
  return (
    <span role="img" aria-label={label} title={label} data-testid="no-image" className={cn('grid size-full place-items-center bg-surface-2 text-muted', className)}>
      <span className="flex flex-col items-center gap-1.5 px-2 text-center">
        <ImageOff size={size === 'sm' ? 20 : 28} aria-hidden="true" />
        {size === 'md' ? <span className="text-xs font-medium">{label}</span> : null}
      </span>
    </span>
  );
}
