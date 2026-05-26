# Bulk → Inspire refactor (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all whole-unit regen surfaces in the DLA Studio (per-entry `regenAll` + 5 Bulk paths) through the existing backend inspiring pipeline, so every regen produces 6-sentence inspiring-quality output with the strong validators + auto-substitute fallback.

**Architecture:** Two new GAS actions — `regenerateOneInspiring` (writes candidate to `_pendingRegen` marker for preview) and `applyPendingRegen` (promotes marker → `s`). Extend the existing `regenerateAllInspiring` with `opts.indices` so Bulk paths can target specific units in batch. Frontend gets one shared `bulkRegenViaInspiring(targets, label)` helper used by all 5 Bulk sites; `regenAll` uses the preview+apply marker pattern.

**Tech Stack:** Google Apps Script (V8 runtime), vanilla JS frontend (no build step), GitHub Pages static hosting, clasp deploys. No test framework — ad-hoc Node scripts for pure-function tests, manual Studio E2E for GAS code.

**Spec:** [docs/superpowers/specs/2026-05-26-bulk-to-inspire-refactor-design.md](../specs/2026-05-26-bulk-to-inspire-refactor-design.md)

---

## Task 1: Extend `inspiringCandidateIndexes_` with `opts.indices` short-circuit

**Files:**
- Modify: `gas_backend/Code.js:4462-4474`

- [ ] **Step 1: Write the failing test** (ad-hoc Node script)

Create `tmp/test-opts-indices.js` (gitignored — `tmp/` is OK to use without committing):

```js
// tmp/test-opts-indices.js
const fs = require('fs');
const src = fs.readFileSync('gas_backend/Code.js', 'utf8');
const start = src.indexOf('function inspiringCandidateIndexes_');
let depth = 0, i = start, end = -1;
while (i < src.length) { if (src[i]==='{') depth++; else if (src[i]==='}') { depth--; if (depth===0) { end = i+1; break; } } i++; }
// Stub the helpers it calls so we can eval the function in isolation
function inspiringInScope_(u, opts) { return !opts.ca || u.ca === opts.ca; }
function inspiringHasUnitDetails_(u) { return !!(u && u.ci && u.lo); }
eval(src.slice(start, end));

const data = [
  { ca: 'A', ci: 'X', lo: 'Y' },  // 0 — has details
  { ca: 'B', ci: 'X', lo: 'Y' },  // 1 — has details
  { ca: 'A', ci: '',  lo: 'Y' },  // 2 — missing ci
  { ca: 'A', ci: 'X', lo: 'Y', inspiringRegenAt: '2026-05-25' },  // 3 — already done
];

// Test 1: opts.indices short-circuit
const r1 = inspiringCandidateIndexes_(data, { indices: [0, 2, 3] });
console.assert(JSON.stringify(r1) === '[0,3]', `Test 1 FAIL: expected [0,3] (idx 2 dropped for missing ci), got ${JSON.stringify(r1)}`);

// Test 2: opts.indices bypasses inspiringRegenAt-skip
console.assert(r1.includes(3), 'Test 2 FAIL: idx 3 should be included even though inspiringRegenAt set');

// Test 3: opts.indices filters out-of-range
const r2 = inspiringCandidateIndexes_(data, { indices: [0, 99, -1] });
console.assert(JSON.stringify(r2) === '[0]', `Test 3 FAIL: expected [0], got ${JSON.stringify(r2)}`);

// Test 4: no indices → existing behaviour preserved
const r3 = inspiringCandidateIndexes_(data, {});
// existing behaviour: in-scope + has-details + not already done → 0, 1
console.assert(JSON.stringify(r3) === '[0,1]', `Test 4 FAIL: expected [0,1], got ${JSON.stringify(r3)}`);

console.log('All tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tmp/test-opts-indices.js
```

