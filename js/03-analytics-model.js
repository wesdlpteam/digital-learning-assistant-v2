/* =============================================================
   03-analytics-model.js  -  the counting rules behind Live Analytics

   Pure functions, no DOM. buildAnalyticsModel() turns the raw Google
   Sheet rows into one model and every Analytics panel reads that
   model, so two panels can no longer disagree about what a visit, a
   team or a campus is.

   Rules agreed with Nathan 2026-10-09
   (docs/superpowers/specs/2026-10-09-analytics-rebuild-design.md):
   - A page view is an Analytics row whose page is not 'exit'. 'exit'
     was a placeholder index.html logged on tab switch, never a page.
   - A visit is one session id: one sitting at the DLA, however many
     pages. Its time is its first page view.
   - Campus and year spellings fold to one name. Mirrors
     normaliseCampus_ / normaliseYear_ in gas_analytics/Code.js.
   - A team is one campus + year level. The universe is the units in DATA.
   - A percent change only when both windows hold AM_MIN_FOR_PCT or more.

   var + function declarations only, so tests/analytics-model.test.mjs
   can load this file in a Node vm context.
   ============================================================= */

var AM_CAMPUSES = ['Elsternwick', 'Glen Waverley', 'St Kilda Road'];
var AM_YEARS = ['3 Year Old Kinder', '4 Year Old Kinder', 'Prep',
  'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6'];
var AM_NO_CAMPUS = 'Campus not chosen';
var AM_WINDOW_DAYS = 28;   // headline window: last 4 weeks vs the 4 before
var AM_MIN_FOR_PCT = 20;   // below this a % change is noise, so show counts
var AM_ACTIVE_DAYS = 14;   // team grid green
var AM_QUIET_DAYS = 42;    // team grid amber up to here, grey after
var AM_DAY_MS = 86400000;

/* ---------- Spelling ---------- */

function amCampus(v) {
  var c = String(v == null ? '' : v).trim();
  var k = c.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (!k) return '';
  if (k === 'el' || k.indexOf('elsternwick') > -1) return 'Elsternwick';
  if (k === 'gw' || k.indexOf('glen waverley') > -1) return 'Glen Waverley';
  if (k === 'skr' || k === 'stk' || k.indexOf('st kilda') > -1) return 'St Kilda Road';
  return c;
}

function amYear(v) {
  var y = String(v == null ? '' : v).trim()
    .replace(/^(Elsternwick|Glen Waverley|St Kilda(?: Road| Rd)?|EL|GW|SKR|STK)\s*/i, '')
    .replace(/\s*Team$/i, '').trim();
  if (!y) return '';
  if (/3\s*year\s*old\s*kinder|3yo\s*kinder/i.test(y)) return '3 Year Old Kinder';
  if (/4\s*year\s*old\s*kinder|4yo\s*kinder/i.test(y)) return '4 Year Old Kinder';
  if (/prep|foundation/i.test(y)) return 'Prep';
  var m = y.match(/year\s*([1-6])/i) || y.match(/\b([1-6])\b/);
  if (m) return 'Year ' + m[1];
  return y;
}

/* ---------- Time ---------- */

// Wall-clock parts in `tz` to a real instant. Treat the parts as UTC, see
// what that instant reads as in tz, and subtract the difference.
function amInstantInTz(year, month, day, hour, min, sec, tz) {
  var asIfUtc = Date.UTC(year, month - 1, day, hour, min, sec);
  try {
    var dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var p = {};
    dtf.formatToParts(new Date(asIfUtc)).forEach(function (x) {
      if (x.type !== 'literal') p[x.type] = parseInt(x.value, 10);
    });
    if (p.hour === 24) p.hour = 0;
    var inTz = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return new Date(asIfUtc - (inTz - asIfUtc));
  } catch (_) {
    return new Date(year, month - 1, day, hour, min, sec);
  }
}

// What the Sheets API can hand back for a timestamp cell:
//  - a serial number (UNFORMATTED_VALUE + SERIAL_NUMBER): days since
//    1899-12-30, wall clock in the sheet's timezone
//  - display text 'DD/MM/YYYY' or 'DD/MM/YYYY HH:MM[:SS]' (en_GB sheet)
//  - an ISO string (the sandbox demo)
function amParseTimestamp(raw, tz) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!isFinite(raw) || raw < 1) return null;
    var wall = new Date(Date.UTC(1899, 11, 30) + Math.round(raw * AM_DAY_MS));
    return amInstantInTz(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(),
      wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), tz);
  }
  var s = String(raw).trim();
  if (!s) return null;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return amInstantInTz(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), tz);
  if (/^\d+(\.\d+)?$/.test(s)) return amParseTimestamp(Number(s), tz);
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/* ---------- Rows ---------- */

