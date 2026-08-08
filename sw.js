/* ═══════════ sw.js — offline-first service worker ═══════════
   Strategy:
     • app shell + modules  → stale-while-revalidate (instant load, silent update)
     • navigations          → network-first, falling back to the cached shell
   All user data lives in IndexedDB, which the worker never touches.
   ═══════════════════════════════════════════════════════════ */

/* Names the cache, so a new value forces clients to fetch fresh files instead
   of serving the previous build. build-pages.mjs rewrites this line with a hash
   of the built files, so the value below only matters when serving the project
   root directly (serve.mjs / local dev) — the deployed copy is always stamped. */
const VERSION = 'v1.2.5';
const CACHE = `cashchecker-${VERSION}`;

const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/util.js', './js/db.js', './js/store.js', './js/ui.js',
  './js/charts.js', './js/ai.js', './js/seed.js', './js/sync.js', './js/landing.js', './js/gdrive.js',
  './js/views/common.js', './js/views/dashboard.js', './js/views/tracker.js', './js/views/credit.js',
  './js/views/investments.js', './js/views/marketing.js', './js/views/budget.js', './js/views/bills.js',
  './js/views/shopping.js', './js/views/goals.js', './js/views/loans.js', './js/views/reports.js', './js/views/analytics.js',
  './js/views/categories.js', './js/views/calendar.js', './js/views/reminders.js', './js/views/notifications.js',
  './js/views/settings.js', './js/views/custom.js', './js/views/accounts.js',
  './assets/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll fails the whole install if one entry 404s; add individually instead
    await Promise.all(PRECACHE.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] precache skipped', url, err.message); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;          // never touch cross-origin

  // navigations: try network, fall back to the cached shell (offline launch)
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) ||
          new Response('<h1>Offline</h1><p>Cash Checker could not load its shell.</p>',
            { headers: { 'Content-Type': 'text/html' }, status: 503 });
      }
    })());
    return;
  }

  // everything else: stale-while-revalidate
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504, statusText: 'Offline' });
  })());
});
