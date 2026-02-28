const CACHE_NAME = 'pasfini-v2';
const urlsToCache = [
  '/Pasfini/',
  '/Pasfini/index.html',
  '/Pasfini/manifest.webmanifest',
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - network-first for navigation, cache-first for assets
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Navigation requests (HTML pages): network-first to always get latest version
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
              })
              .catch((err) => {
                console.error('Caching failed:', err);
              });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }

  // All other requests (JS, CSS, images): cache-first with network fallback
  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
          return response;
        }

        return fetch(request).then((response) => {
          if (!response || !response.ok) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(request, responseToCache);
            })
            .catch((err) => {
              console.error('Caching failed:', err);
            });

          return response;
        });
      })
  );
});
