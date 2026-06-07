// tests/banned-phrase.impl.js
var AUDIT_BANNED_PHRASES = [
  'for a twist',
  'the twist:', 'the twist —', "here's the twist", 'here is the twist', 'the real twist', 'the big twist',
  'connected to the central idea', 'linked to the line of inquiry',
  'related to the unit theme', 'for this unit', 'in this unit', 'about this unit',
  "this unit's focus", 'the unit focus', 'connects to the unit focus',
  'share their learning', 'use the app to present', 'make a simple product',
  'create a digital product', 'explore the topic', 'connected to the unit',
  'present their findings', 'record their thinking',
  'document their learning journey', 'document their inquiry journey'
];

function auditBannedPhraseHit_(text) {
  var t = String(text || '').toLowerCase();
  for (var i = 0; i < AUDIT_BANNED_PHRASES.length; i++) {
    if (t.indexOf(AUDIT_BANNED_PHRASES[i]) !== -1) return AUDIT_BANNED_PHRASES[i];
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AUDIT_BANNED_PHRASES: AUDIT_BANNED_PHRASES, auditBannedPhraseHit_: auditBannedPhraseHit_ };
}
