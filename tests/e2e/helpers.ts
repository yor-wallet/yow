import { expect, type Page, type TestInfo } from '@playwright/test';

export const LOCALES = ['ar', 'en'] as const;

/**
 * Asserts the page has no horizontal overflow:
 *  1. document scrollWidth <= window.innerWidth
 *  2. no visible element's box extends past the viewport (left < 0 or right > clientWidth),
 *     after clipping by overflow-hidden/auto ancestors (html/body excluded on purpose:
 *     `overflow-x: clip` there must not hide real bugs).
 * Intentional horizontal scrollers (carousels, chip rows, tab lists) must be marked
 * with `data-scroll-x`; their descendants are ignored.
 */
export async function expectNoHorizontalOverflow(page: Page) {
  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const innerWidth = window.innerWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders: string[] = [];
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const tid = el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : '';
      const cls = typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${tid}${cls}`;
    };
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el.closest('[data-scroll-x]') && !el.hasAttribute('data-scroll-x')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.display === 'contents') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      let left = rect.left;
      let right = rect.right;
      if (style.position !== 'fixed') {
        for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (/(hidden|clip|auto|scroll)/.test(ps.overflowX)) {
            const pr = p.getBoundingClientRect();
            left = Math.max(left, pr.left);
            right = Math.min(right, pr.right);
          }
          if (ps.position === 'fixed') break;
        }
      }
      if (right - left < 1) continue; // fully clipped
      if (left < -1 || right > vw + 1) offenders.push(`${describe(el)} [${Math.round(left)}..${Math.round(right)}] vw=${vw}`);
    }
    return { vw, innerWidth, scrollWidth, offenders: offenders.slice(0, 15) };
  });
  expect(result.scrollWidth, `document scrollWidth ${result.scrollWidth} > innerWidth ${result.innerWidth}`).toBeLessThanOrEqual(
    result.innerWidth,
  );
  expect(result.offenders, 'elements overflowing the viewport horizontally').toEqual([]);
}

export function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

/** Unique, valid test identity per test/project (avoids collisions in parallel runs). */
export function uniqueUser(testInfo: TestInfo) {
  const tag = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const digits = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  return {
    fullName: 'E2E Tester',
    email: `e2e-${tag}@test.doom.local`.toLowerCase(),
    phone: `9${digits}`,
    password: 'E2ePassword123',
  };
}

/** Distinct client IP per test so DB-backed per-IP rate limits do not couple parallel tests. */
export async function useUniqueIp(page: Page) {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 250)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  return ip;
}

/** The visible back button (mobile sticky header or desktop text button). */
export function backButton(page: Page) {
  return page.locator('[data-testid="back-button"]:visible').first();
}

/** Navigate and wait until React has hydrated (interactive controls are wired). */
export async function gotoReady(page: Page, url: string) {
  const res = await page.goto(url);
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' });
  return res;
}

/** Pick a capacity on the product page: pill buttons on desktop, a native menu on phones/tablets. */
export async function pickCapacity(page: Page, capacity: string) {
  if (isDesktop(page)) await page.getByRole('button', { name: capacity }).click();
  else await page.getByTestId('capacity-select').selectOption(capacity);
}
