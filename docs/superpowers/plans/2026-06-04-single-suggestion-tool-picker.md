# Single-suggestion regen: tool picker + exception fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "Regen failed: exception" on per-suggestion regen, and add a chooser so the curator can either let the AI pick a replacement tool or pick one themselves from the year-appropriate approved list.

**Architecture:** One shared backend action (`regenerateOneInspiringSlot`) gains an optional `forcedTool`. The ↻ button opens a small chooser; "Let AI choose" runs today's path, "Choose a tool myself" opens a year-appropriate tool grid (tools already used elsewhere in the unit are disabled) and sends the pick as `forcedTool`. Both drafts flow through the existing `showChangesPopup` review gate. The exception is fixed by porting the frontend `cleanTextCorruption_` into the GAS backend.

**Tech stack:** Plain global-scope ES (no modules, no build step). GAS V8 backend (`Code.js`, pushed via clasp). Static site served by GitHub Pages. No test harness — verification is `node --check` for syntax + manual browser checks after deploy.

**Spec:** `docs/superpowers/specs/2026-06-04-single-suggestion-tool-picker-design.md`

**Locked decisions:** picked tool → AI rewrites the activity; picker shows year-appropriate approved tools only; a tool already used elsewhere in the same unit is blocked (greyed in picker + rejected server-side).

**Testing note:** This repo has no automated tests. Each code task ends with `node --check <file>` (syntax gate) and a commit. Behavioural verification is a single manual pass in the browser after the deploy task (Task 7). All `node`/`git`/`clasp` commands run from the repo root: `c:/Users/BennN/OneDrive - Wesley College/Documents/DLA_Workspace/digital-learning-assistant-v2`.

---

## Task 1: Backend — add `cleanTextCorruption_` (fixes the exception)

**Why:** `regenerateOneInspiringSlot_` calls `cleanTextCorruption_` at `Code.js:5343` and `:5365`, but that function is defined only in the front-end (`js/00-config-state-utils.js:62`) — never in `gas_backend/`. On the success path the backend throws `ReferenceError`, caught and returned as `{error:'exception'}`. Porting the function into the backend resolves both call sites.

**Files:**
- Modify: `gas_backend/Code.js` (insert a new function immediately above `function regenerateOneInspiringSlot_(body) {`, currently line 5214)

- [ ] **Step 1: Confirm the function is absent server-side and present once client-side**

Run (repo root):
```
node -e "const fs=require('fs');console.log('backend:',(fs.readFileSync('gas_backend/Code.js','utf8').match(/function cleanTextCorruption_/g)||[]).length);console.log('frontend:',(fs.readFileSync('js/00-config-state-utils.js','utf8').match(/function cleanTextCorruption_/g)||[]).length);"
```
Expected: `backend: 0` and `frontend: 1`.

- [ ] **Step 2: Insert the ported function**

In `gas_backend/Code.js`, find:
```js
function regenerateOneInspiringSlot_(body) {
  try {
```
Insert this **above** that `function regenerateOneInspiringSlot_` line:
```js
// 2026-06-04: Backend port of the front-end cleanTextCorruption_
// (js/00-config-state-utils.js). regenerateOneInspiringSlot_ calls it on the
// success path; without a server-side definition the call threw ReferenceError
// and surfaced to the Studio as "Regen failed: exception". Keep behaviour
// identical to the client cleaner.
function cleanTextCorruption_(value) {
  let s = String(value || '');
  const urls = [];
  s = s.replace(/https?:\/\/\S+/g, function (url) {
    const token = '__DLA_URL_' + urls.length + '__';
    urls.push(url);
    return token;
  });
  s = s.replace(/�/g, '');
  s = s.replace(/\b(students|learners|teachers|teams|groups|children|communities|families|parents|humans|elephants|animals)\?\s*([a-z])/gi, '$1’ $2');
  s = s.replace(/\b(student|learner|teacher|team|group|child|community|family|parent|human|elephant|animal|school|unit|world)\?\s*([a-z])/gi, '$1’s $2');
  s = s.replace(/([A-Za-z])\?([A-Za-z])/g, '$1’$2');
  s = s.replace(/([A-Za-z0-9)\]\}"”’])\s+\?\s+([A-Za-z0-9(\[\{"“])/g, '$1 — $2');
  s = s.replace(/\s+([,.;:])/g, '$1');
  s = s.replace(/ {2,}/g, ' ');
  s = s.replace(/__DLA_URL_(\d+)__/g, function (_, i) { return urls[Number(i)] || ''; });
  return s;
}

```
(Unicode escapes `’` `—` `“` `”` are the curly apostrophe, em-dash, and curly double-quotes — written as escapes so the file stays ASCII-safe through clasp.)

