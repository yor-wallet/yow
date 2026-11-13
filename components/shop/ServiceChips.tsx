import { Truck, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * The two delivery promises under the hero: express within N hours / standard within N hours. The hours come
 * from the configured delivery zones (fastest configured zone); a promise that is not configured is NOT shown
 * (SPEC: promised times must match configured capacity), so a store with no zones simply has no chips.
 */
export function ServiceChips({ expressHours, standardHours }: { expressHours: number | null; standardHours: number | null }) {
  const t = useTranslations('home.chips');
  if (expressHours === null && standardHours === null) return null;
  const chip = 'flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-2.5 shadow-card transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return (
    <ul className="grid grid-cols-2 gap-3" data-testid="service-chips">
      {standardHours !== null ? (
        <li className="min-w-0">
          <Link href="/delivery" className={chip} data-testid="chip-standard">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-primary text-on-accent" aria-hidden="true">
              <Truck size={20} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-muted">{t('standardLabel')}</span>
              <span className="block truncate text-base font-extrabold">{t('hours', { count: standardHours })}</span>
            </span>
          </Link>
        </li>
      ) : null}
      {expressHours !== null ? (
        <li className="min-w-0">
          <Link href="/delivery" className={chip} data-testid="chip-express">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-primary text-on-accent" aria-hidden="true">
              <Zap size={20} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-muted">{t('expressLabel')}</span>
              <span className="block truncate text-base font-extrabold">{t('hours', { count: expressHours })}</span>
            </span>
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
