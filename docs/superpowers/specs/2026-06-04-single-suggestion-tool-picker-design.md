# Single-suggestion regen: tool picker + exception fix

- **Date:** 2026-06-04
- **Status:** Approved (Approach A) — pending spec review
- **Area:** DLA Studio → Browse → per-class → per-suggestion ↻ regen
- **Files in scope:** `js/06-bulk-router-chat.js`, `gas_backend/Code.js`, `js/00-config-state-utils.js` (version bump), `DLA_Studio.html` (version bump)

## Problem

Two issues, fixed together because they live on the same path.

1. **Bug — single-suggestion regen is broken for everyone.** Clicking the ↻ on any one tech
   suggestion in Browse shows **"Regen failed: exception"** at the top of the Studio. This is not
   Year-4-specific; it fails on every class and year level. Year 4 is just where it was noticed.

2. **Feature — let the curator pick the replacement tool.** Today ↻ silently asks the AI to choose.
   Nathan wants a choice point first: *"Is there a specific tool you'd like to replace it with?"*
   If no → AI chooses (today's intended behaviour). If yes → show the approved tools for that class's
   year level and let them pick one; the AI then writes the activity around that chosen tool.

## Root cause of the bug (confirmed)

The backend slot-regen function `regenerateOneInspiringSlot_` (`gas_backend/Code.js`) calls
`cleanTextCorruption_(...)` on its output at **`Code.js:5343`** and **`Code.js:5365`**. That tidy-up
function is defined **only in the front-end** (`js/00-config-state-utils.js:62`) and **does not exist
anywhere in `gas_backend/`** (verified: zero definitions of `cleanTextCorruption_`/`clean*_` in
`Code.js`). On the *success* path the server therefore throws
`ReferenceError: cleanTextCorruption_ is not defined`, which the function's `catch` (`Code.js:5391`)
wraps as `{ error:'exception', message: String(err) }`.

Compounding it, the front-end (`regenSingleSug`, `js/06-bulk-router-chat.js:1780`) reports
`result.reason || result.error` — but the exception branch puts the detail in `message`, not
`reason` — so the curator sees the bare word "exception" with the real cause hidden.

This was introduced in the 2026-05-28 rewrite that moved slot regen server-side; the whole-unit path
`regenerateOneInspiring_` never calls the cleaner, which is why bulk regen still works.

## What the curator experiences

1. Click **↻** on a suggestion (unchanged trigger).
2. A small chooser box appears: *"Replace **&lt;current tool&gt;** in this suggestion?"* with two
   buttons — **Let AI choose** and **Choose a tool myself**.
3. **Let AI choose** → today's intended behaviour (server picks a fresh tool + writes the activity).
4. **Choose a tool myself** → a panel of approved tools appropriate to this class's year level.
   Tools already used elsewhere in the *same* unit are greyed out and unclickable. Pick one.
5. Either way, the result lands in the existing **"Review Proposed Changes"** preview. Nothing is
   saved to the planner until the curator approves it there.

## Design decisions (locked with Nathan)

| Decision | Choice |
|---|---|
| When a tool is picked, what happens to the activity text? | **AI rewrites the activity** around the chosen tool + the unit's learning intentions. |
| Which tools appear in the picker? | **Year-appropriate only** — the approved whitelist filtered to the class's year level. |
| Picking a tool already used elsewhere in the same unit? | **Blocked** — greyed out in the picker, and rejected server-side as a backstop. |

## Architecture (Approach A — one shared path)

Both buttons drive the **same** backend action `regenerateOneInspiringSlot`. The only difference is
that the "Choose a tool myself" path adds a `forcedTool` field. The backend already does unit lookup,
6-slot validation, prompt building, intra-unit duplicate checking, and returns a draft for review —
we extend it rather than fork it.

### Front-end — `js/06-bulk-router-chat.js`

- **`regenSingleSug(entryIdx, sugIdx)`** becomes a thin entry that opens the chooser box (instead of
  immediately calling the server). The ↻ button markup (`:1675`) is unchanged.
- **`regenSlotWithAI(entryIdx, sugIdx)`** — the *current* body of `regenSingleSug` (fetch the
  `regenerateOneInspiringSlot` action, route the draft through `showChangesPopup`). No `forcedTool`.
- **`openSlotToolPicker(entryIdx, sugIdx)`** — builds an overlay panel mirroring the existing
  `showChangesPopup` pattern (`js/09-legacy-restored.js:314`: fixed overlay, `--card`/`--border` vars,
  hand-rolled grid). Tool list comes from **`getAgeAppropriateTools(entry.yl)`**
  (`js/05-bulk-setup-libraries.js:349`), which already returns approved, year-appropriate,
  banned-filtered tool **name strings**. Tools whose name matches any tool currently in the unit's
  6 slots (computed via `sugTool(...)` over `getSugs(entry)`) are rendered disabled/greyed. A short
  search box filters the grid (there are ~20–45 tools). Clicking an enabled tool calls
  `regenSlotWithTool`.
- **`regenSlotWithTool(entryIdx, sugIdx, toolName)`** — same fetch as `regenSlotWithAI` plus
  `forcedTool: toolName`; routes the draft through `showChangesPopup`.
- **Error surfacing:** change the thrown message to
  `result.message || result.reason || result.error` so a real server error is shown, not "exception".

### Back-end — `gas_backend/Code.js`

- **Fix the bug:** add a server-side `cleanTextCorruption_` (port the body verbatim from
  `js/00-config-state-utils.js:62`). This resolves both call sites (`:5343`, `:5365`) and matches the
  documented convention that AI output is run through the cleaner before save/display.
- **Forced-tool support in `regenerateOneInspiringSlot_(body)`:** when `body.forcedTool` is present:
  1. **Validate** it is in the approved set, not banned, and age-appropriate for `target.yl`
     (backstop to the picker). On failure return a clear, specific error
     (e.g. `{ error:'forced-tool-invalid', reason:'<tool> is not approved for <year>' }`).
  2. **Duplicate guard:** if `forcedTool` collides (via `diversityToolComponents_`/`diversityToolKey_`)
     with another slot in the unit, return `{ error:'forced-tool-duplicate', reason:'<tool> is already
     used in this unit' }`. (Belt-and-braces; the picker already greys these out.)
  3. **Prompt:** instruct the model to use **exactly** `forcedTool` and write the activity (`t`/`d`)
     for it. The tool-membership rejection loop and the auto-substitute fallback are **skipped** for
     this path — the curator's pick is authoritative. (Exact prompt mechanics — reuse
     `inspiringCallOnce_` with a forced-tool instruction vs. a dedicated prompt — to be pinned down in
     the implementation plan after reading `inspiringCallOnce_`.)
  4. Output still runs through `cleanTextCorruption_` and returns the existing success shape
     `{ ok:true, idx, sugIdx, t, d, autoSwapped:false, ca, yl, th }`.
