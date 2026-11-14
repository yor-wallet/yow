import { expect, test } from '@playwright/test';
import { createCustomer, createKycRequest, createStaff, emailVerifyPath, signIn } from './fixtures';
import { expectNoHorizontalOverflow, gotoReady, uniqueUser, useUniqueIp } from './helpers';

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page);
});

test.describe('identity verification by an administrator', () => {
  test('an administrator opens a request, must explain a refusal, and the decision is recorded', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    const request = createKycRequest(customer.id, `KYC ${customer.fullName}`);
    const admin = await createStaff(uniqueUser(testInfo), 'ADMIN');
    await signIn(page, admin.email, admin.password, '/admin/kyc');
    await expect(page.getByTestId('admin-title')).toHaveText('Identity verifications');
    await expect(page.getByTestId('kyc-tabs')).toBeVisible();

    await gotoReady(page, `/en/admin/kyc/${request.id}`);
    await expect(page.getByTestId('kyc-customer')).toContainText(customer.email);
    await expect(page.getByTestId('kyc-status')).toHaveText('To review');
    await expectNoHorizontalOverflow(page);

    const form = page.getByTestId('kyc-form');
    await form.locator('select[name="decision"]').selectOption('REJECTED');
    await page.getByTestId('kyc-form-submit').click();
    await expect(form).toContainText('Write a message to the customer');
    await expect(page.getByTestId('kyc-status')).toHaveText('To review');

    await form.locator('textarea[name="notes"]').fill('The photo of the card is blurred.');
    await page.getByTestId('kyc-form-submit').click();
    await expect(page.getByTestId('kyc-status')).toHaveText('Refused');
    await expect(page.getByTestId('kyc-decision')).toContainText('A decision was already recorded.');
  });

  test('other staff cannot open identity requests', async ({ page }, testInfo) => {
    const catalog = await createStaff(uniqueUser(testInfo), 'CATALOG');
    await signIn(page, catalog.email, catalog.password, '/admin/products');
    expect((await page.goto('/en/admin/kyc'))?.status()).toBe(404);
  });
});

test.describe('account confirmation by e-mail', () => {
  test('the link from the e-mail confirms the account; a broken link says so', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    await gotoReady(page, `/en${emailVerifyPath(customer.id)}`);
    await expect(page.getByTestId('verify-email')).toHaveAttribute('data-result', 'ok');
    await expect(page.getByTestId('verify-email')).toContainText('Your e-mail is confirmed');
    await gotoReady(page, '/en/verify-email?token=broken');
    await expect(page.getByTestId('verify-email')).toHaveAttribute('data-result', 'invalid');
    await gotoReady(page, `/ar${emailVerifyPath(customer.id)}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('verify-email')).toHaveAttribute('data-result', 'ok');
  });
});
