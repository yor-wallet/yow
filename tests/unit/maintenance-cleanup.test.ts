/**
 * Maintenance sweep (doom_test): allow-list only, preview deletes nothing, real run deletes exactly the
 * expired temporary rows, live rows survive, orphan image families only after the grace period,
 * the lease prevents overlap, re-running is safe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { SETTINGS, type SettingsMap } from '@/lib/admin/settings';
import { CLEANUP_TARGETS, imageFamilyRoot, runCleanup } from '@/lib/maintenance/cleanup';
import { __setStorageDriverForTests, type Bucket, type StorageDriver, type StoredObject } from '@/lib/storage';
import { cleanup, createProduct, createUser, RUN } from './shop/fixtures';

const NOW = new Date('2030-06-15T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const settings = Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [k, d.default])) as SettingsMap;
const tag = RUN.toLowerCase();

class ListingStorage implements StorageDriver {
  readonly name = 'memory-list';
  readonly files = new Map<string, Date>();
  async put(_b: Bucket, key: string, data: Buffer) {
    this.files.set(key, NOW);
    return { key, size: data.length };
  }
  async get() {
    return null;
  }
  async delete(_b: Bucket, key: string) {
    this.files.delete(key);
  }
  async exists(_b: Bucket, key: string) {
    return this.files.has(key);
  }
  publicUrl(key: string) {
    return `/media/${key}`;
  }
  async list(_b: Bucket, prefix: string): Promise<StoredObject[]> {
    return [...this.files].filter(([k]) => k.startsWith(prefix)).map(([key, updatedAt]) => ({ key, updatedAt }));
  }
}

const storage = new ListingStorage();
let userId: string;
let productId: string;
const ids = { sessions: [] as string[], attempts: [] as string[], idem: [] as string[], runs: [] as string[] };

beforeAll(async () => {
  __setStorageDriverForTests(storage);
  const u = await createUser();
  userId = u.id;
  const p = await createProduct({ variants: [{ priceBaisa: 100_000, stock: 3 }] });
  productId = p.id;

  const s = (name: string, expiresAt: Date, revokedAt: Date | null = null) => prisma.session.create({ data: { userId, tokenHash: `${tag}-${name}`, expiresAt, revokedAt } });
  ids.sessions = (await Promise.all([s('old-expired', days(40)), s('old-revoked', days(-5), days(45)), s('recent-expired', days(3)), s('live', days(-10))])).map((x) => x.id);

  const a = (createdAt: Date) => prisma.loginAttempt.create({ data: { identifier: `${tag}@test.doom.local`, success: false, createdAt } });
  ids.attempts = (await Promise.all([a(days(60)), a(days(2))])).map((x) => x.id);

  await prisma.rateLimit.createMany({ data: [{ key: `${tag}:old`, count: 3, resetAt: days(3) }, { key: `${tag}:live`, count: 1, resetAt: days(-1) }] });

  const i = (key: string, expiresAt: Date, status: 'IN_PROGRESS' | 'COMPLETED', lockedUntil: Date | null = null) =>
    prisma.idempotencyRecord.create({ data: { scope: `${tag}.test`, key, requestHash: 'h', status, expiresAt, lockedUntil } });
  ids.idem = (await Promise.all([i('old-done', days(20), 'COMPLETED'), i('old-locked', days(20), 'IN_PROGRESS', days(-1)), i('fresh', days(1), 'COMPLETED')])).map((x) => x.id);

  const r = (startedAt: Date, status: 'RUNNING' | 'SUCCEEDED') => prisma.agentRun.create({ data: { agentKey: `${tag}-agent`, status, startedAt } });
  const [oldRun, oldWithProposal, oldRunning, freshRun] = await Promise.all([r(days(200), 'SUCCEEDED'), r(days(200), 'SUCCEEDED'), r(days(200), 'RUNNING'), r(days(5), 'SUCCEEDED')]);
  await prisma.agentProposal.create({ data: { runId: oldWithProposal!.id, agentKey: `${tag}-agent`, title: 'keep me', details: {} } });
  ids.runs = [oldRun!.id, oldWithProposal!.id, oldRunning!.id, freshRun!.id];

  // Images: one attached family, one old orphan family, one fresh orphan (upload in progress), one foreign file.
  await prisma.productImage.create({ data: { productId, key: `products/${tag}/2030/01/used.webp`, width: 10, height: 10 } });
  for (const k of ['used.webp', 'used.avif', 'used-480.webp', 'orphan.webp', 'orphan.avif', 'orphan-480.avif']) storage.files.set(`products/${tag}/2030/01/${k}`, days(30));
  storage.files.set(`products/${tag}/2030/06/fresh.webp`, days(1));
  storage.files.set(`kyc/${tag}/doc.bin`, days(400));
});

afterAll(async () => {
  await prisma.agentProposal.deleteMany({ where: { agentKey: `${tag}-agent` } });
  await prisma.agentRun.deleteMany({ where: { agentKey: `${tag}-agent` } });
  await prisma.idempotencyRecord.deleteMany({ where: { scope: `${tag}.test` } });
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: `${tag}:` } } });
  await prisma.loginAttempt.deleteMany({ where: { identifier: `${tag}@test.doom.local` } });
  await prisma.auditLog.deleteMany({ where: { action: 'maintenance.cleanup' } });
  await prisma.setting.deleteMany({ where: { key: 'cleanup.lock' } });
  __setStorageDriverForTests(null);
  await cleanup();
  await prisma.$disconnect();
});

const mine = async () => ({
  sessions: await prisma.session.count({ where: { id: { in: ids.sessions } } }),
  attempts: await prisma.loginAttempt.count({ where: { id: { in: ids.attempts } } }),
  rate: await prisma.rateLimit.count({ where: { key: { startsWith: `${tag}:` } } }),
  idem: await prisma.idempotencyRecord.count({ where: { id: { in: ids.idem } } }),
  runs: await prisma.agentRun.count({ where: { id: { in: ids.runs } } }),
  files: storage.files.size,
});

describe('maintenance cleanup', () => {
  it('has an explicit allow-list that names no business data', () => {
    expect([...CLEANUP_TARGETS]).toEqual(['sessions', 'login_attempts', 'rate_limits', 'idempotency', 'agent_runs', 'orphan_images']);
    expect(imageFamilyRoot('products/x/2026/11/abcd-480.avif')).toBe('products/x/2026/11/abcd');
    expect(imageFamilyRoot('products/x/2026/11/abcd.webp')).toBe('products/x/2026/11/abcd');
  });

  it('preview counts and deletes nothing, takes no lease, writes no audit row', async () => {
    const before = await mine();
    const report = await runCleanup({ dryRun: true, now: NOW, settings });
    expect(report.dryRun).toBe(true);
    const by = Object.fromEntries(report.targets.map((t) => [t.target, t]));
    expect(by.sessions!.candidates).toBeGreaterThanOrEqual(2);
    expect(by.login_attempts!.candidates).toBeGreaterThanOrEqual(1);
    expect(by.rate_limits!.candidates).toBeGreaterThanOrEqual(1);
    expect(by.idempotency!.candidates).toBeGreaterThanOrEqual(1);
    expect(by.agent_runs!.candidates).toBeGreaterThanOrEqual(1);
    expect(by.orphan_images!.candidates).toBe(3);
    expect(report.targets.every((t) => t.deleted === 0 && !t.error)).toBe(true);
    expect(await mine()).toEqual(before);
    expect(await prisma.setting.count({ where: { key: 'cleanup.lock' } })).toBe(0);
  });

  it('a real run (tiny batches) removes exactly the expired temporary data and keeps everything else', async () => {
    const orders = await prisma.order.count();
    const products = await prisma.product.count();
    const report = await runCleanup({ dryRun: false, now: NOW, settings, batchSize: 2, maxBatches: 500 });
    expect(report.skipped).toBeUndefined();
    expect(report.targets.every((t) => !t.error)).toBe(true);

    expect((await prisma.session.findMany({ where: { id: { in: ids.sessions } }, select: { tokenHash: true } })).map((s) => s.tokenHash).sort()).toEqual([`${tag}-live`, `${tag}-recent-expired`]);
    expect(await prisma.loginAttempt.count({ where: { id: { in: ids.attempts } } })).toBe(1);
    expect((await prisma.rateLimit.findMany({ where: { key: { startsWith: `${tag}:` } } })).map((r) => r.key)).toEqual([`${tag}:live`]);
    expect((await prisma.idempotencyRecord.findMany({ where: { id: { in: ids.idem } }, select: { key: true } })).map((r) => r.key).sort()).toEqual(['fresh', 'old-locked']);
    // Old run without proposals goes; the run with a proposal, the RUNNING one and the fresh one stay.
    expect(await prisma.agentRun.count({ where: { id: { in: ids.runs } } })).toBe(3);
    expect(await prisma.agentProposal.count({ where: { agentKey: `${tag}-agent` } })).toBe(1);

    expect([...storage.files.keys()].sort()).toEqual(
      [`kyc/${tag}/doc.bin`, `products/${tag}/2030/01/used-480.webp`, `products/${tag}/2030/01/used.avif`, `products/${tag}/2030/01/used.webp`, `products/${tag}/2030/06/fresh.webp`].sort(),
    );
    expect(await prisma.order.count()).toBe(orders);
    expect(await prisma.product.count()).toBe(products);
    expect(await prisma.auditLog.count({ where: { action: 'maintenance.cleanup' } })).toBe(1);
  });

  it('is safe to re-run: the second run finds nothing of ours', async () => {
    const before = await mine();
    const report = await runCleanup({ dryRun: false, now: NOW, settings });
    expect(report.targets.find((t) => t.target === 'orphan_images')!.candidates).toBe(0);
    expect(await mine()).toEqual(before);
  });

  it('never overlaps: a run is skipped while another holds the lease', async () => {
    await prisma.setting.upsert({ where: { key: 'cleanup.lock' }, update: { value: { until: new Date(NOW.getTime() + 60_000).toISOString() } }, create: { key: 'cleanup.lock', value: { until: new Date(NOW.getTime() + 60_000).toISOString() } } });
    const report = await runCleanup({ dryRun: false, now: NOW, settings });
    expect(report).toMatchObject({ skipped: 'locked', targets: [] });
    // An expired lease (crashed run) is taken over.
    const later = await runCleanup({ dryRun: false, now: new Date(NOW.getTime() + 120_000), settings });
    expect(later.skipped).toBeUndefined();
  });
});

describe('scheduled entry point', () => {
  it('does nothing while cleanup.enabled is 0 (the default), and sweeps once it is 1', async () => {
    const { runScheduledCleanup } = await import('@/lib/maintenance/cleanup');
    expect(settings['cleanup.enabled']).toBe(0);
    expect(await runScheduledCleanup({ now: NOW, settings })).toEqual({ skipped: 'disabled' });
    await prisma.setting.deleteMany({ where: { key: 'cleanup.lock' } });
    const on = await runScheduledCleanup({ now: NOW, settings: { ...settings, 'cleanup.enabled': 1 } });
    expect(on).toMatchObject({ dryRun: false });
  });
});
