/**
 * Web Vitals in a test environment (specification §7): LCP, CLS and a lab stand-in for INP (the longest
 * input-to-next-paint of a real tap, via the Event Timing API) on the home page, a category, a product
 * and the cart, as a throttled phone (4× CPU slowdown, fast-3G-like network) and as a desktop.
 * These are lab numbers, not field data. Usage: BASE=http://localhost:3000 node scripts/measure-vitals.mjs [out.json]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const RUNS = Number(process.env.RUNS || 3);
const PAGES = [['home', '/ar'], ['category', '/ar/category/smartphones'], ['product', '/ar/product/demo-phone-apple-1'], ['cart', '/ar/cart']];
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function once(browser, device, path) {
  const phone = device === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (phone) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  }
  await page.addInitScript(() => {
    window.__v = { lcp: 0, cls: 0, inp: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__v.inp = Math.max(window.__v.inp, e.duration); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached', timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  // A real interaction: tap the first safe control (theme toggle is harmless and always present).
  const toggle = page.locator('[data-testid="theme-toggle"]:visible').first();
  if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(600); }
  const v = await page.evaluate(() => window.__v);
  await ctx.close();
  return v;
}

const browser = await chromium.launch();
const out = { base: BASE, at: new Date().toISOString(), runs: RUNS, results: [] };
for (const device of ['phone', 'desktop']) {
  for (const [name, path] of PAGES) {
    const rs = [];
    for (let i = 0; i < RUNS; i++) rs.push(await once(browser, device, path));
    out.results.push({ device, page: name, lcpMs: Math.round(median(rs.map((r) => r.lcp))), cls: Number(median(rs.map((r) => r.cls)).toFixed(3)), inpMs: Math.round(median(rs.map((r) => r.inp))) });
  }
}
await browser.close();
fs.writeFileSync(process.argv[2] || 'vitals.json', JSON.stringify(out, null, 2));
console.table(out.results);
