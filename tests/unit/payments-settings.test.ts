/**
 * Payment settings (crypto, gift-card exchange, wallet limits): the 8% gift-card commission booked in the
 * ledger, the business rules that gate crypto / gift cards (checkout display AND server side), and the
 * admin mutation that edits them. Runs against PostgreSQL (doom_test).
 *
 * The ledger is append-only (a trigger refuses to delete entries), so the customers, reviewers, cards and ledger
 * rows of the commission tests stay in doom_test — uniquely named (`payset-…`), balanced, and harmless. Settings
 * rows and the staff accounts used to edit settings are removed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { ForbiddenError, ValidationError, type Actor } from '@/lib/admin/actor';
import { getSettings, SETTINGS, type SettingKey } from '@/lib/admin/settings';
import { parseFormValue, savePaymentSettings, toFormValue } from '@/lib/admin/payment-settings';
import { reviewGiftCard, submitGiftCard } from '@/lib/payments/giftcards';
import { assertMethodAllowed, giftCardCommissionBaisa, methodPolicyReason } from '@/lib/payments/policy';
import { listPaymentMethods } from '@/lib/payments/registry';
import { getWalletLimits } from '@/lib/wallet/limits';
import { ensureWallet, getBalance, systemAccountId, walletAccountCode } from '@/lib/wallet/ledger';
import { MoneyError } from '@/lib/wallet/errors';
import { cleanup, createUser, RUN } from './shop/fixtures';

const PAYMENT_KEYS = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => SETTINGS[k].group === 'payments');
const staffIds: string[] = [];
let seq = 0;

/** Staff who EDIT settings: no ledger activity, so the fixture cleanup removes them. */
async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  staffIds.push(u.id);
  return { id: u.id, role };
}

/** Users that take part in ledger postings (customers, finance reviewers): kept, see the header. */
async function keptUser(role: Actor['role'] | 'CUSTOMER' = 'CUSTOMER', kyc: 'VERIFIED' | 'UNVERIFIED' = 'UNVERIFIED') {
  const n = ++seq;
  return prisma.user.create({
    data: { email: `payset-${RUN.toLowerCase()}-${n}@test.doom.local`, fullName: 'Payment Settings Tester', passwordHash: 'x'.repeat(60), role, kycStatus: kyc, phone: `+9687${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}` },
    select: { id: true, email: true },
  });
}
const customer = (kyc: 'VERIFIED' | 'UNVERIFIED' = 'UNVERIFIED') => keptUser('CUSTOMER', kyc);
const finance = () => keptUser('FINANCE');

