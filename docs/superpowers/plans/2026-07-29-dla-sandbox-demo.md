# DLA Sandbox Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable script that generates an unplugged sandbox copy of the public DLA site — no AI calls, no analytics, slimmed data — and publish it to its own GitHub Pages site for the 2026 webinar and conference.

**Architecture:** A Node build script in the main repo reads the live `index.html`, `data.json` and `libraries.json`, applies anchored text transforms plus two injected browser scripts, and writes a complete static site into a sibling output directory. All transform logic lives in small pure modules with unit tests. The source repo's own files are never modified. Verification guards run at the end of every build and fail the build loudly.

**Tech Stack:** Node 24 (v24.15.0 confirmed installed), built-in `node:test` runner and `node:assert/strict` — **zero npm dependencies**. Output is plain static HTML/JS served by GitHub Pages.

## Global Constraints

- **No npm dependencies.** The repo has no `package.json` and must not gain one beyond a minimal `{"type":"module"}` stub for the test runner. Use only Node built-ins.
- **The source repo's site files are read-only to this work.** `index.html`, `data.json`, `libraries.json`, `css/`, `js/`, `gas_backend/`, `gas_analytics/` must be byte-for-byte unchanged when the work is done. Only `tools/`, `tests/`, `docs/` and `.gitignore` may gain files.
- **Fail loudly, never silently.** Every transform anchors on an exact string. If an anchor is not found, throw with a message naming the anchor. Never fall back to a no-op.
- **Zero cross-origin network requests from the sandbox at runtime.** This is the money guarantee and the primary acceptance test.
- **Unit array order in `data.json` must be preserved exactly.** Unit indices appear in URL hashes.
- **Fields the public site reads, and the only ones kept:** `ca`, `yl`, `th`, `ci`, `lo`, `s`.
- **Fields dropped:** `plannerText`, `plannerContextRich`, `audited`, `humanVerified`, `stemRebooted`, `diversityRegenAt`, `inspiringRegenRecovered`, `inspiringRegenAutoSwapped`, `inspiringRegenAt`, `inspiringRegenAtVersion`, `suggestionAuditAt`, `suggestionAuditVersion`.
- **Suggestion objects are `{t, d}` only.** They carry no `steps`, `valueAdd`, `fit` or `fitNote`. The sandbox must never invent those fields.
- **Badge copy, verbatim:** `Sandbox demo — not live data`
- **Output directory default:** `../dla-sandbox` relative to the repo root, overridable with `--out <path>`.
- **Sandbox repo:** `wesdlpteam/dla-sandbox`, public, GitHub Pages served from `main` root.
- **Line endings:** the repo has `core.autocrlf=true`. Write new files with `\n` and let git normalise. Do **not** use `-c core.autocrlf=false` on `git add`.

---

## File Structure

**Created in the main repo:**

| Path | Responsibility |
|---|---|
| `package.json` | Minimal `{"type":"module","private":true}` stub so `node --test` treats `.mjs`/`.js` consistently. No dependencies. |
| `tools/build-sandbox.mjs` | CLI entry point. Reads inputs, calls the lib modules in order, writes output, runs guards. |
| `tools/lib/slim-data.mjs` | `KEEP_FIELDS`, `DROPPED_FIELDS`, `slimUnits(units)`. |
| `tools/lib/transform-html.mjs` | `ANCHORS`, `replaceAnchor(html, anchor, replacement)`, `transformHtml(html, opts)`. |
| `tools/lib/verify.mjs` | `assertNoDroppedFieldUsage(html)`, `assertNoGoogleScriptRefs(html)`, `assertSizeUnder(bytes, cap, label)`. |
| `tools/lib/leaderboard.mjs` | `fetchLeaderboardSnapshot(url)`, `loadPreviousSnapshot(path)`. |
| `tools/browser/sandbox-guard.js` | Injected **first**. Blocks all cross-origin `fetch` and `sendBeacon`. |
| `tools/browser/sandbox-shim.js` | Injected **last**. Picker lookup, leaderboard from file, local tick state, badge. |
| `tools/browser/match-tool.js` | Pure `matchToolToSuggestion(tool, suggestions)`. Plain browser script, no exports — loaded into the page by concatenation and into tests via `node:vm`. |
| `tests/helpers/load-browser-script.mjs` | Evaluates a `tools/browser/*.js` file in a `node:vm` context and returns named globals. |
| `tests/slim-data.test.mjs` | Unit tests for the slimmer. |
| `tests/match-tool.test.mjs` | Unit tests for the picker matcher. |
| `tests/transform-html.test.mjs` | Unit tests for the anchored transforms. |
| `tests/verify.test.mjs` | Unit tests for the build guards. |

**Generated into `../dla-sandbox/`** (never hand-edited): `index.html`, `data.json`, `libraries.json`, `demo-leaderboard.json`, `.nojekyll`, `README.md`.

---

## Anchors (exact strings in `index.html`, verified 2026-07-29)

These are the only points the build script touches. Each must be found exactly once.

