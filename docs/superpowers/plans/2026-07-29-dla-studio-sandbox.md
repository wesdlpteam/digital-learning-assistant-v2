# DLA Studio Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Publish an unplugged demo of DLA Studio at `https://wesdlpteam.github.io/dla-sandbox/studio.html` — no sign-in, no Drive, no AI, no spend — with the content and analytics changes Nathan asked for on 2026-07-29.

**Spec:** `docs/superpowers/specs/2026-07-29-dla-studio-sandbox-design.md`

**Architecture:** Copy `DLA_Studio.html`, `css/studio.css` and all nine `js/*.js` into the sandbox repo unchanged except for anchored constant edits, inject the proven `sandbox-guard.js` **before** them and a new `studio-shim.js` **after** them, and feed the page from two prepared local JSON files. All content changes happen in the shim and in the prepared data — no surgery on the Studio's own markup or logic.

## Global Constraints

- No npm dependencies. Node built-ins only. Tests via `node --test "tests/*.test.mjs"` (directory form does not descend on Windows).
- `DLA_Studio.html`, `css/`, `js/`, `gas_backend/`, `gas_analytics/`, `data.json`, `libraries.json` must be **byte-for-byte unchanged** when done.
- Fail loudly: every anchored replacement must match exactly once or throw by name.
- Zero requests to `script.google.com`, `googleapis.com`, `accounts.google.com` at runtime.
- Demo corpus is **127 units** (all Kinder dropped), all marked human-verified → counts read **127 / 127**.
- Analytics screens must carry the visible line **`Sample data — demonstration only`** in addition to the corner badge.
- Badge copy, verbatim: `Sandbox demo — not live data`.
- Disabled-control note, verbatim: `Turned off in this demo`.

---

## Findings that this plan depends on (all verified 2026-07-29)

**Studio page structure** (`DLA_Studio.html`, 703 lines):
- L9 `<script src="https://accounts.google.com/gsi/client">` — Google sign-in. **Remove.**
- L10 `<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js">` — charts. **Keep** (a `<script>` tag, not a `fetch`, so the guard does not block it; the analytics screens need it).
- L11 `<link rel="stylesheet" href="css/studio.css">` — **copy the file across.**
- L693–701 the nine `js/*.js?v=5.55` tags, in this load order: 00, 01, 02, 04, 05, 06, 07, **09, 08** (08 last on purpose — it overrides 09).

**Globals** (see `[[reference_dla_studio_globals_are_lexical]]`): `DATA` is `let` in `js/00`, so it is a lexical global, **not** `window.DATA`. `SCRIPT_URL`, `CLIENT_ID`, `ANALYTICS_SHEET_ID`, `OPENAI_MODEL`, `OPENAI_FAST_MODEL` are `const` in `js/00` at lines 36, 48, 49, 50, 51.

**The data seam:** `ingest(arr, skipCache)` in `js/02-ui-load-navigation.js:203` sets `DATA` and rebuilds every filter dropdown. Calling `ingest(preparedUnits, true)` is the whole job — no need to touch the Drive loader beyond disabling it.

**The analytics seam:** `loadLiveAnalytics()` in `js/09-legacy-restored.js:1199` is the single entry point. It calls:
- `getAnalyticsSheetTz()`
- `readMultipleRanges(['Dashboard!A1:F60','Analytics!A1:F5000','Feedback!A1:G100','Used!A1:G2000'])`
- `readSheetRange('Intent!A1:G2000')` and `readSheetRange('Interactions!A1:G5000')` (both tolerated as missing)

then caches to `window._dashRowsCache`, `_growthRowsCache`, `_usedRowsCache`, `_intentRowsCache`, `_interactionRowsCache`, `_feedbackCache` and calls the `renderLive*` family. **Overriding `readMultipleRanges`, `readSheetRange` and `getAnalyticsSheetTz` makes every chart, KPI and scorecard render from local sample data with no other change.** This is the key discovery — do not try to patch individual renderers.

`renderLiveScorecard(rows)` (js/09:1303) locates its block with `findSection(rows, 'WEEKLY SCORECARD')`, so the Dashboard sheet is section-headed rows of cells.

**Sections to remove** are `.card` elements identified by a contained button id — no markup surgery, just `el.closest('.card').remove()`:
- Twist cleanup → `#btn-twist-sweep` (DLA_Studio.html L400)
- Audit Suggestions → `#btn-suggestion-audit` (L410)

