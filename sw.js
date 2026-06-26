/* Universal CAD Studio v0.20.0 — static PWA service worker */
importScripts('./precache-manifest.js');

const APP_VERSION = '0.20.0';
const SCHEMA_VERSION = 2;
const CACHE_PREFIX = 'universal-cad-studio';
const CACHE = `${CACHE_PREFIX}-v${APP_VERSION}-schema${SCHEMA_VERSION}`;
const ASSETS = Array.isArray(self.__PRECACHE_ASSETS) ? self.__PRECACHE_ASSETS : ['./', './index.html'];

async function notifyClients(type, detail = {}) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type, appVersion: APP_VERSION, ...detail });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(`${CACHE_PREFIX}-`) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
    await notifyClients('SW_ACTIVATED');
  })());
});

async function fetchWithTimeout(request, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(request, { cache: 'no-store', signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function networkFirst(request, { navigation = false } = {}) {
  try {
    const response = await fetchWithTimeout(request);
    if (response?.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: navigation });
    if (cached) return cached;
    if (navigation) {
      const shell = await caches.match('./index.html') || await caches.match('./');
      if (shell) return shell;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response?.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') { event.respondWith(networkFirst(event.request, { navigation: true })); return; }
  const freshnessSensitive = /\.(?:js|css|webmanifest|json)$/i.test(url.pathname) || url.pathname.endsWith('/');
  event.respondWith(freshnessSensitive ? networkFirst(event.request) : cacheFirst(event.request));
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'CHECK_VERSION') event.source?.postMessage?.({ type: 'SW_VERSION', appVersion: APP_VERSION, cacheName: CACHE });
  if (type === 'CLEAR_RUNTIME_CACHE') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const keys = await cache.keys();
      await Promise.all(keys.filter((request) => !ASSETS.some((asset) => new URL(asset, self.location.href).href === request.url)).map((request) => cache.delete(request)));
      event.source?.postMessage?.({ type: 'RUNTIME_CACHE_CLEARED' });
    })());
  }
});
