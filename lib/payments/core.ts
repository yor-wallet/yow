import { Prisma, type PaymentIntent, type PaymentProvider } from '@prisma/client';
import { prisma, isUniqueViolation } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { isBaisa } from '@/lib/money';
import { idempotencyKeySchema } from '@/lib/validation';
import { can } from '@/lib/rbac';
import { MoneyError } from '@/lib/wallet/errors';
import { getWalletLimits } from '@/lib/wallet/limits';
import {
  ensureWallet,
  makeReference,
  postTransaction,
  systemAccountId,
  withLedgerTx,
  type LedgerEntryInput,
  type SystemAccountCode,
} from '@/lib/wallet/ledger';
import { getAdapter } from './registry';
import { assertMethodAllowed } from './policy';
import { raisePaymentAlert } from './alerts';
import { notifyMoney } from './notify';
import { markOrderPaid } from './order-port';
import { isExternalProvider, type ExternalProviderId, type PaymentMethodId, type ProviderAdapter, type StartPaymentResult } from './types';
import { payReturnUrl, webhookUrl } from './util';

/**
 * Payment core. `confirmPaymentIntent` is the ONLY place that marks a PaymentIntent
 * SUCCEEDED and posts the ledger + downstream effects (wallet credit / order paid /
 * instalment paid). It is idempotent (row lock on the intent + ledger idempotency key
 * `pi:<intentId>`), and an amount mismatch marks the intent FAILED and raises an alert.
 */

type Locale = 'ar' | 'en' | 'fr';
const PENDING_STATUSES = ['CREATED', 'PENDING', 'REQUIRES_ACTION'] as const;
const DEFAULT_EXPIRY_MS = 60 * 60_000;

export type ConfirmArgs = {
  /** Amount the provider / reviewer CONFIRMED (baisa). */
  confirmedAmountBaisa: number;
  providerRef?: string | null;
  /** Where the confirmation came from: `wallet`, `webhook:thawani`, `poll:thawani`, `giftcard.review`, `flex.accept`… */
  source: string;
  actorId?: string | null;
};

export type ConfirmResult = {
  outcome: 'succeeded' | 'already_succeeded' | 'failed';
  intentId: string;
  /** True when an external payment for an order/instalment that was no longer payable was credited to the wallet instead. */
  creditedToWallet?: boolean;
  ledgerTransactionId?: string;
};

function checkKey(key: string): string {
  const r = idempotencyKeySchema.safeParse(key);
  if (!r.success) throw new MoneyError('invalid_input', 'A valid idempotency key is required');
  return r.data;
}

function sourceAccountFor(provider: PaymentProvider): SystemAccountCode | 'WALLET' {
  switch (provider) {
    case 'WALLET':
      return 'WALLET';
    case 'GIFT_CARD':
      return 'GIFT_CARD_CLEARING';
    case 'FLEX':
      return 'FLEX_RECEIVABLE';
    default:
      return 'PAYMENT_CLEARING';
  }
}

const REF_PREFIX: Record<string, string> = {
  TOPUP: 'TOP',
  GIFT_CARD_CREDIT: 'GFT',
  ORDER_PAYMENT: 'PAY',
  FLEX_DISBURSEMENT: 'FLX',
  INSTALLMENT_PAYMENT: 'INS',
  REFUND: 'RFD',
  ADJUSTMENT: 'ADJ',
  REVERSAL: 'REV',
};

/** Commission recorded on a gift-card intent (integer baisa, strictly below the encashed value). */
function commissionOf(metadata: unknown, amount: number): number {
  const c = (metadata as { commissionBaisa?: unknown } | null)?.commissionBaisa;
  if (c === undefined || c === null) return 0;
  if (typeof c !== 'number' || !Number.isSafeInteger(c) || c < 0 || c >= amount) throw new MoneyError('ledger_integrity', 'Invalid commission on the payment intent');
  return c;
}

export function ledgerReference(type: keyof typeof REF_PREFIX | string): string {
  return makeReference(REF_PREFIX[type] ?? 'TXN');
}

