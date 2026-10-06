/* Qardis — testy jednostkowe core.js. Działają w przeglądarce (tests.html) i w Node:
   node tests.js */
(function(){
  "use strict";
  var isNode = typeof window === "undefined";
  if (isNode) { global.window = {}; require("./core.js"); }
  var C = window.QardisCore;
  var results = [];
  function eq(name, got, want){
    var ok = JSON.stringify(got) === JSON.stringify(want);
    results.push({ name: name, ok: ok, got: got, want: want });
  }

  // sanitizeEntry / daty
  eq("ts 9999 odrzucony", C.sanitizeEntry({ id: "a", ts: Date.UTC(9999,0,1), sys: 120, dia: 80 }), null);
  eq("ts rok 0099 odrzucony", C.sanitizeEntry({ id: "a", ts: new Date("0099-01-01T00:00").getTime(), sys: 120 }), null);
  eq("validFormTs 2026 ok", C.validFormTs(Date.UTC(2026,9,6)), true);
  eq("validFormTs 1999 odrzucony", C.validFormTs(Date.UTC(1999,11,31)), false);
  eq("validFormTs 2100+ odrzucony", C.validFormTs(Date.UTC(2100,0,2)), false);
  eq("validFormTs NaN", C.validFormTs(NaN), false);
  eq("liczby jako stringi", C.sanitizeEntry({ ts: 1, sys: "120", dia: "80", wgt: "75,5" }),
     { id: null, ts: 1, sys: 120, dia: 80, hr: null, wgt: 75.5, note: "" });
  eq("poza zakresem -> null", C.sanitizeEntry({ ts: 1, wgt: 15 }).wgt, null);
  eq("lossy wykrywa utratę", C.lossy({ wgt: 15 }, C.sanitizeEntry({ ts: 1, wgt: 15 })), true);
  eq("lossy bez utraty", C.lossy({ sys: "120" }, C.sanitizeEntry({ ts: 1, sys: "120" })), false);

  // CSV
  eq("csv zwykły tekst", C.csvEscape("abc"), "abc");
  eq("csv cudzysłów", C.csvEscape('a"b'), '"a""b"');
  eq("csv średnik", C.csvEscape("a;b"), '"a;b"');
  eq("csv CR cytowane", C.csvEscape("a\rb"), '"a\rb"');
  eq("csv formuła =", C.csvEscape("=1+1"), "'=1+1");
  eq("csv formuła @", C.csvEscape("@SUM(A1)"), "'@SUM(A1)");
  eq("csv formuła -", C.csvEscape("-2+3"), "'-2+3");
  eq("csv liczba kropka", C.csvEscape(75.5), "75.5");
  eq("csv liczba przecinek (PL)", C.csvEscape(75.5, true), '"75,5"');
  eq("csv null", C.csvEscape(null), "");

  // pluralizacja
  eq("pl 0", C.pluralEntries(0, "pl"), " wpisów.");
  eq("pl 1", C.pluralEntries(1, "pl"), " wpis.");
  eq("pl 2", C.pluralEntries(2, "pl"), " wpisy.");
  eq("pl 12", C.pluralEntries(12, "pl"), " wpisów.");
  eq("pl 22", C.pluralEntries(22, "pl"), " wpisy.");
  eq("en 1", C.pluralEntries(1, "en"), " entry.");
  eq("en 3", C.pluralEntries(3, "en"), " entries.");

  // lerpTs
  eq("lerp środek", C.lerpTs([0, 10, 20], 0.5), 5);
  eq("lerp clamp <0", C.lerpTs([0, 10, 20], -3), 0);
  eq("lerp clamp >n", C.lerpTs([0, 10, 20], 9), 20);
  eq("lerp NaN -> pierwszy", C.lerpTs([7, 10], NaN), 7);
  eq("lerp pusta", C.lerpTs([], 1), 0);

  // import
  eq("validateImport tablica", C.validateImport([]), true);
  eq("validateImport obiekt", C.validateImport({ entries: [] }), true);
  eq("validateImport pusty obiekt", C.validateImport({}), false);
  eq("validateImport zły element", C.validateImport([1]), false);

  // sygnatura duplikatów
  var a = { id: "x", ts: 5, sys: 120, dia: 80, hr: null, wgt: null };
  var b = { id: "y", ts: 5, sys: 120, dia: 80, hr: null, wgt: null };
  eq("entrySig ignoruje id", C.entrySig(a) === C.entrySig(b), true);
  eq("entrySig rozróżnia wartości", C.entrySig(a) === C.entrySig({ ts: 5, sys: 121, dia: 80, hr: null, wgt: null }), false);

  // wrapText
  var m = function(str){ return str.length * 10; };   // 10 jednostek na znak
  eq("wrap: krótki tekst", C.wrapText("ala ma kota", 200, m), ["ala ma kota"]);
  eq("wrap: zawijanie słów", C.wrapText("ala ma kota i psa", 100, m), ["ala ma", "kota i psa"]);
  eq("wrap: długie słowo łamane", C.wrapText("abcdefghij", 40, m), ["abcd", "efgh", "ij"]);
  eq("wrap: pusty tekst", C.wrapText("", 100, m), []);
  eq("wrap: białe znaki i nowe linie", C.wrapText("a\n\n  b", 100, m), ["a b"]);
  eq("wrap: maxLines z wielokropkiem", C.wrapText("aa bb cc dd", 25, m, 2), ["aa", "b\u2026"]);

  // buildPdf (struktura pliku)
  var fakeJpeg = new Uint8Array([255, 216, 255, 217]);
  var pdf = C.buildPdf([{ data: fakeJpeg, w: 10, h: 5 }, { data: fakeJpeg, w: 10, h: 5 }], 842, 595, "Qardis – żółć");
  var txt = ""; for (var i = 0; i < pdf.length; i++) txt += String.fromCharCode(pdf[i]);
  eq("pdf: nagłówek", txt.slice(0, 8), "%PDF-1.4");
  eq("pdf: koniec", txt.slice(-6), "%%EOF\n");
  eq("pdf: liczba stron", (txt.match(/\/Type \/Page /g) || []).length, 2);
  var sx = parseInt(txt.match(/startxref\n(\d+)/)[1], 10);
  eq("pdf: startxref wskazuje na xref", txt.slice(sx, sx + 4), "xref");
  var offs = txt.slice(sx).split("\n").filter(function(l){ return /^\d{10} 00000 n $/.test(l); });
  eq("pdf: offsety obiektów poprawne", offs.every(function(l, k){ return txt.slice(parseInt(l, 10)).indexOf((k + 1) + " 0 obj") === 0; }), true);
  eq("pdf: tytuł UTF-16BE", /\/Title <FEFF0051/.test(txt), true);

  var failed = results.filter(function(r){ return !r.ok; });
  if (isNode) {
    results.forEach(function(r){ console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.ok ? "" : "  got=" + JSON.stringify(r.got) + " want=" + JSON.stringify(r.want))); });
    console.log("\n" + (results.length - failed.length) + "/" + results.length + " OK");
    process.exit(failed.length ? 1 : 0);
  } else {
    var out = document.getElementById("out");
    var h = document.createElement("h1");
    h.textContent = (results.length - failed.length) + "/" + results.length + " OK";
    out.appendChild(h);
    results.forEach(function(r){
      var p = document.createElement("div");
      p.className = r.ok ? "pass" : "fail";
      p.textContent = (r.ok ? "✓ " : "✗ ") + r.name + (r.ok ? "" : " — got " + JSON.stringify(r.got) + ", want " + JSON.stringify(r.want));
      out.appendChild(p);
    });
  }
})();
