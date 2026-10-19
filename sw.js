/* Qardis Service Worker â peÅna historia zmian: CHANGELOG.md.

   Wersjonowanie: nazwa cache powstaje z hasza SHA-256 zawartoÅci zasobÃ³w,
   policzonego przy instalacji. Uwaga operacyjna: przeglÄdarka sprawdza sw.js
   bajt po bajcie przy nawigacji, wiÄc przy deployu musi zmieniÄ siÄ takÅ¼e sam
   plik sw.js â bump-sw.sh aktualizuje liniÄ âBuild:â.

   Strategie: nawigacja network-first z wyÅcigiem 2 s; skrypty i style
   cache-first z bieÅ¼Äcego cache + odÅwieÅ¼anie w tle (cache jest nazwany
   hashem CAÅEGO zestawu, wiÄc trafienie jest zawsze spÃ³jne z wersjÄ HTML,
   a sÅaba sieÄ nie dodaje oczekiwania przy starcie); ikony i manifest
   stale-while-revalidate.

   Build: 2026-10-19T07:42:22Z
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

// Audyt: przeglÄdarka usypia workera (juÅ¼ po ~30 s bezczynnoÅci), a po wznowieniu
// install siÄ NIE odpala ponownie â CACHE_NAME zostaje null i wszystkie
// if (CACHE_NAME) milczÄ, a activate skasowaÅby jedyny istniejÄcy cache.
// Dlatego po wznowieniu przejmujemy istniejÄcy cache qardis-* z caches.keys().
async function ensureCacheName() {
  if (CACHE_NAME) return CACHE_NAME;
  const keys = await caches.keys();
  // Ostatni klucz z listy = najpÃ³Åºniej utworzony cache (kolejnoÅÄ tworzenia).
  // Teoretyczny scenariusz: uÅpienie miÄdzy install a activate zostawiÅoby
  // dwa cache â bierzemy nowszy, Å¼eby activate nie skasowaÅ wÅaÅciciela danych.
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

// Pobiera zasoby (tolerujÄc braki niekrytycznych), liczy hash i zapeÅnia cache.
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
  CACHE_NAME = name;   // jedyna prawda o aktualnym cache â ustalana tutaj
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

// Odczyt: najpierw aktualny cache (CACHE_NAME), dopiero potem wszystkie â
// caches.match bez wskazania zwraca trafienie z NAJSTARSZEGO cache.
async function matchCurrent(key) {
  if (CACHE_NAME) {
    try {
      const c = await caches.open(CACHE_NAME);
      const m = await c.match(key);
      if (m) return m;
    } catch (_) { /* przejdÅº do globalnego match */ }
  }
  return caches.match(key);
}

// Network-first z wyÅcigiem NAV_TIMEOUT_MS i fallbackiem do cache.
// UÅ¼ywane dla nawigacji ORAZ js/css â HTML i skrypty zawsze z tej samej "ÅwieÅ¼oÅci".
async function networkFirst(e, key) {
  await ensureCacheName();
  const net = fetch(e.request, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;   // bÅÄd HTTP = brak sieci -> fallback do cache
      if (CACHE_NAME) {
        const copy = res.clone();   // klon synchronicznie, zanim ciaÅo przeczyta strona
        try {
          const c = await caches.open(CACHE_NAME);
          await c.put(key, copy);
        } catch (_) { /* cache opcjonalny (limit pamiÄci) â odpowiedÅº sieci i tak zwracamy */ }
      }
      return res;
    })
    .catch(() => null);
  e.waitUntil(net);   // respondWith przedÅuÅ¼a Å¼ycie zdarzenia, wiÄc waitUntil po await jest dozwolone
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  const res = await Promise.race([net, timer]);
  if (res) return res;
  const m = (await matchCurrent(key)) || (key === "./index.html" ? await matchCurrent("./") : null);
  return m || (await net) || Response.error();
}

// Cache-first dla js/css z odÅwieÅ¼aniem w tle. Cache jest nazwany hashem
// CAÅEGO zestawu zasobÃ³w, wiÄc trafienie z bieÅ¼Äcego CACHE_NAME jest zawsze
// spÃ³jne z wersjÄ aplikacji; nowa wersja dochodzi po zmianie sw.js
// (bump-sw.sh) i nowej instalacji. Na sÅabej sieci start nie czeka na
// wyÅcig network-first â HTML i JS zawsze z tej samej "ÅwieÅ¼oÅci".
async function cacheFirstWithRevalidate(e) {
  await ensureCacheName();
  const cached = await matchCurrent(e.request);
  const update = fetch(e.request, { cache: "no-cache" })
    .then(async (res) => {
      if (!res.ok) return null;   // bÅÄd HTTP nie zastÄpuje cache
      if (CACHE_NAME) {
        const copy = res.clone();
        try {
          const c = await caches.open(CACHE_NAME);
          await c.put(e.request, copy);
        } catch (_) { /* cache opcjonalny (limit pamiÄci) */ }
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

  // PozostaÅe zasoby (ikony, manifest): stale-while-revalidate
  e.respondWith((async () => {
    await ensureCacheName();
    const cached = await matchCurrent(e.request);
    const update = fetch(e.request, { cache: "no-cache" })
      .then(async (res) => {
        if (!res.ok) return null;   // bÅÄd HTTP nie zastÄpuje cache
        if (CACHE_NAME) {
          const copy = res.clone();
          try {
            const c = await caches.open(CACHE_NAME);
            await c.put(e.request, copy);
          } catch (_) { /* bÅÄd zapisu nie moÅ¼e zamieniÄ udanej odpowiedzi sieci w bÅÄd */ }
        }
        return res;
      })
      .catch(() => null);
    e.waitUntil(update);
    return cached || (await update) || Response.error();
  })());
});