'use client';

import { useTransition } from 'react';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useHistoryModal } from '@/components/ui/useHistoryModal';
import { cn } from '@/lib/cn';
import { setDeliveryAreaAction } from './area-actions';

export type AreaChoice = { code: string; label: string };

/**
 * "Deliver to Muscat" selector shown above the search on browsing pages. It remembers the governorate the
 * shopper is interested in (cookie) so product pages and the cart can show that zone's real delivery times
 * and fees. It never replaces the address chosen at checkout.
 */
export function DeliverTo({ options, current, className }: { options: AreaChoice[]; current: AreaChoice | null; className?: string }) {
  const t = useTranslations('nav.deliver');
  const router = useRouter();
  const sheet = useHistoryModal('deliver-to');
  const [pending, start] = useTransition();

  const choose = (code: string | null) =>
    start(async () => {
      await setDeliveryAreaAction(code);
      sheet.closeThen(() => router.refresh());
    });

  return (
    <>
      <button
        type="button"
        onClick={sheet.open}
        aria-haspopup="dialog"
        data-testid="deliver-to"
        className={cn('flex min-h-11 max-w-full items-center gap-2 rounded-xl px-1 text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-ring', className)}
      >
        <MapPin size={18} aria-hidden="true" className="shrink-0 text-orange" />
        <span className="truncate" data-testid="deliver-to-label">
          {current ? t('label', { area: current.label }) : t('choose')}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted" />
      </button>
      <BottomSheet {...sheet.props} title={t('title')} description={t('hint')}>
        <ul className="flex flex-col gap-2" data-testid="area-list" aria-busy={pending || undefined}>
          {options.map((o) => {
            const active = o.code === current?.code;
            return (
              <li key={o.code}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => (active ? sheet.close() : choose(o.code))}
                  aria-pressed={active}
                  data-testid={`area-option-${o.code}`}
                  className={cn(
                    'flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-start text-base font-semibold transition-colors',
                    active ? 'border-blue bg-blue/10' : 'border-border hover:bg-surface-2',
                  )}
                >
                  <span>{o.label}</span>
                  {active ? <Check size={18} aria-hidden="true" className="text-accent" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {current ? (
          <button type="button" onClick={() => choose(null)} disabled={pending} className="mt-3 min-h-11 text-sm font-semibold text-accent underline-offset-4 hover:underline" data-testid="area-clear">
            {t('clear')}
          </button>
        ) : null}
      </BottomSheet>
    </>
  );
}
