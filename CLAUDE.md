# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working policy — Superpowers skills are the FIRST choice

**Before touching code, debugging, or claiming work is complete, invoke the relevant Superpowers skill via the Skill tool.** This is non-negotiable on this repo.

- **Any bug, regression, unexpected behaviour, "it still does X" report** → `superpowers:systematic-debugging` BEFORE proposing fixes. No quick patches without Phase 1 (root cause) complete.
- **Any new feature, refactor, or behaviour change** → `superpowers:brainstorming` first if requirements aren't crystal-clear; `superpowers:test-driven-development` while implementing.
- **Before claiming "done", "fixed", "ready", "should work", or before a commit/push** → `superpowers:verification-before-completion`. Run actual checks, show evidence.
- **Multi-step work** → `TodoWrite` to track progress; mark complete only when each step is truly done.
- **Plan / spec work** → `superpowers:writing-plans` for anything beyond a one-liner.
- **Receiving review or correction from the user** → `superpowers:receiving-code-review` — verify the technical claim before agreeing or implementing.

If a Superpowers skill exists for the task in front of you, invoke it. Default to invocation; only skip when the skill demonstrably doesn't fit.

This applies to the public site (`index.html`), the Studio (`DLA_Studio.html` + `js/`), and both GAS backends (`gas_backend/`, `gas_analytics/`).

## Talking to Nathan — plain English, not developer-speak

Nathan is not a coder. When you explain what you changed or added, or when you ask a clarifying question:

- Describe it in terms of what a teacher/curator sees and does on the site, not function names, file paths, or code structure. Lead with the user-facing behaviour ("the Edit Unit Details button now opens a popup with three boxes"), not the implementation ("rewrote `startUoiEdit` to build a `tech-overlay`").
- Frame clarifying questions as concrete user-facing choices Nathan can picture, not as technical questions. "Should the popup close automatically after Save, or stay open with a 'submitted' message?" beats "Should `submitUoiEdit` call `closeUoiEdit()` synchronously?".
- Avoid jargon (modal, callback, endpoint, payload, regex, DOM, state, branch, merge, PR, refactor, etc.) unless Nathan used the word first. If a technical word is unavoidable, give a one-line plain gloss in parentheses.
- Code identifiers, file paths and line numbers can still appear when they genuinely help (e.g. so Nathan can find the right file in the workspace), but the *first* sentence of any change summary should be readable without them.

## What this repo is

Wesley College Digital Learning Assistant (DLA) v2. A static site hosted on GitHub Pages (`wesdlpteam/digital-learning-assistant-v2`, served from `main`) plus two Google Apps Script backends managed locally via `clasp`. There is no build step — files are edited and pushed, then GitHub Pages serves them directly.

Two web entrypoints:
- `index.html` — public teacher-facing app. Reads `data.json` / `libraries.json` from the deployed Pages site. Posts analytics to the gas_analytics endpoint (`FBHOOK` constant in the file).
- `DLA_Studio.html` — admin/curator UI ("DLA Studio v5.16"). Requires Google sign-in against the Wesley allowlist. Edits the source-of-truth JSON in Drive and triggers backend actions.

`DLA_Studio_legacy_backup.html` is a frozen pre-modularization backup — do not edit unless explicitly asked.

## Working commands

```powershell
# Push static site (data.json/libraries.json are usually auto-committed by the GAS backend)
git add <files>; git commit -m "..."; git push

# Apps Script deploys (each folder is its own clasp project — cd in first)
cd gas_backend;   clasp push
cd gas_analytics; clasp push
# IMPORTANT: `clasp push` only updates HEAD. The live /exec URLs (FBHOOK in
# index.html, SCRIPT_URL in 00-config-state-utils.js) are pinned to specific
# versioned deployments — push alone WILL NOT change what the URL serves.
# After every push, update the live deployment to the new head:
#   clasp deployments                                                  # find the pinned deployment ID
#   clasp deploy --deploymentId <ID> --description "<what changed>"    # bump that deployment to head
# clasp login state lives in ~/.clasprc.json (gitignored).
```

