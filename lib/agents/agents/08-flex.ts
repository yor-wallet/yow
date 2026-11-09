import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { DAY, muscatDayStart } from '../util';

/**
 * 8 · FLEX follow-up — overdue instalments and instalments due within 3 days.
 * Proposes `notification.send` reminders (sent only once a human approves).
 */
export default defineAgent({
  key: 'flex',
  number: 8,
  nameKey: 'flex',
  scopes: ['flexInstallment', 'flexApplication'],
  schedule: { everyMinutes: AGENT_INTERVALS.flex },
  async run(ctx) {
    const today = muscatDayStart(ctx.now);
    const soon = new Date(today.getTime() + 4 * DAY);
    const rows = await ctx.db.flexInstallment.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lt: soon }, application: { status: { in: ['ACTIVE', 'ACCEPTED'] } } },
      select: {
        id: true,
        sequence: true,
        dueDate: true,
        amountBaisa: true,
        status: true,
        application: { select: { id: true, userId: true, months: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 2000,
    });
    let overdue = 0;
    let upcoming = 0;
    for (const r of rows) {
      const due = r.dueDate.toISOString().slice(0, 10);
      const isOverdue = r.dueDate < today;
      const days = Math.round(Math.abs(today.getTime() - r.dueDate.getTime()) / DAY);
      if (isOverdue) overdue++;
      else upcoming++;
      ctx.propose({
        severity: isOverdue ? (days > 14 ? 'HIGH' : 'MEDIUM') : 'INFO',
        titleKey: isOverdue ? 'flex.overdue' : 'flex.dueSoon',
        params: { sequence: r.sequence, months: r.application.months, days },
        title: isOverdue
          ? `FLEX instalment ${r.sequence}/${r.application.months} overdue by ${days} day(s)`
          : `FLEX instalment ${r.sequence}/${r.application.months} due in ${days} day(s)`,
        details: { installmentId: r.id, applicationId: r.application.id, userId: r.application.userId, dueDate: due, amountBaisa: r.amountBaisa },
        action: {
          type: 'notification.send',
          params: {
            userId: r.application.userId,
            type: isOverdue ? 'flex.overdue' : 'flex.reminder',
            template: isOverdue ? 'flexOverdue' : 'flexReminder',
            vars: { sequence: r.sequence, months: r.application.months, dueDate: due, amountBaisa: r.amountBaisa },
            link: '/flex',
          },
        },
        fingerprint: `${isOverdue ? 'overdue' : 'due'}:${r.id}`,
      });
    }
    ctx.metric('overdue', overdue);
    ctx.metric('dueSoon', upcoming);
  },
});
