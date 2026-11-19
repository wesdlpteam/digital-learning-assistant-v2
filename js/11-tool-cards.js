/* Tool feature cards: what each approved tool can really do.
   Lives in the Tool Inventory screen (#tc-root). Backend actions: toolCardsList, toolCardsSave, toolCardsDraft.
   Plain global script, loaded after js/10. js/05 and js/08 call into it guarded by typeof. */

var TOOL_CARDS_STATE = { loaded: false, loading: false, configured: false, cards: [], error: '' };
// UI state: which tool is selected, the unsaved working copy, and whether a save or draft is running.
var TOOL_CARDS_UI = { selected: '', work: null, dirty: false, busy: '' };

const TC_AGE_BANDS = ['Prep-2', '3-4', '5-6', 'all primary'];
// What each stored band means: the youngest year the feature suits.
const TC_AGE_LABELS = { 'Prep-2': 'Prep and up', '3-4': 'Year 3 and up', '5-6': 'Year 5 and up', 'all primary': 'All years' };
const TC_ACCESS_OPTIONS = [
  { v: 'true', label: 'Students can use it' },
  { v: 'teacher only', label: 'Teacher only' },
  { v: 'unverified', label: 'Not checked yet (teacher-led)' },
  { v: 'false', label: 'Not for students' }
];
const TC_KEY_ALIASES = {
  promptsmartliteteleprompter: 'promptsmart',
  stellariummobile: 'stellarium',
  scaniverse3dscanner: 'scaniverse'
};

function toolCardClientKey_(name) {
  const k = String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, '');
  return TC_KEY_ALIASES[k] || k;
}

function getToolCard_(name) {
  const key = toolCardClientKey_(name);
  if (!key) return null;
  const cards = (TOOL_CARDS_STATE && TOOL_CARDS_STATE.cards) || [];
  for (let i = 0; i < cards.length; i++) {
    if (cards[i] && toolCardClientKey_(cards[i].tool) === key) return cards[i];
  }
  return null;
}

function toolCardStatusFor_(name) {
  const card = getToolCard_(name);
  if (!card) return 'missing';
  return card.status === 'checked' ? 'checked' : 'draft';
}

function tcEsc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function tcApproved_() {
  const list = (typeof TOOL_INVENTORY !== 'undefined' && TOOL_INVENTORY && Array.isArray(TOOL_INVENTORY.approved)) ? TOOL_INVENTORY.approved.slice() : [];
  return list.sort(function (a, b) { return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }); });
}

function tcStatusLabel_(st) {
  return st === 'checked' ? 'Checked' : st === 'draft' ? 'Draft, needs checking' : 'Needs feature card';
}

function tcCall_(payload) {
  const out = withGASToken(payload);
  if (out.googleAccessToken) delete out.token;
  return fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(out)
  }).then(function (r) { return r.json(); }).then(function (result) {
    if (result && result.error) throw new Error(result.error);
    return result || {};
  });
}

function tcClone_(o) { return JSON.parse(JSON.stringify(o)); }

function tcStoreCard_(card) {
  if (!card) return;
  const key = toolCardClientKey_(card.tool);
  const cards = TOOL_CARDS_STATE.cards || [];
  const i = cards.findIndex(function (c) { return toolCardClientKey_(c.tool) === key; });
  if (i >= 0) cards[i] = card; else cards.push(card);
  TOOL_CARDS_STATE.cards = cards;
}

function tcRefreshAll_() {
  renderToolCards_();
  if (typeof renderToolInventory === 'function') { try { renderToolInventory(); } catch (e) { /* ignore */ } }
}

function loadToolCards_(force) {
  if (TOOL_CARDS_STATE.loading) return Promise.resolve();
  if (TOOL_CARDS_STATE.loaded && !force) return Promise.resolve();
  TOOL_CARDS_STATE.loading = true;
  TOOL_CARDS_STATE.error = '';
  renderToolCards_();
  return tcCall_({ action: 'toolCardsList' }).then(function (r) {
    TOOL_CARDS_STATE.configured = !!r.configured;
    TOOL_CARDS_STATE.cards = Array.isArray(r.cards) ? r.cards : [];
    TOOL_CARDS_STATE.loaded = true;
  }).catch(function (e) {
    TOOL_CARDS_STATE.error = (e && e.message) || 'Could not load feature cards.';
  }).then(function () {
    TOOL_CARDS_STATE.loading = false;
    tcRefreshAll_();
  });
}