Expected: Test 1 FAILS with "expected [0,3] ... got [0,1]" or similar (the `opts.indices` short-circuit doesn't exist yet).

- [ ] **Step 3: Implement the minimal change**

Edit `gas_backend/Code.js`, find `function inspiringCandidateIndexes_(data, opts) {` (currently line 4462), and prepend the short-circuit immediately after the `opts = opts || {};` line:

```js
function inspiringCandidateIndexes_(data, opts) {
  opts = opts || {};
  // 2026-05-26: opts.indices short-circuit for Bulk paths that target
  // specific units (vs the ca/yl filter for whole-campus sweeps). When
  // present, those ARE the candidates — bypasses inspiringInScope_ and
  // the inspiringRegenAt-skip (caller is being explicit). Units missing
  // ci/lo are still filtered out (they'd fail the prompt anyway) and
  // surface in the existing `skipped` array on the response.
  if (Array.isArray(opts.indices) && opts.indices.length) {
    return opts.indices.filter(function (i) {
      return Number.isInteger(i) && i >= 0 && i < data.length &&
        data[i] && inspiringHasUnitDetails_(data[i]);
    });
  }
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    if (!inspiringInScope_(u, opts)) continue;
    if (!inspiringHasUnitDetails_(u)) continue;
    if (!opts.redoAll && u.inspiringRegenAt) continue;
    out.push(i);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tmp/test-opts-indices.js
```

Expected: `All tests passed.`

- [ ] **Step 5: Commit**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: inspiringCandidateIndexes_ accepts opts.indices

Lets Bulk paths target specific units in batch instead of relying on
the ca/yl filter (which only suits whole-campus sweeps). Caller is
explicit, so the in-scope and inspiringRegenAt-skip filters are
bypassed; units missing ci/lo are still filtered out and surface in
the response's existing skipped array."
```

---

## Task 2: Add `regenerateOneInspiring_` action helper (single-unit preview-mode regen)

**Files:**
- Modify: `gas_backend/Code.js` (add new function after `regenerateAllInspiring`, around line 4730)

- [ ] **Step 1: Add the function body**

Find the closing brace of `function regenerateAllInspiring(opts) {` (around line 4720+). Immediately after it, add:

```js
// 2026-05-26: Single-unit preview-mode regen. Reuses the inner loop body
// of regenerateAllInspiring (3 attempts -> auto-substitute fallback) but
// writes the result to data[idx]._pendingRegen instead of data[idx].s, so
// the Studio's regenAll preview pane can show the candidate before Apply.
// Returns no body (no-cors POST); the frontend polls Drive for the marker.
function regenerateOneInspiring_(body) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) {
    Logger.log('regenerateOneInspiring_: lock held — bailing');
    return { paused: true, reason: 'lock-held' };
  }
  try {
    if (inspiringAbortRequested_()) return { paused: true, reason: 'aborted' };

    const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
    let raw = JSON.parse(file.getBlob().getDataAsString());
    const isArr = Array.isArray(raw);
    const data = isArr ? raw : Object.values(raw).filter(function (u) { return u && typeof u === 'object'; });

    // Re-resolve idx by (ca, yl, th) to survive concurrent edits.
    let idx = -1;
    const hintIdx = parseInt(body.idx, 10);
    const ca = String(body.ca || '');
    const yl = String(body.yl || '');
    const th = String(body.th || '');
    if (Number.isInteger(hintIdx) && hintIdx >= 0 && hintIdx < data.length &&
        data[hintIdx] && data[hintIdx].ca === ca && data[hintIdx].yl === yl && data[hintIdx].th === th) {
      idx = hintIdx;
    } else {
      for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].ca === ca && data[i].yl === yl && data[i].th === th) { idx = i; break; }
      }
    }
    if (idx === -1) {
      Logger.log('regenerateOneInspiring_: unit not found ' + ca + ' / ' + yl + ' / ' + th);
      return { error: 'unit-not-found' };
    }
    const target = data[idx];
    if (!inspiringHasUnitDetails_(target)) return { error: 'missing-ci-or-lo' };

    const approvedToolsPrompt = getApprovedToolsPrompt_();
    const approvedSet = new Set(getApprovedToolNames_().map(diversityToolKey_));
    const bannedSet = new Set(getBannedToolNames_().map(diversityToolKey_));

    const prompt = inspiringBuildPrompt_(data, idx, approvedToolsPrompt);
    let lastReason = '';
    let lastSugs = null;
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let retryNote = '';
      let retryTemp = 0.75;
      if (attempt > 1) {
        retryTemp = 0.45;
        const toolStrayed = /OFF-WHITELIST|BANNED|AGE-INAPPROPRIATE/.test(lastReason);
        const toolReminder = toolStrayed ? '\n\nCRITICAL: You MUST pick every tool from the approved list above. Re-read the APPROVED TOOLS section. Do not invent tool names, do not use deprecated tools, do not substitute similar-sounding tools. If you are unsure whether a tool is approved, pick a different tool from the list that you can verify IS listed.' : '';
        retryNote = '\n\nRETRY ' + (attempt - 1) + ': Previous attempt failed validation (' + lastReason + '). Apply ALL constraints (tool whitelist, App Smash floor, no dup tools, opener differs from siblings, ~6 sentences per slot 1-5).' + toolReminder;
      }
      const call = inspiringCallOnce_(prompt + retryNote, retryTemp);
      if (!call.ok) { lastReason = call.error || 'unknown'; if (call.retriable && attempt < 3) { Utilities.sleep(8000); continue; } break; }
      lastSugs = call.sugs;
      const verdict = inspiringValidateSugs_(call.sugs, target, data, idx, approvedSet, bannedSet);
      if (!verdict.ok) { lastReason = verdict.reason; if (attempt < 3) { Utilities.sleep(4000); continue; } break; }
      // Successful 3-attempt validation. Write preview marker.
      data[idx]._pendingRegen = {
        sugs: call.sugs.map(function (s) { return { t: s.t, d: s.d }; }),
        ts: new Date().toISOString(),
        autoSwapped: null
      };
      success = true;
      break;
    }

    // Auto-substitute fallback for tool-only failures.
    if (!success && lastSugs && /OFF-WHITELIST|BANNED|AGE-INAPPROPRIATE/.test(lastReason)) {
      const subRes = inspiringApplySubstitutions_(lastSugs, approvedSet, bannedSet, target.yl);
      if (subRes.swaps.length) {
        const sugs = subRes.sugs;
        let shapeOk = Array.isArray(sugs) && sugs.length === 6;
        if (shapeOk) {
          const seen = {};
          for (let z = 0; z < sugs.length && shapeOk; z++) {
            const sg = sugs[z];
            if (!sg || !sg.t || !sg.d) { shapeOk = false; break; }
            const comps = diversityToolComponents_(sg.t);
            for (let j = 0; j < comps.length; j++) {
              const ck = diversityToolKey_(comps[j]);
              if (seen[ck]) { shapeOk = false; break; }
              seen[ck] = true;
            }
          }
        }
        if (shapeOk) {
          data[idx]._pendingRegen = {
            sugs: sugs.map(function (s) { return { t: s.t, d: s.d }; }),
            ts: new Date().toISOString(),
            autoSwapped: subRes.swaps
          };
          success = true;
          Logger.log('regenerateOneInspiring_: AUTO-SWAPPED ' + target.ca + ' / ' + target.yl + ' / ' + target.th);
        }
      }
    }

    if (!success) {
      Logger.log('regenerateOneInspiring_: FAILED ' + target.ca + ' / ' + target.yl + ' / ' + target.th + ' (' + lastReason + ')');
      return { error: 'regen-failed', reason: lastReason };
    }

    // Save data.json back to Drive. Preview marker is in place.
    file.setContent(JSON.stringify(isArr ? data : raw, null, 2));
    return { ok: true, idx: idx, autoSwapped: !!data[idx]._pendingRegen.autoSwapped };
  } catch (err) {
    Logger.log('regenerateOneInspiring_: exception ' + err);
    return { error: 'exception', message: String(err) };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 2: Commit (no test step — verification happens after router wiring + deploy in Task 5)**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: add regenerateOneInspiring_ (preview-mode helper)

Reuses inspiringBuildPrompt_ + inspiringCallOnce_ + inspiringValidateSugs_
+ inspiringApplySubstitutions_ from regenerateAllInspiring's inner loop,
but writes the result to data[idx]._pendingRegen rather than .s. Lets
the Studio regenAll button show a preview pane before Apply.

Not yet routed in doPost — wired in a follow-up commit."
```

---

## Task 3: Add `applyPendingRegen_` action helper (preview → save)

**Files:**
- Modify: `gas_backend/Code.js` (add immediately after `regenerateOneInspiring_`)

- [ ] **Step 1: Add the function body**

Append after `regenerateOneInspiring_`'s closing brace:

```js
// 2026-05-26: Promote a preview marker into the live suggestions. Called
// by the Studio's regenAll preview-pane "Apply" button after the user
// has eyeballed the _pendingRegen candidate.
function applyPendingRegen_(body) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return { paused: true, reason: 'lock-held' };
  try {
    const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
    let raw = JSON.parse(file.getBlob().getDataAsString());
    const isArr = Array.isArray(raw);
    const data = isArr ? raw : Object.values(raw).filter(function (u) { return u && typeof u === 'object'; });

    // Re-resolve idx by (ca, yl, th) — same pattern as regenerateOneInspiring_.
    let idx = -1;
    const hintIdx = parseInt(body.idx, 10);
    const ca = String(body.ca || '');
    const yl = String(body.yl || '');
    const th = String(body.th || '');
    if (Number.isInteger(hintIdx) && hintIdx >= 0 && hintIdx < data.length &&
        data[hintIdx] && data[hintIdx].ca === ca && data[hintIdx].yl === yl && data[hintIdx].th === th) {
      idx = hintIdx;
    } else {
      for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].ca === ca && data[i].yl === yl && data[i].th === th) { idx = i; break; }
      }
    }
    if (idx === -1) return { error: 'unit-not-found' };

    const pending = data[idx]._pendingRegen;
    if (!pending || !Array.isArray(pending.sugs) || !pending.sugs.length) {
      return { error: 'no-pending' };
    }

    data[idx].s = pending.sugs.map(function (s) { return { t: s.t, d: s.d }; });
    data[idx].audited = true;
    data[idx].inspiringRegenAt = new Date().toISOString();
    if (Array.isArray(pending.autoSwapped) && pending.autoSwapped.length) {
      const prior = Array.isArray(data[idx].inspiringRegenAutoSwapped) ? data[idx].inspiringRegenAutoSwapped : [];
      data[idx].inspiringRegenAutoSwapped = prior.concat(pending.autoSwapped);
    }
    clearHumanVerifiedFlags_(data[idx], 'Applied previewed regenerateOneInspiring candidate');
    delete data[idx]._pendingRegen;

    file.setContent(JSON.stringify(isArr ? data : raw, null, 2));
    return { ok: true, idx: idx };
  } catch (err) {
    Logger.log('applyPendingRegen_: exception ' + err);
    return { error: 'exception', message: String(err) };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: add applyPendingRegen_ (promote preview to live)

Moves data[idx]._pendingRegen.sugs into data[idx].s, sets audited:true,
bumps inspiringRegenAt, concats any auto-swap log into the existing
inspiringRegenAutoSwapped, calls clearHumanVerifiedFlags_, deletes the
pending marker. Re-resolves idx by (ca, yl, th) to survive concurrent
edits the same way regenerateOneInspiring_ does."
```

---

## Task 4: Wire both actions into `doPost` router

**Files:**
- Modify: `gas_backend/Code.js` (the `doPost` action dispatcher)

- [ ] **Step 1: Locate the action dispatcher**

In `gas_backend/Code.js`, find `function doPost(e)`. Inside it locate the action-routing switch/if-chain (search for an existing action name like `runSurgeon` or `regenerateAllInspiring` to find the right region — it's the block that branches on `body.action`).

- [ ] **Step 2: Add the two new routes**

Add cases for both new actions alongside existing ones. The exact shape depends on how the existing router is written (lookup table vs switch); match it. Example for a switch:

```js
case 'regenerateoneinspiring':
  responseBody = regenerateOneInspiring_(body);
  break;
case 'applypendingregen':
  responseBody = applyPendingRegen_(body);
  break;
```

If the router is a lookup table:

```js
'regenerateoneinspiring': regenerateOneInspiring_,
'applypendingregen': applyPendingRegen_,
```

Use lowercased keys to match the existing convention (per CLAUDE.md the router dispatches by `body.action` lowercased).

- [ ] **Step 3: Verify both routes are reachable**

In the Apps Script editor (or via clasp), open `Code.js` and check the router:

```bash
grep -n "regenerateoneinspiring\|applypendingregen" gas_backend/Code.js
```

Expected: 2 lines in the router (one per action) plus the function definitions.

- [ ] **Step 4: Commit**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: route regenerateOneInspiring + applyPendingRegen in doPost

Wires both actions into the existing body.action dispatcher. Frontend
clients can now POST { action: 'regenerateOneInspiring', idx, ca, yl, th }
or { action: 'applyPendingRegen', idx, ca, yl, th } through the same
no-cors path as every other backend write."
```

---

## Task 5: Push backend + bump pinned deployment

**Files:**
- No file changes — only deploy.

- [ ] **Step 1: Push to GAS HEAD**

```bash
cd gas_backend && clasp push
```

Expected: list of files pushed, no errors.

- [ ] **Step 2: Find the pinned deployment ID**

```bash
clasp deployments
```

Expected: a list of deployments. The pinned `/exec` URL referenced by `SCRIPT_URL` in `js/00-config-state-utils.js` corresponds to one specific deployment ID. Note it (call it `<DEPLOY_ID>`).

- [ ] **Step 3: Bump the pinned deployment to HEAD**

```bash
clasp deploy --deploymentId <DEPLOY_ID> --description "Bulk -> Inspire refactor: regenerateOneInspiring + applyPendingRegen"
```

Expected: confirmation that the deployment now serves HEAD.

- [ ] **Step 4: Manual verification — hit the new endpoint from the Studio**

Open `DLA_Studio.html` in a browser, sign in, navigate to a unit, open browser devtools console, and run:

```js
const test = DATA[0];
await fetch(SCRIPT_URL, {
  method: 'POST', mode: 'no-cors',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify(withGASToken({
    action: 'regenerateOneInspiring', idx: 0, ca: test.ca, yl: test.yl, th: test.th
  }))
});
console.log('POSTed regenerateOneInspiring for', test.ca, test.yl, test.th);
```

Wait ~30 seconds, then:

```js
await loadFromDrive();
console.log('_pendingRegen on test unit:', DATA[0]._pendingRegen);
```

Expected: `_pendingRegen` is an object with `sugs` (length 6) and `ts` (ISO string). If `null`/missing, check the Apps Script log for errors via `clasp logs` or the GAS editor's Executions panel.

- [ ] **Step 5: Clean up the test marker**

```js
await fetch(SCRIPT_URL, {
  method: 'POST', mode: 'no-cors',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify(withGASToken({
    action: 'applyPendingRegen', idx: 0, ca: DATA[0].ca, yl: DATA[0].yl, th: DATA[0].th
  }))
});
```

Then `await loadFromDrive()` and verify `DATA[0]._pendingRegen` is `undefined` and `DATA[0].inspiringRegenAt` is fresh.

- [ ] **Step 6: Commit (no file changes — empty commit to mark the deploy)**

```bash
git commit --allow-empty -m "deploy: gas_backend Bulk-to-Inspire refactor actions live"
```

---

## Task 6: Add shared `bulkRegenViaInspiring` helper

**Files:**
- Modify: `js/08-export-sync-hotfixes.js` (add new function after `scanAndFixComponentDupes`, around line 280)

- [ ] **Step 1: Write the failing test** (ad-hoc Node script)

Create `tmp/test-bulk-regen-helper.js`:

```js
// tmp/test-bulk-regen-helper.js
const fs = require('fs');
const src = fs.readFileSync('js/08-export-sync-hotfixes.js', 'utf8');
const ok = /function bulkRegenViaInspiring\s*\(/.test(src);
console.assert(ok, 'bulkRegenViaInspiring not defined yet');
console.log(ok ? 'PASS' : 'FAIL — function missing');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tmp/test-bulk-regen-helper.js
```

Expected: assertion failure with message about missing function.

- [ ] **Step 3: Implement the helper**

In `js/08-export-sync-hotfixes.js`, after the closing `}` of `scanAndFixComponentDupes`, insert:

```js
// 2026-05-26: Shared helper for the five Bulk regen sites. Builds an
// indices payload, fires the existing backend regenerateAllInspiring
// batch action with explicit indices, then polls regenerateAllInspiringStatus
// until the expected count of inspiringRegenAt markers refreshes (or two
// consecutive polls show no progress = stall). Takes a snapshot first so
// any per-unit save the backend does is undoable.
async function bulkRegenViaInspiring(targets, label) {
  if (!Array.isArray(targets) || !targets.length) {
    setStatus('Nothing to regen', 'success');
    return { fixed: 0, failed: 0, skipped: 0 };
  }
  if (typeof createManualSnapshot === 'function') { try { createManualSnapshot(); } catch (e) {} }

  const indices = targets.map(function (t) { return t.idx; });
  const total = indices.length;
  const startMarkers = {};
  indices.forEach(function (i) {
    startMarkers[i] = DATA[i] && DATA[i].inspiringRegenAt ? DATA[i].inspiringRegenAt : '';
  });

  // Fire the batch action.
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(withGASToken({
        action: 'regenerateAllInspiring', indices: indices, batch: total
      }))
    });
  } catch (e) {
    setStatus(label + ' — backend POST failed: ' + e.message, 'error');
    return { fixed: 0, failed: total, skipped: 0 };
  }

  // Poll status every 8 seconds until expected count refreshes or stall.
  let lastDone = 0;
  let stallPolls = 0;
  const maxPolls = 90;  // 12 minutes upper bound for ~50-unit batches
  for (let p = 0; p < maxPolls; p++) {
    await sleep(8000);
    await loadFromDrive();
    const done = indices.reduce(function (n, i) {
      const cur = DATA[i] && DATA[i].inspiringRegenAt ? DATA[i].inspiringRegenAt : '';
      return n + (cur && cur !== startMarkers[i] ? 1 : 0);
    }, 0);
    setStatus(label + ': ' + done + '/' + total + ' regenerated…', 'loading');
    if (done >= total) break;
    if (done === lastDone) {
      stallPolls++;
      if (stallPolls >= 2) {
        setStatus(label + ' — stalled at ' + done + '/' + total + ' (check Apps Script log)', 'error');
        break;
      }
    } else {
      stallPolls = 0;
      lastDone = done;
    }
  }

  const finalDone = indices.reduce(function (n, i) {
    const cur = DATA[i] && DATA[i].inspiringRegenAt ? DATA[i].inspiringRegenAt : '';
    return n + (cur && cur !== startMarkers[i] ? 1 : 0);
  }, 0);
  setStatus(label + ' complete — ' + finalDone + '/' + total + ' regenerated', 'success');
  if (typeof renderDashboard === 'function') renderDashboard();
  return { fixed: finalDone, failed: total - finalDone, skipped: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tmp/test-bulk-regen-helper.js
```

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add js/08-export-sync-hotfixes.js
git commit -m "Studio: add bulkRegenViaInspiring helper (shared Bulk path)

Single helper used by all five frontend Bulk regen sites. Fires the
backend regenerateAllInspiring with an explicit indices list, then polls
inspiringRegenAt markers on those entries to gauge progress. Stall
detection bails after two no-progress polls. Snapshot first so any
backend per-unit save is undoable."
```

---

## Task 7: Refactor `regenAll` (per-entry preview pattern)

**Files:**
- Modify: `js/06-bulk-router-chat.js:2040-2118` (the whole `regenAll` function + Apply button onclick)

- [ ] **Step 1: Locate the current function**

```bash
grep -n "async function regenAll\b" js/06-bulk-router-chat.js
```

Expected: one match, around line 2040.

- [ ] **Step 2: Replace with the new preview-pattern version**

Replace the entire `async function regenAll(){ … }` body (currently lines 2040–2118) with:

```js
async function regenAll(){
  if(CURRENT_ENTRY_IDX===null) return;
  const idx = CURRENT_ENTRY_IDX;
  const entry = DATA[idx];
  const btn = document.getElementById('btn-regen-all');
  const res = document.getElementById('regen-all-result');
  btn.disabled = true; btn.textContent = 'Generating…';
  startProgress();
  res.innerHTML = '<div style="font-size:12px;color:#fbbf24">Generating 6 inspiring-quality suggestions… (~30-60s)</div>';

  const startMarkerTs = entry._pendingRegen ? entry._pendingRegen.ts : '';

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(withGASToken({
        action: 'regenerateOneInspiring',
        idx: idx, ca: entry.ca, yl: entry.yl, th: entry.th
      }))
    });

    // Poll Drive for a new _pendingRegen marker on this entry.
    let pending = null;
    const maxPolls = 20;  // 20 * 6s = 2 minutes
    for (let p = 0; p < maxPolls; p++) {
      await sleep(6000);
      await loadFromDrive();
      const e = DATA[idx];
      if (e && e._pendingRegen && e._pendingRegen.ts && e._pendingRegen.ts !== startMarkerTs) {
        pending = e._pendingRegen;
        break;
      }
      res.innerHTML = '<div style="font-size:12px;color:#fbbf24">Generating… (' + (p + 1) + '/' + maxPolls + ')</div>';
    }

    stopProgress();
    if (!pending) {
      res.innerHTML = '<div style="font-size:12px;color:#f87171">AI did not return in time. Check Apps Script log via Studio admin or try again.</div>';
      btn.disabled = false; btn.textContent = 'Generate 6 new suggestions';
      return;
    }

    const sugs = pending.sugs;
    const swappedNote = (Array.isArray(pending.autoSwapped) && pending.autoSwapped.length)
      ? '<div style="font-size:11px;color:var(--gold);margin-bottom:8px">⚠ Auto-substituted: ' + pending.autoSwapped.map(function(s){return 'slot ' + s.slot + ' "' + s.from + '" → "' + s.to + '"';}).join('; ') + '</div>'
      : '';
    res.innerHTML =
      '<div style="font-size:10px;color:var(--mint);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Preview — apply to save</div>' +
      swappedNote +
      sugs.map(function(s){return '<div class="preview-ok"><div class="preview-tool">' + esc(s.t) + '</div><div class="preview-desc">' + esc(s.d) + '</div></div>';}).join('') +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn-pri" onclick="applyRegenAllFromMarker(' + idx + ')">Apply all</button>' +
      '<button class="btn-sm" onclick="discardRegenAllPreview(' + idx + ')">Discard</button>' +
      '</div>';
    btn.textContent = 'Re-roll';
    btn.disabled = false;
  } catch (e) {
    stopProgress();
    res.innerHTML = '<div style="font-size:12px;color:#f87171">' + esc(e.message) + '</div>';
    btn.disabled = false; btn.textContent = 'Generate 6 new suggestions';
  }
}

