/* Qardis Core — czysta, testowalna logika bez DOM.
   Współdzielona przez app.js (produkcja) i tests.html (testy jednostkowe).
   CSP: ładowane z 'self', przed app.js. */

window.QardisCore = (function(){
  "use strict";

  // Jedno źródło limitów wartości (sanityzacja, import i pola numeryczne).
  var LIMITS = { sys:[50,300], dia:[30,200], hr:[20,250], wgt:[20,300] };
  var MAX_TS = 4102444800000;   // 2100-01-01
  var MIN_TS = 946684800000;    // 2000-01-01 (dolna granica dla formularza; import/ładowanie akceptuje >= 0)

  function sanitizeEntry(e){
    if (!e || typeof e !== "object") return null;
    function num(v, lo, hi){
      if (typeof v === "string" && /^\s*\d+([.,]\d+)?\s*$/.test(v)) v = parseFloat(v.replace(",", "."));
      return (typeof v === "number" && isFinite(v) && v >= lo && v <= hi) ? v : null;
    }
    var ts = (typeof e.ts === "number" && isFinite(e.ts) && e.ts >= 0 && e.ts <= MAX_TS) ? e.ts : null;
    if (ts === null) return null;
    return {
      id: (typeof e.id === "string" && e.id.length > 0 && e.id.length <= 100) ? e.id : null,
      ts: ts,
      sys: num(e.sys, LIMITS.sys[0], LIMITS.sys[1]),
      dia: num(e.dia, LIMITS.dia[0], LIMITS.dia[1]),
      hr:  num(e.hr,  LIMITS.hr[0],  LIMITS.hr[1]),
      wgt: num(e.wgt, LIMITS.wgt[0], LIMITS.wgt[1]),
      note: typeof e.note === "string" ? e.note.slice(0, 2000) : ""
    };
  }

  // Czy sanityzacja utraciła jakąkolwiek wartość (sys/dia/hr/wgt)?
  function lossy(orig, clean){
    return ["sys","dia","hr","wgt"].some(function(k){ return orig[k] != null && clean[k] === null; });
  }

  // Escapowanie pola CSV zgodne z RFC 4180 (separator: ';').
  // decimalComma: liczby z przecinkiem dziesiętnym (polski Excel czyta "75.5" jako tekst).
  // Teksty wyglądające jak formuła arkusza (= , @ , +-/cyfra lub nawias, tab/CR)
  // dostają prefiks ', żeby arkusz ich nie wykonał; zwykłe notatki ("- zmęczony")
  // pozostają bez zmian.
  function csvEscape(v, decimalComma){
    if (v == null) return "";
    var s;
    if (typeof v === "number") {
      s = String(v);
      if (decimalComma) s = s.replace(".", ",");
    } else {
      s = String(v);
      // Ochrona przed formułami arkusza, ale TYLKO dla wzorców wyglądających
      // jak formuła: "=...", "@...", tab/CR oraz liczba lub nawias po "-"/"+".
      // Zwykła notatka "- zmęczony" nie jest modyfikowana.
      if (/^[=@\t\r]/.test(s) || /^[+\-][0-9.(`]/.test(s)) s = "'" + s;
    }
    return /[";\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Poprawny znacznik czasu dla nowego/edytowanego wpisu z formularza.
  function validFormTs(ts){ return typeof ts === "number" && isFinite(ts) && ts >= MIN_TS && ts <= MAX_TS; }

  // Sygnatura odczytu — wykrywanie duplikatów przy imporcie z innego urządzenia (inne id, te same dane).
  function entrySig(e){ return [e.ts, e.sys, e.dia, e.hr, e.wgt].join("|"); }

  // Pluralizacja liczby wpisów (pl: wpis/wpisy/wpisów, en: entry/entries).
  function pluralEntries(n, lang){
    if (lang === "en") return n === 1 ? " entry." : " entries.";
    if (n === 1) return " wpis.";
    var m10 = n % 10, m100 = n % 100;
    return (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) ? " wpisy." : " wpisów.";
  }

  // Interpolacja znacznika czasu dla ułamkowego indeksu na osi X (wykres):
  // tsAt(f) = liniowy lerp ts między indeksem floor(f) a floor(f)+1.
  // Testy wykryły: f musi być clampowane PRZED lerpem (ujemne/wyeksponowane
  // wartości dawały wyniki poza zakresem danych).
  function lerpTs(tsArr, f){
    var n = tsArr.length;
    if (!n) return 0;
    if (!isFinite(f)) f = 0;
    var fc = Math.max(0, Math.min(n - 1, f));
    var i0 = Math.min(n - 1, Math.floor(fc));
    var i1 = Math.min(n - 1, i0 + 1);
    return tsArr[i0] + (tsArr[i1] - tsArr[i0]) * (fc - i0);
  }

  // Walidacja struktury pliku importu (obiekt z tablicą entries albo tablica).
  // Testy wykryły: dla surowej tablicy `j.entries` to Array.prototype.entries
  // (funkcja, truthy!) — stary zapis odrzucał każdy plik będący czystą tablicą.
  function validateImport(j){
    if (!j || typeof j !== "object") return false;
    var list = (!Array.isArray(j) && Array.isArray(j.entries)) ? j.entries
             : (Array.isArray(j) ? j : null);
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || typeof list[i] !== "object" || Array.isArray(list[i])) return false;
    }
    return true;
  }


  // Scalanie importu z istniejącymi wpisami: deduplikacja po id i po sygnaturze
  // odczytu, jawne pomijanie rekordów niepełnych lub poza zakresem (bez cichego
  // Date.now() i bez odrzucania całego pliku). Czysta logika — testowana w tests.js.
  // sanitize: sanitizeEntry; makeId: generator id dla rekordów bez id.
  function mergeImported(list, existing, sanitize, makeId){
    var ids = Object.create(null), sigs = Object.create(null);
    existing.forEach(function(e){ ids[e.id] = 1; sigs[entrySig(e)] = 1; });
    var added = [], skipped = 0;
    list.forEach(function(e){
      var item = sanitize(e);
      if (!item || item.ts === null || lossy(e, item)) { skipped++; return; }
      if (item.sys != null && item.dia != null && item.sys <= item.dia) { skipped++; return; }
      if (!item.id) item.id = makeId();
      if (ids[item.id]) { skipped++; return; }        // duplikat id
      var sig = entrySig(item);
      if (sigs[sig]) { skipped++; return; }           // ten sam odczyt, inne id (inne urządzenie)
      added.push(item); ids[item.id] = 1; sigs[sig] = 1;
    });
    return { added: added, skipped: skipped };
  }

  // Scalanie importu z archiwum: sanityzacja rekordów, deduplikacja po id względem
  // istniejącego archiwum i listy głównej, nadawanie id brakującym. Zwraca listę
  // NOWYCH wpisów do dopisania do archiwum (czysta logika — testowana w tests.js).
  function mergeArchive(list, archive, known, sanitize, makeId){
    var arcIds = Object.create(null), knownIds = Object.create(null);
    archive.forEach(function(e){ arcIds[e.id] = 1; });
    known.forEach(function(e){ knownIds[e.id] = 1; });
    var out = [];
    list.forEach(function(e){
      var c = sanitize(e);
      if (!c || !c.ts || lossy(e, c)) return;
      if (!c.id) c.id = makeId();
      if (arcIds[c.id] || knownIds[c.id]) return;   // już w archiwum albo na liście głównej
      out.push(c); arcIds[c.id] = 1;
    });
    return out;
  }

  // Sanityzacja ustawień względem wartości domyślnych: przepisujemy tylko klucze
  // o poprawnym typie (liczby muszą być skończone), walidujemy enumeracje
  // (theme/lang/fontSize) i pilnujemy, by co najmniej jeden monitorowany parametr
  // pozostał włączony. Nieprawidłowy obiekt zwraca defaults bez zmian.
  function sanitizeSettings(s, def){
    if (!s || typeof s !== "object" || Array.isArray(s)) return def;
    var out = Object.assign({}, def);
    Object.keys(def).forEach(function(k){
      if (Object.prototype.hasOwnProperty.call(s, k) && typeof s[k] === typeof def[k] &&
          (typeof s[k] !== "number" || isFinite(s[k]))) out[k] = s[k];
    });
    if (["dark","light"].indexOf(out.theme) < 0) out.theme = def.theme;
    if (["pl","en"].indexOf(out.lang) < 0) out.lang = "pl";
    if (["small","medium","large"].indexOf(out.fontSize) < 0) out.fontSize = "medium";
    if (!out.trackSys && !out.trackDia && !out.trackHr && !out.trackWgt) {
      out.trackSys = out.trackDia = out.trackHr = out.trackWgt = true;
    }
    return out;
  }

  // Zawijanie tekstu do szerokości maxW; measure(str) -> szerokość. Zbyt długie słowa
  // są łamane znak po znaku. maxLines (opcjonalnie) ucina z wielokropkiem.
  function wrapText(text, maxW, measure, maxLines){
    var words = String(text == null ? "" : text).replace(/\s+/g, " ").trim().split(" ");
    var lines = [], cur = "";
    words.forEach(function(w){
      while (w && measure(w) > maxW) {
        var k = w.length;
        while (k > 1 && measure(w.slice(0, k)) > maxW) k--;
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(w.slice(0, k));
        w = w.slice(k);
      }
      var test = cur ? cur + " " + w : w;
      if (cur && measure(test) > maxW) { lines.push(cur); cur = w; } else cur = test;
    });
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      lines[maxLines - 1] = (last.length > 1 ? last.slice(0, -1) : last) + "\u2026";
    }
    return lines;
  }

  // Minimalny generator PDF bez zależności: każda strona to jeden obraz JPEG
  // (pages: [{data: Uint8Array z JPEG, w: px, h: px}]) rozciągnięty na stronę pw x ph pt.
  // Tekst jest rysowany na canvasie, więc działają wszystkie polskie znaki bez osadzania fontów.
  function buildPdf(pages, pw, ph, title){
    var enc = new TextEncoder(), parts = [], offsets = [], len = 0;
    function push(u8){ parts.push(u8); len += u8.length; }
    function str(s){ push(enc.encode(s)); }          // tylko ASCII
    function begin(n){ offsets[n] = len; str(n + " 0 obj\n"); }
    function end(){ str("endobj\n"); }
    var total = 3 + pages.length * 3;

    push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]));   // %PDF-1.4 + znacznik binarny
    begin(1); str("<< /Type /Catalog /Pages 2 0 R >>\n"); end();
    var kids = pages.map(function(_, i){ return (4 + i * 3) + " 0 R"; }).join(" ");
    begin(2); str("<< /Type /Pages /Count " + pages.length + " /Kids [" + kids + "] >>\n"); end();
    var hex = "FEFF";                                  // tytuł jako UTF-16BE (polskie znaki)
    for (var i = 0; i < title.length; i++) hex += ("0000" + title.charCodeAt(i).toString(16)).slice(-4);
    begin(3); str("<< /Title <" + hex + "> /Producer (Qardis) >>\n"); end();

    pages.forEach(function(p, idx){
      var pg = 4 + idx * 3, ct = pg + 1, im = pg + 2;
      begin(pg);
      str("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pw + " " + ph + "] /Resources << /XObject << /Im0 " + im + " 0 R >> >> /Contents " + ct + " 0 R >>\n");
      end();
      var cs = "q " + pw + " 0 0 " + ph + " 0 0 cm /Im0 Do Q\n";
      begin(ct); str("<< /Length " + cs.length + " >>\nstream\n" + cs + "endstream\n"); end();
      begin(im);
      str("<< /Type /XObject /Subtype /Image /Width " + p.w + " /Height " + p.h +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.data.length + " >>\nstream\n");
      push(p.data);
      str("\nendstream\n");
      end();
    });

    var xref = len;
    str("xref\n0 " + (total + 1) + "\n0000000000 65535 f \n");
    for (var n = 1; n <= total; n++) str(("0000000000" + offsets[n]).slice(-10) + " 00000 n \n");
    str("trailer\n<< /Size " + (total + 1) + " /Root 1 0 R /Info 3 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");

    var out = new Uint8Array(len), pos = 0;
    parts.forEach(function(u8){ out.set(u8, pos); pos += u8.length; });
    return out;
  }

  return {
    LIMITS: LIMITS,
    MAX_TS: MAX_TS,
    MIN_TS: MIN_TS,
    validFormTs: validFormTs,
    entrySig: entrySig,
    wrapText: wrapText,
    buildPdf: buildPdf,
    sanitizeEntry: sanitizeEntry,
    lossy: lossy,
    csvEscape: csvEscape,
    pluralEntries: pluralEntries,
    lerpTs: lerpTs,
    validateImport: validateImport,
    mergeImported: mergeImported,
    mergeArchive: mergeArchive,
    sanitizeSettings: sanitizeSettings
  };
})();