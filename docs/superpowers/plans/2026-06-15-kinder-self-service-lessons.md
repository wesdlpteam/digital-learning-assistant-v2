# Kinder year groups + teacher self-service lesson ideas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3YO + 4YO kinder year groups to Elsternwick and St Kilda, and make the existing teacher CI/LOI proposal loop auto-generate lesson ideas on approval, with email + dashboard notifications on submission.

**Architecture:** Reuse the existing proposal loop (public form `submitUoiEdit` → `submitUoiProposal_` → Studio `approveUoiProposal_`). Fill four gaps: seed 24 empty kinder units into the Drive `data.json`; have approval call `regenerateOneInspiring_` to fill the 6 lesson ideas; email dlpteam@ on submit; show a pending badge on the Studio dashboard. Plus a label-only "St Kilda Road" display change.

**Tech Stack:** Google Apps Script (`gas_backend/Code.js`), plain global-scope browser JS (`js/*.js`, `DLA_Studio.html`, `index.html`), Node for the one pure-function test.

**Spec:** `docs/superpowers/specs/2026-06-15-kinder-self-service-lessons-design.md`

**Pre-flight (read before starting):**
- gas_backend EOL gotcha (from project memory): edit `gas_backend/Code.js` carefully re. CRLF; after editing, stage with plain `git add` (autocrlf handles it) — do not use `-c core.autocrlf=false`.
- The six themes, used verbatim everywhere: `Who We Are`, `Where We Are in Place and Time`, `How We Express Ourselves`, `How the World Works`, `How We Organise Ourselves`, `Sharing the Planet`.
- Kinder year-level strings, verbatim: `3 Year Old Kinder`, `4 Year Old Kinder`. Campuses: `Elsternwick`, `St Kilda` (internal value unchanged).

---

## Task 1: Pure helper for the 24 kinder unit combos (TDD)

**Files:**
- Create: `tests/kinder-seed.impl.js`
- Create: `tests/kinder-seed.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/kinder-seed.test.js — Run: node tests/kinder-seed.test.js
const { kinderUnitsToSeed_ } = require('./kinder-seed.impl.js');
let f = 0; const ck = (n, c) => { if (!c) { console.error('FAIL', n); f++; } else console.log('ok', n); };

const combos = kinderUnitsToSeed_();
ck('produces exactly 24 combos', combos.length === 24);
ck('every combo has empty ci/lo and empty s', combos.every(u => u.ci === '' && u.lo === '' && Array.isArray(u.s) && u.s.length === 0));
ck('campuses are Elsternwick + St Kilda only', new Set(combos.map(u => u.ca)).size === 2 && combos.every(u => u.ca === 'Elsternwick' || u.ca === 'St Kilda'));
ck('year levels are the two kinder strings only', combos.every(u => u.yl === '3 Year Old Kinder' || u.yl === '4 Year Old Kinder'));
ck('each campus+year has all six themes', (() => {
  const themes = ['Who We Are','Where We Are in Place and Time','How We Express Ourselves','How the World Works','How We Organise Ourselves','Sharing the Planet'];
  return ['Elsternwick','St Kilda'].every(ca => ['3 Year Old Kinder','4 Year Old Kinder'].every(yl => {
    const got = combos.filter(u => u.ca === ca && u.yl === yl).map(u => u.th).sort();
    return JSON.stringify(got) === JSON.stringify([...themes].sort());
  }));
})());
ck('no duplicate ca|yl|th combos', new Set(combos.map(u => u.ca + '|' + u.yl + '|' + u.th)).size === 24);

if (f) process.exit(1); console.log('passed'); process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/kinder-seed.test.js`
Expected: FAIL — `Cannot find module './kinder-seed.impl.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// tests/kinder-seed.impl.js — mirror of gas_backend kinderUnitsToSeed_ (Code.js)
function kinderUnitsToSeed_() {
  var campuses = ['Elsternwick', 'St Kilda'];
  var years = ['3 Year Old Kinder', '4 Year Old Kinder'];
  var themes = ['Who We Are', 'Where We Are in Place and Time', 'How We Express Ourselves', 'How the World Works', 'How We Organise Ourselves', 'Sharing the Planet'];
  var out = [];
  campuses.forEach(function (ca) {
    years.forEach(function (yl) {
      themes.forEach(function (th) {
        out.push({ ca: ca, yl: yl, th: th, ci: '', lo: '', s: [] });
      });
    });
  });
  return out;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { kinderUnitsToSeed_ };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/kinder-seed.test.js`
