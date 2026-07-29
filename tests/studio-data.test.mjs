import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStudioUnits, PLANNER_TEXT_LIMIT } from '../tools/lib/studio-data.mjs';

const UNITS = [
  { ca: 'Glen Waverley', yl: '3 Year Old Kinder', th: 'Who We Are', s: [] },
  { ca: 'Elsternwick', yl: 'Prep', th: 'How We Express Ourselves', ci: 'Stories.', lo: 'An inquiry', s: [{ t: 'Scratch', d: 'idea' }], humanVerified: false, audited: false, plannerText: 'RAW' },
  { ca: 'St Kilda', yl: '4 Year Old Kinder', th: 'How the World Works', s: [] },
  { ca: 'Glen Waverley', yl: 'Year 6', th: 'Sharing the Planet', ci: 'Water.', s: [{ t: 'Epic', d: 'idea' }] }
];

test('drops every Kinder unit', () => {
  const out = prepareStudioUnits(UNITS);
  assert.equal(out.length, 2);
  assert.equal(out.some(u => /Kinder/i.test(u.yl)), false);
});

test('marks every remaining unit human-verified and audited', () => {
  const out = prepareStudioUnits(UNITS);
  assert.equal(out.every(u => u.humanVerified === true), true);
  assert.equal(out.every(u => u.audited === true), true);
});

test('preserves order of the units it keeps', () => {
  const out = prepareStudioUnits(UNITS);
  assert.deepEqual(out.map(u => u.th), ['How We Express Ourselves', 'Sharing the Planet']);
});

test('keeps the full field set, unlike the public-site slimmer', () => {
  const out = prepareStudioUnits(UNITS);
  const prep = out.find(u => u.yl === 'Prep');
  assert.equal(prep.plannerText, 'RAW');
  assert.equal(prep.ci, 'Stories.');
  assert.deepEqual(prep.s, [{ t: 'Scratch', d: 'idea' }]);
});

test('does not mutate the input units', () => {
  const input = [{ ca: 'X', yl: 'Prep', th: 'T', humanVerified: false }];
  prepareStudioUnits(input);
  assert.equal(input[0].humanVerified, false);
});

test('throws on a non-array input', () => {
  assert.throws(() => prepareStudioUnits(null), /expects an array/);
});

test('truncates plannerText to the limit but keeps more than the UI shows (600)', () => {
  const long = 'x'.repeat(50000);
  const [out] = prepareStudioUnits([{ ca: 'X', yl: 'Prep', th: 'T', plannerText: long }]);
  assert.equal(out.plannerText.length, PLANNER_TEXT_LIMIT);
  assert.ok(PLANNER_TEXT_LIMIT > 600, 'must keep more than the 600 chars the UI renders');
});

test('leaves a short plannerText alone', () => {
  const [out] = prepareStudioUnits([{ ca: 'X', yl: 'Prep', th: 'T', plannerText: 'short note' }]);
  assert.equal(out.plannerText, 'short note');
});

test('drops plannerContextRich, which only ever fed AI prompts', () => {
  const [out] = prepareStudioUnits([{ ca: 'X', yl: 'Prep', th: 'T', plannerContextRich: 'big blob' }]);
  assert.equal('plannerContextRich' in out, false);
});

test('tolerates a unit with no plannerText at all', () => {
  const [out] = prepareStudioUnits([{ ca: 'X', yl: 'Prep', th: 'T' }]);
  assert.equal('plannerText' in out, false);
});
