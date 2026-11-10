import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Price } from '@/components/ui/Price';

export type ScheduleRow = { sequence: number; dueDate: string; amountBaisa: number; status?: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'; paidAt?: Date | null };

const STATUS_VARIANT: Record<NonNullable<ScheduleRow['status']>, BadgeVariant> = { PENDING: 'info', PAID: 'success', OVERDUE: 'error', CANCELLED: 'neutral' };

/** Transparent instalment schedule (dates in Muscat calendar, amounts to the baisa). */
export function ScheduleTable({ rows, totalBaisa, showStatus = false }: { rows: ScheduleRow[]; totalBaisa: number; showStatus?: boolean }) {
  const t = useTranslations('flex');
  const format = useFormatter();
  const date = (ymd: string) => format.dateTime(new Date(`${ymd}T00:00:00+04:00`), 'short');
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card" data-testid="flex-schedule">
      <ol className="divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.sequence}
            className={cn('flex min-h-14 items-center gap-3 px-3 py-2.5 sm:px-4', r.status === 'OVERDUE' && 'bg-error/5', r.status === 'PAID' && 'bg-success/5')}
            data-testid="flex-schedule-row"
            data-amount={r.amountBaisa}
            data-status={r.status}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border-strong font-display text-sm font-bold text-accent">{r.sequence}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {r.status === 'PAID' && r.paidAt ? t('detail.paidOn', { date: format.dateTime(r.paidAt, 'short') }) : t('detail.due', { date: date(r.dueDate) })}
              </span>
              {showStatus && r.status ? (
                <Badge variant={STATUS_VARIANT[r.status]} className="mt-1">
                  {t(`detail.instStatus.${r.status}`)}
                </Badge>
              ) : null}
            </span>
            <span className="shrink-0 font-display">
              <Price baisa={r.amountBaisa} />
            </span>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-3 border-t border-border-strong bg-surface-2/60 px-3 py-3 sm:px-4">
        <span className="font-semibold">{t('apply.total')}</span>
        <span className="font-display" data-testid="flex-schedule-total" data-baisa={totalBaisa}>
          <Price baisa={totalBaisa} size="lg" />
        </span>
      </div>
    </div>
  );
}
