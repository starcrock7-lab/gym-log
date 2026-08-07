// Cache-first with a versioned cache. Bump CACHE when shipping a change, or
// the phone keeps serving the old app forever.
const CACHE = 'gym-log-v2';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/dom.js',
  'js/db.js',
  'js/store.js',
  'js/schema.js',
  'js/seed.js',
  'js/calc.js',
  'js/charts.js',
  'js/crypto.js',
  'js/backup.js',
  'js/ui/home.js',
  'js/ui/workout.js',
  'js/ui/history.js',
  'js/ui/exercises.js',
  'js/ui/routines.js',
  'js/ui/body.js',
  'js/ui/settings.js',
  'js/ui/pickers.js',
  'js/ui/setrow.js',
  'js/ui/focus.js',
  'js/ui/timer.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // One missing file must not fail the whole install and leave the app
    // without a cache at all.
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // The backup call must always hit the network — a cached reply would make a
  // stale backup look like a fresh one.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Serve instantly, then quietly refresh for next launch.
        fetch(request)
          .then((response) => {
            if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response));
          })
          .catch(() => {});
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('index.html'));
    }),
  );
});
