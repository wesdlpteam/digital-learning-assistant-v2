# DLA Sandbox — presentation demo site

**Date:** 2026-07-29
**Status:** design approved, ready for planning
**Purpose:** a standalone, unplugged copy of the public DLA that a webinar and conference audience can open on their own phones and tablets, with no possibility of AI spend and no contamination of live Wesley analytics.

---

## Problem

Nathan is presenting the DLA at a webinar and again at a conference later in 2026. The audience should be able to open the DLA on their own devices and explore it. Pointing them at the live site is unacceptable for three reasons:

1. **Cost.** The "Have a tool in mind?" picker calls OpenAI through `gas_backend` on every use. A room of people tapping it bills the school's key with no cap.
2. **Data pollution.** Every card tick, reaction and page view posts to `gas_analytics`. Conference traffic would distort the usage signals, Tech Champions ribbon and leaderboard that Wesley staff decisions rest on.
3. **Blast radius.** Anything done to make the live site demo-friendly is a change to the site real teachers use.

A fourth problem surfaced during investigation: **payload size**. `data.json` is 11.6 MB. On venue wifi with 50 devices that is a failed demo.

## Success criteria

The build is done when all of these are true and evidenced:

1. Loading the sandbox and exercising every interactive element produces **zero** network requests to `script.google.com` (verified in the browser network panel, not assumed).
2. All 158 units across all three campuses (Elsternwick 54, Glen Waverley 50, St Kilda 54) are browsable, with their existing stored tech ideas intact.
3. Total first-load payload is under 2 MB, and the page is interactive in under 3 seconds on a throttled "Fast 3G / mid-tier mobile" profile.
4. Layout and tap targets are correct at 360, 390 and 430 px (phones) and 768 and 1024 px (tablets), evidenced by screenshots at each width.
5. A visible "Sandbox demo" badge is present on every screen.
6. The live site and live data are byte-for-byte unchanged by this work.

## Non-goals (explicitly out of scope)

- No fake or read-only version of DLA Studio. Teacher-facing site only.
- No Google sign-in of any kind.
- No live AI, not even rate-limited or capped.
- No new AI generation of any content. Everything shown already exists in `data.json`.
- No separate analytics collection for the demo. Demo usage is not measured.
- No changes to the live site, live `data.json`, or either Apps Script backend.

---

## Approach

A **separate public repo** served by GitHub Pages, produced by a **repeatable build script** that lives in the main repo.

```
main repo (source of truth)                  sandbox repo (generated, disposable)
  index.html          ─┐
  data.json           ─┼─► tools/build-sandbox.mjs ─► index.html      (unplugged)
  libraries.json      ─┘                              data.json       (slimmed, ~0.75 MB)
                                                      libraries.json  (copied as-is)
                                                      demo-leaderboard.json (frozen snapshot)
```

- **Sandbox repo:** `wesdlpteam/dla-sandbox`, public, GitHub Pages from `main`.
  URL: `https://wesdlpteam.github.io/dla-sandbox/` — short enough for a slide and a QR code.
- **Build script:** `tools/build-sandbox.mjs` in the main repo. Run it before each event to refresh. The sandbox is never hand-edited; it is always regenerated. This prevents silent drift between demo and live.

Alternatives rejected:
- *`/demo/` folder inside the live repo* — long ugly URL, demo files sit beside live files, mistakes are one directory away from production.
- *`?demo=1` flag on the live site* — requires editing the file real teachers use, and puts the audience on the live URL. Directly contradicts "separate to the original".

---

## Component 1 — Data slimming

**Finding:** each unit in `data.json` carries 18 fields. `index.html` reads exactly six of them: `ca`, `yl`, `th`, `ci`, `lo`, `s`. The other twelve (`plannerText`, `plannerContextRich`, `audited`, `humanVerified`, `stemRebooted`, the various `*RegenAt` / `*Version` stamps) are backend and Studio bookkeeping. Verified by grepping `index.html` for each field name: zero hits.

**Measured:** reducing to those six fields takes `data.json` from **11,622,724 bytes to 779,552 bytes** — a 14.9x reduction, with no visible change to the site.

**Design:** the build script emits a slimmed `data.json` containing only `{ca, yl, th, ci, lo, s}` per unit, preserving array order (unit indices are used in URL hashes, so order must not change).

**Side benefit:** `plannerText` and `plannerContextRich` hold raw copied Wesley planner prose. Dropping them means that internal content is simply not present in the demo copy, independent of the fact that the existing repo is already public.

**Guard:** the build script must fail loudly if `index.html` references a unit field not in the keep-list. Implemented as a check against a hardcoded keep-list plus a scan of `index.html` for `\.(fieldName)\b` on the dropped fields. This stops a future feature silently breaking the demo.

**Note for later, not this job:** the same slimming on the live site would cut every teacher's page load by ~11 MB. Worth a separate ticket.

## Component 2 — Unplugging the network calls

`index.html` has exactly two external endpoints:

| Constant | Line (current) | Talks to | Sandbox treatment |
|---|---|---|---|
| `AI_HOOK` | 548 | `gas_backend` `?action=suggestTech` (OpenAI, costs money) | Replaced; never called |
| `FBHOOK` | 2041 | `gas_analytics` (tracking + leaderboard) | Replaced; never called |

The build script rewrites both constants to sentinel values (e.g. `"__SANDBOX__"`) **and** replaces the functions that use them, so a missed call site cannot leak out. The three touch points:

