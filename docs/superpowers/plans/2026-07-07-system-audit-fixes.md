# 2026-07-07 System Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship all five audit-approved fix areas: scrambled-text repair, analytics catch-up, soup-unit regen, Studio button fixes, backend guardrails.

**Architecture:** Drive data.json is the source of truth (backend pushes it to GitHub; the public site reads the GitHub copy). All data repair therefore runs server-side in gas_backend via a new doPost action, called headlessly with the clasp OAuth token. Client tracking posts a new `interaction` event type to the existing FBHOOK analytics web app; a new Interactions sheet feeds a new Studio dashboard card.

**Tech Stack:** Vanilla JS (index.html public site, js/00-09 Studio), Google Apps Script (gas_backend, gas_analytics), clasp deploys, python for all repo file edits.

## Global Constraints

- ALL repo source files are CRLF. NEVER use the Edit/Write tools on them — edit via `python` with `open(..., newline='')` and CRLF-preserving string ops, then plain `git add` (autocrlf=true cleans). (Established gotcha, confirmed repo-wide.)
- Studio changes: bump APP_VERSION in js/00 AND `?v=` on all 9 script tags in DLA_Studio.html together (5.50 → 5.51), once, in the last Studio-touching commit.
- Auto-commit+push each completed task (user-approved standing rule). Commit messages normal English.
- Backend deploys: `clasp push` + `clasp deploy` from gas_backend/ (and gas_analytics/ for the collector) with `NODE_EXTRA_CA_CERTS=~/wesley-corp-roots.pem`. Redeploy the EXISTING deployment id (`clasp deployments` → `clasp deploy -i <id>`), never create a second web app URL.
- Headless backend calls: POST to backend exec URL with `{action, googleAccessToken: <token from clasp creds>}`; requireAllowedUser_ verifies via userinfo.
- Never touch the DLA_SHARED_SECRET fast path.
- data.json safety: local timestamped backup before repair; repair has dryRun mode; dry-run counts must match local analysis before live run.

---

### Task 1: Scrambled-text repair map (local analysis)

**Files:**
- Create: `<scratchpad>/build_repair_map.py`, output `<scratchpad>/repair_map.json` + `<scratchpad>/repair_dryrun_report.txt`

