import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Read-only star rating (1–5). `label` is the already-translated accessible text ("Rated 4 out of 5"). */
export function Stars({ rating, label, size = 16, className }: { rating: number; label: string; size?: number; className?: string }) {
  const full = Math.round(rating);
  return (
    <span role="img" aria-label={label} className={cn('inline-flex gap-0.5 text-amber', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} aria-hidden="true" fill={n <= full ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}
