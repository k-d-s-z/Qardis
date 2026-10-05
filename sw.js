/* Qardis Service Worker
   Zasada działania: wersja cache to STAŁA poniżej. Przy każdym deploju
   podnieś ją ręcznie (np. na datę buildu) – to jedyny wymagany edit.
   Dlaczego nie Last-Modified: przeglądarka aktualizuje SW tylko przy
   zmianie bajtów pliku sw.js; wgranie samego index.html nie uruchamia
   install/activate, a cache-first bez rewalidacji zatrzymywałoby
   użytkowników na starej wersji na stałe.

   Strategia fetch:
   - żądania nawigacyjne (index.html): network-first → użytkownik zawsze
     dostaje świeżą wersję online; offline wraca ostatni dobry cache;
   - pozostałe GET z tego samego origin: cache-first z rewalidacją
     w tle (stale-while-revalidate) → szybkie ikony/manifest offline. */

const VERSION = "qardis-2026-10-04"; // ← podnieś przy każdym deploju
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

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Nawigacja: network-first, fallback do cache (offline / błąd sieci)
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() =>
          caches.match("./index.html").then((m) => m || caches.match("./"))
        )
    );
    return;
  }

  // Pozostałe zasoby: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

/* Nota dla przyszłego siebie: jeśli wyniesiesz JS z index.html do app.js,
   dodaj "./app.js" do ASSETS i podnieś VERSION. */