/*
 * Flight Brief — Service Worker
 * 
 * PURPOSE: Make the app work completely offline.
 * 
 * HOW IT WORKS:
 *  1. On first visit, the SW caches all app files
 *  2. On subsequent visits, cached files are served instantly
 *  3. When online, the SW checks for updates in the background
 *  4. API calls (to Google Sheets) are NOT cached — they always go to the network
 * 
 * CACHING STRATEGY: "Cache First, Network Fallback"
 *  - Check cache first
 *  - If found → serve from cache (fast, works offline)
 *  - If not found → fetch from network → cache it → serve it
 * 
 * This is the standard PWA pattern for offline-first apps.
 */

// Cache version — increment this when you deploy new files
// Old caches are cleaned up in the 'activate' event
const CACHE_NAME = 'flight-brief-v1';

// List of all files the app needs to function offline
// The SW downloads and stores all of these on first install
const ASSETS_TO_CACHE = [
  './',                          // Root
  './Index.html',                // Main HTML
  './css/style.css',             // Stylesheet
  './js/db.js',                  // IndexedDB layer
  './js/sync.js',                // Sync engine
  './js/app.js',                 // Main app logic
  './manifest.json',             // PWA manifest
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ==========================================
// INSTALL: Cache all app assets
// ==========================================

/**
 * The 'install' event fires when the SW is first registered or updated.
 * We use it to pre-cache all the app's static files.
 * 
 * waitUntil() keeps the SW in the 'installing' state until the promise
 * resolves — this ensures the cache is ready before the SW activates.
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] Install complete');
        // skipWaiting() activates this SW immediately instead of waiting
        // for all tabs to close. This means updates take effect faster.
        return self.skipWaiting();
      })
  );
});

// ==========================================
// ACTIVATE: Clean up old caches
// ==========================================

/**
 * The 'activate' event fires after 'install' completes.
 * We use it to delete old cache versions (from previous deployments).
 * 
 * clients.claim() makes this SW take control of all open tabs immediately,
 * without requiring a page reload.
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        // Delete any cache that isn't the current version
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activate complete');
        return self.clients.claim();
      })
  );
});

// ==========================================
// FETCH: Serve from cache, fallback to network
// ==========================================

/**
 * The 'fetch' event intercepts ALL network requests from the app.
 * This is where the offline magic happens.
 * 
 * Strategy:
 *  1. Try to serve from cache (instant, works offline)
 *  2. If not cached, fetch from network
 *  3. Cache the network response for next time
 *  4. If both fail (offline + not cached), return an error
 * 
 * EXCEPTION: API calls to Google Sheets always go to the network.
 * We don't cache API responses because they contain live data.
 * The IndexedDB layer handles offline data persistence instead.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // --- Skip non-GET requests (POST, PUT, etc.) ---
  // These are API calls — we don't cache them
  if (event.request.method !== 'GET') {
    return;  // Let the browser handle it normally
  }

  // --- Skip cross-origin requests ---
  // (API calls to Google Apps Script, CDN resources, etc.)
  if (url.origin !== location.origin) {
    return;
  }

  // --- Cache-first strategy for local assets ---
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // FOUND IN CACHE → serve it immediately
        if (cachedResponse) {
          return cachedResponse;
        }

        // NOT CACHED → fetch from network
        return fetch(event.request)
          .then(networkResponse => {
            // Only cache successful responses
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }

            // Clone the response — the response body can only be read once,
            // so we clone it: one copy for the cache, one for the browser
            const responseClone = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseClone);
              });

            return networkResponse;
          })
          .catch(() => {
            // BOTH cache and network failed — we're offline and this
            // asset wasn't cached. Return a fallback page.
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
            // For other resources (images, etc.), just fail
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// ==========================================
// BACKGROUND SYNC (optional, for future use)
// ==========================================

/**
 * Background Sync API lets the browser retry failed POST requests
 * when the connection comes back. This is useful for form submissions
 * that fail due to network issues.
 * 
 * Currently not implemented — our sync engine handles retries manually.
 * Uncomment and configure if you want browser-level background sync.
 */
// self.addEventListener('sync', (event) => {
//   if (event.tag === 'sync-briefs') {
//     event.waitUntil(syncEngine.fullSync());
//   }
// });
