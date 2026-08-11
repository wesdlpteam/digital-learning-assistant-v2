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
  },
  // Left alone, the Admin button on the demo sends the audience to the REAL
  // Studio, which is both a sign-in wall and the live tool. Point it at the
  // demo Studio instead.
  ADMIN_URL: {
    label: 'admin link target',
    find: 'const ADMIN_URL="https://wesdlpteam.github.io/digital-learning-assistant-v2/DLA_Studio.html";',
    replace: 'const ADMIN_URL="studio.html"; /* sandbox: point at the demo Studio, not the live one */'
  },
  // A padlock and the word "Admin" say keep out. In a demo we want the opposite.
  ADMIN_BUTTON: {
    label: 'admin button label and icon',
    find: 'title="Open DLA Studio admin"><span class="admin-ico">🔒</span><span>Admin</span>',
    replace: 'title="Open the demo of the behind-the-scenes admin Studio"><span class="admin-ico">👀</span><span>See behind the scenes</span>'
  },
  ADMIN_BUTTON_MOBILE: {
    label: 'admin button label under 430px',
    find: ".admin-btn::after{content:'Admin';font-size:11px}",
    replace: ".admin-btn::after{content:'Behind the scenes';font-size:11px}"
  }
};

const HEAD_SCRIPT_RE = /<script>window\.APP_VERSION='[^']*';<\/script>/;

// ---- DLA_Studio.html -------------------------------------------------------
// The Studio signs in with Google and reads Drive; the demo does neither.
export const STUDIO_ANCHORS = {
  GSI: {
    label: 'Google sign-in library',
    find: '<script src="https://accounts.google.com/gsi/client" async defer></script>',
    replace: '<!-- sandbox: Google sign-in removed -->'
  },
  STUDIO_CSS: {
    label: 'studio stylesheet link',
    find: '<link rel="stylesheet" href="css/studio.css?v=5.62">',
    replace: [
      '<link rel="stylesheet" href="css/studio.css?v=5.62">',
      // Start the demo data downloading in parallel with the nine js/ files
      // instead of after them. Shaves most of the wait before the UI appears.
      '<link rel="preload" as="fetch" href="studio-data.json" crossorigin>',
      '<link rel="preload" as="fetch" href="studio-analytics.json" crossorigin>',
      // #screen-load is the Studio's own "Connect Google Drive to load your
      // data.json" prompt. In the demo nothing ever connects to Drive, so it is
      // both wrong and alarming to show it. Hide it from the very first paint
      // (a style tag in the head, not a shim call, so there is no flash) and
      // show a neutral loading note instead.
      '<style>',
      '#screen-load{display:none!important}',
      '#sandbox-loading{position:fixed;inset:0;z-index:99998;display:flex;align-items:center;',
      'justify-content:center;background:#0d0d0d;color:#c9c9c9;',
      'font:600 15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;padding:24px}',
      '#sandbox-loading .sl-sub{display:block;margin-top:8px;font-weight:400;font-size:13px;color:#7a7a7a}',
      '</style>',
      '<script>/* ===== DLA sandbox guard ===== */',
      '__GUARD__',
      '</script>'
    ].join('\n')
  },
  BODY_OPEN: {
    label: 'body open tag',
    find: '<body>',
    replace: '<body>\n<div id="sandbox-loading">Loading the DLA Studio demo…<span class="sl-sub">Sample data, nothing is connected</span></div>'
  }
};

// js/00-config-state-utils.js — the three endpoints the Studio would otherwise reach.
export const STUDIO_JS00_ANCHORS = {
  SCRIPT_URL: {
    label: 'gas_backend endpoint',
    find: "const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzIoUL_vbTaH4P7PXuX8HeU9Xh6HuiEWJ05k7q50aJjCg7oeF-ELrlLuPx8uxPFHmE-eA/exec';",
    replace: "const SCRIPT_URL = 'sandbox://blocked'; /* sandbox: backend endpoint removed */"
  },
  CLIENT_ID: {
    label: 'Google OAuth client id',
    find: "const CLIENT_ID = '334712966315-9diac0qcv57168kn378i5js2ikgqqvpt.apps.googleusercontent.com';",
    replace: "const CLIENT_ID = 'sandbox-blocked'; /* sandbox: OAuth client removed */"
  },
  ANALYTICS_SHEET_ID: {
    label: 'analytics spreadsheet id',
    find: "const ANALYTICS_SHEET_ID = '1R4P4FJlc8SyRFlVWoM0HpHmfCNMNVOpI8cuEILFxBNY';",
    replace: "const ANALYTICS_SHEET_ID = 'sandbox-blocked'; /* sandbox: sheet id removed */"
  }
};

function applyAnchorSet(text, anchorSet, sourceName) {
  let out = normaliseEol(text);
  for (const [key, anchor] of Object.entries(anchorSet)) {
    const hits = countOccurrences(out, anchor.find);
    if (hits === 0) {
      throw new Error(
        `anchor "${key}" not found in ${sourceName} (${anchor.label}). ` +
        'The source has changed since this build script was written. ' +
        'Update the anchor set in tools/lib/transform-html.mjs.'
      );
    }
    if (hits > 1) {
      throw new Error(`anchor "${key}" appears ${hits} times in ${sourceName} (${anchor.label}); expected exactly 1.`);
    }
    out = out.replace(anchor.find, anchor.replace);
  }
  return out;
}

export function transformStudioHtml(html, { guardJs, shimJs } = {}) {
  if (!guardJs || !shimJs) throw new Error('transformStudioHtml requires guardJs and shimJs');
  const out = applyAnchorSet(html, STUDIO_ANCHORS, 'DLA_Studio.html')
    .replace('__GUARD__', () => guardJs);
  return `${out}\n<script>/* ===== DLA sandbox studio shim ===== */\n${shimJs}\n</script>\n`;
}

export function transformStudioJs00(source) {
  return applyAnchorSet(source, STUDIO_JS00_ANCHORS, 'js/00-config-state-utils.js');
}

// Hosts that appear inline in the Studio scripts as request URLs — Drive reads
// and writes, and the Sheets reads behind the analytics screens. The shim sets a
// sentinel DRIVE_TOKEN so the UI behaves as signed in, which means the usual
// `if(!DRIVE_TOKEN) return` gates no longer stop these paths. The runtime guard
// would still block them, but leaving a live URL in a demo build is the kind of
// thing that is one edit away from mattering, so strip them at build time too.
const HOST_NEUTRALISATIONS = [
  ['https://www.googleapis.com', 'sandbox://blocked'],
  ['https://sheets.googleapis.com', 'sandbox://blocked'],
  ['https://accounts.google.com', 'sandbox://blocked'],
  ['https://script.google.com', 'sandbox://blocked']
];

export function neutraliseHosts(source) {
  let out = normaliseEol(source);
  for (const [from, to] of HOST_NEUTRALISATIONS) out = out.split(from).join(to);
  return out;
}

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