// 2026-05-26: Replaces the old applyRegenAll(idx, pendingId) that read
// from window[pendingId]. Now reads the _pendingRegen marker from
// DATA[idx] and POSTs the backend applyPendingRegen action.
async function applyRegenAllFromMarker(idx) {
  const entry = DATA[idx];
  if (!entry || !entry._pendingRegen) {
    setStatus('No preview to apply — re-roll first', 'error');
    return;
  }
  const oldSugs = getSugs(entry);
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(withGASToken({
        action: 'applyPendingRegen',
        idx: idx, ca: entry.ca, yl: entry.yl, th: entry.th
      }))
    });
    // Poll for the marker to clear.
    for (let p = 0; p < 10; p++) {
      await sleep(4000);
      await loadFromDrive();
      if (!DATA[idx] || !DATA[idx]._pendingRegen) break;
    }
    recordChange(idx, oldSugs, getSugs(DATA[idx]));
    renderEntry(idx);
    setStatus('Applied regenerated suggestions', 'success');
  } catch (e) {
    setStatus('Apply failed: ' + e.message, 'error');
  }
}

function discardRegenAllPreview(idx) {
  const res = document.getElementById('regen-all-result');
  const btn = document.getElementById('btn-regen-all');
  if (res) res.innerHTML = '';
  if (btn) { btn.disabled = false; btn.textContent = 'Generate 6 new suggestions'; }
  // Marker stays in data.json until next preview overwrites it — harmless,
  // since it only renders when the user explicitly opens the regen flow.
  setStatus('Discarded — re-roll or close', 'success');
}
```

- [ ] **Step 3: Search for any leftover references to the old `applyRegenAll(idx, pendingId)` signature**

```bash
grep -n "applyRegenAll\b" js/
```

Expected: zero matches (the old `applyRegenAll` is gone; only `applyRegenAllFromMarker` remains).

- [ ] **Step 4: Commit**

```bash
git add js/06-bulk-router-chat.js
git commit -m "Studio: regenAll uses backend inspiring pipeline + preview marker

