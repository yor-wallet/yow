'use server';

import { revalidatePath } from 'next/cache';
import { currentActor, errorState, runAdminAction, type ActionState } from '@/lib/admin/action';
import { ValidationError } from '@/lib/admin/actor';
import { fileToBuffer } from '@/lib/admin/media';
import { localizedText, productFormToRaw, text, textOrNull, variantFormToRaw } from '@/lib/admin/form';
import { addProductImage, createProduct, deleteProductImage, deleteVariant, saveVariant, setProductStatus, updateProduct } from '@/lib/admin/products';

/**
 * Server actions of the catalogue screens. Each one only translates the form into the raw input of a
 * mutation (RBAC, validation, transaction and audit live in `lib/admin/products.ts`) and maps the result to an
 * `ActionState` the client shows as a toast / field errors.
 */

export async function createProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(createProduct, productFormToRaw(fd), { successCode: 'created', redirectTo: (r) => `/admin/products/${r.id}` });
}

export async function updateProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(updateProduct, productFormToRaw(fd), { successCode: 'saved' });
}

export async function setProductStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(setProductStatus, { id: text(fd, 'id'), status: text(fd, 'status') }, { successCode: 'statusChanged' });
}

export async function saveVariantAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(saveVariant, variantFormToRaw(fd), { successCode: 'saved' });
}

export async function deleteVariantAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(deleteVariant, { id: text(fd, 'id') }, { successCode: 'deleted' });
}

export async function addProductImageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await currentActor();
    const file = await fileToBuffer(fd.get('file'));
    if (!file) throw new ValidationError({ file: ['empty'] });
    await addProductImage(actor, {
      productId: text(fd, 'productId') ?? '',
      variantId: textOrNull(fd, 'variantId'),
      file,
      alt: localizedText(fd, 'alt'),
    });
    revalidatePath('/', 'layout');
    return { status: 'success', code: 'uploaded', at: Date.now() };
  } catch (err) {
    return errorState(err);
  }
}

export async function deleteProductImageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(deleteProductImage, { id: text(fd, 'id') }, { successCode: 'deleted' });
}