There are no tests, linter, or package.json. "Run" = open in a browser or visit the Pages URL.

## Architecture

### Data flow
```
Drive (data.json, libraries.json)  ←edit─  DLA_Studio.html
        │
        └─ gas_backend pushes commits ──►  GitHub repo (main)
                                              │
                                              └─ GitHub Pages ──► index.html (public)
```
- `data.json` (~11 MB) is the planner/unit corpus. `libraries.json` holds tool inventory + lesson libraries plus a `_meta._inventory` block (approved/banned/ageRanges).
- The recent git log is almost entirely `Auto-update data.json` / `Auto-update libraries.json` commits made by the GAS backend's `pushToGitHub()` / `pushLibrariesToGitHub()`. Treat these files as machine-generated even though they live in source control — the Drive copy is the editing surface.

### Frontend (`DLA_Studio.html` + `js/`)
Plain classic `<script>` tags loaded **in this exact order** (see bottom of `DLA_Studio.html`):

```
00-config-state-utils.js   ← globals: DATA, SCRIPT_URL, OPENAI_MODEL, CAMPUS_COL, text-corruption cleaners
01-inventory-helpers.js
02-ui-load-navigation.js   ← screens, tabs, status bar, Drive reconnect
03-dashboard-browse-entry.js
04-audit-analytics-live.js
05-bulk-setup-libraries.js ← libraries.json load/save, optional GitHub pull
06-bulk-router-chat.js
07-bulk-actions.js
09-legacy-restored.js      ← loaded BEFORE 08 on purpose
08-export-sync-hotfixes.js ← hotfixes that intentionally override 09
```
Load order matters — `08` ships after `09` so its definitions win. Don't "fix" the numbering. There are no ES modules; everything is global.

`index.html` is a single self-contained file (inline CSS + JS); it does not load the `js/` folder.

The top of `00-config-state-utils.js` is where global constants live: `SCRIPT_URL` (gas_backend `/exec`), `CLIENT_ID` (Google OAuth — change here if Wesley rotates the client), `ANALYTICS_SHEET_ID`, plus two model names — `OPENAI_MODEL = 'gpt-4.1'` for heavy paths (Bulk AI Edit, Fix All, regenerate, scoring) and `OPENAI_FAST_MODEL = 'gpt-4.1-mini'` for per-suggestion feedback and single-suggestion regen. Grep for both when tracing model usage.

### Authentication & backend calls
- Frontend obtains a Google OAuth access token via GIS (`accounts.google.com/gsi/client`), stored in `DRIVE_TOKEN`. The same token is sent to GAS as `googleAccessToken` so the backend can verify the user's email against `DLA_ALLOWED_EMAILS` in `gas_backend/Code.js`. To add a user, edit that array and `clasp push`.
- Optional `DLA_SHARED_SECRET` fallback: stored in `localStorage` under `dla_shared_secret` on the client and as a Script Property on the server. Used only when Google auth is unavailable.
- Frontend backend calls split into two patterns. **(1) Readable CORS calls:** the AI/data paths — `callAI` (`js/02-ui-load-navigation.js`), the inspiring regen actions (e.g. `inspireAllBatch`), `gradesuggestion`, and the audit status actions — POST to `SCRIPT_URL` with a normal CORS `fetch` (`Content-Type: text/plain;charset=utf-8`, body wrapped by `withGASToken`) and **do read the JSON response** (`JSON.parse(await r.text())` / `await r.json()`). New actions that need a return value should follow this pattern. **(2) Fire-and-forget kicks:** some long-running write actions don't wait on the body — the Studio assumes success and polls Drive afterwards. (Historical note: an older `mode:'no-cors'` pattern that genuinely couldn't read responses has been superseded for the AI/data paths above.)

