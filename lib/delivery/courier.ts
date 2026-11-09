import type { Courier, Role, ShipmentStatus } from '@prisma/client';
import { prisma } from '../db';
import { can } from '../rbac';
import { parseAddressSnapshot } from './addresses';

/**
 * Courier workspace access: a user linked to an active `Courier` row sees the shipments
 * assigned to them; logistics staff (`delivery:write`) see every active shipment.
 */

export type CourierContext = { userId: string; role: Role; courier: Courier | null; isStaff: boolean };

export async function getCourierContext(user: { id: string; role: Role }): Promise<CourierContext | null> {
  const courier = await prisma.courier.findFirst({ where: { userId: user.id, isActive: true } });
  const isStaff = can(user.role, 'delivery:write');
  if (!courier && !isStaff) return null;
  return { userId: user.id, role: user.role, courier, isStaff };
}

export const COURIER_ACTIVE_STATUSES: readonly ShipmentStatus[] = ['COURIER_ASSIGNED', 'OUT_FOR_DELIVERY'];

const courierSelect = {
  id: true,
  status: true,
  trackingCode: true,
  deliveryType: true,
  promisedBy: true,
  deliveredAt: true,
  otpAttempts: true,
  courierId: true,
  courier: { select: { name: true } },
  order: { select: { number: true, addressSnapshot: true, contactPhone: true, _count: { select: { items: true } } } },
} as const;

export async function listCourierShipments(ctx: CourierContext, view: 'active' | 'done' = 'active') {
  const statusFilter = view === 'active' ? { in: [...COURIER_ACTIVE_STATUSES] } : { in: ['DELIVERED', 'FAILED'] as ShipmentStatus[] };
  const rows = await prisma.shipment.findMany({
    where: {
      status: statusFilter,
      ...(ctx.courier && !ctx.isStaff ? { courierId: ctx.courier.id } : {}),
      ...(view === 'done' ? { updatedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } : {}),
    },
    orderBy: [{ promisedBy: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 100,
    select: courierSelect,
  });
  return rows.map((r) => ({ ...r, address: parseAddressSnapshot(r.order.addressSnapshot) }));
}

export async function getCourierShipment(ctx: CourierContext, id: string) {
  const s = await prisma.shipment.findUnique({
    where: { id },
    select: {
      ...courierSelect,
      proofName: true,
      failedReason: true,
      otpExpiresAt: true,
      events: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, note: true, createdAt: true } },
      incidents: { orderBy: { createdAt: 'desc' }, select: { id: true, type: true, status: true, description: true, createdAt: true } },
      order: {
        select: {
          number: true,
          addressSnapshot: true,
          contactPhone: true,
          notes: true,
          items: { select: { id: true, nameSnapshot: true, qty: true, variantLabel: true } },
          _count: { select: { items: true } },
        },
      },
    },
  });
  if (!s) return null;
  if (!ctx.isStaff && s.courierId !== ctx.courier?.id) return null;
  return { ...s, address: parseAddressSnapshot(s.order.addressSnapshot) };
}