**Browse-tab controls** (Inspire all, Sweep app smashes, Makerspace reboot) are **not** in `DLA_Studio.html`; they are created at runtime (`inspireAllBatch`, `rebootMakerspaceBatch` live in `js/06-bulk-router-chat.js:953` and `:918`). Remove them **by visible button text under a MutationObserver**, which also covers anything injected later.

**Write controls present in the markup** (disable all): `#btn-drive` `loadFromDrive`, `#btn-seed-kinder` `seedKinderYearGroups`, `#btn-add-queue` `addToGASQueue`, `#btn-bulk-reset`, `#btn-bulk-voice`, `#btn-bulk-chat-send`, `#btn-full-realism-audit`, `#btn-surgeon` `runSurgeon`, `#btn-refresh-live` `loadLiveAnalytics`, `#btn-ai-summary` `generateAISummary`, `#btn-regen-all` `regenAll`, `#btn-entry-realism-scan`, `#btn-score-quality`, plus `createManualSnapshot`, `savePlaybookFromChat`, `pullLibrariesFromGitHub`, `refreshLibrariesFromDrive`, `showAddLibraryDialog`, `libExportAll`, `libImportAllTrigger`, `downloadJSON`, `clearSession`, `showBackendScreen`, `forceLatestVersion`.

---

## Task 1: Studio data preparation

**Files:** create `tools/lib/studio-data.mjs`, `tests/studio-data.test.mjs`

**Produces:** `prepareStudioUnits(units) => object[]`

- [ ] **Step 1: Write the failing test** — assert that the output drops all Kinder, sets `humanVerified: true` and `audited: true` on every remaining unit, preserves array order, and keeps the full field set (the Studio needs more fields than the public site, so this does **not** use `slimUnits`).
- [ ] **Step 2:** Run `node --test tests/studio-data.test.mjs`, confirm module-not-found.
- [ ] **Step 3: Implement** — `dropExcludedYearLevels` from `slim-data.mjs`, then map each unit to `{...u, humanVerified: true, audited: true}`.
- [ ] **Step 4:** Run the test, confirm pass.
- [ ] **Step 5:** Sanity-run against real `data.json`; expect **127** units out of 158, `0` without ideas.
- [ ] **Step 6:** Commit.

## Task 2: Sample analytics dataset

**Files:** create `tools/lib/studio-analytics.mjs`, `tests/studio-analytics.test.mjs`

**Produces:** `buildSampleAnalytics() => { 'Dashboard!A1:F60': rows, 'Analytics!A1:F5000': rows, 'Feedback!A1:G100': rows, 'Used!A1:G2000': rows, 'Intent!A1:G2000': rows, 'Interactions!A1:G5000': rows }`

**Before writing this task's code you MUST read** `js/09-legacy-restored.js` `renderLiveScorecard`, `renderLiveOverview`, `renderLiveGrowth`, `renderLiveCampusChart`, `renderLiveUsedByTeam`, `renderLiveTopPages`, and `findSection`, plus `renderLiveAdoptionExtras` / `renderToolRankings` in `js/04`, to learn the exact cell layout each expects. Do not guess the row shapes.

