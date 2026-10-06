(function(){
  "use strict";

  function $(id){ return document.getElementById(id); }

  // Audyt(9): czysta logika (limity, sanityzacja, CSV, pluralizacja, interpolacja
  // osi czasu, walidacja importu) wydzielona do core.js \u2014 jedna implementacja
  // dla aplikacji i test\u00f3w jednostkowych (tests.html).
  var LIMITS = QardisCore.LIMITS;
  var sanitizeEntry = QardisCore.sanitizeEntry;
  var lossy = QardisCore.lossy;

  // --- MODU\u0141 1: Storage & State ---
  var StorageModule = (function(){
    var LS = "qardis.entries.v1", LS_SET = "qardis.settings.v1", LS_ARC = "qardis.archive.v1";
    var issue = false;
    var lastRaw = null;   // ostatni stan localStorage znany tej karcie (wykrywanie zapis\u00f3w z innych kart)
    function stash(raw){
      issue = true;
      // Zachowujemy PIERWSZ\u0104 kopi\u0119 \u2014 kolejne wykrycia nie nadpisuj\u0105 orygina\u0142u
      // i nie dubluj\u0105 ca\u0142ego zbioru w limicie localStorage.
      try { if (!localStorage.getItem(LS + ".corrupt")) localStorage.setItem(LS + ".corrupt", raw); } catch(e){}
    }
    function buildDefaults(){
      var autoTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light";
      return {
        defWgt:75, theme:autoTheme, lang:"pl", fontSize:"medium",
        trackSys:true, trackDia:true, trackHr:true, trackWgt:true,
        incHr: false, incWgt: false,      // czy nowy wpis domy\u015blnie zawiera t\u0119tno / wag\u0119 (pami\u0119tane)
        persistAsked: false,
        lastBackupAt: 0                   // czas ostatniej kopii zapasowej (przypominacz ~30 dni)
      };
    }
    function sanitizeSettings(s){
      var def = buildDefaults();
      if (!s || typeof s !== "object" || Array.isArray(s)) return def;
      var out = Object.assign({}, def);
      Object.keys(def).forEach(function(k){
        if (Object.prototype.hasOwnProperty.call(s, k) && typeof s[k] === typeof def[k] &&
            (typeof s[k] !== "number" || isFinite(s[k]))) out[k] = s[k];
      });
      if (["dark","light"].indexOf(out.theme) < 0) out.theme = def.theme;
      if (["pl","en"].indexOf(out.lang) < 0) out.lang = "pl";
      if (["small","medium","large"].indexOf(out.fontSize) < 0) out.fontSize = "medium";
      // Co najmniej jeden monitorowany parametr \u2014 inaczej formularz i lista s\u0105 puste.
      if (!out.trackSys && !out.trackDia && !out.trackHr && !out.trackWgt) {
        out.trackSys = out.trackDia = out.trackHr = out.trackWgt = true;
      }
      return out;
    }
    return {
      hadIssue: function(){ return issue; },
      corruptRaw: function(){
        // Audyt(2): zachowana kopia uszkodzonych danych \u2013 eksportowana z menu.
        try { return localStorage.getItem(LS + ".corrupt"); } catch(e){ return null; }
      },
      loadArchive: function(){
        // Archiwum: wpisy starsze ni\u017c 9 mies., przeniesione r\u0119cznie z menu \u2014 osobny magazyn.
        var raw = null;
        try { raw = localStorage.getItem(LS_ARC); } catch(e){ return []; }
        if (!raw) return [];
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch(e){ parsed = null; }
        if (!Array.isArray(parsed)) return [];
        var out = [], seen = Object.create(null);
        parsed.forEach(function(e){
          var c2 = sanitizeEntry(e);
          if (!c2 || c2.ts === null) return;
          if (!c2.id || seen[c2.id]) c2.id = makeId();
          seen[c2.id] = 1;
          out.push(c2);
        });
        return out;
      },
      saveArchive: function(list){
        try { localStorage.setItem(LS_ARC, JSON.stringify(list)); return true; } catch(e){ return false; }
      },
      loadEntries: function(){
        var raw = null;
        try { raw = localStorage.getItem(LS); } catch(e){ return []; }
        lastRaw = raw;
        if (!raw) return [];
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch(e){ parsed = null; }
        if (!Array.isArray(parsed)) { stash(raw); return []; }
        var out = [], bad = 0, seen = Object.create(null);
        parsed.forEach(function(e){
          var c = sanitizeEntry(e);
          if (!c){ bad++; return; }
          if (lossy(e, c)) bad++;
          if (!c.id || seen[c.id]) c.id = makeId();
          seen[c.id] = 1;
          out.push(c);
        });
        if (bad) stash(raw);
        return out;
      },
      saveEntries: function(entries){
        try {
          // Scalanie zapis\u00f3w mi\u0119dzy kartami: je\u015bli inna karta/PWA zapisa\u0142a dane
          // od naszego ostatniego odczytu, dopnij jej wpisy (po id) przed zapisem,
          // \u017ceby nie skasowa\u0107 ich nadpisaniem ca\u0142ej tablicy.
          var cur = null;
          try { cur = localStorage.getItem(LS); } catch(e){}
          if (cur && cur !== lastRaw) {
            try {
              var remote = JSON.parse(cur);
              if (Array.isArray(remote)) {
                var byId = Object.create(null);
                entries.forEach(function(e){ byId[e.id] = e; });
                remote.forEach(function(re){
                  var c = sanitizeEntry(re);
                  if (!c || !c.id || byId[c.id]) return;
                  entries.push(c); byId[c.id] = c;   // mutujemy przekazan\u0105 tablic\u0119 (global `entries`)
                });
              }
            } catch(e){}
          }
          var raw = JSON.stringify(entries);
          localStorage.setItem(LS, raw);
          lastRaw = raw;
          return true;
        } catch(e){ return false; }
      },
      loadSettings: function(){
        var s = null;
        try { var raw = localStorage.getItem(LS_SET); s = raw ? JSON.parse(raw) : null; } catch(e){ s = null; }
        if (!s) return buildDefaults();
        var out = sanitizeSettings(s);
        return out;
      },
      sanitizeSettings: function(s){ return sanitizeSettings(s, false); },
      saveSettings: function(settings){
        try { localStorage.setItem(LS_SET, JSON.stringify(settings)); return true; }
        catch(e){ return false; }
      },
      wipeAll: function(){
        [LS, LS_SET, LS_ARC, LS + ".corrupt"].forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
        lastRaw = null;
      },
      isStale: function(){
        try { return localStorage.getItem(LS) !== lastRaw; } catch(e){ return false; }
      },
      entriesKey: function(){ return LS; },
      settingsKey: function(){ return LS_SET; }
    };
  })();

  // --- MODU\u0141 2: Validation --- (implementacja w core.js \u2014 audyt(9))
  var ValidationModule = (function(){
    return {
      validateImport: function(j){ return QardisCore.validateImport(j); }
    };
  })();

  // --- MODU\u0141 3: I18n ---
  var I18nModule = (function(){
    var translations = {
      pl: {
        trendsTitle: "Qardis \u2013 Trendy pomiar\u00f3w", trendsDesc: "\u015arednie i zakresy warto\u015bci w wybranym okresie.", trendsNoData: "Brak pomiar\u00f3w w wybranym okresie.",
        sumCount: "Pomiar\u00f3w: {n}", sumBp: "Ci\u015bnienie \u2013 \u015brednia", sumHr: "T\u0119tno \u2013 \u015brednia", sumWgt: "Waga \u2013 \u015brednia", minMax: "min\u2013maks",
        normsNote: "Zalecenia dotycz\u0105ce interpretacji ci\u015bnienia skurczowego i rozkurczowego mog\u0105 si\u0119 zmienia\u0107. Naj\u015bwie\u017csze wytyczne znajdziesz na stronach Polskiego Towarzystwa Nadci\u015bnienia T\u0119tniczego i Polskiego Towarzystwa Kardiologicznego oraz analogicznych instytucji w innych krajach.",
        wipeDesc: "Usuwa wszystkie pomiary i ustawienia z tego urz\u0105dzenia.",
        navHistory: "Pomiary", navTrends: "Trendy", 
        sysLabel: "Skurczowe", diaLabel: "Rozkurczowe", hrLabel: "T\u0119tno", wgtLabel: "Waga",
        emptyTitle: "Brak pomiar\u00f3w", emptyDesc: "Dodaj pierwszy pomiar ci\u015bnienia, aby rozpocz\u0105\u0107 \u015bledzenie wynik\u00f3w.", btnAddFirst: "+ Dodaj pierwszy pomiar",
        addTitleNew: "Nowy wpis", addTitleEdit: "Edytuj wpis", dtLabel: "Data i godzina pomiaru",
        notePlaceholder: "Dodatkowe informacje... (np. przezi\u0119bienie, z\u0142e samopoczucie)",
        btnCancel: "Anuluj", btnSave: "Zapisz", btnDelete: "Usu\u0144", btnUndo: "Cofnij", btnProceed: "Kontynuuj",
        toolsTitle: "Dane i eksport", settingsTitle: "Ustawienia", monitoredTitle: "Monitorowane parametry", 
        
        
        langLabel: "J\u0119zyk", fontSizeLabel: "Wielko\u015b\u0107 czcionki", darkMode: "Tryb ciemny", darkModeDesc: "Jasny / ciemny motyw",
        titleBtnBackup: "Utw\u00f3rz kopi\u0119 zapasow\u0105", titleBtnImport: "Importuj dane z pliku", titleBtnPdf: "Raport: zapisz PDF lub drukuj",
        titleBtnCsv: "Eksportuj dane (CSV)", csvDone: "Pobrano plik CSV",
        discardTitle: "Niezapisane zmiany", discardConfirm: "Arkusz edycji zawiera niezapisane zmiany. Porzuci\u0107 je?", btnDiscard: "Porzu\u0107",
        titleBtnCorrupt: "Eksportuj dane uszkodzone (kopia zabezpieczona)", corruptExported: "Pobrano kopi\u0119 danych uszkodzonych",
        backupReminder: "Min\u0119\u0142o ponad 30 dni od ostatniej kopii zapasowej \u2013 rozwa\u017c jej utworzenie (menu \u201eDane i eksport\u201d).",
        importedMsg: "Zaimportowano ", importError: "Nieprawid\u0142owy plik kopii zapasowej.", importVersionError: "Nieznana wersja formatu kopii (schemaVersion). Utw\u00f3rz now\u0105 kopi\u0119 zapasow\u0105 w aplikacji.",
        noEntriesPdf: "Brak wpis\u00f3w do wydruku.", pdfError: "Nie uda\u0142o si\u0119 otworzy\u0107 okna wydruku.", pdfTitle: "Qardis \u2013 historia pomiar\u00f3w", pdfGen: "Wygenerowano: ", pdfHint: "U\u017cyj Ctrl+P / \u2318+P i wybierz \u201eZapisz jako PDF\u201d.", pdfHeaderDt: "Data i godzina", pdfHeaderNotes: "Uwagi", pdfExportTitle: "Raport pomiar\u00f3w", pdfRangeTitle: "Zakres danych", btnExport: "Eksportuj", btnSavePdf: "Zapisz jako PDF", btnPrint: "Drukuj", pdfSaved: "Raport PDF zapisany", pdfSaveError: "Nie uda\u0142o si\u0119 utworzy\u0107 pliku PDF.",
        savedMsg: "Pomiar zapisany", updatedMsg: "Pomiar zaktualizowany", futureDateWarn: "Data pomiaru przypada w przysz\u0142o\u015bci \u2014 upewnij si\u0119, \u017ce to zamierzone.", deletedMsg: "Wpis zosta\u0142 usuni\u0119ty", importConfirm: "Dane z kopii zostan\u0105 po\u0142\u0105czone z istniej\u0105cymi wpisami. Kontynuowa\u0107?",
        r7:"7 dni", r30:"30 dni", r90:"3 mies.", rAll:"Wszystkie",
        
        bpErrorMsg: "Warto\u015b\u0107 skurczowa (SYS) musi by\u0107 wy\u017csza ni\u017c rozkurczowa (DIA).",
        numRequiredMsg: "Podaj warto\u015bci liczbowe w polach pomiaru.",
        rangeMsg: "Warto\u015b\u0107 poza zakresem: SYS 50\u2013300, DIA 30\u2013200, t\u0119tno 20\u2013250.",
        dateRangeMsg: "Podaj poprawn\u0105 dat\u0119 (lata 2000\u20132099).",
        chartPanHint: "Przeci\u0105gnij wykres w bok, aby przegl\u0105da\u0107 kolejne pomiary (do 4 na ekran). Prze\u0142\u0105cznik zmienia o\u015b na rzeczywisty up\u0142yw czasu.",
        axisCatSwitch: "O\u015b: r\u00f3wna", axisTimeSwitch: "O\u015b: czasowa",
        minParamWarn: "Co najmniej jeden parametr musi pozosta\u0107 w\u0142\u0105czony.",
        privacyAlert: "Uwaga: Ten plik zawiera wra\u017cliwe dane dotycz\u0105ce zdrowia. Przechowuj go w bezpiecznym miejscu i nie udost\u0119pniaj osobom nieupowa\u017cnionym.",
        storageError: "Nie uda\u0142o si\u0119 zapisa\u0107 danych (mo\u017ce tryb prywatny?).",
        backupDone: "Kopia zapasowa pobrana",
        settingsSaved: "Ustawienia zapisane",
        
        
        
        deletedMsgN: "Usuni\u0119to wpis\u00f3w: {n}",
        importSkipped: " Pomini\u0119to: ",
        skipHr: "Pomi\u0144 t\u0119tno", skipWgt: "Pomi\u0144 wag\u0119",
        storageCorrupt: "Wykryto uszkodzone dane. Kopi\u0119 zachowano w pami\u0119ci przegl\u0105darki, nie zosta\u0142y nadpisane.",
        
        
        
        btnClose: "Zamknij", 
        ariaTools: "Dane i eksport", ariaAdd: "Dodaj pomiar", ariaSettings: "Ustawienia", ariaView: "Widok",
        
        
        addHr: "Dodaj t\u0119tno", addWgt: "Dodaj wag\u0119",
        wgtDec: "Zmniejsz wag\u0119 o 0,1 kg", wgtInc: "Zwi\u0119ksz wag\u0119 o 0,1 kg", wgtLabelKg: "Waga [kg]",
        wgtErrorMsg: "Podaj wag\u0119 w zakresie 20\u2013300 kg (np. 75,5).",
        titleBtnWipe: "Usu\u0144 wszystkie dane",
        wipeConfirm: "Usun\u0105\u0107 WSZYSTKIE pomiary, archiwum i ustawienia z tego urz\u0105dzenia? Tej operacji nie mo\u017cna cofn\u0105\u0107. Je\u015bli chcesz zachowa\u0107 dane, najpierw utw\u00f3rz kopi\u0119 zapasow\u0105 (zawiera r\u00f3wnie\u017c archiwum).",
        wipeDone: "Wszystkie dane zosta\u0142y usuni\u0119te",
        privacyNote: "Dane s\u0105 przechowywane wy\u0142\u0105cznie na tym urz\u0105dzeniu.",
        importSettingsConfirm: "Plik zawiera te\u017c ustawienia (j\u0119zyk, monitorowane parametry). Zast\u0105pi\u0107 nimi bie\u017c\u0105ce ustawienia?",
        archiveTitle: "Archiwum pomiar\u00f3w",
        archiveDesc: "Wpisy starsze ni\u017c 9 mies. mo\u017cna przenie\u015b\u0107 do archiwum \u2014 znikaj\u0105 z listy i Trend\u00f3w, ale zostaj\u0105 na urz\u0105dzeniu i mo\u017cna je przywr\u00f3ci\u0107 lub wyeksportowa\u0107.",
        btnArchiveOpen: "Archiwum",
        archiveEmpty: "Brak zarchiwizowanych wpis\u00f3w.",
        archiveCount: "W archiwum: {n}",
        btnArchiveMove: "Archiwizuj wpisy starsze ni\u017c 9 mies.",
        archiveShow: "Poka\u017c wpisy", archiveHide: "Ukryj wpisy",
        btnArchiveRestore: "Przywr\u00f3\u0107 wszystkie",
        btnArchiveExport: "Eksportuj archiwum",
        archivedMsg: "Zarchiwizowano ",
        archiveRestoredMsg: "Przywr\u00f3cono ",
        archiveExportedMsg: "Pobrano archiwum",
        nothingToArchiveMsg: "Brak wpis\u00f3w starszych ni\u017c 9 mies.",
        archiveInBackup: "Kopia zawiera pomiary, archiwum i ustawienia \u2014 pe\u0142na migracja urz\u0105dzenia w jednym pliku.",
        importSavedWarning: "Nie uda\u0142o si\u0119 zapisa\u0107 danych (mo\u017ce limit pami\u0119ci lub tryb prywatny?). Zaimportowane wpisy s\u0105 widoczne, ale znikn\u0105 po od\u015bwie\u017ceniu strony."
      },
      en: {
        trendsTitle: "Qardis \u2013 Measurement trends", trendsDesc: "Averages and value ranges for the selected period.", trendsNoData: "No measurements in the selected period.",
        sumCount: "Measurements: {n}", sumBp: "Blood pressure \u2013 average", sumHr: "Pulse \u2013 average", sumWgt: "Weight \u2013 average", minMax: "min\u2013max",
        normsNote: "Guidelines for interpreting systolic and diastolic blood pressure may change over time. Check the latest recommendations on the websites of the Polish Society of Hypertension and the Polish Cardiac Society, or of equivalent institutions in your country.",
        wipeDesc: "Deletes all measurements and settings from this device.",
        navHistory: "Readings", navTrends: "Trends", 
        sysLabel: "Systolic", diaLabel: "Diastolic", hrLabel: "Pulse", wgtLabel: "Weight",
        emptyTitle: "No measurements yet", emptyDesc: "Add your first blood pressure record to start tracking.", btnAddFirst: "+ Add first measurement",
        addTitleNew: "New entry", addTitleEdit: "Edit entry", dtLabel: "Date and time of measurement",
        notePlaceholder: "Additional info... (e.g. cold, feeling unwell)",
        btnCancel: "Cancel", btnSave: "Save", btnDelete: "Delete", btnUndo: "Undo", btnProceed: "Proceed",
        toolsTitle: "Data & Export", settingsTitle: "Settings", monitoredTitle: "Monitored parameters", 
        
        
        langLabel: "Language", fontSizeLabel: "Font size", darkMode: "Dark mode", darkModeDesc: "Light / dark theme",
        titleBtnBackup: "Backup data", titleBtnImport: "Import data from file", titleBtnPdf: "Report: save PDF or print",
        titleBtnCsv: "Export data (CSV)", csvDone: "CSV file downloaded",
        discardTitle: "Unsaved changes", discardConfirm: "The edit form contains unsaved changes. Discard them?", btnDiscard: "Discard",
        titleBtnCorrupt: "Export corrupted data (safety copy)", corruptExported: "Corrupted data copy downloaded",
        backupReminder: "More than 30 days since your last backup \u2013 consider creating one (Data & Export menu).",
        importedMsg: "Imported ", importError: "Invalid backup file.", importVersionError: "Unknown backup format version (schemaVersion). Create a new backup in the app.",
        noEntriesPdf: "No entries to print.", pdfError: "Failed to open print window.", pdfTitle: "Qardis \u2013 measurement history", pdfGen: "Generated: ", pdfHint: "Use Ctrl+P / \u2318+P and select 'Save as PDF'.", pdfHeaderDt: "Date & Time", pdfHeaderNotes: "Notes", pdfExportTitle: "Measurement report", pdfRangeTitle: "Data range", btnExport: "Export", btnSavePdf: "Save as PDF", btnPrint: "Print", pdfSaved: "PDF report saved", pdfSaveError: "Failed to create the PDF file.",
        savedMsg: "Measurement saved", updatedMsg: "Measurement updated", futureDateWarn: "The measurement date is in the future \u2014 make sure this is intentional.", deletedMsg: "Entry deleted", importConfirm: "Backup data will be merged with existing entries. Proceed?",
        r7:"7 days", r30:"30 days", r90:"3 mos.", rAll:"All",
        
        bpErrorMsg: "Systolic pressure (SYS) must be higher than diastolic (DIA).",
        numRequiredMsg: "Enter numeric values in the measurement fields.",
        rangeMsg: "Value out of range: SYS 50\u2013300, DIA 30\u2013200, pulse 20\u2013250.",
        dateRangeMsg: "Enter a valid date (years 2000\u20132099).",
        chartPanHint: "Drag the chart sideways to browse measurements (up to 4 on screen). The toggle switches the axis to real time spacing.",
        axisCatSwitch: "Axis: even", axisTimeSwitch: "Axis: time",
        minParamWarn: "At least one parameter must stay enabled.",
        privacyAlert: "Notice: This file contains sensitive health data. Store it in a secure place and do not share it with unauthorized persons.",
        storageError: "Failed to save data (private browsing mode?).",
        backupDone: "Backup downloaded",
        settingsSaved: "Settings saved",
        
        
        
        deletedMsgN: "Entries deleted: {n}",
        importSkipped: " Skipped: ",
        skipHr: "Skip pulse", skipWgt: "Skip weight",
        storageCorrupt: "Corrupted data detected. A copy was kept in browser storage and not overwritten.",
        
        
        
        btnClose: "Close", 
        ariaTools: "Data and export", ariaAdd: "Add measurement", ariaSettings: "Settings", ariaView: "View",
        
        
        addHr: "Add pulse", addWgt: "Add weight",
        wgtDec: "Decrease weight by 0.1 kg", wgtInc: "Increase weight by 0.1 kg", wgtLabelKg: "Weight [kg]",
        wgtErrorMsg: "Enter a weight between 20 and 300 kg (e.g. 75.5).",
        titleBtnWipe: "Delete all data",
        wipeConfirm: "Delete ALL measurements, the archive and settings from this device? This cannot be undone. If you want to keep your data, create a backup first (it also includes the archive).",
        wipeDone: "All data has been deleted",
        privacyNote: "Data is stored only on this device.",
        importSettingsConfirm: "The file also contains settings (language, monitored parameters). Replace your current settings with them?",
        archiveTitle: "Measurement archive",
        archiveDesc: "Entries older than 9 months can be moved to the archive \u2014 they disappear from the list and Trends, but stay on this device and can be restored or exported at any time.",
        btnArchiveOpen: "Archive",
        archiveEmpty: "No archived entries.",
        archiveCount: "In archive: {n}",
        btnArchiveMove: "Archive entries older than 9 months",
        archiveShow: "Show entries", archiveHide: "Hide entries",
        btnArchiveRestore: "Restore all",
        btnArchiveExport: "Export archive",
        archivedMsg: "Archived ",
        archiveRestoredMsg: "Restored ",
        archiveExportedMsg: "Archive downloaded",
        nothingToArchiveMsg: "No entries older than 9 months.",
        archiveInBackup: "The backup contains measurements, archive and settings \u2014 a full device migration in one file.",
        importSavedWarning: "Failed to save data (storage limit or private mode?). Imported entries are visible, but will disappear after refreshing the page."
      }
    };
    return {
      t: function(key, lang) {
        var l = lang || "pl";
        return (translations[l] && translations[l][key]) || translations["pl"][key] || key;
      }
    };
  })();

  // --- MODU\u0141 4: Table Renderer ---
  var TableModule = (function(){
    return {
      // Audyt kodu: filtr zakresu wykonuje JEDEN raz wywo\u0142uj\u0105cy (drawTrends) \u2014
      // tabela dostaje ju\u017c przefiltrowan\u0105, posortowan\u0105 malej\u0105co list\u0119.
      renderTable: function(tableMount, filtered, settings, tCb, fmtDateCb){
        tableMount.innerHTML = "";
        if (!filtered.length){
          tableMount.innerHTML = '<div class="trends-empty">' + tCb("trendsNoData") + '</div>';
          return;
        }

        var table = document.createElement("table");
        table.className = "data-table";
        table.setAttribute("role", "table");
        table.setAttribute("aria-label", tCb("trendsTitle"));

        var cols = [];
        if (settings.trackSys) cols.push({ label: "sysLabel", unit: "mmHg", key: "sys" });
        if (settings.trackDia) cols.push({ label: "diaLabel", unit: "mmHg", key: "dia" });
        if (settings.trackHr)  cols.push({ label: "hrLabel",  unit: "bpm",  key: "hr" });
        if (settings.trackWgt) cols.push({ label: "wgtLabel", unit: "kg",   key: "wgt" });

        // Sztywne szeroko\u015bci kolumn: tabela nigdy nie wychodzi poza ekran
        var colW = Math.floor(68 / Math.max(cols.length, 1));
        var colgroup = document.createElement("colgroup");
        var cDate = document.createElement("col");
        cDate.style.width = (100 - colW * cols.length) + "%";
        colgroup.appendChild(cDate);
        cols.forEach(function(){ var c = document.createElement("col"); c.style.width = colW + "%"; colgroup.appendChild(c); });
        table.appendChild(colgroup);

        var thead = document.createElement("thead");
        var htr = document.createElement("tr");
        function addTh(text, unit){
          var th = document.createElement("th");
          th.title = unit ? text + " (" + unit + ")" : text;     // pe\u0142ny tekst po najechaniu / przytrzymaniu
          var l = document.createElement("span"); l.className = "th-l"; l.textContent = text; th.appendChild(l);
          if (unit) { var u = document.createElement("span"); u.className = "th-u"; u.textContent = unit; th.appendChild(u); }
          htr.appendChild(th);
        }
        addTh(tCb("pdfHeaderDt"), "");
        cols.forEach(function(c){ addTh(tCb(c.label), c.unit); });
        thead.appendChild(htr);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        filtered.forEach(function(e){
          var f = fmtDateCb(e.ts);
          var tr = document.createElement("tr");
          var td0 = document.createElement("td");
          td0.title = f.date + " " + f.time;
          var d = document.createElement("span"); d.className = "td-d"; d.textContent = f.date;
          var tm = document.createElement("span"); tm.className = "td-t"; tm.textContent = f.time;
          td0.appendChild(d); td0.appendChild(tm);
          tr.appendChild(td0);
          cols.forEach(function(c){
            var td = document.createElement("td");
            td.textContent = (e[c.key] != null) ? e[c.key] : "--";
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableMount.appendChild(table);
      }
    };
  })();

  // --- MODU\u0141 5: Main App Logic & UI Coordinator ---
  var entries = StorageModule.loadEntries();
  var settings = StorageModule.loadSettings();
  var trendsRangeDays = "all";
  var settingsDraft = null;
  var settingsBefore = null;
  var hrActive = true;
  var wgtActive = true;
  var pendingDeletes = [];
  var deleteTimeout = null;

  function t(key) { return I18nModule.t(key, settings.lang); }

  // Audyt kodu: wsp\u00f3lne helpery dat w jednym miejscu (wcze\u015bniej zdefiniowane
  // trzykrotnie w r\u00f3\u017cnych miejscach pliku \u2014 pad2/fmtDate/toLocalInput/ymd).
  function pad2(n){ return (n<10?"0":"")+n; }
  function fmtDate(ts){
    var d = new Date(ts);
    var locale = settings.lang === "en" ? "en-US" : "pl-PL";
    try {
      return {
        date: d.toLocaleDateString(locale, { year:"numeric", month:"2-digit", day:"2-digit" }),
        time: d.toLocaleTimeString(locale, { hour:"2-digit", minute:"2-digit", hour12:false })
      };
    } catch(e) {
      return { date: pad2(d.getDate())+"."+pad2(d.getMonth()+1)+"."+d.getFullYear(), time: pad2(d.getHours())+":"+pad2(d.getMinutes()) };
    }
  }
  function toLocalInput(ts){
    var d = new Date(ts);
    return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())+"T"+pad2(d.getHours())+":"+pad2(d.getMinutes());
  }
  function ymd(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }   // audyt(6): czytelna nazwa pliku backupu (2026-10-06)

  // Audyt i18n: poprawna pluralizacja (pl: wpis/wpisy/wpis\u00f3w, en: entry/entries) \u2014
  // implementacja w core.js, tutaj tylko podpi\u0119cie j\u0119zyka.
  function pluralEntries(n){ return QardisCore.pluralEntries(n, settings.lang); }

  function applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var k = el.getAttribute('data-i18n');
      el.textContent = t(k);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function(el){
      var txt = t(el.getAttribute('data-i18n-aria')).replace('{p}', el.getAttribute('data-p') || '');
      el.setAttribute('aria-label', txt);
      if (el.hasAttribute('title')) el.title = txt;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function(el){
      var k = el.getAttribute('data-i18n-ph');
      el.placeholder = t(k);
    });
    document.querySelectorAll('#langSwitch button').forEach(function(btn){
      btn.setAttribute('aria-pressed', btn.dataset.val === settings.lang ? 'true' : 'false');
    });
    document.documentElement.lang = settings.lang || "pl";
  }

  function applyFontSize() {
    var fontSizes = { small: "87.5%", medium: "100%", large: "112.5%" };
    var sz = fontSizes[settings.fontSize] || fontSizes.medium;
    document.documentElement.style.setProperty('--base-font-size', sz);
    document.querySelectorAll('#fontSizeSwitch button').forEach(function(btn){
      btn.setAttribute('aria-pressed', btn.dataset.val === settings.fontSize ? 'true' : 'false');
    });
  }

  function applyTheme(){
    document.documentElement.setAttribute("data-theme", settings.theme);
    // S\u0105 dwa metatagi theme-color (z media prefers-color-scheme, dla pierwszego renderu
    // przed startem skryptu). R\u0119czny wyb\u00f3r motywu mo\u017ce r\u00f3\u017cni\u0107 si\u0119 od systemowego,
    // wi\u0119c ustawiamy ten sam kolor w obu \u2014 wtedy wygrywa wyb\u00f3r u\u017cytkownika.
    var color = settings.theme === "dark" ? "#1b1d20" : "#f0f4f9";
    document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){ m.setAttribute("content", color); });
  }

  function renderMonitoredButtons() {
    if (!settingsDraft) return;
    document.querySelectorAll('#monitoredSwitch button').forEach(function(btn){
      var key = btn.dataset.param;
      btn.setAttribute('aria-pressed', settingsDraft[key] ? 'true' : 'false');
    });
  }

  var entryList = $("entryList");
  // Audyt kodu: delegacja zdarze\u0144 na li\u015bcie wpis\u00f3w zamiast listenera per karta
  entryList.addEventListener("click", function(ev){
    var hit = ev.target.closest(".card-hit"); if (!hit) return;
    var en = entries.find(function(x){ return x.id === hit.dataset.id; });
    if (en) openAdd(en);
  });

  function render(){
    resetChart();   // po zmianie danych wykres pokazuje najnowsze pomiary
    entryList.innerHTML = "";

    if (!entries.length){
      entryList.innerHTML = '<div class="empty-box">'
        +'<h3>'+t("emptyTitle")+'</h3>'
        +'<p>'+t("emptyDesc")+'</p>'
        +'<button class="btn" id="btnEmptyAdd">'+t("btnAddFirst")+'</button>'
        +'</div>';
      $("btnEmptyAdd").onclick = function(){ openAdd(null); };
      drawTrends();
      return;
    }

    var arr = sortedDesc();
    var frag = document.createDocumentFragment();

    arr.forEach(function(e){
      var card = document.createElement("div");
      card.className = "entry-card";
      card.setAttribute("role", "group");
      var f = fmtDate(e.ts);
      
      var bpText = (settings.trackSys && e.sys ? e.sys : '--') + ' / ' + (settings.trackDia && e.dia ? e.dia : '--');

      var html = '<div class="card-top">'
        + '<div class="card-main">'
        +   '<span class="card-sysdia">' + bpText + '</span>'
        +   '<span class="card-unit">mmHg</span>'
        + '</div>'
        + '<div class="card-date">' + f.date + '<small>' + f.time + '</small></div>'
        + '</div>';

      var subItems = [];
      if (settings.trackHr && e.hr) subItems.push('<span><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' + e.hr + ' bpm</span>');
      if (settings.trackWgt && e.wgt) subItems.push('<span><svg viewBox="0 0 24 24"><path d="M5 19h14l-1.6-8.2a2 2 0 0 0-2-1.6H8.6a2 2 0 0 0-2 1.6z"/><path d="M12 9V7"/><circle cx="12" cy="6" r="1.6"/></svg>' + e.wgt + ' kg</span>');

      if (subItems.length) {
        html += '<div class="card-sub">' + subItems.join('') + '</div>';
      }
      if (e.note) {
        html += '<div class="card-note">\u270e ' + escapeHtml(e.note) + '</div>';
      }

      card.innerHTML = html;
      var hit = document.createElement("button");
      hit.type = "button";
      hit.className = "card-hit";
      hit.setAttribute("aria-label", t("addTitleEdit") + ", " + f.date + " " + f.time);
      hit.dataset.id = e.id;
      card.insertBefore(hit, card.firstChild);
      frag.appendChild(card);
    });
    entryList.appendChild(frag);

    drawTrends();
  }

  // Audyt kodu: wsp\u00f3lne helpery zamiast powt\u00f3rzonych blok\u00f3w w trzech eksportach
  function downloadFile(name, text, mime){
    var blob = (typeof Blob !== "undefined" && text instanceof Blob) ? text : new Blob([text], {type: mime || "application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  }

  function escapeHtml(s){
    if (typeof s !== "string") return "";
    return s.replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function deleteEntryWithUndo(id){
    var idx = entries.findIndex(function(e){ return e.id === id; });
    if (idx === -1) return;
    pendingDeletes.push(entries[idx]);
    entries.splice(idx, 1);
    if (!StorageModule.saveEntries(entries)) toast(t("storageError"));
    if (editingId === id) editingId = null;
    addSnapshot = null;   // usuni\u0119to wpis \u2014 zamykamy arkusz bez dirty-check
    render();
    if($("addOverlay").classList.contains("open")) setModalState($("addOverlay"), false);

    if (deleteTimeout) clearTimeout(deleteTimeout);
    var n = pendingDeletes.length;
    var msg = n > 1 ? t("deletedMsgN").replace("{n}", n) : t("deletedMsg");

    toastWithUndo(msg, function(){
      if (!pendingDeletes.length) return;
      pendingDeletes.forEach(function(e){ entries.push(e); });
      entries.sort(function(a,b){ return b.ts - a.ts; });
      pendingDeletes = [];
      if (deleteTimeout) { clearTimeout(deleteTimeout); deleteTimeout = null; }
      if (!StorageModule.saveEntries(entries)) toast(t("storageError"));
      render();
    });

    deleteTimeout = setTimeout(function(){
      pendingDeletes = [];
      deleteTimeout = null;
    }, UNDO_MS + 600);
  }

  // --- Ekran Trendy: podsumowanie liczbowe + pionowe s\u0142upki zakresowe + tabela ---
  var DAY_MS = 86400000;
  function mkEl(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function statOf(list, key){
    var n = 0, sum = 0, mn = Infinity, mx = -Infinity;
    list.forEach(function(e){
      var v = e[key];
      if (v == null || !isFinite(v)) return;
      n++; sum += v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    });
    return n ? { n: n, avg: sum / n, min: mn, max: mx } : null;
  }
  function fmt1(v){ return (Math.round(v * 10) / 10).toFixed(1); }
  function rangeTxt(st, f){ var a = f(st.min), b = f(st.max); return a === b ? a : a + "\u2013" + b; }
  function rnd(v){ return String(Math.round(v)); }

  function renderSummary(list, mount){
    mount.textContent = "";
    mount.appendChild(mkEl("div", "sum-count", t("sumCount").replace("{n}", list.length)));
    var s = settings.trackSys ? statOf(list, "sys") : null;
    var d = settings.trackDia ? statOf(list, "dia") : null;
    var h = settings.trackHr  ? statOf(list, "hr")  : null;
    var w = settings.trackWgt ? statOf(list, "wgt") : null;
    if (!s && !d && !h && !w) return;

    var grid = mkEl("div", "sum-grid");
    function card(cls, label, avgText, unit, rangeText){
      var c = mkEl("div", "sum-card " + cls);
      c.appendChild(mkEl("div", "sum-label", label));
      var a = mkEl("div", "sum-avg", avgText);
      a.appendChild(mkEl("small", null, unit));
      c.appendChild(a);
      c.appendChild(mkEl("div", "sum-range", t("minMax") + ": " + rangeText));
      grid.appendChild(c);
    }
    // Audyt kodu: generyczny helper zamiast trzech kopiowanych blok\u00f3w kart
    function cardFor(st, labelKey, unit, f){
      if (!st) return;
      card("", t(labelKey), f(st.avg), unit, rangeTxt(st, f));
    }
    if (s || d) {
      var avg = [s ? rnd(s.avg) : "--", d ? rnd(d.avg) : "--"].join(" / ");
      var rng = [s ? "SYS " + rangeTxt(s, rnd) : "", d ? "DIA " + rangeTxt(d, rnd) : ""]
        .filter(Boolean).join(" \u00b7 ");
      card("wide", t("sumBp"), avg, "mmHg", rng);
    }
    cardFor(h, "sumHr", "bpm", rnd);
    cardFor(w, "sumWgt", "kg", fmt1);
    mount.appendChild(grid);
  }

  // --- Audyt UX (w3): wykres czytelny od pierwszego rzutu oka ---
  // \u2022 O\u015b X domy\u015blnie R\u00d3WNA: ka\u017cdy pomiar to kolejna pozycja, niezale\u017cnie od
  //   up\u0142ywu czasu (kilka pomiar\u00f3w jednego dnia nie zlewa si\u0119 w jeden punkt).
  // \u2022 Prze\u0142\u0105cznik "o\u015b czasowa": odst\u0119py proporcjonalne do rzeczywistego czasu.
  // \u2022 Okno do 4 pomiar\u00f3w na ekran; przesuwanie przeci\u0105gni\u0119ciem (po jednym
  //   kroku na pomiar). Brak trybu "poka\u017c wszystko" \u2014 skala jest zawsze czytelna.
  // \u2022 Mi\u0119dzy punktami etykieta z liczb\u0105 dni (np. "3 dni"), pod punktami data.
  var VISIBLE_MAX = 4;
  var chartMode = "cat";     // "cat" = o\u015b r\u00f3wna, "time" = o\u015b rzeczywistego czasu
  var chartStart = Infinity; // indeks pierwszego widocznego pomiaru (float); Infinity = koniec osi (najnowsze), clamp w drawChart
  function resetChart(){ chartStart = Infinity; }
  function gapLabel(days){
    if (days < 1) return "0 d";
    if (days === 1) return settings.lang === "en" ? "1 day" : "1 dzie\u0144";
    return days + (settings.lang === "en" ? " days" : " dni");
  }
  function drawChart(list, mount){
    var showSys = settings.trackSys, showDia = settings.trackDia;
    var pts = (showSys || showDia) ? list.filter(function(e){
      return (showSys && e.sys != null) || (showDia && e.dia != null);
    }).sort(function(a,b){ return a.ts - b.ts; }) : [];
    if (pts.length < 2) { mount.textContent = ""; chartCtx = null; return; }   // wykres od 2 pomiar\u00f3w

    var n = pts.length;
    var visN = Math.min(VISIBLE_MAX, n);
    // chartStart pozostaje U\u0141AMKOWY (bez Math.round) \u2014 to daje p\u0142ynne
    // przesuwanie: punkty przesuwaj\u0105 si\u0119 piksel po pikselu, nie skokami.
    chartStart = clamp(chartStart, 0, n - visN);

    var W = Math.max(mount.clientWidth || 320, 240), H = 250;
    var padL = 40, padR = 12, padT = 26, padB = 34;
    var iw = W - padL - padR, ih = H - padT - padB;

    var lo = Infinity, hi = -Infinity;
    // Skala Y liczona po WSZYSTKICH punktach okna z zapasem (nie tylko
    // widocznych) \u2014 przesuwanie nie zmienia skali w trakcie panu.
    var winA = Math.floor(chartStart), winB = Math.min(n - 1, Math.ceil(chartStart + visN - 1) + 1);
    for (var q = winA; q <= winB; q++) {
      var pe = pts[q];
      if (showSys && pe.sys != null) { lo = Math.min(lo, pe.sys); hi = Math.max(hi, pe.sys); }
      if (showDia && pe.dia != null) { lo = Math.min(lo, pe.dia); hi = Math.max(hi, pe.dia); }
    }
    var yPad = Math.max(Math.round((hi - lo) * 0.15), 5);
    lo -= yPad; hi += yPad;
    if (hi - lo < 10) { lo -= 5; hi += 5; }

    // Mapowanie u\u0142amkowego indeksu -> X:
    //  \u2022 tryb "cat":  pozycja liniowa wzgl\u0119dem chartStart (r\u00f3wne odst\u0119py)
    //  \u2022 tryb "time": interpolacja znacznika czasu mi\u0119dzy indeksami
    // Audyt(9): interpolacja (lerpTs) w core.js \u2014 testowana jednostkowo.
    var tsArr = pts.map(function(p){ return p.ts; });
    function tsAt(f){ return QardisCore.lerpTs(tsArr, f); }
    var tA = tsAt(chartStart), tB = tsAt(chartStart + visN - 1);
    var timeOk = (chartMode === "time") && (tB - tA) > 0;
    function X(f){
      if (timeOk) return padL + ((tsAt(f) - tA) / (tB - tA)) * iw;
      return padL + ((f - chartStart) / (visN - 1)) * iw;
    }
    function Y(v){ return padT + (1 - (v - lo) / (hi - lo)) * ih; }
    function n1(x){ return Math.round(x * 10) / 10; }
    function shortDate(ts){
      var d = new Date(ts);
      var loc = settings.lang === "en" ? "en-US" : "pl-PL";
      try { return d.toLocaleDateString(loc, { month: "short", day: "numeric" }); }
      catch(e2) { return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1); }
    }

    var svg = "";
    for (var i = 0; i <= 4; i++) {
      var v = lo + (hi - lo) * i / 4, y = n1(Y(v));
      svg += '<line x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'" class="grid"/>'
           + '<text x="'+(padL-6)+'" y="'+n1(y+3.5)+'" text-anchor="end" class="axis">'+Math.round(v)+'</text>';
    }

    // Zakres rysowanych indeks\u00f3w z zapasem, \u017ceby punkty wje\u017cd\u017ca\u0142y/wyje\u017cd\u017ca\u0142y
    // p\u0142ynnie przy kraw\u0119dziach okna.
    var iFrom = Math.max(0, Math.floor(chartStart));
    var iTo = Math.min(n - 1, Math.ceil(chartStart + visN - 1));

    // Daty pod punktami + liczba dni mi\u0119dzy punktami (w po\u0142owie odst\u0119pu)
    for (var k = iFrom; k <= iTo; k++) {
      var xk = X(k);
      if (xk < padL - 4 || xk > W - padR + 4) continue;
      svg += '<text x="'+n1(xk)+'" y="'+(H-8)+'" text-anchor="middle" class="axis axis-date">'+escapeHtml(shortDate(pts[k].ts))+'</text>';
      if (k > 0) {
        var xm = (xk + X(k-1)) / 2;
        // Audyt(3): pr\u00f3g czytelno\u015bci \u2014 etykieta "X dni" tylko wtedy, gdy
        // odst\u0119p na ekranie daje jej miejsce (min. 40 jednostek SVG).
        if (xm >= padL - 4 && xm <= W - padR + 4 && (xk - X(k-1)) >= 40) {
          var days = Math.max(0, Math.round((pts[k].ts - pts[k-1].ts) / DAY_MS));
          svg += '<text x="'+n1(xm)+'" y="'+(H-20)+'" text-anchor="middle" class="axis axis-gap">'+escapeHtml(gapLabel(days))+'</text>';
        }
      }
    }
    function series(key, cls){
      var out = "", prev = null;
      for (var m = iFrom; m <= iTo; m++) {
        var e = pts[m];
        if (e[key] == null) { prev = null; continue; }
        var x = n1(X(m)), y = n1(Y(e[key]));
        if (prev !== null) out += '<line x1="'+prev[0]+'" y1="'+prev[1]+'" x2="'+x+'" y2="'+y+'" class="ln-'+cls+'"/>';
        out += '<circle cx="'+x+'" cy="'+y+'" r="4.5" class="dot-'+cls+'"/>';
        prev = [x, y];
      }
      return out;
    }
    var legend = "";
    var lx = padL;
    if (showSys) { legend += '<text x="'+lx+'" y="14" class="lg-sys">\u25cf SYS</text>'; lx += 58; }
    if (showDia) { legend += '<text x="'+lx+'" y="14" class="lg-dia">\u25cf DIA</text>'; }
    var content = svg + series("sys", "sys") + series("dia", "dia") + legend;

    // Audyt bugfix: struktura (pasek + SVG + podpowied\u017a) tworzona RAZ i nigdy
    // nie czyszczona w trakcie rysowania \u2014 wcze\u015bniejsze mount.textContent=""
    // niszczy\u0142o SVG razem z listenerami przy ka\u017cdym przeci\u0105gni\u0119ciu (drag si\u0119
    // zacina\u0142). Kontekst dla panu \u017cyje w chartCtx, od\u015bwie\u017cany przy ka\u017cdym
    // rysowaniu.
    var svgEl = mount.querySelector("svg");
    if (!svgEl) {
      mount.innerHTML = '<div class="chart-bar"><button type="button" id="btnAxisMode" class="chart-toggle" aria-pressed="false"></button></div>'
        + '<svg viewBox="0 0 320 250" role="img" aria-label="'+escapeHtml(t("trendsTitle"))+'"></svg>'
        + '<div class="chart-hint">' + escapeHtml(t("chartPanHint")) + '</div>';
      svgEl = mount.querySelector("svg");
      var drag = null;
      svgEl.addEventListener("pointerdown", function(ev){
        if (!chartCtx) return;
        drag = { x: ev.clientX, start: chartStart };
        try { svgEl.setPointerCapture(ev.pointerId); } catch(e2){}
        ev.preventDefault();
      });
      svgEl.addEventListener("pointermove", function(ev){
        if (!drag || !chartCtx) return;
        // Delta myszy jest w pikselach CSS \u2014 przeliczamy przez slotPx
        // (jednostki SVG * stosunek ekranu do viewBoxu). Szeroko\u015b\u0107 slotu = 1 pomiar.
        chartStart = clamp(drag.start + (drag.x - ev.clientX) / chartCtx.slotPx, 0, chartCtx.n - chartCtx.visN);
        drawChart(chartCtx.list, mount);
      });
      function endDrag(){ drag = null; }
      svgEl.addEventListener("pointerup", endDrag);
      svgEl.addEventListener("pointercancel", endDrag);
    }
    // Audyt bugfix: listener prze\u0142\u0105cznika osi na KONTENERZE, z flag\u0105 jednorazowej
    // rejestracji. Kontener jest wieczny, a struktura wewn\u0105trz (przycisk+SVG)
    // jest niszczona przy <2 pomiarach i tworzona od nowa \u2014 wcze\u015bniejsze
    // rejestrowanie listenera przy ka\u017cdej rekreacji kumulkowa\u0142o kopie
    // (2+ listener\u00f3w = klikni\u0119cie prze\u0142\u0105cza\u0142o tryb parzy\u015bcie = "martwy" przycisk).
    if (!mount.dataset.chartInit) {
      mount.dataset.chartInit = "1";
      mount.addEventListener("click", function(ev){
        if (!ev.target.closest("#btnAxisMode") || !chartCtx) return;
        chartMode = (chartMode === "cat") ? "time" : "cat";
        drawChart(chartCtx.list, mount);
      });
    }
    var btn = mount.querySelector("#btnAxisMode");
    if (btn) {
      // Etykieta pokazuje tryb, na kt\u00f3ry prze\u0142\u0105czy NAST\u0118PNE klikni\u0119cie
      // (przycisk to "akcja", nie wska\u017anik stanu).
      btn.textContent = (chartMode === "cat") ? t("axisTimeSwitch") : t("axisCatSwitch");
      btn.title = (chartMode === "cat") ? t("axisTimeSwitch") : t("axisCatSwitch");
      btn.setAttribute("aria-pressed", chartMode === "time" ? "true" : "false");
    }
    var rectW = (svgEl.getBoundingClientRect && svgEl.getBoundingClientRect().width) || W;
    chartCtx = { n: n, visN: visN, slotPx: (rectW / W) * (iw / visN), list: list };
    svgEl.setAttribute("viewBox", "0 0 "+W+" "+H);
    svgEl.innerHTML = content;
  }
  var chartCtx = null;   // {n, visN, slotPx, list} \u2014 \u017cywy kontekst dla panu/toggle

  // Audyt(2): po rotacji/zmianie szeroko\u015bci okna wykres sam si\u0119 przerysowuje
  // (debounce 150 ms, tylko gdy ekran Trendy jest aktywny i istnieje kontekst).
  var chartResizeT = null;
  window.addEventListener("resize", function(){
    if (!chartCtx || screenIdx !== 1) return;
    if (chartResizeT) clearTimeout(chartResizeT);
    chartResizeT = setTimeout(function(){ chartResizeT = null; drawChart(chartCtx.list, $("trendsChart")); }, 150);
  });

  function drawTrends(force){
    // Rysuj tylko gdy ekran Trendy jest aktywny, chyba \u017ce wymuszono (zmiana ustawie\u0144)
    if (!force && screenIdx !== 1) return;
    var tableMount = $("trendsTableMount");
    var empty = $("trendsEmpty");
    var sumMount = $("trendsSummary");

    sumMount.textContent = "";
    $("trendsChart").textContent = "";
    chartCtx = null;   // brak kontekstu = resize/pan nie rysuj\u0105 starych danych
    empty.hidden = true;
    tableMount.hidden = true;

    if (!entries.length) {
      empty.innerHTML = '<h3>' + t("emptyTitle") + '</h3>'
        + '<p class="empty-gap">' + t("emptyDesc") + '</p>'
        + '<button class="btn btn--sm" id="btnTrendsAdd">' + t("btnAddFirst") + '</button>';
      empty.hidden = false;
      $("btnTrendsAdd").onclick = function(){ openAdd(null); };
      return;
    }

    var cutoff = (trendsRangeDays === "all") ? -Infinity : Date.now() - trendsRangeDays * DAY_MS;
    // Jedno filtrowanie i jedno sortowanie (malej\u0105co) dla podsumowania i tabeli.
    var filtered = entries.filter(function(e){ return e.ts >= cutoff; })
      .sort(function(a, b){ return b.ts - a.ts; });

    if (!filtered.length) {
      empty.textContent = t("trendsNoData");
      empty.hidden = false;
      return;
    }

    renderSummary(filtered, sumMount);
    drawChart(filtered, $("trendsChart"));
    tableMount.hidden = false;
    TableModule.renderTable(tableMount, filtered, settings, t, fmtDate);
  }

  // Audyt kodu: jeden wsp\u00f3lny handler prze\u0142\u0105cznik\u00f3w zakresu (stan tylko w aria-pressed)
  function bindRangeControls(containerId, onChange){
    var root = $(containerId);
    root.addEventListener("click", function(e){
      var btn = e.target.closest("button[data-range]"); if (!btn) return;
      root.querySelectorAll("button[data-range]").forEach(function(b){ b.setAttribute("aria-pressed", "false"); });
      btn.setAttribute("aria-pressed", "true");
      if (onChange) onChange(btn.dataset.range);
    });
  }
  bindRangeControls("trendsRange", function(r){
    trendsRangeDays = (r === "all") ? "all" : parseInt(r, 10);
    resetChart();   // audyt UX: nowy zakres danych = wykres na pe\u0142nym widoku
    drawTrends();
  });

  var track = $("track");
  var screenIdx = 0;
  function go(i){
    screenIdx = i;
    track.style.transform = "translateX(" + (-i*50) + "%)";
    $("navHistory").classList.toggle("active", i===0);
    $("navHistory").setAttribute("aria-selected", i===0 ? "true" : "false");
    $("navTrends").classList.toggle("active", i===1);
    $("navTrends").setAttribute("aria-selected", i===1 ? "true" : "false");

    var homeSc = $("homeScreen");
    var trendsSc = $("trendsScreen");
    if (i === 0) {
      homeSc.removeAttribute("inert");
      trendsSc.setAttribute("inert", "");
    } else {
      trendsSc.removeAttribute("inert");
      homeSc.setAttribute("inert", "");
      drawTrends(true);
    }
  }

  $("navHistory").onclick = function(){ go(0); };
  $("navTrends").onclick = function(){ go(1); };

  var startX = null, startY = null, dx = 0, dy = 0, axis = null;
  var viewport = $("viewport");
  function allowed(t){
    return !t.closest("#dock") && !t.closest(".sheet") && !t.closest("#trendsChart") &&
           !t.closest("button") && !t.closest("textarea") && !t.closest("input");
  }
  viewport.addEventListener("touchstart", function(e){
    if (!allowed(e.target)) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dy = 0; axis = null; track.classList.add("dragging");
  }, {passive:true});

  viewport.addEventListener("touchmove", function(e){
    if (startX === null) return;
    dx = e.touches[0].clientX - startX;
    dy = e.touches[0].clientY - startY;
    if (axis === null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";   // o\u015b ustalana raz, na pocz\u0105tku gestu
    }
    if (axis !== "x") return;
    var half = viewport.clientWidth;
    var rawOff = -screenIdx*half + dx*0.6;
    var off = Math.max(-half, Math.min(0, rawOff));
    track.style.transform = "translateX("+off+"px)";
  }, {passive:true});

  function endSwipe(){
    if (startX === null) return;
    track.classList.remove("dragging");
    // Audyt(7): przebudowa ekranu (drawTrends) tylko po rzeczywistym ge\u015bcie
    // poziomym; zwyk\u0142e dotkni\u0119cia i przewini\u0119cia pionowe nie ruszaj\u0105 UI.
    if (axis === "x") {
      if (dx < -60 && screenIdx === 0) go(1);
      else if (dx > 60 && screenIdx === 1) go(0);
      else go(screenIdx);   // dosuni\u0119cie z powrotem
    }
    startX = null; startY = null; axis = null;
  }
  viewport.addEventListener("touchend", endSwipe);
  viewport.addEventListener("touchcancel", endSwipe);

  var toolsOverlay = $("toolsOverlay");
  $("btnTools").onclick = function(){ refreshCorruptBtn(); setModalState(toolsOverlay, true); };
  $("btnToolsClose").onclick = function(){ setModalState(toolsOverlay, false); };
  toolsOverlay.addEventListener("click", function(e){ if (e.target === toolsOverlay) setModalState(toolsOverlay, false); });

  var addOverlay = $("addOverlay");
  var editingId = null;
  var addSnapshot = null;   // audyt UX: stan formularza w chwili otwarcia (dirty-check)
  // Audyt UX: pola numeryczne zamiast b\u0119bn\u00f3w (wheel). Zakresy p\u00f3l s\u0105
  // identyczne z LIMITS (koniec z rozjazdem zakres\u00f3w b\u0119benka i danych),
  // pe\u0142na kontrola warto\u015bci z klawiatury numerycznej, mniej kodu.
  function makeNumField(id, lo, hi){
    var inp = $(id);
    inp.min = lo; inp.max = hi;
    return {
      set: function(v){ inp.value = (v != null && isFinite(v)) ? v : ""; },
      get: function(){
        var raw = String(inp.value).replace(",", ".").trim();
        if (raw === "") return null;
        var v = parseFloat(raw);
        return isFinite(v) ? v : NaN;   // bez przycinania: zakres sprawdza btnSave i pokazuje b\u0142\u0105d
      }
    };
  }
  function clamp(v,a,b){ return Math.min(b, Math.max(a, v)); }
  function makeId(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var sysField = makeNumField("wSys", LIMITS.sys[0], LIMITS.sys[1]);
  var diaField = makeNumField("wDia", LIMITS.dia[0], LIMITS.dia[1]);
  var hrField  = makeNumField("wHr",  LIMITS.hr[0],  LIMITS.hr[1]);
  var WGT_MIN = LIMITS.wgt[0], WGT_MAX = LIMITS.wgt[1];
  var wgtInput = $("wWgt");
  var weightField = makeNumField("wWgt", WGT_MIN, WGT_MAX);
  // Audyt kodu: jedno miejsce sortowania malej\u0105co po dacie
  function sortedDesc(){ return entries.slice().sort(function(a,b){ return b.ts - a.ts; }); }

  // ostatnia znana warto\u015b\u0107 (nie tylko z najnowszego wpisu, kt\u00f3ry m\u00f3g\u0142 jej nie mie\u0107)
  function lastKnown(key, fallback){
    var arr = sortedDesc();
    for (var i = 0; i < arr.length; i++) { if (arr[i][key] != null) return arr[i][key]; }
    return fallback;
  }
  function bumpWeight(d){
    var cur = weightField.get();
    if (cur === null || isNaN(cur)) cur = lastKnown("wgt", settings.defWgt);
    weightField.set(Math.round(clamp(cur + d, WGT_MIN, WGT_MAX) * 10) / 10);
  }
  document.querySelectorAll("#boxWWgt .num-btns button").forEach(function(b){
    var d = parseFloat(b.dataset.wstep), delay = null, iv = null;
    function stop(){ clearTimeout(delay); clearInterval(iv); iv = null; }
    b.addEventListener("pointerdown", function(e){
      e.preventDefault(); bumpWeight(d); stop();
      delay = setTimeout(function(){ iv = setInterval(function(){ bumpWeight(d); }, 90); }, 450);
    });
    ["pointerup","pointerleave","pointercancel"].forEach(function(ev){ b.addEventListener(ev, stop); });
    b.addEventListener("keydown", function(e){ if (e.key === "Enter" || e.key === " "){ e.preventDefault(); bumpWeight(d); } });
  });

  function syncOptionalWheels(){
    [["boxWHr","wHr","btnClearWHr",hrActive,"Hr"],["boxWWgt","wWgt","btnClearWWgt",wgtActive,"Wgt"]].forEach(function(a){
      $(a[0]).classList.toggle("disabled", !a[3]);
      // Audyt UX: wszystkie parametry to teraz pola input \u2014 jedno-disable wystarcza
      $(a[1]).disabled = !a[3];
      if (a[1] === "wWgt") document.querySelectorAll("#boxWWgt .num-btns button").forEach(function(b){ b.disabled = !a[3]; });
      var b = $(a[2]);
      var lbl = t((a[3] ? "skip" : "add") + a[4]);
      b.setAttribute("aria-label", lbl); b.title = lbl;
      b.textContent = a[3] ? "\u2715" : "+";
    });
    // Audyt UX: b\u0119bny usuni\u0119te \u2014 zostaj\u0105 tylko etykiety przycisk\u00f3w wagi
    $("btnWgtDec").setAttribute("aria-label", t("wgtDec"));
    $("btnWgtInc").setAttribute("aria-label", t("wgtInc"));
  }
  $("btnClearWHr").onclick = function(){
    hrActive = !hrActive;
    if (!editingId) { settings.incHr = hrActive; StorageModule.saveSettings(settings); }
    syncOptionalWheels();
    // W\u0142\u0105czenie t\u0119tna ustawia fokus na pustym polu (bez podstawiania starej warto\u015bci).
    if (hrActive) { try { $("wHr").focus(); } catch(e){} }
  };
  $("btnClearWWgt").onclick = function(){
    wgtActive = !wgtActive;
    if (!editingId) { settings.incWgt = wgtActive; StorageModule.saveSettings(settings); }
    syncOptionalWheels();
    if (wgtActive) { try { wgtInput.focus(); } catch(e){} }
  };

  var persistTried = false;
  function requestPersist(){
    if (persistTried || settings.persistAsked) return;
    persistTried = true;
    if (!(navigator.storage && navigator.storage.persist && navigator.storage.persisted)) return;
    navigator.storage.persisted().then(function(p){ return p ? true : navigator.storage.persist(); })
      .then(function(granted){
        // Flaga "pytano" tylko, gdy trwa\u0142o\u015b\u0107 faktycznie przyznano; w przeciwnym
        // razie (np. iOS Safari w przegl\u0105darce) spr\u00f3bujemy ponownie w kolejnej sesji.
        if (granted) { settings.persistAsked = true; StorageModule.saveSettings(settings); }
      })
      .catch(function(){});
  }

  function openAdd(entry){
    editingId = entry ? entry.id : null;
    $("addTitle").textContent = entry ? t("addTitleEdit") : t("addTitleNew");
    $("noteField").value = entry ? (entry.note||"") : "";
    $("dtField").min = "2000-01-01T00:00"; $("dtField").max = "2099-12-31T23:59";
    $("dtField").value = toLocalInput(entry ? entry.ts : Date.now());
    
    $("btnDeleteEntryHeader").style.display = entry ? "block" : "none";
    $("bpInlineError").hidden = true;

    $("boxWSys").style.display = settings.trackSys ? "block" : "none";
    $("boxWDia").style.display = settings.trackDia ? "block" : "none";
    $("boxWHr").style.display = settings.trackHr ? "block" : "none";
    $("boxWWgt").style.display = settings.trackWgt ? "block" : "none";

    hrActive = entry ? (entry.hr != null) : !!settings.incHr;
    $("boxWHr").classList.toggle("disabled", !hrActive);

    // Pola nowego wpisu s\u0105 PUSTE (placeholder to tylko podpowied\u017a) \u2014 poprzedni pomiar
    // nie mo\u017ce przypadkiem zosta\u0107 zapisany jako nowy odczyt.

    wgtActive = entry ? (entry.wgt != null) : !!settings.incWgt;
    $("boxWWgt").classList.toggle("disabled", !wgtActive);
    syncOptionalWheels();
    weightField.set(entry ? entry.wgt : null);

    setModalState(addOverlay, true);
    // Audyt UX: pola numeryczne \u2014 bez warto\u015bci poza zakresem nie ma
    // warninga o "przyci\u0119ciu" (zakresy p\u00f3l = LIMITS).
    if (settings.trackSys) sysField.set(entry ? entry.sys : null);
    if (settings.trackDia) diaField.set(entry ? entry.dia : null);
    if (settings.trackHr) hrField.set(entry ? entry.hr : null);
    addSnapshot = JSON.stringify(collectAddState());
  }

  // --- Audyt UX: dirty-check arkusza edycji ---
  // Klik w t\u0142o / Escape / "Anuluj" przy niezapisanych zmianach pytaj\u0105
  // o potwierdzenie, zamiast po cichu gubi\u0107 dane u\u017cytkownika.
  function collectAddState(){
    return {
      note: $("noteField").value,
      dt: $("dtField").value,
      hrActive: hrActive, wgtActive: wgtActive,
      sys: settings.trackSys ? sysField.get() : null,
      dia: settings.trackDia ? diaField.get() : null,
      hr:  (settings.trackHr && hrActive) ? hrField.get() : null,
      wgt: (settings.trackWgt && wgtActive) ? weightField.get() : null
    };
  }
  function isAddDirty(){
    if (!addSnapshot || !addOverlay.classList.contains("open")) return false;
    return JSON.stringify(collectAddState()) !== addSnapshot;
  }
  function requestCloseAdd(){
    var dirty = isAddDirty();
    addSnapshot = null;
    if (!dirty) { setModalState(addOverlay, false); return; }
    openDialog({ title: t("discardTitle"), text: t("discardConfirm"), ok: t("btnDiscard"), danger: true }, function(proceed){
      if (proceed) setModalState(addOverlay, false);
      else addSnapshot = JSON.stringify(collectAddState());   // przywr\u00f3\u0107 snapshot \u2014 arkusz zostaje otwarty
    });
  }

  $("btnAdd").onclick = function(){ openAdd(null); };
  addOverlay.addEventListener("click", function(e){ if (e.target === addOverlay) requestCloseAdd(); });
  $("btnCancelEntry").onclick = requestCloseAdd;
  $("btnDeleteEntryHeader").onclick = function(){ if(editingId) deleteEntryWithUndo(editingId); };

  $("btnSave").onclick = function(){
    var wgtVal = (settings.trackWgt && wgtActive) ? weightField.get() : null;
    var hrVal = (settings.trackHr && hrActive) ? hrField.get() : null;
    var sysVal = settings.trackSys ? sysField.get() : null;
    var diaVal = settings.trackDia ? diaField.get() : null;

    var errEl = $("bpInlineError");
    function badNum(v){ return v === null || isNaN(v); }
    // Wpis edytowany, kt\u00f3ry kiedy\u015b powsta\u0142 przy wy\u0142\u0105czonym parametrze, mo\u017ce mie\u0107 w nim pustk\u0119.
    var origEntry = editingId ? entries.find(function(x){ return x.id === editingId; }) : null;
    function missing(v, key){ return badNum(v) && !(origEntry && origEntry[key] == null && v === null); }
    function outOfRange(v, lim){ return v !== null && !isNaN(v) && (v < lim[0] || v > lim[1]); }
    // Audyt UX: pusty obowi\u0105zkowy parametr = b\u0142\u0105d (kiedy\u015b b\u0119benek gwarantowa\u0142 warto\u015b\u0107)
    if ((settings.trackSys && missing(sysVal, "sys")) || (settings.trackDia && missing(diaVal, "dia")) ||
        (settings.trackHr && hrActive && missing(hrVal, "hr"))) {
      errEl.textContent = t("numRequiredMsg");
      errEl.hidden = false;
      try { errEl.scrollIntoView({block:"nearest", behavior:"smooth"}); } catch(e){}
      return;
    }
    if ((settings.trackSys && outOfRange(sysVal, LIMITS.sys)) || (settings.trackDia && outOfRange(diaVal, LIMITS.dia)) ||
        (settings.trackHr && hrActive && outOfRange(hrVal, LIMITS.hr))) {
      errEl.textContent = t("rangeMsg");
      errEl.hidden = false;
      try { errEl.scrollIntoView({block:"nearest", behavior:"smooth"}); } catch(e){}
      return;
    }
    if (settings.trackSys && settings.trackDia && sysVal !== null && diaVal !== null && sysVal <= diaVal) {
      errEl.textContent = t("bpErrorMsg");
      errEl.hidden = false;
      try { errEl.scrollIntoView({block:"nearest", behavior:"smooth"}); } catch(e){}
      return;
    }
    if (wgtVal !== null && (isNaN(wgtVal) || wgtVal < WGT_MIN || wgtVal > WGT_MAX)) {
      errEl.textContent = t("wgtErrorMsg");
      errEl.hidden = false;
      try { wgtInput.focus(); } catch(e){}
      return;
    }
    errEl.hidden = true;

    var note = $("noteField").value.trim();
    var dtVal = $("dtField").value;
    var ts = dtVal ? new Date(dtVal).getTime() : Date.now();
    // Data poza zakresem akceptowanym przy \u0142adowaniu = wpis znikn\u0105\u0142by po od\u015bwie\u017ceniu.
    if (!QardisCore.validFormTs(ts)) {
      errEl.textContent = t("dateRangeMsg");
      errEl.hidden = false;
      try { $("dtField").focus(); } catch(e){}
      return;
    }
    // Audyt: data z przysz\u0142o\u015bci \u2014 ostrze\u017c (kolejka, nie pilne), ale pozw\u00f3l zapisa\u0107.
    // Pilne zast\u0105pi\u0142oby toast "zapisano"; tak potwierdzenie pokazuje si\u0119 pierwsze.
    // Jeden komunikat zamiast dw\u00f3ch: ostrze\u017cenie o dacie z przysz\u0142o\u015bci sta\u0142oby w kolejce
    // przed potwierdzeniem zapisu i op\u00f3\u017ania\u0142o je o kilka sekund.
    var okMsg = "\u2713 " + t(editingId ? "updatedMsg" : "savedMsg");
    var okMs = 2200;
    if (ts > Date.now() + 60000) { okMsg += ". \u26a0 " + t("futureDateWarn"); okMs = 4500; }
    
    var e = editingId ? entries.find(function(x){ return x.id===editingId; }) : null;
    if (e) {
      var updated = { note: note, ts: ts };
      if (settings.trackSys) updated.sys = sysVal;
      if (settings.trackDia) updated.dia = diaVal;
      if (settings.trackHr) updated.hr = hrVal;
      if (settings.trackWgt) updated.wgt = wgtVal;
      Object.assign(e, updated);
    } else {
      // Nowy wpis \u2014 tak\u017ce gdy edytowany wpis znikn\u0105\u0142 w mi\u0119dzyczasie (usuni\u0119ty w innej karcie):
      // dane u\u017cytkownika nie przepadaj\u0105 po cichu.
      entries.push({id: makeId(), ts:ts, note:note, sys:sysVal, dia:diaVal, hr:hrVal, wgt:wgtVal});
    }
    // Najpierw zapis, potem komunikat \u2014 \u201ezapisano\u201d tylko, gdy zapis si\u0119 uda\u0142.
    if (StorageModule.saveEntries(entries)) toast(okMsg, okMs);
    else toast(t("storageError"), 6000, true);
    addSnapshot = null;   // zapisano \u2014 zamykamy bez dirty-check
    setModalState(addOverlay, false);
    render();
    requestPersist();
  };

  $("btnBackup").onclick = function(){
    // Audyt(8): kopia "wszystko w jednym" (v3) \u2014 wpisy + archiwum + ustawienia.
    // Pe\u0142na migracja urz\u0105dzenia to jeden plik, nie dwa.
    openDialog({ title: t("titleBtnBackup"), text: t("privacyAlert") + "\n\n" + t("archiveInBackup"), ok: t("btnExport") }, function(proceed){
    if (!proceed) return;
    var exp = {};
    ["theme","lang","fontSize","trackSys","trackDia","trackHr","trackWgt","incHr","incWgt"]
      .forEach(function(k){ exp[k] = settings[k]; });
    var backupObj = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      app: "Qardis",
      settings: exp,
      entries: entries,
      archive: StorageModule.loadArchive()
    };
    downloadFile("qardis-kopia-"+ymd(new Date())+".json", JSON.stringify(backupObj, null, 2));
    settings.lastBackupAt = Date.now();     // audyt(3): odmierzaj czas do przypominacza
    StorageModule.saveSettings(settings);
    setModalState(toolsOverlay, false);
    toast("\u2713 " + t("backupDone"));
    });
  };

  $("btnWipe").onclick = function(){
    openDialog({ title: t("titleBtnWipe"), text: t("wipeConfirm"), ok: t("btnDelete"), danger: true }, function(proceed){
    if (!proceed) return;
    setModalState(settingsOverlay, false);
    settingsDraft = null; settingsBefore = null;
    StorageModule.wipeAll();
    entries = []; pendingDeletes = [];
    if (deleteTimeout) { clearTimeout(deleteTimeout); deleteTimeout = null; }
    settings = StorageModule.loadSettings();
    applyTheme(); applyLanguage(); applyFontSize(); render();
    toast("\u2713 " + t("wipeDone"));
    });
  };

  $("btnImport").onclick = function(){ $("importFile").click(); setModalState(toolsOverlay, false); };

  $("importFile").addEventListener("change", function(ev){
    var f = ev.target.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast(t("importError")); ev.target.value = ""; return; }
    openDialog({ title: t("titleBtnImport"), text: t("importConfirm") }, function(proceed){
      if(!proceed){ ev.target.value = ""; return; }
      var r = new FileReader();
    r.onload = function(){
      try{
        var j = JSON.parse(r.result);
        if (!ValidationModule.validateImport(j)) throw new Error("invalid schema or ranges");
        // Audyt: wersja formatu. Odrzucamy tylko NOWSZE ni\u017c znane (v > 3), bo
        // starsze potrafimy poprawnie wczyta\u0107: kopia v3/v2 (v3 = z archiwum),
        // starsze obiekty bez pola, plik archiwum (type: "qardis-archive", v1)
        // i surowa tablica.
        var v = (j && !Array.isArray(j)) ? j.schemaVersion : undefined;
        if (v !== undefined && !(v >= 1 && v <= 3)) throw new Error("unsupported schemaVersion");
        var list = j.entries || j;
        var ids = Object.create(null), sigs = Object.create(null);
        entries.forEach(function(e){ ids[e.id]=1; sigs[QardisCore.entrySig(e)]=1; });
        var added = 0, skipped = 0;
        list.forEach(function(e){
          var item = sanitizeEntry(e);
          // Rekordy bez wa\u017cnego ts pomijamy jawnie (koniec z cichym Date.now());
          // rekordy z warto\u015bciami poza zakresem (np. waga < 20 kg) r\u00f3wnie\u017c \u2013
          // bez utraty danych i bez odrzucania ca\u0142ego pliku.
          if (!item || item.ts === null || lossy(e, item)) { skipped++; return; }
          if (item.sys != null && item.dia != null && item.sys <= item.dia) { skipped++; return; }
          if (!item.id) item.id = makeId();
          if (ids[item.id]) { skipped++; return; }   // duplikat id liczony jako pomini\u0119ty
          var sig = QardisCore.entrySig(item);
          if (sigs[sig]) { skipped++; return; }     // ten sam odczyt z innego urz\u0105dzenia (inne id)
          entries.push(item); ids[item.id]=1; sigs[sig]=1; added++;
        });
        var saved = StorageModule.saveEntries(entries);
        if (!saved) toast(t("importSavedWarning"), 9000, true);   // audyt(10): dane tylko w RAM do prze\u0142adowania
        // Audyt(8): kopia v3 zawiera archiwum \u2014 scal po id z lokalnym archiwum.
        if (j && !Array.isArray(j) && Array.isArray(j.archive)) {
          var arc = StorageModule.loadArchive();
          var arcIds = Object.create(null);
          arc.forEach(function(e){ arcIds[e.id] = 1; });
          var arcAdded = 0;
          j.archive.forEach(function(e){
            var c = sanitizeEntry(e);
            if (!c || !c.ts || lossy(e, c)) return;
            if (!c.id) c.id = makeId();
            if (arcIds[c.id] || ids[c.id]) return;   // ju\u017c w archiwum albo na li\u015bcie g\u0142\u00f3wnej
            arc.push(c); arcIds[c.id] = 1; arcAdded++;
          });
          if (arcAdded && !StorageModule.saveArchive(arc)) toast(t("storageError"), 5000, true);
        }
        render();
        if (j && !Array.isArray(j) && j.settings && typeof j.settings === "object") {
          openDialog({ title: t("settingsTitle"), text: t("importSettingsConfirm") }, function(yes){
          if (!yes) return;
          var keepAsked = settings.persistAsked;
          var keepBackupAt = settings.lastBackupAt;
          settings = StorageModule.sanitizeSettings(j.settings);
          settings.persistAsked = keepAsked;
          settings.lastBackupAt = keepBackupAt;   // audyt: plik nie przesuwa przypominacza o kopii
          if (!StorageModule.saveSettings(settings)) toast(t("storageError"));
            applyTheme(); applyLanguage(); applyFontSize(); render();
          });
        }
        toast("\u2713 " + t("importedMsg")+added+pluralEntries(added)+(skipped ? t("importSkipped")+skipped : ""));
      }catch(err){ toast(err && err.message === "unsupported schemaVersion" ? t("importVersionError") : t("importError")); }
    };
      r.readAsText(f);
    });
    ev.target.value = "";
  });

  var pdfExportRange = "all";
  var pdfOverlayEl = $("pdfRangeOverlay");
  $("btnPdf").onclick = function(){
    setModalState(toolsOverlay, false);
    if (!entries.length){ toast(t("noEntriesPdf")); return; }
    setModalState(pdfOverlayEl, true);
  };
  // Audyt UX: eksport CSV \u2014 otwieralny w Excelu/LibreOffice bez konwersji.
  // (csvEscape w core.js \u2014 testowane jednostkowo.)
  $("btnCsv").onclick = function(){
    if (!entries.length) { toast(t("noEntriesPdf")); return; }
    var head = ["date","time","sys_mmhg","dia_mmhg","hr_bpm","weight_kg","note"].join(";");
    var rows = sortedDesc().map(function(e){
      var f = fmtDate(e.ts);
      var comma = settings.lang !== "en";
      return [f.date, f.time, e.sys, e.dia, e.hr, e.wgt, e.note].map(function(v){ return QardisCore.csvEscape(v, comma); }).join(";");
    });
    // BOM UTF-8 (poprawne polskie znaki w Excelu) + \r\n (konwencja CSV dla Windows)
    downloadFile("qardis-dane-"+ymd(new Date())+".csv",
      "\uFEFF" + head + "\r\n" + rows.join("\r\n"), "text/csv");
    setModalState(toolsOverlay, false);
    toast("\u2713 " + t("csvDone"));
  };

  bindRangeControls("pdfRange", function(r){
    pdfExportRange = (r === "all") ? "all" : parseInt(r, 10);
  });
  $("btnPdfCancel").onclick = function(){ setModalState(pdfOverlayEl, false); };
  pdfOverlayEl.addEventListener("click", function(e){ if (e.target === pdfOverlayEl) setModalState(pdfOverlayEl, false); });
  $("btnPdfExport").onclick = function(){
    setModalState(pdfOverlayEl, false);
    savePdf();
  };
  $("btnPdfPrint").onclick = function(){
    setModalState(pdfOverlayEl, false);
    printReport();
  };

  function reportEntries(){
    return sortedDesc().filter(function(e){
      if (pdfExportRange === "all") return true;
      return e.ts >= Date.now() - pdfExportRange * DAY_MS;
    });
  }
  function reportCols(){
    var cols = [];
    if (settings.trackSys) cols.push({ label: "sysLabel", key: "sys", unit: "mmHg" });
    if (settings.trackDia) cols.push({ label: "diaLabel", key: "dia", unit: "mmHg" });
    if (settings.trackHr)  cols.push({ label: "hrLabel",  key: "hr",  unit: "bpm" });
    if (settings.trackWgt) cols.push({ label: "wgtLabel", key: "wgt", unit: "kg" });
    return cols;
  }

  // --- Zapis PDF bez okna drukowania ---
  // Strony rysujemy na canvasie (A4 poziomo, 2x) i pakujemy jako JPEG do PDF
  // (QardisCore.buildPdf). Dzi\u0119ki temu nie trzeba osadza\u0107 font\u00f3w (polskie znaki
  // dzia\u0142aj\u0105 od razu), a CSP nie blokuje niczego. Tekst w pliku nie jest zaznaczalny \u2014
  // do tego s\u0142u\u017cy opcja \u201eDrukuj\u201d.
  function renderReportPages(arr, cols){
    var PW = 842, PH = 595, M = 34, S = 2, FONT = "Arial, Helvetica, sans-serif";
    var DATE_W = 100, COL_W = 70, HEAD_H = 30, LINE = 13, PADY = 5, MINROW = 20;
    var noteW = PW - 2 * M - DATE_W - COL_W * cols.length;
    var loc = settings.lang === "en" ? "en-US" : "pl-PL";
    var cv = document.createElement("canvas");
    cv.width = PW * S; cv.height = PH * S;
    var ctx = cv.getContext("2d");
    ctx.font = "italic 11px " + FONT;
    function measure(s){ return ctx.measureText(s).width; }

    var rows = arr.map(function(e){
      var f = fmtDate(e.ts);
      var lines = e.note ? QardisCore.wrapText(e.note, noteW - 12, measure, 6) : [];
      return {
        date: f.date + " " + f.time,
        vals: cols.map(function(c){ return e[c.key] != null ? String(e[c.key]) : ""; }),
        lines: lines,
        h: Math.max(MINROW, lines.length * LINE + 2 * PADY)
      };
    });

    // Paginacja: pierwsza strona ma blok tytu\u0142owy
    var limit = PH - M - 8, pageRows = [], cur = [], y = M + 46 + HEAD_H;
    rows.forEach(function(r){
      if (cur.length && y + r.h > limit) { pageRows.push(cur); cur = []; y = M + HEAD_H; }
      cur.push(r); y += r.h;
    });
    pageRows.push(cur);

    var head = [{ w: DATE_W, label: t("pdfHeaderDt"), unit: "" }]
      .concat(cols.map(function(c){ return { w: COL_W, label: t(c.label), unit: c.unit }; }))
      .concat([{ w: noteW, label: t("pdfHeaderNotes"), unit: "" }]);

    var out = [];
    pageRows.forEach(function(list, pi){
      ctx.setTransform(S, 0, 0, S, 0, 0);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH);
      ctx.textBaseline = "alphabetic"; ctx.lineWidth = 0.5; ctx.strokeStyle = "#999";
      var y = M;
      if (pi === 0) {
        ctx.textAlign = "left"; ctx.fillStyle = "#000"; ctx.font = "bold 18px " + FONT;
        ctx.fillText(t("pdfTitle"), M, y + 16);
        ctx.font = "11px " + FONT; ctx.fillStyle = "#555";
        ctx.fillText(t("pdfGen") + new Date().toLocaleString(loc), M, y + 34);
        y += 46;
      }
      var x = M;
      ctx.textAlign = "center";
      head.forEach(function(c){
        ctx.fillStyle = "#eee"; ctx.fillRect(x, y, c.w, HEAD_H); ctx.strokeRect(x, y, c.w, HEAD_H);
        ctx.fillStyle = "#000"; ctx.font = "bold 10px " + FONT;
        ctx.fillText(c.label, x + c.w / 2, y + (c.unit ? 13 : 18), c.w - 6);
        if (c.unit) { ctx.font = "9px " + FONT; ctx.fillStyle = "#555"; ctx.fillText(c.unit, x + c.w / 2, y + 24, c.w - 6); }
        x += c.w;
      });
      y += HEAD_H;
      list.forEach(function(r){
        var cx = M, mid = y + r.h / 2 + 4;
        ctx.fillStyle = "#000"; ctx.font = "11px " + FONT;
        ctx.strokeRect(cx, y, DATE_W, r.h);
        ctx.textAlign = "left"; ctx.fillText(r.date, cx + 6, mid, DATE_W - 8);
        cx += DATE_W;
        ctx.textAlign = "center";
        r.vals.forEach(function(v){
          ctx.strokeRect(cx, y, COL_W, r.h);
          ctx.fillText(v, cx + COL_W / 2, mid, COL_W - 6);
          cx += COL_W;
        });
        ctx.strokeRect(cx, y, noteW, r.h);
        ctx.textAlign = "left"; ctx.font = "italic 11px " + FONT;
        r.lines.forEach(function(ln, li){ ctx.fillText(ln, cx + 6, y + PADY + 9 + li * LINE); });
        y += r.h;
      });
      ctx.font = "9px " + FONT; ctx.fillStyle = "#777";
      ctx.textAlign = "left"; ctx.fillText("Qardis", M, PH - 16);
      ctx.textAlign = "right"; ctx.fillText((pi + 1) + " / " + pageRows.length, PW - M, PH - 16);

      var b64 = cv.toDataURL("image/jpeg", 0.82).split(",")[1];
      if (!b64) throw new Error("canvas export failed");
      var bin = atob(b64), data = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      out.push({ data: data, w: cv.width, h: cv.height });
    });
    return out;
  }
  function savePdf(){
    var arr = reportEntries();
    if (!arr.length){ toast(t("trendsNoData")); return; }
    setTimeout(function(){   // kr\u00f3tka zw\u0142oka: arkusz zd\u0105\u017cy si\u0119 zamkn\u0105\u0107 przed ci\u0119\u017ck\u0105 prac\u0105
      try {
        var pages = renderReportPages(arr, reportCols());
        var bytes = QardisCore.buildPdf(pages, 842, 595, t("pdfTitle"));
        downloadFile("qardis-raport-" + ymd(new Date()) + ".pdf", new Blob([bytes], { type: "application/pdf" }));
        toast("\u2713 " + t("pdfSaved"));
      } catch (err) { toast(t("pdfSaveError"), 5000, true); }
    }, 40);
  }

  // --- Drukuj (okno wydruku przegl\u0105darki) ---
  function printReport(){
    var arr = reportEntries();
    if (!arr.length){ toast(t("trendsNoData")); return; }
    var pdfCols = [];
    if (settings.trackSys) pdfCols.push(["sysLabel", "sys"]);
    if (settings.trackDia) pdfCols.push(["diaLabel", "dia"]);
    if (settings.trackHr)  pdfCols.push(["hrLabel", "hr"]);
    if (settings.trackWgt) pdfCols.push(["wgtLabel", "wgt"]);
    var rows = arr.map(function(e){
      var f = fmtDate(e.ts);
      return "<tr><td>"+escapeHtml(f.date+" "+f.time)+"</td>"
        + pdfCols.map(function(c){ return "<td>"+escapeHtml(e[c[1]] != null ? String(e[c[1]]) : "")+"</td>"; }).join("")
        + "<td>"+escapeHtml(e.note||"")+"</td></tr>";
    }).join("");
    var loc = settings.lang === "en" ? "en-US" : "pl-PL";
    // Style jako osobny ci\u0105g: okno about:blank dziedziczy CSP otwieraj\u0105cego,
    // wi\u0119c inline <style> by\u0142by zablokowany przez 'style-src self'. Arkusz
    // konstruowany (CSSOM) omija restrykcje CSP \u2014 patrz adoptedStyleSheets ni\u017cej.
    var cssRules = [
      '@page{size:A4 landscape;margin:12mm;}',
      'body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;}',
      'h1{font-size:18px;margin:0 0 4px;}',
      'p.sub{font-size:11px;color:#555;margin:0 0 16px;}',
      'table{border-collapse:collapse;width:100%;font-size:12px;}',
      'th,td{border:1px solid #999;padding:5px 8px;text-align:center;}',
      'th{background:#eee;}',
      'td:first-child{text-align:left;white-space:nowrap;}',
      'td:last-child{text-align:left;font-style:italic;}',
      'thead{display:table-header-group;}',
      'tr{page-break-inside:avoid;}',
      '@media print{p.hint{display:none;}}'
    ];
    var html = '<!doctype html><html lang="'+escapeHtml(settings.lang)+'"><head><meta charset="utf-8"><title>'+escapeHtml(t("pdfTitle"))+'</title></head><body>'
      +'<h1>'+escapeHtml(t("pdfTitle"))+'</h1>'
      +'<p class="sub">'+escapeHtml(t("pdfGen")+new Date().toLocaleString(loc))+'</p>'
      +'<p class="hint">'+escapeHtml(t("pdfHint"))+'</p>'
      +'<table><thead><tr><th>'+escapeHtml(t("pdfHeaderDt"))+'</th>'+pdfCols.map(function(c){ return '<th>'+escapeHtml(t(c[0]))+'</th>'; }).join('')+'<th>'+escapeHtml(t("pdfHeaderNotes"))+'</th></tr></thead>'
      +'<tbody>'+rows+'</tbody></table></body></html>';

    // Audyt CSP: zamiast ukrytego iframe.srcdoc (dziedziczy CSP rodzica i
    // wymusza\u0142 'unsafe-inline' w style-src) \u2014 osobne okno wydruku window.open.
    // Wywo\u0142anie z gestu u\u017cytkownika, wi\u0119c blokady pop-up\u00f3w nie przeszkadzaj\u0105.
    var w = window.open("", "_blank");
    if (!w) { toast(t("pdfError")); return; }   // blokada pop-up\u00f3w lub tryb prywatny
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
      // Style przez CSSOM (omija style-src CSP). Safari < 16.4 nie ma adoptedStyleSheets \u2014
      // wtedy pusty <style> + insertRule (te\u017c CSSOM), zamiast przerywa\u0107 ca\u0142y eksport.
      try {
        var sheet = new w.CSSStyleSheet();
        sheet.replaceSync(cssRules.join(""));
        w.document.adoptedStyleSheets = [sheet];
      } catch (errSheet) {
        var st = w.document.createElement("style");
        w.document.head.appendChild(st);
        cssRules.forEach(function(r){ try { st.sheet.insertRule(r, st.sheet.cssRules.length); } catch(e3){} });
      }
      w.document.title = t("pdfTitle");
      // Po wydruku (lub anulowaniu) zamknij okno, \u017ceby nie zostawa\u0142a pusta karta.
      w.onafterprint = function(){ try { w.close(); } catch(e){} };
      setTimeout(function(){ try { w.focus(); w.print(); } catch(err){ toast(t("pdfError")); } }, 200);
    } catch(err){
      toast(t("pdfError"));
      try { w.close(); } catch(e2){}
    }
  }

  var settingsOverlay = $("settingsOverlay");
  
  $("btnSettingsDock").onclick = function(){
    settingsBefore = Object.assign({}, settings);
    settingsDraft = Object.assign({}, settings);
    
    renderMonitoredButtons();

    applyLanguage(); applyFontSize();
    $("themeToggle").classList.toggle("on", settingsDraft.theme === "dark");
    $("themeToggle").setAttribute("aria-checked", settingsDraft.theme === "dark" ? "true" : "false");
    setModalState(settingsOverlay, true);
  };

  $("monitoredSwitch").addEventListener("click", function(e){
    var btn = e.target.closest("button"); if (!btn) return;
    if (!settingsDraft) return;
    var key = btn.dataset.param;
    if (settingsDraft[key]) {
      var othersOn = ["trackSys","trackDia","trackHr","trackWgt"].some(function(k){ return k !== key && settingsDraft[k]; });
      if (!othersOn) { toast("\u26a0 " + t("minParamWarn")); return; }   // ostatniego nie wy\u0142\u0105czamy
    }
    settingsDraft[key] = !settingsDraft[key];
    renderMonitoredButtons();
  });

  $("langSwitch").addEventListener("click", function(e){
    var btn = e.target.closest("button"); if (!btn) return;
    if(!settingsDraft) return;
    settingsDraft.lang = btn.dataset.val;
    settings.lang = settingsDraft.lang; 
    applyLanguage();
  });

  $("fontSizeSwitch").addEventListener("click", function(e){
    var btn = e.target.closest("button"); if (!btn) return;
    if(!settingsDraft) return;
    settingsDraft.fontSize = btn.dataset.val;
    settings.fontSize = settingsDraft.fontSize; applyFontSize();
  });

  settingsOverlay.addEventListener("click", function(e){ if (e.target === settingsOverlay) cancelSettings(); });
  function saveSettings(){
    if(!settingsDraft) return;
    settings = Object.assign({}, settingsDraft);
    if (!StorageModule.saveSettings(settings)) toast(t("storageError"));
    setModalState(settingsOverlay, false);
    settingsDraft=null; settingsBefore=null;
    render();
    toast("\u2713 " + t("settingsSaved"));
  }
  function cancelSettings(){
    setModalState(settingsOverlay, false);
    if(settingsBefore){
      settings = Object.assign({}, settingsBefore);
      applyTheme(); applyLanguage(); applyFontSize(); render();
      settingsDraft=null; settingsBefore=null;
    }
  }
  $("btnSetSave").onclick = saveSettings;
  $("btnSetCancel").onclick = cancelSettings;

  function toggleThemeDraft(){
    if(!settingsDraft) return;
    settingsDraft.theme = settingsDraft.theme === "dark" ? "light" : "dark";
    settings.theme = settingsDraft.theme;
    this.classList.toggle("on", settingsDraft.theme === "dark");
    this.setAttribute("aria-checked", settingsDraft.theme === "dark" ? "true" : "false");
    applyTheme();
  }
  $("themeToggle").onclick = toggleThemeDraft;

  var lastFocusEl = null;
  function setModalState(el, isOpen) {
    var bg = [$("viewport"), $("dock")];
    if (isOpen) {
      if (!document.querySelector(".overlay.open")) lastFocusEl = document.activeElement;
      // Okno potwierdzenia le\u017cy nad arkuszem: arkusz pod spodem te\u017c nie mo\u017ce \u0142apa\u0107 Tab/czytnika.
      document.querySelectorAll(".overlay.open").forEach(function(o){ if (o !== el) o.setAttribute("inert", ""); });
      el.classList.add("open");
      el.removeAttribute("inert");
      bg.forEach(function(b){ b.setAttribute("inert", ""); });
      var sheet = el.querySelector(".sheet");
      if (sheet) {
        sheet.setAttribute("tabindex", "-1");
        setTimeout(function(){ try { sheet.focus({preventScroll:true}); } catch(e){} }, 30);
      }
    } else {
      el.classList.remove("open");
      el.setAttribute("inert", "");
      var below = document.querySelectorAll(".overlay.open");
      below.forEach(function(o){ o.removeAttribute("inert"); });
      if (below.length) {
        var bsheet = below[below.length - 1].querySelector(".sheet");
        if (bsheet) setTimeout(function(){ try { bsheet.focus({preventScroll:true}); } catch(e){} }, 30);
      }
      if (!below.length) {
        bg.forEach(function(b){ b.removeAttribute("inert"); });
        if (lastFocusEl && document.contains(lastFocusEl) && lastFocusEl.focus) { try { lastFocusEl.focus({preventScroll:true}); } catch(e){} }
        lastFocusEl = null;
      }
    }
  }

  // Audyt(1): arkusz potwierdze\u0144 w stylu aplikacji zamiast systemowych okien
  var dialogEl = $("dialogOverlay");
  var dialogCb = null;
  function openDialog(opts, cb){
    $("dialogTitle").textContent = opts.title || "";
    $("dialogText").textContent = opts.text || "";
    var okBtn = $("dialogOk");
    okBtn.textContent = opts.ok || t("btnProceed");
    okBtn.classList.toggle("danger", !!opts.danger);
    $("dialogCancel").hidden = !!opts.info;
    dialogCb = cb || null;
    setModalState(dialogEl, true);
  }
  function closeDialog(result){
    setModalState(dialogEl, false);
    var cb = dialogCb; dialogCb = null;
    if (cb) cb(!!result);
  }
  if (dialogEl) {
    $("dialogOk").onclick = function(){ closeDialog(true); };
    $("dialogCancel").onclick = function(){ closeDialog(false); };
  }

  document.addEventListener("keydown", function(e){
    // Audyt UX: nawigacja klawiatur\u0105 \u2014 strza\u0142ki lewo/prawo prze\u0142\u0105czaj\u0105 ekrany
    // (tylko gdy fokus nie jest w polu tekstowym i \u017caden arkusz nie jest otwarty;
    // strza\u0142ki w polach numerycznych zostaj\u0105 przy inkrementacji warto\u015bci)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      var ae = document.activeElement, tag = ae ? ae.tagName : "";
      var inField = tag === "INPUT" || tag === "TEXTAREA" || (ae && ae.isContentEditable);
      if (!inField && !document.querySelector(".overlay.open")) go(e.key === "ArrowRight" ? 1 : 0);
      return;
    }
    if (e.key === "Escape"){
      if (dialogEl && dialogEl.classList.contains("open")) closeDialog(false);
      else if (addOverlay.classList.contains("open")) requestCloseAdd();
      else if (settingsOverlay.classList.contains("open")) cancelSettings();
      else if (toolsOverlay.classList.contains("open")) setModalState(toolsOverlay, false);
      else if (pdfOverlayEl.classList.contains("open")) setModalState(pdfOverlayEl, false);
      else if (archiveOverlayEl && archiveOverlayEl.classList.contains("open")) setModalState(archiveOverlayEl, false);
    }
  });

  var toastEl = null, toastTimers = [];
  var UNDO_MS = 6000;
  // Wygl\u0105d toast\u00f3w: klasy .toast / .toast-undo / .toast-hide w style.css

  var toastQueue = [];

  function clearToast(){
    toastTimers.forEach(clearTimeout);
    toastTimers = [];
    toastQueue = [];   // jawnie zamkni\u0119te toasty kasuj\u0105 r\u00f3wnie\u017c kolejk\u0119
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }

  // Audyt: toasty ju\u017c si\u0119 nie nadpisuj\u0105. Pilne (np. uszkodzone dane) zast\u0119puj\u0105
  // bie\u017c\u0105cy toast natychmiast; zwyk\u0142e czekaj\u0105 w kolejce (max 3) i s\u0105 puszczane
  // w skr\u00f3conej wersji po zako\u0144czeniu bie\u017c\u0105cego.
  function showToast(el, msg, ms, urgent){
    if (urgent) {
      toastTimers.forEach(clearTimeout); toastTimers = [];
      toastQueue = [];
      if (toastEl) { toastEl.remove(); toastEl = null; }
    } else if (toastEl) {
      if (toastQueue.length < 3) toastQueue.push([el, msg, ms]);
      return;
    }
    displayToast(el, msg, ms || 2200, urgent);
  }
  function displayToast(el, msg, ms, urgent){
    toastEl = el;
    document.body.appendChild(el);
    var live = $("liveRegion");
    if (live) {
      live.setAttribute("aria-live", urgent ? "assertive" : "polite");
      live.textContent = "";
      setTimeout(function(){ live.textContent = msg; }, 50);
    }
    toastTimers.push(setTimeout(function(){ el.classList.add("toast-hide"); }, ms));
    toastTimers.push(setTimeout(function(){
      if (toastEl === el) { el.remove(); toastEl = null; playNextToast(); }
    }, ms + 500));
  }
  function playNextToast(){
    if (toastEl || !toastQueue.length) return;
    var q = toastQueue.shift();
    displayToast(q[0], q[1], Math.min(q[2] || 2200, 3500), false);
  }

  function toast(msg, ms, urgent){
    var el = document.createElement("div");
    el.textContent = msg;
    el.className = "toast";
    showToast(el, msg, ms || 2200, urgent);
  }

  function toastWithUndo(msg, onUndo){
    var el = document.createElement("div");
    var span = document.createElement("span");
    span.textContent = msg;
    el.appendChild(span);

    var undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.textContent = t("btnUndo");
    undoBtn.onclick = function(){ onUndo(); clearToast(); };
    el.appendChild(undoBtn);

    el.className = "toast toast-undo";
    // Audyt(1): pilny \u2014 toast z cofni\u0119ciem NIE mo\u017ce trafi\u0107 do kolejki, bo
    // pendingDeletes \u017cyj\u0105 kr\u00f3cej ni\u017c toast skr\u00f3cony przez kolejk\u0119 (utrata danych).
    showToast(el, msg + " " + t("btnUndo"), UNDO_MS, true);
  }

  applyTheme();
  applyLanguage();
  applyFontSize();
  go(0);
  render();
  if (StorageModule.hadIssue()) toast(t("storageCorrupt"), 9000, true);

  // Audyt(2): przycisk eksportu zachowanej kopii uszkodzonych danych w menu
  function refreshCorruptBtn(){
    var btn = $("btnCorrupt"); if (!btn) return;
    var data = StorageModule.corruptRaw();
    btn.style.display = data ? "flex" : "none";
    btn.onclick = function(){
      var d = StorageModule.corruptRaw(); if (!d) return;
      downloadFile("qardis-dane-uszkodzone-"+ymd(new Date())+".json", d);
      setModalState(toolsOverlay, false);
      toast("\u2713 " + t("corruptExported"));
    };
  }
  refreshCorruptBtn();
  // === Archiwum pomiar\u00f3w (wpisy starsze ni\u017c 9 mies.) ===
  var ARCHIVE_MS = 273 * 24 * 60 * 60 * 1000;
  var archiveOverlayEl = $("archiveOverlay");

  function updateArchiveSummary(){
    var el = $("archiveSummary");
    var archive = StorageModule.loadArchive();
    var peek = $("btnArchivePeek"), list = $("archiveList");
    if (!archive.length) {
      el.textContent = t("archiveEmpty");
      if (peek) peek.hidden = true;
      if (list) { list.hidden = true; list.textContent = ""; }
      return;
    }
    var mn = Infinity, mx = -Infinity;
    archive.forEach(function(e){ if (e.ts < mn) mn = e.ts; if (e.ts > mx) mx = e.ts; });
    el.textContent = t("archiveCount").replace("{n}", archive.length) + " (" + fmtDate(mn).date + " \u2013 " + fmtDate(mx).date + ")";
    // Audyt(7): podgl\u0105d zawarto\u015bci archiwum \u2014 zwijana lista wpis\u00f3w.
    if (peek) {
      peek.hidden = false;
      peek.textContent = list && !list.hidden && list.childNodes.length ? t("archiveHide") : t("archiveShow");
    }
  }
  function renderArchiveList(){
    var list = $("archiveList");
    var archive = StorageModule.loadArchive()
      .sort(function(a,b){ return b.ts - a.ts; })
      .slice(0, 50);   // limit czytelno\u015bci; pe\u0142ne dane w eksporcie
    list.textContent = "";
    archive.forEach(function(e){
      var f = fmtDate(e.ts);
      var row = document.createElement("div");
      row.className = "archive-row";
      var d = document.createElement("span");
      d.textContent = f.date + " " + f.time;
      var v = document.createElement("span");
      var parts = [];
      if (e.sys != null || e.dia != null) parts.push((e.sys != null ? e.sys : "--") + "/" + (e.dia != null ? e.dia : "--"));
      if (e.hr != null) parts.push(e.hr + " bpm");
      if (e.wgt != null) parts.push(e.wgt + " kg");
      v.textContent = parts.join(" \u00b7 ") || "\u2014";
      row.appendChild(d); row.appendChild(v);
      list.appendChild(row);
    });
    list.hidden = false;
  }
  function resetArchivePeek(){
    var list = $("archiveList");
    if (list) { list.hidden = true; list.textContent = ""; }
  }
  $("btnArchivePeek").onclick = function(){
    var list = $("archiveList");
    if (list.hidden) { renderArchiveList(); }
    else { list.hidden = true; list.textContent = ""; }
    updateArchiveSummary();
  };
  function archiveOldEntries(){
    var cutoff = Date.now() - ARCHIVE_MS;
    var toMove = entries.filter(function(e){ return e.ts < cutoff; });
    if (!toMove.length) { toast(t("nothingToArchiveMsg")); return; }
    var archive = StorageModule.loadArchive();
    var ids = Object.create(null);
    archive.forEach(function(e){ ids[e.id] = 1; });
    toMove.forEach(function(e){ if (!ids[e.id]) { archive.push(e); ids[e.id] = 1; } });
    // Audyt(2): najpierw trwa\u0142y zapis archiwum \u2014 przy pora\u017cce (limit pami\u0119ci)
    // przerywamy, zanim wpisy znikn\u0105 z listy. Ewentualne duplikaty przy wznowieniu
    // operacji s\u0105 odfiltrowywane po id, ale nic nie przepada.
    if (!StorageModule.saveArchive(archive)) { toast(t("storageError"), 5000, true); return; }
    entries = entries.filter(function(e){ return e.ts >= cutoff; });
    if (!StorageModule.saveEntries(entries)) toast(t("storageError"), 5000, true);
    resetArchivePeek();
    updateArchiveSummary();
    render();
    toast("\u2713 " + t("archivedMsg") + toMove.length + pluralEntries(toMove.length));
  }
  function restoreArchive(){
    var archive = StorageModule.loadArchive();
    if (!archive.length) { toast(t("archiveEmpty")); return; }
    var ids = Object.create(null);
    entries.forEach(function(e){ ids[e.id] = 1; });
    var added = 0;
    archive.forEach(function(e){ if (!ids[e.id]) { entries.push(e); ids[e.id] = 1; added++; } });
    // Audyt(3): nie czy\u015bci\u0107 archiwum, gdy zapis wpis\u00f3w si\u0119 nie powi\u00f3d\u0142 \u2014
    // duplikaty przy ponownej pr\u00f3bie s\u0105 odfiltrowywane po id.
    if (!StorageModule.saveEntries(entries)) { toast(t("storageError"), 5000, true); return; }
    if (!StorageModule.saveArchive([])) toast(t("storageError"), 5000, true);
    resetArchivePeek();
    updateArchiveSummary();
    render();
    toast("\u2713 " + t("archiveRestoredMsg") + added + pluralEntries(added));
  }
  function exportArchive(){
    var archive = StorageModule.loadArchive();
    if (!archive.length) { toast(t("archiveEmpty")); return; }
    var obj = { schemaVersion: 1, type: "qardis-archive", exportedAt: new Date().toISOString(), entries: archive };
    downloadFile("qardis-archiwum-"+ymd(new Date())+".json", JSON.stringify(obj, null, 2));
    toast("\u2713 " + t("archiveExportedMsg"));
  }
  if (archiveOverlayEl) {
    $("btnArchiveOpen").onclick = function(){
      updateArchiveSummary();
      setModalState(toolsOverlay, false);
      setModalState(archiveOverlayEl, true);
    };
    archiveOverlayEl.addEventListener("click", function(e){ if (e.target === archiveOverlayEl) setModalState(archiveOverlayEl, false); });
    $("btnArchiveClose").onclick = function(){ setModalState(archiveOverlayEl, false); };
    $("btnArchiveMove").onclick = archiveOldEntries;
    $("btnArchiveRestore").onclick = restoreArchive;
    $("btnArchiveExport").onclick = exportArchive;
  }

  // Audyt(3): przypominacz o kopii zapasowej (30 dni)
  (function backupReminder(){
    if (!entries.length) return;
    var MONTH = 30 * 24 * 60 * 60 * 1000;
    if (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > MONTH) {
      toast("\u23f0 " + t("backupReminder"), 9000);
    }
  })();

  // Synchronizacja mi\u0119dzy kartami/oknami PWA tego samego originu.
  window.addEventListener("storage", function(ev){
    if (ev.key === StorageModule.entriesKey()) {
      // Podczas edycji wpisu nie przerywamy formularza \u2013 od\u015bwie\u017camy tylko dane;
      // scaleniem zmian z innej karty przy naszym zapisie zajmie si\u0119 saveEntries.
      entries = StorageModule.loadEntries();
      if (editingId === null) render(); else drawTrends(true);
    } else if (ev.key === StorageModule.settingsKey()) {
      // Nie nadpisujemy ustawie\u0144, gdy u\u017cytkownik ma otwarty arkusz ustawie\u0144/edycji.
      var busy = $("settingsOverlay").classList.contains("open")
        || $("addOverlay").classList.contains("open");
      if (!busy) {
        settings = StorageModule.loadSettings();
        applyTheme(); applyLanguage(); applyFontSize(); render();
      }
    }
  });

  // Karta w tle (zw\u0142aszcza mobilna PWA) nie dostaje zdarze\u0144 \u201estorage\u201d: po powrocie sprawdzamy,
  // czy dane si\u0119 zmieni\u0142y, zanim u\u017cytkownik zapisze co\u015b na nieaktualnym stanie.
  function refreshIfStale(){
    if (document.visibilityState === "hidden") return;
    if ($("addOverlay").classList.contains("open") || !StorageModule.isStale()) return;
    entries = StorageModule.loadEntries();
    render();
  }
  document.addEventListener("visibilitychange", refreshIfStale);
  window.addEventListener("pageshow", function(ev){ if (ev.persisted) refreshIfStale(); });
  window.addEventListener("focus", refreshIfStale);

  // Audyt P1: obs\u0142uga ?action=add przeniesiona z inline <script> do app.js,
  // \u017ceby CSP mog\u0142o by\u0107 czystym script-src 'self' (koniec z utrzymywaniem hasha).
  if (new URLSearchParams(window.location.search).get("action") === "add") {
    try { history.replaceState(null, "", location.pathname); } catch(e){}
    setTimeout(function(){ var b = $("btnAdd"); if (b) b.click(); }, 80);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(e){ /* instalacja PWA niedost\u0119pna; aplikacja dzia\u0142a online */ });
    });
  }
})();