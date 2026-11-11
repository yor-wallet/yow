'use server';

import { revalidatePath } from 'next/cache';
import { runAdminAction, type ActionState } from '@/lib/admin/action';
import { flag, text } from '@/lib/admin/form';
import { updateZone } from '@/lib/admin/zones';

/** Save a zone's rates. RBAC + validation + audit live in lib/admin/zones.ts. */
export async function updateZoneAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAdminAction(
    updateZone,
    {
      id: text(fd, 'id'),
      isActive: flag(fd, 'isActive'),
      standardFeeBaisa: text(fd, 'standardFeeBaisa'),
      standardHours: text(fd, 'standardHours'),
      freeStandardFromBaisa: text(fd, 'freeStandardFromBaisa'),
      dailyCapacityStandard: text(fd, 'dailyCapacityStandard'),
      expressAvailable: flag(fd, 'expressAvailable'),
      expressFeeBaisa: text(fd, 'expressFeeBaisa'),
      expressHours: text(fd, 'expressHours'),
      dailyCapacityExpress: text(fd, 'dailyCapacityExpress'),
      perKgBaisa: text(fd, 'perKgBaisa'),
      perLitreBaisa: text(fd, 'perLitreBaisa'),
    },
    { successCode: 'saved' },
  );
  // Delivery promises appear on the home page, product pages, the cart and /delivery.
  if (state.status === 'success') revalidatePath('/', 'layout');
  return state;
}