| Key | Exact source text |
|---|---|
| `AI_HOOK` | `const AI_HOOK = "https://script.google.com/macros/s/AKfycbzIoUL_vbTaH4P7PXuX8HeU9Xh6HuiEWJ05k7q50aJjCg7oeF-ELrlLuPx8uxPFHmE-eA/exec";` |
| `FBHOOK` | `const FBHOOK="https://script.google.com/macros/s/AKfycbwFSbbn_1IaTst0ujfzBiQpE5pGpo07UL8yxemoHOudXzPHxKmKJvkgW2jvivf9yr9Alg/exec";` |
| `BOOT_LEADERBOARD` | `\nloadLeaderboard();\n` |
| `AUTOUPDATE` | `  var CUR=window.APP_VERSION; if(!CUR) return;` |
| `HEAD_SCRIPT` | regex `<script>window\.APP_VERSION='[^']+';<\/script>` (the version string changes on every deploy, so this one anchor is a regex) |
| `TAIL` | the file's final `</script>` — the guard appends after it |

---

## Task 1: Test harness and the data slimmer

**Files:**
- Create: `package.json`
- Create: `tools/lib/slim-data.mjs`
- Create: `tests/slim-data.test.mjs`
- Modify: `.gitignore` (add the sandbox output dir)

**Interfaces:**
- Consumes: nothing.
- Produces: `KEEP_FIELDS: string[]`, `DROPPED_FIELDS: string[]`, `slimUnits(units: object[]) => object[]`.

- [ ] **Step 1: Create the package stub and gitignore entry**

`package.json`:

```json
{
  "name": "dla-tools",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "build:sandbox": "node tools/build-sandbox.mjs"
  }
}
```

Append to `.gitignore`:

```
# generated sandbox demo output (lives in its own repo)
/build/
../dla-sandbox/
```

- [ ] **Step 2: Write the failing test**

`tests/slim-data.test.mjs`:

```js
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
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `node --test tests/slim-data.test.mjs`
Expected: FAIL — cannot find module `../tools/lib/slim-data.mjs`.

- [ ] **Step 4: Write the implementation**

`tools/lib/slim-data.mjs`:

```js
// The six fields index.html actually reads off a unit. Verified 2026-07-29 by
// grepping index.html for every other field name (zero hits).
export const KEEP_FIELDS = ['ca', 'yl', 'th', 'ci', 'lo', 's'];

// Backend and Studio bookkeeping that ships to teachers' phones for nothing.
export const DROPPED_FIELDS = [
  'plannerText',
  'plannerContextRich',
  'audited',
  'humanVerified',
  'stemRebooted',
  'diversityRegenAt',
  'inspiringRegenRecovered',
  'inspiringRegenAutoSwapped',
  'inspiringRegenAt',
  'inspiringRegenAtVersion',
  'suggestionAuditAt',
  'suggestionAuditVersion'
];

