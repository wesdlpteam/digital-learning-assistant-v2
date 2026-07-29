const AI_HOOK_LINE = 'const AI_HOOK = "https://script.google.com/macros/s/AKfycbzIoUL_vbTaH4P7PXuX8HeU9Xh6HuiEWJ05k7q50aJjCg7oeF-ELrlLuPx8uxPFHmE-eA/exec";';
const FBHOOK_LINE = 'const FBHOOK="https://script.google.com/macros/s/AKfycbwFSbbn_1IaTst0ujfzBiQpE5pGpo07UL8yxemoHOudXzPHxKmKJvkgW2jvivf9yr9Alg/exec";';

export const ANCHORS = {
  AI_HOOK: {
    label: 'live AI endpoint constant',
    find: AI_HOOK_LINE,
    replace: 'const AI_HOOK = "sandbox://blocked"; /* sandbox: live AI endpoint removed */'
  },
  FBHOOK: {
    label: 'analytics endpoint constant',
    find: FBHOOK_LINE,
    replace: 'const FBHOOK="sandbox://blocked"; /* sandbox: analytics endpoint removed */'
  },
  BOOT_LEADERBOARD: {
    label: 'boot-time leaderboard call',
    find: '\nloadLeaderboard();\n',
    replace: '\n/* sandbox: boot leaderboard call removed; the shim re-issues it */\n'
  },
  AUTOUPDATE: {
    label: 'auto-update version poller',
    find: '  var CUR=window.APP_VERSION; if(!CUR) return;',
    replace: '  return; /* sandbox: auto-update poller disabled */'
  }
};

const HEAD_SCRIPT_RE = /<script>window\.APP_VERSION='[^']*';<\/script>/;

function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

export function replaceAnchor(html, key) {
  const anchor = ANCHORS[key];
  if (!anchor) throw new Error(`unknown anchor "${key}"`);
  const hits = countOccurrences(html, anchor.find);
  if (hits === 0) {
    throw new Error(
      `anchor "${key}" not found (${anchor.label}). ` +
      'index.html has changed since this build script was written. ' +
      'Update ANCHORS in tools/lib/transform-html.mjs.'
    );
  }
  if (hits > 1) {
    throw new Error(`anchor "${key}" appears ${hits} times (${anchor.label}); expected exactly 1.`);
  }
  return html.replace(anchor.find, anchor.replace);
}

// The repo runs core.autocrlf=true, so the working copy of index.html has CRLF
// endings while the anchors below are written with LF. Normalise first, or the
// newline-bearing anchors silently miss.
export function normaliseEol(text) {
  return String(text).replace(/\r\n/g, '\n');
}

export function transformHtml(html, { guardJs, shimJs } = {}) {
  if (!guardJs || !shimJs) throw new Error('transformHtml requires guardJs and shimJs');

  let out = normaliseEol(html);
  for (const key of Object.keys(ANCHORS)) out = replaceAnchor(out, key);

  const headHits = out.match(HEAD_SCRIPT_RE);
  if (!headHits) {
    throw new Error(
      'anchor "HEAD_SCRIPT" not found (APP_VERSION head script). ' +
      'Update HEAD_SCRIPT_RE in tools/lib/transform-html.mjs.'
    );
  }
  out = out.replace(
    HEAD_SCRIPT_RE,
    `${headHits[0]}\n<script>/* ===== DLA sandbox guard ===== */\n${guardJs}\n</script>`
  );

  return `${out}\n<script>/* ===== DLA sandbox shim ===== */\n${shimJs}\n</script>\n`;
}
