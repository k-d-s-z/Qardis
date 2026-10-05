/* Qardis Service Worker

   Wersjonowanie: nazwa cache powstaje z hasza SHA-256 zawartości zasobów,
   policzonego przy instalacji — ręczne podbijanie VERSION zostało usunięte.
   Uwaga operacyjna: przeglądarka i tak sprawdza sw.js bajt po bajcie przy
   nawigacji, więc zmiana któregokolwiek pliku wymaga zmiany także sw.js
   (choćby komentarza). Zawartość cache pozostaje świeża niezależnie od tego:
   nawigacja jest network-first, a app.js/ikony stale-while-revalidate.

   Audyt — niezawodność:
   1) Nawigacja: wyścig sieć vs 3 s — przy słabym zasięgu użytkownik
      natychmiast dostaje wersję z cache, zamiast czekać na timeout sieci.
   2) Instalacja: pobieranie zasobów w pętli z Promise.allSettled — brak
      jednej ikony nie blokuje instalacji (wyjątek: index.html jest wymagany).
   3) Wersja cache z hasha plików — koniec z zapominaniem o podbiciu. */

const PREFIX = "qardis-";
const NAV_TIMEOUT_MS = 3000;
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

let CACHE_NAME = null;

async function resolveCache() {
  if (CACHE_NAME) return CACHE_NAME;
  const keys = await caches.keys();
  const ours = keys.filter((k) => k.startsWith(PREFIX)).sort();
  CACHE_NAME = ours[ours.length - 1] || null;
  return CACHE_NAME;
}

async function hashBuffer(buf) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (e) {
    // Awaryjnie: FNV-1a (gdyby crypto.subtle było niedostępne)
    const bytes = new Uint8Array(buf);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16);
  }
}

// Pobiera wszystkie zasoby (tolerując braki), liczy hash i zapełnia cache.
async function installAndVersion() {
  const results = await Promise.allSettled(
    ASSETS.map((a) => fetch(a, { cache: "no-store" }))
  );
  let hashInput = "";
  const good = [];
  for (let i = 0; i < ASSETS.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled" || !r.value || !r.value.ok) continue;
    const res = r.value;
    const buf = await res.clone().arrayBuffer();
    hashInput += ASSETS[i] + ":" + (await hashBuffer(buf)) + "\n";
    good.push([ASSETS[i], res]);
  }
  if (!good.some((pair) => pair[0] === "./index.html")) {
    throw new Error("index.html unavailable at install time");
  }
  const version = await hashBuffer(new TextEncoder().encode(hashInput));
  const name = PREFIX + version.slice(0, 16);
  const cache = await caches.open(name);
  await Promise.allSettled(good.map((pair) => cache.put(pair[0], pair[1])));
  CACHE_NAME = name;
  return name;
}

self.addEventListener("install", (e) => {
  e.waitUntil(installAndVersion().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    resolveCache()
      .then(() =>
        caches.keys().then((keys) =>
          Promise.all(
            keys.filter((k) => k !== CACHE_NAME && k.startsWith(PREFIX)).map((k) => caches.delete(k))
          )
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Nawigacja: wyścig sieć vs 3 s, fallback do cache (offline / słaby zasięg)
  if (e.request.mode === "navigate") {
    const net = fetch(e.request, { cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          resolveCache().then((name) => {
            if (!name) return;
            caches.open(name).then((c) => c.put("./index.html", res.clone()));
          });
        }
        return res;
      })
      .catch(() => null);
    const timer = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
    e.respondWith(
      Promise.race([net, timer]).then((res) => {
        if (res) return res;
        return caches
          .match("./index.html")
          .then((m) => m || caches.match("./"))
          .then((m) => m || net); // brak cache: poczekaj, może sieć jeszcze odpowie
      })
    );
    return;
  }

  // Pozostałe zasoby: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            resolveCache().then((name) => {
              if (!name) return;
              caches.open(name).then((c) => c.put(e.request, res.clone()));
            });
          }
          return res;
        })
        .catch(() => cached || null);
      return cached || net;
    })
  );
});