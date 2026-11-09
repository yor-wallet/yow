import type { Prisma, ProposalSeverity } from '@prisma/client';
import { prisma, type Db } from '@/lib/db';
import { logAudit } from '@/lib/audit';

/**
 * Raise a finance alert: an audit record plus an open `AgentProposal` (agentKey `payments`)
 * so it surfaces in the admin centre's alerts for human review. Never throws (alerts must
 * not break the payment flow); failures are logged.
 */
export async function raisePaymentAlert(
  input: { severity: ProposalSeverity; title: string; code: string; details: Record<string, unknown> },
  db: Db = prisma,
): Promise<void> {
  try {
    await db.agentProposal.create({
      data: {
        agentKey: 'payments',
        severity: input.severity,
        title: input.title,
        details: { ...input.details, code: input.code, source: 'money', fingerprint: `${input.code}:${String(input.details.paymentIntentId ?? '')}` } as Prisma.InputJsonValue,
      },
    });
    await logAudit(
      { actorId: null, action: `payment.alert.${input.code}`, entity: 'PaymentIntent', entityId: (input.details.paymentIntentId as string) ?? null, after: input.details },
      db,
    );
  } catch (err) {
    console.error('[payments] failed to raise alert', input.code, err);
  }
}
