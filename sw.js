// Formula AI Global — Service Worker KILL-SWITCH
// ---------------------------------------------------------------------------
// The previous caching service worker was the root cause of multiple
// launch-blocking bugs: stale homepage, fixes never reaching users, and
// formula.html being served as index.html from cache. For a mostly-static
// multi-page site that does NOT need offline support pre-launch, the SW
// caused far more harm than benefit.
//
// This file is a standard self-destroying kill-switch: when any browser
// fetches the updated sw.js, this version installs, then on activate it
// deletes ALL caches, unregisters itself, and reloads open pages. After
// that the site behaves as a normal reliable static site — the server is
// the single source of truth and deploys reach users immediately (further
// helped by the ?v=8 asset versioning on every page).
//
// IMPORTANT: there is intentionally NO 'fetch' handler — the SW must not
// intercept or cache anything.
// ---------------------------------------------------------------------------

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) { /* ignore */ }

    try {
      await self.clients.claim();
    } catch (_) { /* ignore */ }

    // Remove this service worker entirely. We deliberately DO NOT call
    // client.navigate() here: pages may re-register the SW on load, and
    // navigate()→reload→register→activate→navigate is an infinite
    // ~1s reload loop ("the screen keeps moving every second"). Just
    // unregister silently; the next normal navigation is SW-free.
    try {
      await self.registration.unregister();
    } catch (_) { /* ignore */ }
  })());
});

// No fetch listener on purpose: requests go straight to the network.
