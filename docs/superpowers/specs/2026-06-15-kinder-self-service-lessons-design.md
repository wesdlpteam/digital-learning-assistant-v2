# Kinder year groups + teacher self-service lesson ideas — Design

**Date:** 2026-06-15
**Status:** Awaiting user review

## Problem / goal

Two campuses (Elsternwick, St Kilda Road) have no Early Learning kinder year groups in
the DLA — only Glen Waverley does. Curators currently populate units by uploading planner
documents that are parsed for Central Idea (CI) and Lines of Inquiry (LOIs), then lessons
are generated. Kinder teachers want to skip the planner-upload step: type their CI and LOIs
directly and have the DLA generate the lesson ideas.

This design delivers:

1. New **3 Year Old Kinder** and **4 Year Old Kinder** year groups for Elsternwick and
   St Kilda Road, each with the six transdisciplinary theme shells (empty).
2. A public, no-sign-in **"Build this unit"** flow where a kinder teacher enters CI + LOIs
   and generates lesson ideas, previews/regenerates them, and submits the draft for review.
3. A **Pending submissions** inbox in DLA Studio where a curator reviews, edits, and
   approves a draft — which publishes it straight into the live unit (no planner upload, no
   manual re-typing).
4. On each submission: an **email** to dlpteam@wesleycollege.edu.au (cc nathan.benn@wesleycollege.edu.au)
   and a **dashboard notification badge** in DLA Studio showing the pending count.

## Decisions (from brainstorming)

- **Where teachers edit:** public site (`index.html`), generate-and-preview only; nothing
  goes live until a curator approves in Studio. Sidesteps the parked teacher-auth/hosting work.
- **Seed content:** empty theme shells (heading only; blank CI/LOI, no lessons). Teachers fill.
- **Approval channel:** a Pending submissions inbox inside Studio (one-click Approve).
- **Campus naming:** rename existing `St Kilda` campus to `St Kilda Road` everywhere; add the
  kinder groups under it. One consistent campus label.
- **Theme scope (public):** teachers fill the existing theme shells only. New themes/units are
  a curator action in Studio.
- **Themes per kinder group:** all **six** transdisciplinary themes (same as older year levels),
  not Glen Waverley's reduced 4/3 set.
- **Ideas per generate:** 6 (matches existing corpus).
- **Notification on submit:** email + Studio dashboard badge.

## Data model changes

Each unit in `data.json` is `{ca, yl, th, ci, lo, s:[{t,d}]}`.

### New empty units (24 total)

For each campus in `["Elsternwick", "St Kilda Road"]`
and each year level in `["3 Year Old Kinder", "4 Year Old Kinder"]`,
create one unit per theme in:

```
Who We Are
Where We Are in Place and Time
How We Express Ourselves
How the World Works
How We Organise Ourselves
Sharing the Planet
```

Each new unit: `{ca, yl, th, ci:"", lo:"", s:[]}`.
= 2 campuses × 2 year groups × 6 themes = **24 units**.

### Campus rename

Rename every unit with `ca == "St Kilda"` to `ca == "St Kilda Road"` in `data.json`.
`CAMPUS_COL` (js/00) already maps both `St Kilda` and `St Kilda Road` to the same colour, so
no colour change is needed; verify no other code path hard-compares the literal `"St Kilda"`.

## Components

### A. Public "Build this unit" form (`index.html`)

- Trigger: a teacher opens a unit whose `s` is empty (currently only the new kinder shells).
  Instead of an empty/"no ideas" state, render an inline form:
  - Central Idea — single text box.
  - Lines of Inquiry — one box per line, with "+ add another".
  - **Generate lesson ideas** button.
- On Generate: call the public generate endpoint (below); render ~6 previewed ideas in the
  same card style as normal lessons. Offer **Regenerate** and **Submit for review**.
- On Submit: post the draft (campus, year level, theme, CI, LOIs, generated ideas, optional
  teacher name/email) to the submissions write path. Show a "Thanks — sent for review" state.
- The preview is client-only until approved (guard against the known "preview vanished"
  re-render bug — keep preview in page state, not derived from the live corpus).

### B. Public generate endpoint (gas_backend `doGet`, JSONP)

- New public action mirroring the existing `suggestTech` doGet: no Google auth, JSONP callback,
  per-input caching in Script Properties, daily cap, server-side OpenAI key via `callAIProxy_`.
