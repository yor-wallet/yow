import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { BackButton } from '@/components/layout/BackButton';
import { buttonClasses } from '@/components/ui/Button';

/** Branded, localised 404 (inside the site chrome). */
export default function NotFound() {
  const t = useTranslations('errors.notFound');
  const tc = useTranslations('common.actions');
  return (
    <div className="page-container grid min-h-[60dvh] place-items-center py-16" data-testid="not-found">
      <div className="flex max-w-lg flex-col items-center text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-gradient-premium text-cyan shadow-glow-blue" aria-hidden="true">
          <SearchX size={28} />
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-accent">{t('code')}</p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 text-muted">{t('description')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <BackButton fallbackHref="/" variant="text" className="border border-border" />
          <Link href="/" className={buttonClasses({ variant: 'primary' })}>
            {tc('goHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
