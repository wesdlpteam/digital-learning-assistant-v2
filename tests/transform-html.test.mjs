import test from 'node:test';
import assert from 'node:assert/strict';
import { transformHtml, replaceAnchor, ANCHORS } from '../tools/lib/transform-html.mjs';

const SAMPLE = [
  `<html lang="en"><head><meta charset="UTF-8">`,
  `<script>window.APP_VERSION='2026-07-20-1';</script>`,
  `</head><body><div id="app"></div>`,
  `<script>`,
  `const AI_HOOK = "https://script.google.com/macros/s/AKfycbzIoUL_vbTaH4P7PXuX8HeU9Xh6HuiEWJ05k7q50aJjCg7oeF-ELrlLuPx8uxPFHmE-eA/exec";`,
  `const FBHOOK="https://script.google.com/macros/s/AKfycbwFSbbn_1IaTst0ujfzBiQpE5pGpo07UL8yxemoHOudXzPHxKmKJvkgW2jvivf9yr9Alg/exec";`,
  ``,
  `loadLeaderboard();`,
  `readHash();`,
  `(function(){`,
  `  var CUR=window.APP_VERSION; if(!CUR) return;`,
  `  setInterval(function(){ check(document.hidden); },120000);`,
  `})();`,
  `</script>`,
  ``
].join('\n');

test('every declared anchor is found exactly once in the sample', () => {
  for (const key of Object.keys(ANCHORS)) {
    assert.doesNotThrow(() => replaceAnchor(SAMPLE, key), `anchor ${key} should be found`);
  }
});

test('throws a named error when an anchor is missing', () => {
  assert.throws(
    () => replaceAnchor('<html></html>', 'AI_HOOK'),
    /anchor "AI_HOOK" not found/
  );
});

test('throws when an anchor appears more than once', () => {
  const doubled = SAMPLE + '\nloadLeaderboard();\n';
  assert.throws(() => replaceAnchor(doubled, 'BOOT_LEADERBOARD'), /appears 2 times/);
});

test('removes every reference to script.google.com', () => {
  const out = transformHtml(SAMPLE, { guardJs: '/*guard*/', shimJs: '/*shim*/' });
  assert.equal(out.includes('script.google.com'), false);
});

test('injects the guard before the main page script', () => {
  const out = transformHtml(SAMPLE, { guardJs: 'GUARD_MARKER', shimJs: 'SHIM_MARKER' });
  assert.ok(out.indexOf('GUARD_MARKER') < out.indexOf('const AI_HOOK'));
});

test('appends the shim after all page code', () => {
  const out = transformHtml(SAMPLE, { guardJs: 'GUARD_MARKER', shimJs: 'SHIM_MARKER' });
  assert.ok(out.indexOf('SHIM_MARKER') > out.indexOf('readHash();'));
});

test('removes the boot-time leaderboard call', () => {
  const out = transformHtml(SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.equal(/\nloadLeaderboard\(\);\n/.test(out), false);
});

test('disables the auto-update poller', () => {
  const out = transformHtml(SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('sandbox: auto-update poller disabled'));
});

test('leaves unrelated markup untouched', () => {
  const out = transformHtml(SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('<div id="app"></div>'));
  assert.ok(out.includes('readHash();'));
});

test('handles a CRLF working copy, which is what git checks out on Windows', () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  const out = transformHtml(crlf, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.equal(out.includes('script.google.com'), false);
  assert.ok(out.includes('sandbox: boot leaderboard call removed'));
  assert.ok(out.includes('sandbox: auto-update poller disabled'));
});

test('requires both injected scripts', () => {
  assert.throws(() => transformHtml(SAMPLE, { guardJs: '/*g*/' }), /requires guardJs and shimJs/);
});
