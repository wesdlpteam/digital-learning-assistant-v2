# Suggestion Quality Audit + Consistent-Style Editing — Design Spec

**Date:** 2026-06-07
**Author:** Nathan Benn (commissioned) / Claude (design)
**Status:** Approved design — pending spec review, then implementation plan

> **Scope note (added 2026-06-07):** This spec now covers TWO related workstreams that
> share one AI grader: **(1)** a one-off-then-repeatable server-side audit that fixes the
> stored corpus, and **(2)** making the new writing style apply consistently whenever a
> curator edits in the Studio (Bulk AI Edit + per-suggestion Feedback), including a live
> quality check. Root cause for WS2 is documented in "Workstream 2" below.

---

## Plain-English summary (for Nathan)

A new **"Audit Suggestions"** button in the DLA Studio. You click it once; it runs
entirely on Google's servers, so you can close the Studio and turn your laptop off.

The server reads every stored tech suggestion teachers see (currently 804 across 134
units), has the AI grade each one against our existing quality rules — *teacher-friendly,
creative, achievable, realistic use of the tool* — and then **rewrites only the weak ones**,
leaving the good suggestions in each unit exactly as they are. When it finishes (or pauses
overnight if it hits Google's daily limit), the Studio shows a report: how many were weak,
why, and which units changed.

### The four decisions you made
1. **Depth:** Full AI quality grade of all suggestions (not just a keyword scan).
2. **Fix behaviour:** Auto-fix everything flagged (no manual approve-each step).
3. **Exceptions:** None — human-verified suggestions are graded and fixed too (the report
   still notes which were verified so you can see them).
4. **Granularity:** Surgical — rewrite only the weak suggestions, keep the good ones; and it
   must run on the server with the laptop off.

---

## Problem

The current generation prompt already forbids lazy phrasing and enforces realistic tool use
(`SUGGESTION_STYLE` / `INSPIRING_DESCRIPTION_RULES` / `REALISTIC_TOOL_USE_RULES`). But many
**stored** suggestions predate those rules. A deterministic scan of the local `data.json`
snapshot found 27 of 804 suggestions (3.4%) with explicitly banned phrasing — 24 "For a
twist" + 3 "present their findings". That keyword scan **cannot** catch the deeper problems
Nathan asked about: dull/generic ideas, a tool used as a vague metaphor, or activities a
teacher can't realistically run. Those need AI judgement.

Live data is the Drive copy of `data.json` (~11 MB), regenerated through the GAS backend and
pushed to GitHub Pages. Hand-editing the local snapshot would be overwritten — the fix must
happen server-side through the existing pipeline.

## What already exists (reuse, don't rebuild)

All line numbers are `gas_backend/Code.js`.

| Capability | Existing code | Reuse for |
|---|---|---|
| Self-running server timer (laptop-off, resumable) | `kickoffServerSideRegen` (4539), `serverSideRegenTick` (4625), `removeServerSideRegenTrigger_` (4641) | Pattern for the new audit runner trigger |
| Per-slot rewrite with sibling-dedup, membership/age checks, auto-substitution | `regenerateOneInspiringSlot_` (5388) | Core of the surgical fix — generates one fresh `{t,d}` keeping the other 5 |
| Quality criteria (the rubric, as a prompt) | `INSPIRING_DESCRIPTION_RULES` (3911), `REALISTIC_TOOL_USE_RULES` (115) | Grading criteria AND fix prompt |
| Approved/banned tools + age ranges (live, from Script Properties) | `getApprovedToolsPrompt_` (191), `getApprovedToolNames_` (782), `getBannedToolNames_` (4069) | Both grader context and fix validation |
| Lesson libraries (Minecraft/Micro:bit) | `inspiringLessonsLibraryText_` (3938) | Fix prompt context |
| AI proxy | `callAIProxy_` (990) | The grader call |
| Save + publish | `pushToGitHub` (1647), Drive `file.setContent` | Persist fixed suggestions |
| Text cleanup | `cleanSuggestionObject_` (frontend) / server equivalents | Clean AI output before save |
| Per-unit progress markers in data.json | `inspiringRegenAt` pattern (5128-5130) | Model for the new `suggestionAuditAt` marker |
| Existing twist sweep | `sweepTwistLabels()` action (router 397) | Verify scope; fold in or supersede |

**Key constraint learned:** the existing self-running engine (`regenerateAllInspiring`)
only rewrites a **whole unit's 6 slots atomically** — it cannot rewrite individual slots.
Per-slot rewrite (`regenerateOneInspiringSlot_`) exists but is client-driven and
human-approved, never wired to the timer. **Surgical + laptop-off therefore requires a new
server-side runner** that drives the per-slot logic headlessly. That is the bulk of this
build.

## Design

### Components

1. **Grader** — `auditGradeSuggestion_(unit, slotIdx, approvedToolsPrompt)` (new)
   - Deterministic pre-check first: if the slot's `d` matches any banned phrase (the
     19-item list from `SUGGESTION_STYLE` lines 56-74) → **fail** with reason
     `BANNED_PHRASE` (guarantees the 27 known offenders are always caught regardless of AI).
   - Then an AI call via `callAIProxy_` using `OPENAI_FAST_MODEL` (gpt-4.1-mini) for cost.
     Input: unit `ci`/`lo`/`th`/`yl`, the tool `t`, the description `d`, plus the criteria
     (`INSPIRING_DESCRIPTION_RULES` + `REALISTIC_TOOL_USE_RULES`). Output JSON:
     `{ pass: bool, reasons: [ "dull_generic" | "tool_as_metaphor" | "not_achievable" |
     "jargon_unreadable" | "banned_phrase" ], note: "<short>" }`.
   - Returns the structured verdict; does not mutate anything.

