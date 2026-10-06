// Service worker: keeps a copy of the app on the device so it opens
// instantly and works without signal.
//
// The copy is tied to the app version. A new version of this file (the
// version below moves with the app's, in the same bump) makes the browser
// fetch the new files into a new copy in the background; it takes over
// the next time the app is launched, and the old copy is dropped then.
// Nothing switches while the app is open.
//
// Requests the app makes with cache: 'no-cache' are its update checks
// (the zone data file, this page's version); those always go to the
// network, so an update is never answered from the stored copy.

const VERSION = '0.9.1';
const CACHE = `att-${VERSION}`;
const SHELL = [
  './',
  `./css/style.css?v=${VERSION}`,
  `./js/app.js?v=${VERSION}`,
  `./js/time-engine.js?v=${VERSION}`,
  `./js/slider.js?v=${VERSION}`,
  `./js/zone-coords.js?v=${VERSION}`,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];
// On localhost (development) files are always fetched fresh, with the
// copy only as a fallback, so an edit shows on the next reload.
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.cache === 'no-cache' || req.cache === 'reload') return;   // an update check
  // a page navigation is served as the start page whatever the hash or query
  const key = req.mode === 'navigate' ? './' : req;
  event.respondWith(DEV
    ? fetch(req).catch(() => caches.match(key))
    : caches.match(key).then((hit) => hit ?? fetch(req)));
});
