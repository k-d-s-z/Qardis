(function(){
  "use strict";

  function sanitizeEntry(e){
    if (!e || typeof e !== "object") return null;
    function num(v, lo, hi){ return (typeof v === "number" && isFinite(v) && v >= lo && v <= hi) ? v : null; }
    var ts = (typeof e.ts === "number" && isFinite(e.ts) && e.ts >= 0 && e.ts <= 4102444800000) ? e.ts : null;
    if (ts === null) return null;
    return {
      id: (typeof e.id === "string" && e.id.length > 0 && e.id.length <= 100) ? e.id : null,
      ts: ts,
      sys: num(e.sys, 50, 300), dia: num(e.dia, 30, 200), hr: num(e.hr, 20, 250), wgt: num(e.wgt, 20, 300),
      note: typeof e.note === "string" ? e.note.slice(0, 2000) : ""
    };
  }
  function lossy(orig, clean){
    return ["sys","dia","hr","wgt"].some(function(k){ return orig[k] != null && clean[k] === null; });
  }

  // --- MODUŁ 1: Storage & State ---
  var StorageModule = (function(){
    var LS = "qardis.entries.v1", LS_SET = "qardis.settings.v1";
    var issue = false;
    var lastRaw = null;   // ostatni stan localStorage znany tej karcie (wykrywanie zapisów z innych kart)
    function stash(raw){
      issue = true;
      try { localStorage.setItem(LS + ".corrupt", raw); } catch(e){}
    }
    function buildDefaults(){
      var autoTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light";
      return {
        defSys:120, defDia:80, defHr:70, defWgt:75, theme:autoTheme, lang:"pl", fontSize:"medium",
        trackSys:true, trackDia:true, trackHr:true, trackWgt:true,
        incHr: false, incWgt: false,      // czy nowy wpis domyślnie zawiera tętno / wagę (pamiętane)
        persistAsked: false,
        lastBackupAt: 0                   // czas ostatniej kopii zapasowej (przypominacz ~30 dni)
      };
    }
    function sanitizeSettings(s, fromLoad){
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
      return out;
    }
    return {
      hadIssue: function(){ return issue; },
      corruptRaw: function(){
        // Audyt(2): zachowana kopia uszkodzonych danych – eksportowana z menu.
        try { return localStorage.getItem(LS + ".corrupt"); } catch(e){ return null; }
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
        var out = sanitizeSettings(s, true);
        return out;
      },
      sanitizeSettings: function(s){ return sanitizeSettings(s, false); },
      saveSettings: function(settings){
        try { localStorage.setItem(LS_SET, JSON.stringify(settings)); return true; }
        catch(e){ return false; }
      },
      wipeAll: function(){
        [LS, LS_SET, LS + ".corrupt"].forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
        lastRaw = null;
      },
      entriesKey: function(){ return LS; },
      settingsKey: function(){ return LS_SET; }
    };
  })();

  // --- MODUŁ 2: Validation ---
  var ValidationModule = (function(){
    return {
      validateImport: function(j){
        // Walidacja tylko STRUKTURY pliku (obiekty, typy pól). Zakresy i sensowność
        // poszczególnych rekordów sprawdza pętla importu, która pomija złe rekordy
        // pojedynczo i je zlicza – jeden rekord poza zakresem nie odrzuca całego pliku.
        if (!j || typeof j !== "object") return false;
        var list = j.entries || (Array.isArray(j) ? j : null);
        if (!Array.isArray(list)) return false;
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          var numKeys = ["sys","dia","hr","wgt","ts"];
          for (var k = 0; k < numKeys.length; k++) {
            var v = item[numKeys[k]];
            if (v !== undefined && v !== null && (typeof v !== "number" || !isFinite(v))) return false;
          }
          if (item.id !== undefined && item.id !== null && (typeof item.id !== "string" || item.id.length > 100)) return false;
          if (item.note !== undefined && item.note !== null && (typeof item.note !== "string" || item.note.length > 2000)) return false;
        }
        return true;
      }
    };
  })();

  // --- MODUŁ 3: I18n ---
  var I18nModule = (function(){
    var translations = {
      pl: {
        trendsTitle: "Qardis – Trendy pomiarów", trendsDesc: "Średnie i zakresy wartości w wybranym okresie.", trendsNoData: "Brak pomiarów w wybranym okresie.",
        viewBars: "Zakresy", sumCount: "Pomiarów: {n}", sumBp: "Ciśnienie – średnia", sumHr: "Tętno – średnia", sumWgt: "Waga – średnia", minMax: "min–maks",
        barsHint: "Słupek: od rozkurczowego (DIA) do skurczowego (SYS). Jaśniejsza smuga: min–maks w grupie.",
        barsMode_m: "Pojedyncze pomiary", barsMode_d: "Średnie dzienne", barsMode_w: "Średnie tygodniowe",
        normsNote: "Aktualne normy dla ciśnienia skurczowego i rozkurczowego znajdziesz na stronach Polskiego Towarzystwa Nadciśnienia Tętniczego i Polskiego Towarzystwa Kardiologicznego oraz na stronach analogicznych instytucji w innych krajach.",
        wipeDesc: "Usuwa wszystkie pomiary i ustawienia z tego urządzenia.",
        navHistory: "Pomiary", navTrends: "Trendy", 
        sysLabel: "Skurczowe", diaLabel: "Rozkurczowe", hrLabel: "Tętno", wgtLabel: "Waga",
        emptyTitle: "Brak pomiarów", emptyDesc: "Dodaj pierwszy pomiar ciśnienia, aby rozpocząć śledzenie wyników.", btnAddFirst: "+ Dodaj pierwszy pomiar",
        addTitleNew: "Nowy wpis", addTitleEdit: "Edytuj wpis", dtLabel: "Data i godzina pomiaru",
        notePlaceholder: "Dodatkowe informacje... (np. przeziębienie, złe samopoczucie)",
        btnCancel: "Anuluj", btnSave: "Zapisz", btnDelete: "Usuń", btnUndo: "Cofnij", btnProceed: "Kontynuuj",
        toolsTitle: "Dane i eksport", settingsTitle: "Ustawienia", monitoredTitle: "Monitorowane parametry", 
        
        
        langLabel: "Język", fontSizeLabel: "Wielkość czcionki", darkMode: "Tryb ciemny", darkModeDesc: "Jasny / ciemny motyw",
        titleBtnAdd: "Dodaj wpis", titleBtnBackup: "Utwórz kopię zapasową", titleBtnImport: "Importuj dane z pliku", titleBtnPdf: "Eksportuj raport do PDF", titleBtnSettings: "Ustawienia",
        titleBtnCorrupt: "Eksportuj dane uszkodzone (kopia zabezpieczona)", corruptExported: "Pobrano kopię danych uszkodzonych",
        backupReminder: "Minęło ponad 30 dni od ostatniej kopii zapasowej – rozważ jej utworzenie (menu „Dane i eksport”).",
        btnEdit: "Edytuj", importedMsg: "Zaimportowano ", importedSuffix: " wpis(y/ów).", importError: "Nieprawidłowy plik kopii zapasowej.",
        noEntriesPdf: "Brak wpisów do wydruku.", pdfError: "Nie udało się otworzyć okna wydruku.", pdfTitle: "Qardis – historia pomiarów", pdfGen: "Wygenerowano: ", pdfHint: "Użyj Ctrl+P / ⌘+P i wybierz „Zapisz jako PDF”.", pdfHeaderDt: "Data i godzina", pdfHeaderNotes: "Uwagi", pdfExportTitle: "Eksport raportu PDF", pdfRangeTitle: "Zakres danych", btnExport: "Eksportuj",
        savedMsg: "Pomiar zapisany", updatedMsg: "Pomiar zaktualizowany", deletedMsg: "Wpis został usunięty", importConfirm: "Dane z kopii zostaną połączone z istniejącymi wpisami. Kontynuować?",
        r7:"7 dni", r30:"30 dni", r90:"3 mies.", rAll:"Wszystkie",
        viewTable: "Tabela",
        
        bpErrorMsg: "Wartość skurczowa (SYS) musi być wyższa niż rozkurczowa (DIA).",
        privacyAlert: "Uwaga: Ten plik zawiera wrażliwe dane dotyczące zdrowia. Przechowuj go w bezpiecznym miejscu i nie udostępniaj osobom nieupoważnionym.",
        storageError: "Nie udało się zapisać danych (może tryb prywatny?).",
        wheelClampWarn: "Wpis zawiera wartość spoza zakresu bębenka – zapis przywróci ją do najbliższej dopuszczalnej.",
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
        wipeConfirm: "Usunąć WSZYSTKIE pomiary i ustawienia z tego urządzenia? Tej operacji nie można cofnąć. Jeśli chcesz zachować dane, najpierw utwórz kopię zapasową.",
        wipeDone: "Wszystkie dane zostały usunięte",
        privacyNote: "Dane są przechowywane wyłącznie na tym urządzeniu.",
        importSettingsConfirm: "Plik zawiera też ustawienia (język, monitorowane parametry). Zastąpić nimi bieżące ustawienia?"
      },
      en: {
        trendsTitle: "Qardis – Measurement trends", trendsDesc: "Averages and value ranges for the selected period.", trendsNoData: "No measurements in the selected period.",
        viewBars: "Ranges", sumCount: "Measurements: {n}", sumBp: "Blood pressure – average", sumHr: "Pulse – average", sumWgt: "Weight – average", minMax: "min–max",
        barsHint: "Bar: from diastolic (DIA) to systolic (SYS). Lighter streak: min–max within the group.",
        barsMode_m: "Individual measurements", barsMode_d: "Daily averages", barsMode_w: "Weekly averages",
        normsNote: "Current guidelines for systolic and diastolic blood pressure are available on the websites of the Polish Society of Hypertension and the Polish Cardiac Society, as well as of equivalent institutions in other countries.",
        wipeDesc: "Deletes all measurements and settings from this device.",
        navHistory: "Readings", navTrends: "Trends", 
        sysLabel: "Systolic", diaLabel: "Diastolic", hrLabel: "Pulse", wgtLabel: "Weight",
        emptyTitle: "No measurements yet", emptyDesc: "Add your first blood pressure record to start tracking.", btnAddFirst: "+ Add first measurement",
        addTitleNew: "New entry", addTitleEdit: "Edit entry", dtLabel: "Date and time of measurement",
        notePlaceholder: "Additional info... (e.g. cold, feeling unwell)",
        btnCancel: "Cancel", btnSave: "Save", btnDelete: "Delete", btnUndo: "Undo", btnProceed: "Proceed",
        toolsTitle: "Data & Export", settingsTitle: "Settings", monitoredTitle: "Monitored parameters", 
        
        
        langLabel: "Language", fontSizeLabel: "Font size", darkMode: "Dark mode", darkModeDesc: "Light / dark theme",
        titleBtnAdd: "Add entry", titleBtnBackup: "Backup data", titleBtnImport: "Import data from file", titleBtnPdf: "Export PDF report", titleBtnSettings: "Settings",
        titleBtnCorrupt: "Export corrupted data (safety copy)", corruptExported: "Corrupted data copy downloaded",
        backupReminder: "More than 30 days since your last backup – consider creating one (Data & Export menu).",
        btnEdit: "Edit", importedMsg: "Imported ", importedSuffix: " entry/entries.", importError: "Invalid backup file.",
        noEntriesPdf: "No entries to print.", pdfError: "Failed to open print window.", pdfTitle: "Qardis – measurement history", pdfGen: "Generated: ", pdfHint: "Use Ctrl+P / ⌘+P and select 'Save as PDF'.", pdfHeaderDt: "Date & Time", pdfHeaderNotes: "Notes", pdfExportTitle: "Export PDF report", pdfRangeTitle: "Data range", btnExport: "Export",
        savedMsg: "Measurement saved", updatedMsg: "Measurement updated", deletedMsg: "Entry deleted", importConfirm: "Backup data will be merged with existing entries. Proceed?",
        r7:"7 days", r30:"30 days", r90:"3 mos.", rAll:"All",
        viewTable: "Table",
        
        bpErrorMsg: "Systolic pressure (SYS) must be higher than diastolic (DIA).",
        privacyAlert: "Notice: This file contains sensitive health data. Store it in a secure place and do not share it with unauthorized persons.",
        storageError: "Failed to save data (private browsing mode?).",
        wheelClampWarn: "This entry has a value outside the wheel range – saving will snap it to the nearest allowed value.",
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
        wipeConfirm: "Delete ALL measurements and settings from this device? This cannot be undone. If you want to keep your data, create a backup first.",
        wipeDone: "All data has been deleted",
        privacyNote: "Data is stored only on this device.",
        importSettingsConfirm: "The file also contains settings (language, monitored parameters). Replace your current settings with them?"
      }
    };
    return {
      t: function(key, lang) {
        var l = lang || "pl";
        return (translations[l] && translations[l][key]) || translations["pl"][key] || key;
      }
    };
  })();

  // --- MODUŁ 4: Table Renderer ---
  var TableModule = (function(){
    return {
      renderTable: function(tableMount, entries, settings, rangeDays, tCb, fmtDateCb, escapeHtmlCb){
        tableMount.innerHTML = "";
        if (!entries.length){
          tableMount.innerHTML = '<div class="trends-empty">' + tCb("emptyTitle") + '</div>';
          return;
        }
        var now = Date.now();
        var filtered = entries.filter(function(e){
          if (rangeDays === "all") return true;
          var cutoff = now - (rangeDays * 24 * 60 * 60 * 1000);
          return e.ts >= cutoff;
        }).sort(function(a,b){ return b.ts - a.ts; });

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

        // Sztywne szerokości kolumn: tabela nigdy nie wychodzi poza ekran
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
    };
  })();

  // --- MODUŁ 5: Main App Logic & UI Coordinator ---
  var entries = StorageModule.loadEntries();
  var settings = StorageModule.loadSettings();
  var trendsRangeDays = 30;
  var settingsDraft = null;
  var settingsBefore = null;
  var hrActive = true;
  var wgtActive = true;
  var pendingDeletes = [];
  var deleteTimeout = null;

  function t(key) { return I18nModule.t(key, settings.lang); }

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
      btn.classList.toggle('active', btn.dataset.val === settings.lang);
      btn.setAttribute('aria-pressed', btn.dataset.val === settings.lang ? 'true' : 'false');
    });
    document.documentElement.lang = settings.lang || "pl";
  }

  function applyFontSize() {
    var fontSizes = { small: "87.5%", medium: "100%", large: "112.5%" };
    var sz = fontSizes[settings.fontSize] || fontSizes.medium;
    document.documentElement.style.setProperty('--base-font-size', sz);
    document.querySelectorAll('#fontSizeSwitch button').forEach(function(btn){
      btn.classList.toggle('active', btn.dataset.val === settings.fontSize);
      btn.setAttribute('aria-pressed', btn.dataset.val === settings.fontSize ? 'true' : 'false');
    });
  }

  function applyTheme(){
    document.documentElement.setAttribute("data-theme", settings.theme);
    var meta = document.getElementById("themeColorMeta");
    if(meta) meta.setAttribute("content", settings.theme === "dark" ? "#1b1d20" : "#f0f4f9");
  }

  function renderMonitoredButtons() {
    if (!settingsDraft) return;
    document.querySelectorAll('#monitoredSwitch button').forEach(function(btn){
      var p = btn.dataset.param;
      var key = 'track' + p.charAt(0).toUpperCase() + p.slice(1);
      btn.classList.toggle('active', !!settingsDraft[key]);
      btn.setAttribute('aria-pressed', settingsDraft[key] ? 'true' : 'false');
    });
  }

  function fmtDate(ts){
    var d = new Date(ts);
    function p(n){ return (n<10?"0":"")+n; }
    return { date: p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear(), time: p(d.getHours())+":"+p(d.getMinutes()) };
  }

  var entryList = document.getElementById("entryList");

  function render(){
    entryList.innerHTML = "";

    if (!entries.length){
      entryList.innerHTML = '<div class="empty-box">'
        +'<h3>'+t("emptyTitle")+'</h3>'
        +'<p>'+t("emptyDesc")+'</p>'
        +'<button class="btn" id="btnEmptyAdd" style="max-width:220px;margin:0 auto">'+t("btnAddFirst")+'</button>'
        +'</div>';
      document.getElementById("btnEmptyAdd").onclick = function(){ openAdd(null); };
      drawTrends();
      return;
    }

    var arr = entries.slice().sort(function(a,b){ return b.ts - a.ts; });
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
        html += '<div class="card-note">✎ ' + escapeHtml(e.note) + '</div>';
      }

      card.innerHTML = html;
      var hit = document.createElement("button");
      hit.type = "button";
      hit.className = "card-hit";
      hit.setAttribute("aria-label", t("addTitleEdit") + ", " + f.date + " " + f.time);
      hit.addEventListener("click", function(){ openAdd(e); });
      card.insertBefore(hit, card.firstChild);
      frag.appendChild(card);
    });
    entryList.appendChild(frag);

    drawTrends();
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
    render();
    if(document.getElementById("addOverlay").classList.contains("open")) setModalState(document.getElementById("addOverlay"), false);

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
    var s = settings.trackSys ? statOf(list, "sys") : null;
    var d = settings.trackDia ? statOf(list, "dia") : null;
    var h = settings.trackHr  ? statOf(list, "hr")  : null;
    var w = settings.trackWgt ? statOf(list, "wgt") : null;

    mount.appendChild(mkEl("div", "sum-count", t("sumCount").replace("{n}", list.length)));
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
    if (s || d) {
      var avgParts = [], rngParts = [];
      if (s) { avgParts.push(rnd(s.avg)); rngParts.push("SYS " + rangeTxt(s, rnd)); }
      if (d) { avgParts.push(rnd(d.avg)); rngParts.push("DIA " + rangeTxt(d, rnd)); }
      card("wide", t("sumBp"), avgParts.join(" / "), "mmHg", rngParts.join(" · "));
    }
    if (h) card("", t("sumHr"), rnd(h.avg), "bpm", rangeTxt(h, rnd));
    if (w) card("", t("sumWgt"), fmt1(w.avg), "kg", rangeTxt(w, fmt1));
    mount.appendChild(grid);
  }

  function drawTrends(force){
    // Rysuj tylko gdy ekran Trendy jest aktywny, chyba że wymuszono (zmiana ustawień)
    if (!force && screenIdx !== 1) return;
    var tableMount = document.getElementById("trendsTableMount");
    var empty = document.getElementById("trendsEmpty");
    var sumMount = document.getElementById("trendsSummary");

    sumMount.textContent = "";
    empty.hidden = true;
    tableMount.hidden = true;

    if (!entries.length) {
      empty.innerHTML = '<h3>' + t("emptyTitle") + '</h3>'
        + '<p style="margin-bottom:12px;">' + t("emptyDesc") + '</p>'
        + '<button class="btn" id="btnTrendsAdd" style="max-width:200px;margin:0 auto;padding:10px 14px;font-size:0.9rem;">' + t("btnAddFirst") + '</button>';
      empty.hidden = false;
      document.getElementById("btnTrendsAdd").onclick = function(){ openAdd(null); };
      return;
    }

    var cutoff = (trendsRangeDays === "all") ? -Infinity : Date.now() - trendsRangeDays * DAY_MS;
    var filtered = entries.filter(function(e){ return e.ts >= cutoff; })
      .sort(function(a, b){ return a.ts - b.ts; });

    if (!filtered.length) {
      empty.textContent = t("trendsNoData");
      empty.hidden = false;
      return;
    }

    renderSummary(filtered, sumMount);
    tableMount.hidden = false;
    TableModule.renderTable(tableMount, entries, settings, trendsRangeDays, t, fmtDate, escapeHtml);
  }

  document.getElementById("trendsRange").addEventListener("click", function(e){
    var btn = e.target.closest("button"); if (!btn) return;
    document.querySelectorAll("#trendsRange button").forEach(function(b){ b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
    btn.classList.add("active"); btn.setAttribute("aria-pressed", "true");
    var r = btn.dataset.range;
    trendsRangeDays = (r === "all") ? "all" : parseInt(r, 10);
    drawTrends();
  });
  document.querySelectorAll("#trendsRange button").forEach(function(b){ b.setAttribute("aria-pressed", b.classList.contains("active") ? "true" : "false"); });

  var track = document.getElementById("track");
  var screenIdx = 0;
  function go(i){
    screenIdx = i;
    track.style.transform = "translateX(" + (-i*50) + "%)";
    document.getElementById("navHistory").classList.toggle("active", i===0);
    document.getElementById("navHistory").setAttribute("aria-selected", i===0 ? "true" : "false");
    document.getElementById("navTrends").classList.toggle("active", i===1);
    document.getElementById("navTrends").setAttribute("aria-selected", i===1 ? "true" : "false");

    var homeSc = document.getElementById("homeScreen");
    var trendsSc = document.getElementById("trendsScreen");
    if (i === 0) {
      homeSc.removeAttribute("inert"); homeSc.setAttribute("aria-hidden", "false");
      trendsSc.setAttribute("inert", ""); trendsSc.setAttribute("aria-hidden", "true");
    } else {
      trendsSc.removeAttribute("inert"); trendsSc.setAttribute("aria-hidden", "false");
      homeSc.setAttribute("inert", ""); homeSc.setAttribute("aria-hidden", "true");
      drawTrends(true);
    }
  }

  document.getElementById("navHistory").onclick = function(){ go(0); };
  document.getElementById("navTrends").onclick = function(){ go(1); };

  var startX = null, startY = null, dx = 0, dy = 0, axis = null;
  var viewport = document.getElementById("viewport");
  function allowed(t){
    return !t.closest("#dock") && !t.closest(".sheet") && !t.closest(".wheel") &&
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
    if (axis === "x" && dx < -60 && screenIdx === 0) go(1);
    else if (axis === "x" && dx > 60 && screenIdx === 1) go(0);
    else go(screenIdx);
    startX = null; startY = null; axis = null;
  }
  viewport.addEventListener("touchend", endSwipe);
  viewport.addEventListener("touchcancel", endSwipe);

  var toolsOverlay = document.getElementById("toolsOverlay");
  document.getElementById("btnTools").onclick = function(){ setModalState(toolsOverlay, true); };
  document.getElementById("btnToolsClose").onclick = function(){ setModalState(toolsOverlay, false); };
  toolsOverlay.addEventListener("click", function(e){ if (e.target === toolsOverlay) setModalState(toolsOverlay, false); });

  var addOverlay = document.getElementById("addOverlay");
  var editingId = null;
  var ROW = 40;
  function makeWheel(elId, cfg){
    var el = document.getElementById(elId);
    var rowEls = []; el.innerHTML = "";
    el.setAttribute("role", "spinbutton"); el.tabIndex = 0;
    el.setAttribute("aria-valuemin", cfg.min); el.setAttribute("aria-valuemax", cfg.max);
    function spacer(){ var sp = document.createElement("div"); sp.className = "sp"; sp.innerHTML = "&nbsp;"; el.appendChild(sp); }
    spacer();
    var v = cfg.min;
    while (v <= cfg.max + 1e-9){
      var d = document.createElement("div");
      d.textContent = (cfg.step && cfg.step < 1) ? v.toFixed(1) : Math.round(v);
      d.dataset.val = v; el.appendChild(d); rowEls.push(d);
      v = +(v + (cfg.step||1)).toFixed(1);
    }
    spacer();
    function idxOf(){ var i = Math.round(el.scrollTop / ROW); return Math.min(Math.max(i, 0), rowEls.length - 1); }
    function paint(){
      var idx = idxOf();
      rowEls.forEach(function(n,i){ n.className = (i === idx) ? "sel" : ""; });
      if (rowEls[idx]) el.setAttribute("aria-valuenow", rowEls[idx].dataset.val);
    }
    // Odczyt zawsze z pełnego wiersza: dosunięcie przerywa inercję (momentum scroll),
    // więc "Zapisz" w trakcie toczenia koła nie złapie wartości z połowy przewijania.
    var settledVal = cfg.min, settleT = null;
    function commit(){
      el.scrollTop = Math.round(el.scrollTop / ROW) * ROW;
      paint();
      var n = rowEls[idxOf()];
      if (n) settledVal = +n.dataset.val;
    }
    el.addEventListener("scroll", function(){
      paint();
      if (settleT) clearTimeout(settleT);
      settleT = setTimeout(commit, 160);   // fallback dla przeglądarek bez scrollend
    });
    el.addEventListener("scrollend", function(){ if (settleT) { clearTimeout(settleT); settleT = null; } commit(); });
    el.addEventListener("click", function(e){
      var item = e.target.closest("div[data-val]");
      if(item) {
        var val = +item.dataset.val;
        var i = Math.round((clamp(val, cfg.min, cfg.max) - cfg.min) / (cfg.step||1));
        el.scrollTop = i * ROW; commit();
      }
    });
    el.addEventListener("keydown", function(ev){
      var st = cfg.step || 1, cur = +rowEls[Math.min(Math.max(Math.round(el.scrollTop / ROW), 0), rowEls.length - 1)].dataset.val, nv = null;
      switch (ev.key) {
        case "ArrowUp": nv = cur + st; break;
        case "ArrowDown": nv = cur - st; break;
        case "PageUp": nv = cur + st * 10; break;
        case "PageDown": nv = cur - st * 10; break;
        case "Home": nv = cfg.min; break;
        case "End": nv = cfg.max; break;
      }
      if (nv === null) return;
      ev.preventDefault();
      var i = Math.round((clamp(+nv.toFixed(1), cfg.min, cfg.max) - cfg.min) / st);
      el.scrollTop = i * ROW; commit();
    });
    return {
      set: function(val){
        var i = Math.round((clamp(val, cfg.min, cfg.max) - cfg.min) / (cfg.step||1));
        el.scrollTop = i * ROW; commit();
      },
      get: function(){
        // Zawsze zatrzymaj inercję i odczytaj pełny (dosunięty) wiersz.
        commit();
        return settledVal;
      }
    };
  }
  function clamp(v,a,b){ return Math.min(b, Math.max(a, v)); }
  function clampWheelVal(cfg, val){
    if (val == null) return val;
    return clamp(val, cfg.min, cfg.max);
  }
  function makeId(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var wheelDefs = {
    wSys: {min:60, max:250, step:1}, wDia: {min:30, max:180, step:1}, wHr: {min:30, max:220, step:1}
  };
  var wheels = {};
  Object.keys(wheelDefs).forEach(function(id){
    try { wheels[id] = makeWheel(id, wheelDefs[id]); } catch(e){}
  });

  var WHEEL_UNITS = { wSys: " mmHg", wDia: " mmHg", wHr: " bpm" };
  var WGT_MIN = 20, WGT_MAX = 300;
  var wgtInput = document.getElementById("wWgt");
  var weightField = {
    set: function(v){ wgtInput.value = (v != null && isFinite(v)) ? (Math.round(v * 10) / 10).toFixed(1) : ""; },
    get: function(){
      var raw = String(wgtInput.value).replace(",", ".").trim();
      if (raw === "") return null;
      var v = parseFloat(raw);
      return isFinite(v) ? Math.round(v * 10) / 10 : NaN;
    }
  };
  // ostatnia znana wartość (nie tylko z najnowszego wpisu, który mógł jej nie mieć)
  function lastKnown(key, fallback){
    var arr = entries.slice().sort(function(a,b){ return b.ts - a.ts; });
    for (var i = 0; i < arr.length; i++) { if (arr[i][key] != null) return arr[i][key]; }
    return fallback;
  }
  function bumpWeight(d){
    var cur = weightField.get();
    if (cur === null || isNaN(cur)) cur = lastKnown("wgt", settings.defWgt);
    weightField.set(clamp(cur + d, WGT_MIN, WGT_MAX));
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
      document.getElementById(a[0]).classList.toggle("disabled", !a[3]);
      var w = document.getElementById(a[1]);
      if (w.tagName === "INPUT") {
        w.disabled = !a[3];
        document.querySelectorAll("#boxWWgt .num-btns button").forEach(function(b){ b.disabled = !a[3]; });
      } else {
        w.tabIndex = a[3] ? 0 : -1;
        w.setAttribute("aria-disabled", a[3] ? "false" : "true");
      }
      var b = document.getElementById(a[2]);
      var lbl = t((a[3] ? "skip" : "add") + a[4]);
      b.setAttribute("aria-label", lbl); b.title = lbl;
      b.textContent = a[3] ? "✕" : "+";
    });
  }
  function labelWheels(){
    Object.keys(wheelDefs).forEach(function(id){
      var w = document.getElementById(id);
      var lab = w.parentNode.querySelector("label");
      if (lab) w.setAttribute("aria-label", lab.textContent + WHEEL_UNITS[id]);
    });
    wgtInput.setAttribute("aria-label", t("wgtLabel") + " (kg)");
    document.getElementById("btnWgtDec").setAttribute("aria-label", t("wgtDec"));
    document.getElementById("btnWgtInc").setAttribute("aria-label", t("wgtInc"));
  }
  document.getElementById("btnClearWHr").onclick = function(){
    hrActive = !hrActive;
    if (!editingId) { settings.incHr = hrActive; StorageModule.saveSettings(settings); }
    syncOptionalWheels();
  };
  document.getElementById("btnClearWWgt").onclick = function(){
    wgtActive = !wgtActive;
    if (wgtActive && weightField.get() === null) weightField.set(lastKnown("wgt", settings.defWgt));
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
        // Flaga "pytano" tylko, gdy trwałość faktycznie przyznano; w przeciwnym
        // razie (np. iOS Safari w przeglądarce) spróbujemy ponownie w kolejnej sesji.
        if (granted) { settings.persistAsked = true; StorageModule.saveSettings(settings); }
      })
      .catch(function(){});
  }

  function toLocalInput(ts){
    var d = new Date(ts);
    function p(n){ return (n<10?"0":"")+n; }
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
  }

  function getLatestEntry(){
    if (!entries.length) return null;
    var sorted = entries.slice().sort(function(a,b){ return b.ts - a.ts; });
    return sorted[0];
  }

  function openAdd(entry){
    editingId = entry ? entry.id : null;
    document.getElementById("addTitle").textContent = entry ? t("addTitleEdit") : t("addTitleNew");
    document.getElementById("noteField").value = entry ? (entry.note||"") : "";
    document.getElementById("dtField").value = toLocalInput(entry ? entry.ts : Date.now());
    
    document.getElementById("btnDeleteEntryHeader").style.display = entry ? "block" : "none";
    document.getElementById("bpInlineError").hidden = true;

    document.getElementById("boxWSys").style.display = settings.trackSys ? "block" : "none";
    document.getElementById("boxWDia").style.display = settings.trackDia ? "block" : "none";
    document.getElementById("boxWHr").style.display = settings.trackHr ? "block" : "none";
    document.getElementById("boxWWgt").style.display = settings.trackWgt ? "block" : "none";

    hrActive = entry ? (entry.hr != null) : !!settings.incHr;
    document.getElementById("boxWHr").classList.toggle("disabled", !hrActive);

    var latest = getLatestEntry();
    var defaultSys = latest && latest.sys != null ? latest.sys : settings.defSys;
    var defaultDia = latest && latest.dia != null ? latest.dia : settings.defDia;
    var defaultHr  = lastKnown("hr", settings.defHr);
    var defaultWgt = lastKnown("wgt", settings.defWgt);

    wgtActive = entry ? (entry.wgt != null) : !!settings.incWgt;
    document.getElementById("boxWWgt").classList.toggle("disabled", !wgtActive);
    syncOptionalWheels();
    labelWheels();
    weightField.set(entry ? entry.wgt : (wgtActive ? defaultWgt : null));

    // Ostrzeżenie: wpis ma wartość spoza zakresu bębenka – zapis zmieniłby ją po cichu
    if (entry) {
      var sClamped = clampWheelVal(wheelDefs.wSys, entry.sys);
      var dClamped = clampWheelVal(wheelDefs.wDia, entry.dia);
      var hClamped = clampWheelVal(wheelDefs.wHr, entry.hr);
      if ((entry.sys != null && sClamped !== entry.sys) ||
          (entry.dia != null && dClamped !== entry.dia) ||
          (entry.hr != null && hClamped !== entry.hr)) {
        toast("⚠ " + t("wheelClampWarn"));
      }
    }

    setModalState(addOverlay, true);
    setTimeout(function(){
      if (settings.trackSys) wheels.wSys.set(entry ? entry.sys : defaultSys);
      if (settings.trackDia) wheels.wDia.set(entry ? entry.dia : defaultDia);
      if (settings.trackHr) wheels.wHr.set(entry ? (entry.hr || defaultHr) : defaultHr);
    }, 60);
  }

  document.getElementById("btnAdd").onclick = function(){ openAdd(null); };
  addOverlay.addEventListener("click", function(e){ if (e.target === addOverlay) setModalState(addOverlay, false); });
  document.getElementById("btnCancelEntry").onclick = function(){ setModalState(addOverlay, false); };
  document.getElementById("btnDeleteEntryHeader").onclick = function(){ if(editingId) deleteEntryWithUndo(editingId); };

  document.getElementById("btnSave").onclick = function(){
    var wgtVal = (settings.trackWgt && wgtActive) ? weightField.get() : null;
    var hrVal = (settings.trackHr && hrActive) ? wheels.wHr.get() : null;
    var sysVal = settings.trackSys ? wheels.wSys.get() : null;
    var diaVal = settings.trackDia ? wheels.wDia.get() : null;

    var errEl = document.getElementById("bpInlineError");
    if (settings.trackSys && settings.trackDia && sysVal <= diaVal) {
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

    var note = document.getElementById("noteField").value.trim();
    var dtVal = document.getElementById("dtField").value;
    var ts = dtVal ? new Date(dtVal).getTime() : Date.now();
    
    if (editingId){
      var e = entries.find(function(x){ return x.id===editingId; });
      if (e) {
        var updated = { note: note, ts: ts };
        if (settings.trackSys) updated.sys = sysVal;
        if (settings.trackDia) updated.dia = diaVal;
        if (settings.trackHr) updated.hr = hrVal;
        if (settings.trackWgt) updated.wgt = wgtVal;
        Object.assign(e, updated);
      }
      toast("✓ " + t("updatedMsg"));
    } else {
      entries.push({id: makeId(), ts:ts, note:note, sys:sysVal, dia:diaVal, hr:hrVal, wgt:wgtVal});
      toast("✓ " + t("savedMsg"));
    }
    if (!StorageModule.saveEntries(entries)) toast(t("storageError"));
    setModalState(addOverlay, false);
    render();
    requestPersist();
  };

  document.getElementById("btnBackup").onclick = function(){
    openDialog({ title: t("titleBtnBackup"), text: t("privacyAlert"), ok: t("btnExport") }, function(proceed){
    if (!proceed) return;
    var exp = {};
    ["theme","lang","fontSize","trackSys","trackDia","trackHr","trackWgt","incHr","incWgt"]
      .forEach(function(k){ exp[k] = settings[k]; });
    var backupObj = {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      app: "Qardis",
      settings: exp,
      entries: entries
    };
    var blob = new Blob([JSON.stringify(backupObj, null, 2)], {type:"application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    var d = new Date(), p=function(n){return (n<10?"0":"")+n;};
    a.download = "qardis-kopia-"+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
    settings.lastBackupAt = Date.now();     // audyt(3): odmierzaj czas do przypominacza
    StorageModule.saveSettings(settings);
    setModalState(toolsOverlay, false);
    toast("✓ " + t("backupDone"));
    });
  };

  document.getElementById("btnWipe").onclick = function(){
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

  document.getElementById("btnImport").onclick = function(){ document.getElementById("importFile").click(); setModalState(toolsOverlay, false); };

  document.getElementById("importFile").addEventListener("change", function(ev){
    var f = ev.target.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast(t("importError")); ev.target.value = ""; return; }
    openDialog({ title: t("titleBtnImport"), text: t("importConfirm") }, function(proceed){
      if(!proceed){ ev.target.value = ""; return; }
      var r = new FileReader();
    r.onload = function(){
      try{
        var j = JSON.parse(r.result);
        if (!ValidationModule.validateImport(j)) throw new Error("invalid schema or ranges");
        var list = j.entries || j;
        var ids = Object.create(null); entries.forEach(function(e){ ids[e.id]=1; });
        var added = 0, skipped = 0;
        list.forEach(function(e){
          var item = sanitizeEntry(e);
          // Rekordy bez ważnego ts pomijamy jawnie (koniec z cichym Date.now());
          // rekordy z wartościami poza zakresem (np. waga < 20 kg) również –
          // bez utraty danych i bez odrzucania całego pliku.
          if (!item || item.ts === null || lossy(e, item)) { skipped++; return; }
          if (item.sys != null && item.dia != null && item.sys <= item.dia) { skipped++; return; }
          if (!item.id) item.id = makeId();
          if (ids[item.id]) { skipped++; return; }   // duplikat id liczony jako pominięty
          entries.push(item); ids[item.id]=1; added++;
        });
        if (!StorageModule.saveEntries(entries)) toast(t("storageError"));
        render();
        if (j && !Array.isArray(j) && j.settings && typeof j.settings === "object") {
          openDialog({ title: t("settingsTitle"), text: t("importSettingsConfirm") }, function(yes){
          if (!yes) return;
          var keepAsked = settings.persistAsked;
          settings = StorageModule.sanitizeSettings(j.settings);
          settings.persistAsked = keepAsked;
          if (!StorageModule.saveSettings(settings)) toast(t("storageError"));
            applyTheme(); applyLanguage(); applyFontSize(); render();
          });
        }
        toast("✓ " + t("importedMsg")+added+t("importedSuffix")+(skipped ? t("importSkipped")+skipped : ""));
      }catch(err){ toast(t("importError")); }
    };
      r.readAsText(f);
    });
    ev.target.value = "";
  });

  var pdfExportRange = "30";
  var pdfOverlayEl = document.getElementById("pdfRangeOverlay");
  document.getElementById("btnPdf").onclick = function(){
    setModalState(toolsOverlay, false);
    if (!entries.length){ toast(t("noEntriesPdf")); return; }
    setModalState(pdfOverlayEl, true);
  };
  document.getElementById("pdfRange").addEventListener("click", function(e){
    var b = e.target.closest("button[data-range]"); if (!b) return;
    document.querySelectorAll("#pdfRange button").forEach(function(x){ x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
    b.classList.add("active"); b.setAttribute("aria-pressed", "true");
    pdfExportRange = (b.dataset.range === "all") ? "all" : parseInt(b.dataset.range, 10);
  });
  document.getElementById("btnPdfCancel").onclick = function(){ setModalState(pdfOverlayEl, false); };
  pdfOverlayEl.addEventListener("click", function(e){ if (e.target === pdfOverlayEl) setModalState(pdfOverlayEl, false); });
  document.getElementById("btnPdfExport").onclick = function(){
    setModalState(pdfOverlayEl, false);
    exportPdf();
  };
  function exportPdf(){
    var arr = entries.slice().filter(function(e){
      if (pdfExportRange === "all") return true;
      return e.ts >= Date.now() - pdfExportRange * 24 * 60 * 60 * 1000;
    }).sort(function(a,b){ return b.ts-a.ts; });
    if (!arr.length){ toast(t("trendsNoData")); return; }
    var rows = arr.map(function(e){
      var f = fmtDate(e.ts);
      return "<tr><td>"+f.date+" "+f.time+"</td><td>"+escapeHtml(String(e.sys||""))+"</td><td>"+escapeHtml(String(e.dia||""))+"</td><td>"+escapeHtml(String(e.hr||""))+"</td><td>"+escapeHtml(String(e.wgt||""))+"</td><td>"+escapeHtml(e.note||"")+"</td></tr>";
    }).join("");
    var loc = settings.lang === "en" ? "en-US" : "pl-PL";
    var html = '<!doctype html><html lang="'+escapeHtml(settings.lang)+'"><head><meta charset="utf-8"><title>'+escapeHtml(t("pdfTitle"))+'</title><style>'
      +'@page{size:A4 landscape;margin:12mm;}'
      +'body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;}'
      +'h1{font-size:18px;margin:0 0 4px;}p.sub{font-size:11px;color:#555;margin:0 0 16px;}'
      +'table{border-collapse:collapse;width:100%;font-size:12px;}'
      +'th,td{border:1px solid #999;padding:5px 8px;text-align:center;}'
      +'th{background:#eee;}td:first-child{text-align:left;white-space:nowrap;}td:last-child{text-align:left;font-style:italic;}'
      +'thead{display:table-header-group;}tr{page-break-inside:avoid;}'
      +'@media print{p.hint{display:none;}}'
      +'</style></head><body>'
      +'<h1>'+escapeHtml(t("pdfTitle"))+'</h1>'
      +'<p class="sub">'+escapeHtml(t("pdfGen")+new Date().toLocaleString(loc))+'</p>'
      +'<p class="hint">'+escapeHtml(t("pdfHint"))+'</p>'
      +'<table><thead><tr><th>'+escapeHtml(t("pdfHeaderDt"))+'</th><th>'+escapeHtml(t("sysLabel"))+'</th><th>'+escapeHtml(t("diaLabel"))+'</th><th>'+escapeHtml(t("hrLabel"))+'</th><th>'+escapeHtml(t("wgtLabel"))+'</th><th>'+escapeHtml(t("pdfHeaderNotes"))+'</th></tr></thead>'
      +'<tbody>'+rows+'</tbody></table></body></html>';

    var iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);
    var printed = false;
    iframe.onload = function(){
      if (printed) return;
      printed = true;
      setTimeout(function(){
        try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
        catch(err){ toast(t("pdfError")); }
        setTimeout(function(){ iframe.remove(); }, 60000);
      }, 150);
    };
    try {
      iframe.srcdoc = html;
      setTimeout(function(){ if(!printed){ printed = true; toast(t("pdfError")); iframe.remove(); } }, 3000);
    } catch(err){ toast(t("pdfError")); iframe.remove(); }
  }

  var settingsOverlay = document.getElementById("settingsOverlay");
  
  document.getElementById("btnSettingsDock").onclick = function(){
    settingsBefore = Object.assign({}, settings);
    settingsDraft = Object.assign({}, settings);
    
    renderMonitoredButtons();

    applyLanguage(); applyFontSize();
    document.getElementById("themeToggle").classList.toggle("on", settingsDraft.theme === "dark");
    document.getElementById("themeToggle").setAttribute("aria-checked", settingsDraft.theme === "dark" ? "true" : "false");
    setModalState(settingsOverlay, true);
  };

  document.getElementById("monitoredSwitch").addEventListener("click", function(e){
    var btn = e.target.closest("button"); if (!btn) return;
    if (!settingsDraft) return;
    var p = btn.dataset.param;
    var key = 'track' + p.charAt(0).toUpperCase() + p.slice(1);
    settingsDraft[key] = !settingsDraft[key];
    renderMonitoredButtons();
  });

  document.getElementById("langSwitch").addEventListener("click", function(e){
    var btn = e.target.closest("button"); if (!btn) return;
    if(!settingsDraft) return;
    settingsDraft.lang = btn.dataset.val;
    settings.lang = settingsDraft.lang; 
    applyLanguage();
  });

  document.getElementById("fontSizeSwitch").addEventListener("click", function(e){
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
  document.getElementById("btnSetSave").onclick = saveSettings;
  document.getElementById("btnSetCancel").onclick = cancelSettings;

  function toggleThemeDraft(){
    if(!settingsDraft) return;
    settingsDraft.theme = settingsDraft.theme === "dark" ? "light" : "dark";
    settings.theme = settingsDraft.theme;
    this.classList.toggle("on", settingsDraft.theme === "dark");
    this.setAttribute("aria-checked", settingsDraft.theme === "dark" ? "true" : "false");
    applyTheme();
  }
  document.getElementById("themeToggle").onclick = toggleThemeDraft;
  document.getElementById("themeToggle").onkeydown = function(e){
    if(e.key==="Enter" || e.key===" "){e.preventDefault();toggleThemeDraft.call(this);}
  };

  var lastFocusEl = null;
  function setModalState(el, isOpen) {
    var bg = [document.getElementById("viewport"), document.getElementById("dock")];
    if (isOpen) {
      if (!document.querySelector(".overlay.open")) lastFocusEl = document.activeElement;
      el.classList.add("open");
      el.removeAttribute("inert");
      el.setAttribute("aria-hidden", "false");
      bg.forEach(function(b){ b.setAttribute("inert", ""); });
      var sheet = el.querySelector(".sheet");
      if (sheet) {
        sheet.setAttribute("tabindex", "-1");
        setTimeout(function(){ try { sheet.focus({preventScroll:true}); } catch(e){} }, 30);
      }
    } else {
      el.classList.remove("open");
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
      if (!document.querySelector(".overlay.open")) {
        bg.forEach(function(b){ b.removeAttribute("inert"); });
        if (lastFocusEl && document.contains(lastFocusEl) && lastFocusEl.focus) { try { lastFocusEl.focus({preventScroll:true}); } catch(e){} }
        lastFocusEl = null;
      }
    }
  }

  // Audyt(1): arkusz potwierdzeń w stylu aplikacji zamiast systemowych okien
  var dialogEl = document.getElementById("dialogOverlay");
  var dialogCb = null;
  function openDialog(opts, cb){
    document.getElementById("dialogTitle").textContent = opts.title || "";
    document.getElementById("dialogText").textContent = opts.text || "";
    var okBtn = document.getElementById("dialogOk");
    okBtn.textContent = opts.ok || t("btnProceed");
    okBtn.classList.toggle("danger", !!opts.danger);
    document.getElementById("dialogCancel").hidden = !!opts.info;
    dialogCb = cb || null;
    setModalState(dialogEl, true);
  }
  function closeDialog(result){
    setModalState(dialogEl, false);
    var cb = dialogCb; dialogCb = null;
    if (cb) cb(!!result);
  }
  if (dialogEl) {
    document.getElementById("dialogOk").onclick = function(){ closeDialog(true); };
    document.getElementById("dialogCancel").onclick = function(){ closeDialog(false); };
  }

  document.addEventListener("keydown", function(e){
    if (e.key === "Escape"){
      if (dialogEl && dialogEl.classList.contains("open")) closeDialog(false);
      else if (addOverlay.classList.contains("open")) setModalState(addOverlay, false);
      else if (settingsOverlay.classList.contains("open")) cancelSettings();
      else if (toolsOverlay.classList.contains("open")) setModalState(toolsOverlay, false);
      else if (pdfOverlayEl.classList.contains("open")) setModalState(pdfOverlayEl, false);
    }
  });

  var toastEl = null, toastTimers = [];
  var UNDO_MS = 6000;
  var TOAST_CSS = "position:fixed;bottom:calc(90px + env(safe-area-inset-bottom, 0px));left:50%;transform:translateX(-50%);width:max-content;max-width:92vw;text-align:center;line-height:1.4;background:var(--card);color:var(--text);border:1px solid var(--line);padding:10px 18px;border-radius:12px;font-size:.8125rem;font-weight:600;z-index:200;box-shadow:0 8px 24px rgba(0,0,0,0.2);backdrop-filter:blur(8px);transition:opacity .4s;";

  function clearToast(){
    toastTimers.forEach(clearTimeout);
    toastTimers = [];
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }

  // Każdy toast ma własne timery (poprzednie są czyszczone), więc nowy toast nie jest skracany przez stary
  function showToast(el, msg, ms, urgent){
    clearToast();
    toastEl = el;
    document.body.appendChild(el);
    var live = document.getElementById("liveRegion");
    if (live) {
      live.setAttribute("aria-live", urgent ? "assertive" : "polite");
      live.textContent = "";
      setTimeout(function(){ live.textContent = msg; }, 50);
    }
    toastTimers.push(setTimeout(function(){ el.style.opacity = "0"; }, ms));
    toastTimers.push(setTimeout(function(){ if (toastEl === el) { el.remove(); toastEl = null; } }, ms + 500));
  }

  function toast(msg, ms, urgent){
    var el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = TOAST_CSS;
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
    undoBtn.style.cssText = "background:transparent;border:none;color:var(--accent-fg);font-weight:700;font-size:.8125rem;cursor:pointer;margin-left:12px;padding:10px 8px;min-height:44px;";
    undoBtn.onclick = function(){ onUndo(); clearToast(); };
    el.appendChild(undoBtn);

    el.style.cssText = TOAST_CSS + "padding:2px 10px 2px 16px;display:flex;align-items:center;";
    showToast(el, msg + " " + t("btnUndo"), UNDO_MS);
  }

  applyTheme();
  applyLanguage();
  applyFontSize();
  go(0);
  render();
  if (StorageModule.hadIssue()) toast(t("storageCorrupt"), 9000, true);

  // Audyt(2): przycisk eksportu zachowanej kopii uszkodzonych danych w menu
  var btnCorrupt = document.getElementById("btnCorrupt");
  if (btnCorrupt) {
    var corruptData = StorageModule.corruptRaw();
    if (corruptData) {
      btnCorrupt.style.display = "flex";
      btnCorrupt.onclick = function(){
        var blob = new Blob([corruptData], {type:"application/json"});
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        var d = new Date(), p=function(n){return (n<10?"0":"")+n;};
        a.download = "qardis-dane-uszkodzone-"+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+".json";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
        setModalState(toolsOverlay, false);
        toast("✓ " + t("corruptExported"));
      };
    }
  }
  // Audyt(3): przypominacz o kopii zapasowej (30 dni)
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
      var busy = document.getElementById("settingsOverlay").classList.contains("open")
        || document.getElementById("addOverlay").classList.contains("open");
      if (!busy) {
        settings = StorageModule.loadSettings();
        applyTheme(); applyLanguage(); applyFontSize(); render();
      }
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(e){ /* instalacja PWA niedostępna; aplikacja działa online */ });
    });
  }
})();