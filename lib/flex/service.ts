import type { FlexStatus, Prisma, Role } from '@prisma/client';
import { prisma, isUniqueViolation, type Db } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { can } from '@/lib/rbac';
import { idempotencyKeySchema } from '@/lib/validation';
import { MoneyError } from '@/lib/wallet/errors';
import { ensureWallet, withLedgerTx } from '@/lib/wallet/ledger';
import { confirmPaymentIntent, resultFromIntent } from '@/lib/payments/core';
import { notifyMoney } from '@/lib/payments/notify';
import type { StartPaymentResult } from '@/lib/payments/types';
import { placeOrder, quoteLines, isOrderError } from '@/lib/orders';
import { priceItems } from '@/lib/cart/pricing';
import { computeSchedule, dateOnly, isFlexMonths, muscatToday, type FlexMonths } from './schedule';
import { isFlexPartnerConfigured, submitToPartner } from './partner';

/**
 * DOOM FLEX — 3/6/12 monthly instalments, 0% interest, no fees, total = cash price.
 *
 * Flow: product → duration → KYC VERIFIED → `applyForFlex` (SUBMITTED) → finance decision
 * `decideFlexApplication` (APPROVED / REJECTED; or the partner webhook) → customer accepts the
 * terms (checkbox + explicit confirm) `acceptFlexTerms` → ACCEPTED → a 1-item order is placed
 * (lib/orders `placeOrder`, paymentMethod FLEX), the FLEX PaymentIntent is confirmed
 * (ledger FLEX_RECEIVABLE → PLATFORM_REVENUE, order PAID) and the FlexInstallment rows are
 * created → ACTIVE → `payInstallment` from the wallet → COMPLETED when all are paid.
 * Without a finance partner DOOM self-finances after admin approval.
 */

export const FLEX_TERMS_VERSION = 'flex-terms-2026-11';
/** Open (not finished) applications/plans per customer. */
export const MAX_OPEN_FLEX = 2;
/** An approval must be accepted within this many days. */
export const FLEX_APPROVAL_VALID_DAYS = 14;

const OPEN_STATUSES: FlexStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACCEPTED', 'ACTIVE'];
const PENDING_DECISION: FlexStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

function checkKey(key: string): string {
  const r = idempotencyKeySchema.safeParse(key);
  if (!r.success) throw new MoneyError('invalid_input', 'A valid idempotency key is required');
  return r.data;
}

// ───────────── Eligibility ─────────────

export type FlexIneligibleReason =
  | 'login_required'
  | 'kyc_required'
  | 'account_inactive'
  | 'overdue_installments'
  | 'too_many_open'
  | 'product_unavailable'
  | 'price_unavailable'
  | 'out_of_stock';

export type FlexEligibility = {
  eligible: boolean;
  reasons: FlexIneligibleReason[];
  kycStatus: string | null;
  openCount: number;
};

export async function getFlexEligibility(userId: string | null, db: Db = prisma): Promise<FlexEligibility> {
  if (!userId) return { eligible: false, reasons: ['login_required'], kycStatus: null, openCount: 0 };
  const [user, openCount, overdue] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { status: true, kycStatus: true } }),
    db.flexApplication.count({ where: { userId, status: { in: OPEN_STATUSES } } }),
    db.flexInstallment.count({
      where: { application: { userId }, OR: [{ status: 'OVERDUE' }, { status: 'PENDING', dueDate: { lt: muscatToday() } }] },
    }),
  ]);
  const reasons: FlexIneligibleReason[] = [];
  if (!user || user.status !== 'ACTIVE') reasons.push('account_inactive');
  if (user && user.kycStatus !== 'VERIFIED') reasons.push('kyc_required');
  if (overdue > 0) reasons.push('overdue_installments');
  if (openCount >= MAX_OPEN_FLEX) reasons.push('too_many_open');
  return { eligible: reasons.length === 0, reasons, kycStatus: user?.kycStatus ?? null, openCount };
}

