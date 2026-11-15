'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Live time left before an offer ends. The first render (server and hydration) shows the end date, so the
 * HTML never depends on the clock; the ticking display takes over once mounted. When the time is up the
 * offer says so — the server stops applying it at the same instant.
 */
export function Countdown({ endsAt }: { endsAt: string }) {
  const t = useTranslations('home.promoCard');
  const format = useFormatter();
  const end = Date.parse(endsAt);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const until = t('endsOn', { date: format.dateTime(new Date(end), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' }) });
  if (now === null) return <span className="text-xs text-muted">{until}</span>;
  const left = end - now;
  if (left <= 0) return <span className="text-xs font-semibold text-muted" data-testid="promo-ended">{t('ended')}</span>;
  const days = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const urgent = left < 86_400_000;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs" title={until} data-testid="promo-countdown">
      <Clock size={14} aria-hidden="true" className={urgent ? 'text-error' : 'text-muted'} />
      <span className="text-muted">{t('endsIn')}</span>
      {/* The clock is decorative for assistive technology: the end date is announced instead of a value changing every second. */}
      <span className="sr-only">{until}</span>
      <span aria-hidden="true" dir="ltr" className={`inline-flex items-center gap-1 font-display font-bold tabular-nums ${urgent ? 'text-error' : 'text-fg'}`}>
        {days > 0 ? <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{t('days', { count: days })}</span> : null}
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{two(h)}</span>:<span className="rounded-md bg-surface-2 px-1.5 py-0.5">{two(m)}</span>:
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{two(s)}</span>
      </span>
    </span>
  );
}
