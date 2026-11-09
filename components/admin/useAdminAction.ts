'use client';

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useToast } from '@/components/ui/Toast';
import type { ActionState } from '@/lib/admin/action';

const IDLE: ActionState = { status: 'idle' };

/** Field error codes with a translation under `admin.errors.fields`; anything else is shown as "invalid". */
const FIELD_CODES = [
  'required',
  'too_long',
  'invalid',
  'sku_invalid',
  'sku_taken',
  'slug_invalid',
  'slug_taken',
  'amount_invalid',
  'amount_too_large',
  'compare_not_higher',
  'below_reserved',
  'color_invalid',
  'bad_type',
  'empty',
  'too_large',
  'bad_image',
] as const;
type FieldCode = (typeof FIELD_CODES)[number];

/** Codes with a message under `admin.errors` (the rest fall back to `generic`). */
const ERROR_CODES = ['forbidden', 'not_found', 'validation', 'constraint', 'generic', 'idempotency', 'duplicate', 'in_progress', 'product_needs_variant', 'variant_in_use'] as const;
type ErrorCode = (typeof ERROR_CODES)[number];
const TOAST_CODES = ['saved', 'created', 'deleted', 'uploaded', 'statusChanged'] as const;
type ToastCode = (typeof TOAST_CODES)[number];

/**
 * Wires a server action (`(prev, formData) => ActionState`) to a form: pending flag, a toast for the outcome,
 * translated field errors, and a client redirect / refresh after success.
 *
 *   const { formAction, onSubmit, pending, fieldError } = useAdminAction(saveVariantAction, { onSuccess: () => … });
 *   <form action={formAction} onSubmit={onSubmit}> … <Input error={fieldError('sku')} /> …
 *
 * React 19 resets the fields of a `<form action>` once the action ends, which would wipe what a person typed
 * after a validation error. `onSubmit` therefore sends the data itself (inside a transition) and prevents the
 * default submission: the fields keep their values, and `action` still covers a submit before hydration.
 */
export function useAdminAction(
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>,
  opts: { onSuccess?: (state: ActionState) => void; refresh?: boolean } = {},
) {
  const t = useTranslations('admin');
  const router = useRouter();
  const { toast } = useToast();
  const [state, formAction, pending] = useActionState(action, IDLE);
  const handled = useRef<number | undefined>(undefined);
  const { onSuccess, refresh = true } = opts;

  useEffect(() => {
    if (state.status === 'idle' || state.at === handled.current) return;
    handled.current = state.at;
    if (state.status === 'success') {
      const code = (TOAST_CODES as readonly string[]).includes(state.code ?? '') ? (state.code as ToastCode) : 'saved';
      toast({ title: t(`toast.${code}`), variant: 'success' });
      onSuccess?.(state);
      if (state.redirectTo) router.push(state.redirectTo);
      else if (refresh) router.refresh();
    } else {
      const code = (ERROR_CODES as readonly string[]).includes(state.code ?? '') ? (state.code as ErrorCode) : 'generic';
      toast({ title: t(`errors.${code}`), variant: 'error' });
    }
  }, [state, t, toast, router, onSuccess, refresh]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };

  /** The first translated error for `name` (or its nested paths, e.g. `specs.0.label`), if any. */
  const fieldError = (name: string): string | undefined => {
    const errors = state.status === 'error' ? state.fieldErrors : undefined;
    if (!errors) return undefined;
    const key = Object.keys(errors).find((k) => k === name || k.startsWith(`${name}.`));
    const code = key ? errors[key]?.[0] : undefined;
    if (!code) return undefined;
    return t(`errors.fields.${(FIELD_CODES as readonly string[]).includes(code) ? (code as FieldCode) : 'invalid'}`);
  };

  return { state, formAction, onSubmit, pending, fieldError };
}
