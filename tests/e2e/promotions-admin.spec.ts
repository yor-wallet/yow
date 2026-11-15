import { expect, test } from '@playwright/test';
import { createStaff, signIn } from './fixtures';
import { expectNoHorizontalOverflow, gotoReady, uniqueUser, useUniqueIp } from './helpers';

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page);
});

/**
 * The promotions of these tests always carry a CODE: a coded promotion applies only when a customer
 * types it, so it cannot change the totals of the checkout tests running in parallel.
 */
const promoCode = () => `E2E${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

test.describe('promotion manager', () => {
  test('an administrator creates an offer, it appears as a coupon in the shop, then is switched off and deleted', async ({ page }, testInfo) => {
    const admin = await createStaff(uniqueUser(testInfo), 'ADMIN');
    const code = promoCode();
    const name = `Launch offer ${code}`;
    await signIn(page, admin.email, admin.password, '/admin/promotions');
    await expect(page.getByTestId('admin-title')).toHaveText('Promotions');
    await page.getByTestId('new-promotion').click();
    await expect(page).toHaveURL(/\/admin\/promotions\/new$/);

    const form = page.getByTestId('promotion-form');
    await form.locator('[name="name.en"]').fill(name);
    await form.locator('[name="name.ar"]').fill(`عرض الافتتاح ${code}`);
    await form.locator('[name="name.fr"]').fill(`Offre de lancement ${code}`);
    // A percentage that is almost certainly a typing mistake is refused.
    await form.locator('[name="percent"]').fill('95');
    await form.locator('[name="code"]').fill(code.toLowerCase());
    await page.getByTestId('promotion-form-submit').click();
    await expect(form).toContainText('Enter a percentage between 0.01 and 90.');

    await form.locator('[name="percent"]').fill('5');
    await form.locator('[name="maxDiscountBaisa"]').fill('10');
    await form.locator('[name="endsAt"]').fill('2031-01-01T00:00');
    await form.locator('[name="isActive"]').check();
    await page.getByTestId('promotion-form-submit').click();
    await expect(page).toHaveURL(/\/admin\/promotions\/[a-z0-9]+$/);
    await expect(page.getByTestId('promotion-state')).toHaveText('Live');
    await expect(page.locator('[name="code"]')).toHaveValue(code);
    await expectNoHorizontalOverflow(page);

    // In the shop: a coupon with the real value, the code, and the time left.
    await gotoReady(page, '/en/promotions');
    const ticket = page.getByTestId('promotion-ticket').filter({ hasText: name });
    await expect(ticket).toBeVisible();
    await expect(ticket.getByTestId('promotion-value')).toHaveText('-5%');
    await expect(ticket.getByTestId('promotion-code')).toHaveText(code);
    await expect(ticket.getByTestId('promo-countdown')).toBeVisible();
    await expect(ticket).toContainText('Discount capped at');
    await expectNoHorizontalOverflow(page);
    await gotoReady(page, '/ar/promotions');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('promotion-ticket').filter({ hasText: code })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Switched off: gone from the shop at once.
    await gotoReady(page, '/en/admin/promotions');
    const row = page.getByTestId('promotion-row').filter({ hasText: name });
    await expect(row.getByTestId('promotion-state')).toHaveText('Live');
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await expect(row.getByTestId('promotion-state')).toHaveText('Off');
    await gotoReady(page, '/en/promotions');
    await expect(page.getByTestId('promotion-ticket').filter({ hasText: name })).toHaveCount(0);

    // Never used: it can be deleted.
    await gotoReady(page, '/en/admin/promotions');
    await page.getByTestId('promotion-row').filter({ hasText: name }).getByRole('link').click();
    await page.getByTestId('promotion-delete').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/admin\/promotions$/);
    await expect(page.getByTestId('promotion-row').filter({ hasText: name })).toHaveCount(0);
  });

  test('staff without the promotions right cannot open the manager', async ({ page }, testInfo) => {
    const support = await createStaff(uniqueUser(testInfo), 'SUPPORT');
    await signIn(page, support.email, support.password, '/admin');
    expect((await page.goto('/en/admin/promotions'))?.status()).toBe(404);
  });
});
