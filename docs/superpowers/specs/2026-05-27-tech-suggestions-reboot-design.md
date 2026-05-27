# Tech Suggestions Reboot — drop App Smash, restore Minecraft/Micro:bit lessons

**Status:** Design approved 2026-05-27.
**Author:** Nathan Benn + Claude (brainstormed in-session).
**Predecessors in memory:** [[project-dla-app-smash-regression]], [[project-dla-app-smash-opener-bias]], [[project-dla-app-smash-intra-unit-dup]], [[resumable-bulk-ops-required]], [[bulk-inspiring-refactor-followup]].

## Goal

Reboot the DLA tech suggestion corpus on a single rule: **every suggestion uses one approved tool**. No "Tool A + Tool B" App Smash entries anywhere in `data.json` after this lands. At the same time, restore the Minecraft Education and Micro:bit lesson libraries inside the 6-sentence inspiring prompt so the curated `libraries.json` lessons surface again — while still allowing the AI to design a custom Minecraft/Micro:bit activity when no library lesson naturally fits the unit's central idea.

The user's observation: single-tool 6-sentence suggestions work great; App Smash suggestions are where the output stops making sense. The Minecraft and Micro:bit lesson library entries (still present in `libraries.json`) stopped surfacing when `inspiringBuildPrompt_` was introduced because that prompt never injected them. Both problems are addressed in one pass.

## Why now

- The 6-sentence Inspire All flow (`regenerateAllInspiring`) is the source of truth for new suggestions going forward — the bulk-to-inspire refactor (Phase 1 plan dated 2026-05-26) routes every whole-unit regen surface through it.
- The App Smash rule has accumulated significant maintenance cost: opener bias (fixed 2026-05-25), intra-unit component duplication (fixed 2026-05-26), the 239-suggestion wipe regression on 2026-05-20, plus an entire scheduled-trigger recovery loop. Dropping the rule removes the root cause class.
- Minecraft and Micro:bit are core to upper-primary STEM at Wesley; their absence from new 6-sentence output is a real loss.
- Inspire All's existing infrastructure (resumable batches, per-unit markers, snapshot-then-process, opts.indices targeting) is exactly the engine we need for a one-time cleanup sweep.

## Scope

### In scope

| Surface | File | Change |
|---|---|---|
| Active 6-sentence prompt | `gas_backend/Code.js` — `inspiringBuildPrompt_` | Strip App Smash; inject Minecraft + Micro:bit libraries with two-mode (library lesson OR custom activity) wording. |
| Legacy 6-sentence prompt | `gas_backend/Code.js` — `auditPlanners` prompt | Strip App Smash; relax existing strict Minecraft/Micro:bit rule from "MUST select exactly one" to the same two-mode wording. |
| Backend validator | `gas_backend/Code.js` — `diversityValidateSugs_` | Delete the `>=2 App Smashes in slots 1-5` gate. Keep dedup + opener-uniqueness + slot count. |
| Backend retry notes | `gas_backend/Code.js` (lines 4629, 4785) | Drop `App Smash floor` from retry-prompt classifier. |
| Frontend prompts | `js/00-config-state-utils.js` (`appSmashRequirementForEntry_`, App-Smash rules constant, `appSmashCountInRegen_`) | Delete all App Smash helpers + the inline App Smash rules constant. |
| Frontend prompts | `js/05-bulk-setup-libraries.js` — `regenerateOneSuggestion` retry loop | Drop the call to `appSmashRequirementForEntry_`, the `lastFailReason === 'smash'` retry classifier, the `< 2` final throw. |
| Frontend prompts | `js/08-export-sync-hotfixes.js` — bulk regen helpers (×2) | Same drop pattern as above. |
| Frontend normalisation | `js/06-bulk-router-chat.js` — `normaliseToolName` `+` recursion | Remove the recursion-on-`+` branch (dead path after cleanup). |
| Frontend parsing | `js/08-export-sync-hotfixes.js` — `appSmashParen` / `appSmashPlus` regex | Remove the dead matchers. Keep the generic `+` split in `auditToolParts_` so audit math stays defensive during the transition. |
| App Smash recovery system | `gas_backend/Code.js` — `flagUnitsMissingAppSmashes`, `kickoffFullAppSmashRecovery`, `appSmashRecoveryTick`, `cleanupAppSmashRecoveryTrigger_` | Delete entirely after pre-flight trigger cleanup. |
| Surgeon partner-preservation branch | `gas_backend/Code.js` — `auditPlanners` lines ~1436-1545 | Strip the App Smash partner-preservation prompt block and the post-Surgeon re-queue check. |
| Cleanup pass infrastructure | `gas_backend/Code.js` — new `inspiringFindUnitsWithAppSmashes_` + `regenerateAllInspiringSweepAppSmashes` wrapper | Reuses existing `regenerateAllInspiring(opts.indices)` plumbing. |
| Cleanup pass UI | `js/06-bulk-router-chat.js` — Inspire All card | One new "Sweep App Smashes" button; identical progress affordance to a normal Inspire All run. |