2. **Surgical fix** — reuse `regenerateOneInspiringSlot_`'s generation core, refactored so it
   can be called headlessly and **persist** (the existing one returns to client without
   saving). New thin wrapper `auditFixSlot_(data, unitIdx, slotIdx)` that:
   - builds the "other 5 slots" tool footprint (existing logic, 5424-5435),
   - generates a fresh `{t,d}` (gpt-4.1, the heavy model) honouring membership/age/dup +
     `inspiringApplySubstitutions_` fallback,
   - runs server text-cleanup,
   - writes `data[unitIdx].s[slotIdx] = {t,d}` and records the change.

3. **Runner + timer** — mirror the proven regen trigger pattern:
   - `kickoffSuggestionAudit({ca, yl, redoAll})` (new) — concurrency guard (refuse if an
     audit OR the inspiring-regen trigger is already installed; they both write `data.json`),
     reset progress, write initial report state, install a time-based trigger
     (`everyMinutes(N)` — propose **N = 5** for snappier feel; the 6-min GAS limit governs
     per-tick batch size, not the interval), fire one tick immediately.
   - `suggestionAuditTick()` (new) — the trigger handler. Loads `data.json`, processes a
     bounded batch of units (batch size ≈ 6-8 units/tick to stay under the 6-min limit),
     and for each unit: grade all 6 slots, surgically fix any that fail, stamp
     `unit.suggestionAuditAt` + `unit.suggestionAuditVersion`. Save Drive + `pushToGitHub`
     **only if the batch changed something**; always update the small report file. When no
     un-audited units remain → finalise report, remove trigger.
   - `removeSuggestionAuditTrigger_()` + `suggestionAuditAbort()` (new) — stop/cleanup.

