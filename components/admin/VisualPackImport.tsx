'use client';

import { useState } from 'react';
import { CheckCircle2, ImageDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { importVisualPackStepAction } from '@/app/[locale]/admin/products/import/actions';
import type { VisualPackKey } from '@/lib/admin/visual-pack-import';

type Phase = { kind: 'idle' } | { kind: 'running'; done: number; model: string } | { kind: 'done'; variants: number; images: number } | { kind: 'failed' };

/**
 * Imports a pack shipped with the site, one model per request (each one optimises several images),
 * with a progress bar. Safe to start again: models already imported add nothing.
 */
export function VisualPackImport({
  packKey,
  models,
  images,
  verifiedOn,
  origin,
}: {
  packKey: VisualPackKey;
  models: number;
  images: number;
  verifiedOn: string;
  origin: 'author' | 'owner';
}) {
  const t = useTranslations('admin.import.packs');
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const run = async () => {
    let variants = 0;
    let pictures = 0;
    setPhase({ kind: 'running', done: 0, model: '…' });
    for (let i = 0; i < models; i++) {
      const res = await importVisualPackStepAction(packKey, i).catch(() => null);
      if (!res || !res.ok) {
        setPhase({ kind: 'failed' });
        return;
      }
      variants += res.step.variantsCreated;
      pictures += res.step.imagesCreated;
      setPhase({ kind: 'running', done: res.step.done, model: res.step.model });
    }
    setPhase({ kind: 'done', variants, images: pictures });
    router.refresh();
  };

  const running = phase.kind === 'running';
  return (
    <div className="rounded-card border border-border bg-surface p-4" data-testid="visual-pack" data-pack={packKey}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{t(`names.${packKey}`)}</p>
          <p className="text-sm text-muted">{t(origin === 'owner' ? 'summaryOwner' : 'summary', { models, images, date: verifiedOn })}</p>
        </div>
        <Button type="button" variant="primary" size="sm" onClick={run} loading={running} disabled={running} leadingIcon={<ImageDown size={18} aria-hidden="true" />} data-testid="visual-pack-start">
          {t('start')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">{t('note')}</p>

      {running ? (
        <div className="mt-3" role="status" aria-live="polite" data-testid="visual-pack-progress">
          <div className="h-2 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
            <div className="h-full rounded-pill bg-gradient-primary transition-[width] duration-(--dur-nav)" style={{ width: `${Math.round((phase.done / models) * 100)}%` }} />
          </div>
          <p className="mt-1 text-sm">{t('running', { done: phase.done, total: models, model: phase.model })}</p>
        </div>
      ) : null}
      {phase.kind === 'done' ? (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm" data-testid="visual-pack-done">
          <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
          <span>
            {phase.variants + phase.images === 0 ? t('nothingNew') : t('done', { variants: phase.variants, images: phase.images })}{' '}
            <Link href="/admin/products?status=DRAFT" className="font-semibold text-accent underline-offset-4 hover:underline">
              →
            </Link>
          </span>
        </p>
      ) : null}
      {phase.kind === 'failed' ? (
        <p role="alert" className="mt-3 text-sm font-medium text-error" data-testid="visual-pack-failed">
          {t('failed')}
        </p>
      ) : null}
    </div>
  );
}
