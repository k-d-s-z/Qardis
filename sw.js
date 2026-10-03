/* Qardis Service Worker
   Wersjonowanie automatyczne: nazwa cache powstaje z nagłówka Last-Modified
   pliku index.html na serwerze (data deployu/buildu). Po każdym wgraniu
   nowego index.html zmienia się data → zmienia się nazwa cache → stare
   cache są usuwane, a użytkownicy dostają świeżą wersję. Nic nie trzeba
   edytować ręcznie. */

const PREFIX = "qardis-";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

async function buildVersion() {
  try {
    const res = await fetch("./index.html", { cache: "no-store" });
    const lm = res.headers.get("last-modified");
    if (lm) {
      const stamp = new Date(lm)
        .toISOString()
        .replace(/[:T]/g, "-")
        .slice(0, 16); // np. qardis-2026-10-03-14-22
      return PREFIX + stamp;
    }
  } catch (e) { /* offline przy instalacji – fallback niżej */ }
  return PREFIX + Date.now();
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    buildVersion()
      .then((name) => caches.open(name).then((c) => c.addAll(ASSETS)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    buildVersion()
      .then(async (name) => {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => !k.startsWith(PREFIX) || k !== name)
            .map((k) => caches.delete(k))
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok && e.request.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          buildVersion().then((name) =>
            caches.open(name).then((c) => c.put(e.request, copy))
          );
        }
        return res;
      }).catch(() => cached);
    })
  );
});