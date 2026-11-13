import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'primary' | 'secondary';

// Status colours of the specification: text + tinted ground (success #137047 on #E7F6ED, warning
// #805000 on #FFF3CB, error #B42318 on #FDECEA); each badge also carries text, never colour alone.
const variants: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-2 text-fg border border-border',
  info: 'border border-border-strong bg-surface-2 text-fg',
  success: 'border border-success/30 bg-[var(--doom-success-bg)] text-success',
  warning: 'border border-amber/30 bg-[var(--doom-warning-bg)] text-amber',
  error: 'border border-error/30 bg-[var(--doom-error-bg)] text-error',
  primary: 'border border-night/80 bg-yellow text-on-accent',
  secondary: 'border border-night/80 bg-yellow text-on-accent',
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
      key={count}
      aria-hidden="true"
      className={cn(
        'animate-pop absolute -top-1 -end-1 inline-flex min-w-5 items-center justify-center rounded-pill bg-gradient-secondary px-1 text-[11px] font-bold leading-5 text-on-accent',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
