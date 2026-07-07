// tests/strip-twist.impl.js — mirror of gas_backend stripTwistLabel_ (Code.js)
function stripTwistLabel_(value) {
  let s = String(value || '');
  s = s.replace(/(^|[.!?]\s+)(?:and |but )?(?:here(?:'|’)?s |here is )?the (?:real |big )?twist(?:\s*[:—]\s*|\s+is(?:\s+that)?\s+)/gi, function (m, lead) { return lead; });
  // 2026-07-07: stock lead-in clauses from pre-ban regens ("To add a digital
  // twist, " / "As a playful twist, " / "To stretch their thinking, " ...).
  // Strip the clause, keep the sentence. Mid-sentence nouns ("adding a sensory
  // twist to their designs") and titles ("Ada Twist, Scientist") don't match.
  s = s.replace(/(^|[.!?]\s+)(?:as|in|for)\s+(?:a|an|the)\s+(?:[\w-]+\s+)?twist(?:\s+of\s+[\w-]+)?\s*[,:]\s*/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)to\s+add\s+(?:a|an|the)\s+(?:[\w-]+\s+)?twist\s*[,:]\s*/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)to\s+bring\s+in\s+(?:a|an)\s+[\w-]+\s+twist\s*[,:]\s*/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)a\s+twist\s+of\s+[\w-]+\s*[,:]\s*/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)to\s+stretch\s+their\s+(?:thinking|learning)\s*[,:]\s*/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)(?:to\s+)?take\s+it\s+further\s*[,:]\s*/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)for\s+an\s+extra\s+challenge\s*[,:]\s*/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, function (m, lead, ch) { return lead + ch.toUpperCase(); });
  return s.replace(/ {2,}/g, ' ').trim();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { stripTwistLabel_ };