- [ ] **Step 3: Syntax gate**

Run: `node --check gas_backend/Code.js`
Expected: no output, exit 0.

- [ ] **Step 4: Confirm exactly one definition now exists server-side**

Run:
```
node -e "console.log((require('fs').readFileSync('gas_backend/Code.js','utf8').match(/function cleanTextCorruption_/g)||[]).length)"
```
Expected: `1`.

- [ ] **Step 5: Commit**

```
git add gas_backend/Code.js
git commit -m "fix: define cleanTextCorruption_ in GAS backend"
```
(Subject ≤50 chars, no AI attribution — repo commit hook enforces both.)

---

## Task 2: Backend — honour a curator-picked `forcedTool`

**Why:** The "Choose a tool myself" path sends `forcedTool`. When present, validate it, block intra-unit duplicates, and ask the model only to write the activity for that exact tool — skipping the tool-selection loop and auto-substitute. Backward compatible: no `forcedTool` ⇒ unchanged AI path.

**Files:**
- Modify: `gas_backend/Code.js` inside `regenerateOneInspiringSlot_` (insert after the `slotRoleLine` definition, before `const siblingFootprint = ...`)

- [ ] **Step 1: Insert the forced-tool branch**

In `gas_backend/Code.js`, find this exact pair of lines (end of the `slotRoleLine` ternary, then the sibling footprint line):
```js
      : 'This is slot ' + (sugIdx + 1) + ' of 6. Pick a single approved tool that opens a fresh angle on the unit theme.';

    const siblingFootprint = diversitySiblingToolFootprint_(data, idx);
```
Insert the following block **between** them (after the `slotRoleLine` line, before `const siblingFootprint`):
```js

    // ── Curator-picked tool path (2026-06-04) ──────────────────────────────
    // When the Studio picker supplies forcedTool, honour it exactly: validate
    // membership + age, block intra-unit duplicates, then ask the model ONLY to
    // write the activity for this tool. No tool-selection loop, no auto-swap.
    const forcedTool = (typeof body.forcedTool === 'string') ? body.forcedTool.trim() : '';
    if (forcedTool) {
      const fMembership = inspiringCheckToolMembership_([{ t: forcedTool, d: '' }], approvedSet, bannedSet, target.yl);
      if (!fMembership.ok) {
        return { error: 'forced-tool-invalid', reason: forcedTool + ' is not allowed here: ' + fMembership.reason };
      }
      let fDup = false;
      diversityToolComponents_(forcedTool).forEach(function (c) {
        if (otherKeys.has(diversityToolKey_(c))) fDup = true;
      });
      if (fDup) {
        return { error: 'forced-tool-duplicate', reason: forcedTool + ' is already used in another slot of this unit — pick a different tool' };
      }

      const fPrompt = 'You are a visionary Digital Learning Coach at Wesley College (IB PYP, Melbourne). You are rewriting ONE digital technology suggestion for a single unit. Output STRICT JSON only.\n\n' +
        'Campus: ' + target.ca + ' | Year Level: ' + target.yl + ' | Theme: "' + target.th + '"' +
        (target.ci ? '\nCentral Idea: "' + target.ci + '"' : '') +
        (target.lo ? '\nLines of Inquiry: "' + target.lo + '"' : '') +
        (target.plannerText ? '\nPlanner context: ' + String(target.plannerText).slice(0, 4000) : '') + '\n\n' +
        slotRoleLine + '\n' + sentenceRule + '\n\n' +
        'YOU MUST USE EXACTLY THIS TOOL: "' + forcedTool + '". Do not substitute, rename, abbreviate, or pair it with any other tool. Build the entire activity around "' + forcedTool + '".\n' +
        'TOOLS ALREADY USED IN OTHER SLOTS OF THIS UNIT (do not reuse their ideas): ' + (otherTools.length ? otherTools.join(', ') : '(none)') + '.\n\n' +
        'YEAR LEVEL GUIDANCE FOR ' + target.yl + ':\n' + inspiringYearRule_(target.yl) + '\n' +
        inspiringLessonsLibraryText_() + '\n' +
        INSPIRING_DESCRIPTION_RULES + '\n\n' +
        'Return ONLY a valid JSON object (no markdown, no backticks). Use straight apostrophes (\'). Wrap the single suggestion inside an "s" array so the schema is:\n' +
        '{ "s": [ { "t": "' + forcedTool + '", "d": "' + (isStemSlot ? '4-5' : '6') + ' inspiring sentences tailored to THIS unit, all built around ' + forcedTool + '." } ] }';

      let fParsed = null;
      let fReason = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        const call = inspiringCallOnce_(fPrompt, attempt > 1 ? 0.5 : 0.7);
        if (!call.ok) {
          fReason = call.error || 'unknown';
          if (call.retriable && attempt < 3) { Utilities.sleep(6000); continue; }
          break;
        }
        const p = (call.sugs && call.sugs.length > 0) ? call.sugs[0] : null;
        if (!p || !p.d) {
          fReason = 'response missing description';
          if (attempt < 3) { Utilities.sleep(3000); continue; }
          break;
        }
        fParsed = p;
        break;
      }
      if (!fParsed) {
        Logger.log('regenerateOneInspiringSlot_: FORCED-TOOL FAILED ' + target.ca + ' / ' + target.yl + ' / ' + target.th + ' slot ' + (sugIdx + 1) + ' tool=' + forcedTool + ' (' + fReason + ')');
        return { error: 'regen-failed', reason: fReason };
      }
      return {
        ok: true,
        idx: idx,
        sugIdx: sugIdx,
        t: cleanTextCorruption_(forcedTool),
        d: cleanTextCorruption_(fParsed.d),
        autoSwapped: false,
        ca: target.ca,
        yl: target.yl,
        th: target.th
      };
    }
    // ── end curator-picked tool path ───────────────────────────────────────
```