4. **Progress + report store** — a small separate Drive JSON file
   `suggestion_audit_report.json` (NOT inside the 11 MB `data.json`, so grading-only ticks
   don't rewrite the big file). Holds: `status` (running|paused|done), `startedAt`,
   `finishedAt`, `total`, `graded`, `rewritten`, per-reason counts, and a capped list of
   changed `{ca,yl,th,slot,reason,oldTool,newTool}`. Resumability still keyed off the
   per-unit `suggestionAuditAt` marker in `data.json` (same model as `inspiringRegenAt`), so
   the report file is informational, not the source of truth for resume.

5. **doPost actions** (router ~229, `if (action === ...)` style):
   - `kickoffsuggestionaudit` → `kickoffSuggestionAudit(opts)`
   - `suggestionauditstatus` → reads the report file, returns it
   - `suggestionauditabort` → `suggestionAuditAbort()`
   - `suggestionauditreset` → clear all `suggestionAuditAt` markers (re-audit from scratch)
   - All behind `requireAllowedUser_`.

6. **Studio UI** (`js/07-bulk-actions.js` Bulk area + status panel; bump `APP_VERSION` in
   `js/00` and the `?v=` on all script tags in `DLA_Studio.html`):
   - "Audit Suggestions" button → POST `kickoffsuggestionaudit` (no-cors fire-and-forget) →
     show "running on the server, you can close this" message.
   - Status panel polls (reads `suggestion_audit_report.json` from Drive, consistent with the
     no-cors "poll Drive" convention) → shows `graded/total`, `rewritten`, and on completion
     the per-reason breakdown + changed-units list.

### Data flow

```
Studio "Audit Suggestions"  ──POST kickoffsuggestionaudit──►  gas_backend
                                                                  │ installs 5-min trigger
                                                                  ▼
                                            suggestionAuditTick() every 5 min (laptop OFF)
                                                  │ load data.json (Drive)
                                                  │ for each un-audited unit (batch):
                                                  │   grade 6 slots (gpt-4.1-mini + banned-phrase precheck)
                                                  │   surgically rewrite failed slots (gpt-4.1)
                                                  │   stamp suggestionAuditAt
                                                  │ save data.json + pushToGitHub (if changed)
                                                  │ update suggestion_audit_report.json
                                                  ▼ when none remain → finalise + remove trigger
Studio status panel  ◄──poll Drive suggestion_audit_report.json──  report
```

### Error handling & edge cases
- **GAS daily runtime cap:** if a tick throws/quota-pauses, it's swallowed (like
  `serverSideRegenTick`); the trigger keeps firing and resumes from the marker — spreads over
  multiple days if needed. Report shows `status:"paused"` with a plain note.
- **Concurrency:** refuse kickoff if the inspiring-regen trigger is installed, or if an audit
  is already running (both write `data.json`).
- **Grader false-positive risk:** banned-phrase pre-check is deterministic (no AI leniency).
  AI grader uses a conservative prompt (only fail on clear violations) to avoid needlessly
  churning acceptable suggestions; borderline = pass.
- **human-verified:** graded and fixed per Nathan's call. When a verified slot is rewritten,
  clear that slot's verified flag (mirror `clearHumanVerifiedFlags_` intent at slot level)
  and record it in the report so Nathan can see which curated ones changed.
