import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold ' +
  'transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-(--dur-btn) ease-snappy ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55';

const variants: Record<ButtonVariant, string> = {
  // Dark ink on the gradients keeps AA contrast across the whole gradient.
  primary: 'sheen bg-gradient-primary text-on-accent shadow-glow-blue hover:-translate-y-px hover:shadow-glow-cyan',
  accent: 'sheen bg-gradient-secondary text-on-accent shadow-glow-orange hover:-translate-y-px hover:brightness-105',
  secondary: 'gradient-border holo-border-hover text-fg hover:shadow-glow-blue',
  outline: 'border border-border-strong bg-transparent text-fg hover:bg-surface-2',
  ghost: 'bg-transparent text-fg hover:bg-surface-2',
  danger: 'bg-error text-on-accent hover:brightness-110',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-4 text-sm',
  md: 'min-h-11 px-5 text-[15px]',
  lg: 'min-h-13 px-7 text-base',
  icon: 'size-11 p-0',
};

export type ButtonStyleProps = { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string };

/** Class names for button-styled elements (e.g. `<Link className={buttonClasses({variant:'primary'})}>`). */
export function buttonClasses({ variant = 'primary', size = 'md', fullWidth, className }: ButtonStyleProps = {}): string {
  return cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonStyleProps & {
    loading?: boolean;
    /** Accessible label announced while loading (defaults to children). */
    loadingLabel?: string;
    leadingIcon?: ReactNode;
    trailingIcon?: ReactNode;
  };

/**
 * Button (min 44px touch target). Variants: primary (blue→cyan), accent (orange→amber),
 * secondary (gradient border), outline, ghost, danger. `loading` disables and shows a spinner
 * while keeping the width stable.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, fullWidth, className, loading = false, loadingLabel, leadingIcon, trailingIcon, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </span>
      {loading ? (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner label={loadingLabel ?? (typeof children === 'string' ? children : undefined)} />
        </span>
      ) : null}
    </button>
  );
});
