import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunctions, loadConstants } from './helpers/extract-functions.mjs';

// Regression cover for the Tech Champions points split reported 14 Sep 2026:
// St Kilda Road Year 5 read 9 points, then 2, because the Used/Intent sheets
// hold two spellings of the same campus — 'St Kilda Rd' on rows written before
// commit e1264ab, 'St Kilda Road' on rows written after it. The collector keyed
// teams on the raw cell value, so one team scored as two; the page then keyed on
// the tidied name and, on the collision, kept the last row instead of the total.

const COLLECTOR = 'gas_analytics/Code.js';
const PAGE = 'index.html';

// Real rows from the live DLA_Feedback sheet, fetched 14 Sep 2026.
// Columns: Timestamp, Team, Campus, Year Level, Theme, Tool, Phase
const HEADER = ['Timestamp', 'Team', 'Campus', 'Year Level', 'Theme', 'Tool', 'Phase'];
const USED_ROWS = [
  ['', '', 'St Kilda Rd', 'Year 5', 'Sharing the Planet', 'Minecraft: Ocean Heroes', 'Suggestion'],
  ['', '', 'Elsternwick', 'Year 3', 'How We Express Ourselves', 'Canva + Freeform', 'Suggestion'],
  ['', '', 'Elsternwick', 'Year 3', 'How We Express Ourselves', 'Epic + Sketchbook', 'Suggestion'],
  ['', '', 'St Kilda Rd', 'Year 5', 'How the World Works', 'Merge Cubes', 'Teacher-picked tool'],
  ['', '', 'St Kilda Rd', 'Year 5', 'How the World Works', 'Minecraft Education', 'Suggestion'],
  ['', '', 'Elsternwick', 'Year 3', 'Where We Are in Place and Time', 'National Geographic MapMaker', 'Suggestion'],
  ['', '', 'Glen Waverley', 'Year 6', 'How We Express Ourselves', 'Podcast Equipment', 'Suggestion'],
  ['', '', 'St Kilda Road', 'Year 5', 'How the World Works', 'Microsoft Forms', 'Suggestion']
];
const INTENT_ROWS = [
  ['', '', 'St Kilda Rd', 'Prep', 'Sharing the Planet', 'ChatterPix Kids', 'Suggestion'],
  ['', '', 'St Kilda Rd', 'Prep', 'Sharing the Planet', 'Seek by iNaturalist', 'Suggestion'],
  ['', '', 'St Kilda Rd', 'Year 5', 'How the World Works', 'Merge Cubes', 'Teacher-picked tool'],
  ['', '', 'St Kilda Rd', 'Year 5', 'How the World Works', 'Minecraft Education', 'Suggestion'],
  ['', '', 'St Kilda Rd', 'Year 5', 'How the World Works', 'Tinkercad', 'Teacher-picked tool'],
  ['', '', 'Elsternwick', 'Year 3', 'Who We Are', 'Epic', 'Suggestion'],
  ['', '', 'Elsternwick', 'Year 3', 'Who We Are', 'Seek by iNaturalist', 'Suggestion'],
  ['', '', 'Elsternwick', 'Year 3', 'Sharing the Planet', 'Padlet', 'Suggestion'],
  ['', '', 'Glen Waverley', 'Year 2', 'How the World Works (Solar System)', 'Delightex', 'Suggestion'],
  ['', '', 'St Kilda Road', 'Year 2', 'How the World Works', 'Seesaw', 'Suggestion'],
  ['', '', 'St Kilda Road', 'Year 2', 'How the World Works', 'Puppet Pals', 'Suggestion'],
  ['', '', 'Glen Waverley', 'Year 4', 'Who We Are', 'Microsoft Forms', 'Suggestion'],
  ['', '', 'Glen Waverley', 'Year 4', 'Who We Are', 'Padlet', 'Suggestion'],
  ['', '', 'Elsternwick', 'Prep', 'Sharing the Planet', 'Beebots', 'Suggestion']
];

function fakeSheet(rows) {
  return { getDataRange: () => ({ getValues: () => [HEADER].concat(rows) }) };
}

