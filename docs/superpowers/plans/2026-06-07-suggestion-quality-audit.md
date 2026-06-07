# Suggestion Quality Audit + Consistent-Style Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade every stored tech suggestion against the new quality bar and surgically auto-fix the weak ones on a hands-off GAS timer, AND make that same new style apply whenever a curator edits in the Studio (Bulk AI Edit + per-suggestion Feedback), with a live quality check.

**Architecture:** One shared AI grader (`auditGradeSuggestion_`, server-side, exposed via a `gradesuggestion` action) is used by both (a) a new self-running GAS audit trigger that drains un-audited units and rewrites only the failed slots, and (b) the two client edit paths, which call it live and auto-redo once on a weak result. The client `SUGGESTION_STYLE` is brought back into sync with the server's `INSPIRING_DESCRIPTION_RULES`, and the server's `stripTwistLabel_` is ported client-side into the existing text-cleaner chain.

**Tech Stack:** Google Apps Script (`gas_backend/Code.js`, pushed via `clasp`), vanilla JS Studio (`js/00`–`js/09`, classic `<script>` tags), Drive-hosted `data.json`. No build step, no test harness — pure logic is verified with Node scripts at repo-root `tests/`; GAS integration is verified by manual Apps Script editor runs + the grade-only dry run.

**Spec:** `docs/superpowers/specs/2026-06-07-suggestion-quality-audit-design.md`

**Phases (each independently shippable):**
1. Shared grader (server)
2. Audit runner + trigger (server)
3. Audit Studio UI
4. WS2 — rule unification + twist-strip
5. WS2 — live grade gate on edit paths

---

## Conventions for every GAS task

- After editing `gas_backend/Code.js`, deploy per CLAUDE.md:
  ```bash
  cd gas_backend && clasp push
  clasp deployments                                             # find the pinned deployment ID
  clasp deploy --deploymentId <ID> --description "<what changed>"
  ```
  `clasp push` alone does NOT change what the live `/exec` URL serves.
- GAS data.json load idiom (canonical, used everywhere):
  ```js
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const raw = JSON.parse(file.getBlob().getDataAsString());
  const isArr = Array.isArray(raw);
  const data = isArr ? raw : Object.values(raw).filter(u => u && typeof u === 'object');
  ```
- GAS data.json save idiom:
  ```js
  const toWrite = isArr ? data : raw;
  file.setContent(JSON.stringify(toWrite, null, 2));
  try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e) { Logger.log('pushToGitHub failed: ' + e); }
  ```
- doPost action cases follow the existing style exactly:
  ```js
  if (action === 'someaction') {
    const result = someFn({ ca: body.ca || null });
    result.user = verifiedEmail;
    return jsonResponse(result);
  }
  ```
- Commit format: this repo's hook requires **subject ≤ 50 chars** and **no AI attribution** (no `Co-Authored-By`/`Generated with`). Keep subjects short; put detail in the body.

---

# PHASE 1 — Shared grader (server)

### Task 1: Banned-phrase pre-check (pure logic + Node test)

**Files:**
- Create: `tests/banned-phrase.test.js` (repo root — OUTSIDE `gas_backend/`, so clasp never pushes it)
- Modify: `gas_backend/Code.js` (add constant + function near the other inspiring constants, just before `INSPIRING_DESCRIPTION_RULES` at line 3911)

- [ ] **Step 1: Write the failing Node test**

```js
// tests/banned-phrase.test.js
// Run: node tests/banned-phrase.test.js   (exit 0 = pass)
const { AUDIT_BANNED_PHRASES, auditBannedPhraseHit_ } = require('./banned-phrase.impl.js');

let failures = 0;
function check(name, cond){ if(!cond){ console.error('FAIL:', name); failures++; } else { console.log('ok:', name); } }

check('catches "For a twist"', auditBannedPhraseHit_('Students code. For a twist, they retell it.') === 'for a twist');
check('catches "the twist:" label', !!auditBannedPhraseHit_('They build a city. The twist: a flood hits.'));
check('catches "present their findings"', auditBannedPhraseHit_('Students present their findings to the class.') === 'present their findings');
check('catches "for this unit"', auditBannedPhraseHit_('A poster for this unit.') === 'for this unit');
check('passes clean text', auditBannedPhraseHit_('Students design a flood-resilient model city and stress-test it.') === null);
check('case-insensitive', auditBannedPhraseHit_('FOR A TWIST they swap roles.') === 'for a twist');
check('has >=15 phrases', AUDIT_BANNED_PHRASES.length >= 15);

if(failures){ console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll banned-phrase tests passed'); process.exit(0);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node tests/banned-phrase.test.js`
Expected: FAIL — `Cannot find module './banned-phrase.impl.js'`.

- [ ] **Step 3: Write the implementation (shared by Node test and GAS)**

Create `tests/banned-phrase.impl.js` — this is the canonical logic, copied verbatim into `Code.js` in Step 4 so the Node test and the server agree:

```js
// tests/banned-phrase.impl.js
var AUDIT_BANNED_PHRASES = [
  'for a twist',
  'the twist:', 'the twist —', "here's the twist", 'here is the twist', 'the real twist', 'the big twist',
  'connected to the central idea', 'linked to the line of inquiry',
  'related to the unit theme', 'for this unit', 'in this unit', 'about this unit',
  "this unit's focus", 'the unit focus', 'connects to the unit focus',
  'share their learning', 'use the app to present', 'make a simple product',
  'create a digital product', 'explore the topic', 'connected to the unit',
  'present their findings', 'record their thinking',
  'document their learning journey', 'document their inquiry journey'
];

function auditBannedPhraseHit_(text) {
  var t = String(text || '').toLowerCase();
  for (var i = 0; i < AUDIT_BANNED_PHRASES.length; i++) {
    if (t.indexOf(AUDIT_BANNED_PHRASES[i]) !== -1) return AUDIT_BANNED_PHRASES[i];
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AUDIT_BANNED_PHRASES: AUDIT_BANNED_PHRASES, auditBannedPhraseHit_: auditBannedPhraseHit_ };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node tests/banned-phrase.test.js`
Expected: PASS — "All banned-phrase tests passed".

- [ ] **Step 5: Copy the logic into Code.js**

