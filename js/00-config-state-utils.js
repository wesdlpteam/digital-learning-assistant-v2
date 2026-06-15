let DATA = [];
// App version. BUMP THIS on every deploy, and keep it identical to the ?v=
// stamp on the <script src="js/..."> tags in DLA_Studio.html. Bumping the
// number changes every code file's web address, which forces browsers to
// download the new code instead of reusing a stale cached copy.
const APP_VERSION = '5.45';

// Reliable "get the latest version" action used by the ↻ latest button.
// Reloads the whole app from the network with a one-off unique address so the
// browser cannot reuse a cached page; the fresh page then pulls the
// version-stamped (and therefore fresh) code files.
function forceLatestVersion(){
  const base = location.href.split('#')[0].split('?')[0];
  location.replace(base + '?v=' + Date.now());
}

// Show the running code's version in the bottom-left + setup labels so the
// curator can tell at a glance whether they are on the latest version.
function stampVersionLabels(){
  try{
    const a = document.getElementById('dla-version-label');
    if(a) a.textContent = '● DLA Studio v' + APP_VERSION;
    const b = document.getElementById('setup-version-label');
    if(b) b.textContent = 'v' + APP_VERSION;
  }catch(e){}
}
if(typeof document !== 'undefined'){
  if(document.readyState !== 'loading') stampVersionLabels();
  else document.addEventListener('DOMContentLoaded', stampVersionLabels);
}

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzIoUL_vbTaH4P7PXuX8HeU9Xh6HuiEWJ05k7q50aJjCg7oeF-ELrlLuPx8uxPFHmE-eA/exec';
let DRIVE_TOKEN = null;
let CURRENT_USER_EMAIL = '';
let DRIVE_FILE_ID = null;
let CURRENT_ENTRY_IDX = null;
let PREV_TAB = 'dashboard';
let AUDIT_VIEW = 'tools';
let AUDIT_YEAR_CAMPUS = '';
const CHANGE_HISTORY = [];
const LOCKS = {}; 
const MAX_HISTORY = 20;

const CLIENT_ID = '334712966315-9diac0qcv57168kn378i5js2ikgqqvpt.apps.googleusercontent.com';
const ANALYTICS_SHEET_ID = '1R4P4FJlc8SyRFlVWoM0HpHmfCNMNVOpI8cuEILFxBNY';
const OPENAI_MODEL = 'gpt-4.1';            // main model (Bulk AI Edit, Fix All, regenerate, scoring)
const OPENAI_FAST_MODEL = 'gpt-4.1-mini';  // feedback & single-suggestion regen — faster & cheaper
const YR = ["3 Year Old Kinder","4 Year Old Kinder","Prep","Year 1","Year 2","Year 3","Year 4","Year 5","Year 6"];
const CAMPUS_COL = { Elsternwick:'#818cf8', 'Glen Waverley':'#34d399', 'St Kilda':'#fb923c', 'St Kilda Road':'#fb923c' };