function tcSelect_(name, scroll) {
  // Wait for a save or draft to come back before switching tools.
  if (TOOL_CARDS_UI.busy) return false;
  if (TOOL_CARDS_UI.dirty && TOOL_CARDS_UI.selected && toolCardClientKey_(TOOL_CARDS_UI.selected) !== toolCardClientKey_(name)) {
    if (!confirm('Discard your changes to ' + TOOL_CARDS_UI.selected + '?')) return false;
  }
  TOOL_CARDS_UI.selected = name;
  TOOL_CARDS_UI.dirty = false;
  const card = getToolCard_(name);
  TOOL_CARDS_UI.work = card ? tcClone_(card) : null;
  renderToolCards_();
  if (scroll) {
    // The Bulk page folds its boxes away (js/08 setupBulkCollapsibleSections); open ours first.
    const box = document.getElementById('tc-card');
    if (box && box.classList.contains('bulk-collapsible-card') && !box.classList.contains('bulk-card-open')) {
      const head = box.querySelector(':scope > .bulk-card-header');
      if (head) head.click();
    }
    const root = document.getElementById('tc-root');
    // Jump, not smooth: a smooth scroll is cut short when the box above re-renders.
    if (root && root.scrollIntoView) root.scrollIntoView({ block: 'start' });
  }
  return true;
}

async function draftToolCardForTool_(name) {
  try {
    if (TOOL_CARDS_UI.busy) return;
    TOOL_CARDS_UI.busy = 'draft';
    TOOL_CARDS_UI.busyTool = name;
    renderToolCards_();
    const r = await tcCall_({ action: 'toolCardsDraft', tool: name });
    if (r.card) tcStoreCard_(r.card);
    TOOL_CARDS_STATE.loaded = true;
    TOOL_CARDS_UI.busy = '';
    // Never throw away unsaved edits on another card: just store the draft.
    if (!TOOL_CARDS_UI.dirty) {
      TOOL_CARDS_UI.selected = name;
      TOOL_CARDS_UI.work = r.card ? tcClone_(r.card) : null;
    }
    tcRefreshAll_();
    if (typeof setStatus === 'function') setStatus('Drafted a feature card for ' + name + '. Check it before the idea writers use it.');
  } catch (e) {
    TOOL_CARDS_UI.busy = '';
    renderToolCards_();
    if (typeof setStatus === 'function') setStatus((e && e.message) || 'Could not draft the feature card.', 'error');
  }
}

// Cleans the working copy into the shape the backend stores.
function tcBuildCard_(work, status) {
  const feats = [];
  (work.features || []).forEach(function (f) {
    const name = String(f.name || '').trim();
    const does = String(f.does || '').trim();
    if (!name || !does) return;
    const out = { name: name, does: does, ages: f.ages || 'all primary', studentAllowed: f.studentAllowed, source: String(f.source || '').trim() };
    const hint = String(f.transformHint || '').trim();
    if (hint) out.transformHint = hint;
    if (f.off) out.off = true;
    feats.push(out);
  });
  const card = {
    tool: work.tool,
    what: String(work.what || '').trim(),
    features: feats,
    restrictions: (work.restrictions || []).map(function (s) { return String(s).trim(); }).filter(Boolean),
    lastChecked: work.lastChecked || '',
    status: status
  };
  if (status === 'checked') card.lastChecked = new Date().toISOString().slice(0, 10);
  return card;
}

async function tcSave_(status) {
  const work = TOOL_CARDS_UI.work;
  if (!work || TOOL_CARDS_UI.busy) return;
  try {
    TOOL_CARDS_UI.busy = 'save';
    renderToolCards_();
    const r = await tcCall_({ action: 'toolCardsSave', card: tcBuildCard_(work, status) });
    if (r.card) tcStoreCard_(r.card);
    TOOL_CARDS_UI.busy = '';
    TOOL_CARDS_UI.dirty = false;
    TOOL_CARDS_UI.work = r.card ? tcClone_(r.card) : null;
    tcRefreshAll_();
    if (typeof setStatus === 'function') setStatus('Saved the feature card for ' + work.tool + '.');
  } catch (e) {
    TOOL_CARDS_UI.busy = '';
    renderToolCards_();
    if (typeof setStatus === 'function') setStatus((e && e.message) || 'Could not save the feature card.', 'error');
  }
}

function tcAccessValue_(v) { return v === true ? 'true' : v === false ? 'false' : (v === 'teacher only' ? 'teacher only' : 'unverified'); }
function tcAccessParse_(s) { return s === 'true' ? true : s === 'false' ? false : s; }

