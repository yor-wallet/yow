import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { FileDown } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { formatBaisa } from '@/lib/money';
import { loadReceipt } from '@/lib/receipts';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonClasses } from '@/components/ui/Button';
import { PrintButton } from '@/components/wallet/PrintButton';

/**
 * Printable receipt in the page's language — Arabic (RTL) included, which the PDF cannot
 * shape. `/[locale]/wallet/receipt/<ledgerTransactionId>` or `?type=order` with an order id/number.
 */
type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ type?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'wallet.receipt' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #doom-receipt, #doom-receipt * { visibility: visible !important; }
  #doom-receipt { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none !important; border: 0 !important; }
  .doom-ambient { display: none !important; }
}`;

export default async function ReceiptPage({ params, searchParams }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  const type = (await searchParams).type === 'order' ? 'order' : 'wallet';
  const { user } = await requireUser({ next: `/wallet/receipt/${id}${type === 'order' ? '?type=order' : ''}` });
  const data = await loadReceipt(type, id, { id: user.id, role: user.role }, locale);
  if (!data) notFound();
  const [t, tw, tp, format] = await Promise.all([getTranslations('wallet.receipt'), getTranslations('wallet'), getTranslations('payments'), getFormatter()]);
  const money = (b: number) => formatBaisa(b, locale);
  const typeLabel = data.type === 'ORDER' ? t('orderTitle') : tw(`types.${data.type as 'TOPUP'}`);

  return (
    <div className="pb-16">
      <style>{PRINT_CSS}</style>
      <PageHeader title={data.kind === 'order' ? t('orderTitle') : t('walletTitle')} fallbackHref={data.kind === 'order' ? `/orders/${data.reference}` : `/wallet/tx/${data.id}`} />
      <div className="page-container mt-4 lg:mt-8">
        <div className="mx-auto mb-4 flex max-w-3xl flex-wrap justify-end gap-3 print:hidden">
          <a href={`/api/receipts/${data.kind}/${data.id}`} className={buttonClasses({ variant: 'outline' })} download>
            <FileDown size={18} aria-hidden="true" />
            {t('downloadPdf')}
          </a>
          <PrintButton label={t('print')} />
        </div>
        <article id="doom-receipt" className="mx-auto max-w-3xl rounded-card bg-white p-6 text-ink shadow-float sm:p-10" data-testid="receipt" data-theme="light">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink/10 pb-6">
            <Image src="/brand/doom-logo-horizontal-light-640.png" alt="DOOM | دوم" width={200} height={80} className="h-auto w-44" priority />
            <div className="text-end">
              <h2 className="text-2xl font-bold">{data.kind === 'order' ? t('orderTitle') : t('walletTitle')}</h2>
              <p className="mt-1 text-sm">
                {t('number')} <span dir="ltr" className="font-mono font-semibold">{data.reference}</span>
              </p>
            </div>
          </header>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 py-6 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink/60">{t('date')}</dt>
              <dd className="font-medium">{format.dateTime(data.issuedAt, 'long')}</dd>
            </div>
            <div>
              <dt className="text-ink/60">{t('type')}</dt>
              <dd className="font-medium">{typeLabel}</dd>
            </div>
            <div>
              <dt className="text-ink/60">{t('customer')}</dt>
              <dd className="font-medium">
                {data.customer.name}
                <span className="block break-all text-ink/70" dir="ltr">
                  {data.customer.email}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-ink/60">{t('method')}</dt>
              <dd className="font-medium">{data.method ? tp(`methods.${data.method}.label`) : '—'}</dd>
            </div>
            <div>
              <dt className="text-ink/60">{t('status')}</dt>
              <dd className="font-medium text-success">{data.kind === 'order' ? t('statusPaid') : t('statusConfirmed')}</dd>
            </div>
          </dl>
          <div className="overflow-x-auto" data-scroll-x>
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-y border-ink/10 text-ink/60">
                  <th className="py-2 text-start font-medium">{t('description')}</th>
                  <th className="py-2 text-end font-medium">{t('qty')}</th>
                  <th className="py-2 text-end font-medium">{t('unit')}</th>
                  <th className="py-2 text-end font-medium">{t('total')}</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={i} className="border-b border-ink/5">
                    <td className="py-2.5 pe-3">{data.kind === 'wallet' ? typeLabel : l.label}</td>
                    <td className="py-2.5 text-end tabular-nums">{l.qty}</td>
                    <td className="py-2.5 text-end tabular-nums [unicode-bidi:isolate]">{money(l.unitBaisa)}</td>
                    <td className="py-2.5 text-end tabular-nums [unicode-bidi:isolate]">{money(l.totalBaisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ms-auto mt-6 grid max-w-sm grid-cols-1 gap-2 text-sm">
            {data.kind === 'order' ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink/70">{t('subtotal')}</dt>
                  <dd className="tabular-nums [unicode-bidi:isolate]">{money(data.subtotalBaisa)}</dd>
                </div>
                {data.discountBaisa > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink/70">{t('discount')}</dt>
                    <dd className="tabular-nums [unicode-bidi:isolate]">-{money(data.discountBaisa)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <dt className="text-ink/70">{t('delivery')}</dt>
                  <dd className="tabular-nums [unicode-bidi:isolate]">{money(data.deliveryFeeBaisa)}</dd>
                </div>
              </>
            ) : null}
            <div className="flex justify-between gap-4 border-t border-ink/10 pt-2 text-base font-bold">
              <dt>{t('total')}</dt>
              <dd className="tabular-nums [unicode-bidi:isolate]" data-testid="receipt-total">
                {money(data.totalBaisa)}
              </dd>
            </div>
            {data.vat ? (
              <div className="flex justify-between gap-4" data-testid="receipt-vat">
                <dt className="text-ink/70">{t('vat', { rate: (data.vat.rateBps / 100).toString() })}</dt>
                <dd className="tabular-nums [unicode-bidi:isolate]">{money(data.vat.includedBaisa)}</dd>
              </div>
            ) : null}
            {data.refundedBaisa > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink/70">{t('refunded')}</dt>
                <dd className="tabular-nums [unicode-bidi:isolate]">{money(data.refundedBaisa)}</dd>
              </div>
            ) : null}
            {data.walletAmountBaisa !== null ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink/70">{data.walletAmountBaisa >= 0 ? t('walletCredit') : t('walletDebit')}</dt>
                <dd className="font-semibold tabular-nums [unicode-bidi:isolate]">{formatBaisa(data.walletAmountBaisa, locale, { signed: true })}</dd>
              </div>
            ) : null}
          </dl>
          <footer className="mt-10 border-t border-ink/10 pt-4 text-xs text-ink/60">
            <p>{t('footer')}</p>
            <p className="mt-1">{t('timezone')}</p>
          </footer>
        </article>
      </div>
    </div>
  );
}
