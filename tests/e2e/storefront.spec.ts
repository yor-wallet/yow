import { expect, test, type Page } from '@playwright/test';
import { backButton, expectNoHorizontalOverflow, gotoReady, isDesktop, pickCapacity, useUniqueIp } from './helpers';

const alpha = '/en/product/e2e-sf-alpha';

/** Open the brand filter UI that matches the form factor and tick `label`. */
async function pickBrand(page: Page, label: RegExp) {
  if (!isDesktop(page)) await page.getByTestId('open-filters').click();
  await page.getByRole('checkbox', { name: label }).filter({ visible: true }).click();
  // Immediately pressing "Show results" must still apply the filter (regression: the sheet's history entry raced the URL update).
  if (!isDesktop(page)) await page.getByTestId('show-results').click();
}

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page); // per-IP cart rate limits must not couple parallel tests
});

test.describe('home', () => {
  test('hero carousel: campaigns, dots, pause/play, no overflow', async ({ page }) => {
    await gotoReady(page, '/en');
    const carousel = page.getByTestId('hero-carousel');
    await expect(carousel).toBeVisible();
    const slides = carousel.getByTestId('hero-slide');
    await expect(slides).toHaveCount(7); // the seeded campaigns
    await expect(carousel.locator('[data-testid="hero-slide"][data-active="true"]')).toHaveCount(1);
    // Inactive slides are hidden from assistive technology and unfocusable.
    await expect(slides.nth(1)).toHaveAttribute('aria-hidden', 'true');

    await carousel.getByRole('button', { name: /Show slide 3/ }).click();
    await expect(slides.nth(2)).toHaveAttribute('data-active', 'true');
    await expect(slides.nth(2)).toHaveAttribute('aria-hidden', 'false');

    const toggle = page.getByTestId('carousel-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAccessibleName('Play the slideshow');

    await expectNoHorizontalOverflow(page);
  });

  test('sections follow the spec and show honest empty states, never fake products', async ({ page }) => {
    await gotoReady(page, '/en');
    for (const id of ['deals', 'smartphones', 'apple', 'samsung', 'honor', 'computers', 'audio', 'recommended']) {
      await expect(page.getByTestId(`rail-${id}`)).toBeAttached();
    }
    await expect(page.getByTestId('home-flex')).toBeAttached();
    await expect(page.getByTestId('home-express')).toBeAttached();
    await expect(page.getByTestId('home-reviews')).toBeAttached();
    await expect(page.getByTestId('home-support')).toBeAttached();
    // The FLEX illustration is computed (360 OMR → 120 / 60 / 30), 0% interest.
    await expect(page.getByTestId('home-flex')).toContainText('120.000');
    await expect(page.getByTestId('home-flex')).toContainText('30.000');
    await expectNoHorizontalOverflow(page);
  });

  test('reduced motion never leaves sections invisible', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await gotoReady(page, '/en');
    await expect(page.locator('#home-categories-title')).toBeVisible();
    await expect(page.getByTestId('home-flex')).toBeInViewport({ ratio: 0 }).catch(() => undefined);
    const opacity = await page.getByTestId('home-support').locator('> div').first().evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe('1');
    await context.close();
  });
});

