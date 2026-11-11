const CACHE = "nextvo-admin-shell-v2";
const CACHE_PREFIX = "nextvo-admin-shell-";
const PRECACHE = ["/offline.html", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: "A network connection is required for this request." }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store, max-age=0" },
    })));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match("/offline.html"))));
    return;
  }

  if (url.pathname === "/offline.html" || url.pathname.startsWith("/icon-")) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(request).then((cached) => cached || fetch(request))));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    }))));
  }
});