### Out of scope

- `js/06-bulk-router-chat.js` — per-slot `regenSingleSug` (Phase 2 of the bulk-to-inspire refactor handles this).
- `js/07-bulk-actions.js` — chatbot-routed bulk edits, AI Edit. Different intent surface; Phase 3.
- `runSurgeon` mechanics outside the App Smash branch. Tool-replacement function still useful for banned-tool sweeps.
- `data.json` schema. No new fields. The lesson is encoded in the `t` string (`Minecraft: <Title>`) per existing convention; the URL lives in sentence 1 of `d`.
- Public-site (`index.html`) display logic. There is no visual App-Smash treatment to remove (grep confirms no `App Smash` strings in `index.html`); the `+` split paths there are also benign after cleanup.

## The new 6-sentence prompt

### Removed wording

From `inspiringBuildPrompt_` ([Code.js:3919-3922](../../gas_backend/Code.js)):

> - Suggestions 1-5: Digital technology integrations. **At LEAST 2 must be an App Smash ("Tool A + Tool B")**.
>
> NO DUPLICATE TOOLS within this unit (HARD RULE): … **App Smash components count — if slot 1 is "Padlet + iMovie", neither Padlet nor iMovie may appear in slots 2-6.**
>
> **APP SMASH FORMAT:** "Tool 1 + Tool 2" with a literal + sign…

### Replacement wording

> - Suggestions 1-5: Single-tool digital integrations — one approved tool per slot. Each follows the 6-sentence inspiring style below.
> - Slot 1 sets the unit's tone — pick the tool that opens THIS unit's central idea in the most surprising, specific way.
>
> NO DUPLICATE TOOLS within this unit (HARD RULE): each of the 6 suggestions uses a DIFFERENT tool. No `+` pairings — every suggestion stands on one tool.

### New lesson-library block (injected after the YEAR LEVEL GUIDANCE section)

```
APPROVED MINECRAFT EDUCATION LESSONS LIBRARY:
{{libraries.minecraft entries, format: - [Ages X] <Title>: <desc> (URL: <url>)}}

You may suggest Minecraft Education in TWO ways:
1. PREFERRED — pick a library lesson when one connects naturally to
   THIS unit's central idea. Set "t": "Minecraft: <exact title>" and
   include the exact URL in sentence 1 of "d". Use any Teaching notes
   shown to ground later sentences in concrete lesson stages.
2. CUSTOM — if no library lesson fits the central idea but Minecraft
   is still the right tool, design a custom Minecraft activity for
   THIS unit. Set "t": "Minecraft Education" (no colon, no title) and
   build the 6 sentences around the UOI directly.

APPROVED MICRO:BIT LESSONS LIBRARY:
{{libraries.microbit entries, same format}}

Same two-mode rule as Minecraft: "Micro:bit: <Title>" + URL when a
library lesson fits; plain "Micro:bit" with a custom unit-specific
activity when none does.
```

The `auditPlanners` prompt gets the same lesson-library block, replacing the existing stricter "you MUST select exactly one" rule at [Code.js:1033-1037](../../gas_backend/Code.js).

## Validator changes

### `diversityValidateSugs_` ([Code.js:3357-3386](../../gas_backend/Code.js))

Delete lines 3371-3373:

```js
// >=2 App Smashes in slots 1-5
const smashCount = sugs.slice(0, 5).filter(sg => /\+/.test(sg.t)).length;
if (smashCount < 2) return { ok: false, reason: 'only ' + smashCount + ' App Smash(es) in slots 1-5 (need >=2)' };
```

Everything else stays — the slot count check, the cross-slot tool dedup via `diversityToolComponents_` (which is now effectively a single-component split for new data, but defensive for legacy data still in flight), the opener-uniqueness check against sibling units.

### Retry-prompt classifier ([Code.js:4629, 4785](../../gas_backend/Code.js))

Drop `App Smash floor` from the constraint list in the retry note:

```js
// before
retryNote = '\n\nRETRY ' + (attempt - 1) + ': Previous attempt failed validation (' + lastReason + '). Apply ALL constraints (tool whitelist, App Smash floor, no dup tools, opener differs from siblings, ~6 sentences per slot 1-5).' + toolReminder;

// after
retryNote = '\n\nRETRY ' + (attempt - 1) + ': Previous attempt failed validation (' + lastReason + '). Apply ALL constraints (tool whitelist, no dup tools, opener differs from siblings, ~6 sentences per slot 1-5).' + toolReminder;
```

