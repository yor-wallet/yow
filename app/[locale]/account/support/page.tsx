import type { Metadata } from 'next';
import { ChevronRight, CircleHelp, LifeBuoy, MessageSquarePlus } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { listTickets } from '@/lib/support';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { buttonClasses } from '@/components/ui/Button';
import { TicketStatusBadge } from '@/components/delivery/StatusBadges';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.support' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function SupportPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: '/account/support' });
  const [t, format, tickets] = await Promise.all([getTranslations('account.support'), getFormatter(), listTickets(user.id)]);
  const newLink = (
    <Link href="/account/support/new" className={buttonClasses({ variant: 'primary', size: 'sm' })} data-testid="ticket-new">
      <MessageSquarePlus size={18} aria-hidden="true" />
      {t('new')}
    </Link>
  );

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/account" actions={tickets.length ? newLink : undefined} />
      <div className="page-container mt-5 grid grid-cols-1 gap-6 lg:mt-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          {tickets.length === 0 ? (
            <EmptyState icon={<LifeBuoy size={26} />} title={t('emptyTitle')} description={t('emptyText')} action={newLink} />
          ) : (
            <section aria-labelledby="tickets-title">
              <SectionHeading id="tickets-title" title={t('listTitle')} />
              <ul className="flex flex-col gap-3" data-testid="ticket-list">
                {tickets.map((tk) => {
                  const last = tk.messages[0];
                  return (
                    <li key={tk.id}>
                      <Link
                        href={`/account/support/${tk.number}`}
                        data-spotlight=""
                        className="spotlight holo-border-hover group flex min-w-0 items-center gap-4 rounded-card border border-border bg-surface/80 p-4 shadow-card backdrop-blur transition-[transform,box-shadow] duration-(--dur-card) hover:-translate-y-0.5 hover:shadow-glow-blue"
                        data-testid="ticket-card"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-muted" dir="ltr">
                              {tk.number}
                            </span>
                            <TicketStatusBadge status={tk.status} />
                          </div>
                          <p className="mt-1 truncate font-semibold">{tk.subject}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {t('openedOn', { date: format.dateTime(tk.createdAt, 'short') })} · {t('messages', { count: tk._count.messages })}
                            {tk.order ? ` · ${t('linkedOrder', { number: tk.order.number })}` : ''}
                            {last ? ` · ${last.isStaff ? t('lastReplyStaff') : t('awaiting')}` : ''}
                          </p>
                        </div>
                        <ChevronRight size={18} aria-hidden="true" className="flip-rtl shrink-0 text-muted" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
        <aside className="min-w-0 lg:col-span-4">
          <div className="relative rounded-card glass p-5">
            <span className="hud-label">{t('team')}</span>
            <p className="mt-3 text-sm text-muted">{t('subtitle')}</p>
            <Link href="/help" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent underline-offset-4 hover:underline">
              <CircleHelp size={18} aria-hidden="true" />
              {t('helpLink')}
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
