import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'primary' | 'secondary';

const variants: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-2 text-fg border border-border',
  info: 'border border-blue/40 bg-blue/12 text-accent',
  success: 'bg-success text-on-accent',
  warning: 'bg-amber text-on-accent',
  error: 'bg-error text-on-accent',
  primary: 'bg-gradient-primary text-on-accent',
  secondary: 'bg-gradient-secondary text-on-accent',
};

export function Badge({ variant = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-pill px-2.5 py-0.5 text-xs font-semibold leading-5',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}

/** Small numeric bubble for icons (cart count, unread notifications). Hidden when 0. */
export function CountBubble({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -top-1 -end-1 inline-flex min-w-5 items-center justify-center rounded-pill bg-gradient-secondary px-1 text-[11px] font-bold leading-5 text-on-accent',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
