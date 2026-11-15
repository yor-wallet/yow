import { Prisma, type Promotion } from '@prisma/client';
import { z } from 'zod';
import { prisma, isUniqueViolation } from '@/lib/db';
import { idSchema } from '@/lib/validation';
import { localize } from '@/lib/localized';
import { isPromotionLive } from '@/lib/catalog/promotions';
import { toRule } from '@/lib/catalog/promotions-db';
import { NotFoundError, ValidationError } from './actor';
import { changedFields, defineMutation } from './mutation';
import { zBool, zDateOpt, zIdList, zIntOpt, zLocalized, zLocalizedOpt, zMoney, zMoneyOpt, zPercentBps } from './zod';

/**
 * Promotion manager. A promotion is a real discount applied by the order engine
 * (`lib/catalog/promotions.ts`): automatic when it has no code, or unlocked by its code.
 * It can target products, categories and/or brands (nothing chosen = the whole cart), be limited
 * in time and in number of uses. A new promotion is never active by itself: it is switched on
 * explicitly (a discount is money). Every change is audited.
 */

export const PROMOTION_TYPES = ['PERCENT', 'FIXED'] as const;
/** A percentage above this is almost certainly a typing mistake (50 instead of 5). */
export const MAX_PERCENT_BPS = 9000;

const empty = (v: unknown) => v === undefined || v === null || String(v).trim() === '';
const zCode = z.preprocess(
  (v) => (empty(v) ? null : String(v).trim().toUpperCase()),
  z.string().regex(/^[A-Z0-9_-]{3,32}$/, 'code_invalid').nullable(),
);

export const promotionSchema = z
  .object({
    id: idSchema.optional(),
    name: zLocalized(120),
    description: zLocalizedOpt(400),
    type: z.enum(PROMOTION_TYPES),
    /** PERCENT: "5" or "7.5" (%). */
    percent: z.unknown().optional(),
    /** FIXED: an amount in OMR. */
    amount: z.unknown().optional(),
    code: zCode,
    minSubtotalBaisa: zMoneyOpt(),
    maxDiscountBaisa: zMoneyOpt(),
    productIds: zIdList(100),
    categoryIds: zIdList(60),
    brandIds: zIdList(60),
    startsAt: zDateOpt(),
    endsAt: zDateOpt(),
    usageLimit: zIntOpt(1, 1_000_000),
    perUserLimit: zIntOpt(1, 1000),
    isActive: zBool,
  })
  .transform((v, ctx) => {
    const { percent, amount, ...rest } = v;
    let value = 0;
    if (v.type === 'PERCENT') {
      const r = zPercentBps(MAX_PERCENT_BPS).safeParse(percent);
      if (!r.success || r.data < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percent'], message: 'percent_invalid' });
      else value = r.data;
    } else {
      const r = zMoney({ positive: true, max: 5_000_000 }).safeParse(amount);
      if (!r.success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: r.error.issues[0]?.message ?? 'amount_invalid' });
      else value = r.data;
    }
    if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'end_before_start' });
    // A cap only makes sense on a percentage; on a fixed amount it would silently shrink the discount.
    return { ...rest, value, maxDiscountBaisa: v.type === 'PERCENT' ? v.maxDiscountBaisa : null };
  });

export const savePromotion = defineMutation({
  name: 'promotion.save',
  permission: 'promotions:write',
  schema: promotionSchema,
  async run({ tx, actor, input, audit }) {
    const { id, description, ...rest } = input;
    // Only real targets are kept (unknown ids are dropped).
    const [products, categories, brands] = await Promise.all([
      rest.productIds.length ? tx.product.findMany({ where: { id: { in: rest.productIds } }, select: { id: true } }) : [],
      rest.categoryIds.length ? tx.category.findMany({ where: { id: { in: rest.categoryIds } }, select: { id: true } }) : [],
      rest.brandIds.length ? tx.brand.findMany({ where: { id: { in: rest.brandIds } }, select: { id: true } }) : [],
    ]);
    const keep = (ids: string[], found: { id: string }[]) => ids.filter((x) => found.some((f) => f.id === x));
    const data = {
      ...rest,
      productIds: keep(rest.productIds, products),
      categoryIds: keep(rest.categoryIds, categories),
      brandIds: keep(rest.brandIds, brands),
      description: description ?? Prisma.DbNull,
    };
    try {
      if (!id) {
        const p = await tx.promotion.create({ data: { ...data, createdById: actor.id } });
        await audit({ action: 'promotion.create', entity: 'Promotion', entityId: p.id, after: { ...data, description } });
        return { id: p.id };
      }
      const before = await tx.promotion.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Promotion');
      const after = await tx.promotion.update({ where: { id }, data });
      const diff = changedFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
      delete diff.before.updatedAt;
      delete diff.after.updatedAt;
      if (Object.keys(diff.after).length > 0) await audit({ action: 'promotion.update', entity: 'Promotion', entityId: id, before: diff.before, after: diff.after });
      return { id };
    } catch (err) {
      if (isUniqueViolation(err, 'code')) throw new ValidationError({ code: ['code_taken'] });
      throw err;
    }
  },
});

