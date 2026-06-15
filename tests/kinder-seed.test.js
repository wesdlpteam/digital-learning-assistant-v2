// tests/kinder-seed.test.js — Run: node tests/kinder-seed.test.js
const { kinderUnitsToSeed_ } = require('./kinder-seed.impl.js');
let f = 0; const ck = (n, c) => { if (!c) { console.error('FAIL', n); f++; } else console.log('ok', n); };

const combos = kinderUnitsToSeed_();
ck('produces exactly 24 combos', combos.length === 24);
ck('every combo has empty ci/lo and empty s', combos.every(u => u.ci === '' && u.lo === '' && Array.isArray(u.s) && u.s.length === 0));
ck('campuses are Elsternwick + St Kilda only', new Set(combos.map(u => u.ca)).size === 2 && combos.every(u => u.ca === 'Elsternwick' || u.ca === 'St Kilda'));
ck('year levels are the two kinder strings only', combos.every(u => u.yl === '3 Year Old Kinder' || u.yl === '4 Year Old Kinder'));
ck('each campus+year has all six themes', (() => {
  const themes = ['Who We Are','Where We Are in Place and Time','How We Express Ourselves','How the World Works','How We Organise Ourselves','Sharing the Planet'];
  return ['Elsternwick','St Kilda'].every(ca => ['3 Year Old Kinder','4 Year Old Kinder'].every(yl => {
    const got = combos.filter(u => u.ca === ca && u.yl === yl).map(u => u.th).sort();
    return JSON.stringify(got) === JSON.stringify([...themes].sort());
  }));
})());
ck('no duplicate ca|yl|th combos', new Set(combos.map(u => u.ca + '|' + u.yl + '|' + u.th)).size === 24);

if (f) process.exit(1); console.log('passed'); process.exit(0);