function tcFeatureHtml_(f, i) {
  const ages = TC_AGE_BANDS.map(function (a) { return '<option value="' + a + '"' + (f.ages === a ? ' selected' : '') + '>' + (TC_AGE_LABELS[a] || a) + '</option>'; }).join('');
  const acc = TC_ACCESS_OPTIONS.map(function (o) { return '<option value="' + o.v + '"' + (tcAccessValue_(f.studentAllowed) === o.v ? ' selected' : '') + '>' + o.label + '</option>'; }).join('');
  const src = String(f.source || '');
  const open = /^https:\/\//i.test(src) ? '<a class="tc-open" href="' + tcEsc_(src) + '" target="_blank" rel="noopener">Open</a>' : '';
  return '<div class="tc-feat' + (f.off ? ' tc-off' : '') + '" data-tc-i="' + i + '">' +
    '<div class="tc-feat-top">' +
      '<label class="tc-use"><input type="checkbox" data-tc-f="use"' + (f.off ? '' : ' checked') + '>Use</label>' +
      '<input class="inp tc-name" data-tc-f="name" aria-label="Feature name" placeholder="Feature name" value="' + tcEsc_(f.name) + '">' +
      '<button type="button" class="btn-sm tc-del" data-tc-del="' + i + '" aria-label="Remove this feature">Remove</button>' +
    '</div>' +
    '<label class="tc-fld"><span class="tc-lbl">What students can do</span><textarea class="inp" rows="2" data-tc-f="does">' + tcEsc_(f.does) + '</textarea></label>' +
    '<div class="tc-feat-grid">' +
      '<label class="tc-fld"><span class="tc-lbl">From</span><select class="inp" data-tc-f="ages">' + ages + '</select></label>' +
      '<label class="tc-fld"><span class="tc-lbl">Student access</span><select class="inp" data-tc-f="access">' + acc + '</select></label>' +
      '<label class="tc-fld"><span class="tc-lbl">RAT transform hint (optional)</span><input class="inp" data-tc-f="transformHint" value="' + tcEsc_(f.transformHint || '') + '"></label>' +
      '<label class="tc-fld"><span class="tc-lbl">Source ' + open + '</span><input class="inp" data-tc-f="source" placeholder="https://..., internal, or blank" value="' + tcEsc_(src) + '"></label>' +
    '</div>' +
  '</div>';
}

function tcDetailHtml_() {
  const name = TOOL_CARDS_UI.selected;
  if (!name) return '<p class="tc-empty">Pick a tool on the left to see or write its feature card.</p>';
  const work = TOOL_CARDS_UI.work;
  const busy = TOOL_CARDS_UI.busy;
  if (!work) {
    const drafting = busy === 'draft';
    return '<h3 class="tc-h">' + tcEsc_(name) + '</h3>' +
      '<p class="tc-note">This tool has no feature card yet, so the idea writers will not suggest it.</p>' +
      '<button type="button" class="btn-pri" data-tc-act="draft"' + (busy ? ' disabled' : '') + '>' + (drafting ? 'Drafting...' : 'Draft a card with AI') + '</button>';
  }
  const st = work.status === 'checked' ? 'checked' : 'draft';
  const saving = busy === 'save';
  const dis = busy ? ' disabled' : '';
  const feats = (work.features || []).map(tcFeatureHtml_).join('') || '<p class="tc-empty">No features yet.</p>';
  return '<div class="tc-head"><h3 class="tc-h">' + tcEsc_(work.tool || name) + '</h3>' +
      '<span class="tc-st tc-' + st + '">' + tcStatusLabel_(st) + '</span>' +
      (work.lastChecked ? '<span class="tc-when">Last checked ' + tcEsc_(work.lastChecked) + '</span>' : '') + '</div>' +
    (st === 'draft' ? '<p class="tc-note tc-note-draft">Drafted by AI without web access. Check each feature against the maker\'s own pages before marking it checked.</p>' : '') +
    '<label class="tc-fld"><span class="tc-lbl">What it is</span><input class="inp" data-tc-f="what" value="' + tcEsc_(work.what || '') + '"></label>' +
    '<span class="tc-lbl tc-lbl-gap">Features</span>' +
    '<div class="tc-feats">' + feats + '</div>' +
    '<button type="button" class="btn-sm" data-tc-act="add">Add a feature</button>' +
    '<label class="tc-fld tc-lbl-gap"><span class="tc-lbl">Limits (one per line)</span><textarea class="inp" rows="3" data-tc-f="restrictions">' + tcEsc_((work.restrictions || []).join('\n')) + '</textarea></label>' +
    '<div class="tc-actions">' +
      '<button type="button" class="btn-pri" data-tc-act="save-checked"' + dis + '>' + (saving ? 'Saving...' : 'Save and mark as checked') + '</button>' +
      (st === 'draft' ? '<button type="button" class="btn-sm" data-tc-act="save-draft"' + dis + '>Save as draft</button>' : '') +
    '</div>';
}

