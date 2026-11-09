import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Progress stepper (checkout, KYC, FLEX). `current` is 0-based.
 * Small screens: compact "Step x of y" + current label + progress bar; md+: full row.
 */
export function Stepper({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  const t = useTranslations('common.stepper');
  const total = steps.length;
  const clamped = Math.min(Math.max(current, 0), total - 1);
  return (
    <nav aria-label={t('progress', { current: clamped + 1, total })} className={className}>
      <div className="md:hidden">
        <p className="text-xs font-medium text-muted">{t('progress', { current: clamped + 1, total })}</p>
        <p className="mt-0.5 font-semibold text-fg">{steps[clamped]}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
          <div
            className="h-full rounded-pill bg-gradient-primary transition-[width] duration-(--dur-nav)"
            style={{ width: `${((clamped + 1) / total) * 100}%` }}
          />
        </div>
      </div>
      <ol className="hidden items-center gap-2 md:flex">
        {steps.map((label, i) => {
          const done = i < clamped;
          const isCurrent = i === clamped;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={isCurrent ? 'step' : undefined}>
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                  done && 'bg-success text-on-accent',
                  isCurrent && 'bg-gradient-primary text-on-accent shadow-glow-blue',
                  !done && !isCurrent && 'border border-border-strong text-muted',
                )}
              >
                {done ? <Check size={16} aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn('truncate text-sm', isCurrent ? 'font-semibold text-fg' : 'text-muted')}>
                {label}
                {done ? <span className="sr-only"> ({t('completed')})</span> : null}
              </span>
              {i < total - 1 ? <span aria-hidden="true" className={cn('h-px min-w-4 flex-1', done ? 'bg-success' : 'bg-border')} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
