/**
 * Gift cards handled by the finance team: what the admin screens read (never the code or the storage key),
 * the e-mail every reviewer gets for a new card, and the decision e-mail to the customer.
 * Runs against PostgreSQL (doom_test).
 *
 * The ledger is append-only, so the customers and reviewers of the credited cards stay in doom_test —
 * uniquely named (`gcadmin-…`), balanced, and harmless.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { formatDeclaredValue, getGiftCardForAdmin, giftCardCounts, listGiftCardsForAdmin } from '@/lib/admin/gift-cards';
import { giftCardBrandLabel } from '@/lib/payments/giftcard-brands';
import { notifyCustomerOfGiftCardDecision, notifyStaffOfGiftCard } from '@/lib/payments/giftcard-emails';
import { reviewGiftCard, submitGiftCard } from '@/lib/payments/giftcards';
import { RUN } from './shop/fixtures';

const MAIL_ENV = { BREVO_API_KEY: 'test-key', MAIL_FROM: 'shop@example.test', APP_URL: 'https://shop.example.test' };
const saved = { BREVO_API_KEY: process.env.BREVO_API_KEY, MAIL_FROM: process.env.MAIL_FROM, APP_URL: process.env.APP_URL };
let seq = 0;

type Role = 'CUSTOMER' | 'FINANCE' | 'ADMIN' | 'SUPPORT';
async function keptUser(role: Role = 'CUSTOMER', status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  const n = ++seq;
  return prisma.user.create({
    data: { email: `gcadmin-${RUN.toLowerCase()}-${n}@test.doom.local`, fullName: `Gift Card Tester ${n}`, passwordHash: 'x'.repeat(60), role, status, locale: 'en', phone: `+9687${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}` },
    select: { id: true, email: true, fullName: true },
  });
}

async function submitCard(userId: string, value = '100') {
  const code = `G${randomBytes(6).toString('hex').toUpperCase()}`;
  const res = await submitGiftCard({ userId, data: { brand: 'GOOGLE_PLAY', code, currency: 'OMR', value } });
  return { id: res.id, code };
}

type Sent = { to: string; subject: string; html: string; text: string; tags: string[] };
function captureBrevo(): Sent[] {
  const calls: Sent[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as { to: { email: string }[]; subject: string; htmlContent: string; textContent: string; tags: string[] };
    calls.push({ to: b.to[0]!.email, subject: b.subject, html: b.htmlContent, text: b.textContent, tags: b.tags });
    return { ok: true, status: 201, json: async () => ({ messageId: `<m${calls.length}@test>` }) };
  });
  return calls;
}

beforeAll(() => {
  Object.assign(process.env, MAIL_ENV);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await prisma.$disconnect();
});

describe('gift cards: what the admin screens read', () => {
  it('formats the value printed on the card and the brand name', () => {
    expect(formatDeclaredValue(2550, 'USD')).toBe('25.50 USD');
    expect(formatDeclaredValue(25_000, 'OMR')).toBe('25.000 OMR');
    expect(formatDeclaredValue(5, 'USD')).toBe('0.05 USD');
    expect(giftCardBrandLabel('GOOGLE_PLAY', 'Other')).toBe('Google Play');
    expect(giftCardBrandLabel('OTHER', 'Other brand')).toBe('Other brand');
  });

  it('lists a new card under "to verify" and never exposes the code or the storage key', async () => {
    const user = await keptUser();
    const { id, code } = await submitCard(user.id, '40');
    const before = await giftCardCounts();
    expect(before.SUBMITTED).toBeGreaterThanOrEqual(1);
    const row = (await listGiftCardsForAdmin('SUBMITTED', 200)).find((c) => c.id === id);
    expect(row).toMatchObject({ brand: 'GOOGLE_PLAY', declaredValue: 40_000, declaredCurrency: 'OMR', codeLast4: code.slice(-4) });
    const detail = await getGiftCardForAdmin(id);
    expect(detail).toMatchObject({ status: 'SUBMITTED', hasImage: false, commissionBaisa: null, user: { email: user.email } });
    expect(JSON.stringify(detail)).not.toContain(code);
    expect(detail).not.toHaveProperty('imageKey');
    expect(detail).not.toHaveProperty('codeEncrypted');
    expect(await getGiftCardForAdmin('../etc')).toBeNull();
    expect(await getGiftCardForAdmin('unknown-id')).toBeNull();
  }, 60_000);

  it('shows the commission kept once the card is verified', async () => {
    const user = await keptUser();
    const reviewer = await keptUser('FINANCE');
    const { id } = await submitCard(user.id);
    await reviewGiftCard({ id, decision: 'VERIFIED', encashedValueBaisa: 100_000, reviewerId: reviewer.id });
    expect(await getGiftCardForAdmin(id)).toMatchObject({ status: 'VERIFIED', encashedValueBaisa: 100_000, commissionBaisa: 8_000, feeBpsApplied: 800, reviewedBy: { fullName: reviewer.fullName } });
    expect((await listGiftCardsForAdmin('VERIFIED', 200)).some((c) => c.id === id)).toBe(true);
  }, 60_000);
});

describe('gift cards: e-mails', () => {
  it('tells every active reviewer about a new card, with a link and never the code', async () => {
    const user = await keptUser();
    const finance = await keptUser('FINANCE');
    const admin = await keptUser('ADMIN');
    const support = await keptUser('SUPPORT');
    const suspended = await keptUser('FINANCE', 'SUSPENDED');
    const { id, code } = await submitCard(user.id);
    const calls = captureBrevo();
    const res = await notifyStaffOfGiftCard(id);
    const to = calls.map((c) => c.to);
    expect(to).toContain(finance.email);
    expect(to).toContain(admin.email);
    expect(to).not.toContain(support.email);
    expect(to).not.toContain(suspended.email);
    expect(to).not.toContain(user.email);
    expect(res.sent).toBe(calls.length);
    const mine = calls.find((c) => c.to === finance.email)!;
    expect(mine.subject).toContain(user.fullName);
    expect(mine.html).toContain('Google Play');
    expect(mine.html).toContain(`https://shop.example.test/en/admin/finance/gift-cards/${id}`);
    expect(mine.tags).toEqual(['giftcard-submitted-admin']);
    for (const c of calls) expect(c.html + c.text + c.subject).not.toContain(code);
    expect(await notifyStaffOfGiftCard('unknown')).toEqual({ sent: 0, skipped: 0 });
  }, 60_000);

  it('tells the customer what was added to the wallet, or why the card was refused; nothing while it is open', async () => {
    const user = await keptUser();
    const reviewer = await keptUser('FINANCE');
    const a = await submitCard(user.id);
    let calls = captureBrevo();
    expect(await notifyCustomerOfGiftCardDecision(a.id)).toBe(false); // still open
    expect(calls).toHaveLength(0);

    await reviewGiftCard({ id: a.id, decision: 'VERIFIED', encashedValueBaisa: 100_000, reviewerId: reviewer.id });
    expect(await notifyCustomerOfGiftCardDecision(a.id)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: user.email, tags: ['giftcard-decision'] });
    expect(calls[0]!.text).toContain('92.000'); // credited: 100 minus 8%
    expect(calls[0]!.text).toContain('8.000'); // commission kept
    expect(calls[0]!.html).toContain('https://shop.example.test/en/wallet');
    expect(calls[0]!.html + calls[0]!.text).not.toContain(a.code);

    const b = await submitCard(user.id);
    await reviewGiftCard({ id: b.id, decision: 'REJECTED', notes: 'Already used <b>code</b>', reviewerId: reviewer.id });
    calls = captureBrevo();
    expect(await notifyCustomerOfGiftCardDecision(b.id)).toBe(true);
    expect(calls[0]!.text).toContain('Already used');
    expect(calls[0]!.html).toContain('Already used &lt;b&gt;code&lt;/b&gt;'); // the note is escaped
    expect(calls[0]!.html).not.toContain('92.000');
  }, 60_000);
});
