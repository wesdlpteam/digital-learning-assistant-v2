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
 *   intent           → Intent sheet (teacher plans to try a suggestion), recomputes Leaderboard
 *   unintent         → removes most recent matching Intent row (toggle off), recomputes Leaderboard
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
  INTENT:      'Intent',
  FEEDBACK:    'Feedback',
  REACTIONS:   'Reactions',
  ANALYTICS:   'Analytics',
  LEADERBOARD: 'Leaderboard',
  ERRORS:      'Errors'
};

// Headers — used both to validate sheets at startup and to repair a missing/wrong header row.
const HEADERS = {
  Used:        ['Timestamp','Team','Campus','Year Level','Theme','Tool','Phase'],
  Intent:      ['Timestamp','Team','Campus','Year Level','Theme','Tool','Phase'],
  Feedback:    ['Timestamp','Campus','Year Level','Theme','Tool','Phase','Feedback'],
  Reactions:   ['Timestamp','Campus','Year Level','Theme','Tool','Phase','Reaction'],
  Analytics:   ['Timestamp','Session','Page','Campus','Year Level','Time Spent (seconds)'],
  Leaderboard: ['Campus','Year','Points','Streaks','LastTheme','LastTool','StreakCount'],
  Errors:      ['Timestamp','Reason','Type','Body','Raw']
};

const REACTION_DEBOUNCE_MS = 5000;
// Used is worth more than Intent because it represents follow-through, not just planning.
const POINTS_PER_USED      = 2;
const POINTS_PER_INTENT    = 1;
const POINTS_PER_STREAK    = 3;
const STREAK_USES_REQUIRED = 3; // Bonus fires when a team logs this many uses in one unit.

// Global per-minute POST cap. Apps Script does not expose the client IP or
// Origin header to web-app handlers, so per-IP rate-limiting isn't possible.
// A global cap is a blunt instrument but stops runaway loops or scripted
// abuse from burning the daily sheet-write quota and exhausting the Apps
// Script execution budget. Real traffic (1-3 concurrent teachers × a few
// events/min each) sits well below 200/min.
const RATE_LIMIT_PER_MINUTE = 200;
const RATE_LIMIT_PROP_KEY   = 'DLA_ANALYTICS_POST_TS';
const RATE_LIMIT_WINDOW_MS  = 60 * 1000;

// Returns true if this POST should proceed, false if rate-limited. Caller
// owns the script lock so the read-modify-write is atomic.
function withinRateLimit_() {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let arr = [];
  try {
    const raw = props.getProperty(RATE_LIMIT_PROP_KEY);
    if (raw) arr = JSON.parse(raw);
    if (!Array.isArray(arr)) arr = [];
  } catch (_) { arr = []; }
  // Drop timestamps outside the rolling window
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  arr = arr.filter(function(t) { return t >= cutoff; });
  if (arr.length >= RATE_LIMIT_PER_MINUTE) {
    // Persist the trimmed list so we don't re-trim on the next call
    try { props.setProperty(RATE_LIMIT_PROP_KEY, JSON.stringify(arr)); } catch (_) {}
    return false;
  }
  arr.push(now);
  try { props.setProperty(RATE_LIMIT_PROP_KEY, JSON.stringify(arr)); } catch (_) {}
  return true;
}

// ─── HTTP entry points ─────────────────────────────────────────────────

