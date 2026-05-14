/**
 * DLA Feedback Web App — v2.0
 *
 * One Apps Script project, one deployment. Deploy as Web App with:
 *   • Execute as:  Me
 *   • Who has access:  Anyone
 *
 * Routes events by `body.type`:
 *   used             → Used sheet, then recompute Leaderboard
 *   unused           → removes most recent matching Used row (toggle off), recomputes Leaderboard
 *   reaction         → Reactions sheet (server-side debounce: 5s same-context window)
 *   analytics_batch  → Analytics sheet (one row per event in batch)
 *   feedback         → Feedback sheet (REFUSES empty feedback text)
 *
 * GET ?action=leaderboard&callback=foo  → JSONP leaderboard payload
 *
 * ── 6-column Analytics layout (matches Dashboard formulas) ──
 *   A Timestamp | B Session | C Page | D Campus | E Year Level | F Time Spent (seconds)
 */

// ─── Config ────────────────────────────────────────────────────────────
const SHEET_ID = '1R4P4FJlc8SyRFlVWoM0HpHmfCNMNVOpI8cuEILFxBNY';

const SHEETS = {
  USED:        'Used',
  FEEDBACK:    'Feedback',
  REACTIONS:   'Reactions',
  ANALYTICS:   'Analytics',
  LEADERBOARD: 'Leaderboard',
  ERRORS:      'Errors'
};

// Headers — used both to validate sheets at startup and to repair a missing/wrong header row.
const HEADERS = {
  Used:        ['Timestamp','Team','Campus','Year Level','Theme','Tool','Phase'],
  Feedback:    ['Timestamp','Campus','Year Level','Theme','Tool','Phase','Feedback'],
  Reactions:   ['Timestamp','Campus','Year Level','Theme','Tool','Phase','Reaction'],
  Analytics:   ['Timestamp','Session','Page','Campus','Year Level','Time Spent (seconds)'],
  Leaderboard: ['Campus','Year','Points','Streaks','LastTheme','LastTool','StreakCount'],
  Errors:      ['Timestamp','Reason','Type','Body','Raw']
};

const REACTION_DEBOUNCE_MS = 5000;
const POINTS_PER_USED      = 1;
const POINTS_PER_STREAK    = 3;
const STREAK_USES_REQUIRED = 3; // Bonus fires when a team logs this many uses in one unit.

// ─── HTTP entry points ─────────────────────────────────────────────────

