/* Qardis Service Worker

   Wersjonowanie: nazwa cache powstaje z hasza SHA-256 zawartości zasobów,
   policzonego przy instalacji — ręczne podbijanie VERSION nie istnieje.
   Uwaga operacyjna: przeglądarka sprawdza sw.js bajt po bajcie przy nawigacji,
   więc przy deploju musi zmienić się także sam plik sw.js (choćby komentarz).
   Świeżość danych zapewniają strategie: nawigacja network-first z wyścigiem
   2 s, app.js/ikony stale-while-revalidate.

   Audyt — refaktoryzacja po audytach:
   1) Nazwa cache jest JAWNA: ustala ją instalacja i trzyma w CACHE_NAME.
      Koniec ze zgadywaniem "najnowszego" cache po sortowaniu nazw —
      fetch może najwyżej pominąć cache, dopóki instalacja trwa.
   2) Krytyczne zasoby (index.html, app.js, style.css, manifest) są
      wymagane do instalacji; ikony są opcjonalne.
   3) Odpowiedź HTTP z błędem (5xx itp.) jest traktowana jak brak sieci
      i następuje fallback do cache — użytkownik nie widzi strony
      błędu hotelowego Wi-Fi, skoro w cache jest działająca wersja.
   4) Wyścig nawigacji skrócony do 2 s; usunięto fallback hashowania
      awaryjnego (crypto.subtle dostępne wszędzie, gdzie działa SW).
   5) Worker po wznowieniu odzyskuje CACHE_NAME z caches.keys()
      (ensureCacheName) — uśpiony worker nie ma w pamięci nazwy cache.
   6) Zapis do cache jest w try/catch: błąd (limit pamięci, wyczyszczony
      storage) nie zamienia udanej odpowiedzi sieci w błąd dla użytkownika. */

const PREFIX = "qardis-";
const NAV_TIMEOUT_MS = 2000;
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./style.css",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];
const REQUIRED = ["./index.html", "./app.js", "./style.css", "./manifest.webmanifest"];

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
  const cache = await caches.open(name);
  await Promise.allSettled(good.map((pair) => cache.put(pair[0], pair[1])));
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

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Nawigacja: wyścig sieć vs 2 s, fallback do cache (offline / słaby zasięg)
  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      await ensureCacheName();
      const net = fetch(e.request, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return null;   // audyt: błąd HTTP = brak sieci -> fallback do cache
          if (CACHE_NAME) {
            // Klon synchronicznie — zanim przeglądarka zacznie czytać ciało odpowiedzi.
            const copy = res.clone();
            try {
              const c = await caches.open(CACHE_NAME);
              await c.put("./index.html", copy);
            } catch (_) { /* cache jest opcjonalny (limit pamięci, wyczyszczony storage) — odpowiedź sieci i tak zwracamy */ }
          }
          return res;
        })
        .catch(() => null);
      // waitUntil rejestrowane SYNCHRONICZNIE: gdy wygra timer 2 s, respondWith
      // rozstrzyga się wcześniej i późniejsze waitUntil rzuciłoby InvalidStateError.
      e.waitUntil(net);
      const timer = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
      const res = await Promise.race([net, timer]);
      if (res) return res;
      // Brak cache: poczekaj, może sieć jeszcze odpowie.
      const m = (await caches.match("./index.html")) || (await caches.match("./"));
      return m || (await net) || Response.error();
    })());
    return;
  }

  // Pozostałe zasoby: stale-while-revalidate
  e.respondWith((async () => {
    await ensureCacheName();
    const cached = await caches.match(e.request);
    const update = fetch(e.request, { cache: "no-cache" })
      .then(async (res) => {
        if (!res.ok) return null;   // audyt: błąd HTTP nie zastępuje cache
        if (CACHE_NAME) {
          const copy = res.clone();   // klon synchronicznie, zanim ciało przeczyta strona
          try {
            const c = await caches.open(CACHE_NAME);
            await c.put(e.request, copy);
          } catch (_) { /* błąd zapisu nie może zamienić udanej odpowiedzi sieci w błąd */ }
        }
        return res;
      })
      .catch(() => null);
    // Rejestrujemy BEFORE zwróceniem cached — po rozstrzygnięciu respondWith
    // zdarzenie fetch jest już zamknięte i waitUntil rzuciłby InvalidStateError.
    e.waitUntil(update);
    return cached || (await update) || Response.error();
  })());
});