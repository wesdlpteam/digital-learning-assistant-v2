/* DLA sandbox shim. Appended after all page code so its overrides win.
   Requires matchToolToSuggestion (concatenated ahead of this file).

   Page globals it leans on, all confirmed present in index.html:
     S, gu(), CN, TC, TE, escapeHtml(), linkifyDesc(), loadLeaderboard(),
     renderTechResult(), openTechPicker(), #techModalBody, #techGrid,
     .tech-tile[data-tool], .tech-meta,
     button[onclick*="regenTechResultFromOverlay"] */
(function () {
  var FAKE_THINK_MS = 700;
  var EXTRA_IDEAS_URL = 'sandbox-extra-ideas.json';

  // ---- styles -------------------------------------------------------------
  function addStyles() {
    var css = document.createElement('style');
    css.textContent =
      '#sandboxBadge{position:fixed;left:12px;bottom:12px;z-index:99999;background:#1b1b1f;color:#fff;' +
      'font:600 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;padding:8px 12px;border-radius:999px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none;opacity:.92;max-width:calc(100vw - 24px)}' +
      '@media(max-width:430px){#sandboxBadge{font-size:11px;padding:6px 10px;left:8px;bottom:8px}}' +
      // nothing to regenerate in a demo, so hide every regen control
      'button[onclick*="regenTechResultFromOverlay"]{display:none!important}' +
      // tools that have a ready-made idea for the unit you are on
      '.tech-tile.sandbox-ready{outline:2px solid #4CAF50;outline-offset:-2px}' +
      '.tech-tile.sandbox-ready::after{content:" \\2713";color:#4CAF50;font-weight:700;margin-left:6px}' +
      // the "here are five others" panel
      '.sandbox-alt-intro{margin:0 0 14px;color:#BBB;font-size:14px;line-height:1.5}' +
      '.sandbox-alt-intro strong{color:#FFF}' +
      '.sandbox-alt-count{margin:0 0 10px;color:#888;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}' +
      '.sandbox-alt .sg{margin-bottom:12px}';
    document.head.appendChild(css);
  }

  function addBadge() {
    if (document.getElementById('sandboxBadge')) return;
    var el = document.createElement('div');
    el.id = 'sandboxBadge';
    el.textContent = 'Sandbox demo — not live data';
    document.body.appendChild(el);
  }

  // ---- the unit currently on screen --------------------------------------
  function currentUnit() {
    try {
      // S, CN, CM and D are declared const/let in index.html, so they live in
      // the global LEXICAL scope and are NOT properties of window. Reach them
      // by bare name (visible across classic script tags), never as window.S.
      // The functions we override are function declarations, so those ARE on
      // window and can be reassigned.
      if (typeof S === 'undefined' || S.ca == null || S.yl == null || S.ui == null) return null;
      // gu() expects the campus CODE (S.ca is already 'EL'/'GW'/'SKR'), the
      // same way index.html calls it. Do not translate through CN here.
      var units = gu(S.ca, S.yl);
      return (units && units[S.ui]) || null;
    } catch (e) { return null; }
  }

  function currentUnitSuggestions() {
    var unit = currentUnit();
    return (unit && unit.s) || [];
  }

  // ---- leaderboard: frozen snapshot, never the network -------------------
  var _snapshot = null;
  window.fetchLeaderboard = function () {
    if (_snapshot) return Promise.resolve(_snapshot);
    return fetch('demo-leaderboard.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { _snapshot = rows; return rows; })
      .catch(function () { _snapshot = []; return []; });
  };

  // ---- the pre-written "other tools for this unit" ideas ------------------
  // Written at build time by tools/gen-sandbox-extra-ideas.mjs, one small batch
  // per unit, each idea using an approved tool the unit's own six don't use.
  // Fetched lazily on the first dead-end so it never slows the first page load.
  var _extrasPromise = null;
  function loadExtraIdeas() {
    if (!_extrasPromise) {
      _extrasPromise = fetch(EXTRA_IDEAS_URL, { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return _extrasPromise;
  }

  function extraIdeasFor(unit) {
    if (!unit) return Promise.resolve([]);
    var key = [unit.ca, unit.yl, unit.th].join('|');
    return loadExtraIdeas().then(function (byUnit) {
      var list = byUnit && byUnit[key];
      return Array.isArray(list) ? list : [];
    });
  }

  // ---- picker: float the tools that actually have a ready-made idea ------
  // Only ~9% of (unit, tool) pairs have a stored idea, so without this most
  // taps land on the fallback. Marking and floating the ones that work makes
  // the demo land without hiding anything.
  var _realOpenTechPicker = window.openTechPicker;
  if (typeof _realOpenTechPicker === 'function') {
    window.openTechPicker = function () {
      var result = _realOpenTechPicker.apply(this, arguments);
      try {
        var grid = document.getElementById('techGrid');
        if (!grid) return result;
        var suggestions = currentUnitSuggestions();
        if (!suggestions.length) return result;
        var tiles = grid.querySelectorAll('.tech-tile');
        var ready = [];
        for (var i = 0; i < tiles.length; i++) {
          var tool = tiles[i].getAttribute('data-tool') || '';
          if (matchToolToSuggestion(tool, suggestions)) {
            tiles[i].classList.add('sandbox-ready');
            tiles[i].title = 'Has a ready-made idea for this unit';
            ready.push(tiles[i]);
          }
        }
        for (var j = ready.length - 1; j >= 0; j--) grid.insertBefore(ready[j], grid.firstChild);
      } catch (e) { /* presentation sugar only, never break the picker */ }
      return result;
    };
  }

  // ---- picker result: ready-made idea, or five others for this unit -------
  window.fetchTechSuggestion = function (campus, yl, theme, tool) {
    var suggestions = currentUnitSuggestions();
    var hit = matchToolToSuggestion(tool, suggestions);
    if (hit) {
      setTimeout(function () {
        // Stored ideas are {t,d} only. Do not invent steps, valueAdd or fit.
        renderTechResult(campus, yl, theme, tool, {
          description: hit.d,
          sandboxReadyMade: true,
          sandboxActivityName: hit.t
        });
      }, FAKE_THINK_MS);
      return;
    }
    // No ready-made idea for this tool. Show the five that were written ahead
    // of time for this unit instead. Keep the fake think time so the demo still
    // feels like the live site even when the file is already cached.
    var started = Date.now();
    extraIdeasFor(currentUnit()).then(function (extras) {
      setTimeout(function () {
        renderTechResult(campus, yl, theme, tool, {
          sandboxNoMatch: true,
          sandboxExtras: extras,
          sandboxAlternatives: suggestions.slice(0, 6)
        });
      }, Math.max(0, FAKE_THINK_MS - (Date.now() - started)));
    });
  };

  // TC and TE are top-level `const` in index.html, so like S they live in the
  // global lexical scope and are NOT window properties. Read them by bare name.
  function themeColour(theme) {
    try { return (typeof TC !== 'undefined' && TC[theme]) || '#888'; } catch (e) { return '#888'; }
  }
  function themeEmoji(theme) {
    try { return (typeof TE !== 'undefined' && TE[theme]) || '💡'; } catch (e) { return '💡'; }
  }

  function ideaCardHtml(idea, theme) {
    var tc = themeColour(theme);
    var em = themeEmoji(theme);
    var desc = (typeof linkifyDesc === 'function') ? linkifyDesc(idea.d) : escapeHtml(idea.d);
    return '<div class="sg">' +
      '<div class="sg-head"><div class="sg-icon" style="background:' + tc + '">' + em + '</div>' +
        '<div class="sg-meta"><div class="sg-type">Another idea for this unit</div>' +
        '<div class="sg-tool">' + escapeHtml(idea.t) + '</div></div></div>' +
      '<div class="sg-body"><div class="sg-desc">' + desc + '</div></div>' +
      '</div>';
  }

  var _realRenderTechResult = window.renderTechResult;
  window.renderTechResult = function (campus, yl, theme, tool, resp) {
    var body = document.getElementById('techModalBody');

    if (resp && resp.sandboxNoMatch && body) {
      var overlay = document.getElementById('techOverlay');
      var d = (overlay && overlay.dataset) || {};
      var args = [d.campus || campus, d.yl || yl, d.theme || theme, d.ci || '', d.lo || '']
        .map(encodeURIComponent).map(function (v) { return "'" + v + "'"; }).join(',');
      var extras = resp.sandboxExtras || [];
      var main;
      if (extras.length) {
        main =
          '<p class="sandbox-alt-intro">There is no ready-made idea for <strong>' + escapeHtml(tool) + '</strong> in this unit. ' +
            'On the live DLA this is where it writes you a fresh one for ' + escapeHtml(tool) + ' in about ten seconds. ' +
            'This demo copy generates nothing on the day, so here are ' + extras.length + ' other ideas for this unit instead.</p>' +
          '<div class="sandbox-alt-count">' + extras.length + ' more ideas for ' + escapeHtml(yl) + ' · ' + escapeHtml(theme) + '</div>' +
          '<div class="sandbox-alt">' + extras.map(function (idea) { return ideaCardHtml(idea, theme); }).join('') + '</div>';
      } else {
        // No pre-written batch for this unit (a new unit added since the last
        // build). Fall back to naming the unit's own ready-made ideas.
        var list = (resp.sandboxAlternatives || []).map(function (s) {
          return '<li style="margin:8px 0">' + escapeHtml(s.t) + '</li>';
        }).join('');
        main =
          '<p class="sandbox-alt-intro">There is no ready-made idea for <strong>' + escapeHtml(tool) + '</strong> in this unit, ' +
            'and this demo copy generates nothing on the day.</p>' +
          (list ? '<p style="margin:0 0 6px"><strong>Ready-made ideas for this unit:</strong></p>' +
                  '<ul style="margin:0 0 4px;padding-left:20px">' + list + '</ul>' : '');
      }
      body.innerHTML =
        '<div style="padding:4px 2px">' + main + '</div>' +
        '<div class="tech-actions">' +
          '<button class="tech-btn primary" onclick="openTechPicker(' + args + ')">← Choose another tool</button>' +
          '<button class="tech-btn" onclick="closeTech()">Done</button>' +
        '</div>' +
        '<div class="tech-meta">Sandbox demo — these were written ahead of time, nothing is generated here</div>';
      return;
    }

    var result = _realRenderTechResult.apply(this, arguments);

    if (resp && resp.sandboxReadyMade && body) {
      // The real renderer stamps "Fresh suggestion - just now", which is not
      // true here. Say what actually happened.
      var meta = body.querySelector('.tech-meta');
      if (meta) {
        meta.textContent = 'Ready-made idea for this unit: ' + resp.sandboxActivityName +
          ' · sandbox demo, nothing generated';
      }
    }
    return result;
  };

  // ---- boot ---------------------------------------------------------------
  function boot() {
    addStyles();
    addBadge();
    if (typeof loadLeaderboard === 'function') loadLeaderboard(true);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
