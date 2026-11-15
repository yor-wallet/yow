import { prisma } from '@/lib/db';
import { can } from '@/lib/rbac';
import { appUrl, sendEmail } from '@/lib/email';
import { flexDecisionMessage, flexSubmittedAdminMessage } from '@/lib/email/templates';
import { localize } from '@/lib/localized';
import { formatBaisa } from '@/lib/money';

/**
 * DOOM FLEX e-mails. Every staff member who can decide (`flex:decide`) is told about each new application;
 * the customer is told about the decision. Never throws: an e-mail problem must not undo an application
 * or a decision.
 */
export async function notifyStaffOfFlexApplication(applicationId: string): Promise<{ sent: number; skipped: number }> {
  try {
    const app = await prisma.flexApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, months: true, principalBaisa: true, createdAt: true, user: { select: { fullName: true } }, product: { select: { name: true } } },
    });
    if (!app) return { sent: 0, skipped: 0 };
    const staff = await prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['FINANCE', 'ADMIN', 'SUPERADMIN'] } },
      select: { email: true, fullName: true, role: true, locale: true },
    });
    let sent = 0;
    let skipped = 0;
    for (const member of staff.filter((s) => can(s.role, 'flex:decide'))) {
      const locale = member.locale === 'en' ? 'en' : 'ar';
      const res = await sendEmail(
        flexSubmittedAdminMessage({
          locale: member.locale,
          admin: { email: member.email, name: member.fullName },
          customerName: app.user.fullName,
          productName: localize(app.product?.name, locale),
          months: app.months,
          total: formatBaisa(app.principalBaisa, locale),
          submittedAt: app.createdAt,
          url: appUrl(`/${locale}/admin/finance/flex/${app.id}`),
        }),
      );
      if (res.ok) sent++;
      else skipped++;
    }
    return { sent, skipped };
  } catch (err) {
    console.error('[email] flex staff notification failed', err instanceof Error ? err.message : err);
    return { sent: 0, skipped: 0 };
  }
}

export async function notifyCustomerOfFlexDecision(applicationId: string): Promise<boolean> {
  try {
    const app = await prisma.flexApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, status: true, decisionNote: true, user: { select: { email: true, fullName: true, locale: true } }, product: { select: { name: true } } },
    });
    if (!app || (app.status !== 'APPROVED' && app.status !== 'REJECTED')) return false;
    const locale = app.user.locale === 'en' ? 'en' : 'ar';
    const res = await sendEmail(
      flexDecisionMessage({
        locale: app.user.locale,
        email: app.user.email,
        name: app.user.fullName,
        decision: app.status,
        productName: localize(app.product?.name, locale),
        note: app.decisionNote,
        url: appUrl(`/${locale}/flex/${app.id}`),
      }),
    );
    return res.ok;
  } catch (err) {
    console.error('[email] flex decision e-mail failed', err instanceof Error ? err.message : err);
    return false;
  }
}
