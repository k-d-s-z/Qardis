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
      storage) nie zamienia udanej odpowiedzi sieci w błąd dla użytkownika.
   7) Wydanie porządkowe: toasty przeniesione do klas CSS, zmienne z-index,
      CSP z img-src 'self'. Zmiana tego pliku wymusza przebudowę cache.
   8) Wydanie audytu UX/kodu: dirty-check arkusza edycji, eksport CSV,
      skróty klawiszowe strzałek, deduplikacja helperów dat i filtrowania.
   9) Wydanie "pola zamiast bębnów": numeryczne inputy dla SYS/DIA/HR,
      nowa ikona menu, wykres trendów (SVG) z przesuwaniem po osi czasu.
  10) Wykres w3: oś równa (kategoryczna) z przełącznikiem na oś czasu,
      okno do 4 pomiarów, etykiety liczby dni między pomiarami,
      kolory serii/legendy wymuszone klasami CSS.
  11) Wykres w3 poprawki: płynne przesuwanie (ułamkowy offset okna,
      przelicznik px SVG), przełącznik osi z aria-pressed.
  12) Szybkie fixy po audycie: usunięty martwy wheelClampWarn (i18n),
      resize wykresu z debounce, próg czytelności etykiet "X dni",
      touch target 44px dla przełącznika osi, wyrównanie pól numerycznych,
      myślniki w datach nazw plików (backup/CSV/archiwum).
  13) Bugfix: listener przełącznika osi z flagą jednorazowej rejestracji
      (kumulacja listenerów na kontenerze czyniła przycisk "martwym").
  14) Audyt 7-10: podgląd archiwum, kopia v3 "wszystko w jednym"
      (wpisy+archiwum+ustawienia), core.js z czystą logiką + tests.html,
      bump-sw.sh do automatyzacji wersjonowania przy deploju.
  15) Audyt 2026-10: instalacja sprawdza wynik cache.put dla zasobów
      krytycznych (niepełny cache = błąd instalacji, nie ciche "działa");
      skrypty i style (js/css) używają tej samej strategii co nawigacja
      (network-first z wyścigiem 2 s) — koniec rozjazdu nowy HTML + stary JS;
      odczyt z cache najpierw z aktualnego CACHE_NAME, dopiero potem globalnie.

   Build: 2026-10-06T07:11:12Z
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

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith(networkFirst(e, "./index.html"));
    return;
  }
  if (e.request.destination === "script" || e.request.destination === "style") {
    e.respondWith(networkFirst(e, e.request));
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
