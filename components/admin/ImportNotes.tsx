import { getTranslations } from 'next-intl/server';
import { AlertTriangle } from 'lucide-react';
import type { ImportMeta } from '@/lib/admin/catalogue-import';
import { Section } from './ui';

/**
 * Notes of the catalogue import on a product: the candidate colours and capacities are NOT verified.
 * Staff check the official page, then create only the SKUs that really exist. Admin-only.
 */
export async function ImportNotes({ meta }: { meta: ImportMeta }) {
  const t = await getTranslations('admin.importNotes');
  return (
    <Section id="import-notes" title={t('title')} className="border border-amber/40">
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-amber/10 p-3 text-sm font-medium" data-testid="import-warning">
        <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-amber" />
        {t('warning')}
      </p>
      {meta.toVerify ? (
        <div className="mb-4 rounded-xl border border-amber/40 p-3 text-sm" data-testid="import-to-verify">
          <p className="font-semibold">{t('toVerify')}</p>
          {/* Written by the pack's author (in French): keep its own language and direction. */}
          <p lang="fr" dir="auto" className="mt-1">
            {meta.toVerify}
          </p>
        </div>
      ) : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="import-notes">
        <div>
          <dt className="text-muted">{t('batch')}</dt>
          <dd className="font-semibold [unicode-bidi:plaintext]">{meta.batch}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('series')}</dt>
          <dd className="font-semibold [unicode-bidi:plaintext]">{[meta.series, meta.year].filter(Boolean).join(' · ') || t('unknown')}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('storage')}</dt>
          <dd className="font-semibold [unicode-bidi:plaintext]">{meta.candidateStorageGb.length > 0 ? meta.candidateStorageGb.map((g) => (g >= 1024 ? `${g / 1024} TB` : `${g} GB`)).join(' · ') : t('unknown')}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('colors')}</dt>
          <dd className="font-semibold [unicode-bidi:plaintext]">{meta.candidateColors.length > 0 ? meta.candidateColors.join(' · ') : t('unknown')}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted">{t('source')}</dt>
          <dd>
            {meta.sourceUrl ? (
              <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all font-semibold text-accent underline-offset-4 hover:underline">
                {meta.sourceUrl}
              </a>
            ) : (
              t('unknown')
            )}
          </dd>
        </div>
      </dl>
    </Section>
  );
}
