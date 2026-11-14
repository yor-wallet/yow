'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LazyMotion, animate, domAnimation, m } from 'motion/react';
import { CalendarDays, ChevronDown, Percent, ReceiptText, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { usePrefersReducedMotion } from '@/components/ui/Reveal';
import { cn } from '@/lib/cn';
import { computeSchedule, FLEX_MONTHS, type FlexMonths } from '@/lib/flex/schedule';
import { formatBaisa } from '@/lib/money';

const EASE = [0.2, 0.7, 0.2, 1] as const;

/** Counts from the previous value to `target` (integer baisa); immediate under reduced motion. */
function useTweened(target: number, reduce: boolean): number {
  const [value, setValue] = useState(target);
  const shown = useRef(target);
  useEffect(() => {
    if (reduce || shown.current === target) {
      shown.current = target;
      setValue(target);
      return;
    }
    const controls = animate(shown.current, target, {
      duration: 0.65,
      ease: EASE,
      onUpdate: (v) => {
        shown.current = Math.round(v);
        setValue(shown.current);
      },
    });
    return () => controls.stop();
  }, [target, reduce]);
  return value;
}

/**
 * DOOM FLEX planner on the product page: choose 3, 6 or 12 months and see the plan come together —
 * a ring of instalments drawn one by one, the monthly amount counting to its value, the dates and
 * the amount of every instalment. Everything is computed from the real price of the selected variant
 * with the same rules as the FLEX application (lib/flex/schedule): 0 % interest, no fees, the
 * instalments add up exactly to the price, the last one carries the baisa remainder, one due date per
 * month in Muscat time. Dates appear after hydration (they depend on "today"), so the server HTML and
 * the first client render always match. Reduced motion: values and ring are shown immediately.
 */
export function FlexPlanner({ priceBaisa, className }: { priceBaisa: number; className?: string }) {
  const t = useTranslations('product.flex');
  const locale = useLocale();
  const rtl = locale === 'ar';
  const reduce = usePrefersReducedMotion();
  const [months, setMonths] = useState<FlexMonths>(6);
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  const plan = computeSchedule(priceBaisa, months, today ?? new Date(0));
  const monthly = useTweened(plan.monthlyBaisa, reduce);
  const n = plan.installments.length;
  const index = FLEX_MONTHS.indexOf(months);
  const remainder = plan.lastBaisa - plan.monthlyBaisa;
  const dateFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const shortMonth = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { month: 'short', timeZone: 'UTC' });
  const due = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
  const gap = n > 6 ? 0.014 : 0.02;

  return (
    <LazyMotion features={domAnimation} strict>
      <section aria-labelledby="flex-options-title" className={cn('overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card sm:p-5', className)} data-testid="flex-options">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-yellow text-night">
            <CalendarDays size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="flex-options-title" className="text-lg font-bold leading-tight">
              {t('optionsTitle')}
            </h2>
            <p className="text-sm text-muted">{t('subtitle')}</p>
          </div>
        </div>

        {/* 3 / 6 / 12 months: a sliding yellow pill marks the choice. */}
        <div role="radiogroup" aria-label={t('durationLabel')} className="relative mt-4 grid grid-cols-3 rounded-pill bg-surface-2 p-1">
          <span
            aria-hidden="true"
            className="absolute inset-y-1 start-1 w-[calc((100%-0.5rem)/3)] rounded-pill bg-yellow shadow-card transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none"
            style={{ transform: `translateX(${(rtl ? -1 : 1) * index * 100}%)` }}
          />
          {FLEX_MONTHS.map((mo) => (
            <button
              key={mo}
              type="button"
              role="radio"
              aria-checked={months === mo}
              aria-pressed={months === mo}
              onClick={() => setMonths(mo)}
              data-testid={`flex-months-${mo}`}
              className={cn(
                'relative z-10 min-h-11 rounded-pill px-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                months === mo ? 'text-night' : 'text-muted hover:text-fg',
              )}
            >
              {t('months', { count: mo })}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-5 max-sm:flex-col">
          {/* Ring: one arc per instalment, drawn in order; the first (yellow) is the first payment. */}
          <div className="relative size-44 shrink-0" aria-hidden="true">
            <svg viewBox="0 0 100 100" className="size-full">
              <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" className="stroke-surface-2" />
              {plan.installments.map((inst, i) => (
                <g key={`${n}-${inst.sequence}`} transform={`rotate(${-90 + (i * 360) / n} 50 50)`}>
                  <m.circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    strokeWidth="9"
                    className={i === 0 ? 'stroke-yellow' : 'stroke-fg'}
                    initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1 / n - gap, opacity: 1 }}
                    transition={{ delay: reduce ? 0 : 0.05 + i * (0.55 / n), duration: reduce ? 0 : 0.32, ease: EASE }}
                  />
                </g>
              ))}
            </svg>
            <div className="absolute inset-0 grid place-content-center text-center">
              <span className="text-xs font-medium text-muted">{t('monthly')}</span>
              <span className="text-xl font-bold leading-tight tabular-nums text-price">
                <bdi>{formatBaisa(monthly, locale)}</bdi>
              </span>
              <span className="text-xs font-semibold text-muted">× {n}</span>
            </div>
          </div>

          <div className="flex w-full min-w-0 flex-col gap-2.5">
            <p className="sr-only" aria-live="polite" data-testid="flex-monthly">
              <span className="font-bold tabular-nums">
                <bdi>{t('perMonth', { amount: formatBaisa(plan.monthlyBaisa, locale) })}</bdi>
              </span>
              <span className="text-muted"> × {n}</span>
            </p>
            <dl className="grid grid-cols-1 gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
                <dt className="flex items-center gap-2 text-muted">
                  <ReceiptText size={16} aria-hidden="true" />
                  {t('total')}
                </dt>
                <dd className="font-bold tabular-nums">
                  <bdi>{formatBaisa(plan.totalBaisa, locale)}</bdi>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
                <dt className="flex items-center gap-2 text-muted">
                  <Percent size={16} aria-hidden="true" />
                  {t('interest')}
                </dt>
                <dd className="font-bold text-success">0 %</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
                <dt className="flex items-center gap-2 text-muted">
                  <ShieldCheck size={16} aria-hidden="true" />
                  {t('fees')}
                </dt>
                <dd className="font-bold text-success">{t('none')}</dd>
              </div>
            </dl>
            <p className="min-h-5 text-xs text-muted" data-testid="flex-first-due">
              {today ? t('firstDue', { date: dateFmt.format(due(plan.installments[0]!.dueDate)) }) : null}
            </p>
          </div>
        </div>

        {/* Month strip: one chip per instalment, popping in one after the other. */}
        <ol className="mt-4 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(n, 6)}, minmax(0, 1fr))` }} aria-label={t('scheduleLabel')}>
          <AnimatePresence initial={false} mode="popLayout">
            {plan.installments.map((inst, i) => (
              <m.li
                key={`${n}-${inst.sequence}`}
                initial={reduce ? false : { opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0, scale: 0.9 }}
                transition={{ delay: reduce ? 0 : 0.12 + i * 0.035, duration: reduce ? 0 : 0.25, ease: EASE }}
                className={cn('rounded-xl border px-1.5 py-1.5 text-center', i === 0 ? 'border-yellow bg-yellow/25' : 'border-border bg-surface')}
              >
                <span className="block text-[11px] font-semibold text-muted">{today ? shortMonth.format(due(inst.dueDate)) : `#${inst.sequence}`}</span>
                <span className="block text-xs font-bold tabular-nums">
                  <bdi>{formatBaisa(inst.amountBaisa, locale, { currency: false })}</bdi>
                </span>
              </m.li>
            ))}
          </AnimatePresence>
        </ol>

        {/* Full schedule with dates. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="flex-schedule"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-4 hover:underline"
          data-testid="flex-schedule-toggle"
        >
          {open ? t('hideSchedule') : t('showSchedule')}
          <ChevronDown size={18} aria-hidden="true" className={cn('transition-transform duration-(--dur-btn)', open && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {open ? (
            <m.div
              id="flex-schedule"
              key="schedule"
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduce ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
              className="overflow-hidden"
            >
              <table className="mt-1 w-full text-sm" data-testid="flex-schedule">
                <thead className="sr-only">
                  <tr>
                    <th>{t('colInstallment')}</th>
                    <th>{t('colDate')}</th>
                    <th>{t('colAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.installments.map((inst) => (
                    <tr key={inst.sequence} className="border-b border-border last:border-0">
                      <td className="py-2 font-medium">{t('installmentN', { n: inst.sequence })}</td>
                      <td className="py-2 text-muted">{today ? dateFmt.format(due(inst.dueDate)) : '—'}</td>
                      <td className="py-2 text-end font-bold tabular-nums">
                        <bdi>{formatBaisa(inst.amountBaisa, locale)}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {remainder > 0 ? <p className="mt-1 text-xs text-muted">{t('remainder', { amount: formatBaisa(remainder, locale) })}</p> : null}
            </m.div>
          ) : null}
        </AnimatePresence>

        <p className="mt-2 text-xs text-muted">
          {t('note')}{' '}
          <Link href="/flex" className="font-semibold text-accent underline-offset-4 hover:underline">
            {t('cta')}
          </Link>
        </p>
      </section>
    </LazyMotion>
  );
}
