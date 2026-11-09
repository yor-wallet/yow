'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/layout/BackButton';
import { Button } from '@/components/ui/Button';

/** Branded error boundary for every localised page. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.error');
  const tc = useTranslations('common.actions');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page-container grid min-h-[60dvh] place-items-center py-16" data-testid="error-page">
      <div className="flex max-w-lg flex-col items-center text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-gradient-premium text-orange shadow-glow-orange" aria-hidden="true">
          <TriangleAlert size={28} />
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-accent">{t('code')}</p>
        <h1 className="mt-2 text-3xl font-extrabold">{t('title')}</h1>
        <p className="mt-3 text-muted">{t('description')}</p>
        {error.digest ? <p className="mt-2 text-xs text-muted">{t('reference', { digest: error.digest })}</p> : null}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <BackButton fallbackHref="/" variant="text" className="border border-border" />
          <Button onClick={reset}>{tc('retry')}</Button>
        </div>
      </div>
    </div>
  );
}