function doPost(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(err) {
    return jsonResponse_({ error: 'Could not acquire lock' });
  }
  try {
    const raw  = (e && e.postData && e.postData.contents) || '';
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch (_) { body = {}; }

    const type = String(body.type || '').toLowerCase().trim();
    const ss   = SpreadsheetApp.openById(SHEET_ID);

    if (type === 'used') {
      handleUsed_(ss, body);
    } else if (type === 'unused') {
      handleUnused_(ss, body);
    } else if (type === 'reaction') {
      handleReaction_(ss, body);
    } else if (type === 'analytics_batch') {
      handleAnalyticsBatch_(ss, body);
    } else if (type === 'feedback') {
      handleFeedback_(ss, body);
    } else if (!type && typeof body.feedback === 'string' && body.feedback.trim()) {
      // Back-compat — old client (pre-v2) sent feedback with no `type` field.
      handleFeedback_(ss, body);
    } else {
      logError_(ss, 'unknown_type', type, body, raw);
    }

    return jsonResponse_({ ok: true });
  } catch (err) {
    try {
      const ss = SpreadsheetApp.openById(SHEET_ID);
      logError_(ss, 'doPost_exception', '', { error: String(err) }, '');
    } catch (_) {}
    return jsonResponse_({ error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || '').toLowerCase().trim();

  if (action === 'leaderboard') {
    const data = getLeaderboard_();
    if (params.callback) {
      return ContentService
        .createTextOutput(params.callback + '(' + JSON.stringify(data) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return jsonResponse_(data);
  }

  return jsonResponse_({ status: 'DLA Feedback GAS v2 online' });
}

// ─── Type handlers ─────────────────────────────────────────────────────

function handleUsed_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.USED);
  const ts = new Date();
  const campus = clean_(body.campus);
  const year   = clean_(body.year);
  const theme  = clean_(body.theme);
  const tool   = clean_(body.tool);
  const phase  = clean_(body.phase);
  if (!campus || !year || !theme) {
    logError_(ss, 'used_missing_required', 'used', body, '');
    return;
  }
  const team = clean_(body.team) || (campus + ' ' + year + ' Team');
  sheet.appendRow([ts, team, campus, year, theme, tool, phase]);
  recomputeLeaderboard_(ss);
}

// Removes the most recent Used row matching campus|year|theme|tool|phase so the
// "I Used This" button can toggle off. Team is matched if present so two
// teams sharing a unit can't undo each other's clicks.
function handleUnused_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.USED);
  const campus = clean_(body.campus);
  const year   = clean_(body.year);
  const theme  = clean_(body.theme);
  const tool   = clean_(body.tool);
  const phase  = clean_(body.phase);
  const team   = clean_(body.team);
  if (!campus || !year || !theme) {
    logError_(ss, 'unused_missing_required', 'unused', body, '');
    return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  // Used columns: 0 Timestamp, 1 Team, 2 Campus, 3 Year, 4 Theme, 5 Tool, 6 Phase
  for (let i = data.length - 1; i >= 0; i--) {
    const r = data[i];
    if (
      clean_(r[2]) === campus &&
      clean_(r[3]) === year &&
      clean_(r[4]) === theme &&
      clean_(r[5]) === tool &&
      clean_(r[6]) === phase &&
      (!team || clean_(r[1]) === team)
    ) {
      sheet.deleteRow(i + 2);
      recomputeLeaderboard_(ss);
      return;
    }
  }
  // No match — leave the sheet untouched. Likely a stale undo from a refreshed page.
}

function handleReaction_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.REACTIONS);
  const ts = new Date();
  const campus   = clean_(body.campus);
  const year     = clean_(body.year);
  const theme    = clean_(body.theme);
  const tool     = clean_(body.tool);
  const phase    = clean_(body.phase);
  const reaction = clean_(body.reaction).toLowerCase();
  if (!campus || !year || !theme || !reaction) {
    logError_(ss, 'reaction_missing_required', 'reaction', body, '');
    return;
  }
  if (reaction !== 'up' && reaction !== 'down') {
    logError_(ss, 'reaction_invalid_value', 'reaction', body, '');
    return;
  }
  // Server-side debounce — ignore identical reaction within 5s on the same context.
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const lookback = Math.min(20, lastRow - 1);
    const recent = sheet.getRange(lastRow - lookback + 1, 1, lookback, 7).getValues();
    const nowMs = ts.getTime();
    for (let i = recent.length - 1; i >= 0; i--) {
      const r = recent[i];
      if (!r[0]) continue;
      const dt = nowMs - new Date(r[0]).getTime();
      if (dt > REACTION_DEBOUNCE_MS) break;
      if (
        clean_(r[1]) === campus &&
        clean_(r[2]) === year &&
        clean_(r[3]) === theme &&
        clean_(r[4]) === tool &&
        clean_(r[5]) === phase &&
        clean_(r[6]).toLowerCase() === reaction
      ) {
        return; // duplicate inside debounce window
      }
    }
  }
  sheet.appendRow([ts, campus, year, theme, tool, phase, reaction]);
}

function handleAnalyticsBatch_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.ANALYTICS);
  const ts = new Date();
  const session = clean_(body.session);
  const events  = Array.isArray(body.events) ? body.events : [];
  if (!session || !events.length) return;

  const rows = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i] || {};
    const page    = clean_(ev.page);
    const campus  = clean_(ev.campus);
    const year    = clean_(ev.year);
    const seconds = Number(ev.seconds || 0);
    if (!page) continue;
    if (!(seconds >= 1 && seconds <= 600)) continue; // sanity bounds
    rows.push([ts, session, page, campus, year, seconds]);
  }
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }
}

function handleFeedback_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.FEEDBACK);
  const feedback = clean_(body.feedback);
  if (!feedback) return; // refuse empty rows — root cause of the 275 phantom rows
  const ts = new Date();
  const campus = clean_(body.campus);
  const year   = clean_(body.year);
  const theme  = clean_(body.theme);
  const tool   = clean_(body.tool);
  const phase  = clean_(body.phase);
  sheet.appendRow([ts, campus, year, theme, tool, phase, feedback]);
}

// ─── Leaderboard ───────────────────────────────────────────────────────

