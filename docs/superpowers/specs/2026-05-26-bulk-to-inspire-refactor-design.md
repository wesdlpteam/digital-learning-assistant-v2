# Bulk → Inspire refactor (Phase 1)

**Status:** Design approved 2026-05-26.
**Author:** Nathan Benn + Claude (brainstormed in-session).
**Predecessors in memory:** [[bulk-inspiring-refactor-followup]], [[project-dla-app-smash-intra-unit-dup]], [[resumable-bulk-ops-required]].

## Goal

Every whole-unit regen surface in the DLA Studio — both the per-entry "Generate 6 new suggestions" button and the five Bulk paths — produces the same ~6-sentence inspiring-style output the backend `regenerateAllInspiring` already produces for the Inspire All sweep. That means: stronger validators (whitelist, banned, age-mismatch, intra-unit dup, opener-clash, ~6-sentence-per-slot), the auto-substitute fallback for stuck tool names, the marker discipline (`inspiringRegenAt`, `inspiringRegenAutoSwapped`, `clearHumanVerifiedFlags_`), and the snapshot-then-process resumability.

Per-slot regen and the long-tail AI-write paths are explicitly **out of scope** here; they are tracked as Phase 2 and Phase 3 follow-ups.

## Why now

- 2026-05-25 commit `db748e1` shipped opener-bias prevention. 2026-05-26 commit `243c330` shipped intra-unit component-dup prevention and `770a61a` added the in-Studio scan-and-fix button for the 13 affected units. Before running that auto-fix, the user wants the regen surface it calls to produce the inspiring quality output, not the older 4-validator frontend prompt.
- Inspire All sweep is confirmed complete (bad-tool + duplicate counts at zero, `inspiringRegenAt` markers recovered), which is the gate the memory said this refactor was blocked on.
- The five Bulk paths today duplicate ~150 lines of prompt + 3-attempt retry across `js/05-bulk-setup-libraries.js`, `js/06-bulk-router-chat.js`, `js/08-export-sync-hotfixes.js`, `js/09-legacy-restored.js`, plus the `scanAndFixComponentDupes` function added 2026-05-26. Each copy has slightly different fail-handling and validator wiring, which is exactly the divergence problem that the inspiring backend already solved once.

## Scope

### In scope

| Surface | File | Behaviour after refactor |
|---|---|---|
| Per-entry "Generate 6 new suggestions" | `js/06-bulk-router-chat.js` `regenAll` | POST `regenerateOneInspiring` (preview mode); poll Drive for `_pendingRegen` marker; render preview pane from marker; Apply POSTs `applyPendingRegen`; Discard clears local preview UI only. |
| Fix All Of Type | `js/05-bulk-setup-libraries.js` `fixAllOfType` | Build targets, call shared `bulkRegenViaInspiring(targets, label)`, render. |
| Bulk Regen panel | `js/08-export-sync-hotfixes.js` `runBulkRegen` | Same shared helper. |
| Tool-reuse auto-fix | `js/08-export-sync-hotfixes.js` `scanAndFixComponentDupes` | Same shared helper. |
| Legacy incomplete fixer | `js/09-legacy-restored.js` (the `regenerateAllInspiring`-shaped retry loop) | Same shared helper. |

### Out of scope

- **Per-slot regen** (`regenSingleSug` in `js/06-bulk-router-chat.js`). The ↻ button next to a single suggestion will be addressed by a Phase 2 spec that introduces a single-slot inspiring action (`regenerateOneSlotInspiring(idx, slotIdx)`).
- **Surgeon** (`runSurgeon` in `js/08-export-sync-hotfixes.js`). Different shape — replaces one banned tool across many entries — already backend-side. Untouched.
- **Bulk AI Edit / chatbot regen patterns** in `js/07-bulk-actions.js`. Routed through a different chatbot intent system; Phase 3.
- **Audit replacement drafts** (`draftAllRealismFixes`, individual draft buttons in `js/09-legacy-restored.js`). Different intent (one-slot replacement under a tighter constraint); Phase 3.
- **Makerspace reboot prompt** in `js/08-export-sync-hotfixes.js`. Single-purpose action with its own templated prompt; Phase 3.
- **Single-suggestion feedback edits** that already use `OPENAI_FAST_MODEL` for speed. Quality there is acceptable; speed matters more for inline tweaks. `SUGGESTION_STYLE` stays in `js/00-config-state-utils.js` as a frontend fallback per the memory note.

