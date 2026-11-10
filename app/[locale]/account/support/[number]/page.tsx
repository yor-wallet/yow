import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Headset, Package, UserRound } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { getTicketThread } from '@/lib/support';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { TicketStatusBadge } from '@/components/delivery/StatusBadges';
import { ReplyForm } from '@/components/account/SupportForms';
import { cn } from '@/lib/cn';

type Props = { params: Promise<{ locale: string; number: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.support' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function TicketPage({ params }: Props) {
  const { locale: rawLocale, number: rawNumber } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const number = decodeURIComponent(rawNumber).slice(0, 40);
  const { user } = await requireUser({ next: `/account/support/${encodeURIComponent(number)}` });
  const ticket = await getTicketThread(user.id, number);
  if (!ticket) notFound();
  const [t, format] = await Promise.all([getTranslations('account.support'), getFormatter()]);

  return (
    <div className="pb-14">
      <PageHeader title={ticket.subject} subtitle={ticket.number} fallbackHref="/account/support" actions={<TicketStatusBadge status={ticket.status} />} />
      <div className="page-container mt-5 max-w-3xl lg:mt-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-mono" dir="ltr">
            {ticket.number}
          </span>
          <span aria-hidden="true">·</span>
          <span>{t('openedOn', { date: format.dateTime(ticket.createdAt, 'long') })}</span>
          {ticket.order ? (
            <>
              <span aria-hidden="true">·</span>
              <Link href={`/orders/${ticket.order.number}`} className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent underline-offset-4 hover:underline">
                <Package size={16} aria-hidden="true" />
                {t('linkedOrder', { number: ticket.order.number })}
              </Link>
            </>
          ) : null}
        </div>

        <ol className="mt-4 flex flex-col gap-3" data-testid="ticket-thread">
          {ticket.messages.map((m) => (
            <li key={m.id} className={cn('flex min-w-0', m.isStaff ? 'justify-start' : 'justify-end')}>
              <div
                className={cn(
                  'relative min-w-0 max-w-[min(100%,36rem)] rounded-card border p-4 shadow-card',
                  m.isStaff ? 'border-cyan/35 bg-surface/90 backdrop-blur' : 'border-blue/40 bg-blue/12',
                )}
                data-testid="ticket-message"
              >
                <p className="flex items-center gap-2 text-xs font-semibold text-muted">
                  {m.isStaff ? <Headset size={14} aria-hidden="true" className="text-accent" /> : <UserRound size={14} aria-hidden="true" />}
                  {m.isStaff ? t('team') : t('you')}
                  <span aria-hidden="true">·</span>
                  <time dateTime={m.createdAt.toISOString()}>{format.dateTime(m.createdAt, 'long')}</time>
                </p>
                <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed">{m.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <Card className="mt-6">
          {ticket.status === 'CLOSED' ? (
            <p className="text-sm text-muted" role="status">
              {t('closedNotice')}
            </p>
          ) : (
            <>
              {ticket.status === 'RESOLVED' ? (
                <p className="mb-3 text-sm text-muted" role="status">
                  {t('resolvedNotice')}
                </p>
              ) : null}
              <ReplyForm number={ticket.number} />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
