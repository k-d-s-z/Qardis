# Qardis - poprawki po audycie (2026-10-06)

## Integralnosc danych
- Data wpisu walidowana (2000-2099) w formularzu i przy zapisie - wpis nie znika juz po odswiezeniu (app.js `btnSave`, core.js `validFormTs`).
- Koniec cichego przycinania wartosci: SYS/DIA/tetno poza zakresem daja blad zamiast zapisu przycietej liczby (`makeNumField.get`).
- Nowy wpis ma puste pola (zamiast podstawionego poprzedniego pomiaru).
- "Zapisano" pokazuje sie dopiero po udanym zapisie; blad zapisu jest pilnym toastem.
- Edycja wpisu usunietego w innej karcie tworzy nowy wpis zamiast po cichu nic nie zapisac.
- Edycja starego wpisu z pustym (wczesniej niemonitorowanym) parametrem jest mozliwa.
- Pierwsza kopia `.corrupt` nie jest nadpisywana; przycisk eksportu odswieza sie przy otwarciu menu.
- Odswiezanie stanu po powrocie do karty (`visibilitychange`, `pageshow`, `focus`).

## Wykres i gesty
- Wykres otwiera sie na najnowszych pomiarach.
- Przeciaganie wykresu nie przelacza juz ekranow.
- Brak starego `chartCtx` po pustym zakresie.
- Kontrast legendy (>= 4,5:1), osie 11 px.

## Eksport / import
- CSV: neutralizacja formul (`= + - @`), cytowanie `\r`, przecinek dziesietny w trybie PL.
- PDF: kolumny zgodne z monitorowanymi parametrami, fallback dla Safari < 16.4 (CSSOM `insertRule`).
- Import: duplikaty wykrywane tez po (ts + wartosci), liczby jako stringi akceptowane, wpisy archiwum kolidujace z lista pomijane.

## Service Worker i wdrozenie
- Instalacja sprawdza wynik `cache.put` dla zasobow krytycznych.
- `js`/`css` jak nawigacja: network-first z wyscigiem 2 s (koniec rozjazdu HTML <-> JS).
- Odczyt najpierw z aktualnego `CACHE_NAME`.
- `bump-sw.sh`: LF, bez `sed -i`, idempotentny (naglowek nie rosnie). `.gitattributes` pilnuje LF.

## Dostepnosc
- `role="dialog"`/`aria-modal` na `.sheet`; okno potwierdzenia blokuje arkusz pod spodem i zwraca fokus; ukryty `h1`; grupa "Monitorowane parametry" ma etykiete.

## Raport: "Zapisz jako PDF" i "Drukuj" (osobne opcje)
- Menu -> "Raport: zapisz PDF lub drukuj" -> wybor zakresu -> dwa przyciski.
- **Zapisz jako PDF** tworzy plik `qardis-raport-RRRR-MM-DD.pdf` i pobiera go bez okna drukowania (A4 poziomo, naglowek tabeli na kazdej stronie, numeracja stron, kolumny zgodne z monitorowanymi parametrami). Generator jest wbudowany (core.js `buildPdf`), bez bibliotek i bez zmian w CSP. Strony sa obrazami JPEG, wiec tekst w pliku nie jest zaznaczalny.
- **Drukuj** dziala jak dotad (okno wydruku, tekst zaznaczalny).
- Testy: `wrapText`, `buildPdf` (struktura, offsety xref) - razem 50 przypadkow.

## Testy
- `tests.html` / `tests.js` (50 przypadkow): `node tests.js` lub otworz `tests.html`.

## Znane ograniczenia (nie zmienione)
- Scalanie miedzy kartami nadal jest suma zbiorow - pelne rozwiazanie wymaga znacznikow usuniecia (tombstones) i zmiany formatu danych.
- Nie dostarczono manifest.webmanifest ani ikon - nie byly audytowane.
- app.js sprawdzony skladniowo i testami logiki (core.js); pelny test w przegladarce nalezy wykonac recznie.

## Zmiany po przegladadzie (2026-10-06)
- Domyslny zakres Trendow i raportu PDF: "Wszystkie" zamiast 30 dni.
- Sprzatanie: usuniete defSys/defDia/defHr, fromLoad, 3. parametr lastKnown, id=themeColorMeta, martwa regula CSS .wheel-box.input-mode::after, labelWheels wciagniete do syncOptionalWheels, scalony podwojny listener tetna, DAY_MS w reportEntries.
- app.js dostarczony w czystym ASCII (polskie znaki jako \uXXXX) - odporny na uszkodzenie kodowania.