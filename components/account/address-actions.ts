'use server';

import { ZodError } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { AddressError, createAddress, deleteAddress, setDefaultAddress, updateAddress, type AddressWithGeo } from '@/lib/delivery/addresses';
import { fieldErrorsOf, type FieldErrors } from '@/lib/validation';
import type { LocalizedText } from '@/lib/localized';

/** Address returned to client components after a save (checkout reuses it). */
export type SavedAddress = {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  governorateId: string;
  governorateName: LocalizedText;
  wilayaId: string;
  wilayaName: LocalizedText;
  area: string;
  street: string | null;
  building: string;
  lat: number | null;
  lng: number | null;
  instructions: string | null;
  isDefault: boolean;
};

export type SaveAddressResult =
  | { ok: true; address: SavedAddress }
  | { ok: false; error: 'unauthenticated' | 'not_found' | 'wilaya_mismatch' | 'neighborhood_mismatch' | 'limit_reached' | 'validation' | 'generic'; fieldErrors?: FieldErrors };

function toSaved(a: AddressWithGeo): SavedAddress {
  return {
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    governorateId: a.governorateId,
    governorateName: a.governorate.name as LocalizedText,
    wilayaId: a.wilayaId,
    wilayaName: a.wilaya.name as LocalizedText,
    area: a.area,
    street: a.street,
    building: a.building,
    lat: a.lat,
    lng: a.lng,
    instructions: a.instructions,
    isDefault: a.isDefault,
  };
}

/** Create (no id) or update an address of the signed-in user. Validated server-side (zod). */
export async function saveAddressAction(input: { id?: string; data: Record<string, unknown> }): Promise<SaveAddressResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  try {
    const address = input.id
      ? await updateAddress(session.user.id, String(input.id), input.data)
      : await createAddress(session.user.id, input.data);
    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: input.id ? 'address.update' : 'address.create',
      entity: 'Address',
      entityId: address.id,
    });
    revalidatePath('/[locale]/account/addresses', 'page');
    return { ok: true, address: toSaved(address) };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, error: 'validation', fieldErrors: fieldErrorsOf(err) };
    if (err instanceof AddressError) {
      if (err.code === 'neighborhood_mismatch') return { ok: false, error: 'neighborhood_mismatch', fieldErrors: { neighborhoodId: ['neighborhood_mismatch'] } };
      return err.code === 'wilaya_mismatch'
        ? { ok: false, error: 'wilaya_mismatch', fieldErrors: { wilayaId: ['wilaya_mismatch'] } }
        : { ok: false, error: err.code };
    }
    console.error('[address] save failed', err);
    return { ok: false, error: 'generic' };
  }
}

export async function deleteAddressAction(id: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  try {
    await deleteAddress(session.user.id, String(id));
    await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'address.delete', entity: 'Address', entityId: String(id) });
    revalidatePath('/[locale]/account/addresses', 'page');
    return { ok: true };
  } catch (err) {
    if (!(err instanceof AddressError)) console.error('[address] delete failed', err);
    return { ok: false };
  }
}

export async function setDefaultAddressAction(id: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  try {
    await setDefaultAddress(session.user.id, String(id));
    revalidatePath('/[locale]/account/addresses', 'page');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
