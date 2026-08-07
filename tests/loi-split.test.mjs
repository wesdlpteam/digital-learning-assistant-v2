// tests/loi-split.test.mjs
//
// Regression cover for the 2026-08-07 report: Elsternwick Year 4 "How the World
// Works" showed all three Lines of Inquiry run together on one numbered row in
// the Studio. The teacher typed them one per line; the Studio only split on
// semicolons and bullets, so the whole lot arrived as a single "01".
//
// The public site (index.html splitLinesOfInquiry) already handled line breaks.
// This pins the Studio's shared helper to the same behaviour, reading both
// functions out of the real source so they cannot drift apart again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function loadFunction(file, name) {
  const source = readFileSync(join(root, file), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in ${file}`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return new Function(source.slice(start, i + 1) + `\nreturn ${name};`)();
}

const studioSplit = loadFunction('js/00-config-state-utils.js', 'splitLinesOfInquiry');
const publicSplit = loadFunction('index.html', 'splitLinesOfInquiry');

// Exactly what the teacher submitted for Elsternwick Year 4.
const TYPED_ONE_PER_LINE =
  'Interactions between objects, materials and living things\n' +
  'Gathering and analysing evidence\n' +
  'How scientific knowledge develops';

const SEMICOLONS =
  'The causes of geological change over time; How extreme environments cause natural disasters; The impact of natural events on communities';

test('splits Lines of Inquiry typed one per line', () => {
  assert.deepEqual(studioSplit(TYPED_ONE_PER_LINE), [
    'Interactions between objects, materials and living things',
    'Gathering and analysing evidence',
    'How scientific knowledge develops'
  ]);
});

test('still splits the semicolon style the older units use', () => {
  assert.equal(studioSplit(SEMICOLONS).length, 3);
  assert.equal(studioSplit(SEMICOLONS)[0], 'The causes of geological change over time');
});

test('splits bullets and mixed separators', () => {
  assert.deepEqual(studioSplit('One • Two\nThree; Four'), ['One', 'Two', 'Three', 'Four']);
});

test('strips leading dashes and bullet characters from each line', () => {
  assert.deepEqual(studioSplit('- One\n– Two\n— Three'), ['One', 'Two', 'Three']);
});

test('drops blank lines instead of numbering them', () => {
  assert.deepEqual(studioSplit('One\n\n\nTwo\n  \nThree'), ['One', 'Two', 'Three']);
});

test('handles empty and missing input', () => {
  assert.deepEqual(studioSplit(''), []);
  assert.deepEqual(studioSplit(null), []);
  assert.deepEqual(studioSplit(undefined), []);
});

test('a single unbroken line stays one line', () => {
  assert.deepEqual(studioSplit('Only one line of inquiry'), ['Only one line of inquiry']);
});

test('Studio and public site agree on every shape', () => {
  for (const input of [TYPED_ONE_PER_LINE, SEMICOLONS, 'One • Two\nThree; Four', '- One\n– Two', '', 'Solo']) {
    assert.deepEqual(studioSplit(input), publicSplit(input), `disagreed on: ${JSON.stringify(input)}`);
  }
});