- Inputs: `ca`, `yl`, `th`, `ci`, `lo` (LOIs), `n` (default 6), `regen` (0/1).
- Output: array of `{t, d}` lesson ideas.
- Reuses the shared suggestion-quality rules (inspiring description rules, banned-phrase strip,
  approved-tool whitelist validation) so kinder ideas match the rest of the corpus.
- **Age-appropriate tools:** restrict candidate tools to those suitable for 3–4 year-olds,
  using the inventory `ageRanges` in `libraries.json` (`_meta._inventory`). Tools without a
  kinder-appropriate range are excluded.
- Model: `gpt-4.1-mini` (consistent with the existing public picker).

### C. Submission write path (gas_analytics `doPost`)

- New `type: 'kinder_submission'` handled by the analytics `doPost` (the proven public,
  unauthenticated write path already used for reactions/feedback).
- Writes a row to a new **`KinderSubmissions`** sheet tab: timestamp, campus, year level,
  theme, CI, LOIs, generated ideas (JSON), teacher name/email (if given), `status:"pending"`.
- On write, send an **email** via `MailApp.sendEmail` to dlpteam@wesleycollege.edu.au, cc
  nathan.benn@wesleycollege.edu.au, with the submission details and a note to review in Studio.

### D. Studio Pending submissions inbox + dashboard badge

- Studio reads pending rows via a JSONP `GET ?action=pendingSubmissions` on the analytics
  backend (Studio already talks to the analytics project in `04-audit-analytics-live.js`).
- **Dashboard badge:** the Studio dashboard shows a notification badge with the count of
  `status == "pending"` submissions; clicking opens the inbox.
- **Inbox view:** lists each pending submission (campus, year level, theme, CI, LOIs, ideas).
  Curator can edit CI/LOIs/ideas inline.
- **Approve:** the signed-in curator action writes the unit into `data.json` (sets `ci`, `lo`,
  `s` on the matching `{ca, yl, th}` unit) via the authenticated gas_backend path, pushes to
  GitHub, and marks the submission `status:"approved"` (status update posted back to analytics).
- **Discard:** marks the submission `status:"discarded"`; no corpus change.
- Approve/Discard remove the item from the pending count/badge.

## Data flow

```
Teacher (public index.html)
  └─ Generate  ──► gas_backend doGet?action=generateKinder (JSONP, capped/cached)  ──► ideas preview
  └─ Submit    ──► gas_analytics doPost type=kinder_submission ──► KinderSubmissions sheet (pending)
                                                                 └─ MailApp email to Nathan

Curator (DLA Studio, signed in)
  └─ Dashboard badge (count pending)  ◄── gas_analytics GET ?action=pendingSubmissions
  └─ Inbox → Approve ──► gas_backend (auth) writes unit into data.json → pushToGitHub
                       └─ status=approved back to analytics sheet
                       └─► GitHub Pages serves the populated unit to teachers
```

## Error handling

- Generate: surface daily-cap / API errors as a friendly "couldn't generate right now, try
  again shortly" message; never expose keys or raw errors. Itemise filter reasons if zero
  ideas pass the whitelist/age filter (consistent with existing zero-result messaging).
- Submit: if the analytics write fails, keep the preview on screen and tell the teacher it
  didn't send; do not silently drop the draft.
- Approve: if the data.json write/push fails, leave the submission `pending` and show the
  curator the error; do not mark approved on failure.
- Email failure must not block the submission write (best-effort; log on the server).

## Testing

- No formal test harness in this repo; verification is manual in-browser plus targeted unit
  tests where pure functions exist (e.g. age-range tool filtering, theme-shell generation).
- Manual checks:
  1. `data.json` has 24 new empty kinder units; all `St Kilda` → `St Kilda Road`; no orphan
     `"St Kilda"` references in code.
  2. Public: open a new kinder unit → form appears → Generate returns 6 age-appropriate,
     whitelist-valid ideas → Submit shows confirmation.
  3. Email arrives; `KinderSubmissions` row written with `pending`.
  4. Studio dashboard badge shows the count; inbox lists the submission; Approve populates the
     live unit and clears the badge; Discard removes it without corpus change.
- Bump `APP_VERSION` (js/00) and the `?v=` query on the Studio script tags per the versioning
  rule. Redeploy both GAS projects and bump the pinned deployments (push alone won't change the
  live /exec URLs).

## Out of scope

- Teachers creating brand-new themes/units from the public site (curator-only in Studio).
- Fully signed-in teacher editing on the public site (parked on Wesley IT hosting).
- Backfilling CI/LOIs/lessons for the new kinder units (they ship empty by design).
