const CACHE_NAME = "clivelle-pwa-v4";
const BASE_URL = new URL("./", self.location.href);
const APP_SHELL = [
  "",
  "index.html",
  "styles.css",
  "app.js",
  "pwa.js",
  "manifest.webmanifest",
  "clivelle-icon.svg",
  "clivelle-logo.svg",
  "hero-editorial.svg",
  "story-editorial.svg",
  "cloud-scrunchie.svg",
  "marigold-barrette.svg",
  "mauve-claw.svg",
  "pearl-headband.svg",
  "petal-clip.svg",
  "ribbon-scrunchie.svg",
  "rosewood-claw.svg",
  "sunday-headband.svg"
].map((path) => new URL(path, BASE_URL).href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match(new URL("index.html", BASE_URL).href))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