function doPost(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(err) {
    return jsonResponse_({ error: 'Could not acquire lock' });
  }
  try {
    if (!withinRateLimit_()) {
      // Don't log every rate-limited request (would itself burn quota), just
      // the first one in each window. The client uses mode:'no-cors' so the
      // body is never read — silent drop is fine from a UX standpoint.
      return jsonResponse_({ error: 'rate-limited' });
    }

    const raw  = (e && e.postData && e.postData.contents) || '';
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch (_) { body = {}; }

    const type = String(body.type || '').toLowerCase().trim();
    const ss   = SpreadsheetApp.openById(SHEET_ID);

    if (type === 'used') {
      handleUsed_(ss, body);
    } else if (type === 'unused') {
      handleUnused_(ss, body);
    } else if (type === 'intent') {
      handleIntent_(ss, body);
    } else if (type === 'unintent') {
      handleUnintent_(ss, body);
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
      // Sanitise JSONP callback name — only allow JS-identifier-safe chars.
      // Without this, any caller can inject arbitrary JS into the response body.
      var cbSafe = String(params.callback).replace(/[^A-Za-z0-9_$.]/g, '');
      if (!cbSafe) cbSafe = 'callback';
      return ContentService
        .createTextOutput(cbSafe + '(' + JSON.stringify(data) + ');')
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

// Removes the most recent Used row that matches the undo request so the
// "I Used This" button can toggle off. Tiered match — each tier loosens the
// fields that have to line up — because older rows in the sheet predate
// some fields (team) or have slightly different phase strings, and a strict
// match would leave the row in place (so points wouldn't drop).
//
// Two teams can't share a row: each (campus, year, theme, tool, phase)
// belongs to exactly one team's view, so dropping the team check is safe.
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

  // Tiered matchers — first to find a hit wins.
  const tiers = [
    // 1. Exact: every field including team.
    function(r) {
      return clean_(r[2]) === campus &&
             clean_(r[3]) === year &&
             clean_(r[4]) === theme &&
             clean_(r[5]) === tool &&
             clean_(r[6]) === phase &&
             (!team || clean_(r[1]) === team);
    },
    // 2. Drop team check (old rows may have a different/empty team field).
    function(r) {
      return clean_(r[2]) === campus &&
             clean_(r[3]) === year &&
             clean_(r[4]) === theme &&
             clean_(r[5]) === tool &&
             clean_(r[6]) === phase;
    },
    // 3. Drop phase check too (phase labels have changed historically).
    function(r) {
      return clean_(r[2]) === campus &&
             clean_(r[3]) === year &&
             clean_(r[4]) === theme &&
             clean_(r[5]) === tool;
    },
    // 4. Last resort — drop tool too. Removes any row for that team+theme.
    function(r) {
      return clean_(r[2]) === campus &&
             clean_(r[3]) === year &&
             clean_(r[4]) === theme;
    }
  ];

  for (let t = 0; t < tiers.length; t++) {
    for (let i = data.length - 1; i >= 0; i--) {
      if (tiers[t](data[i])) {
        sheet.deleteRow(i + 2);
        recomputeLeaderboard_(ss);
        return;
      }
    }
  }

  // No match in any tier — log so we can see what the sheet held vs. the
  // request and refine the matcher.
  logError_(ss, 'unused_no_match', 'unused', body, JSON.stringify({
    campus: campus, year: year, theme: theme, tool: tool, phase: phase, team: team,
    rowCount: data.length
  }));
}

// Intent = teacher clicked "I'm going to try this" on a suggestion.
// Stored separately from Used so the two signals stay independent — a teacher
// can mark intent, later mark used, and the leaderboard counts both.
function handleIntent_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.INTENT);
  const ts = new Date();
  const campus = clean_(body.campus);
  const year   = clean_(body.year);
  const theme  = clean_(body.theme);
  const tool   = clean_(body.tool);
  const phase  = clean_(body.phase);
  if (!campus || !year || !theme) {
    logError_(ss, 'intent_missing_required', 'intent', body, '');
    return;
  }
  const team = clean_(body.team) || (campus + ' ' + year + ' Team');
  sheet.appendRow([ts, team, campus, year, theme, tool, phase]);
  recomputeLeaderboard_(ss);
}

// Mirrors handleUnused_'s tiered match so an undo click reliably finds the
// row even when stored team/phase strings have drifted from the request.
function handleUnintent_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.INTENT);
  const campus = clean_(body.campus);
  const year   = clean_(body.year);
  const theme  = clean_(body.theme);
  const tool   = clean_(body.tool);
  const phase  = clean_(body.phase);
  const team   = clean_(body.team);
  if (!campus || !year || !theme) {
    logError_(ss, 'unintent_missing_required', 'unintent', body, '');
    return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const tiers = [
    function(r) {
      return clean_(r[2]) === campus && clean_(r[3]) === year && clean_(r[4]) === theme &&
             clean_(r[5]) === tool && clean_(r[6]) === phase && (!team || clean_(r[1]) === team);
    },
    function(r) {
      return clean_(r[2]) === campus && clean_(r[3]) === year && clean_(r[4]) === theme &&
             clean_(r[5]) === tool && clean_(r[6]) === phase;
    },
    function(r) {
      return clean_(r[2]) === campus && clean_(r[3]) === year && clean_(r[4]) === theme &&
             clean_(r[5]) === tool;
    },
    function(r) {
      return clean_(r[2]) === campus && clean_(r[3]) === year && clean_(r[4]) === theme;
    }
  ];
  for (let t = 0; t < tiers.length; t++) {
    for (let i = data.length - 1; i >= 0; i--) {
      if (tiers[t](data[i])) {
        sheet.deleteRow(i + 2);
        recomputeLeaderboard_(ss);
        return;
      }
    }
  }
  logError_(ss, 'unintent_no_match', 'unintent', body, JSON.stringify({
    campus: campus, year: year, theme: theme, tool: tool, phase: phase, team: team,
    rowCount: data.length
  }));
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

const FEEDBACK_MAX_LEN = 5000;

function handleFeedback_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.FEEDBACK);
  // Feedback gets its own larger cap (paragraphs are legitimate). Still defang
  // formula prefixes and hard-cap so a single huge submission can't bloat the sheet.
  let feedback = body.feedback == null ? '' : String(body.feedback).trim();
  if (feedback && /^[=+\-@\t\r]/.test(feedback)) feedback = "'" + feedback;
  if (feedback.length > FEEDBACK_MAX_LEN) feedback = feedback.slice(0, FEEDBACK_MAX_LEN);
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

