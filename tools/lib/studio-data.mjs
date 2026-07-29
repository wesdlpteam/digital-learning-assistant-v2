import { dropExcludedYearLevels } from './slim-data.mjs';

// js/06-bulk-router-chat.js renders plannerText truncated to 600 chars, so the
// demo only needs a little more than that for the UI to look identical.
export const PLANNER_TEXT_LIMIT = 700;

// Fields the Studio only ever feeds to AI prompts. Every AI path is dead in the
// demo, so these are pure payload. plannerContextRich is the biggest single
// contributor to data.json's size.
export const AI_ONLY_FIELDS = ['plannerContextRich'];

// The Studio demo corpus. Unlike the public site, the Studio reads far more than
// six fields per unit (audit flags, planner text and regen stamps all drive its
// dashboards), so this keeps the whole unit and only changes what the demo needs:
//
//   - Kinder year groups are removed entirely (see dropExcludedYearLevels).
//   - Everything left is marked human-verified and audited, so the Studio's
//     completeness counters read 127 / 127 rather than a part-done figure.
//   - plannerText is truncated to what the UI actually shows.
//   - AI-only fields are dropped, since no AI path runs in the demo.
//
// Live data is never touched — this runs at build time on a copy.
export function prepareStudioUnits(units) {
  if (!Array.isArray(units)) throw new Error('prepareStudioUnits expects an array of units');
  return dropExcludedYearLevels(units).map(unit => {
    const out = { ...unit, humanVerified: true, audited: true };
    for (const field of AI_ONLY_FIELDS) delete out[field];
    if (typeof out.plannerText === 'string' && out.plannerText.length > PLANNER_TEXT_LIMIT) {
      out.plannerText = out.plannerText.slice(0, PLANNER_TEXT_LIMIT);
    }
    return out;
  });
}
