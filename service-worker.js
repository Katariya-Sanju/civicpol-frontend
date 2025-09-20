// service-worker.js — CivicPol (with translate hosts passthrough)
const STATIC_CACHE  = 'civicpol-static-v7';
const RUNTIME_CACHE = 'civicpol-runtime-v7';

const ASSETS = [
  '/',
  '/index.html',
  '/reports.html',
  '/case.html',
  '/admin.html',
  '/style.css',
  '/manifest.json',
  '/cp-logo.svg',
  '/cp-logo-compact.svg'
];

const MAX_RUNTIME_ENTRIES = 150;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// helpers
async function limitCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) {
    await cache.delete(keys[0]);
    return limitCache(cacheName, max);
  }
}
async function putRuntime(request, response) {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
    await limitCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
  } catch {}
}
function isHTML(req) {
  return req.mode === 'navigate' || (req.headers.get('accept')||'').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only GET
  if (req.method !== 'GET') return;

  // Let Google Translate resources go straight to network (avoid caching issues)
  if (/(^|\.)translate\.google\./.test(url.hostname) || /( ^|\. )translate\.gstatic\.com$/.test(url.hostname)) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // HTML navigations: network-first, fallback to cached index/case
  if (isHTML(req)) {
    event.respondWith(
      fetch(req)
        .then((resp) => { putRuntime(req, resp); return resp.clone(); })
        .catch(async () => (await caches.match(req)) || caches.match('/index.html'))
    );
    return;
  }

  // Static same-origin assets: cache-first
  if (url.origin === self.location.origin && ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((resp)=>{ putRuntime(req, resp); return resp.clone(); }))
    );
    return;
  }

  // API JSON (GET): network-first with fallback
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((resp)=>{ putRuntime(req, resp); return resp.clone(); })
        .catch(()=> caches.match(req))
    );
    return;
  }

  // Uploads: cache-first after first fetch
  if (url.origin === self.location.origin && url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((resp)=>{ putRuntime(req, resp); return resp.clone(); }))
    );
    return;
  }

  // Third-party libs (tiles, fonts, CDN): stale-while-revalidate
  if (
    /(^|\.)unpkg\.com$/.test(url.hostname) ||
    /(^|\.)cdn\.jsdelivr\.net$/.test(url.hostname) ||
    /(^|\.)fonts\.googleapis\.com$/.test(url.hostname) ||
    /(^|\.)fonts\.gstatic\.com$/.test(url.hostname) ||
    /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname)
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchAndUpdate = fetch(req).then((resp) => { putRuntime(req, resp); return resp.clone(); }).catch(()=>null);
        return cached || fetchAndUpdate;
      })
    );
    return;
  }

  // Default: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((resp)=>{ putRuntime(req, resp); return resp.clone(); }))
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});