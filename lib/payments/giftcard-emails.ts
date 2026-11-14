import { prisma } from '@/lib/db';
import { can } from '@/lib/rbac';
import { appUrl, sendEmail } from '@/lib/email';
import { giftCardDecisionMessage, giftCardSubmittedAdminMessage } from '@/lib/email/templates';
import { formatBaisa } from '@/lib/money';

/**
 * Gift-card e-mails. Every staff member who can review gift cards (`giftcards:review`) is told about each
 * new card; the customer is told about the decision. Contents: brand, amounts and a link — never the code.
 * Never throws: an e-mail problem must not undo a submission or a decision.
 */
export async function notifyStaffOfGiftCard(submissionId: string): Promise<{ sent: number; skipped: number }> {
  try {
    const card = await prisma.giftCardSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, brand: true, createdAt: true, user: { select: { fullName: true } } },
    });
    if (!card) return { sent: 0, skipped: 0 };
    const staff = await prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['FINANCE', 'ADMIN', 'SUPERADMIN'] } },
      select: { email: true, fullName: true, role: true, locale: true },
    });
    let sent = 0;
    let skipped = 0;
    for (const member of staff.filter((s) => can(s.role, 'giftcards:review'))) {
      const locale = member.locale === 'en' ? 'en' : 'ar';
      const res = await sendEmail(
        giftCardSubmittedAdminMessage({
          locale: member.locale,
          admin: { email: member.email, name: member.fullName },
          customerName: card.user.fullName,
          brand: card.brand,
          submittedAt: card.createdAt,
          url: appUrl(`/${locale}/admin/finance/gift-cards/${card.id}`),
        }),
      );
      if (res.ok) sent++;
      else skipped++;
    }
    return { sent, skipped };
  } catch (err) {
    console.error('[email] gift card staff notification failed', err instanceof Error ? err.message : err);
    return { sent: 0, skipped: 0 };
  }
}

export async function notifyCustomerOfGiftCardDecision(submissionId: string): Promise<boolean> {
  try {
    const card = await prisma.giftCardSubmission.findUnique({
      where: { id: submissionId },
      select: {
        status: true,
        brand: true,
        notes: true,
        encashedValueBaisa: true,
        paymentIntent: { select: { metadata: true } },
        user: { select: { email: true, fullName: true, locale: true } },
      },
    });
    if (!card || (card.status !== 'VERIFIED' && card.status !== 'REJECTED')) return false;
    const locale = card.user.locale === 'en' ? 'en' : 'ar';
    const commission = Number((card.paymentIntent?.metadata as { commissionBaisa?: unknown } | null)?.commissionBaisa ?? 0) || 0;
    const credited = card.status === 'VERIFIED' && card.encashedValueBaisa !== null ? card.encashedValueBaisa - commission : null;
    const res = await sendEmail(
      giftCardDecisionMessage({
        locale: card.user.locale,
        email: card.user.email,
        name: card.user.fullName,
        decision: card.status,
        brand: card.brand,
        credited: credited !== null ? formatBaisa(credited, locale) : null,
        commission: credited !== null && commission > 0 ? formatBaisa(commission, locale) : null,
        note: card.status === 'REJECTED' ? card.notes : null,
        url: appUrl(`/${locale}/wallet`),
      }),
    );
    return res.ok;
  } catch (err) {
    console.error('[email] gift card decision e-mail failed', err instanceof Error ? err.message : err);
    return false;
  }
}
