/**
 * Account confirmation by e-mail and identity verification by an administrator: the Brevo sender (never
 * faked when not configured), signed confirmation links, the "confirm your e-mail first" rule, the e-mail
 * every administrator gets for a new identity request, and the decision e-mail to the customer.
 * Runs against PostgreSQL (doom_test); created rows are removed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { isEmailConfigured, sendEmail } from '@/lib/email';
import { kycDecisionMessage, verifyEmailMessage } from '@/lib/email/templates';
import { confirmEmail, emailVerificationUrl, sendVerificationEmail } from '@/lib/auth/email-verification';
import { signToken } from '@/lib/auth/tokens';
import { notifyAdminsOfKycSubmission, notifyCustomerOfKycDecision } from '@/lib/kyc/emails';
import { KycError, submitKyc } from '@/lib/kyc';
import { cleanup, createUser } from './shop/fixtures';

const MAIL_ENV = { BREVO_API_KEY: 'test-key', MAIL_FROM: 'shop@example.test' };
const saved = { BREVO_API_KEY: process.env.BREVO_API_KEY, MAIL_FROM: process.env.MAIL_FROM };
const submissions: string[] = [];

function mailOn() {
  Object.assign(process.env, MAIL_ENV);
}
function mailOff() {
  delete process.env.BREVO_API_KEY;
  delete process.env.MAIL_FROM;
}
/** Captures what would be sent to Brevo. */
function captureBrevo() {
  const calls: { url: string; headers: Record<string, string>; body: { sender: { email: string }; to: { email: string; name?: string }[]; subject: string; htmlContent: string; textContent: string; tags: string[] } }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 201, json: async () => ({ messageId: `<m${calls.length}@test>` }) };
  });
  return calls;
}

beforeAll(mailOff);
afterEach(() => {
  vi.unstubAllGlobals();
  mailOff();
});
afterAll(async () => {
  Object.assign(process.env, saved);
  for (const k of ['BREVO_API_KEY', 'MAIL_FROM'] as const) if (saved[k] === undefined) delete process.env[k];
  await prisma.kycSubmission.deleteMany({ where: { id: { in: submissions } } });
  await cleanup();
  await prisma.$disconnect();
});

describe('sending e-mail', () => {
  it('is never faked: without a key and a sender nothing is sent', async () => {
    const calls = captureBrevo();
    expect(isEmailConfigured()).toBe(false);
    expect(await sendEmail(verifyEmailMessage({ locale: 'en', name: 'A', email: 'a@example.test', url: 'https://x.test' }))).toEqual({ ok: false, skipped: true });
    expect(calls).toHaveLength(0);
  });
  it('uses the Brevo transactional API and escapes every inserted value', async () => {
    mailOn();
    const calls = captureBrevo();
    const res = await sendEmail(verifyEmailMessage({ locale: 'ar', name: '<script>alert(1)</script>', email: 'a@example.test', url: 'https://doom.test/ar/verify-email?token=abc' }));
    expect(res).toEqual({ ok: true, id: '<m1@test>' });
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0]!.headers['api-key']).toBe('test-key');
    expect(calls[0]!.body.sender.email).toBe('shop@example.test');
    expect(calls[0]!.body.to).toEqual([{ email: 'a@example.test', name: '<script>alert(1)</script>' }]);
    expect(calls[0]!.body.htmlContent).not.toContain('<script>');
    expect(calls[0]!.body.htmlContent).toContain('&lt;script&gt;');
    expect(calls[0]!.body.htmlContent).toContain('dir="rtl"');
    expect(calls[0]!.body.textContent).toContain('https://doom.test/ar/verify-email?token=abc');
  });
  it('a provider failure is reported, not thrown', async () => {
    mailOn();
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sendEmail(verifyEmailMessage({ locale: 'en', name: 'A', email: 'a@example.test', url: 'https://x.test' }))).toEqual({ ok: false, skipped: false, error: 'http_401' });
    spy.mockRestore();
  });
});

