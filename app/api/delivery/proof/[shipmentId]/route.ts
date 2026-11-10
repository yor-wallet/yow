import { NextResponse } from 'next/server';
import { apiHandler, HttpError } from '@/lib/http';
import { requireApiUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { getRequestMeta } from '@/lib/request';
import { readProofPhoto } from '@/lib/delivery/proof';

type Ctx = { params: Promise<{ shipmentId: string }> };

/**
 * Proof-of-delivery photo (private, encrypted at rest). Allowed: logistics staff
 * (`delivery:read`), the order's customer, the assigned courier. Every access is audited.
 */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireApiUser();
  const { shipmentId } = await params;
  const s = await prisma.shipment.findUnique({
    where: { id: shipmentId.slice(0, 64) },
    select: { id: true, proofPhotoKey: true, order: { select: { userId: true } }, courier: { select: { userId: true } } },
  });
  if (!s || !s.proofPhotoKey) throw new HttpError(404, 'not_found');
  const allowed = can(session.user.role, 'delivery:read') || s.order.userId === session.user.id || s.courier?.userId === session.user.id;
  if (!allowed) throw new HttpError(404, 'not_found');
  const photo = await readProofPhoto(s.id, s.proofPhotoKey);
  if (!photo) throw new HttpError(404, 'not_found');
  const meta = await getRequestMeta();
  await logAudit({ actorId: session.user.id, actorRole: session.user.role, action: 'delivery.proof.view', entity: 'Shipment', entityId: s.id, ...meta });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      'Content-Type': photo.mime,
      'Cache-Control': 'no-store, private',
      'Content-Disposition': 'inline; filename="proof-of-delivery"',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
});
