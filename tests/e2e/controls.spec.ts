import { expect, test } from '@playwright/test';
import { gotoReady, useUniqueIp } from './helpers';

/**
 * Controls guard (owner's specification §6): on the key pages every button, link and icon control has an
 * accessible name, no link is dead ("#", empty, javascript:), and visible controls are at least 44 × 44 CSS px
 * (exceptions of WCAG 2.5.8: a link stretched over its whole card, a link inside a sentence, the home
 * carousel's slide dots). The full crawl with link status checks is `scripts/audit-controls.mjs`.
 */
const PAGES = ['/ar', '/en', '/fr', '/ar/categories', '/en/category/smartphones', '/ar/search?q=phone', '/en/cart', '/ar/login', '/en/register', '/fr/delivery'];

test.beforeEach(async ({ page }) => {
  await useUniqueIp(page);
});

for (const path of PAGES) {
  test(`controls on ${path}: names, targets and sizes`, async ({ page }) => {
    await gotoReady(page, path);
    const report = await page.evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden],[inert],[aria-hidden="true"]');
      };
      const nameOf = (el: Element) => {
        const label = el.getAttribute('aria-label')?.trim();
        if (label) return label;
        const by = el.getAttribute('aria-labelledby');
        if (by) {
          const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
          if (t) return t;
        }
        const text = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) return text;
        const alt = el.querySelector('img[alt]')?.getAttribute('alt')?.trim();
        if (alt) return alt;
        return el.getAttribute('title')?.trim() || el.querySelector('svg title')?.textContent?.trim() || '';
      };
      const out: { kind: string; what: string }[] = [];
      const sel = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="radio"], summary';
      for (const el of document.querySelectorAll(sel)) {
        const name = nameOf(el);
        const what = `${el.tagName.toLowerCase()} "${name || el.getAttribute('href') || ''}"`;
        if (!name) out.push({ kind: 'no-name', what });
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') ?? '';
          if (!href || href === '#' || /^javascript:/i.test(href)) out.push({ kind: 'dead-link', what });
        }
        if (!visible(el)) continue;
        if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const r = el.getBoundingClientRect();
        const parent = el.parentElement;
        const stretched = el.tagName === 'A' && getComputedStyle(el, '::after').position === 'absolute';
        const inSentence = el.tagName === 'A' && !!parent && ['P', 'LABEL', 'SPAN', 'LI', 'DD'].includes(parent.tagName) && (parent.innerText || '').trim().length > ((el as HTMLElement).innerText || '').trim().length + 6;
        const dot = /^(عرض الشريحة|Show slide|Afficher la diapositive)/.test(name) && r.width >= 28 && r.height >= 44;
        if ((Math.round(r.width) < 44 || Math.round(r.height) < 44) && !stretched && !inSentence && !dot) out.push({ kind: 'small-target', what: `${what} ${Math.round(r.width)}×${Math.round(r.height)}` });
      }
      return out;
    });
    expect(report, JSON.stringify(report, null, 1)).toEqual([]);
  });
}
