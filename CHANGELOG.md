# CHANGELOG — Qardis

Historia wydań przeniesiona z nagłówka `sw.js` (przy deploju `bump-sw.sh`
aktualizuje tylko linię „Build:” w `sw.js`; szczegóły zmian żyją tutaj).

## 2026-10-07 — wykres tętna, wykres w PDF, porządki po audycie

- **Wykres tętna** (ekran Trendy): seria HR z własną skalą na prawej osi (bpm);
  gdy ciśnienie nie jest śledzone, tętno używa lewej osi. Legenda „● HR”.
- **Wykres w PDF i wydruku**: pierwsza strona raportu to wykres przebiegu
  (SYS/DIA lewa oś mmHg, tętno prawa oś bpm) z całego zakresu raportu;
  okno „Drukuj” dostaje ten sam wykres jako inline SVG.
- **PDF bez blokowania UI**: kodowanie stron przez `canvas.toBlob` z oddawaniem
  sterowania między stronami (zamiast `toDataURL` + `atob`).
- **Placeholdery 120/80/70/75.0 usunięte** — pola pomiaru są jawnie puste
  (jasna cyfra z przykładu mogła wyglądać jak wypełnione pole).
- **Autofokus** na pierwszym widocznym polu pomiaru po otwarciu arkusza
  (bez auto-skoków między polami — SYS bywa dwucyfrowe).
- **Prezentacja chronologiczna**: lista pomiarów, tabela trendów, CSV, PDF,
  wydruk i podgląd archiwum posortowane od najstarszego (min/maks pozostają
  w Trendach).
- `gapLabel`: pomiary z tego samego dnia mają etykietę „ten sam dzień” /
  „same day” (zamiast „0 d”).
- **Uproszczenia kodu**: `showFormError` zamiast pięciu bloków błędów w
  `btnSave`; `ValidationModule` i `TableModule` spłaszczone do funkcji;
  `bindSegmented` dla języka i czcionki; klucze backupu wyprowadzone z
  wartości domyślnych; helper `bpString`; `sanitizeSettings(s, false)` poprawione.
- **Optymalizacje**: buforowane `Intl.DateTimeFormat` per locale; scalanie
  importu wydzielone do `QardisCore.mergeImported` (testowane w tests.js).
- **`csvEscape`**: prefiks `'` tylko dla wzorców wyglądających jak formuła
  (`=`, `@`, `+`/`-` przed cyfrą/nawiasem) — notatka „- zmęczony” zostaje bez zmian.
- **`sw.js`**: js/css cache-first z bieżącego cache (spójna wersja, brak
  wyścigu 2 s na słabej sieci) + odświeżanie w tle.
- Kosmetyka: `.wheels`/`.wheel-box`/`syncOptionalWheels` → `.fields`/
  `.field-box`/`syncOptionalFields`; komentarze-changelog usunięte z kodu.

## Wcześniejsze wydania (z nagłówka sw.js)

1) Nazwa cache JAWNA: ustala ją instalacja i trzyma w CACHE_NAME.
2) Krytyczne zasoby (index.html, app.js, style.css, manifest) wymagane do
   instalacji; ikony opcjonalne.
3) Odpowiedź HTTP z błędem (5xx) = fallback do cache zamiast strony błędu.
4) Wyścig nawigacji skrócony do 2 s; bez awaryjnego hashowania.
5) Worker po wznowieniu odzyskuje CACHE_NAME z caches.keys() (ensureCacheName).
6) Zapis do cache w try/catch — błąd nie psuje udanej odpowiedzi sieci.
7) Toasty w klasach CSS, zmienne z-index, CSP z img-src 'self'.
8) Dirty-check arkusza edycji, eksport CSV, skróty strzałek, deduplikacja
   helperów dat i filtrowania.
9) „Pola zamiast bębnów”: numeryczne inputy dla SYS/DIA/HR, wykres trendów
   (SVG) z przesuwaniem po osi czasu.
10) Wykres w3: oś równa z przełącznikiem na oś czasu, okno do 4 pomiarów,
    etykiety liczby dni, kolory serii/legendy w CSS.
11) Wykres w3 poprawki: płynne przesuwanie (ułamkowy offset), aria-pressed.
12) Fixy: martwy wheelClampWarn, resize z debounce, próg czytelności etykiet,
    touch target 44px, myślniki w datach nazw plików.
13) Bugfix: jednorazowa rejestracja listenera przełącznika osi.
14) Podgląd archiwum, kopia v3 „wszystko w jednym”, core.js + tests.html,
    bump-sw.sh.
15) Instalacja sprawdza wynik cache.put; odczyt z cache najpierw z aktualnego
    CACHE_NAME, potem globalnie.