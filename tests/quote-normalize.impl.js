// tests/quote-normalize.impl.js — mirror of normalizeSmartQuotes_ (js/00-config-state-utils.js)
// Curly/smart quotes are the one kind of punctuation that gets lossy-transcoded to "?"
// somewhere on the save pipeline. Plain ASCII quotes can never be corrupted that way, so
// we convert smart quotes -> straight BEFORE any text is built/stored — matching the
// curly->straight normalisation the server AI paths already do (gas_backend Code.js).
function normalizeSmartQuotes_(value) {
  return String(value == null ? '' : value)
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"');
}

// Mirror of the Wise Discussion Chatbot description template (js/07-bulk-actions.js:880),
// so the test can prove the built description never carries smart double-quotes.
function buildWiseDescriptionSample_(parts) {
  parts = parts || {};
  const scenario = parts.scenario || 'Project Ideation';
  const personaName = parts.personaName || 'Leo, a student sustainability coach';
  const topic = parts.topic || 'Sharing the Planet: living things adapt';
  const purpose = parts.purpose || 'test and refine inquiry actions';
  const examples = parts.examples || '“What could we test this week?” and “How will we know it helped?”';
  const product = parts.product || 'a one-page project proposal';
  const theme = parts.theme || 'Sharing the Planet';
  return normalizeSmartQuotes_(
    `The teacher creates a Wise Discussion Chatbot using the ${scenario} scenario and sets the bot's role as ${personaName}. The topic is “${topic}”. Students chat with the bot to ${purpose}; for example, they ask ${examples}. After the chat, students produce ${product} linked explicitly to ${theme}.`
  );
}

// Mirror of wiseCardIsScrambled_ (js/00-config-state-utils.js). Detects a Wise
// Discussion Chatbot description whose quote characters were lossy-transcoded to "?".
// Signature that appears ONLY in corrupted text, never in a clean build:
//   "??"        — a real "?" followed by a mangled close-quote  (clean: ?")
//   space-?-letter — a mangled open-quote before a word        (clean: space-"-letter)
// A genuine question mark is always preceded by a letter (e.g. "helped? They"), so a
// SPACE immediately before "?" only happens when an opening quote was destroyed.
function wiseCardIsScrambled_(desc) {
  return /\?\?|\s\?[A-Za-z]/.test(String(desc == null ? '' : desc));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeSmartQuotes_: normalizeSmartQuotes_,
    buildWiseDescriptionSample_: buildWiseDescriptionSample_,
    wiseCardIsScrambled_: wiseCardIsScrambled_
  };
}
