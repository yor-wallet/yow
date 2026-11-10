import { requireApiUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { apiHandler, HttpError } from '@/lib/http';
import { loadReceipt, renderReceiptPdf, type ReceiptKind } from '@/lib/receipts';

/**
 * GET /api/receipts/wallet/:ledgerTransactionId  |  /api/receipts/order/:orderIdOrNumber
 * PDF receipt (English + French). Owner, or staff with `wallets:read` / `orders:read`.
 * The Arabic receipt is the printable page /ar/wallet/receipt/:id.
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler<{ params: Promise<{ type: string; id: string }> }>(async (_req, ctx) => {
  const session = await requireApiUser();
  const { type, id } = await ctx.params;
  if ((type !== 'wallet' && type !== 'order') || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(404, 'not_found');
  const data = await loadReceipt(type as ReceiptKind, id, { id: session.user.id, role: session.user.role });
  if (!data) throw new HttpError(404, 'not_found');
  const pdf = await renderReceiptPdf(data);
  if (session.user.id !== data.ownerId) {
    await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'receipt.download', entity: type === 'wallet' ? 'LedgerTransaction' : 'Order', entityId: data.id });
  }
  return new Response(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="doom-receipt-${data.reference.replace(/[^A-Za-z0-9-]/g, '')}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