**Steps:**
- [x] Inventory done: 7,485 tokens, 1,037 distinct, fields: plannerContextRich 6707, d 746, plannerText 10, fromTool/from 22.
- [ ] Build map with rule classes, in priority order:
  1. EXCLUDE tokens whose right side is a URL-param word: `v, usp, si, sa, pli, tabindex, id, gl, hl, t, q, list, index, feature` or containing digits → never fix.
  2. Apostrophe rules: `([A-Za-z])\?(s|re|ll|ve|m)\b` → `$1'$2`; `n\?t\b` → `n't`; `i\?d\b`/`you\?d\b`/`we\?d\b`/`they\?d\b`/`he\?d\b`/`she\?d\b` → `'d`.
  3. Ligature dictionary (explicit, from inventory): di?erent→different, pro?le→profile, re?ect*→refl*, e?ectiv*→effectiv*, pro?t→profit, in?uence→influence, identi?ed→identified, speci?c→specific, de?nition/de?ne/de?ning→defini*/define/defining, signi?cant*→significant*, con?ict→conflict, con?dence→confidence, re?ne→refine, sca?old*→scaffold*, o?cial→official, su?ciently→sufficiently, o?ine→offline, ful?l→fulfil, wild?res→wildfires, bene?t/bene?cial→benefit/beneficial, scienti?c→scientific, a?ect*→affect*, e?ort→effort, o?er*→offer*, di?erence*/di?erently→difference*/differently, e?ectiveness→effectiveness (validate every distinct token; unknowns → review list).
  4. Word-joins (em-dash/hyphen loss): explicit per-token decisions from the review list (e.g. activity?prompt, colours?such, blacks?while, see?think) — mapped by hand after eyeballing context. Anything unresolved stays UNFIXED (report it, don't guess).
- [ ] Dry-run against repo data.json: report replacements per token, remaining unfixed tokens, zero URL hits. Manually review the residual list.

### Task 2: Server-side repair action + live run

**Files:**
- Modify: `gas_backend/Code.js` — add `REPAIR_TEXT_MAP` (embedded from repair_map.json), `repairScrambledText(opts)`, doPost branch `repairscrambledtext`.

**Interfaces:** doPost `{action:'repairscrambledtext', dryRun:true|false}` → `{ok, dryRun, replacements, perToken:{tok:n}, unitsTouched}`; live run saves data.json + `pushToGitHub()`.

**Core code:**
```js
function repairScrambledText(opts) {
  opts = opts || {};
  var dryRun = !!opts.dryRun;
  var file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  var data = JSON.parse(file.getBlob().getDataAsString());
  var perToken = {}, total = 0, unitsTouched = 0;
  function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function fixString(s) {
    var out = s;
    REPAIR_TEXT_MAP.forEach(function (m) {   // m = { from:'di?erent', to:'different' }
      var re = new RegExp(esc(m.from), 'gi');
      out = out.replace(re, function (hit) {
        total++; perToken[m.from] = (perToken[m.from] || 0) + 1;
        return (hit.charAt(0) === hit.charAt(0).toUpperCase())
          ? m.to.charAt(0).toUpperCase() + m.to.slice(1) : m.to;
      });
    });
    return out;
  }
  function walk(o) {
    var changed = false;
    if (Array.isArray(o)) { o.forEach(function (v, i) { if (typeof v === 'string') { var f = fixString(v); if (f !== v) { o[i] = f; changed = true; } } else if (v && typeof v === 'object') { if (walk(v)) changed = true; } }); }
    else { Object.keys(o).forEach(function (k) { var v = o[k]; if (typeof v === 'string') { var f = fixString(v); if (f !== v) { o[k] = f; changed = true; } } else if (v && typeof v === 'object') { if (walk(v)) changed = true; } }); }
    return changed;
  }
  data.forEach(function (u) { if (u && typeof u === 'object' && walk(u)) unitsTouched++; });
  if (!dryRun && total > 0) { file.setContent(JSON.stringify(data, null, 2)); try { pushToGitHub(); } catch (e) { Logger.log('repairScrambledText push failed: ' + e); } }
  return { ok: true, dryRun: dryRun, replacements: total, perToken: perToken, unitsTouched: unitsTouched };
}
```
Guard: token `di?erent` etc. can't hit URLs because `?` in the map entries always sits between letters and URL-param tokens were excluded from the map.

- [ ] Backup: copy repo data.json → `data.json.backup-20260707` (untracked).
- [ ] Embed map, add doPost branch, python-edit Code.js, `clasp push`, deploy.
- [ ] Headless dryRun → compare totals to Task 1 local dry-run (must match within URL-exclusion differences).
- [ ] Live run → `git pull` (backend pushed data.json) → re-run inventory: teacher-visible `d`/`plannerText` token count ≈ 0; commit any repo-side artefacts.

### Task 3: Analytics collector — `interaction` type + delete orphaned reactions

**Files:** Modify `gas_analytics/Code.js`.

- [ ] Add `INTERACTIONS: 'Interactions'` to SHEETS; header `['Timestamp','Session','Kind','Page','Campus','Year Level','Detail']`.
- [ ] Add handler + doPost branch:
```js
const INTERACTION_KINDS = ['tech_picker_open','tech_picker_generate','tech_picker_regen','tech_picker_custom','copilot_open','stem_reveal','feedback_open','uoi_submit','tech_chip_reopen'];
function handleInteraction_(ss, body) {
  const sheet = ensureSheet_(ss, SHEETS.INTERACTIONS);
  const kind = clean_(body.kind).toLowerCase();
  if (INTERACTION_KINDS.indexOf(kind) === -1) { logError_(ss, 'interaction_unknown_kind', 'interaction', body, ''); return; }
  sheet.appendRow([new Date(), clean_(body.session), kind, clean_(body.page), clean_(body.campus), clean_(body.year), clean_(body.detail)]);
}
```
- [ ] Delete: `handleReaction_`, the `reaction` doPost branch, `REACTIONS` from SHEETS/HEADERS, `REACTION_DEBOUNCE_MS`, and the header-comment line for reaction.
- [ ] `clasp push` + redeploy same deployment id. Verify with a curl test POST (interaction row lands; reaction now logs unknown_type to Errors).

### Task 4: index.html — trackInteraction + back-button dwell fix

**Files:** Modify `index.html` (python edit; publishes on git push).

- [ ] Add next to `_flushAnalytics`:
```js
function trackInteraction(kind,detail){try{var p={type:'interaction',v:'2',session:_userSession,kind:kind,page:_pageName,campus:_pageCampus,year:_pageYear,detail:String(detail||'').slice(0,200)};fetch(FBHOOK,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify(p)}).catch(function(){});}catch(e){}}
```
- [ ] One-line hooks at function heads (or success callbacks):
  - `openTechPicker` → `trackInteraction('tech_picker_open',theme);`
  - `pickTech` → `trackInteraction('tech_picker_generate',tool);`
  - `regenTechResultFromOverlay` → `trackInteraction('tech_picker_regen','');`
  - `regenWithCustomDetails` → `trackInteraction('tech_picker_custom','');`
  - `openCopilotHelper` → `trackInteraction('copilot_open','');` (after `if(!d)return;`)
  - `openStem` → `trackInteraction('stem_reveal',d.toolLabel);` (after `if(!d)return;`)
  - `openFB` → `trackInteraction('feedback_open','');`
  - `submitUoiEdit` success `.then` (after parsed-error check) → `trackInteraction('uoi_submit',theme);`
  - `reopenTechChip` → `trackInteraction('tech_chip_reopen','');`
- [ ] `bk()` dwell fix — close the page timer on back-nav with the same trackPage used forward:
```js
function bk(){if(S.v==="detail"){S.ui=null;S.v="units";trackPage(S.yl||"Units",CN[S.ca]||"",S.yl||"")}else if(S.v==="units"){S.yl=null;S.v="campus";trackPage((CN[S.ca]||"")+" campus",CN[S.ca]||"","")}else if(S.v==="campus"){S.ca=null;S.v="home";trackPage("Home","","");loadLeaderboard()}else{S.v="home";trackPage("Home","","");loadLeaderboard();}pushHash();R()}
```
- [ ] Commit + push.

### Task 5: Studio dashboard — Interactions card

**Files:** Modify `js/09-legacy-restored.js` (fetch), `js/04-audit-analytics-live.js` (render), `DLA_Studio.html` (container div if needed).

- [ ] In `loadLiveAnalytics` add tolerant fetch after the Intent block: `let interactionRows=[]; try{ interactionRows=await readSheetRange('Interactions!A1:G5000'); }catch(e){ interactionRows=[]; }` and stash `window._interactionRowsCache=interactionRows;` (+ add to `_growthRowsCache`).
- [ ] New renderer in js/04 `renderInteractionsCard()` — counts by Kind with friendly labels (Tool picker opened / AI idea generated / Copilot helper / STEM reveals / Feedback opened / Proposals submitted), plus headline "AI generations" total (`tech_picker_generate+tech_picker_regen+tech_picker_custom`); render into a new panel in the Engagement subtab (locate its container at impl time; same pattern as funnel panel). Call it from `loadLiveAnalytics` next to `renderLiveEngagementExtras()`.

### Task 6: Studio button fixes

**Files:** `js/00-config-state-utils.js`, `js/06-bulk-router-chat.js`, `js/09-legacy-restored.js`, `js/02-ui-load-navigation.js`, then version bump in `js/00` + `DLA_Studio.html`.

- [ ] **Ctrl+U undo** — implement in js/00 under recordChange:
```js
async function undoLastChange(){
  const pos = CHANGE_HISTORY.findIndex(en => en && typeof en.idx === 'number' && Array.isArray(en.oldSugs));
  if(pos === -1){ if(typeof setStatus==='function') setStatus('Nothing to undo — no suggestion change recorded this session'); return; }
  const h = CHANGE_HISTORY[pos];
  CHANGE_HISTORY.splice(pos, 1);
  if(!DATA[h.idx]){ if(typeof setStatus==='function') setStatus('Undo failed: unit no longer exists','error'); return; }
  DATA[h.idx].s = JSON.parse(JSON.stringify(h.oldSugs));
  if(typeof renderEntry === 'function' && CURRENT_ENTRY_IDX === h.idx) renderEntry(h.idx);
  if(typeof renderBrowse === 'function') renderBrowse();
  await saveToDrive();
  if(typeof setStatus==='function') setStatus('↶ Undid last suggestion change to "' + (DATA[h.idx].th||'unit') + '"');
}
```
  (Verify renderEntry/renderBrowse signatures at impl.)
- [ ] **'no planner' dup card** — js/06:753 label → `'no planner summary'` (filterIssueType map already routes it to missingplanner).
- [ ] **addToGASQueue false success** — js/09:481: drop `mode:'no-cors'`, read the JSON like every other GAS POST:
```js
const r = await fetch(SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(withGASToken({action:'addToQueue', ca, yl, th, ci:''}))});
const result = await r.json().catch(()=>({}));
if(result && result.error) throw new Error(result.error);
```
- [ ] **downloadJSON side effect** — js/02:380: delete `if(DRIVE_FILE_ID) saveToDrive();`.
- [ ] Version bump 5.50→5.51 (js/00 APP_VERSION + all 9 `?v=` in DLA_Studio.html). Commit + push.
- [ ] NOTE: audit's CP-05 (realism progress bar) was a false positive — elements exist at js/09:684-686. No action. CP-04 (feedback panel wipe on re-render) accepted as known-low; skip this round to bound scope.

### Task 7: Backend guardrails

**Files:** `gas_backend/Code.js`, `js/05-bulk-setup-libraries.js`, `tests/banned-phrase.impl.js` untouched (grader already bans).

- [ ] **Slot-regen opener guard**: add helper + wire both branches of `regenerateOneInspiringSlotCore_` when `sugIdx===0`:
```js
function slotOpenerDupesSibling_(data, idx, toolName) {
  var target = data[idx]; var key = diversityToolKey_(toolName); if (!key) return null;
  for (var k = 0; k < data.length; k++) {
    if (k === idx) continue; var u = data[k];
    if (!u || u.ca !== target.ca || u.yl !== target.yl) continue;
    if (diversityToolKey_(diversitySlotTool_(u, 0)) === key) return u.th || 'sibling unit';
  }
  return null;
}
```
  Forced-tool branch: on collision return `{ error:'forced-tool-opener-dup', reason: forcedTool+' already opens sibling unit "'+sib+'" in this year level — pick a different tool for slot 1' }`. Free-pick branch: treat as validation failure (`lastReason=...; continue` retry), same as the dup check.
- [ ] **Generation-time twist ban**: in `INSPIRING_DESCRIPTION_RULES` banned list add line: `'  - "For a twist" / "To stretch" / "Take it further" / "For an extra challenge" — vary openings naturally instead of stock lead-ins.\n'`; mirror the same line in js/05 SUGGESTION_STYLE banned block (~line 78). Also add `'to stretch'`, `'take it further'`, `'for an extra challenge'` to `AUDIT_BANNED_PHRASES`.
- [ ] **Silent-failure surfacing**: (a) auditPlanners catch (Code.js:1572) → also `PropertiesService.getScriptProperties().setProperty('DLA_LAST_AUDIT_SAVE_FAIL', new Date().toISOString()+' '+writeErr);` (b) inside `pushToGitHub` set `DLA_LAST_GITHUB_PUSH_FAIL` property on final failure, delete it on success (single chokepoint covers all ~15 swallowed call sites); (c) new doGet `action=health` returning `{ok:true, lastAuditSaveFail, lastGitHubPushFail}` from those properties.
- [ ] `clasp push` + deploy. Commit + push.

### Task 8: Soup-unit regen (server-side, resumable)

**Files:** `gas_backend/Code.js` REPAIR_CONTAM_TARGETS.

- [ ] Local scan first: quick python heuristic across pre-2026-06-04 `inspiringRegenAt` units for cross-theme keyword bleed (e.g. "disaster" outside HWW/STP) → confirm target list = GW Y5 "How We Express Ourselves", StK Y3 "Where We Are in Place and Time" (+ any new finds).
- [ ] Replace REPAIR_CONTAM_TARGETS with the new tuples (old two are verified clean — remove).
- [ ] Deploy; headless `repaircontaminated` → wait for the self-removing trigger regen; then `finishrepaircontaminated` (slot-6 makerspace purge). Verify via fresh data.json pull: no disaster bleed in targets, plannerText non-empty, s[5] on-topic.

### Task 9: Verify everything + wrap up

- [ ] verifier agent: re-run "?"-token inventory (teacher-visible ≈ 0); confirm interaction POST lands in sheet; health endpoint responds; Studio v5.51 tags consistent; slot-0 regen rejects sibling opener (code inspection); git clean/pushed; deployments live.
- [ ] Update memories (audit backlog file → mark shipped items) and MEMORY.md.
- [ ] Final plain-English report to Nathan: what shipped, how to see it, what's deliberately left (77 existing "twist" texts await the quality-audit feature; CP-04 low-risk panel refresh).
