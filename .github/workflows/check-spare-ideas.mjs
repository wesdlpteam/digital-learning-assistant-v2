// Reports how many of the sandbox's spare tool ideas have gone stale.
//
// The "Have a tech tool in mind?" picker falls back to these when a presenter
// taps a tool the unit has no ready-made idea for, and they are chosen to avoid
// the tools the unit already shows. Regenerating the units changes those tools,
// so the cache drifts: it reached 22% after the August regeneration.
//
// This only REPORTS. Refreshing costs real AI calls and takes about 16 minutes,
// so it stays a deliberate decision rather than something a nightly job spends
// money on by itself.
import fs from 'node:fs';

const units = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const cache = JSON.parse(fs.readFileSync('sandbox-extra-ideas.json', 'utf8'));

const key = (u) => [u.ca, u.yl, u.th].join('|');
const live = new Map(units.map((u) => [key(u), u]));

let total = 0;
let clash = 0;
for (const [k, v] of Object.entries(cache)) {
  if (k === '_meta') continue;
  const unit = live.get(k);
  if (!unit) continue;
  const used = new Set((unit.s || []).map((s) => String(s?.t || '').trim().toLowerCase()));
  for (const idea of Array.isArray(v) ? v : v.ideas || []) {
    total++;
    if (used.has(String(idea?.t || '').trim().toLowerCase())) clash++;
  }
}

const pct = total ? Math.round((clash / total) * 100) : 0;
const lines = [
  '## Sandbox rebuilt',
  '',
  `Spare tool ideas that now duplicate a tool the unit already shows: **${clash} of ${total} (${pct}%)**`,
  '',
  pct >= 15
    ? '> Worth refreshing before the next event: `node tools/gen-sandbox-extra-ideas.mjs --force`'
    : '> Healthy. No refresh needed.'
];
console.log(lines.join('\n'));