function metaOf(intent: Pick<PaymentIntent, 'metadata'>): Record<string, unknown> {
  return intent.metadata && typeof intent.metadata === 'object' && !Array.isArray(intent.metadata)
    ? (intent.metadata as Record<string, unknown>)
    : {};
}

// ───────────── Confirmation ─────────────

/**
 * Confirm a payment intent. Pass `tx` to compose with a caller's transaction (wallet
 * payments do: debit + order paid commit atomically, or not at all).
 */
export async function confirmPaymentIntent(intentId: string, args: ConfirmArgs, tx?: Prisma.TransactionClient): Promise<ConfirmResult> {
  if (tx) return confirmInTx(tx, intentId, args);
  const owner = await prisma.paymentIntent.findUnique({ where: { id: intentId }, select: { userId: true } });
  if (!owner) throw new MoneyError('not_found', 'Payment intent not found');
  await ensureWallet(owner.userId); // created outside the transaction (wallet credits may need it)
  return withLedgerTx((t) => confirmInTx(t, intentId, args));
}

async function confirmInTx(tx: Prisma.TransactionClient, intentId: string, args: ConfirmArgs): Promise<ConfirmResult> {
  await tx.$queryRaw`SELECT "id" FROM "PaymentIntent" WHERE "id" = ${intentId} FOR UPDATE`;
  const intent = await tx.paymentIntent.findUnique({ where: { id: intentId }, include: { installment: true } });
  if (!intent) throw new MoneyError('not_found', 'Payment intent not found');
  if (intent.status === 'SUCCEEDED') return { outcome: 'already_succeeded', intentId };
  if (intent.status === 'FAILED' && intent.failureCode === 'amount_mismatch') return { outcome: 'failed', intentId };
  if (!isBaisa(args.confirmedAmountBaisa) || args.confirmedAmountBaisa < 0) {
    throw new MoneyError('invalid_amount', 'confirmedAmountBaisa must be a non-negative integer');
  }
  if (args.providerRef && intent.providerRef && args.providerRef !== intent.providerRef) {
    await raisePaymentAlert(
      {
        severity: 'HIGH',
        code: 'provider_ref_mismatch',
        title: `${intent.provider} confirmation for another provider reference`,
        details: { paymentIntentId: intent.id, expected: intent.providerRef, received: args.providerRef, source: args.source },
      },
      prisma, // outside the transaction: it is rolled back by the throw below
    );
    throw new MoneyError('provider_ref_mismatch');
  }

  // Top-ups by gift card (admin-verified encashed value) and crypto (provider-settled OMR
  // value) credit the CONFIRMED amount; everything else must match exactly.
  const variable = intent.purpose === 'TOPUP' && (intent.provider === 'GIFT_CARD' || intent.provider === 'CRYPTO');
  let amount = intent.amountBaisa;
  if (variable) {
    if (args.confirmedAmountBaisa <= 0) throw new MoneyError('invalid_amount', 'Confirmed amount must be positive');
    amount = args.confirmedAmountBaisa;
  } else if (args.confirmedAmountBaisa !== intent.amountBaisa) {
    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'FAILED',
        failureCode: 'amount_mismatch',
        failureMessage: `Confirmed ${args.confirmedAmountBaisa} baisa, expected ${intent.amountBaisa} (${args.source})`,
        confirmedAmountBaisa: args.confirmedAmountBaisa,
        providerRef: intent.providerRef ?? args.providerRef ?? null,
      },
    });
    await raisePaymentAlert(
      {
        severity: 'CRITICAL',
        code: 'amount_mismatch',
        title: `${intent.provider} payment confirmed for a different amount — manual review required`,
        details: {
          paymentIntentId: intent.id,
          provider: intent.provider,
          purpose: intent.purpose,
          amountBaisa: intent.amountBaisa,
          confirmedAmountBaisa: args.confirmedAmountBaisa,
          source: args.source,
        },
      },
      tx,
    );
    return { outcome: 'failed', intentId: intent.id };
  }

  const walletAccount = async () => {
    const w = await tx.wallet.findUnique({ where: { userId: intent.userId }, select: { ledgerAccountId: true } });
    if (!w) throw new MoneyError('ledger_integrity', 'Wallet missing for confirmation (call ensureWallet first)');
    return w.ledgerAccountId;
  };
  const src = sourceAccountFor(intent.provider);
  const sourceId = src === 'WALLET' ? await walletAccount() : await systemAccountId(tx, src);
  const external = src === 'PAYMENT_CLEARING';
  const base = {
    idempotencyKey: `pi:${intent.id}`,
    paymentIntentId: intent.id,
    createdById: args.actorId ?? null,
    metadata: { source: args.source, provider: intent.provider, purpose: intent.purpose },
  };

  let creditedToWallet = false;
  let ledgerTransactionId: string;
  let link = '/wallet';

  const creditWalletInstead = async (why: string) => {
    const { transaction } = await postTransaction(tx, {
      ...base,
      reference: ledgerReference('TOPUP'),
      type: 'TOPUP',
      description: why,
      orderId: intent.orderId,
      entries: [
        { accountId: sourceId, amountBaisa: -amount },
        { accountId: await walletAccount(), amountBaisa: amount },
      ],
    });
    creditedToWallet = true;
    await raisePaymentAlert(
      {
        severity: 'MEDIUM',
        code: 'credited_to_wallet',
        title: `${intent.provider} payment arrived for a ${intent.purpose.toLowerCase()} that is no longer payable — credited to the wallet`,
        details: { paymentIntentId: intent.id, orderId: intent.orderId, amountBaisa: amount, reason: why },
      },
      tx,
    );
    return transaction.id;
  };

  if (intent.purpose === 'TOPUP') {
    if (src === 'WALLET' || src === 'FLEX_RECEIVABLE') throw new MoneyError('invalid_input', 'Invalid top-up source');
    const type = intent.provider === 'GIFT_CARD' ? 'GIFT_CARD_CREDIT' : 'TOPUP';
    const giftCard =
      intent.provider === 'GIFT_CARD'
        ? await tx.giftCardSubmission.findFirst({ where: { paymentIntentId: intent.id }, select: { id: true } })
        : null;
    // Gift cards: the exchange commission (decided and stored on the intent at verification) goes to
    // platform revenue; the wallet receives the rest. One balanced transaction: -gross = +net +commission.
    const commission = intent.provider === 'GIFT_CARD' ? commissionOf(intent.metadata, amount) : 0;
    const { transaction } = await postTransaction(tx, {
      ...base,
      reference: ledgerReference(type),
      type,
      giftCardSubmissionId: giftCard?.id ?? null,
      ...(commission > 0 ? { metadata: { ...base.metadata, grossBaisa: amount, commissionBaisa: commission } } : {}),
      entries: [
        { accountId: sourceId, amountBaisa: -amount },
        { accountId: await walletAccount(), amountBaisa: amount - commission },
        ...(commission > 0 ? [{ accountId: await systemAccountId(tx, 'PLATFORM_REVENUE'), amountBaisa: commission }] : []),
      ],
    });
    ledgerTransactionId = transaction.id;
  } else if (intent.purpose === 'ORDER') {
    if (!intent.orderId) throw new MoneyError('order_not_payable', 'Intent has no order');
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${intent.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: intent.orderId },
      select: { id: true, userId: true, status: true, totalBaisa: true, deliveryFeeBaisa: true, number: true },
    });
    const other = order
      ? await tx.paymentIntent.count({ where: { orderId: order.id, status: 'SUCCEEDED', id: { not: intent.id } } })
      : 0;
    // A late external payment for an order cancelled after its reservation expired can still
    // be honoured if the stock is there (markOrderPaid decides); otherwise → wallet credit.
    const statusOk = order?.status === 'PENDING_PAYMENT' || (external && order?.status === 'CANCELLED');
    const payable = !!order && statusOk && other === 0 && order.totalBaisa === amount && order.userId === intent.userId;
    const marked = payable ? await markOrderPaid(order.id, intent.id, tx) : null;
    if (!payable || !marked || !marked.ok || marked.alreadyPaid) {
      if (!external) throw new MoneyError('order_not_payable', 'Order is not awaiting this payment');
      const why = marked && !marked.ok ? `order_${marked.reason}` : 'order_not_payable';
      ledgerTransactionId = await creditWalletInstead(why);
    } else {
      const fee = order.deliveryFeeBaisa;
      const entries: LedgerEntryInput[] = [{ accountId: sourceId, amountBaisa: -amount }];
      if (fee > 0 && fee < amount) {
        entries.push({ accountId: await systemAccountId(tx, 'PLATFORM_REVENUE'), amountBaisa: amount - fee });
        entries.push({ accountId: await systemAccountId(tx, 'DELIVERY_REVENUE'), amountBaisa: fee });
      } else {
        entries.push({ accountId: await systemAccountId(tx, 'PLATFORM_REVENUE'), amountBaisa: amount });
      }
      const type = intent.provider === 'FLEX' ? 'FLEX_DISBURSEMENT' : 'ORDER_PAYMENT';
      const { transaction } = await postTransaction(tx, { ...base, reference: ledgerReference(type), type, orderId: order.id, entries });
      ledgerTransactionId = transaction.id;
      link = `/orders/${order.number}`;
    }
  } else {
    // INSTALLMENT
    const inst = intent.installment;
    if (inst) await tx.$queryRaw`SELECT "id" FROM "FlexInstallment" WHERE "id" = ${inst.id} FOR UPDATE`;
    const fresh = inst ? await tx.flexInstallment.findUnique({ where: { id: inst.id }, include: { application: true } }) : null;
    const payable =
      !!fresh &&
      (fresh.status === 'PENDING' || fresh.status === 'OVERDUE') &&
      fresh.amountBaisa === amount &&
      fresh.application.userId === intent.userId &&
      (fresh.application.status === 'ACTIVE' || fresh.application.status === 'ACCEPTED');
    if (!payable) {
      if (!external) throw new MoneyError('installment_not_payable', 'Instalment is not payable');
      ledgerTransactionId = await creditWalletInstead('installment_not_payable');
    } else {
      const { transaction } = await postTransaction(tx, {
        ...base,
        reference: ledgerReference('INSTALLMENT_PAYMENT'),
        type: 'INSTALLMENT_PAYMENT',
        flexInstallmentId: fresh.id,
        orderId: fresh.application.orderId,
        entries: [
          { accountId: sourceId, amountBaisa: -amount },
          { accountId: await systemAccountId(tx, 'FLEX_RECEIVABLE'), amountBaisa: amount },
        ],
      });
      ledgerTransactionId = transaction.id;
      await tx.flexInstallment.update({ where: { id: fresh.id }, data: { status: 'PAID', paidAt: new Date() } });
      const remaining = await tx.flexInstallment.count({
        where: { applicationId: fresh.applicationId, status: { in: ['PENDING', 'OVERDUE'] } },
      });
      if (remaining === 0) {
        await tx.flexApplication.update({ where: { id: fresh.applicationId }, data: { status: 'COMPLETED' } });
        await logAudit(
          { actorId: null, action: 'flex.completed', entity: 'FlexApplication', entityId: fresh.applicationId, after: { status: 'COMPLETED' } },
          tx,
        );
      }
      link = `/flex/${fresh.applicationId}`;
    }
  }

  const meta = metaOf(intent);
  await tx.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: 'SUCCEEDED',
      confirmedAmountBaisa: args.confirmedAmountBaisa,
      succeededAt: new Date(),
      providerRef: intent.providerRef ?? args.providerRef ?? null,
      failureCode: null,
      failureMessage: null,
      ...(variable && amount !== intent.amountBaisa ? { amountBaisa: amount } : {}),
      metadata: {
        ...meta,
        confirmedBy: args.source,
        ...(variable && amount !== intent.amountBaisa ? { requestedAmountBaisa: intent.amountBaisa } : {}),
        ...(creditedToWallet ? { creditedToWallet: true } : {}),
      } as Prisma.InputJsonValue,
    },
  });
  await logAudit(
    {
      actorId: args.actorId ?? null,
      action: 'payment.succeeded',
      entity: 'PaymentIntent',
      entityId: intent.id,
      before: { status: intent.status },
      after: { status: 'SUCCEEDED', amountBaisa: amount, provider: intent.provider, purpose: intent.purpose, source: args.source, creditedToWallet },
    },
    tx,
  );
  if (intent.purpose === 'TOPUP' || creditedToWallet) {
    if (intent.provider !== 'GIFT_CARD') await notifyMoney(intent.userId, 'topupConfirmed', { amountBaisa: amount }, '/wallet', tx);
  } else if (intent.purpose === 'INSTALLMENT') {
    await notifyMoney(intent.userId, 'installmentPaid', { amountBaisa: amount }, link, tx);
  } else if (intent.provider !== 'FLEX') {
    await notifyMoney(intent.userId, 'orderPaid', { amountBaisa: amount }, link, tx);
  }
  return { outcome: 'succeeded', intentId: intent.id, creditedToWallet, ledgerTransactionId };
}

