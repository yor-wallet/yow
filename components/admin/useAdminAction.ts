'use client';

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useToast } from '@/components/ui/Toast';
import type { ActionState } from '@/lib/admin/action';

const IDLE: ActionState = { status: 'idle' };

type LooseT = ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

/** Toast keys under `admin.toast`; anything unknown falls back to `saved`. */
function toastKey(t: LooseT, code: string | undefined): string {
  return code && t.has(`toast.${code}`) ? `toast.${code}` : 'toast.saved';
}

/** Error keys under `admin.errors` (incl. `ext.*` codes of the money / logistics modules); else `generic`. */
function errorKey(t: LooseT, code: string | undefined): string {
  return code && t.has(`errors.${code}`) ? `errors.${code}` : 'errors.generic';
}

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
  const t = useTranslations('admin') as unknown as LooseT;
  const tv = useTranslations('errors') as unknown as LooseT;
  const router = useRouter();
  const { toast } = useToast();
  const [state, formAction, pending] = useActionState(action, IDLE);
  const handled = useRef<number | undefined>(undefined);
  const { onSuccess, refresh = true } = opts;

  useEffect(() => {
    if (state.status === 'idle' || state.at === handled.current) return;
    handled.current = state.at;
    if (state.status === 'success') {
      toast({ title: t(toastKey(t, state.code)), variant: 'success' });
      onSuccess?.(state);
      if (state.redirectTo) router.push(state.redirectTo);
      else if (refresh) router.refresh();
    } else {
      toast({ title: t(errorKey(t, state.code)), variant: 'error' });
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
    if (t.has(`errors.fields.${code}`)) return t(`errors.fields.${code}`);
    if (tv.has(`validation.${code}`)) return tv(`validation.${code}`);
    return t('errors.fields.invalid');
  };

  return { state, formAction, onSubmit, pending, fieldError };
}
