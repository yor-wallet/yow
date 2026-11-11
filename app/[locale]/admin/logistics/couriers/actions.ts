'use server';

import { runAdminAction, type ActionState } from '@/lib/admin/action';
import { createCourier, setCourierActive } from '@/lib/admin/couriers';
import { text } from '@/lib/admin/form';

/** Courier actions. RBAC + validation + audit live in lib/admin/couriers.ts. */

export async function createCourierAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(createCourier, { name: text(fd, 'name'), phone: text(fd, 'phone'), vehicle: text(fd, 'vehicle'), accountEmail: text(fd, 'accountEmail') }, { successCode: 'created' });
}

export async function setCourierActiveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(setCourierActive, { id: text(fd, 'id'), isActive: text(fd, 'isActive') }, { successCode: 'saved' });
}
