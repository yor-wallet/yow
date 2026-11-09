'use client';

import { useEffect, useState } from 'react';
import { Check, CircleAlert, PackageCheck, PackageOpen, Package, Truck, UserCheck, BadgeCheck, type LucideIcon } from 'lucide-react';
import type { ShipmentStatus } from '@prisma/client';
import { cn } from '@/lib/cn';

export type TimelineStep = {
  status: ShipmentStatus;
  label: string;
  hint: string;
  /** Pre-formatted time of the step, when reached. */
  at?: string | null;
};

const ICONS: Record<ShipmentStatus, LucideIcon> = {
  CONFIRMED: BadgeCheck,
  PREPARING: PackageOpen,
  PACKED: Package,
  COURIER_ASSIGNED: UserCheck,
  OUT_FOR_DELIVERY: Truck,
  DELIVERED: PackageCheck,
  FAILED: CircleAlert,
};

/**
 * Animated delivery timeline. The progress rail fills up to the current step after
 * mount (transition — instant with reduced motion). Vertical, RTL-safe (logical props).
 */
export function ShipmentTimeline({
  steps,
  current,
  failed = false,
  label,
  doneLabel,
  currentLabel,
}: {
  steps: TimelineStep[];
  /** Index of the current step (-1 = none reached). */
  current: number;
  failed?: boolean;
  label: string;
  doneLabel: string;
  currentLabel: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const total = steps.length;
  const ratio = total > 1 ? Math.max(0, current) / (total - 1) : 0;
  const pct = Math.round(ratio * 100);

  return (
    <div className="min-w-0" data-testid="shipment-timeline" data-current={current >= 0 ? steps[current]?.status : 'NONE'}>
      {/* Summary bar */}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-valuetext={current >= 0 ? steps[current]?.label : undefined}
        className="h-2 overflow-hidden rounded-pill bg-surface-2"
      >
        <div
          className={cn(
            'h-full rounded-pill transition-[width] duration-[1200ms] ease-premium',
            failed ? 'bg-error' : current === total - 1 ? 'bg-success' : 'bg-gradient-primary',
          )}
          style={{ width: shown ? `${Math.max(pct, current >= 0 ? 6 : 0)}%` : '0%' }}
        />
      </div>

      <ol className="relative mt-6" aria-label={label}>
        {/* Rail */}
        <span aria-hidden="true" className="absolute inset-y-5 start-5 w-0.5 -translate-x-1/2 rounded-pill bg-border rtl:translate-x-1/2" />
        <span
          aria-hidden="true"
          className={cn(
            'absolute start-5 top-5 w-0.5 -translate-x-1/2 rounded-pill transition-[height] duration-[1200ms] ease-premium rtl:translate-x-1/2',
            failed ? 'bg-error' : 'bg-gradient-primary',
          )}
          style={{ height: shown ? `calc((100% - 2.5rem) * ${ratio})` : '0px' }}
        />
        {steps.map((step, i) => {
          const done = i < current || (i === current && i === total - 1 && !failed);
          const isCurrent = i === current && !done;
          const reached = i <= current;
          const Icon = failed && i === current ? ICONS.FAILED : ICONS[step.status];
          return (
            <li
              key={step.status}
              className="relative flex gap-4 pb-6 last:pb-0"
              aria-current={isCurrent ? 'step' : undefined}
              data-step={step.status}
              data-reached={reached || undefined}
            >
              <span
                className={cn(
                  'relative z-10 grid size-10 shrink-0 place-items-center rounded-full border transition-[background-color,box-shadow,border-color] duration-(--dur-card)',
                  done && 'border-transparent bg-success text-on-accent',
                  isCurrent && !failed && 'border-transparent bg-gradient-primary text-on-accent shadow-glow-cyan',
                  isCurrent && failed && 'border-transparent bg-error text-on-accent',
                  !reached && 'border-border-strong bg-surface text-muted',
                )}
                style={{ transitionDelay: shown ? `${i * 90}ms` : undefined }}
              >
                {isCurrent && !failed ? (
                  <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-cyan/30 motion-reduce:hidden" />
                ) : null}
                {done ? <Check size={18} aria-hidden="true" /> : <Icon size={18} aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1 pt-1.5">
                <p className={cn('font-semibold', reached ? 'text-fg' : 'text-muted')}>
                  {step.label}
                  {done ? <span className="sr-only"> ({doneLabel})</span> : null}
                  {isCurrent ? <span className="sr-only"> ({currentLabel})</span> : null}
                </p>
                {reached ? <p className="mt-0.5 text-sm text-muted">{step.hint}</p> : null}
                {step.at ? (
                  <p className="mt-0.5 text-xs text-muted" dir="auto">
                    {step.at}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