### gas_backend (`gas_backend/`)
Single `doPost(e)` router dispatched by `body.action` (lowercased). Current actions: `runSurgeon`, `addToQueue`, `callAI`, `getPlannerContext`, `syncToolInventory`, `enrichPlanners`, `rebootMakerspace`, `resetMakerspaceFlags`, `extractUnitDetails`. Every action goes through `requireAllowedUser_` first.

`doGet(e)` exposes one **public** action — `?action=suggestTech&ca=...&yl=...&th=...&tool=...&cb=<jsonpCallback>&regen=0|1` — used by `index.html`'s "Have a tool in mind?" picker. JSONP only (no Google auth, since teachers aren't signed in). Validates `tool` against the synced `DLA_TOOL_APPROVED` list, caches results per `(ca|yl|th|tool)` in Script Properties as `tech_sugg_v1_<sha1>`, and refuses calls past `TECH_SUGGEST_DAILY_CAP` (counter resets daily). Uses `gpt-4.1-mini` and returns `{description, valueAdd, steps[], fit, fitNote, generatedAt, cached}`.

Required Script Properties: `OPENAI_API_KEY`, `GITHUB_TOKEN`. Optional: `DLA_SHARED_SECRET`, plus tool-inventory keys written by `syncToolInventory_`.

Hardcoded Drive/Sheet IDs at the top of the file: `DATA_JSON_FILE_ID`, `LIBRARIES_JSON_FILE_ID`, `PLANNERS_FOLDER_ID`, `TECH_RULES_SHEET_ID`. The OpenAI key is **only** in Script Properties — `getKey()` on the frontend is a deliberate no-op. All AI calls go through `callAIProxy_` so the key never reaches the browser.

`APPROVED_TOOLS` / `REALISTIC_TOOL_USE_RULES` constants are the hardcoded fallback prompt. The live prompt is built by `getApprovedToolsPrompt_()` from synced Script Properties — edit via the Studio's Tool Inventory UI, not by changing these constants.

### gas_analytics (`gas_analytics/`)
Separate Apps Script project. `doPost` routes by `body.type`: `used`, `reaction`, `analytics_batch`, `feedback`. Writes to the `Analytics` / `Used` / `Feedback` / `Reactions` / `Leaderboard` sheets in spreadsheet `1R4P4FJlc8SyRFlVWoM0HpHmfCNMNVOpI8cuEILFxBNY`. `GET ?action=leaderboard` returns JSONP. The deployed web app URL is hardcoded as `FBHOOK` in `index.html` — if you redeploy and the `/exec` URL changes, update that constant.

`gas_analytics/app.html` is an unused/legacy view — `doGet` only returns JSON (or JSONP for `?action=leaderboard`) and never serves this HTML. Don't waste time editing `app.html` thinking it's the rendered web app.

## Conventions & gotchas

- **Text corruption cleaners** (`cleanTextCorruption_`, `cleanSuggestionText_`, `cleanSuggestionObject_` in `00-config-state-utils.js`) repair AI-output artefacts (`?` → `'` in contractions, `?` → `—` between words, the recurring "Watr Humans and Elephants" typo). Run AI/backend strings through these before display or save.
- **`.gs` vs `.js`**: GAS files are stored locally as `.js` for editor support; `scriptExtensions` in both `.clasp.json` files tells clasp to push them as `.gs`.
- **Drive file IDs in `gas_backend/Code.js`** are environment-specific. Do not regenerate them unless migrating.
- **Planner source files** live at `g:\My Drive\Digital Learning Assistant\DLA Planners\2026` (an extra working directory). GAS reads them via `PLANNERS_FOLDER_ID`; the local path is only useful for manual inspection.
- **GitHub pull from Studio** (`pullLibrariesFromGitHub` in `js/05-…`) overwrites the Drive copy with whatever is on `main`. Only use after a deliberate direct edit to `libraries.json` in GitHub — usually the flow is the other way (Drive → GitHub).