export type FlexProduct = {
  productId: string;
  variantId: string;
  slug: string;
  name: unknown;
  variantName: unknown;
  imageKey: string | null;
  priceBaisa: number | null;
  available: boolean;
  reason?: FlexIneligibleReason;
};

/** The product/variant a customer wants to finance (live price & stock — never invented). */
export async function getFlexProduct(productRef: string, variantId?: string | null, db: Db = prisma): Promise<FlexProduct | null> {
  const product = await db.product.findFirst({
    where: { OR: [{ id: productRef }, { slug: productRef }] },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      isSellable: true,
      images: { select: { key: true }, orderBy: { sort: 'asc' }, take: 1 },
      variants: {
        where: { isActive: true, ...(variantId ? { id: variantId } : {}) },
        orderBy: [{ isDefault: 'desc' }, { sort: 'asc' }],
        take: 1,
        select: { id: true, name: true, priceBaisa: true, stock: true, reserved: true },
      },
    },
  });
  const v = product?.variants[0];
  if (!product || !v) return null;
  const base = { productId: product.id, variantId: v.id, slug: product.slug, name: product.name, variantName: v.name, imageKey: product.images[0]?.key ?? null, priceBaisa: v.priceBaisa };
  if (product.status !== 'ACTIVE' || !product.isSellable) return { ...base, available: false, reason: 'product_unavailable' };
  if (v.priceBaisa === null || v.priceBaisa <= 0) return { ...base, available: false, reason: 'price_unavailable' };
  if (v.stock - v.reserved < 1) return { ...base, available: false, reason: 'out_of_stock' };
  return { ...base, available: true };
}

// ───────────── Customer: apply ─────────────

export type ApplyResult = { applicationId: string; status: FlexStatus; replayed: boolean };

export async function applyForFlex(input: {
  userId: string;
  productId: string;
  variantId: string;
  months: number;
  idempotencyKey: string;
}): Promise<ApplyResult> {
  checkKey(input.idempotencyKey);
  if (!isFlexMonths(input.months)) throw new MoneyError('invalid_input', 'months must be 3, 6 or 12');
  const months: FlexMonths = input.months;

  // Same customer, same variant, still open → replay (double click / back + resubmit).
  const open = await prisma.flexApplication.findFirst({
    where: { userId: input.userId, variantId: input.variantId, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } },
    select: { id: true, status: true, months: true },
  });
  if (open) return { applicationId: open.id, status: open.status, replayed: true };

  const elig = await getFlexEligibility(input.userId);
  if (elig.reasons.includes('kyc_required')) throw new MoneyError('kyc_required');
  if (!elig.eligible) throw new MoneyError(elig.reasons.includes('too_many_open') ? 'flex_active_limit' : 'flex_not_eligible', undefined, { reasons: elig.reasons });

  const product = await getFlexProduct(input.productId, input.variantId);
  if (!product || product.variantId !== input.variantId) throw new MoneyError('not_found', 'Product not found');
  if (!product.available || product.priceBaisa === null) throw new MoneyError('flex_not_eligible', undefined, { reasons: [product.reason] });
  computeSchedule(product.priceBaisa, months); // validates principal/months

  const [user, kyc] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: input.userId }, select: { id: true, fullName: true, phone: true, email: true, kycStatus: true } }),
    prisma.kycSubmission.findFirst({ where: { userId: input.userId, status: 'VERIFIED' }, orderBy: { reviewedAt: 'desc' }, select: { id: true } }),
  ]);

  const app = await prisma.$transaction(async (tx) => {
    const created = await tx.flexApplication.create({
      data: {
        userId: input.userId,
        productId: product.productId,
        variantId: product.variantId,
        kycSubmissionId: kyc?.id ?? null,
        months,
        principalBaisa: product.priceBaisa!,
        status: 'SUBMITTED',
      },
    });
    await logAudit(
      { actorId: input.userId, actorRole: 'CUSTOMER', action: 'flex.apply', entity: 'FlexApplication', entityId: created.id, after: { months, principalBaisa: created.principalBaisa, variantId: product.variantId } },
      tx,
    );
    return created;
  });

  if (isFlexPartnerConfigured()) {
    try {
      const { partnerRef } = await submitToPartner({
        id: app.id,
        principalBaisa: app.principalBaisa,
        months,
        customer: { id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, kycVerified: user.kycStatus === 'VERIFIED' },
      });
      await prisma.flexApplication.update({ where: { id: app.id }, data: { partnerRef, status: 'UNDER_REVIEW' } });
      return { applicationId: app.id, status: 'UNDER_REVIEW', replayed: false };
    } catch (err) {
      // The application stays SUBMITTED for an in-house decision.
      console.error('[flex] partner submission failed', err);
    }
  }
  return { applicationId: app.id, status: app.status, replayed: false };
}

