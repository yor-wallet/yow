import { defineAgent } from '../framework';
import { llmSummaryEnabled, summariseTickets } from '../llm';
import { AGENT_INTERVALS } from '../schedule';
import { ago, categoriseText, HOUR, top } from '../util';

/**
 * 9 · Customer support — tickets waiting on staff beyond the SLA (`support.slaHours`,
 * proposes `ticket.escalate`), and a deterministic keyword categorisation of open
 * tickets. Optional LLM summary (off by default, see lib/agents/llm.ts).
 */
export default defineAgent({
  key: 'support',
  number: 9,
  nameKey: 'support',
  scopes: ['supportTicket', 'supportMessage'],
  schedule: { everyMinutes: AGENT_INTERVALS.support },
  async run(ctx) {
    const sla = ctx.settings['support.slaHours'];
    const tickets = await ctx.db.supportTicket.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: {
        id: true,
        number: true,
        subject: true,
        priority: true,
        createdAt: true,
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { isStaff: true, createdAt: true, body: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    ctx.metric('openTickets', tickets.length);
    const deadline = ago(ctx.now, sla * HOUR);
    const categories: Record<string, number> = {};
    const lines: string[] = [];
    let breaches = 0;
    for (const t of tickets) {
      const last = t.messages[0];
      const cat = categoriseText(`${t.subject} ${last?.body ?? ''}`);
      categories[cat] = (categories[cat] ?? 0) + 1;
      lines.push(`[${cat}] ${t.subject}${last && !last.isStaff ? ` — ${last.body}` : ''}`);
      // Waiting on staff: no staff reply after the customer's last message.
      const waitingSince = last ? (last.isStaff ? null : last.createdAt) : t.createdAt;
      if (!waitingSince || waitingSince > deadline) continue;
      breaches++;
      const hours = Math.round((ctx.now.getTime() - waitingSince.getTime()) / HOUR);
      const target = t.priority === 'URGENT' ? null : t.priority === 'HIGH' ? 'URGENT' : 'HIGH';
      ctx.propose({
        severity: hours > sla * 2 ? 'HIGH' : 'MEDIUM',
        titleKey: 'support.slaBreach',
        params: { number: t.number, hours },
        title: `Ticket ${t.number} waiting ${hours}h for a reply (SLA ${sla}h)`,
        details: { ticketId: t.id, number: t.number, subject: t.subject, category: cat, priority: t.priority, waitingHours: hours, slaHours: sla },
        action: target ? { type: 'ticket.escalate', params: { ticketId: t.id, priority: target } } : undefined,
        fingerprint: `sla:${t.id}`,
      });
    }
    ctx.metric('slaBreaches', breaches);

    if (tickets.length) {
      const summary = llmSummaryEnabled() ? await summariseTickets(top(lines, 60)) : null;
      ctx.metric('llmSummary', summary ? 'generated' : llmSummaryEnabled() ? 'unavailable' : 'disabled');
      ctx.propose({
        severity: 'INFO',
        titleKey: 'support.categories',
        params: { count: tickets.length },
        title: `${tickets.length} open ticket(s) by category`,
        details: { categories, ...(summary ? { llmSummary: summary } : {}) },
        fingerprint: 'categories',
      });
    }
  },
});
