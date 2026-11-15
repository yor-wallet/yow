/**
 * DOOM FLEX end to end, as the owner specified it: product → duration (3 / 6 / 12 months, 0 % interest, no
 * fees, total = cash price) → identity verified → application → finance decision → the customer accepts
 * the terms → schedule → instalments paid from the wallet or directly in crypto.
 * Runs against PostgreSQL (doom_test).
 *
 * The ledger is append-only, so the customers and reviewers of these plans stay in doom_test — uniquely
 * named (`flexflow-…`), balanced, and harmless. Settings rows are removed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { acceptFlexTerms, applyForFlex, decideFlexApplication, FLEX_TERMS_VERSION, payInstallment, quoteFlexAcceptance } from '@/lib/flex';
import { notifyCustomerOfFlexDecision, notifyStaffOfFlexApplication } from '@/lib/flex/emails';
import { flexCounts, flexCustomerHistory, getFlexForAdmin, listFlexForAdmin } from '@/lib/admin/flex';
import { confirmPaymentIntent, startInstallmentPayment } from '@/lib/payments/core';
import { listPaymentMethods } from '@/lib/payments/registry';
import { ensureWallet, getBalance, makeReference, postTransaction, systemAccountId, withLedgerTx } from '@/lib/wallet/ledger';
import { MoneyError } from '@/lib/wallet/errors';
import { cleanup, createAddress, createDeliveryArea, createProduct, RUN } from './shop/fixtures';

const TRON_SHOP = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // a public, well-formed Tron address (the USDT contract): test value only
const ENV_KEYS = ['CRYPTO_ADDRESS_TRON', 'CRYPTO_ADDRESS_BSC', 'CRYPTO_ADDRESS_ETH', 'BREVO_API_KEY', 'MAIL_FROM', 'APP_URL'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const SETTINGS = ['crypto.enabled', 'crypto.requireKyc', 'crypto.forInstallments'];
let seq = 0;
const kept: string[] = [];
const key = () => `flexflow${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

type Role = 'CUSTOMER' | 'FINANCE' | 'SUPPORT';
async function keptUser(role: Role = 'CUSTOMER', kyc: 'VERIFIED' | 'UNVERIFIED' = 'VERIFIED') {
  const n = ++seq;
  const user = await prisma.user.create({
    data: { email: `flexflow-${RUN.toLowerCase()}-${n}@test.doom.local`, fullName: `Flex Tester ${n}`, passwordHash: 'x'.repeat(60), role, kycStatus: kyc, locale: 'en', phone: `+9687${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}` },
    select: { id: true, email: true, fullName: true },
  });
  kept.push(user.id);
  return user;
}

async function fund(userId: string, amountBaisa: number) {
  const wallet = await ensureWallet(userId);
  const adjustments = await systemAccountId(prisma, 'ADJUSTMENTS');
  await withLedgerTx((tx) =>
    postTransaction(tx, {
      reference: makeReference('ADJ'),
      type: 'ADJUSTMENT',
      idempotencyKey: `flexflow-fund-${userId}-${amountBaisa}-${Date.now()}`,
      description: 'Test funding',
      entries: [
        { accountId: wallet.ledgerAccountId, amountBaisa },
        { accountId: adjustments, amountBaisa: -amountBaisa },
      ],
    }),
  );
}

async function setSetting(k: string, value: number | null) {
  if (value === null) await prisma.setting.deleteMany({ where: { key: k } });
  else await prisma.setting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } });
}

/** A verified customer with an address, and an ACTIVE plan of `months` on a 360 OMR phone (free delivery: fee 0). */
async function activePlan(months: 3 | 6 | 12 = 3) {
  const customer = await keptUser();
  const finance = await keptUser('FINANCE');
  const product = await createProduct({ variants: [{ priceBaisa: 360_000, stock: 5 }] });
  const variant = product.variants[0]!;
  const area = await createDeliveryArea({ standardFeeBaisa: 0 });
  const address = await createAddress(customer.id, area);
  const applied = await applyForFlex({ userId: customer.id, productId: product.id, variantId: variant.id, months, idempotencyKey: key() });
  await decideFlexApplication({ id: applied.applicationId, decision: 'APPROVED', actorId: finance.id });
  const quote = await quoteFlexAcceptance({ applicationId: applied.applicationId, userId: customer.id, addressId: address.id, locale: 'en' });
  const accepted = await acceptFlexTerms({ applicationId: applied.applicationId, userId: customer.id, acceptTerms: true, termsVersion: FLEX_TERMS_VERSION, addressId: address.id, expectedTotalBaisa: quote.totalBaisa!, locale: 'en' });
  const installments = await prisma.flexInstallment.findMany({ where: { applicationId: applied.applicationId }, orderBy: { sequence: 'asc' } });
  return { customer, finance, product, variant, address, applicationId: applied.applicationId, accepted, installments };
}

