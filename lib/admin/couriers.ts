import { z } from 'zod';
import { prisma } from '@/lib/db';
import { idSchema } from '@/lib/validation';
import { NotFoundError, ValidationError } from './actor';
import { defineMutation } from './mutation';
import { zBool, zPhone, zText, zTextOpt } from './zod';

/**
 * Couriers. A courier may be linked to a customer account (by e-mail): that person then sees the
 * deliveries assigned to them in the courier workspace (/courier). Every change is audited.
 */

export type AdminCourierRow = {
  id: string;
  name: string;
  phone: string;
  vehicle: string | null;
  isActive: boolean;
  accountEmail: string | null;
  openShipments: number;
};

export async function listAdminCouriers(): Promise<AdminCourierRow[]> {
  const rows = await prisma.courier.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      phone: true,
      vehicle: true,
      isActive: true,
      user: { select: { email: true } },
      _count: { select: { shipments: { where: { status: { in: ['COURIER_ASSIGNED', 'OUT_FOR_DELIVERY'] } } } } },
    },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone, vehicle: c.vehicle, isActive: c.isActive, accountEmail: c.user?.email ?? null, openShipments: c._count.shipments }));
}

/** Active couriers for the "assign courier" menu. */
export async function listActiveCouriers(): Promise<{ id: string; name: string; phone: string }[]> {
  return prisma.courier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, phone: true } });
}

export const createCourier = defineMutation({
  name: 'courier.create',
  permission: 'couriers:write',
  schema: z.object({
    name: zText(80, 2),
    phone: zPhone,
    vehicle: zTextOpt(80),
    /** Optional account to link (the person signs in with it to use /courier). */
    accountEmail: zTextOpt(254),
  }),
  async run({ tx, input, audit }) {
    let userId: string | null = null;
    if (input.accountEmail) {
      const user = await tx.user.findUnique({ where: { email: input.accountEmail.toLowerCase() }, select: { id: true, courier: { select: { id: true } } } });
      if (!user) throw new ValidationError({ accountEmail: ['account_not_found'] });
      if (user.courier) throw new ValidationError({ accountEmail: ['account_already_courier'] });
      userId = user.id;
    }
    const courier = await tx.courier.create({ data: { name: input.name, phone: input.phone, vehicle: input.vehicle, userId, governorateIds: [] }, select: { id: true } });
    await audit({ action: 'courier.create', entity: 'Courier', entityId: courier.id, after: { name: input.name, phone: input.phone, vehicle: input.vehicle, linkedAccount: !!userId } });
    return { id: courier.id };
  },
});

export const setCourierActive = defineMutation({
  name: 'courier.setActive',
  permission: 'couriers:write',
  schema: z.object({ id: idSchema, isActive: zBool }),
  async run({ tx, input, audit }) {
    const before = await tx.courier.findUnique({ where: { id: input.id }, select: { isActive: true } });
    if (!before) throw new NotFoundError('Courier');
    if (before.isActive === input.isActive) return { id: input.id };
    await tx.courier.update({ where: { id: input.id }, data: { isActive: input.isActive } });
    await audit({ action: input.isActive ? 'courier.activate' : 'courier.deactivate', entity: 'Courier', entityId: input.id, before, after: { isActive: input.isActive } });
    return { id: input.id };
  },
});
