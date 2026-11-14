import 'server-only';
import type { KycStatus } from '@prisma/client';
import { prisma } from '@/lib/db';

/** Admin view of one identity verification (metadata only — documents are opened through the audited viewer). */
export async function getKycSubmissionForAdmin(id: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return prisma.kycSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      fullName: true,
      requestedDocs: true,
      reviewNote: true,
      rejectionReason: true,
      submittedAt: true,
      reviewedAt: true,
      reviewedBy: { select: { fullName: true } },
      user: { select: { id: true, email: true, emailVerifiedAt: true, phone: true, fullName: true, kycStatus: true, createdAt: true } },
      documents: { where: { deletedAt: null }, orderBy: { type: 'asc' }, select: { id: true, type: true, mime: true, sizeBytes: true, createdAt: true } },
    },
  });
}

export const KYC_ADMIN_TABS: readonly KycStatus[] = ['PENDING', 'DOCUMENTS_REQUESTED', 'VERIFIED', 'REJECTED'];

export async function kycCounts(): Promise<Record<string, number>> {
  const rows = await prisma.kycSubmission.groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}
