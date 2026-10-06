# Qardis — poprawki po audycie (2026-10-06)

## Integralność danych
- Data wpisu walidowana (2000–2099) w formularzu i przy zapisie — wpis nie znika już po odświeżeniu (app.js `btnSave`, core.js `validFormTs`).
- Koniec cichego przycinania wartości: SYS/DIA/tętno poza zakresem dają błąd zamiast zapisu przyciętej liczby (`makeNumField.get`).
- Nowy wpis ma puste pola (zamiast podstawionego poprzedniego pomiaru).
- „Zapisano” pokazuje się dopiero po udanym zapisie; błąd zapisu jest pilnym toastem.
- Edycja wpisu usuniętego w innej karcie tworzy nowy wpis zamiast po cichu nic nie zapisać.
- Edycja starego wpisu z pustym (wcześniej niemonitorowanym) parametrem jest możliwa.
- Pierwsza kopia `.corrupt` nie jest nadpisywana; przycisk eksportu odświeża się przy otwarciu menu.
- Odświeżanie stanu po powrocie do karty (`visibilitychange`, `pageshow`, `focus`).

## Wykres i gesty
- Wykres otwiera się na najnowszych pomiarach.
- Przeciąganie wykresu nie przełącza już ekranów.
- Brak starego `chartCtx` po pustym zakresie.
- Kontrast legendy (≥ 4,5:1), osie 11 px.

## Eksport / import
- CSV: neutralizacja formuł (`= + - @`), cytowanie `\r`, przecinek dziesiętny w trybie PL.
- PDF: kolumny zgodne z monitorowanymi parametrami, fallback dla Safari < 16.4 (CSSOM `insertRule`).
- Import: duplikaty wykrywane też po (ts + wartości), liczby jako stringi akceptowane, wpisy archiwum kolidujące z listą pomijane.

## Service Worker i wdrożenie
- Instalacja sprawdza wynik `cache.put` dla zasobów krytycznych.
- `js`/`css` jak nawigacja: network-first z wyścigiem 2 s (koniec rozjazdu HTML ↔ JS).
- Odczyt najpierw z aktualnego `CACHE_NAME`.
- `bump-sw.sh`: LF, bez `sed -i`, idempotentny (nagłówek nie rośnie). `.gitattributes` pilnuje LF.

## Dostępność
- `role="dialog"`/`aria-modal` na `.sheet`; okno potwierdzenia blokuje arkusz pod spodem i zwraca fokus; ukryty `h1`; grupa „Monitorowane parametry” ma etykietę.

## Raport: „Zapisz jako PDF” i „Drukuj” (osobne opcje)
- Menu → „Raport: zapisz PDF lub drukuj” → wybór zakresu → dwa przyciski.
- **Zapisz jako PDF** tworzy plik `qardis-raport-RRRR-MM-DD.pdf` i pobiera go bez okna drukowania (A4 poziomo, nagłówek tabeli na każdej stronie, numeracja stron, kolumny zgodne z monitorowanymi parametrami). Generator jest wbudowany (core.js `buildPdf`), bez bibliotek i bez zmian w CSP. Strony są obrazami JPEG, więc tekst w pliku nie jest zaznaczalny.
- **Drukuj** działa jak dotąd (okno wydruku, tekst zaznaczalny).
- Testy: `wrapText`, `buildPdf` (struktura, offsety xref) — razem 50 przypadków.

## Testy
- `tests.html` / `tests.js` (50 przypadków): `node tests.js` lub otwórz `tests.html`.

## Znane ograniczenia (nie zmienione)
- Scalanie między kartami nadal jest sumą zbiorów — pełne rozwiązanie wymaga znaczników usunięcia (tombstones) i zmiany formatu danych.
- Nie dostarczono manifest.webmanifest ani ikon — nie były audytowane.
- app.js sprawdzony składniowo i testami logiki (core.js); pełny test w przeglądarce należy wykonać ręcznie.