## Architecture

### Backend additions (`gas_backend/Code.js`)

Three changes, all dispatched through the existing `doPost` router and `requireAllowedUser_` gate.

#### 1. Extend `inspiringCandidateIndexes_(data, opts)`

Short-circuit to `opts.indices` when present:

```js
function inspiringCandidateIndexes_(data, opts) {
  opts = opts || {};
  if (Array.isArray(opts.indices) && opts.indices.length) {
    return opts.indices.filter(i =>
      Number.isInteger(i) && i >= 0 && i < data.length &&
      data[i] && inspiringHasUnitDetails_(data[i])
    );
  }
  // existing behaviour …
}
```

When the caller passes explicit indices, those ARE the candidates (no `inspiringInScope_` or `inspiringRegenAt` filtering — the caller is being explicit). Units missing `ci`/`lo` (i.e. `inspiringHasUnitDetails_` returns false) are still filtered out — they would fail the inspiring prompt anyway. They surface in the response's existing `skipped` array so the helper can show "N regenerated, M skipped (missing ci/lo) — fill those in before re-running" to the user. This is a **behaviour change vs current Bulk paths**, which today regenerate units regardless of `ci`/`lo`; after this refactor those units will be reported as skipped instead of silently producing low-context output.

#### 2. New action `regenerateOneInspiring`

```
action: 'regenerateOneInspiring'
payload: { idx: <number>, ca: <string>, yl: <string>, th: <string> }
```

Routing: register in the `doPost` action dispatcher.

Body:
1. Load `data.json` from Drive.
2. Re-resolve the target by `(ca, yl, th)` match (not raw idx) to survive concurrent edits from other tabs. `idx` is sent only as a hint — if it still matches `(ca, yl, th)`, use it; otherwise scan `data` for the matching key. If no match, return `{ error: 'unit-not-found' }` and log.
3. Build prompt via `inspiringBuildPrompt_(data, resolvedIdx, getApprovedToolsPrompt_())`.
4. Run the same inner attempt loop `regenerateAllInspiring` uses (lines 4605–4684) — `inspiringCallOnce_`, `inspiringValidateSugs_`, retry up to 3 times with the existing temperature drop and CRITICAL retry note, then the `inspiringApplySubstitutions_` fallback if all three attempts failed on a tool issue.
5. **Critically:** the result is written to `data[resolvedIdx]._pendingRegen = { sugs, ts, autoSwapped }` rather than `data[resolvedIdx].s`, where `sugs` is the array of 6 `{ t, d }` objects, `ts` is `new Date().toISOString()` (matching the format of `inspiringRegenAt`), and `autoSwapped` is the swap log if the substitution fallback fired (else absent). No marker bump on `inspiringRegenAt`. No `clearHumanVerifiedFlags_` yet — that fires on Apply.
6. Save data.json to Drive.

#### 3. New action `applyPendingRegen`

```
action: 'applyPendingRegen'
payload: { idx: <number>, ca: <string>, yl: <string>, th: <string> }
```

Body:
1. Load `data.json`.
2. Re-resolve target by `(ca, yl, th)`.
3. If no `_pendingRegen` on the target, return `{ error: 'no-pending' }`.
4. Move `_pendingRegen.sugs` → `data[idx].s` (mapped through `{ t, d }` to drop any extra fields).
5. Set `audited: true`, `inspiringRegenAt: new Date().toISOString()`, concat any `_pendingRegen.autoSwapped` into `inspiringRegenAutoSwapped`.
6. Call `clearHumanVerifiedFlags_(data[idx], 'Applied previewed regenerateOneInspiring candidate')`.
7. Delete `_pendingRegen`.
8. Save to Drive.

No new `discardPendingRegen` action. Discard is client-side only; the next preview overwrites the marker, and the marker is harmless if left in place because the frontend renders preview UI only when the user has actively requested it.

### Frontend additions

#### Shared helper: `bulkRegenViaInspiring(targets, label)`

Lives in `js/08-export-sync-hotfixes.js` (alongside `runBulkRegen` which currently owns the closest analog). Signature:

```js
async function bulkRegenViaInspiring(targets, label)
  // targets: Array<{ e: Entry, idx: number }>
  // label:   string for status bar + progress UI
```