// Aggregates Used + Intent rows into per-team totals. Source of truth for both
// the cached Leaderboard sheet (written by recomputeLeaderboard_) and the live
// GET endpoint (served by getLeaderboard_). Returns an array of team objects.
// Used and Intent stack: a team that marks intent (+1) then later used (+2)
// on the same suggestion ends up with +3 for that suggestion. Streak bonuses
// fire only on Used rows — intents alone don't trigger a streak.
function aggregateLeaderboard_(ss) {
  const usedSheet   = ensureSheet_(ss, SHEETS.USED);
  const intentSheet = ensureSheet_(ss, SHEETS.INTENT);
  const usedData   = usedSheet.getDataRange().getValues();
  const intentData = intentSheet.getDataRange().getValues();

  // Used/Intent columns: 0 Timestamp, 1 Team, 2 Campus, 3 Year, 4 Theme, 5 Tool, 6 Phase
  const teams = {};   // key = "campus|year"           →   { campus, year, points, streaks, lastTheme, lastTool }
  const units = {};   // key = "campus|year|theme"     →   { count, awarded }   (Used-only, for streak bonus)

  function getOrInitTeam(campus, year) {
    const tkey = campus + '|' + year;
    if (!teams[tkey]) teams[tkey] = { campus: campus, year: year, points: 0, streaks: 0, lastTheme: '', lastTool: '' };
    return teams[tkey];
  }

  // Used rows — each worth POINTS_PER_USED, and contribute to streak bonus.
  for (let i = 1; i < usedData.length; i++) {
    const r = usedData[i];
    const campus = clean_(r[2]);
    const year   = clean_(r[3]);
    const theme  = clean_(r[4]);
    const tool   = clean_(r[5]);
    if (!campus || !year) continue;

    const team = getOrInitTeam(campus, year);
    team.points    += POINTS_PER_USED;
    team.lastTheme  = theme || team.lastTheme;
    team.lastTool   = tool  || team.lastTool;

    // Streak bonus fires once a team logs STREAK_USES_REQUIRED USED rows in the
    // same unit (phase ignored). Intent rows don't count toward streaks — only
    // follow-through earns the bonus.
    const ukey = campus + '|' + year + '|' + theme;
    if (!units[ukey]) units[ukey] = { count: 0, awarded: false };
    units[ukey].count += 1;
    if (units[ukey].count >= STREAK_USES_REQUIRED && !units[ukey].awarded) {
      units[ukey].awarded = true;
      team.streaks       += 1;
      team.points        += POINTS_PER_STREAK;
    }
  }

  // Intent rows — each worth POINTS_PER_INTENT, stack on top of any Used points.
  for (let i = 1; i < intentData.length; i++) {
    const r = intentData[i];
    const campus = clean_(r[2]);
    const year   = clean_(r[3]);
    if (!campus || !year) continue;
    const team = getOrInitTeam(campus, year);
    team.points += POINTS_PER_INTENT;
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
      }),
      usedKeys:   getUsedKeys_(ss),
      intentKeys: getIntentKeys_(ss)
    };
  } catch (err) {
    return { leaderboard: [], usedKeys: [], intentKeys: [], error: String(err) };
  }
}

// Returns the deduplicated set of "campus|year|theme|tool|phase" keys from
// the named sheet. The DLA page uses this to render Used/Intent buttons in
// their done state on every browser, not just the device that clicked.
function getKeysFromSheet_(ss, sheetName) {
  const sheet = ensureSheet_(ss, sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const seen = {};
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const campus = clean_(r[2]);
    const year   = clean_(r[3]);
    const theme  = clean_(r[4]);
    const tool   = clean_(r[5]);
    const phase  = clean_(r[6]);
    if (!campus || !year || !theme) continue;
    const k = campus + '|' + year + '|' + theme + '|' + tool + '|' + phase;
    if (seen[k]) continue;
    seen[k] = 1;
    out.push(k);
  }
  return out;
}

function getUsedKeys_(ss)   { return getKeysFromSheet_(ss, SHEETS.USED); }
function getIntentKeys_(ss) { return getKeysFromSheet_(ss, SHEETS.INTENT); }

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

// Hard cap for any single cell we write to the sheet. Stops a single
// bad/malicious request bloating the spreadsheet (sheets cap individual
// cells at 50 000 chars anyway, but well before that we lose readability
// and quota). Feedback uses its own larger cap, set in handleFeedback_.
const CELL_MAX_LEN = 500;

function clean_(v) {
  if (v === undefined || v === null) return '';
  let s = String(v).trim();
  // Defang spreadsheet-formula prefixes. Without this, a value like
  // "=HYPERLINK("http://evil","Click me")" submitted as a campus/year/tool
  // would execute as a formula when written to the sheet. Prepending a
  // single quote tells Sheets to treat the cell as literal text.
  if (s && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.length > CELL_MAX_LEN) s = s.slice(0, CELL_MAX_LEN);
  return s;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}