function renderToolCards_() {
  const root = document.getElementById('tc-root');
  if (!root) return;
  const S = TOOL_CARDS_STATE;
  if (S.loading && !S.loaded) { root.innerHTML = '<p class="tc-empty">Loading feature cards...</p>'; return; }
  if (S.error && !S.loaded) {
    root.innerHTML = '<p class="tc-empty">' + tcEsc_(S.error) + '</p><button type="button" class="btn-sm" data-tc-act="retry">Try again</button>';
    return;
  }
  if (!S.loaded) { root.innerHTML = '<p class="tc-empty">Feature cards load once you are signed in.</p>'; return; }
  if (!S.configured) { root.innerHTML = '<p class="tc-empty">The card store has not been set up yet.</p>'; return; }
  const tools = tcApproved_();
  let nChecked = 0, nDraft = 0, nMissing = 0;
  const items = tools.map(function (t) {
    const st = toolCardStatusFor_(t);
    if (st === 'checked') nChecked++; else if (st === 'draft') nDraft++; else nMissing++;
    const sel = toolCardClientKey_(t) === toolCardClientKey_(TOOL_CARDS_UI.selected);
    return '<button type="button" class="tc-item' + (sel ? ' tc-sel' : '') + '" data-tc-tool="' + tcEsc_(t) + '"' + (sel ? ' aria-current="true"' : '') + '>' +
      '<span class="tc-item-name">' + tcEsc_(t) + '</span><span class="tc-st tc-' + st + '">' + tcStatusLabel_(st) + '</span></button>';
  }).join('');
  const summary = nChecked + ' checked, ' + nDraft + (nDraft === 1 ? ' draft' : ' drafts') + ', ' + nMissing + (nMissing === 1 ? ' needs a card' : ' need a card');
  const countEl = document.getElementById('tc-count');
  if (countEl) countEl.textContent = nMissing + nDraft ? (nMissing + nDraft) + ' to check' : 'all checked';
  root.innerHTML = '<p class="tc-summary">' + summary + '</p>' +
    '<div class="tc-layout"><div class="tc-list" role="list">' + (items || '<p class="tc-empty">No approved tools yet.</p>') + '</div>' +
    '<div class="tc-detail">' + tcDetailHtml_() + '</div></div>';
}

function tcFeatureEdit_(el) {
  const work = TOOL_CARDS_UI.work;
  if (!work) return;
  const field = el.getAttribute('data-tc-f');
  if (!field) return;
  if (field === 'what') { work.what = el.value; TOOL_CARDS_UI.dirty = true; return; }
  if (field === 'restrictions') { work.restrictions = el.value.split('\n'); TOOL_CARDS_UI.dirty = true; return; }
  const row = el.closest('[data-tc-i]');
  if (!row) return;
  const f = (work.features || [])[Number(row.getAttribute('data-tc-i'))];
  if (!f) return;
  if (field === 'use') { f.off = !el.checked; row.classList.toggle('tc-off', f.off); }
  else if (field === 'access') f.studentAllowed = tcAccessParse_(el.value);
  else f[field] = el.value;
  TOOL_CARDS_UI.dirty = true;
}

(function installToolCardEvents_() {
  if (window.__DLA_TOOL_CARDS_EVENTS) return;
  window.__DLA_TOOL_CARDS_EVENTS = true;
  document.addEventListener('click', function (e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const chip = t.closest('[data-inv-card]');
    if (chip) { e.preventDefault(); tcSelect_(chip.getAttribute('data-inv-card'), true); return; }
    const root = document.getElementById('tc-root');
    if (!root || !root.contains(t)) return;
    const item = t.closest('[data-tc-tool]');
    if (item) { tcSelect_(item.getAttribute('data-tc-tool'), false); return; }
    const del = t.closest('[data-tc-del]');
    if (del) {
      if (TOOL_CARDS_UI.work) { TOOL_CARDS_UI.work.features.splice(Number(del.getAttribute('data-tc-del')), 1); TOOL_CARDS_UI.dirty = true; renderToolCards_(); }
      return;
    }
    const act = t.closest('[data-tc-act]');
    if (!act) return;
    const a = act.getAttribute('data-tc-act');
    if (a === 'draft') draftToolCardForTool_(TOOL_CARDS_UI.selected);
    else if (a === 'retry') loadToolCards_(true);
    else if (a === 'save-checked') tcSave_('checked');
    else if (a === 'save-draft') tcSave_('draft');
    else if (a === 'add' && TOOL_CARDS_UI.work) {
      TOOL_CARDS_UI.work.features = TOOL_CARDS_UI.work.features || [];
      TOOL_CARDS_UI.work.features.push({ name: '', does: '', ages: 'all primary', studentAllowed: 'unverified', source: '' });
      TOOL_CARDS_UI.dirty = true;
      renderToolCards_();
    }
  });
  document.addEventListener('input', function (e) {
    const root = document.getElementById('tc-root');
    if (root && e.target && root.contains(e.target)) tcFeatureEdit_(e.target);
  });
  document.addEventListener('change', function (e) {
    const root = document.getElementById('tc-root');
    if (root && e.target && root.contains(e.target)) tcFeatureEdit_(e.target);
  });
})();

setTimeout(function () { try { renderToolCards_(); } catch (e) { /* ignore */ } }, 0);
