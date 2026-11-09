import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Role, TicketStatus } from '@prisma/client';
import { prisma, isUniqueViolation } from '../db';
import { can } from '../rbac';
import { logAudit } from '../audit';
import { rateLimit } from '../rate-limit';
import { notifyTemplate } from '../notifications';

/**
 * Customer support tickets (SupportTicket / SupportMessage).
 * Customers create tickets (optionally linked to one of their orders) and reply;
 * staff replies (`support:write`) can be public or internal notes (never shown to customers).
 */

export const TICKET_SUBJECT_MAX = 140;
export const TICKET_MESSAGE_MAX = 4000;
export const ACCOUNT_DELETION_SUBJECT = 'ACCOUNT DELETION REQUEST';

export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(4, 'subject_too_short').max(TICKET_SUBJECT_MAX, 'too_long'),
  message: z.string().trim().min(10, 'message_too_short').max(TICKET_MESSAGE_MAX, 'too_long'),
  orderNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const ticketReplySchema = z.object({
  message: z.string().trim().min(2, 'message_too_short').max(TICKET_MESSAGE_MAX, 'too_long'),
});

export class SupportError extends Error {
  constructor(public readonly code: 'not_found' | 'order_not_found' | 'closed' | 'rate_limited' | 'forbidden') {
    super(code);
    this.name = 'SupportError';
  }
}

/** `ST-YYMMDD-XXXXX` (Crockford base32). */
export function generateTicketNumber(now = new Date()): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  let suffix = '';
  for (const b of randomBytes(5)) suffix += alphabet[b % 32];
  return `ST-${d}-${suffix}`;
}

export async function createTicket(input: {
  userId: string;
  subject: string;
  message: string;
  orderNumber?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}) {
  const data = ticketCreateSchema.parse(input);
  const rl = await rateLimit(`support:create:${input.userId}`, 10, 60 * 60 * 1000);
  if (!rl.ok) throw new SupportError('rate_limited');
  let orderId: string | null = null;
  if (data.orderNumber) {
    const order = await prisma.order.findFirst({ where: { number: data.orderNumber, userId: input.userId }, select: { id: true } });
    if (!order) throw new SupportError('order_not_found');
    orderId = order.id;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const ticket = await tx.supportTicket.create({
          data: {
            number: generateTicketNumber(),
            userId: input.userId,
            orderId,
            subject: data.subject,
            priority: input.priority ?? 'NORMAL',
            messages: { create: { authorId: input.userId, body: data.message } },
          },
        });
        await notifyTemplate(input.userId, 'supportCreated', { number: ticket.number }, `/account/support/${ticket.number}`, tx);
        return ticket;
      });
    } catch (err) {
      if (attempt < 3 && isUniqueViolation(err, 'number')) continue;
      throw err;
    }
  }
}

export async function listTickets(userId: string) {
  return prisma.supportTicket.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      number: true,
      subject: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      order: { select: { number: true } },
      _count: { select: { messages: { where: { isInternal: false } } } },
      messages: { where: { isInternal: false }, orderBy: { createdAt: 'desc' }, take: 1, select: { isStaff: true, createdAt: true } },
    },
  });
}

/** Ticket + public messages for its owner (internal notes are never returned). */
export async function getTicketThread(userId: string, number: string) {
  return prisma.supportTicket.findFirst({
    where: { userId, number },
    include: {
      order: { select: { number: true } },
      messages: {
        where: { isInternal: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true, body: true, isStaff: true, createdAt: true, author: { select: { fullName: true } } },
      },
    },
  });
}

const CLOSED: readonly TicketStatus[] = ['CLOSED'];

/** Customer reply. A RESOLVED ticket re-opens; a CLOSED one cannot be replied to. */
export async function replyToTicket(input: { userId: string; number: string; message: string }) {
  const { message } = ticketReplySchema.parse({ message: input.message });
  const rl = await rateLimit(`support:reply:${input.userId}`, 30, 60 * 60 * 1000);
  if (!rl.ok) throw new SupportError('rate_limited');
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.findFirst({ where: { userId: input.userId, number: input.number } });
    if (!ticket) throw new SupportError('not_found');
    if (CLOSED.includes(ticket.status)) throw new SupportError('closed');
    await tx.supportMessage.create({ data: { ticketId: ticket.id, authorId: input.userId, body: message } });
    const status: TicketStatus = ticket.status === 'RESOLVED' || ticket.status === 'WAITING_CUSTOMER' ? 'OPEN' : ticket.status;
    return tx.supportTicket.update({ where: { id: ticket.id }, data: { status, updatedAt: new Date() } });
  });
}

/** Staff reply / internal note (admin inbox). Notifies the customer for public replies. */
export async function staffReplyToTicket(input: {
  ticketId: string;
  staff: { id: string; role: Role };
  message: string;
  internal?: boolean;
  status?: TicketStatus;
}) {
  if (!can(input.staff.role, 'support:write')) throw new SupportError('forbidden');
  const { message } = ticketReplySchema.parse({ message: input.message });
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new SupportError('not_found');
    await tx.supportMessage.create({
      data: { ticketId: ticket.id, authorId: input.staff.id, isStaff: true, isInternal: !!input.internal, body: message },
    });
    const status = input.status ?? (input.internal ? ticket.status : 'WAITING_CUSTOMER');
    const updated = await tx.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status,
        assignedToId: ticket.assignedToId ?? input.staff.id,
        closedAt: status === 'CLOSED' ? new Date() : status === ticket.status ? ticket.closedAt : null,
      },
    });
    await logAudit(
      {
        actorId: input.staff.id,
        actorRole: input.staff.role,
        action: input.internal ? 'support.note' : 'support.reply',
        entity: 'SupportTicket',
        entityId: ticket.id,
        before: { status: ticket.status },
        after: { status },
      },
      tx,
    );
    if (!input.internal) {
      await notifyTemplate(ticket.userId, 'supportReply', { number: ticket.number }, `/account/support/${ticket.number}`, tx);
    }
    return updated;
  });
}
