import test from 'node:test';
import assert from 'node:assert/strict';
import { slimUnits, KEEP_FIELDS, DROPPED_FIELDS } from '../tools/lib/slim-data.mjs';

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
