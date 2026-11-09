import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { Page, TestInfo } from '@playwright/test';
import { TEST_DB } from './global-setup';

/**
 * Per-test helpers that need the database (customers, addresses, a funded wallet, unpaid orders).
 * Anything that runs project library code goes through `tests/e2e/support/tasks.ts` in a `tsx`
 * child process (real hashing, double-entry ledger, order placement); plain reads/writes use a
 * Prisma client bound to the TEST database.
 */
const db = new PrismaClient({ datasourceUrl: TEST_DB });
const TASKS = path.resolve(__dirname, 'support/tasks.ts');

function task<T>(payload: Record<string, unknown>): T {
  const out = execFileSync('npx', ['tsx', TASKS, JSON.stringify(payload)], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: TEST_DB, NODE_ENV: 'test' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as T;
}

export type Customer = { id: string; fullName: string; email: string; phone: string; password: string };

export async function createCustomer(c: { fullName: string; email: string; phone: string; password: string }): Promise<Customer> {
  const { id } = task<{ id: string }>({ task: 'createUser', ...c });
  return { ...c, id };
}

export type StaffRole = 'SUPPORT' | 'LOGISTICS' | 'FINANCE' | 'CATALOG' | 'ADMIN';

/** A staff account (role raised in the TEST database) for the admin screens. */
export async function createStaff(c: { fullName: string; email: string; phone: string; password: string }, role: StaffRole): Promise<Customer & { role: StaffRole }> {
  const { id } = task<{ id: string }>({ task: 'createStaff', role, ...c });
  return { ...c, id, role };
}

/** A DRAFT product with no variant, private to one test (for the admin form tests). Removed by the teardown (`e2e-sf-` slug). */
export async function createDraftProduct(testInfo: TestInfo): Promise<{ id: string; slug: string; sku: string; name: string }> {
  const uid = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const category = await db.category.findFirstOrThrow({ where: { slug: 'power-banks' } });
  const name = `E2E Draft Item ${uid}`;
  const slug = `e2e-sf-draft-${uid}`;
  const sku = `E2E-SF-DRAFT-${uid}`.toUpperCase();
  const p = await db.product.create({ data: { slug, sku, categoryId: category.id, name: { en: name, ar: name, fr: name }, status: 'DRAFT' } });
  return { id: p.id, slug, sku, name };
}

/** Credits the customer's wallet through a real, balanced ledger transaction. */
export async function fundWallet(userId: string, amountBaisa: number) {
  task({ task: 'fundWallet', userId, amountBaisa });
}

export async function walletBalance(userId: string): Promise<number> {
  return task<{ balanceBaisa: number }>({ task: 'walletBalance', userId }).balanceBaisa;
}

/** An UNPAID order (stock reserved for 15 min) created through the real `placeOrder`, like the checkout does. */
export async function placeUnpaidOrder(userId: string, variantSku: string, qty = 1): Promise<string> {
  return task<{ number: string }>({ task: 'placeUnpaidOrder', userId, variantSku, qty }).number;
}

/** A default delivery address in Muscat (the zone fixture gives it real fees). */
export async function addMuscatAddress(userId: string, recipientName = 'E2E Tester') {
  const gov = await db.governorate.findFirstOrThrow({ where: { code: 'MA' } });
  const wilaya = await db.wilaya.findFirstOrThrow({ where: { governorateId: gov.id, slug: 'ma-muscat' } });
  return db.address.create({
    data: { userId, label: 'Home', recipientName, phone: '+96891234567', governorateId: gov.id, wilayaId: wilaya.id, area: 'Qurum', building: '12', street: 'Way 100', isDefault: true },
  });
}

/** Signs in through the real form and waits until the session exists (the page left /login). */
export async function signIn(page: Page, email: string, password: string, next?: string) {
  await page.goto(`/en/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' });
  await page.getByLabel('Email').fill(email);
  // The label carries a required-field asterisk ("Password*"), so match it by regex; "Show password" is a button.
  await page.getByLabel(/^Password\s*\*?$/).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 20_000 });
}

export type CheckoutProduct = { slug: string; path: string; sku: string; name: string; priceBaisa: number };

/**
 * A product that belongs to ONE test (own SKU, plenty of stock), so tests that buy or reserve it never compete
 * with each other or with the shared storefront fixtures. It lives in a category/brand the storefront specs do
 * not look at, and the `e2e-sf-` slug prefix makes the global teardown remove it.
 */
export async function createCheckoutProduct(testInfo: TestInfo, opts: { stock?: number; priceBaisa?: number } = {}): Promise<CheckoutProduct> {
  const uid = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const category = await db.category.findFirstOrThrow({ where: { slug: 'power-banks' } });
  const brand = await db.brand.findFirstOrThrow({ where: { slug: 'anker' } });
  const priceBaisa = opts.priceBaisa ?? 100_000;
  const sku = `E2E-CO-${uid}`.toUpperCase();
  const slug = `e2e-sf-co-${uid}`;
  const name = 'E2E Checkout Charger';
  await db.product.create({
    data: {
      slug,
      sku: `E2E-SF-CO-${uid}`.toUpperCase(),
      categoryId: category.id,
      brandId: brand.id,
      name: { en: name, ar: 'شاحن إي تو إي للدفع', fr: name },
      description: { en: 'Test product used by the automated tests only.', ar: 'منتج اختباري يُستخدم في الاختبارات الآلية فقط.', fr: 'Produit de test utilisé uniquement par les tests automatisés.' },
      status: 'ACTIVE',
      publishedAt: new Date(),
      variants: { create: [{ sku, priceBaisa, stock: opts.stock ?? 20, isDefault: true, sort: 0 }] },
    },
  });
  return { slug, path: `/en/product/${slug}`, sku, name, priceBaisa };
}

export async function orderByNumber(number: string) {
  return db.order.findUniqueOrThrow({ where: { number }, include: { items: true, paymentIntents: true } });
}

export async function orderCount(userId: string): Promise<number> {
  return db.order.count({ where: { userId } });
}

export async function variantStock(sku: string) {
  return db.productVariant.findUniqueOrThrow({ where: { sku }, select: { stock: true, reserved: true } });
}
