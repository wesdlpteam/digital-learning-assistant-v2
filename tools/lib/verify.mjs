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

export function assertNoGoogleScriptRefs(html) {
  const hits = html.match(/script\.google\.com/g);
  if (hits) {
    throw new Error(
      `${hits.length} reference(s) to script.google.com survived into the sandbox output. ` +
      'The sandbox must never be able to reach the live backends.'
    );
  }
}

export function assertSizeUnder(bytes, cap, label) {
  if (bytes > cap) {
    throw new Error(`${label} is ${bytes} bytes, over the ${cap} byte cap for the sandbox.`);
  }
}
