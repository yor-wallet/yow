import { expect, test } from '@playwright/test';
import { LOCALES, expectNoHorizontalOverflow, gotoReady, isDesktop } from './helpers';

for (const locale of LOCALES) {
  test(`home loads in ${locale} with correct lang/dir, chrome and no overflow`, async ({ page }) => {
    const res = await page.goto(`/${locale}`);
    expect(res?.status()).toBe(200);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', locale);
    await expect(html).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page).toHaveTitle(/DOOM \| دوم/);

    // Official logo in the visible header, with fixed dimensions.
    const header = isDesktop(page) ? page.getByTestId('desktop-header') : page.getByTestId('mobile-header');
    await expect(header).toBeVisible();
    const logo = header.locator('img[alt="DOOM | دوم"]');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('data-logo-surface', 'dark');
    const box = await logo.boundingBox();
    expect(box?.height).toBeCloseTo(38, 0);
    expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    // Primary navigation per form factor.
    if (isDesktop(page)) {
      await expect(page.getByTestId('bottom-nav')).toBeHidden();
      await expect(page.locator('[data-testid="desktop-header"] nav').first()).toBeVisible();
    } else {
      const nav = page.getByTestId('bottom-nav');
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link')).toHaveCount(5);
      await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
    }

    // Categories come from the seeded DB.
    await expect(page.locator('#home-categories-title')).toBeVisible();
    await expect(page.locator('a[href$="/category/smartphones"]').first()).toBeAttached();

    await expectNoHorizontalOverflow(page);
  });
}

test.describe('locale negotiation', () => {
  test.use({ locale: 'ar-OM' });
  test('root redirects to the preferred locale (Arabic)', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/ar$/);
  });
});

test.describe('locale fallback', () => {
  test.use({ locale: 'de-DE' });
  test('unsupported browser language falls back to Arabic (default)', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/ar$/);
  });
});

test('viewport meta allows zoom and covers safe areas', async ({ page }) => {
  await page.goto('/en');
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).toContain('width=device-width');
  expect(content).toContain('viewport-fit=cover');
  expect(content).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
});

test('theme toggle persists (cookie) and renders server-side without flash', async ({ page }) => {
  await gotoReady(page, '/en');
  await page.locator('[data-testid="theme-toggle"]:visible').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const header = isDesktop(page) ? page.getByTestId('desktop-header') : page.getByTestId('mobile-header');
  await expect(header.locator('img[alt="DOOM | دوم"]')).toHaveAttribute('data-logo-surface', 'light');
  await expectNoHorizontalOverflow(page);
});

test('secondary pages have no horizontal overflow', async ({ page }) => {
  for (const path of ['/ar/login', '/en/register', '/fr/legal/privacy', '/ar/legal/terms', '/en/this-page-does-not-exist']) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
});

test('unknown pages render the branded 404 with a back button', async ({ page }) => {
  const res = await page.goto('/fr/nope-nope');
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId('not-found')).toBeVisible();
  await expect(page.getByTestId('not-found').getByTestId('back-button')).toBeVisible();
});