test.describe('catalogue', () => {
  test('category page lists real products; brand filter lives in the URL', async ({ page }) => {
    await gotoReady(page, '/en/category/smartphones');
    const cards = page.getByTestId('product-card');
    await expect(cards.filter({ hasText: 'E2E Alpha Phone' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'E2E Beta Phone' })).toHaveCount(1);
    await expect(page.getByTestId('result-count')).toContainText('product');

    if (!isDesktop(page)) {
      // The sheet shows the live number of matches for the draft before it is applied.
      await page.getByTestId('open-filters').click();
      await page.getByRole('checkbox', { name: /Samsung/ }).filter({ visible: true }).click();
      await expect(page.getByTestId('show-results')).toContainText('2 results');
      await page.getByTestId('show-results').click();
    } else {
      await pickBrand(page, /Samsung/);
    }
    await expect(page).toHaveURL(/brand=samsung/);
    await expect(cards.filter({ hasText: 'E2E Beta Phone' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'E2E Alpha Phone' })).toHaveCount(0);
    await expect(page.getByTestId('active-filters')).toContainText('Samsung');
    await expectNoHorizontalOverflow(page);

    // Removing the chip restores the full list.
    await page.getByTestId('active-filters').getByRole('button', { name: /Remove filter: Samsung/ }).click();
    await expect(page).not.toHaveURL(/brand=/);
    await expect(cards.filter({ hasText: 'E2E Alpha Phone' })).toHaveCount(1);
  });

  test('sorting by price reorders the grid', async ({ page }) => {
    await gotoReady(page, '/en/category/smartphones?sort=price_desc');
    const first = page.getByTestId('product-card').filter({ hasText: /E2E (Alpha|Beta|Soldout|Unpriced) Phone/ }).first();
    await expect(first).toContainText('E2E Beta Phone'); // 200.000 is the most expensive of the fixtures
    await page.getByTestId('sort-select').selectOption('price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(page.getByTestId('product-card').filter({ hasText: /E2E (Alpha|Beta|Soldout|Unpriced) Phone/ }).first()).toContainText('E2E Soldout Phone');
  });

  test('search finds products in English and Arabic (hamza-insensitive) and explains an empty result', async ({ page }) => {
    await gotoReady(page, '/en/search?q=e2e%20alpha');
    await expect(page.getByTestId('product-card')).toHaveCount(1);
    await expect(page.getByTestId('search-title')).toContainText('e2e alpha');

    await gotoReady(page, `/ar/search?q=${encodeURIComponent('هاتف إي تو إي ألفا')}`);
    await expect(page.getByTestId('product-card')).toHaveCount(1);
    await gotoReady(page, `/ar/search?q=${encodeURIComponent('هاتف اي تو اي الفا')}`); // plain alef instead of hamza
    await expect(page.getByTestId('product-card')).toHaveCount(1);

    await gotoReady(page, '/en/search?q=zzzz-no-such-product');
    await expect(page.getByTestId('product-card')).toHaveCount(0);
    await expect(page.getByText('No result for “zzzz-no-such-product”')).toBeVisible();

    await gotoReady(page, '/en/search');
    await expect(page.getByTestId('search-title')).toHaveText('Browse the catalogue');
  });

  test('cards show only real prices and stock', async ({ page }) => {
    await gotoReady(page, '/en/category/smartphones');
    const card = (name: string) => page.getByTestId('product-card').filter({ hasText: name });
    await expect(card('E2E Alpha Phone')).toContainText('100.000');
    await expect(card('E2E Alpha Phone')).toContainText('From'); // two variants with different prices
    await expect(card('E2E Soldout Phone')).toContainText('Out of stock');
    await expect(card('E2E Soldout Phone').getByTestId('quick-add')).toHaveCount(0);
    await expect(card('E2E Unpriced Phone')).toContainText('Price coming soon');
    await expect(card('E2E Unpriced Phone').getByTestId('quick-add')).toHaveCount(0);
  });

  test('categories page lists the tree and unknown slugs give a 404', async ({ page }) => {
    await gotoReady(page, '/en/categories');
    await expect(page.getByRole('heading', { level: 2, name: 'Smartphones' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const res = await page.goto('/en/category/no-such-category');
    expect(res?.status()).toBe(404);
  });
});

test.describe('product page and cart', () => {
  test('choose a variant, add to cart, change the quantity and remove the line', async ({ page }) => {
    await gotoReady(page, alpha);
    await expect(page.getByTestId('product-title')).toHaveText('E2E Alpha Phone');
    const price = page.getByTestId('product-price');
    await expect(price).toContainText('100.000');
    await expect(page.getByTestId('product-availability')).toContainText('In stock');

    await pickCapacity(page, '256GB');
    await expect(price).toContainText('130.000');
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('add-to-cart').click();
    await expect(page.getByText('Added to cart').first()).toBeVisible();

    await gotoReady(page, '/en/cart');
    const lines = page.getByTestId('cart-line');
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText('256GB');
    await expect(page.getByTestId('cart-total')).toContainText('130.000');

    await page.getByRole('button', { name: /Increase quantity of E2E Alpha Phone/ }).click();
    await expect(page.getByTestId('cart-qty')).toHaveText('2');
    await expect(page.getByTestId('cart-total')).toContainText('260.000');
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('cart-remove').click();
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });

  test('stock is a hard limit: the quantity stops at the real availability', async ({ page }) => {
    await gotoReady(page, alpha);
    await pickCapacity(page, '256GB'); // stock 3
    if (isDesktop(page)) {
      const inc = page.getByRole('button', { name: 'Increase quantity' });
      for (let i = 0; i < 6; i++) if (await inc.isEnabled()) await inc.click();
      await expect(page.getByTestId('qty-value')).toHaveText('3');
      await expect(inc).toBeDisabled();
      return;
    }
    // Phones add one unit from the product page; the quantity is adjusted (and capped) in the cart.
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByText('Added to cart')).toBeVisible();
    await gotoReady(page, '/en/cart');
    const inc = page.getByRole('button', { name: /Increase quantity of E2E Alpha Phone/ });
    for (let i = 0; i < 6; i++) {
      if (!(await inc.isEnabled())) break;
      const before = await page.getByTestId('cart-qty').textContent();
      await inc.click();
      await expect(page.getByTestId('cart-qty')).not.toHaveText(before ?? '');
    }
    await expect(page.getByTestId('cart-qty')).toHaveText('3');
    await expect(inc).toBeDisabled();
  });

  test('sold-out and unpriced products cannot be bought', async ({ page }) => {
    await gotoReady(page, '/en/product/e2e-sf-soldout');
    await expect(page.getByTestId('add-to-cart')).toBeDisabled();
    if (isDesktop(page)) await expect(page.getByTestId('buy-now')).toBeDisabled(); // phones only show the pinned add-to-cart
    await expect(page.getByTestId('product-availability')).toContainText('Out of stock');

    await gotoReady(page, '/en/product/e2e-sf-noprice');
    await expect(page.getByText('Price not available yet')).toBeVisible();
    await expect(page.getByTestId('add-to-cart')).toBeDisabled();
  });

  test('unknown product gives a localized 404', async ({ page }) => {
    const res = await page.goto('/fr/product/no-such-product');
    expect(res?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  });

  test('compare: visitors are sent to sign in; the comparison page explains itself when signed out', async ({ page }) => {
    await gotoReady(page, alpha);
    await page.getByTestId('compare-toggle').click();
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    await gotoReady(page, '/en/compare');
    await expect(page.getByText('Sign in to compare')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('visitors are sent to sign in (and back) to use favourites', async ({ page }) => {
    await gotoReady(page, '/en/category/smartphones');
    await page.getByTestId('product-card').filter({ hasText: 'E2E Alpha Phone' }).getByTestId('favorite-toggle').click();
    await expect(page).toHaveURL(/\/en\/login\?next=/);
  });

  test('the product page is a good citizen: one h1, structured data without invented facts, RTL in Arabic', async ({ page }) => {
    await gotoReady(page, '/ar/product/e2e-sf-alpha');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('h1:visible')).toHaveCount(1);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}');
    expect(ld['@type']).toBe('Product');
    expect(ld.offers).toMatchObject({ priceCurrency: 'OMR', price: '100.000' });
    expect(ld.aggregateRating).toBeUndefined(); // no review exists, none is invented
    await gotoReady(page, '/en/product/e2e-sf-noprice');
    const noPrice = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}');
    expect(noPrice.offers).toBeUndefined(); // no price, so no offer
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('navigation', () => {
  test('Back from a product returns to the same filtered listing', async ({ page }) => {
    await gotoReady(page, '/en/category/smartphones?brand=apple');
    await page.getByTestId('product-card').filter({ hasText: 'E2E Alpha Phone' }).getByRole('link', { name: 'E2E Alpha Phone', exact: true }).click();
    await expect(page).toHaveURL(/\/en\/product\/e2e-sf-alpha$/);
    await backButton(page).click();
    await expect(page).toHaveURL(/\/en\/category\/smartphones\?brand=apple$/);
  });

  test('the mobile filter sheet is closed by the browser Back button', async ({ page }) => {
    test.skip(isDesktop(page), 'the filter sheet is a mobile/tablet control');
    await gotoReady(page, '/en/category/smartphones');
    await page.getByTestId('open-filters').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/\/en\/category\/smartphones$/);
  });
});
