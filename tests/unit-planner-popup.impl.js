// tests/unit-planner-popup.impl.js — mirror of index.html unitNeedsPlannerPopup_
// True only when a unit has placeholder suggestions awaiting a planner upload
// (legacy "message Nathan" flow). Truly-empty units (s:[] — e.g. the kinder
// shells) return false so the click opens the editable detail view instead.
function unitNeedsPlannerPopup_(u) {
  if (!u || !u.s || !u.s.length) return false;
  return u.s.every(function (s) {
    return !s.t || s.t.indexOf('Planner Needed') !== -1 || s.t === '(empty)';
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { unitNeedsPlannerPopup_ };
