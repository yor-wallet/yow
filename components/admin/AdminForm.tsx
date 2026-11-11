'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Checkbox, type InputProps } from '@/components/ui/Input';
import { Select, type SelectProps } from '@/components/ui/Select';
import { Textarea, type TextareaProps } from '@/components/ui/Textarea';
import { Button, type ButtonProps } from '@/components/ui/Button';
import type { ActionState } from '@/lib/admin/action';
import { cn } from '@/lib/cn';
import { useAdminAction } from './useAdminAction';

/**
 * Generic admin form: server action + translated field errors + toast + idempotency key.
 *
 *   <AdminForm action={saveBrandAction} hidden={{ id }} submitLabel={t('save')} testId="brand-form">
 *     <FInput name="name" label={t('name')} defaultValue={brand.name} required />
 *   </AdminForm>
 *
 * Field components (`FInput`, `FSelect`, `FTextarea`, `FCheckbox`, `FLocalized`, `FMoney`) read their
 * error from the form context by `name`. `idempotent` adds a hidden `idempotencyKey` generated once per
 * intent (kept across retries, renewed after a success).
 */

type Ctx = { fieldError: (name: string) => string | undefined; pending: boolean };
const FormCtx = createContext<Ctx>({ fieldError: () => undefined, pending: false });
export const useFormCtx = () => useContext(FormCtx);

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-key`;
}

export function AdminForm({
  action,
  children,
  hidden,
  submitLabel,
  submitVariant = 'primary',
  idempotent,
  testId,
  className,
  onSuccess,
  footer,
  resetOnSuccess,
  encType,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children?: ReactNode;
  hidden?: Record<string, string | number | null | undefined>;
  submitLabel?: string | null;
  submitVariant?: ButtonProps['variant'];
  idempotent?: boolean;
  testId?: string;
  className?: string;
  onSuccess?: (state: ActionState) => void;
  /** Extra buttons next to submit. */
  footer?: ReactNode;
  resetOnSuccess?: boolean;
  encType?: 'multipart/form-data';
}) {
  const [key, setKey] = useState(newKey);
  const [formKey, setFormKey] = useState(0);
  const { formAction, onSubmit, pending, fieldError } = useAdminAction(action, {
    onSuccess: (s) => {
      setKey(newKey());
      if (resetOnSuccess) setFormKey((k) => k + 1);
      onSuccess?.(s);
    },
  });
  return (
    <FormCtx.Provider value={{ fieldError, pending }}>
      <form key={formKey} action={formAction} onSubmit={onSubmit} className={cn('grid min-w-0 grid-cols-1 gap-4', className)} data-testid={testId} encType={encType} noValidate>
        {Object.entries(hidden ?? {}).map(([k, v]) => (v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
        {idempotent ? <input type="hidden" name="idempotencyKey" value={key} /> : null}
        {children}
        {submitLabel !== null || footer ? (
          <div className="flex flex-wrap items-center gap-3">
            {submitLabel !== null ? (
              <Button type="submit" variant={submitVariant} loading={pending} data-testid={testId ? `${testId}-submit` : undefined}>
                {submitLabel}
              </Button>
            ) : null}
            {footer}
          </div>
        ) : null}
      </form>
    </FormCtx.Provider>
  );
}

export function FInput({ name, ...rest }: InputProps & { name: string }) {
  const { fieldError } = useFormCtx();
  return <Input name={name} error={fieldError(name)} {...rest} />;
}

/** OMR amount: decimal keypad, Latin digits, currency suffix. */
export function FMoney({ name, ...rest }: InputProps & { name: string }) {
  const { fieldError } = useFormCtx();
  // The amount is typed left-to-right; in RTL pages it is right-aligned so it never sits under the "OMR" label (inline end).
  return <Input name={name} inputMode="decimal" autoComplete="off" dir="ltr" placeholder="0.000" className="rtl:text-right" error={fieldError(name)} endAdornment={<span className="pe-3 text-xs font-semibold text-muted">OMR</span>} {...rest} />;
}

export function FTextarea({ name, ...rest }: TextareaProps & { name: string }) {
  const { fieldError } = useFormCtx();
  return <Textarea name={name} error={fieldError(name)} {...rest} />;
}

export function FSelect({ name, options, ...rest }: SelectProps & { name: string; options: { value: string; label: string }[] }) {
  const { fieldError } = useFormCtx();
  return (
    <Select name={name} error={fieldError(name)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function FCheckbox({ name, label, defaultChecked, hint }: { name: string; label: ReactNode; defaultChecked?: boolean; hint?: string }) {
  const { fieldError } = useFormCtx();
  return (
    <div>
      <Checkbox name={name} label={label} defaultChecked={defaultChecked} error={fieldError(name)} />
      {hint ? <p className="-mt-1 ms-8 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const LANGS = ['ar', 'en', 'fr'] as const;

/** Three inputs (ar / en / fr) named `<name>.ar` … with the right text direction each. */
export function FLocalized({
  name,
  label,
  defaultValue,
  multiline,
  required,
  maxLength,
}: {
  name: string;
  label: string;
  defaultValue?: Partial<Record<'ar' | 'en' | 'fr', string>> | null;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
}) {
  const t = useTranslations('admin.form.languages');
  const { fieldError } = useFormCtx();
  const groupError = fieldError(name);
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-3 rounded-2xl border border-border p-3 md:grid-cols-3">
      <legend className="px-1 text-sm font-medium">
        {label}
        {required ? <span className="ms-0.5 text-orange" aria-hidden="true">*</span> : null}
      </legend>
      {LANGS.map((l) => {
        const common = {
          name: `${name}.${l}`,
          label: t(l),
          defaultValue: defaultValue?.[l] ?? '',
          dir: l === 'ar' ? ('rtl' as const) : ('ltr' as const),
          lang: l,
          maxLength,
          error: fieldError(`${name}.${l}`) ?? (l === 'en' ? groupError : undefined),
        };
        return multiline ? <Textarea key={l} rows={3} {...common} /> : <Input key={l} {...common} />;
      })}
    </fieldset>
  );
}