1. **`fetchTechSuggestion(...)`** — replaced with a local lookup (Component 3). No `fetch`.
2. **Analytics posts** — `trackInteraction`, the `sendBeacon` flush, and the four fire-and-forget `fetch(FBHOOK, ...)` posts become no-ops that return immediately.
3. **`fetchLeaderboard(...)`** — reads the frozen `demo-leaderboard.json` instead of the network. The JSONP fallback path is removed entirely (it injects a `<script>` tag, which must not survive into the sandbox).

**Also disabled:** the auto-update version poller (`APP_VERSION` check near line 2950). It fetches the live site to compare versions; in the sandbox it would both reach out to the network and potentially force-reload mid-presentation. Removed.

**Verification:** after the build, grep the generated `index.html` for `script.google.com` and expect zero matches, and confirm at runtime with the browser network panel.

## Component 3 — The "Have a tool in mind?" picker

Live behaviour: teacher names a tool, the site asks OpenAI for a tailored idea, and renders `{description, valueAdd, steps[], fit, fitNote}`.

Sandbox behaviour, with no new generation:

1. **Match against the unit's existing ideas.** Each unit's `s` array holds six entries shaped `{t: <activity/tool name>, d: <description>}`. If the picked tool matches an entry (case-insensitive, tolerant of the activity name containing the tool name — e.g. tool "Adobe Express" matches `"Animating a Character with Adobe Express"`), render that entry's description in the picker's normal layout.
   - Fields the stored idea does not have (`steps[]`, `valueAdd`, `fit`) are simply omitted rather than faked. The panel must not invent content.
2. **No match — honest fallback.** Render a clearly-worded panel: on the live DLA this writes a fresh idea in about ten seconds; this demo shows the ready-made ideas instead. Then list the unit's six existing ideas as a jumping-off point.
3. **Perceived latency.** Keep the existing spinner for ~700 ms before rendering, so the interaction feels like the real product rather than an instant lookup.
4. **Regenerate button** — hidden in the sandbox. There is nothing to regenerate and a dead button on stage looks broken.

The tool list offered in the picker still comes from `libraries.json` `_meta._inventory.approved` (48 tools), copied across unchanged.

## Component 4 — Leaderboard and interactivity

- **Leaderboard:** frozen snapshot captured at build time into `demo-leaderboard.json`. Rows are `{campus, year, points, streaks}` — campus and year level only, no individual staff are named, so nothing personal appears on a conference screen.
- **Ticks and reactions:** the buttons keep their animation and confetti, and remember their own state in the visitor's browser storage so a second tap toggles correctly. Nothing is transmitted.
- **Local-only leaderboard nudge:** a tick increments the on-screen number for that visitor only, so the cause-and-effect is visible. Resets on reload. This is presentation sugar, and it must be obvious from the "Sandbox demo" badge that these numbers are not real.

## Component 5 — Mobile and tablet

The site already sets a viewport meta tag and has a handful of `@media` rules (430 px and 480 px breakpoints), so it is partly responsive already. This is a verification-and-repair pass, not a redesign.

Widths to check: **360, 390, 430** (phones), **768, 1024** (tablets).

Screens to check at each width:
- Home: hero, Tech Champions ribbon (it deliberately breaks out of the 700 px wrapper using `calc(50% - 50vw)`, which is the most likely thing to overflow), campus cards.
- Campus → year level → unit list.
- Unit detail: central idea, lines of inquiry, the six idea cards, VALUE ADD callouts.
- The tool picker dialog — highest risk. It is a modal with an editable panel and was built desktop-first.
- Sandbox badge does not cover controls.

Checks: no horizontal page scroll; text at least 16 px so iOS does not zoom on focus; tap targets at least 44x44 px; dialogs scroll internally rather than trapping content off-screen.

Evidence: screenshots at each width via browser device emulation, before and after any fix.

## Component 6 — Sandbox badge

A small fixed badge reading "Sandbox demo — not live data", present on every screen, styled to be visible but not to obscure controls, and shrinking to an icon under 430 px. Purpose: audience photos and screenshots are honest, and nobody mistakes the demo for the production site.

---

## Build and refresh process

1. Run `node tools/build-sandbox.mjs` in the main repo. It reads `index.html`, `data.json`, `libraries.json`, fetches the current leaderboard once, and writes the sandbox output folder.
   - The leaderboard fetch is the script's only network call, made from Nathan's machine at build time. On the Wesley network this can trip TLS interception; if it fails with "self-signed certificate in certificate chain", set `NODE_EXTRA_CA_CERTS` to `~/wesley-corp-roots.pem`. The script must also accept a `--no-leaderboard` flag that reuses the previous snapshot, so a network failure can never block a build the day before an event.
2. The script fails loudly (non-zero exit, clear message) if: an unknown unit field is referenced by `index.html`; `script.google.com` survives in the output; or the output `data.json` exceeds 2 MB.
3. Commit and push the sandbox repo. GitHub Pages redeploys.
4. Re-run before each event to refresh content.

## Testing

- **Automated in the build:** the three fail-loud guards above.
- **Manual, evidenced:** network panel showing zero Apps Script requests during a full click-through; throttled load timing; screenshots at all five widths; the picker exercised against a matched tool and an unmatched tool.
- **Regression on live:** confirm `git status` in the main repo shows only the new `tools/` script and this spec — no changes to `index.html`, `data.json` or `libraries.json`.

## Risks

| Risk | Mitigation |
|---|---|
| A future live-site feature reads a field the slimmer drops | Build script fails loudly on unknown field references |
| Venue wifi fails entirely | Sub-1 MB payload; consider having the sandbox open on a phone beforehand as a backstop. Fully offline use is out of scope |
| Audience assumes demo numbers are real | Persistent sandbox badge |
| Demo drifts from live over months | Never hand-edit; always regenerate from the script |
