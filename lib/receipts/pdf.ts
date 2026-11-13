import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatBaisa } from '@/lib/money';
import { localize } from '@/lib/localized';
import type { ReceiptData } from './data';

/**
 * PDF receipt (pdf-lib, A4). Standard fonts cannot shape Arabic, so the PDF is bilingual
 * English + French; the Arabic receipt is the printable HTML page /ar/wallet/receipt/[id].
 * The official logo (light variant on its violet plate — the PDF page is white) is embedded.
 */

const LOGO = 'public/brand/doom-logo-horizontal-light-640.png';
const NIGHT = rgb(16 / 255, 5 / 255, 46 / 255);
const BLUE = rgb(8 / 255, 123 / 255, 255 / 255);
const MUTED = rgb(0.38, 0.36, 0.48);
const LINE = rgb(0.86, 0.86, 0.92);
const SUCCESS = rgb(22 / 255, 166 / 255, 115 / 255);

/** Standard fonts are WinAnsi: replace exotic spaces, drop what cannot be encoded. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[    ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TYPE_LABELS: Record<string, [string, string]> = {
  TOPUP: ['Wallet top-up', 'Rechargement du portefeuille'],
  GIFT_CARD_CREDIT: ['Gift card credit', 'Crédit carte cadeau'],
  ORDER_PAYMENT: ['Order payment', 'Paiement de commande'],
  FLEX_DISBURSEMENT: ['DOOM FLEX financing', 'Financement DOOM FLEX'],
  INSTALLMENT_PAYMENT: ['DOOM FLEX instalment', 'Échéance DOOM FLEX'],
  REFUND: ['Refund', 'Remboursement'],
  ADJUSTMENT: ['Adjustment', 'Ajustement'],
  REVERSAL: ['Reversal', 'Contre-passation'],
  ORDER: ['Order', 'Commande'],
};

const METHOD_LABELS: Record<string, string> = {
  WALLET: 'DOOM Wallet',
  CARD: 'Bank card / Carte bancaire',
  OOREDOO: 'Ooredoo',
  OMANTEL: 'Omantel',
  CRYPTO: 'Crypto (licensed provider / prestataire agréé)',
  GIFT_CARD: 'Gift card / Carte cadeau',
  FLEX: 'DOOM FLEX',
};

function muscatDate(d: Date, locale: 'en' | 'fr'): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
    numberingSystem: 'latn',
  }).format(d);
}

async function loadLogo(): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(path.join(process.cwd(), LOGO));
  } catch {
    return null;
  }
}

type Ctx = { page: PDFPage; font: PDFFont; bold: PDFFont; y: number; left: number; right: number };

function text(ctx: Ctx, value: string, x: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'right'; maxWidth?: number } = {}) {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.font;
  let s = pdfSafe(value);
  if (opts.maxWidth && font.widthOfTextAtSize(s, size) > opts.maxWidth) {
    while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > opts.maxWidth) s = s.slice(0, -1);
    s = `${s.trimEnd()}...`;
  }
  const w = font.widthOfTextAtSize(s, size);
  ctx.page.drawText(s, { x: opts.align === 'right' ? x - w : x, y: ctx.y, size, font, color: opts.color ?? NIGHT });
}

function rule(ctx: Ctx, gap = 10) {
  ctx.y -= gap;
  ctx.page.drawLine({ start: { x: ctx.left, y: ctx.y }, end: { x: ctx.right, y: ctx.y }, thickness: 0.7, color: LINE });
  ctx.y -= gap + 4;
}

const omr = (b: number) => pdfSafe(formatBaisa(b, 'en'));

export async function renderReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`DOOM receipt ${data.reference}`);
  doc.setAuthor('DOOM');
  doc.setCreator('DOOM');
  doc.setProducer('DOOM');
  doc.setCreationDate(new Date());
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { page, font, bold, y: 841.89 - 48, left: 48, right: 595.28 - 48 };

  // Header: official logo + title.
  const logoBytes = await loadLogo();
  if (logoBytes) {
    const logo = await doc.embedPng(logoBytes);
    const w = 110; // the wordmark is taller than the former lock-up: keep the header height
    const h = (logo.height / logo.width) * w;
    page.drawImage(logo, { x: ctx.left, y: ctx.y - h + 10, width: w, height: h });
  } else {
    text(ctx, 'DOOM', ctx.left, { size: 22, bold: true });
  }
  const title = data.kind === 'order' ? ['Receipt', 'Reçu'] : ['Wallet receipt', 'Reçu de portefeuille'];
  text(ctx, title[0]!, ctx.right, { size: 18, bold: true, align: 'right' });
  ctx.y -= 18;
  text(ctx, title[1]!, ctx.right, { size: 12, color: MUTED, align: 'right' });
  ctx.y -= 18;
  text(ctx, `No / N° ${data.reference}`, ctx.right, { size: 10, bold: true, align: 'right', color: BLUE });
  ctx.y -= 40;

  // Meta block.
  const label = TYPE_LABELS[data.type] ?? [data.type, data.type];
  const meta: [string, string][] = [
    ['Date', `${muscatDate(data.issuedAt, 'en')}  /  ${muscatDate(data.issuedAt, 'fr')} (Asia/Muscat)`],
    ['Type', `${label[0]} / ${label[1]}`],
    ['Method / Moyen', data.method ? (METHOD_LABELS[data.method] ?? data.method) : '-'],
    ['Customer / Client', `${data.customer.name} - ${data.customer.email}${data.customer.phone ? ` - ${data.customer.phone}` : ''}`],
  ];
  if (data.orderNumber && data.kind === 'wallet') meta.push(['Order / Commande', data.orderNumber]);
  meta.push(['Status / Statut', data.kind === 'order' ? (data.refundedBaisa > 0 ? 'Paid, refunded in part or in full / Payée, remboursée en tout ou partie' : 'Paid / Payée') : 'Confirmed / Confirmé']);
  for (const [k, v] of meta) {
    text(ctx, k, ctx.left, { size: 9, color: MUTED });
    text(ctx, v, ctx.left + 120, { size: 10, maxWidth: ctx.right - ctx.left - 120 });
    ctx.y -= 16;
  }
  rule(ctx);

  // Lines.
  text(ctx, 'Description', ctx.left, { size: 9, bold: true, color: MUTED });
  text(ctx, 'Qty / Qté', ctx.right - 190, { size: 9, bold: true, color: MUTED, align: 'right' });
  text(ctx, 'Unit / Unitaire', ctx.right - 95, { size: 9, bold: true, color: MUTED, align: 'right' });
  text(ctx, 'Total', ctx.right, { size: 9, bold: true, color: MUTED, align: 'right' });
  ctx.y -= 16;
  for (const line of data.lines.slice(0, 30)) {
    const desc = data.kind === 'wallet' ? `${label[0]} / ${label[1]}` : localize(line.labelJson, 'en', line.label) || line.label;
    text(ctx, desc, ctx.left, { size: 10, maxWidth: ctx.right - ctx.left - 250 });
    text(ctx, String(line.qty), ctx.right - 190, { size: 10, align: 'right' });
    text(ctx, omr(line.unitBaisa), ctx.right - 95, { size: 10, align: 'right' });
    text(ctx, omr(line.totalBaisa), ctx.right, { size: 10, align: 'right' });
    ctx.y -= 16;
  }
  rule(ctx);

  // Totals.
  const totals: [string, string, boolean][] = [];
  if (data.kind === 'order') {
    totals.push(['Subtotal / Sous-total', omr(data.subtotalBaisa), false]);
    if (data.discountBaisa > 0) totals.push(['Discount / Remise', `-${omr(data.discountBaisa)}`, false]);
    totals.push(['Delivery / Livraison', omr(data.deliveryFeeBaisa), false]);
  }
  totals.push(['Total', omr(data.totalBaisa), true]);
  if (data.vat) {
    const pct = (data.vat.rateBps / 100).toFixed(data.vat.rateBps % 100 === 0 ? 0 : 2);
    totals.push([`VAT included ${pct}% / TVA incluse ${pct} %`, omr(data.vat.includedBaisa), false]);
  }
  if (data.refundedBaisa > 0) totals.push(['Refunded / Remboursé', omr(data.refundedBaisa), false]);
  if (data.walletAmountBaisa !== null) {
    const dir = data.walletAmountBaisa >= 0 ? 'Credited to wallet / Crédité au portefeuille' : 'Debited from wallet / Débité du portefeuille';
    totals.push([dir, pdfSafe(formatBaisa(data.walletAmountBaisa, 'en', { signed: true })), false]);
  }
  for (const [k, v, strong] of totals) {
    text(ctx, k, ctx.right - 120, { size: strong ? 12 : 10, bold: strong, color: strong ? NIGHT : MUTED, align: 'right' });
    text(ctx, v, ctx.right, { size: strong ? 12 : 10, bold: strong, color: strong ? SUCCESS : NIGHT, align: 'right' });
    ctx.y -= strong ? 20 : 16;
  }

  // Footer.
  ctx.y = 70;
  page.drawLine({ start: { x: ctx.left, y: 86 }, end: { x: ctx.right, y: 86 }, thickness: 0.7, color: LINE });
  text(ctx, 'DOOM - Sultanate of Oman / Sultanat d\'Oman. Amounts in Omani rial (OMR, 3 decimals).', ctx.left, { size: 8, color: MUTED });
  ctx.y -= 12;
  text(ctx, 'This receipt was generated from DOOM\'s ledger. / Ce reçu est généré à partir du registre comptable de DOOM.', ctx.left, { size: 8, color: MUTED });
  ctx.y -= 12;
  text(ctx, 'Arabic version: open the receipt page in your account. / Version arabe : page du reçu dans votre compte.', ctx.left, { size: 8, color: MUTED });

  return doc.save();
}