- **Fix failure:** if `auditFixSlot_` can't produce a valid replacement after retries +
  substitution, leave the original slot, mark it in the report as `flagged_unfixed`, and
  still stamp the unit audited (so it isn't retried forever) — Nathan handles those by hand.
- **No-cors:** client never reads POST bodies; all status via the Drive report file.

### Testing (no test harness in repo — manual verification plan)
1. Unit-test the grader prompt offline: feed the 24 "For a twist" descriptions + a sample of
   known-good ones; confirm precheck flags all 24 and the AI passes the good ones.
2. Dry-run mode flag (`opts.gradeOnly`) on a single campus/year: grades + writes report but
   does NOT rewrite — lets Nathan eyeball the verdicts before a full run.
3. Run on one year-group live; confirm: only flagged slots changed, siblings untouched,
   `suggestionAuditAt` stamped, report accurate, trigger self-removes.
4. Confirm laptop-off: kick off, close browser, verify progress advances on next open.

---

# Workstream 2 — Consistent new style across Studio edit paths

## Root cause (verified 2026-06-07)

The writing rules exist in **two drifted copies**:

- **Server:** `INSPIRING_DESCRIPTION_RULES` (`gas_backend/Code.js:3911-3931`) — the *new*
  style: strict 6-sentence per-sentence template, **explicit ban on announcing "the twist"**
  ("The twist:" / "Here's the twist" / "the real twist"), a SINGLE-TOOL REALITY CHECK hard
  rule, and the corpus runs every output through `stripTwistLabel_()`. Used by the server
  actions: `regenerateallinspiring`, `regenerateoneinspiring`, `regenerateoneinspiringslot`,
  sweep. So **Inspire All / Generate 6 / per-slot ↻ already produce the new style.**
- **Studio client:** `SUGGESTION_STYLE` (`js/05-bulk-setup-libraries.js:46-145`) — the *older*
  style. No "twist" ban, no `stripTwistLabel_`, different structure. Injected into the
  client-side paths: **Bulk AI Edit chat** (`js/07-bulk-actions.js:68,415,549,1429,1579`) and
  **per-suggestion Feedback chat** (`js/06-bulk-router-chat.js:2287`). Legacy fallbacks in
  `js/09` carry yet more copies (`1183,1333,1394,3218`).

**Consequence:** editing a lesson via Feedback, or running a Bulk AI Edit, can still *generate*
"For a twist…" phrasing — it is not only legacy stored data. This is what Nathan is seeing.

## Decision (spec review)
**Same rules everywhere + a live quality check** on the two interactive client paths.

## Design

1. **Unify the rules (single source, drift-guarded).**
   - Update the client `SUGGESTION_STYLE` so its description-style + banned-phrases content
     matches the server's `INSPIRING_DESCRIPTION_RULES`: add the explicit "do not announce the
     twist" ban, the SINGLE-TOOL REALITY CHECK hard rule, "present their findings" to the
     banned list, and the per-sentence-job framing. Keep the client-only additions that the
     server expresses elsewhere (Podcasting/Animate/Green-Screen/Minecraft rules) — these are
     NOT a drift, they're client conveniences; leave them.
   - Add a load-bearing comment at BOTH definitions: `// KEEP IN SYNC with the other copy
     (gas_backend INSPIRING_DESCRIPTION_RULES <-> js/05 SUGGESTION_STYLE). Grader + all edit
     paths assume one shared style.` This is the cheap drift guard (no runtime fetch).

2. **Strip "twist" labels on the client output paths.** Port the server's `stripTwistLabel_`
   logic into a client helper (`js/00-config-state-utils.js`, beside the other text cleaners)
   and apply it to suggestion text produced by Bulk AI Edit and the Feedback chat before the
   draft is shown / saved — exactly where the server applies it to its own output.

3. **One shared grader, reused live.** The audit's grader (`auditGradeSuggestion_`, WS1) is
   exposed as a server action `gradesuggestion` (doPost) returning
   `{pass, reasons[], note}`. The two interactive client paths call it after generating a
   draft and **before** showing it: if `pass === false`, automatically re-generate once
   (same path, with the grader's `reasons` appended to the prompt as a fix hint); if it still
   fails, show the draft anyway with a small "couldn't fully meet the style bar — review"
   note rather than blocking the curator. This keeps the grader rubric identical to the audit
   (no third definition of "good").
   - **Transport:** reuse the exact request/response mechanism the existing `callAI()` client
     helper already uses to read AI results (the Feedback/Bulk paths already read responses,
     so a readable channel exists — the implementation reads `callAI`'s definition and mirrors
     it for the grade call). Grading uses `OPENAI_FAST_MODEL` (gpt-4.1-mini).

4. **Live-check UX:** one extra short "checking style…" beat after generate, before the draft
   appears. The auto-redo is capped at one retry to bound latency/cost (per Nathan: accepts a
   few seconds + extra cost for the strongest guarantee).

## WS2 testing (manual)
- Feed the 24 known "For a twist" descriptions through the client `stripTwistLabel_` port →
  confirm labels removed, sentence still reads naturally.
- In the Studio: run a Feedback edit that would historically yield "For a twist"; confirm the
  output is in the new style and any twist label is stripped.
- Confirm the grade gate: force a weak draft (e.g. instruct "write 2 vague sentences"),
  confirm it auto-redoes once and surfaces the note if still weak.
- Confirm the client and server rule text now agree on: twist ban, single-tool reality check,
  banned-phrase list.

---

## Out of scope (YAGNI)
- No per-suggestion manual approve UI for the audit (Nathan chose auto-fix).
- No re-grading of `index.html`'s public "Have a tool in mind?" live picker (separate path).
- No runtime fetch of rules from server to client — the sync-comment guard is sufficient
  (avoids a load-time dependency).
- No live grade gate on the *server* regen buttons (Inspire All / Generate 6 / ↻) — those
  already use the new rules; the periodic audit is their safety net.

## Resolved decisions (spec review, 2026-06-07)
- **Trigger interval: 5 minutes** (`everyMinutes(5)`). Snappier; per-tick batch size still
  governs the 6-min GAS limit. Accept slightly higher chance of an overnight quota pause on a
  full run.
- **First run is a dry run.** The first kickoff defaults to `gradeOnly: true` — grades every
  suggestion and writes the report, but rewrites nothing. The Studio surfaces "this was a dry
  run — review verdicts, then run again to auto-fix." Subsequent runs auto-fix. Implement as a
  one-time flag persisted in the report/Script Properties so the dry-run gate only applies to
  the very first audit, not every future run.
