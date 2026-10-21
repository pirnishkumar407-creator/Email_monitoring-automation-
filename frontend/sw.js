// Service Worker for AI Email Automation PWA
const CACHE_NAME = 'ai-email-pwa-v1.1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/admin.html',
  '/css/style.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/admin.js',
  '/js/charts.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg'
];

// Install Event: Pre-cache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[PWA SW] Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[PWA SW] Partial cache pre-fill:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PWA SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event Strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Skip non-GET requests (e.g. POST /api/...)
  if (req.method !== 'GET') {
    return;
  }

  // 2. API calls: Network first with graceful offline response
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match(req).then((cached) => {
          if (cached) return cached;
          return new Response(
            JSON.stringify({
              success: false,
              offline: true,
              message: 'You are currently offline. Displaying cached data.'
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 503
            }
          );
        });
      })
    );
    return;
  }

  // 3. Static Assets: Stale-While-Revalidate (Speed + Freshness)
  event.respondWith(
    caches.match(req).then((cachedResp) => {
      const fetchPromise = fetch(req).then((networkResp) => {
        if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
          const respToCache = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respToCache));
        }
        return networkResp;
      }).catch(() => {
        // If offline and request is an HTML page, serve dashboard fallback
        if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
          return caches.match('/dashboard.html');
        }
      });

      return cachedResp || fetchPromise;
    })
  );
});