function getGASToken(){ return localStorage.getItem('dla_shared_secret') || ''; }
function withGASToken(payload){
  const out = Object.assign({}, payload);
  // Send the verified Google OAuth token to GAS so the backend can enforce the DLP staff allowlist.
  // This token is already required for Drive access and includes userinfo.email scope.
  if(DRIVE_TOKEN) out.googleAccessToken = DRIVE_TOKEN;
  const token = getGASToken();
  if(token) out.token = token; // optional emergency/shared-secret fallback
  return out;
}
function cleanTextCorruption_(value){
  // Some AI/backend responses arrive with stray question marks where punctuation
  // should be. Keep real question marks at sentence ends, but repair obvious
  // mid-word apostrophes and isolated dash placeholders before display/save.
  let s = String(value || '');
  const urls = [];
  s = s.replace(/https?:\/\/\S+/g, function(url){
    const token = `__DLA_URL_${urls.length}__`;
    urls.push(url);
    return token;
  });
  s = s.replace(/\uFFFD/g, '');
  s = s.replace(/\b(students|learners|teachers|teams|groups|children|communities|families|parents|humans|elephants|animals)\?\s*([a-z])/gi, '$1’ $2');
  s = s.replace(/\b(student|learner|teacher|team|group|child|community|family|parent|human|elephant|animal|school|unit|world)\?\s*([a-z])/gi, '$1’s $2');
  s = s.replace(/([A-Za-z])\?([A-Za-z])/g, '$1’$2');
  s = s.replace(/([A-Za-z0-9)\]\}"”’])\s+\?\s+([A-Za-z0-9(\[\{"“])/g, '$1 — $2');
  s = s.replace(/\s+([,.;:])/g, '$1');
  s = s.replace(/ {2,}/g, ' ');
  s = s.replace(/__DLA_URL_(\d+)__/g, function(_, i){ return urls[Number(i)] || ''; });
  return s;
}
function cleanMinecraftLessonUrl_(url){
  return String(url || '').trim()
    .replace(/watr-humans-and-elephants/gi, 'water-humans-and-elephants');
}
function stripTwistLabel_(value) {
  let s = String(value || '');
  s = s.replace(/(^|[.!?]\s+)(?:and |but )?(?:here(?:'|’)?s |here is )?the (?:real |big )?twist(?:\s*[:—]\s*|\s+is(?:\s+that)?\s+)/gi, function (m, lead) { return lead; });
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, function (m, lead, ch) { return lead + ch.toUpperCase(); });
  return s.replace(/ {2,}/g, ' ').trim();
}
function cleanSuggestionText_(value){
  return stripTwistLabel_(cleanTextCorruption_(value)
    .replace(/\bWatr Humans and Elephants\b/gi, 'Water Humans and Elephants')
    .replace(/\bWatr Humans And Elephants\b/gi, 'Water Humans and Elephants')
    .trim());
}
function cleanSuggestionObject_(s){
  const out = Object.assign({}, s || {});
  if(out.t != null) out.t = cleanSuggestionText_(out.t);
  if(out.tool != null) out.tool = cleanSuggestionText_(out.tool);
  if(out.technology != null) out.technology = cleanSuggestionText_(out.technology);
  if(out.name != null) out.name = cleanSuggestionText_(out.name);
  if(out.d != null) out.d = cleanSuggestionText_(out.d);
  if(out.desc != null) out.desc = cleanSuggestionText_(out.desc);
  if(out.description != null) out.description = cleanSuggestionText_(out.description);
  if(out.integration_idea != null) out.integration_idea = cleanSuggestionText_(out.integration_idea);
  if(out.activity != null) out.activity = cleanSuggestionText_(out.activity);
  if(out.suggestion != null) out.suggestion = cleanSuggestionText_(out.suggestion);
  if(out.url != null) out.url = cleanMinecraftLessonUrl_(out.url);
  if(out.lessonUrl != null) out.lessonUrl = cleanMinecraftLessonUrl_(out.lessonUrl);
  return out;
}
function cleanChangeObject_(c){
  const out = cleanSuggestionObject_(c);
  if(out.reason != null) out.reason = cleanSuggestionText_(out.reason);
  if(out.auditReason != null) out.auditReason = cleanSuggestionText_(out.auditReason);
  if(out.flagReason != null) out.flagReason = cleanSuggestionText_(out.flagReason);
  if(out.reviewReason != null) out.reviewReason = cleanSuggestionText_(out.reviewReason);
  if(out.problem != null) out.problem = cleanSuggestionText_(out.problem);
  if(out.whyBetter != null) out.whyBetter = cleanSuggestionText_(out.whyBetter);
  if(out.improvementRationale != null) out.improvementRationale = cleanSuggestionText_(out.improvementRationale);
  if(out.remainingConcern != null) out.remainingConcern = cleanSuggestionText_(out.remainingConcern);
  if(out.remainingConcerns != null) out.remainingConcerns = cleanSuggestionText_(out.remainingConcerns);
  return out;
}

function cleanJSON(s){
  // Strip code fences, collapse newlines inside string values (so unescaped
  // newlines from the model don't break JSON.parse), and drop trailing commas.
  // The string-matching regex handles escaped quotes via `(?:[^"\\]|\\.)*` so
  // AI output like `"He said \"hi\""` doesn't split at the inner quote.
  return s
    .replace(/```json|```/g, '')
    .replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) => '"' + inner.replace(/[\n\r]+/g, ' ') + '"')
    .replace(/,\s*([\]}])/g, '$1')
    .trim();
}