Behaviour:
1. Snapshot first (call `createManualSnapshot()` if available — matches existing pattern).
2. Build `indices = targets.map(t => t.idx)`.
3. POST `regenerateAllInspiring` with `{ indices, batch: indices.length }` (single backend call — backend processes them with its existing per-unit save loop, so resumability is preserved per [[resumable-bulk-ops-required]]).
4. Poll `regenerateAllInspiringStatus` every 8 seconds. On each poll, compare the current `done` count (units in `targets` with `inspiringRegenAt` markers refreshed since the start) against `targets.length`.
5. Stall detection: if two consecutive polls show no progress AND no `aborted`/`paused` state, surface a warning and call `loadFromDrive()` so the user can see the partial result.
6. On completion or stall, call `loadFromDrive()` and `renderDashboard()`.

#### `regenAll` refactor (per-entry)

Replace the inline prompt + 3-attempt loop with:

1. POST `regenerateOneInspiring` with `{ idx, ca, yl, th }`.
2. Show "Generating…" with progress spinner.
3. Poll Drive `modifiedTime` every 6 seconds. When it changes, call `loadFromDrive()` and inspect `DATA[idx]._pendingRegen`. If present, render the preview pane from `_pendingRegen.sugs` (matching the existing preview-pane HTML shape so no UI changes).
4. **Apply** button POSTs `applyPendingRegen`, polls modifiedTime again, then `loadFromDrive` + `renderEntry(idx)`.
5. **Discard** button clears the local preview UI; the marker stays in `data.json` until next preview overwrites it (harmless — it never re-renders unless the user explicitly opens the regen flow again on that entry).
6. Error states (backend returned an error, polling stalled, etc.) surface in the existing red-text `regen-all-result` slot.

#### Bulk-site rewrites (5 sites)

Each becomes ~5 lines:

```js
const targets = DATA.map((e, idx) => ({ e, idx })).filter(/* site-specific filter */);
if (!targets.length) { setStatus('Nothing to regen', 'success'); return; }
const confirmed = confirm(`Regenerate ${targets.length} unit${…}? Inspire-quality output, ~${targets.length * 8}s total.`);
if (!confirmed) return;
await bulkRegenViaInspiring(targets, `<site-specific label>`);
```

The site-specific filter for each:
- `05 fixAllOfType` — filters by type (`incomplete`/`banned`/`offwhitelist`/`duplicate`) — keep this logic, just hand the result to the helper.
- `08 runBulkRegen` — campus+year filter from dropdowns — keep, hand to helper.
- `08 scanAndFixComponentDupes` — `componentDupesInRegen_(e.s)` — keep the existing `findComponentDupeTargets_()`, hand its output to the helper.
- `09 legacy incomplete fixer` — incomplete-detection logic — keep, hand to helper.

### Dead code to delete

After the rewrites:
- The inline prompt strings in `05/06/08/09` that build the old 4-validator prompt locally.
- The 3-attempt retry loops in `05/06/08/09` (also the one inside `scanAndFixComponentDupes`).
- The `lastSmashCount`, `lastDupOpener`, `lastDupComponent`, `dupedTool`, `lastFailReason` locals in each of those loops.

### Code that stays

- The four frontend validators (`componentDupesInRegen_`, `appSmashCountInRegen_`, `openerDupesSiblingInYear_`, plus the `toolKey`-based dup check). `componentDupesInRegen_` still backs the **scan** half of the Audit card (`findComponentDupeTargets_` and `renderComponentDupAuditList`) — only the **fix** half routes to backend.
- `appSmashRequirementForEntry_` / `APP_SMASH_REQUIREMENT` — referenced by other call sites; keep until Phase 3 cleanup.
- `SUGGESTION_STYLE` — referenced by per-slot regen and feedback paths.

## Data flow

```
Studio click  ──POST──►  GAS doPost  ──►  regenerateOneInspiring()
                                            │
                                            ├─►  inspiringBuildPrompt_
                                            ├─►  inspiringCallOnce_
                                            ├─►  inspiringValidateSugs_  (3 attempts)
                                            ├─►  inspiringApplySubstitutions_ (fallback)
                                            └─►  data[idx]._pendingRegen = { sugs, … }
                                                  │
Drive ◄──────────────save──────────────────────────┘

Studio polls modifiedTime  ──►  loadFromDrive  ──►  DATA[idx]._pendingRegen present
                                                          │
                                                          ▼
                                                  Render preview pane

Apply click  ──POST──►  applyPendingRegen
                          │
                          ├─►  data[idx].s = _pendingRegen.sugs
                          ├─►  audited = true; inspiringRegenAt; clearHumanVerifiedFlags_
                          └─►  delete _pendingRegen  →  save to Drive
                                                          │
Studio reloads  ──►  renderEntry  ──────────────────────────┘
```

