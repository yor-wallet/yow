import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoReady, uniqueUser, useUniqueIp } from './helpers';

test.describe('authentication', () => {
  test('register → account → logout → login → account', async ({ page }, testInfo) => {
    await useUniqueIp(page);
    const u = uniqueUser(testInfo);

    await gotoReady(page, '/en/register');
    const form = page.getByTestId('register-form');
    await form.getByRole('textbox', { name: /Full name/ }).fill(u.fullName);
    await form.getByRole('textbox', { name: /Email/ }).fill(u.email);
    await form.getByRole('textbox', { name: /Mobile number/ }).fill(u.phone);
    await form.locator('input[name="password"]').fill(u.password);
    await form.locator('input[name="confirmPassword"]').fill(u.password);
    await form.getByRole('checkbox').check();
    await expectNoHorizontalOverflow(page);
    await form.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/en\/account$/);
    await expect(page.getByTestId('account-profile')).toContainText(u.email);
    await expect(page.getByTestId('account-profile')).toContainText(`+968${u.phone}`);

    // Session cookie is httpOnly + SameSite=Lax.
    const cookie = (await page.context().cookies()).find((c) => c.name === 'doom_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');

    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/en$/);
    expect((await page.context().cookies()).find((c) => c.name === 'doom_session' && c.value)).toBeUndefined();

    await gotoReady(page, '/en/login');
    const login = page.getByTestId('login-form');
    await login.getByRole('textbox', { name: /Email/ }).fill(u.email);
    await login.locator('input[name="password"]').fill(u.password);
    await login.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/en\/account$/);
    await expect(page.getByTestId('account-profile')).toContainText(u.fullName);
  });

  test('protected page redirects to login and returns after sign-in (ar)', async ({ page }, testInfo) => {
    await useUniqueIp(page);
    const u = uniqueUser(testInfo);
    // Create the account first.
    await gotoReady(page, '/ar/register');
    const reg = page.getByTestId('register-form');
    await reg.locator('input[name="fullName"]').fill(u.fullName);
    await reg.locator('input[name="email"]').fill(u.email);
    await reg.locator('input[name="phone"]').fill(u.phone);
    await reg.locator('input[name="password"]').fill(u.password);
    await reg.locator('input[name="confirmPassword"]').fill(u.password);
    await reg.locator('input[name="acceptTerms"]').check();
    await reg.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/ar\/account$/);
    await page.context().clearCookies();

    await page.goto('/ar/account');
    await expect(page).toHaveURL(/\/ar\/login\?next=%2Faccount$/);
    const login = page.getByTestId('login-form');
    await login.locator('input[name="email"]').fill(u.email);
    await login.locator('input[name="password"]').fill(u.password);
    await login.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/ar\/account$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('shows translated validation and credential errors', async ({ page }, testInfo) => {
    await useUniqueIp(page);
    await gotoReady(page, '/en/register');
    const form = page.getByTestId('register-form');
    await form.locator('input[name="fullName"]').fill('A');
    await form.locator('input[name="email"]').fill('not-an-email');
    await form.locator('input[name="phone"]').fill('12345');
    await form.locator('input[name="password"]').fill('short');
    await form.locator('input[name="confirmPassword"]').fill('different');
    await form.locator('button[type="submit"]').click();
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(form).toContainText("Enter a valid email address.");
    await expect(form).toContainText("Enter a valid Omani number (8 digits).");
    await expect(form).toContainText('You must accept the terms to continue.');
    // Non-sensitive values are kept, passwords are not.
    await expect(form.locator('input[name="email"]')).toHaveValue('not-an-email');
    await expect(form.locator('input[name="password"]')).toHaveValue('');

    await gotoReady(page, '/en/login');
    const login = page.getByTestId('login-form');
    await login.locator('input[name="email"]').fill(uniqueUser(testInfo).email);
    await login.locator('input[name="password"]').fill('WrongPassword1');
    await login.locator('button[type="submit"]').click();
    await expect(page.getByTestId('form-error')).toHaveText('Incorrect email or password.');
  });
});
