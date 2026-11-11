'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { runAdminAction, type ActionState } from '@/lib/admin/action';
import { text } from '@/lib/admin/form';
import { moderateReview } from '@/lib/admin/reviews';
import { CATALOG_TAG } from '@/lib/catalog/cache';

/** Publish / reject a review. RBAC + validation + audit live in lib/admin/reviews.ts. */
export async function moderateReviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAdminAction(moderateReview, { id: text(fd, 'id'), decision: text(fd, 'decision') }, { successCode: 'saved' });
  if (state.status === 'success') {
    revalidateTag(CATALOG_TAG); // home "latest reviews" and product ratings
    revalidatePath('/[locale]/admin/reviews', 'page');
  }
  return state;
}