Note: every symbol used here is already in scope at this point — `approvedSet`, `bannedSet`, `otherTools`, `otherKeys`, `isStemSlot`, `sentenceRule`, `slotRoleLine`, `target`, `idx`, `sugIdx` — and the helpers `inspiringCheckToolMembership_`, `diversityToolComponents_`, `diversityToolKey_`, `inspiringYearRule_`, `inspiringLessonsLibraryText_`, `inspiringCallOnce_`, `cleanTextCorruption_` (added in Task 1), plus the constant `INSPIRING_DESCRIPTION_RULES`, all exist.

- [ ] **Step 2: Syntax gate**

Run: `node --check gas_backend/Code.js`
Expected: no output, exit 0.

- [ ] **Step 3: Confirm the AI path is untouched below the branch**

Run:
```
node -e "const s=require('fs').readFileSync('gas_backend/Code.js','utf8');console.log('forcedTool refs:',(s.match(/forcedTool/g)||[]).length);console.log('still has AI loop:', s.includes('for (let attempt = 1; attempt <= 3; attempt++) {'));"
```
Expected: `forcedTool refs:` ≥ 7, and `still has AI loop: true`.

- [ ] **Step 4: Commit**

```
git add gas_backend/Code.js
git commit -m "feat: forcedTool support in slot regen"
```

