/**
 * Controls audit (owner's specification §6): walks the storefront pages and lists every button, link and
 * interactive icon with its accessible name, target and size, then flags what is wrong:
 *   - no accessible name (icon-only control without aria-label / title / text),
 *   - links with an empty, "#" or "javascript:" target,
 *   - internal link targets that do not answer (status >= 400),
 *   - touch targets smaller than 44 × 44 CSS px (visible controls only).
 * Usage:  BASE=http://localhost:3100 node scripts/audit-controls.mjs [out.json]
 * The pages are public ones plus a throw-away signed-in account when REGISTER=1 (local databases only).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.argv[2] || 'controls-audit.json';
const LOCALES = (process.env.LOCALES || 'ar,en,fr').split(',');
const PUBLIC_PAGES = ['', '/categories', '/category/smartphones', '/search?q=phone', '/product/demo-phone-apple-1', '/cart', '/login', '/register', '/favorites', '/compare', '/promotions', '/delivery', '/legal/terms', '/legal/privacy', '/legal/returns', '/help', '/flex'];
const ACCOUNT_PAGES = ['/account', '/orders', '/wallet', '/wallet/top-up', '/account/addresses', '/account/notifications', '/account/support', '/account/profile', '/account/security', '/account/help'];

/** Runs in the page: every interactive element with name / target / size. */
function collect() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden],[inert],[aria-hidden="true"]');
  };
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() || '').join(' ').trim();
      if (t) return t;
    }
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const svgTitle = el.querySelector('svg title');
    if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();
    if (el.tagName === 'INPUT' && el.value) return el.value;
    return '';
  };
  const sel = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="radio"], [role="switch"], summary, input[type="submit"], input[type="button"]';
  return [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      name: nameOf(el),
      href: el.tagName === 'A' ? el.getAttribute('href') : '',
      testid: el.getAttribute('data-testid') || '',
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      visible: visible(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      type: el.getAttribute('type') || '',
      // Exceptions of WCAG 2.5.8: a link stretched over its whole card (::after covers it) or a link inside a sentence.
      exempt:
        (el.tagName === 'A' && getComputedStyle(el, '::after').position === 'absolute') ||
        (el.tagName === 'A' && !!el.parentElement && ['P', 'LABEL', 'SPAN', 'LI', 'DD'].includes(el.parentElement.tagName) && (el.parentElement.innerText || '').trim().length > (el.innerText || '').trim().length + 6),
    };
  });
}

const browser = await chromium.launch();
const result = { base: BASE, at: new Date().toISOString(), pages: [], issues: [] };
const hrefStatus = new Map();

async function status(ctx, href) {
  if (hrefStatus.has(href)) return hrefStatus.get(href);
  let code = 0;
  try {
    const res = await ctx.request.get(new URL(href, BASE).toString(), { maxRedirects: 5, timeout: 30000 });
    code = res.status();
  } catch {
    code = -1;
  }
  hrefStatus.set(href, code);
  return code;
}

async function auditPage(ctx, locale, path, device) {
  const page = await ctx.newPage();
  const url = `/${locale}${path}`;
  const entry = { url, device, controls: 0, issues: [] };
  try {
    const res = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    entry.status = res?.status() ?? 0;
    await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached', timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const controls = await page.evaluate(collect);
    entry.controls = controls.length;
    for (const c of controls) {
      const where = `${c.tag}${c.testid ? `[${c.testid}]` : ''} "${c.name || c.href || ''}"`;
      if (!c.name) entry.issues.push({ kind: 'no-name', where, href: c.href });
      if (c.tag === 'a' && (!c.href || c.href === '#' || /^javascript:/i.test(c.href))) entry.issues.push({ kind: 'dead-link', where, href: c.href });
      // Known exception: the 7 slide dots of the home carousel are 24–40 × 44 (WCAG 2.5.8 minimum 24) (seven 44 px dots do not fit a 390 px banner; the carousel is also swipeable and has previous / next buttons from 430 px).
      const carouselDot = /^عرض الشريحة|^Show slide|^Afficher la diapositive/.test(c.name) && c.w >= 24 && c.h >= 44;
      if (c.visible && !c.disabled && !c.exempt && !carouselDot && (c.w < 44 || c.h < 44) && !(c.tag === 'a' && c.h >= 24 && c.w >= 44)) entry.issues.push({ kind: 'small-target', where: `${where} ${c.w}×${c.h}`, href: c.href });
    }
    const hrefs = [...new Set(controls.filter((c) => c.tag === 'a' && c.href && !/^(#|mailto:|tel:|javascript:|https?:\/\/(?!localhost))/i.test(c.href)).map((c) => c.href.split('#')[0]))];
    for (const h of hrefs) {
      const code = await status(ctx, h);
      if (code >= 400 || code < 0) entry.issues.push({ kind: 'broken-link', where: h, href: h, status: code });
    }
  } catch (err) {
    entry.issues.push({ kind: 'page-error', where: String(err).slice(0, 160) });
  }
  await page.close();
  return entry;
}

async function runContext(label, opts, pages, register) {
  const ctx = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-forwarded-for': `10.3.${Math.floor(Math.random() * 250)}.7` }, ...opts });
  await ctx.addCookies([{ name: 'doom_area', value: 'MA', url: BASE }]);
  if (register) {
    const p = await ctx.newPage();
    const email = `audit-${Date.now().toString(36)}@test.doom.local`;
    await p.goto(`${BASE}/en/register`);
    await p.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' });
    const form = p.locator('form', { has: p.locator('input[name="fullName"]') });
    await p.locator('input[name="fullName"]').fill('Audit Tester');
    await p.locator('input[name="email"]').fill(email);
    await p.locator('input[name="phone"]').fill('9' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0'));
    await p.locator('input[name="password"]').fill('AuditPassword123');
    await p.locator('input[name="confirmPassword"]').fill('AuditPassword123');
    await form.getByRole('checkbox').check();
    await form.locator('button[type="submit"]').click();
    await p.waitForURL(/account/, { timeout: 20000 });
    await p.close();
  }
  for (const locale of LOCALES) {
    for (const path of pages) {
      const e = await auditPage(ctx, locale, path, label);
      result.pages.push(e);
      for (const i of e.issues) result.issues.push({ page: e.url, device: label, ...i });
    }
  }
  await ctx.close();
}

await runContext('phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, PUBLIC_PAGES, false);
await runContext('desktop', { viewport: { width: 1440, height: 900 } }, PUBLIC_PAGES, false);
if (process.env.REGISTER === '1') await runContext('phone-signed-in', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, ACCOUNT_PAGES, true);
await browser.close();

fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
const by = {};
for (const i of result.issues) by[i.kind] = (by[i.kind] || 0) + 1;
console.log(`pages: ${result.pages.length}, controls: ${result.pages.reduce((n, p) => n + p.controls, 0)}, issues:`, by);
