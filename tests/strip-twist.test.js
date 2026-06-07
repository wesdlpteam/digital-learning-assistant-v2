// tests/strip-twist.test.js — Run: node tests/strip-twist.test.js
const { stripTwistLabel_ } = require('./strip-twist.impl.js');
let f = 0; const ck = (n, c) => { if (!c) { console.error('FAIL', n); f++; } else console.log('ok', n); };
ck('removes "The twist:" lead', !/twist/i.test(stripTwistLabel_('Students build a city. The twist: a flood hits at night.')));
ck('keeps the content after the label', /flood/i.test(stripTwistLabel_('Students build a city. The twist: a flood hits at night.')));
ck('leaves clean text alone', stripTwistLabel_('Students design a resilient city and test it.') === 'Students design a resilient city and test it.');
if (f) process.exit(1); console.log('passed'); process.exit(0);
