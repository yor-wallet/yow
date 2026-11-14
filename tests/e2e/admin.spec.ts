import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { addMuscatAddress, createCheckoutProduct, createCustomer, createDraftProduct, createStaff, placeUnpaidOrder, signIn } from './fixtures';
import { backButton, expectNoHorizontalOverflow, gotoReady, isDesktop, uniqueUser, useUniqueIp } from './helpers';

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page);
});

const tagOf = (testInfo: { project: { name: string }; workerIndex: number }) =>
  `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

test.describe('admin access', () => {
  test('visitors are sent to sign in, customers get a 404, staff get in', async ({ page, browser }, testInfo) => {
    await page.goto('/en/admin/products');
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fadmin%2Fproducts/);

    const customer = await createCustomer(uniqueUser(testInfo));
    const ctx = await browser.newContext();
    const customerPage = await ctx.newPage();
    await customerPage.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${Math.floor(Math.random() * 255)}.2.7` });
    await signIn(customerPage, customer.email, customer.password);
    expect((await customerPage.goto('/en/admin'))?.status()).toBe(404);
    expect((await customerPage.goto('/en/admin/products'))?.status()).toBe(404);
    expect((await customerPage.goto('/en/admin/orders/DM-2026-000001'))?.status()).toBe(404);
    await ctx.close();

    const staff = await createStaff(uniqueUser(testInfo), 'ADMIN');
    await signIn(page, staff.email, staff.password, '/admin');
    await expect(page.getByTestId('admin-shell')).toBeVisible();
    await expect(page.getByTestId('admin-title')).toHaveText('Overview');
  });

  test('the menu is a sidebar on desktop and a sheet on phones; the overview shows real numbers', async ({ page }, testInfo) => {
    const staff = await createStaff(uniqueUser(testInfo), 'ADMIN');
    await signIn(page, staff.email, staff.password, '/admin');
    await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' });
    for (const id of ['stat-revenue', 'stat-paid-orders', 'stat-orders-today', 'stat-unpaid', 'stat-active-products', 'stat-draft-products', 'stat-low-stock', 'stat-out-of-stock']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
    if (isDesktop(page)) {
      await expect(page.getByTestId('admin-sidebar')).toBeVisible();
      await expect(page.getByTestId('admin-menu')).toBeHidden();
      await page.getByTestId('admin-sidebar').getByTestId('admin-nav-products').click();
    } else {
      await expect(page.getByTestId('admin-sidebar')).toBeHidden();
      await page.getByTestId('admin-menu').click();
      await page.locator('[data-testid="admin-nav-products"]:visible').click();
    }
    await expect(page).toHaveURL(/\/en\/admin\/products$/);
    await expect(page.getByTestId('admin-title')).toHaveText('Products');
  });

  test('Arabic admin is right-to-left without horizontal overflow', async ({ page }, testInfo) => {
    const staff = await createStaff(uniqueUser(testInfo), 'ADMIN');
    await signIn(page, staff.email, staff.password, '/admin');
    await gotoReady(page, '/ar/admin/products');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('admin-shell')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await gotoReady(page, '/ar/admin/products/new');
    await expectNoHorizontalOverflow(page);
  });

  test('the import screen offers both photo packs, the owner one flagged "names to verify"', async ({ page }, testInfo) => {
    const staff = await createStaff(uniqueUser(testInfo), 'ADMIN');
    await signIn(page, staff.email, staff.password, '/admin');
    await gotoReady(page, '/en/admin/products/import');
    await expect(page.locator('[data-testid="visual-pack"][data-pack="iphone-visuals-2026"]')).toBeVisible();
    const owner = page.locator('[data-testid="visual-pack"][data-pack="doom-photos-2026-11"]');
    await expect(owner).toContainText("Owner's photos");
    await expect(owner).toContainText('14 models · 15 photos');
    await expect(owner).toContainText('names to verify');
    await gotoReady(page, '/ar/admin/products/import');
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('catalogue', () => {
  test('an administrator creates a product, adds a priced variant and an image, publishes it, and it shows in the store', async ({ page, browser }, testInfo) => {
    const staff = await createStaff(uniqueUser(testInfo), 'ADMIN');
    const tag = tagOf(testInfo);
    const name = `E2E SF Admin Created ${tag}`; // the slug is generated from the English name → e2e-sf-… (removed by the teardown)
    const slug = `e2e-sf-admin-created-${tag}`;
    const sku = `E2E-SF-ADM-${tag}`.toUpperCase();

    await signIn(page, staff.email, staff.password, '/admin/products');
    await expect(page.getByTestId('admin-title')).toHaveText('Products');
    await page.getByTestId('new-product').click();
    await expect(page.getByTestId('product-form')).toBeVisible();
    await expect(backButton(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Submitting an empty form explains what is missing (server validation), nothing is created.
    await page.getByTestId('field-sku').fill(sku);
    await page.getByTestId('field-category').selectOption(await page.getByTestId('field-category').locator('option', { hasText: 'Power banks' }).getAttribute('value'));
    await page.getByTestId('product-save').click();
    await expect(page.getByTestId('name-error')).toContainText('This field is required');

    await page.getByTestId('field-name-en').fill(name);
    await page.getByTestId('field-name-ar').fill('منتج إداري للاختبار');
    await page.getByTestId('add-spec').click();
    await page.locator('[name="specs.0.key"]').fill('color');
    await page.locator('[name="specs.0.label.en"]').fill('Colour');
    await page.locator('[name="specs.0.value.en"]').fill('Blue');
    await page.getByTestId('product-save').click();

    // → the edit page of the new DRAFT product
    await expect(page).toHaveURL(/\/en\/admin\/products\/[a-z0-9]+$/);
    await expect(page.getByTestId('admin-title')).toHaveText(name);
    await expect(page.getByTestId('status-bar')).toHaveAttribute('data-status', 'DRAFT');
    await expect(page.getByTestId('publish')).toBeDisabled(); // needs a variant first
    await expect(page.getByTestId('needs-variant')).toBeVisible();
    await expect(page.locator('[name="slug"]')).toHaveValue(slug);
    await expectNoHorizontalOverflow(page);

    // A variant with a real price and stock.
    await page.getByTestId('add-variant').click();
    const fresh = page.getByTestId('variant-new');
    await fresh.getByTestId('variant-sku').fill(`${sku}-A`);
    await fresh.getByTestId('variant-price').fill('129.5');
    await fresh.getByTestId('variant-stock').fill('7');
    await fresh.getByTestId('variant-save').click();
    await expect(page.getByTestId('variant-card')).toHaveCount(1);
    await expect(page.getByTestId('variant-card').getByTestId('variant-price')).toHaveValue('129.500');
    await expect(page.getByTestId('variant-card').getByTestId('variant-stock')).toHaveValue('7');
    await expect(page.getByTestId('publish')).toBeEnabled();

    // An image (checked by its real type, optimised on the server).
    const png = await sharp({ create: { width: 240, height: 240, channels: 3, background: '#3366cc' } }).png().toBuffer();
    await page.getByTestId('image-file').setInputFiles({ name: 'blue.png', mimeType: 'image/png', buffer: png });
    await page.locator('[name="alt.en"]').fill(`Blue test image ${tag}`);
    await page.getByTestId('image-upload').click();
    await expect(page.getByTestId('image-item')).toHaveCount(1);

    // Not visible to customers while it is a draft…
    const visitor = await browser.newContext();
    const vp = await visitor.newPage();
    await vp.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${Math.floor(Math.random() * 255)}.3.9` });
    expect((await vp.goto(`/en/product/${slug}`))?.status()).toBe(404);

    // …and live as soon as it is published.
    await page.getByTestId('publish').click();
    await expect(page.getByTestId('status-bar')).toHaveAttribute('data-status', 'ACTIVE');
    await expect(page.getByTestId('view-on-site')).toBeVisible();
    await gotoReady(vp, `/en/product/${slug}`);
    await expect(vp.getByTestId('product-title')).toHaveText(name);
    await expect(vp.getByTestId('product-price')).toContainText('129.500');
    await expect(vp.getByTestId('product-availability')).toContainText('In stock');
    const image = vp.getByRole('img', { name: `Blue test image ${tag}` }).first();
    await expect(image).toBeVisible();
    expect(await image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await visitor.close();

    // The list finds it by SKU, and the list filter lives in the URL.
    await gotoReady(page, `/en/admin/products?q=${tag}`);
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row')).toContainText('Published');
    await page.getByTestId('product-status-filter').selectOption('DRAFT');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/status=DRAFT/);
    await expect(page.getByTestId('product-row')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('the variant form explains invalid prices and stock, and keeps compare-at above the price', async ({ page }, testInfo) => {
    const staff = await createStaff(uniqueUser(testInfo), 'ADMIN');
    const product = await createDraftProduct(testInfo);
    await signIn(page, staff.email, staff.password, `/admin/products/${product.id}`);
    await page.getByTestId('add-variant').click();
    const fresh = page.getByTestId('variant-new');
    await fresh.getByTestId('variant-sku').fill(`${product.sku}-V`);

    await fresh.getByTestId('variant-price').fill('12.3456');
    await fresh.getByTestId('variant-save').click();
    await expect(fresh).toContainText('Enter an amount in OMR with at most 3 decimals');

    await fresh.getByTestId('variant-price').fill('50');
    await fresh.locator('[name="compareAt"]').fill('40');
    await fresh.getByTestId('variant-save').click();
    await expect(fresh).toContainText('The previous price must be higher than the price');

    await fresh.getByTestId('variant-stock').fill('');
    await fresh.locator('[name="compareAt"]').fill('60');
    await fresh.getByTestId('variant-save').click();
    // `required` on the stock box stops the browser form before the server is asked.
    expect(await fresh.getByTestId('variant-stock').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);

    await fresh.getByTestId('variant-stock').fill('3');
    await fresh.getByTestId('variant-save').click();
    await expect(page.getByTestId('variant-card')).toHaveCount(1);
    await expect(page.getByTestId('variant-card').locator('[name="compareAt"]')).toHaveValue('60.000');

    // A duplicate SKU is refused with a message on the field.
    await page.getByTestId('add-variant').click();
    const second = page.getByTestId('variant-new');
    await second.getByTestId('variant-sku').fill(`${product.sku}-V`);
    await second.getByTestId('variant-stock').fill('1');
    await second.getByTestId('variant-save').click();
    await expect(second).toContainText('This SKU is already used');
  });
});

test.describe('orders', () => {
  test('staff find an order by number and see its customer, items, totals and history; the page has a Back button', async ({ page }, testInfo) => {
    const product = await createCheckoutProduct(testInfo);
    const customer = await createCustomer(uniqueUser(testInfo));
    await addMuscatAddress(customer.id, customer.fullName);
    const number = await placeUnpaidOrder(customer.id, product.sku, 2);
    const staff = await createStaff(uniqueUser(testInfo), 'ADMIN');

    await signIn(page, staff.email, staff.password, '/admin/orders');
    await page.getByTestId('order-search').fill(number);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(new RegExp(`q=${number}`));
    await expect(page.getByTestId('order-row')).toHaveCount(1);
    await expect(page.getByTestId('order-row')).toContainText('Awaiting payment');
    await expect(page.getByTestId('order-row')).toContainText(customer.email);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('order-link').click();
    await expect(page.getByTestId('admin-title')).toContainText(number);
    await expect(page.getByTestId('order-items')).toContainText(product.name);
    await expect(page.getByTestId('order-item')).toContainText('2');
    await expect(page.getByTestId('admin-order-total')).toContainText('201.500'); // 2 × 100.000 + 1.500 standard delivery
    await expect(page.getByTestId('order-history')).toContainText('Awaiting payment');
    await expect(page.getByTestId('order-payments')).toHaveCount(0); // nothing was paid
    await expect(page.getByTestId('fulfilment-none')).toBeVisible(); // no delivery before the payment is confirmed
    await expectNoHorizontalOverflow(page);

    await expect(backButton(page)).toBeVisible();
    await backButton(page).click();
    await expect(page).toHaveURL(/\/en\/admin\/orders/);

    expect((await page.goto('/en/admin/orders/DM-0000-NOPE'))?.status()).toBe(404);
  });

  test('payment settings: three sections, crypto honest about its processor, errors explained, hidden from other staff', async ({ page }, testInfo) => {
    const staff = await createStaff(uniqueUser(testInfo), 'ADMIN');
    await signIn(page, staff.email, staff.password, '/admin/site/settings');
    await expect(page.getByTestId('admin-title')).toHaveText('Payments settings');
    for (const id of ['crypto', 'giftcard', 'wallet']) await expect(page.getByTestId(`ps-section-${id}`)).toBeVisible();
    await expect(page.getByTestId('crypto-processor')).toHaveText('No processor connected');
    await expect(page.getByTestId('ps-not-yet')).toContainText('Selling gift cards');
    await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' });
    await expectNoHorizontalOverflow(page);

    // The default commission is 8%; an out-of-range value is explained and nothing is saved.
    const fee = page.locator('input[name="giftcard.feeBps"]');
    await expect(fee).toHaveValue('8');
    await fee.fill('99');
    await page.getByTestId('ps-form-giftcard-submit').click();
    await expect(page.getByTestId('ps-section-giftcard')).toContainText('This value is out of range.');
    await page.reload();
    await expect(page.locator('input[name="giftcard.feeBps"]')).toHaveValue('8');

    const catalog = await createStaff(uniqueUser(testInfo), 'CATALOG');
    const other = await page.context().browser()!.newContext();
    const otherPage = await other.newPage();
    await otherPage.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${Math.floor(Math.random() * 255)}.3.9` });
    await signIn(otherPage, catalog.email, catalog.password, '/admin/products');
    expect((await otherPage.goto('/en/admin/site/settings'))?.status()).toBe(404);
    await other.close();
  });

  test('customers see the gift card commission before submitting a card', async ({ page }, testInfo) => {
    const customer = await createCustomer(uniqueUser(testInfo));
    await signIn(page, customer.email, customer.password, '/wallet/gift-card');
    await expect(page.getByTestId('giftcard-fee')).toContainText('8%');
    await expect(page.getByTestId('giftcard-paused')).toHaveCount(0);
  });

  test('a catalogue manager (no orders permission) sees only the catalogue', async ({ page }, testInfo) => {
    const staff = await createStaff(uniqueUser(testInfo), 'CATALOG');
    await signIn(page, staff.email, staff.password, '/admin/products');
    await expect(page.getByTestId('admin-title')).toHaveText('Products');
    expect((await page.goto('/en/admin/orders'))?.status()).toBe(404);
  });
});
