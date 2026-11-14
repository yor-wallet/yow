import { prisma } from '@/lib/db';
import { can } from '@/lib/rbac';
import { appUrl, sendEmail } from '@/lib/email';
import { kycDecisionMessage, kycSubmittedAdminMessage } from '@/lib/email/templates';

/**
 * Identity-verification e-mails. Every administrator who can decide (`kyc:decide`) is told about each new
 * submission; the customer is told about the decision. Contents: names and a link — never a document.
 * Never throws: an e-mail problem must not undo a submission or a decision.
 */
export async function notifyAdminsOfKycSubmission(submissionId: string): Promise<{ sent: number; skipped: number }> {
  try {
    const sub = await prisma.kycSubmission.findUnique({ where: { id: submissionId }, select: { id: true, fullName: true, submittedAt: true } });
    if (!sub) return { sent: 0, skipped: 0 };
    const staff = await prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['ADMIN', 'SUPERADMIN'] } },
      select: { email: true, fullName: true, role: true, locale: true },
    });
    let sent = 0;
    let skipped = 0;
    for (const admin of staff.filter((s) => can(s.role, 'kyc:decide'))) {
      const locale = admin.locale === 'en' ? 'en' : 'ar';
      const res = await sendEmail(
        kycSubmittedAdminMessage({ locale: admin.locale, admin: { email: admin.email, name: admin.fullName }, customerName: sub.fullName, submittedAt: sub.submittedAt, url: appUrl(`/${locale}/admin/kyc/${sub.id}`) }),
      );
      if (res.ok) sent++;
      else skipped++;
    }
    return { sent, skipped };
  } catch (err) {
    console.error('[email] kyc admin notification failed', err instanceof Error ? err.message : err);
    return { sent: 0, skipped: 0 };
  }
}

export async function notifyCustomerOfKycDecision(submissionId: string): Promise<boolean> {
  try {
    const sub = await prisma.kycSubmission.findUnique({
      where: { id: submissionId },
      select: { status: true, reviewNote: true, user: { select: { email: true, fullName: true, locale: true } } },
    });
    if (!sub || (sub.status !== 'VERIFIED' && sub.status !== 'REJECTED' && sub.status !== 'DOCUMENTS_REQUESTED')) return false;
    const locale = sub.user.locale === 'en' ? 'en' : 'ar';
    const res = await sendEmail(
      kycDecisionMessage({ locale: sub.user.locale, email: sub.user.email, name: sub.user.fullName, decision: sub.status, note: sub.reviewNote, url: appUrl(`/${locale}/account/verification`) }),
    );
    return res.ok;
  } catch (err) {
    console.error('[email] kyc decision e-mail failed', err instanceof Error ? err.message : err);
    return false;
  }
}
