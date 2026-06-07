// tests/banned-phrase.test.js
// Run: node tests/banned-phrase.test.js   (exit 0 = pass)
const { AUDIT_BANNED_PHRASES, auditBannedPhraseHit_ } = require('./banned-phrase.impl.js');

let failures = 0;
function check(name, cond){ if(!cond){ console.error('FAIL:', name); failures++; } else { console.log('ok:', name); } }

check('catches "For a twist"', auditBannedPhraseHit_('Students code. For a twist, they retell it.') === 'for a twist');
check('catches "the twist:" label', !!auditBannedPhraseHit_('They build a city. The twist: a flood hits.'));
check('catches "present their findings"', auditBannedPhraseHit_('Students present their findings to the class.') === 'present their findings');
check('catches "for this unit"', auditBannedPhraseHit_('A poster for this unit.') === 'for this unit');
check('passes clean text', auditBannedPhraseHit_('Students design a flood-resilient model city and stress-test it.') === null);
check('case-insensitive', auditBannedPhraseHit_('FOR A TWIST they swap roles.') === 'for a twist');
check('has >=15 phrases', AUDIT_BANNED_PHRASES.length >= 15);

if(failures){ console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll banned-phrase tests passed'); process.exit(0);
