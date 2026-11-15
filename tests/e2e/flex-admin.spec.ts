import { expect, test } from '@playwright/test';
import { createCustomer, createFlexApplication, createStaff, signIn } from './fixtures';
import { expectNoHorizontalOverflow, gotoReady, uniqueUser, useUniqueIp } from './helpers';

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page);
});

test.describe('instalment (DOOM FLEX) applications decided by the finance team', () => {
  test('finance sees the application with its schedule, approves it, and the customer is asked to accept the terms', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    const application = createFlexApplication(customer.id, 'E2E-BETA', 6);
    const finance = await createStaff(uniqueUser(testInfo), 'FINANCE');
    await signIn(page, finance.email, finance.password, '/admin/finance/flex');
    await expect(page.getByTestId('admin-title')).toHaveText('Instalments (DOOM FLEX)');
    await expect(page.getByTestId('flex-tabs')).toBeVisible();

    await gotoReady(page, `/en/admin/finance/flex/${application.id}`);
    await expect(page.getByTestId('flex-status')).toHaveText('To decide');
    await expect(page.getByTestId('flex-customer')).toContainText(customer.email);
    await expect(page.getByTestId('flex-identity')).toHaveText('Validated');
    await expect(page.getByTestId('flex-application')).toContainText('6 months');
    // 200 OMR over 6 months: six instalments shown before anything is created.
    await expect(page.getByTestId('flex-schedule').locator('li')).toHaveCount(6);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('flex-form-submit').click();
    await expect(page.getByTestId('flex-status')).toHaveText('Approved — awaiting the customer');
    await expect(page.getByTestId('flex-outcome')).toContainText('A decision was already recorded.');

    // The customer now finds the approved application and the terms to accept.
    await page.context().clearCookies();
    await signIn(page, customer.email, customer.password, `/flex/${application.id}`);
    await expect(page.locator('body')).toContainText(/approved/i);
  });

  test('a refusal needs a note; staff without the finance right cannot open the applications', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    const application = createFlexApplication(customer.id, 'E2E-BETA', 3);
    const finance = await createStaff(uniqueUser(testInfo), 'FINANCE');
    await signIn(page, finance.email, finance.password, `/admin/finance/flex/${application.id}`);
    const form = page.getByTestId('flex-form');
    await form.locator('select[name="decision"]').selectOption('REJECTED');
    await page.getByTestId('flex-form-submit').click();
    await expect(form).toContainText('Write a short note');
    await form.locator('textarea[name="notes"]').fill('The requested amount is too high for a first plan.');
    await page.getByTestId('flex-form-submit').click();
    await expect(page.getByTestId('flex-status')).toHaveText('Refused');

    await page.context().clearCookies();
    const catalog = await createStaff(uniqueUser(testInfo), 'CATALOG');
    await signIn(page, catalog.email, catalog.password, '/admin/products');
    expect((await page.goto('/en/admin/finance/flex'))?.status()).toBe(404);
  });
});
