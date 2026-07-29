import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSampleAnalytics, TIMESTAMP_SENTINEL, CAMPUSES, YEAR_LEVELS
} from '../tools/lib/studio-analytics.mjs';

const TOOLS = ['Book Creator', 'Scratch', 'Adobe Express', 'Canva', 'Epic', 'Apple Clips', 'micro:bit'];
const DATA = buildSampleAnalytics(TOOLS);

// Mirrors findSection() in js/09-legacy-restored.js:1288
function findSection(rows, headerText) {
  let start = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(c => String(c || '').includes(headerText))) { start = i; break; }
  }
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < rows.length; i++) {
    if (!rows[i] || !rows[i].length || rows[i].every(c => !c)) break;
    out.push(rows[i]);
  }
  return out;
}

test('provides every range loadLiveAnalytics asks for', () => {
  assert.deepEqual(Object.keys(DATA).sort(), [
    'Analytics!A1:F5000', 'Dashboard!A1:F60', 'Feedback!A1:G100',
    'Intent!A1:G2000', 'Interactions!A1:G5000', 'Used!A1:G2000'
  ]);
});

test('the Dashboard carries all three sections the renderers look for', () => {
  const rows = DATA['Dashboard!A1:F60'];
  assert.ok(findSection(rows, 'WEEKLY SCORECARD').length > 0);
  assert.ok(findSection(rows, 'VIEWS BY CAMPUS').length > 0);
  assert.ok(findSection(rows, 'TOP 10 MOST VIEWED PAGES').length > 0);
});

test('every scorecard metric reads as good, so nothing renders amber or red', () => {
  const data = findSection(DATA['Dashboard!A1:F60'], 'WEEKLY SCORECARD').slice(1);
  assert.ok(data.length >= 4);
  for (const row of data) {
    const [metric, , value, target, status] = row;
    assert.ok(metric, 'metric label present');
    assert.ok(value, 'value present');
    assert.ok(target, 'target present');
    assert.match(String(status).toLowerCase(), /good|✓/);
  }
});

test('campus reach is 3 of 3 and year coverage is 7 of 7', () => {
  const data = findSection(DATA['Dashboard!A1:F60'], 'WEEKLY SCORECARD').slice(1);
  const reach = data.find(r => /Campus Reach/.test(r[0]));
  const cover = data.find(r => /Year Level Coverage/.test(r[0]));
  assert.equal(reach[2], '3');
  assert.equal(cover[2], '7');
});

test('views by campus lists all three campuses with numeric views', () => {
  const data = findSection(DATA['Dashboard!A1:F60'], 'VIEWS BY CAMPUS').slice(1);
  assert.deepEqual(data.map(r => r[0]).sort(), [...CAMPUSES].sort());
  assert.ok(data.every(r => parseInt(r[1], 10) > 0));
});

test('top pages survives the slice(2) and Page-header filter the renderer applies', () => {
  const section = findSection(DATA['Dashboard!A1:F60'], 'TOP 10 MOST VIEWED PAGES');
  const data = section.slice(2).filter(r => r && r[0] && r[1] && r[0] !== 'Page').slice(0, 10);
  assert.equal(data.length, 10);
  assert.ok(data.every(r => parseInt(r[1], 10) > 0));
});

test('Used covers every campus and every year level', () => {
  const rows = DATA['Used!A1:G2000'].slice(1);
  assert.deepEqual([...new Set(rows.map(r => r[2]))].sort(), [...CAMPUSES].sort());
  assert.deepEqual([...new Set(rows.map(r => r[3]))].sort(), [...YEAR_LEVELS].sort());
});

test('Used rows survive the renderer filter and use only supplied tool names', () => {
  const rows = DATA['Used!A1:G2000'].slice(1);
  assert.ok(rows.every(r => r[1] || (r[2] && r[3])), 'renderLiveUsedByTeam filter');
  assert.ok(rows.every(r => r[5]), 'renderLiveUsed needs r[5]');
  assert.ok(rows.every(r => TOOLS.includes(r[5])));
});

