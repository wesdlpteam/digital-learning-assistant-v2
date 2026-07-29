#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimUnits, dropExcludedYearLevels } from './lib/slim-data.mjs';
import { transformHtml, transformStudioHtml, transformStudioJs00, neutraliseHosts } from './lib/transform-html.mjs';
import { prepareStudioUnits } from './lib/studio-data.mjs';
import { buildSampleAnalytics } from './lib/studio-analytics.mjs';
import { assertNoDroppedFieldUsage, assertNoGoogleScriptRefs, assertSizeUnder } from './lib/verify.mjs';
import { fetchLeaderboardSnapshot, loadPreviousSnapshot } from './lib/leaderboard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_CAP = 2 * 1024 * 1024;

function arg(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}
const OUT = path.resolve(ROOT, arg('--out', '../dla-sandbox'));
const SKIP_LEADERBOARD = process.argv.includes('--no-leaderboard');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, contents) {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, contents, 'utf8');
  return Buffer.byteLength(contents, 'utf8');
}

// The nine Studio scripts, in the exact order DLA_Studio.html loads them.
// 08 ships after 09 on purpose — its definitions are meant to win.
const STUDIO_JS = [
  '00-config-state-utils.js', '01-inventory-helpers.js', '02-ui-load-navigation.js',
  '04-audit-analytics-live.js', '05-bulk-setup-libraries.js', '06-bulk-router-chat.js',
  '07-bulk-actions.js', '09-legacy-restored.js', '08-export-sync-hotfixes.js'
];

function approvedToolNames() {
  const inv = JSON.parse(read('libraries.json'))._meta._inventory || {};
  return (inv.approved || [])
    .map(a => (typeof a === 'string' ? a : (a.name || a.tool || a.t || '')))
    .filter(Boolean);
}

const README = `# DLA Sandbox

Generated demo copy of the Wesley College Digital Learning Assistant, used for
presentations. **Do not edit these files by hand** - they are overwritten on
every build.

Regenerate from the main repo (digital-learning-assistant-v2):

    node tools/build-sandbox.mjs --out ../dla-sandbox

No AI calls, no analytics, frozen leaderboard snapshot. Not live data.
`;

async function main() {
  console.log(`Building sandbox into ${OUT}`);

  // 1. index.html
  const sourceHtml = read('index.html');
  assertNoDroppedFieldUsage(sourceHtml);
  const guardJs = read('tools/browser/sandbox-guard.js');
  const shimJs = `${read('tools/browser/match-tool.js')}\n${read('tools/browser/sandbox-shim.js')}`;
  const outHtml = transformHtml(sourceHtml, { guardJs, shimJs });
  assertNoGoogleScriptRefs(outHtml);
  const htmlBytes = write('index.html', outHtml);

  // 2. data.json
  const sourceData = read('data.json');
  const units = JSON.parse(sourceData);
  const kept = dropExcludedYearLevels(units);
  const slim = JSON.stringify(slimUnits(kept));
  assertSizeUnder(Buffer.byteLength(slim, 'utf8'), DATA_CAP, 'data.json');
  const dataBytes = write('data.json', slim);

  // 3. libraries.json - copied as-is, it holds the approved tool list
  const libBytes = write('libraries.json', read('libraries.json'));

  // 4. leaderboard snapshot
  const snapshotPath = path.join(OUT, 'demo-leaderboard.json');
  let rows;
  if (SKIP_LEADERBOARD) {
    rows = loadPreviousSnapshot(snapshotPath);
    console.log('Reusing previous leaderboard snapshot');
  } else {
    rows = await fetchLeaderboardSnapshot();
  }
  const lbBytes = write('demo-leaderboard.json', JSON.stringify(rows));

  // 5. Studio demo — studio.html, its CSS, its nine scripts, and two data files
  const studioShim = read('tools/browser/studio-shim.js');
  const studioHtml = transformStudioHtml(read('DLA_Studio.html'), { guardJs, shimJs: studioShim });
  assertNoGoogleScriptRefs(studioHtml);
  let studioBytes = write('studio.html', studioHtml);
  studioBytes += write('css/studio.css', read('css/studio.css'));
  for (const name of STUDIO_JS) {
    const src = read(`js/${name}`);
    const out = neutraliseHosts(name.startsWith('00-') ? transformStudioJs00(src) : src);
    assertNoGoogleScriptRefs(out, `js/${name}`);
    studioBytes += write(`js/${name}`, out);
  }
  const studioUnits = prepareStudioUnits(units);
  studioBytes += write('studio-data.json', JSON.stringify(studioUnits));
  studioBytes += write('studio-analytics.json', JSON.stringify(buildSampleAnalytics(approvedToolNames())));

  // 6. housekeeping
  write('.nojekyll', '');
  write('README.md', README);

  const total = htmlBytes + dataBytes + libBytes + lbBytes;
  const before = Buffer.byteLength(sourceData, 'utf8');
  console.log(`  index.html            ${htmlBytes.toLocaleString()} bytes`);
  console.log(`  data.json             ${dataBytes.toLocaleString()} bytes (from ${before.toLocaleString()}; ${kept.length} units kept of ${units.length}, Kinder dropped)`);
  console.log(`  libraries.json        ${libBytes.toLocaleString()} bytes`);
  console.log(`  demo-leaderboard.json ${lbBytes.toLocaleString()} bytes`);
  console.log(`  TOTAL first load      ${total.toLocaleString()} bytes  (public site)`);
  if (total > DATA_CAP) throw new Error(`total payload ${total} exceeds ${DATA_CAP}`);
  console.log(`  studio bundle         ${studioBytes.toLocaleString()} bytes (${studioUnits.length} units, all verified)`);
  console.log('Sandbox build OK');
}

main().catch(err => { console.error(`\nBUILD FAILED: ${err.message}\n`); process.exit(1); });