describe('account confirmation by e-mail', () => {
  it('the link confirms the account once; confirming again is harmless', async () => {
    const u = await createUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const url = new URL(await emailVerificationUrl(user));
    const token = url.searchParams.get('token')!;
    expect(await confirmEmail(token)).toEqual({ ok: true, alreadyConfirmed: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).not.toBeNull();
    expect(await confirmEmail(token)).toEqual({ ok: true, alreadyConfirmed: true });
  });
  it('a tampered link, a link for another purpose, or a link sent to a previous address is refused', async () => {
    const u = await createUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const token = new URL(await emailVerificationUrl(user)).searchParams.get('token')!;
    expect(await confirmEmail(token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa'))).toEqual({ ok: false, error: 'invalid' });
    expect(await confirmEmail(await signToken({ eh: 'x' }, { purpose: 'kyc-doc', expiresIn: '1h', subject: u.id }))).toEqual({ ok: false, error: 'invalid' });
    expect(await confirmEmail('')).toEqual({ ok: false, error: 'invalid' });
    await prisma.user.update({ where: { id: u.id }, data: { email: `changed-${u.email}` } });
    expect(await confirmEmail(token)).toEqual({ ok: false, error: 'invalid' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).toBeNull();
  });
  it('the confirmation e-mail is sent only when e-mail is configured, and never to a confirmed account', async () => {
    const u = await createUser();
    expect(await sendVerificationEmail(u.id)).toEqual({ ok: false, skipped: true });
    mailOn();
    const calls = captureBrevo();
    expect(await sendVerificationEmail(u.id)).toMatchObject({ ok: true });
    expect(calls[0]!.body.to[0]!.email).toBe(u.email);
    expect(calls[0]!.body.textContent).toMatch(/\/verify-email\?token=/);
    await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
    expect(await sendVerificationEmail(u.id)).toEqual({ ok: false, skipped: false, error: 'already_verified' });
  });
  it('identity verification waits for a confirmed e-mail — only once e-mails can actually be sent', async () => {
    const u = await createUser();
    mailOn();
    await expect(submitKyc({ userId: u.id, fullName: 'Test Person', files: {} })).rejects.toMatchObject({ code: 'email_unverified' });
    mailOff(); // not configured: the rule cannot be met, so it is not enforced (the next rule answers)
    const err = await submitKyc({ userId: u.id, fullName: 'Test Person', files: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KycError);
    expect((err as KycError).code).not.toBe('email_unverified');
  });
});

describe('identity verification e-mails', () => {
  it('every administrator who can decide is told about a new request (never other staff), with a link and no document', async () => {
    const admin = await createUser();
    const superadmin = await createUser();
    const catalog = await createUser();
    const finance = await createUser();
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN', locale: 'en' } });
    await prisma.user.update({ where: { id: superadmin.id }, data: { role: 'SUPERADMIN', locale: 'ar' } });
    await prisma.user.update({ where: { id: catalog.id }, data: { role: 'CATALOG' } });
    await prisma.user.update({ where: { id: finance.id }, data: { role: 'FINANCE' } });
    const customer = await createUser();
    const sub = await prisma.kycSubmission.create({ data: { userId: customer.id, fullName: 'Salim <b>Test</b>', status: 'PENDING' } });
    submissions.push(sub.id);

    expect(await notifyAdminsOfKycSubmission(sub.id)).toMatchObject({ sent: 0 }); // not configured: nothing sent
    mailOn();
    const calls = captureBrevo();
    await notifyAdminsOfKycSubmission(sub.id);
    const to = calls.map((c) => c.body.to[0]!.email);
    expect(to).toContain(admin.email);
    expect(to).toContain(superadmin.email);
    expect(to).not.toContain(catalog.email);
    expect(to).not.toContain(finance.email);
    expect(to).not.toContain(customer.email);
    const mine = calls.find((c) => c.body.to[0]!.email === admin.email)!;
    expect(mine.body.subject).toContain('New identity verification');
    expect(mine.body.htmlContent).toContain(`/en/admin/kyc/${sub.id}`);
    expect(mine.body.htmlContent).not.toContain('<b>Test</b>');
    expect(calls.find((c) => c.body.to[0]!.email === superadmin.email)!.body.htmlContent).toContain(`/ar/admin/kyc/${sub.id}`);
  });

  it('the customer is told about the decision, with the reason when refused', async () => {
    const customer = await createUser();
    const sub = await prisma.kycSubmission.create({ data: { userId: customer.id, fullName: 'Test Person', status: 'REJECTED', reviewNote: 'Photo floue <i>', rejectionReason: 'Photo floue <i>' } });
    submissions.push(sub.id);
    mailOn();
    const calls = captureBrevo();
    expect(await notifyCustomerOfKycDecision(sub.id)).toBe(true);
    expect(calls[0]!.body.to[0]!.email).toBe(customer.email);
    expect(calls[0]!.body.htmlContent).toContain('Photo floue &lt;i&gt;');
    expect(calls[0]!.body.tags).toEqual(['kyc-rejected']);
    // Still pending: nothing to tell.
    const pending = await prisma.kycSubmission.create({ data: { userId: customer.id, fullName: 'Test Person', status: 'PENDING' } });
    submissions.push(pending.id);
    expect(await notifyCustomerOfKycDecision(pending.id)).toBe(false);
  });

  it('decision e-mails exist in the three languages, and a validation shows no reason', () => {
    for (const locale of ['ar', 'en', 'fr']) {
      const m = kycDecisionMessage({ locale, email: 'c@example.test', name: 'C', decision: 'VERIFIED', note: 'internal', url: 'https://x.test' });
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.html).not.toContain('internal');
    }
  });
});
