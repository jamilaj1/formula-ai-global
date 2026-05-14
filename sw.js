// Formula AI Global - Service Worker
// CACHE bumped from v3 → v4 so old caches are evicted on activate.
const CACHE = 'formula-ai-v4';
const ASSETS = [
  './',
  './index.html',
  './search.html',
  './pricing.html',
  './dashboard.html',
  './formulas.html',
  './compliance.html',
  './about.html',
  './login.html',
  './register.html',
  './learn.html',
  './chat.html',
  './discover.html',
  './library.html',
  './industries.html',
  './docs.html',
  './contact.html',
  './safety.html',
  './lab.html',
  './encyclopedia.html',
  './programs.html',
  './privacy.html',
  './terms.html',
  './assets/styles.css',
  './assets/app.js?v=3',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Wipe stale caches
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));

    // Take over any open pages immediately
    await self.clients.claim();

    // Force-reload every open page so the new SW + fresh JS take effect
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) {
      try {
        await client.navigate(client.url);
      } catch (_) {
        client.postMessage({ type: 'fai-force-reload' });
      }
    }
  })());
});

// Fallback: if a page can't be navigated by the SW, it can listen for the
// message and reload itself.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'fai-skip-waiting') self.skipWaiting();
});

// Network-first for JS / CSS / HTML so users always see the latest UI logic.
// Fall back to cache only when offline. Other assets (images/fonts) stay
// cache-first for performance.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;
  const isCriticalAsset = /\.(js|css|html)(\?|$)/i.test(url) || url.endsWith('/');

  if (isCriticalAsset) {
    // Network-first
    event.respondWith(
      fetch(event.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => null);
        return res;
      }).catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
    );
  } else {
    // Cache-first for static media
    event.respondWith(
      caches.match(event.request).then(response => response || fetch(event.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => null);
        return res;
      }).catch(() => caches.match('./index.html')))
    );
  }
});
