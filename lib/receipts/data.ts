import type { OrderStatus, PaymentProvider, Role } from '@prisma/client';
import { prisma, type Db } from '@/lib/db';
import { can } from '@/lib/rbac';
import { localize, type LocalizedText } from '@/lib/localized';

/**
 * Receipt data for DOOM Wallet transactions and paid orders, with ownership / role checks.
 * Rendered as PDF (lib/receipts/pdf.ts, English + French) and as a printable HTML page in the
 * reader's locale (Arabic included) at /[locale]/wallet/receipt/[id].
 *
 * VAT: shown ONLY when a VAT rate is stored in `Setting` (`tax.vatBps` as basis points — the
 * admin settings key — or `tax.vat` as `{ rateBps }` / `{ rate: 5 }`). Prices are VAT-inclusive;
 * the receipt shows the VAT included in the total. Nothing is hard-coded.
 */

export type ReceiptKind = 'wallet' | 'order';

export type ReceiptLine = { label: string; labelJson?: unknown; qty: number; unitBaisa: number; totalBaisa: number };

export type ReceiptData = {
  kind: ReceiptKind;
  id: string;
  reference: string;
  issuedAt: Date;
  customer: { name: string; email: string; phone: string | null };
  /** Ledger transaction type (wallet) or 'ORDER'. */
  type: string;
  method: PaymentProvider | null;
  /** Signed effect on the customer's wallet (wallet receipts only). */
  walletAmountBaisa: number | null;
  lines: ReceiptLine[];
  subtotalBaisa: number;
  deliveryFeeBaisa: number;
  discountBaisa: number;
  totalBaisa: number;
  vat: { rateBps: number; includedBaisa: number } | null;
  orderNumber: string | null;
  orderStatus: OrderStatus | null;
  refundedBaisa: number;
};

export type Viewer = { id: string; role: Role };

const PAID_STATUSES: readonly OrderStatus[] = ['PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REFUNDED', 'PARTIALLY_REFUNDED'];

/** VAT rate (basis points) if — and only if — one is configured. */
export async function getVatRateBps(db: Db = prisma): Promise<number | null> {
  const rows = await db.setting.findMany({ where: { key: { in: ['tax.vatBps', 'tax.vat'] } } });
  for (const key of ['tax.vatBps', 'tax.vat']) {
    const v = rows.find((r) => r.key === key)?.value as unknown;
    let bps: number | null = null;
    if (typeof v === 'number') bps = v;
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.enabled === false) return null;
      if (typeof o.rateBps === 'number') bps = o.rateBps;
      else if (typeof o.rate === 'number') bps = Math.round(o.rate * 100);
    }
    if (bps !== null && Number.isInteger(bps) && bps > 0 && bps <= 5000) return bps;
  }
  return null;
}

/** VAT included in a VAT-inclusive total: total × r / (1 + r), rounded half up. */
export function includedVat(totalBaisa: number, rateBps: number): number {
  return Math.round((totalBaisa * rateBps) / (10_000 + rateBps));
}

export async function loadWalletReceipt(transactionId: string, viewer: Viewer, db: Db = prisma): Promise<ReceiptData | null> {
  const tx = await db.ledgerTransaction.findUnique({
    where: { id: transactionId },
    include: {
      entries: { include: { account: { select: { type: true, userId: true } } } },
      paymentIntent: { select: { provider: true, userId: true } },
    },
  });
  if (!tx) return null;
  const walletEntry = tx.entries.find((e) => e.account.type === 'CUSTOMER_WALLET');
  const ownerId = walletEntry?.account.userId ?? tx.paymentIntent?.userId ?? null;
  if (!ownerId) return null;
  if (ownerId !== viewer.id && !can(viewer.role, 'wallets:read')) return null;
  const [owner, order] = await Promise.all([
    db.user.findUnique({ where: { id: ownerId }, select: { fullName: true, email: true, phone: true } }),
    tx.orderId ? db.order.findUnique({ where: { id: tx.orderId }, select: { number: true, status: true } }) : null,
  ]);
  if (!owner) return null;
  const positive = tx.entries.filter((e) => e.amountBaisa > 0).reduce((s, e) => s + e.amountBaisa, 0);
  const amount = walletEntry ? Math.abs(walletEntry.amountBaisa) : positive;
  return {
    kind: 'wallet',
    id: tx.id,
    reference: tx.reference,
    issuedAt: tx.createdAt,
    customer: { name: owner.fullName, email: owner.email, phone: owner.phone },
    type: tx.type,
    method: tx.paymentIntent?.provider ?? null,
    walletAmountBaisa: walletEntry?.amountBaisa ?? null,
    lines: [{ label: tx.type, qty: 1, unitBaisa: amount, totalBaisa: amount }],
    subtotalBaisa: amount,
    deliveryFeeBaisa: 0,
    discountBaisa: 0,
    totalBaisa: amount,
    vat: null, // stored-value movements are not a taxable supply; VAT appears on order receipts
    orderNumber: order?.number ?? null,
    orderStatus: order?.status ?? null,
    refundedBaisa: 0,
  };
}

export async function loadOrderReceipt(orderRef: string, viewer: Viewer, locale = 'en', db: Db = prisma): Promise<ReceiptData | null> {
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderRef }, { number: orderRef }] },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      user: { select: { fullName: true, email: true, phone: true } },
      paymentIntents: { where: { status: 'SUCCEEDED' }, select: { provider: true, succeededAt: true }, take: 1 },
      refunds: { where: { status: 'COMPLETED' }, select: { amountBaisa: true } },
    },
  });
  if (!order) return null;
  if (order.userId !== viewer.id && !can(viewer.role, 'orders:read')) return null;
  if (!PAID_STATUSES.includes(order.status)) return null;
  const rate = await getVatRateBps(db);
  return {
    kind: 'order',
    id: order.id,
    reference: order.number,
    issuedAt: order.paidAt ?? order.paymentIntents[0]?.succeededAt ?? order.placedAt,
    customer: { name: order.user.fullName, email: order.user.email, phone: order.contactPhone ?? order.user.phone },
    type: 'ORDER',
    method: order.paymentIntents[0]?.provider ?? order.paymentMethod,
    walletAmountBaisa: null,
    lines: order.items.map((i) => ({
      label: [localize(i.nameSnapshot as LocalizedText, locale), i.variantLabel].filter(Boolean).join(' · '),
      labelJson: i.nameSnapshot,
      qty: i.qty,
      unitBaisa: i.unitPriceBaisa,
      totalBaisa: i.lineTotalBaisa,
    })),
    subtotalBaisa: order.subtotalBaisa,
    deliveryFeeBaisa: order.deliveryFeeBaisa,
    discountBaisa: order.discountBaisa,
    totalBaisa: order.totalBaisa,
    vat: rate ? { rateBps: rate, includedBaisa: includedVat(order.totalBaisa, rate) } : null,
    orderNumber: order.number,
    orderStatus: order.status,
    refundedBaisa: order.refunds.reduce((s, r) => s + r.amountBaisa, 0),
  };
}

export async function loadReceipt(kind: ReceiptKind, id: string, viewer: Viewer, locale = 'en'): Promise<ReceiptData | null> {
  return kind === 'wallet' ? loadWalletReceipt(id, viewer) : loadOrderReceipt(id, viewer, locale);
}
