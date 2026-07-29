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

  // ---- 2b. Silence the dead Drive paths ----------------------------------
  // js/08's init starts a conflict-polling timer that asks Drive for the file's
  // modifiedTime every few seconds. The guard blocks every one of those, so
  // nothing leaves the device, but it fills the console and serves no purpose
  // in a demo. Neuter the callers rather than relying on the guard alone.
  window.getDriveFileModified = function () { return Promise.resolve(null); };
  window.startConflictPolling = function () { /* sandbox: no Drive to poll */ };
  window.reloadFromDrive = function () { return Promise.resolve(); };
  window.loadUoiProposals = function () { return Promise.resolve([]); };

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
      // Tool Inventory whitelist fills the content width. It lives in
      // #panel-tools as #inv-whitelist-pills, inside a two-column grid that
      // pins it to a ~531px column. Collapse that grid to one column so the
      // pills run the full width and the neighbouring block stacks underneath.
      '#panel-tools div:has(> div > #inv-whitelist-pills){grid-template-columns:1fr!important}' +
      '#panel-tools div:has(> #inv-whitelist-pills){grid-column:1/-1!important;width:100%}' +
      '#inv-whitelist-pills{display:flex;flex-wrap:wrap;gap:8px;width:100%;max-width:none!important}' +
      '#inv-whitelist-pills > *{flex:0 0 auto}';
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
    'btn-drive', 'btn-add-queue', 'btn-bulk-reset', 'btn-bulk-voice',
    'btn-bulk-chat-send', 'btn-full-realism-audit', 'btn-surgeon', 'btn-refresh-live',
    'btn-ai-summary', 'btn-regen-all', 'btn-entry-realism-scan', 'btn-score-quality'
  ];
  var WRITE_ONCLICK = /loadFromDrive|seedKinderYearGroups|addToGASQueue|runSurgeon|runTwistSweep|startSuggestionAudit|regenAll|generateAISummary|loadLiveAnalytics|createManualSnapshot|savePlaybookFromChat|pullLibrariesFromGitHub|refreshLibrariesFromDrive|showAddLibraryDialog|libImportAllTrigger|clearSession|forceLatestVersion|showBackendScreen|runFullRealismAudit|scanCurrentEntryRealism|scoreEntryQuality|bulkChatSend|bulkChatReset|toggleBulkVoice|inspireAll|rebootMakerspace|runBulk|Surgeon/i;

  // Sections Nathan asked to remove, keyed by a button inside the card.
  // btn-seed-kinder is the dashboard's "Kinder year groups" one-time setup card;
  // Kinder is gone from the demo corpus entirely, so the card has nothing to
  // refer to.
  var REMOVE_CARD_BY_BTN_ID = ['btn-twist-sweep', 'btn-suggestion-audit', 'btn-seed-kinder'];
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

    // b2. some of these are not controls at all — the Makerspace reboot shows up
    //     on Browse as a plain status line ("126/127 projects rebooted"). Remove
    //     the whole card it sits in.
    var blocks = document.querySelectorAll('.card, .card2');
    Array.prototype.forEach.call(blocks, function (el) {
      var text = (el.textContent || '');
      if (!text) return;
      if (REMOVE_BY_TEXT.some(function (re) { return re.test(text); })) {
        var card = el.closest ? (el.closest('.card') || el) : el;
        card.remove();
      }
    });

    // b3. Kinder is gone from the demo corpus, but the year-level pickers are
    //     built from a hardcoded list, not from DATA. Strip it there too so no
    //     screen offers a year group that no longer exists.
    var opts = document.querySelectorAll('option');
    Array.prototype.forEach.call(opts, function (o) {
      if (/kinder/i.test(o.textContent || '') || /kinder/i.test(o.value || '')) o.remove();
    });
    var labels = document.querySelectorAll('label, .pill, .chip, .age-range, [data-year]');
    Array.prototype.forEach.call(labels, function (el) {
      var t = (el.textContent || '').trim();
      if (/^\s*\d\s*year\s*old\s*kinder\s*$/i.test(t)) el.remove();
    });

    // c. disable every remaining write control
    WRITE_CONTROL_IDS.forEach(function (id) { disable(document.getElementById(id)); });
    var all = document.querySelectorAll('button, input[type=submit]');
    Array.prototype.forEach.call(all, function (el) {
      var oc = el.getAttribute('onclick') || '';
      if (oc && WRITE_ONCLICK.test(oc)) disable(el);
    });

    // d. sample-data label at the top of each numbers panel. Only the outermost
    //    host per panel — live-content sits inside panel-live, and labelling
    //    both stacks two identical banners.
    ['panel-live', 'panel-dashboard'].forEach(function (id) {
      var host = document.getElementById(id);
      if (!host || host.querySelector('.sandbox-sample-note')) return;
      var note = document.createElement('div');
      note.className = 'sandbox-sample-note';
      note.textContent = SAMPLE_TEXT;
      host.insertBefore(note, host.firstChild);
    });
  }

  // ---- 6. Charts on hidden tabs -----------------------------------------
  // loadLiveAnalytics() runs while the Analytics panel is still hidden, so
  // ECharts measures its containers at 0px and draws nothing. Re-measure after
  // any tab switch, once the panel actually has a size.
  function resizeCharts() {
    if (!window.echarts || !echarts.getInstanceByDom) return;
    var candidates = document.querySelectorAll('[id^="live-"], .chart, [class*="chart"]');
    Array.prototype.forEach.call(candidates, function (el) {
      try {
        var inst = echarts.getInstanceByDom(el);
        if (inst) inst.resize();
      } catch (e) { /* not a chart host */ }
    });
  }

  // ---- 6b. Trim empty leading buckets off the growth chart ---------------
  // renderGrowthChart_eChart hardcodes 12 buckets for the Month view
  // (js/04-audit-analytics-live.js:753) regardless of how much data exists. The
  // demo's history starts in May, so Month drew nine blank months first, which
  // reads as "nobody used this for most of a year". Drop the leading buckets
  // where every series is zero, so the axis begins where the data does.
  function trimEmptyGrowthBuckets() {
    if (!window.echarts || !echarts.getInstanceByDom) return;
    var host = document.getElementById('live-growth-chart');
    if (!host) return;
    var inst;
    try { inst = echarts.getInstanceByDom(host); } catch (e) { return; }
    if (!inst) return;

    var opt;
    try { opt = inst.getOption(); } catch (e) { return; }
    if (!opt || !opt.xAxis || !opt.xAxis[0] || !Array.isArray(opt.xAxis[0].data)) return;
    var series = (opt.series || []).filter(function (s) { return Array.isArray(s.data); });
    if (!series.length) return;

    var categories = opt.xAxis[0].data;
    var value = function (v) {
      if (v && typeof v === 'object') v = v.value;
      return Number(v) || 0;
    };
    var firstWithData = -1;
    for (var i = 0; i < categories.length; i++) {
      var any = series.some(function (s) { return value(s.data[i]) > 0; });
      if (any) { firstWithData = i; break; }
    }
    // nothing to trim, no data at all, or it would leave too little to plot
    if (firstWithData <= 0) return;
    if (categories.length - firstWithData < 2) return;

    opt.xAxis[0].data = categories.slice(firstWithData);
    opt.series.forEach(function (s) {
      if (Array.isArray(s.data)) s.data = s.data.slice(firstWithData);
    });
    try { inst.setOption(opt, true); } catch (e) { /* leave the chart as drawn */ }
  }

  var _realRenderLiveGrowth = window.renderLiveGrowth;
  if (typeof _realRenderLiveGrowth === 'function') {
    window.renderLiveGrowth = function () {
      var result = _realRenderLiveGrowth.apply(this, arguments);
      setTimeout(trimEmptyGrowthBuckets, 40);
      return result;
    };
  }

  // Both levels of navigation hide their panels with display:none, so a chart
  // can be laid out at 0px twice over: once for the tab, once for the
  // Analytics sub-tab (.analytics-subpanel, driven by setAnalyticsSubtab).
  function afterNav() {
    setTimeout(function () { sweep(); resizeCharts(); }, 60);
    setTimeout(function () { resizeCharts(); trimEmptyGrowthBuckets(); }, 260);
    setTimeout(function () { resizeCharts(); trimEmptyGrowthBuckets(); }, 700);
  }
  ['switchTab', 'setAnalyticsSubtab'].forEach(function (name) {
    var real = window[name];
    if (typeof real !== 'function') return;
    window[name] = function () {
      var result = real.apply(this, arguments);
      afterNav();
      return result;
    };
  });
  window.addEventListener('resize', function () { setTimeout(resizeCharts, 120); });

  // ---- 7. Boot -----------------------------------------------------------
  function boot() {
    addStyles();
    addBadge();

    Promise.all([
      fetch('studio-data.json', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch('studio-analytics.json', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch('libraries.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
    ]).then(function (both) {
      var units = both[0];
      var raw = both[1];
      var libs = both[2];

      // The Tool Inventory normally arrives with libraries.json from Drive.
      // Without this the whitelist shows a single seeded entry instead of the
      // real approved list.
      try {
        if (typeof loadToolInventoryFromMeta === 'function' && libs && libs._meta) {
          loadToolInventoryFromMeta(libs._meta);
          if (typeof LIBRARIES !== 'undefined') LIBRARIES = libs;
          if (typeof renderToolInventory === 'function') renderToolInventory();
        }
      } catch (e) {
        if (window.console) console.warn('[sandbox] tool inventory seed failed:', e && e.message);
      }
      ANALYTICS = {};
      Object.keys(raw).forEach(function (range) { ANALYTICS[range] = resolveRows(raw[range]); });

      ingest(units, true);
      showApp();
      sweep();

      // The demo's own loading note replaces the Studio's "Connect Google Drive
      // to load your data.json" screen, which is hidden from first paint. Clear
      // it now that the real UI is up.
      var loading = document.getElementById('sandbox-loading');
      if (loading) loading.remove();

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
