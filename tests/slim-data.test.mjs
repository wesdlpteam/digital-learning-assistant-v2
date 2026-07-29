import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slimUnits, KEEP_FIELDS, DROPPED_FIELDS,
  dropExcludedYearLevels, EXCLUDED_YEAR_LEVELS
} from '../tools/lib/slim-data.mjs';

const FULL_UNIT = {
  ca: 'Elsternwick',
  yl: 'Prep',
  th: 'How We Express Ourselves',
  ci: 'Stories connect us.',
  lo: 'An inquiry into stories',
  s: [{ t: 'Adobe Express', d: 'Some idea.' }],
  audited: true,
  humanVerified: true,
  stemRebooted: false,
  plannerText: 'RAW PLANNER PROSE',
  plannerContextRich: 'MORE RAW PROSE',
  diversityRegenAt: '2026-01-01',
  inspiringRegenRecovered: 1,
  inspiringRegenAutoSwapped: 0,
  inspiringRegenAt: '2026-01-02',
  inspiringRegenAtVersion: 'v5.50',
  suggestionAuditAt: '2026-01-03',
  suggestionAuditVersion: 'v5.51'
};

test('keeps exactly the six fields the public site reads', () => {
  const [out] = slimUnits([FULL_UNIT]);
  assert.deepEqual(Object.keys(out).sort(), [...KEEP_FIELDS].sort());
});

test('drops raw planner prose', () => {
  const [out] = slimUnits([FULL_UNIT]);
  assert.equal(out.plannerText, undefined);
  assert.equal(out.plannerContextRich, undefined);
});

test('preserves values of kept fields including nested suggestions', () => {
  const [out] = slimUnits([FULL_UNIT]);
  assert.equal(out.ca, 'Elsternwick');
  assert.equal(out.ci, 'Stories connect us.');
  assert.deepEqual(out.s, [{ t: 'Adobe Express', d: 'Some idea.' }]);
});

test('preserves array order exactly', () => {
  const units = [
    { ...FULL_UNIT, ci: 'first' },
    { ...FULL_UNIT, ci: 'second' },
    { ...FULL_UNIT, ci: 'third' }
  ];
  assert.deepEqual(slimUnits(units).map(u => u.ci), ['first', 'second', 'third']);
});

test('omits kept fields that are absent rather than writing undefined', () => {
  const [out] = slimUnits([{ ca: 'X', yl: 'Y', th: 'T', s: [] }]);
  assert.equal('ci' in out, false);
  assert.equal('lo' in out, false);
});

test('DROPPED_FIELDS and KEEP_FIELDS do not overlap', () => {
  const overlap = KEEP_FIELDS.filter(f => DROPPED_FIELDS.includes(f));
  assert.deepEqual(overlap, []);
});

test('throws on a non-array input', () => {
  assert.throws(() => slimUnits(null), /expects an array/);
});

test('drops both Kinder year levels and keeps everything else in order', () => {
  const units = [
    { ca: 'Elsternwick', yl: '3 Year Old Kinder', th: 'A' },
    { ca: 'Elsternwick', yl: 'Prep', th: 'B' },
    { ca: 'St Kilda', yl: '4 Year Old Kinder', th: 'C' },
    { ca: 'St Kilda', yl: 'Year 6', th: 'D' }
  ];
  assert.deepEqual(dropExcludedYearLevels(units).map(u => u.th), ['B', 'D']);
});

test('leaves a corpus with no Kinder untouched', () => {
  const units = [{ ca: 'X', yl: 'Prep', th: 'A' }, { ca: 'X', yl: 'Year 1', th: 'B' }];
  assert.equal(dropExcludedYearLevels(units).length, 2);
});

test('EXCLUDED_YEAR_LEVELS names both Kinder levels exactly as the data spells them', () => {
  assert.deepEqual(EXCLUDED_YEAR_LEVELS, ['3 Year Old Kinder', '4 Year Old Kinder']);
});

test('dropExcludedYearLevels throws on a non-array input', () => {
  assert.throws(() => dropExcludedYearLevels(null), /expects an array/);
});
