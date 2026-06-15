# Kinder year groups + teacher self-service lesson ideas — Design

**Date:** 2026-06-15
**Status:** Awaiting user review (revised after discovering existing proposal loop)

## Problem / goal

Two campuses (Elsternwick, St Kilda) have no Early Learning kinder year groups in the DLA —
only Glen Waverley does. Separately, kinder teachers want to enter their Central Idea (CI)
and Lines of Inquiry (LOIs) directly and have the DLA generate lesson ideas, instead of
uploading planner documents for a curator to parse.

## What already exists (do NOT rebuild)

A teacher CI/LOI **proposal loop** was shipped 2026-05-25 and is fully working:

- **Public form (`index.html`):** every unit — including empty ones — shows an
  "✏️ Edit unit details" button (`startUoiEdit`, index.html:1132). The teacher types the
  Central Idea + Lines of Inquiry + an optional note and hits "💾 Save and submit for
  approval" (`submitUoiEdit`, index.html:1249), which GETs the public
  `?action=submitUoiProposal` endpoint. After submitting, it offers to generate a tailored
  idea for any one tool via the existing tool picker.
- **Backend (`gas_backend/Code.js`):** `submitUoiProposal_` (doGet, public, daily-capped)
  stores proposals in the `DLA_UOI_PROPOSALS` Script Property. `listUoiProposals_`,
  `approveUoiProposal_`, `dismissUoiProposal_` (doPost, authenticated) power review.
  `approveUoiProposal_` (Code.js:972) writes the teacher's CI/LOIs into the matching
  `data.json` unit and pushes to GitHub.
- **Studio review (`js/06-bulk-router-chat.js`):** pending proposals render in the browse
  screen with ✓ Approve / ✕ Dismiss (`loadUoiProposals`, `approveUoiProposal`,
  `dismissUoiProposal`, ~js/06:1273–1327, 1559–1592).

So the form, the inbox, and the approve→publish-CI/LOI path are done. This design only fills
the gaps below.

## Gaps this design closes

1. **The 24 kinder units don't exist.** Create empty 3YO + 4YO units (6 themes each) for
   Elsternwick and St Kilda so teachers have something to open and fill.
2. **Approval saves CI/LOIs but not lesson ideas.** Today the unit stays empty until a curator
   separately runs "Inspire All". Make approval **auto-generate the 6 lesson ideas**.
3. **No email on submission.** Send one to dlpteam@ (cc nathan@) when a proposal arrives.
4. **No dashboard notification.** The pending count is only visible inside the browse screen;
   add a badge/banner on the Studio dashboard home.
5. **Campus label.** Show "St Kilda Road" (teachers currently see "St Kilda Rd").

## Decisions (from brainstorming)

- **Where teachers edit:** existing public form (no rebuild). Approve-gated in Studio.
- **Seed content:** empty theme shells (blank CI/LOI, no lessons). All **six** transdisciplinary
  themes per kinder group (same as older year levels), not GW's reduced 4/3 set.
- **Lesson generation timing:** **automatically when a curator approves** the proposal.
- **Campus naming:** keep internal `St Kilda` (low risk); only change the displayed label to
  read "St Kilda Road". New kinder units slot under the existing `St Kilda` campus.
- **Theme scope (public):** teachers fill existing shells only.
- **Notification on submit:** email (dlpteam@ main, cc nathan.benn@) + Studio dashboard badge.
- **Age-appropriateness:** already handled — `inspiringYearRule_` (Code.js:3629) and the kinder
  branch (Code.js:2910) restrict 3YO/4YO generation to a fixed kinder-safe tool set. No new
  filtering needed.

## Changes by component

### 1. Seed 24 empty kinder units (gas_backend, run once)

New idempotent function `seedKinderUnits_()` in `gas_backend/Code.js`:
- Reads the Drive `data.json` (source of truth — editing the local file alone would be
  overwritten by the next backend push).
- For each `ca` in `["Elsternwick", "St Kilda"]`, each `yl` in
  `["3 Year Old Kinder", "4 Year Old Kinder"]`, each `th` in the six themes
  (`Who We Are`, `Where We Are in Place and Time`, `How We Express Ourselves`,
  `How the World Works`, `How We Organise Ourselves`, `Sharing the Planet`):
  if no unit already has that `ca/yl/th`, append `{ca, yl, th, ci:"", lo:"", s:[]}`.
- Save back to Drive and `pushToGitHub()`. = 2 × 2 × 6 = **24 units**.
- Run once from the Apps Script editor; idempotent so re-running is safe.

