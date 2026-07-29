// The six fields index.html actually reads off a unit. Verified 2026-07-29 by
// grepping index.html for every other field name (zero hits).
export const KEEP_FIELDS = ['ca', 'yl', 'th', 'ci', 'lo', 's'];

// Backend and Studio bookkeeping that ships to teachers' phones for nothing.
export const DROPPED_FIELDS = [
  'plannerText',
  'plannerContextRich',
  'audited',
  'humanVerified',
  'stemRebooted',
  'diversityRegenAt',
  'inspiringRegenRecovered',
  'inspiringRegenAutoSwapped',
  'inspiringRegenAt',
  'inspiringRegenAtVersion',
  'suggestionAuditAt',
  'suggestionAuditVersion'
];

export function slimUnits(units) {
  if (!Array.isArray(units)) throw new Error('slimUnits expects an array of units');
  return units.map(unit => {
    const out = {};
    for (const field of KEEP_FIELDS) {
      if (unit && Object.prototype.hasOwnProperty.call(unit, field)) out[field] = unit[field];
    }
    return out;
  });
}
