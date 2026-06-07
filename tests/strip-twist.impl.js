// tests/strip-twist.impl.js — mirror of gas_backend stripTwistLabel_ (Code.js)
function stripTwistLabel_(value) {
  let s = String(value || '');
  s = s.replace(/(^|[.!?]\s+)(?:and |but )?(?:here(?:'|’)?s |here is )?the (?:real |big )?twist(?:\s*[:—]\s*|\s+is(?:\s+that)?\s+)/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, function (m, lead, ch) { return lead + ch.toUpperCase(); });
  return s.replace(/ {2,}/g, ' ').trim();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { stripTwistLabel_ };
