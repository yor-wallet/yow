/* DOOM | دوم — service worker (offline-safe, minimal).
 *
 * - Pre-caches the offline page and brand assets.
 * - Cache-first for immutable build assets (/_next/static), fonts, /brand, /icons.
 * - Network-only for EVERYTHING else that is dynamic: HTML pages (may contain
 *   personal data), /api/*, payments, webhooks, server actions (POST), /media.
 *   When a navigation fails (offline) the offline page is shown instead.
 * Bump VERSION to invalidate caches.
 */
const VERSION = 'doom-v2'; // v2: new official logo (cached brand files must be refreshed)
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/brand/doom-logo-horizontal-transparent-320.webp',
  '/icons/icon-192.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableStatic(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/brand/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(woff2?|ttf)$/.test(url.pathname)
  );
}

function isNeverCache(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/media/') ||
    url.pathname.includes('/payments') ||
    url.pathname.includes('/checkout') ||
    url.pathname.includes('/wallet') ||
    url.pathname.includes('/admin')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // server actions, payments, forms: never intercepted
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCache(url)) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (isCacheableStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
