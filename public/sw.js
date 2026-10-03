/* LevelUp service worker.
 *   static assets  → cache-first (they're content-hashed)
 *   app pages      → network-first, falling back to the last good copy, then /offline.html
 *   API + files    → network only (offline taps are queued by the page itself)
 */
const VERSION = 'levelup-v1';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const APP_PAGES = ['/today', '/plan', '/progress', '/money', '/you'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(['/offline.html', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || /\.(?:woff2|png|svg|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && APP_PAGES.some((p) => url.pathname === p)) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(url.pathname, { cacheName: PAGES })) || (await caches.match('/offline.html'))),
    );
  }
});
