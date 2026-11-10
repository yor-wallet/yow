import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { NewTicketForm } from '@/components/account/SupportForms';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ order?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.support' });
  return { title: t('newTitle'), robots: { index: false } };
}

export default async function NewTicketPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { order } = await searchParams;
  const orderParam = typeof order === 'string' ? order.slice(0, 40) : undefined;
  const { user } = await requireUser({ next: `/account/support/new${orderParam ? `?order=${encodeURIComponent(orderParam)}` : ''}` });
  const [t, format, orders] = await Promise.all([
    getTranslations('account.support'),
    getFormatter(),
    prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { placedAt: 'desc' },
      take: 50,
      select: { number: true, placedAt: true },
    }),
  ]);
  const options = orders.map((o) => ({ number: o.number, label: `${o.number} · ${format.dateTime(o.placedAt, 'short')}` }));
  const defaultOrder = orderParam && orders.some((o) => o.number === orderParam) ? orderParam : undefined;

  return (
    <div className="pb-14">
      <PageHeader title={t('newTitle')} subtitle={t('newSubtitle')} fallbackHref="/account/support" />
      <div className="page-container mt-5 lg:mt-6">
        <Card className="mx-auto max-w-2xl">
          <NewTicketForm orders={options} defaultOrder={defaultOrder} />
        </Card>
      </div>
    </div>
  );
}
