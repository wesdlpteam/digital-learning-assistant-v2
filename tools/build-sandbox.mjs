#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimUnits } from './lib/slim-data.mjs';
import { transformHtml } from './lib/transform-html.mjs';
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
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, rel), contents, 'utf8');
  return Buffer.byteLength(contents, 'utf8');
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
  const slim = JSON.stringify(slimUnits(units));
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

  // 5. housekeeping
  write('.nojekyll', '');
  write('README.md', README);

  const total = htmlBytes + dataBytes + libBytes + lbBytes;
  const before = Buffer.byteLength(sourceData, 'utf8');
  console.log(`  index.html            ${htmlBytes.toLocaleString()} bytes`);
  console.log(`  data.json             ${dataBytes.toLocaleString()} bytes (from ${before.toLocaleString()}, ${units.length} units)`);
  console.log(`  libraries.json        ${libBytes.toLocaleString()} bytes`);
  console.log(`  demo-leaderboard.json ${lbBytes.toLocaleString()} bytes`);
  console.log(`  TOTAL first load      ${total.toLocaleString()} bytes`);
  if (total > DATA_CAP) throw new Error(`total payload ${total} exceeds ${DATA_CAP}`);
  console.log('Sandbox build OK');
}

main().catch(err => { console.error(`\nBUILD FAILED: ${err.message}\n`); process.exit(1); });
