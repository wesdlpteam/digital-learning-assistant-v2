import { DROPPED_FIELDS } from './slim-data.mjs';

// If the live site starts reading a field the slimmer drops, the demo would
// silently lose a feature. Fail the build instead.
export function assertNoDroppedFieldUsage(html) {
  const offenders = DROPPED_FIELDS.filter(field =>
    new RegExp(`\\.${field}\\b`).test(html)
  );
  if (offenders.length) {
    throw new Error(
      `index.html now reads unit field(s) the sandbox slimmer drops: ${offenders.join(', ')}. ` +
      'Add them to KEEP_FIELDS in tools/lib/slim-data.mjs (and re-measure the output size).'
    );
  }
}

// Hosts the demo must never carry a reference to. script.google.com is the paid
// path (gas_backend → OpenAI); the other two are how the Studio would sign in
// and read the real analytics spreadsheet.
export const FORBIDDEN_HOSTS = [
  'script.google.com',
  'accounts.google.com',
  'sheets.googleapis.com',
  'www.googleapis.com'
];

export function assertNoGoogleScriptRefs(text, label = 'the sandbox output') {
  const found = FORBIDDEN_HOSTS
    .map(host => ({ host, hits: (text.match(new RegExp(host.replace(/\./g, '\\.'), 'g')) || []).length }))
    .filter(r => r.hits > 0);
  if (found.length) {
    const detail = found.map(r => `${r.host} x${r.hits}`).join(', ');
    throw new Error(
      `Forbidden host reference(s) survived into ${label}: ${detail}. ` +
      'The sandbox must never be able to reach the live backends or sign in.'
    );
  }
}

export function assertSizeUnder(bytes, cap, label) {
  if (bytes > cap) {
    throw new Error(`${label} is ${bytes} bytes, over the ${cap} byte cap for the sandbox.`);
  }
}
