import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Shimmer placeholder. Always give it the final element's dimensions to avoid layout shift. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('skeleton rounded-xl', className)} {...rest} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cn('skeleton h-3.5 rounded-md', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
