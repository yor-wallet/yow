'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { currentActor, errorState, runAdminAction, type ActionState } from '@/lib/admin/action';
import { removeCampaign, saveCampaign, toggleCampaign } from '@/lib/admin/campaigns';
import { fileToBuffer } from '@/lib/admin/media';
import { nestForm } from '@/lib/admin/zod';
import { text } from '@/lib/admin/form';
import { CAMPAIGNS_TAG } from '@/lib/catalog/cache';

/** Campaign manager actions. RBAC + validation + audit live in lib/admin/campaigns.ts. */

export async function saveCampaignAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await currentActor();
    const raw = nestForm(fd, ['placements', 'productIds']);
    const files = { media: await fileToBuffer(fd.get('media')), mediaMobile: await fileToBuffer(fd.get('mediaMobile')), poster: await fileToBuffer(fd.get('poster')) };
    delete raw.media;
    delete raw.mediaMobile;
    delete raw.poster;
    const isNew = !raw.id;
    const res = await saveCampaign(actor, raw, files);
    revalidateTag(CAMPAIGNS_TAG);
    revalidatePath('/', 'layout');
    return { status: 'success', code: isNew ? 'created' : 'saved', redirectTo: isNew ? `/admin/campaigns/${res.id}` : undefined, at: Date.now() };
  } catch (err) {
    return errorState(err);
  }
}

export async function toggleCampaignAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAdminAction(toggleCampaign, { id: text(fd, 'id'), isActive: text(fd, 'isActive') }, { successCode: 'saved' });
  if (state.status === 'success') revalidateTag(CAMPAIGNS_TAG);
  return state;
}

export async function deleteCampaignAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAdminAction(removeCampaign, { id: text(fd, 'id') }, { successCode: 'deleted', redirectTo: () => '/admin/campaigns' });
  if (state.status === 'success') revalidateTag(CAMPAIGNS_TAG);
  return state;
}
