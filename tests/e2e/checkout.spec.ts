import { expect, test, type Page } from '@playwright/test';
import { addMuscatAddress, createCheckoutProduct, createCustomer, fundWallet, orderByNumber, orderCount, placeUnpaidOrder, signIn, variantStock, walletBalance, type CheckoutProduct } from './fixtures';
import { PROMO_CODE } from './global-setup';
import { expectNoHorizontalOverflow, gotoReady, uniqueUser, useUniqueIp } from './helpers';

// Every test buys its OWN product (100.000 OMR, stock 20, see createCheckoutProduct): the tests run in
// parallel on several devices and must not compete for the same units.
async function addToCart(page: Page, product: CheckoutProduct) {
  await gotoReady(page, product.path);
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByText('Added to cart').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page);
});

test.describe('checkout', () => {
  test('wallet checkout: address, delivery, promo code, payment → a paid order (one order even on a double click)', async ({ page }, testInfo) => {
    const product = await createCheckoutProduct(testInfo);
    const user = await createCustomer(uniqueUser(testInfo));
    await addMuscatAddress(user.id, user.fullName);
    await fundWallet(user.id, 1_000_000);

    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/en\/account/);
    await addToCart(page, product);

    await gotoReady(page, '/en/checkout');
    await expect(page.getByTestId('address-option').first()).toHaveAttribute('aria-checked', 'true');
    // The cheapest AVAILABLE delivery option is chosen for the customer; fees come from the zone configuration.
    await expect(page.getByTestId('delivery-standard')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('delivery-standard')).toContainText('1.500');
    await expect(page.getByTestId('payment-wallet')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('checkout-total')).toContainText('101.500');
    // Methods that need a contract/credentials are shown disabled, with the reason, never faked.
    await expect(page.getByTestId('payment-card')).toBeDisabled();
    await expect(page.getByTestId('payment-card')).toContainText('Not available yet');
    await expectNoHorizontalOverflow(page);

    // A wrong code is explained; a right one reduces the total (10% of the products only).
    await page.getByTestId('promo-input').fill('NOT-A-CODE');
    await page.getByTestId('promo-apply').click();
    await expect(page.getByTestId('promo-status')).toContainText('not valid for your cart');
    await page.getByTestId('promo-input').fill(PROMO_CODE.toLowerCase());
    await page.getByTestId('promo-apply').click();
    await expect(page.getByTestId('promo-status')).toContainText('you save OMR 10.000');
    await expect(page.getByTestId('checkout-total')).toContainText('91.500');
    await expect(page).toHaveURL(new RegExp(`promo=${PROMO_CODE}`));

    await page.getByTestId('place-order').dblclick();
    await expect(page).toHaveURL(/\/en\/orders\/DM-[A-Z0-9-]+\?paid=1/);
    await expect(page.getByTestId('paid-banner')).toBeVisible();
    await expect(page.getByTestId('order-items')).toContainText(product.name);

    const number = (await page.getByTestId('order-number').innerText()).trim();
    const order = await orderByNumber(number);
    expect(order).toMatchObject({ status: 'PAID', totalBaisa: 91_500, subtotalBaisa: 100_000, discountBaisa: 10_000, deliveryFeeBaisa: 1_500, paymentMethod: 'WALLET' });
    expect(order.paymentIntents.filter((p) => p.status === 'SUCCEEDED')).toHaveLength(1);
    expect(await orderCount(user.id)).toBe(1); // the double click did not create a second order
    expect(await walletBalance(user.id)).toBe(1_000_000 - 91_500);

    // The cart was emptied by the order and the order shows up in the list.
    await gotoReady(page, '/en/cart');
    await expect(page.getByText('Your cart is empty')).toBeVisible();
    await gotoReady(page, '/en/orders');
    await expect(page.getByTestId('order-card')).toHaveCount(1);
    await expect(page.getByTestId('order-card')).toContainText(number);
    await expectNoHorizontalOverflow(page);
  });

  test('a wallet balance that is too low disables the method and the order button, with the reason', async ({ page }, testInfo) => {
    const product = await createCheckoutProduct(testInfo);
    const user = await createCustomer(uniqueUser(testInfo));
    await addMuscatAddress(user.id, user.fullName);
    await fundWallet(user.id, 50_000); // 50 OMR < 101.500
    await signIn(page, user.email, user.password);
    await addToCart(page, product);
    await gotoReady(page, '/en/checkout');
    await expect(page.getByTestId('payment-wallet')).toBeDisabled();
    await expect(page.getByTestId('payment-wallet')).toContainText('wallet balance is too low');
    await expect(page.getByTestId('place-order')).toBeDisabled();
    expect(await orderCount(user.id)).toBe(0);
  });

  test('visitors sign in first and their cart follows them; an empty cart explains itself', async ({ page }, testInfo) => {
    const product = await createCheckoutProduct(testInfo);
    const user = await createCustomer(uniqueUser(testInfo));
    await addMuscatAddress(user.id, user.fullName);
    await addToCart(page, product); // anonymous cart (cookie)
    await page.goto('/en/checkout');
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fcheckout/);
    await signIn(page, user.email, user.password, '/checkout');
    await expect(page).toHaveURL(/\/en\/checkout$/);
    await expect(page.getByTestId('checkout-summary')).toContainText(product.name);

    // Remove the line: the checkout page then says there is nothing to check out.
    await gotoReady(page, '/en/cart');
    await page.getByTestId('cart-remove').click();
    await expect(page.getByText('Your cart is empty')).toBeVisible();
    await gotoReady(page, '/en/checkout');
    await expect(page.getByText('Nothing to check out')).toBeVisible();
  });

  test('a customer without an address is asked for one, and delivery waits for it', async ({ page }, testInfo) => {
    const product = await createCheckoutProduct(testInfo);
    const user = await createCustomer(uniqueUser(testInfo));
    await signIn(page, user.email, user.password);
    await addToCart(page, product);
    await gotoReady(page, '/en/checkout');
    await expect(page.getByTestId('no-address')).toBeVisible();
    await expect(page.getByTestId('delivery-need-address')).toBeVisible();
    await expect(page.getByTestId('place-order')).toBeDisabled();
    await page.getByTestId('add-address').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack(); // the browser Back button closes the sheet first
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/\/en\/checkout$/);
  });
});