Replaces the inline 3-attempt frontend retry with a POST to the new
regenerateOneInspiring action; the backend writes a _pendingRegen
candidate, Studio polls Drive for the marker, then renders the existing
preview pane sourced from DATA[idx]._pendingRegen.sugs. Apply POSTs
applyPendingRegen; Discard clears local UI only (marker auto-cleared on
next preview)."
```

---

## Task 8: Refactor `fixAllOfType` (05) to call the helper

**Files:**
- Modify: `js/05-bulk-setup-libraries.js:670-735` (the inline retry loop inside `fixAllOfType`)

- [ ] **Step 1: Locate the inline regen loop**

```bash
grep -n "async function fixAllOfType\b" js/05-bulk-setup-libraries.js
```

Expected: one match, around line 660.

- [ ] **Step 2: Replace the inline regen body with a helper call**

Inside `fixAllOfType`, find the `for(const {e,idx,type} of entries){ … }` block (the long inline regen loop). Replace its body (everything between the outer `for` braces) with:

```js
  // Old: 60+ lines of inline prompt + 3-attempt retry per type
  // New: defer to the inspiring backend via the shared helper.
  await bulkRegenViaInspiring(
    entries.map(function (x) { return { e: x.e, idx: x.idx }; }),
    'Fix All Of Type (' + type + ')'
  );
