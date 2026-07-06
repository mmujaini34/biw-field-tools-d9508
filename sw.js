/* BIW Field Tools — Service Worker v3.5.2 (offline-first, bulletproof) */
const CACHE_NAME = 'biw-field-tools-v3.5.2';
const ASSETS = [
  './',
  './index.html',
  './timesheet.html',
  './checklist.html',
  './report.html',
  './empty-timesheet.html',
  './bg.jpg',
  './libs/html2canvas.min.js',
  './libs/jspdf.umd.min.js',
  './assets/timesheet-image-1.webp',
  './assets/timesheet-image-2.webp',
  './assets/timesheet-image-3.webp',
  './assets/timesheet-image-4.webp',
  './assets/timesheet-image-5.webp',
  './assets/timesheet-image-6.webp',
  './assets/report-image-1.webp',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(ASSETS.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(handle(e.request));
});

async function handle(request) {
  /* 1) الكاش أولاً — أوفلاين فوري */
  try {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      refreshInBackground(request);
      return cached;
    }
  } catch (err) {}

  /* 2) مو بالكاش → الشبكة، ونخزنه للمرات الجاية */
  try {
    const res = await fetch(request);
    if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
    }
    return res;
  } catch (err) {}

  /* 3) أوفلاين وبدون كاش → أبدًا ما نرجع فاضي */
  try {
    if (request.mode === 'navigate' || (request.headers.get('accept') || '').indexOf('text/html') !== -1) {
      const home = await caches.match('./index.html', { ignoreSearch: true });
      if (home) return home;
      const root = await caches.match('./', { ignoreSearch: true });
      if (root) return root;
    }
  } catch (err) {}
  return new Response('Offline - not cached', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

function refreshInBackground(request) {
  try {
    fetch(request).then((res) => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
      }
    }).catch(() => {});
  } catch (err) {}
}