function amCell(row, i) {
  var v = row ? row[i] : '';
  return v == null ? '' : String(v).trim();
}

// Data rows only: drops the header row and fully blank rows.
function amDataRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(1).filter(function (r) {
    return Array.isArray(r) && r.some(function (c) { return c !== '' && c != null; });
  });
}

function amTeamKey(campus, year) { return campus + '|' + year; }

// Analytics: A Timestamp | B Session | C Page | D Campus | E Year Level | F Seconds
function amPageViews(rows, tz) {
  var out = [];
  amDataRows(rows).forEach(function (r, i) {
    var page = amCell(r, 2);
    if (!page || page.toLowerCase() === 'exit') return;
    var ts = amParseTimestamp(r[0], tz);
    if (!ts) return;
    var campus = amCampus(r[3]);
    var rawYear = amCell(r, 4);
    var year = amYear(rawYear);
    var teamPage = !!(campus && year);
    out.push({
      ts: ts, session: amCell(r, 1) || ('row-' + i), page: page,
      campus: campus, year: year, seconds: Number(r[5]) || 0,
      isTeamPage: teamPage,
      // A year-level list page is logged with the year as its page name.
      isUnit: teamPage && page !== rawYear && page !== year && !/ campus$/i.test(page)
    });
  });
  return out;
}

function amVisits(pageViews) {
  var bySession = Object.create(null);
  pageViews.forEach(function (v) {
    var s = bySession[v.session];
    if (!s) s = bySession[v.session] = { session: v.session, ts: v.ts, pages: 0, campusCounts: Object.create(null), teams: Object.create(null), hasTeamPage: false };
    if (v.ts < s.ts) s.ts = v.ts;
    s.pages++;
    if (v.campus) s.campusCounts[v.campus] = (s.campusCounts[v.campus] || 0) + 1;
    if (v.isTeamPage) { s.hasTeamPage = true; s.teams[amTeamKey(v.campus, v.year)] = true; }
  });
  return Object.keys(bySession).map(function (k) {
    var s = bySession[k];
    var best = '', bestN = 0;
    Object.keys(s.campusCounts).sort(function (a, b) {
      return AM_CAMPUSES.indexOf(a) - AM_CAMPUSES.indexOf(b);
    }).forEach(function (c) {
      if (s.campusCounts[c] > bestN) { best = c; bestN = s.campusCounts[c]; }
    });
    return { session: s.session, ts: s.ts, pages: s.pages, campus: best, hasTeamPage: s.hasTeamPage, teams: Object.keys(s.teams) };
  }).sort(function (a, b) { return a.ts - b.ts; });
}

// Used / Intent: A Timestamp | B Team | C Campus | D Year | E Theme | F Tool | G Phase
function amClicks(rows, tz, normaliseTool) {
  var out = [];
  amDataRows(rows).forEach(function (r) {
    var campus = amCampus(r[2]), year = amYear(r[3]);
    if (!campus || !year) return;
    var tool = amCell(r, 5);
    if (normaliseTool && tool) tool = normaliseTool(tool) || tool;
    var theme = amCell(r, 4), phase = amCell(r, 6);
    out.push({
      ts: amParseTimestamp(r[0], tz), campus: campus, year: year, team: campus + ' ' + year,
      theme: theme, tool: tool, phase: phase,
      sig: [campus, year, theme, tool, phase].join('|')
    });
  });
  return out;
}

// Feedback: A Timestamp | B Campus | C Year | D Theme | E Tool | F Phase | G Feedback
function amFeedback(rows, tz) {
  var out = [];
  amDataRows(rows).forEach(function (r) {
    var text = amCell(r, 6);
    if (!text) return;
    out.push({
      ts: amParseTimestamp(r[0], tz), campus: amCampus(r[1]), year: amYear(r[2]),
      theme: amCell(r, 3), tool: amCell(r, 4), phase: amCell(r, 5), text: text
    });
  });
  return out;
}

// Interactions: A Timestamp | B Session | C Kind | D Page | E Campus | F Year | G Detail
function amInteractions(rows, tz) {
  return amDataRows(rows).map(function (r) {
    return {
      ts: amParseTimestamp(r[0], tz), session: amCell(r, 1), kind: amCell(r, 2).toLowerCase(),
      page: amCell(r, 3), campus: amCampus(r[4]), year: amYear(r[5]), detail: amCell(r, 6)
    };
  }).filter(function (e) { return e.kind; });
}

function amSortTeams(a, b) {
  return (AM_YEARS.indexOf(a.year) - AM_YEARS.indexOf(b.year)) ||
    (AM_CAMPUSES.indexOf(a.campus) - AM_CAMPUSES.indexOf(b.campus));
}

