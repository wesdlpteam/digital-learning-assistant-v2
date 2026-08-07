#!/usr/bin/env node
// Generates the sandbox demo's EXTRA tech ideas — the ones the "Have a tech
// tool in mind?" picker falls back to when a presenter taps a tool the unit has
// no ready-made idea for.
//
// Why this exists: the sandbox makes no AI calls at runtime, and every unit
// ships with exactly the six ideas its own page already lists. Tapping anything
// else used to dead-end on "not one of the ready-made ideas". This script asks
// the live DLA backend (action=extraTechIdeas) for five more ideas per unit,
// each using a different approved tool the unit doesn't already use, and caches
// them in sandbox-extra-ideas.json for build-sandbox.mjs to bake in.
//
// Run it rarely — only when the unit corpus changes. The cache is committed, so
// a normal sandbox rebuild costs nothing.
//
//   node tools/gen-sandbox-extra-ideas.mjs                 # fill in what's missing
//   node tools/gen-sandbox-extra-ideas.mjs --limit 5       # try a handful first
//   node tools/gen-sandbox-extra-ideas.mjs --force         # regenerate everything
//
// Auth reuses the clasp login in ~/.clasprc.json, so there is no key to handle
// here: the refresh token mints a Google access token, the backend verifies the
// account against DLA_ALLOWED_EMAILS, and the OpenAI key never leaves Apps
// Script. The action sits outside the public suggestTech daily cap, so running
// this cannot lock teachers out of the live picker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropExcludedYearLevels } from './lib/slim-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzIoUL_vbTaH4P7PXuX8HeU9Xh6HuiEWJ05k7q50aJjCg7oeF-ELrlLuPx8uxPFHmE-eA/exec';
const CACHE_PATH = path.join(ROOT, 'sandbox-extra-ideas.json');
const PER_UNIT = 5;

function arg(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}
const FORCE = process.argv.includes('--force');
const LIMIT = Number(arg('--limit', '0')) || 0;
const CONCURRENCY = Math.max(1, Math.min(6, Number(arg('--concurrency', '3')) || 3));

export function unitKey(unit) {
  return [unit.ca, unit.yl, unit.th].join('|');
}

async function mintAccessToken() {
  const rcPath = path.join(os.homedir(), '.clasprc.json');
  if (!fs.existsSync(rcPath)) {
    throw new Error('No clasp login found at ~/.clasprc.json — run `clasp login` first');
  }
  const creds = JSON.parse(fs.readFileSync(rcPath, 'utf8')).tokens?.default;
  if (!creds?.refresh_token) throw new Error('~/.clasprc.json has no refresh token — run `clasp login` again');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Could not refresh the clasp token: ${JSON.stringify(json).slice(0, 200)}`);
  return json.access_token;
}

async function requestIdeas(token, unit) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'extraTechIdeas',
      googleAccessToken: token,
      ca: unit.ca,
      yl: unit.yl,
      th: unit.th,
      ci: unit.ci || '',
      lo: unit.lo || '',
      exclude: (unit.s || []).map(s => s && s.t).filter(Boolean),
      count: PER_UNIT
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Backend returned non-JSON: ${text.slice(0, 160)}`); }
  if (parsed.error) throw new Error(parsed.error);
  const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.filter(i => i && i.t && i.d) : [];
  if (!ideas.length) throw new Error('Backend returned no usable ideas');
  return ideas;
}

// Written after EVERY unit, not at the end: a long run that dies partway (laptop
// sleeps, token expires, network drops) must lose nothing, and a re-run picks up
// exactly where it stopped.
function saveCache(cache) {
  const tmp = `${CACHE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 1), 'utf8');
  fs.renameSync(tmp, CACHE_PATH);
}

async function main() {
  const units = dropExcludedYearLevels(JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')));
  const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : { _meta: {} };

  let todo = units.filter(u => (u.s || []).length);
  if (!FORCE) todo = todo.filter(u => !(cache[unitKey(u)] || []).length);
  if (LIMIT) todo = todo.slice(0, LIMIT);

  const skipped = units.filter(u => !(u.s || []).length).length;
  console.log(`${units.length} demo units (${skipped} skipped: no ready-made ideas of their own)`);
  console.log(`${todo.length} to generate, ${CONCURRENCY} at a time, ~${Math.ceil(todo.length * 25 / CONCURRENCY / 60)} min`);
  if (!todo.length) { console.log('Nothing to do.'); return; }

  const token = await mintAccessToken();
  const started = Date.now();
  let done = 0;
  const failures = [];

  const queue = todo.slice();
  async function worker() {
    for (;;) {
      const unit = queue.shift();
      if (!unit) return;
      const label = `${unit.ca} / ${unit.yl} / ${unit.th}`;
      try {
        const ideas = await requestIdeas(token, unit);
        cache[unitKey(unit)] = ideas;
        saveCache(cache);
        done++;
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`  [${done}/${todo.length}] ${ideas.length} ideas — ${label}  (${mins} min)`);
        if (ideas.length < PER_UNIT) console.log(`      only ${ideas.length} of ${PER_UNIT} passed the checks`);
      } catch (err) {
        failures.push({ label, reason: err.message });
        console.log(`  [!] FAILED ${label}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  cache._meta = {
    generatedAt: new Date().toISOString(),
    perUnit: PER_UNIT,
    units: Object.keys(cache).filter(k => k !== '_meta').length
  };
  saveCache(cache);

  const bytes = fs.statSync(CACHE_PATH).size;
  console.log(`\n${cache._meta.units} units cached in sandbox-extra-ideas.json (${bytes.toLocaleString()} bytes)`);
  if (failures.length) {
    console.log(`${failures.length} failed — re-run to retry just those:`);
    for (const f of failures) console.log(`  ${f.label}: ${f.reason}`);
  }
}

// Importable for the tests; only runs the generator when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error(`\nGENERATION FAILED: ${err.message}\n`); process.exit(1); });
}
