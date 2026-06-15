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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeSmartQuotes_: normalizeSmartQuotes_, buildWiseDescriptionSample_: buildWiseDescriptionSample_ };
}