In `gas_backend/Code.js`, immediately ABOVE line 3911 (`const INSPIRING_DESCRIPTION_RULES = ...`), paste the `AUDIT_BANNED_PHRASES` array and `auditBannedPhraseHit_` function from Step 3 (drop the `module.exports` block — GAS has no `module`). Add a comment:
```js
// 2026-06-07: Deterministic banned-phrase pre-check for the suggestion audit grader.
// Mirror of tests/banned-phrase.impl.js — keep the two in sync.
```

- [ ] **Step 6: Commit**

```bash
git add tests/banned-phrase.test.js tests/banned-phrase.impl.js gas_backend/Code.js
git commit -m "feat: banned-phrase precheck for audit grader"
```

---

### Task 2: The AI grader `auditGradeSuggestion_`

**Files:**
- Modify: `gas_backend/Code.js` (add after `auditBannedPhraseHit_`)

- [ ] **Step 1: Write the grader function**

This reuses `callAIProxy_` (returns `{text}`), `OPENAI_FAST_MODEL`, and the server's existing `INSPIRING_DESCRIPTION_RULES` + `REALISTIC_TOOL_USE_RULES` as the rubric so the bar is identical to generation. Paste after `auditBannedPhraseHit_`:

```js
// 2026-06-07: AI quality grader for a single stored suggestion. Returns
// { pass: bool, reasons: [string], note: string }. Deterministic banned-phrase
// pre-check runs first (guarantees the known offenders fail regardless of the
// model). Uses the FAST model — this runs across the whole corpus.
function auditGradeSuggestion_(unit, slotIdx, sug) {
  const t = (sug && sug.t) ? String(sug.t) : '';
  const d = (sug && sug.d) ? String(sug.d) : '';

  // 1) Deterministic pre-check — always authoritative on a hit.
  const banned = auditBannedPhraseHit_(d);
  if (banned) {
    return { pass: false, reasons: ['banned_phrase'], note: 'Contains banned phrase: "' + banned + '"' };
  }
  if (!d || d.length < 120) {
    return { pass: false, reasons: ['too_thin'], note: 'Description is empty or far too short.' };
  }

  // 2) AI grade against the same rules used to GENERATE suggestions.
  const rubric = INSPIRING_DESCRIPTION_RULES + '\n' + REALISTIC_TOOL_USE_RULES;
  const system = 'You are a strict but fair reviewer of primary-school digital-technology activity suggestions for Wesley College (IB PYP). '
    + 'Judge ONE suggestion against the quality rules. Be conservative: only FAIL on a CLEAR violation; if it is acceptable, PASS. '
    + 'Fail reasons you may use (only when clearly true): '
    + '"dull_generic" (boring, templated, could apply to any unit), '
    + '"tool_as_metaphor" (the tool is used as a vague metaphor, not for its real affordance), '
    + '"not_achievable" (a primary teacher could not realistically run this with this single tool), '
    + '"jargon_unreadable" (abstract/edu-jargon; a teacher cannot picture the lesson), '
    + '"banned_phrase" (lazy templated phrasing). '
    + 'Return STRICT JSON only: {"pass":true|false,"reasons":["..."],"note":"one short sentence"}.';
  const user = 'QUALITY RULES:\n' + rubric
    + '\n\n---\nUNIT: ' + (unit.ca || '') + ' | ' + (unit.yl || '') + ' | "' + (unit.th || '') + '"'
    + (unit.ci ? '\nCentral Idea: "' + unit.ci + '"' : '')
    + (unit.lo ? '\nLines of Inquiry: "' + unit.lo + '"' : '')
    + '\nSLOT: ' + (slotIdx + 1) + ' of 6' + (slotIdx === 5 ? ' (STEM Design Cycle slot)' : '')
    + '\nTOOL: ' + t
    + '\nDESCRIPTION: "' + d + '"'
    + '\n\nGrade this one suggestion. JSON only.';

  let parsed = null;
  try {
    const res = callAIProxy_({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemPrompt: system,
      model: OPENAI_FAST_MODEL,
      maxTokens: 300,
      temperature: 0
    });
    let txt = String(res && res.text || '').replace(/```json|```/g, '').trim();
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s !== -1 && e !== -1) parsed = JSON.parse(txt.slice(s, e + 1));
  } catch (err) {
    Logger.log('auditGradeSuggestion_: grade call failed (' + err + ') — defaulting to PASS to avoid false churn.');
    return { pass: true, reasons: [], note: 'grader error — passed by default' };
  }
  if (!parsed || typeof parsed.pass !== 'boolean') {
    return { pass: true, reasons: [], note: 'unparseable grade — passed by default' };
  }
  return {
    pass: parsed.pass,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
    note: String(parsed.note || '')
  };
}
```

- [ ] **Step 2: Add a manual GAS test function**

Add near the bottom of `Code.js` (these `test*_` helpers are run by hand in the Apps Script editor):

```js
function testAuditGrader_() {
  const unit = { ca: 'Test', yl: 'Year 3', th: 'Sharing the Planet', ci: 'Living things depend on each other.', lo: 'Ecosystems; interdependence' };
  const weak = { t: 'ScratchJr', d: 'Students use ScratchJr to make a story. For a twist, they retell it from another character. They share their learning with the class and present their findings.' };
  const strong = { t: 'Micro:bit', d: 'Students programme a Micro:bit to log light and temperature in three microhabitats around the school grounds, such as under a log, in open lawn, and beside the pond. Working in pairs they use the accelerometer-free data-logging blocks to capture readings every minute across a lunchtime, then graph the differences. They compare which tiny creatures they predict would thrive in each spot and why, linking conditions to the interdependence of living things. Each pair captures annotated MakeCode screenshots and a 30-second clip of their device in place. They present one habitat-protection action the school could take based on their evidence. The work becomes a corridor display that invites other classes to add their own observations.' };
  Logger.log('WEAK -> ' + JSON.stringify(auditGradeSuggestion_(unit, 0, weak)));
  Logger.log('STRONG -> ' + JSON.stringify(auditGradeSuggestion_(unit, 1, strong)));
}
```

- [ ] **Step 3: Deploy and run the manual test**

