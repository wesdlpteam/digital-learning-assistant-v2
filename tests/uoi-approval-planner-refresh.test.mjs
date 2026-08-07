// tests/uoi-approval-planner-refresh.test.mjs
//
// Regression cover for the 2026-08-07 report: a teacher rewrote the Central
// Idea + Lines of Inquiry for Elsternwick Year 4 "How the World Works" (natural
// disasters -> scientific investigations), the edit was approved, ideas
// regenerated a minute later, and all six came back about bushfires, floods and
// earthquakes.
//
// Cause: approval wrote the new ci/lo but left the unit's planner-derived text
// alone. plannerText (a summary of the OLD planner) is injected into every regen
// prompt as "Planner context" and is longer and more concrete than the new
// ci/lo, so the model kept writing the old unit.
//
// These tests eval the real functions straight out of gas_backend/Code.js so a
// mirrored copy can't drift away from what actually ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'gas_backend', 'Code.js'), 'utf8');

// Pull a top-level `function name(...) { ... }` out of Code.js by brace matching.
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in gas_backend/Code.js`);
  let depth = 0, i = source.indexOf('{', start);
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  assert.ok(i < source.length, `unbalanced braces in ${name}`);
  return source.slice(start, i + 1);
}

const sandbox = new Function(
  extractFunction('_repairContamPlannerText_') + '\n' +
  extractFunction('uoiRefreshUnitContextAfterEdit_') + '\n' +
  extractFunction('uoiEditNewerThanPlanner_') + '\n' +
  'return { uoiRefreshUnitContextAfterEdit_, uoiEditNewerThanPlanner_ };'
)();

const OLD_TOPIC = /bushfire|flood|earthquake|natural disaster|geological/i;

// The unit exactly as it sat in data.json after the teacher's edit was approved.
function elsternwickY4() {
  return {
    ca: 'Elsternwick',
    yl: 'Year 4',
    th: 'How the World Works',
    ci: 'Scientific investigations help us understand interactions within systems.',
    lo: 'Interactions between objects, materials and living things\nGathering and analysing evidence\nHow scientific knowledge develops',
    plannerText:
      "The Year 4 'How the World Works' unit explores the causes and effects of natural disasters, " +
      'geological change, and community responses. Students investigate bushfires, earthquakes, ' +
      'floods, and other disasters through research, experiments, mapping, and case studies.',
    plannerContextRich: 'Theme: How the World Works\n'.padEnd(4000, 'x'),
    plannerContextRichAt: '2026-03-01T00:00:00.000Z',
    stemRebooted: true,
    audited: true
  };
}

test('rebuilds the planner summary from the new Central Idea and Lines of Inquiry', () => {
  const unit = elsternwickY4();
  uoiRefreshUnitContextAfterEditCall(unit);
  assert.ok(unit.plannerText.includes('Scientific investigations help us understand'));
  assert.ok(unit.plannerText.includes('Gathering and analysing evidence'));
});

test('leaves no trace of the old planner topic anywhere the regen prompt reads', () => {
  const unit = elsternwickY4();
  uoiRefreshUnitContextAfterEditCall(unit);
  // inspiringBuildPrompt_ / diversityBuildPrompt_ / the slot regens all read
  // target.plannerText; rebootMakerspace falls back to plannerContextRich.
  const seenByPrompts = [unit.plannerText || '', unit.plannerContextRich || ''].join(' ');
  assert.doesNotMatch(seenByPrompts, OLD_TOPIC);
});

test('drops the stale whole-year planner blob and its timestamp', () => {
  const unit = elsternwickY4();
  uoiRefreshUnitContextAfterEditCall(unit);
  assert.equal(unit.plannerContextRich, undefined);
  assert.equal(unit.plannerContextRichAt, undefined);
});

test('unlocks the cached STEM project so the 6th slot cannot be healed back', () => {
  const unit = elsternwickY4();
  uoiRefreshUnitContextAfterEditCall(unit);
  assert.equal(unit.stemRebooted, false);
});

test('never leaves the old summary behind when the edit clears the details', () => {
  const unit = elsternwickY4();
  unit.ci = '';
  unit.lo = '';
  uoiRefreshUnitContextAfterEditCall(unit);
  assert.doesNotMatch(unit.plannerText || '', OLD_TOPIC);
});

test('reports what it cleared so approval can log it', () => {
  const cleared = sandbox.uoiRefreshUnitContextAfterEdit_(elsternwickY4());
  assert.equal(cleared.plannerTextRebuilt, true);
  assert.equal(cleared.plannerContextRichDropped, true);
  assert.equal(cleared.stemUnlocked, true);
});

test('tolerates a missing unit', () => {
  assert.doesNotThrow(() => sandbox.uoiRefreshUnitContextAfterEdit_(null));
});

test('planner re-import is blocked while the teacher edit is the newer of the two', () => {
  const entry = { uoiEditApprovedAt: '2026-08-07T00:57:09.663Z' };
  const plannerFileSaved = Date.parse('2026-03-01T00:00:00.000Z');
  assert.equal(sandbox.uoiEditNewerThanPlanner_(entry, plannerFileSaved), true);
});

test('planner re-import is allowed again once the planner file itself is updated', () => {
  const entry = { uoiEditApprovedAt: '2026-08-07T00:57:09.663Z' };
  const plannerFileSaved = Date.parse('2026-08-08T09:00:00.000Z');
  assert.equal(sandbox.uoiEditNewerThanPlanner_(entry, plannerFileSaved), false);
});

test('units with no approved teacher edit are never blocked from enrichment', () => {
  assert.equal(sandbox.uoiEditNewerThanPlanner_({}, Date.now()), false);
});

function uoiRefreshUnitContextAfterEditCall(unit) {
  return sandbox.uoiRefreshUnitContextAfterEdit_(unit);
}