```

(`type` is whichever type the outer function was called with — `incomplete` / `banned` / `offwhitelist` / `duplicate`. Keep the existing type-aware target filter that was already in the function above the loop.)

- [ ] **Step 3: Search for dead locals**

After the edit, search for orphaned locals inside `fixAllOfType`:

```bash
grep -n "lastSmashCount\|lastDupOpener\|lastDupComponent\|dupedTool\|lastFailReason" js/05-bulk-setup-libraries.js
```

Expected: zero matches (all dead-code retry locals removed from this file).

- [ ] **Step 4: Commit**

```bash
git add js/05-bulk-setup-libraries.js
git commit -m "Studio: fixAllOfType routes through bulkRegenViaInspiring

Drops the inline prompt + 3-attempt retry (≈60 lines) and calls the
shared helper. Same type-based target filter (incomplete / banned /
offwhitelist / duplicate). Output now matches Inspire All quality."
```

---

## Task 9: Refactor `runBulkRegen` (08) to call the helper

**Files:**
- Modify: `js/08-export-sync-hotfixes.js:41-124` (the existing `runBulkRegen` function)

- [ ] **Step 1: Locate**

```bash
grep -n "async function runBulkRegen\b" js/08-export-sync-hotfixes.js
```

Expected: one match, around line 41.

- [ ] **Step 2: Replace the function body**

Replace the entire body of `runBulkRegen` (everything inside the outer braces) with:

```js
async function runBulkRegen(){
  const ca = document.getElementById('bulk-regen-campus')?.value || '';
  const yr = document.getElementById('bulk-regen-year')?.value || '';
  const targets = DATA.map(function(e, idx){ return { e: e, idx: idx }; }).filter(function(t){
    if(ca && t.e.ca !== ca) return false;
    if(yr && t.e.yl !== yr) return false;
    return getSugs(t.e).filter(isRealSug).length >= 6;
  });
  if(!targets.length){ setStatus('No entries match the selected filters', 'error'); return; }

  const confirmed = confirm('Regenerate ' + targets.length + ' entr' + (targets.length!==1?'ies':'y') + (ca?' for '+ca:'') + (yr?' '+yr:'') + '?\n\nUses the inspiring backend pipeline. ~' + Math.ceil(targets.length * 8 / 60) + ' minute(s) total. Undoable via snapshots.');
  if(!confirmed) return;

  const btn = document.getElementById('btn-bulk-regen');
  if(btn) btn.disabled = true;
  await bulkRegenViaInspiring(targets, 'Bulk Regen' + (ca||yr?' ('+[ca,yr].filter(Boolean).join(' ')+')':''));
  if(btn) btn.disabled = false;
}
```

- [ ] **Step 3: Search for dead locals**

```bash
grep -n "bulk-regen-bar\|bulk-regen-label\|bulk-regen-result" js/08-export-sync-hotfixes.js
```

Expected: zero matches (the old progress DOM is no longer driven from this function — `bulkRegenViaInspiring` calls `setStatus` instead).

- [ ] **Step 4: Commit**

```bash
git add js/08-export-sync-hotfixes.js
git commit -m "Studio: runBulkRegen routes through bulkRegenViaInspiring