// ───────────── Starting payments ─────────────

export function resultFromIntent(intent: PaymentIntent, replayed: boolean): StartPaymentResult {
  switch (intent.status) {
    case 'SUCCEEDED':
      return { status: 'succeeded', intentId: intent.id, replayed };
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
      return { status: 'failed', reason: intent.failureCode ?? intent.status.toLowerCase(), intentId: intent.id, replayed };
    default: {
      const notExpired = !intent.expiresAt || intent.expiresAt.getTime() > Date.now();
      if (intent.redirectUrl && notExpired) return { status: 'redirect', url: intent.redirectUrl, intentId: intent.id, replayed };
      const instructions = metaOf(intent).instructions;
      return { status: 'pending', intentId: intent.id, replayed, ...(typeof instructions === 'string' ? { instructions } : {}) };
    }
  }
}

async function customerOf(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, phone: true, status: true, locale: true } });
  if (!u || u.status !== 'ACTIVE') throw new MoneyError('forbidden', 'Account not active');
  return u;
}

/** Create the provider-side payment for a CREATED intent (outside any DB transaction). */
async function launchExternal(
  intent: PaymentIntent,
  adapter: ProviderAdapter,
  customer: Awaited<ReturnType<typeof customerOf>>,
  locale: Locale,
  description: string,
): Promise<StartPaymentResult> {
  try {
    const res = await adapter.createPayment({
      intentId: intent.id,
      amountBaisa: intent.amountBaisa,
      purpose: intent.purpose,
      description,
      locale,
      returnUrl: payReturnUrl(locale, intent.id),
      cancelUrl: payReturnUrl(locale, intent.id, '?cancelled=1'),
      webhookUrl: webhookUrl(adapter.slug),
      customer: { id: customer.id, email: customer.email, fullName: customer.fullName, phone: customer.phone },
    });
    await prisma.paymentIntent.updateMany({
      where: { id: intent.id, status: 'CREATED' },
      data: {
        status: 'PENDING',
        providerRef: res.providerRef,
        redirectUrl: res.redirectUrl ?? null,
        expiresAt: res.expiresAt ?? new Date(Date.now() + DEFAULT_EXPIRY_MS),
        metadata: { ...metaOf(intent), ...(res.instructions ? { instructions: res.instructions } : {}) } as Prisma.InputJsonValue,
      },
    });
    const updated = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    return resultFromIntent(updated, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[payments] ${adapter.slug} createPayment failed`, message);
    await prisma.paymentIntent.updateMany({
      where: { id: intent.id, status: 'CREATED' },
      data: { status: 'FAILED', failureCode: 'provider_error', failureMessage: message.slice(0, 500) },
    });
    throw new MoneyError('provider_unavailable', `${adapter.displayName} is unavailable right now`);
  }
}

async function replayOrThrow(
  key: string,
  matches: (i: PaymentIntent) => boolean,
): Promise<StartPaymentResult | null> {
  const existing = await prisma.paymentIntent.findUnique({ where: { idempotencyKey: key } });
  if (!existing) return null;
  if (!matches(existing)) throw new MoneyError('idempotency_key_reused', 'Idempotency key already used for another payment');
  return resultFromIntent(existing, true);
}

/**
 * Start a wallet top-up through an external provider (CARD / OOREDOO / OMANTEL / CRYPTO).
 * Gift cards use `submitGiftCard` (lib/payments/giftcards). The wallet is credited only by
 * `confirmPaymentIntent` after server-side verification with the provider.
 */
export async function startTopUp(
  userId: string,
  methodId: PaymentMethodId,
  amountBaisa: number,
  idempotencyKey: string,
  opts: { locale?: Locale } = {},
): Promise<StartPaymentResult> {
  const key = `topup:${userId}:${checkKey(idempotencyKey)}`;
  if (!isBaisa(amountBaisa) || amountBaisa <= 0) throw new MoneyError('invalid_amount');
  if (!isExternalProvider(methodId)) throw new MoneyError('method_unavailable', `${methodId} cannot be used to top up`);

  const replay = await replayOrThrow(key, (i) => i.userId === userId && i.provider === methodId && i.amountBaisa === amountBaisa && i.purpose === 'TOPUP');
  if (replay) return replay;

  const adapter = getAdapter(methodId);
  if (!adapter.isConfigured()) throw new MoneyError('method_unavailable', `${adapter.displayName} is not available`);
  if (methodId === 'CRYPTO') await assertMethodAllowed('CRYPTO', { purpose: 'TOPUP', amountBaisa, userId });
  const limits = await getWalletLimits();
  if (amountBaisa < Math.max(limits.minTopUpBaisa, adapter.minAmountBaisa ?? 0)) {
    throw new MoneyError('amount_below_minimum', undefined, { minBaisa: Math.max(limits.minTopUpBaisa, adapter.minAmountBaisa ?? 0) });
  }
  if (amountBaisa > limits.maxTopUpBaisa) throw new MoneyError('amount_above_maximum', undefined, { maxBaisa: limits.maxTopUpBaisa });

  const customer = await customerOf(userId);
  const wallet = await ensureWallet(userId);
  if (wallet.status !== 'ACTIVE') throw new MoneyError('wallet_frozen');
  const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: wallet.ledgerAccountId }, select: { balanceBaisa: true } });
  if (account.balanceBaisa + amountBaisa > limits.maxBalanceBaisa) {
    throw new MoneyError('balance_limit_exceeded', undefined, { maxBalanceBaisa: limits.maxBalanceBaisa });
  }

  let intent: PaymentIntent;
  try {
    intent = await prisma.paymentIntent.create({
      data: { userId, provider: methodId, purpose: 'TOPUP', amountBaisa, idempotencyKey: key, status: 'CREATED', metadata: {} },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await replayOrThrow(key, (i) => i.userId === userId && i.provider === methodId && i.amountBaisa === amountBaisa);
      if (again) return again;
    }
    throw err;
  }
  const locale = opts.locale ?? customer.locale;
  return launchExternal(intent, adapter, customer, locale, 'DOOM Wallet top-up');
}

/**
 * Start paying an order (status PENDING_PAYMENT) owned by `userId`.
 *  - WALLET: one DB transaction debits the wallet, marks the intent SUCCEEDED and the order
 *    PAID (via lib/orders `markOrderPaid`) — or nothing happens (e.g. insufficient balance).
 *  - CARD / OOREDOO / OMANTEL / CRYPTO: creates the provider payment and returns the
 *    redirect; confirmation happens later (webhook + server-side re-fetch / status poll).
 * Idempotent per key; an unexpired pending intent for the same order + method is reused.
 */
export async function startOrderPayment(
  orderId: string,
  methodId: PaymentMethodId,
  userId: string,
  idempotencyKey: string,
  opts: { locale?: Locale } = {},
): Promise<StartPaymentResult> {
  const key = `order:${userId}:${checkKey(idempotencyKey)}`;
  const replay = await replayOrThrow(key, (i) => i.userId === userId && i.orderId === orderId && i.provider === methodId);
  if (replay) return replay;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, userId: true, status: true, totalBaisa: true, number: true } });
  if (!order || order.userId !== userId) throw new MoneyError('not_found', 'Order not found');
  const paid = await prisma.paymentIntent.count({ where: { orderId, status: 'SUCCEEDED' } });
  if (paid > 0) throw new MoneyError('order_already_paid');
  if (order.status !== 'PENDING_PAYMENT' || order.totalBaisa <= 0) throw new MoneyError('order_not_payable');
  const customer = await customerOf(userId);

  if (methodId === 'WALLET') {
    const wallet = await ensureWallet(userId);
    if (wallet.status !== 'ACTIVE') throw new MoneyError('wallet_frozen');
    try {
      const { intentId, replayed } = await withLedgerTx(async (tx) => {
        const dup = await tx.paymentIntent.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
        if (dup) return { intentId: dup.id, replayed: true };
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, totalBaisa: true } });
        const already = await tx.paymentIntent.count({ where: { orderId, status: 'SUCCEEDED' } });
        if (already > 0) throw new MoneyError('order_already_paid');
        if (fresh.status !== 'PENDING_PAYMENT') throw new MoneyError('order_not_payable');
        const intent = await tx.paymentIntent.create({
          data: { userId, provider: 'WALLET', purpose: 'ORDER', orderId, amountBaisa: fresh.totalBaisa, idempotencyKey: key, status: 'CREATED', metadata: {} },
        });
        await confirmInTx(tx, intent.id, { confirmedAmountBaisa: fresh.totalBaisa, source: 'wallet', actorId: userId });
        return { intentId: intent.id, replayed: false };
      });
      const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
      return resultFromIntent(intent, replayed);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await replayOrThrow(key, (i) => i.orderId === orderId && i.provider === 'WALLET');
        if (again) return again;
      }
      throw err;
    }
  }

  if (!isExternalProvider(methodId)) throw new MoneyError('method_unavailable', `${methodId} cannot pay an order directly`);
  const adapter = getAdapter(methodId);
  if (!adapter.isConfigured()) throw new MoneyError('method_unavailable', `${adapter.displayName} is not available`);
  if (methodId === 'CRYPTO') await assertMethodAllowed('CRYPTO', { purpose: 'ORDER', amountBaisa: order.totalBaisa, userId });
  if (adapter.minAmountBaisa && order.totalBaisa < adapter.minAmountBaisa) throw new MoneyError('amount_below_minimum');

  const reusable = await prisma.paymentIntent.findFirst({
    where: { orderId, provider: methodId, userId, status: 'PENDING', redirectUrl: { not: null }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (reusable && reusable.amountBaisa === order.totalBaisa) return resultFromIntent(reusable, true);

  let intent: PaymentIntent;
  try {
    intent = await prisma.paymentIntent.create({
      data: { userId, provider: methodId, purpose: 'ORDER', orderId, amountBaisa: order.totalBaisa, idempotencyKey: key, status: 'CREATED', metadata: {} },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await replayOrThrow(key, (i) => i.orderId === orderId && i.provider === methodId);
      if (again) return again;
    }
    throw err;
  }
  return launchExternal(intent, adapter, customer, opts.locale ?? customer.locale, `DOOM order ${order.number}`);
}

// ───────────── Status / refresh ─────────────

/** Close a still-pending intent after the provider reported failure / cancellation / expiry. */
export async function closePendingIntent(intentId: string, status: 'FAILED' | 'CANCELLED' | 'EXPIRED', code: string): Promise<boolean> {
  const res = await prisma.paymentIntent.updateMany({
    where: { id: intentId, status: { in: [...PENDING_STATUSES] } },
    data: { status, failureCode: code },
  });
  return res.count === 1;
}

/**
 * Ask the provider for the current status of a pending external intent (server-side) and
 * confirm/close it accordingly. Safe to call repeatedly (status page polling, webhooks, cron).
 */
export async function refreshPaymentIntent(intentId: string, source = 'poll'): Promise<PaymentIntent> {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new MoneyError('not_found');
  if (!(PENDING_STATUSES as readonly string[]).includes(intent.status) || !intent.providerRef || !isExternalProvider(intent.provider)) {
    return intent;
  }
  const adapter = getAdapter(intent.provider as ExternalProviderId);
  if (!adapter.isConfigured()) return intent;
  const status = await adapter.fetchStatus(intent.providerRef);
  if (status.clientReference && status.clientReference !== intent.id) {
    await raisePaymentAlert({
      severity: 'HIGH',
      code: 'client_reference_mismatch',
      title: `${adapter.displayName} returned a payment for another reference`,
      details: { paymentIntentId: intent.id, providerRef: intent.providerRef, clientReference: status.clientReference },
    });
    return intent;
  }
  if (status.status === 'paid' && typeof status.amountBaisa === 'number') {
    await confirmPaymentIntent(intent.id, { confirmedAmountBaisa: status.amountBaisa, providerRef: intent.providerRef, source: `${source}:${adapter.slug}` });
  } else if (status.status === 'failed') {
    await closePendingIntent(intent.id, 'FAILED', 'provider_declined');
  } else if (status.status === 'cancelled') {
    await closePendingIntent(intent.id, 'CANCELLED', 'cancelled');
  } else if (status.status === 'expired') {
    await closePendingIntent(intent.id, 'EXPIRED', 'expired');
  }
  return prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
}

export type PaymentIntentView = {
  id: string;
  status: PaymentIntent['status'];
  provider: PaymentIntent['provider'];
  purpose: PaymentIntent['purpose'];
  amountBaisa: number;
  confirmedAmountBaisa: number | null;
  createdAt: string;
  succeededAt: string | null;
  failureCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  flexApplicationId: string | null;
  /** Continue-to-provider link while still pending and not expired. */
  redirectUrl: string | null;
  instructions: string | null;
  creditedToWallet: boolean;
  ledgerTransactionId: string | null;
};

/** Safe status view for the customer (owner) or finance staff (`payments:read`). */
export async function getPaymentIntentView(
  intentId: string,
  viewer: { id: string; role: Parameters<typeof can>[0] },
): Promise<PaymentIntentView | null> {
  const intent = await prisma.paymentIntent.findUnique({
    where: { id: intentId },
    include: {
      order: { select: { number: true } },
      installment: { select: { applicationId: true } },
      ledgerTransactions: { select: { id: true }, take: 1 },
    },
  });
  if (!intent) return null;
  if (intent.userId !== viewer.id && !can(viewer.role, 'payments:read')) return null;
  const meta = metaOf(intent);
  const pending = (PENDING_STATUSES as readonly string[]).includes(intent.status);
  const notExpired = !intent.expiresAt || intent.expiresAt.getTime() > Date.now();
  return {
    id: intent.id,
    status: intent.status,
    provider: intent.provider,
    purpose: intent.purpose,
    amountBaisa: intent.amountBaisa,
    confirmedAmountBaisa: intent.confirmedAmountBaisa,
    createdAt: intent.createdAt.toISOString(),
    succeededAt: intent.succeededAt?.toISOString() ?? null,
    failureCode: intent.failureCode,
    orderId: intent.orderId,
    orderNumber: intent.order?.number ?? null,
    flexApplicationId: intent.installment?.applicationId ?? (typeof meta.flexApplicationId === 'string' ? meta.flexApplicationId : null),
    redirectUrl: pending && notExpired ? intent.redirectUrl : null,
    instructions: pending && typeof meta.instructions === 'string' ? meta.instructions : null,
    creditedToWallet: meta.creditedToWallet === true,
    ledgerTransactionId: intent.ledgerTransactions[0]?.id ?? null,
  };
}

/**
 * Housekeeping for the cron/agents: re-check pending external intents whose expiry passed,
 * then mark the still-unpaid ones EXPIRED. Returns the number of intents examined.
 */
export async function expireStalePaymentIntents(now = new Date(), limit = 100): Promise<{ examined: number; expired: number; confirmed: number }> {
  const stale = await prisma.paymentIntent.findMany({
    where: { status: { in: [...PENDING_STATUSES] }, expiresAt: { lt: now }, provider: { in: ['CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO'] } },
    take: limit,
    orderBy: { expiresAt: 'asc' },
  });
  let expired = 0;
  let confirmed = 0;
  for (const intent of stale) {
    try {
      const fresh = await refreshPaymentIntent(intent.id, 'expiry');
      if (fresh.status === 'SUCCEEDED') confirmed++;
      else if ((PENDING_STATUSES as readonly string[]).includes(fresh.status) && (await closePendingIntent(intent.id, 'EXPIRED', 'expired'))) expired++;
    } catch (err) {
      console.error('[payments] expiry check failed', intent.id, err);
    }
  }
  return { examined: stale.length, expired, confirmed };
}