Run: `cd gas_backend && clasp push` then in the Apps Script editor run `testAuditGrader_` and read the Logs (View → Logs).
Expected: WEAK → `{"pass":false,...}` with `banned_phrase` (the deterministic check fires on "For a twist"); STRONG → `{"pass":true,...}`.

- [ ] **Step 4: Commit**

```bash
git add gas_backend/Code.js
git commit -m "feat: AI grader for stored suggestions"
```

---

### Task 3: Expose grader via `gradesuggestion` action

**Files:**
- Modify: `gas_backend/Code.js` doPost router (add a case alongside the others, e.g. after the `serversideregenabort` case ~line 484)

- [ ] **Step 1: Add the router case**

```js
    // 2026-06-07: live + audit-shared grader. Client edit paths call this to
    // grade a freshly generated suggestion before showing it.
    if (action === 'gradesuggestion') {
      const unit = {
        ca: body.ca || '', yl: body.yl || '', th: body.th || '',
        ci: body.ci || '', lo: body.lo || ''
      };
      const slotIdx = Number.isInteger(parseInt(body.sugIdx, 10)) ? parseInt(body.sugIdx, 10) : 0;
      const result = auditGradeSuggestion_(unit, slotIdx, { t: body.t || '', d: body.d || '' });
      result.user = verifiedEmail;
      return jsonResponse(result);
    }
```

- [ ] **Step 2: Deploy**

Run: `cd gas_backend && clasp push && clasp deployments` then `clasp deploy --deploymentId <ID> --description "add gradesuggestion action"`.

- [ ] **Step 3: Verify via the manual test still works + commit**

(The action is exercised live in Phase 5; here just confirm the file pushes cleanly.)
```bash
git add gas_backend/Code.js
git commit -m "feat: gradesuggestion doPost action"
```

---

# PHASE 2 — Audit runner + trigger (server)

### Task 4: Extract a reusable slot generator core from `regenerateOneInspiringSlot_`

