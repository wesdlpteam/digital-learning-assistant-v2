function clampYearLevelValue(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return -2;
  return Math.max(-2, Math.min(6, Math.round(n)));
}

function yearLevelLabel(value){
  const n = clampYearLevelValue(value);
  return YEAR_LEVEL_CHOICES.find(y => y.value === n)?.label || `Year ${n}`;
}

function ageRangeLabel(range){
  const r = normaliseAgeRange(range);
  return r.min === r.max ? yearLevelLabel(r.min) : `${yearLevelLabel(r.min)}–${yearLevelLabel(r.max)}`;
}

function yearSelectOptions(selected){
  const sel = clampYearLevelValue(selected);
  return YEAR_LEVEL_CHOICES
    .map(y => `<option value="${y.value}" ${y.value === sel ? 'selected' : ''}>${y.label}</option>`)
    .join('');
}

function jsArg(value){
  return JSON.stringify(String(value || ''));
}

function toolInventoryKey(tool){
  const raw = String(tool || '').trim();
  if(!raw) return '';
  try { return normaliseToolName(raw).toLowerCase().trim(); }
  catch(e){ return raw.toLowerCase().trim(); }
}

function normaliseToolList(list){
  if(!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach(item => {
    const value = String(item || '').trim();
    if(!value) return;
    const key = toolInventoryKey(value);
    if(seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
}

function normaliseAgeRange(range){
  const source = range && typeof range === 'object' ? range : {};
  let min = clampYearLevelValue(source.min ?? source.minYear ?? source.from ?? 0);
  let max = clampYearLevelValue(source.max ?? source.maxYear ?? source.to ?? 6);
  if(min > max){ const tmp = min; min = max; max = tmp; }
  return { min, max };
}

function normaliseAgeRanges(ranges){
  const out = {};
  if(!ranges || typeof ranges !== 'object') return out;
  Object.entries(ranges).forEach(([tool, range]) => {
    const key = toolInventoryKey(tool);
    if(key) out[key] = normaliseAgeRange(range);
  });
  return out;
}

let TOOL_INVENTORY_CLEANUP_PENDING = false;

function removeToolInventoryCrossListConflicts(preferList){
  TOOL_INVENTORY.approved = Array.isArray(TOOL_INVENTORY.approved) ? TOOL_INVENTORY.approved : [];
  TOOL_INVENTORY.banned = Array.isArray(TOOL_INVENTORY.banned) ? TOOL_INVENTORY.banned : [];
  TOOL_INVENTORY.ageRanges = TOOL_INVENTORY.ageRanges || {};

  const before = JSON.stringify({
    approved: TOOL_INVENTORY.approved,
    banned: TOOL_INVENTORY.banned,
    ageRanges: TOOL_INVENTORY.ageRanges
  });

  const bannedKeys = new Set(TOOL_INVENTORY.banned.map(toolInventoryKey).filter(Boolean));
  const approvedKeys = new Set(TOOL_INVENTORY.approved.map(toolInventoryKey).filter(Boolean));

  // Safety-first default: if the same tool appears in both lists under aliases
  // such as "Sway" and "Microsoft Sway", banned wins.
  if(preferList === 'approved'){
    TOOL_INVENTORY.banned = TOOL_INVENTORY.banned.filter(t => !approvedKeys.has(toolInventoryKey(t)));
  } else {
    TOOL_INVENTORY.approved = TOOL_INVENTORY.approved.filter(t => !bannedKeys.has(toolInventoryKey(t)));
    bannedKeys.forEach(k => { if(k && TOOL_INVENTORY.ageRanges) delete TOOL_INVENTORY.ageRanges[k]; });
  }

  const after = JSON.stringify({
    approved: TOOL_INVENTORY.approved,
    banned: TOOL_INVENTORY.banned,
    ageRanges: TOOL_INVENTORY.ageRanges
  });
  if(before !== after) TOOL_INVENTORY_CLEANUP_PENDING = true;
}

function normaliseToolInventory(){
  TOOL_INVENTORY = TOOL_INVENTORY && typeof TOOL_INVENTORY === 'object'
    ? TOOL_INVENTORY
    : { approved: [], banned: [], ageRanges: {} };
  TOOL_INVENTORY.approved = normaliseToolList(TOOL_INVENTORY.approved);
  TOOL_INVENTORY.banned = normaliseToolList(TOOL_INVENTORY.banned);
  TOOL_INVENTORY.ageRanges = normaliseAgeRanges(TOOL_INVENTORY.ageRanges);
  removeToolInventoryCrossListConflicts('banned');
  return TOOL_INVENTORY;
}

function loadToolInventoryFromMeta(meta){
  const inv = (meta && meta._inventory && typeof meta._inventory === 'object') ? meta._inventory : {};
  TOOL_INVENTORY = {
    approved: normaliseToolList(inv.approved || inv.whitelist || inv.allowlist || []),
    banned: normaliseToolList(inv.banned || inv.blocklist || inv.denylist || []),
    ageRanges: normaliseAgeRanges(inv.ageRanges || inv.ranges || inv.age_ranges || {})
  };
  seedDefaultInventoryIfEmpty();
  return TOOL_INVENTORY;
}

function serialiseToolInventoryForMeta(){
  normaliseToolInventory();
  return {
    approved: TOOL_INVENTORY.approved || [],
    banned: TOOL_INVENTORY.banned || [],
    ageRanges: TOOL_INVENTORY.ageRanges || {}
  };
}

function invAddTool(listKey){
  const inputId = listKey === 'approved' ? 'inv-whitelist-input' : 'inv-banned-input';
  const input = document.getElementById(inputId);
  if(!input) return;
  const rawVal = (input.value || '').trim();
  if(!rawVal) return;
  const val = normaliseToolName(rawVal).trim() || rawVal;
  normaliseToolInventory();
  TOOL_INVENTORY[listKey] = TOOL_INVENTORY[listKey] || [];
  const key = toolInventoryKey(val);
  const exists = TOOL_INVENTORY[listKey].some(x => toolInventoryKey(x) === key);
  if(exists){
    setStatus(`"${val}" is already in the ${listKey === 'approved' ? 'whitelist' : 'banned list'}`, 'error');
    input.value = '';
    return;
  }
  // If adding to banned, also remove from approved (and vice versa)
  if(listKey === 'banned'){
    TOOL_INVENTORY.approved = (TOOL_INVENTORY.approved || []).filter(x => toolInventoryKey(x) !== key);
    if(TOOL_INVENTORY.ageRanges) delete TOOL_INVENTORY.ageRanges[key];
  } else {
    TOOL_INVENTORY.banned = (TOOL_INVENTORY.banned || []).filter(x => toolInventoryKey(x) !== key);
    const minEl = document.getElementById('inv-whitelist-min');
    const maxEl = document.getElementById('inv-whitelist-max');
    const range = normaliseAgeRange({ min: minEl?.value ?? 0, max: maxEl?.value ?? 6 });
    TOOL_INVENTORY.ageRanges[key] = range;
  }
  TOOL_INVENTORY[listKey].push(val);
  input.value = '';
  renderToolInventory();
  saveLibraries();
  setStatus(`Added "${val}" to ${listKey === 'approved' ? 'whitelist' : 'banned list'}`);
  // For whitelist adds, let the AI draft a "what it's for" note, then show an approve/edit popup.
  if(listKey === 'approved' && typeof proposeToolAffordance_ === 'function'){
    proposeToolAffordance_(val);
  }
}

function invRemoveTool(listKey, tool){
  normaliseToolInventory();
  const key = toolInventoryKey(tool);
  const before = (TOOL_INVENTORY[listKey] || []).length;
  TOOL_INVENTORY[listKey] = (TOOL_INVENTORY[listKey] || []).filter(x => toolInventoryKey(x) !== key);
  if(listKey === 'approved' && TOOL_INVENTORY.ageRanges) delete TOOL_INVENTORY.ageRanges[key];
  renderToolInventory();
  saveLibraries();
  const removed = before - (TOOL_INVENTORY[listKey] || []).length;
  setStatus(removed ? `Removed "${tool}" from ${listKey === 'approved' ? 'whitelist' : 'banned list'}` : `"${tool}" was already removed`);
}

function invUpdateToolAge(tool, edge, value){
  normaliseToolInventory();
  const key = toolInventoryKey(tool);
  const current = getToolAgeRange(tool);
  let next = { min: current.min, max: current.max };
  if(edge === 'min') next.min = clampYearLevelValue(value);
  if(edge === 'max') next.max = clampYearLevelValue(value);
  if(next.min > next.max){
    if(edge === 'min') next.max = next.min;
    if(edge === 'max') next.min = next.max;
  }
  TOOL_INVENTORY.ageRanges[key] = next;
  renderToolInventory();
  saveLibraries();
  // Re-scan the dashboard against the new range straight away (the dashboard
  // reads ageRanges live, so this just makes the recheck instant when visible).
  if(typeof renderDashboard === 'function') renderDashboard();
  setStatus(`Updated ${tool} age range to ${ageRangeLabel(next)}`);
}

function renderToolInventory(){
  const whitelistEl = document.getElementById('inv-whitelist-pills');
  const bannedEl = document.getElementById('inv-banned-pills');
  const whCountEl = document.getElementById('inv-whitelist-count');
  const banCountEl = document.getElementById('inv-banned-count');
  const totalEl = document.getElementById('inv-count');
  if(!whitelistEl || !bannedEl) return;

  normaliseToolInventory();
  const shouldPersistInventoryCleanup = TOOL_INVENTORY_CLEANUP_PENDING;
  TOOL_INVENTORY_CLEANUP_PENDING = false;
  const approved = TOOL_INVENTORY.approved || [];
  const banned = TOOL_INVENTORY.banned || [];

  if(shouldPersistInventoryCleanup){
    if(DRIVE_TOKEN && LIBRARIES_FILE_ID && typeof saveLibraries === 'function'){
      setTimeout(() => saveLibraries().catch(e => console.warn('Inventory cleanup save failed:', e)), 0);
      setStatus('Cleaned duplicate tool aliases across whitelist/banned lists ✓');
    } else {
      setStatus('Cleaned duplicate tool aliases locally — reconnect Drive to persist', 'loading');
    }
  }

  if(whCountEl) whCountEl.textContent = approved.length ? `(${approved.length})` : '';
  if(banCountEl) banCountEl.textContent = banned.length ? `(${banned.length})` : '';
  if(totalEl) totalEl.textContent = (approved.length || banned.length) ? `${approved.length + banned.length} entries` : '';

  whitelistEl.innerHTML = approved.length
    ? approved.map(t => {
        const range = getToolAgeRange(t);
        const rwNote = (typeof getToolAffordance_ === 'function') ? getToolAffordance_(t) : null;
        const rwOn = !!(rwNote && rwNote.realWorld);
        return `<div style="display:grid;grid-template-columns:minmax(150px,1fr) 105px 105px auto auto auto;gap:6px;align-items:center;padding:7px 8px;background:rgba(197,232,74,0.08);border:1px solid rgba(197,232,74,0.3);border-radius:12px;font-size:12px;color:var(--lime)">
          <div style="min-width:0">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t)}</div>
            <div style="font-size:10px;color:var(--dim);font-weight:600">${ageRangeLabel(range)}</div>
          </div>
          <select class="inp" title="Minimum year level" onchange="invUpdateToolAge(${jsArg(t)},'min',this.value)" style="margin-bottom:0;font-size:11px;padding:5px 7px;color:var(--lime);border-color:rgba(197,232,74,.3)">${yearSelectOptions(range.min)}</select>
          <select class="inp" title="Maximum year level" onchange="invUpdateToolAge(${jsArg(t)},'max',this.value)" style="margin-bottom:0;font-size:11px;padding:5px 7px;color:var(--lime);border-color:rgba(197,232,74,.3)">${yearSelectOptions(range.max)}</select>
          <label title="Weave a real-world AI connection into this tool's suggestions" style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:var(--dim);cursor:pointer;white-space:nowrap;user-select:none"><input type="checkbox" ${rwOn ? 'checked' : ''} onchange="invToggleAiRealWorld(${jsArg(t)}, this.checked)" style="accent-color:var(--lime);cursor:pointer">AI real-world</label>
          <button type="button" onclick="event.stopPropagation(); invEditToolAffordance(${jsArg(t)}); return false;" style="background:transparent;border:none;color:var(--lime);cursor:pointer;padding:0 4px;font-size:14px;line-height:1;opacity:.8" title="Edit how the AI should use this tool (what it's for, good uses, real-world examples)">✎</button>
          <button type="button" onclick="event.stopPropagation(); invRemoveTool('approved',${jsArg(t)}); return false;" style="background:transparent;border:none;color:var(--lime);cursor:pointer;padding:0 6px;font-size:18px;line-height:1;opacity:.8" title="Remove">×</button>
        </div>`;
      }).join('')
    : '<span style="font-size:11px;color:var(--dim);font-style:italic">No whitelist — all approved tools allowed.</span>';

  bannedEl.innerHTML = banned.length
    ? banned.map(t => `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 4px 4px 10px;background:rgba(255,128,128,0.08);border:1px solid rgba(255,128,128,0.3);border-radius:99px;font-size:12px;font-weight:600;color:#FF8080">${esc(t)}<button type="button" onclick="event.stopPropagation(); invRemoveTool('banned',${jsArg(t)}); return false;"  style="background:transparent;border:none;color:#FF8080;cursor:pointer;padding:0 6px;font-size:14px;line-height:1;opacity:.7" title="Remove">×</button></span>`).join('')
    : '<span style="font-size:11px;color:var(--dim);font-style:italic">No bans.</span>';
}