// ───────────── Staff / partner: decide ─────────────

export type FlexDecision = 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

/**
 * Finance decision on an application (requires `flex:decide` = FINANCE / ADMIN / SUPERADMIN;
 * audited). Pass `actorId: null` with `source: 'partner'` for a verified partner decision.
 */
export async function decideFlexApplication(input: {
  id: string;
  decision: FlexDecision;
  actorId: string | null;
  notes?: string | null;
  source?: 'staff' | 'partner';
}): Promise<{ id: string; status: FlexStatus; replayed: boolean }> {
  let actor: { id: string; role: Role } | null = null;
  if (input.source !== 'partner') {
    const u = input.actorId ? await prisma.user.findUnique({ where: { id: input.actorId }, select: { id: true, role: true, status: true } }) : null;
    if (!u || u.status !== 'ACTIVE' || !can(u.role, 'flex:decide')) throw new MoneyError('forbidden', 'FLEX decisions require the FINANCE or ADMIN role');
    actor = { id: u.id, role: u.role };
  }
  if (!['UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(input.decision)) throw new MoneyError('invalid_input');
  const notes = input.notes?.trim().slice(0, 1000) || null;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "FlexApplication" WHERE "id" = ${input.id} FOR UPDATE`;
    const app = await tx.flexApplication.findUnique({ where: { id: input.id }, include: { user: { select: { kycStatus: true } } } });
    if (!app) throw new MoneyError('not_found');
    if (actor && app.userId === actor.id) throw new MoneyError('self_review');
    if (app.status === input.decision) return { id: app.id, status: app.status, replayed: true };
    if (!PENDING_DECISION.includes(app.status)) throw new MoneyError('flex_invalid_state', `Application is ${app.status}`);
    if (input.decision === 'APPROVED' && app.user.kycStatus !== 'VERIFIED') throw new MoneyError('kyc_required');

    const final = input.decision !== 'UNDER_REVIEW';
    await tx.flexApplication.update({
      where: { id: app.id },
      data: {
        status: input.decision,
        ...(final ? { decidedById: actor?.id ?? null, decidedAt: new Date(), decisionNote: notes } : {}),
      },
    });
    await logAudit(
      {
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action: `flex.${input.decision.toLowerCase()}`,
        entity: 'FlexApplication',
        entityId: app.id,
        before: { status: app.status },
        after: { status: input.decision, notes, source: input.source ?? 'staff' },
      },
      tx,
    );
    if (input.decision === 'APPROVED') await notifyMoney(app.userId, 'flexApproved', {}, `/flex/${app.id}`, tx);
    if (input.decision === 'REJECTED') await notifyMoney(app.userId, 'flexRejected', {}, `/flex/${app.id}`, tx);
    return { id: app.id, status: input.decision, replayed: false };
  });
}

// ───────────── Customer: quote, accept, activate ─────────────

export type FlexAcceptQuote = {
  ready: boolean;
  reason?: 'address_required' | 'delivery_unavailable' | 'price_changed' | 'out_of_stock';
  subtotalBaisa: number;
  discountBaisa: number;
  deliveryFeeBaisa: number | null;
  totalBaisa: number | null;
  schedule: ReturnType<typeof computeSchedule> | null;
};

/** Exact amounts the FLEX order would have (same quote path as checkout). */
export async function quoteFlexAcceptance(
  input: { applicationId: string; userId: string; addressId: string | null; locale: string },
  db: Db = prisma,
): Promise<FlexAcceptQuote> {
  const app = await db.flexApplication.findUnique({ where: { id: input.applicationId }, select: { userId: true, variantId: true, months: true, principalBaisa: true } });
  if (!app || app.userId !== input.userId || !app.variantId) throw new MoneyError('not_found');
  const lines = await priceItems([{ id: null, variantId: app.variantId, qty: 1 }], input.locale, db);
  const quote = await quoteLines(lines, { userId: input.userId, locale: input.locale, addressId: input.addressId, deliveryType: 'STANDARD' }, db);
  const empty = { subtotalBaisa: quote.subtotalBaisa, discountBaisa: quote.discountBaisa, deliveryFeeBaisa: null, totalBaisa: null, schedule: null };
  if (!quote.ready || lines.length === 0) return { ready: false, reason: 'out_of_stock', ...empty };
  // The approval covers the product price: it must not have increased since.
  if (quote.subtotalBaisa - quote.discountBaisa > app.principalBaisa) return { ready: false, reason: 'price_changed', ...empty };
  if (!input.addressId || !quote.address) return { ready: false, reason: 'address_required', ...empty };
  const std = quote.delivery?.STANDARD;
  if (!std?.available || std.feeBaisa === undefined || quote.totalBaisa === null) return { ready: false, reason: 'delivery_unavailable', ...empty };
  if (!isFlexMonths(app.months)) throw new MoneyError('flex_invalid_state');
  return {
    ready: true,
    subtotalBaisa: quote.subtotalBaisa,
    discountBaisa: quote.discountBaisa,
    deliveryFeeBaisa: std.feeBaisa,
    totalBaisa: quote.totalBaisa,
    schedule: computeSchedule(quote.totalBaisa, app.months),
  };
}

export type AcceptResult = { applicationId: string; status: FlexStatus; orderId: string; orderNumber: string; replayed: boolean };

/**
 * The customer accepts the terms (explicit checkbox + confirm) of an APPROVED application:
 * ACCEPTED → order placed (1 item, STANDARD delivery, paymentMethod FLEX) → FLEX payment
 * confirmed (ledger FLEX_RECEIVABLE → revenue, order PAID) → instalments created → ACTIVE.
 * The financed amount is the order total shown on the confirmation step (`expectedTotalBaisa`).
 */
export async function acceptFlexTerms(input: {
  applicationId: string;
  userId: string;
  acceptTerms: boolean;
  termsVersion: string;
  addressId: string;
  expectedTotalBaisa: number;
  locale: 'ar' | 'en' | 'fr';
}): Promise<AcceptResult> {
  if (input.acceptTerms !== true || input.termsVersion !== FLEX_TERMS_VERSION) throw new MoneyError('terms_required');
  const app = await prisma.flexApplication.findUnique({
    where: { id: input.applicationId },
    include: { user: { select: { kycStatus: true, status: true } }, order: { select: { id: true, number: true } } },
  });
  if (!app || app.userId !== input.userId) throw new MoneyError('not_found');
  if ((app.status === 'ACTIVE' || app.status === 'COMPLETED') && app.order) {
    return { applicationId: app.id, status: app.status, orderId: app.order.id, orderNumber: app.order.number, replayed: true };
  }
  if (app.status !== 'APPROVED' && app.status !== 'ACCEPTED') throw new MoneyError('flex_invalid_state', `Application is ${app.status}`);
  if (app.user.kycStatus !== 'VERIFIED' || app.user.status !== 'ACTIVE') throw new MoneyError('kyc_required');
  if (app.status === 'APPROVED' && app.decidedAt && app.decidedAt.getTime() < Date.now() - FLEX_APPROVAL_VALID_DAYS * 86_400_000) {
    throw new MoneyError('flex_invalid_state', 'Approval expired', { reason: 'approval_expired' });
  }
  if (!app.variantId || !isFlexMonths(app.months)) throw new MoneyError('flex_invalid_state');
  const months: FlexMonths = app.months;

  const quote = await quoteFlexAcceptance({ applicationId: app.id, userId: input.userId, addressId: input.addressId, locale: input.locale });
  if (!quote.ready || quote.totalBaisa === null) throw new MoneyError('flex_not_eligible', undefined, { reason: quote.reason });
  if (quote.totalBaisa !== input.expectedTotalBaisa) throw new MoneyError('flex_not_eligible', undefined, { reason: 'price_changed' });

  if (app.status === 'APPROVED') {
    await prisma.$transaction(async (tx) => {
      const n = await tx.flexApplication.updateMany({
        where: { id: app.id, status: 'APPROVED' },
        data: { status: 'ACCEPTED', termsVersion: FLEX_TERMS_VERSION, termsAcceptedAt: new Date() },
      });
      if (n.count === 1) {
        await logAudit(
          { actorId: input.userId, actorRole: 'CUSTOMER', action: 'flex.accept', entity: 'FlexApplication', entityId: app.id, after: { termsVersion: FLEX_TERMS_VERSION, totalBaisa: quote.totalBaisa } },
          tx,
        );
      }
    });
  }

  let placed;
  try {
    placed = await placeOrder({
      userId: input.userId,
      idempotencyKey: `flex-${app.id}`,
      addressId: input.addressId,
      deliveryType: 'STANDARD',
      paymentMethod: 'FLEX',
      locale: input.locale,
      expectedTotalBaisa: quote.totalBaisa,
      items: [{ variantId: app.variantId, qty: 1 }],
    });
  } catch (err) {
    if (isOrderError(err)) throw new MoneyError('flex_not_eligible', err.message, { reason: err.code });
    throw err;
  }

  await ensureWallet(input.userId);
  const total = placed.totalBaisa;
  const schedule = computeSchedule(total, months);
  await withLedgerTx(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "FlexApplication" WHERE "id" = ${app.id} FOR UPDATE`;
    const fresh = await tx.flexApplication.findUniqueOrThrow({ where: { id: app.id }, select: { status: true } });
    if (fresh.status === 'ACTIVE') return;
    if (fresh.status !== 'ACCEPTED') throw new MoneyError('flex_invalid_state');
    const key = `flex:${app.id}`;
    const intent =
      (await tx.paymentIntent.findUnique({ where: { idempotencyKey: key } })) ??
      (await tx.paymentIntent.create({
        data: {
          userId: input.userId,
          provider: 'FLEX',
          purpose: 'ORDER',
          orderId: placed.orderId,
          amountBaisa: total,
          idempotencyKey: key,
          status: 'PENDING',
          metadata: { flexApplicationId: app.id, months },
        },
      }));
    const confirmed = await confirmPaymentIntent(intent.id, { confirmedAmountBaisa: total, source: 'flex.accept', actorId: input.userId }, tx);
    if (confirmed.outcome === 'failed') throw new MoneyError('flex_invalid_state', 'FLEX payment could not be confirmed');
    await tx.flexInstallment.createMany({
      data: schedule.installments.map((i) => ({ applicationId: app.id, sequence: i.sequence, dueDate: dateOnly(i.dueDate), amountBaisa: i.amountBaisa })),
      skipDuplicates: true,
    });
    await tx.flexApplication.update({ where: { id: app.id }, data: { status: 'ACTIVE', orderId: placed.orderId, principalBaisa: total } });
    await logAudit(
      {
        actorId: input.userId,
        actorRole: 'CUSTOMER',
        action: 'flex.activate',
        entity: 'FlexApplication',
        entityId: app.id,
        before: { status: 'ACCEPTED', principalBaisa: app.principalBaisa },
        after: { status: 'ACTIVE', orderId: placed.orderId, principalBaisa: total, installments: schedule.installments.length },
      },
      tx,
    );
  });
  return { applicationId: app.id, status: 'ACTIVE', orderId: placed.orderId, orderNumber: placed.number, replayed: placed.replayed };
}

