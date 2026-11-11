/**
 * Couriers and the admin fulfilment chain against PostgreSQL (doom_test): RBAC, courier creation
 * (linked account), activation, and the steps an order goes through from the admin order page
 * (the same library calls as app/[locale]/admin/orders/[number]/actions.ts).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, ValidationError, type Actor } from '@/lib/admin/actor';
import { createCourier, listActiveCouriers, listAdminCouriers, setCourierActive } from '@/lib/admin/couriers';
import { getAdminOrder } from '@/lib/admin/orders';
import { assignCourier, DeliveryError, transitionShipment } from '@/lib/delivery/shipments';
import { markOrderPaid, placeOrder } from '@/lib/orders';
import { addToUserCart, cleanup, createAddress, createDeliveryArea, createProduct, createUser, RUN } from './shop/fixtures';

let area: Awaited<ReturnType<typeof createDeliveryArea>>;
let logistics: Actor;
let support: Actor;
const courierIds: string[] = [];
const phone = () => `9${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  return { id: u.id, role };
}

async function courier(over: Record<string, unknown> = {}) {
  const res = await createCourier(logistics, { name: `${RUN} Courier`, phone: phone(), vehicle: 'Motorbike', accountEmail: '', ...over });
  courierIds.push(res.id);
  return res.id;
}

/** A paid order with its shipment (CONFIRMED), as after a confirmed payment. */
async function paidOrder() {
  const user = await createUser();
  const address = await createAddress(user.id, area);
  const product = await createProduct({ variants: [{ priceBaisa: 30_000, stock: 5 }] });
  await addToUserCart(user.id, product.variants[0]!.id, 1);
  const placed = await placeOrder({ userId: user.id, idempotencyKey: randomUUID().replace(/-/g, ''), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'WALLET', locale: 'en' });
  const paid = await prisma.$transaction((tx) => markOrderPaid(placed.orderId, null, tx));
  if (!paid.ok) throw new Error('fixture: order not paid');
  const order = await getAdminOrder(placed.number);
  if (!order?.shipment) throw new Error('fixture: no shipment');
  return { number: placed.number, orderId: placed.orderId, shipmentId: order.shipment.id };
}

const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  area = await createDeliveryArea();
  logistics = await staff('LOGISTICS');
  support = await staff('SUPPORT');
});

afterAll(async () => {
  await prisma.shipment.updateMany({ where: { courierId: { in: courierIds } }, data: { courierId: null } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: courierIds } } });
  await prisma.courier.deleteMany({ where: { id: { in: courierIds } } });
  await cleanup();
  await prisma.$disconnect();
});

describe('couriers', () => {
  it('needs couriers:write', async () => {
    await expect(createCourier(support, { name: 'Nope Courier', phone: phone() })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('creates a courier, normalises the phone, links an account once, and audits', async () => {
    const account = await createUser();
    const local = phone();
    const id = await courier({ phone: local, accountEmail: account.email.toUpperCase() });
    const row = await prisma.courier.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ phone: `+968${local}`, userId: account.id, isActive: true, vehicle: 'Motorbike' });
    expect(await prisma.auditLog.count({ where: { actorId: logistics.id, action: 'courier.create', entityId: id } })).toBe(1);

    const again = await createCourier(logistics, { name: 'Second Courier', phone: phone(), accountEmail: account.email }).catch((e) => e);
    expect(again).toBeInstanceOf(ValidationError);
    expect((again as ValidationError).fieldErrors).toMatchObject({ accountEmail: ['account_already_courier'] });
    const unknown = await createCourier(logistics, { name: 'Third Courier', phone: phone(), accountEmail: 'nobody@test.doom.local' }).catch((e) => e);
    expect((unknown as ValidationError).fieldErrors).toMatchObject({ accountEmail: ['account_not_found'] });
    await expect(createCourier(logistics, { name: 'Bad Phone', phone: '12' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('deactivated couriers leave the assignment menu', async () => {
    const id = await courier();
    expect((await listActiveCouriers()).some((c) => c.id === id)).toBe(true);
    await setCourierActive(logistics, { id, isActive: 'false' });
    expect((await listActiveCouriers()).some((c) => c.id === id)).toBe(false);
    expect((await listAdminCouriers()).find((c) => c.id === id)).toMatchObject({ isActive: false, openShipments: 0 });
  });
});

describe('fulfilment chain', () => {
  it('prepares, packs and assigns a courier; the order status follows', async () => {
    const o = await paidOrder();
    const c = await courier();
    expect(await orderStatus(o.orderId)).toBe('PAID');

    await transitionShipment({ shipmentId: o.shipmentId, to: 'PREPARING', actor: logistics });
    expect(await orderStatus(o.orderId)).toBe('PROCESSING');
    await transitionShipment({ shipmentId: o.shipmentId, to: 'PACKED', actor: logistics });
    expect(await orderStatus(o.orderId)).toBe('PACKED');
    await assignCourier({ shipmentId: o.shipmentId, courierId: c, actor: logistics });

    const order = await getAdminOrder(o.number);
    expect(order!.shipment).toMatchObject({ status: 'COURIER_ASSIGNED', courier: { id: c } });
    expect(order!.status).toBe('SHIPPED');
    expect((await listAdminCouriers()).find((x) => x.id === c)!.openShipments).toBe(1);
  });

  it('refuses skipped steps, staff without delivery:write, and inactive couriers', async () => {
    const o = await paidOrder();
    await expect(transitionShipment({ shipmentId: o.shipmentId, to: 'PACKED', actor: logistics })).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(transitionShipment({ shipmentId: o.shipmentId, to: 'PREPARING', actor: support })).rejects.toBeInstanceOf(DeliveryError);

    const c = await courier();
    await setCourierActive(logistics, { id: c, isActive: 'false' });
    await transitionShipment({ shipmentId: o.shipmentId, to: 'PREPARING', actor: logistics });
    await transitionShipment({ shipmentId: o.shipmentId, to: 'PACKED', actor: logistics });
    await expect(assignCourier({ shipmentId: o.shipmentId, courierId: c, actor: logistics })).rejects.toMatchObject({ code: 'courier_inactive' });
  });

  it('a failed delivery keeps its reason and can be sent out again', async () => {
    const o = await paidOrder();
    await transitionShipment({ shipmentId: o.shipmentId, to: 'PREPARING', actor: logistics });
    await transitionShipment({ shipmentId: o.shipmentId, to: 'FAILED', actor: logistics, note: 'Customer unreachable' });
    expect((await getAdminOrder(o.number))!.shipment).toMatchObject({ status: 'FAILED', failedReason: 'Customer unreachable' });
    await transitionShipment({ shipmentId: o.shipmentId, to: 'PACKED', actor: logistics });
    expect((await getAdminOrder(o.number))!.shipment).toMatchObject({ status: 'PACKED', failedReason: null });
  });
});
