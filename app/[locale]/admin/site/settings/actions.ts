'use server';

import { revalidatePath } from 'next/cache';
import { runAdminAction, type ActionState } from '@/lib/admin/action';
import { PAYMENT_SETTING_SECTIONS, savePaymentSettings } from '@/lib/admin/payment-settings';

/** Save one section of the payment settings. RBAC + validation + audit live in lib/admin/payment-settings.ts. */
export async function savePaymentSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const section = String(fd.get('section') ?? '');
  const fields = PAYMENT_SETTING_SECTIONS.find((s) => s.id === section)?.fields ?? [];
  const values: Record<string, string> = {};
  for (const f of fields) {
    // A switch is a checkbox: absent = off. Other fields are always submitted (empty = default).
    values[f.key] = f.control === 'switch' ? (fd.get(f.key) ? '1' : '0') : String(fd.get(f.key) ?? '');
  }
  const state = await runAdminAction(savePaymentSettings, { section, values }, { successCode: 'saved' });
  // Checkout, wallet and top-up pages read these settings.
  if (state.status === 'success') revalidatePath('/', 'layout');
  return state;
}