/** Customer cancels an application that is not active yet. */
export async function cancelFlexApplication(input: { applicationId: string; userId: string }): Promise<{ status: FlexStatus }> {
  return prisma.$transaction(async (tx) => {
    const app = await tx.flexApplication.findUnique({ where: { id: input.applicationId }, select: { id: true, userId: true, status: true } });
    if (!app || app.userId !== input.userId) throw new MoneyError('not_found');
    if (app.status === 'CANCELLED') return { status: app.status };
    if (!['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(app.status)) throw new MoneyError('flex_invalid_state');
    await tx.flexApplication.update({ where: { id: app.id }, data: { status: 'CANCELLED' } });
    await logAudit({ actorId: input.userId, actorRole: 'CUSTOMER', action: 'flex.cancel', entity: 'FlexApplication', entityId: app.id, before: { status: app.status } }, tx);
    return { status: 'CANCELLED' as const };
  });
}

// ───────────── Customer: pay an instalment ─────────────

/** Pay one instalment from the DOOM Wallet (atomic debit → FLEX_RECEIVABLE). */
export async function payInstallment(input: { installmentId: string; userId: string; idempotencyKey: string }): Promise<StartPaymentResult> {
  const key = `inst:${input.userId}:${checkKey(input.idempotencyKey)}`;
  const replay = await prisma.paymentIntent.findUnique({ where: { idempotencyKey: key } });
  if (replay) {
    if (replay.userId !== input.userId || replay.purpose !== 'INSTALLMENT') throw new MoneyError('idempotency_key_reused');
    return resultFromIntent(replay, true);
  }
  const inst = await prisma.flexInstallment.findUnique({ where: { id: input.installmentId }, include: { application: { select: { userId: true, status: true } } } });
  if (!inst || inst.application.userId !== input.userId) throw new MoneyError('not_found');
  if (inst.status === 'PAID') throw new MoneyError('installment_not_payable', 'Already paid', { reason: 'already_paid' });
  if (!['PENDING', 'OVERDUE'].includes(inst.status) || inst.application.status !== 'ACTIVE') throw new MoneyError('installment_not_payable');
  const wallet = await ensureWallet(input.userId);
  if (wallet.status !== 'ACTIVE') throw new MoneyError('wallet_frozen');

  try {
    const intentId = await withLedgerTx(async (tx) => {
      const dup = await tx.paymentIntent.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
      if (dup) return dup.id;
      await tx.$queryRaw`SELECT "id" FROM "FlexInstallment" WHERE "id" = ${inst.id} FOR UPDATE`;
      const fresh = await tx.flexInstallment.findUniqueOrThrow({ where: { id: inst.id }, select: { status: true, paymentIntentId: true, amountBaisa: true, applicationId: true } });
      if (fresh.status === 'PAID') throw new MoneyError('installment_not_payable', 'Already paid', { reason: 'already_paid' });
      if (fresh.paymentIntentId) {
        // A previous attempt left an unconfirmed intent: release the link (wallet attempts are atomic, so it never succeeded).
        await tx.flexInstallment.update({ where: { id: inst.id }, data: { paymentIntentId: null } });
      }
      const intent = await tx.paymentIntent.create({
        data: {
          userId: input.userId,
          provider: 'WALLET',
          purpose: 'INSTALLMENT',
          amountBaisa: fresh.amountBaisa,
          idempotencyKey: key,
          status: 'CREATED',
          metadata: { flexApplicationId: fresh.applicationId, installmentId: inst.id },
        },
      });
      await tx.flexInstallment.update({ where: { id: inst.id }, data: { paymentIntentId: intent.id } });
      await confirmPaymentIntent(intent.id, { confirmedAmountBaisa: fresh.amountBaisa, source: 'wallet', actorId: input.userId }, tx);
      return intent.id;
    });
    return resultFromIntent(await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } }), false);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await prisma.paymentIntent.findUnique({ where: { idempotencyKey: key } });
      if (again) return resultFromIntent(again, true);
    }
    throw err;
  }
}

