import { NextResponse } from 'next/server';
import { apiHandler, HttpError } from '@/lib/http';
import { requireApiPermission } from '@/lib/auth';
import { getGiftCardImage } from '@/lib/payments/giftcards';
import { isMoneyError } from '@/lib/wallet/errors';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Authorised, audited viewer of the photo a customer attached to a gift card. Requires a staff session
 * with `giftcards:review` (FINANCE / ADMIN / SUPERADMIN). Every view is written to the audit log by
 * `getGiftCardImage`. Decrypted bytes are never cached (`no-store`) and are served sandboxed.
 */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireApiPermission('giftcards:review');
  const { id } = await params;
  try {
    const image = await getGiftCardImage({ id: id.slice(0, 64), actorId: session.user.id });
    if (!image || !/^image\/(png|jpeg|webp)$/.test(image.mime)) throw new HttpError(404, 'not_found');
    return new NextResponse(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.mime,
        'Cache-Control': 'no-store, private, max-age=0',
        Pragma: 'no-cache',
        'Content-Disposition': 'inline; filename="gift-card"',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (err) {
    if (isMoneyError(err)) throw new HttpError(err.code === 'forbidden' ? 403 : 404, err.code);
    throw err;
  }
});
