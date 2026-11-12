'use server';

import { revalidatePath } from 'next/cache';
import { currentActor, errorState, type ActionState } from '@/lib/admin/action';
import { ValidationError } from '@/lib/admin/actor';
import { importCatalogue, parseCataloguePack } from '@/lib/admin/catalogue-import';
import { text } from '@/lib/admin/form';

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Import a catalogue pack (JSON) as DRAFT products. RBAC, validation and audit live in
 * lib/admin/catalogue-import.ts; nothing is priced, stocked or published by an import.
 */
export async function importCatalogueAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await currentActor();
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: ['required'] });
    if (file.size > MAX_BYTES) throw new ValidationError({ file: ['file_too_large'] });
    const items = parseCataloguePack(await file.text());
    if (!items) throw new ValidationError({ file: ['file_invalid'] });
    const batch = text(fd, 'batch') || file.name.replace(/\.json$/i, '').slice(0, 60) || 'import';
    const res = await importCatalogue(actor, { batch, items }).catch((err) => {
      // A schema error on any model rejects the whole file: point at the file field.
      if (err instanceof ValidationError && !err.fieldErrors?.file) throw new ValidationError({ file: ['file_invalid'] });
      throw err;
    });
    revalidatePath('/[locale]/admin/products', 'page');
    return { status: 'success', code: 'imported', data: { created: res.created, refreshed: res.refreshed, total: res.total, brandsCreated: res.brandsCreated.join(', ') }, at: Date.now() };
  } catch (err) {
    return errorState(err);
  }
}
