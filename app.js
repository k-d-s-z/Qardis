(function(){
  "use strict";

  function $(id){ return document.getElementById(id); }

  // Czysta logika (limity, sanityzacja, CSV, pluralizacja, interpolacja osi czasu,
  // walidacja i scalanie importu) lives in core.js — jedna implementacja
  // dla aplikacji i testów jednostkowych (tests.html).
  var LIMITS = QardisCore.LIMITS;
  var sanitizeEntry = QardisCore.sanitizeEntry;
  var lossy = QardisCore.lossy;

  // --- MODUŁ 1: Storage & State ---
  var StorageModule = (function(){
    var LS = "qardis.entries.v1", LS_SET = "qardis.settings.v1", LS_ARC = "qardis.archive.v1";
    var issue = false;
    var lastRaw = null;   // ostatni stan localStorage znany tej karcie (wykrywanie zapisów z innych kart)
    function stash(raw){
      issue = true;
      // Zachowujemy PIERWSZĄ kopię — kolejne wykrycia nie nadpisują oryginału
      // i nie dublują całego zbioru w limicie localStorage.
      try { if (!localStorage.getItem(LS + ".corrupt")) localStorage.setItem(LS + ".corrupt", raw); } catch(e){}
    }
    function buildDefaults(){
      var autoTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light";
      return {
        defWgt:75, theme:autoTheme, lang:"pl", fontSize:"medium",
        trackSys:true, trackDia:true, trackHr:true, trackWgt:true,
        incHr: false, incWgt: false,      // czy nowy wpis domyślnie zawiera tętno / wagę (pamiętane)
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
      // Co najmniej jeden monitorowany parametr — inaczej formularz i lista są puste.
      if (!out.trackSys && !out.trackDia && !out.trackHr && !out.trackWgt) {
        out.trackSys = out.trackDia = out.trackHr = out.trackWgt = true;
      }
      return out;
    }
    return {
      hadIssue: function(){ return issue; },
      corruptRaw: function(){
        try { return localStorage.getItem(LS + ".corrupt"); } catch(e){ return null; }
      },
      loadArchive: function(){
        // Archiwum: wpisy starsze niż 9 mies., przeniesione ręcznie z menu — osobny magazyn.
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
          // Scalanie zapisów między kartami: jeśli inna karta/PWA zapisała dane
          // od naszego ostatniego odczytu, dopnij jej wpisy (po id) przed zapisem,
          // żeby nie skasować ich nadpisaniem całej tablicy.
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
                  entries.push(c); byId[c.id] = c;   // mutujemy przekazaną tablicę (global `entries`)
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
        return sanitizeSettings(s);
      },
      sanitizeSettings: function(s){ return sanitizeSettings(s); },
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
      settingsKey: function(){ return LS_SET; },
      defaults: function(){ return buildDefaults(); }
    };
  })();

  // Walidacja importu: implementacja w core.js (QardisCore.validateImport).

  // --- MODUŁ 3: I18n ---
  var I18nModule = (function(){
    var translations = {
      pl: {
        trendsTitle: "Qardis – Trendy pomiarów", trendsDesc: "Średnie i zakresy wartości w wybranym okresie.", trendsNoData: "Brak pomiarów w wybranym okresie.",
        sumCount: "Pomiarów: {n}", sumBp: "Ciśnienie – średnia", sumHr: "Tętno – średnia", sumWgt: "Waga – średnia", minMax: "min–maks",
        normsNote: "Zalecenia dotyczące interpretacji ciśnienia skurczowego i rozkurczowego mogą się zmieniać. Najświeższe wytyczne znajdziesz na stronach Polskiego Towarzystwa Nadciśnienia Tętniczego i Polskiego Towarzystwa Kardiologicznego oraz analogicznych instytucji w innych krajach.",
        wipeDesc: "Usuwa wszystkie pomiary i ustawienia z tego urządzenia.",
        navHistory: "Pomiary", navTrends: "Trendy", 
        sysLabel: "Skurczowe", diaLabel: "Rozkurczowe", hrLabel: "Tętno", wgtLabel: "Waga",
        emptyTitle: "Brak pomiarów", emptyDesc: "Dodaj pierwszy pomiar ciśnienia, aby rozpocząć śledzenie wyników.", btnAddFirst: "+ Dodaj pierwszy pomiar",
        addTitleNew: "Nowy wpis", addTitleEdit: "Edytuj wpis", dtLabel: "Data i godzina pomiaru",
        notePlaceholder: "Dodatkowe informacje... (np. przeziębienie, złe samopoczucie)",
        btnCancel: "Anuluj", btnSave: "Zapisz", btnDelete: "Usuń", btnUndo: "Cofnij", btnProceed: "Kontynuuj",
        toolsTitle: "Dane i eksport", settingsTitle: "Ustawienia", monitoredTitle: "Monitorowane parametry", 
        
        langLabel: "Język", fontSizeLabel: "Wielkość czcionki", darkMode: "Tryb ciemny", darkModeDesc: "Jasny / ciemny motyw",
        titleBtnBackup: "Utwórz kopię zapasową", titleBtnImport: "Importuj dane z pliku", titleBtnPdf: "Raport: zapisz PDF lub drukuj",
        titleBtnCsv: "Eksportuj dane (CSV)", csvDone: "Pobrano plik CSV",
        discardTitle: "Niezapisane zmiany", discardConfirm: "Arkusz edycji zawiera niezapisane zmiany. Porzucić je?", btnDiscard: "Porzuć",
        titleBtnCorrupt: "Eksportuj dane uszkodzone (kopia zabezpieczona)", corruptExported: "Pobrano kopię danych uszkodzonych",
        backupReminder: "Minęło ponad 30 dni od ostatniej kopii zapasowej – rozważ jej utworzenie (menu „Dane i eksport”).",
        importedMsg: "Zaimportowano ", importError: "Nieprawidłowy plik kopii zapasowej.", importVersionError: "Nieznana wersja formatu kopii (schemaVersion). Utwórz nową kopię zapasową w aplikacji.",
        noEntriesPdf: "Brak wpisów do wydruku.", pdfError: "Nie udało się otworzyć okna wydruku.", pdfTitle: "Qardis – historia pomiarów", pdfGen: "Wygenerowano: ", pdfHint: "Użyj Ctrl+P / ⌘+P i wybierz „Zapisz jako PDF”.", pdfHeaderDt: "Data i godzina", pdfHeaderNotes: "Uwagi", pdfExportTitle: "Raport pomiarów", pdfRangeTitle: "Zakres danych", btnExport: "Eksportuj", btnSavePdf: "Zapisz jako PDF", btnPrint: "Drukuj", pdfSaved: "Raport PDF zapisany", pdfSaveError: "Nie udało się utworzyć pliku PDF.",
        savedMsg: "Pomiar zapisany", updatedMsg: "Pomiar zaktualizowany", futureDateWarn: "Data pomiaru przypada w przyszłości — upewnij się, że to zamierzone.", deletedMsg: "Wpis został usunięty", importConfirm: "Dane z kopii zostaną połączone z istniejącymi wpisami. Kontynuować?",
        r7:"7 dni", r30:"30 dni", r90:"3 mies.", rAll:"Wszystkie",
        
        bpErrorMsg: "Wartość skurczowa (SYS) musi być wyższa niż rozkurczowa (DIA).",
        numRequiredMsg: "Podaj wartości liczbowe w polach pomiaru.",
        rangeMsg: "Wartość poza zakresem: SYS 50–300, DIA 30–200, tętno 20–250.",
        dateRangeMsg: "Podaj poprawną datę (lata 2000–2099).",
        chartPanHint: "Przeciągnij wykres w bok, aby przeglądać kolejne pomiary (do 4 na ekran). Przełącznik zmienia oś na rzeczywisty upływ czasu.",
        axisCatSwitch: "Oś: równa", axisTimeSwitch: "Oś: czasowa",
        minParamWarn: "Co najmniej jeden parametr musi pozostać włączony.",
        privacyAlert: "Uwaga: Ten plik zawiera wrażliwe dane dotyczące zdrowia. Przechowuj go w bezpiecznym miejscu i nie udostępniaj osobom nieupoważnionym.",
        storageError: "Nie udało się zapisać danych (może tryb prywatny?).",
        backupDone: "Kopia zapasowa pobrana",
        settingsSaved: "Ustawienia zapisane",
        
        deletedMsgN: "Usunięto wpisów: {n}",
        importSkipped: " Pominięto: ",
        skipHr: "Pomiń tętno", skipWgt: "Pomiń wagę",
        storageCorrupt: "Wykryto uszkodzone dane. Kopię zachowano w pamięci przeglądarki, nie zostały nadpisane.",
        
        btnClose: "Zamknij", 
        ariaTools: "Dane i eksport", ariaAdd: "Dodaj pomiar", ariaSettings: "Ustawienia", ariaView: "Widok",
        
        addHr: "Dodaj tętno", addWgt: "Dodaj wagę",
        wgtDec: "Zmniejsz wagę o 0,1 kg", wgtInc: "Zwiększ wagę o 0,1 kg", wgtLabelKg: "Waga [kg]",
        wgtErrorMsg: "Podaj wagę w zakresie 20–300 kg (np. 75,5).",
        titleBtnWipe: "Usuń wszystkie dane",
        wipeConfirm: "Usunąć WSZYSTKIE pomiary, archiwum i ustawienia z tego urządzenia? Tej operacji nie można cofnąć. Jeśli chcesz zachować dane, najpierw utwórz kopię zapasową (zawiera również archiwum).",
        wipeDone: "Wszystkie dane zostały usunięte",
        privacyNote: "Dane są przechowywane wyłącznie na tym urządzeniu.",
        importSettingsConfirm: "Plik zawiera też ustawienia (język, monitorowane parametry). Zastąpić nimi bieżące ustawienia?",
        archiveTitle: "Archiwum pomiarów",
        archiveDesc: "Wpisy starsze niż 9 mies. można przenieść do archiwum — znikają z listy i Trendów, ale zostają na urządzeniu i można je przywrócić lub wyeksportować.",
        btnArchiveOpen: "Archiwum",
        archiveEmpty: "Brak zarchiwizowanych wpisów.",
        archiveCount: "W archiwum: {n}",
        btnArchiveMove: "Archiwizuj wpisy starsze niż 9 mies.",
        archiveShow: "Pokaż wpisy", archiveHide: "Ukryj wpisy",
        btnArchiveRestore: "Przywróć wszystkie",
        btnArchiveExport: "Eksportuj archiwum",
        archivedMsg: "Zarchiwizowano ",
        archiveRestoredMsg: "Przywrócono ",
        archiveExportedMsg: "Pobrano archiwum",
        nothingToArchiveMsg: "Brak wpisów starszych niż 9 mies.",
        archiveInBackup: "Kopia zawiera pomiary, archiwum i ustawienia — pełna migracja urządzenia w jednym pliku.",
        importSavedWarning: "Nie udało się zapisać danych (może limit pamięci lub tryb prywatny?). Zaimportowane wpisy są widoczne, ale znikną po odświeżeniu strony."
      },
      en: {
        trendsTitle: "Qardis – Measurement trends", trendsDesc: "Averages and value ranges for the selected period.", trendsNoData: "No measurements in the selected period.",
        sumCount: "Measurements: {n}", sumBp: "Blood pressure – average", sumHr: "Pulse – average", sumWgt: "Weight – average", minMax: "min–max",
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
        backupReminder: "More than 30 days since your last backup – consider creating one (Data & Export menu).",
        importedMsg: "Imported ", importError: "Invalid backup file.", importVersionError: "Unknown backup format version (schemaVersion). Create a new backup in the app.",
        noEntriesPdf: "No entries to print.", pdfError: "Failed to open print window.", pdfTitle: "Qardis – measurement history", pdfGen: "Generated: ", pdfHint: "Use Ctrl+P / ⌘+P and select 'Save as PDF'.", pdfHeaderDt: "Date & Time", pdfHeaderNotes: "Notes", pdfExportTitle: "Measurement report", pdfRangeTitle: "Data range", btnExport: "Export", btnSavePdf: "Save as PDF", btnPrint: "Print", pdfSaved: "PDF report saved", pdfSaveError: "Failed to create the PDF file.",
        savedMsg: "Measurement saved", updatedMsg: "Measurement updated", futureDateWarn: "The measurement date is in the future — make sure this is intentional.", deletedMsg: "Entry deleted", importConfirm: "Backup data will be merged with existing entries. Proceed?",
        r7:"7 days", r30:"30 days", r90:"3 mos.", rAll:"All",
        
        bpErrorMsg: "Systolic pressure (SYS) must be higher than diastolic (DIA).",
        numRequiredMsg: "Enter numeric values in the measurement fields.",
        rangeMsg: "Value out of range: SYS 50–300, DIA 30–200, pulse 20–250.",
        dateRangeMsg: "Enter a valid date (years 2000–2099).",
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
        archiveDesc: "Entries older than 9 months can be moved to the archive — they disappear from the list and Trends, but stay on this device and can be restored or exported at any time.",
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
        archiveInBackup: "The backup contains measurements, archive and settings — a full device migration in one file.",
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

  // --- Renderer tabeli trendów ---
  // Filtr zakresu wykonuje JEDEN raz wywołujący (drawTrends) — tabela dostaje
  // już przefiltrowaną, posortowaną (chronologicznie) listę.
  function renderTrendsTable(tableMount, filtered, tCb, fmtDateCb){
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

        // Szerokości kolumn: table-layout: fixed + .data-table th:first-child w style.css

        var thead = document.createElement("thead");
        var htr = document.createElement("tr");
        function addTh(text, unit){
          var th = document.createElement("th");
          th.title = unit ? text + " (" + unit + ")" : text;     // pełny tekst po najechaniu / przytrzymaniu
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

  // --- MODUŁ 5: Main App Logic & UI Coordinator ---
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

  // Formatery dat są buforowane per locale — Intl.DateTimeFormat tworzenie
  // przy każdym wierszu listy/tabeli/CSV/PDF było głównym kosztem na słabszych
  // telefonach. Wspólne helpery dat w jednym miejscu.
  function pad2(n){ return (n<10?"0":"")+n; }
  var dateFmts = {};
  function dateFmt(){
    var locale = settings.lang === "en" ? "en-US" : "pl-PL";
    if (!Object.prototype.hasOwnProperty.call(dateFmts, locale)) {
      try {
        dateFmts[locale] = {
          d: new Intl.DateTimeFormat(locale, { year:"numeric", month:"2-digit", day:"2-digit" }),
          t: new Intl.DateTimeFormat(locale, { hour:"2-digit", minute:"2-digit", hour12:false }),
          s: new Intl.DateTimeFormat(locale, { month:"short", day:"numeric" })
        };
      } catch(e){ dateFmts[locale] = null; }
    }
    return dateFmts[locale];
  }
  function fmtDate(ts){
    var d = new Date(ts);
    var f = dateFmt();
    if (f) return { date: f.d.format(d), time: f.t.format(d) };
    return { date: pad2(d.getDate())+"."+pad2(d.getMonth()+1)+"."+d.getFullYear(), time: pad2(d.getHours())+":"+pad2(d.getMinutes()) };
  }
  function shortDateStr(ts){
    var d = new Date(ts);
    var f = dateFmt();
    if (f) return f.s.format(d);
    return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
  }
  function toLocalInput(ts){
    var d = new Date(ts);
    return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())+"T"+pad2(d.getHours())+":"+pad2(d.getMinutes());
  }
  function ymd(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }

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
    // Są dwa metatagi theme-color (z media prefers-color-scheme, dla pierwszego renderu
    // przed startem skryptu). Ręczny wybór motywu może różnić się od systemowego,
    // więc ustawiamy ten sam kolor w obu — wtedy wygrywa wybór użytkownika.
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

    var arr = sortedAsc();
    var frag = document.createDocumentFragment();

    arr.forEach(function(e){
      var card = document.createElement("div");
      card.className = "entry-card";
      card.setAttribute("role", "group");
      var f = fmtDate(e.ts);

      var bpText = escapeHtml(bpString(e));

      var html = '<div class="card-top">'
        + '<div class="card-main">'
        +   '<span class="card-sysdia">' + bpText + '</span>'
        +   '<span class="card-unit">mmHg</span>'
        + '</div>'
        + '<div class="card-date">' + escapeHtml(f.date) + '<small>' + escapeHtml(f.time) + '</small></div>'
        + '</div>';

      var subItems = [];
      if (settings.trackHr && e.hr) subItems.push('<span><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' + escapeHtml(String(e.hr)) + ' bpm</span>');
      if (settings.trackWgt && e.wgt) subItems.push('<span><svg viewBox="0 0 24 24"><path d="M5 19h14l-1.6-8.2a2 2 0 0 0-2-1.6H8.6a2 2 0 0 0-2 1.6z"/><path d="M12 9V7"/><circle cx="12" cy="6" r="1.6"/></svg>' + escapeHtml(String(e.wgt)) + ' kg</span>');

      if (subItems.length) {
        html += '<div class="card-sub">' + subItems.join('') + '</div>';
      }
      if (e.note) {
        html += '<div class="card-note">✎ ' + escapeHtml(e.note) + '</div>';
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
    addSnapshot = null;   // usunięto wpis — zamykamy arkusz bez dirty-check
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

  // --- Ekran Trendy: podsumowanie liczbowe + pionowe słupki zakresowe + tabela ---
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
  function rangeTxt(st, f){ var a = f(st.min), b = f(st.max); return a === b ? a : a + "–" + b; }
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
    function cardFor(st, labelKey, unit, f){
      if (!st) return;
      card("", t(labelKey), f(st.avg), unit, rangeTxt(st, f));
    }
    if (s || d) {
      var avg = [s ? rnd(s.avg) : "--", d ? rnd(d.avg) : "--"].join(" / ");
      var rng = [s ? "SYS " + rangeTxt(s, rnd) : "", d ? "DIA " + rangeTxt(d, rnd) : ""]
        .filter(Boolean).join(" · ");
      card("wide", t("sumBp"), avg, "mmHg", rng);
    }
    cardFor(h, "sumHr", "bpm", rnd);
    cardFor(w, "sumWgt", "kg", fmt1);
    mount.appendChild(grid);
  }

  var VISIBLE_MAX = 4;
  var chartMode = "cat";     // "cat" = oś równa, "time" = oś rzeczywistego czasu
  var chartStart = Infinity; // indeks pierwszego widocznego pomiaru (float); Infinity = koniec osi (najnowsze), clamp w drawChart
  function resetChart(){ chartStart = Infinity; }
  function gapLabel(days){
    if (days < 1) return settings.lang === "en" ? "same day" : "ten sam dzień";
    if (days === 1) return settings.lang === "en" ? "1 day" : "1 dzień";
    return days + (settings.lang === "en" ? " days" : " dni");
  }
  function drawChart(list, mount){
    var showSys = settings.trackSys, showDia = settings.trackDia, showHr = settings.trackHr;
    var pts = (showSys || showDia || showHr) ? list.filter(function(e){
      return (showSys && e.sys != null) || (showDia && e.dia != null) || (showHr && e.hr != null);
    }).sort(function(a,b){ return a.ts - b.ts; }) : [];
    if (pts.length < 2) { mount.textContent = ""; chartCtx = null; return; }   // wykres od 2 pomiarów

    var n = pts.length;
    var visN = Math.min(VISIBLE_MAX, n);
    // chartStart pozostaje UŁAMKOWY (bez Math.round) — to daje płynne
    // przesuwanie: punkty przesuwają się piksel po pikselu, nie skokami.
    chartStart = clamp(chartStart, 0, n - visN);

    // Skale Y liczone po WSZYSTKICH punktach okna z zapasem (nie tylko
    // widocznych) — przesuwanie nie zmienia skali w trakcie panu.
    // Tętno ma własną skalę (prawa oś, bpm), bo zakres tętna nie pokrywa się
    // z zakresem ciśnienia (mmHg) — jedna wspólna skala spłaszczyłaby jedną z serii.
    var winA = Math.floor(chartStart), winB = Math.min(n - 1, Math.ceil(chartStart + visN - 1) + 1);
    var bpLo = Infinity, bpHi = -Infinity, hrLo = Infinity, hrHi = -Infinity;
    for (var q = winA; q <= winB; q++) {
      var pe = pts[q];
      if (showSys && pe.sys != null) { bpLo = Math.min(bpLo, pe.sys); bpHi = Math.max(bpHi, pe.sys); }
      if (showDia && pe.dia != null) { bpLo = Math.min(bpLo, pe.dia); bpHi = Math.max(bpHi, pe.dia); }
      if (showHr && pe.hr != null) { hrLo = Math.min(hrLo, pe.hr); hrHi = Math.max(hrHi, pe.hr); }
    }
    var bpOk = isFinite(bpLo), hrOk = isFinite(hrLo);
    function padScale(lo, hi){
      var p = Math.max(Math.round((hi - lo) * 0.15), 5);
      lo -= p; hi += p;
      if (hi - lo < 10) { lo -= 5; hi += 5; }
      return [lo, hi];
    }
    var L, R = null;   // L = skala lewej osi, R = skala prawej osi (tylko tętno)
    if (bpOk) {
      L = padScale(bpLo, bpHi);
      if (hrOk) R = padScale(hrLo, hrHi);
    } else {
      L = padScale(hrLo, hrHi);   // samo tętno — jedna skala
    }
    var hasRight = !!R;

    var W = Math.max(mount.clientWidth || 320, 240), H = 250;
    var padL = 40, padR = hasRight ? 44 : 12, padT = 26, padB = 34;
    var iw = W - padL - padR, ih = H - padT - padB;

    // Mapowanie ułamkowego indeksu -> X:
    //  • tryb "cat":  pozycja liniowa względem chartStart (równe odstępy)
    //  • tryb "time": interpolacja znacznika czasu między indeksami
    var tsArr = pts.map(function(p){ return p.ts; });
    function tsAt(f){ return QardisCore.lerpTs(tsArr, f); }
    var tA = tsAt(chartStart), tB = tsAt(chartStart + visN - 1);
    var timeOk = (chartMode === "time") && (tB - tA) > 0;
    function X(f){
      if (timeOk) return padL + ((tsAt(f) - tA) / (tB - tA)) * iw;
      return padL + ((f - chartStart) / (visN - 1)) * iw;
    }
    function YL(v){ return padT + (1 - (v - L[0]) / (L[1] - L[0])) * ih; }
    function YR(v){ return padT + (1 - (v - R[0]) / (R[1] - R[0])) * ih; }
    function n1(x){ return Math.round(x * 10) / 10; }

    var svg = "";
    for (var i = 0; i <= 4; i++) {
      var v = L[0] + (L[1] - L[0]) * i / 4, y = n1(YL(v));
      svg += '<line x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'" class="grid"/>'
           + '<text x="'+(padL-6)+'" y="'+n1(y+3.5)+'" text-anchor="end" class="axis">'+Math.round(v)+'</text>';
      if (hasRight) {
        var hv = R[0] + (R[1] - R[0]) * i / 4;
        svg += '<text x="'+(W-padR+6)+'" y="'+n1(y+3.5)+'" text-anchor="start" class="axis axis-hr">'+Math.round(hv)+'</text>';
      }
    }

    // Zakres rysowanych indeksów z zapasem, żeby punkty wjeżdżały/wyjeżdżały
    // płynnie przy krawędziach okna.
    var iFrom = Math.max(0, Math.floor(chartStart));
    var iTo = Math.min(n - 1, Math.ceil(chartStart + visN - 1));

    // Daty pod punktami + liczba dni między punktami (w połowie odstępu)
    for (var k = iFrom; k <= iTo; k++) {
      var xk = X(k);
      if (xk < padL - 4 || xk > W - padR + 4) continue;
      svg += '<text x="'+n1(xk)+'" y="'+(H-8)+'" text-anchor="middle" class="axis axis-date">'+escapeHtml(shortDateStr(pts[k].ts))+'</text>';
      if (k > 0) {
        var xm = (xk + X(k-1)) / 2;
        if (xm >= padL - 4 && xm <= W - padR + 4 && (xk - X(k-1)) >= 40) {
          var days = Math.max(0, Math.round((pts[k].ts - pts[k-1].ts) / DAY_MS));
          svg += '<text x="'+n1(xm)+'" y="'+(H-20)+'" text-anchor="middle" class="axis axis-gap">'+escapeHtml(gapLabel(days))+'</text>';
        }
      }
    }
    function series(key, cls, ymap){
      var out = "", prev = null;
      for (var m = iFrom; m <= iTo; m++) {
        var e = pts[m];
        if (e[key] == null) { prev = null; continue; }
        var x = n1(X(m)), y = n1(ymap(e[key]));
        if (prev !== null) out += '<line x1="'+prev[0]+'" y1="'+prev[1]+'" x2="'+x+'" y2="'+y+'" class="ln-'+cls+'"/>';
        out += '<circle cx="'+x+'" cy="'+y+'" r="4.5" class="dot-'+cls+'"/>';
        prev = [x, y];
      }
      return out;
    }
    var legend = "";
    var lx = padL;
    if (showSys) { legend += '<text x="'+lx+'" y="14" class="lg-sys">● SYS</text>'; lx += 58; }
    if (showDia) { legend += '<text x="'+lx+'" y="14" class="lg-dia">● DIA</text>'; lx += 58; }
    if (showHr && hrOk) { legend += '<text x="'+lx+'" y="14" class="lg-hr">● HR</text>'; }
    var content = svg + series("sys", "sys", YL) + series("dia", "dia", YL) +
                  (showHr ? series("hr", "hr", hasRight ? YR : YL) : "") + legend;

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
        // Delta myszy jest w pikselach CSS — przeliczamy przez slotPx
        // (jednostki SVG * stosunek ekranu do viewBoxu). Szerokość slotu = 1 pomiar.
        chartStart = clamp(drag.start + (drag.x - ev.clientX) / chartCtx.slotPx, 0, chartCtx.n - chartCtx.visN);
        drawChart(chartCtx.list, mount);
      });
      function endDrag(){ drag = null; }
      svgEl.addEventListener("pointerup", endDrag);
      svgEl.addEventListener("pointercancel", endDrag);
    }
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
      // Etykieta pokazuje tryb, na który przełączy NASTĘPNE kliknięcie
      // (przycisk to "akcja", nie wskaźnik stanu).
      btn.textContent = (chartMode === "cat") ? t("axisTimeSwitch") : t("axisCatSwitch");
      btn.title = (chartMode === "cat") ? t("axisTimeSwitch") : t("axisCatSwitch");
      btn.setAttribute("aria-pressed", chartMode === "time" ? "true" : "false");
    }
    var rectW = (svgEl.getBoundingClientRect && svgEl.getBoundingClientRect().width) || W;
    chartCtx = { n: n, visN: visN, slotPx: (rectW / W) * (iw / visN), list: list };
    svgEl.setAttribute("viewBox", "0 0 "+W+" "+H);
    svgEl.innerHTML = content;
  }
  var chartCtx = null;   // {n, visN, slotPx, list} — żywy kontekst dla panu/toggle

  var chartResizeT = null;
  window.addEventListener("resize", function(){
    if (!chartCtx || screenIdx !== 1) return;
    if (chartResizeT) clearTimeout(chartResizeT);
    chartResizeT = setTimeout(function(){ chartResizeT = null; drawChart(chartCtx.list, $("trendsChart")); }, 150);
  });

  function drawTrends(force){
    // Rysuj tylko gdy ekran Trendy jest aktywny, chyba że wymuszono (zmiana ustawień)
    if (!force && screenIdx !== 1) return;
    var tableMount = $("trendsTableMount");
    var empty = $("trendsEmpty");
    var sumMount = $("trendsSummary");

    sumMount.textContent = "";
    $("trendsChart").textContent = "";
    chartCtx = null;   // brak kontekstu = resize/pan nie rysują starych danych
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
    // Jedno filtrowanie i jedno sortowanie (chronologicznie) dla podsumowania i tabeli.
    var filtered = entries.filter(function(e){ return e.ts >= cutoff; })
      .sort(function(a, b){ return a.ts - b.ts; });

    if (!filtered.length) {
      empty.textContent = t("trendsNoData");
      empty.hidden = false;
      return;
    }

    renderSummary(filtered, sumMount);
    drawChart(filtered, $("trendsChart"));
    tableMount.hidden = false;
    renderTrendsTable(tableMount, filtered, settings, t, fmtDate);
  }

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
    resetChart();
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
      axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";   // oś ustalana raz, na początku gestu
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
    if (axis === "x") {
      if (dx < -60 && screenIdx === 0) go(1);
      else if (dx > 60 && screenIdx === 1) go(0);
      else go(screenIdx);   // dosunięcie z powrotem
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
  var addSnapshot = null;
  function makeNumField(id, lo, hi){
    var inp = $(id);
    inp.min = lo; inp.max = hi;
    return {
      set: function(v){ inp.value = (v != null && isFinite(v)) ? v : ""; },
      get: function(){
        var raw = String(inp.value).replace(",", ".").trim();
        if (raw === "") return null;
        var v = parseFloat(raw);
        return isFinite(v) ? v : NaN;   // bez przycinania: zakres sprawdza btnSave i pokazuje błąd
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
  // Jedno miejsce porządkowania danych: prezentacja jest CHRONOLOGICZNA
  // (od najstarszego), rosnąco po dacie; "najnowsze" widać na końcu, a min/maks
  // w Trendach. Malejąco sortujemy tylko tam, gdzie szukamy ostatniej wartości.
  function sortedAsc(){ return entries.slice().sort(function(a,b){ return a.ts - b.ts; }); }
  function sortedDesc(){ return entries.slice().sort(function(a,b){ return b.ts - a.ts; }); }
  function bpString(e){
    return (settings.trackSys && e.sys != null ? e.sys : "--") + " / " +
           (settings.trackDia && e.dia != null ? e.dia : "--");
  }

  // ostatnia znana wartość (nie tylko z najnowszego wpisu, który mógł jej nie mieć)
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

  function syncOptionalFields(){
    [["boxWHr","wHr","btnClearWHr",hrActive,"Hr"],["boxWWgt","wWgt","btnClearWWgt",wgtActive,"Wgt"]].forEach(function(a){
      $(a[0]).classList.toggle("disabled", !a[3]);
      $(a[1]).disabled = !a[3];
      if (a[1] === "wWgt") document.querySelectorAll("#boxWWgt .num-btns button").forEach(function(b){ b.disabled = !a[3]; });
      var b = $(a[2]);
      var lbl = t((a[3] ? "skip" : "add") + a[4]);
      b.setAttribute("aria-label", lbl); b.title = lbl;
      b.textContent = a[3] ? "✕" : "+";
    });
    $("btnWgtDec").setAttribute("aria-label", t("wgtDec"));
    $("btnWgtInc").setAttribute("aria-label", t("wgtInc"));
  }
  $("btnClearWHr").onclick = function(){
    hrActive = !hrActive;
    if (!editingId) { settings.incHr = hrActive; StorageModule.saveSettings(settings); }
    syncOptionalFields();
    // Włączenie tętna ustawia fokus na pustym polu (bez podstawiania starej wartości).
    if (hrActive) { try { $("wHr").focus(); } catch(e){} }
  };
  $("btnClearWWgt").onclick = function(){
    wgtActive = !wgtActive;
    if (!editingId) { settings.incWgt = wgtActive; StorageModule.saveSettings(settings); }
    syncOptionalFields();
    if (wgtActive) { try { wgtInput.focus(); } catch(e){} }
  };

  var persistTried = false;
  function requestPersist(){
    if (persistTried || settings.persistAsked) return;
    persistTried = true;
    if (!(navigator.storage && navigator.storage.persist && navigator.storage.persisted)) return;
    navigator.storage.persisted().then(function(p){ return p ? true : navigator.storage.persist(); })
      .then(function(granted){
        // Flaga "pytano" tylko, gdy trwałość faktycznie przyznano; w przeciwnym
        // razie (np. iOS Safari w przeglądarce) spróbujemy ponownie w kolejnej sesji.
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

    // Pola nowego wpisu są PUSTE (bez placeholderów z przykładowymi wartościami —
    // jasna cyfra mogła wyglądać jak wypełnione pole) — poprzedni pomiar
    // nie może przypadkiem zostać zapisany jako nowy odczyt.

    wgtActive = entry ? (entry.wgt != null) : !!settings.incWgt;
    $("boxWWgt").classList.toggle("disabled", !wgtActive);
    syncOptionalFields();
    weightField.set(entry ? entry.wgt : null);

    setModalState(addOverlay, true);
    if (settings.trackSys) sysField.set(entry ? entry.sys : null);
    if (settings.trackDia) diaField.set(entry ? entry.dia : null);
    if (settings.trackHr) hrField.set(entry ? entry.hr : null);
    addSnapshot = JSON.stringify(collectAddState());
    // Autofokus na pierwsze WIDOCZNE, aktywne pole pomiaru (po fokusie arkusza
    // z setModalState) — bez automatycznego skoku między polami: SYS bywa
    // dwucyfrowe (50–99), więc auto-przejście po 3 cyfrach pomijałoby wartości.
    setTimeout(function(){
      var focusId = null;
      if (settings.trackSys) focusId = "wSys";
      else if (settings.trackDia) focusId = "wDia";
      else if (settings.trackHr && hrActive) focusId = "wHr";
      else if (settings.trackWgt && wgtActive) focusId = "wWgt";
      if (focusId) { try { $(focusId).focus({preventScroll:true}); } catch(e){} }
    }, 60);
  }

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
      else addSnapshot = JSON.stringify(collectAddState());   // przywróć snapshot — arkusz zostaje otwarty
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
    // Wpis edytowany, który kiedyś powstał przy wyłączonym parametrze, może mieć w nim pustkę.
    var origEntry = editingId ? entries.find(function(x){ return x.id === editingId; }) : null;
    function missing(v, key){ return badNum(v) && !(origEntry && origEntry[key] == null && v === null); }
    function outOfRange(v, lim){ return v !== null && !isNaN(v) && (v < lim[0] || v > lim[1]); }
    function showFormError(key, focusEl){
      errEl.textContent = t(key);
      errEl.hidden = false;
      try { errEl.scrollIntoView({block:"nearest", behavior:"smooth"}); } catch(e){}
      if (focusEl) { try { focusEl.focus(); } catch(e){} }
    }
    // Pusty obowiązkowy parametr = błąd (pole zawsze zaczyna puste).
    if ((settings.trackSys && missing(sysVal, "sys")) || (settings.trackDia && missing(diaVal, "dia")) ||
        (settings.trackHr && hrActive && missing(hrVal, "hr"))) {
      showFormError("numRequiredMsg"); return;
    }
    if ((settings.trackSys && outOfRange(sysVal, LIMITS.sys)) || (settings.trackDia && outOfRange(diaVal, LIMITS.dia)) ||
        (settings.trackHr && hrActive && outOfRange(hrVal, LIMITS.hr))) {
      showFormError("rangeMsg"); return;
    }
    if (settings.trackSys && settings.trackDia && sysVal !== null && diaVal !== null && sysVal <= diaVal) {
      showFormError("bpErrorMsg"); return;
    }
    if (wgtVal !== null && (isNaN(wgtVal) || wgtVal < WGT_MIN || wgtVal > WGT_MAX)) {
      showFormError("wgtErrorMsg", wgtInput); return;
    }
    errEl.hidden = true;

    var note = $("noteField").value.trim();
    var dtVal = $("dtField").value;
    var ts = dtVal ? new Date(dtVal).getTime() : Date.now();
    // Data poza zakresem akceptowanym przy ładowaniu = wpis zniknąłby po odświeżeniu.
    if (!QardisCore.validFormTs(ts)) {
      showFormError("dateRangeMsg", $("dtField")); return;
    }
    var okMsg = "✓ " + t(editingId ? "updatedMsg" : "savedMsg");
    var okMs = 2200;
    if (ts > Date.now() + 60000) { okMsg += ". ⚠ " + t("futureDateWarn"); okMs = 4500; }
    
    var e = editingId ? entries.find(function(x){ return x.id===editingId; }) : null;
    if (e) {
      var updated = { note: note, ts: ts };
      if (settings.trackSys) updated.sys = sysVal;
      if (settings.trackDia) updated.dia = diaVal;
      if (settings.trackHr) updated.hr = hrVal;
      if (settings.trackWgt) updated.wgt = wgtVal;
      Object.assign(e, updated);
    } else {
      // Nowy wpis — także gdy edytowany wpis zniknął w międzyczasie (usunięty w innej karcie):
      // dane użytkownika nie przepadają po cichu.
      entries.push({id: makeId(), ts:ts, note:note, sys:sysVal, dia:diaVal, hr:hrVal, wgt:wgtVal});
    }
    // Najpierw zapis, potem komunikat — „zapisano” tylko, gdy zapis się udał.
    if (StorageModule.saveEntries(entries)) toast(okMsg, okMs);
    else toast(t("storageError"), 6000, true);
    addSnapshot = null;   // zapisano — zamykamy bez dirty-check
    setModalState(addOverlay, false);
    render();
    requestPersist();
  };

  $("btnBackup").onclick = function(){
    openDialog({ title: t("titleBtnBackup"), text: t("privacyAlert") + "\n\n" + t("archiveInBackup"), ok: t("btnExport") }, function(proceed){
    if (!proceed) return;
    var exp = {};
    // Klucze wyprowadzone z wartości domyślnych (bez flag technicznych
    // persistAsked/lastBackupAt i defWgt) — jedno źródło prawdy o kształcie ustawień.
    Object.keys(StorageModule.defaults()).forEach(function(k){
      if (k !== "persistAsked" && k !== "lastBackupAt" && k !== "defWgt") exp[k] = settings[k];
    });
    var backupObj = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      app: "Qardis",
      settings: exp,
      entries: entries,
      archive: StorageModule.loadArchive()
    };
    downloadFile("qardis-kopia-"+ymd(new Date())+".json", JSON.stringify(backupObj, null, 2));
    settings.lastBackupAt = Date.now();
    StorageModule.saveSettings(settings);
    setModalState(toolsOverlay, false);
    toast("✓ " + t("backupDone"));
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
    toast("✓ " + t("wipeDone"));
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
        if (!QardisCore.validateImport(j)) throw new Error("invalid schema or ranges");
        // Wersja formatu: odrzucamy tylko NOWSZE niż znane (v > 3), bo
        // starsze potrafimy poprawnie wczytać: kopia v3/v2 (v3 = z archiwum),
        // starsze obiekty bez pola, plik archiwum (type: "qardis-archive", v1)
        // i surowa tablica.
        var v = (j && !Array.isArray(j)) ? j.schemaVersion : undefined;
        if (v !== undefined && !(v >= 1 && v <= 3)) throw new Error("unsupported schemaVersion");
        var list = j.entries || j;
        // Deduplikacja i sanityzacja importu w core.js (mergeImported) —
        // testowana jednostkowo w tests.js.
        var res = QardisCore.mergeImported(list, entries, sanitizeEntry, makeId);
        res.added.forEach(function(e){ entries.push(e); });
        var added = res.added.length, skipped = res.skipped;
        var saved = StorageModule.saveEntries(entries);
        if (!saved) toast(t("importSavedWarning"), 9000, true);   // dane tylko w RAM do przeładowania
        // Kopia v3 zawiera archiwum — scal po id z lokalnym archiwum.
        if (j && !Array.isArray(j) && Array.isArray(j.archive)) {
          var arc = StorageModule.loadArchive();
          var arcIds = Object.create(null);
          arc.forEach(function(e){ arcIds[e.id] = 1; });
          var knownIds = Object.create(null);
          entries.forEach(function(e){ knownIds[e.id] = 1; });
          var arcAdded = 0;
          j.archive.forEach(function(e){
            var c = sanitizeEntry(e);
            if (!c || !c.ts || lossy(e, c)) return;
            if (!c.id) c.id = makeId();
            if (arcIds[c.id] || knownIds[c.id]) return;   // już w archiwum albo na liście głównej
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
          settings.lastBackupAt = keepBackupAt;
          if (!StorageModule.saveSettings(settings)) toast(t("storageError"));
            applyTheme(); applyLanguage(); applyFontSize(); render();
          });
        }
        toast("✓ " + t("importedMsg")+added+pluralEntries(added)+(skipped ? t("importSkipped")+skipped : ""));
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
  $("btnCsv").onclick = function(){
    if (!entries.length) { toast(t("noEntriesPdf")); return; }
    var head = ["date","time","sys_mmhg","dia_mmhg","hr_bpm","weight_kg","note"].join(";");
    var rows = sortedAsc().map(function(e){
      var f = fmtDate(e.ts);
      var comma = settings.lang !== "en";
      return [f.date, f.time, e.sys, e.dia, e.hr, e.wgt, e.note].map(function(v){ return QardisCore.csvEscape(v, comma); }).join(";");
    });
    // BOM UTF-8 (poprawne polskie znaki w Excelu) + \r\n (konwencja CSV dla Windows)
    downloadFile("qardis-dane-"+ymd(new Date())+".csv",
      "\uFEFF" + head + "\r\n" + rows.join("\r\n"), "text/csv");
    setModalState(toolsOverlay, false);
    toast("✓ " + t("csvDone"));
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
    return sortedAsc().filter(function(e){
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
  // (QardisCore.buildPdf). Dzięki temu nie trzeba osadzać fontów (polskie znaki
  // działają od razu), a CSP nie blokuje niczego. Tekst w pliku nie jest zaznaczalny —
  // do tego służy opcja „Drukuj”. Kodowanie przez canvas.toBlob (nie blokuje wątku
  // UI jak toDataURL+atob), z oddaniem sterowania między stronami.
  // Pierwsza strona raportu to WYKRES (przebieg dla lekarza), dalej tabela wyników.
  var PDF_PW = 842, PDF_PH = 595, PDF_S = 2;
  function canvasToJpegBytes(cv){
    return new Promise(function(res, rej){
      cv.toBlob(function(b){ b ? res(b.arrayBuffer()) : rej(new Error("canvas export failed")); }, "image/jpeg", 0.82);
    }).then(function(buf){ return new Uint8Array(buf); });
  }
  // Rysuje wykres z całego zakresu raportu: SYS/DIA na lewej osi (mmHg),
  // tętno na prawej osi (bpm) — skala tętna nie pokrywa się z ciśnieniem.
  // Zwraca false, gdy danych jest za mało na wykres.
  function drawPdfChartPage(ctx, arr, PW, PH, M){
    var FONT = "Arial, Helvetica, sans-serif";
    var showSys = settings.trackSys, showDia = settings.trackDia, showHr = settings.trackHr;
    var pts = arr.filter(function(e){
      return (showSys && e.sys != null) || (showDia && e.dia != null) || (showHr && e.hr != null);
    }).sort(function(a,b){ return a.ts - b.ts; });
    if (pts.length < 2) return false;
    var bpLo = Infinity, bpHi = -Infinity, hrLo = Infinity, hrHi = -Infinity;
    pts.forEach(function(p){
      if (showSys && p.sys != null) { bpLo = Math.min(bpLo, p.sys); bpHi = Math.max(bpHi, p.sys); }
      if (showDia && p.dia != null) { bpLo = Math.min(bpLo, p.dia); bpHi = Math.max(bpHi, p.dia); }
      if (showHr && p.hr != null) { hrLo = Math.min(hrLo, p.hr); hrHi = Math.max(hrHi, p.hr); }
    });
    var bpOk = isFinite(bpLo), hrOk = isFinite(hrLo);
    if (!bpOk && !hrOk) return false;
    function pad(lo, hi){
      var p = Math.max(Math.round((hi - lo) * 0.12), 4);
      lo -= p; hi += p;
      if (hi - lo < 10) { lo -= 5; hi += 5; }
      return [lo, hi];
    }
    var L = bpOk ? pad(bpLo, bpHi) : pad(hrLo, hrHi);          // lewa oś
    var R = (bpOk && hrOk) ? pad(hrLo, hrHi) : null;           // prawa oś (tylko tętno)
    var T = M + 60, B = PH - M - 30;
    var Lx = M + 44, Rx = PW - M - (R ? 44 : 10);
    var iw = Rx - Lx, ih = B - T;
    if (iw < 100 || ih < 60) return false;
    function YL(v){ return T + (1 - (v - L[0]) / (L[1] - L[0])) * ih; }
    function YR(v){ return T + (1 - (v - R[0]) / (R[1] - R[0])) * ih; }
    function X(i){ return Lx + (i / (pts.length - 1)) * iw; }

    ctx.textBaseline = "alphabetic";
    for (var i = 0; i <= 4; i++) {
      var v = L[0] + (L[1] - L[0]) * i / 4, y = YL(v);
      ctx.strokeStyle = "#ddd"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(Lx, y); ctx.lineTo(Rx, y); ctx.stroke();
      ctx.fillStyle = "#555"; ctx.font = "9px " + FONT; ctx.textAlign = "right";
      ctx.fillText(String(Math.round(v)), Lx - 5, y + 3);
      if (R) {
        var hv = R[0] + (R[1] - R[0]) * i / 4;
        ctx.fillStyle = "#15803d"; ctx.textAlign = "left";
        ctx.fillText(String(Math.round(hv)), Rx + 5, y + 3);
      }
    }
    var step = Math.max(1, Math.ceil(pts.length / 8));   // podpróbkowane daty, żeby się nie nakładały
    ctx.fillStyle = "#555"; ctx.font = "9px " + FONT; ctx.textAlign = "center";
    for (var k = 0; k < pts.length; k += step) {
      ctx.fillText(shortDateStr(pts[k].ts), X(k), B + 14);
    }
    function drawSeries(key, ymap, color){
      var started = false;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
      ctx.beginPath();
      for (var m = 0; m < pts.length; m++) {
        var val = pts[m][key];
        if (val == null) { started = false; continue; }
        var x = X(m), yy = ymap(val);
        if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
        ctx.fillRect(x - 1.8, yy - 1.8, 3.6, 3.6);
      }
      ctx.stroke();
    }
    if (showSys) drawSeries("sys", YL, "#c53030");
    if (showDia) drawSeries("dia", YL, "#2b6cb0");
    if (showHr)  drawSeries("hr", R ? YR : YL, "#15803d");
    var lx = Lx; ctx.textAlign = "left"; ctx.font = "bold 10px " + FONT;
    if (showSys) { ctx.fillStyle = "#c53030"; ctx.fillText("● SYS (mmHg)", lx, M + 46); lx += 110; }
    if (showDia) { ctx.fillStyle = "#2b6cb0"; ctx.fillText("● DIA (mmHg)", lx, M + 46); lx += 110; }
    if (showHr)  { ctx.fillStyle = "#15803d"; ctx.fillText("● HR (bpm" + (R ? ", prawa oś" : "") + ")", lx, M + 46); }
    return true;
  }
  async function renderReportPages(arr, cols){
    var PW = PDF_PW, PH = PDF_PH, M = 34, S = PDF_S, FONT = "Arial, Helvetica, sans-serif";
    var DATE_W = 100, COL_W = 70, HEAD_H = 30, LINE = 13, PADY = 5, MINROW = 20;
    var noteW = PW - 2 * M - DATE_W - COL_W * cols.length;
    var loc = settings.lang === "en" ? "en-US" : "pl-PL";
    var cv = document.createElement("canvas");
    cv.width = PW * S; cv.height = PH * S;
    var ctx = cv.getContext("2d");
    ctx.font = "italic 11px " + FONT;
    function measure(s){ return ctx.measureText(s).width; }
    var yieldUI = function(){ return new Promise(function(r){ setTimeout(r, 0); }); };

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

    // Paginacja tabeli: pierwsza strona tabeli ma blok tytułowy (gdy nie ma wykresu)
    var limit = PH - M - 8, pageRows = [], cur = [], y = M + 46 + HEAD_H;
    rows.forEach(function(r){
      if (cur.length && y + r.h > limit) { pageRows.push(cur); cur = []; y = M + HEAD_H; }
      cur.push(r); y += r.h;
    });
    pageRows.push(cur);

    var head = [{ w: DATE_W, label: t("pdfHeaderDt"), unit: "" }]
      .concat(cols.map(function(c){ return { w: COL_W, label: t(c.label), unit: c.unit }; }))
      .concat([{ w: noteW, label: t("pdfHeaderNotes"), unit: "" }]);

    // Strona 1: wykres (oś czasu = chronologia pomiarów, pełny zakres raportu)
    var out = [];
    var chartFirst = false;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH);
    ctx.textAlign = "left"; ctx.fillStyle = "#000"; ctx.font = "bold 18px " + FONT;
    ctx.fillText(t("pdfTitle"), M, M + 16);
    ctx.font = "11px " + FONT; ctx.fillStyle = "#555";
    ctx.fillText(t("pdfGen") + new Date().toLocaleString(loc), M, M + 34);
    chartFirst = drawPdfChartPage(ctx, arr, PW, PH, M);
    if (chartFirst) {
      ctx.font = "9px " + FONT; ctx.fillStyle = "#777";
      ctx.textAlign = "left"; ctx.fillText("Qardis", M, PH - 16);
      ctx.textAlign = "right"; ctx.fillText("1 / " + (pageRows.length + 1), PW - M, PH - 16);
      out.push({ data: await canvasToJpegBytes(cv), w: cv.width, h: cv.height });
      await yieldUI();
    }

    for (var pi = 0; pi < pageRows.length; pi++) {
      var list = pageRows[pi];
      ctx.setTransform(S, 0, 0, S, 0, 0);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH);
      ctx.textBaseline = "alphabetic"; ctx.lineWidth = 0.5; ctx.strokeStyle = "#999";
      var y = M;
      if (pi === 0 && !chartFirst) {
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
      ctx.textAlign = "right"; ctx.fillText((pi + 1 + (chartFirst ? 1 : 0)) + " / " + (pageRows.length + (chartFirst ? 1 : 0)), PW - M, PH - 16);

      out.push({ data: await canvasToJpegBytes(cv), w: cv.width, h: cv.height });
      await yieldUI();
    }
    return out;
  }
  function savePdf(){
    var arr = reportEntries();
    if (!arr.length){ toast(t("trendsNoData")); return; }
    setTimeout(function(){   // krótka zwłoka: arkusz zdąży się zamknąć przed ciężką pracą
      renderReportPages(arr, reportCols())
        .then(function(pages){
          var bytes = QardisCore.buildPdf(pages, PDF_PW, PDF_PH, t("pdfTitle"));
          downloadFile("qardis-raport-" + ymd(new Date()) + ".pdf", new Blob([bytes], { type: "application/pdf" }));
          toast("✓ " + t("pdfSaved"));
        })
        .catch(function(){ toast(t("pdfSaveError"), 5000, true); });
    }, 40);
  }

  // --- Drukuj (okno wydruku przeglądarki) ---
  // Statyczny SVG wykresu dla okna wydruku (ta sama geometria co strona wykresu
  // w PDF: SYS/DIA lewa oś, tętno prawa oś, pełny zakres raportu).
  function buildPrintChartSvg(arr, W, H){
    var showSys = settings.trackSys, showDia = settings.trackDia, showHr = settings.trackHr;
    var pts = arr.filter(function(e){
      return (showSys && e.sys != null) || (showDia && e.dia != null) || (showHr && e.hr != null);
    }).sort(function(a,b){ return a.ts - b.ts; });
    if (pts.length < 2) return "";
    var bpLo = Infinity, bpHi = -Infinity, hrLo = Infinity, hrHi = -Infinity;
    pts.forEach(function(p){
      if (showSys && p.sys != null) { bpLo = Math.min(bpLo, p.sys); bpHi = Math.max(bpHi, p.sys); }
      if (showDia && p.dia != null) { bpLo = Math.min(bpLo, p.dia); bpHi = Math.max(bpHi, p.dia); }
      if (showHr && p.hr != null) { hrLo = Math.min(hrLo, p.hr); hrHi = Math.max(hrHi, p.hr); }
    });
    var bpOk = isFinite(bpLo), hrOk = isFinite(hrLo);
    if (!bpOk && !hrOk) return "";
    function pad(lo, hi){
      var p = Math.max(Math.round((hi - lo) * 0.12), 4);
      lo -= p; hi += p;
      if (hi - lo < 10) { lo -= 5; hi += 5; }
      return [lo, hi];
    }
    var L = bpOk ? pad(bpLo, bpHi) : pad(hrLo, hrHi);
    var R = (bpOk && hrOk) ? pad(hrLo, hrHi) : null;
    var padL = 44, padR = R ? 44 : 10, padT = 8, padB = 22;
    var iw = W - padL - padR, ih = H - padT - padB;
    function YL(v){ return padT + (1 - (v - L[0]) / (L[1] - L[0])) * ih; }
    function YR(v){ return padT + (1 - (v - R[0]) / (R[1] - R[0])) * ih; }
    function X(i){ return padL + (i / (pts.length - 1)) * iw; }
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;margin:0 0 12px;">';
    for (var i = 0; i <= 4; i++) {
      var v = L[0] + (L[1] - L[0]) * i / 4, y = YL(v);
      s += '<line x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'" stroke="#ddd" stroke-width="1"/>'
         + '<text x="'+(padL-5)+'" y="'+(y+3)+'" text-anchor="end" font-size="9" fill="#555">'+Math.round(v)+'</text>';
      if (R) {
        var hv = R[0] + (R[1] - R[0]) * i / 4;
        s += '<text x="'+(W-padR+5)+'" y="'+(y+3)+'" font-size="9" fill="#15803d">'+Math.round(hv)+'</text>';
      }
    }
    var step = Math.max(1, Math.ceil(pts.length / 8));
    for (var k = 0; k < pts.length; k += step) {
      s += '<text x="'+X(k)+'" y="'+(H-6)+'" text-anchor="middle" font-size="9" fill="#555">'+escapeHtml(shortDateStr(pts[k].ts))+'</text>';
    }
    function series(key, ymap, color){
      var out = "", prev = null;
      for (var m = 0; m < pts.length; m++) {
        var val = pts[m][key];
        if (val == null) { prev = null; continue; }
        var x = X(m), yy = ymap(val);
        if (prev) out += '<line x1="'+prev[0]+'" y1="'+prev[1]+'" x2="'+x+'" y2="'+yy+'" stroke="'+color+'" stroke-width="2"/>';
        out += '<rect x="'+(x-2)+'" y="'+(yy-2)+'" width="4" height="4" fill="'+color+'"/>';
        prev = [x, yy];
      }
      return out;
    }
    if (showSys) s += series("sys", YL, "#c53030");
    if (showDia) s += series("dia", YL, "#2b6cb0");
    if (showHr)  s += series("hr", R ? YR : YL, "#15803d");
    return s + '</svg>';
  }
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
    // Style jako osobny ciąg: okno about:blank dziedziczy CSP otwierającego,
    // więc inline <style> byłby zablokowany przez 'style-src self'. Arkusz
    // konstruowany (CSSOM) omija restrykcje CSP — patrz adoptedStyleSheets niżej.
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
      'svg{page-break-inside:avoid;}',
      '@media print{p.hint{display:none;}}'
    ];
    var chartSvg = buildPrintChartSvg(arr, 740, 240);
    var html = '<!doctype html><html lang="'+escapeHtml(settings.lang)+'"><head><meta charset="utf-8"><title>'+escapeHtml(t("pdfTitle"))+'</title></head><body>'
      +'<h1>'+escapeHtml(t("pdfTitle"))+'</h1>'
      +'<p class="sub">'+escapeHtml(t("pdfGen")+new Date().toLocaleString(loc))+'</p>'
      +'<p class="hint">'+escapeHtml(t("pdfHint"))+'</p>'
      +chartSvg
      +'<table><thead><tr><th>'+escapeHtml(t("pdfHeaderDt"))+'</th>'+pdfCols.map(function(c){ return '<th>'+escapeHtml(t(c[0]))+'</th>'; }).join('')+'<th>'+escapeHtml(t("pdfHeaderNotes"))+'</th></tr></thead>'
      +'<tbody>'+rows+'</tbody></table></body></html>';

    var w = window.open("", "_blank");
    if (!w) { toast(t("pdfError")); return; }   // blokada pop-upów lub tryb prywatny
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
      // Style przez CSSOM (omija style-src CSP). Safari < 16.4 nie ma adoptedStyleSheets —
      // wtedy pusty <style> + insertRule (też CSSOM), zamiast przerywać cały eksport.
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
      // Po wydruku (lub anulowaniu) zamknij okno, żeby nie zostawała pusta karta.
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
      if (!othersOn) { toast("⚠ " + t("minParamWarn")); return; }   // ostatniego nie wyłączamy
    }
    settingsDraft[key] = !settingsDraft[key];
    renderMonitoredButtons();
  });

  // Wspólny handler segmentów ustawień (jak bindRangeControls dla zakresów)
  function bindSegmented(id, key, apply){
    $(id).addEventListener("click", function(e){
      var btn = e.target.closest("button"); if (!btn || !settingsDraft) return;
      settingsDraft[key] = btn.dataset.val;
      settings[key] = settingsDraft[key];
      apply();
    });
  }
  bindSegmented("langSwitch", "lang", applyLanguage);
  bindSegmented("fontSizeSwitch", "fontSize", applyFontSize);

  settingsOverlay.addEventListener("click", function(e){ if (e.target === settingsOverlay) cancelSettings(); });
  function saveSettings(){
    if(!settingsDraft) return;
    settings = Object.assign({}, settingsDraft);
    if (!StorageModule.saveSettings(settings)) toast(t("storageError"));
    setModalState(settingsOverlay, false);
    settingsDraft=null; settingsBefore=null;
    render();
    toast("✓ " + t("settingsSaved"));
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
      // Okno potwierdzenia leży nad arkuszem: arkusz pod spodem też nie może łapać Tab/czytnika.
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
  // Wygląd toastów: klasy .toast / .toast-undo / .toast-hide w style.css

  var toastQueue = [];

  function clearToast(){
    toastTimers.forEach(clearTimeout);
    toastTimers = [];
    toastQueue = [];   // jawnie zamknięte toasty kasują również kolejkę
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }

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
    showToast(el, msg + " " + t("btnUndo"), UNDO_MS, true);
  }

  applyTheme();
  applyLanguage();
  applyFontSize();
  go(0);
  render();
  if (StorageModule.hadIssue()) toast(t("storageCorrupt"), 9000, true);

  function refreshCorruptBtn(){
    var btn = $("btnCorrupt"); if (!btn) return;
    var data = StorageModule.corruptRaw();
    btn.style.display = data ? "flex" : "none";
    btn.onclick = function(){
      var d = StorageModule.corruptRaw(); if (!d) return;
      downloadFile("qardis-dane-uszkodzone-"+ymd(new Date())+".json", d);
      setModalState(toolsOverlay, false);
      toast("✓ " + t("corruptExported"));
    };
  }
  refreshCorruptBtn();
  // === Archiwum pomiarów (wpisy starsze niż 9 mies.) ===
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
    el.textContent = t("archiveCount").replace("{n}", archive.length) + " (" + fmtDate(mn).date + " – " + fmtDate(mx).date + ")";
    if (peek) {
      peek.hidden = false;
      peek.textContent = list && !list.hidden && list.childNodes.length ? t("archiveHide") : t("archiveShow");
    }
  }
  function renderArchiveList(){
    var list = $("archiveList");
    var archive = StorageModule.loadArchive()
      .sort(function(a,b){ return a.ts - b.ts; })   // chronologicznie
      .slice(-50);   // limit czytelności (ostatnie 50); pełne dane w eksporcie
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
      v.textContent = parts.join(" · ") || "—";
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
    if (!StorageModule.saveArchive(archive)) { toast(t("storageError"), 5000, true); return; }
    entries = entries.filter(function(e){ return e.ts >= cutoff; });
    if (!StorageModule.saveEntries(entries)) toast(t("storageError"), 5000, true);
    resetArchivePeek();
    updateArchiveSummary();
    render();
    toast("✓ " + t("archivedMsg") + toMove.length + pluralEntries(toMove.length));
  }
  function restoreArchive(){
    var archive = StorageModule.loadArchive();
    if (!archive.length) { toast(t("archiveEmpty")); return; }
    var ids = Object.create(null);
    entries.forEach(function(e){ ids[e.id] = 1; });
    var added = 0;
    archive.forEach(function(e){ if (!ids[e.id]) { entries.push(e); ids[e.id] = 1; added++; } });
    if (!StorageModule.saveEntries(entries)) { toast(t("storageError"), 5000, true); return; }
    if (!StorageModule.saveArchive([])) toast(t("storageError"), 5000, true);
    resetArchivePeek();
    updateArchiveSummary();
    render();
    toast("✓ " + t("archiveRestoredMsg") + added + pluralEntries(added));
  }
  function exportArchive(){
    var archive = StorageModule.loadArchive();
    if (!archive.length) { toast(t("archiveEmpty")); return; }
    var obj = { schemaVersion: 1, type: "qardis-archive", exportedAt: new Date().toISOString(), entries: archive };
    downloadFile("qardis-archiwum-"+ymd(new Date())+".json", JSON.stringify(obj, null, 2));
    toast("✓ " + t("archiveExportedMsg"));
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

  (function backupReminder(){
    if (!entries.length) return;
    var MONTH = 30 * 24 * 60 * 60 * 1000;
    if (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > MONTH) {
      toast("⏰ " + t("backupReminder"), 9000);
    }
  })();

  // Synchronizacja między kartami/oknami PWA tego samego originu.
  window.addEventListener("storage", function(ev){
    if (ev.key === StorageModule.entriesKey()) {
      // Podczas edycji wpisu nie przerywamy formularza – odświeżamy tylko dane;
      // scaleniem zmian z innej karty przy naszym zapisie zajmie się saveEntries.
      entries = StorageModule.loadEntries();
      if (editingId === null) render(); else drawTrends(true);
    } else if (ev.key === StorageModule.settingsKey()) {
      // Nie nadpisujemy ustawień, gdy użytkownik ma otwarty arkusz ustawień/edycji.
      var busy = $("settingsOverlay").classList.contains("open")
        || $("addOverlay").classList.contains("open");
      if (!busy) {
        settings = StorageModule.loadSettings();
        applyTheme(); applyLanguage(); applyFontSize(); render();
      }
    }
  });

  // Karta w tle (zwłaszcza mobilna PWA) nie dostaje zdarzeń „storage”: po powrocie sprawdzamy,
  // czy dane się zmieniły, zanim użytkownik zapisze coś na nieaktualnym stanie.
  function refreshIfStale(){
    if (document.visibilityState === "hidden") return;
    if ($("addOverlay").classList.contains("open") || !StorageModule.isStale()) return;
    entries = StorageModule.loadEntries();
    render();
  }
  document.addEventListener("visibilitychange", refreshIfStale);
  window.addEventListener("pageshow", function(ev){ if (ev.persisted) refreshIfStale(); });
  window.addEventListener("focus", refreshIfStale);

  if (new URLSearchParams(window.location.search).get("action") === "add") {
    try { history.replaceState(null, "", location.pathname); } catch(e){}
    setTimeout(function(){ var b = $("btnAdd"); if (b) b.click(); }, 80);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(e){ /* instalacja PWA niedostępna; aplikacja działa online */ });
    });
  }
})();