// Aggregates Used rows into per-team totals. Source of truth for both the
// cached Leaderboard sheet (written by recomputeLeaderboard_) and the live
// GET endpoint (served by getLeaderboard_). Returns an array of team objects.
function aggregateLeaderboard_(ss) {
  const usedSheet = ensureSheet_(ss, SHEETS.USED);
  const data = usedSheet.getDataRange().getValues();
  if (data.length < 2) return [];

  // Used columns: 0 Timestamp, 1 Team, 2 Campus, 3 Year, 4 Theme, 5 Tool, 6 Phase
  const teams = {};   // key = "campus|year"           →   { campus, year, points, streaks, lastTheme, lastTool }
  const units = {};   // key = "campus|year|theme"     →   { count, awarded }

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const campus = clean_(r[2]);
    const year   = clean_(r[3]);
    const theme  = clean_(r[4]);
    const tool   = clean_(r[5]);
    if (!campus || !year) continue;

    const tkey = campus + '|' + year;
    if (!teams[tkey]) teams[tkey] = { campus: campus, year: year, points: 0, streaks: 0, lastTheme: '', lastTool: '' };
    teams[tkey].points    += POINTS_PER_USED;
    teams[tkey].lastTheme  = theme || teams[tkey].lastTheme;
    teams[tkey].lastTool   = tool  || teams[tkey].lastTool;

    // Bonus fires once a team logs STREAK_USES_REQUIRED uses in the same unit (phase ignored).
    const ukey = campus + '|' + year + '|' + theme;
    if (!units[ukey]) units[ukey] = { count: 0, awarded: false };
    units[ukey].count += 1;
    if (units[ukey].count >= STREAK_USES_REQUIRED && !units[ukey].awarded) {
      units[ukey].awarded   = true;
      teams[tkey].streaks   += 1;
      teams[tkey].points    += POINTS_PER_STREAK;
    }
  }

  return Object.keys(teams).map(function(k) { return teams[k]; });
}

function recomputeLeaderboard_(ss) {
  const lbSheet = ensureSheet_(ss, SHEETS.LEADERBOARD);
  const teams = aggregateLeaderboard_(ss);

  // Wipe + repopulate the Leaderboard sheet (header preserved).
  const lastRow = lbSheet.getLastRow();
  if (lastRow > 1) lbSheet.getRange(2, 1, lastRow - 1, 7).clearContent();
  ensureHeaderRow_(lbSheet, HEADERS.Leaderboard);

  if (teams.length) {
    const rows = teams.map(function(t) {
      return [t.campus, t.year, t.points, t.streaks, t.lastTheme, t.lastTool, t.streaks];
    });
    lbSheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
}

// Computes the leaderboard live from Used on every GET so the dashboard
// reflects the current state of the source data, not a stale cache that
// only refreshes inside handleUsed_.
function getLeaderboard_() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const teams = aggregateLeaderboard_(ss);
    return {
      leaderboard: teams.map(function(t) {
        return {
          campus:    t.campus,
          year:      t.year,
          points:    t.points,
          streaks:   t.streaks,
          lastTheme: t.lastTheme,
          lastTool:  t.lastTool
        };
      })
    };
  } catch (err) {
    return { leaderboard: [], error: String(err) };
  }
}

// ─── Manual / one-shot helpers ─────────────────────────────────────────

/** Run once from the Apps Script editor to rebuild the leaderboard from existing Used data. */
function recomputeLeaderboard() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  recomputeLeaderboard_(ss);
}

/**
 * Clean up the 275+ timestamp-only rows the previous GAS wrote to the Feedback sheet.
 * Keeps any row where any column past the timestamp has content. Run from the editor.
 */
function purgeEmptyFeedbackRows() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.FEEDBACK);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const keep = [data[0]];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const hasContent = r.slice(1).some(function(c) { return c !== '' && c !== null && c !== undefined; });
    if (hasContent) keep.push(r);
  }
  sheet.clearContents();
  sheet.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
  Logger.log('Feedback purge: kept ' + (keep.length - 1) + ' rows of ' + (data.length - 1));
}

/** Run once to repair sheet headers (Analytics in particular has wrong labels in the existing sheet). */
function repairHeaders() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Object.keys(HEADERS).forEach(function(name) {
    const sheet = ensureSheet_(ss, name);
    ensureHeaderRow_(sheet, HEADERS[name]);
  });
}

// ─── Internals ─────────────────────────────────────────────────────────

function ensureSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (HEADERS[name]) ensureHeaderRow_(sheet, HEADERS[name]);
  return sheet;
}

function ensureHeaderRow_(sheet, headers) {
  const current = sheet.getLastColumn() === 0
    ? []
    : sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  let needsWrite = false;
  for (let i = 0; i < headers.length; i++) {
    if (current[i] !== headers[i]) { needsWrite = true; break; }
  }
  if (needsWrite) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function logError_(ss, reason, type, body, raw) {
  const sheet = ensureSheet_(ss, SHEETS.ERRORS);
  sheet.appendRow([
    new Date(),
    reason,
    type || '',
    safeStringify_(body).slice(0, 500),
    String(raw || '').slice(0, 1000)
  ]);
}

function safeStringify_(o) {
  try { return JSON.stringify(o); } catch (_) { return String(o); }
}

function clean_(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}