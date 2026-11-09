const PREFIX = 'pokeradar-shell-';
const CACHE = PREFIX + 'v11';
const SHELL = [
  './', './index.html', './achats-30-ans.html', './styles.css', './app.mjs', './catalog.mjs', './domain.mjs',
  './storage.mjs', './watch.mjs', './manifest.webmanifest', './assets/radar.svg', './assets/field.svg',
  './assets/radar-180.png', './assets/radar-192.png', './assets/radar-512.png'
];
const scope = self.registration.scope;
const index = new URL('index.html', scope).href;
const shellUrls = new Set(SHELL.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...shellUrls].map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.hash = '';
  if (request.mode === 'navigate') url.search = '';
  const cacheKey = url.href === scope ? index : url.href;
  if (!shellUrls.has(cacheKey)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(cacheKey) ?? fetch(request);
  })());
});
