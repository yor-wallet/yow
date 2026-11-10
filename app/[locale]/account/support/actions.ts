'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { createTicket, replyToTicket, SupportError } from '@/lib/support';
import { fieldErrorsOf, type FieldErrors } from '@/lib/validation';

export type SupportFormState = {
  status: 'idle' | 'error' | 'ok';
  error?: string;
  fieldErrors?: FieldErrors;
  values?: { subject?: string; message?: string; orderNumber?: string };
};

function errorState(err: unknown, values: SupportFormState['values']): SupportFormState {
  if (err instanceof ZodError) return { status: 'error', fieldErrors: fieldErrorsOf(err), values };
  if (err instanceof SupportError) return { status: 'error', error: err.code, values };
  console.error('[support] action failed', err);
  return { status: 'error', error: 'generic', values };
}

export async function createTicketAction(_prev: SupportFormState, fd: FormData): Promise<SupportFormState> {
  const session = await getSession();
  const locale = await getLocale();
  if (!session) redirect({ href: '/login?next=/account/support/new', locale });
  const values = {
    subject: String(fd.get('subject') ?? ''),
    message: String(fd.get('message') ?? ''),
    orderNumber: String(fd.get('orderNumber') ?? ''),
  };
  let number: string;
  try {
    const ticket = await createTicket({ userId: session!.user.id, ...values });
    number = ticket.number;
  } catch (err) {
    return errorState(err, values);
  }
  revalidatePath('/[locale]/account/support', 'layout');
  redirect({ href: `/account/support/${number}`, locale });
  return { status: 'ok' };
}

export async function replyTicketAction(_prev: SupportFormState, fd: FormData): Promise<SupportFormState> {
  const session = await getSession();
  if (!session) return { status: 'error', error: 'generic' };
  const values = { message: String(fd.get('message') ?? '') };
  const number = String(fd.get('number') ?? '').slice(0, 40);
  try {
    await replyToTicket({ userId: session.user.id, number, message: values.message });
  } catch (err) {
    return errorState(err, values);
  }
  revalidatePath(`/[locale]/account/support/${number}`, 'page');
  return { status: 'ok' };
}
