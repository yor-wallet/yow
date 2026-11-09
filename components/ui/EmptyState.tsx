import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Elegant empty state (used instead of ever showing fake products/data). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-card border border-dashed border-border-strong bg-surface/40 text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-10 sm:py-14',
        className,
      )}
    >
      {icon ? (
        <div className="grid size-14 place-items-center rounded-2xl bg-gradient-premium text-cyan shadow-glow-blue" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-bold text-fg">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
