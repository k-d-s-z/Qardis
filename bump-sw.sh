#!/bin/bash
# bump-sw.sh — wymusza bajtową zmianę sw.js przy każdym deploju.
#
# Dlaczego: przeglądarka sprawdza sw.js bajt po bajcie przy nawigacji; bez
# zmiany pliku nowa instalacja się nie odpali, a aplikacja zostanie na starym
# cache. Skrypt dopisuje/aktualizuje linię "Build:" z datą w nagłówku sw.js.
#
# Idempotentny: wielokrotne uruchomienie nie powiększa nagłówka (puste linie
# przed zamknięciem komentarza są zwijane do jednej). Tylko POSIX (awk/mv) —
# działa tak samo na Linuksie i macOS; bez `sed -i`.
#
# Użycie:  ./bump-sw.sh            (sw.js w bieżącym katalogu)
#          ./bump-sw.sh katalog/   (ścieżka do katalogu ze sw.js)
set -eu

DIR="${1:-.}"
FILE="$DIR/sw.js"
[ -f "$FILE" ] || { echo "bump-sw: nie znaleziono $FILE" >&2; exit 1; }

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TMP="$FILE.tmp.$$"
trap 'rm -f "$TMP"' EXIT

awk -v b="   Build: $STAMP" '
  BEGIN { done = 0; held = 0 }
  /^   Build: / { next }                                  # usuń starą linię Build:
  !done && /^[[:space:]]*$/ { held++; next }              # wstrzymaj puste linie w nagłówku
  {
    if (!done && $0 ~ /^\*\/[[:space:]]*$/) {             # pierwsza linia zawierająca tylko "*/"
      print ""; print b; print "*/";
      done = 1; held = 0; next
    }
    while (held > 0) { print ""; held-- }
    print
  }
  END { if (!done) exit 2 }
' "$FILE" > "$TMP" || { echo "bump-sw: nie znaleziono zamknięcia komentarza nagłówka (*/ w osobnej linii)" >&2; exit 2; }

mv "$TMP" "$FILE"
trap - EXIT
echo "bump-sw: sw.js oznaczony jako $STAMP"
