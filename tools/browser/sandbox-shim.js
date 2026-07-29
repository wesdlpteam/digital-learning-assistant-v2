/* DLA sandbox shim. Appended after all page code so its overrides win.
   Requires matchToolToSuggestion (concatenated ahead of this file).

   Page globals it leans on, all confirmed present in index.html:
     S, gu(), CN, escapeHtml(), loadLeaderboard(), renderTechResult(),
     openTechPicker(), #techModalBody, #techGrid, .tech-tile[data-tool],
     .tech-meta, button[onclick*="regenTechResultFromOverlay"] */
(function () {
  var FAKE_THINK_MS = 700;

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
      '.tech-tile.sandbox-ready::after{content:" \\2713";color:#4CAF50;font-weight:700;margin-left:6px}';
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
  function currentUnitSuggestions() {
    try {
      // S, CN, CM and D are declared const/let in index.html, so they live in
      // the global LEXICAL scope and are NOT properties of window. Reach them
      // by bare name (visible across classic script tags), never as window.S.
      // The functions we override are function declarations, so those ARE on
      // window and can be reassigned.
      if (typeof S === 'undefined' || S.ca == null || S.yl == null || S.ui == null) return [];
      // gu() expects the campus CODE (S.ca is already 'EL'/'GW'/'SKR'), the
      // same way index.html calls it. Do not translate through CN here.
      var units = gu(S.ca, S.yl);
      var unit = units && units[S.ui];
      return (unit && unit.s) || [];
    } catch (e) { return []; }
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

  // ---- picker result: ready-made idea or an honest fallback --------------
  window.fetchTechSuggestion = function (campus, yl, theme, tool) {
    var suggestions = currentUnitSuggestions();
    var hit = matchToolToSuggestion(tool, suggestions);
    setTimeout(function () {
      if (hit) {
        // Stored ideas are {t,d} only. Do not invent steps, valueAdd or fit.
        renderTechResult(campus, yl, theme, tool, {
          description: hit.d,
          sandboxReadyMade: true,
          sandboxActivityName: hit.t
        });
        return;
      }
      renderTechResult(campus, yl, theme, tool, {
        sandboxNoMatch: true,
        sandboxAlternatives: suggestions.slice(0, 6)
      });
    }, FAKE_THINK_MS);
  };

  var _realRenderTechResult = window.renderTechResult;
  window.renderTechResult = function (campus, yl, theme, tool, resp) {
    var body = document.getElementById('techModalBody');

    if (resp && resp.sandboxNoMatch && body) {
      var overlay = document.getElementById('techOverlay');
      var d = (overlay && overlay.dataset) || {};
      var args = [d.campus || campus, d.yl || yl, d.theme || theme, d.ci || '', d.lo || '']
        .map(encodeURIComponent).map(function (v) { return "'" + v + "'"; }).join(',');
      var list = (resp.sandboxAlternatives || []).map(function (s) {
        return '<li style="margin:8px 0">' + escapeHtml(s.t) + '</li>';
      }).join('');
      body.innerHTML =
        '<div style="padding:4px 2px">' +
          '<p style="margin:0 0 12px"><strong>' + escapeHtml(tool) + '</strong> is not one of the ready-made ideas for this unit.</p>' +
          '<p style="margin:0 0 12px">On the live DLA this is where it writes you a fresh idea in about ten seconds. ' +
          'This demo copy shows the ready-made ideas instead, so nothing is generated on the day.</p>' +
          (list ? '<p style="margin:0 0 6px"><strong>Ready-made ideas for this unit:</strong></p>' +
                  '<ul style="margin:0;padding-left:20px">' + list + '</ul>' : '') +
        '</div>' +
        '<div class="tech-actions">' +
          '<button class="tech-btn primary" onclick="openTechPicker(' + args + ')">← Choose another tool</button>' +
          '<button class="tech-btn" onclick="closeTech()">Done</button>' +
        '</div>' +
        '<div class="tech-meta">Sandbox demo — nothing is generated here</div>';
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
