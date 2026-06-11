const CACHE = 'huozi-v5';
const SHELL = ['./', './index.html', './style.css', './app.js', './feeds.js', './favicon.svg', './manifest.json',
               './js/utils.js', './js/db.js', './js/markets.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Don't cache cross-origin requests (RSS proxies, Yahoo Finance, etc.)
  if (url.origin !== self.location.origin) return;
  // Always fetch data files fresh — updated by GitHub Actions every 15 min
  if (url.pathname.includes('/data/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
    })
  );
});