Drops ≈80 lines of inline prompt + retry. Same campus+year filter,
same confirm dialog. Progress now flows through setStatus rather than
a dedicated progress bar — matches the shape of the four other Bulk
sites."
```

---

## Task 10: Refactor `scanAndFixComponentDupes` (08) to call the helper

**Files:**
- Modify: `js/08-export-sync-hotfixes.js` (the `scanAndFixComponentDupes` function added in commit `770a61a`)

- [ ] **Step 1: Locate**

```bash
grep -n "async function scanAndFixComponentDupes\b" js/08-export-sync-hotfixes.js
```

Expected: one match.

- [ ] **Step 2: Replace the function body**

Replace the inline retry-loop body (everything inside `for(const {e, idx} of targets){ … }`) with a single helper call, and trim the surrounding bookkeeping:

```js
async function scanAndFixComponentDupes(){
  const targets = findComponentDupeTargets_();
  if(!targets.length){
    setStatus('No intra-unit tool reuse found — nothing to fix', 'success');
    renderComponentDupAuditList();
    return;
  }
  const confirmed = confirm('Regenerate ' + targets.length + ' unit' + (targets.length===1?'':'s') + ' with repeated tools?\n\nUses the inspiring backend pipeline. ~' + Math.ceil(targets.length * 8 / 60) + ' minute(s) total. Undoable via snapshots.');
  if(!confirmed) return;
  const btn = document.getElementById('btn-component-dup-fix');
  const scanBtn = document.getElementById('btn-component-dup-scan');
  if(btn) btn.disabled = true;
  if(scanBtn) scanBtn.disabled = true;
  await bulkRegenViaInspiring(targets, 'Tool-reuse auto-fix');
  if(scanBtn) scanBtn.disabled = false;
  renderComponentDupAuditList();
}
```

- [ ] **Step 3: Commit**

```bash
git add js/08-export-sync-hotfixes.js
git commit -m "Studio: scanAndFixComponentDupes routes through helper