beforeAll(async () => {
  process.env.CRYPTO_ADDRESS_TRON = TRON_SHOP;
  delete process.env.CRYPTO_ADDRESS_BSC;
  delete process.env.CRYPTO_ADDRESS_ETH;
  delete process.env.BREVO_API_KEY;
  await prisma.setting.deleteMany({ where: { key: { in: SETTINGS } } });
  await prisma.setting.create({ data: { key: 'crypto.enabled', value: 1 } });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await prisma.setting.deleteMany({ where: { key: { in: SETTINGS } } });
  // The kept customers' addresses point at the test delivery areas: remove them so the areas can go
  // (orders keep their own copy of the address).
  await prisma.address.deleteMany({ where: { userId: { in: kept } } });
  await cleanup();
  await prisma.$disconnect();
});

describe('DOOM FLEX: from the application to the schedule', () => {
  it('needs a verified identity, then a finance decision, then the customer’s acceptance — and splits the price exactly', async () => {
    const unverified = await keptUser('CUSTOMER', 'UNVERIFIED');
    const product = await createProduct({ variants: [{ priceBaisa: 360_000, stock: 5 }] });
    const variant = product.variants[0]!;
    await expect(applyForFlex({ userId: unverified.id, productId: product.id, variantId: variant.id, months: 3, idempotencyKey: key() })).rejects.toMatchObject({ code: 'kyc_required' });
    const customer = await keptUser();
    await expect(applyForFlex({ userId: customer.id, productId: product.id, variantId: variant.id, months: 4, idempotencyKey: key() })).rejects.toBeInstanceOf(MoneyError);

    const applied = await applyForFlex({ userId: customer.id, productId: product.id, variantId: variant.id, months: 6, idempotencyKey: key() });
    expect(applied).toMatchObject({ status: 'SUBMITTED', replayed: false });
    // Nothing exists before the decision and the acceptance.
    expect(await prisma.flexInstallment.count({ where: { applicationId: applied.applicationId } })).toBe(0);

    // The admin screens: listed under "to decide", with the customer and the product.
    expect((await flexCounts()).SUBMITTED).toBeGreaterThanOrEqual(1);
    expect((await listFlexForAdmin('SUBMITTED', 200)).some((a) => a.id === applied.applicationId)).toBe(true);
    expect(await getFlexForAdmin(applied.applicationId)).toMatchObject({ status: 'SUBMITTED', months: 6, principalBaisa: 360_000, user: { email: customer.email, kycStatus: 'VERIFIED' } });
    expect(await getFlexForAdmin('../x')).toBeNull();

    // Who may decide: finance, not support, and never one's own application.
    const support = await keptUser('SUPPORT');
    const finance = await keptUser('FINANCE');
    await expect(decideFlexApplication({ id: applied.applicationId, decision: 'APPROVED', actorId: support.id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(decideFlexApplication({ id: applied.applicationId, decision: 'APPROVED', actorId: customer.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await decideFlexApplication({ id: applied.applicationId, decision: 'APPROVED', actorId: finance.id, notes: 'ok' })).toMatchObject({ status: 'APPROVED', replayed: false });
    expect(await decideFlexApplication({ id: applied.applicationId, decision: 'APPROVED', actorId: finance.id })).toMatchObject({ replayed: true });
    await expect(decideFlexApplication({ id: applied.applicationId, decision: 'REJECTED', actorId: finance.id })).rejects.toMatchObject({ code: 'flex_invalid_state' });

    // The customer confirms on an address we deliver to (2 OMR delivery here): the plan covers the order total.
    const area = await createDeliveryArea({ standardFeeBaisa: 2000 });
    const address = await createAddress(customer.id, area);
    const quote = await quoteFlexAcceptance({ applicationId: applied.applicationId, userId: customer.id, addressId: address.id, locale: 'en' });
    expect(quote).toMatchObject({ ready: true, totalBaisa: 362_000, deliveryFeeBaisa: 2000 });
    await expect(acceptFlexTerms({ applicationId: applied.applicationId, userId: customer.id, acceptTerms: false, termsVersion: FLEX_TERMS_VERSION, addressId: address.id, expectedTotalBaisa: 362_000, locale: 'en' })).rejects.toMatchObject({ code: 'terms_required' });
    const accepted = await acceptFlexTerms({ applicationId: applied.applicationId, userId: customer.id, acceptTerms: true, termsVersion: FLEX_TERMS_VERSION, addressId: address.id, expectedTotalBaisa: 362_000, locale: 'en' });
    expect(accepted.status).toBe('ACTIVE');

    const rows = await prisma.flexInstallment.findMany({ where: { applicationId: applied.applicationId }, orderBy: { sequence: 'asc' } });
    expect(rows).toHaveLength(6);
    // 0 % interest, no fees: the instalments add up to the order total, to the baisa.
    expect(rows.reduce((s, r) => s + r.amountBaisa, 0)).toBe(362_000);
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: accepted.orderId } });
    expect(order).toMatchObject({ status: 'PAID', totalBaisa: 362_000 });
    expect(await flexCustomerHistory(customer.id, 'none')).toMatchObject({ plans: { ACTIVE: 1 }, overdue: 0 });
  }, 120_000);
});

describe('DOOM FLEX: paying the instalments', () => {
  it('from the wallet: paid at once, nothing without the balance, never twice', async () => {
    const plan = await activePlan(3);
    const [first] = plan.installments;
    expect(plan.installments.map((i) => i.amountBaisa)).toEqual([120_000, 120_000, 120_000]);
    await expect(payInstallment({ installmentId: first!.id, userId: plan.customer.id, idempotencyKey: key() })).rejects.toMatchObject({ code: 'insufficient_balance' });
    await fund(plan.customer.id, 150_000);
    const k = key();
    expect(await payInstallment({ installmentId: first!.id, userId: plan.customer.id, idempotencyKey: k })).toMatchObject({ status: 'succeeded' });
    expect(await payInstallment({ installmentId: first!.id, userId: plan.customer.id, idempotencyKey: k })).toMatchObject({ status: 'succeeded', replayed: true });
    expect((await getBalance(plan.customer.id)).balanceBaisa).toBe(30_000);
    await expect(payInstallment({ installmentId: first!.id, userId: plan.customer.id, idempotencyKey: key() })).rejects.toMatchObject({ code: 'installment_not_payable' });
    expect((await prisma.flexInstallment.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe('PAID');
  }, 120_000);

  it('in crypto: a payment is opened, the instalment is paid only once the transfer is confirmed, and the plan completes', async () => {
    const plan = await activePlan(3);
    const [first, second, third] = plan.installments;
    const methods = await listPaymentMethods({ purpose: 'INSTALLMENT', amountBaisa: first!.amountBaisa, userId: plan.customer.id });
    expect(methods.map((m) => [m.id, m.available])).toEqual([['WALLET', false], ['CRYPTO', true]]);

    const started = await startInstallmentPayment(first!.id, 'CRYPTO', plan.customer.id, key());
    expect(started.status).not.toBe('succeeded');
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: started.intentId } });
    expect(intent).toMatchObject({ provider: 'CRYPTO', purpose: 'INSTALLMENT', amountBaisa: 120_000, status: 'PENDING', userId: plan.customer.id });
    // Opening the payment credits nothing and marks nothing paid.
    expect((await prisma.flexInstallment.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe('PENDING');
    // Coming back reuses the same open payment (same amount to send, same address).
    expect(await startInstallmentPayment(first!.id, 'CRYPTO', plan.customer.id, key())).toMatchObject({ intentId: intent.id, replayed: true });
    // Somebody else cannot pay or see this instalment.
    const stranger = await keptUser();
    await expect(startInstallmentPayment(first!.id, 'CRYPTO', stranger.id, key())).rejects.toMatchObject({ code: 'not_found' });

    const receivable = await systemAccountId(prisma, 'FLEX_RECEIVABLE');
    const before = (await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: receivable } })).balanceBaisa;
    // The blockchain check confirmed the transfer.
    expect(await confirmPaymentIntent(intent.id, { confirmedAmountBaisa: 120_000, source: 'test' })).toMatchObject({ outcome: 'succeeded', creditedToWallet: false });
    expect((await prisma.flexInstallment.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe('PAID');
    expect((await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: receivable } })).balanceBaisa - before).toBe(120_000);
    expect((await getBalance(plan.customer.id)).balanceBaisa).toBe(0); // the wallet is not involved
    await expect(startInstallmentPayment(first!.id, 'CRYPTO', plan.customer.id, key())).rejects.toMatchObject({ code: 'installment_not_payable' });

    // Second instalment: a crypto payment is opened but the customer finally pays from the wallet;
    // the crypto transfer that arrives afterwards is not lost — it is credited to the wallet.
    const late = await startInstallmentPayment(second!.id, 'CRYPTO', plan.customer.id, key());
    await fund(plan.customer.id, 120_000);
    expect(await payInstallment({ installmentId: second!.id, userId: plan.customer.id, idempotencyKey: key() })).toMatchObject({ status: 'succeeded' });
    expect((await getBalance(plan.customer.id)).balanceBaisa).toBe(0);
    expect(await confirmPaymentIntent(late.intentId!, { confirmedAmountBaisa: 120_000, source: 'test' })).toMatchObject({ outcome: 'succeeded', creditedToWallet: true });
    expect((await getBalance(plan.customer.id)).balanceBaisa).toBe(120_000);

    // Third and last instalment in crypto: the plan is complete.
    const last = await startInstallmentPayment(third!.id, 'CRYPTO', plan.customer.id, key());
    await confirmPaymentIntent(last.intentId!, { confirmedAmountBaisa: 120_000, source: 'test' });
    expect((await prisma.flexApplication.findUniqueOrThrow({ where: { id: plan.applicationId } })).status).toBe('COMPLETED');
    expect(await getFlexForAdmin(plan.applicationId)).toMatchObject({ status: 'COMPLETED', order: { status: 'PAID' } });
  }, 120_000);

  it('the administrator can switch crypto off for instalments; the wallet still works', async () => {
    const plan = await activePlan(3);
    const [first] = plan.installments;
    await setSetting('crypto.forInstallments', 0);
    try {
      await expect(startInstallmentPayment(first!.id, 'CRYPTO', plan.customer.id, key())).rejects.toMatchObject({ code: 'method_unavailable' });
      const crypto = (await listPaymentMethods({ purpose: 'INSTALLMENT', amountBaisa: first!.amountBaisa, userId: plan.customer.id })).find((m) => m.id === 'CRYPTO');
      expect(crypto).toMatchObject({ available: false, reason: 'disabled_by_admin' });
      await expect(startInstallmentPayment(first!.id, 'WALLET', plan.customer.id, key())).rejects.toMatchObject({ code: 'method_unavailable' });
    } finally {
      await setSetting('crypto.forInstallments', null);
    }
    await fund(plan.customer.id, 120_000);
    expect(await payInstallment({ installmentId: first!.id, userId: plan.customer.id, idempotencyKey: key() })).toMatchObject({ status: 'succeeded' });
  }, 120_000);
});