function amTeamUniverse(units) {
  var seen = Object.create(null), out = [];
  (units || []).forEach(function (u) {
    if (!u) return;
    var c = amCampus(u.ca), y = amYear(u.yl);
    if (!c || !y) return;
    var k = amTeamKey(c, y);
    if (seen[k]) return;
    seen[k] = true;
    out.push({ key: k, campus: c, year: y });
  });
  return out.sort(amSortTeams);
}

function buildAnalyticsModel(raw, opts) {
  raw = raw || {};
  opts = opts || {};
  var tz = opts.tz || 'Australia/Melbourne';
  var pageViews = amPageViews(raw.analytics, tz);
  return {
    tz: tz,
    now: opts.now ? new Date(opts.now) : new Date(),
    analyticsRows: amDataRows(raw.analytics).length,
    pageViews: pageViews,
    visits: amVisits(pageViews),
    used: amClicks(raw.used, tz, opts.normaliseTool),
    intents: amClicks(raw.intent, tz, opts.normaliseTool),
    feedback: amFeedback(raw.feedback, tz),
    interactions: amInteractions(raw.interactions, tz),
    teams: amTeamUniverse(opts.units)
  };
}

/* ---------- Metrics ---------- */

function amWindowFrom(model, n) {
  return new Date(model.now.getTime() - (n || 1) * AM_WINDOW_DAYS * AM_DAY_MS);
}

function amCountBetween(events, from, to) {
  var n = 0;
  events.forEach(function (e) { if (e.ts && e.ts >= from && (!to || e.ts <= to)) n++; });
  return n;
}

function amCompare(cur, prev) {
  var pct = (cur >= AM_MIN_FOR_PCT && prev >= AM_MIN_FOR_PCT)
    ? Math.round(((cur - prev) / prev) * 100) : null;
  return { cur: cur, prev: prev, pct: pct };
}

// Every team in the universe, plus any team seen in the data but missing
// from it, with its latest activity (unit-page view, intent or used click).
function amTeamActivity(model) {
  var map = Object.create(null);
  function touch(campus, year, ts, field) {
    if (!campus || !year) return;
    var k = amTeamKey(campus, year);
    var t = map[k] || (map[k] = { key: k, campus: campus, year: year, last: null, views: 0, intents: 0, used: 0 });
    t[field]++;
    if (ts && (!t.last || ts > t.last)) t.last = ts;
  }
  model.pageViews.forEach(function (v) { if (v.isTeamPage) touch(v.campus, v.year, v.ts, 'views'); });
  model.intents.forEach(function (e) { touch(e.campus, e.year, e.ts, 'intents'); });
  model.used.forEach(function (e) { touch(e.campus, e.year, e.ts, 'used'); });
  var known = {};
  var out = model.teams.map(function (t) {
    known[t.key] = true;
    return map[t.key] || { key: t.key, campus: t.campus, year: t.year, last: null, views: 0, intents: 0, used: 0 };
  });
  Object.keys(map).forEach(function (k) { if (!known[k]) out.push(map[k]); });
  var now = model.now.getTime();
  out.forEach(function (t) {
    var age = t.last ? (now - t.last.getTime()) / AM_DAY_MS : Infinity;
    t.status = !t.last ? 'never' : age <= AM_ACTIVE_DAYS ? 'active' : age <= AM_QUIET_DAYS ? 'quiet' : 'idle';
  });
  return out.sort(amSortTeams);
}

function amHeadline(model) {
  var to = model.now, from = amWindowFrom(model, 1), prevFrom = amWindowFrom(model, 2);
  function block(events) {
    var c = amCompare(amCountBetween(events, from, null), amCountBetween(events, prevFrom, new Date(from.getTime() - 1)));
    c.allTime = events.length;
    return c;
  }
  var teams = amTeamActivity(model);
  var active = teams.filter(function (t) { return t.last && t.last >= from; }).length;
  return {
    windowDays: AM_WINDOW_DAYS,
    visits: block(model.visits),
    intents: block(model.intents),
    used: block(model.used),
    teamsActive: { cur: active, total: teams.length }
  };
}