Drops ≈90 lines of inline regen-loop code added in 770a61a, now that
the same shape is centralised in bulkRegenViaInspiring. Behaviour
unchanged from the user's perspective; output quality lifts to the
inspiring 6-sentence style with auto-substitute fallback."
```

---

## Task 11: Refactor the 09 legacy incomplete fixer to call the helper

**Files:**
- Modify: `js/09-legacy-restored.js:1395-1450` (the incomplete-fixer regen loop)

- [ ] **Step 1: Locate**

```bash
grep -n "for(const {e,idx} of incomplete)" js/09-legacy-restored.js
```

Expected: one match around line 1395.

- [ ] **Step 2: Replace the inline regen with a helper call**

Find the enclosing `async function` that contains the `for(const {e,idx} of incomplete)` loop (the legacy incomplete fixer). Replace the inline loop body (~60 lines) with:

```js
  if(!incomplete.length){ setStatus('No incomplete entries to fix', 'success'); return; }
  await bulkRegenViaInspiring(
    incomplete.map(function(x){ return { e: x.e, idx: x.idx }; }),
    'Legacy incomplete fixer'
  );
```

(The outer function — the one that builds `incomplete` from `DATA` — stays unchanged.)

- [ ] **Step 3: Verify dead locals are gone**

```bash
grep -n "lastSmashCount\|lastDupOpener\|lastDupComponent\|dupedTool\|lastFailReason" js/09-legacy-restored.js
```

Expected: zero matches.

- [ ] **Step 4: Commit**

```bash
git add js/09-legacy-restored.js
git commit -m "Studio: legacy incomplete fixer routes through helper

