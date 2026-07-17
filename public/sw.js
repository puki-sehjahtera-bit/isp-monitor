const CACHE = "isp-monitor-v4";
const STATIC = ["/", "/style.css", "/app.js", "/chart.min.js", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Jangan cache API / realtime socket — selalu lewat network.
  if (e.request.url.includes("/api") || e.request.url.includes("/socket.io") || e.request.url.includes("/events")) {
    return fetch(e.request).catch(() => new Response(null, { status: 503 }));
  }
  // Navigasi: network-first, fallback ke cache kalau offline.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Asset statis: network-first supaya update tampil langsung tanpa bump manual.
  e.respondWith(
    fetch(e.request).then((res) => {
      const ct = res.headers.get("Content-Type") || "";
      if (res.ok && (ct.includes("text") || ct.includes("javascript") || ct.includes("image"))) {
        caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