async function setSetting(key: SettingKey, value: number | null) {
  if (value === null) await prisma.setting.deleteMany({ where: { key } });
  else await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function clearPaymentSettings() {
  await prisma.setting.deleteMany({ where: { key: { in: PAYMENT_KEYS } } });
}

/** A fully valid card ready for review. */
async function submitCard(userId: string) {
  const code = `T${randomBytes(6).toString('hex').toUpperCase()}`;
  const res = await submitGiftCard({ userId, data: { brand: 'APPLE', code, currency: 'OMR', value: '100' } });
  return res.id;
}

beforeAll(clearPaymentSettings);
afterEach(clearPaymentSettings);

afterAll(async () => {
  await clearPaymentSettings();
  await prisma.auditLog.deleteMany({ where: { entity: 'Setting', actorId: { in: staffIds } } });
  await cleanup();
  await prisma.$disconnect();
});

describe('gift card exchange commission', () => {
  it('rounds the commission to the nearest baisa and never takes the whole card', () => {
    expect(giftCardCommissionBaisa(100_000, 800)).toBe(8_000);
    expect(giftCardCommissionBaisa(12_345, 800)).toBe(988); // 987.6
    expect(giftCardCommissionBaisa(100_000, 0)).toBe(0);
    expect(giftCardCommissionBaisa(1, 5_000)).toBe(0); // 0.5 rounds to 1 but is capped below the value
    expect(giftCardCommissionBaisa(2, 5_000)).toBe(1);
  });

  it('credits 92.000 OMR and books 8.000 OMR as platform revenue for a 100.000 OMR card (default 8%)', async () => {
    const user = await customer();
    const reviewer = await finance();
    await ensureWallet(user.id);
    const revenue = await systemAccountId(prisma, 'PLATFORM_REVENUE');
    const clearing = await systemAccountId(prisma, 'GIFT_CARD_CLEARING');
    const revenueBefore = (await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: revenue } })).balanceBaisa;
    const clearingBefore = (await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: clearing } })).balanceBaisa;

    const id = await submitCard(user.id);
    const res = await reviewGiftCard({ id, decision: 'VERIFIED', encashedValueBaisa: 100_000, reviewerId: reviewer.id });
    expect(res).toMatchObject({ status: 'VERIFIED', creditedBaisa: 92_000, replayed: false });

    expect((await getBalance(user.id)).balanceBaisa).toBe(92_000);
    expect((await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: revenue } })).balanceBaisa - revenueBefore).toBe(8_000);
    expect((await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: clearing } })).balanceBaisa - clearingBefore).toBe(-100_000);

    // One balanced transaction: -100 000 clearing, +92 000 wallet, +8 000 revenue; the amounts are on the record.
    const tx = await prisma.ledgerTransaction.findFirstOrThrow({ where: { giftCardSubmissionId: id }, include: { entries: true } });
    expect(tx.entries.reduce((n, e) => n + e.amountBaisa, 0)).toBe(0);
    expect(tx.entries.map((e) => e.amountBaisa).sort((a, b) => a - b)).toEqual([-100_000, 8_000, 92_000]);
    expect(tx.metadata).toMatchObject({ grossBaisa: 100_000, commissionBaisa: 8_000 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: 'giftcard.verify' } });
    expect(audit.after).toMatchObject({ encashedValueBaisa: 100_000, feeBps: 800, commissionBaisa: 8_000, creditedBaisa: 92_000 });

    // Re-running the same verification credits nothing more and reports the net amount.
    const again = await reviewGiftCard({ id, decision: 'VERIFIED', encashedValueBaisa: 100_000, reviewerId: reviewer.id });
    expect(again).toMatchObject({ creditedBaisa: 92_000, replayed: true });
    expect((await getBalance(user.id)).balanceBaisa).toBe(92_000);
  }, 60_000);

  it('uses the configured percentage; 0% credits the whole value', async () => {
    const user = await customer();
    const reviewer = await finance();
    await ensureWallet(user.id);
    await setSetting('giftcard.feeBps', 1_250); // 12.5%
    const a = await submitCard(user.id);
    expect(await reviewGiftCard({ id: a, decision: 'VERIFIED', encashedValueBaisa: 40_000, reviewerId: reviewer.id })).toMatchObject({ creditedBaisa: 35_000 });
    await setSetting('giftcard.feeBps', 0);
    const b = await submitCard(user.id);
    expect(await reviewGiftCard({ id: b, decision: 'VERIFIED', encashedValueBaisa: 10_000, reviewerId: reviewer.id })).toMatchObject({ creditedBaisa: 10_000 });
    expect((await getBalance(user.id)).balanceBaisa).toBe(45_000);
    const free = await prisma.ledgerTransaction.findFirstOrThrow({ where: { giftCardSubmissionId: b }, include: { entries: true } });
    expect(free.entries).toHaveLength(2); // no commission line at 0%
  }, 60_000);

  it('can be paused, can require a verified identity, and limits the cards awaiting review', async () => {
    const plain = await customer();
    const verified = await customer('VERIFIED');
    await setSetting('giftcard.enabled', 0);
    await expect(submitCard(plain.id)).rejects.toBeInstanceOf(MoneyError);
    await setSetting('giftcard.enabled', null);

    await setSetting('giftcard.requireKyc', 1);
    await expect(submitCard(plain.id)).rejects.toMatchObject({ code: 'kyc_required' });
    await expect(submitCard(verified.id)).resolves.toBeTruthy();

    await setSetting('giftcard.requireKyc', null);
    await setSetting('giftcard.maxOpen', 1);
    await expect(submitCard(verified.id)).rejects.toMatchObject({ message: expect.stringContaining('Too many') });
  }, 60_000);
});

