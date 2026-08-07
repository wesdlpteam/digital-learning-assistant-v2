import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UNIT = {
  ca: 'Glen Waverley',
  yl: 'Year 3',
  th: 'How We Organise Ourselves',
  ci: 'Communities organise themselves to meet shared needs.',
  s: [
    { t: 'Book Creator', d: 'A ready-made idea using Book Creator.' },
    { t: 'Padlet', d: 'A ready-made idea using Padlet.' }
  ]
};
const UNIT_KEY = 'Glen Waverley|Year 3|How We Organise Ourselves';

const EXTRAS = {
  _meta: { perUnit: 5 },
  [UNIT_KEY]: [
    { t: 'Canva', d: 'Students design a poster about how their community organises itself.' },
    { t: 'Kahoot', d: 'Students build a quiz about the jobs that keep a community running.' },
    { t: 'Seesaw', d: 'Students record a short walk-through of a community service they rely on.' },
    { t: 'Epic', d: 'Students read and respond to books about how towns are organised.' },
    { t: 'Microsoft Forms', d: 'Students survey classmates about which shared services matter most.' }
  ]
};

// Mirrors the generated page: match-tool.js is concatenated ahead of the shim,
// and both run as classic scripts whose top-level names share one global scope.
function bootPage({ extras = EXTRAS, unit = UNIT } = {}) {
  const fetched = [];
  const head = { appendChild() {} };
  const modalBody = { innerHTML: '', querySelector: () => null };
  const context = {
    console,
    fetch(url) {
      fetched.push(String(url));
      if (String(url).indexOf('sandbox-extra-ideas.json') !== -1) {
        return Promise.resolve({ ok: !!extras, json: () => Promise.resolve(extras || {}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    },
    // Run timers inline; the tests await real ticks to let the chain settle.
    setTimeout: fn => { fn(); return 0; },
    document: {
      readyState: 'complete',
      head,
      body: { appendChild() {} },
      createElement: () => ({ set textContent(v) { this._t = v; }, get textContent() { return this._t; } }),
      getElementById: id => (id === 'techModalBody' ? modalBody : null),
      addEventListener() {}
    },
    // Page globals the shim reads by bare name.
    S: { ca: 'GW', yl: 'Year 3', ui: 0 },
    gu: () => [unit],
    TC: { 'How We Organise Ourselves': '#38BDF8' },
    TE: { 'How We Organise Ourselves': '⚙️' },
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    linkifyDesc: s => String(s == null ? '' : s),
    renderTechResult() {},
    openTechPicker() {},
    closeTech() {}
  };
  context.window = context;
  vm.createContext(context);
  for (const rel of ['tools/browser/match-tool.js', 'tools/browser/sandbox-shim.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), context, { filename: rel });
  }
  return { context, modalBody, fetched };
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

test('a tool with no ready-made idea shows the pre-written ideas for that unit', async () => {
  const { context, modalBody } = bootPage();
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  await settle();
  for (const idea of EXTRAS[UNIT_KEY]) {
    assert.ok(modalBody.innerHTML.includes(idea.t), `missing tool ${idea.t}`);
    assert.ok(modalBody.innerHTML.includes(idea.d), `missing description for ${idea.t}`);
  }
});

test('the dead-end wording names the tapped tool and stays honest about the demo', async () => {
  const { context, modalBody } = bootPage();
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  await settle();
  assert.ok(modalBody.innerHTML.includes('Tinkercad'));
  assert.ok(/5 other ideas for this unit/.test(modalBody.innerHTML));
  assert.ok(/written ahead of time/.test(modalBody.innerHTML));
});

test('it never claims to have generated anything on the day', async () => {
  const { context, modalBody } = bootPage();
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  await settle();
  assert.equal(/Fresh suggestion/.test(modalBody.innerHTML), false);
});

test('the extras file is not fetched until a tool actually dead-ends', async () => {
  const { context, fetched } = bootPage();
  assert.equal(fetched.some(u => u.includes('sandbox-extra-ideas.json')), false);
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  await settle();
  assert.equal(fetched.filter(u => u.includes('sandbox-extra-ideas.json')).length, 1);
});

test('the extras file is fetched once, not once per dead-end', async () => {
  const { context, fetched } = bootPage();
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  await settle();
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Sketchbook');
  await settle();
  assert.equal(fetched.filter(u => u.includes('sandbox-extra-ideas.json')).length, 1);
});

test('a unit with no pre-written batch falls back to naming its own ready-made ideas', async () => {
  const { context, modalBody } = bootPage({ extras: { _meta: {} } });
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  await settle();
  assert.ok(modalBody.innerHTML.includes('Ready-made ideas for this unit'));
  assert.ok(modalBody.innerHTML.includes('Book Creator'));
});

test('a missing extras file degrades instead of breaking the picker', async () => {
  const { context, modalBody } = bootPage({ extras: null });
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  await settle();
  assert.ok(modalBody.innerHTML.includes('Ready-made ideas for this unit'));
});

test('a tool that DOES have a ready-made idea still shows just that one', async () => {
  const { context } = bootPage();
  const seen = [];
  context.renderTechResult = (ca, yl, th, tool, resp) => seen.push({ tool, resp });
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Padlet');
  await settle();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].resp.sandboxReadyMade, true);
  assert.equal(seen[0].resp.description, 'A ready-made idea using Padlet.');
  assert.equal(seen[0].resp.sandboxExtras, undefined);
});

test('the lookup key matches the unit fields the generator writes', async () => {
  const built = [UNIT.ca, UNIT.yl, UNIT.th].join('|');
  assert.equal(built, UNIT_KEY);
  const { context, modalBody } = bootPage({ unit: { ...UNIT, th: 'A Unit Nobody Generated' } });
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'A Unit Nobody Generated', 'Tinkercad');
  await settle();
  assert.ok(modalBody.innerHTML.includes('Ready-made ideas for this unit'));
});

test('every generated batch is well formed and free of placeholder text', () => {
  const cachePath = path.join(ROOT, 'sandbox-extra-ideas.json');
  if (!fs.existsSync(cachePath)) return; // not generated yet on a fresh clone
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  for (const [key, ideas] of Object.entries(cache)) {
    if (key === '_meta') continue;
    assert.equal(key.split('|').length, 3, `key ${key} is not campus|year|unit`);
    assert.ok(Array.isArray(ideas) && ideas.length, `${key} has no ideas`);
    const tools = new Set();
    for (const idea of ideas) {
      assert.ok(idea.t && idea.d, `${key} has an idea missing its tool or description`);
      assert.ok(idea.d.split(/\s+/).length >= 40, `${key} / ${idea.t}: description too thin`);
      assert.equal(/^for a twist/i.test(idea.d), false, `${key} / ${idea.t}: banned "For a twist" opener`);
      assert.equal(tools.has(idea.t), false, `${key} repeats the tool ${idea.t}`);
      tools.add(idea.t);
    }
  }
});
