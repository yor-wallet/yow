import { z } from 'zod';
import type { Address, Governorate, Wilaya } from '@prisma/client';
import { prisma, type Db } from '../db';
import { addressInputSchema, OMAN_BOUNDS } from '../validation';
import { isLocalizedText, type LocalizedText } from '../localized';

/**
 * Customer address book + the address snapshot contract stored on `Order.addressSnapshot`.
 * Storefront checkout builds the snapshot with `toAddressSnapshot(address)` so delivery
 * (capacity per zone, courier view, tracking) can read it with `parseAddressSnapshot`.
 */

export const MAX_ADDRESSES_PER_USER = 20;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'too_long')
    .optional()
    .transform((v) => (v ? v : undefined));

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : typeof v === 'string' ? Number(v) : v),
  z.number({ invalid_type_error: 'location_invalid' }).finite('location_invalid').optional(),
);

/** Address form schema (server side). Coordinates optional, both-or-none, inside Oman. */
export const addressSchema = addressInputSchema
  .extend({
    label: optionalText(40),
    street: optionalText(120),
    instructions: optionalText(500),
    lat: optionalNumber,
    lng: optionalNumber,
    neighborhoodId: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.string().min(1).max(64).optional()),
  })
  .superRefine((v, ctx) => {
    const hasLat = v.lat !== undefined;
    const hasLng = v.lng !== undefined;
    if (hasLat !== hasLng) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lat'], message: 'location_invalid' });
    if (hasLat && hasLng) {
      const inside =
        v.lat! >= OMAN_BOUNDS.minLat && v.lat! <= OMAN_BOUNDS.maxLat && v.lng! >= OMAN_BOUNDS.minLng && v.lng! <= OMAN_BOUNDS.maxLng;
      if (!inside) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lat'], message: 'location_outside_oman' });
    }
  });

export type AddressFormInput = z.input<typeof addressSchema>;
export type AddressData = z.output<typeof addressSchema>;

export class AddressError extends Error {
  constructor(public readonly code: 'not_found' | 'wilaya_mismatch' | 'neighborhood_mismatch' | 'limit_reached') {
    super(code);
    this.name = 'AddressError';
  }
}

export type AddressWithGeo = Address & { governorate: Governorate; wilaya: Wilaya };

const withGeo = { governorate: true, wilaya: true } as const;

export async function listAddresses(userId: string, db: Db = prisma): Promise<AddressWithGeo[]> {
  return db.address.findMany({
    where: { userId, deletedAt: null },
    include: withGeo,
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });
}

export async function getAddress(userId: string, id: string, db: Db = prisma): Promise<AddressWithGeo | null> {
  return db.address.findFirst({ where: { id, userId, deletedAt: null }, include: withGeo });
}

export async function getDefaultAddress(userId: string, db: Db = prisma): Promise<AddressWithGeo | null> {
  return db.address.findFirst({
    where: { userId, deletedAt: null },
    include: withGeo,
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });
}

async function assertWilaya(data: AddressData, db: Db) {
  const w = await db.wilaya.findUnique({ where: { id: data.wilayaId }, select: { governorateId: true } });
  if (!w || w.governorateId !== data.governorateId) throw new AddressError('wilaya_mismatch');
}

/** "المعبيلة الجنوبية · Al Mabelah South": readable by the customer, the courier and staff in either language. */
export function neighborhoodLabel(name: unknown): string {
  const n = (name ?? {}) as { ar?: string; en?: string };
  return [n.ar, n.en].filter((v, i, all) => !!v && all.indexOf(v) === i).join(' · ');
}

/**
 * A neighbourhood picked from the list must belong to the wilaya; `area` is then written from the
 * reference names (never from the client), so the snapshot kept on orders is always the official one.
 */
async function resolveArea(data: AddressData, db: Db): Promise<{ neighborhoodId: string | null; area: string }> {
  if (!data.neighborhoodId) return { neighborhoodId: null, area: data.area };
  const n = await db.neighborhood.findUnique({ where: { id: data.neighborhoodId }, select: { wilayaId: true, name: true } });
  if (!n || n.wilayaId !== data.wilayaId) throw new AddressError('neighborhood_mismatch');
  return { neighborhoodId: data.neighborhoodId, area: neighborhoodLabel(n.name) };
}

