/* Qardis Service Worker — pełna historia zmian: CHANGELOG.md.

   Wersjonowanie: nazwa cache powstaje z hasza SHA-256 zawartości zasobów,
   policzonego przy instalacji. Uwaga operacyjna: przeglądarka sprawdza sw.js
   bajt po bajcie przy nawigacji, więc przy deployu musi zmienić się także sam
   plik sw.js — bump-sw.sh aktualizuje linię „Build:”.

   Strategie: nawigacja network-first z wyścigiem 2 s; skrypty i style
   cache-first z bieżącego cache + odświeżanie w tle (cache jest nazwany
   hashem CAŁEGO zestawu, więc trafienie jest zawsze spójne z wersją HTML,
   a słaba sieć nie dodaje oczekiwania przy starcie); ikony i manifest
   stale-while-revalidate.

   Build: 2026-10-07T09:23:54Z
*/
const PREFIX = "qardis-";
const NAV_TIMEOUT_MS = 2000;
const ASSETS = [
  "./",
  "./index.html",
  "./core.js",
  "./app.js",
  "./style.css",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];
const REQUIRED = ["./index.html", "./core.js", "./app.js", "./style.css", "./manifest.webmanifest"];

let CACHE_NAME = null;

// Audyt: przeglądarka usypia workera (już po ~30 s bezczynności), a po wznowieniu
// install się NIE odpala ponownie — CACHE_NAME zostaje null i wszystkie
// if (CACHE_NAME) milczą, a activate skasowałby jedyny istniejący cache.
// Dlatego po wznowieniu przejmujemy istniejący cache qardis-* z caches.keys().
async function ensureCacheName() {
  if (CACHE_NAME) return CACHE_NAME;
  const keys = await caches.keys();
  // Ostatni klucz z listy = najpóźniej utworzony cache (kolejność tworzenia).
  // Teoretyczny scenariusz: uśpienie między install a activate zostawiłoby
  // dwa cache — bierzemy nowszy, żeby activate nie skasował właściciela danych.
  const found = keys.filter((k) => k.startsWith(PREFIX)).pop();
  if (found) CACHE_NAME = found;
  return CACHE_NAME;
}

async function hashBuffer(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Pobiera zasoby (tolerując braki niekrytycznych), liczy hash i zapełnia cache.
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
  const got = Object.create(null);
  good.forEach((pair) => { got[pair[0]] = 1; });
  for (const req of REQUIRED) {
    if (!got[req]) throw new Error("critical asset unavailable: " + req);
  }
  const version = await hashBuffer(new TextEncoder().encode(hashInput));
  const name = PREFIX + version.slice(0, 16);
  const existed = await caches.has(name);
  const cache = await caches.open(name);
  const puts = await Promise.allSettled(good.map((pair) => cache.put(pair[0], pair[1])));
  const failed = good.filter((pair, i) => puts[i].status === "rejected" && REQUIRED.indexOf(pair[0]) >= 0);
  if (failed.length) {
    if (!existed) { try { await caches.delete(name); } catch (_) {} }
    throw new Error("cache write failed: " + failed.map((p) => p[0]).join(", "));
  }
  CACHE_NAME = name;   // jedyna prawda o aktualnym cache — ustalana tutaj
  return name;
}

self.addEventListener("install", (e) => {
  e.waitUntil(installAndVersion().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    ensureCacheName()
      .then(() => caches.keys())
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k.startsWith(PREFIX)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Odczyt: najpierw aktualny cache (CACHE_NAME), dopiero potem wszystkie —
// caches.match bez wskazania zwraca trafienie z NAJSTARSZEGO cache.
async function matchCurrent(key) {
  if (CACHE_NAME) {
    try {
      const c = await caches.open(CACHE_NAME);
      const m = await c.match(key);
      if (m) return m;
    } catch (_) { /* przejdź do globalnego match */ }
  }
  return caches.match(key);
}

// Network-first z wyścigiem NAV_TIMEOUT_MS i fallbackiem do cache.
// Używane dla nawigacji ORAZ js/css — HTML i skrypty zawsze z tej samej "świeżości".
async function networkFirst(e, key) {
  await ensureCacheName();
  const net = fetch(e.request, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;   // błąd HTTP = brak sieci -> fallback do cache
      if (CACHE_NAME) {
        const copy = res.clone();   // klon synchronicznie, zanim ciało przeczyta strona
        try {
          const c = await caches.open(CACHE_NAME);
          await c.put(key, copy);
        } catch (_) { /* cache opcjonalny (limit pamięci) — odpowiedź sieci i tak zwracamy */ }
      }
      return res;
    })
    .catch(() => null);
  e.waitUntil(net);   // respondWith przedłuża życie zdarzenia, więc waitUntil po await jest dozwolone
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  const res = await Promise.race([net, timer]);
  if (res) return res;
  const m = (await matchCurrent(key)) || (key === "./index.html" ? await matchCurrent("./") : null);
  return m || (await net) || Response.error();
}

// Cache-first dla js/css z odświeżaniem w tle. Cache jest nazwany hashem
// CAŁEGO zestawu zasobów, więc trafienie z bieżącego CACHE_NAME jest zawsze
// spójne z wersją aplikacji; nowa wersja dochodzi po zmianie sw.js
// (bump-sw.sh) i nowej instalacji. Na słabej sieci start nie czeka na
// wyścig network-first — HTML i JS zawsze z tej samej "świeżości".
async function cacheFirstWithRevalidate(e) {
  await ensureCacheName();
  const cached = await matchCurrent(e.request);
  const update = fetch(e.request, { cache: "no-cache" })
    .then(async (res) => {
      if (!res.ok) return null;   // błąd HTTP nie zastępuje cache
      if (CACHE_NAME) {
        const copy = res.clone();
        try {
          const c = await caches.open(CACHE_NAME);
          await c.put(e.request, copy);
        } catch (_) { /* cache opcjonalny (limit pamięci) */ }
      }
      return res;
    })
    .catch(() => null);
  e.waitUntil(update);
  if (cached) return cached;
  return (await update) || Response.error();
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith(networkFirst(e, "./index.html"));
    return;
  }
  if (e.request.destination === "script" || e.request.destination === "style") {
    e.respondWith(cacheFirstWithRevalidate(e));
    return;
  }

  // Pozostałe zasoby (ikony, manifest): stale-while-revalidate
  e.respondWith((async () => {
    await ensureCacheName();
    const cached = await matchCurrent(e.request);
    const update = fetch(e.request, { cache: "no-cache" })
      .then(async (res) => {
        if (!res.ok) return null;   // błąd HTTP nie zastępuje cache
        if (CACHE_NAME) {
          const copy = res.clone();
          try {
            const c = await caches.open(CACHE_NAME);
            await c.put(e.request, copy);
          } catch (_) { /* błąd zapisu nie może zamienić udanej odpowiedzi sieci w błąd */ }
        }
        return res;
      })
      .catch(() => null);
    e.waitUntil(update);
    return cached || (await update) || Response.error();
  })());
});