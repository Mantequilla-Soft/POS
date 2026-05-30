const CACHE = 'poshive-v56';

const APP_SHELL = [
  'login.html',
  'dashboard.html',
  'pos.html',
  'admin.html',
  'members.html',
  'campaigns.html',
  'kitchen.html',
  'reviewreceipts.html',
  'superadmin.html',
  'quick-sale.html',
  'reports.html',
  'reservations.html',
  'hotel.html',
  'theme.css',
  'i18n.js',
  'payment-plugins.js',
  'theme-loader.js',
  'manifest.json',
  'images/poslogo.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for API calls, cache-first for app shell
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
