const CACHE = 'huozi-v6';
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
  // Network-first: always serve the latest deploy when online, fall back to
  // cache offline. Cache-first here meant deploys never reached returning
  // visitors unless the sw.js version string was bumped by hand.
  // 'no-cache' bypasses the browser HTTP cache (GitHub Pages max-age=600)
  // and revalidates with the server — cheap 304s when nothing changed.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
