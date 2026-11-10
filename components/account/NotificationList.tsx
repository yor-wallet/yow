'use client';

import { useOptimistic, useTransition } from 'react';
import { BadgePercent, Bell, CheckCheck, KeyRound, LifeBuoy, ShieldCheck, Truck, Wallet, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { markNotificationsReadAction } from '@/app/[locale]/account/notifications/actions';
import { cn } from '@/lib/cn';

export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  time: string;
  isoTime: string;
  unread: boolean;
  /** Live handover code (delivery.otp, still usable) — computed server-side for the owner. */
  handoverCode?: string | null;
};

function iconFor(type: string): LucideIcon {
  if (type.startsWith('delivery.otp')) return KeyRound;
  if (type.startsWith('delivery')) return Truck;
  if (type.startsWith('kyc')) return ShieldCheck;
  if (type.startsWith('support')) return LifeBuoy;
  if (type.startsWith('security')) return KeyRound;
  if (type.startsWith('flex')) return BadgePercent;
  if (type.startsWith('wallet') || type.startsWith('payment') || type.startsWith('refund') || type.startsWith('giftcard')) return Wallet;
  return Bell;
}

/** Notification centre list: opening an item marks it read then follows its link. */
export function NotificationList({ items, unreadTotal }: { items: NotificationView[]; unreadTotal: number }) {
  const t = useTranslations('account.notifications');
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [optimistic, setRead] = useOptimistic(items, (state, ids: string[] | 'all') =>
    state.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, unread: false } : n)),
  );

  const open = (n: NotificationView) =>
    start(async () => {
      if (n.unread) {
        setRead([n.id]);
        await markNotificationsReadAction([n.id]);
      }
      if (n.link) router.push(n.link);
      else router.refresh();
    });

  const markAll = () =>
    start(async () => {
      setRead('all');
      const res = await markNotificationsReadAction();
      toast({ title: t('markedAllRead'), variant: res.ok ? 'success' : 'error' });
      router.refresh();
    });

  return (
    <div>
      {unreadTotal > 0 ? (
        <div className="mb-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={markAll} disabled={pending} leadingIcon={<CheckCheck size={16} aria-hidden="true" />} data-testid="notifications-mark-all">
            {t('markAllRead')}
          </Button>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2.5" data-testid="notification-list">
        {optimistic.map((n) => {
          const Icon = iconFor(n.type);
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => open(n)}
                data-spotlight=""
                data-testid="notification-item"
                data-unread={n.unread ? 'true' : undefined}
                className={cn(
                  'spotlight holo-border-hover group flex w-full min-w-0 items-start gap-3 rounded-card border p-4 text-start shadow-card backdrop-blur transition-[box-shadow,transform] duration-(--dur-card) ease-premium hover:-translate-y-0.5 hover:shadow-glow-blue',
                  n.unread ? 'border-blue/45 bg-blue/10' : 'border-border bg-surface/80',
                )}
              >
                <span className={cn('relative grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-premium', n.unread ? 'text-cyan neon-box' : 'text-muted')}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn('min-w-0 break-words', n.unread ? 'font-bold' : 'font-semibold')}>{n.title}</span>
                    {n.unread ? (
                      <span className="inline-flex items-center gap-1 rounded-pill bg-gradient-secondary px-2 text-[11px] font-bold leading-5 text-on-accent">
                        {t('new')}
                      </span>
                    ) : null}
                  </span>
                  {n.body ? <span className="mt-0.5 block text-sm text-muted">{n.body}</span> : null}
                  {n.handoverCode ? (
                    <span className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-xl border border-cyan/40 bg-night/50 px-3 py-2" data-testid="notification-handover">
                      <span className="text-xs font-semibold text-muted">{t('handoverCode')}</span>
                      <span className="font-display neon font-mono text-lg font-extrabold tracking-[0.3em] text-white" dir="ltr">
                        {n.handoverCode}
                      </span>
                      <span className="w-full text-xs text-muted">{t('handoverHint')}</span>
                    </span>
                  ) : null}
                  <time dateTime={n.isoTime} className="mt-1 block text-xs text-muted">
                    {n.time}
                  </time>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
