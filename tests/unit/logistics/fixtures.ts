import type { DeliveryType, OrderStatus, Role } from '@prisma/client';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { __setStorageDriverForTests, type Bucket, type StorageDriver } from '@/lib/storage';

/**
 * Test-only data for the logistics & account unit tests (shared doom_test DB): every row is
 * uniquely named with the `test-logistics-` prefix and removed in `cleanup()`. Files go to an
 * in-memory storage driver (nothing written to disk).
 */
export const RUN = `test-logistics-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let seq = 0;
const created = { users: [] as string[] };

export class MemoryStorage implements StorageDriver {
  readonly name = 'memory';
  readonly files = new Map<string, Buffer>();
  async put(bucket: Bucket, key: string, data: Buffer) {
    this.files.set(`${bucket}:${key}`, Buffer.from(data));
    return { key, size: data.length };
  }
  async get(bucket: Bucket, key: string) {
    return this.files.get(`${bucket}:${key}`) ?? null;
  }
  async delete(bucket: Bucket, key: string) {
    this.files.delete(`${bucket}:${key}`);
  }
  async exists(bucket: Bucket, key: string) {
    return this.files.has(`${bucket}:${key}`);
  }
  publicUrl(key: string) {
    return `/media/${key}`;
  }
}

export function useMemoryStorage(): MemoryStorage {
  const m = new MemoryStorage();
  __setStorageDriverForTests(m);
  return m;
}

export async function createUser(opts: { role?: Role; phone?: boolean; fullName?: string } = {}) {
  const n = ++seq;
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-u${n}@test.doom.local`,
      fullName: opts.fullName ?? `Logistics Tester ${n}`,
      passwordHash: 'not-a-real-hash',
      role: opts.role ?? 'CUSTOMER',
      phone: opts.phone === false ? null : `+9689${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
    },
  });
  created.users.push(user.id);
  return user;
}

export async function muscatGeo() {
  const gov = await prisma.governorate.findFirstOrThrow({ where: { code: 'MA' }, include: { wilayas: { orderBy: { sort: 'asc' }, take: 1 } } });
  return { governorate: gov, wilaya: gov.wilayas[0]! };
}

export async function createAddress(userId: string) {
  const { governorate, wilaya } = await muscatGeo();
  return prisma.address.create({
    data: { userId, recipientName: 'Test Receiver', phone: '+96891234567', governorateId: governorate.id, wilayaId: wilaya.id, area: 'Al Khuwair', building: '12', isDefault: true },
  });
}

/** A minimal order row (test fixture) with a Muscat address snapshot. */
export async function createOrder(userId: string, opts: { status?: OrderStatus; deliveryType?: DeliveryType } = {}) {
  const n = ++seq;
  const { governorate, wilaya } = await muscatGeo();
  return prisma.order.create({
    data: {
      number: `${RUN}-O${n}`.toUpperCase(),
      userId,
      status: opts.status ?? 'PAID',
      subtotalBaisa: 10_000,
      totalBaisa: 10_000,
      deliveryType: opts.deliveryType ?? 'STANDARD',
      idempotencyKey: `${RUN}-order-${n}`,
      paidAt: new Date(),
      addressSnapshot: {
        recipientName: 'Test Receiver',
        phone: '+96891234567',
        governorateId: governorate.id,
        governorateName: governorate.name,
        wilayaId: wilaya.id,
        wilayaSlug: wilaya.slug,
        wilayaName: wilaya.name,
        area: 'Al Khuwair',
        building: '12',
        lat: 23.588,
        lng: 58.3829,
      },
    },
  });
}

export async function createCourier(name = 'Test Courier') {
  const user = await createUser({ fullName: name });
  const courier = await prisma.courier.create({ data: { userId: user.id, name, phone: user.phone ?? '+96890000000' } });
  return { user, courier };
}

/** Real image bytes (sharp) for upload tests. */
export async function image(format: 'jpeg' | 'png' | 'webp' = 'jpeg', size = 64): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 8, g: 123, b: 255 } } })
    .toFormat(format)
    .toBuffer();
}

/** A HEIC-looking header (ISO-BMFF `ftypheic`). */
export function heicHeader(): Buffer {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(24, 0);
  b.write('ftypheic', 4, 'ascii');
  b.write('mif1heic', 16, 'ascii');
  return b;
}

export async function cleanup() {
  const ids = created.users;
  if (!ids.length) return;
  await prisma.kycAccessLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.supportTicket.deleteMany({ where: { userId: { in: ids } } });
  await prisma.order.deleteMany({ where: { userId: { in: ids } } });
  await prisma.courier.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.idempotencyRecord.deleteMany({ where: { userId: { in: ids } } });
  await prisma.rateLimit.deleteMany({ where: { OR: ids.map((id) => ({ key: { contains: id } })) } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  created.users = [];
}
