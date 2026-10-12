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
  // The genuine whitelist is now in place. Boot-time hotfixes (the NatGeo
  // seed in js/08) can make TOOL_INVENTORY.approved non-empty long before
  // this runs, so "approved has entries" is NOT a reliable loaded-signal —
  // this flag is. The dashboard's off-whitelist and tool-mismatch counts
  // stay quiet until it's set, preventing the boot-time flash of hundreds
  // of false "off whitelist" hits (the 647-then-0 flicker).
  window._TOOL_INVENTORY_READY = true;
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

// Whitelist display: sorted copy (the stored order is left alone), first
// ceil(n/2) tools in the left column, the rest in the right column.
function invSplitColumns_(list){
  const sorted = (Array.isArray(list) ? list : []).slice().sort(function(a, b){
    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  });
  const half = Math.ceil(sorted.length * 0.5);
  return { left: sorted.slice(0, half), right: sorted.slice(half) };
}

// Left column, 1px divider, right column. rowFn turns one tool into its row HTML.
function invColumnsHtml_(cols, rowFn){
  return '<div class="inv-col">' + cols.left.map(rowFn).join('') + '</div>'
    + '<div class="inv-col-divider"></div>'
    + '<div class="inv-col">' + cols.right.map(rowFn).join('') + '</div>';
}

