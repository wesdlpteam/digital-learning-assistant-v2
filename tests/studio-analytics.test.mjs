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

test('all activity falls inside the rolling 30-day window the dashboard filters on', () => {
  for (const [range, rows] of Object.entries(DATA)) {
    if (range.startsWith('Dashboard')) continue;
    for (const row of rows.slice(1)) {
      const days = Number(String(row[0]).match(TIMESTAMP_SENTINEL)[1]);
      assert.ok(days <= 29, `${range} event ${days} days ago is outside the window`);
    }
  }
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
