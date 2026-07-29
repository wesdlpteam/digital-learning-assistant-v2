# Sandbox demo — mobile and tablet check

**Date:** 2026-07-29
**Build tested:** local build of `tools/build-sandbox.mjs`, served over HTTP on `localhost:8137`
**Method:** Chrome device emulation via chrome-devtools, measured in-page (bounding boxes, computed styles, `performance` entries), not by eyeballing CSS.

Served over real HTTP rather than `file://` on purpose: the sandbox guard compares against `location.origin`, which is `null` under `file://`.

## Result summary

| Width | Home | Unit detail | Tool picker | Horizontal scroll | Badge |
|---|---|---|---|---|---|
| 360 (small phone) | pass | pass | pass, modal 329px, scrolls inside | none | fits, 12px |
| 390 (iPhone) | pass | pass | pass, scrolls inside, close visible | none | fits |
| 430 (large phone) | pass | pass | pass, scrolls inside, close visible | none | fits, 12px |
| 768 (tablet portrait) | pass | pass | pass, close visible | none | fits |
| 1024 (tablet landscape) | pass | pass | pass, close visible | none | fits |

Tool picker marked **6 of 48** tiles as having a ready-made idea at every width, and floated them to the top of the grid.

Screenshots: `<scratchpad>/shots/w360-home.png`, `<scratchpad>/shots/w768-unit.png`.

## Checks run at each width

- **No horizontal page scroll.** `documentElement.scrollWidth <= clientWidth` on home, unit detail and with the picker open. Passed at all five widths.
- **Tech Champions ribbon.** The prime suspect, since it escapes the 700px wrapper with `calc(50% - 50vw)`. Measured at 1024px: left 175, right 835, viewport 1009 — comfortably inside. No overflow at any width.
- **Picker dialog.** Fits the viewport, scrolls internally rather than pushing content off-screen, and the close button stays present at every width.
- **Badge.** Present on every screen, right edge inside the viewport, drops to 11px under 430px.

## Findings NOT fixed (live-site issues, out of scope for this job)

These exist on the live site too. They are recorded here rather than patched, because this task's scope was sandbox-specific breakage only.

1. **Tap targets under the 44x44px guideline** on unit detail at 360px:
   - `✏️ Edit unit details` — 137x30
   - `🚀 I'm going to try this` — 177x34
   - `✓ I Used This` — 116x34
   - `💬 Feedback` — 118x34
   - tech chip (e.g. `🔧 Book Creator`) — 111x27
   - one unlabelled 36x36 control
   - Picker tiles are 38px high (278x38 at 360px).
2. **Body text below 14px** in places: the feedback prompt and "Tap to reveal" STEM line render at 12px, some idea body copy at 13px. iOS Safari zooms on focus when an input's text is under 16px; none of these are inputs, so it is a legibility point rather than a zoom bug.
3. **`a.planner-modal-cta`** reports a bounding box past the right edge at all widths, but the page never scrolls horizontally, so it sits inside a clipped or hidden container. Cosmetic, worth a look if that modal is ever opened on a phone.

## Sandbox-specific observation (accepted, not a defect)

The badge sits bottom-left and visually overlaps the last campus card on a phone. It is `pointer-events: none`, so it never blocks a tap. Left as-is: being unmissable is the point of it.

## Load performance

Emulated **Fast 4G**, cache ignored, 390px viewport:

- Page shell painted / DOMContentLoaded: **498 ms**
- `data.json` (748 KB transferred) complete: **1,635 ms**
- Fully populated and interactive: **~1.7 s**

Comfortably inside the 3 s success criterion. For comparison, the live site ships an 11.6 MB `data.json` for the same screens.

## Network behaviour

After a full click-through (home → campus → year → unit → tick → react → picker → matched tool → unmatched tool), the only requests were:

- `localhost/index.html`
- `localhost/data.json`
- `localhost/libraries.json`
- `localhost/demo-leaderboard.json`
- Google Fonts stylesheet + one woff2

**Zero requests to `script.google.com`.** Console showed only the guard's own info line, `[sandbox] blocked outbound request: sandbox://blocked`, twice — that is the neutered analytics call being swallowed as designed.

**Correction to the spec wording:** the spec said "zero cross-origin requests". That is not literally true and never was — the page loads Google Fonts via a `<link>` stylesheet, which is not a `fetch` and is not blocked (blocking it would break the typography). The guarantee that matters, and that holds, is **zero requests to the DLA backends**, which is where any cost or data pollution would come from. Google Fonts is free and carries no DLA data.