// ───────────── Overdue detection (cron / agents) ─────────────

export type OverdueInstallment = {
  installmentId: string;
  applicationId: string;
  userId: string;
  sequence: number;
  months: number;
  dueDate: string;
  amountBaisa: number;
  daysOverdue: number;
};

/** Read-only: instalments past due (Muscat calendar) and not paid. */
export async function findOverdueInstallments(now: Date = new Date(), db: Db = prisma): Promise<OverdueInstallment[]> {
  const today = muscatToday(now);
  const rows = await db.flexInstallment.findMany({
    where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lt: today }, application: { status: 'ACTIVE' } },
    select: { id: true, sequence: true, dueDate: true, amountBaisa: true, application: { select: { id: true, userId: true, months: true } } },
    orderBy: { dueDate: 'asc' },
    take: 5000,
  });
  return rows.map((r) => ({
    installmentId: r.id,
    applicationId: r.application.id,
    userId: r.application.userId,
    sequence: r.sequence,
    months: r.application.months,
    dueDate: r.dueDate.toISOString().slice(0, 10),
    amountBaisa: r.amountBaisa,
    daysOverdue: Math.round((today.getTime() - r.dueDate.getTime()) / 86_400_000),
  }));
}

/** Cron: flag PENDING instalments past their due date as OVERDUE. Returns how many changed. */
export async function markOverdueInstallments(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.flexInstallment.updateMany({
    where: { status: 'PENDING', dueDate: { lt: muscatToday(now) }, application: { status: 'ACTIVE' } },
    data: { status: 'OVERDUE' },
  });
  return count;
}