describe('business rules for crypto and gift cards', () => {
  const base = { purpose: 'ORDER' as const, amountBaisa: 50_000 };

  it('crypto is off by default, then follows the switches', async () => {
    const user = await customer('VERIFIED');
    const input = { ...base, userId: user.id };
    expect(await methodPolicyReason('CRYPTO', input)).toBe('disabled_by_admin');
    await setSetting('crypto.enabled', 1);
    expect(await methodPolicyReason('CRYPTO', input)).toBeNull();
    await setSetting('crypto.forOrders', 0);
    expect(await methodPolicyReason('CRYPTO', input)).toBe('disabled_by_admin');
    expect(await methodPolicyReason('CRYPTO', { ...input, purpose: 'TOPUP' })).toBeNull();
    await setSetting('crypto.forTopup', 0);
    expect(await methodPolicyReason('CRYPTO', { ...input, purpose: 'TOPUP' })).toBe('disabled_by_admin');
  });

  it('crypto requires a verified identity by default and respects the amount bounds', async () => {
    const plain = await customer();
    const verified = await customer('VERIFIED');
    await setSetting('crypto.enabled', 1);
    expect(await methodPolicyReason('CRYPTO', { ...base, userId: plain.id })).toBe('kyc_required');
    expect(await methodPolicyReason('CRYPTO', { ...base, userId: null })).toBe('login_required');
    await setSetting('crypto.requireKyc', 0);
    expect(await methodPolicyReason('CRYPTO', { ...base, userId: plain.id })).toBeNull();

    await setSetting('crypto.minPaymentBaisa', 20_000);
    await setSetting('crypto.maxPaymentBaisa', 80_000);
    expect(await methodPolicyReason('CRYPTO', { ...base, userId: verified.id, amountBaisa: 10_000 })).toBe('amount_below_minimum');
    expect(await methodPolicyReason('CRYPTO', { ...base, userId: verified.id, amountBaisa: 90_000 })).toBe('amount_above_maximum');
    expect(await methodPolicyReason('CRYPTO', { ...base, userId: verified.id, amountBaisa: 80_000 })).toBeNull();
  });

  it('the server refuses what the settings forbid, with the matching error', async () => {
    const plain = await customer();
    await expect(assertMethodAllowed('CRYPTO', { ...base, userId: plain.id })).rejects.toMatchObject({ code: 'method_unavailable' });
    await setSetting('crypto.enabled', 1);
    await expect(assertMethodAllowed('CRYPTO', { ...base, userId: plain.id })).rejects.toMatchObject({ code: 'kyc_required' });
    await setSetting('crypto.requireKyc', 0);
    await setSetting('crypto.maxPaymentBaisa', 10_000);
    await expect(assertMethodAllowed('CRYPTO', { ...base, userId: plain.id })).rejects.toMatchObject({ code: 'amount_above_maximum' });
  });

  it('the checkout list shows the reason, and the method only once an address is configured AND enabled', async () => {
    const user = await customer('VERIFIED');
    const keys = ['CRYPTO_ADDRESS_TRON', 'CRYPTO_ADDRESS_BSC', 'CRYPTO_ADDRESS_ETH'] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const crypto = async () => (await listPaymentMethods({ purpose: 'ORDER', amountBaisa: 50_000, userId: user.id })).find((m) => m.id === 'CRYPTO')!;
    try {
      for (const k of keys) delete process.env[k];
      expect(await crypto()).toMatchObject({ available: false, reason: 'not_configured' });
      process.env.CRYPTO_ADDRESS_BSC = '0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed'; // wrong checksum: ignored, never used
      expect(await crypto()).toMatchObject({ available: false, reason: 'not_configured' });
      process.env.CRYPTO_ADDRESS_BSC = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
      expect(await crypto()).toMatchObject({ available: false, reason: 'disabled_by_admin' });
      await setSetting('crypto.enabled', 1);
      expect(await crypto()).toMatchObject({ available: true });
      await setSetting('giftcard.enabled', 0);
      const gift = (await listPaymentMethods({ purpose: 'TOPUP', amountBaisa: 0, userId: user.id })).find((m) => m.id === 'GIFT_CARD')!;
      expect(gift).toMatchObject({ available: false, reason: 'disabled_by_admin' });
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it('wallet limits set here override the built-in defaults', async () => {
    expect((await getWalletLimits()).maxTopUpBaisa).toBe(500_000);
    await setSetting('wallet.maxTopUpBaisa', 300_000);
    await setSetting('wallet.minTopUpBaisa', 5_000);
    expect(await getWalletLimits()).toMatchObject({ minTopUpBaisa: 5_000, maxTopUpBaisa: 300_000, maxBalanceBaisa: 2_000_000 });
  });
});

describe('editing the settings (admin)', () => {
  const values = (v: Record<string, string>) => ({ section: 'giftcard' as const, values: v });

  it('converts what staff type: percent, OMR, switches, Arabic digits', () => {
    expect(parseFormValue('percent', '8')).toBe(800);
    expect(parseFormValue('percent', '12.5 %')).toBe(1_250);
    expect(parseFormValue('percent', '٨٫٥')).toBe(850);
    expect(parseFormValue('percent', '8.555')).toBe('invalid');
    expect(parseFormValue('omr', '1.500')).toBe(1_500);
    expect(parseFormValue('omr', '')).toBeNull();
    expect(parseFormValue('count', '12')).toBe(12);
    expect(parseFormValue('count', '-1')).toBe('invalid');
    expect(toFormValue('percent', 800)).toBe('8');
    expect(toFormValue('percent', 1_250)).toBe('12.5');
    expect(toFormValue('omr', 2_500)).toBe('2.500');
    expect(toFormValue('omr', null)).toBe('');
  });

  it('needs settings:write', async () => {
    const catalog = await staff('CATALOG');
    await expect(savePaymentSettings(catalog, values({ 'giftcard.feeBps': '5' }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(savePaymentSettings(null, values({ 'giftcard.feeBps': '5' }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getSettings())['giftcard.feeBps']).toBe(800);
  });

  it('saves, applies at once, audits only what changed, and an empty value restores the default', async () => {
    const admin = await staff('SUPERADMIN');
    const res = await savePaymentSettings(admin, values({ 'giftcard.feeBps': '10', 'giftcard.enabled': '1', 'giftcard.maxOpen': '3' }));
    expect(res).toMatchObject({ section: 'giftcard', changed: 2 }); // `enabled` was already 1
    const now = await getSettings();
    expect(now['giftcard.feeBps']).toBe(1_000);
    expect(now['giftcard.maxOpen']).toBe(3);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.payments.update', actorId: admin.id }, orderBy: { createdAt: 'desc' } });
    expect(audit.before).toEqual({ 'giftcard.feeBps': 800, 'giftcard.maxOpen': 5 });
    expect(audit.after).toEqual({ 'giftcard.feeBps': 1_000, 'giftcard.maxOpen': 3 });

    await savePaymentSettings(admin, values({ 'giftcard.feeBps': '' }));
    expect((await getSettings())['giftcard.feeBps']).toBe(800);
    expect(await prisma.setting.count({ where: { key: 'giftcard.feeBps' } })).toBe(0); // back to "unset"
    expect(await savePaymentSettings(admin, values({ 'giftcard.feeBps': '8' }))).toMatchObject({ changed: 0 });
  });

  it('rejects what is out of range, not a number, or inverted — and saves nothing', async () => {
    const admin = await staff('ADMIN');
    await expect(savePaymentSettings(admin, values({ 'giftcard.feeBps': '51', 'giftcard.maxOpen': '0' }))).rejects.toMatchObject({ fieldErrors: { 'giftcard.feeBps': ['out_of_range'], 'giftcard.maxOpen': ['out_of_range'] } });
    await expect(savePaymentSettings(admin, values({ 'giftcard.feeBps': 'abc' }))).rejects.toMatchObject({ fieldErrors: { 'giftcard.feeBps': ['number_invalid'] } });
    await expect(savePaymentSettings(admin, { section: 'crypto', values: { 'crypto.minPaymentBaisa': '50', 'crypto.maxPaymentBaisa': '10' } })).rejects.toMatchObject({ fieldErrors: { 'crypto.maxPaymentBaisa': ['range_inverted'] } });
    await expect(savePaymentSettings(admin, { section: 'wallet', values: { 'wallet.maxTopUpBaisa': '900', 'wallet.maxBalanceBaisa': '100' } })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.setting.count({ where: { key: { in: PAYMENT_KEYS } } })).toBe(0);
  });

  it('ignores keys outside the submitted section', async () => {
    const admin = await staff('ADMIN');
    expect(await savePaymentSettings(admin, values({ 'crypto.enabled': '1', 'tax.vatBps': '900' }))).toMatchObject({ changed: 0 });
    const s = await getSettings();
    expect(s['crypto.enabled']).toBe(0);
    expect(s['tax.vatBps']).toBe(500);
  });
});
