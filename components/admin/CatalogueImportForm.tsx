'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/lib/admin/action';
import { importCatalogueAction } from '@/app/[locale]/admin/products/import/actions';
import { AdminForm, FInput, useFormCtx } from './AdminForm';

function FileField({ label, hint }: { label: string; hint: string }) {
  const { fieldError } = useFormCtx();
  const error = fieldError('file');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="catalogue-file" className="text-sm font-medium">
        {label}
      </label>
      <input
        id="catalogue-file"
        type="file"
        name="file"
        accept="application/json,.json"
        required
        aria-invalid={error ? true : undefined}
        aria-describedby="catalogue-file-hint"
        className="block w-full min-w-0 rounded-xl border border-border bg-surface text-sm file:me-3 file:min-h-11 file:cursor-pointer file:border-0 file:bg-surface-2 file:px-4 file:text-sm file:font-semibold file:text-fg"
        data-testid="catalogue-file"
      />
      <p id="catalogue-file-hint" className="text-xs text-muted">
        {hint}
      </p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-error" data-testid="catalogue-file-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Upload a catalogue pack; shows what the import did (created / refreshed drafts). */
export function CatalogueImportForm() {
  const t = useTranslations('admin.import');
  const [result, setResult] = useState<ActionState['data'] | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <AdminForm action={importCatalogueAction} submitLabel={t('submit')} testId="catalogue-import-form" encType="multipart/form-data" onSuccess={(s) => setResult(s.data ?? null)} className="flex flex-col gap-4">
        <FileField label={t('file')} hint={t('fileHint')} />
        <FInput name="batch" label={t('batch')} hint={t('batchHint')} maxLength={60} autoComplete="off" />
      </AdminForm>
      {result ? (
        <div role="status" className="flex items-start gap-3 rounded-card border border-success/40 bg-success/10 p-4 text-sm" data-testid="catalogue-import-result">
          <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="font-semibold">{t('done', { total: Number(result.total ?? 0) })}</p>
            <p>{t('doneDetail', { created: Number(result.created ?? 0), refreshed: Number(result.refreshed ?? 0) })}</p>
            {result.brandsCreated ? <p>{t('brandsCreated', { brands: String(result.brandsCreated) })}</p> : null}
            <Link href="/admin/products?status=DRAFT" className="mt-1 inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline">
              {t('seeDrafts')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