Expected: `passed` (exit 0), all `ok` lines.

- [ ] **Step 5: Commit**

```bash
git add tests/kinder-seed.impl.js tests/kinder-seed.test.js
git commit -m "test: kinder unit seed combos helper"
```

---

## Task 2: Seed the 24 kinder units into Drive data.json (gas_backend)

**Files:**
- Modify: `gas_backend/Code.js` (add `kinderUnitsToSeed_` + `seedKinderUnits_` near the UOI proposal block, after Code.js:1026)

- [ ] **Step 1: Add the functions**

Insert after the `dismissUoiProposal_` function (after Code.js:1026), before the `AI PROXY` banner:

```javascript
// ==========================================
// 2026-06-15: SEED EMPTY KINDER UNITS
// Adds 3YO + 4YO kinder shells (6 themes each) for Elsternwick and
// St Kilda so teachers can open them and submit CI/LOIs. Idempotent —
// skips any ca/yl/th that already exists. Run once from the editor.
// ==========================================
function kinderUnitsToSeed_() {
  var campuses = ['Elsternwick', 'St Kilda'];
  var years = ['3 Year Old Kinder', '4 Year Old Kinder'];
  var themes = ['Who We Are', 'Where We Are in Place and Time', 'How We Express Ourselves', 'How the World Works', 'How We Organise Ourselves', 'Sharing the Planet'];
  var out = [];
  campuses.forEach(function (ca) {
    years.forEach(function (yl) {
      themes.forEach(function (th) {
        out.push({ ca: ca, yl: yl, th: th, ci: '', lo: '', s: [] });
      });
    });
  });
  return out;
}

function seedKinderUnits_() {
  var file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  var data = JSON.parse(file.getBlob().getDataAsString());
  if (!Array.isArray(data)) { Logger.log('seedKinderUnits_: data.json is not an array — aborting'); return { error: 'data-not-array' }; }

  var existing = {};
  for (var i = 0; i < data.length; i++) {
    var e = data[i];
    if (e && e.ca && e.yl && e.th) existing[e.ca + '|' + e.yl + '|' + e.th] = true;
  }

  var added = 0;
  kinderUnitsToSeed_().forEach(function (u) {
    if (!existing[u.ca + '|' + u.yl + '|' + u.th]) { data.push(u); added++; }
  });

  if (added === 0) { Logger.log('seedKinderUnits_: nothing to add (all 24 already present)'); return { added: 0 }; }

  file.setContent(JSON.stringify(data, null, 2));
  try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e2) { Logger.log('seedKinderUnits_: pushToGitHub failed: ' + e2); }
  Logger.log('seedKinderUnits_: added ' + added + ' kinder unit(s); total now ' + data.length);
  return { added: added, total: data.length };
}
```

- [ ] **Step 2: Push the backend code**

Run: `cd gas_backend && clasp push`
Expected: push succeeds, lists `Code.js` (as `.gs`).

- [ ] **Step 3: Run the seeder once**

In the Apps Script editor (script.google.com → the gas_backend project), select function `seedKinderUnits_` and click **Run**. Authorise if prompted.
Expected (Executions log): `seedKinderUnits_: added 24 kinder unit(s); total now 158`.

- [ ] **Step 4: Verify the units landed in Drive + GitHub**

