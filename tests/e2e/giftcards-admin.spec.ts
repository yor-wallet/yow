import { expect, test } from '@playwright/test';
import { createCustomer, createGiftCard, createStaff, signIn, walletBalance } from './fixtures';
import { expectNoHorizontalOverflow, gotoReady, uniqueUser, useUniqueIp } from './helpers';

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page);
});

const cardCode = () => `E2E${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

test.describe('gift cards verified by the finance team', () => {
  test('finance opens a card, sees the code on demand, verifies it and the wallet gets the value minus the commission', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    const code = cardCode();
    const card = createGiftCard(customer.id, code, '100');
    const finance = await createStaff(uniqueUser(testInfo), 'FINANCE');
    await signIn(page, finance.email, finance.password, '/admin/finance/gift-cards');
    await expect(page.getByTestId('admin-title')).toHaveText('Gift cards');
    await expect(page.getByTestId('giftcards-tabs')).toBeVisible();

    await gotoReady(page, `/en/admin/finance/gift-cards/${card.id}`);
    await expect(page.getByTestId('giftcard-customer')).toContainText(customer.email);
    await expect(page.getByTestId('giftcard-status')).toHaveText('To verify');
    await expect(page.getByTestId('giftcard-card')).toContainText('100.000 OMR');
    // The code is not in the page until the reviewer asks for it.
    await expect(page.locator('body')).not.toContainText(code);
    await page.getByTestId('giftcard-reveal').click();
    await expect(page.getByTestId('giftcard-code-value')).toHaveText(code);
    await expectNoHorizontalOverflow(page);

    // Verifying needs the value actually encashed.
    const form = page.getByTestId('giftcard-form');
    await page.getByTestId('giftcard-form-submit').click();
    await expect(form).toContainText('Enter the value actually encashed.');
    await expect(page.getByTestId('giftcard-status')).toHaveText('To verify');
    expect(await walletBalance(customer.id)).toBe(0);

    await form.locator('input[name="encashedValue"]').fill('100');
    await page.getByTestId('giftcard-form-submit').click();
    await expect(page.getByTestId('giftcard-status')).toHaveText('Verified and credited');
    await expect(page.getByTestId('giftcard-credited')).toContainText('92.000');
    await expect(page.getByTestId('giftcard-outcome')).toContainText('A decision was already recorded.');
    // 100 OMR encashed, 8% exchange commission kept.
    expect(await walletBalance(customer.id)).toBe(92_000);
  });

  test('a refusal needs a note and credits nothing', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    const card = createGiftCard(customer.id, cardCode(), '25');
    const finance = await createStaff(uniqueUser(testInfo), 'FINANCE');
    await signIn(page, finance.email, finance.password, `/admin/finance/gift-cards/${card.id}`);
    const form = page.getByTestId('giftcard-form');
    await form.locator('select[name="decision"]').selectOption('REJECTED');
    await page.getByTestId('giftcard-form-submit').click();
    await expect(form).toContainText('Write a short note');
    await form.locator('textarea[name="notes"]').fill('The code was already used.');
    await page.getByTestId('giftcard-form-submit').click();
    await expect(page.getByTestId('giftcard-status')).toHaveText('Refused');
    expect(await walletBalance(customer.id)).toBe(0);
  });

  test('staff without the finance right cannot open gift cards', async ({ page }, testInfo) => {
    const catalog = await createStaff(uniqueUser(testInfo), 'CATALOG');
    await signIn(page, catalog.email, catalog.password, '/admin/products');
    expect((await page.goto('/en/admin/finance/gift-cards'))?.status()).toBe(404);
    expect((await page.goto('/api/admin/gift-cards/nope/image'))?.status()).toBe(403);
  });
});

test.describe('identity required for crypto', () => {
  test('the top-up page says why crypto is locked and leads to the verification', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    await signIn(page, customer.email, customer.password, '/wallet/top-up');
    const crypto = page.getByTestId('topup-method-CRYPTO');
    await expect(crypto).toBeVisible();
    // Only meaningful when the test server offers crypto with the identity rule (the default).
    test.skip((await crypto.getAttribute('data-available')) === 'true' || !(await crypto.textContent())?.includes('Verify your identity'), 'crypto is not locked by identity on this server');
    await expect(page.getByTestId('kyc-required-notice')).toBeVisible();
    await page.getByTestId('kyc-required-cta').click();
    await expect(page).toHaveURL(/\/account\/verification/);
  });
});