test('every timestamp is a day-offset sentinel, never a baked date', () => {
  for (const [range, rows] of Object.entries(DATA)) {
    if (range.startsWith('Dashboard')) continue;
    for (const row of rows.slice(1)) {
      assert.match(String(row[0]), TIMESTAMP_SENTINEL, `${range} timestamp`);
    }
  }
});

test('all activity falls inside the requested history span', () => {
  for (const [range, rows] of Object.entries(DATA)) {
    if (range.startsWith('Dashboard')) continue;
    for (const row of rows.slice(1)) {
      const days = Number(String(row[0]).match(TIMESTAMP_SENTINEL)[1]);
      assert.ok(days < 90, `${range} event ${days} days ago is outside the 90-day span`);
    }
  }
});

test('history reaches back across the whole requested span, not just recent weeks', () => {
  const wide = buildSampleAnalytics(TOOLS, { historyDays: 90 });
  const oldest = Math.max(...wide['Analytics!A1:F5000'].slice(1)
    .map(r => Number(String(r[0]).match(TIMESTAMP_SENTINEL)[1])));
  assert.equal(oldest, 89, 'oldest view should sit at the far end of the span');
  // every third of the range carries activity, so the Month bucket has points
  for (const [lo, hi] of [[0, 29], [30, 59], [60, 89]]) {
    const inBand = wide['Analytics!A1:F5000'].slice(1).filter(r => {
      const d = Number(String(r[0]).match(TIMESTAMP_SENTINEL)[1]);
      return d >= lo && d <= hi;
    });
    assert.ok(inBand.length > 100, `only ${inBand.length} views between ${lo} and ${hi} days ago`);
  }
});

test('a longer span still leaves the recent end busiest', () => {
  const wide = buildSampleAnalytics(TOOLS, { historyDays: 90 });
  const rows = wide['Analytics!A1:F5000'].slice(1);
  const count = (lo, hi) => rows.filter(r => {
    const d = Number(String(r[0]).match(TIMESTAMP_SENTINEL)[1]);
    return d >= lo && d <= hi;
  }).length;
  assert.ok(count(0, 29) > count(60, 89), 'recent month should out-draw the oldest month');
});

test('the span never drops below a month, however small a value is passed', () => {
  const tiny = buildSampleAnalytics(TOOLS, { historyDays: 5 });
  const oldest = Math.max(...tiny['Analytics!A1:F5000'].slice(1)
    .map(r => Number(String(r[0]).match(TIMESTAMP_SENTINEL)[1])));
  assert.equal(oldest, 29);
});

test('campus and page rollups are derived from the view rows, not hardcoded', () => {
  const rows = DATA['Analytics!A1:F5000'].slice(1);
  const section = findSection(DATA['Dashboard!A1:F60'], 'VIEWS BY CAMPUS').slice(1);
  const rollupTotal = section.reduce((a, r) => a + Number(r[1]), 0);
  assert.equal(rollupTotal, rows.length, 'campus views must add up to the actual view count');
});

test('every team has a Used event inside the last 7 days, so all 21 count as active', () => {
  const rows = DATA['Used!A1:G2000'].slice(1);
  const teams = new Set(rows.map(r => r[1]));
  assert.equal(teams.size, 21, '3 campuses x 7 year levels');
  for (const team of teams) {
    const recent = rows.filter(r =>
      r[1] === team && Number(String(r[0]).match(TIMESTAMP_SENTINEL)[1]) <= 6);
    assert.ok(recent.length > 0, `${team} has no use in the last 7 days`);
  }
});

