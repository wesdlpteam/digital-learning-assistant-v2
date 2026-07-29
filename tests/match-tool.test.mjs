import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserScript } from './helpers/load-browser-script.mjs';

const { matchToolToSuggestion } = loadBrowserScript(
  'tools/browser/match-tool.js',
  ['matchToolToSuggestion']
);

const SUGGESTIONS = [
  { t: 'Animating a Character with Adobe Express', d: 'Adobe idea.' },
  { t: 'Scratch', d: 'Scratch idea.' },
  { t: 'Sensing the Playground with micro:bit', d: 'Microbit idea.' }
];

test('exact match on the activity name', () => {
  const hit = matchToolToSuggestion('Scratch', SUGGESTIONS);
  assert.equal(hit.d, 'Scratch idea.');
});

test('matches a tool named inside a longer activity title', () => {
  const hit = matchToolToSuggestion('Adobe Express', SUGGESTIONS);
  assert.equal(hit.d, 'Adobe idea.');
});

test('ignores case and punctuation differences', () => {
  const hit = matchToolToSuggestion('microbit', SUGGESTIONS);
  assert.equal(hit.d, 'Microbit idea.');
});

test('prefers an exact activity-name match over a substring match', () => {
  const suggestions = [
    { t: 'Building a Quiz with Scratch', d: 'substring one' },
    { t: 'Scratch', d: 'exact one' }
  ];
  assert.equal(matchToolToSuggestion('Scratch', suggestions).d, 'exact one');
});

test('returns null when nothing matches', () => {
  assert.equal(matchToolToSuggestion('Tinkercad', SUGGESTIONS), null);
});

test('returns null for empty or missing input', () => {
  assert.equal(matchToolToSuggestion('', SUGGESTIONS), null);
  assert.equal(matchToolToSuggestion('Scratch', null), null);
  assert.equal(matchToolToSuggestion('Scratch', []), null);
});

test('refuses to match on fewer than three characters, to avoid false hits', () => {
  assert.equal(matchToolToSuggestion('a', SUGGESTIONS), null);
  assert.equal(matchToolToSuggestion('ex', SUGGESTIONS), null);
});

test('tolerates malformed suggestion entries', () => {
  const messy = [null, { d: 'no tool name' }, { t: 'Scratch', d: 'good' }];
  assert.equal(matchToolToSuggestion('Scratch', messy).d, 'good');
});
