'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentActor, errorState, type ActionState } from '@/lib/admin/action';
import { ForbiddenError, ValidationError } from '@/lib/admin/actor';
import { text } from '@/lib/admin/form';
import { assignCourier, transitionShipment } from '@/lib/delivery/shipments';
import { idSchema } from '@/lib/validation';

/**
 * Order fulfilment from the admin order page. The rules (allowed steps, who may act, audit,
 * customer notifications, order status mirroring) live in lib/delivery/shipments.ts; these
 * actions only validate the form and report the outcome.
 */

const STEPS = ['PREPARING', 'PACKED', 'FAILED'] as const;
const stepSchema = z.object({ shipmentId: idSchema, to: z.enum(STEPS), note: z.string().trim().max(300).optional() });
const assignSchema = z.object({ shipmentId: idSchema, courierId: idSchema });

function done(): ActionState {
  revalidatePath('/', 'layout');
  return { status: 'success', code: 'statusChanged', at: Date.now() };
}

export async function shipmentStepAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await currentActor();
    if (!actor) throw new ForbiddenError('delivery:write');
    const input = stepSchema.safeParse({ shipmentId: text(fd, 'shipmentId'), to: text(fd, 'to'), note: text(fd, 'note') });
    if (!input.success) throw new ValidationError({ note: ['invalid'] });
    if (input.data.to === 'FAILED' && !input.data.note) throw new ValidationError({ note: ['required'] });
    await transitionShipment({ shipmentId: input.data.shipmentId, to: input.data.to, actor, note: input.data.note ?? null });
    return done();
  } catch (err) {
    return errorState(err);
  }
}

export async function assignCourierAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await currentActor();
    if (!actor) throw new ForbiddenError('delivery:write');
    const input = assignSchema.safeParse({ shipmentId: text(fd, 'shipmentId'), courierId: text(fd, 'courierId') });
    if (!input.success) throw new ValidationError({ courierId: ['required'] });
    await assignCourier({ shipmentId: input.data.shipmentId, courierId: input.data.courierId, actor });
    return done();
  } catch (err) {
    return errorState(err);
  }
}
