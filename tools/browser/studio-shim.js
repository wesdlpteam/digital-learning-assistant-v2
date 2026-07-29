/* DLA Studio sandbox shim. Appended after all nine js/ files so its overrides win.
 *
 * Page globals it leans on (all verified in the real Studio):
 *   ingest(arr, skipCache)      js/02-ui-load-navigation.js:203  — sets DATA, rebuilds filters
 *   showApp()                   js/02:16                          — reveals #app-content
 *   loadLiveAnalytics()         js/09-legacy-restored.js:1199     — the single analytics entry
 *   DRIVE_TOKEN / DRIVE_FILE_ID js/00:37,39  — `let`, so assignable by bare name
 *   DATA                        js/00:1      — `let`, lexical, NOT window.DATA
 *
 * The functions we override (readMultipleRanges, readSheetRange,
 * getAnalyticsSheetTz) are plain function declarations, so they DO live on
 * window and can be reassigned from here.
 */
(function () {
  var BADGE_TEXT = 'Sandbox demo — not live data';
  var SAMPLE_TEXT = 'Sample data — demonstration only';
  var OFF_NOTE = 'Turned off in this demo';

  var ANALYTICS = null;

  // ---- 1. Timestamps -----------------------------------------------------
  // Sample rows carry "@-<days>d<HH>:<MM>" instead of a baked date, so the
  // dashboard's rolling 7/14/30-day windows always contain data no matter when
  // the demo is opened. Resolve them against today at load time.
  var SENTINEL = /^@-(\d+)d(\d{2}):(\d{2})$/;
  function resolveStamp(value) {
    var m = SENTINEL.exec(String(value));
    if (!m) return value;
    var d = new Date();
    d.setDate(d.getDate() - Number(m[1]));
    d.setHours(Number(m[2]), Number(m[3]), 0, 0);
    return d.toISOString();
  }
  function resolveRows(rows) {
    return (rows || []).map(function (row, i) {
      if (i === 0 || !Array.isArray(row)) return row;   // header
      return row.map(function (cell) { return resolveStamp(cell); });
    });
  }

  // ---- 2. Fake session ---------------------------------------------------
  // Every Drive/backend path is gated on `if(!DRIVE_TOKEN) return`. Give it a
  // sentinel so the UI behaves as signed in. Nothing can actually go out: the
  // guard blocks all cross-origin requests.
  try { DRIVE_TOKEN = 'sandbox-demo-token'; } catch (e) {}
  try { DRIVE_FILE_ID = 'sandbox-demo-file'; } catch (e) {}
  try { CURRENT_USER_EMAIL = 'demo@wesleycollege.edu.au'; } catch (e) {}

  // js/08's init waits forever for window.google.accounts before its silent
  // re-auth. Satisfy the wait with a stub that never prompts, so the poll stops.
  window.google = window.google || {};
  window.google.accounts = window.google.accounts || {
    oauth2: {
      initTokenClient: function () {
        return { requestAccessToken: function () { /* sandbox: no sign-in */ } };
      }
    },
    id: { initialize: function () {}, prompt: function () {}, renderButton: function () {} }
  };

  // ---- 3. Analytics: read from the local sample file, never Sheets --------
  window.getAnalyticsSheetTz = function () { return Promise.resolve('Australia/Melbourne'); };
  window.readSheetRange = function (range) {
    return Promise.resolve(ANALYTICS && ANALYTICS[range] ? ANALYTICS[range] : []);
  };
  window.readMultipleRanges = function (ranges) {
    return Promise.resolve((ranges || []).map(function (r) {
      return ANALYTICS && ANALYTICS[r] ? ANALYTICS[r] : [];
    }));
  };

  // ---- 4. Styles ---------------------------------------------------------
  function addStyles() {
    var css = document.createElement('style');
    css.textContent =
      '#sandboxBadge{position:fixed;left:12px;bottom:12px;z-index:99999;background:#1b1b1f;color:#fff;' +
      'font:600 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;padding:8px 12px;border-radius:999px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none;opacity:.92}' +
      '.sandbox-sample-note{display:block;margin:0 0 14px;padding:8px 14px;border-radius:8px;' +
      'background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.45);color:#fbbf24;' +
      'font:700 12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.02em}' +
      '.sandbox-off{opacity:.45;cursor:not-allowed!important;position:relative}' +
      '.sandbox-off-note{font-size:11px;color:#888;margin-left:8px;font-weight:600}' +
      // Tool Inventory whitelist should use the full content width
      '#panel-inventory .lib-list,#panel-inventory .tool-list,#panel-inventory table,' +
      '#panel-inventory .card{width:100%;max-width:none!important}' +
      '#panel-inventory .card{box-sizing:border-box}';
    document.head.appendChild(css);
  }

  function addBadge() {
    if (document.getElementById('sandboxBadge')) return;
    var el = document.createElement('div');
    el.id = 'sandboxBadge';
    el.textContent = BADGE_TEXT;
    document.body.appendChild(el);
  }

  // ---- 5. Removals, disabling and honesty labels -------------------------
  // Controls that generate, save, sync or push. Everything stays visible so the
  // audience can see the capability; nothing is clickable.
  var WRITE_CONTROL_IDS = [
    'btn-drive', 'btn-seed-kinder', 'btn-add-queue', 'btn-bulk-reset', 'btn-bulk-voice',
    'btn-bulk-chat-send', 'btn-full-realism-audit', 'btn-surgeon', 'btn-refresh-live',
    'btn-ai-summary', 'btn-regen-all', 'btn-entry-realism-scan', 'btn-score-quality'
  ];
  var WRITE_ONCLICK = /loadFromDrive|seedKinderYearGroups|addToGASQueue|runSurgeon|runTwistSweep|startSuggestionAudit|regenAll|generateAISummary|loadLiveAnalytics|createManualSnapshot|savePlaybookFromChat|pullLibrariesFromGitHub|refreshLibrariesFromDrive|showAddLibraryDialog|libImportAllTrigger|clearSession|forceLatestVersion|showBackendScreen|runFullRealismAudit|scanCurrentEntryRealism|scoreEntryQuality|bulkChatSend|bulkChatReset|toggleBulkVoice|inspireAll|rebootMakerspace|runBulk|Surgeon/i;

  // Sections Nathan asked to remove, keyed by a button inside the card.
  var REMOVE_CARD_BY_BTN_ID = ['btn-twist-sweep', 'btn-suggestion-audit'];
  // Controls created at runtime, so matched by their visible label.
  var REMOVE_BY_TEXT = [/inspire all/i, /sweep app smash/i, /makerspace/i];

  function disable(el) {
    if (!el || el.dataset.sandboxOff) return;
    el.dataset.sandboxOff = '1';
    el.classList.add('sandbox-off');
    el.setAttribute('aria-disabled', 'true');
    el.removeAttribute('onclick');
    el.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); }, true);
    if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') el.disabled = true;
    if (!el.parentNode || el.parentNode.querySelector('.sandbox-off-note')) return;
    var note = document.createElement('span');
    note.className = 'sandbox-off-note';
    note.textContent = OFF_NOTE;
    el.insertAdjacentElement('afterend', note);
  }

  function sweep() {
    // a. remove the two named Bulk cards
    REMOVE_CARD_BY_BTN_ID.forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      var card = btn.closest ? btn.closest('.card') : null;
      (card || btn).remove();
    });

    // b. remove runtime-created controls by label, plus their card when it is
    //    left with nothing else to do
    var clickable = document.querySelectorAll('button, a.btn, .btn, .btn-pri, .btn-sec');
    Array.prototype.forEach.call(clickable, function (el) {
      var label = (el.textContent || '').trim();
      if (!label) return;
      if (REMOVE_BY_TEXT.some(function (re) { return re.test(label); })) {
        var card = el.closest ? el.closest('.card') : null;
        if (card && card.querySelectorAll('button, .btn, .btn-pri').length <= 1) card.remove();
        else el.remove();
      }
    });

    // c. disable every remaining write control
    WRITE_CONTROL_IDS.forEach(function (id) { disable(document.getElementById(id)); });
    var all = document.querySelectorAll('button, input[type=submit]');
    Array.prototype.forEach.call(all, function (el) {
      var oc = el.getAttribute('onclick') || '';
      if (oc && WRITE_ONCLICK.test(oc)) disable(el);
    });

    // d. sample-data labels on anything showing numbers
    ['panel-live', 'panel-analytics', 'panel-dashboard', 'live-content', 'screen-dashboard']
      .forEach(function (id) {
        var host = document.getElementById(id);
        if (!host || host.querySelector(':scope > .sandbox-sample-note')) return;
        var note = document.createElement('div');
        note.className = 'sandbox-sample-note';
        note.textContent = SAMPLE_TEXT;
        host.insertBefore(note, host.firstChild);
      });
  }

  // ---- 6. Boot -----------------------------------------------------------
  function boot() {
    addStyles();
    addBadge();

    Promise.all([
      fetch('studio-data.json', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch('studio-analytics.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
    ]).then(function (both) {
      var units = both[0];
      var raw = both[1];
      ANALYTICS = {};
      Object.keys(raw).forEach(function (range) { ANALYTICS[range] = resolveRows(raw[range]); });

      ingest(units, true);
      showApp();
      sweep();

      if (typeof loadLiveAnalytics === 'function') {
        loadLiveAnalytics().catch(function (e) {
          if (window.console) console.warn('[sandbox] analytics render issue:', e && e.message);
        });
      }

      // Tabs render lazily, so keep sweeping as panels appear.
      new MutationObserver(function () { sweep(); })
        .observe(document.body, { childList: true, subtree: true });
    }).catch(function (err) {
      if (window.console) console.error('[sandbox] studio boot failed:', err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
