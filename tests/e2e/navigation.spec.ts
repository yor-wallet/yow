import { expect, test } from '@playwright/test';
import { backButton, expectNoHorizontalOverflow, gotoReady, isDesktop } from './helpers';

test.describe('Back button', () => {
  test('falls back to a safe route when the page is opened directly', async ({ page }) => {
    await gotoReady(page, '/en/legal/terms');
    await expect(page.locator('h1:visible')).toHaveText('Terms of sale');
    await backButton(page).click();
    await expect(page).toHaveURL(/\/en$/);
    // The fallback replaced the entry: we never left the site and there is no loop.
    await expect(page.locator('#home-hero-title')).toBeVisible();
  });

  test('uses real history after in-app navigation', async ({ page }) => {
    await gotoReady(page, '/fr');
    await page.getByTestId('site-footer').locator('a[href="/fr/legal/privacy"]').click();
    await expect(page).toHaveURL(/\/fr\/legal\/privacy$/);
    await backButton(page).click();
    await expect(page).toHaveURL(/\/fr$/);
    // Browser forward still works (real history, no hash hacks).
    await page.goForward();
    await expect(page).toHaveURL(/\/fr\/legal\/privacy$/);
  });

  test('back arrow is mirrored in RTL', async ({ page }) => {
    await gotoReady(page, '/ar/legal/returns');
    const transform = await backButton(page)
      .locator('svg')
      .evaluate((svg) => getComputedStyle(svg).transform);
    expect(transform).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  });

  test('works on the login page reached via a protected redirect', async ({ page }) => {
    await gotoReady(page, '/en/account');
    await expect(page).toHaveURL(/\/en\/login/);
    await backButton(page).click();
    await expect(page).toHaveURL(/\/en$/);
  });
});

test.describe('History-backed overlays', () => {
  test('modal closes on browser Back and the page stays', async ({ page }) => {
    await page.goto('/en');
    await gotoReady(page, '/en/ui-kit');
    await page.getByTestId('open-modal').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/en\/ui-kit$/);
    // The modal entry was consumed: the next Back leaves the page.
    await page.goBack();
    await expect(page).toHaveURL(/\/en$/);
  });

  test('closing with the X button pops its history entry', async ({ page }) => {
    await page.goto('/en');
    await gotoReady(page, '/en/ui-kit');
    await page.getByTestId('open-sheet').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/en\/ui-kit$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/en$/);
  });

  test('Escape closes the modal', async ({ page }) => {
    await gotoReady(page, '/en/ui-kit');
    await page.getByTestId('open-modal').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('mobile language sheet closes on Back; choosing a language switches locale', async ({ page }) => {
    test.skip(isDesktop(page), 'mobile/tablet header only');
    await gotoReady(page, '/en');
    await page.locator('[data-testid="locale-switcher"]:visible').click();
    const sheet = page.getByTestId('locale-sheet');
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/en$/);

    await page.locator('[data-testid="locale-switcher"]:visible').click();
    await sheet.getByRole('link', { name: 'العربية' }).click();
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
