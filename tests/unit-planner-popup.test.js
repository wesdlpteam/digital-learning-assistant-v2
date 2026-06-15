// tests/unit-planner-popup.test.js — Run: node tests/unit-planner-popup.test.js
const { unitNeedsPlannerPopup_ } = require('./unit-planner-popup.impl.js');
let f = 0; const ck = (n, c) => { if (!c) { console.error('FAIL', n); f++; } else console.log('ok', n); };

// Truly-empty units (kinder shells) must NOT show the planner popup — they go to the edit form.
ck('empty array -> no popup', unitNeedsPlannerPopup_({ s: [] }) === false);
ck('missing s -> no popup', unitNeedsPlannerPopup_({}) === false);
ck('null unit -> no popup', unitNeedsPlannerPopup_(null) === false);
// Real ideas -> no popup (normal unit).
ck('has real idea -> no popup', unitNeedsPlannerPopup_({ s: [{ t: 'Book Creator', d: 'x' }] }) === false);
ck('mixed real+placeholder -> no popup', unitNeedsPlannerPopup_({ s: [{ t: 'Epic', d: 'x' }, { t: 'Planner Needed' }] }) === false);
// Legacy placeholder units -> keep the message-Nathan popup.
ck('all Planner Needed -> popup', unitNeedsPlannerPopup_({ s: [{ t: 'Planner Needed' }] }) === true);
ck('(empty) placeholder -> popup', unitNeedsPlannerPopup_({ s: [{ t: '(empty)' }] }) === true);
ck('blank t placeholder -> popup', unitNeedsPlannerPopup_({ s: [{ d: 'no tool' }] }) === true);

if (f) process.exit(1); console.log('passed'); process.exit(0);
