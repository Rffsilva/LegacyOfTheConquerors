// Service worker template; vite.config.ts fills in VERSION and FILES at build time.
// Precaches the whole game on install so it runs offline, serves it cache-first, and waits
// for the page to ask before switching to a new version mid-session.

const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `lotc-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', ...FILES.map((f) => `./${f}`)])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('lotc-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Servers often send Vary: Origin/Accept-Encoding; module scripts are requested with an
      // Origin header the precache requests lacked, so ignore Vary or nothing would match.
      const options = { ignoreSearch: true, ignoreVary: true };
      // Any page load (e.g. ?scen=scen3) gets the app shell.
      if (request.mode === 'navigate') {
        return (await cache.match('./', options)) ?? fetch(request);
      }
      const cached = await cache.match(request, options);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })(),
  );
});