- The AI path (no `forcedTool`) is unchanged apart from the cleaner fix.

### Versioning & deploy (per repo rule)

- Bump `APP_VERSION` in `js/00-config-state-utils.js` (5.23 → 5.24) **and** all 10 `?v=` query strings
  in `DLA_Studio.html` (`:655–664`) together.
- Front-end: `git add` the changed files, commit, push (GitHub Pages serves it).
- Back-end: `cd gas_backend; clasp push`, then bump the pinned deployment to head
  (`clasp deploy --deploymentId <ID> --description "..."`) — push alone does not change the live
  `/exec` URL.

## Error handling

- Backend returns structured `{ error, reason }` objects (no thrown surprises); the catch-all
  `exception` branch will additionally have `message` surfaced by the front-end now.
- Picker path failures (invalid/duplicate forced tool) come back as named errors and show in the
  status bar via the improved message; the chooser/picker can be reopened.
- If `getAgeAppropriateTools(entry.yl)` returns an empty list (mis-synced inventory), the picker shows
  a plain "No approved tools available for this year level" message and the AI path still works.

## Out of scope (YAGNI)

- No change to whole-unit/bulk regen, the public site, or the feedback chat.
- No new tool-inventory editing — the picker only *reads* the existing approved list.
- Not removing the dead `_legacyRegenSingleSug_unused` body in this change (leave as-is).
- No automatic re-save: the review popup remains the only save gate.

## Verification (manual — repo has no test harness)

1. After the cleaner fix + deploy: Browse → a Year 4 class → ↻ → **Let AI choose** → a draft appears
   in the review popup (no "exception"). Approve and confirm it saves.
2. ↻ → **Choose a tool myself** → picker shows year-appropriate approved tools; tools already in the
   unit are greyed; pick one → draft uses that exact tool and a fresh activity → approve → saves.
3. Confirm a greyed (already-used) tool cannot be picked, and that the server also rejects it if
   forced (e.g. via a crafted request) with a clear message.
4. Spot-check on a non-Year-4 class to confirm the fix is global.
```
