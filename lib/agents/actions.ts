import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { createTranslator } from 'next-intl';
import { idSchema } from '@/lib/validation';
import { notify } from '@/lib/notifications';
import { formatBaisa } from '@/lib/money';
import type { LocalizedText } from '@/lib/localized';
import { AdminError, NotFoundError, type Actor } from '@/lib/admin/actor';
import type { AuditInput } from '@/lib/admin/mutation';
import arAgents from '@/messages/ar/agents.json';
import enAgents from '@/messages/en/agents.json';
import frAgents from '@/messages/fr/agents.json';
import { ACTION_PERMISSIONS, type ActionType } from './action-types';
import { releaseExpiredReservations } from '@/lib/orders';

/**
 * Whitelisted action handlers executed by `applyProposal` AFTER human approval, inside
 * the approval transaction (audit rows commit atomically with the change).
 * Agents never call these.
 */

type HandlerCtx = {
  tx: Prisma.TransactionClient;
  actor: Actor;
  audit: (e: AuditInput) => Promise<void>;
  /** Result of the EXTERNAL effect (see EXTERNAL_ACTIONS), already executed before the transaction. */
  external?: Record<string, unknown>;
};
type AnyHandler = { schema: z.ZodTypeAny; apply: (params: unknown, ctx: HandlerCtx) => Promise<Record<string, unknown>> };

/** Typed at definition, erased in the table (params are validated by `schema` before `apply`). */
function handler<S extends z.ZodTypeAny>(schema: S, apply: (params: z.output<S>, ctx: HandlerCtx) => Promise<Record<string, unknown>>): AnyHandler {
  return { schema, apply: apply as AnyHandler['apply'] };
}

type LooseT = (key: string, values?: Record<string, string | number>) => string;
const MESSAGES = { ar: arAgents, en: enAgents, fr: frAgents } as const;
function renderAgentTemplate(template: string, vars: Record<string, string | number>): { title: LocalizedText; body: LocalizedText } {
  const title = {} as LocalizedText;
  const body = {} as LocalizedText;
  for (const locale of ['ar', 'en', 'fr'] as const) {
    const t = (createTranslator as unknown as (o: { locale: string; messages: Record<string, unknown>; namespace: string }) => LooseT)({
      locale,
      messages: { agents: MESSAGES[locale] },
      namespace: 'agents.notificationTemplates',
    });
    const v = { ...vars, amount: typeof vars.amountBaisa === 'number' ? formatBaisa(vars.amountBaisa, locale) : '' };
    title[locale] = t(`${template}.title`, v);
    body[locale] = t(`${template}.body`, v);
  }
  return { title, body };
}

