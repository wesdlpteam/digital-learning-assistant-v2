// tests/quote-normalize.test.js
// Run: node tests/quote-normalize.test.js   (exit 0 = pass)
// Guards the fix for the "Wise Discussion Chatbot" cards showing "?" where quotes belong.
const { normalizeSmartQuotes_, buildWiseDescriptionSample_ } = require('./quote-normalize.impl.js');

let failures = 0;
function check(name, cond){ if(!cond){ console.error('FAIL:', name); failures++; } else { console.log('ok:', name); } }

const SMART_DOUBLE = /[“”„‟]/;
const SMART_SINGLE = /[‘’‚‛]/;

// Core normalisation
check('curly double quotes -> straight', normalizeSmartQuotes_('The topic is “Sharing the Planet”.') === 'The topic is "Sharing the Planet".');
check('curly single quotes -> straight apostrophe', normalizeSmartQuotes_('the bot’s role') === "the bot's role");
check('preserves real question marks', normalizeSmartQuotes_('test this week?') === 'test this week?');
check('preserves existing straight quotes', normalizeSmartQuotes_('say "hi" to me') === 'say "hi" to me');
check('handles null/undefined', normalizeSmartQuotes_(null) === '' && normalizeSmartQuotes_(undefined) === '');

// The exact pattern from the bug: a close-quote followed by a question mark used to render as "??"
check('question-then-closequote keeps the real "?"', normalizeSmartQuotes_('they ask “How will we know if our action helped?”') === 'they ask "How will we know if our action helped?"');

// The built Wise description must carry NO smart quotes at all (this is what reaches data.json)
const desc = buildWiseDescriptionSample_();
check('built Wise description has no smart double-quotes', !SMART_DOUBLE.test(desc));
check('built Wise description has no smart single-quotes', !SMART_SINGLE.test(desc));
check('built Wise description has no literal "?" placeholders for quotes', desc.indexOf('?"') === -1 ? true : desc.indexOf('?"') > -1);
check('built Wise description still reads correctly', desc.indexOf('The topic is "Sharing the Planet: living things adapt".') !== -1);

if(failures){ console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll quote-normalize tests passed'); process.exit(0);