describe('DOOM FLEX: e-mails', () => {
  it('tells every staff member who can decide about a new application, and the customer about the decision', async () => {
    Object.assign(process.env, { BREVO_API_KEY: 'test-key', MAIL_FROM: 'shop@example.test', APP_URL: 'https://shop.example.test' });
    const sent: { to: string; subject: string; html: string; tags: string[] }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body) as { to: { email: string }[]; subject: string; htmlContent: string; tags: string[] };
      sent.push({ to: b.to[0]!.email, subject: b.subject, html: b.htmlContent, tags: b.tags });
      return { ok: true, status: 201, json: async () => ({ messageId: '<m@test>' }) };
    });
    try {
      const customer = await keptUser();
      const finance = await keptUser('FINANCE');
      const support = await keptUser('SUPPORT');
      const product = await createProduct({ variants: [{ priceBaisa: 240_000, stock: 5 }], name: 'Flex Mail Phone' });
      const applied = await applyForFlex({ userId: customer.id, productId: product.id, variantId: product.variants[0]!.id, months: 12, idempotencyKey: key() });

      await notifyStaffOfFlexApplication(applied.applicationId);
      const to = sent.map((s) => s.to);
      expect(to).toContain(finance.email);
      expect(to).not.toContain(support.email);
      expect(to).not.toContain(customer.email);
      const mine = sent.find((s) => s.to === finance.email)!;
      expect(mine.subject).toContain(customer.fullName);
      expect(mine.html).toContain('Flex Mail Phone');
      expect(mine.html).toContain('12 monthly instalments');
      expect(mine.html).toContain(`https://shop.example.test/en/admin/finance/flex/${applied.applicationId}`);

      sent.length = 0;
      expect(await notifyCustomerOfFlexDecision(applied.applicationId)).toBe(false); // not decided yet
      await decideFlexApplication({ id: applied.applicationId, decision: 'REJECTED', actorId: finance.id, notes: 'Too many <open> plans' });
      expect(await notifyCustomerOfFlexDecision(applied.applicationId)).toBe(true);
      expect(sent[0]).toMatchObject({ to: customer.email, tags: ['flex-decision'] });
      expect(sent[0]!.html).toContain('Too many &lt;open&gt; plans');
      expect(sent[0]!.html).toContain(`https://shop.example.test/en/flex/${applied.applicationId}`);
    } finally {
      delete process.env.BREVO_API_KEY;
    }
  }, 120_000);
});
