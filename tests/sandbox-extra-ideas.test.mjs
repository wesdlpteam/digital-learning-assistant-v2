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

// Enough of a DOM for the picker: a grid of tool tiles inside a parent the
// shim can slot its explanatory note into.
function makeTile(tool) {
  return {
    className: '', title: '', parentNode: null,
    classList: { _set: new Set(), add(c) { this._set.add(c); }, contains(c) { return this._set.has(c); } },
    getAttribute(name) { return name === 'data-tool' ? tool : null; }
  };
}

function makeGrid(tools) {
  const grid = {
    id: 'techGrid',
    children: tools.map(makeTile),
    get firstChild() { return this.children[0] || null; },
    // Real querySelectorAll returns a static list, so snapshot it here too.
    querySelectorAll(sel) { return sel === '.tech-tile' ? this.children.slice() : []; },
    removeChild(node) {
      const at = this.children.indexOf(node);
      if (at !== -1) this.children.splice(at, 1);
      return node;
    },
    insertBefore(node, ref) {
      const at = this.children.indexOf(node);
      if (at !== -1) this.children.splice(at, 1);
      const to = ref ? this.children.indexOf(ref) : -1;
      this.children.splice(to === -1 ? this.children.length : to, 0, node);
      node.parentNode = this;
      return node;
    },
    tools() { return this.children.map(c => c.getAttribute('data-tool')); }
  };
  grid.children.forEach(tile => { tile.parentNode = grid; });
  grid.parentNode = {
    kids: [grid],
    querySelector(sel) { return this.kids.find(k => ('.' + k.className) === sel) || null; },
    insertBefore(node, ref) {
      const to = this.kids.indexOf(ref);
      this.kids.splice(to === -1 ? this.kids.length : to, 0, node);
      return node;
    }
  };
  return grid;
}

// Mirrors the generated page: match-tool.js is concatenated ahead of the shim,
// and both run as classic scripts whose top-level names share one global scope.
function bootPage({ extras = EXTRAS, unit = UNIT, gridTools = null, basePath = '' } = {}) {
  const fetched = [];
  const head = { appendChild() {} };
  const modalBody = { innerHTML: '', querySelector: () => null };
  const grid = gridTools ? makeGrid(gridTools) : null;
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
      createElement: () => ({ className: '', innerHTML: '', textContent: '' }),
      getElementById: id => {
        if (id === 'techModalBody') return modalBody;
        if (id === 'techGrid') return grid;
        return null;
      },
      addEventListener() {}
    },
    // Page globals the shim reads by bare name.
    _basePath: basePath,
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
  return { context, modalBody, fetched, grid };
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

const GRID_TOOLS = ['Book Creator', 'Canva', 'Epic', 'Kahoot', 'Microsoft Forms', 'Padlet', 'Scratch', 'Seesaw', 'Tinkercad'];

test('the picker drops the tools this unit already uses', async () => {
  const { context, grid } = bootPage({ gridTools: GRID_TOOLS });
  context.openTechPicker();
  await settle();
  assert.equal(grid.tools().includes('Book Creator'), false);
  assert.equal(grid.tools().includes('Padlet'), false);
  assert.equal(grid.tools().includes('Tinkercad'), true);
});

test('the picker explains why the list is shorter', async () => {
  const { context, grid } = bootPage({ gridTools: GRID_TOOLS });
  context.openTechPicker();
  await settle();
  const note = grid.parentNode.querySelector('.sandbox-picker-note');
  assert.ok(note, 'no note was inserted');
  assert.ok(/already uses are left out/.test(note.innerHTML));
});

test('the picker ticks and floats the tools with an idea ready', async () => {
  const { context, grid } = bootPage({ gridTools: GRID_TOOLS });
  context.openTechPicker();
  await settle();
  const readyTools = EXTRAS[UNIT_KEY].map(i => i.t);
  const top = grid.tools().slice(0, readyTools.length);
  assert.deepEqual(top.slice().sort(), readyTools.slice().sort());
  for (const tile of grid.children.slice(0, readyTools.length)) {
    assert.ok(tile.classList.contains('sandbox-ready'), `${tile.getAttribute('data-tool')} not ticked`);
  }
});

test('a unit with no ideas of its own keeps the full tool list', async () => {
  const { context, grid } = bootPage({ unit: { ...UNIT, s: [] }, gridTools: GRID_TOOLS });
  context.openTechPicker();
  await settle();
  assert.equal(grid.children.length, GRID_TOOLS.length);
  assert.equal(grid.parentNode.querySelector('.sandbox-picker-note'), null);
});

test('the extras file is fetched when the picker opens, not at page load', async () => {
  const { context, fetched } = bootPage({ gridTools: GRID_TOOLS });
  assert.equal(fetched.some(u => u.includes('sandbox-extra-ideas.json')), false);
  context.openTechPicker();
  await settle();
  assert.equal(fetched.filter(u => u.includes('sandbox-extra-ideas.json')).length, 1);
});

// The app rewrites the address bar to /GW/Year3/HWOO as you browse, so a bare
// 'sandbox-extra-ideas.json' would resolve to /GW/Year3/sandbox-extra-ideas.json
// and 404. Both demo files must hang off the site root instead.
test('demo files are fetched from the site root, not the unit path', async () => {
  const { context, fetched } = bootPage({ basePath: '/dla-sandbox' });
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  context.fetchLeaderboard();
  await settle();
  assert.ok(fetched.includes('/dla-sandbox/sandbox-extra-ideas.json'), fetched.join(' | '));
  assert.ok(fetched.includes('/dla-sandbox/demo-leaderboard.json'), fetched.join(' | '));
});

test('a site served from the root still gets a plain absolute path', async () => {
  const { context, fetched } = bootPage();
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Tinkercad');
  await settle();
  assert.ok(fetched.includes('/sandbox-extra-ideas.json'), fetched.join(' | '));
});

test('picking a tool that has an idea ready leads with that idea', async () => {
  const { context, modalBody } = bootPage();
  context.fetchTechSuggestion('Glen Waverley', 'Year 3', 'How We Organise Ourselves', 'Canva');
  await settle();
  assert.ok(/The tool you picked/.test(modalBody.innerHTML));
  assert.ok(/Here is an idea using <strong>Canva<\/strong>/.test(modalBody.innerHTML));
  assert.ok(modalBody.innerHTML.includes(EXTRAS[UNIT_KEY][0].d), 'the Canva idea is missing');
  assert.ok(/4 more ideas for/.test(modalBody.innerHTML));
  // still five in total, the picked one plus the other four
  for (const idea of EXTRAS[UNIT_KEY]) assert.ok(modalBody.innerHTML.includes(idea.d), `missing ${idea.t}`);
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
