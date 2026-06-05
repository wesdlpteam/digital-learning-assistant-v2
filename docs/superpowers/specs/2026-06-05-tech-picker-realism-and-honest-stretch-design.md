# "Have a tool in mind?" picker — realistic suggestions, honest stretch, durable storage

- **Date:** 2026-06-05
- **Status:** Approved by Nathan ("Do it")
- **Area:** Public site `index.html` "Have a tech tool in mind?" picker + its backend (`gas_backend/Code.js` `suggestTechForPlanner_`)
- **Files in scope:** `gas_backend/Code.js`, `index.html`

## Problem

When a teacher uses the "Have a tech tool in mind?" picker and the AI rates the tool a
**stretch** fit, the picker still force-fits it with an elaborate, over-engineered activity
(observed: Lego Spike Prime "code motors and sensors to simulate economic transactions" for a
Year 5 economics unit). Two faults:

1. **Stretch is force-fitted.** The backend gives three verdicts — `good`, `stretch`, `poor`.
   Both `good` and `stretch` render the full activity card; only `poor` gets an honest note.
   A stretch should not be dressed up as a real suggestion.
2. **Suggestions are too complex/unrealistic.** The prompt instructs the model to be a
   "visionary" coach — "reject the obvious", "push into territory most classrooms have not
   explored", show off "an advanced or under-used feature". This manufactures fantasy activities
   no normal teacher could run at that year level.

Additionally Nathan asked that a generated idea be **stored** so reopening the same tool for the
same unit does not regenerate.

## Decisions (locked with Nathan)

| Decision | Choice |
|---|---|
| What happens on a `stretch` fit? | Treat it like `poor`: honest 2-3 sentence note ("not a strong fit, try X"), **no** activity, no Value Add, no "How do I teach this?", not pinned as a real suggestion. Only a genuine `good` fit gets an activity. |
| How ambitious should `good`-fit activities be? | **Realistic + age-appropriate.** Drop the visionary/under-used-feature pressure. Something a normal teacher could run with this year level using the tool's everyday strengths. |
| Persistence on reopen | Keep + harden the existing per-`(ca\|yl\|th\|tool)` ScriptProperties cache so a plain reopen never regenerates. |

## Changes

### Backend — `gas_backend/Code.js` (`suggestTechForPlanner_`, ~lines 668-694)

- **System prompt:** replace "visionary digital learning coach … descriptions inspire … creative
  ambition" with a grounded, practical coach who gives realistic, age-appropriate ideas. Keep
  STRICT JSON only.
- **Fit tiers (raised bar):**
  - `good` = the tool's everyday core function genuinely serves this unit's central idea / lines of
    inquiry **and** the activity is realistic for this exact year level.
  - `stretch` = could be bent to fit but it is not a natural match, or making it fit would be too
    complex/ambitious for this year level. → honest note, **no** activity.
  - `poor` = the tool's core function has little to do with the unit. → honest note, **no** activity.
  - Only `good` produces `description` (activity), `valueAdd`, `steps`. `stretch` and `poor` both
    produce a 2-3 sentence honest `description` + `fitNote`, with empty `valueAdd`/`steps`.
- **Mission/description rules for a `good` fit:** drop "never thought of using it like that",
  "reject the obvious/generic", "advanced or under-used feature", "unexpected angle". Replace with a
  plain ~4-5 sentence activity: what students do with the tool, how it connects to a named line of
  inquiry / central idea, what they make, and the everyday tool feature that powers it — all
  realistic for the year level. Keep the existing SINGLE-TOOL REALITY CHECK rule.
- **JSON shape is unchanged** (`description`, `valueAdd`, `steps`, `fit`, `fitNote`) — no
  data-contract change for the page.

### Backend — cache reset + storage hardening

- **Bump cache prefix** `tech_sugg_v3_` → `tech_sugg_v4_` so old over-engineered answers are
  abandoned and every tool+unit regenerates **once** under the new prompt, then is stored.
- **One-time prune** (`pruneOldTechCaches_`, guarded by a `tech_cache_pruned_v4` flag property):
  on the first call after deploy, delete every `tech_sugg_v1_/v2_/v3_` property. This reclaims
  ScriptProperties space. Rationale: ScriptProperties has a finite size; if it fills, the cache
  write at the end of `suggestTechForPlanner_` silently fails and **every** click regenerates —
  the exact "it keeps regenerating" symptom. Pruning orphaned old-prefix entries prevents that.

### Frontend — `index.html` (~line 977)

- Route a `stretch` verdict through the existing **honest-fit card** (today `if(fit==='poor')`),
  i.e. `if(fit==='poor'||fit==='stretch')`. That card already shows the plain explanation +
  "Choose another tool" / "Try again" / "Done" and skips Value Add / "How do I teach this?" / the
  pinned chip.
- Keep the amber "Works with a stretch" badge for a stretch (red stays for poor): use
  `'tech-fit '+fit` for the badge class, and only force the red note border when `fit==='poor'`.
- No data-contract change; the plain-click cache path (`regen=0`) is untouched, so reopen still
  serves the stored answer.

## Out of scope (YAGNI)

- No change to the Studio's own regen, bulk paths, or the unit-suggestion cards.
- No migration of the cache off ScriptProperties to Drive/Sheets (pruning addresses the fill risk;
  revisit only if regeneration persists after deploy).
- No new fit verdicts or badge colours beyond the existing good/stretch/poor.

## Verification (manual — no test harness)

1. After deploy: public site → a unit → "Have a tech tool in mind?" → pick a clearly ill-fitting
   tool (e.g. Lego Spike Prime on an economics unit) → honest "not a strong fit" card, no activity,
   no "How do I teach this?", not pinned.
2. Pick a genuinely good-fit tool → a plain, age-appropriate activity (no fantasy engineering).
3. Close and reopen the same good-fit tool → identical stored answer, no spinner-then-different text
   (served from cache).
4. Confirm the amber stretch badge vs red poor badge render correctly.