function normaliseChangeIndex(v, fallback){
  if(v == null) return fallback;
  const n = Number(v);
  if(Number.isFinite(n)) return n;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : fallback;
}

function normaliseChanges(raw){
  return raw.filter(c=>c&&(c.entryIdx!=null||c.entry_idx!=null)).map(c=>{
    c = cleanChangeObject_(c);
    return {
      entryIdx:normaliseChangeIndex(c.entryIdx!=null?c.entryIdx:c.entry_idx, 0),
      sugIdx:normaliseChangeIndex(c.sugIdx!=null?c.sugIdx:c.sug_idx, 0),
      t:cleanSuggestionText_(c.t||c.tool||c.technology||c.name||''),
      d:cleanSuggestionText_(c.d||c.desc||c.description||c.integration_idea||c.activity||c.suggestion||''),
      url:c.url||c.lessonUrl||''
    };
  });
}

// Shared AI safety helpers used by Bulk AI and per-suggestion feedback.
const AI_FORBIDDEN_TOOL_KEYWORDS = ['chatgpt','gemini','claude ai','copilot','google docs','google slides','google sheets','wevideo','flipgrid'];
function compactForPrompt(value, max){
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trim() + '…' : text;
}
function proposalToolParts(toolName){
  const raw = String(toolName || '').trim();
  if(!raw) return [];
  const parts = raw.split(/\s*(?:\+|&|\/|\band\b|\bwith\b)\s*/i).map(p=>p.trim()).filter(Boolean);
  return parts.length ? parts : [raw];
}
function toolContainsForbiddenKeyword(toolName){
  const t = String(toolName || '').toLowerCase();
  return AI_FORBIDDEN_TOOL_KEYWORDS.some(k => t.includes(k));
}
function toolViolatesInventoryBan(toolName){
  const raw = String(toolName || '').toLowerCase();
  const normalised = normaliseToolName(toolName || '').toLowerCase();
  return (TOOL_INVENTORY?.banned || []).some(b => {
    const bRaw = String(b || '').toLowerCase();
    const bNorm = normaliseToolName(b || '').toLowerCase();
    return normalised === bNorm || normalised.includes(bNorm) || raw.includes(bRaw);
  });
}
function isAiToolSafeForEntry(toolName, entry){
  if(!String(toolName || '').trim()) return false;
  if(toolContainsForbiddenKeyword(toolName)) return false;
  if(toolViolatesInventoryBan(toolName)) return false;
  if(entry && !isToolAgeAppropriate(toolName, entry.yl)) return false;
  return true;
}
function wouldDupeToolProposalInEntry(entry, toolName, excludeSugIdx){
  const newKeys = proposalToolParts(toolName).map(toolKey).filter(Boolean);
  if(!newKeys.length) return false;
  return getSugs(entry).some((s,i) => {
    if(i === excludeSugIdx) return false;
    const existingKeys = proposalToolParts(sugTool(s)).map(toolKey).filter(Boolean);
    return existingKeys.some(k => newKeys.includes(k));
  });
}

