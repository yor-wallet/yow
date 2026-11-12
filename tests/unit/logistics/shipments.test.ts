/**
 * Shipment lifecycle: transition guard, order mirroring, handover OTP (hashing, attempts,
 * lock, renewal), proof of delivery (encrypted), incidents, notifications.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ShipmentStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { __setStorageDriverForTests } from '@/lib/storage';
import {
  ALLOWED_TRANSITIONS,
  assignCourier,
  canTransition,
  completeDelivery,
  createShipmentForOrder,
  DeliveryError,
  regenerateHandoverOtp,
  reportIncident,
  transitionShipment,
} from '@/lib/delivery/shipments';
import { checkHandoverOtp, deriveHandoverOtp, hashHandoverOtp, issueHandoverOtp, OTP_MAX_ATTEMPTS } from '@/lib/delivery/otp';
import { handoverCodeFor } from '@/lib/delivery/tracking';
import { unpackProof } from '@/lib/delivery/proof';
import { cleanup, createCourier, createOrder, createUser, image, useMemoryStorage, type MemoryStorage } from './fixtures';

let storage: MemoryStorage;
beforeAll(() => {
  storage = useMemoryStorage();
});
afterAll(async () => {
  await cleanup();
  __setStorageDriverForTests(null);
  await prisma.$disconnect();
});

const expectCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(DeliveryError);
  await expect(p).rejects.toMatchObject({ code });
};

describe('transition guard', () => {
  const ALL: ShipmentStatus[] = ['CONFIRMED', 'PREPARING', 'PACKED', 'COURIER_ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'];

  it('only allows the documented forward path, failure and re-dispatch', () => {
    expect(canTransition('CONFIRMED', 'PREPARING')).toBe(true);
    expect(canTransition('PREPARING', 'PACKED')).toBe(true);
    expect(canTransition('PACKED', 'COURIER_ASSIGNED')).toBe(true);
    expect(canTransition('COURIER_ASSIGNED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
    expect(canTransition('FAILED', 'PACKED')).toBe(true);
    // no skipping, no going back from delivered
    expect(canTransition('CONFIRMED', 'PACKED')).toBe(false);
    expect(canTransition('CONFIRMED', 'DELIVERED')).toBe(false);
    expect(canTransition('PACKED', 'OUT_FOR_DELIVERY')).toBe(false);
    for (const to of ALL) expect(canTransition('DELIVERED', to)).toBe(false);
    // every active step can fail
    for (const from of ['CONFIRMED', 'PREPARING', 'PACKED', 'COURIER_ASSIGNED', 'OUT_FOR_DELIVERY'] as const) {
      expect(ALLOWED_TRANSITIONS[from]).toContain('FAILED');
    }
  });
});

describe('handover OTP', () => {
  it('derives a stable 6-digit code from the issue nonce and stores only a keyed hash', () => {
    const at = new Date('2026-11-10T10:00:00.123Z');
    const code = deriveHandoverOtp('ship_1', at);
    expect(code).toMatch(/^\d{6}$/);
    expect(deriveHandoverOtp('ship_1', at)).toBe(code);
    expect(deriveHandoverOtp('ship_2', at)).not.toBe(code);
    const hash = hashHandoverOtp('ship_1', code);
    expect(hash).not.toContain(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(checkHandoverOtp('ship_1', code, hash)).toBe(true);
    expect(checkHandoverOtp('ship_1', ` ${code.slice(0, 3)} ${code.slice(3)} `, hash)).toBe(true);
    expect(checkHandoverOtp('ship_2', code, hash)).toBe(false);
    expect(checkHandoverOtp('ship_1', '12345', hash)).toBe(false);
    expect(checkHandoverOtp('ship_1', 'abcdef', hash)).toBe(false);
  });

  it('issues a fresh code each time', () => {
    const a = issueHandoverOtp('ship_x');
    const b = issueHandoverOtp('ship_x', new Date(Date.now() + 1000));
    expect(a.otpHash).not.toBe(b.otpHash);
    expect(checkHandoverOtp('ship_x', a.otp, a.otpHash)).toBe(true);
    expect(a.otp).toBe(deriveHandoverOtp('ship_x', a.otpExpiresAt));
  });
});

describe('shipment lifecycle (database)', () => {
  it('runs confirmed → delivered with order mirroring, OTP attempts, lock, renewal and proof', async () => {
    const customer = await createUser();
    const staff = await createUser({ role: 'LOGISTICS' });
    const { user: courierUser, courier } = await createCourier();
    const { user: otherCourierUser } = await createCourier('Other Courier');
    const order = await createOrder(customer.id);
    const staffActor = { id: staff.id, role: staff.role };
    const courierActor = { id: courierUser.id, role: courierUser.role };

    // created once (idempotent), CONFIRMED + event + notification in 3 languages
    const shipment = await prisma.$transaction((tx) => createShipmentForOrder(order.id, tx));
    const again = await prisma.$transaction((tx) => createShipmentForOrder(order.id, tx));
    expect(again.id).toBe(shipment.id);
    expect(shipment.status).toBe('CONFIRMED');
    expect(shipment.trackingCode).toMatch(/^DX[0-9A-Z]{10}$/);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: shipment.id, status: 'CONFIRMED' } })).toBe(1);
    const confirmedNotif = await prisma.notification.findFirstOrThrow({ where: { userId: customer.id, type: 'delivery.status' } });
    expect(confirmedNotif.title).toMatchObject({ en: expect.stringContaining(order.number), ar: expect.stringContaining(order.number), fr: expect.stringContaining(order.number) });

    // permissions & guard
    await expectCode(transitionShipment({ shipmentId: shipment.id, to: 'PREPARING', actor: { id: customer.id, role: 'CUSTOMER' } }), 'forbidden');
    await expectCode(transitionShipment({ shipmentId: shipment.id, to: 'OUT_FOR_DELIVERY', actor: courierActor }), 'forbidden');
    await expectCode(transitionShipment({ shipmentId: shipment.id, to: 'PACKED', actor: staffActor }), 'invalid_transition');
    await expectCode(transitionShipment({ shipmentId: shipment.id, to: 'DELIVERED', actor: staffActor }), 'use_complete_delivery');

    await transitionShipment({ shipmentId: shipment.id, to: 'PREPARING', actor: staffActor });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PROCESSING');
    await transitionShipment({ shipmentId: shipment.id, to: 'PACKED', actor: staffActor });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PACKED');
    await expectCode(transitionShipment({ shipmentId: shipment.id, to: 'COURIER_ASSIGNED', actor: staffActor }), 'courier_required');
    await assignCourier({ shipmentId: shipment.id, courierId: courier.id, actor: staffActor });
    const assigned = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(assigned).toMatchObject({ status: 'COURIER_ASSIGNED', courierId: courier.id });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('SHIPPED');

    // another courier cannot act; the assigned one picks up → OTP issued (hash only)
    await expectCode(transitionShipment({ shipmentId: shipment.id, to: 'OUT_FOR_DELIVERY', actor: { id: otherCourierUser.id, role: 'CUSTOMER' } }), 'forbidden');
    await transitionShipment({ shipmentId: shipment.id, to: 'OUT_FOR_DELIVERY', actor: courierActor });
    const out = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(out.status).toBe('OUT_FOR_DELIVERY');
    expect(out.otpHash).toMatch(/^[0-9a-f]{64}$/);
    const live = handoverCodeFor(out);
    expect(live?.code).toMatch(/^\d{6}$/);
    expect(out.otpHash).not.toContain(live!.code);
    expect(await prisma.notification.count({ where: { userId: customer.id, type: 'delivery.otp' } })).toBe(1);
    // the code is never written in clear in any notification
    const notifs = await prisma.notification.findMany({ where: { userId: customer.id } });
    expect(JSON.stringify(notifs)).not.toContain(live!.code);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');

    // wrong codes are counted (and committed) until the lock + automatic incident
    const photo = await image('jpeg');
    const wrong = live!.code === '000000' ? '111111' : '000000';
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      const r = await completeDelivery({ shipmentId: shipment.id, otp: wrong, receiverName: 'Ahmed', photo, actor: courierActor });
      expect(r).toEqual({ ok: false, code: 'otp_invalid', attemptsLeft: OTP_MAX_ATTEMPTS - i });
    }
    expect(await completeDelivery({ shipmentId: shipment.id, otp: wrong, receiverName: 'Ahmed', photo, actor: courierActor })).toEqual({ ok: false, code: 'otp_locked' });
    expect(await completeDelivery({ shipmentId: shipment.id, otp: live!.code, receiverName: 'Ahmed', photo, actor: courierActor })).toEqual({ ok: false, code: 'otp_locked' });
    expect(handoverCodeFor(await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } }))).toBeNull();
    expect(await prisma.deliveryIncident.count({ where: { shipmentId: shipment.id, type: 'OTP_FAILURE' } })).toBe(1);

    // only staff can renew; the new code works, the old one does not
    await expectCode(regenerateHandoverOtp({ shipmentId: shipment.id, actor: courierActor }), 'forbidden');
    await regenerateHandoverOtp({ shipmentId: shipment.id, actor: staffActor });
    const renewed = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(renewed.otpAttempts).toBe(0);
    const code = handoverCodeFor(renewed)!.code;
    expect(checkHandoverOtp(shipment.id, live!.code, renewed.otpHash!)).toBe(live!.code === code);

    // validation of the proof before any code check
    await expectCode(completeDelivery({ shipmentId: shipment.id, otp: code, receiverName: 'A', photo, actor: courierActor }), 'receiver_required');
    await expectCode(completeDelivery({ shipmentId: shipment.id, otp: code, receiverName: 'Ahmed', photo: Buffer.from('not an image at all'), actor: courierActor }), 'photo_invalid');

    const done = await completeDelivery({ shipmentId: shipment.id, otp: code, receiverName: 'Ahmed Al Balushi', photo, actor: courierActor, lat: 23.6, lng: 58.4 });
    expect(done.ok).toBe(true);
    const delivered = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(delivered).toMatchObject({ status: 'DELIVERED', proofName: 'Ahmed Al Balushi', otpHash: null });
    expect(delivered.deliveredAt).toBeInstanceOf(Date);
    // proof stored encrypted in the private bucket and decryptable only for this shipment
    const blob = await storage.get('private', delivered.proofPhotoKey!);
    expect(blob!.subarray(0, 4).toString('ascii')).toBe('DPF1');
    expect(blob!.includes(photo.subarray(0, 16))).toBe(false);
    expect(unpackProof(blob!, shipment.id).equals(photo)).toBe(true);
    expect(() => unpackProof(blob!, 'another-shipment')).toThrow();
    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { events: true } });
    expect(finalOrder.status).toBe('DELIVERED');
    expect(finalOrder.deliveredAt).toBeInstanceOf(Date);
    expect(finalOrder.events.map((e) => e.toStatus)).toEqual(expect.arrayContaining(['PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']));
    expect(await prisma.auditLog.count({ where: { entity: 'Shipment', entityId: shipment.id } })).toBeGreaterThanOrEqual(6);
    // a delivered shipment cannot be completed or failed again
    await expectCode(transitionShipment({ shipmentId: shipment.id, to: 'FAILED', actor: staffActor }), 'invalid_transition');
  });

  it('blocks progress on inactive orders and lets couriers report incidents on their deliveries only', async () => {
    const customer = await createUser();
    const staff = await createUser({ role: 'LOGISTICS' });
    const stranger = await createUser();
    const { user: courierUser, courier } = await createCourier();
    const order = await createOrder(customer.id, { deliveryType: 'EXPRESS' });
    const shipment = await prisma.$transaction((tx) => createShipmentForOrder(order.id, tx));
    expect(shipment.deliveryType).toBe('EXPRESS');
    await assignCourier({ shipmentId: shipment.id, courierId: courier.id, actor: { id: staff.id, role: 'LOGISTICS' } }); // pre-assignment (CONFIRMED)
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe('CONFIRMED');

    const incident = await reportIncident({ shipmentId: shipment.id, type: 'ADDRESS_ISSUE', description: 'Gate closed, no answer', actor: { id: courierUser.id, role: courierUser.role } });
    expect(incident.status).toBe('OPEN');
    await expectCode(reportIncident({ shipmentId: shipment.id, type: 'DELAY', description: 'Not mine', actor: { id: stranger.id, role: 'CUSTOMER' } }), 'forbidden');
    await expectCode(reportIncident({ shipmentId: shipment.id, type: 'DELAY', description: ' ', actor: { id: staff.id, role: 'LOGISTICS' } }), 'description_required');

    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await expectCode(transitionShipment({ shipmentId: shipment.id, to: 'PREPARING', actor: { id: staff.id, role: 'LOGISTICS' } }), 'order_not_active');
  });
});
