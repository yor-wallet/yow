'use client';

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Eye, EyeOff, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Form controls: Input, PasswordInput, Select, Textarea.
 * - font-size ≥ 16px (no iOS zoom), min height 44px
 * - label + hint + error wired with aria-describedby / aria-invalid
 * - logical properties only (RTL-safe)
 * `error` is an already-translated message.
 */

type FieldShellProps = {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

export function FieldShell({ id, label, hint, error, required, className, children }: FieldShellProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
          {required ? (
            <span aria-hidden="true" className="ms-0.5 text-orange">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const controlClasses =
  'block w-full min-w-0 min-h-11 rounded-xl border bg-surface px-3.5 py-2.5 text-base text-fg ' +
  'placeholder:text-muted/70 shadow-[inset_0_1px_0_rgb(255_255_255/0.03)] ' +
  'transition-[border-color,box-shadow] duration-(--dur-btn) ' +
  'focus:border-cyan focus:outline-none focus:shadow-[0_0_0_3px_rgb(0_217_255/0.18),0_0_22px_-6px_rgb(0_217_255/0.65)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

function describedBy(id: string, error?: ReactNode, hint?: ReactNode) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

type CommonProps = { label?: ReactNode; hint?: ReactNode; error?: ReactNode; containerClassName?: string };

export type InputProps = InputHTMLAttributes<HTMLInputElement> & CommonProps & { endAdornment?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { id, label, hint, error, containerClassName, className, required, endAdornment, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, error, hint)}
          className={cn(controlClasses, error ? 'border-error' : 'border-border', endAdornment ? 'pe-12' : null, className)}
          {...rest}
        />
        {endAdornment ? <div className="absolute inset-y-0 end-0 flex items-center pe-1">{endAdornment}</div> : null}
      </div>
    </FieldShell>
  );
});

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'endAdornment'> & { showLabel: string; hideLabel: string }>(
  function PasswordInput({ showLabel, hideLabel, ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        spellCheck={false}
        {...rest}
        endAdornment={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? hideLabel : showLabel}
            aria-pressed={visible}
            className="grid size-10 place-items-center rounded-lg text-muted hover:text-fg"
          >
            {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        }
      />
    );
  },
);

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & CommonProps & { placeholder?: string };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, hint, error, containerClassName, className, required, children, placeholder, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, error, hint)}
          className={cn(controlClasses, 'appearance-none pe-10', error ? 'border-error' : 'border-border', className)}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {children}
        </select>
        <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>
    </FieldShell>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & CommonProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { id, label, hint, error, containerClassName, className, required, rows = 4, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, error, hint)}
        className={cn(controlClasses, 'resize-y', error ? 'border-error' : 'border-border', className)}
        {...rest}
      />
    </FieldShell>
  );
});

/** Checkbox with label (44px row). */
export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; error?: ReactNode }>(
  function Checkbox({ id, label, error, className, ...rest }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <label htmlFor={fieldId} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-fg">
          <input
            ref={ref}
            id={fieldId}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-blue"
            {...rest}
          />
          <span>{label}</span>
        </label>
        {error ? (
          <p id={`${fieldId}-error`} role="alert" className="text-sm font-medium text-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
