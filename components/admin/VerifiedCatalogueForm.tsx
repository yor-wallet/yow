'use client';

import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ActionState } from '@/lib/admin/action';
import { AdminForm, FCheckbox } from './AdminForm';

/** One click: apply the verified catalogue (facts from official pages). Shows exactly what changed. */
export function VerifiedCatalogueForm({ action }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const t = useTranslations('admin.verified');
  const [result, setResult] = useState<ActionState['data'] | null>(null);
  const n = (k: string) => Number(result?.[k] ?? 0);
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-muted" data-testid="verified-rules">
        {(['facts', 'variants', 'noPrice', 'drafts'] as const).map((k) => (
          <li key={k}>{t(`rules.${k}`)}</li>
        ))}
      </ul>
      <AdminForm action={action} submitLabel={t('apply')} testId="verified-form" onSuccess={(s) => setResult(s.data ?? null)}>
        <FCheckbox name="publish" label={t('publish')} hint={t('publishHint')} />
      </AdminForm>
      {result ? (
        <div role="status" className="flex items-start gap-3 rounded-card border border-success/40 bg-success/10 p-4 text-sm" data-testid="verified-result">
          <BadgeCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="font-semibold">{t('done', { created: n('productsCreated'), updated: n('productsUpdated') })}</p>
            <p>{t('doneVariants', { variants: n('variantsCreated'), published: n('published') })}</p>
            <p>{t('doneDrafts', { awaiting: n('draftsAwaitingMatrix'), unverified: n('unverified') })}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