function toRow(data: AddressData) {
  return {
    label: data.label ?? null,
    recipientName: data.recipientName,
    phone: data.phone,
    governorateId: data.governorateId,
    wilayaId: data.wilayaId,
    area: data.area,
    street: data.street ?? null,
    building: data.building,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    instructions: data.instructions ?? null,
  };
}

/** Create an address (validated). The first address becomes the default. */
export async function createAddress(userId: string, input: unknown): Promise<AddressWithGeo> {
  const data = addressSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await assertWilaya(data, tx);
    const place = await resolveArea(data, tx);
    const count = await tx.address.count({ where: { userId, deletedAt: null } });
    if (count >= MAX_ADDRESSES_PER_USER) throw new AddressError('limit_reached');
    const makeDefault = data.isDefault === true || count === 0;
    if (makeDefault) await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    return tx.address.create({ data: { userId, ...toRow(data), ...place, isDefault: makeDefault }, include: withGeo });
  });
}

export async function updateAddress(userId: string, id: string, input: unknown): Promise<AddressWithGeo> {
  const data = addressSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new AddressError('not_found');
    await assertWilaya(data, tx);
    const place = await resolveArea(data, tx);
    const makeDefault = data.isDefault === true || existing.isDefault;
    if (data.isDefault === true && !existing.isDefault) {
      await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.address.update({ where: { id }, data: { ...toRow(data), ...place, isDefault: makeDefault }, include: withGeo });
  });
}

/** Soft delete (orders keep their own snapshot). Promotes another address to default if needed. */
export async function deleteAddress(userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new AddressError('not_found');
    await tx.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
    if (existing.isDefault) {
      const next = await tx.address.findFirst({ where: { userId, deletedAt: null }, orderBy: { updatedAt: 'desc' } });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

export async function setDefaultAddress(userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new AddressError('not_found');
    await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    await tx.address.update({ where: { id }, data: { isDefault: true } });
  });
}

// ───────────── Order address snapshot ─────────────

export type AddressSnapshot = {
  addressId?: string;
  recipientName: string;
  phone: string;
  governorateId: string;
  governorateCode?: string;
  governorateName?: LocalizedText;
  wilayaId: string;
  wilayaSlug?: string;
  wilayaName?: LocalizedText;
  area: string;
  street?: string | null;
  building: string;
  lat?: number | null;
  lng?: number | null;
  instructions?: string | null;
};

/** Snapshot an address for `Order.addressSnapshot` (keeps names so later renames don't alter history). */
export function toAddressSnapshot(a: AddressWithGeo): AddressSnapshot {
  return {
    addressId: a.id,
    recipientName: a.recipientName,
    phone: a.phone,
    governorateId: a.governorateId,
    governorateCode: a.governorate.code,
    governorateName: a.governorate.name as LocalizedText,
    wilayaId: a.wilayaId,
    wilayaSlug: a.wilaya.slug,
    wilayaName: a.wilaya.name as LocalizedText,
    area: a.area,
    street: a.street,
    building: a.building,
    lat: a.lat,
    lng: a.lng,
    instructions: a.instructions,
  };
}

/** Tolerant reader for `Order.addressSnapshot` (null when unusable). */
export function parseAddressSnapshot(value: unknown): AddressSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
  const num = (k: string) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : null);
  const recipientName = str('recipientName') ?? str('fullName') ?? str('name');
  const governorateId = str('governorateId');
  const wilayaId = str('wilayaId');
  if (!recipientName || !governorateId || !wilayaId) return null;
  return {
    addressId: str('addressId') ?? str('id'),
    recipientName,
    phone: str('phone') ?? '',
    governorateId,
    governorateCode: str('governorateCode'),
    governorateName: isLocalizedText(v.governorateName) ? v.governorateName : undefined,
    wilayaId,
    wilayaSlug: str('wilayaSlug'),
    wilayaName: isLocalizedText(v.wilayaName) ? v.wilayaName : undefined,
    area: str('area') ?? '',
    street: str('street') ?? null,
    building: str('building') ?? '',
    lat: num('lat'),
    lng: num('lng'),
    instructions: str('instructions') ?? null,
  };
}

/** OpenStreetMap link (no API key) for coordinates. */
export function osmLink(lat: number, lng: number, zoom = 17): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=${zoom}/${lat.toFixed(6)}/${lng.toFixed(6)}`;
}

/** Turn-by-turn navigation link for couriers (opens the device's maps app / browser). */
export function navigationLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