export const ACTION_HANDLERS: { [K in ActionType]: AnyHandler } = {
  'variant.setPrice': handler(z.object({ variantId: idSchema, priceBaisa: z.number().int().positive().max(1_000_000_000) }), async (p, { tx, audit }) => {
    const before = await tx.productVariant.findUnique({ where: { id: p.variantId }, select: { id: true, sku: true, priceBaisa: true, compareAtBaisa: true } });
    if (!before) throw new NotFoundError('ProductVariant');
    const after = await tx.productVariant.update({ where: { id: p.variantId }, data: { priceBaisa: p.priceBaisa }, select: { id: true, sku: true, priceBaisa: true } });
    await audit({ action: 'variant.price.update', entity: 'ProductVariant', entityId: p.variantId, before: { priceBaisa: before.priceBaisa }, after: { priceBaisa: after.priceBaisa, source: 'agent_proposal' } });
    return { variantId: p.variantId, priceBaisa: after.priceBaisa };
  }),

  'product.disableSale': handler(z.object({ productId: idSchema }), async (p, { tx, audit }) => {
    const before = await tx.product.findUnique({ where: { id: p.productId }, select: { isSellable: true } });
    if (!before) throw new NotFoundError('Product');
    await tx.product.update({ where: { id: p.productId }, data: { isSellable: false } });
    await audit({ action: 'product.sale.disable', entity: 'Product', entityId: p.productId, before, after: { isSellable: false } });
    return { productId: p.productId };
  }),

  'campaign.deactivate': handler(z.object({ campaignId: idSchema }), async (p, { tx, audit }) => {
    const before = await tx.campaign.findUnique({ where: { id: p.campaignId }, select: { isActive: true } });
    if (!before) throw new NotFoundError('Campaign');
    await tx.campaign.update({ where: { id: p.campaignId }, data: { isActive: false } });
    await audit({ action: 'campaign.deactivate', entity: 'Campaign', entityId: p.campaignId, before, after: { isActive: false } });
    return { campaignId: p.campaignId };
  }),

  'promotion.deactivate': handler(z.object({ promotionId: idSchema }), async (p, { tx, audit }) => {
    const before = await tx.promotion.findUnique({ where: { id: p.promotionId }, select: { isActive: true } });
    if (!before) throw new NotFoundError('Promotion');
    await tx.promotion.update({ where: { id: p.promotionId }, data: { isActive: false } });
    await audit({ action: 'promotion.deactivate', entity: 'Promotion', entityId: p.promotionId, before, after: { isActive: false } });
    return { promotionId: p.promotionId };
  }),

  'payment.flag': handler(z.object({ paymentIntentId: idSchema, reason: z.string().trim().min(1).max(64) }), async (p, { tx, actor, audit }) => {
    const before = await tx.paymentIntent.findUnique({ where: { id: p.paymentIntentId }, select: { metadata: true, status: true } });
    if (!before) throw new NotFoundError('PaymentIntent');
    const meta = (before.metadata && typeof before.metadata === 'object' && !Array.isArray(before.metadata) ? before.metadata : {}) as Record<string, unknown>;
    // Flagging marks the intent for manual review; it never changes its status or money.
    const flagged = { reason: p.reason, by: actor.id, at: new Date().toISOString() };
    await tx.paymentIntent.update({ where: { id: p.paymentIntentId }, data: { metadata: { ...meta, flagged } as Prisma.InputJsonValue } });
    await audit({ action: 'payment.flag', entity: 'PaymentIntent', entityId: p.paymentIntentId, before: { flagged: meta.flagged ?? null }, after: { flagged } });
    return { paymentIntentId: p.paymentIntentId };
  }),

  'notification.send': handler(
    z.object({
      userId: idSchema,
      type: z.string().trim().min(1).max(64),
      template: z.enum(['flexReminder', 'flexOverdue']),
      vars: z.record(z.union([z.string(), z.number()])).default({}),
      link: z.string().startsWith('/').max(200).nullable().optional(),
    }),
    async (p, { tx, audit }) => {
      const user = await tx.user.findUnique({ where: { id: p.userId }, select: { id: true } });
      if (!user) throw new NotFoundError('User');
      const { title, body } = renderAgentTemplate(p.template, p.vars);
      const n = await notify({ userId: p.userId, type: p.type, title, body, link: p.link ?? null }, tx);
      await audit({ action: 'notification.send', entity: 'Notification', entityId: n.id, after: { userId: p.userId, type: p.type, template: p.template } });
      return { notificationId: n.id };
    },
  ),

  'ticket.escalate': handler(z.object({ ticketId: idSchema, priority: z.enum(['HIGH', 'URGENT']) }), async (p, { tx, audit }) => {
    const before = await tx.supportTicket.findUnique({ where: { id: p.ticketId }, select: { priority: true } });
    if (!before) throw new NotFoundError('SupportTicket');
    await tx.supportTicket.update({ where: { id: p.ticketId }, data: { priority: p.priority } });
    await audit({ action: 'ticket.escalate', entity: 'SupportTicket', entityId: p.ticketId, before, after: { priority: p.priority } });
    return { ticketId: p.ticketId, priority: p.priority };
  }),

  'reservations.releaseExpired': handler(z.object({}).passthrough(), async (_p, { audit, external }) => {
    await audit({ action: 'reservations.release_expired', entity: 'StockReservation', after: external ?? {} });
    return external ?? {};
  }),
};

/**
 * Actions whose effect is owned by another module and runs in its OWN transactions
 * (storefront `releaseExpiredReservations`). They are idempotent: executed first, then the
 * proposal is marked APPLIED and audited with their result.
 */
export const EXTERNAL_ACTIONS: Partial<Record<ActionType, (params: Record<string, unknown>) => Promise<Record<string, unknown>>>> = {
  'reservations.releaseExpired': async () => {
    const r = await releaseExpiredReservations(new Date());
    return { orders: r.orders, reservations: r.reservations };
  },
};

export function actionPermission(type: ActionType) {
  return ACTION_PERMISSIONS[type];
}

/** Validate params and run the handler. Throws AdminError('action_invalid') on bad params. */
export async function executeAction(type: ActionType, params: unknown, ctx: HandlerCtx): Promise<Record<string, unknown>> {
  const h = ACTION_HANDLERS[type];
  const parsed = h.schema.safeParse(params ?? {});
  if (!parsed.success) throw new AdminError('action_invalid');
  return h.apply(parsed.data, ctx);
}
