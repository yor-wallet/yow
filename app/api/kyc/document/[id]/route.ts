import { NextResponse } from 'next/server';
import { apiHandler, HttpError } from '@/lib/http';
import { requireApiPermission } from '@/lib/auth';
import { getRequestMeta } from '@/lib/request';
import { getKycDocumentForReview, KycError, verifyKycDocumentToken } from '@/lib/kyc';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Authorised, audited KYC document viewer. Requires the reviewer's session with
 * `kyc:documents` (ADMIN/SUPERADMIN). When the link carries `?t=` (from
 * `kycDocumentUrl()`), the short-lived token must match the document and the reviewer.
 * Decrypted bytes are never cached (`no-store`) and served sandboxed.
 */
export const GET = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireApiPermission('kyc:documents');
  const { id } = await params;
  const docId = id.slice(0, 64);
  const token = new URL(req.url).searchParams.get('t');
  if (token !== null && !(await verifyKycDocumentToken(token, docId, session.user.id))) {
    throw new HttpError(403, 'link_expired');
  }
  const meta = await getRequestMeta();
  try {
    const doc = await getKycDocumentForReview(docId, session.user.id, meta);
    return new NextResponse(new Uint8Array(doc.bytes), {
      headers: {
        'Content-Type': doc.mime,
        'Cache-Control': 'no-store, private, max-age=0',
        Pragma: 'no-cache',
        'Content-Disposition': `inline; filename="kyc-${doc.type.toLowerCase()}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (err) {
    if (err instanceof KycError) throw new HttpError(err.code === 'forbidden' ? 403 : 404, err.code);
    throw err;
  }
});
