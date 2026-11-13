// Offline play: cache-first for the hashed build assets, network-first (falling back to the cache) for the page and everything else. A new build has new hashed names and a new
// CACHE name is not needed: stale entries are simply never asked for again; the page itself is refreshed on every online load.
const CACHE = 'liquid-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png']).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (/\/assets\//.test(req.url)) { e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(req, c)); return r; }))); return; }
  e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(req, c)); return r; }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
});