// ───────────── Reads ─────────────

export async function listFlexApplications(userId: string, db: Db = prisma) {
  return db.flexApplication.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      status: true,
      months: true,
      principalBaisa: true,
      createdAt: true,
      product: { select: { name: true, slug: true } },
      variant: { select: { name: true } },
      installments: { select: { status: true, amountBaisa: true } },
    },
  });
}

export async function getFlexApplication(id: string, viewer: { id: string; role: Role }, db: Db = prisma) {
  const app = await db.flexApplication.findUnique({
    where: { id },
    include: {
      product: { select: { name: true, slug: true, images: { select: { key: true }, orderBy: { sort: 'asc' }, take: 1 } } },
      variant: { select: { name: true, priceBaisa: true } },
      order: { select: { id: true, number: true, status: true } },
      installments: { orderBy: { sequence: 'asc' }, include: { paymentIntent: { select: { id: true, status: true } } } },
    },
  });
  if (!app) return null;
  if (app.userId !== viewer.id && !can(viewer.role, 'flex:read')) return null;
  return app;
}

export type FlexApplicationDetail = NonNullable<Awaited<ReturnType<typeof getFlexApplication>>>;

/** Partner decision (verified webhook) — recorded through the same audited path. */
export async function applyPartnerDecision(event: { reference: string | null; partnerRef: string | null; decision: 'APPROVED' | 'REJECTED' | null; note: string | null }) {
  if (!event.decision) return { applied: false, reason: 'no_decision' as const };
  const where: Prisma.FlexApplicationWhereInput = event.reference ? { id: event.reference } : { partnerRef: event.partnerRef ?? '__none__' };
  const app = await prisma.flexApplication.findFirst({ where, select: { id: true, partnerRef: true } });
  if (!app || (event.partnerRef && app.partnerRef && app.partnerRef !== event.partnerRef)) return { applied: false, reason: 'unknown_application' as const };
  await decideFlexApplication({ id: app.id, decision: event.decision, actorId: null, notes: event.note, source: 'partner' });
  return { applied: true as const };
}
