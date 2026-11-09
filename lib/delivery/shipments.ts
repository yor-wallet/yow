import { Prisma, type IncidentType, type OrderStatus, type Role, type Shipment, type ShipmentStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma, type Db } from '../db';
import { can } from '../rbac';
import { logAudit } from '../audit';
import { notifyTemplate } from '../notifications';
import { parseAddressSnapshot } from './addresses';
import { resolveZone } from './quote';
import { checkHandoverOtp, issueHandoverOtp, OTP_MAX_ATTEMPTS } from './otp';
import { validateImage } from './images';
import { storeProofPhoto } from './proof';
import { getStorage } from '../storage';

/**
 * Shipment lifecycle (DOOM EXPRESS):
 *   CONFIRMED → PREPARING → PACKED → COURIER_ASSIGNED → OUT_FOR_DELIVERY → DELIVERED
 *   any active step → FAILED; FAILED → PACKED (re-dispatch); COURIER_ASSIGNED → PACKED (unassign)
 * Every transition writes a ShipmentEvent, mirrors the Order status (+ OrderStatusEvent),
 * is audited, and notifies the customer at the key steps. DELIVERED is reachable only
 * through `completeDelivery` (handover OTP + proof photo + receiver name).
 */

export const SHIPMENT_FLOW: readonly ShipmentStatus[] = [
  'CONFIRMED',
  'PREPARING',
  'PACKED',
  'COURIER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export const ALLOWED_TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  CONFIRMED: ['PREPARING', 'FAILED'],
  PREPARING: ['PACKED', 'FAILED'],
  PACKED: ['COURIER_ASSIGNED', 'FAILED'],
  COURIER_ASSIGNED: ['OUT_FOR_DELIVERY', 'PACKED', 'FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: ['PACKED'],
};

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Order status mirrored for each shipment status (CONFIRMED / FAILED leave the order unchanged). */
export const ORDER_STATUS_FOR_SHIPMENT: Readonly<Partial<Record<ShipmentStatus, OrderStatus>>> = {
  PREPARING: 'PROCESSING',
  PACKED: 'PACKED',
  COURIER_ASSIGNED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
};

/** Order statuses in which the delivery may progress. */
const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ['PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'];

/** Courier-side transitions (the assigned courier may perform these). */
const COURIER_TRANSITIONS: readonly ShipmentStatus[] = ['OUT_FOR_DELIVERY', 'FAILED'];

export type DeliveryErrorCode =
  | 'not_found'
  | 'invalid_transition'
  | 'forbidden'
  | 'order_not_active'
  | 'courier_required'
  | 'courier_inactive'
  | 'use_complete_delivery'
  | 'otp_not_issued'
  | 'receiver_required'
  | 'photo_required'
  | 'photo_invalid'
  | 'description_required';

export class DeliveryError extends Error {
  constructor(public readonly code: DeliveryErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DeliveryError';
  }
}

export type Actor = { id: string; role: Role };

/** Short public tracking code, e.g. `DX7K2M9QPA4T` (Crockford base32, 50 bits). */
export function generateTrackingCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(10);
  let out = 'DX';
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

async function runInTx<T>(db: Prisma.TransactionClient | undefined, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (db) return fn(db);
  return prisma.$transaction(fn, { timeout: 15_000, maxWait: 5_000 });
}

async function lockShipment(tx: Prisma.TransactionClient, shipmentId: string) {
  await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id = ${shipmentId} FOR UPDATE`;
  return tx.shipment.findUnique({
    where: { id: shipmentId },
    include: { order: { select: { id: true, number: true, userId: true, status: true } }, courier: true },
  });
}

/** Is `actor` the courier assigned to this shipment? */
async function isAssignedCourier(db: Db, actorId: string, courierId: string | null): Promise<boolean> {
  if (!courierId) return false;
  const c = await db.courier.findUnique({ where: { id: courierId }, select: { userId: true, isActive: true } });
  return !!c && c.isActive && c.userId === actorId;
}

/**
 * Create the shipment (CONFIRMED) for a paid order. Idempotent: returns the existing
 * shipment when called twice. Called by `markOrderPaid` (lib/orders) inside its transaction.
 * The promise (`promisedBy`) uses the zone's configured hours for the order's delivery type.
 */
export async function createShipmentForOrder(orderId: string, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<Shipment> {
  const existing = await tx.shipment.findUnique({ where: { orderId } });
  if (existing) return existing;
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, userId: true, deliveryType: true, addressSnapshot: true },
  });
  if (!order) throw new DeliveryError('not_found');
  const snap = parseAddressSnapshot(order.addressSnapshot);
  const zone = snap ? await resolveZone({ governorateId: snap.governorateId, wilayaId: snap.wilayaId }, tx) : null;
  const hours = zone ? (order.deliveryType === 'EXPRESS' ? zone.expressHours : zone.standardHours) : null;
  const now = new Date();
  const shipment = await tx.shipment.create({
    data: {
      orderId: order.id,
      deliveryType: order.deliveryType,
      status: 'CONFIRMED',
      trackingCode: generateTrackingCode(),
      promisedBy: hours ? new Date(now.getTime() + hours * 3600 * 1000) : null,
      events: { create: { status: 'CONFIRMED' } },
    },
  });
  await notifyTemplate(order.userId, 'deliveryConfirmed', { number: order.number }, `/orders/${order.number}`, tx);
  return shipment;
}

async function mirrorOrderStatus(
  tx: Prisma.TransactionClient,
  order: { id: string; status: OrderStatus },
  to: ShipmentStatus,
  actorId: string | null,
  note?: string | null,
) {
  const target = ORDER_STATUS_FOR_SHIPMENT[to];
  if (!target || target === order.status) return;
  await tx.order.update({
    where: { id: order.id },
    data: { status: target, ...(target === 'DELIVERED' ? { deliveredAt: new Date() } : {}) },
  });
  await tx.orderStatusEvent.create({
    data: { orderId: order.id, fromStatus: order.status, toStatus: target, actorId, note: note ?? null },
  });
}

export type TransitionInput = {
  shipmentId: string;
  to: ShipmentStatus;
  actor: Actor;
  note?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Required when moving to COURIER_ASSIGNED if no courier is set yet. */
  courierId?: string | null;
};

/**
 * Validated status transition. Staff need `delivery:write`; the assigned courier may
 * mark OUT_FOR_DELIVERY (picked up) and FAILED. Issues the handover OTP on OUT_FOR_DELIVERY.
 */
export async function transitionShipment(input: TransitionInput, db?: Prisma.TransactionClient): Promise<Shipment> {
  if (input.to === 'DELIVERED') throw new DeliveryError('use_complete_delivery');
  return runInTx(db, async (tx) => {
    const s = await lockShipment(tx, input.shipmentId);
    if (!s) throw new DeliveryError('not_found');
    const staff = can(input.actor.role, 'delivery:write');
    const courier = !staff && COURIER_TRANSITIONS.includes(input.to) && (await isAssignedCourier(tx, input.actor.id, s.courierId));
    if (!staff && !courier) throw new DeliveryError('forbidden');
    if (!canTransition(s.status, input.to)) throw new DeliveryError('invalid_transition');
    if (!ACTIVE_ORDER_STATUSES.includes(s.order.status)) throw new DeliveryError('order_not_active');

    const data: Prisma.ShipmentUpdateInput = { status: input.to };
    let courierId = s.courierId;
    if (input.to === 'COURIER_ASSIGNED') {
      courierId = input.courierId ?? s.courierId;
      if (!courierId) throw new DeliveryError('courier_required');
      const c = await tx.courier.findUnique({ where: { id: courierId }, select: { isActive: true } });
      if (!c) throw new DeliveryError('courier_required');
      if (!c.isActive) throw new DeliveryError('courier_inactive');
      data.courier = { connect: { id: courierId } };
    }
    if (input.to === 'OUT_FOR_DELIVERY') {
      const otp = issueHandoverOtp(s.id);
      data.otpHash = otp.otpHash;
      data.otpExpiresAt = otp.otpExpiresAt;
      data.otpAttempts = 0;
    }
    if (input.to === 'FAILED') {
      data.failedReason = input.note?.trim() || null;
      data.otpHash = null;
      data.otpExpiresAt = null;
    }
    if (input.to === 'PACKED') {
      data.otpHash = null;
      data.otpExpiresAt = null;
      data.otpAttempts = 0;
      if (s.status === 'FAILED') data.failedReason = null;
    }

    const updated = await tx.shipment.update({ where: { id: s.id, status: s.status }, data });
    await tx.shipmentEvent.create({
      data: {
        shipmentId: s.id,
        status: input.to,
        note: input.note?.trim() || null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        actorId: input.actor.id,
      },
    });
    await mirrorOrderStatus(tx, s.order, input.to, input.actor.id, input.note);
    await logAudit(
      {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'shipment.transition',
        entity: 'Shipment',
        entityId: s.id,
        before: { status: s.status, courierId: s.courierId },
        after: { status: input.to, courierId, note: input.note ?? null },
      },
      tx,
    );
    const link = `/orders/${s.order.number}`;
    const params = { number: s.order.number };
    if (input.to === 'COURIER_ASSIGNED') await notifyTemplate(s.order.userId, 'deliveryShipped', params, link, tx);
    if (input.to === 'OUT_FOR_DELIVERY') await notifyTemplate(s.order.userId, 'deliveryOutForDelivery', params, link, tx);
    if (input.to === 'FAILED') await notifyTemplate(s.order.userId, 'deliveryFailed', params, link, tx);
    return updated;
  });
}

/**
 * Assign (or reassign) a courier. PACKED → COURIER_ASSIGNED; already assigned → courier
 * swapped (event note); earlier steps → pre-assignment without status change.
 */
export async function assignCourier(input: { shipmentId: string; courierId: string; actor: Actor; note?: string }): Promise<Shipment> {
  if (!can(input.actor.role, 'delivery:write')) throw new DeliveryError('forbidden');
  const s = await prisma.shipment.findUnique({ where: { id: input.shipmentId }, select: { status: true, courierId: true } });
  if (!s) throw new DeliveryError('not_found');
  if (s.status === 'PACKED') {
    return transitionShipment({ shipmentId: input.shipmentId, to: 'COURIER_ASSIGNED', actor: input.actor, courierId: input.courierId, note: input.note });
  }
  if (s.status === 'DELIVERED' || s.status === 'OUT_FOR_DELIVERY') throw new DeliveryError('invalid_transition');
  return prisma.$transaction(async (tx) => {
    const c = await tx.courier.findUnique({ where: { id: input.courierId }, select: { isActive: true, name: true } });
    if (!c) throw new DeliveryError('courier_required');
    if (!c.isActive) throw new DeliveryError('courier_inactive');
    const updated = await tx.shipment.update({ where: { id: input.shipmentId }, data: { courierId: input.courierId } });
    await tx.shipmentEvent.create({
      data: { shipmentId: input.shipmentId, status: updated.status, note: input.note ?? `courier:${c.name}`, actorId: input.actor.id },
    });
    await logAudit(
      {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'shipment.courier.assign',
        entity: 'Shipment',
        entityId: input.shipmentId,
        before: { courierId: s.courierId },
        after: { courierId: input.courierId },
      },
      tx,
    );
    return updated;
  });
}

export type CompleteDeliveryInput = {
  shipmentId: string;
  otp: string;
  receiverName: string;
  photo: Buffer;
  actor: Actor;
  lat?: number | null;
  lng?: number | null;
};

export type CompleteDeliveryResult =
  | { ok: true; shipment: Shipment }
  | { ok: false; code: 'otp_invalid'; attemptsLeft: number }
  | { ok: false; code: 'otp_locked' | 'otp_expired' };

/**
 * Handover: verify the customer's OTP (max OTP_MAX_ATTEMPTS, then locked + incident),
 * store the encrypted proof photo, record the receiver's name, mark DELIVERED.
 * Wrong codes are counted in a committed transaction (cannot be bypassed by errors).
 */
export async function completeDelivery(input: CompleteDeliveryInput): Promise<CompleteDeliveryResult> {
  const receiverName = input.receiverName.trim();
  if (receiverName.length < 2 || receiverName.length > 100) throw new DeliveryError('receiver_required');
  if (!input.photo || input.photo.length === 0) throw new DeliveryError('photo_required');
  if (!validateImage(input.photo).ok) throw new DeliveryError('photo_invalid');

  // Step 1 — verify the code (attempt counting commits on its own).
  const check = await prisma.$transaction(async (tx) => {
    const s = await lockShipment(tx, input.shipmentId);
    if (!s) throw new DeliveryError('not_found');
    const staff = can(input.actor.role, 'delivery:write');
    if (!staff && !(await isAssignedCourier(tx, input.actor.id, s.courierId))) throw new DeliveryError('forbidden');
    if (s.status !== 'OUT_FOR_DELIVERY') throw new DeliveryError('invalid_transition');
    if (!ACTIVE_ORDER_STATUSES.includes(s.order.status)) throw new DeliveryError('order_not_active');
    if (!s.otpHash || !s.otpExpiresAt) throw new DeliveryError('otp_not_issued');
    if (s.otpAttempts >= OTP_MAX_ATTEMPTS) return { ok: false as const, code: 'otp_locked' as const };
    if (s.otpExpiresAt <= new Date()) return { ok: false as const, code: 'otp_expired' as const };
    if (checkHandoverOtp(s.id, input.otp, s.otpHash)) return { ok: true as const };
    const attempts = s.otpAttempts + 1;
    await tx.shipment.update({ where: { id: s.id }, data: { otpAttempts: attempts } });
    await logAudit(
      { actorId: input.actor.id, actorRole: input.actor.role, action: 'shipment.otp.failed', entity: 'Shipment', entityId: s.id, after: { attempts } },
      tx,
    );
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await tx.deliveryIncident.create({
        data: { shipmentId: s.id, type: 'OTP_FAILURE', description: `Handover code locked after ${attempts} wrong attempts`, reportedById: input.actor.id },
      });
      return { ok: false as const, code: 'otp_locked' as const };
    }
    return { ok: false as const, code: 'otp_invalid' as const, attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
  });
  if (!check.ok) return check;

  // Step 2 — store the proof, then commit the delivery.
  const proofKey = await storeProofPhoto(input.shipmentId, input.photo);
  try {
    const shipment = await prisma.$transaction(async (tx) => {
      const s = await lockShipment(tx, input.shipmentId);
      if (!s || s.status !== 'OUT_FOR_DELIVERY') throw new DeliveryError('invalid_transition');
      const now = new Date();
      const updated = await tx.shipment.update({
        where: { id: s.id, status: 'OUT_FOR_DELIVERY' },
        data: { status: 'DELIVERED', deliveredAt: now, proofPhotoKey: proofKey, proofName: receiverName, otpHash: null, otpExpiresAt: null },
      });
      await tx.shipmentEvent.create({
        data: { shipmentId: s.id, status: 'DELIVERED', note: null, lat: input.lat ?? null, lng: input.lng ?? null, actorId: input.actor.id },
      });
      await mirrorOrderStatus(tx, s.order, 'DELIVERED', input.actor.id);
      await logAudit(
        {
          actorId: input.actor.id,
          actorRole: input.actor.role,
          action: 'shipment.delivered',
          entity: 'Shipment',
          entityId: s.id,
          before: { status: s.status },
          after: { status: 'DELIVERED', proofName: receiverName },
        },
        tx,
      );
      await notifyTemplate(s.order.userId, 'deliveryDelivered', { number: s.order.number, name: receiverName }, `/orders/${s.order.number}`, tx);
      return updated;
    });
    return { ok: true, shipment };
  } catch (err) {
    await getStorage().delete('private', proofKey).catch(() => undefined);
    throw err;
  }
}

/** Issue a fresh handover code (staff, e.g. after a lock or expiry). */
export async function regenerateHandoverOtp(input: { shipmentId: string; actor: Actor }): Promise<Shipment> {
  if (!can(input.actor.role, 'delivery:write')) throw new DeliveryError('forbidden');
  return prisma.$transaction(async (tx) => {
    const s = await lockShipment(tx, input.shipmentId);
    if (!s) throw new DeliveryError('not_found');
    if (s.status !== 'OUT_FOR_DELIVERY') throw new DeliveryError('invalid_transition');
    const otp = issueHandoverOtp(s.id);
    const updated = await tx.shipment.update({
      where: { id: s.id },
      data: { otpHash: otp.otpHash, otpExpiresAt: otp.otpExpiresAt, otpAttempts: 0 },
    });
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: s.status, note: 'otp:renewed', actorId: input.actor.id } });
    await logAudit(
      { actorId: input.actor.id, actorRole: input.actor.role, action: 'shipment.otp.renew', entity: 'Shipment', entityId: s.id },
      tx,
    );
    await notifyTemplate(s.order.userId, 'deliveryOtpRenewed', { number: s.order.number }, `/orders/${s.order.number}`, tx);
    return updated;
  });
}

export const INCIDENT_TYPES: readonly IncidentType[] = ['DELAY', 'DAMAGE', 'ADDRESS_ISSUE', 'CUSTOMER_UNREACHABLE', 'OTP_FAILURE', 'LOST', 'OTHER'];

/** Report a delivery incident (logistics staff or the assigned courier). */
export async function reportIncident(input: { shipmentId: string; type: IncidentType; description: string; actor: Actor }) {
  const description = input.description.trim();
  if (description.length < 3 || description.length > 1000) throw new DeliveryError('description_required');
  if (!INCIDENT_TYPES.includes(input.type)) throw new DeliveryError('invalid_transition');
  const s = await prisma.shipment.findUnique({ where: { id: input.shipmentId }, select: { id: true, courierId: true } });
  if (!s) throw new DeliveryError('not_found');
  const staff = can(input.actor.role, 'incidents:write');
  if (!staff && !(await isAssignedCourier(prisma, input.actor.id, s.courierId))) throw new DeliveryError('forbidden');
  return prisma.$transaction(async (tx) => {
    const incident = await tx.deliveryIncident.create({
      data: { shipmentId: s.id, type: input.type, description, reportedById: input.actor.id },
    });
    await logAudit(
      {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'delivery.incident.report',
        entity: 'DeliveryIncident',
        entityId: incident.id,
        after: { shipmentId: s.id, type: input.type, description },
      },
      tx,
    );
    return incident;
  });
}

export async function resolveIncident(input: { incidentId: string; resolution: string; actor: Actor }) {
  if (!can(input.actor.role, 'incidents:write')) throw new DeliveryError('forbidden');
  const resolution = input.resolution.trim();
  if (resolution.length < 3) throw new DeliveryError('description_required');
  return prisma.$transaction(async (tx) => {
    const before = await tx.deliveryIncident.findUnique({ where: { id: input.incidentId } });
    if (!before) throw new DeliveryError('not_found');
    const incident = await tx.deliveryIncident.update({
      where: { id: input.incidentId },
      data: { status: 'RESOLVED', resolution, resolvedAt: new Date(), resolvedById: input.actor.id },
    });
    await logAudit(
      {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'delivery.incident.resolve',
        entity: 'DeliveryIncident',
        entityId: incident.id,
        before: { status: before.status },
        after: { status: 'RESOLVED', resolution },
      },
      tx,
    );
    return incident;
  });
}
