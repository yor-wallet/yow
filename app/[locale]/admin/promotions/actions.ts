'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { currentActor, errorState, runAdminAction, type ActionState } from '@/lib/admin/action';
import { deletePromotion, savePromotion, togglePromotion } from '@/lib/admin/promotions';
import { nestForm } from '@/lib/admin/zod';
import { text } from '@/lib/admin/form';
import { CATALOG_TAG, PROMOTIONS_TAG } from '@/lib/catalog/cache';

/** Promotion manager actions. RBAC, validation and audit live in lib/admin/promotions.ts. */

/** Offers and the product cards that show their badge are cached: refresh both at once. */
function refresh() {
  revalidateTag(PROMOTIONS_TAG);
  revalidateTag(CATALOG_TAG);
  revalidatePath('/', 'layout');
}

export async function savePromotionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await currentActor();
    const raw = nestForm(fd, ['categoryIds', 'brandIds', 'productIds']);
    const isNew = !raw.id;
    const res = await savePromotion(actor, raw);
    refresh();
    return { status: 'success', code: isNew ? 'created' : 'saved', redirectTo: isNew ? `/admin/promotions/${res.id}` : undefined, at: Date.now() };
  } catch (err) {
    return errorState(err);
  }
}

export async function togglePromotionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAdminAction(togglePromotion, { id: text(fd, 'id'), isActive: text(fd, 'isActive') }, { successCode: 'saved' });
  if (state.status === 'success') refresh();
  return state;
}

export async function deletePromotionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAdminAction(deletePromotion, { id: text(fd, 'id') }, { successCode: 'deleted' });
  if (state.status !== 'success') return state;
  refresh();
  // Leave the page of the promotion that no longer exists in the same response (a client-side redirect
  // would lose the race against the refreshed page, which is now a 404).
  redirect(`/${await getLocale()}/admin/promotions`);
}
