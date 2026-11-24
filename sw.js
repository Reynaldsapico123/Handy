const CACHE_NAME = "handy-v15";
const APP_SHELL = [
  "/",
  "/index.html",
  "/calculator.html",
  "/unit-converter.html",
  "/timer.html",
  "/guides.html",
  "/world-clock.html",
  "/currency.html",
  "/qr-code.html",
  "/icons/handy-192.png",
  "/icons/handy-512.png",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/social-preview.svg"
];
const TOOL_ASSETS = [
  "/calculator.js",
  "/unit-converter.js",
  "/timer.js",
  "/guides.js",
  "/world-clock.js",
  "/currency.js",
  "/qr-code.js",
  "/node_modules/qrcode-generator/dist/qrcode.js",
  "/node_modules/jsqr/dist/jsQR.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch("/index.html");
    if (!response.ok) throw new Error("Could not load the app shell for offline caching.");
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)]
      .map(([, asset]) => new URL(asset, self.location.origin))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => `${url.pathname}${url.search}`);
    const buildId = html.match(/<meta name="handy-build" content="([^"]+)"/)?.[1];
    if (!buildId) throw new Error("Could not determine the app build for offline caching.");
    const toolAssets = TOOL_ASSETS.map((asset) => `${asset}?v=${encodeURIComponent(buildId)}`);
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...new Set([...APP_SHELL, ...assets, ...toolAssets])]);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const appShell = await caches.match("/index.html");
          if (appShell) return appShell;
        }
        throw error;
      }
    })()
  );
});