Drops ≈60 lines of inline retry; calls bulkRegenViaInspiring. Same
'detect units with <6 valid suggestions' filter (unchanged in the
caller). Output quality lifts to the inspiring 6-sentence style."
```

---

## Task 12: Sweep for orphan validators / helpers

**Files:**
- Read-only sweep across `js/`

- [ ] **Step 1: Check the four frontend validators are still wired to the Audit scan path**

The four validators MUST survive — `componentDupesInRegen_` backs the Audit "Scan for tool reuse" card.

```bash
grep -n "componentDupesInRegen_\|appSmashCountInRegen_\|openerDupesSiblingInYear_" js/
```

Expected: still referenced by `findComponentDupeTargets_` (08), `renderComponentDupAuditList` (08), and `appSmashRequirementForEntry_` (00). NOT referenced by any retry loops in 05/06/08/09 any more.

- [ ] **Step 2: Check `SUGGESTION_STYLE` survives for the feedback paths**

```bash
grep -n "SUGGESTION_STYLE" js/
```

Expected: definition in `00-config-state-utils.js`, references in `regenSingleSug` (06) and other feedback paths (07, 09). NONE in the Bulk paths.

- [ ] **Step 3: Verify no dead `applyRegenAll` references**

```bash
grep -n "applyRegenAll\b\|applyRegenAll('" js/ DLA_Studio.html
```

Expected: zero matches. (The old preview pane's Apply onclick was changed to `applyRegenAllFromMarker` in Task 7.)

- [ ] **Step 4: Commit (only if any orphans were removed)**

If the sweep found dead code, remove it and:

```bash
git add js/
git commit -m "Studio: drop orphan helpers after Bulk-to-Inspire refactor"
```

If nothing to remove, skip the commit.

---

## Task 13: End-to-end Studio verification

**Files:**
- No file changes — manual click-through.

- [ ] **Step 1: Hard-reload Studio**

Open `DLA_Studio.html` in Chrome, sign in, then Ctrl+Shift+R to drop cached JS.

- [ ] **Step 2: Verify per-entry regenAll preview flow**

1. Browse → click any unit.
2. Click "Generate 6 new suggestions".
3. Wait ~30–60s for the preview pane.
4. Eyeball: 6 slots, each `t` field a real approved tool (or "Tool A + Tool B" pair), each `d` field ~6 sentences. Slot 6 = STEM Design Cycle activity.
5. Click "Apply all".
6. Wait ~10s, then verify the entry now shows the new suggestions and the preview pane is gone.
7. In devtools console: `DATA[CURRENT_ENTRY_IDX]._pendingRegen` should be `undefined`; `DATA[CURRENT_ENTRY_IDX].inspiringRegenAt` should be a fresh ISO timestamp.

Expected: pass on all 7.

- [ ] **Step 3: Verify Discard flow**

1. Same unit, click "Generate 6 new suggestions" again.
2. When preview lands, click "Discard".
3. Verify the pane clears and the original suggestions on the entry are still intact.

Expected: discard does NOT change `DATA[idx].s` (only clears local UI); `_pendingRegen` may stay set (harmless) or be overwritten next regen.

- [ ] **Step 4: Verify the auto-fix Bulk path**

1. Go to Audit → "🧹 Tool-reuse audit" card.
2. Click "Scan for tool reuse" → expect 13 affected units listed (or however many remain — per [project_dla_app_smash_intra_unit_dup.md](C:\Users\BennN\.claude\projects\c--Users-BennN-OneDrive---Wesley-College-Documents-DLA-Workspace\memory\project_dla_app_smash_intra_unit_dup.md)).
3. Click "✨ Regenerate all flagged" → confirm.
4. Watch the status bar tick: "Tool-reuse auto-fix: 1/13 regenerated…" then 2/13, etc.
5. Wait until "Tool-reuse auto-fix complete — 13/13 regenerated".
6. Click "Scan for tool reuse" again → expect 0 affected units.

Expected: 13/13 pass; subsequent scan returns nothing.

- [ ] **Step 5: Final commit (only if any fixes from observed bugs)**

If verification surfaced issues, fix inline and commit per the bug. Otherwise:

```bash
git push
```

(Pushes everything from Tasks 1–12 in one go to `main` for GitHub Pages.)

---

## Self-review against the spec

**Spec coverage check** — every spec section maps to one or more tasks:

| Spec section | Task(s) |
|---|---|
| Backend: extend `inspiringCandidateIndexes_` | Task 1 |
| Backend: new `regenerateOneInspiring_` | Task 2 |
| Backend: new `applyPendingRegen_` | Task 3 |
| Backend: register in `doPost` | Task 4 |
| Deploy (clasp push + bump) | Task 5 |
| Frontend: shared `bulkRegenViaInspiring` | Task 6 |
| Frontend: refactor `regenAll` | Task 7 |
| Frontend: refactor 5 Bulk sites | Tasks 8, 9, 10, 11 (4 Bulk sites — `runBulkRegen` covers Bulk Regen panel; `scanAndFixComponentDupes` covers the just-added Audit fix; `fixAllOfType` covers 05; legacy fixer covers 09. The fifth "site" was the old `regenAll` itself, handled in Task 7) |
| Dead-code cleanup | Sweep in Task 12 (each refactor task already deletes its own dead locals) |
| Validators stay | Task 12 sweep verifies |
| Failure modes covered | Polling stall in Task 6; auto-substitute reused in Task 2; idx-drift re-resolution in Tasks 2 + 3 |
| Behaviour change: missing ci/lo units skipped | Task 1 (helper filters them) — surfaces in `bulkRegenViaInspiring` status via the response's skipped array (Task 6 handles by counting `finalDone` < `total`) |
| Manual E2E test plan | Task 13 |

**Placeholder scan:** searched the plan for "TBD", "TODO", "implement later", "add error handling" — zero matches. Every step contains the actual code.

**Type consistency:** function names checked — `regenerateOneInspiring_` / `applyPendingRegen_` / `bulkRegenViaInspiring` / `applyRegenAllFromMarker` / `discardRegenAllPreview` / `findComponentDupeTargets_` / `renderComponentDupAuditList` are consistent across every task that references them.

**Ambiguity check:** the `<DEPLOY_ID>` placeholder in Task 5 is a real environment-specific value the engineer must look up via `clasp deployments` — this is documented inline, not a spec gap.