### Frontend `appSmashCountInRegen_(sugs) < 2` throws

In `js/05-bulk-setup-libraries.js:733` and the two parallel sites in `js/08-export-sync-hotfixes.js`: delete the throw, delete the `lastFailReason === 'smash'` retry branches, delete the `lastSmashCount` tracking.

## Cleanup pass

### `inspiringFindUnitsWithAppSmashes_(data)`

```js
function inspiringFindUnitsWithAppSmashes_(data) {
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    if (!u || !Array.isArray(u.s)) continue;
    // Slots 0-4 only (slot 5 is the STEM Makerspace slot; never an App Smash today).
    for (let s = 0; s < 5 && s < u.s.length; s++) {
      const sg = u.s[s];
      if (sg && typeof sg.t === 'string' && sg.t.indexOf('+') !== -1) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}
```

### `regenerateAllInspiringSweepAppSmashes(opts)`

Thin wrapper. Builds indices via the finder, then delegates to `regenerateAllInspiring({ ...opts, indices, label: 'App-Smash sweep' })`. The existing batch loop (12 units, ~3 min/batch), per-unit timestamp marker (`inspiringRegenAt`), snapshot-then-process discipline, and abort hook all flow through unchanged.

### Studio UI

A second button on the existing Inspire All card in `js/06-bulk-router-chat.js`:

```
[ ✨ Inspire all units ]   [ 🔥 Sweep App Smashes (N units) ]
```

The count is computed client-side by mirroring the backend finder on the in-memory `DATA`. The button calls a new `runSweepAppSmashes()` function that confirms, then polls the same status endpoint. Progress card UI is shared with Inspire All.

## Sequencing (must be followed)

1. **Pre-flight (manual, GAS editor):** Run `cleanupAppSmashRecoveryTrigger_('Pre-deletion safety')` to remove any live 10-minute trigger. Verify with `ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction())` — `appSmashRecoveryTick` must not appear.
2. **Backend code changes** — prompt rewrites, validator strip, helper additions, recovery-system deletion. Single commit.
3. **Frontend code changes** — same commit if practical, or a follow-on commit if the backend needs to deploy first to avoid mismatched expectations.
4. **Deploy backend:** `clasp push` in `gas_backend/`, then bump the pinned deployment with `clasp deploy --deploymentId <ID> --description 'Tech suggestion reboot: drop App Smash, restore lesson libraries'`.
5. **Push static site** to GitHub Pages.
6. **Cleanup pass:** In Studio → Inspire All card → "Sweep App Smashes". Confirm count, run, wait for completion. Resumable per existing infrastructure if the laptop sleeps.
7. **Verify:**
   - Audit view shows zero units with `+` in any slot.
   - Spot-check 5-10 freshly regenerated units in Studio.
   - Spot-check on public site to confirm Minecraft/Micro:bit lesson links surface in upper-primary units where they fit.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sweep stalls partway → mixed App Smash / single-tool corpus | Resumable per `inspiringRegenAt` markers + batch-internal save+push. Re-running the sweep picks up where it left off. |
| Live trigger fires after handler deletion | Pre-flight step 1 removes the trigger before any deletion. |
| AI defaults to a small set of "safe" openers across siblings now that App Smash variety is gone | Existing `diversitySiblingToolFootprint_` + opener-differs-from-sibling validator carries this load; no behaviour change. |
| Custom-mode Minecraft / Micro:bit suggestions go off the rails without a library anchor | Tool-membership validator still enforces approved + age-appropriate; the relaxed wording explicitly anchors custom activities to the unit's central idea. |
| Future maintainer rediscovers App Smash pattern in legacy code | Full amputation removes the references; the design doc captures the rationale. |
| Cleanup pass burns through OpenAI quota | Batch size + cooldown handling already in place. Expected cost is bounded by `regenerateAllInspiring`'s known per-unit cost × number of affected units. |

## Open questions

None remaining at design time. The two design-level decisions — full amputation (Option B) and "allow but don't push" lesson posture — are locked in.

## Files touched (summary)

- `gas_backend/Code.js` — prompts, validators, retry notes, surgeon branch removal, recovery-system deletion, new sweep finder + wrapper.
- `js/00-config-state-utils.js` — delete App Smash helpers + constant.
- `js/05-bulk-setup-libraries.js` — strip App Smash branches in `regenerateOneSuggestion`.
- `js/06-bulk-router-chat.js` — strip `normaliseToolName` `+` recursion; add Sweep button + handler.
- `js/08-export-sync-hotfixes.js` — strip App Smash branches in bulk regen helpers; remove dead regex parsers.

No new files. No schema changes to `data.json` / `libraries.json`. No new external dependencies.