test('most intents are followed through, so intent-to-use does not read 0%', () => {
  const sig = r => [r[2], r[3], r[4], r[5], r[6]].map(v => String(v || '').trim()).join('|');
  const usedSigs = new Set(DATA['Used!A1:G2000'].slice(1).map(sig));
  const intents = DATA['Intent!A1:G2000'].slice(1);
  const followed = intents.filter(r => usedSigs.has(sig(r))).length;
  const rate = followed / intents.length;
  assert.ok(rate >= 0.6, `intent-to-use conversion was ${Math.round(rate * 100)}%, expected 60%+`);
});

test('no signature is used before anyone ever expressed intent in it', () => {
  // Signatures legitimately repeat now that events are dealt across days, so a
  // pairwise "this use answers that intent" ordering is not meaningful. The
  // invariant that still matters: for any campus/year/theme/tool combination
  // that appears in both sheets, intent activity did not begin AFTER use
  // activity began. Larger daysAgo == earlier in time.
  const days = r => Number(String(r[0]).match(TIMESTAMP_SENTINEL)[1]);
  const sig = r => [r[2], r[3], r[4], r[5], r[6]].map(v => String(v || '').trim()).join('|');
  const earliest = rows => {
    const m = new Map();
    rows.forEach(r => {
      const k = sig(r);
      if (!m.has(k) || days(r) > m.get(k)) m.set(k, days(r));
    });
    return m;
  };
  const firstIntent = earliest(DATA['Intent!A1:G2000'].slice(1));
  const firstUse = earliest(DATA['Used!A1:G2000'].slice(1));
  for (const [k, useDay] of firstUse) {
    if (!firstIntent.has(k)) continue;   // used without a prior intent — realistic
    assert.ok(
      firstIntent.get(k) >= useDay,
      `signature ${k} was used ${useDay} days ago but first intended only ${firstIntent.get(k)} days ago`
    );
  }
});

// The growth chart plots page views against tools-marked-used per day. If the
// uses land on a handful of day-offsets the line reads as impossible spikes
// separated by dead air, which is exactly what a sharp audience notices.
function usesPerDay() {
  const counts = new Array(30).fill(0);
  DATA['Used!A1:G2000'].slice(1).forEach(r => {
    const d = Number(String(r[0]).match(TIMESTAMP_SENTINEL)[1]);
    if (d < 30) counts[d] += 1;
  });
  return counts;
}

test('uses are spread across the month, not clustered on a few days', () => {
  const counts = usesPerDay();
  const zeroDays = counts.filter(c => c === 0).length;
  assert.ok(zeroDays <= 4, `${zeroDays} days have no uses at all; expected at most 4`);
});

test('no single day carries an implausible spike of uses', () => {
  const counts = usesPerDay();
  const active = counts.filter(c => c > 0).sort((a, b) => a - b);
  const median = active[Math.floor(active.length / 2)];
  const max = Math.max(...counts);
  assert.ok(max <= median * 4, `busiest day had ${max} uses against a median of ${median}`);
});

test('uses trend upward over the month, matching the views line', () => {
  const counts = usesPerDay();
  const recent = counts.slice(0, 10).reduce((a, b) => a + b, 0);   // last 10 days
  const older = counts.slice(20, 30).reduce((a, b) => a + b, 0);   // first 10 days
  assert.ok(recent > older, `recent uses ${recent} should exceed older uses ${older}`);
});

test('page views trend upward towards today', () => {
  const rows = DATA['Analytics!A1:F5000'].slice(1);
  const count = d => rows.filter(r => Number(String(r[0]).match(TIMESTAMP_SENTINEL)[1]) === d).length;
  assert.ok(count(0) > count(29), 'most recent day busier than the oldest');
});

test('output is deterministic, so rebuilds do not churn the diff', () => {
  assert.equal(JSON.stringify(buildSampleAnalytics(TOOLS)), JSON.stringify(DATA));
});

test('falls back to a built-in tool list when none is supplied', () => {
  const d = buildSampleAnalytics();
  assert.ok(d['Used!A1:G2000'].slice(1).every(r => r[5]));
});
