'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { IncidentType } from '@prisma/client';
import { getSession } from '@/lib/auth';
import { getCourierContext, getCourierShipment } from '@/lib/delivery/courier';
import { completeDelivery, DeliveryError, INCIDENT_TYPES, reportIncident, transitionShipment } from '@/lib/delivery/shipments';
import { IMAGE_MAX_BYTES } from '@/lib/delivery/images';

export type CourierActionResult =
  | { ok: true }
  | { ok: false; error: string; attemptsLeft?: number };

const idSchema = z.string().min(1).max(64);
const coord = z.coerce.number().finite().optional();

async function actorFor(shipmentId: string) {
  const session = await getSession();
  if (!session) return null;
  const ctx = await getCourierContext(session.user);
  if (!ctx) return null;
  const shipment = await getCourierShipment(ctx, shipmentId);
  if (!shipment) return null;
  return { actor: { id: session.user.id, role: session.user.role }, shipment };
}

function fail(err: unknown): CourierActionResult {
  if (err instanceof DeliveryError) return { ok: false, error: err.code };
  console.error('[courier] action failed', err);
  return { ok: false, error: 'generic' };
}

function refresh(id: string) {
  revalidatePath('/[locale]/courier', 'layout');
  revalidatePath(`/[locale]/courier/${id}`, 'page');
}

/** Courier picked the parcel up: COURIER_ASSIGNED → OUT_FOR_DELIVERY (issues the customer's handover code). */
export async function startDeliveryAction(shipmentId: string, coords?: { lat?: number; lng?: number }): Promise<CourierActionResult> {
  const id = idSchema.safeParse(shipmentId);
  if (!id.success) return { ok: false, error: 'not_found' };
  const ctx = await actorFor(id.data);
  if (!ctx) return { ok: false, error: 'not_found' };
  const lat = coord.safeParse(coords?.lat);
  const lng = coord.safeParse(coords?.lng);
  try {
    await transitionShipment({
      shipmentId: id.data,
      to: 'OUT_FOR_DELIVERY',
      actor: ctx.actor,
      lat: lat.success ? (lat.data ?? null) : null,
      lng: lng.success ? (lng.data ?? null) : null,
    });
    refresh(id.data);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Handover: OTP + receiver name + proof photo (multipart). */
export async function completeDeliveryAction(fd: FormData): Promise<CourierActionResult> {
  const id = idSchema.safeParse(fd.get('shipmentId'));
  if (!id.success) return { ok: false, error: 'not_found' };
  const otp = String(fd.get('otp') ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(otp)) return { ok: false, error: 'otp_format' };
  const receiverName = String(fd.get('receiverName') ?? '');
  const photo = fd.get('photo');
  if (!(photo instanceof File) || photo.size === 0) return { ok: false, error: 'photo_required' };
  if (photo.size > IMAGE_MAX_BYTES) return { ok: false, error: 'photo_invalid' };
  const ctx = await actorFor(id.data);
  if (!ctx) return { ok: false, error: 'not_found' };
  const lat = coord.safeParse(fd.get('lat') || undefined);
  const lng = coord.safeParse(fd.get('lng') || undefined);
  try {
    const res = await completeDelivery({
      shipmentId: id.data,
      otp,
      receiverName,
      photo: Buffer.from(await photo.arrayBuffer()),
      actor: ctx.actor,
      lat: lat.success ? (lat.data ?? null) : null,
      lng: lng.success ? (lng.data ?? null) : null,
    });
    refresh(id.data);
    if (!res.ok) return { ok: false, error: res.code, ...(res.code === 'otp_invalid' ? { attemptsLeft: res.attemptsLeft } : {}) };
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function failDeliveryAction(shipmentId: string, reason: string): Promise<CourierActionResult> {
  const id = idSchema.safeParse(shipmentId);
  if (!id.success) return { ok: false, error: 'not_found' };
  const note = reason.trim().slice(0, 500);
  if (note.length < 3) return { ok: false, error: 'description_required' };
  const ctx = await actorFor(id.data);
  if (!ctx) return { ok: false, error: 'not_found' };
  try {
    await transitionShipment({ shipmentId: id.data, to: 'FAILED', actor: ctx.actor, note });
    refresh(id.data);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reportIncidentAction(shipmentId: string, type: string, description: string): Promise<CourierActionResult> {
  const id = idSchema.safeParse(shipmentId);
  if (!id.success) return { ok: false, error: 'not_found' };
  if (!(INCIDENT_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'generic' };
  const ctx = await actorFor(id.data);
  if (!ctx) return { ok: false, error: 'not_found' };
  try {
    await reportIncident({ shipmentId: id.data, type: type as IncidentType, description: description.slice(0, 1000), actor: ctx.actor });
    refresh(id.data);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