export function slimUnits(units) {
  if (!Array.isArray(units)) throw new Error('slimUnits expects an array of units');
  return units.map(unit => {
    const out = {};
    for (const field of KEEP_FIELDS) {
      if (unit && Object.prototype.hasOwnProperty.call(unit, field)) out[field] = unit[field];
    }
    return out;
  });
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node --test tests/slim-data.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 6: Prove the real-world size win**

Run:

```bash
node -e "import('./tools/lib/slim-data.mjs').then(async m=>{const fs=await import('node:fs');const raw=fs.readFileSync('data.json','utf8');const units=JSON.parse(raw);const out=JSON.stringify(m.slimUnits(units));console.log('units',units.length,'before',raw.length,'after',out.length);})"
```

Expected: `units 158`, before ≈ 11,622,724, after ≈ 779,552. Record the actual numbers in the commit message. If `units` is not 158 the corpus has changed since the spec — note the new number and carry on.

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore tools/lib/slim-data.mjs tests/slim-data.test.mjs
git commit -m "Add data slimmer for sandbox build: 11.6MB -> 0.78MB"
```

---

## Task 2: The tool-picker matcher

**Files:**
- Create: `tools/browser/match-tool.js`
- Create: `tests/helpers/load-browser-script.mjs`
- Create: `tests/match-tool.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: browser global `matchToolToSuggestion(tool: string, suggestions: {t:string,d:string}[]) => {t,d}|null`, and the test helper `loadBrowserScript(relPath: string, names: string[]) => object`.

`match-tool.js` is a plain browser script with **no import/export**, because it gets concatenated into the page. Tests reach it through `node:vm`.

- [ ] **Step 1: Write the test helper**

`tests/helpers/load-browser-script.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Evaluates a plain browser script (no modules) in an isolated context and
// hands back the globals it declared. Lets us unit-test code that has to ship
// as an inline <script> in the generated page.
export function loadBrowserScript(relPath, names, extraGlobals = {}) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const context = vm.createContext({ console, ...extraGlobals });
  vm.runInContext(source, context, { filename: relPath });
  const out = {};
  for (const name of names) {
    if (typeof context[name] === 'undefined') {
      throw new Error(`${relPath} did not define global "${name}"`);
    }
    out[name] = context[name];
  }
  return out;
}
```

- [ ] **Step 2: Write the failing test**

`tests/match-tool.test.mjs`:

```js
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
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `node --test tests/match-tool.test.mjs`
Expected: FAIL — `ENOENT` on `tools/browser/match-tool.js`.

- [ ] **Step 4: Write the implementation**

`tools/browser/match-tool.js`:

```js
/* Sandbox picker matcher. Plain browser script: no imports, no exports.
   Also loaded by tests/match-tool.test.mjs through node:vm. */
function matchToolToSuggestion(tool, suggestions) {
  function norm(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  var needle = norm(tool);
  if (needle.length < 3) return null;
  if (!suggestions || !suggestions.length) return null;

  var substringHit = null;
  for (var i = 0; i < suggestions.length; i++) {
    var entry = suggestions[i];
    if (!entry || !entry.t) continue;
    var name = norm(entry.t);
    if (name === needle) return entry;
    if (substringHit === null && name.indexOf(needle) !== -1) substringHit = entry;
  }
  return substringHit;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node --test tests/match-tool.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/browser/match-tool.js tests/helpers/load-browser-script.mjs tests/match-tool.test.mjs
git commit -m "Add sandbox tool-picker matcher with vm-based browser script tests"
```

---

## Task 3: Anchored HTML transforms

**Files:**
- Create: `tools/lib/transform-html.mjs`
- Create: `tests/transform-html.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `ANCHORS: Record<string,{find: string|RegExp, replace: string, label: string}>`, `replaceAnchor(html, key) => string`, `transformHtml(html, {guardJs, shimJs}) => string`.

What each anchor does:
1. `AI_HOOK` and `FBHOOK` string constants become `'sandbox://blocked'`, so even an unpatched call site cannot reach Google.
2. The boot-time `loadLeaderboard();` call is removed — it runs during page parse, before the shim can override anything. The shim re-issues it.
3. The auto-update poller returns immediately.
4. The guard script is injected right after the `APP_VERSION` head script, so it is in place before any page code runs.
5. The shim (matcher + behaviour) is appended at end of file, so its overrides win.

- [ ] **Step 1: Write the failing test**

`tests/transform-html.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/transform-html.test.mjs`
Expected: FAIL — cannot find module `../tools/lib/transform-html.mjs`.

- [ ] **Step 3: Write the implementation**

`tools/lib/transform-html.mjs`:

```js
const AI_HOOK_LINE = 'const AI_HOOK = "https://script.google.com/macros/s/AKfycbzIoUL_vbTaH4P7PXuX8HeU9Xh6HuiEWJ05k7q50aJjCg7oeF-ELrlLuPx8uxPFHmE-eA/exec";';
const FBHOOK_LINE = 'const FBHOOK="https://script.google.com/macros/s/AKfycbwFSbbn_1IaTst0ujfzBiQpE5pGpo07UL8yxemoHOudXzPHxKmKJvkgW2jvivf9yr9Alg/exec";';

export const ANCHORS = {
  AI_HOOK: {
    label: 'live AI endpoint constant',
    find: AI_HOOK_LINE,
    replace: 'const AI_HOOK = "sandbox://blocked"; /* sandbox: live AI endpoint removed */'
  },
  FBHOOK: {
    label: 'analytics endpoint constant',
    find: FBHOOK_LINE,
    replace: 'const FBHOOK="sandbox://blocked"; /* sandbox: analytics endpoint removed */'
  },
  BOOT_LEADERBOARD: {
    label: 'boot-time leaderboard call',
    find: '\nloadLeaderboard();\n',
    replace: '\n/* sandbox: boot leaderboard call removed; the shim re-issues it */\n'
  },
  AUTOUPDATE: {
    label: 'auto-update version poller',
    find: '  var CUR=window.APP_VERSION; if(!CUR) return;',
    replace: '  return; /* sandbox: auto-update poller disabled */'
  }
};

const HEAD_SCRIPT_RE = /<script>window\.APP_VERSION='[^']*';<\/script>/;

function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

export function replaceAnchor(html, key) {
  const anchor = ANCHORS[key];
  if (!anchor) throw new Error(`unknown anchor "${key}"`);
  const hits = countOccurrences(html, anchor.find);
  if (hits === 0) {
    throw new Error(
      `anchor "${key}" not found (${anchor.label}). ` +
      'index.html has changed since this build script was written. ' +
      'Update ANCHORS in tools/lib/transform-html.mjs.'
    );
  }
  if (hits > 1) {
    throw new Error(`anchor "${key}" appears ${hits} times (${anchor.label}); expected exactly 1.`);
  }
  return html.replace(anchor.find, anchor.replace);
}

export function transformHtml(html, { guardJs, shimJs }) {
  if (!guardJs || !shimJs) throw new Error('transformHtml requires guardJs and shimJs');

  let out = html;
  for (const key of Object.keys(ANCHORS)) out = replaceAnchor(out, key);

  const headHits = out.match(HEAD_SCRIPT_RE);
  if (!headHits) {
    throw new Error(
      'anchor "HEAD_SCRIPT" not found (APP_VERSION head script). ' +
      'Update HEAD_SCRIPT_RE in tools/lib/transform-html.mjs.'
    );
  }
  out = out.replace(
    HEAD_SCRIPT_RE,
    `${headHits[0]}\n<script>/* ===== DLA sandbox guard ===== */\n${guardJs}\n</script>`
  );

  return `${out}\n<script>/* ===== DLA sandbox shim ===== */\n${shimJs}\n</script>\n`;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/transform-html.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the anchors match the real file**

Run:

```bash
node -e "import('./tools/lib/transform-html.mjs').then(async m=>{const fs=await import('node:fs');const html=fs.readFileSync('index.html','utf8');const out=m.transformHtml(html,{guardJs:'/*g*/',shimJs:'/*s*/'});console.log('google refs left:',(out.match(/script\.google\.com/g)||[]).length);})"
```

Expected: `google refs left: 0`, no thrown error. If it throws, the anchor named in the error has drifted — read that part of `index.html` and update the anchor before continuing.

- [ ] **Step 6: Commit**

```bash
git add tools/lib/transform-html.mjs tests/transform-html.test.mjs
git commit -m "Add anchored index.html transforms for the sandbox build"
```

---

## Task 4: The runtime guard

**Files:**
- Create: `tools/browser/sandbox-guard.js`
- Create: `tests/sandbox-guard.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: browser global `__sandboxGuardInstalled: true` and a wrapped `window.fetch` / `navigator.sendBeacon`.

This is the belt to the anchors' braces: even if a future edit reintroduces an external URL, nothing leaves the device.

- [ ] **Step 1: Write the failing test**

`tests/sandbox-guard.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserScript } from './helpers/load-browser-script.mjs';

function makeWindow() {
  const calls = [];
  const fakeWindow = {
    location: { origin: 'https://wesdlpteam.github.io', href: 'https://wesdlpteam.github.io/dla-sandbox/' },
    fetch: (url, opts) => { calls.push(String(url)); return Promise.resolve({ ok: true, real: true }); }
  };
  fakeWindow.window = fakeWindow;
  const navigator = { sendBeacon: () => { calls.push('beacon'); return true; } };
  return { fakeWindow, navigator, calls };
}

function install() {
  const { fakeWindow, navigator, calls } = makeWindow();
  loadBrowserScript(
    'tools/browser/sandbox-guard.js',
    ['__sandboxGuardInstalled'],
    { window: fakeWindow, navigator, document: { location: fakeWindow.location } }
  );
  return { fakeWindow, navigator, calls };
}

test('blocks fetch to an absolute cross-origin URL', async () => {
  const { fakeWindow, calls } = install();
  const res = await fakeWindow.fetch('https://script.google.com/macros/s/abc/exec');
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('blocks the sandbox:// sentinel left behind by the transforms', async () => {
  const { fakeWindow, calls } = install();
  const res = await fakeWindow.fetch('sandbox://blocked');
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('allows a relative URL through to the real fetch', async () => {
  const { fakeWindow, calls } = install();
  const res = await fakeWindow.fetch('data.json');
  assert.equal(res.real, true);
  assert.deepEqual(calls, ['data.json']);
});

test('allows a same-origin absolute URL through', async () => {
  const { fakeWindow, calls } = install();
  await fakeWindow.fetch('https://wesdlpteam.github.io/dla-sandbox/libraries.json');
  assert.equal(calls.length, 1);
});

test('a blocked fetch resolves rather than rejecting, so page catch blocks are not needed', async () => {
  const { fakeWindow } = install();
  const res = await fakeWindow.fetch('https://script.google.com/x');
  assert.equal(res.status, 0);
  assert.equal(typeof res.text, 'function');
  assert.equal(await res.text(), '');
});

test('sendBeacon is neutered and reports success so page code does not retry', () => {
  const { navigator, calls } = install();
  assert.equal(navigator.sendBeacon('https://script.google.com/x', 'body'), true);
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/sandbox-guard.test.mjs`
Expected: FAIL — `ENOENT` on `tools/browser/sandbox-guard.js`.

- [ ] **Step 3: Write the implementation**

`tools/browser/sandbox-guard.js`:

```js
/* DLA sandbox guard. Installed before any page code runs.
   Nothing may leave this device. Cross-origin fetch and every sendBeacon are
   swallowed and resolved as an empty failed response, so existing page code
   takes its normal error path without a visible break. */
(function () {
  var w = typeof window !== 'undefined' ? window : this;
  var realFetch = w.fetch ? w.fetch.bind(w) : null;
  var origin = (w.location && w.location.origin) || '';

  function isSameOrigin(url) {
    var s = String(url == null ? '' : url);
    if (!s) return true;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return origin && s.indexOf(origin + '/') === 0;
    if (s.indexOf('//') === 0) return false;
    return true; // relative path
  }

  function blockedResponse() {
    return Promise.resolve({
      ok: false,
      status: 0,
      statusText: 'blocked by sandbox guard',
      text: function () { return Promise.resolve(''); },
      json: function () { return Promise.reject(new Error('sandbox: request blocked')); }
    });
  }

  w.fetch = function (input, init) {
    var url = input && input.url ? input.url : input;
    if (!isSameOrigin(url)) {
      if (w.console && w.console.info) w.console.info('[sandbox] blocked outbound request:', String(url));
      return blockedResponse();
    }
    if (!realFetch) return blockedResponse();
    return realFetch(input, init);
  };

  if (typeof navigator !== 'undefined') {
    navigator.sendBeacon = function () { return true; };
  }

  w.__sandboxGuardInstalled = true;
})();
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/sandbox-guard.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/browser/sandbox-guard.js tests/sandbox-guard.test.mjs
git commit -m "Add sandbox runtime guard blocking all outbound requests"
```

---

## Task 5: The behaviour shim

**Files:**
- Create: `tools/browser/sandbox-shim.js`

**Interfaces:**
- Consumes: browser global `matchToolToSuggestion` from `tools/browser/match-tool.js` (the build concatenates `match-tool.js` then `sandbox-shim.js` into one `shimJs` string, so the matcher is in scope).
- Consumes from the page: globals `D` (unit array), `S` (view state `{v,ca,yl,ui}`), `CN` (campus code → name map), `gu(campusCode, yearLevel)`, `renderTechResult(campus, yl, theme, tool, resp)`, `loadLeaderboard(force)`, `escapeHtml(s)`.
- Produces: overrides of `fetchTechSuggestion` and `fetchLeaderboard`; injects the badge element.

This task has no unit test of its own — it is glue over page globals that only exist in the browser. Its logic (`matchToolToSuggestion`) is already tested in Task 2, and its behaviour is verified end-to-end in Tasks 7 and 8. Do not write a mock of the whole page to chase coverage here.

- [ ] **Step 1: Write the shim**

`tools/browser/sandbox-shim.js`:

```js
/* DLA sandbox shim. Appended after all page code so its overrides win.
   Requires matchToolToSuggestion (concatenated ahead of this file). */
(function () {
  var FAKE_THINK_MS = 700;

  // ---- 1. Badge -----------------------------------------------------------
  function addBadge() {
    if (document.getElementById('sandboxBadge')) return;
    var css = document.createElement('style');
    css.textContent =
      '#sandboxBadge{position:fixed;left:12px;bottom:12px;z-index:99999;background:#1b1b1f;color:#fff;' +
      'font:600 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;padding:8px 12px;border-radius:999px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none;opacity:.92;max-width:calc(100vw - 24px)}' +
      '@media(max-width:430px){#sandboxBadge{font-size:11px;padding:6px 10px;left:8px;bottom:8px}}';
    document.head.appendChild(css);
    var el = document.createElement('div');
    el.id = 'sandboxBadge';
    el.textContent = 'Sandbox demo — not live data';
    document.body.appendChild(el);
  }

  // ---- 2. Leaderboard from a frozen file ----------------------------------
  var _snapshot = null;
  window.fetchLeaderboard = function () {
    if (_snapshot) return Promise.resolve(_snapshot);
    return fetch('demo-leaderboard.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { _snapshot = rows; return rows; })
      .catch(function () { _snapshot = []; return []; });
  };

  // ---- 3. Tool picker: ready-made ideas only, never a network call --------
  function currentUnitSuggestions() {
    try {
      if (!window.S || S.ca == null || S.yl == null || S.ui == null) return [];
      var units = gu(S.ca, S.yl);
      var unit = units && units[S.ui];
      return (unit && unit.s) || [];
    } catch (e) { return []; }
  }

  window.fetchTechSuggestion = function (campus, yl, theme, tool) {
    var suggestions = currentUnitSuggestions();
    var hit = matchToolToSuggestion(tool, suggestions);
    setTimeout(function () {
      if (hit) {
        // Stored ideas are {t,d} only. Do not invent steps, valueAdd or fit.
        renderTechResult(campus, yl, theme, tool, {
          description: hit.d,
          sandboxReadyMade: true,
          sandboxActivityName: hit.t
        });
        return;
      }
      renderTechResult(campus, yl, theme, tool, {
        sandboxNoMatch: true,
        sandboxAlternatives: suggestions.slice(0, 6)
      });
    }, FAKE_THINK_MS);
  };

  // ---- 4. Fallback panel + ready-made banner ------------------------------
  var _realRenderTechResult = window.renderTechResult;
  window.renderTechResult = function (campus, yl, theme, tool, resp) {
    var body = document.getElementById('techModalBody');
    if (resp && resp.sandboxNoMatch && body) {
      var list = (resp.sandboxAlternatives || []).map(function (s) {
        return '<li style="margin:8px 0"><strong>' + escapeHtml(s.t) + '</strong></li>';
      }).join('');
      body.innerHTML =
        '<div style="padding:4px 2px">' +
        '<p style="margin:0 0 12px"><strong>' + escapeHtml(tool) + '</strong> is not one of the ready-made ideas for this unit.</p>' +
        '<p style="margin:0 0 12px">On the live DLA this is where it writes you a fresh idea in about ten seconds. This demo copy shows the ready-made ideas instead, so nothing is generated on the day.</p>' +
        (list ? '<p style="margin:0 0 6px">Ready-made ideas for this unit:</p><ul style="margin:0;padding-left:20px">' + list + '</ul>' : '') +
        '</div>';
      return;
    }
    var result = _realRenderTechResult.apply(this, arguments);
    if (resp && resp.sandboxReadyMade && body) {
      var note = document.createElement('p');
      note.style.cssText = 'margin:14px 0 0;font-size:13px;opacity:.75';
      note.textContent = 'Ready-made idea from this unit: ' + resp.sandboxActivityName;
      body.appendChild(note);
    }
    return result;
  };

  // ---- 5. Hide the Regenerate control — nothing to regenerate -------------
  function hideRegenControls() {
    var style = document.createElement('style');
    style.textContent = '[onclick*="regenerateTech"],[onclick*="openTechResult"][data-regen],.tech-regen-btn{display:none!important}';
    document.head.appendChild(style);
  }

  // ---- 6. Boot ------------------------------------------------------------
  function boot() {
    addBadge();
    hideRegenControls();
    if (typeof loadLeaderboard === 'function') loadLeaderboard(true);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
```

- [ ] **Step 2: Sanity-check the shim parses**

Run: `node --check tools/browser/sandbox-shim.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add tools/browser/sandbox-shim.js
git commit -m "Add sandbox behaviour shim: ready-made picker, frozen leaderboard, badge"
```

---

## Task 6: Build guards and the orchestrator

**Files:**
- Create: `tools/lib/verify.mjs`
- Create: `tools/lib/leaderboard.mjs`
- Create: `tests/verify.test.mjs`
- Create: `tools/build-sandbox.mjs`

**Interfaces:**
- Consumes: `slimUnits`, `DROPPED_FIELDS` (Task 1); `transformHtml` (Task 3); the two browser scripts (Tasks 2, 4, 5).
- Produces: a complete sandbox site in the output directory.

- [ ] **Step 1: Write the failing guard test**

`tests/verify.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoDroppedFieldUsage,
  assertNoGoogleScriptRefs,
  assertSizeUnder
} from '../tools/lib/verify.mjs';

test('passes when the page references no dropped field', () => {
  assert.doesNotThrow(() => assertNoDroppedFieldUsage('var x = u.ca + u.yl + u.s;'));
});

test('throws naming the dropped field the page still reads', () => {
  assert.throws(
    () => assertNoDroppedFieldUsage('var t = unit.plannerText;'),
    /plannerText/
  );
});

test('does not false-positive on a field name inside a longer word', () => {
  assert.doesNotThrow(() => assertNoDroppedFieldUsage('var x = u.auditedByHand;'));
});

test('passes when no Google Apps Script reference survives', () => {
  assert.doesNotThrow(() => assertNoGoogleScriptRefs('<script>var a=1;</script>'));
});

test('throws when a Google Apps Script reference survives', () => {
  assert.throws(
    () => assertNoGoogleScriptRefs('fetch("https://script.google.com/macros/s/x/exec")'),
    /script\.google\.com/
  );
});

test('size guard passes under the cap and throws over it', () => {
  assert.doesNotThrow(() => assertSizeUnder(1000, 2000, 'data.json'));
  assert.throws(() => assertSizeUnder(3000, 2000, 'data.json'), /data\.json/);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/verify.test.mjs`
Expected: FAIL — cannot find module `../tools/lib/verify.mjs`.

- [ ] **Step 3: Write the guards**

`tools/lib/verify.mjs`:

```js
import { DROPPED_FIELDS } from './slim-data.mjs';

// If the live site starts reading a field the slimmer drops, the demo would
// silently lose a feature. Fail the build instead.
export function assertNoDroppedFieldUsage(html) {
  const offenders = DROPPED_FIELDS.filter(field =>
    new RegExp(`\\.${field}\\b`).test(html)
  );
  if (offenders.length) {
    throw new Error(
      `index.html now reads unit field(s) the sandbox slimmer drops: ${offenders.join(', ')}. ` +
      'Add them to KEEP_FIELDS in tools/lib/slim-data.mjs (and re-measure the output size).'
    );
  }
}

export function assertNoGoogleScriptRefs(html) {
  const hits = html.match(/script\.google\.com/g);
  if (hits) {
    throw new Error(
      `${hits.length} reference(s) to script.google.com survived into the sandbox output. ` +
      'The sandbox must never be able to reach the live backends.'
    );
  }
}

export function assertSizeUnder(bytes, cap, label) {
  if (bytes > cap) {
    throw new Error(`${label} is ${bytes} bytes, over the ${cap} byte cap for the sandbox.`);
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/verify.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the leaderboard snapshotter**

`tools/lib/leaderboard.mjs`:

```js
import fs from 'node:fs';

const FBHOOK = 'https://script.google.com/macros/s/AKfycbwFSbbn_1IaTst0ujfzBiQpE5pGpo07UL8yxemoHOudXzPHxKmKJvkgW2jvivf9yr9Alg/exec';

// Build-time only, run from Nathan's machine. On the Wesley network this can
// hit TLS interception; if it fails with "self-signed certificate in
// certificate chain", set NODE_EXTRA_CA_CERTS=~/wesley-corp-roots.pem.
export async function fetchLeaderboardSnapshot() {
  const res = await fetch(`${FBHOOK}?action=leaderboard&t=${Date.now()}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`leaderboard fetch failed: HTTP ${res.status}`);
  return res.json();
}

export function loadPreviousSnapshot(path) {
  if (!fs.existsSync(path)) {
    throw new Error(
      `--no-leaderboard was given but ${path} does not exist yet. ` +
      'Run once with network access to capture the first snapshot.'
    );
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
```

- [ ] **Step 6: Write the orchestrator**

`tools/build-sandbox.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimUnits } from './lib/slim-data.mjs';
import { transformHtml } from './lib/transform-html.mjs';
import { assertNoDroppedFieldUsage, assertNoGoogleScriptRefs, assertSizeUnder } from './lib/verify.mjs';
import { fetchLeaderboardSnapshot, loadPreviousSnapshot } from './lib/leaderboard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_CAP = 2 * 1024 * 1024;

function arg(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}
const OUT = path.resolve(ROOT, arg('--out', '../dla-sandbox'));
const SKIP_LEADERBOARD = process.argv.includes('--no-leaderboard');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, contents) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, rel), contents, 'utf8');
  return Buffer.byteLength(contents, 'utf8');
}

const README = `# DLA Sandbox

Generated demo copy of the Wesley College Digital Learning Assistant, for
presentations. **Do not edit these files by hand** — they are overwritten.

Regenerate from the main repo:

    node tools/build-sandbox.mjs --out ../dla-sandbox

No AI calls, no analytics, frozen leaderboard. Not live data.
`;

async function main() {
  console.log(`Building sandbox into ${OUT}`);

  // 1. index.html
  const sourceHtml = read('index.html');
  assertNoDroppedFieldUsage(sourceHtml);
  const guardJs = read('tools/browser/sandbox-guard.js');
  const shimJs = `${read('tools/browser/match-tool.js')}\n${read('tools/browser/sandbox-shim.js')}`;
  const outHtml = transformHtml(sourceHtml, { guardJs, shimJs });
  assertNoGoogleScriptRefs(outHtml);
  const htmlBytes = write('index.html', outHtml);

  // 2. data.json
  const sourceData = read('data.json');
  const units = JSON.parse(sourceData);
  const slim = JSON.stringify(slimUnits(units));
  assertSizeUnder(Buffer.byteLength(slim, 'utf8'), DATA_CAP, 'data.json');
  const dataBytes = write('data.json', slim);

  // 3. libraries.json — copied as-is, it holds the approved tool list
  const libBytes = write('libraries.json', read('libraries.json'));

  // 4. leaderboard snapshot
  const snapshotPath = path.join(OUT, 'demo-leaderboard.json');
  let rows;
  if (SKIP_LEADERBOARD) {
    rows = loadPreviousSnapshot(snapshotPath);
    console.log('Reusing previous leaderboard snapshot');
  } else {
    rows = await fetchLeaderboardSnapshot();
  }
  const lbBytes = write('demo-leaderboard.json', JSON.stringify(rows));

  // 5. housekeeping
  write('.nojekyll', '');
  write('README.md', README);

  const total = htmlBytes + dataBytes + libBytes + lbBytes;
  console.log(`  index.html            ${htmlBytes.toLocaleString()} bytes`);
  console.log(`  data.json             ${dataBytes.toLocaleString()} bytes (from ${Buffer.byteLength(sourceData, 'utf8').toLocaleString()}, ${units.length} units)`);
  console.log(`  libraries.json        ${libBytes.toLocaleString()} bytes`);
  console.log(`  demo-leaderboard.json ${lbBytes.toLocaleString()} bytes`);
  console.log(`  TOTAL first load      ${total.toLocaleString()} bytes`);
  if (total > DATA_CAP) throw new Error(`total payload ${total} exceeds ${DATA_CAP}`);
  console.log('Sandbox build OK');
}

main().catch(err => { console.error(`\nBUILD FAILED: ${err.message}\n`); process.exit(1); });
```

- [ ] **Step 7: Run the whole suite, then a real build**

Run: `node --test tests/`
Expected: PASS, 36 tests across 5 files.

Run: `node tools/build-sandbox.mjs --out ../dla-sandbox`
Expected: `Sandbox build OK`, with `data.json` around 780,000 bytes and `TOTAL first load` around 1.1 MB.

If the leaderboard fetch fails with a certificate error, set `NODE_EXTRA_CA_CERTS` to `~/wesley-corp-roots.pem` and retry.

- [ ] **Step 8: Confirm the source repo is untouched**

Run: `git status --short -- index.html data.json libraries.json css js gas_backend gas_analytics`
Expected: **no output at all.**

- [ ] **Step 9: Commit**

```bash
git add tools/lib/verify.mjs tools/lib/leaderboard.mjs tools/build-sandbox.mjs tests/verify.test.mjs
git commit -m "Add sandbox build orchestrator with fail-loud guards"
git push
```

---

## Task 7: Publish the sandbox site

**Files:**
- Create: the `wesdlpteam/dla-sandbox` repository (new, public).
- No files in the main repo change.

**Interfaces:**
- Consumes: the output of `tools/build-sandbox.mjs`.
- Produces: a live URL at `https://wesdlpteam.github.io/dla-sandbox/`.

- [ ] **Step 1: Create the repo**

```bash
gh repo create wesdlpteam/dla-sandbox --public \
  --description "Unplugged demo copy of the Wesley DLA for presentations. Generated - do not edit by hand."
```

If `gh` lacks permission on the `wesdlpteam` org, stop and tell Nathan — he creates it in the GitHub web UI, then continue from Step 2.

- [ ] **Step 2: Initialise and push the built site**

```bash
cd ../dla-sandbox
git init -b main
git remote add origin https://github.com/wesdlpteam/dla-sandbox.git
git add .
git commit -m "Initial sandbox build from digital-learning-assistant-v2"
git push -u origin main
```

- [ ] **Step 3: Turn on GitHub Pages**

```bash
gh api -X POST repos/wesdlpteam/dla-sandbox/pages -f "source[branch]=main" -f "source[path]=/"
```

Then confirm: `gh api repos/wesdlpteam/dla-sandbox/pages --jq .html_url`
Expected: `https://wesdlpteam.github.io/dla-sandbox/`

Pages can take a couple of minutes on first deploy.

- [ ] **Step 4: Verify the money guarantee — zero outbound requests**

Open the live sandbox URL in Chrome with DevTools on the Network tab, filter to `google`, then click through: home, a campus, a year level, a unit, tick a card, react to a card, open "Have a tool in mind?", pick a tool that IS in the unit's ideas, and pick one that is NOT.

Expected: **zero** requests to `script.google.com`. Only `index.html`, `data.json`, `libraries.json`, `demo-leaderboard.json`.

Record the result. If any request appears, stop — the guard has a hole and Task 4 needs revisiting.

- [ ] **Step 5: Verify content and picker behaviour**

Confirm: all three campuses appear; unit counts look right (Elsternwick 54, Glen Waverley 50, St Kilda 54 at time of writing); each unit shows its ready-made ideas; the badge reads `Sandbox demo — not live data`; the matched-tool path shows the stored idea; the unmatched-tool path shows the honest fallback with the unit's ideas listed.

- [ ] **Step 6: Verify load time on a throttled connection**

In DevTools, set throttling to "Fast 4G", hard-reload, and record the time to interactive.
Expected: under 3 seconds.

---

## Task 8: Mobile and tablet pass

**Files:**
- Create: `docs/superpowers/notes/2026-07-29-sandbox-mobile-check.md` (findings and screenshots log)
- Modify: `tools/browser/sandbox-shim.js` (only if a fix is needed, and only for sandbox-specific CSS)

**Interfaces:**
- Consumes: the published sandbox site.
- Produces: a recorded pass/fail per width, and fixes for anything broken.

Fixes for layout problems that exist on the live site too are **out of scope here** — record them in the notes file for a separate job. Only sandbox-specific breakage (the badge, the fallback panel) gets fixed in this task.

- [ ] **Step 1: Capture screenshots at every width**

Widths: **360, 390, 430** (phones) and **768, 1024** (tablets).

Screens at each width: home (hero, Tech Champions ribbon, campus cards); campus → year list; unit detail (central idea, lines of inquiry, the six idea cards, VALUE ADD callouts); the tool picker dialog, both matched and unmatched; the badge.

Use Chrome DevTools device emulation. Save screenshots into the scratchpad and reference them from the notes file.

- [ ] **Step 2: Check each of these at each width and record pass/fail**

- No horizontal page scroll. The Tech Champions ribbon is the prime suspect: it deliberately escapes the 700 px wrapper with `calc(50% - 50vw)`.
- Body text at 16 px or larger, so iOS Safari does not zoom when a field is focused.
- Tap targets at least 44x44 px, especially the tick and reaction buttons and the modal close button.
- The tool picker dialog scrolls internally rather than pushing content off-screen, and its close button stays reachable.
- The badge does not cover any control.

- [ ] **Step 3: Fix sandbox-specific breakage only**

If the badge or fallback panel misbehaves, adjust the CSS inside `tools/browser/sandbox-shim.js`, rebuild, and re-check. Everything else goes in the notes file as a finding for later.

- [ ] **Step 4: Write up the findings**

`docs/superpowers/notes/2026-07-29-sandbox-mobile-check.md`: a table of width x screen with pass/fail, the fixes applied, and any live-site issues found but deliberately not fixed.

- [ ] **Step 5: Rebuild, republish, commit**

```bash
node tools/build-sandbox.mjs --out ../dla-sandbox --no-leaderboard
cd ../dla-sandbox && git add . && git commit -m "Rebuild after mobile pass" && git push
```

Back in the main repo:

```bash
git add tools/browser/sandbox-shim.js docs/superpowers/notes/2026-07-29-sandbox-mobile-check.md
git commit -m "Sandbox mobile pass: findings and fixes"
git push
```

- [ ] **Step 6: Final acceptance against the spec**

Confirm every success criterion in `docs/superpowers/specs/2026-07-29-dla-sandbox-demo-design.md`:

1. Zero `script.google.com` requests during a full click-through — evidenced in Task 7 Step 4.
2. All units across all three campuses browsable with their ideas intact — Task 7 Step 5.
3. Total first load under 2 MB, interactive under 3 s throttled — Task 6 Step 7 and Task 7 Step 6.
4. Correct at 360/390/430/768/1024 px with screenshots — Task 8 Steps 1-2.
5. Badge present on every screen — Task 8 Step 1.
6. Live site and data unchanged — re-run `git status --short -- index.html data.json libraries.json` and expect no output.

Anything that fails goes back to the owning task. Do not report done with an open item.

---

## Self-Review Notes

**Spec coverage:** Data slimming → Task 1. Unplugging AI and analytics → Tasks 3, 4. Picker behaviour → Tasks 2, 5. Leaderboard and local tick state → Tasks 5, 6. Badge → Task 5. Mobile → Task 8. Build and refresh process → Task 6. Testing → every task plus Tasks 7 and 8. Risks: dropped-field guard → Task 6 `assertNoDroppedFieldUsage`; TLS interception → Task 6 `leaderboard.mjs` and `--no-leaderboard`; drift → the never-hand-edit rule stated in the generated README.

**Deliberate spec deviation:** the spec's "local-only leaderboard nudge" (a tick bumping the on-screen number for that visitor) is **not** implemented. The page's existing tick handlers already call `refreshLeaderboardSoon()`, which now re-reads the frozen snapshot, so the number simply stays put. Adding a fake increment means reaching into four separate inline handlers for presentation sugar that could mislead. If Nathan wants it after seeing the demo, it is a small follow-up.

**Type consistency:** `slimUnits`, `KEEP_FIELDS`, `DROPPED_FIELDS`, `transformHtml`, `replaceAnchor`, `ANCHORS`, `assertNoDroppedFieldUsage`, `assertNoGoogleScriptRefs`, `assertSizeUnder`, `fetchLeaderboardSnapshot`, `loadPreviousSnapshot`, `matchToolToSuggestion`, `loadBrowserScript` — each is defined once and used under the same name everywhere.
