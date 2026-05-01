// Formula AI Global - Service Worker
// Strategy:
//   - Pre-cache the app shell on install
//   - Network-first for HTML / API (so users always get fresh search results)
//   - Cache-first for static assets (icons, manifest, etc.)
//   - Offline fallback: serve cached '/' if HTML fetch fails
const VERSION = 'v1'
const STATIC_CACHE = `formula-ai-static-${VERSION}`
const RUNTIME_CACHE = `formula-ai-runtime-${VERSION}`

const SHELL = ['/', '/manifest.json', '/icon-192.svg', '/icon-512.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Don't intercept API calls or auth callbacks
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/_next/data/')) return

  // HTML: network-first, fall back to cached '/'
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy))
          return res
        })
        .catch(() => caches.match(request).then((m) => m || caches.match('/')))
    )
    return
  }

  // Everything else: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((res) => {
        if (!res.ok || res.type === 'opaque') return res
        const copy = res.clone()
        caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy))
        return res
      })
    })
  )
})