### 2. Auto-generate lesson ideas on approval (gas_backend)

In `approveUoiProposal_` (Code.js:972), after writing `ci`/`lo` and saving to Drive, call
`regenerateOneInspiring_({ ca: p.ca, yl: p.yl, th: p.th })` (Code.js:5269). That function
re-reads Drive, builds the inspiring prompt, generates + validates 6 suggestions (kinder-safe
tools enforced for kinder year levels), writes them to the unit's `s`, and persists/pushes.
Return its result so the Studio can surface "ideas generated". Keep it best-effort: if
generation fails, the CI/LOI save still stands and the curator can run Inspire later.

### 3. Email on submission (gas_backend)

In `submitUoiProposal_` (Code.js:930), after a successful save, best-effort
`MailApp.sendEmail({ to: "dlpteam@wesleycollege.edu.au", cc: "nathan.benn@wesleycollege.edu.au",
subject, htmlBody })` with campus / year / theme / CI / LOIs / note and a "review in DLA Studio"
line. Wrap in try/catch so an email failure never blocks the submission write.

### 4. Studio dashboard badge (frontend)

Add a `<div id="uoi-pending-banner">` to the dashboard markup in `DLA_Studio.html` just above
`#stat-cards`. In `renderDashboard()` (js/06:626), read `window._uoiProposalsCache` (already
populated at startup by `loadUoiProposals()`); if any are `status:"pending"`, render a clickable
banner "📥 N teacher submission(s) awaiting review" that navigates to the browse/review screen.
Empty/zero → render nothing.

### 5. Campus display label (frontend)

In `index.html`, change the three display strings from "St Kilda Rd" to "St Kilda Road":
`CN.SKR` (index.html:1632), the return in the campus-normaliser (index.html:2470), and the
`campuses[]` name (index.html:2623). Internal `data.json` value stays `St Kilda`; backend
canonicalisers (`/^st\s*kilda(\s*(rd|road))?$/i`) already accept "Road".

## Data flow (after changes)

```
Teacher (public index.html, existing form)
  └─ Edit unit details → type CI/LOIs → Save and submit
       └─► gas_backend doGet ?action=submitUoiProposal (public, capped)
             ├─ store in DLA_UOI_PROPOSALS (status:pending)
             └─ MailApp → dlpteam@ (cc nathan@)

Curator (DLA Studio, signed in)
  └─ Dashboard banner "N awaiting review" (from window._uoiProposalsCache)
  └─ Browse → Approve
       └─► gas_backend approveUoiProposal_
             ├─ write CI/LOIs into data.json unit + save
             ├─ regenerateOneInspiring_ → 6 kinder-safe ideas into unit.s
             └─ pushToGitHub → GitHub Pages → live unit populated for teachers
```

## Error handling

- Submit: existing JSON error path on the form stays; email failure is swallowed server-side.
- Approve: if `regenerateOneInspiring_` returns an error/paused, keep the CI/LOI save and
  report "ideas not generated — run Inspire" to the curator; do not fail the whole approval.
- Seed: skip units that already exist; never duplicate; log counts.

## Testing / verification

- `tests/` has a couple of pure-function tests; no full harness. Verify manually + targeted.
- Pure-function unit test: a `kinderUnitsToSeed_` helper (returns the 24 `{ca,yl,th}` combos)
  is testable without Drive — assert it yields exactly 24 unique combos with the right themes.
- Manual:
  1. Run `seedKinderUnits_()`; confirm Drive + GitHub `data.json` gains 24 empty kinder units
     and the public site lists 3YO/4YO under Elsternwick and St Kilda.
  2. Public: open a new kinder unit → Edit unit details → enter CI/LOIs → submit. Confirm the
     dlpteam@ email arrives (cc nathan@) and the proposal is pending.
  3. Studio: dashboard shows the "N awaiting review" banner; Approve → unit gains 6
     kinder-appropriate, whitelist-valid lesson ideas live on the site; badge count drops.
  4. Confirm "St Kilda Road" shows on the public site.
- Bump `APP_VERSION` (js/00) + the `?v=` on the Studio script tags. Redeploy gas_backend and
  bump the pinned deployment (push alone won't change the live /exec URL).

## Out of scope

- Rebuilding the teacher form or the approve/dismiss inbox (already exist).
- A separate "preview 6 ideas before submitting" public flow (generation happens on approve).
- Full internal rename of the `St Kilda` campus value (label-only change chosen).
- Backfilling CI/LOIs/lessons for the new kinder units (they ship empty by design).
- Signed-in teacher editing on the public site (parked on Wesley IT hosting).
