import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transformHtml, replaceAnchor, ANCHORS,
  transformStudioHtml, transformStudioJs00, neutraliseHosts
} from '../tools/lib/transform-html.mjs';

const STUDIO_SAMPLE = [
  '<!DOCTYPE html>',
  '<html lang="en"><head><meta charset="UTF-8">',
  '<script src="https://accounts.google.com/gsi/client" async defer></script>',
  '<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>',
  '<link rel="stylesheet" href="css/studio.css?v=5.62">',
  '</head>',
  '<body>',
  '<div id="app-content"></div>',
  '<script src="js/00-config-state-utils.js?v=5.55"></script>',
  '</body></html>'
].join('\n');

const JS00_SAMPLE = [
  'let DATA = [];',
  "const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzIoUL_vbTaH4P7PXuX8HeU9Xh6HuiEWJ05k7q50aJjCg7oeF-ELrlLuPx8uxPFHmE-eA/exec';",
  "const CLIENT_ID = '334712966315-9diac0qcv57168kn378i5js2ikgqqvpt.apps.googleusercontent.com';",
  "const ANALYTICS_SHEET_ID = '1R4P4FJlc8SyRFlVWoM0HpHmfCNMNVOpI8cuEILFxBNY';"
].join('\n');

const SAMPLE = [
  `<html lang="en"><head><meta charset="UTF-8">`,
  `<script>window.APP_VERSION='2026-07-20-1';</script>`,
  `@media(max-width:430px){.admin-btn{font-size:0}.admin-btn::after{content:'Admin';font-size:11px}}`,
  `</head><body><div id="app"></div>`,
  `<script>`,
  `const ADMIN_URL="https://wesdlpteam.github.io/digital-learning-assistant-v2/DLA_Studio.html";`,
  `h+='<a class="admin-btn" href="'+ADMIN_URL+'" target="_blank" rel="noopener" title="Open DLA Studio admin"><span class="admin-ico">🔒</span><span>Admin</span></a>';`,
  `</script>`,
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

test('admin button points at the demo Studio, never the live one', () => {
  const out = transformHtml(SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('const ADMIN_URL="studio.html"'));
  assert.equal(out.includes('digital-learning-assistant-v2/DLA_Studio.html'), false);
});

test('admin button is inviting rather than locked', () => {
  const out = transformHtml(SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('See behind the scenes'));
  assert.equal(out.includes('🔒'), false);
  assert.equal(/<span>Admin<\/span>/.test(out), false);
});

test('admin button label is also replaced on phone widths', () => {
  const out = transformHtml(SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes("content:'Behind the scenes'"));
  assert.equal(out.includes("content:'Admin'"), false);
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

/* ---------- Studio ---------- */

test('studio: removes the Google sign-in library', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.equal(out.includes('accounts.google.com'), false);
});

test('studio: keeps the echarts CDN, which the analytics screens need', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('echarts'));
});

test('studio: preserves the versioned stylesheet while injecting demo assets', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('<link rel="stylesheet" href="css/studio.css?v=5.62">'));
});

test('studio: guard lands before the js/ scripts, shim after them', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE, { guardJs: 'GUARD_MARKER', shimJs: 'SHIM_MARKER' });
  const guard = out.indexOf('GUARD_MARKER');
  const firstJs = out.indexOf('js/00-config-state-utils.js');
  const shim = out.indexOf('SHIM_MARKER');
  assert.ok(guard > -1 && guard < firstJs, 'guard must precede the Studio scripts');
  assert.ok(shim > firstJs, 'shim must follow the Studio scripts');
});

test('studio: a $ in the guard source is not eaten by replace()', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE, { guardJs: 'var a="$&$1$`";', shimJs: '/*s*/' });
  assert.ok(out.includes('var a="$&$1$`";'));
});

test('studio: throws by name when an anchor is missing', () => {
  assert.throws(
    () => transformStudioHtml('<html></html>', { guardJs: '/*g*/', shimJs: '/*s*/' }),
    /anchor "GSI" not found in DLA_Studio\.html/
  );
});

test('studio js/00: neuters all three endpoint constants', () => {
  const out = transformStudioJs00(JS00_SAMPLE);
  assert.equal(out.includes('script.google.com'), false);
  assert.equal(out.includes('apps.googleusercontent.com'), false);
  assert.equal(out.includes('1R4P4FJlc8SyRFlVWoM0HpHmfCNMNVOpI8cuEILFxBNY'), false);
  assert.ok(out.includes('sandbox://blocked'));
});

test('studio js/00: leaves unrelated declarations alone', () => {
  const out = transformStudioJs00(JS00_SAMPLE);
  assert.ok(out.includes('let DATA = [];'));
});

test('studio js/00: throws by name when a constant has drifted', () => {
  assert.throws(
    () => transformStudioJs00('let DATA = [];'),
    /anchor "SCRIPT_URL" not found in js\/00-config-state-utils\.js/
  );
});

test('neutraliseHosts strips every Drive, Sheets, OAuth and backend URL', () => {
  const src = [
    "fetch('https://www.googleapis.com/drive/v3/files/' + id)",
    "fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid)",
    "location = 'https://accounts.google.com/o/oauth2/v2/auth'",
    "fetch('https://script.google.com/macros/s/x/exec')"
  ].join('\n');
  const out = neutraliseHosts(src);
  assert.equal(/googleapis\.com|accounts\.google\.com|script\.google\.com/.test(out), false);
  assert.equal((out.match(/sandbox:\/\/blocked/g) || []).length, 4);
});

test('neutraliseHosts leaves the surrounding code intact', () => {
  const out = neutraliseHosts("fetch('https://www.googleapis.com/drive/v3/files/' + id, opts)");
  assert.ok(out.includes("/drive/v3/files/' + id, opts)"));
});

test('neutraliseHosts is a no-op on code with no such URLs', () => {
  assert.equal(neutraliseHosts('let DATA = [];'), 'let DATA = [];');
});

test('studio: hides the Connect-Google-Drive startup screen from first paint', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('#screen-load{display:none!important}'));
  // the rule must be in the head, before the body renders, or it flashes
  assert.ok(out.indexOf('#screen-load{display:none') < out.indexOf('<body>'));
});

test('studio: shows a neutral demo loading note instead', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('id="sandbox-loading"'));
  assert.ok(out.includes('Loading the DLA Studio demo'));
  assert.equal(/Connect Google Drive/i.test(out), false);
});

test('studio: preloads the demo data so it downloads alongside the scripts', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE, { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.ok(out.includes('rel="preload" as="fetch" href="studio-data.json"'));
  assert.ok(out.includes('rel="preload" as="fetch" href="studio-analytics.json"'));
});

test('studio: handles a CRLF working copy', () => {
  const out = transformStudioHtml(STUDIO_SAMPLE.replace(/\n/g, '\r\n'), { guardJs: '/*g*/', shimJs: '/*s*/' });
  assert.equal(out.includes('accounts.google.com'), false);
});
