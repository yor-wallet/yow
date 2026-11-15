/**
 * Promotion manager (Admin > Promotions): what staff may type, who may save, the audit trail, and that a
 * saved promotion is exactly what the order engine applies. Runs against PostgreSQL (doom_test); every
 * promotion and audit row created here is removed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, ValidationError, type Actor } from '@/lib/admin/actor';
import { deletePromotion, getPromotion, listPromotions, promotionSchema, promotionState, savePromotion, togglePromotion } from '@/lib/admin/promotions';
import { bestPromotion } from '@/lib/catalog/promotions';
import { loadLivePromotions } from '@/lib/catalog/promotions-db';
import { freeStandardDeliveryFrom } from '@/lib/delivery/zones';
import { cleanup, createDeliveryArea, createProduct, createUser, RUN } from './shop/fixtures';

const created: string[] = [];
const staffIds: string[] = [];
const code = (suffix: string) => `T${RUN.replace(/[^A-Za-z0-9]/g, '').slice(-10).toUpperCase()}${suffix}`;

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  staffIds.push(u.id);
  return { id: u.id, role };
}

const base = (over: Record<string, unknown> = {}) => ({
  name: { ar: 'عرض', en: 'Test offer', fr: 'Offre test' },
  type: 'PERCENT',
  percent: '5',
  code: code('A'),
  ...over,
});

async function save(actor: Actor | null, input: Record<string, unknown>) {
  const res = await savePromotion(actor, input);
  if (!created.includes(res.id)) created.push(res.id);
  return res.id;
}

const fieldErrors = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ValidationError);
  return (err as ValidationError).fieldErrors ?? {};
};

afterAll(async () => {
  await prisma.promotion.deleteMany({ where: { id: { in: created } } });
  await prisma.auditLog.deleteMany({ where: { entity: 'Promotion', entityId: { in: created } } });
  await cleanup();
  await prisma.$disconnect();
});

describe('promotion form values', () => {
  it('reads a percentage or an amount, upper-cases the code, and keeps a cap only on a percentage', () => {
    const pct = promotionSchema.parse(base({ percent: '7,5', code: ' welcome-5 ', maxDiscountBaisa: '10', minSubtotalBaisa: '50' }));
    expect(pct).toMatchObject({ type: 'PERCENT', value: 750, code: 'WELCOME-5', maxDiscountBaisa: 10_000, minSubtotalBaisa: 50_000, isActive: false });
    const fixed = promotionSchema.parse(base({ type: 'FIXED', percent: '', amount: '2.500', code: '', maxDiscountBaisa: '10' }));
    expect(fixed).toMatchObject({ type: 'FIXED', value: 2500, code: null, maxDiscountBaisa: null });
    expect(fixed).not.toHaveProperty('percent');
    expect(fixed).not.toHaveProperty('amount');
  });

  it('refuses a missing or absurd value, a bad code and an end before the start', () => {
    const issues = (input: Record<string, unknown>) => {
      const r = promotionSchema.safeParse(input);
      return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
    };
    expect(issues(base({ percent: '' }))).toContain('percent:percent_invalid');
    expect(issues(base({ percent: '0' }))).toContain('percent:percent_invalid');
    expect(issues(base({ percent: '95' }))).toContain('percent:percent_invalid'); // 50 typed instead of 5 is the usual accident
    expect(issues(base({ type: 'FIXED', amount: '0' }))).toContain('amount:amount_invalid');
    expect(issues(base({ code: 'ab' }))).toContain('code:code_invalid');
    expect(issues(base({ code: 'promo été' }))).toContain('code:code_invalid');
    expect(issues(base({ startsAt: '2026-11-21', endsAt: '2026-11-20' }))).toContain('endsAt:end_before_start');
    expect(issues(base({ name: { ar: 'عرض', en: '', fr: 'x' } })).some((i) => i.startsWith('name.en'))).toBe(true);
  });
});

describe('promotion manager', () => {
  it('only staff with the promotions right can save; a new promotion is off, audited, and keeps real targets only', async () => {
    const support = await staff('SUPPORT');
    const admin = await staff('ADMIN');
    await expect(savePromotion(support, base())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(savePromotion(null, base())).rejects.toBeInstanceOf(ForbiddenError);

    const product = await createProduct({ variants: [{ priceBaisa: 100_000, stock: 5 }] });
    const id = await save(admin, base({ productIds: [product.id, 'does-not-exist'], categoryIds: ['nope'] }));
    const row = await prisma.promotion.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ isActive: false, value: 500, type: 'PERCENT', code: code('A'), productIds: [product.id], categoryIds: [], createdById: admin.id });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'Promotion', entityId: id, action: 'promotion.create' } });
    expect(audit.actorId).toBe(admin.id);
    expect(promotionState(row)).toBe('off');
    expect((await listPromotions()).find((p) => p.id === id)?.state).toBe('off');
    expect((await getPromotion(id))?.products.map((p) => p.id)).toEqual([product.id]);
    expect(await getPromotion('../x')).toBeNull();

    // The same code cannot be used twice.
    expect(await fieldErrors(savePromotion(admin, base()))).toEqual({ code: ['code_taken'] });
  }, 60_000);

  it('once switched on, the order engine applies exactly what was saved; switching off stops it', async () => {
    const admin = await staff('ADMIN');
    const product = await createProduct({ variants: [{ priceBaisa: 200_000, stock: 5 }] });
    const id = await save(admin, base({ code: code('B'), percent: '10', maxDiscountBaisa: '15', productIds: [product.id] }));
    const line = { productId: product.id, categoryId: product.categoryId, brandId: product.brandId, lineTotalBaisa: 200_000 };

    expect((await loadLivePromotions()).some((p) => p.id === id)).toBe(false);
    await togglePromotion(admin, { id, isActive: 'true' });
    const live = (await loadLivePromotions()).filter((p) => p.id === id);
    expect(live).toHaveLength(1);
    // 10% of 200 OMR = 20 OMR, capped at 15 OMR — and only with the code.
    expect(bestPromotion(live, [line], { code: code('B') })).toMatchObject({ promotionId: id, discountBaisa: 15_000 });
    expect(bestPromotion(live, [line])).toBeNull();
    expect(bestPromotion(live, [{ ...line, productId: 'another-product' }], { code: code('B') })).toBeNull();
    expect(promotionState(await prisma.promotion.findUniqueOrThrow({ where: { id } }))).toBe('live');
    expect(await prisma.auditLog.count({ where: { entity: 'Promotion', entityId: id, action: 'promotion.activate' } })).toBe(1);

    // Editing writes only what changed.
    await save(admin, base({ id, code: code('B'), percent: '12', maxDiscountBaisa: '15', productIds: [product.id], isActive: 'on' }));
    const update = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'Promotion', entityId: id, action: 'promotion.update' } });
    expect(update.before).toEqual({ value: 1000 });
    expect(update.after).toEqual({ value: 1200 });

    await togglePromotion(admin, { id, isActive: 'false' });
    expect((await loadLivePromotions()).some((p) => p.id === id)).toBe(false);
  }, 60_000);

  it('tells scheduled, ended and used-up promotions apart', async () => {
    const admin = await staff('ADMIN');
    const id = await save(admin, base({ code: code('C'), isActive: 'on', startsAt: '2031-01-01', endsAt: '2031-01-03', usageLimit: '2' }));
    const row = await prisma.promotion.findUniqueOrThrow({ where: { id } });
    expect(row.startsAt?.toISOString()).toBe('2030-12-31T20:00:00.000Z'); // Muscat midnight
    expect(promotionState(row, new Date('2030-12-01T00:00:00Z'))).toBe('scheduled');
    expect(promotionState(row, new Date('2031-01-02T00:00:00Z'))).toBe('live');
    expect(promotionState(row, new Date('2031-02-01T00:00:00Z'))).toBe('ended');
    expect(promotionState({ ...row, usageCount: 2 }, new Date('2031-01-02T00:00:00Z'))).toBe('used_up');
  }, 60_000);

  it('deletes a promotion that was never used, and refuses once an order used it', async () => {
    const admin = await staff('ADMIN');
    const unused = await save(admin, base({ code: code('D') }));
    await deletePromotion(admin, { id: unused });
    expect(await prisma.promotion.findUnique({ where: { id: unused } })).toBeNull();

    const used = await save(admin, base({ code: code('E') }));
    await prisma.promotion.update({ where: { id: used }, data: { usageCount: 1 } });
    expect(await fieldErrors(deletePromotion(admin, { id: used }))).toEqual({ id: ['promotion_in_use'] });
    expect(await prisma.promotion.findUnique({ where: { id: used } })).not.toBeNull();
  }, 60_000);
});

describe('free standard delivery shown to customers', () => {
  it('is announced only when it holds in every area we deliver to, with the highest threshold', async () => {
    // Other tests share the database: reason on the areas as they are, plus one more.
    const before = await freeStandardDeliveryFrom();
    const area = await createDeliveryArea({ standardFeeBaisa: 2000 });
    // The new area has no free-delivery rule → nothing may be promised any more.
    expect(await freeStandardDeliveryFrom()).toBeNull();
    await prisma.deliveryZone.update({ where: { id: area.zone.id }, data: { freeStandardFromBaisa: 9_999_000 } });
    const after = await freeStandardDeliveryFrom();
    // Either another area still has no rule (null), or the promise is the highest threshold.
    if (before === null) expect(after === null || after === 9_999_000).toBe(true);
    else expect(after).toBe(9_999_000);
  }, 60_000);
});