---

## Task 3: Backend deploy + smoke check (regen works again)

**Why:** Tasks 1–2 are backward compatible and independently shippable. Deploying now restores the broken ↻ for every class before the front-end ships.

**Files:** none (deploy only)

- [ ] **Step 1: Push the backend to clasp HEAD**

```
cd gas_backend; clasp push
```
Expected: "Pushed N files." If clasp errors with a TLS/self-signed-certificate message, set `NODE_EXTRA_CA_CERTS` to the corp bundle (`~/wesley-corp-roots.pem`) for the session and retry.

- [ ] **Step 2: Bump the pinned live deployment to HEAD**

`clasp push` updates HEAD only; the live `/exec` URL is pinned. Find the deployment ID and bump it:
```
clasp deployments
clasp deploy --deploymentId <ID-from-previous-output> --description "slot regen: fix cleanTextCorruption_ + forcedTool"
```
Expected: "Deployed <ID> @<n>."

- [ ] **Step 3: Manual smoke check (Studio in browser)**

Browse → any class → ↻ on a suggestion → (the chooser is not built yet, so this still calls the old direct path **only if** Task 4 isn't deployed — skip until Task 7). For now, confirm via the Apps Script editor: open `regenerateOneInspiringSlot_`, Run a manual test with a known `ca/yl/th/sugIdx`, and confirm it returns `{ ok:true, t, d }` rather than `{ error:'exception' }`.

- [ ] **Step 4: Return to repo root**

```
cd ..
```

---

## Task 4: Front-end — chooser + AI path + real error message

**Why:** Replace the immediate-regen `regenSingleSug` with a chooser, move the current behaviour into a shared `runSlotRegen_`, and surface the server's real `message` instead of the bare word "exception".

**Files:**
- Modify: `js/06-bulk-router-chat.js` — replace `regenSingleSug` (lines 1755–1797)

- [ ] **Step 1: Replace the function**

In `js/06-bulk-router-chat.js`, replace the entire current function body from:
```js
async function regenSingleSug(entryIdx, sugIdx){
```
down to its closing brace at line 1797 (the one immediately before the `// 2026-05-28: Legacy client-side regenSingleSug body kept here` comment) with:
```js
// 2026-06-04: regenSingleSug now opens a chooser (AI vs pick-a-tool). Both
// routes share runSlotRegen_, which posts to the server-side
// regenerateOneInspiringSlot action and shows the draft via showChangesPopup
// for human approval before writing.
function regenSingleSug(entryIdx, sugIdx){
  const entry = DATA[entryIdx];
  const currentSug = getSugs(entry)[sugIdx];
  const currentTool = sugTool(currentSug) || 'this tool';
  const existing = document.getElementById('regen-chooser-overlay');
  if(existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'regen-chooser-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:440px;width:100%;box-sizing:border-box">
      <h3 style="font-size:18px;font-weight:900;margin:0 0 6px">Replace ${esc(currentTool)}?</h3>
      <p style="font-size:13px;color:var(--dim);margin:0 0 18px">Let the AI pick a fresh tool, or choose one yourself.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-pri" id="regen-chooser-ai" style="flex:1;min-width:150px">✨ Let AI choose</button>
        <button class="btn" id="regen-chooser-pick" style="flex:1;min-width:150px">📋 Choose a tool myself</button>
      </div>
      <div style="text-align:center;margin-top:14px">
        <button class="btn-sm" id="regen-chooser-cancel" style="border:none">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (ev)=>{ if(ev.target===overlay) overlay.remove(); });
  document.getElementById('regen-chooser-cancel').onclick = ()=> overlay.remove();
  document.getElementById('regen-chooser-ai').onclick = ()=>{ overlay.remove(); regenSlotWithAI(entryIdx, sugIdx); };
  document.getElementById('regen-chooser-pick').onclick = ()=>{ overlay.remove(); openSlotToolPicker(entryIdx, sugIdx); };
}

function regenSlotWithAI(entryIdx, sugIdx){ return runSlotRegen_(entryIdx, sugIdx, null); }
function regenSlotWithTool(entryIdx, sugIdx, toolName){ return runSlotRegen_(entryIdx, sugIdx, toolName); }

async function runSlotRegen_(entryIdx, sugIdx, forcedTool){
  const uid = `s${entryIdx}_${sugIdx}`;
  const btn = document.getElementById(uid+'-regen');
  if(btn){ btn.textContent='…'; btn.disabled=true; }
  startProgress();
  const entry = DATA[entryIdx];
  const currentSug = getSugs(entry)[sugIdx];
  const currentTool = sugTool(currentSug);
  try{
    const payload = withGASToken({
      action: 'regenerateOneInspiringSlot',
      ca: entry.ca,
      yl: entry.yl,
      th: entry.th,
      idx: entryIdx,
      sugIdx: sugIdx
    });
    if(forcedTool) payload.forcedTool = forcedTool;
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if(result.error){
      throw new Error(result.reason || result.message || result.error);
    }
    if(!result.t || !result.d){
      throw new Error('Server returned no suggestion');
    }
    const reason = forcedTool
      ? `Single slot regen — curator chose ${forcedTool}`
      : (result.autoSwapped
          ? 'Single slot regen — server auto-substituted an off-whitelist pick'
          : 'Single slot regen via inspiring pipeline');
    window._snapshotReason = `Before regenerating ${currentTool || 'suggestion'} in ${entry.yl} ${entry.th}`;
    showChangesPopup([{ entryIdx, sugIdx, t: result.t, d: result.d, reason }]);
    setStatus('Regenerated draft ready for review');
  }catch(e){
    setStatus('Regen failed: '+e.message, 'error');
  }finally{
    stopProgress();
    if(btn){ btn.textContent='↻'; btn.disabled=false; }
  }
}
```

- [ ] **Step 2: Syntax gate**

Run: `node --check js/06-bulk-router-chat.js`
Expected: no output, exit 0.

- [ ] **Step 3: Confirm names line up**

Run:
```
node -e "const s=require('fs').readFileSync('js/06-bulk-router-chat.js','utf8');['function regenSingleSug','function regenSlotWithAI','function regenSlotWithTool','async function runSlotRegen_'].forEach(n=>console.log(n, s.includes(n)));"
```
Expected: all four print `true`.

- [ ] **Step 4: Commit**

```
git add js/06-bulk-router-chat.js
git commit -m "feat: regen chooser + shared slot regen runner"
```

---

## Task 5: Front-end — the tool picker

**Why:** "Choose a tool myself" needs a year-appropriate approved-tool grid with already-used tools disabled. Uses the existing `getAgeAppropriateTools(yl)` (returns approved, age-filtered, banned-filtered tool name strings) and the existing `.fb-chip` / `.inp` styles.

**Files:**
- Modify: `js/06-bulk-router-chat.js` — add `openSlotToolPicker` directly after the `runSlotRegen_` block from Task 4

- [ ] **Step 1: Add the picker function**

In `js/06-bulk-router-chat.js`, immediately after the closing brace of `runSlotRegen_` (added in Task 4), insert:
```js

// 2026-06-04: Year-appropriate approved-tool grid for "Choose a tool myself".
// Tools already used in OTHER slots of this unit are disabled (matches the
// server's intra-unit duplicate guard). Clicking a tool runs a forced-tool regen.
function openSlotToolPicker(entryIdx, sugIdx){
  const entry = DATA[entryIdx];
  const sugs = getSugs(entry);
  const currentTool = sugTool(sugs[sugIdx]) || '';
  const usedKeys = new Set(
    sugs.map((s, i) => (i === sugIdx ? null : toolKey(sugTool(s)))).filter(Boolean)
  );
  const tools = (getAgeAppropriateTools(entry.yl) || []).slice().sort((a, b) => a.localeCompare(b));

  const existing = document.getElementById('slot-tool-picker-overlay');
  if(existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'slot-tool-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px';

  const tiles = tools.map(name => {
    const used = usedKeys.has(toolKey(name));
    const sameAsCurrent = toolKey(name) === toolKey(currentTool);
    const dis = used ? ' disabled title="Already used elsewhere in this unit"' : '';
    const suffix = used ? ' • in use' : (sameAsCurrent ? ' (current)' : '');
    return `<button class="fb-chip" data-tool="${esc(name)}"${dis}>${esc(name)}${suffix}</button>`;
  }).join('');

  const grid = tools.length
    ? `<div id="slot-tool-grid" style="display:flex;flex-wrap:wrap;gap:8px;overflow-y:auto;max-height:46vh;align-content:flex-start;padding:2px">${tiles}</div>`
    : `<div style="color:var(--dim);font-size:13px;padding:18px 0">No approved tools available for ${esc(entry.yl)}. Check the Tool Inventory, or use "Let AI choose".</div>`;

  overlay.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:680px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-sizing:border-box">
      <h3 style="font-size:18px;font-weight:900;margin:0 0 4px">Choose a replacement tool</h3>
      <p style="font-size:13px;color:var(--dim);margin:0 0 14px">Approved tools for ${esc(entry.yl)}. Greyed-out tools are already used elsewhere in this unit. The AI writes a fresh activity around your pick.</p>
      <input id="slot-tool-search" class="inp" placeholder="Search tools…" autocomplete="off" style="margin-bottom:14px">
      ${grid}
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button class="btn" id="slot-tool-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (ev)=>{ if(ev.target===overlay) overlay.remove(); });
  document.getElementById('slot-tool-cancel').onclick = ()=> overlay.remove();

  const search = document.getElementById('slot-tool-search');
  if(search){
    search.focus();
    search.addEventListener('input', ()=>{
      const q = search.value.trim().toLowerCase();
      overlay.querySelectorAll('#slot-tool-grid .fb-chip').forEach(chip => {
        const name = (chip.getAttribute('data-tool') || '').toLowerCase();
        chip.style.display = name.includes(q) ? '' : 'none';
      });
    });
  }
  overlay.querySelectorAll('#slot-tool-grid .fb-chip').forEach(chip => {
    if(chip.disabled) return;
    chip.onclick = ()=>{
      const tool = chip.getAttribute('data-tool');
      overlay.remove();
      regenSlotWithTool(entryIdx, sugIdx, tool);
    };
  });
}
```

- [ ] **Step 2: Syntax gate**

Run: `node --check js/06-bulk-router-chat.js`
Expected: no output, exit 0.

- [ ] **Step 3: Confirm the picker resolves its dependencies (names exist in the file/globals)**

Run:
```
node -e "const s=require('fs').readFileSync('js/06-bulk-router-chat.js','utf8');['function openSlotToolPicker','getAgeAppropriateTools','toolKey','regenSlotWithTool'].forEach(n=>console.log(n, s.includes(n)));"
```
Expected: all `true`. (`getAgeAppropriateTools` lives in `js/05-bulk-setup-libraries.js`; `toolKey` is a global used at `js/06:1729` — both load before use at runtime.)

- [ ] **Step 4: Commit**

```
git add js/06-bulk-router-chat.js
git commit -m "feat: year-appropriate tool picker for slot regen"
```

---

## Task 6: Version bump (cache-bust)

**Why:** Browsers serve cached `js/` unless `APP_VERSION` and every `?v=` query string are bumped together (repo rule). Front-end changed in Tasks 4–5, so bump 5.23 → 5.24.

**Files:**
- Modify: `js/00-config-state-utils.js:6` (`APP_VERSION`)
- Modify: `DLA_Studio.html` (10 `?v=5.23` query strings, ~lines 655–664)

- [ ] **Step 1: Bump APP_VERSION**

In `js/00-config-state-utils.js`, change line 6 from:
```js
const APP_VERSION = '5.23';
```
to:
```js
const APP_VERSION = '5.24';
```
(If the current literal is not exactly `'5.23'`, bump whatever it is by one minor — read the line first.)

- [ ] **Step 2: Bump every script tag's `?v=`**

In `DLA_Studio.html`, replace all occurrences of `?v=5.23` with `?v=5.24` (expect 10).

- [ ] **Step 3: Verify the bump is consistent**

Run:
```
node -e "const fs=require('fs');console.log('APP_VERSION 5.24:', /APP_VERSION\s*=\s*'5\.24'/.test(fs.readFileSync('js/00-config-state-utils.js','utf8')));const h=fs.readFileSync('DLA_Studio.html','utf8');console.log('?v=5.24 count:', (h.match(/\?v=5\.24/g)||[]).length, '| leftover ?v=5.23:', (h.match(/\?v=5\.23/g)||[]).length);"
```
Expected: `APP_VERSION 5.24: true`, `?v=5.24 count: 10`, `leftover ?v=5.23: 0`.

- [ ] **Step 4: Commit**

```
git add js/00-config-state-utils.js DLA_Studio.html
git commit -m "chore: bump Studio version to 5.24"
```

---

## Task 7: Deploy front-end + full manual verification

**Files:** none (deploy + verify)

- [ ] **Step 1: Push the static site**

```
git push
```
Expected: pushes to `main`; GitHub Pages redeploys within ~1 min.

- [ ] **Step 2: Hard-reload the Studio**

Open `DLA_Studio.html` (deployed), sign in, click the ↻ (force-reload) control, and confirm the bottom-left version reads **5.24**.

- [ ] **Step 3: Verify the bug fix (AI path)**

Browse → a **Year 4** class → ↻ on a suggestion → chooser appears → **Let AI choose** → a draft appears in the "Review Proposed Changes" popup with **no "Regen failed: exception"**. Approve → confirm it saves to the unit.

- [ ] **Step 4: Verify the picker (forced-tool path)**

↻ → **Choose a tool myself** → the grid shows year-appropriate approved tools; tools already used elsewhere in the unit are greyed/disabled; the search box filters. Pick an enabled tool → a draft built around that exact tool appears in the review popup → approve → confirm the slot now shows the chosen tool.

- [ ] **Step 5: Verify the block rule**

Confirm a greyed (already-used) tool cannot be clicked. (Server backstop already in place via `forced-tool-duplicate`.)

- [ ] **Step 6: Spot-check another year level**

Repeat Step 3 on a non-Year-4 class to confirm the exception fix is global.

- [ ] **Step 7: Mark complete**

Only after Steps 2–6 pass in the browser, report done with the observed results.

---

## Self-review checklist (run after writing, before executing)

- **Spec coverage:** exception fix (Task 1), forcedTool backend (Task 2), chooser + error surfacing (Task 4), year-appropriate picker with block (Task 5), version bump (Task 6), deploy + manual verify (Tasks 3, 7). All spec requirements mapped.
- **Type/name consistency:** `runSlotRegen_(entryIdx, sugIdx, forcedTool)` defined in Task 4 and called by `regenSlotWithAI`/`regenSlotWithTool` (Task 4) and `openSlotToolPicker` (Task 5). Backend reads `body.forcedTool`; front-end sends `payload.forcedTool`. Return shape `{ ok, idx, sugIdx, t, d, autoSwapped, ca, yl, th }` matches what `runSlotRegen_` reads (`result.t`, `result.d`, `result.autoSwapped`, `result.error`, `result.reason`, `result.message`).
- **No placeholders:** every code step contains complete code; no TBD/TODO.
