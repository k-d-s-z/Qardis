# CHANGELOG — Qardis

Historia wydań przeniesiona z nagłówka `sw.js` (przy deploju `bump-sw.sh`
aktualizuje tylko linię „Build:” w `sw.js`; szczegóły zmian żyją tutaj).

## 2026-10-07 — wykres tętna, wykres w PDF, porządki po audycie

- **Wykres tętna** (ekran Trendy): seria HR z własną skalą na prawej osi (bpm);
  gdy ciśnienie nie jest śledzone, tętno używa lewej osi. Legenda „● HR” (napis w kolorze linii serii).
- **Wykres w PDF i wydruku**: pierwsza strona raportu to wykres przebiegu
  (SYS/DIA lewa oś mmHg, tętno prawa oś bpm) z całego zakresu raportu;
  okno „Drukuj” dostaje ten sam wykres jako inline SVG.
- **PDF bez blokowania UI**: kodowanie stron przez `canvas.toBlob` z oddawaniem
  sterowania między stronami (zamiast `toDataURL` + `atob`).
- **Placeholdery 120/80/70/75.0 usunięte** — pola pomiaru są jawnie puste
  (jasna cyfra z przykładu mogła wyglądać jak wypełnione pole).
- **Autofokus** na pierwszym widocznym polu pomiaru po otwarciu arkusza
  (bez auto-skoków między polami — SYS bywa dwucyfrowe).
- **Kolejność domyślna: od najnowszych**: lista pomiarów, tabela trendów, CSV,
  PDF, wydruk i podgląd archiwum prezentują wpisy od najnowszego na górze
  (bez opcji sortowania — min/maks pozostają w Trendach).

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

## 2026-10-07 (druga tura) — nawigacja po liście, touch-targety, testy

- **Scrubber miesięcy**: pasek po prawej krawędzi ekranu pomiarów —
  przeciągnięcie przenosi do wybranego miesiąca (widoczny, gdy pomiary
  obejmują co najmniej 2 miesiące).
- **Przycisk „Na początek listy”**: pojawia się po przewinięciu w dół,
  płynnie wraca na szczyt listy.
- **Touch-targety 44 px**: przyciski zakresów (7/30/90/Wszystkie) i
  przełączników segmentowych (PL/EN, S/M/L, parametry) mają rozszerzoną
  hit-area (`::after { inset: -6px }`) bez zmiany rozmiarów wizualnych.
- **Kontrast zielonego `+` w trybie ciemnym**: przyciemnione tło docka
  (`--dock: #101214ee`) — akcent bez zmian, kontrast komponentu ≥ 3:1.
- **Enter przeskakuje między polami formularza** (data → SYS → DIA → tętno →
  waga; pomija pola ukryte, textarea nietknięta).
- **Frame-busting dla GitHub Pages**: GH Pages nie pozwala ustawiać nagłówków
  (`frame-ancestors`, `X-Content-Type-Options`), więc aplikacja sama
  wychodzi z obcej ramki (`self !== top`).
- **Testy**: `sanitizeSettings` i scalanie archiwum (`mergeArchive`)
  przeniesione do core.js i pokryte testami (71/71).

## 2026-10-07 (trzecia tura) — bugfixy nawigacji i tabeli trendów

- **Naprawiona tabela trendów**: wywołanie rendererowi tabeli przekazywało
  o jeden argument za dużo (`settings` w miejscu callbacku tłumaczeń), przez
  co rysowanie wyrzucało wyjątek i tabela w ogóle się nie pojawiała.
- **Scrubber/przycisk „na początek" tylko na ekranie Pomiarów**: reguła
  `display: flex` przycisku nadpisywała atrybut `hidden` — dodane globalne
  `[hidden] { display: none !important }`; oba elementy znikają na Trendach.
- **Legenda skrótów nad tabelą trendów**: widoczny opis „SYS — ciśnienie
  skurczowe · DIA — ciśnienie rozkurczowe · HR — tętno (uderzenia na
  minutę)" (tylko śledzone parametry, PL/EN).

## 2026-10-07 (czwarta tura) — ciągłość tętna na wykresie, kolory serii na kartach

- **Brakujące tętno nie przerywa linii**: pomiar bez tętna robił na serii HR
  dziurę — teraz sąsiednie punkty z tętnem łączy jedna linia (punkty bez
  wartości po prostu nie są rysowane). To samo dotyczy serii SYS/DIA przy
  ewentualnych brakach.
- **Kolory serii z wykresu na kartach pomiarów**: przed wartością skurczową
  czerwona kropka (SYS), przed rozkurczową niebieska (DIA), ikona serca przy
  tętnie zielona (HR) — spójnie z legendą wykresu i motywem jasnym/ciemnym.
- **Kolory przy polach formularza**: etykiety pól Skurczowe/Rozkurczowe/Tętno
  w arkuszu dodawania/edycji dostają kropki w kolorach serii.
- Kolory serii wyznaczone zmiennymi CSS (`--c-sys/--c-dia/--c-hr`) w obu
  motywach.

## 2026-10-07 (piąta tura) — legenda pod wykresem, kolor wagi, odstępy kropek

- **Pełne opisy w legendzie wykresu**: kolorowa legenda nad wykresem pokazuje
  pełne nazwy parametrów po jednej na linię — „● SYS — ciśnienie skurczowe”,
  „● DIA — ciśnienie rozkurczowe”, „● HR — tętno (uderzenia na minutę)”
  (tylko śledzone serie; obszar wykresu automatycznie schodzi niżej);
  osobny opis pod wykresem i w tabeli trendów usunięty.
- **Kolor wagi**: fioletowa kropka przy etykiecie „Waga [kg]" w arkuszu
  pomiaru i fioletowa ikona wagi na kartach pomiarów — spójnie z SYS/DIA/HR.
- **Rozsunięte kropki na kartach**: wartości skurczowa i rozkurczowa
  dostają wyraźny odstęp od swoich kropek (flex + gap 10 px zamiast
  marginesów) — nie zlewają się w jeden ciąg.

## 2026-10-07 (szósta tura) — audyt: bugfix języka legendy, optymalizacja renderu

- **Legenda wykresu po zmianie języka**: opis „SYS — …” pod wykresem nie był
  przerysowany przy przełączeniu PL/EN w ustawieniach — teraz zmiana języka
  odświeża też wykres (drawTrends z wymuszeniem).
- **Render listy**: jedno sortowanie na przebieg render() (scrubber miesięcy
  dostaje już posortowaną tablicę zamiast sortować drugi raz).
- Audyt bez znalezisk krytycznych: testy 71/71, słowniki PL/EN kompletne,
  brak martwego kodu po refaktorach, escapowanie HTML w kartach/archiwum
  poprawne, service worker spójny z listą zasobów.

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