// 2026-05-26: Component-level dedup for the regen retry loops. The pre-existing
// dedup in 05/06/08/09 compares the WHOLE `t` string via toolKey() — so
// "Seesaw", "Seesaw + Padlet", and "Seesaw + Book Creator" are three distinct
// keys and the same component can repeat freely across slots 1-5 (observed:
// GW 3YOK "Who We Are" had Seesaw in slots 2,3,5). Likewise "Seesaw + Seesaw"
// is a unique whole-string so the existing dedup never trips it (observed in
// 3 audited units). This helper splits each `t` on '+' and reports the first
// offending tool component if either (a) a single slot pairs a tool with
// itself, or (b) the same component appears in 2+ of slots 1-5. Returns null
// if clean.
function componentDupesInRegen_(sugs){
  const arr = Array.isArray(sugs) ? sugs : [];
  for(let i=0; i<Math.min(5, arr.length); i++){
    const s = arr[i];
    const t = s && typeof s.t === 'string' ? s.t : '';
    if(!t) continue;
    const parts = t.split(/\s*\+\s*/).map(p => p.trim()).filter(Boolean);
    if(parts.length > 1){
      const seen = new Set();
      for(const p of parts){
        const k = p.toLowerCase();
        if(seen.has(k)) return p;
        seen.add(k);
      }
    }
  }
  const counts = {};
  for(let i=0; i<Math.min(5, arr.length); i++){
    const s = arr[i];
    const t = s && typeof s.t === 'string' ? s.t : '';
    if(!t) continue;
    const seenInSlot = new Set();
    t.split(/\s*\+\s*/).map(p => p.trim()).filter(Boolean).forEach(p => {
      const k = p.toLowerCase();
      if(seenInSlot.has(k)) return;
      seenInSlot.add(k);
      if(!counts[k]) counts[k] = { label: p, slots: 0 };
      counts[k].slots++;
    });
  }
  for(const k in counts){
    if(counts[k].slots >= 2) return counts[k].label;
  }
  return null;
}

// 2026-05-25: Collect the distinct slot-1 tool labels currently in use by
// other units in the same campus + year level. Used for prompt injection and
// for the post-parse opener-diversity check. Matching by (ca|yl|th) follows
// the convention noted in CLAUDE.md that ca|yl|th is unique per entry.
function siblingOpenersForEntry_(entry){
  if(!entry || !Array.isArray(window.DATA)) return [];
  const ca = entry.ca || '';
  const yl = entry.yl || '';
  const th = entry.th || '';
  const set = new Set();
  window.DATA.forEach(e => {
    if(!e || e.ca !== ca || e.yl !== yl) return;
    if((e.th || '') === th) return;
    const s0 = Array.isArray(e.s) && e.s[0];
    const t = s0 && typeof s0.t === 'string' ? s0.t.trim() : '';
    if(t) set.add(t);
  });
  return Array.from(set);
}