// Monday-start weeks (or calendar months) in the browser's local time.
function amBucketStart(d, bucket) {
  if (bucket === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

// Oldest first, ending with the bucket that holds `now`. Leading buckets with
// no activity at all are trimmed, so a short history does not open on empty bars.
function amSeries(model, opts) {
  opts = opts || {};
  var bucket = opts.bucket === 'month' ? 'month' : 'week';
  var count = opts.count || (bucket === 'month' ? 12 : 26);
  var campus = opts.campus && opts.campus !== 'all' ? amCampus(opts.campus) : null;
  var last = amBucketStart(model.now, bucket);
  var starts = [];
  for (var i = count - 1; i >= 0; i--) {
    starts.push(bucket === 'month'
      ? new Date(last.getFullYear(), last.getMonth() - i, 1)
      : new Date(last.getFullYear(), last.getMonth(), last.getDate() - 7 * i));
  }
  var idx = {};
  starts.forEach(function (s, j) { idx[s.getTime()] = j; });
  var names = AM_CAMPUSES.concat([AM_NO_CAMPUS]);
  var zeros = function () { return starts.map(function () { return 0; }); };
  var visits = {};
  names.forEach(function (n) { visits[n] = zeros(); });
  var used = zeros(), intents = zeros();
  function slot(ts) {
    if (!ts) return -1;
    var k = amBucketStart(ts, bucket).getTime();
    return (k in idx) ? idx[k] : -1;
  }
  model.visits.forEach(function (v) {
    if (campus && v.campus !== campus) return;
    var j = slot(v.ts);
    if (j < 0) return;
    visits[visits[v.campus] ? v.campus : AM_NO_CAMPUS][j]++;
  });
  model.used.forEach(function (e) { if (campus && e.campus !== campus) return; var j = slot(e.ts); if (j >= 0) used[j]++; });
  model.intents.forEach(function (e) { if (campus && e.campus !== campus) return; var j = slot(e.ts); if (j >= 0) intents[j]++; });
  var first = 0;
  while (first < starts.length - 1 && !used[first] && !intents[first] &&
    !names.some(function (n) { return visits[n][first]; })) first++;
  var out = { bucket: bucket, starts: starts.slice(first), visits: {}, used: used.slice(first), intents: intents.slice(first) };
  names.forEach(function (n) { out.visits[n] = visits[n].slice(first); });
  return out;
}

function amCampusTotals(model) {
  var names = AM_CAMPUSES.concat([AM_NO_CAMPUS]);
  var t = {};
  names.forEach(function (n) { t[n] = { campus: n, visits: 0, pageViews: 0, seconds: 0 }; });
  model.visits.forEach(function (v) { t[t[v.campus] ? v.campus : AM_NO_CAMPUS].visits++; });
  model.pageViews.forEach(function (p) {
    var x = t[t[p.campus] ? p.campus : AM_NO_CAMPUS];
    x.pageViews++;
    x.seconds += p.seconds;
  });
  return names.map(function (n) {
    var x = t[n];
    return { campus: n, visits: x.visits, pageViews: x.pageViews, avgSeconds: x.pageViews ? Math.round(x.seconds / x.pageViews) : 0 };
  });
}

function amTopPages(model, n) {
  var map = Object.create(null);
  model.pageViews.forEach(function (p) {
    if (!p.isUnit) return;
    var k = p.page + '|' + p.campus + '|' + p.year;
    var x = map[k] || (map[k] = { page: p.page, campus: p.campus, year: p.year, views: 0, seconds: 0 });
    x.views++;
    x.seconds += p.seconds;
  });
  return Object.keys(map).map(function (k) {
    var x = map[k];
    return { page: x.page, campus: x.campus, year: x.year, views: x.views, avgSeconds: Math.round(x.seconds / x.views) };
  }).sort(function (a, b) { return b.views - a.views || a.page.localeCompare(b.page); }).slice(0, n || 10);
}

function amToolUsage(model, campus) {
  var c = campus && campus !== 'all' ? amCampus(campus) : null;
  var map = Object.create(null);
  function add(e, field) {
    if (!e.tool || (c && e.campus !== c)) return;
    var x = map[e.tool] || (map[e.tool] = { tool: e.tool, used: 0, intents: 0 });
    x[field]++;
  }
  model.used.forEach(function (e) { add(e, 'used'); });
  model.intents.forEach(function (e) { add(e, 'intents'); });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.used - a.used || b.intents - a.intents || a.tool.localeCompare(b.tool); });
}

function amSteps(model) {
  var from = amWindowFrom(model, 1);
  function pair(list) {
    return { allTime: list.length, recent: list.filter(function (e) { return e.ts && e.ts >= from; }).length };
  }
  return {
    visits: pair(model.visits),
    teamVisits: pair(model.visits.filter(function (v) { return v.hasTeamPage; })),
    intents: pair(model.intents),
    used: pair(model.used)
  };
}

// "Going to try" clicks at least minAgeDays old with no "used" click of the
// same campus, year, theme, tool and phase.
function amOpenIntents(model, minAgeDays) {
  var cutoff = model.now.getTime() - (minAgeDays == null ? 7 : minAgeDays) * AM_DAY_MS;
  var usedSigs = Object.create(null);
  model.used.forEach(function (e) { usedSigs[e.sig] = true; });
  return model.intents.filter(function (e) { return e.ts && e.ts.getTime() <= cutoff && !usedSigs[e.sig]; });
}