Run: `cd .. && git pull` (the seeder's `pushToGitHub` commits `data.json`), then:
Run: `python -c "import json;d=json.load(open('data.json',encoding='utf-8'));print(sum(1 for u in d if u['yl'] in ('3 Year Old Kinder','4 Year Old Kinder') and u['ca'] in ('Elsternwick','St Kilda')))"`
Expected: `24`.

- [ ] **Step 5: Commit (only if local data.json changed and isn't already committed by the backend)**

```bash
git add data.json
git commit -m "data: seed 3YO/4YO kinder shells for Elsternwick + St Kilda" || echo "already committed by backend push"
```

---

## Task 3: Auto-generate lesson ideas on approval (gas_backend)

**Files:**
- Modify: `gas_backend/Code.js` — `approveUoiProposal_` (Code.js:972–1011)

- [ ] **Step 1: Add the generation call**

Replace this block (Code.js:1002–1010):

```javascript
  file.setContent(JSON.stringify(data, null, 2));
  try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e2) { Logger.log('pushToGitHub after UOI approval failed: ' + e2); }

  p.status = 'approved';
  p.approvedAt = new Date().toISOString();
  proposals[idx] = p;
  saveUoiProposals_(proposals);

  return { id: id, applied: true, changes: changes, requiresRegen: true };
```

with:

```javascript
  file.setContent(JSON.stringify(data, null, 2));
  try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e2) { Logger.log('pushToGitHub after UOI approval failed: ' + e2); }

  // Auto-generate the 6 lesson ideas from the just-saved CI/LOIs so the unit
  // isn't left empty (kinder year levels get kinder-safe tools via the
  // inspiring year rule). Best-effort: if it fails, the CI/LOI edit still
  // stands and a curator can run Inspire All later.
  var ideasGenerated = false;
  try {
    if (typeof regenerateOneInspiring_ === 'function' && unit.ci && unit.lo) {
      var ideasResult = regenerateOneInspiring_({ ca: p.ca, yl: p.yl, th: p.th });
      ideasGenerated = !!(ideasResult && !ideasResult.error && !ideasResult.paused);
    }
  } catch (e3) { Logger.log('regenerateOneInspiring_ after UOI approval failed: ' + e3); }

  p.status = 'approved';
  p.approvedAt = new Date().toISOString();
  proposals[idx] = p;
  saveUoiProposals_(proposals);

  return { id: id, applied: true, changes: changes, requiresRegen: !ideasGenerated, ideasGenerated: ideasGenerated };
```

(Note: `regenerateOneInspiring_` requires both `ci` and `lo` via `inspiringHasUnitDetails_`; the `unit.ci && unit.lo` guard mirrors that so we don't call it pointlessly when a teacher filled only one field.)

- [ ] **Step 2: Push the backend code**

Run: `cd gas_backend && clasp push`
Expected: push succeeds.

- [ ] **Step 3: Verify manually after deploy (covered in Task 7)**

Deferred to the end-to-end check in Task 7 (needs the live deployment). For now confirm no syntax error: Apps Script editor shows no red error markers on save/push.

- [ ] **Step 4: Commit**

```bash
git add gas_backend/Code.js
git commit -m "feat: auto-generate lesson ideas when a UOI proposal is approved"
```

---

## Task 4: Email dlpteam@ (cc nathan@) on submission (gas_backend)

**Files:**
- Modify: `gas_backend/Code.js` — `submitUoiProposal_` (Code.js:930–961)

- [ ] **Step 1: Add the email send**

Replace this block (Code.js:958–960):

```javascript
  saveUoiProposals_(proposals);
  incrementUoiDailyCounter_();
  return { id: id, submittedAt: proposals[proposals.length - 1].submittedAt };
```

with:

```javascript
  saveUoiProposals_(proposals);
  incrementUoiDailyCounter_();

  // Notify the DLA team a submission is waiting for review. Best-effort —
  // an email/quota failure must never block the saved submission.
  try {
    var esc_ = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var loHtml = esc_(lo).replace(/\n/g, '<br>');
    MailApp.sendEmail({
      to: 'dlpteam@wesleycollege.edu.au',
      cc: 'nathan.benn@wesleycollege.edu.au',
      subject: 'New DLA lesson-idea submission: ' + ca + ' / ' + yl + ' / ' + th,
      htmlBody:
        '<p>A teacher submitted a Central Idea / Lines of Inquiry for review.</p>' +
        '<p><b>Campus:</b> ' + esc_(ca) + '<br>' +
        '<b>Year level:</b> ' + esc_(yl) + '<br>' +
        '<b>Theme:</b> ' + esc_(th) + '</p>' +
        '<p><b>Central Idea:</b><br>' + (ci ? esc_(ci) : '<i>(none given)</i>') + '</p>' +
        '<p><b>Lines of Inquiry:</b><br>' + (lo ? loHtml : '<i>(none given)</i>') + '</p>' +
        (note ? '<p><b>Teacher note:</b><br>' + esc_(note) + '</p>' : '') +
        '<p>Review and approve it in DLA Studio — approving will auto-generate the lesson ideas.</p>'
    });
  } catch (mailErr) { Logger.log('submitUoiProposal_ email failed (non-fatal): ' + mailErr); }

  return { id: id, submittedAt: proposals[proposals.length - 1].submittedAt };
```

- [ ] **Step 2: Push the backend code**

Run: `cd gas_backend && clasp push`
Expected: push succeeds.

- [ ] **Step 3: Commit**

```bash
git add gas_backend/Code.js
git commit -m "feat: email dlpteam (cc nathan) when a teacher submits a proposal"
```

---

## Task 5: Studio dashboard pending-submissions banner (frontend)

**Files:**
- Modify: `DLA_Studio.html` (add a banner container above `#stat-cards`)
- Modify: `js/06-bulk-router-chat.js` — `renderDashboard()` (js/06:626)

- [ ] **Step 1: Add the banner container**

In `DLA_Studio.html`, find the element with `id="stat-cards"`. Immediately BEFORE it, add:

```html
<div id="uoi-pending-banner"></div>
```

- [ ] **Step 2: Populate it in renderDashboard()**

In `js/06-bulk-router-chat.js`, immediately after the `document.getElementById('db-sub').textContent=...` line (js/06:640), insert:

```javascript
  // Pending teacher submissions notification (data from loadUoiProposals at startup).
  (function(){
    var banner = document.getElementById('uoi-pending-banner');
    if(!banner) return;
    var cache = window._uoiProposalsCache || [];
    var pending = cache.filter(function(p){ return !p.status || p.status === 'pending'; });
    if(!pending.length){ banner.innerHTML=''; return; }
    banner.innerHTML =
      '<div onclick="goToProposalReview()" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:14px;'+
      'background:#FBBF24;border-radius:10px;font-weight:800;color:#111">'+
      '<span style="font-size:16px">📥</span>'+
      '<span style="flex:1">'+pending.length+' teacher submission'+(pending.length!==1?'s':'')+' awaiting review</span>'+
      '<span style="font-size:12px;background:#111;color:#FBBF24;padding:5px 12px;border-radius:8px">Review →</span>'+
      '</div>';
  })();
```

- [ ] **Step 3: Add the navigation helper**

The proposals render in the browse panel, reached via `switchTab('browse', navItem)`
(`js/02-ui-load-navigation.js:449`, which calls `renderBrowse()`). Add this wrapper near
`renderDashboard` in `js/06-bulk-router-chat.js`:

```javascript
function goToProposalReview(){
  // Refresh the proposals list, then switch to the browse panel where the
  // pending-proposal cards render (switchTab('browse',…) calls renderBrowse()).
  try { if (typeof loadUoiProposals === 'function') loadUoiProposals(); } catch(e){}
  switchTab('browse', document.querySelector('.nav-item[data-tab="browse"]'));
}
```

- [ ] **Step 4: Verify in the browser**

Open `DLA_Studio.html` (signed in) with at least one pending proposal present. Expected: an amber "N teacher submission(s) awaiting review" banner shows on the dashboard above the stat cards; clicking it lands on the browse/review screen showing the proposal cards. With zero pending, the banner is absent.

- [ ] **Step 5: Commit**

```bash
git add DLA_Studio.html js/06-bulk-router-chat.js
git commit -m "feat: dashboard banner for pending teacher submissions"
```

---

## Task 6: Show "St Kilda Road" on the public site (frontend)

**Files:**
- Modify: `index.html` (3 display strings)

- [ ] **Step 1: Update CN map (index.html:1632)**

Change `CN={"GW":"Glen Waverley","EL":"Elsternwick","SKR":"St Kilda Rd"}` so `SKR` maps to `"St Kilda Road"`.

- [ ] **Step 2: Update the campus normaliser return (index.html:2470)**

Change the `return 'St Kilda Rd';` on that line to `return 'St Kilda Road';`.

- [ ] **Step 3: Update the campuses[] name (index.html:2623)**

In the `campuses=[...]` array, change the SKR entry's `name:'St Kilda Rd'` to `name:'St Kilda Road'`.

- [ ] **Step 4: Verify in the browser**

Open `index.html`. Expected: the campus shows as "St Kilda Road" everywhere (campus picker, headings); the new 3YO/4YO kinder year groups appear under it (and under Elsternwick); opening a kinder unit shows the "✏️ Edit unit details" affordance.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: display campus label as 'St Kilda Road'"
```

---

## Task 7: Version bump, deploy, end-to-end verification

**Files:**
- Modify: `js/00-config-state-utils.js` (`APP_VERSION`)
- Modify: `DLA_Studio.html` (`?v=` on the script tags)

- [ ] **Step 1: Bump the Studio version**

In `js/00-config-state-utils.js`, increment `APP_VERSION` (e.g. `5.43` → `5.44`). In `DLA_Studio.html`, bump the `?v=` query on ALL of the `js/*.js` script tags to the same number (per the versioning rule — all together or browsers serve stale code).

- [ ] **Step 2: Update the pinned backend deployment**

```bash
cd gas_backend
clasp deployments            # note the pinned deployment ID (the one SCRIPT_URL points at)
clasp deploy --deploymentId <ID> --description "kinder auto-generate + email + dashboard badge"
cd ..
```
Expected: deployment bumped to head (push alone does NOT change the live /exec URL).

- [ ] **Step 3: End-to-end check (covers Tasks 2–4)**

1. Public site → campus "St Kilda Road" → "4 Year Old Kinder" → a theme → "✏️ Edit unit details" → enter a Central Idea AND at least one Line of Inquiry → "Save and submit for approval".
   Expected: success message; an email arrives at dlpteam@ (cc nathan.benn@) with the details.
2. DLA Studio (signed in, hard-refresh) → dashboard shows the amber "1 teacher submission awaiting review" banner.
3. Click the banner → browse/review screen → ✓ Approve.
   Expected: the unit gains 6 lesson ideas that are kinder-appropriate (tools from the kinder-safe set) and whitelist-valid; the proposal leaves the pending list; the banner count drops.
4. Reload the public kinder unit.
   Expected: the 6 generated lesson ideas now show live.

- [ ] **Step 4: Commit**

```bash
git add js/00-config-state-utils.js DLA_Studio.html
git commit -m "chore: bump Studio version for kinder self-service feature"
git push
```

---

## Self-review notes (author)

- **Spec coverage:** kinder units → Task 1–2; auto-generate on approve → Task 3; email → Task 4;
  dashboard badge → Task 5; "St Kilda Road" label → Task 6; age-appropriateness → inherited from
  the existing inspiring kinder rule (no task needed); version/deploy → Task 7.
- **Reused, not rebuilt:** public form, proposal storage, approve/dismiss inbox (all pre-existing).
- **Placeholder scan:** none — browse navigation resolved to `switchTab('browse', …)` (js/02:449).
- **Type/name consistency:** `kinderUnitsToSeed_` shared by Task 1 (test mirror) and Task 2
  (backend); `regenerateOneInspiring_({ca,yl,th})`, `submitUoiProposal_`, `approveUoiProposal_`,
  `window._uoiProposalsCache`, `renderDashboard`, `switchTab` all verified against source.
