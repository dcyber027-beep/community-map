const CACHE_NAME = 'community-map-v35';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/privacy.html',
  '/support.html',
  '/terms.html',
  '/styles.css',
  '/app.js',
  '/sw-register.js',
  '/vendor/purify.min.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever handle GET requests.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // CRITICAL: never intercept cross-origin requests.
  // Map tiles (CARTO/OSM), CDN scripts/fonts (unpkg, Google Fonts) and the
  // geocoding API return opaque (no-cors) responses. The browser stores those
  // in Cache Storage with large fixed "padding" (each tile counts as several
  // MB toward the origin quota). Caching every tile as the user pans fills the
  // mobile storage quota within seconds, thrashing disk I/O and getting the
  // tab throttled/killed — which looks like the page "working for a second
  // then freezing". Desktop/localhost has a huge quota so it never shows.
  // Let the browser's normal HTTP cache handle all cross-origin assets.
  if (url.origin !== self.location.origin) return;

  // Never cache backend API calls.
  if (url.pathname.includes('/api/')) return;

  // Navigation requests: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('/index.html')))
    );
    return;
  }

  // Same-origin static assets: cache-first, with a background refresh.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
