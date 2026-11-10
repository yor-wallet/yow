'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { useToast } from '@/components/ui/Toast';
import { useValidationMessage } from '@/components/ui/useValidationMessage';
import { createTicketAction, replyTicketAction, type SupportFormState } from '@/app/[locale]/account/support/actions';

const INITIAL: SupportFormState = { status: 'idle' };

function useSupportErrors() {
  const t = useTranslations('account.support.errors');
  const vm = useValidationMessage();
  return (code: string | undefined) => {
    if (!code) return undefined;
    const key = code as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : vm(code);
  };
}

export function NewTicketForm({ orders, defaultOrder }: { orders: { number: string; label: string }[]; defaultOrder?: string }) {
  const t = useTranslations('account.support');
  const err = useSupportErrors();
  const [state, action] = useActionState(createTicketAction, INITIAL);
  const v = state.values;
  return (
    <form action={action} className="grid grid-cols-1 gap-4" data-testid="ticket-form" noValidate>
      <Input
        name="subject"
        label={t('subject')}
        hint={t('subjectHint')}
        required
        maxLength={140}
        defaultValue={v?.subject}
        error={err(state.fieldErrors?.subject?.[0])}
      />
      <Select name="orderNumber" label={t('order')} defaultValue={v?.orderNumber ?? defaultOrder ?? ''}>
        <option value="">{t('orderNone')}</option>
        {orders.map((o) => (
          <option key={o.number} value={o.number}>
            {o.label}
          </option>
        ))}
      </Select>
      <Textarea
        name="message"
        label={t('message')}
        hint={t('messageHint')}
        required
        rows={6}
        maxLength={4000}
        defaultValue={v?.message}
        error={err(state.fieldErrors?.message?.[0])}
      />
      {state.error ? (
        <p role="alert" className="rounded-xl border border-error/40 bg-error/10 px-4 py-3 text-sm font-medium text-error">
          {err(state.error)}
        </p>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton leadingIcon={<Send size={18} aria-hidden="true" className="flip-rtl" />} data-testid="ticket-submit">
          {t('send')}
        </SubmitButton>
      </div>
    </form>
  );
}

export function ReplyForm({ number }: { number: string }) {
  const t = useTranslations('account.support');
  const err = useSupportErrors();
  const { toast } = useToast();
  const [state, action] = useActionState(replyTicketAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === 'ok') {
      formRef.current?.reset();
      toast({ title: t('replySent'), variant: 'success' });
    }
  }, [state, t, toast]);
  return (
    <form ref={formRef} action={action} className="grid grid-cols-1 gap-3" data-testid="ticket-reply-form" noValidate>
      <input type="hidden" name="number" value={number} />
      <Textarea
        name="message"
        label={t('replyLabel')}
        placeholder={t('replyPlaceholder')}
        required
        rows={4}
        maxLength={4000}
        defaultValue={state.status === 'error' ? state.values?.message : undefined}
        error={err(state.fieldErrors?.message?.[0] ?? (state.status === 'error' ? state.error : undefined))}
      />
      <div className="flex justify-end">
        <SubmitButton leadingIcon={<Send size={18} aria-hidden="true" className="flip-rtl" />} data-testid="ticket-reply-submit">
          {t('reply')}
        </SubmitButton>
      </div>
    </form>
  );
}
