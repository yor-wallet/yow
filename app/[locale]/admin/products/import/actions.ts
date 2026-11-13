'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { currentActor, errorState, runAdminAction, type ActionState } from '@/lib/admin/action';
import { ValidationError } from '@/lib/admin/actor';
import { importCatalogue, parseCataloguePack } from '@/lib/admin/catalogue-import';
import { importVerifiedCatalogue } from '@/lib/admin/catalogue-verified';
import { applyVariantImport, previewVariantImport } from '@/lib/admin/variant-pricing';
import { text } from '@/lib/admin/form';
import { CATALOG_TAG } from '@/lib/catalog/cache';
import { importVisualPackModel, VISUAL_PACKS, type VisualImportStep } from '@/lib/admin/visual-pack-import';

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

/**
 * Apply the verified 2026 catalogue shipped with the code (facts from official manufacturer pages):
 * products, specifications and the colour x capacity variants the sources confirm — never a price,
 * a stock quantity, a photo or a review. `publish` also activates the fully verified models.
 */
export async function applyVerifiedCatalogueAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await currentActor();
    const mod = (await import('@/data/catalogue/verified-catalogue-2026.json')) as unknown as { default?: { models: unknown[] }; models?: unknown[] };
    const models = mod.default?.models ?? mod.models ?? [];
    const res = await importVerifiedCatalogue(actor, { models, publish: fd.get('publish') === 'on' });
    revalidatePath('/[locale]/admin/products', 'page');
    revalidateTag(CATALOG_TAG);
    return { status: 'success', code: 'verifiedApplied', data: { ...res, brandsCreated: res.brandsCreated.join(', ') }, at: Date.now() };
  } catch (err) {
    return errorState(err);
  }
}

/** CSV price & stock import: a dry run first (never writes), then an atomic, audited apply. */

export async function previewImportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const preview = await previewVariantImport(await currentActor(), { csv: text(fd, 'csv') ?? '' });
    return { status: 'success', code: 'importChecked', data: preview as unknown as Record<string, unknown>, at: Date.now() };
  } catch (err) {
    return errorState(err);
  }
}

export async function applyImportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAdminAction(
    applyVariantImport,
    { csv: text(fd, 'csv') ?? '', idempotencyKey: text(fd, 'idempotencyKey') },
    { successCode: 'importApplied', idempotent: true, idempotencyKey: text(fd, 'idempotencyKey'), data: (r) => r },
  );
  if (state.status === 'success') revalidateTag(CATALOG_TAG);
  return state;
}

/**
 * Import one model of a visual pack shipped with the code (called in a loop by the client, which
 * shows the progress). Creates draft variants and images only: no price, no stock, nothing published.
 */
export async function importVisualPackStepAction(key: string, index: number): Promise<{ ok: true; step: VisualImportStep } | { ok: false; code: string }> {
  try {
    const actor = await currentActor();
    const pack = VISUAL_PACKS.find((p) => p.key === key);
    if (!pack || !Number.isInteger(index) || index < 0 || index > 500) return { ok: false, code: 'not_found' };
    const step = await importVisualPackModel(actor, pack.key, index);
    if (step.done >= step.total) revalidatePath('/', 'layout');
    return { ok: true, step };
  } catch (err) {
    return { ok: false, code: errorState(err).code ?? 'generic' };
  }
}
