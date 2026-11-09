/**
 * Tests that touch PostgreSQL (TEST_DATABASE_URL → doom_test, migrated + seeded).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { authenticate, createUser, LOGIN_MAX_FAILURES_PER_ACCOUNT } from '@/lib/auth/service';
import { verifyPassword } from '@/lib/auth/password';
import { IdempotencyError, stableStringify, withIdempotency } from '@/lib/idempotency';
import { rateLimit } from '@/lib/rate-limit';
import { logAudit, redact } from '@/lib/audit';
import { signToken, verifyToken } from '@/lib/auth/tokens';

const RUN = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = (s: string) => `${RUN}-${s}@test.doom.local`;
let phoneSeq = 0;
const phone = () => `9${String(Date.now() % 1_000_000).padStart(6, '0')}${phoneSeq++ % 10}`;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: RUN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.loginAttempt.deleteMany({ where: { identifier: { startsWith: RUN } } });
  await prisma.idempotencyRecord.deleteMany({ where: { scope: { startsWith: RUN } } });
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe('seed data', () => {
  it('has the 11 governorates, 61 wilayas and fee-less delivery zones', async () => {
    expect(await prisma.governorate.count()).toBe(11);
    expect(await prisma.wilaya.count()).toBe(61);
    const zones = await prisma.deliveryZone.findMany();
    expect(zones.length).toBeGreaterThanOrEqual(11);
    expect(zones.every((z) => z.standardFeeBaisa === null && z.expressFeeBaisa === null)).toBe(true);
  });

  it('contains no product, price or stock', async () => {
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.productVariant.count()).toBe(0);
  });
});

describe('auth service', () => {
  it('registers a customer with a bcrypt(12) hash and normalised fields', async () => {
    const res = await createUser({
      fullName: 'Test User',
      email: email('reg').toUpperCase(),
      phone: phone(),
      password: 'Password1234',
      confirmPassword: 'Password1234',
      acceptTerms: true,
      locale: 'en',
    });
    expect(res.ok).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: email('reg') } });
    expect(u.role).toBe('CUSTOMER');
    expect(u.phone).toMatch(/^\+968\d{8}$/);
    expect(u.passwordHash.startsWith('$2')).toBe(true);
    expect(u.passwordHash.split('$')[2]).toBe('12');
    expect(await verifyPassword('Password1234', u.passwordHash)).toBe(true);
  });

  it('rejects duplicate email with a field error', async () => {
    const base = { fullName: 'Dup', password: 'Password1234', confirmPassword: 'Password1234', acceptTerms: true };
    await createUser({ ...base, email: email('dup'), phone: phone() });
    const again = await createUser({ ...base, email: email('dup'), phone: phone() });
    expect(again).toMatchObject({ ok: false, error: 'email_taken' });
  });

  it('authenticates, rejects wrong passwords generically, and rate limits', async () => {
    await createUser({
      fullName: 'Login User',
      email: email('login'),
      phone: phone(),
      password: 'Password1234',
      confirmPassword: 'Password1234',
      acceptTerms: true,
    });
    const ok = await authenticate({ email: email('login'), password: 'Password1234' }, { ip: '10.0.0.1' });
    expect(ok.ok).toBe(true);

    const unknown = await authenticate({ email: email('nobody'), password: 'whatever123' });
    expect(unknown).toMatchObject({ ok: false, error: 'invalid_credentials' });

    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT; i++) {
      const bad = await authenticate({ email: email('login'), password: 'wrong-password-1' });
      expect(bad).toMatchObject({ ok: false, error: 'invalid_credentials' });
    }
    const blocked = await authenticate({ email: email('login'), password: 'Password1234' });
    expect(blocked).toMatchObject({ ok: false, error: 'rate_limited' });
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('refuses suspended accounts', async () => {
    await createUser({
      fullName: 'Suspended',
      email: email('susp'),
      phone: phone(),
      password: 'Password1234',
      confirmPassword: 'Password1234',
      acceptTerms: true,
    });
    await prisma.user.update({ where: { email: email('susp') }, data: { status: 'SUSPENDED' } });
    expect(await authenticate({ email: email('susp'), password: 'Password1234' })).toMatchObject({ ok: false, error: 'account_suspended' });
  });
});

describe('idempotency', () => {
  it('runs once, replays the stored result and rejects a different payload', async () => {
    let calls = 0;
    const opts = { scope: `${RUN}.order`, key: 'key-0000000000000001', request: { a: 1, b: [1, 2] } };
    const first = await withIdempotency(opts, async () => ({ id: ++calls }));
    const second = await withIdempotency({ ...opts, request: { b: [1, 2], a: 1 } }, async () => ({ id: ++calls }));
    expect(first).toEqual({ result: { id: 1 }, replayed: false });
    expect(second).toEqual({ result: { id: 1 }, replayed: true });
    expect(calls).toBe(1);
    await expect(withIdempotency({ ...opts, request: { a: 2 } }, async () => 1)).rejects.toBeInstanceOf(IdempotencyError);
  });

  it('a failed attempt can be retried', async () => {
    const opts = { scope: `${RUN}.pay`, key: 'key-0000000000000002' };
    await expect(withIdempotency(opts, async () => Promise.reject(new Error('provider down')))).rejects.toThrow('provider down');
    const retry = await withIdempotency(opts, async () => 'ok');
    expect(retry).toEqual({ result: 'ok', replayed: false });
  });

  it('concurrent duplicates: exactly one executes', async () => {
    let calls = 0;
    const opts = { scope: `${RUN}.race`, key: 'key-0000000000000003' };
    const run = () =>
      withIdempotency(opts, async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 50));
        return 'done';
      });
    const results = await Promise.allSettled([run(), run(), run()]);
    expect(calls).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  });

  it('stableStringify sorts keys', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('rate limit, audit, tokens', () => {
  it('fixed window counts atomically', async () => {
    const key = `${RUN}:rl`;
    const results = await Promise.all(Array.from({ length: 5 }, () => rateLimit(key, 3, 60_000)));
    expect(results.filter((r) => r.ok).length).toBe(3);
    expect(results.find((r) => !r.ok)?.retryAfterSec).toBeGreaterThan(0);
  });

  it('audit log redacts secrets', async () => {
    expect(redact({ email: 'a@b.c', passwordHash: 'x', nested: { otpHash: 'y', ok: 1 } })).toEqual({
      email: 'a@b.c',
      passwordHash: '[redacted]',
      nested: { otpHash: '[redacted]', ok: 1 },
    });
    const row = await logAudit({ action: `${RUN}.test`, entity: 'Test', after: { token: 'secret', v: 1 }, ip: null, userAgent: null });
    expect(row.after).toEqual({ token: '[redacted]', v: 1 });
    await prisma.auditLog.delete({ where: { id: row.id } });
  });

  it('signed tokens are purpose-bound', async () => {
    const tok = await signToken({ orderId: 'o1' }, { purpose: 'receipt', expiresIn: '5m' });
    expect((await verifyToken<{ orderId: string }>(tok, 'receipt'))?.orderId).toBe('o1');
    expect(await verifyToken(tok, 'other')).toBeNull();
    expect(await verifyToken(`${tok}x`, 'receipt')).toBeNull();
  });
});

describe('database safety constraints', () => {
  it('ledger transactions must balance (deferred trigger)', async () => {
    const [a, b] = await Promise.all([
      prisma.ledgerAccount.findUniqueOrThrow({ where: { code: 'PLATFORM_CASH' } }),
      prisma.ledgerAccount.findUniqueOrThrow({ where: { code: 'ADJUSTMENTS' } }),
    ]);
    await expect(
      prisma.$transaction(async (tx) => {
        const t = await tx.ledgerTransaction.create({
          data: { reference: `${RUN}-unbalanced`, type: 'ADJUSTMENT', idempotencyKey: `${RUN}-unbalanced` },
        });
        await tx.ledgerEntry.create({ data: { transactionId: t.id, accountId: a.id, amountBaisa: 1000 } });
        await tx.ledgerEntry.create({ data: { transactionId: t.id, accountId: b.id, amountBaisa: -999 } });
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(await prisma.ledgerTransaction.count({ where: { reference: `${RUN}-unbalanced` } })).toBe(0);
  });

  it('stock cannot go negative', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO "ProductVariant" ("id","productId","sku","stock","reserved","updatedAt") VALUES ('x','missing','x',-1,0,now())`,
    ).rejects.toThrow();
  });
});
