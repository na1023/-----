const CACHE = 'kabu-v9';
const ASSETS = [
  './index.html',
  './style.css',
  './js/adapters.js',
  './js/api.js',
  './js/portfolio.js',
  './js/firebase-config.js',
  './js/sync.js',
  './js/app.js',
  './icon.svg',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API calls → network only (no cache)
  if (url.hostname.includes('yahoo.com') || url.hostname.includes('corsproxy') || url.hostname.includes('allorigins')
      || url.hostname.includes('googleapis.com') || url.hostname.includes('firebase') || url.hostname.includes('gstatic.com')) {
    return;
  }
  // アプリのファイル → ネット優先（最新を取得、失敗時のみキャッシュ）
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