export const togglePromotion = defineMutation({
  name: 'promotion.toggle',
  permission: 'promotions:write',
  schema: z.object({ id: idSchema, isActive: zBool }),
  async run({ tx, input, audit }) {
    const p = await tx.promotion.findUnique({ where: { id: input.id }, select: { isActive: true } });
    if (!p) throw new NotFoundError('Promotion');
    if (p.isActive === input.isActive) return { id: input.id };
    await tx.promotion.update({ where: { id: input.id }, data: { isActive: input.isActive } });
    await audit({ action: input.isActive ? 'promotion.activate' : 'promotion.deactivate', entity: 'Promotion', entityId: input.id, before: p, after: { isActive: input.isActive } });
    return { id: input.id };
  },
});

/** A promotion already used by an order is part of that order's history: it is switched off, never deleted. */
export const deletePromotion = defineMutation({
  name: 'promotion.delete',
  permission: 'promotions:write',
  schema: z.object({ id: idSchema }),
  async run({ tx, input, audit }) {
    const p = await tx.promotion.findUnique({ where: { id: input.id }, select: { id: true, code: true, name: true, usageCount: true, _count: { select: { orders: true } } } });
    if (!p) throw new NotFoundError('Promotion');
    if (p.usageCount > 0 || p._count.orders > 0) throw new ValidationError({ id: ['promotion_in_use'] });
    await tx.promotion.delete({ where: { id: input.id } });
    await audit({ action: 'promotion.delete', entity: 'Promotion', entityId: input.id, before: { code: p.code, name: p.name } });
    return { id: input.id };
  },
});

// ───────────── reads ─────────────

export type PromotionState = 'live' | 'scheduled' | 'ended' | 'used_up' | 'off';

/** What the customer experiences right now. */
export function promotionState(p: Promotion, now: Date = new Date()): PromotionState {
  if (!p.isActive) return 'off';
  if (p.usageLimit !== null && p.usageCount >= p.usageLimit) return 'used_up';
  if (p.endsAt && now >= p.endsAt) return 'ended';
  if (p.startsAt && now < p.startsAt) return 'scheduled';
  return isPromotionLive(toRule(p), now) ? 'live' : 'off';
}

export async function listPromotions(now: Date = new Date()) {
  const rows = await prisma.promotion.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }], take: 200 });
  return rows.map((p) => ({ ...p, state: promotionState(p, now) }));
}

export async function getPromotion(id: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const p = await prisma.promotion.findUnique({ where: { id } });
  if (!p) return null;
  const products = p.productIds.length
    ? await prisma.product.findMany({ where: { id: { in: p.productIds } }, select: { id: true, sku: true, name: true } })
    : [];
  return { promotion: p, products: p.productIds.map((pid) => products.find((x) => x.id === pid)).filter((x): x is (typeof products)[number] => !!x) };
}

/** Categories and brands a promotion can target. */
export async function promotionTargets(locale: string) {
  const [categories, brands] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { sort: 'asc' }], select: { id: true, name: true, parentId: true } }),
    prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const top = categories.filter((c) => !c.parentId);
  return {
    categories: top.flatMap((c) => [
      { id: c.id, label: localize(c.name, locale), child: false },
      ...categories.filter((s) => s.parentId === c.id).map((s) => ({ id: s.id, label: localize(s.name, locale), child: true })),
    ]),
    brands: brands.map((b) => ({ id: b.id, label: b.name })),
  };
}