// 2026-05-25: Post-parse opener-diversity check. Returns the duplicated
// slot-1 tool label if `sugs[0].t` matches any sibling's slot-1 tool in the
// same campus+year level, else null. Wire into the regen retry loops.
function openerDupesSiblingInYear_(entry, sugs){
  if(!entry || !Array.isArray(sugs) || !sugs.length) return null;
  const opener = sugs[0] && typeof sugs[0].t === 'string' ? sugs[0].t.trim() : '';
  if(!opener) return null;
  const siblings = siblingOpenersForEntry_(entry).map(s => s.toLowerCase());
  return siblings.includes(opener.toLowerCase()) ? opener : null;
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function recordChange(idx, oldSugs, newSugs){
  CHANGE_HISTORY.unshift({ idx, oldSugs, newSugs, ts: Date.now() });
  if(CHANGE_HISTORY.length > MAX_HISTORY) CHANGE_HISTORY.pop();
}

// ========== SNAPSHOT / UNDO SYSTEM ==========
let SNAPSHOTS = [];
const MAX_SNAPSHOTS = 20;
const SNAPSHOT_KEY = 'dla_snapshots_v1';

function loadSnapshots(){
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if(raw) SNAPSHOTS = JSON.parse(raw) || [];
  } catch(e){ SNAPSHOTS = []; }
}
function saveSnapshotsToStorage(){
  if(SNAPSHOTS.length > MAX_SNAPSHOTS) SNAPSHOTS = SNAPSHOTS.slice(0, MAX_SNAPSHOTS);
  // Try to save; if localStorage quota is exceeded, drop the oldest snapshot
  // and retry until it fits. Previously this swallowed quota errors silently,
  // which left new snapshots in memory but never persisted (so the panel only
  // showed entries from before data.json grew past the per-origin quota).
  while(SNAPSHOTS.length){
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(SNAPSHOTS));
      return;
    } catch(e){
      const quota = /quota|maximum.*storage|exceeded|NS_ERROR_DOM_QUOTA/i.test((e && (e.name + ' ' + e.message)) || '');
      if(!quota){ console.warn('Snapshot save failed:', e.message); return; }
      const removed = SNAPSHOTS.pop();
      console.warn('Snapshot quota exceeded; dropped oldest snapshot to make room:', removed && removed.name);
    }
  }
}
function entrySnapshotKey_(e){
  if(!e) return '';
  // Prefer a stable id if entries carry one; otherwise compose from the unit
  // identity fields. ca|yl|th is unique per planner entry in this corpus.
  if(e.id) return 'id:' + String(e.id);
  if(e._id) return 'id:' + String(e._id);
  return [e.ca || '', e.yl || '', e.th || ''].join('|');
}
function createSnapshot(name){
  // Only the suggestions field (`s`) changes between snapshots in practice.
  // Persisting just that field per entry keeps a 20-snapshot history well
  // under the ~5-10MB localStorage cap, even with a multi-MB data.json.
  const sByKey = {};
  let dropped = 0;
  for(const e of DATA){
    const key = entrySnapshotKey_(e);
    if(!key){ dropped++; continue; }
    if(Object.prototype.hasOwnProperty.call(sByKey, key)){ dropped++; continue; }
    sByKey[key] = JSON.parse(JSON.stringify(e.s || []));
  }
  if(dropped) console.warn('createSnapshot: skipped', dropped, 'entries (missing or duplicate key)');
  const snap = {
    id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    name: name || ('Snapshot ' + new Date().toLocaleString('en-AU')),
    ts: Date.now(),
    format: 'sugs-v1',
    sByKey,
    entryCount: Object.keys(sByKey).length
  };
  SNAPSHOTS.unshift(snap);
  saveSnapshotsToStorage();
  return snap;
}
function restoreSnapshot(id){
  const snap = SNAPSHOTS.find(s => s.id === id);
  if(!snap){ alert('Snapshot not found'); return; }
  if(!confirm(`Restore "${snap.name}"?\n\nThis will replace the current suggestions with the snapshot from ${new Date(snap.ts).toLocaleString('en-AU')}.\n\nA new snapshot of the CURRENT state will be saved first so you can re-undo.`)) return;
  createSnapshot('Before restoring: ' + snap.name);

  if(snap.format === 'sugs-v1' && snap.sByKey){
    // New compact format: patch the suggestions field per entry by key.
    let restored = 0, missing = 0;
    for(const entry of DATA){
      const key = entrySnapshotKey_(entry);
      const sugs = key && snap.sByKey[key];
      if(sugs){
        entry.s = JSON.parse(JSON.stringify(sugs));
        restored++;
      } else {
        missing++;
      }
    }
    setStatus(`Restored snapshot: ${snap.name} (${restored} entries restored${missing ? `, ${missing} not in snapshot` : ''})`);
  } else if(Array.isArray(snap.data)){
    // Legacy full-DATA format — pre-2026-05-20 snapshots still restore.
    DATA.length = 0;
    snap.data.forEach(e => DATA.push(JSON.parse(JSON.stringify(e))));
    setStatus(`Restored snapshot: ${snap.name}`);
  } else {
    alert('Snapshot is in an unrecognised format and cannot be restored.');
    return;
  }

  saveToDrive();
  if(typeof renderBrowse === 'function') renderBrowse();
  if(typeof renderAuditChart === 'function') renderAuditChart();
  if(typeof renderBulkWelcome === 'function') renderBulkWelcome();
  if(typeof renderSnapshotsList === 'function') renderSnapshotsList();
}
function deleteSnapshot(id){
  const snap = SNAPSHOTS.find(s => s.id === id);
  if(!snap) return;
  if(!confirm(`Delete snapshot "${snap.name}"?\n\nThis cannot be undone.`)) return;
  SNAPSHOTS = SNAPSHOTS.filter(s => s.id !== id);
  saveSnapshotsToStorage();
  renderSnapshotsList();
}
function createManualSnapshot(){
  const name = prompt('Name this snapshot:', 'Manual snapshot ' + new Date().toLocaleString('en-AU'));
  if(!name) return;
  createSnapshot(name);
  renderSnapshotsList();
  setStatus('Snapshot saved ✓');
}
function renderSnapshotsList(){
  const container = document.getElementById('snapshots-list');
  if(!container) return;
  if(!SNAPSHOTS.length){
    container.innerHTML = '<div style="color:var(--dim);font-size:13px;padding:10px 0">No snapshots yet. A snapshot is created automatically before every Bulk AI Edit.</div>';
    return;
  }
  container.innerHTML = SNAPSHOTS.map(snap => {
    const age = Math.round((Date.now() - snap.ts) / 60000);
    const ageStr = age < 1 ? 'just now' : age < 60 ? age + 'm ago' : age < 1440 ? Math.round(age/60) + 'h ago' : Math.round(age/1440) + 'd ago';
    const entryCount = typeof snap.entryCount === 'number'
      ? snap.entryCount
      : (snap.sByKey ? Object.keys(snap.sByKey).length : (snap.data || []).length);
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--card2);border:1px solid var(--border);border-radius:10px;margin-bottom:6px">
      <span style="font-size:16px">📸</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(snap.name)}</div>
        <div style="font-size:11px;color:var(--dim)">${ageStr} · ${entryCount} entries</div>
      </div>
      <button class="btn-sm" onclick="restoreSnapshot('${snap.id}')" style="color:var(--lime);border-color:var(--lime)">↺ Restore</button>
      <button class="btn-sm" onclick="deleteSnapshot('${snap.id}')" style="color:#FF8080">✕</button>
    </div>`;
  }).join('');
}

// ========== PLAYBOOKS SYSTEM ==========
let PLAYBOOKS = [];
const PLAYBOOK_KEY = 'dla_playbooks_v1';
const SEED_PLAYBOOKS = [
  { name: 'Diversify most overused tool', prompt: 'Find the most overused tool in the library and propose replacements for the worst offenders using underused alternatives.' },
  { name: 'Scan for Minecraft opportunities', prompt: 'Find opportunities to use verified Minecraft Education lessons from the curated library wherever they genuinely connect to the unit.' },
  { name: 'Scan for Micro:bit opportunities', prompt: 'Find opportunities to use Micro:bit wherever a curated lesson genuinely connects to the unit.' },
  { name: 'Bulk up weak/generic descriptions', prompt: 'Scan the entire library for vague, brief, generic, or weakly-connected descriptions and improve the description using the same tool.' },
  { name: 'Boost hands-on STEM (Year 4+)', prompt: 'Find Year 4, 5 and 6 entries where a hands-on STEM tool (Sphero BOLT, Lego Spike Prime, Micro:bit, CoDrone, 3D Printers) could genuinely connect but is missing.' }
];

function loadPlaybooks(){
  try {
    const raw = localStorage.getItem(PLAYBOOK_KEY);
    if(raw){
      PLAYBOOKS = JSON.parse(raw) || [];
    } else {
      PLAYBOOKS = SEED_PLAYBOOKS.map((p,i) => ({ ...p, id:'pb_seed_'+i, seed:true }));
      savePlaybooks();
    }
  } catch(e){ PLAYBOOKS = SEED_PLAYBOOKS.map((p,i) => ({ ...p, id:'pb_seed_'+i, seed:true })); }
}
function savePlaybooks(){
  try { localStorage.setItem(PLAYBOOK_KEY, JSON.stringify(PLAYBOOKS)); }
  catch(e){ console.warn('Playbook save failed:', e.message); }
}
function savePlaybookFromChat(){
  const lastUser = [...(typeof bulkChatMemory !== 'undefined' ? bulkChatMemory : [])].reverse().find(m => m.role === 'user');
  const input = document.getElementById('bulk-chat-input');
  const fromInput = input?.value?.trim() || '';
  const prompt_ = fromInput || (lastUser?.content || '');
  if(!prompt_){ alert('Type a request in the chat first, or send one, then save it as a playbook.'); return; }
  const name = prompt('Name this playbook:', prompt_.slice(0, 40));
  if(!name) return;
  PLAYBOOKS.unshift({ id: 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), name, prompt: prompt_ });
  savePlaybooks();
  renderPlaybooksList();
  setStatus('Playbook saved ✓');
}
function runPlaybook(id){
  const pb = PLAYBOOKS.find(p => p.id === id);
  if(!pb) return;
  if(typeof bulkChatQuickStart === 'function') bulkChatQuickStart(pb.prompt);
}
function deletePlaybook(id){
  const pb = PLAYBOOKS.find(p => p.id === id);
  if(!pb) return;
  if(!confirm(`Delete playbook "${pb.name}"?`)) return;
  PLAYBOOKS = PLAYBOOKS.filter(p => p.id !== id);
  savePlaybooks();
  renderPlaybooksList();
}
function renderPlaybooksList(){
  const container = document.getElementById('playbooks-list');
  if(!container) return;
  if(!PLAYBOOKS.length){
    container.innerHTML = '<div style="color:var(--dim);font-size:13px;padding:10px 0">No playbooks yet.</div>';
    return;
  }
  container.innerHTML = PLAYBOOKS.map(pb => {
    const seed = pb.seed ? ' <span style="font-size:9px;padding:2px 6px;border-radius:20px;background:rgba(212,160,23,0.15);color:var(--gold);font-weight:700;letter-spacing:.5px">TEMPLATE</span>' : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--card2);border:1px solid var(--border);border-radius:10px;margin-bottom:6px">
      <span style="font-size:16px">${pb.seed ? '📘' : '📖'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(pb.name)}${seed}</div>
        <div style="font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(pb.prompt)}</div>
      </div>
      <button class="btn-sm" onclick="runPlaybook('${pb.id}')" style="color:var(--gold);border-color:var(--gold)">▶ Run</button>
      ${pb.seed ? '' : `<button class="btn-sm" onclick="deletePlaybook('${pb.id}')" style="color:#FF8080">✕</button>`}
    </div>`;
  }).join('');
}

loadSnapshots();
loadPlaybooks();

// ========== TOOL INVENTORY UI ==========
const YEAR_LEVEL_CHOICES = [
  { value: -2, label: '3 Year Old Kinder' },
  { value: -1, label: '4 Year Old Kinder' },
  { value: 0, label: 'Prep' },
  { value: 1, label: 'Year 1' },
  { value: 2, label: 'Year 2' },
  { value: 3, label: 'Year 3' },
  { value: 4, label: 'Year 4' },
  { value: 5, label: 'Year 5' },
  { value: 6, label: 'Year 6' }
];

