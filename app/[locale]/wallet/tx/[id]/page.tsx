import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FileDown, Printer } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';
import { loadWalletReceipt } from '@/lib/receipts';
import { PageHeader } from '@/components/layout/PageHeader';
import { HudCorners } from '@/components/ui/HudCorners';
import { buttonClasses } from '@/components/ui/Button';
import { StatusBadge } from '@/components/wallet/StatusBadge';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'wallet.tx' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function TransactionPage({ params }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: `/wallet/tx/${id}` });
  const data = await loadWalletReceipt(id, { id: user.id, role: user.role });
  if (!data) notFound();
  const [t, tw, tp, format] = await Promise.all([getTranslations('wallet.tx'), getTranslations('wallet'), getTranslations('payments'), getFormatter()]);
  const signed = data.walletAmountBaisa ?? data.totalBaisa;
  const rows: [string, React.ReactNode][] = [
    [t('type'), tw(`types.${data.type as 'TOPUP'}`)],
    [t('status'), <StatusBadge key="s" status="confirmed" />],
    [t('date'), format.dateTime(data.issuedAt, 'long')],
    [t('reference'), <span key="r" dir="ltr" className="font-mono text-sm" data-testid="tx-reference">{data.reference}</span>],
  ];
  if (data.method) rows.push([t('method'), tp(`methods.${data.method}.label`)]);
  if (data.orderNumber) {
    rows.push([
      t('order'),
      <Link key="o" href={`/orders/${data.orderNumber}`} className="font-semibold text-accent hover:underline">
        {data.orderNumber}
      </Link>,
    ]);
  }
  return (
    <div className="pb-16">
      <PageHeader title={t('title')} fallbackHref="/wallet" />
      <div className="page-container mt-4 lg:mt-8">
        <div className="relative mx-auto max-w-2xl rounded-card holo-border p-5 shadow-float sm:p-7" data-testid="tx-detail">
          <HudCorners />
          <p className="text-sm text-muted">{t('amount')}</p>
          <p
            className={cn('neon mt-1 font-display text-4xl font-bold tabular-nums [unicode-bidi:isolate]', signed > 0 ? 'text-success' : 'text-fg')}
            data-testid="tx-amount"
          >
            {formatBaisa(signed, locale, { signed: true })}
          </p>
          <dl className="mt-6 grid grid-cols-1 divide-y divide-border">
            {rows.map(([k, v]) => (
              <div key={k} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <dt className="text-sm text-muted">{k}</dt>
                <dd className="min-w-0 text-end font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <a href={`/api/receipts/wallet/${data.id}`} className={buttonClasses({ variant: 'primary', fullWidth: true, className: 'sheen' })} data-testid="tx-receipt-pdf" download>
              <FileDown size={18} aria-hidden="true" />
              {t('receiptPdf')}
            </a>
            <Link href={`/wallet/receipt/${data.id}`} className={buttonClasses({ variant: 'outline', fullWidth: true })} data-testid="tx-receipt-print">
              <Printer size={18} aria-hidden="true" />
              {t('receiptPrint')}
            </Link>
          </div>
          <p className="mt-2 text-xs text-muted">
            {t('receiptPdfHint')} · {t('receiptPrintHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
