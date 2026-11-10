/** Receipts (money module): data with ownership checks, PDF rendering (en + fr). */
export { loadReceipt, loadWalletReceipt, loadOrderReceipt, getVatRateBps, includedVat } from './data';
export type { ReceiptData, ReceiptKind, ReceiptLine, Viewer } from './data';
export { renderReceiptPdf, pdfSafe } from './pdf';