Target picture (Nathan's brief: positive, all staff, all campuses):
- Campus Reach **3 of 3**
- Weekly Sessions comfortably above the `10+ teachers` bar
- Avg Time on Page above the `20+ seconds` bar
- Year Level Coverage **7 of 7**
- Growth trend rising across the bucket range
- Used/Intent rows spread across all three campuses and Prep–Year 6

- [ ] **Step 1:** Read the renderers listed above and write down each expected row shape as a comment block in the module.
- [ ] **Step 2: Write the failing test** — assert every required range key exists, the Dashboard rows contain a `WEEKLY SCORECARD` section header, campus reach reads 3 of 3, year coverage 7 of 7, and every `Used` row's campus is one of the three real campus names.
- [ ] **Step 3:** Run the test, confirm failure.
- [ ] **Step 4: Implement.**
- [ ] **Step 5:** Run the test, confirm pass.
- [ ] **Step 6:** Commit.

## Task 3: Studio shim

**Files:** create `tools/browser/studio-shim.js`

No unit test — it is glue over page globals that only exist in the browser. Verified end-to-end in Task 5.

- [ ] **Step 1: Write the shim** with these parts, in this order:
  1. **Fake session** — set `DRIVE_TOKEN` and `DRIVE_FILE_ID` to sentinel strings by bare name so every `if(!DRIVE_TOKEN) return` gate passes; stub `gapiReady`/GIS entry points to no-ops.
  2. **Data** — `fetch('studio-data.json')` then `ingest(rows, true)`.
  3. **Analytics** — override `readMultipleRanges`, `readSheetRange`, `getAnalyticsSheetTz` to resolve from `studio-analytics.json`; then call `loadLiveAnalytics()`.
  4. **Cleanup pass**, run on load and from a `MutationObserver` on `document.body`:
     - remove `#btn-twist-sweep` and `#btn-suggestion-audit` via `.closest('.card').remove()`
     - remove any control whose text matches `/inspire all/i`, `/sweep app smash/i`, `/makerspace/i`, together with its `.card` when that card has no other control
     - disable every remaining write control listed in the Findings section, adding the note `Turned off in this demo`
  5. **Layout** — CSS making the Tool Inventory whitelist list span the full content width.
  6. **Labels** — the corner badge, plus an inline `Sample data — demonstration only` banner inserted at the top of the analytics and dashboard panels.
- [ ] **Step 2:** `node --check tools/browser/studio-shim.js`.
- [ ] **Step 3:** Commit.

## Task 4: Extend the build script

**Files:** modify `tools/build-sandbox.mjs`, `tools/lib/transform-html.mjs`, `tools/lib/verify.mjs`

- [ ] **Step 1:** Add `STUDIO_ANCHORS` to `transform-html.mjs` — remove the GSI script tag (L9), and in `js/00` replace `SCRIPT_URL`, `CLIENT_ID` and `ANALYTICS_SHEET_ID` values with `sandbox://blocked`. Each must match exactly once.
- [ ] **Step 2:** Write tests for the new anchors in `tests/transform-html.test.mjs`; run; confirm pass.
- [ ] **Step 3:** Extend `build-sandbox.mjs` to also emit `studio.html`, `css/studio.css`, `js/*.js` (with the `js/00` edit), `studio-data.json`, `studio-analytics.json`, and to inject guard-before / shim-after into `studio.html`.
- [ ] **Step 4:** Run `assertNoGoogleScriptRefs` over **every** emitted file, not just `index.html`. Extend the guard to also reject `accounts.google.com` and `googleapis.com`.
- [ ] **Step 5:** Run the full suite and a real build; confirm `Sandbox build OK`.
- [ ] **Step 6:** Confirm `git status --short` shows no change to the protected files.
- [ ] **Step 7:** Commit.

## Task 5: Verify in a real browser, then publish

- [ ] **Step 1:** Serve the built sandbox over local HTTP (not `file://` — the guard compares against `location.origin`).
- [ ] **Step 2:** Open `studio.html`. Confirm: no sign-in prompt; the dashboard renders; unit counts read 127 / 127; no Kinder anywhere; dashboard shows zero units without a planner.
- [ ] **Step 3:** Visit every tab. Confirm the named Browse and Bulk sections are gone, the whitelist fills the width, and every write control is present but disabled with the note.
- [ ] **Step 4:** Confirm the analytics screens show the strong sample week across all three campuses **and** the `Sample data — demonstration only` line.
- [ ] **Step 5:** With the network panel open, click through every tab and every disabled control. Confirm **zero** requests to `script.google.com`, `googleapis.com`, `accounts.google.com`. Record the result.
- [ ] **Step 6:** Check at 768 and 1024 widths (the Studio is a desktop tool; phones are not a target for it, unlike the public site).
- [ ] **Step 7:** Push the sandbox repo, wait for Pages, re-verify on the live URL.
- [ ] **Step 8:** Commit and merge to `main`.

## Self-Review Notes

**Spec coverage:** Kinder removal + 127/127 → Task 1. Dashboard zero-no-planner → Task 1 (data) confirmed in Task 5. Browse and Bulk section removal, whitelist width, disabled buttons → Task 3. Positive analytics → Task 2. Honesty labels → Task 3 Step 1.6. Sign-in bypass → Task 3 Step 1.1 + Task 4 Step 1. Safety → guard reused, Task 4 Step 4.

**Known risk:** Task 2 depends on row shapes that have not yet been read. If the renderers turn out to expect something awkward, the fallback is to render the analytics panels from the shim directly rather than through the sheet seam — slower and less faithful, so try the seam first.

**Deliberate deviation:** the spec said "inline the js files so the page is self-contained". Copying them as separate files is simpler, keeps the diff reviewable, and costs one extra request each on a site that is already sub-2 MB. Inlining buys nothing here.
