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
      {/* Summary bar — neon progress with a HUD readout */}
      <div className="flex items-center justify-between gap-3">
        <span className="hud-label">{current >= 0 ? steps[current]?.label : label}</span>
        <span className="font-display neon text-sm font-bold tabular-nums text-accent" dir="ltr" aria-hidden="true">
          {String(Math.max(0, current + 1)).padStart(2, '0')}/{String(total).padStart(2, '0')}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-valuetext={current >= 0 ? steps[current]?.label : undefined}
        className="relative mt-2 h-2.5 overflow-hidden rounded-pill border border-blue/15 bg-surface-2 dark:border-cyan/20 dark:bg-night/40"
      >
        <div
          className={cn(
            'relative h-full overflow-hidden rounded-pill transition-[width] duration-(--dur-banner) ease-premium',
            failed
              ? 'bg-error shadow-[0_0_14px_rgb(229_72_77/0.7)]'
              : current === total - 1
                ? 'bg-success shadow-[0_0_14px_rgb(22_166_115/0.7)]'
                : 'bg-gradient-primary shadow-[0_0_16px_rgb(0_217_255/0.75)]',
          )}
          style={{ width: shown ? `${Math.max(pct, current >= 0 ? 6 : 0)}%` : '0%' }}
        >
          <span aria-hidden="true" className="doom-timeline-scan absolute inset-y-0 w-1/3 motion-reduce:hidden" />
        </div>
      </div>

      <style>{`@keyframes doom-timeline-scan{from{transform:translateX(-120%)}to{transform:translateX(320%)}}.doom-timeline-scan{inset-inline-start:0;background:linear-gradient(90deg,transparent,rgb(255 255 255/.55),transparent);animation:doom-timeline-scan 2.4s var(--ease-premium) infinite}[dir=rtl] .doom-timeline-scan{animation-direction:reverse}`}</style>
      <ol className="relative mt-6" aria-label={label}>
        {/* Rail */}
        <span aria-hidden="true" className="absolute inset-y-5 start-5 w-0.5 -translate-x-1/2 rounded-pill bg-border [background-image:repeating-linear-gradient(to_bottom,transparent_0_6px,rgb(0_217_255/0.25)_6px_8px)] rtl:translate-x-1/2" />
        <span
          aria-hidden="true"
          className={cn(
            'absolute start-5 top-5 w-0.5 -translate-x-1/2 rounded-pill transition-[height] duration-(--dur-banner) ease-premium rtl:translate-x-1/2',
            failed ? 'bg-error shadow-[0_0_10px_rgb(229_72_77/0.7)]' : 'bg-gradient-primary shadow-[0_0_12px_rgb(0_217_255/0.8)]',
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
                  done && 'border-transparent bg-success text-on-accent shadow-[0_0_14px_rgb(22_166_115/0.55)]',
                  isCurrent && !failed && 'neon-box border-transparent bg-gradient-primary text-on-accent',
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
