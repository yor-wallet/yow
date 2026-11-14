import { expect, test } from '@playwright/test';
import { createCryptoPayment, createCustomer, signIn } from './fixtures';
import { expectNoHorizontalOverflow, gotoReady, uniqueUser, useUniqueIp } from './helpers';

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page);
});

const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const BSC = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

test.describe('paying in USDT', () => {
  test('the pay page shows the exact amount and the address of the chosen network, and explains a bad transaction id', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    const payment = createCryptoPayment(customer.id);
    await signIn(page, customer.email, customer.password, `/pay/${payment.id}`);
    await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' });

    await expect(page.getByTestId('crypto-pay')).toBeVisible();
    await expect(page.getByTestId('crypto-amount')).toHaveText(`${payment.amountUsdt} USDT`);
    expect(payment.amountUsdt).toMatch(/^13\.\d{4}$/); // 5.000 OMR = 13.004 USD, rounded up to 13.01 + the payment's own offset

    // Tron first; the address follows the network the customer picks.
    await expect(page.getByTestId('crypto-address')).toHaveText(TRON);
    await page.getByTestId('crypto-network-BSC').check({ force: true });
    await expect(page.getByTestId('crypto-address')).toHaveText(BSC);
    await expect(page.getByTestId('crypto-pay')).toContainText('BNB Smart Chain (BEP20)');
    await page.getByTestId('crypto-network-TRON').check({ force: true });
    await expect(page.getByTestId('crypto-address')).toHaveText(TRON);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('crypto-tx-input').fill('not-a-transaction-id');
    await page.getByTestId('crypto-verify').click();
    await expect(page.getByTestId('crypto-error')).toHaveAttribute('data-code', 'invalid_input');
    await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'PENDING');
  });

  test("another customer cannot open someone else's payment, and the page is right-to-left in Arabic", async ({ page, browser }, testInfo) => {
    const owner = await createCustomer(uniqueUser(testInfo));
    const payment = createCryptoPayment(owner.id);
    const other = await createCustomer(uniqueUser(testInfo));
    await signIn(page, other.email, other.password, '/account');
    expect((await page.goto(`/en/pay/${payment.id}`))?.status()).toBe(404);

    const ctx = await browser.newContext();
    const ownerPage = await ctx.newPage();
    await ownerPage.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${Math.floor(Math.random() * 255)}.4.4` });
    await signIn(ownerPage, owner.email, owner.password, '/account');
    await gotoReady(ownerPage, `/ar/pay/${payment.id}`);
    await expect(ownerPage.getByTestId('crypto-pay')).toBeVisible();
    await expect(ownerPage.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(ownerPage.getByTestId('crypto-amount')).toHaveAttribute('dir', 'ltr');
    await expect(ownerPage.getByTestId('crypto-address')).toHaveAttribute('dir', 'ltr');
    await expectNoHorizontalOverflow(ownerPage);
    await ctx.close();
  });
});