test.describe('address book', () => {
  test('governorate → wilaya → neighbourhood: the list follows the wilaya, "Other" lets the customer type it', async ({ page }, testInfo) => {
    const user = await createCustomer(uniqueUser(testInfo));
    await signIn(page, user.email, user.password);
    await gotoReady(page, '/en/account/addresses/new');
    const form = page.getByTestId('address-form');
    await form.locator('select[name="governorateId"]').selectOption({ label: 'Muscat' });
    await form.locator('select[name="wilayaId"]').selectOption({ label: 'As Seeb' });
    const hood = form.locator('select[name="neighborhoodId"]');
    await expect(hood).toBeVisible();
    await expect(form.locator('input[name="area"]')).toHaveCount(0);
    await hood.selectOption({ label: 'Al Mabelah South' });
    await form.locator('input[name="building"]').fill('Villa 12');
    await page.getByTestId('address-submit').click();
    await expect(page).toHaveURL(/\/en\/account\/addresses$/);
    await expect(page.getByText('Al Mabelah South').first()).toBeVisible();

    // "Other": the free-text field comes back.
    await gotoReady(page, '/ar/account/addresses/new');
    const ar = page.getByTestId('address-form');
    await ar.locator('select[name="governorateId"]').selectOption({ label: 'مسقط' });
    await ar.locator('select[name="wilayaId"]').selectOption({ label: 'السيب' });
    await ar.locator('select[name="neighborhoodId"]').selectOption('OTHER');
    await expect(ar.locator('input[name="area"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('orders', () => {
  test('an unpaid order keeps its stock reserved, can be paid later, and shows the reason when it cannot', async ({ page }, testInfo) => {
    const product = await createCheckoutProduct(testInfo);
    const user = await createCustomer(uniqueUser(testInfo));
    await addMuscatAddress(user.id, user.fullName);
    const before = await variantStock(product.sku);
    const number = await placeUnpaidOrder(user.id, product.sku, 2);
    expect((await variantStock(product.sku)).reserved).toBe(before.reserved + 2);

    await signIn(page, user.email, user.password);
    await gotoReady(page, `/en/orders/${number}`);
    await expect(page.getByTestId('pay-panel')).toBeVisible();
    await expect(page.getByTestId('pay-method-wallet')).toBeDisabled(); // nothing in the wallet yet
    await expect(page.getByTestId('pay-method-wallet')).toContainText('too low');
    await expect(page.getByTestId('pay-button')).toBeDisabled();

    await fundWallet(user.id, 500_000);
    await gotoReady(page, `/en/orders/${number}`);
    await page.getByTestId('pay-button').click();
    await expect(page).toHaveURL(/\?paid=1/);
    await expect(page.getByTestId('paid-banner')).toBeVisible();
    expect((await orderByNumber(number)).status).toBe('PAID');
    await expectNoHorizontalOverflow(page);
  });

  test('cancelling an unpaid order asks for confirmation and releases the reserved stock', async ({ page }, testInfo) => {
    const product = await createCheckoutProduct(testInfo);
    const user = await createCustomer(uniqueUser(testInfo));
    await addMuscatAddress(user.id, user.fullName);
    const before = await variantStock(product.sku);
    const number = await placeUnpaidOrder(user.id, product.sku, 1);
    expect((await variantStock(product.sku)).reserved).toBe(before.reserved + 1);

    await signIn(page, user.email, user.password);
    await gotoReady(page, `/en/orders/${number}`);
    await page.getByTestId('cancel-order').click();
    await expect(page.getByRole('dialog')).toContainText('Cancel this order?');
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('cancelled-notice')).toBeVisible();
    await expect(page.getByTestId('pay-panel')).toHaveCount(0);
    expect((await orderByNumber(number)).status).toBe('CANCELLED');
    expect((await variantStock(product.sku)).reserved).toBe(before.reserved);
  });

  test('orders are private: other customers and visitors get a 404 / the login page', async ({ page, browser }, testInfo) => {
    const product = await createCheckoutProduct(testInfo);
    const owner = await createCustomer(uniqueUser(testInfo));
    await addMuscatAddress(owner.id, owner.fullName);
    const number = await placeUnpaidOrder(owner.id, product.sku, 1);

    // A visitor is sent to sign in.
    await page.goto(`/en/orders/${number}`);
    await expect(page).toHaveURL(/\/en\/login\?next=/);

    // Another signed-in customer cannot see it.
    const other = await createCustomer(uniqueUser(testInfo));
    const ctx = await browser.newContext();
    const otherPage = await ctx.newPage();
    await otherPage.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${Math.floor(Math.random() * 255)}.1.9` });
    await signIn(otherPage, other.email, other.password);
    const res = await otherPage.goto(`/en/orders/${number}`);
    expect(res?.status()).toBe(404);
    expect((await otherPage.goto('/en/orders/not-an-order-number'))?.status()).toBe(404);
    await ctx.close();
  });
});