`regenerateOneInspiringSlot_` (Code.js:5388-5635) reads Drive itself and returns a preview. The audit needs to generate a replacement for a slot using an **already-loaded** `data` array (so the tick doesn't re-read 11 MB per slot). Refactor without changing existing behaviour.

**Files:**
- Modify: `gas_backend/Code.js:5388-5635`

- [ ] **Step 1: Add the core function**

Add a new function `regenerateOneInspiringSlotCore_(data, idx, sugIdx, opts)` containing the body of `regenerateOneInspiringSlot_` from the `const target = data[idx];` logic onward (lines 5414-5630), but taking `data, idx, sugIdx` as parameters instead of parsing `body`. It returns the same `{ ok, t, d, autoSwapped, ... }` / `{ error, reason }` shapes. Replace `body.forcedTool` reads with `opts && opts.forcedTool`. Do NOT call Drive or `setContent` inside the core.

- [ ] **Step 2: Rewrite `regenerateOneInspiringSlot_` to delegate**

Make the existing function keep its public contract (reads Drive, validates `sugIdx`/`idx`, returns preview) but delegate generation to the core:

```js
function regenerateOneInspiringSlot_(body) {
  try {
    const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
    const raw = JSON.parse(file.getBlob().getDataAsString());
    const data = Array.isArray(raw) ? raw : Object.values(raw).filter(u => u && typeof u === 'object');
    const ca = String(body.ca || ''), yl = String(body.yl || ''), th = String(body.th || '');
    const sugIdx = parseInt(body.sugIdx, 10);
    if (!Number.isInteger(sugIdx) || sugIdx < 0 || sugIdx > 5) return { error: 'bad-sugIdx', reason: 'sugIdx must be 0-5' };
    let idx = -1;
    const hintIdx = parseInt(body.idx, 10);
    if (Number.isInteger(hintIdx) && hintIdx >= 0 && hintIdx < data.length &&
        data[hintIdx] && data[hintIdx].ca === ca && data[hintIdx].yl === yl && data[hintIdx].th === th) {
      idx = hintIdx;
    } else {
      for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].ca === ca && data[i].yl === yl && data[i].th === th) { idx = i; break; }
      }
    }
    if (idx === -1) return { error: 'unit-not-found' };
    return regenerateOneInspiringSlotCore_(data, idx, sugIdx, { forcedTool: body.forcedTool });
  } catch (err) {
    Logger.log('regenerateOneInspiringSlot_: exception ' + err);
    return { error: 'exception', message: String(err) };
  }
}
```

- [ ] **Step 3: Verify existing per-slot ↻ button still works**

Deploy (`clasp push` + redeploy). In the Studio Browse tab, click ↻ on one suggestion, pick "AI". Expected: a fresh single suggestion preview appears exactly as before (no behaviour change).

- [ ] **Step 4: Commit**

```bash
git add gas_backend/Code.js
git commit -m "refactor: extract slot-generator core"
```

---

### Task 5: Audit constants + report file helpers

**Files:**
- Modify: `gas_backend/Code.js` (add a constant block near the `SERVER_REGEN_*` constants ~line 4474; add report helpers)

- [ ] **Step 1: Add constants**

```js
// 2026-06-07: Suggestion quality audit (separate runner from inspiring regen).
var SUGGESTION_AUDIT_TICK_HANDLER = 'suggestionAuditTick';
var SUGGESTION_AUDIT_TICK_MINUTES = 5;          // snappier cadence (spec decision)
var SUGGESTION_AUDIT_TICK_BATCH = 6;            // units per tick — stay under the 6-min GAS limit
var SUGGESTION_AUDIT_VERSION = 'a1-2026-06-07';
var SUGGESTION_AUDIT_REPORT_FILE = 'suggestion_audit_report.json'; // small file in same Drive folder as data.json
var SUGGESTION_AUDIT_DRYRUN_PROP = 'SUGGESTION_AUDIT_DRYRUN_DONE'; // set after first real dry run
```

- [ ] **Step 2: Add report read/write helpers**

The report lives as a small file beside `data.json` so frequent updates don't rewrite the 11 MB file. Find-or-create by name in the data.json file's parent folder:

```js
function suggestionAuditReportFile_() {
  const parents = DriveApp.getFileById(DATA_JSON_FILE_ID).getParents();
  const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const it = folder.getFilesByName(SUGGESTION_AUDIT_REPORT_FILE);
  if (it.hasNext()) return it.next();
  return folder.createFile(SUGGESTION_AUDIT_REPORT_FILE, '{}', 'application/json');
}
function suggestionAuditReadReport_() {
  try { return JSON.parse(suggestionAuditReportFile_().getBlob().getDataAsString() || '{}'); }
  catch (e) { return {}; }
}
function suggestionAuditWriteReport_(report) {
  suggestionAuditReportFile_().setContent(JSON.stringify(report, null, 2));
}
```

- [ ] **Step 3: Deploy + manual smoke test**

Add and run `function testAuditReport_(){ suggestionAuditWriteReport_({status:'test', at:new Date().toISOString()}); Logger.log(JSON.stringify(suggestionAuditReadReport_())); }`.
Expected: Logs show the round-tripped object; a `suggestion_audit_report.json` appears in the data.json folder. Delete `testAuditReport_` after.

- [ ] **Step 4: Commit**

```bash
git add gas_backend/Code.js
git commit -m "feat: audit constants + report file helpers"
```

---

### Task 6: `auditFixSlot_` — persist a surgical rewrite

**Files:**
- Modify: `gas_backend/Code.js`

- [ ] **Step 1: Add the function**

Operates on in-memory `data`, generates a replacement via the Task-4 core, writes it into the slot, clears the unit's human-verified flag (whole-unit, per existing `clearHumanVerifiedFlags_`), and reports success/failure. Does NOT save Drive (the tick batches saves).

```js
// 2026-06-07: surgically rewrite ONE weak slot in-memory. Returns
// { ok, oldTool, newTool } or { ok:false, reason }. Caller persists data.
function auditFixSlot_(data, idx, sugIdx) {
  const unit = data[idx];
  const before = (unit.s && unit.s[sugIdx]) ? unit.s[sugIdx] : { t: '', d: '' };
  const gen = regenerateOneInspiringSlotCore_(data, idx, sugIdx, {});
  if (!gen || !gen.ok || !gen.t || !gen.d) {
    return { ok: false, reason: (gen && gen.reason) || 'regen-failed', oldTool: before.t || '' };
  }
  unit.s[sugIdx] = { t: gen.t, d: gen.d };
  if (typeof clearHumanVerifiedFlags_ === 'function') {
    clearHumanVerifiedFlags_(unit, 'Suggestion rewritten by quality audit');
  }
  return { ok: true, oldTool: before.t || '', newTool: gen.t };
}
```

- [ ] **Step 2: Commit** (verified end-to-end in Task 7)

```bash
git add gas_backend/Code.js
git commit -m "feat: auditFixSlot_ surgical slot rewrite"
```

---

### Task 7: The audit tick worker

**Files:**
- Modify: `gas_backend/Code.js`

- [ ] **Step 1: Add `suggestionAuditTick`**

Processes a batch of un-audited units: grade 6 slots each; if not dry-run, fix failed slots; stamp `suggestionAuditAt`; save Drive only if changed; always update the report. Mirrors the swallow-errors-and-retry pattern of `serverSideRegenTick`.

```js
function suggestionAuditTick() {
  try {
    const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
    const raw = JSON.parse(file.getBlob().getDataAsString());
    const isArr = Array.isArray(raw);
    const data = isArr ? raw : Object.values(raw).filter(u => u && typeof u === 'object');

    const report = suggestionAuditReadReport_();
    const dryRun = !!report.dryRun;
    if (!report.reasons) report.reasons = {};
    if (!report.changed) report.changed = [];
    report.total = report.total || data.filter(function (u) { return u && Array.isArray(u.s) && u.s.length; }).length;

    let processedUnits = 0, changedThisBatch = false;
    for (let i = 0; i < data.length && processedUnits < SUGGESTION_AUDIT_TICK_BATCH; i++) {
      const u = data[i];
      if (!u || !Array.isArray(u.s) || !u.s.length) continue;
      if (u.suggestionAuditAt && u.suggestionAuditVersion === SUGGESTION_AUDIT_VERSION) continue; // already audited this version
      processedUnits++;

      for (let s = 0; s < u.s.length; s++) {
        const verdict = auditGradeSuggestion_(u, s, u.s[s]);
        report.graded = (report.graded || 0) + 1;
        if (!verdict.pass) {
          (verdict.reasons.length ? verdict.reasons : ['unspecified']).forEach(function (r) {
            report.reasons[r] = (report.reasons[r] || 0) + 1;
          });
          const rec = { ca: u.ca, yl: u.yl, th: u.th, slot: s, reason: verdict.reasons.join(',') || 'unspecified', note: verdict.note, verified: u.humanVerified === true };
          if (!dryRun) {
            const fix = auditFixSlot_(data, i, s);
            if (fix.ok) { report.rewritten = (report.rewritten || 0) + 1; rec.oldTool = fix.oldTool; rec.newTool = fix.newTool; changedThisBatch = true; }
            else { rec.unfixed = true; rec.reason += '|fix:' + fix.reason; }
          }
          if (report.changed.length < 500) report.changed.push(rec);
        }
      }
      u.suggestionAuditAt = new Date().toISOString();
      u.suggestionAuditVersion = SUGGESTION_AUDIT_VERSION;
      changedThisBatch = true; // the marker itself is a change worth persisting for resume
    }

    if (changedThisBatch) {
      const toWrite = isArr ? data : raw;
      file.setContent(JSON.stringify(toWrite, null, 2));
      try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e) { Logger.log('audit pushToGitHub failed: ' + e); }
    }

    const remaining = data.filter(function (u) {
      return u && Array.isArray(u.s) && u.s.length && !(u.suggestionAuditAt && u.suggestionAuditVersion === SUGGESTION_AUDIT_VERSION);
    }).length;
    report.remaining = remaining;
    report.status = remaining === 0 ? 'done' : 'running';
    report.updatedAt = new Date().toISOString();
    if (remaining === 0) {
      report.finishedAt = report.updatedAt;
      if (dryRun) { PropertiesService.getScriptProperties().setProperty(SUGGESTION_AUDIT_DRYRUN_PROP, '1'); report.status = 'dry-run-done'; }
      suggestionAuditWriteReport_(report);
      const removed = removeSuggestionAuditTrigger_();
      Logger.log('suggestionAuditTick: complete, removed ' + removed + ' trigger(s).');
    } else {
      suggestionAuditWriteReport_(report);
    }
  } catch (e) {
    Logger.log('suggestionAuditTick error (will retry next tick): ' + (e && e.stack ? e.stack : e));
    const r = suggestionAuditReadReport_(); r.status = 'paused'; r.lastError = String(e); suggestionAuditWriteReport_(r);
  }
}
```

- [ ] **Step 2: Add `removeSuggestionAuditTrigger_`**

```js
function removeSuggestionAuditTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SUGGESTION_AUDIT_TICK_HANDLER) { ScriptApp.deleteTrigger(triggers[i]); removed++; }
  }
  return removed;
}
```

- [ ] **Step 3: Deploy + dry-run-style manual test on a tiny slice**

Temporarily set `SUGGESTION_AUDIT_TICK_BATCH = 1`, write a dry-run report (`suggestionAuditWriteReport_({status:'running', dryRun:true})`), run `suggestionAuditTick` once in the editor. Expected Logs/report: `graded` ≈ 6, units stamped `suggestionAuditAt`, no Drive content change to `s` (dry run), `remaining` decremented. Restore batch to 6 and clear markers after (`suggestionAuditReset` from Task 8).

- [ ] **Step 4: Commit**

```bash
git add gas_backend/Code.js
git commit -m "feat: suggestion audit tick worker"
```

---

### Task 8: Kickoff, status, abort, reset + router actions

**Files:**
- Modify: `gas_backend/Code.js` (functions + doPost cases)

- [ ] **Step 1: Add the control functions**

```js
function kickoffSuggestionAudit(opts) {
  opts = opts || {};
  // Concurrency guard — don't run alongside the inspiring regen trigger (both write data.json).
  const existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === SUGGESTION_AUDIT_TICK_HANDLER || t.getHandlerFunction() === SERVER_REGEN_TICK_HANDLER;
  });
  if (existing.length) return { error: 'busy', reason: 'An audit or regen job is already running. Wait for it to finish or abort it first.' };

  const props = PropertiesService.getScriptProperties();
  // First-ever run is forced to dry-run (spec decision), unless caller explicitly overrides.
  const firstRunDone = props.getProperty(SUGGESTION_AUDIT_DRYRUN_PROP) === '1';
  const dryRun = (typeof opts.dryRun === 'boolean') ? opts.dryRun : !firstRunDone;

  // Reset markers so the audit re-grades the whole corpus under this version.
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const raw = JSON.parse(file.getBlob().getDataAsString());
  const isArr = Array.isArray(raw);
  const data = isArr ? raw : Object.values(raw).filter(u => u && typeof u === 'object');
  let total = 0;
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    if (!u || !Array.isArray(u.s) || !u.s.length) continue;
    total++;
    delete u.suggestionAuditAt; delete u.suggestionAuditVersion;
  }
  file.setContent(JSON.stringify(isArr ? data : raw, null, 2));

  suggestionAuditWriteReport_({
    status: 'running', dryRun: dryRun, startedAt: new Date().toISOString(),
    total: total, graded: 0, rewritten: 0, remaining: total, reasons: {}, changed: []
  });

  removeSuggestionAuditTrigger_();
  ScriptApp.newTrigger(SUGGESTION_AUDIT_TICK_HANDLER).timeBased().everyMinutes(SUGGESTION_AUDIT_TICK_MINUTES).create();
  suggestionAuditTick(); // start immediately

  return {
    message: 'Suggestion audit started' + (dryRun ? ' (DRY RUN — grades only, no changes).' : ' (auto-fix).')
      + ' ' + total + ' units. Tick every ' + SUGGESTION_AUDIT_TICK_MINUTES + ' min. You can close the Studio.',
    dryRun: dryRun, total: total
  };
}

function suggestionAuditStatus() {
  const r = suggestionAuditReadReport_();
  r.triggerInstalled = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === SUGGESTION_AUDIT_TICK_HANDLER; });
  return r;
}

function suggestionAuditAbort() {
  const removed = removeSuggestionAuditTrigger_();
  const r = suggestionAuditReadReport_(); r.status = 'aborted'; suggestionAuditWriteReport_(r);
  return { message: 'Aborted. Removed ' + removed + ' trigger(s).', removed: removed };
}
```

- [ ] **Step 2: Add router cases** (after the `gradesuggestion` case)

```js
    if (action === 'kickoffsuggestionaudit') {
      const result = kickoffSuggestionAudit({ dryRun: (typeof body.dryRun === 'boolean') ? body.dryRun : undefined });
      result.user = verifiedEmail;
      return jsonResponse(result);
    }
    if (action === 'suggestionauditstatus') {
      const result = suggestionAuditStatus();
      result.user = verifiedEmail;
      return jsonResponse(result);
    }
    if (action === 'suggestionauditabort') {
      const result = suggestionAuditAbort();
      result.user = verifiedEmail;
      return jsonResponse(result);
    }
```

- [ ] **Step 3: Deploy + verify dry run end-to-end on the live corpus**

Deploy (push + redeploy). From the Studio console (or a temporary editor run of `kickoffSuggestionAudit({dryRun:true})`), start a dry run. Wait/observe ticks. Expected: `suggestion_audit_report.json` fills with `graded` climbing to ~804, `rewritten:0` (dry run), per-reason counts populated, `status` → `dry-run-done`, trigger auto-removed, and **no `s` text changed** in `data.json`.

- [ ] **Step 4: Commit**

```bash
git add gas_backend/Code.js
git commit -m "feat: audit kickoff/status/abort + actions"
```

---

# PHASE 3 — Audit Studio UI

### Task 9: "Audit Suggestions" button + status panel

**Files:**
- Modify: `js/07-bulk-actions.js` (Bulk area — add button + panel render + poll). Match the existing bulk-card markup style used by Inspire All.
- Modify: `js/00-config-state-utils.js` (`APP_VERSION`) and `DLA_Studio.html` (`?v=` on all script tags) — version bump so browsers fetch new JS.

- [ ] **Step 1: Add the client functions**

Add to `js/07-bulk-actions.js`. Uses the existing authenticated POST helper. NOTE: confirm the project's POST-with-token helper name by reading how `inspireAllBatch` posts (js/06 ~804) — reuse that exact helper (shown here as `gasPost`; replace with the real name if different):

```js
// 2026-06-07: Suggestion Quality Audit — server-side, laptop-off.
async function startSuggestionAudit() {
  if (!confirm('Start the Suggestion Quality Audit?\n\nThe first run is a DRY RUN — it grades every suggestion and shows you a report without changing anything. Run it again afterwards to auto-fix.\n\nIt runs on the server, so you can close the Studio.')) return;
  try {
    const res = await gasPost({ action: 'kickoffsuggestionaudit' });
    if (res && res.error) { setStatus('Audit not started: ' + (res.reason || res.error), 'error'); return; }
    setStatus(res && res.message ? res.message : 'Audit started on the server.', 'success');
    pollSuggestionAudit();
  } catch (e) { setStatus('Could not start audit: ' + e.message, 'error'); }
}

async function pollSuggestionAudit() {
  const panel = document.getElementById('suggestion-audit-panel');
  if (!panel) return;
  try {
    const r = await gasPost({ action: 'suggestionauditstatus' });
    const reasons = r.reasons ? Object.entries(r.reasons).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(' · ') : '';
    const dry = r.dryRun ? ' <span style="color:var(--gold)">(dry run)</span>' : '';
    panel.innerHTML = `
      <div style="font-size:12px;line-height:1.6">
        <strong>Audit${dry}:</strong> ${r.status || 'unknown'}<br>
        Graded ${r.graded || 0} / ${r.total || 0} · ${r.rewritten || 0} rewritten · ${r.remaining ?? '?'} left<br>
        ${reasons ? `<span style="color:var(--dim)">Weak by reason: ${reasons}</span>` : ''}
        ${(r.status === 'dry-run-done') ? `<br><button class="btn-pri" onclick="confirmAuditAutoFix()">Looks right — run the auto-fix</button>` : ''}
        ${(r.status === 'running') ? `<br><button class="btn-sm" onclick="abortSuggestionAudit()">Stop</button>` : ''}
      </div>`;
    if (r.status === 'running') setTimeout(pollSuggestionAudit, 20000);
  } catch (e) { panel.innerHTML = `<span style="color:#f87171">Status check failed: ${e.message}</span>`; }
}

async function confirmAuditAutoFix() {
  if (!confirm('Run the auto-fix now? This rewrites every suggestion the audit graded as weak.')) return;
  const res = await gasPost({ action: 'kickoffsuggestionaudit', dryRun: false });
  setStatus(res && res.message ? res.message : 'Auto-fix started.', 'success');
  pollSuggestionAudit();
}

async function abortSuggestionAudit() {
  const res = await gasPost({ action: 'suggestionauditabort' });
  setStatus(res && res.message ? res.message : 'Aborted.', 'success');
  pollSuggestionAudit();
}
```

- [ ] **Step 2: Add the button + panel to the Bulk UI**

Find the Bulk-tools card container (where Inspire All's card is rendered) and add a sibling card:

```html
<div class="bulk-card">
  <div class="bulk-card-title">🔎 Audit Suggestions</div>
  <div style="font-size:12px;color:var(--dim);margin-bottom:8px">Grades every stored suggestion for teacher-friendly, creative, achievable quality and rewrites the weak ones. Runs on the server — close the Studio anytime.</div>
  <button class="btn-pri" onclick="startSuggestionAudit()">Start audit</button>
  <div id="suggestion-audit-panel" style="margin-top:10px"></div>
</div>
```

On Bulk-tab load, call `pollSuggestionAudit()` once so an in-progress audit shows immediately. Hook it where the Bulk tab initialises (mirror how Inspire All status is restored on load).

- [ ] **Step 3: Bump versions**

In `js/00-config-state-utils.js` bump `APP_VERSION` (e.g. `v5.27`). In `DLA_Studio.html` bump the `?v=` query on ALL `<script src="js/...">` tags to the same value (per the version-stamping rule — all 10 together).

- [ ] **Step 4: Verify in browser**

Push static files. Hard-reload the Studio (↻ latest), open Bulk tab. Expected: the "Audit Suggestions" card shows; clicking "Start audit" kicks a dry run and the panel begins showing "Graded X / 804". Confirm the bottom-left running-version stamp shows the new APP_VERSION.

- [ ] **Step 5: Commit**

```bash
git add js/07-bulk-actions.js js/00-config-state-utils.js DLA_Studio.html
git commit -m "feat: Audit Suggestions Studio button + panel"
```

---

# PHASE 4 — WS2: rule unification + twist-strip

### Task 10: Bring client `SUGGESTION_STYLE` back in sync

**Files:**
- Modify: `js/05-bulk-setup-libraries.js:46-145` (`SUGGESTION_STYLE`)
- Modify: `gas_backend/Code.js:3911` (add the sync comment)

- [ ] **Step 1: Add the missing new-style rules to the client copy**

Inside the `BANNED PHRASES` block of `SUGGESTION_STYLE` (after the existing list, around line 73), add the twist ban and "present their findings" to match the server:

```
- "present their findings"
- "The twist" / "The twist:" / "Here's the twist" / "the real twist" — never announce a twist by name; write the unexpected angle as a plain sentence.
```

And after the `TEACHER READABILITY` paragraph (line 94), add the server's single-tool hard rule:

```
SINGLE-TOOL REALITY CHECK (HARD RULE): the ENTIRE activity must be genuinely achievable using ONLY the one named tool. Do not describe steps that secretly need a second app or device (no separate video editor, camera app, maps tool, audio recorder, slideshow app) unless that capability is built into the named tool itself. If the idea would need another app, choose a different single tool that can do the whole thing, or scope the activity down to what THIS tool actually does.
```

- [ ] **Step 2: Add drift-guard comments to BOTH copies**

Above `const SUGGESTION_STYLE` (js/05:46):
```js
// KEEP IN SYNC with gas_backend INSPIRING_DESCRIPTION_RULES. The audit grader and
// all Studio edit paths assume one shared style (twist ban, single-tool reality
// check, banned-phrase list). Update both copies together.
```
Above `const INSPIRING_DESCRIPTION_RULES` (Code.js:3911): the mirror comment pointing back to `js/05 SUGGESTION_STYLE`.

- [ ] **Step 3: Verify (no test harness — visual + grep)**

Run a Grep to confirm the twist ban now appears in `js/05`:
`grep -n "Here's the twist" js/05-bulk-setup-libraries.js` → expect a hit.

- [ ] **Step 4: Commit**

```bash
git add js/05-bulk-setup-libraries.js gas_backend/Code.js
git commit -m "fix: sync client style rules with server"
```

---

### Task 11: Port `stripTwistLabel_` to the client and wire into the cleaner

**Files:**
- Create test: `tests/strip-twist.test.js` (repo root)
- Modify: `js/00-config-state-utils.js` (add `stripTwistLabel_`, call it from `cleanSuggestionText_` at line 87)

- [ ] **Step 1: Write the failing Node test**

```js
// tests/strip-twist.test.js — Run: node tests/strip-twist.test.js
const { stripTwistLabel_ } = require('./strip-twist.impl.js');
let f = 0; const ck = (n, c) => { if (!c) { console.error('FAIL', n); f++; } else console.log('ok', n); };
ck('removes "For a twist," lead', !/twist/i.test(stripTwistLabel_('Students build a city. The twist: a flood hits at night.')));
ck('recapitalises after strip', /\. A flood/.test(stripTwistLabel_('Students build a city. The twist: a flood hits at night.')) || /flood/i.test(stripTwistLabel_('Students build a city. The twist: a flood hits at night.')));
ck('leaves clean text alone', stripTwistLabel_('Students design a resilient city and test it.') === 'Students design a resilient city and test it.');
if (f) process.exit(1); console.log('passed'); process.exit(0);
```

- [ ] **Step 2: Run to confirm fail**

Run: `node tests/strip-twist.test.js` → FAIL (module missing).

- [ ] **Step 3: Create the impl (mirror of the server's `stripTwistLabel_`)**

```js
// tests/strip-twist.impl.js — mirror of gas_backend stripTwistLabel_ (Code.js:5381)
function stripTwistLabel_(value) {
  let s = String(value || '');
  s = s.replace(/(^|[.!?]\s+)(?:and |but )?(?:here(?:'|’)?s |here is )?the (?:real |big )?twist(?:\s*[:—]\s*|\s+is(?:\s+that)?\s+)/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, function (m, lead, ch) { return lead + ch.toUpperCase(); });
  return s.replace(/ {2,}/g, ' ').trim();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { stripTwistLabel_ };
```

- [ ] **Step 4: Run to confirm pass**

Run: `node tests/strip-twist.test.js` → "passed".

- [ ] **Step 5: Add to the Studio and wire into the cleaner**

In `js/00-config-state-utils.js`, add the `stripTwistLabel_` function (body from Step 3, drop the `module.exports`) beside the other cleaners. Then modify `cleanSuggestionText_` (line 87) so cleaned description text also has twist labels stripped:

```js
function cleanSuggestionText_(value){
  return stripTwistLabel_(cleanTextCorruption_(value)
    /* ...keep the rest of the existing chain exactly... */ );
}
```
(Read the current body of `cleanSuggestionText_` first and wrap its existing return expression in `stripTwistLabel_( ... )`. Because `cleanSuggestionObject_` and `cleanChangeObject_` both route `d`/`description` through `cleanSuggestionText_`, this covers BOTH the Feedback save path (`confirmSugFeedback` → `cleanSuggestionObject_`) and the Bulk path (`normaliseChanges` → `cleanChangeObject_`).)

- [ ] **Step 6: Verify in browser**

Bump `APP_VERSION` + `?v=` (as Task 9 Step 3). Hard-reload. In Browse, run a Feedback edit and apply an option; confirm any "twist" phrasing is gone from the saved text. (Spot-check by editing a suggestion that previously produced "For a twist".)

- [ ] **Step 7: Commit**

```bash
git add tests/strip-twist.test.js tests/strip-twist.impl.js js/00-config-state-utils.js js/05-bulk-setup-libraries.js DLA_Studio.html
git commit -m "fix: strip twist labels on Studio edits"
```

---

# PHASE 5 — WS2: live grade gate on edit paths

### Task 12: Client `gradeSuggestionLive` helper

**Files:**
- Modify: `js/02-ui-load-navigation.js` (beside `callAI`) or `js/00` — wherever shared AI helpers live; mirror `callAI`'s transport.

- [ ] **Step 1: Add the helper**

Reuses the exact CORS-fetch transport `callAI` uses (POST to `SCRIPT_URL`, `text/plain` body wrapped by `withGASToken`, reads `await r.text()` → JSON). Returns `{pass, reasons, note}`; on any error returns `{pass:true}` so it never blocks the curator:

```js
async function gradeSuggestionLive(entry, sugIdx, t, d) {
  try {
    const body = withGASToken({
      action: 'gradesuggestion',
      ca: entry.ca || '', yl: entry.yl || '', th: entry.th || '',
      ci: entry.ci || '', lo: entry.lo || '', sugIdx: sugIdx, t: t || '', d: d || ''
    });
    const r = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const j = JSON.parse(await r.text());
    return (typeof j.pass === 'boolean') ? j : { pass: true, reasons: [], note: '' };
  } catch (e) { console.warn('gradeSuggestionLive failed, passing by default:', e.message); return { pass: true, reasons: [], note: '' }; }
}
```

- [ ] **Step 2: Commit** (exercised in Tasks 13-14)

```bash
git add js/02-ui-load-navigation.js
git commit -m "feat: client live grade helper"
```

---

### Task 13: Live gate in the Feedback chat

**Files:**
- Modify: `js/06-bulk-router-chat.js` — `applySugFeedbackDirect` (after the `filtered` array is built, ~line 2329).

- [ ] **Step 1: Grade candidates, auto-redo once, annotate**

After `window['_fbsugs_'+uid] = filtered;` is set (line 2329), insert a grading pass that grades each filtered candidate and, if all fail, regenerates once with the failure reasons appended. Keep it bounded to one redo. Add before the `resultEl.innerHTML = ...` render:

```js
    // 2026-06-07: live quality gate — grade each candidate; if none pass, redo once.
    sendBtn.textContent = 'Checking style…';
    let graded = await Promise.all(filtered.map(s => gradeSuggestionLive(entry, sugIdx, s.t, s.d)));
    let anyPass = graded.some(g => g.pass);
    if (!anyPass) {
      const reasons = [...new Set(graded.flatMap(g => g.reasons || []))].join(', ');
      const redoPrompt = prompt + `\n\nThe previous options were graded WEAK (${reasons}). Rewrite all 3 to fix this — vivid, specific, achievable, no banned phrasing.`;
      try {
        const raw2 = await callAI([{role:'user',parts:[{text:redoPrompt}]}], null, OPENAI_FAST_MODEL);
        const c2 = raw2.replace(/```json|```/g,'').trim();
        const a = c2.indexOf('['), b = c2.lastIndexOf(']');
        if (a !== -1 && b !== -1) {
          const re = JSON.parse(c2.slice(a, b+1)).filter(s => s && s.t);
          if (re.length) { filtered.length = 0; re.forEach(s => filtered.push(s)); window['_fbsugs_'+uid] = filtered; graded = await Promise.all(filtered.map(s => gradeSuggestionLive(entry, sugIdx, s.t, s.d))); }
        }
      } catch (e) { /* keep originals; annotate below */ }
    }
    // Build a per-option style note for the render.
    const styleNote = filtered.map((s,i) => (graded[i] && graded[i].pass) ? '' : ` <span title="${(graded[i]&&graded[i].note)||''}" style="color:var(--gold);font-size:10px">⚠ style</span>`);
```

Then in the existing option render (line 2342), append `${styleNote[i]||''}` after the tool name span so weak-but-shown options are marked.

- [ ] **Step 2: Verify in browser**

Bump version, hard-reload. In Browse → Feedback, type "make it 2 vague sentences". Expected: a brief "Checking style…", then options appear; the deliberately-weak request triggers a redo and/or a "⚠ style" marker. A normal request shows no warning and no extra delay beyond the one check.

- [ ] **Step 3: Commit**

```bash
git add js/06-bulk-router-chat.js
git commit -m "feat: live style check in Feedback chat"
```

---

### Task 14: Live gate in Bulk AI Edit

**Files:**
- Modify: `js/07-bulk-actions.js` — `startBulkAnalysis`, after `changes` is normalised/filtered and before `showChangesPopup(changes)` (line 1836).

- [ ] **Step 1: Grade each proposed change; mark weak ones in the popup**

Bulk runs can be large, so do NOT auto-redo every change inline (cost/time). Instead grade each proposed change and attach a `_styleWeak`/`_styleNote` flag so the review popup shows which proposals are weak before the curator applies them:

```js
      // 2026-06-07: live quality gate for bulk proposals — annotate weak ones.
      bulkChatAddMessage('assistant', 'Checking proposed changes against the style bar…');
      await Promise.all(changes.map(async (c) => {
        const entry = DATA[c.entryIdx];
        if (!entry) return;
        const g = await gradeSuggestionLive(entry, c.sugIdx, c.t, c.d);
        if (!g.pass) { c._styleWeak = true; c._styleNote = (g.reasons || []).join(', ') + (g.note ? ' — ' + g.note : ''); }
      }));
```

- [ ] **Step 2: Surface the flag in `showChangesPopup`**

Read `showChangesPopup` (js/07) and, in each change row, when `c._styleWeak`, render a small amber `⚠ style: ${c._styleNote}` badge. This is display-only; applying remains the curator's choice.

- [ ] **Step 3: Verify in browser**

Bump version, hard-reload. Run a Bulk AI Edit instruction that would yield generic output (e.g. "make slot 1 of every Year 2 unit a simple Canva poster"). Expected: after generation, a "Checking proposed changes…" beat, then the review popup shows ⚠ style badges on the generic ones.

- [ ] **Step 4: Commit**

```bash
git add js/07-bulk-actions.js
git commit -m "feat: live style check in Bulk AI Edit"
```

---

### Task 15: Update stale CLAUDE.md note + finalise

**Files:**
- Modify: `CLAUDE.md` (the "no-cors, responses cannot be read" note is inaccurate for `callAI`/readable POSTs)

- [ ] **Step 1: Correct the note**

In the "Authentication & backend calls" section, amend the no-cors sentence to note that the AI/data paths (`callAI`, regen, `gradesuggestion`, status actions) use a normal CORS `fetch` POST and DO read JSON responses; only fire-and-forget write kicks rely on polling Drive.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: correct callAI CORS note"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** WS1 audit (Tasks 1-9) ✓; dry-run-first (Task 8 kickoff) ✓; 5-min timer (Task 5 const) ✓; surgical per-slot fix (Tasks 4,6,7) ✓; report file + status panel (Tasks 5,8,9) ✓; concurrency guard (Task 8) ✓. WS2 rule unification (Task 10) ✓; twist-strip on edit paths (Task 11) ✓; shared grader reused live (Tasks 2,12) ✓; live gate on both edit paths (Tasks 13,14) ✓; one-redo cap (Task 13) ✓.
- **Type/name consistency:** grader returns `{pass, reasons, note}` everywhere (Tasks 2,3,12); `regenerateOneInspiringSlotCore_(data, idx, sugIdx, opts)` defined in Task 4 and consumed in Task 6; `suggestionAuditAt`/`suggestionAuditVersion` markers written in Task 7 and reset in Task 8; report fields (`graded/rewritten/remaining/reasons/changed/status/dryRun`) consistent across Tasks 5,7,8,9.
- **Placeholder scan:** the few "read the existing function first, then apply this change" steps (Task 4 core extraction, Task 9 `gasPost` helper name, Task 11 `cleanSuggestionText_` wrap, Task 14 `showChangesPopup`) each name the exact function + line and show the transformation — they require confirming the surrounding idiom, not inventing logic.
- **Known assumption to confirm at execution:** the authenticated POST helper name used by bulk actions (shown as `gasPost`) — Task 9 Step 1 instructs reading `inspireAllBatch`'s post call and reusing the real helper.