Bulk paths skip the `_pendingRegen` step entirely — they call `regenerateAllInspiring({ indices, batch })` which writes directly to `data[idx].s` and bumps `inspiringRegenAt` per its existing behaviour.

## Failure modes

| Failure | Behaviour |
|---|---|
| AI off-whitelist / banned / age-mismatch after 3 attempts | Auto-substitute fallback inside `regenerateOneInspiring`. If still failing (non-tool issue or substitution shape broken), action returns without writing `_pendingRegen`. Frontend polling times out after 90s, shows red error in `regen-all-result`. |
| `inspiringAbortRequested_()` set mid-batch | Backend bails as it does today, status returns `aborted: true`, helper surfaces this to the user. |
| Cooldown active | Backend returns `paused: true, reason: 'cooldown'`. Helper surfaces and stops. |
| Concurrent edit (another tab) creates idx drift | Re-resolution by `(ca, yl, th)` finds the right entry. If the unit was renamed since the request started, action returns `unit-not-found`. |
| Apply called when `_pendingRegen` already cleared (race with another tab Applying first) | Returns `no-pending`; frontend re-loads from Drive and re-renders the entry (other tab's result already there). |
| `clasp push` without `clasp deploy --deploymentId <ID>` | Live `/exec` URL keeps serving old backend; new actions return 404-shaped errors. Mitigate by surfacing the deploy step in commit message and verifying after deploy. |

## Testing

Following the repo convention (no test framework — manual + ad-hoc node scripts).

1. **Unit test for `regenerateOneInspiring`'s preview marker shape**: small backend test triggered via the Studio that POSTs the action against a known idx with a mocked AI response, verifies `_pendingRegen` is written with `{ sugs, ts, autoSwapped }` and that `s` is unchanged.
2. **End-to-end for `regenAll`**: open a known unit, click Generate 6 new suggestions, confirm preview pane renders within ~30s, confirm `_pendingRegen` is in `DATA[idx]` after `loadFromDrive`, click Apply, confirm `inspiringRegenAt` bumps and `_pendingRegen` is gone.
3. **End-to-end for one Bulk path**: run `scanAndFixComponentDupes` on the 13 known-affected units (per `project_dla_app_smash_intra_unit_dup`). Expected: all 13 get regenerated, `inspiringRegenAt` markers refreshed, `componentDupesInRegen_` returns null for each on re-scan.
4. **Verify dead-code removal didn't break callers**: grep for `componentDupesInRegen_`, `appSmashCountInRegen_`, `openerDupesSiblingInYear_` after the cleanup; surviving call sites must be the Audit scan + any feedback paths that still build prompts client-side.

## Deployment

1. `cd gas_backend; clasp push`
2. `clasp deployments` to find the pinned deployment ID (the one `SCRIPT_URL` in `js/00-config-state-utils.js` points at).
3. `clasp deploy --deploymentId <ID> --description "Bulk → Inspire refactor: regenerateOneInspiring + applyPendingRegen actions"` to bump that deployment to HEAD.
4. Then commit + push the frontend changes. GitHub Pages serves from `main` within ~60s.
5. Hard-reload the Studio (Ctrl+Shift+R) to drop cached JS.

## Scope estimate

~3–4 hours focused work:
- Backend: ~1 hour (2 new actions + opts.indices extension + clasp deploy)
- Frontend: ~2 hours (shared helper + regenAll refactor + 5 Bulk-site rewrites + dead-code cleanup)
- Manual testing: ~30 min
- Commit + push + deploy: ~15 min

## Follow-ups (not in this spec)

- **Phase 2 — per-slot regen at the same caliber.** New backend action `regenerateOneSlotInspiring(idx, slotIdx)` that builds a single-slot variant of the inspiring prompt, runs validators against the unit's other slots, applies auto-substitute on tool failures. Frontend `regenSingleSug` polls for a `_pendingSlotRegen` marker and uses the existing `showChangesPopup` UI. Estimated ~1–2 hours.
- **Phase 3 — long-tail AI-write paths.** `Bulk AI Edit` chatbot regen in 07, Audit replacement drafts in 09, makerspace reboot prompt in 08. Case-by-case conversion. Estimated ~2–3 hours.