function loadCollector(usedRows = USED_ROWS, intentRows = INTENT_ROWS) {
  const consts = loadConstants(COLLECTOR, [
    'SHEETS', 'POINTS_PER_USED', 'POINTS_PER_INTENT', 'POINTS_PER_STREAK',
    'STREAK_USES_REQUIRED', 'CELL_MAX_LEN'
  ]);
  const sheets = { [consts.SHEETS.USED]: fakeSheet(usedRows), [consts.SHEETS.INTENT]: fakeSheet(intentRows) };
  return loadFunctions(
    COLLECTOR,
    ['clean_', 'normaliseCampus_', 'normaliseYear_', 'cleanCampus_', 'cleanYear_',
     'aggregateLeaderboard_', 'getKeysFromSheet_'],
    { ...consts, ensureSheet_: (_ss, name) => sheets[name] }
  );
}

function findTeam(teams, campus, year) {
  return teams.filter(t => t.campus === campus && t.year === year);
}

test('collector scores one St Kilda Road Year 5 team, not two', () => {
  const { aggregateLeaderboard_ } = loadCollector();
  const teams = aggregateLeaderboard_({});
  const y5 = findTeam(teams, 'St Kilda Road', 'Year 5');
  assert.equal(y5.length, 1, 'both campus spellings fold into one team');
  assert.equal(teams.filter(t => t.campus === 'St Kilda Rd').length, 0, 'no short-form team survives');
});

test('St Kilda Road Year 5 keeps every point it earned', () => {
  const { aggregateLeaderboard_ } = loadCollector();
  const [y5] = findTeam(aggregateLeaderboard_({}), 'St Kilda Road', 'Year 5');
  // 4 used x 2 + 3 intent x 1 + one streak bonus (3 uses in How the World Works)
  assert.equal(y5.points, 14);
  assert.equal(y5.streaks, 1);
});

test('the streak bonus counts uses across both campus spellings', () => {
  // Drop the row written under the new spelling: the unit falls to 2 uses and
  // the bonus must not fire, proving the bonus above came from the third use.
  const { aggregateLeaderboard_ } = loadCollector(USED_ROWS.slice(0, 7));
  const [y5] = findTeam(aggregateLeaderboard_({}), 'St Kilda Road', 'Year 5');
  assert.equal(y5.streaks, 0);
  assert.equal(y5.points, 9);
});

test('other campuses are untouched by the normalisation', () => {
  const { aggregateLeaderboard_ } = loadCollector();
  const teams = aggregateLeaderboard_({});
  const [el3] = findTeam(teams, 'Elsternwick', 'Year 3');
  assert.equal(el3.points, 9, '3 used + 3 intent');
  const [gw6] = findTeam(teams, 'Glen Waverley', 'Year 6');
  assert.equal(gw6.points, 2);
  const [skr2] = findTeam(teams, 'St Kilda Road', 'Year 2');
  assert.equal(skr2.points, 2, 'two intents');
});

test('button-state keys come back under the tidy campus name', () => {
  const { getKeysFromSheet_ } = loadCollector();
  const keys = getKeysFromSheet_({}, 'Used');
  assert.ok(
    keys.includes('St Kilda Road|Year 5|How the World Works|Merge Cubes|Teacher-picked tool'),
    'an old short-form row still matches the key the page builds'
  );
  assert.equal(keys.filter(k => k.startsWith('St Kilda Rd|')).length, 0);
});

test('the page adds up duplicate rows for one team instead of keeping the last', () => {
  const { mergeLeaderboard } = loadFunctions(
    PAGE,
    ['normaliseCampusName', 'normaliseYearName', 'foldLeaderboardRows', 'mergeLeaderboard']
  );
  // Mimics a collector that has not been redeployed yet: two rows, one team.
  const merged = mergeLeaderboard([], [
    { campus: 'St Kilda Rd', year: 'Year 5', points: 9, streaks: 0 },
    { campus: 'St Kilda Road', year: 'Year 5', points: 2, streaks: 0 }
  ]);
  const y5 = merged.filter(t => t.campus === 'St Kilda Road' && t.year === 'Year 5');
  assert.equal(y5.length, 1);
  assert.equal(y5[0].points, 11, 'shows the real total, not 9 or 2');
});

test('a fresh payload replaces the cached figure rather than stacking on it', () => {
  const { mergeLeaderboard } = loadFunctions(
    PAGE,
    ['normaliseCampusName', 'normaliseYearName', 'foldLeaderboardRows', 'mergeLeaderboard']
  );
  const cached = [{ campus: 'St Kilda Road', year: 'Year 5', points: 11, streaks: 0 }];
  const fresh = [{ campus: 'St Kilda Road', year: 'Year 5', points: 14, streaks: 1 }];
  const merged = mergeLeaderboard(cached, fresh);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].points, 14);
  assert.equal(merged[0].streaks, 1);
});
