'use client';

import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Selectable option card (design direction v2): icon at the start, label + small hint,
 * radio dot at the end. Selected = blue border + light blue tint. Use inside an element
 * with `role="radiogroup"`.
 */
export function RadioCard({
  icon: Icon,
  label,
  hint,
  checked,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon?: LucideIcon;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={cn(
        'flex min-h-14 w-full min-w-0 items-center gap-3 rounded-2xl border px-4 py-2.5 text-start transition-[border-color,background-color,box-shadow] duration-(--dur-btn) disabled:opacity-60',
        checked ? 'border-blue bg-blue/8 shadow-[0_0_0_1px_var(--color-blue)] dark:bg-blue/15' : 'border-border bg-surface hover:border-border-strong',
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={20} aria-hidden="true" className={cn('shrink-0', checked ? 'text-accent' : 'text-muted')} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className={cn('grid size-5 shrink-0 place-items-center rounded-full border-2', checked ? 'border-blue' : 'border-border-strong')}
      >
        {checked ? <span className="size-2.5 rounded-full bg-blue" /> : null}
      </span>
    </button>
  );
}
