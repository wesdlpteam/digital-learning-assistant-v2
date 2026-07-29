/* Sandbox picker matcher. Plain browser script: no imports, no exports.
   Also loaded by tests/match-tool.test.mjs through node:vm.

   Two normalisations, because tool names carry inconsistent punctuation:
   "micro:bit" spaces out to "micro bit" but a teacher types "microbit".
   Comparing both the spaced and the fully-squashed form catches either. */
function matchToolToSuggestion(tool, suggestions) {
  function spaced(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  function squashed(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  var needleSpaced = spaced(tool);
  var needleSquashed = squashed(tool);
  if (needleSpaced.length < 3) return null;
  if (!suggestions || !suggestions.length) return null;

  var substringHit = null;
  for (var i = 0; i < suggestions.length; i++) {
    var entry = suggestions[i];
    if (!entry || !entry.t) continue;
    var nameSpaced = spaced(entry.t);
    var nameSquashed = squashed(entry.t);
    if (nameSpaced === needleSpaced || nameSquashed === needleSquashed) return entry;
    if (substringHit === null &&
        (nameSpaced.indexOf(needleSpaced) !== -1 || nameSquashed.indexOf(needleSquashed) !== -1)) {
      substringHit = entry;
    }
  }
  return substringHit;
}
