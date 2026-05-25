// ===== PLANNER CONTEXT — on-demand fetch from GAS for Browse feedback/regenerate =====
const _plannerContextCache = {};

async function fetchPlannerContext(entry) {
  if (!entry || !entry.ca || !entry.yl || !entry.th) return '';
  const cacheKey = `${entry.ca}|${entry.yl}|${entry.th}`;
  if (_plannerContextCache[cacheKey] !== undefined) return _plannerContextCache[cacheKey];
  try {
    const body = withGASToken({ action: 'getPlannerContext', ca: entry.ca, yl: entry.yl, th: entry.th });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const d = await r.json();
    if (d.error) { console.warn('getPlannerContext error:', d.error); _plannerContextCache[cacheKey] = ''; return ''; }
    const ctx = d.plannerContext || '';
    _plannerContextCache[cacheKey] = ctx;
    if (d.found) console.log('Planner context fetched for', cacheKey, '—', ctx.length, 'chars');
    return ctx;
  } catch (err) {
    console.warn('getPlannerContext failed:', err.message);
    _plannerContextCache[cacheKey] = '';
    return '';
  }
}

// ===== TOOL DIVERSITY SCANNER =====
let _diversifyRunning = false;
let _diversifySwaps = [];

function runDiversityScan() {
  const ca = document.getElementById('div-campus')?.value || '';
  const yr = document.getElementById('div-year')?.value || '';
  const statusEl = document.getElementById('diversity-status');
  const resultsEl = document.getElementById('diversity-results');
  const fixBtn = document.getElementById('btn-diversity-fix');

  const filtered = DATA.filter(e => {
    if (ca && e.ca !== ca) return false;
    if (yr && e.yl !== yr) return false;
    return getSugs(e).filter(isRealSug).length >= 1;
  });
  if (!filtered.length) {
    statusEl.style.color = 'var(--salmon)';
    statusEl.textContent = 'No entries match those filters';
    resultsEl.innerHTML = '';
    fixBtn.style.display = 'none';
    return;
  }

  // Count tool frequency — per-entry (does tool appear in this entry?)
  const toolEntryCount = {};
  const toolNames = {};
  filtered.forEach(e => {
    const seen = new Set();
    getSugs(e).filter(isRealSug).forEach(s => {
      const raw = sugTool(s);
      const key = toolKey(raw);
      if (!key || seen.has(key)) return;
      seen.add(key);
      toolEntryCount[key] = (toolEntryCount[key] || 0) + 1;
      if (!toolNames[key]) toolNames[key] = raw;
    });
  });

  const sorted = Object.entries(toolEntryCount)
    .map(([key, count]) => ({
      key, name: toolNames[key] || key, count,
      pct: Math.round((count / filtered.length) * 100)
    }))
    .sort((a, b) => b.count - a.count);

  const OVERUSED_PCT = 50;
  const overused = sorted.filter(t => t.pct > OVERUSED_PCT);
  const TARGET_PCT = 35; // bring overused down to ~35%

  // Build the underused pool (age-appropriate, not banned, used ≤2 times)
  const yearForAge = yr || 'Year 3';
  const ageTools = getAgeAppropriateTools(yearForAge);
  const underused = ageTools.filter(t => {
    const k = toolKey(t);
    return k && (!toolEntryCount[k] || toolEntryCount[k] <= 2) && !toolContainsForbiddenKeyword(t) && !toolViolatesInventoryBan(t);
  });

  // Build swap plan for overused tools
  _diversifySwaps = [];
  overused.forEach(ot => {
    const targetCount = Math.max(1, Math.ceil(filtered.length * TARGET_PCT / 100));
    const swapsNeeded = Math.max(0, ot.count - targetCount);
    if (swapsNeeded === 0) return;

    // Find candidate entries — prefer entries where this tool appears and has other overused tools too
    const candidates = [];
    filtered.forEach((e, fi) => {
      const sugs = getSugs(e).filter(isRealSug);
      sugs.forEach((s, si) => {
        if (toolKey(sugTool(s)) === ot.key) {
          const idx = DATA.indexOf(e);
          candidates.push({ entry: e, dataIdx: idx, sugIdx: si, sug: s });
        }
      });
    });

    // Take only as many as needed, from the end (arbitrary but stable)
    const toSwap = candidates.slice(-swapsNeeded);
    toSwap.forEach(c => {
      // Pick an underused tool not already in that entry
      const usedInEntry = new Set(getSugs(c.entry).map(s => toolKey(sugTool(s))).filter(Boolean));
      const available = underused.filter(t => !usedInEntry.has(toolKey(t)));
      const replacement = available.length ? available[Math.floor(Math.random() * Math.min(available.length, 6))] : null;
      if (replacement) {
        _diversifySwaps.push({
          dataIdx: c.dataIdx,
          sugIdx: c.sugIdx,
          entry: c.entry,
          oldTool: ot.name,
          newTool: replacement,
          currentDesc: sugDesc(c.sug)
        });
      }
    });
  });

  // Render results
  const maxBar = sorted.length ? sorted[0].count : 1;
  let html = `<div style="font-size:12px;color:var(--dim);margin-bottom:12px;font-weight:600">${filtered.length} entries · ${sorted.length} unique tools</div>`;
  html += sorted.map(t => {
    const barW = Math.round((t.count / maxBar) * 100);
    const isOver = t.pct > OVERUSED_PCT;
    const color = isOver ? 'var(--salmon)' : 'var(--lime)';
    const tag = isOver ? ` <span style="color:var(--salmon);font-weight:800;font-size:10px;letter-spacing:.5px">OVERUSED</span>` : '';
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;font-weight:600">
        <span style="color:var(--text)">${esc(t.name)}${tag}</span>
        <span style="color:var(--dim)">${t.count} entries (${t.pct}%)</span>
      </div>
      <div style="height:5px;background:var(--card2);border-radius:3px"><div style="height:100%;width:${barW}%;background:${color};border-radius:3px;transition:width .4s"></div></div>
    </div>`;
  }).join('');

  if (overused.length && _diversifySwaps.length) {
    html += `<div style="margin-top:16px;padding:12px 16px;background:rgba(155,139,255,.08);border:1px solid rgba(155,139,255,.25);border-radius:10px">
      <div style="font-size:13px;font-weight:700;color:var(--purple);margin-bottom:6px">📊 ${overused.length} overused tool${overused.length !== 1 ? 's' : ''} · ${_diversifySwaps.length} swap${_diversifySwaps.length !== 1 ? 's' : ''} planned</div>
      <div style="font-size:12px;color:var(--dim);line-height:1.6">
        ${_diversifySwaps.map(sw => `<div style="margin-bottom:3px">• <strong style="color:var(--salmon)">${esc(sw.oldTool)}</strong> → <strong style="color:var(--lime)">${esc(sw.newTool)}</strong> <span style="opacity:.7">in ${esc(sw.entry.ca)} ${esc(sw.entry.yl)} — ${esc(sw.entry.th)}</span></div>`).join('')}
      </div>
    </div>`;
    fixBtn.style.display = '';
  } else if (overused.length === 0) {
    html += `<div style="margin-top:14px;padding:10px 14px;background:rgba(197,232,74,.08);border:1px solid rgba(197,232,74,.2);border-radius:8px;font-size:13px;color:var(--lime);font-weight:600">✓ No overused tools — distribution looks healthy</div>`;
    fixBtn.style.display = 'none';
  } else {
    html += `<div style="margin-top:14px;padding:10px 14px;background:rgba(255,128,128,.08);border:1px solid rgba(255,128,128,.2);border-radius:8px;font-size:13px;color:var(--salmon);font-weight:600">Overused tools found but no suitable replacements available — check your Tool Inventory</div>`;
    fixBtn.style.display = 'none';
  }

  if (underused.length) {
    html += `<div style="margin-top:14px;padding:12px 16px;background:var(--card2);border-radius:8px;border-left:3px solid var(--lime)">
      <div style="font-size:11px;color:var(--lime);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">Underused tools (≤2 entries)</div>
      <div style="font-size:12px;color:var(--dim);line-height:1.8">${underused.map(t => `<span style="display:inline-block;padding:2px 8px;margin:2px 3px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11px;font-weight:600;color:var(--text)">${esc(t)}</span>`).join('')}</div>
    </div>`;
  }

  resultsEl.innerHTML = html;
  statusEl.style.color = 'var(--lime)';
  statusEl.textContent = `Scanned ${filtered.length} entries`;
}

async function runAutoDiversify() {
  if (_diversifyRunning || !_diversifySwaps.length) return;
  _diversifyRunning = true;
  const statusEl = document.getElementById('diversity-status');
  const fixBtn = document.getElementById('btn-diversity-fix');
  const stopBtn = document.getElementById('btn-diversity-stop');
  const scanBtn = document.getElementById('btn-diversity-scan');

  fixBtn.disabled = true;
  scanBtn.disabled = true;
  stopBtn.style.display = '';
  startProgress();

  let completed = 0;
  const total = _diversifySwaps.length;

  for (const sw of _diversifySwaps) {
    if (!_diversifyRunning) break;
    statusEl.style.color = 'var(--purple)';
    statusEl.textContent = `Diversifying ${completed + 1}/${total}: ${sw.oldTool} → ${sw.newTool}…`;

    try {
      const entry = DATA[sw.dataIdx];
      const plannerCtx = entry.plannerContextRich || entry.plannerText || '';
      const yl = entry.yl || '';
      const constraintBlock = buildToolConstraints(yl);

      const prompt = `You are a Digital Learning Coach at Wesley College (IB PYP, Melbourne).
Rewrite this technology suggestion for a different tool.

UNIT: ${entry.th || ''}
YEAR LEVEL: ${yl}
CAMPUS: ${entry.ca || ''}
${plannerCtx ? 'PLANNER CONTEXT: ' + plannerCtx.slice(0, 8000) : ''}

OLD TOOL: ${sw.oldTool}
OLD DESCRIPTION: ${sw.currentDesc}

NEW TOOL TO USE: ${sw.newTool}
${constraintBlock}

${SUGGESTION_STYLE}

Write ONE JSON object: {"t":"${sw.newTool}","d":"..."}
The description must be for ${sw.newTool} specifically, naming its real features and concrete student actions.
Return ONLY the JSON object, no markdown fences, no extra text.`;

      const raw = await callAI(
        [{ role: 'user', parts: [{ text: prompt }] }],
        '', OPENAI_FAST_MODEL
      );

      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && parsed.t && parsed.d) {
        const sugs = entry.s;
        if (Array.isArray(sugs) && sugs[sw.sugIdx]) {
          sugs[sw.sugIdx] = { t: parsed.t, d: parsed.d };
          if (parsed.url) sugs[sw.sugIdx].url = parsed.url;
          // If this entry was human-verified, clear the flag — the suggestion
          // just changed, reviewers need to re-check it.
          markEntryNeedsHumanRecheck_(sw.dataIdx, 'Tool swapped by diversity scanner');
          completed++;
        }
      }
    } catch (err) {
      console.warn('Diversify swap failed:', sw.oldTool, '→', sw.newTool, err.message);
    }
    // Brief pause between API calls
    if (_diversifyRunning && completed < total) await new Promise(r => setTimeout(r, 3000));
  }

  _diversifyRunning = false;
  fixBtn.disabled = false;
  fixBtn.style.display = 'none';
  scanBtn.disabled = false;
  stopBtn.style.display = 'none';
  stopProgress();

  if (completed > 0) {
    statusEl.style.color = 'var(--lime)';
    statusEl.textContent = `✓ ${completed}/${total} suggestions diversified — saving…`;
    try {
      await saveToDrive();
      CHANGE_HISTORY.push({ type: 'diversify', count: completed, ts: Date.now() });
      statusEl.textContent = `✓ ${completed} suggestions diversified and saved to Drive`;
      renderDashboard();
    } catch (err) {
      statusEl.textContent = `✓ ${completed} diversified but save failed: ${err.message}`;
    }
  } else {
    statusEl.style.color = 'var(--salmon)';
    statusEl.textContent = completed === 0 && !_diversifyRunning ? 'Stopped — no changes made' : 'No swaps succeeded';
  }
  _diversifySwaps = [];
}

function stopAutoDiversify() {
  _diversifyRunning = false;
  const statusEl = document.getElementById('diversity-status');
  if (statusEl) statusEl.textContent += ' — stopping…';
}

function closeEntry(){
  if(CURRENT_ENTRY_IDX !== null){
    // Release lock in background
    if(DATA._locks) delete DATA._locks[String(CURRENT_ENTRY_IDX)];
    MY_LOCK_IDX = null;
    stopLockHeartbeat();
    saveLocks(); // fire-and-forget
    renderLockIndicators();
  }
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const panel=document.getElementById('panel-'+PREV_TAB);
  if(panel) panel.classList.add('active');
  CURRENT_ENTRY_IDX=null;
  if(PREV_TAB==='browse') renderBrowse();
}

// v5.18 FIX: Removed all BANNED tools from this list. Previously contained
// classvr, green screen, digital camera, google earth, lego spike essential,
// teams, powerpoint, onenote, sway — all of which are banned.
// This list is the FALLBACK whitelist when TOOL_INVENTORY.approved is empty,
// so banned tools in here could slip through if the inventory hasn't loaded.
const TOOL_WHITELIST = [
  // Microsoft M365 (only approved ones: Word, Excel, Forms)
  // Note: bare 'microsoft' removed — it was a substring-match backdoor for banned MS tools.
  'microsoft word','microsoft excel','microsoft forms','word','excel','forms',
  'wise','schoolbox','wise discussion chatbots','schoolbox discussion chatbots',

  // Robotics / STEM (Lego Spike Essential is BANNED — only Prime)
  'beebot','beebots','bee-bot','bee-bots','sphero indi','sphero bolt','sphero',
  'lego spike prime','lego spike','lego','micro:bit','microbit','codrone','makey makey',

  // Hardware (ClassVR, Green Screen, Digital Camera are BANNED)
  '3d printer','merge cube','merge cubes',
  'podcast equipment','rodecaster','ipad','laptop',

  // Core creation
  'seesaw','canva','book creator','padlet',

  // Video / audio / animation
  'garageband','scratchjr','scratch jr','scratch','stop motion studio','stop motion',
  'chatterpix','imovie','puppet pals',
  'adobe express','podcasting using canva','animating a character with adobe express',

  // Subject specific (Google Earth is BANNED)
  'google maps','national geographic mapmaker','national geographic map maker','nat geo mapmaker','mapmaker',
  'field guide to victoria','field guide','sky map',
  'geoboard',

  // Other
  'clickview','epic','piccollage','brushes redux','word clouds','abcya',
  'sketchbook','explain everything','freeform','delightex',
  'kahoot','tinkercad','minecraft','minecraft education',

  // Extended hardware
  'insta360','rugged robot','smart bricks','indi robot','edison',
  'cubetto','pico vr','pico','merge explorer'
];


// v5.18 FIX: Expanded static banned list so these tools are caught
// even before TOOL_INVENTORY loads from libraries.json.
const DASHBOARD_STATIC_BANNED_TOOLS = [
  'wevideo', 'we video',
  'classvr', 'class vr',
  'flipgrid', 'flip',
  'google earth',
  'google slides', 'google docs', 'google sheets',
  'google streetview', 'google street view', 'google syncview',
  'microsoft teams', 'teams',
  'microsoft powerpoint', 'powerpoint',
  'microsoft onenote', 'onenote',
  'microsoft sway', 'sway',
  'lego spike essential',
  'green screen', 'green screen kits',
  'digital camera', 'digital cameras',
  'apple keynote', 'keynote',
  'banqer',
  'chatgpt', 'claude', 'gemini', 'copilot'
];

function dashboardToolKey_(toolName){
  const raw = String(toolName || '').trim();
  const norm = (typeof normaliseToolName === 'function' ? normaliseToolName(raw) : raw);
  return String(norm || '')
    .toLowerCase()
    .replace(/[’']/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}

function dashboardBannedToolMatch_(toolName){
  const key = dashboardToolKey_(toolName);
  if(!key) return null;

  const candidates = [];
  try{
    if(typeof TOOL_INVENTORY !== 'undefined' && TOOL_INVENTORY && Array.isArray(TOOL_INVENTORY.banned)){
      candidates.push(...TOOL_INVENTORY.banned);
    }
  }catch(e){}
  candidates.push(...DASHBOARD_STATIC_BANNED_TOOLS);

  for(const bannedName of candidates){
    const bk = dashboardToolKey_(bannedName);
    if(!bk) continue;
    if(key === bk || key.includes(bk) || bk.includes(key)){
      return String(bannedName || '').trim() || toolName;
    }
  }
  return null;
}

function isWhitelisted(toolName){
  if(!toolName) return true;
  const raw = String(toolName || '').trim();
  const key = dashboardToolKey_(raw);

  // Banned list always wins, including static legacy bans such as ClassVR.
  if(dashboardBannedToolMatch_(raw)) return false;

  // National Geographic MapMaker variants are approved even if older dashboard code
  // runs before the editable Tool Inventory finishes loading from libraries.json.
  if(/^(national geographic mapmaker|national geographic map maker|nat geo mapmaker|mapmaker)$/.test(key)) return true;

  try{
    if(typeof TOOL_INVENTORY !== 'undefined' && TOOL_INVENTORY){
      const approved = Array.isArray(TOOL_INVENTORY.approved) ? TOOL_INVENTORY.approved : [];
      if(approved.length){
        const isApproved = approved.some(a => {
          const ak = dashboardToolKey_(a);
          return ak && (key === ak || key.includes(ak) || ak.includes(key));
        });
        if(isApproved) return true;
      }
    }
  }catch(e){}

  const t = key;
  return TOOL_WHITELIST.some(w => {
    const wk = dashboardToolKey_(w);
    return wk && (t === wk || t.includes(wk) || wk.includes(t));
  });
}

function getIssues(){
  const incomplete=[], banned=[], duplicates=[], offWhitelist=[], missingPlanner=[];
  DATA.forEach((e,idx)=>{
    const sugs=getSugs(e);
    const realSugs=sugs.filter(isRealSug);
    if(realSugs.length<6) incomplete.push({e,idx,type:'incomplete',detail:`${realSugs.length}/6 — no planner uploaded`});

    const bannedSeen = new Set();
    sugs.forEach((s, slotIdx)=>{
      if(!s || !isRealSug(s)) return;
      // STEM Design Cycle slot (#6, index 5) titles are activity names, not tech tools — skip banned-tool match.
      if(slotIdx === 5) return;
      const tool = sugTool(s);
      const desc = sugDesc(s);
      const bannedTool = dashboardBannedToolMatch_(tool) || dashboardBannedToolMatch_(desc);
      if(!bannedTool) return;
      const bannedKey = dashboardToolKey_(bannedTool);
      const uniqueKey = `${idx}:${slotIdx}:${bannedKey}`;
      if(bannedSeen.has(uniqueKey)) return;
      bannedSeen.add(uniqueKey);
      banned.push({
        e,
        idx,
        type:'banned',
        detail:`${tool || bannedTool} is banned${dashboardToolKey_(tool) !== bannedKey && desc ? ' / mentioned in description' : ''}`
      });
    });

    const tools=realSugs.map(s=>sugTool(s).toLowerCase().trim());
    const seen=new Set();
    tools.forEach(t=>{ if(seen.has(t)) duplicates.push({e,idx,type:'duplicate',detail:`"${sugTool(realSugs[tools.indexOf(t)])}" appears twice`}); seen.add(t); });

    realSugs.forEach((s, slotIdx)=>{
      // STEM Design Cycle slot (#6, index 5) is exempt from whitelist check
      if(slotIdx === 5) return;
      const t=sugTool(s);
      if(t && dashboardBannedToolMatch_(t)) return;
      if(t&&!isWhitelisted(t))
        offWhitelist.push({e,idx,type:'offwhitelist',detail:`"${t}" not in approved list`});
    });

    if(!e.plannerText || e.plannerText.trim().length < 20)
      missingPlanner.push({e,idx,type:'missingplanner',detail:'No planner summary'});
  });
  return {incomplete,banned,duplicates,offWhitelist,missingPlanner};
}

function filterIssueType(label){
  
  const map={'banned':'banned','off whitelist':'offwhitelist','duplicates':'duplicate','no planner':'incomplete','no planner summary':'missingplanner'};
  const type=map[label];
  const el=document.getElementById('issues-list');
  if(!el) return;
  const all=window._ALL_ISSUES||[];
  const filtered=type?all.filter(i=>i.type===type):all;
  el.innerHTML=filtered.length
    ?filtered.map(iss=>issueRowHTML(iss)).join('')
    :'<div style="padding:20px;color:var(--dim);text-align:center">No issues of this type ✓</div>';
  el.scrollIntoView({behavior:'smooth',block:'start'});
}

function renderDashboard(){
  const {incomplete,banned,duplicates,offWhitelist,missingPlanner}=getIssues();
  const total=incomplete.length+banned.length+duplicates.length+offWhitelist.length+missingPlanner.length;
  document.getElementById('db-sub').textContent=`${DATA.length} entries across ${[...new Set(DATA.map(e=>e.ca))].length} campuses — ${total} issue${total!==1?'s':''} found`;
  const statDefs=[
    {label:'total entries',val:DATA.length,bg:'#C5E84A',col:'#111'},
    {label:'no planner',val:incomplete.length,bg:incomplete.length>0?'#F5A623':'#1a1a1a',col:incomplete.length>0?'#111':'#888'},
    {label:'banned tools',val:banned.length,bg:banned.length>0?'#FF8080':'#1a1a1a',col:banned.length>0?'#111':'#888'},
    {label:'duplicates',val:duplicates.length,bg:duplicates.length>0?'#9B8BFF':'#1a1a1a',col:duplicates.length>0?'#fff':'#888'},
    {label:'off whitelist',val:offWhitelist.length,bg:offWhitelist.length>0?'#60B8F0':'#1a1a1a',col:offWhitelist.length>0?'#111':'#888'},
    {label:'no planner',val:missingPlanner.length,bg:missingPlanner.length>0?'#D4A017':'#1a1a1a',col:missingPlanner.length>0?'#111':'#888'},
  ];
  document.getElementById('stat-cards').innerHTML=statDefs.map(({label,val,bg,col})=>`<div class="stat-card" style="background:${bg};border-color:transparent;cursor:pointer" onclick="filterIssueType('${label}')"><div class="stat-num" style="color:${col}">${val}</div><div class="stat-lbl" style="color:${col}">${label}</div></div>`).join('');

  const all=[
    ...banned,
    ...offWhitelist,
    ...duplicates,
    ...incomplete,
    ...missingPlanner,
  ];
  window._ALL_ISSUES = all;
  
  const fixBar = document.getElementById('fix-incomplete-bar');
  if(fixBar){
    const fixBtns = [];
    if(incomplete.length>0) fixBtns.push({count:incomplete.length, label:'Fix no planner', color:'var(--orange)', type:'incomplete', fn:"fixAllOfType('incomplete')"});
    if(duplicates.length>0) fixBtns.push({count:duplicates.length, label:'Fix duplicates', color:'#9B8BFF', type:'duplicate', fn:"fixAllOfType('duplicate')"});
    if(banned.length>0) fixBtns.push({count:banned.length, label:'Fix banned tools', color:'#FF8080', type:'banned', fn:"fixAllOfType('banned')"});
    if(offWhitelist.length>0) fixBtns.push({count:offWhitelist.length, label:'Fix off-list', color:'#60B8F0', type:'offwhitelist', fn:"fixAllOfType('offwhitelist')"});

    if(fixBtns.length > 0){
      fixBar.innerHTML=`
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          ${fixBtns.map(b=>`
            <div style="flex:1;min-width:200px;display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.04);border:1px solid ${b.color}44;border-radius:10px">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700;color:${b.color}">${b.count} ${b.label.toLowerCase().replace('fix ','')}</div>
              </div>
              <button onclick="${b.fn}" style="padding:7px 14px;background:${b.color};color:#111;border:none;border-radius:8px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap">${b.label}</button>
            </div>`).join('')}
        </div>
        <div id="fix-all-progress" style="display:none;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:10px">
          <div style="font-size:13px;color:var(--lime);font-weight:600;margin-bottom:8px" id="fix-all-label">Starting…</div>
          <div style="height:5px;background:var(--card2);border-radius:3px"><div id="fix-all-bar" style="height:100%;border-radius:3px;background:var(--lime);width:0%;transition:width .4s"></div></div>
        </div>`;
    } else {
      fixBar.innerHTML='<div style="padding:10px 14px;background:rgba(197,232,74,0.08);border:1px solid rgba(197,232,74,0.2);border-radius:8px;font-size:13px;color:var(--lime);font-weight:600">✓ No issues — all entries look good</div>';
    }
  }
  document.getElementById('issues-list').innerHTML=all.length
    ? all.map(({e,idx,type,detail})=>{
        const badgeBg={'banned':'#FF8080','incomplete':'#F5A623','duplicate':'#9B8BFF','offwhitelist':'#60B8F0','missingplanner':'#D4A017'}[type]||'#888';
        const badgeCol={'banned':'#111','incomplete':'#111','duplicate':'#fff','offwhitelist':'#111','missingplanner':'#111'}[type]||'#fff';
        const label={'banned':'banned','incomplete':'no planner','duplicate':'duplicate','offwhitelist':'off-list','missingplanner':'no planner'}[type]||type;
        return `<div class="row" onclick="openEntry(${idx})">
          <span style="font-size:11px;padding:4px 11px;border-radius:20px;background:${badgeBg};color:${badgeCol};font-weight:800;letter-spacing:.3px;flex-shrink:0">${label}</span>
          <span style="font-size:13px;color:#9ab89a;width:110px;flex-shrink:0">${esc(e.ca)}</span>
          <span style="font-size:13px;color:var(--gold);font-weight:700;width:70px;flex-shrink:0">${esc(e.yl)}</span>
          <span style="flex:1;font-size:14px;font-weight:600;color:var(--text)">${esc(e.th)}</span>
          <span style="font-size:11px;color:var(--dim)">${detail}</span>
          <span style="color:var(--dim)">›</span>
        </div>`;
      }).join('')
    : '<div style="text-align:center;padding:24px;color:var(--dim);font-size:13px">No issues found ✓</div>';
}


// ========== HUMAN VERIFICATION + REALISM RESCAN HELPERS ==========
function ensureHumanVerificationStyles_(){
  if(document.getElementById('human-verify-styles')) return;
  const style = document.createElement('style');
  style.id = 'human-verify-styles';
  style.textContent = `
    .human-verified-unit{
      border-color:rgba(212,160,23,.95)!important;
      background:linear-gradient(90deg,rgba(212,160,23,.13),rgba(26,26,26,.98) 46%,rgba(197,232,74,.04))!important;
      box-shadow:0 0 0 1px rgba(212,160,23,.42),0 0 24px rgba(212,160,23,.24),inset 0 0 22px rgba(212,160,23,.055);
    }
    .human-verified-unit:hover{
      border-color:var(--gold)!important;
      box-shadow:0 0 0 1px rgba(212,160,23,.75),0 0 32px rgba(212,160,23,.35),inset 0 0 26px rgba(212,160,23,.08);
    }
    .human-verify-flash{animation:humanVerifyGoldFlash 1.25s ease-out 1;}
    @keyframes humanVerifyGoldFlash{
      0%{transform:scale(.992);box-shadow:0 0 0 0 rgba(212,160,23,.9),0 0 0 rgba(212,160,23,0)}
      42%{transform:scale(1.006);box-shadow:0 0 0 4px rgba(212,160,23,.42),0 0 42px rgba(212,160,23,.58)}
      100%{transform:scale(1);}
    }
    .human-verified-tick{
      display:inline-flex;align-items:center;gap:5px;margin-left:10px;padding:3px 10px;border-radius:999px;
      background:rgba(212,160,23,.16);border:1px solid rgba(212,160,23,.68);color:var(--gold);
      font-size:10px;font-weight:900;letter-spacing:.65px;text-transform:uppercase;vertical-align:middle;white-space:nowrap;
      box-shadow:0 0 14px rgba(212,160,23,.18);
    }
    .human-verified-btn,.human-verified-entry-btn{
      padding:7px 12px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--dim);
      font-size:11px;font-weight:900;font-family:inherit;cursor:pointer;letter-spacing:.45px;text-transform:uppercase;white-space:nowrap;
      transition:all .12s ease;
    }
    .human-verified-btn:hover,.human-verified-entry-btn:hover{border-color:var(--gold);color:var(--gold);background:rgba(212,160,23,.08);}
    .human-verified-btn.verified,.human-verified-entry-btn.verified{
      border-color:rgba(212,160,23,.9);background:rgba(212,160,23,.16);color:var(--gold);
      box-shadow:0 0 14px rgba(212,160,23,.16);
    }
    .human-verified-entry-banner{
      padding:9px 14px;background:rgba(212,160,23,.10);border:1px solid rgba(212,160,23,.55);border-radius:10px;margin-bottom:10px;
      color:var(--gold);font-size:12px;font-weight:800;box-shadow:0 0 18px rgba(212,160,23,.12);
    }
  `;
  document.head.appendChild(style);
}

function isHumanVerifiedEntry_(entry){
  return !!(entry && (entry.humanVerified === true || entry.humanVerifiedAt || entry.human_verified === true));
}

function humanVerifiedMeta_(entry){
  if(!entry) return '';
  const bits = [];
  if(entry.humanVerifiedBy) bits.push(entry.humanVerifiedBy);
  if(entry.humanVerifiedAt){
    try { bits.push(new Date(entry.humanVerifiedAt).toLocaleString('en-AU', {dateStyle:'medium', timeStyle:'short'})); }
    catch(e){ bits.push(entry.humanVerifiedAt); }
  }
  return bits.join(' · ');
}

function setHumanVerifiedForEntry_(idx, verified){
  const entry = DATA && DATA[idx];
  if(!entry) return false;
  if(verified){
    entry.humanVerified = true;
    entry.humanVerifiedAt = new Date().toISOString();
    entry.humanVerifiedBy = CURRENT_USER_EMAIL || localStorage.getItem('dla_user_email') || 'DLP team';
  } else {
    entry.humanVerified = false;
    delete entry.humanVerifiedAt;
    delete entry.humanVerifiedBy;
    delete entry.humanVerifiedReason;
  }
  return true;
}

function toggleHumanVerified(idx){
  const entry = DATA && DATA[idx];
  if(!entry) return;
  const next = !isHumanVerifiedEntry_(entry);
  setHumanVerifiedForEntry_(idx, next);
  window._lastHumanVerifiedIdx = next ? idx : null;
  saveToDrive();
  setStatus(next ? `Human verified: ${entry.yl} — ${entry.th}` : `Human verification removed: ${entry.yl} — ${entry.th}`);
  if(typeof renderBrowse === 'function') renderBrowse();
  if(CURRENT_ENTRY_IDX === idx && typeof renderEntry === 'function') renderEntry(idx);
}

function removeAllHumanVerified(){
  if(!DATA || !DATA.length) return;
  const count = DATA.filter(e => isHumanVerifiedEntry_(e)).length;
  if(!count){ setStatus('No verified entries to reset'); return; }
  if(!confirm(`Remove human verification from all ${count} entries? This lets you start verifying from scratch.`)) return;
  DATA.forEach(function(entry, idx){ setHumanVerifiedForEntry_(idx, false); });
  saveToDrive();
  setStatus(`Cleared human verification from ${count} entries`);
  if(typeof renderBrowse === 'function') renderBrowse();
}

// v5.20: Makerspace reboot — calls GAS to replace the 6th suggestion with a new
// catchy hands-on physical project. Processes up to 4 entries per batch.
async function rebootMakerspaceBatch(){
  const ca = document.getElementById('browse-campus')?.value || '';
  const yr = document.getElementById('browse-year')?.value || '';
  const scopeLabel = ca || yr ? ` (${[ca, yr].filter(Boolean).join(' · ')})` : '';
  if(!confirm(`Reboot the Makerspace (#6) suggestion for entries${scopeLabel}? This processes 4 at a time and replaces only suggestion #6 — suggestions 1-5 are preserved.`)) return;

  setStatus(`Rebooting makerspace${scopeLabel}…`, 'loading');
  try {
    const payload = withGASToken({ action: 'rebootMakerspace' });
    if(ca) payload.filterCa = ca;
    if(yr) payload.filterYl = yr;
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if(result.error){ setStatus('Reboot error: ' + result.error, 'error'); return; }
    setStatus(result.message || `Rebooted ${result.rebooted || 0} makerspace projects`, 'success');
    // Reload data from Drive so we see the new suggestions
    if(typeof loadFromDrive === 'function'){
      await loadFromDrive();
      if(typeof renderBrowse === 'function') renderBrowse();
    }
  } catch(err) {
    setStatus('Reboot failed: ' + err.message, 'error');
  }
}

// 2026-05-25: Inspire All — bulk 6-sentence regen across every unit.
// Snapshots data.json once, then loops POSTs to regenerateAllInspiring
// until allDone:true. Each backend call processes 12 units (~3 min) and
// returns progress so the button can show live status. The backend skips
// units already marked inspiringRegenAt so a mid-run failure or refresh
// just resumes where we left off.
async function inspireAllBatch(){
  const ca = document.getElementById('f-campus')?.value || '';
  const yr = document.getElementById('f-year')?.value || '';
  const scopeLabel = ca || yr ? ` (${[ca, yr].filter(Boolean).join(' · ')})` : ' across all 3 campuses';
  if(!confirm(`Regenerate EVERY unit${scopeLabel} in the new 6-sentence inspiring style?\n\n• Units WITHOUT a Central Idea + Lines of Inquiry are SKIPPED (the prompt has nothing to anchor on)\n• data.json will be snapshotted to Drive first (rollback path)\n• Early-years units (3YO, 4YO, Prep) get hands-on + screen-free emphasis\n• ~12 units per batch, ~3 min/batch\n• Estimated total: 25-35 min\n• Progress shows on the ✨ card; safe to leave running\n\nProceed?`)) return;

  const btn = document.getElementById('btn-inspire-all');
  const statusEl = document.getElementById('inspire-all-status');
  if(btn){ btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = '✨ Running…'; }
  let batchNum = 0;
  let totalFixed = 0;
  let totalFailed = 0;
  const allFailures = [];

  // Heartbeat: each backend batch is a single long-running HTTP request
  // (snapshot + 12 OpenAI calls + GitHub push, ~1-3 min). Without a ticking
  // counter the page looks frozen during that wait. This timer updates the
  // status line every second with elapsed time so the user can see work is
  // in progress.
  let heartbeatTimer = null;
  const startHeartbeat = (label) => {
    const t0 = Date.now();
    const tick = () => {
      if(!statusEl) return;
      const secs = Math.floor((Date.now() - t0) / 1000);
      const mm = String(Math.floor(secs / 60)).padStart(1, '0');
      const ss = String(secs % 60).padStart(2, '0');
      statusEl.textContent = `${label} — ${mm}:${ss} elapsed (each batch takes ~1-3 min)`;
    };
    tick();
    heartbeatTimer = setInterval(tick, 1000);
  };
  const stopHeartbeat = () => { if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer = null; } };

  try {
    while(true){
      batchNum++;
      const firstBatchHint = batchNum === 1 ? ' (first batch also snapshots data.json — ~30s extra)' : '';
      startHeartbeat(`Batch ${batchNum} running${firstBatchHint}`);
      setStatus(`Inspire All: batch ${batchNum} processing…`, 'loading');
      // batch=4 keeps each backend call well under Apps Script's hard 6-min
      // execution limit even when the whitelist validator triggers 3 retries
      // per unit (3 retries × ~15s = 45s/unit worst case, ×4 = ~3 min + snapshot
      // + save + push). batch=8 was hitting the 360s wall and the fetch timed
      // out client-side at 369s after the runtime severed the connection.
      const payload = withGASToken({ action: 'regenerateAllInspiring', batch: 4 });
      if(ca) payload.ca = ca;
      if(yr) payload.yl = yr;
      const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      stopHeartbeat();
      if(result.error){
        setStatus('Inspire All error: ' + result.error, 'error');
        if(statusEl) statusEl.textContent = 'Failed: ' + result.error + ' — partial progress saved. Click Inspire All again to resume.';
        return;
      }
      if(result.paused){
        setStatus('Inspire All paused: ' + (result.reason || 'unknown') + (result.until ? ' until ' + result.until : ''), 'error');
        if(statusEl) statusEl.textContent = `Paused (${result.reason || 'unknown'}${result.until ? ' until ' + result.until : ''}). Click Inspire All again to resume.`;
        return;
      }
      totalFixed += result.fixed || 0;
      totalFailed += result.failed || 0;
      if(Array.isArray(result.failures)) allFailures.push(...result.failures);
      const snapNote = result.snapshot && !result.snapshot.alreadyExisted ? ` · snapshot: ${result.snapshot.snapshotName}` : '';
      const skipNote = result.skippedCount ? ` · ${result.skippedCount} skipped (no CI/LOI)` : '';
      if(statusEl) statusEl.textContent = `Batch ${batchNum} done — ${result.done}/${result.total} eligible units regenerated, ${result.remaining} remaining${skipNote}${snapNote}`;
      setStatus(`Inspire All: ${result.done}/${result.total} done (batch ${batchNum})`, 'success');
      if(result.allDone){
        const failNote = totalFailed > 0 ? ` (${totalFailed} failed — see console)` : '';
        const skipMsg = result.skippedCount ? ` · ${result.skippedCount} skipped (need CI + LOI in the planner)` : '';
        setStatus(`✨ Inspire All complete: ${totalFixed} regenerated${failNote}${skipMsg}`, 'success');
        if(statusEl) statusEl.textContent = `Complete — ${totalFixed} regenerated${failNote}${skipMsg}. Reload data to see the new descriptions.`;
        if(allFailures.length) console.warn('Inspire All failures:', allFailures);
        if(Array.isArray(result.skipped) && result.skipped.length) console.info('Inspire All skipped (no CI/LOI):', result.skipped);
        // Reload data so the new descriptions appear in the Studio.
        if(typeof loadFromDrive === 'function'){
          await loadFromDrive();
          if(typeof renderBrowse === 'function') renderBrowse();
        }
        return;
      }
      // Brief pause between batches so the backend lock + GitHub push settle.
      await sleep(2500);
    }
  } catch(err){
    stopHeartbeat();
    setStatus('Inspire All failed: ' + err.message, 'error');
    if(statusEl) statusEl.textContent = 'Failed: ' + err.message + ' — partial progress saved. Click Inspire All again to resume.';
  } finally {
    stopHeartbeat();
    if(btn){ btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '🚀 Inspire all' + (ca || yr ? ' (in view)' : ''); }
  }
}

// 2026-05-25: First Inspire All run leaked off-whitelist + banned tools at
// temperature 0.75 because the inherited validator didn't check the tool
// list. The backend now hard-validates approved/banned membership. This
// helper finds any units the first run wrote with rogue tools and clears
// their inspiringRegenAt so Inspire All redoes ONLY those.
async function inspireAllRequeueBadTools(){
  const ca = document.getElementById('f-campus')?.value || '';
  const yr = document.getElementById('f-year')?.value || '';
  const scopeLabel = ca || yr ? ` for ${[ca, yr].filter(Boolean).join(' · ')}` : '';
  setStatus('Scanning for off-whitelist / banned tools…', 'loading');
  try {
    const payload = withGASToken({ action: 'regenerateAllInspiringRequeueBadTools' });
    if(ca) payload.ca = ca;
    if(yr) payload.yl = yr;
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if(result.error){ setStatus('Requeue error: ' + result.error, 'error'); return; }
    if(!result.found){
      setStatus(`No off-whitelist or banned tools found${scopeLabel}.`, 'success');
      return;
    }
    setStatus(`Cleared inspiringRegenAt on ${result.cleared} unit(s) with rogue tools — click Inspire All to redo them`, 'success');
    console.info(`Inspire All bad-tool units (${result.found}):`, result.units);
    if(typeof loadFromDrive === 'function'){
      await loadFromDrive();
      if(typeof renderBrowse === 'function') renderBrowse();
    }
    if(confirm(`Found ${result.found} unit(s) with off-whitelist or banned tools (cleared their flags). Click OK to start Inspire All now and regenerate them with the tightened validator. The full list is in the browser console.`)){
      inspireAllBatch();
    }
  } catch(err){
    setStatus('Requeue failed: ' + err.message, 'error');
  }
}

async function inspireAllReset(){
  const ca = document.getElementById('f-campus')?.value || '';
  const yr = document.getElementById('f-year')?.value || '';
  const scopeLabel = ca || yr ? ` for ${[ca, yr].filter(Boolean).join(' · ')}` : ' for ALL units';
  if(!confirm(`Reset the Inspire All flags${scopeLabel}? Next run will reprocess every unit from scratch (and create a fresh data.json snapshot). Existing suggestions stay until the regen overwrites them. Proceed?`)) return;
  setStatus('Resetting Inspire All flags…', 'loading');
  try {
    const payload = withGASToken({ action: 'regenerateAllInspiringReset' });
    if(ca) payload.ca = ca;
    if(yr) payload.yl = yr;
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if(result.error){ setStatus('Reset error: ' + result.error, 'error'); return; }
    setStatus(`Cleared inspire flags on ${result.cleared || 0} unit(s)`, 'success');
    if(typeof loadFromDrive === 'function'){
      await loadFromDrive();
      if(typeof renderBrowse === 'function') renderBrowse();
    }
  } catch(err){
    setStatus('Reset failed: ' + err.message, 'error');
  }
}

async function resetMakerspaceFlagsBatch(){
  const ca = document.getElementById('browse-campus')?.value || '';
  const yr = document.getElementById('browse-year')?.value || '';
  const scopeLabel = ca || yr ? ` (${[ca, yr].filter(Boolean).join(' · ')})` : '';
  if(!confirm(`Reset the Makerspace reboot flags for entries${scopeLabel}? This lets you re-run the reboot from scratch — existing #6 suggestions stay until reboot is run again.`)) return;

  setStatus(`Resetting reboot flags${scopeLabel}…`, 'loading');
  try {
    const payload = withGASToken({ action: 'resetMakerspaceFlags' });
    if(ca) payload.filterCa = ca;
    if(yr) payload.filterYl = yr;
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if(result.error){ setStatus('Reset error: ' + result.error, 'error'); return; }
    setStatus(result.message || `Reset ${result.reset || 0} flags`, 'success');
    if(typeof loadFromDrive === 'function'){
      await loadFromDrive();
      if(typeof renderBrowse === 'function') renderBrowse();
    }
  } catch(err) {
    setStatus('Reset failed: ' + err.message, 'error');
  }
}

function markEntryNeedsHumanRecheck_(idx, reason){
  const entry = DATA && DATA[idx];
  if(!entry || !isHumanVerifiedEntry_(entry)) return;
  entry.humanVerified = false;
  entry.humanVerifiedResetAt = new Date().toISOString();
  entry.humanVerifiedResetReason = reason || 'Suggestion changed after human verification';
  delete entry.humanVerifiedAt;
  delete entry.humanVerifiedBy;
}

function isRealismAuditChange_(change){
  const text = [change && change.auditSource, change && change.auditReason, change && change.reason, change && change.flagReason].filter(Boolean).join(' ');
  return /realism|age audit|age-audit|audit-deterministic|too long|unrealistic|age-appropriate|vague|generic|weak/i.test(text);
}

function rescanRealismAfterApprovedFixes_(appliedCount, skippedDupes){
  try{
    const before = (REALISM_AUDIT_RESULTS || []).length;
    runFullRealismAudit();
    const after = (REALISM_AUDIT_RESULTS || []).length;
    const reduced = Math.max(0, before - after);
    const host = document.getElementById('realism-audit-result');
    if(host){
      host.insertAdjacentHTML('afterbegin', `<div style="padding:12px 14px;background:rgba(197,232,74,.09);border:1px solid rgba(197,232,74,.32);border-left:4px solid var(--lime);border-radius:10px;margin-bottom:10px">
        <div style="font-size:13px;font-weight:900;color:var(--lime);margin-bottom:4px">✓ Re-scanned after applying fixes</div>
        <div style="font-size:12px;color:#ddd;line-height:1.55">Applied ${appliedCount} approved fix${appliedCount!==1?'es':''}${skippedDupes?` and skipped ${skippedDupes} duplicate${skippedDupes!==1?'s':''}`:''}. ${reduced ? `The audit now shows ${reduced} fewer flag${reduced!==1?'s':''}.` : 'The audit has refreshed below so remaining flags are current.'}</div>
      </div>`);
    }
  }catch(e){
    console.warn('Auto-rescan after approved fixes failed:', e);
    setStatus('Fixes saved, but automatic rescan failed — run Scan all suggestions again.', 'error');
  }
}

function renderBrowse(){
  ensureHumanVerificationStyles_();
  const ca=document.getElementById('f-campus')?.value||'';
  const yr=document.getElementById('f-year')?.value||'';
  const q=(document.getElementById('f-search')?.value||'').toLowerCase();
  const tool=(document.getElementById('f-tool')?.value||'').toLowerCase();
  const filtered=DATA.map((e,idx)=>({e,idx})).filter(({e})=>{
    if(ca&&e.ca!==ca) return false;
    if(yr&&e.yl!==yr) return false;
    const verifiedText = isHumanVerifiedEntry_(e) ? 'human verified verified checked approved' : '';
    if(q&&!e.th?.toLowerCase().includes(q)&&!verifiedText.includes(q)&&!getSugs(e).some(s=>sugTool(s).toLowerCase().includes(q)||sugDesc(s).toLowerCase().includes(q))) return false;
    if(tool&&!getSugs(e).some(s=>sugTool(s).toLowerCase().includes(tool))) return false;
    return true;
  });
  const verifiedCount = filtered.filter(({e})=>isHumanVerifiedEntry_(e)).length;
  const totalVerifiedCount = DATA.filter(e=>isHumanVerifiedEntry_(e)).length;
  const remainingCount = Math.max(0, DATA.length - totalVerifiedCount);
  document.getElementById('browse-count').textContent=`${filtered.length} entries · ${verifiedCount} human verified in view`;

  // v5.20: Makerspace Reboot summary — counts how many filtered entries have a refreshed makerspace project
  const filteredAudited = filtered.filter(({e}) => e.audited && Array.isArray(e.s) && e.s.length >= 5);
  const filteredRebooted = filteredAudited.filter(({e}) => e.stemRebooted === true).length;
  const filteredAuditedTotal = filteredAudited.length;
  const filteredRebootRemaining = filteredAuditedTotal - filteredRebooted;
  const scopeLabel = ca || yr ? `in view (${[ca, yr].filter(Boolean).join(' · ')})` : 'across all units';
  const makerspaceSummaryHtml = filteredAuditedTotal > 0 ? `<div class="card2" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;border-color:rgba(167,139,250,.35);background:rgba(167,139,250,.06)">
    <span style="font-size:18px">🛠</span>
    <span style="font-size:13px;color:var(--text);font-weight:800">${filteredRebooted}/${filteredAuditedTotal} makerspace projects rebooted ${scopeLabel}</span>
    <span style="font-size:12px;color:var(--dim)">${filteredRebootRemaining > 0 ? `${filteredRebootRemaining} still using the original generated #6 suggestion` : 'All makerspace projects refreshed with catchy hands-on titles'}</span>
    ${filteredRebootRemaining > 0 ? `<button onclick="rebootMakerspaceBatch()" style="margin-left:auto;padding:6px 14px;background:#A78BFA;color:#111;border:none;border-radius:8px;font-weight:800;font-size:12px;cursor:pointer" title="Replace the 6th (Makerspace) suggestion with a new catchy hands-on physical project. Processes 4 at a time.">Reboot makerspace${ca || yr ? ' (in view)' : ''}</button>` : ''}
    ${filteredRebooted > 0 ? `<button onclick="resetMakerspaceFlagsBatch()" style="padding:6px 12px;background:transparent;border:1px solid rgba(255,128,128,.3);color:#FF8080;border-radius:8px;font-weight:600;font-size:11px;cursor:pointer" title="Clear the rebooted flag so you can re-run the makerspace reboot from scratch">Reset reboot flags</button>` : ''}
  </div>` : '';

  const verificationSummaryHtml = `<div class="card2" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-color:${remainingCount ? 'rgba(212,160,23,.35)' : 'rgba(197,232,74,.4)'};background:${remainingCount ? 'rgba(212,160,23,.06)' : 'rgba(197,232,74,.08)'}">
    <span class="human-verified-tick" style="margin-left:0">✓ Human verified audit</span>
    <span style="font-size:13px;color:var(--text);font-weight:800">${totalVerifiedCount}/${DATA.length} units checked</span>
    <span style="font-size:12px;color:var(--dim)">${remainingCount ? `${remainingCount} still need a human check` : 'All units have been human verified'}</span>
    ${totalVerifiedCount > 0 ? `<button onclick="removeAllHumanVerified()" style="margin-left:auto;padding:5px 12px;background:transparent;border:1px solid rgba(255,128,128,0.3);color:#FF8080;border-radius:8px;font-weight:600;font-size:11px;cursor:pointer" title="Clear all human verification flags so you can re-verify from scratch">Reset all verified</button>` : ''}
  </div>`;

  // 2026-05-25: "Inspire All" card — bulk 6-sentence regen across every unit
  // that has both Central Idea (ci) and Lines of Inquiry (lo). Units missing
  // either anchor are counted separately as "skipped" so teachers know what
  // to fill in manually before re-running. Counts units already touched by
  // the inspiringRegenAt marker so the card doubles as a progress display
  // while the looping runner is mid-flight.
  const inspireHasDetails = (e) => !!(e && e.ci && String(e.ci).trim() && e.lo && String(e.lo).trim());
  const inspireEligible = filtered.filter(({e}) => inspireHasDetails(e));
  const inspireSkipped = filtered.filter(({e}) => !inspireHasDetails(e));
  const filteredInspired = inspireEligible.filter(({e}) => e.inspiringRegenAt).length;
  const filteredInspiredTotal = inspireEligible.length;
  const inspiredRemaining = filteredInspiredTotal - filteredInspired;
  const inspireScopeLabel = ca || yr ? `(${[ca, yr].filter(Boolean).join(' · ')})` : 'across all 3 campuses';
  const inspireSkippedTitle = inspireSkipped.length ? inspireSkipped.map(({e}) => {
    const m = [];
    if(!e.ci || !String(e.ci).trim()) m.push('CI');
    if(!e.lo || !String(e.lo).trim()) m.push('LOI');
    return `${e.ca} · ${e.yl} · ${e.th} (missing ${m.join(' + ')})`;
  }).join('\n') : '';
  const inspireSkippedNote = inspireSkipped.length ? ` · <span style="color:#fbbf24;cursor:help" title="${esc(inspireSkippedTitle)}">${inspireSkipped.length} skipped (no CI/LOI)</span>` : '';
  const inspireSummaryHtml = `<div id="inspire-all-card" class="card2" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.06)">
    <span style="font-size:18px">✨</span>
    <span style="font-size:13px;color:var(--text);font-weight:800">${filteredInspired}/${filteredInspiredTotal} units regenerated in 6-sentence inspiring style ${inspireScopeLabel}${inspireSkippedNote}</span>
    <span id="inspire-all-status" style="font-size:12px;color:var(--dim)">${inspiredRemaining > 0 ? `${inspiredRemaining} still using the old 2-3 sentence descriptions` : (filteredInspiredTotal > 0 ? 'All eligible units regenerated — early-years (3YO/4YO/Prep) include hands-on / screen-free options' : 'No eligible units in view')}</span>
    ${inspiredRemaining > 0 ? `<button id="btn-inspire-all" onclick="inspireAllBatch()" style="margin-left:auto;padding:6px 14px;background:#38BDF8;color:#0a1f2e;border:none;border-radius:8px;font-weight:800;font-size:12px;cursor:pointer" title="Regenerate every unit's 6 suggestions in the new 6-sentence inspiring style. Snapshots data.json first. Processes 8 units at a time. Units missing Central Idea or Lines of Inquiry are SKIPPED. The tightened validator now also rejects off-whitelist + banned tools.">🚀 Inspire all${ca || yr ? ' (in view)' : ''}</button>` : ''}
    ${filteredInspired > 0 ? `<button id="btn-inspire-requeue" onclick="inspireAllRequeueBadTools()" style="padding:6px 12px;background:transparent;border:1px solid #FBBF24;color:#FBBF24;border-radius:8px;font-weight:700;font-size:11px;cursor:pointer" title="Scan all inspiring-regenerated units for off-whitelist or banned tools, clear their inspiringRegenAt flag, and offer to redo just those with the tightened validator.">🔍 Re-regen bad tools</button>` : ''}
    ${filteredInspired > 0 ? `<button id="btn-inspire-reset" onclick="inspireAllReset()" style="padding:6px 12px;background:transparent;border:1px solid rgba(255,128,128,.3);color:#FF8080;border-radius:8px;font-weight:600;font-size:11px;cursor:pointer" title="Clear the inspiringRegenAt flag on EVERY unit so Inspire All can be re-run from scratch. Existing suggestions stay until the regen overwrites them.">Reset inspire flags</button>` : ''}
  </div>`;

  document.getElementById('browse-list').innerHTML=inspireSummaryHtml + makerspaceSummaryHtml + verificationSummaryHtml + filtered.map(({e,idx})=>{
    const verified = isHumanVerifiedEntry_(e);
    const flash = window._lastHumanVerifiedIdx === idx ? ' human-verify-flash' : '';
    const meta = verified ? humanVerifiedMeta_(e) : '';
    const tick = verified ? `<span class="human-verified-tick" title="${esc(meta || 'Human verified')}">✓ Human verified</span>` : '';
    const btnText = verified ? '✓ Human verified' : 'Human verify';
    const btnTitle = verified ? `Click to remove human verification${meta ? ' — '+esc(meta) : ''}` : 'Mark this unit as manually checked by a human';
    return `<div class="row ${verified ? 'human-verified-unit' : ''}${flash}" id="browse-row-${idx}" onclick="openEntry(${idx})">
      <span style="font-size:13px;color:#9ab89a;width:110px;flex-shrink:0">${esc(e.ca)}</span>
      <span style="font-size:13px;color:var(--gold);font-weight:700;width:70px;flex-shrink:0">${esc(e.yl)}</span>
      <span style="flex:1;font-size:14px;font-weight:700;color:var(--text);min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="overflow:hidden;text-overflow:ellipsis">${esc(e.th)}</span>${tick}
      </span>
      <button class="human-verified-btn ${verified?'verified':''}" title="${btnTitle}" onclick="event.stopPropagation();toggleHumanVerified(${idx});return false;">${btnText}</button>
      <span style="font-size:13px;color:#9ab89a;min-width:52px;text-align:right">${getSugs(e).length}/6 ›</span>
    </div>`;
  }).join('');
  window._lastHumanVerifiedIdx = null;
}

function renderEntry(idx){
  const e=DATA[idx];
  ensureHumanVerificationStyles_();
  const entryHumanVerified = isHumanVerifiedEntry_(e);
  const entryHumanVerifiedMeta = entryHumanVerified ? humanVerifiedMeta_(e) : '';
  const entryHumanVerifiedBanner = entryHumanVerified ? `<div class="human-verified-entry-banner" title="${esc(entryHumanVerifiedMeta || 'Human verified')}">✓ Human verified${entryHumanVerifiedMeta ? ` · ${esc(entryHumanVerifiedMeta)}` : ''}</div>` : '';
  
  const existingLock = isLocked(idx);
  const lockBanner = existingLock && !isLockedByMe(idx)
    ? `<div style="padding:8px 14px;background:rgba(251,191,36,0.15);border:1px solid #fbbf24;border-radius:8px;margin-bottom:10px;font-size:12px;color:#fbbf24;font-weight:600">
        🔒 ${existingLock.user} is also editing this entry — coordinate before saving
      </div>`
    : `<div style="padding:6px 14px;background:rgba(197,232,74,0.08);border:1px solid rgba(197,232,74,0.2);border-radius:8px;margin-bottom:10px;font-size:11px;color:var(--lime)">
        ✓ Locked by you — others will see this entry is in use
      </div>`;
  document.getElementById('entry-header').innerHTML=lockBanner+entryHumanVerifiedBanner+`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:${(e.ci||e.lo||e.plannerText)?'16px':'0'}">
      <div>
        <h2 style="font-size:24px;font-weight:700;color:#fff;margin-bottom:6px">${esc(e.th)}</h2>
        <p style="font-size:14px;color:var(--dim);font-weight:500">${esc(e.ca)} · ${esc(e.yl)}</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button class="human-verified-entry-btn ${entryHumanVerified?'verified':''}" onclick="toggleHumanVerified(${idx})" title="${entryHumanVerified ? 'Remove human verification' : 'Mark this unit as manually checked by a human'}">${entryHumanVerified ? '✓ Human verified' : 'Human verify'}</button>
        <button onclick="deleteEntry(${idx})" style="flex-shrink:0;padding:7px 14px;background:transparent;border:1px solid #FF8080;color:#FF8080;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit" title="Delete this entry">🗑 Delete</button>
      </div>
    </div>
    ${e.ci?`<div style="padding:12px 16px;background:var(--card2);border-radius:10px;border-left:3px solid var(--gold);margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--gold);margin-bottom:4px">Central Idea</div>
      <div style="font-size:14px;color:var(--text);line-height:1.6;font-style:italic">"${esc(e.ci)}"</div>
    </div>`:''}
    ${e.lo?`<div style="padding:12px 16px;background:var(--card2);border-radius:10px;border-left:3px solid var(--purple);margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--purple);margin-bottom:8px">Lines of Inquiry</div>
      ${e.lo.split(/[;•]/).filter(l=>l.trim()).map((l,i)=>`<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:4px"><span style="font-size:12px;font-weight:700;color:var(--purple);flex-shrink:0">0${i+1}</span><span style="font-size:13px;color:#ccc;line-height:1.5">${esc(l.trim())}</span></div>`).join('')}
    </div>`:''}
    ${e.plannerText?`<div style="padding:12px 16px;background:var(--card2);border-radius:10px;border-left:3px solid var(--blue);margin-bottom:4px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--blue);margin-bottom:4px">Unit Summary</div>
      <div style="font-size:13px;color:#aaa;line-height:1.65">${esc(e.plannerText.length>600?e.plannerText.slice(0,600)+'…':e.plannerText)}</div>
    </div>`:''}`;
  const sugs=getSugs(e);
  document.getElementById('entry-sugs').innerHTML=sugs.length
    ? sugs.map((s,i)=>buildSugRow(s,idx,i)).join('')
    : '<div class="card2" style="color:var(--dim);font-size:12px;font-style:italic">No suggestions yet.</div>';
  document.getElementById('regen-all-result').innerHTML='';
  document.getElementById('btn-regen-all').disabled=false;
  document.getElementById('btn-regen-all').textContent=`Generate 6 new suggestions for ${e.yl}`;
}


function buildSugRow(sug, entryIdx, sugIdx){
  const uid = `s${entryIdx}_${sugIdx}`;
  const tool = sugTool(sug);
  const desc = sugDesc(sug);
  const url = sug.url || null;
  const isStem = sugIdx === 5;
  const linkHtml = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--lime);text-decoration:none;font-weight:700;margin-top:6px;padding:3px 8px;border:1px solid var(--lime);border-radius:6px">↗ View lesson</a>`
    : '';
  const stemBadge = isStem
    ? `<span style="font-size:9px;font-weight:800;padding:3px 10px;border-radius:99px;background:#4361ee;color:#fff;letter-spacing:.8px;text-transform:uppercase;flex-shrink:0">🔬 STEM Design Cycle</span>`
    : '';
  const stemBorder = isStem ? 'border-color:#4361ee' : '';
  const stemCycleLabel = isStem
    ? `<div style="font-size:12px;font-weight:700;color:#4361ee;margin-bottom:8px">🔄 Empathise → Define → Ideate → Prototype → Test → Empathise</div>`
    : '';
  const stemSeparator = isStem
    ? `<div style="display:flex;align-items:center;gap:10px;margin:18px 0 10px"><div style="flex:1;height:1px;background:var(--border)"></div><span style="font-size:10px;font-weight:700;color:#4361ee;letter-spacing:1px;text-transform:uppercase;white-space:nowrap">STEM Idea</span><div style="flex:1;height:1px;background:var(--border)"></div></div>`
    : '';
  return `${stemSeparator}<div class="sug" id="${uid}" style="${stemBorder}">
    <div class="sug-main">
      <div style="display:flex;align-items:center;gap:8px">
        <div class="sug-tool">${esc(tool)}</div>
        ${stemBadge}
        <div style="flex:1"></div>
        <button class="btn-sm" id="${uid}-regen" onclick="regenSingleSug(${entryIdx},${sugIdx})" title="Regenerate this suggestion">↻</button>
        <button class="btn-sm" onclick="openFeedbackChat('${uid}',${entryIdx},${sugIdx})">💬 feedback</button>
      </div>
      ${stemCycleLabel}
      <div class="sug-desc">${linkify(desc)}</div>
      ${linkHtml}
    </div>
  </div>`;
}

function regenAllowsPodcastTool_(entry, currentSug){
  const text = [
    entry?.th, entry?.ci, entry?.lo, entry?.plannerText,
    sugTool(currentSug), sugDesc(currentSug)
  ].filter(Boolean).join(' ').toLowerCase();
  return /podcast|audio|voice|voiceover|voice-over|oral history|interview|narrat|spoken|speaking|listening|soundscape|sound track|soundtrack|radio|recording|record\b|music|garageband/.test(text);
}

function shuffleRegenTools_(arr, seedText){
  const out = [...arr];
  let seed = 0;
  const seedSource = String(seedText || '') + '|' + Date.now() + '|' + Math.random();
  for(let i=0;i<seedSource.length;i++) seed = ((seed << 5) - seed + seedSource.charCodeAt(i)) >>> 0;
  function rand(){ seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }
  for(let i=out.length-1;i>0;i--){
    const j = Math.floor(rand() * (i+1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function regenToolPriorityScore_(tool, entry, freq, isStem){
  const t = normaliseToolName(tool || '');
  const key = t.toLowerCase();
  const unit = [entry?.th, entry?.ci, entry?.lo, entry?.plannerText].filter(Boolean).join(' ').toLowerCase();
  let score = 40;
  const count = freq[t] || 0;
  score -= Math.min(count, 18); // underused tools rise naturally, but not by hard-forcing one platform
  if(isStem){
    if(/sphero|lego spike|micro:bit|codrone|makey makey|3d printer|tinkercad|bee-bot|beebot|indi|minecraft/.test(key)) score += 20;
    if(/seesaw|book creator|padlet|canva/.test(key)) score -= 18;
  }
  if(/where we are|place|time|migration|journey|map|geography|settlement|country|local|community/.test(unit) && /google earth|google maps|minecraft|padlet|canva|book creator/.test(key)) score += 10;
  if(/sharing the planet|sustain|habitat|ecosystem|environment|water|waste|climate|biodiversity|conservation|animal|plant/.test(unit) && /field guide|google earth|micro:bit|minecraft|book creator|canva|padlet|microsoft forms|excel/.test(key)) score += 10;
  if(/how the world works|force|motion|energy|material|machine|system|science|experiment|investig/.test(unit) && /sphero|lego spike|micro:bit|tinkercad|minecraft|makey makey|microsoft excel|forms/.test(key)) score += 10;
  if(/express|identity|culture|story|belief|perspective|communication|arts|celebration/.test(unit) && /book creator|canva|imovie|adobe express|garageband|green screen|puppet pals|chatterpix|wise/.test(key)) score += 10;
  if(/organise|government|economy|market|systems|community services|civics|rules|decision/.test(unit) && /microsoft forms|microsoft excel|canva|padlet|book creator|google maps|wise/.test(key)) score += 8;
  return score;
}

function getRegenerateCandidateTools_(entry, currentSug, sugIdx, freq){
  const currentTool = sugTool(currentSug);
  const isStem = sugIdx === 5;
  const podcastAllowed = regenAllowsPodcastTool_(entry, currentSug);
  const usedKeys = new Set(getSugs(entry).map(s => toolKey(sugTool(s))).filter(Boolean));
  usedKeys.delete(toolKey(currentTool));

  let candidates = getAgeAppropriateTools(entry.yl).filter(t => {
    const k = toolKey(t);
    if(!k || k === toolKey(currentTool)) return false;
    if(usedKeys.has(k)) return false;
    if(toolContainsForbiddenKeyword(t) || toolViolatesInventoryBan(t)) return false;
    if(!podcastAllowed && /podcasting using canva|podcast equipment/i.test(normaliseToolName(t))) return false;
    return true;
  });

  candidates = candidates.sort((a,b) => regenToolPriorityScore_(b, entry, freq, isStem) - regenToolPriorityScore_(a, entry, freq, isStem));
  const top = candidates.slice(0, 18);
  const rest = shuffleRegenTools_(candidates.slice(18), `${entry?.ca}|${entry?.yl}|${entry?.th}|${sugIdx}`);
  const mixedTop = shuffleRegenTools_(top, `${entry?.ca}|${entry?.yl}|${entry?.th}|${sugIdx}|top`);
  return [...mixedTop.slice(0, 12), ...rest.slice(0, 4)];
}

async function regenSingleSug(entryIdx, sugIdx){
  const uid = `s${entryIdx}_${sugIdx}`;
  const btn = document.getElementById(uid+'-regen');
  if(btn){ btn.textContent='Scanning…'; btn.disabled=true; }
  startProgress();

  const entry = DATA[entryIdx];
  const currentSug = getSugs(entry)[sugIdx];
  const currentTool = sugTool(currentSug);
  const others = getSugs(entry).filter((_,i)=>i!==sugIdx).map(s=>sugTool(s)).join(', ');
  const isStem = sugIdx === 5;

  // Fetch rich planner context from GAS — cached per session
  let regenPlannerCtx = entry.plannerContextRich || '';
  if (!regenPlannerCtx) {
    try { regenPlannerCtx = await fetchPlannerContext(entry); } catch(e) {}
  }
  const regenPlannerBlock = regenPlannerCtx
    ? regenPlannerCtx.slice(0, 8000)
    : (entry.plannerText ? entry.plannerText.slice(0, 1500) : '');
  if(btn) btn.textContent = '…';

  const freq = {};
  DATA.forEach(e => {
    getSugs(e).forEach(s => {
      const t = normaliseToolName((s && s.t ? s.t.trim() : ''));
      if(t) freq[t] = (freq[t] || 0) + 1;
    });
  });

  // Age-appropriate tools for this unit's year level. Exclude the current tool and other tools already used in this unit.
  const ageAppropriate = getAgeAppropriateTools(entry.yl).filter(t => toolKey(t) !== toolKey(currentTool));
  const candidateTools = getRegenerateCandidateTools_(entry, currentSug, sugIdx, freq);
  const candidateKeys = new Set(candidateTools.map(toolKey).filter(Boolean));
  const podcastAllowed = regenAllowsPodcastTool_(entry, currentSug);
  const constraintBlock = buildToolConstraints(entry.yl);

  const overused = Object.entries(freq).filter(([t,c]) => c > 13).map(([t])=>t);
  const neverUsed = candidateTools.filter(t => !freq[normaliseToolName(t)]).slice(0, 6);

  const stemInstruction = isStem ? `
THIS IS SUGGESTION #6 — IT MUST BE A STEM DESIGN CYCLE ACTIVITY using the cycle: Empathise → Define → Ideate → Prototype → Test. Use a hands-on maker/robotics tool that is age-appropriate.` : '';

  const podcastGuard = podcastAllowed ? `
Podcast/audio tools are allowed for this regeneration because the current unit or activity includes audio, speaking, interview, narration or sound.` : `
PODCAST GUARD: Do NOT choose Podcasting using Canva or Podcast Equipment for this regeneration. The current unit/activity does not specifically call for podcasting, interviews, audio storytelling, narration or sound work.`;

  const prompt = `You are a Digital Learning Coach at Wesley College generating a fresh technology suggestion for an IB PYP unit.

Unit: ${entry.ca} | ${entry.yl} | "${entry.th}"${entry.ci?`
Central Idea: "${entry.ci}"`:''}${regenPlannerBlock?`
Planner context: ${regenPlannerBlock}`:''}Current suggestion being regenerated: ${currentTool}: ${sugDesc(currentSug)}
Tools already used in this unit (do not repeat): ${others||'none'}

${constraintBlock}
${stemInstruction}
${podcastGuard}

HARD RULES:
- This is a regeneration, not a wording tweak.
- Do NOT use the current tool again: ${currentTool || '(none)'}.
- Do NOT duplicate any other tool already used in this unit.
- Choose exactly ONE tool from this candidate list: ${candidateTools.length ? candidateTools.join(', ') : '(no available candidates)'}.
- Do NOT choose a tool outside the candidate list.
- Do NOT default to Podcasting using Canva. Only use it when podcast/audio work is explicitly central to the activity.

OVERUSED TOOLS (avoid unless perfect fit — already appears 14+ times across library): ${overused.length ? overused.join(', ') : '(none)'}
NEVER-USED candidate tools (fresh ideas): ${neverUsed.length ? neverUsed.join(', ') : '(none)'}

Generate ONE fresh suggestion that is genuinely age-appropriate for ${entry.yl} and connects to this unit's theme.
${SUGGESTION_STYLE}

Return ONLY JSON: {"t":"Tool Name","d":"2-3 vivid sentences connecting to this unit."}`;

  try{
    if(!candidateTools.length) throw new Error('No available age-appropriate tools left for this unit after excluding repeats and banned tools');
    let newSug = null;
    let lastIssue = null;
    for(let attempt=0; attempt<5; attempt++){
      let retryNote = '';
      if(lastIssue === 'same') retryNote = `

RETRY: You used the same tool (${currentTool}). You MUST choose a DIFFERENT tool from this candidate list only: ${candidateTools.join(', ')}.`;
      else if(lastIssue === 'dupe') retryNote = `

RETRY: Previous response used a tool already in this unit. Pick a DIFFERENT tool from this candidate list only: ${candidateTools.join(', ')}.`;
      else if(lastIssue === 'age') retryNote = `

RETRY: Previous response proposed a tool NOT age-appropriate for ${entry.yl}. You MUST pick from: ${candidateTools.join(', ')}.`;
      else if(lastIssue === 'unavailable') retryNote = `

RETRY: Previous response proposed a tool Wesley does NOT have. Pick from this candidate list only: ${candidateTools.join(', ')}.`;
      else if(lastIssue === 'candidate') retryNote = `

RETRY: Previous response chose a tool outside the candidate list. Pick exactly ONE of these tools and no others: ${candidateTools.join(', ')}.`;
      else if(lastIssue === 'podcast') retryNote = `

RETRY: Do NOT choose Podcasting using Canva. This regeneration is not for a podcast, audio interview, narration or sound activity. Pick a different candidate tool: ${candidateTools.join(', ')}.`;

      const raw = await callAI([{role:'user',parts:[{text:prompt+retryNote}]}], null, OPENAI_FAST_MODEL);
      const clean = raw.replace(/```json|```/g,'').trim();
      const si = clean.indexOf('{'), ei = clean.lastIndexOf('}');
      if(si===-1||ei===-1) throw new Error('No JSON');
      const parsed = JSON.parse(clean.slice(si, ei+1));
      if(!parsed.t||!parsed.d) throw new Error('Invalid');

      if(toolKey(parsed.t) === toolKey(currentTool)){
        lastIssue = 'same';
        continue;
      }
      if(wouldDupeInEntry(entry, parsed.t, sugIdx)){
        lastIssue = 'dupe';
        continue;
      }
      const toolLower = normaliseToolName(parsed.t).toLowerCase();
      if(NOT_AVAILABLE_AT_WESLEY.some(na => na.toLowerCase() === toolLower)){
        lastIssue = 'unavailable';
        continue;
      }
      if(!isToolAgeAppropriate(parsed.t, entry.yl)){
        lastIssue = 'age';
        continue;
      }
      if(!candidateKeys.has(toolKey(parsed.t))){
        lastIssue = 'candidate';
        continue;
      }
      if(!podcastAllowed && /podcasting using canva|podcast equipment/i.test(normaliseToolName(parsed.t))){
        lastIssue = 'podcast';
        continue;
      }
      newSug = parsed;
      break;
    }
    if(!newSug){
      const problem = lastIssue === 'same' ? 'AI kept repeating the same tool' :
                      lastIssue === 'age' ? 'AI kept proposing tools not age-appropriate' :
                      lastIssue === 'dupe' ? 'AI kept proposing tools already in this unit' :
                      lastIssue === 'unavailable' ? 'AI kept proposing tools Wesley does not have' :
                      lastIssue === 'candidate' ? 'AI kept choosing tools outside the candidate list' :
                      lastIssue === 'podcast' ? 'AI kept defaulting to Podcasting using Canva for a non-audio activity' :
                      'AI failed after 5 attempts';
      throw new Error(`${problem} — try 💬 feedback with a specific tool name`);
    }

    // Safety-first: do not apply or save immediately. Show before/after for approval.
    window._snapshotReason = `Before regenerating ${currentTool || 'suggestion'} in ${entry.yl} ${entry.th}`;
    showChangesPopup([{ entryIdx, sugIdx, t:newSug.t, d:newSug.d, reason:'Single suggestion regeneration from Browse Library' }]);
    setStatus('Regenerated draft ready for review');
  }catch(e){
    setStatus('Regen failed: '+e.message, 'error');
  }finally{
    stopProgress();
    if(btn){ btn.textContent='↻'; btn.disabled=false; }
  }
}

function openFeedbackChat(uid, entryIdx, sugIdx){
  document.querySelectorAll('.sug-chat-window').forEach(el=>{
    if(el.id !== uid+'-chat') el.remove();
  });
  const existing = document.getElementById(uid+'-chat');
  if(existing){ existing.remove(); delete window['_fbmem_'+uid]; return; }

  // Reset conversation memory for a fresh panel open
  delete window['_fbmem_'+uid];

  const entry = DATA[entryIdx];
  const sug = getSugs(entry)[sugIdx];
  const sugEl = document.getElementById(uid);
  if(!sugEl) return;

  const isStem = sugIdx === 5;
  const ciChip = entry.ci ? `<span class="fb-ci-chip" title="${esc(entry.ci)}">💡 ${esc(entry.ci)}</span>` : '';

  // Quick-action chips — most common edit intents, one tap to fire
  const chips = isStem ? [
    { label: '🔧 Strengthen Design Cycle', prompt: 'Make the Design Cycle phases (Empathise → Define → Ideate → Prototype → Test) more explicit and concrete' },
    { label: '✋ More hands-on', prompt: 'Make this activity more hands-on with physical materials and prototyping' },
    { label: '🎯 Connect to CI', prompt: 'Connect this more explicitly to the central idea' },
    { label: '🔄 Different tool', prompt: 'Suggest the Design Cycle activity using a different age-appropriate maker or robotics tool' },
    { label: '🌱 Try underused', prompt: 'Reframe the Design Cycle using an underused age-appropriate maker tool' },
    { label: '🤝 Group', prompt: 'Reframe this as a small-group collaborative Design Cycle activity' }
  ] : [
    { label: '✋ Hands-on', prompt: 'Make this activity more hands-on and physical for students' },
    { label: '🎯 Connect to CI', prompt: 'Connect this more explicitly to the central idea' },
    { label: '🔄 New tool', prompt: 'Suggest a different age-appropriate tool for this activity' },
    { label: '✨ More vivid', prompt: 'Make the description more vivid and specific — replace generic language with concrete student actions' },
    { label: '🌱 Try underused', prompt: 'Reframe this using an underused age-appropriate tool that fits the unit' },
    { label: '🤝 Group', prompt: 'Reframe this as a collaborative small-group activity' }
  ];

  const chipsHtml = chips.map(c =>
    `<button class="fb-chip" onclick="feedbackQuickAction('${uid}',${entryIdx},${sugIdx},${JSON.stringify(c.prompt).replace(/"/g,'&quot;')})">${esc(c.label)}</button>`
  ).join('');

  const placeholderText = "e.g. make it hands-on · use Sphero BOLT · connect to provocation · simpler · group · change 'students' to 'learners'…";

  const panel = document.createElement('div');
  panel.id = uid+'-chat';
  panel.className = 'sug-chat-window';
  panel.style.cssText = 'background:#0a0f0a;border:1px solid var(--border);border-top:none;border-radius:0 0 12px 12px;overflow:hidden;margin-bottom:12px';
  panel.innerHTML = `
    <div style="padding:10px 16px;background:var(--card2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Edit Suggestion</span>
      <span style="font-size:11px;color:var(--gold);font-weight:600">${esc(sugTool(sug))}</span>
      ${ciChip}
      <div style="flex:1"></div>
      <button onclick="document.getElementById('${uid}-chat').remove();delete window['_fbmem_${uid}']" style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:16px;padding:0">✕</button>
    </div>
    <div style="padding:10px 16px;background:#0a0f0a;border-bottom:1px solid var(--border)">
      <div style="font-size:10px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Quick changes</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${chipsHtml}</div>
    </div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);background:var(--card2)">
      <div id="${uid}-memhint" style="margin-bottom:8px;display:none"></div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:8px;line-height:1.5">Type any request — GPT-4.1 Mini understands tool swaps, refinements, direct edits, curriculum ties, and more.</div>
      <div style="display:flex;gap:8px">
        <button class="btn-sm" onclick="toggleFeedbackVoice('${uid}')" id="${uid}-voice" title="Speak your request (en-AU)" style="padding:8px 10px;flex-shrink:0">🎤</button>
        <input id="${uid}-input" class="inp" placeholder="${esc(placeholderText)}" style="flex:1;margin-bottom:0;font-size:13px" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();applySugFeedbackDirect('${uid}',${entryIdx},${sugIdx})}">
        <button class="btn-pri" id="${uid}-send" onclick="applySugFeedbackDirect('${uid}',${entryIdx},${sugIdx})" style="padding:10px 16px;font-size:13px;white-space:nowrap">Apply →</button>
      </div>
      <div id="${uid}-result" style="margin-top:10px"></div>
    </div>`;

  sugEl.after(panel);
  panel.querySelector(`#${uid}-input`).focus();
}

async function applySugFeedbackDirect(uid, entryIdx, sugIdx){
  const input = document.getElementById(uid+'-input');
  const sendBtn = document.getElementById(uid+'-send');
  const resultEl = document.getElementById(uid+'-result');
  const memHintEl = document.getElementById(uid+'-memhint');
  const instruction = input?.value.trim();
  if(!instruction) return;

  const entry = DATA[entryIdx];
  const sug = getSugs(entry)[sugIdx];
  const others = getSugs(entry).filter((_,i)=>i!==sugIdx).map(s=>sugTool(s)).join(', ');
  const isStem = sugIdx === 5;
  const currentTool = sugTool(sug);
  const currentDesc = sugDesc(sug);
  // 2026-05-18: Detect whether the slot being regenerated is an App Smash
  // combo. If so, the regen prompt should preserve the partner tool by
  // default; teachers who genuinely want to collapse a combo to a single
  // tool can do so via explicit TOOL_SWAP wording. Prevents single-slot
  // regen from silently eroding combos.
  const currentToolParts = currentTool.split(/\s*\+\s*|\s*&\s*|\s+and\s+/i).map(p=>p.trim()).filter(Boolean);
  const currentIsCombo = currentToolParts.length >= 2;
  const explicitlyAsksSingle = /\b(single tool|just one tool|one tool only|not an app ?smash|stop combining|simplify to one)\b/i.test(instruction);
  const preserveCombo = currentIsCombo && !explicitlyAsksSingle;

  // ===== Conversation memory — multi-turn refinements =====
  const memKey = '_fbmem_' + uid;
  if(!window[memKey]) window[memKey] = { instructions: [] };
  window[memKey].instructions.push(instruction);
  const allInstructions = window[memKey].instructions.slice();
  const priorInstructions = allInstructions.slice(0, -1);

  // Update memory hint UI
  if(memHintEl){
    if(priorInstructions.length){
      const memList = priorInstructions.map((p,i)=>`${i+1}. "${esc(p.length>50?p.slice(0,50)+'…':p)}"`).join(' &nbsp;·&nbsp; ');
      memHintEl.style.display = 'block';
      memHintEl.className = 'fb-mem-hint';
      memHintEl.innerHTML = `<span style="font-weight:700">↻ Refining</span> <span style="opacity:.85">${memList}</span> <button onclick="resetFeedbackMemory('${uid}')" style="margin-left:auto;background:transparent;border:none;color:var(--purple);cursor:pointer;font-size:10px;font-weight:700;text-decoration:underline">reset</button>`;
    } else {
      memHintEl.style.display = 'none';
    }
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Scanning planner\u2026';
  startProgress();
  resultEl.innerHTML = '';
  if(typeof ensureLibrariesLoadedForAI === 'function') await ensureLibrariesLoadedForAI();

  // Fetch rich planner context from GAS (reads markdown directly) — cached per session
  let richPlannerCtx = entry.plannerContextRich || '';
  if (!richPlannerCtx) {
    try {
      richPlannerCtx = await fetchPlannerContext(entry);
    } catch (err) {
      console.warn('Planner context fetch failed, using plannerText fallback:', err.message);
    }
  }
  const plannerBlock = richPlannerCtx
    ? richPlannerCtx.slice(0, 8000)
    : (entry.plannerText ? entry.plannerText.slice(0, 1500) : '');

  sendBtn.textContent = 'Thinking\u2026';

  // Age & availability constraints
  const ageAppropriate = getAgeAppropriateTools(entry.yl);
  const constraintBlock = buildToolConstraints(entry.yl);

  // Platform detection from the latest instruction
  const { platform, contextBlock: platformContext } = detectPlatformContext(instruction, entry.yl);

  // Overused / underused awareness
  const freq = {};
  DATA.forEach(e => {
    getSugs(e).forEach(s => {
      const t = normaliseToolName((s && s.t ? s.t.trim() : ''));
      if(t) freq[t] = (freq[t] || 0) + 1;
    });
  });
  const overused = Object.entries(freq).filter(([t,c]) => c > 13).map(([t])=>t);
  const ageAppropriateLower = ageAppropriate.map(t=>t.toLowerCase());
  const underused = Object.entries(freq)
    .filter(([t,c]) => c <= 2 && ageAppropriateLower.includes(t.toLowerCase()))
    .sort((a,b)=>a[1]-b[1])
    .slice(0, 8)
    .map(([t,c])=>`${t} (${c}x)`);

  const stemInstruction = isStem ? `
NOTE: This is suggestion #6 — the STEM Design Cycle slot. Every proposal must frame a hands-on Empathise → Define → Ideate → Prototype → Test activity using an age-appropriate maker/robotics tool.` : '';

  // Lines of inquiry — useful for CURRICULUM_TIE intent
  const loiBlock = entry.lo ? `\nLines of Inquiry: ${entry.lo}` : '';

  // Conversation memory injection — when user refines, prior instructions still apply
  const conversationBlock = priorInstructions.length
    ? `\nCONVERSATION CONTEXT (multi-turn refinement — apply ALL of these together):
${priorInstructions.map((p,i)=>`  Earlier: "${p}"`).join('\n')}
  LATEST: "${instruction}"

The 3 options must satisfy the LATEST instruction AND every earlier instruction in this conversation.`
    : `\nTeacher's instruction: "${instruction}"`;

  const prompt = `You are a Digital Learning Coach at Wesley College improving a technology suggestion for an IB PYP unit.

Unit: ${entry.ca} | ${entry.yl} | "${entry.th}"${entry.ci?`\nCentral Idea: "${entry.ci}"`:''}${loiBlock}${plannerBlock?`\nPlanner context: ${plannerBlock}`:''}
Current suggestion tool: ${currentTool}
Current suggestion description: "${currentDesc}"
Other tools already in this unit (do not repeat): ${others||'none'}
${stemInstruction}

${constraintBlock}
${platformContext}

OVERUSED TOOLS across library (avoid unless teacher specifically names them): ${overused.length ? overused.join(', ') : '(none)'}
UNDERUSED age-appropriate tools (prefer these when suitable): ${underused.length ? underused.join(', ') : '(none)'}

TOOL FIELD RULE:
${preserveCombo ? `- APP SMASH PRESERVATION (HARD RULE): The current suggestion is an App Smash combining ${currentToolParts.map(p=>`"${p}"`).join(' and ')}. The "t" field of EVERY option MUST stay an App Smash in the format "Tool A + Tool B" (literal + sign). Each option's description MUST explicitly use BOTH tools together and explain what each contributes. Do NOT collapse the combo to a single tool. If the teacher's instruction names a specific tool to swap, swap only that side and keep the other partner.` : `- Prefer one clear tool in the "t" field.
- If the teacher explicitly asks for an app smash, you may use "Tool A + Tool B" only when BOTH tools are age-appropriate and neither is banned.`}
- Never include a banned or unavailable tool, even as part of an app smash.
${conversationBlock}

INTENT DETECTION (auto-detect from the teacher's instruction and respond accordingly):

1. DESCRIPTION_REFINE — teacher wants to change style, angle, or emphasis ("more hands-on", "shorter", "more vivid", "more concrete", "less generic", "add scaffolding"). Keep the CURRENT tool (${currentTool}). Return 3 different description variants of the activity, all using ${currentTool}, each taking a distinct angle on the refinement.

2. TOOL_SWAP — teacher names a specific tool ("use Canva", "swap for Sphero BOLT", "change to Minecraft"). Use ONLY that tool in all 3 options, with 3 different activity ideas. If the named tool is not age-appropriate or not available at Wesley, return 3 close alternatives and politely note the issue in the description of option 1.

3. TOOL_BROWSE — teacher asks for alternatives without naming one ("different tool", "something else", "what else", "any alternative", "try something new"). Return 3 options each using a DIFFERENT age-appropriate tool not already in this entry. Prefer underused tools.

4. DIRECT_EDIT — teacher gives literal text instruction ("change 'X' to 'Y'", "replace X with Y", "remove the bit about X", "add a sentence about Y", "use 'learners' instead of 'students'"). Apply the edit literally to the current description. Option 1 should be the closest exact edit; options 2 and 3 can be lightly polished variants. All keep the same tool and same overall activity unless the teacher explicitly names a new tool.

5. STEM_REFRAME — teacher asks for hands-on Design Cycle / maker / robotics activity. Restructure the activity as Empathise → Define → Ideate → Prototype → Test using an age-appropriate maker/robotics tool. All 3 options should follow the Design Cycle.

6. CURRICULUM_TIE — teacher asks to connect to central idea, lines of inquiry, provocation, or transdisciplinary theme. Reference the relevant curriculum element explicitly in each option using a direct phrase from the central idea or lines of inquiry above. Tool can stay the same or change — your choice based on best fit.

7. DIFFICULTY_ADJUST — "simpler", "easier", "more rigorous", "more challenging", "more scaffolding", "extension for advanced students". Keep the tool unless teacher names a new one; adjust complexity, vocabulary, and scaffolding in the description.

8. OUTPUT_TYPE — teacher specifies an artefact ("produce a video", "create a podcast", "make a poster", "build a model", "design a poster"). Reframe the activity to produce that specific output, choosing or keeping a tool that supports it.

9. SOCIAL_MODE — "group", "individual", "pairs", "collaborative", "small-group", "whole-class". Reframe collaboration structure of the activity.

10. TIME_BOUND — "shorter", "single lesson", "extend over a week", "5-minute warm-up", "full unit". Adjust scope and duration to fit.

If MULTIPLE intents apply (e.g. "use Sphero BOLT and make it more hands-on"), satisfy all of them.
If intent is AMBIGUOUS or UNCLEAR, default to TOOL_BROWSE and return 3 different age-appropriate tool options.

NEGATIVE INSTRUCTIONS:
If the teacher says "do not", "don't", "avoid", "not X", "but not X", or "without X", exclude that tool, wording, or approach completely from all 3 options.

GENERAL RULES:
- Every tool must be in the age-appropriate list above.
- Every description must connect specifically to this unit's content — nothing generic.
- Each of the 3 options must be MEANINGFULLY different from the others — different tools, OR different angles on the same tool.
${SUGGESTION_STYLE}

Return ONLY a JSON array of exactly 3 suggestions:
[{"t":"Tool Name","d":"2-3 vivid sentences."},{"t":"Tool Name","d":"2-3 vivid sentences."},{"t":"Tool Name","d":"2-3 vivid sentences."}]`;

  try{
    const raw = await callAI([{role:'user',parts:[{text:prompt}]}], null, OPENAI_FAST_MODEL);
    const clean = raw.replace(/```json|```/g,'').trim();
    const si = clean.indexOf('['), ei = clean.lastIndexOf(']');
    if(si===-1||ei===-1) throw new Error('No suggestions returned');
    const rawSugs = JSON.parse(clean.slice(si, ei+1));
    if(!rawSugs.length) throw new Error('Empty response');

    // Filter out: duplicates, unavailable tools, age-inappropriate tools.
    // If the original slot was an App Smash, also reject options that
    // collapsed the combo to a single tool (so combos can't silently erode
    // through the single-slot regen flow).
    const filtered = [];
    const rejected = [];
    rawSugs.forEach(s => {
      if(!s || !s.t) return;
      if(preserveCombo && !/\+/.test(s.t)){
        rejected.push({t:s.t, reason:'collapsed App Smash combo to single tool'}); return;
      }
      if(wouldDupeToolProposalInEntry(entry, s.t, sugIdx)){ rejected.push({t:s.t, reason:'already in this unit'}); return; }
      if(toolContainsForbiddenKeyword(s.t)){ rejected.push({t:s.t, reason:'forbidden tool'}); return; }
      if(toolViolatesInventoryBan(s.t)){ rejected.push({t:s.t, reason:'not available at Wesley'}); return; }
      if(!isToolAgeAppropriate(s.t, entry.yl)){
        rejected.push({t:s.t, reason:`not age-appropriate for ${entry.yl}`}); return;
      }
      filtered.push(s);
    });

    if(!filtered.length){
      const rejectedNote = rejected.length
        ? `All ${rejected.length} options were rejected:\n${rejected.map(r=>`• ${r.t} (${r.reason})`).join('\n')}`
        : 'All options duplicate tools already in this unit';
      throw new Error(rejectedNote + '\n\nTry rephrasing — e.g. name a different tool or ask for "any age-appropriate alternative".');
    }

    window['_fbsugs_'+uid] = filtered;

    let rejectedBanner = '';
    if(rejected.length){
      rejectedBanner = `<div style="padding:8px 12px;background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.3);border-radius:8px;margin-bottom:8px;font-size:11px;color:var(--gold);line-height:1.5">
        <strong>⚠ Filtered ${rejected.length} option${rejected.length!==1?'s':''}:</strong> ${rejected.map(r => `${esc(r.t)} (${r.reason})`).join(' · ')}
      </div>`;
    }

    resultEl.innerHTML = rejectedBanner + filtered.map((s,i) => `
      <div style="padding:10px 14px;background:#0a1a0a;border:1px solid #1e3a1e;border-radius:8px;margin-bottom:8px">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700;color:var(--lime);margin-bottom:2px">${esc(s.t)}</div>
            <div style="font-size:12px;color:#aaa;line-height:1.5">${esc(s.d)}</div>
          </div>
          <button onclick="confirmSugFeedback(${entryIdx},${sugIdx},'${uid}',${i})" style="flex-shrink:0;padding:7px 14px;background:var(--lime);color:#111;border:none;border-radius:8px;font-weight:800;font-size:12px;cursor:pointer">Apply</button>
        </div>
      </div>`).join('') +
      `<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
        <button onclick="feedbackGetMore('${uid}',${entryIdx},${sugIdx})" style="padding:6px 12px;background:transparent;border:1px solid var(--border);color:var(--lime);border-radius:8px;font-weight:600;font-size:11px;cursor:pointer" title="Get 3 fresh options keeping the same context">🔄 More options</button>
        <button onclick="resetFeedbackMemory('${uid}')" style="padding:6px 12px;background:transparent;border:1px solid var(--border);color:var(--dim);border-radius:8px;font-weight:600;font-size:11px;cursor:pointer" title="Clear conversation context and start fresh">↻ Reset</button>
        <button onclick="document.getElementById('${uid}-result').innerHTML='';document.getElementById('${uid}-input').value=''" style="padding:6px 12px;background:transparent;border:1px solid var(--border);color:var(--dim);border-radius:8px;font-weight:600;font-size:11px;cursor:pointer">Clear</button>
      </div>`;

    // Clear input ready for next refinement
    if(input) input.value = '';

  }catch(e){
    const isParseError = e.message.includes('JSON') || e.message.includes('No suggestions') || e.message.includes('Empty');
    const msg = isParseError
      ? 'AI returned an unexpected format. Try being more specific, e.g. "change the tool to Canva" or "make this about the provocation activity".'
      : e.message.replace(/\n/g, '<br>');
    resultEl.innerHTML = `<div style="font-size:12px;color:#f87171;line-height:1.5">\u2717 ${msg}</div>`;
    // Roll back this turn from memory since it failed
    if(window[memKey] && window[memKey].instructions.length){
      window[memKey].instructions.pop();
    }
  }
  stopProgress();
  sendBtn.disabled = false;
  sendBtn.textContent = 'Apply \u2192';
}

// ===== FEEDBACK HELPERS — quick chips, voice, more options, memory reset =====

function feedbackQuickAction(uid, entryIdx, sugIdx, prompt){
  const input = document.getElementById(uid+'-input');
  if(!input) return;
  input.value = prompt;
  // Slight delay so the user sees what's being submitted
  setTimeout(() => applySugFeedbackDirect(uid, entryIdx, sugIdx), 150);
}

let _fbVoiceRec = null;
function toggleFeedbackVoice(uid){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    alert('Voice input not supported in this browser. Try Chrome or Edge.');
    return;
  }
  // Stop any active recognition
  if(_fbVoiceRec){
    try { _fbVoiceRec.stop(); } catch{}
    _fbVoiceRec = null;
    return;
  }
  const btn = document.getElementById(uid+'-voice');
  const input = document.getElementById(uid+'-input');
  _fbVoiceRec = new SR();
  _fbVoiceRec.lang = 'en-AU';
  _fbVoiceRec.interimResults = true;
  _fbVoiceRec.continuous = false;

  let finalText = '';
  _fbVoiceRec.onstart = () => {
    if(btn){ btn.textContent = '🛑'; btn.style.background = '#FF6B6B'; btn.style.color = '#FFF'; btn.style.borderColor = '#FF6B6B'; }
  };
  _fbVoiceRec.onresult = (e) => {
    let interim = '';
    for(let i = e.resultIndex; i < e.results.length; i++){
      const transcript = e.results[i][0].transcript;
      if(e.results[i].isFinal) finalText += transcript + ' ';
      else interim += transcript;
    }
    if(input) input.value = (finalText + interim).trim();
  };
  _fbVoiceRec.onerror = (e) => {
    console.warn('Feedback voice error:', e.error);
    if(btn){ btn.textContent = '🎤'; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
    _fbVoiceRec = null;
    if(e.error === 'not-allowed') alert('Microphone access denied. Check browser permissions.');
  };
  _fbVoiceRec.onend = () => {
    if(btn){ btn.textContent = '🎤'; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
    if(finalText && input){ input.value = finalText.trim(); input.focus(); }
    _fbVoiceRec = null;
  };
  try { _fbVoiceRec.start(); } catch(e){ console.warn(e); _fbVoiceRec = null; }
}

function feedbackGetMore(uid, entryIdx, sugIdx){
  const input = document.getElementById(uid+'-input');
  if(!input) return;
  // Re-fire keeping conversation memory intact, asking for fresh alternatives
  input.value = 'Show me 3 more different options that still satisfy the previous instructions';
  applySugFeedbackDirect(uid, entryIdx, sugIdx);
}

function resetFeedbackMemory(uid){
  delete window['_fbmem_'+uid];
  const memHintEl = document.getElementById(uid+'-memhint');
  if(memHintEl){ memHintEl.style.display = 'none'; memHintEl.innerHTML = ''; }
  const resultEl = document.getElementById(uid+'-result');
  if(resultEl) resultEl.innerHTML = '<div style="font-size:11px;color:var(--dim);padding:6px 0">↻ Conversation reset — next request starts fresh</div>';
  const input = document.getElementById(uid+'-input');
  if(input){ input.value = ''; input.focus(); }
}


function confirmSugFeedback(entryIdx, sugIdx, uid, choiceIdx){
  const suggestions = window['_fbsugs_'+uid];
  if(!suggestions || !suggestions[choiceIdx]) return;
  const newSug = cleanSuggestionObject_(suggestions[choiceIdx]);
  // Safety net: if another slot was changed between showing options and confirming, abort
  if(wouldDupeToolProposalInEntry(DATA[entryIdx], newSug.t, sugIdx)){
    setStatus(`Skipped \u2014 "${newSug.t}" is already used in this unit`, 'error');
    return;
  }
  const realism = checkRealisticToolUse(newSug.t, newSug.d, DATA[entryIdx]);
  if(!realism.ok){
    setStatus(`Skipped \u2014 unrealistic classroom use: ${realism.reason}`, 'error');
    return;
  }
  const sugs = [...getSugs(DATA[entryIdx])];
  sugs[sugIdx] = {t: newSug.t, d: newSug.d};
  recordChange(entryIdx, getSugs(DATA[entryIdx]), sugs);
  DATA[entryIdx].s = sugs;
  DATA[entryIdx].audited = true;
  markEntryNeedsHumanRecheck_(entryIdx, 'Suggestion feedback edit applied after human verification');
  saveToDrive();
  setStatus('Suggestion updated and saved');
  delete window['_fbsugs_'+uid];
  delete window['_fbmem_'+uid];  // clear conversation memory after a successful apply
  document.getElementById(uid+'-chat')?.remove();
  const sugEl = document.getElementById(`s${entryIdx}_${sugIdx}`);
  if(sugEl){
    const newRow = document.createElement('div');
    newRow.innerHTML = buildSugRow(sugs[sugIdx], entryIdx, sugIdx);
    sugEl.replaceWith(newRow.firstElementChild);
  }
}



async function regenAll(){
  if(CURRENT_ENTRY_IDX===null) return;
  const idx=CURRENT_ENTRY_IDX;
  const entry=DATA[idx];
  const btn=document.getElementById('btn-regen-all');
  const res=document.getElementById('regen-all-result');
  btn.disabled=true; btn.textContent='Generating…';
  startProgress();
  res.innerHTML='<div style="font-size:12px;color:#fbbf24">Generating 5 suggestions…</div>';
  const prompt=`Generate exactly 6 digital technology suggestions for this IB PYP unit.
Suggestion #6 MUST be a STEM Design Cycle activity (Empathise-Define-Ideate-Prototype-Test).
Campus: ${entry.ca} | Year Level: ${entry.yl} | Theme: "${entry.th}"${entry.ci?`\nCentral Idea: "${entry.ci}"`:''}${entry.lo?`\nLines of Inquiry: "${entry.lo}"`:''}${entry.plannerText?`\nPlanner: ${entry.plannerText}`:''}
Requirements:
- All 5 suggestions use different tools (no repeats)
${SUGGESTION_STYLE}
${appSmashRequirementForEntry_(entry)}
- Return ONLY a JSON array with no markdown or backticks:
[{"t":"Tool Name or Tool A + Tool B","d":"2-3 vivid sentences for this unit."},...]`;
  try{
    let sugs = null;
    let dupedTool = null;
    let lastSmashCount = 0;
    let lastDupOpener = '';
    let lastFailReason = '';
    for(let attempt=0; attempt<3; attempt++){
      let retryNote = '';
      if(attempt>0 && lastFailReason === 'dup'){
        retryNote = `\n\nRETRY ${attempt}: Your previous response used "${dupedTool}" twice. Every one of the 5 suggestions MUST use a DIFFERENT tool \u2014 no repeats whatsoever.`;
      } else if(attempt>0 && lastFailReason === 'smash'){
        retryNote = `\n\nRETRY ${attempt}: Your previous response had only ${lastSmashCount} App Smash${lastSmashCount===1?'':'es'} in slots 1-5. You MUST return at least 2 entries whose "t" field uses the "Tool A + Tool B" format with both tools approved and age-appropriate.`;
      } else if(attempt>0 && lastFailReason === 'opener-dup'){
        retryNote = `\n\nRETRY ${attempt}: Your previous response used "${lastDupOpener}" as the slot-1 App Smash, but another unit in this campus + year level already opens with that exact pair. Slot 1 MUST be a DIFFERENT App Smash pair that specifically suits THIS unit's theme.`;
      }
      const raw=await callAI([{role:'user',parts:[{text:prompt+retryNote}]}]);
      const clean=raw.replace(/```json|```/g,'').trim();
      const si=clean.indexOf('['), ei=clean.lastIndexOf(']');
      if(si===-1||ei===-1) throw new Error('No JSON array in response');
      const parsed=JSON.parse(clean.slice(si,ei+1));
      const keys=parsed.map(s=>toolKey(sugTool(s))).filter(Boolean);
      const dup=keys.find((k,i)=>keys.indexOf(k)!==i);
      if(dup){
        const dupSug=parsed.find(s=>toolKey(sugTool(s))===dup);
        dupedTool = dupSug ? sugTool(dupSug) : dup;
        lastFailReason = 'dup';
        continue;
      }
      lastSmashCount = appSmashCountInRegen_(parsed);
      if(lastSmashCount < 2){ lastFailReason = 'smash'; continue; }
      const openerDup = openerDupesSiblingInYear_(entry, parsed);
      if(openerDup){ lastDupOpener = openerDup; lastFailReason = 'opener-dup'; continue; }
      sugs = parsed;
      break;
    }
    if(!sugs){
      if(lastFailReason === 'smash') throw new Error(`AI returned only ${lastSmashCount} App Smash${lastSmashCount===1?'':'es'} after 3 attempts \u2014 not saving. Try regen again or adjust the unit.`);
      if(lastFailReason === 'opener-dup') throw new Error(`AI kept reusing "${lastDupOpener}" as the opener after 3 attempts \u2014 try regen again or adjust manually.`);
      throw new Error(`AI repeated "${dupedTool}" in the batch \u2014 try again`);
    }
    const pendingId='regenall_'+idx;
    window[pendingId]=sugs;
    res.innerHTML=`
      <div style="font-size:10px;color:var(--mint);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Preview — apply to save</div>
      ${sugs.map(s=>`<div class="preview-ok"><div class="preview-tool">${esc(s.t)}</div><div class="preview-desc">${esc(s.d)}</div></div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn-pri" onclick="applyRegenAll(${idx},'${pendingId}')">Apply all</button>
        <button class="btn-sm" onclick="document.getElementById('regen-all-result').innerHTML='';document.getElementById('btn-regen-all').disabled=false;document.getElementById('btn-regen-all').textContent='Generate 6 new suggestions'">Discard</button>
      </div>`;
  }catch(e){
    res.innerHTML=`<div style="font-size:12px;color:#f87171">${esc(e.message)}</div>`;
    stopProgress();
  btn.disabled=false; btn.textContent='Generate 6 new suggestions';
  }
}

function applyRegenAll(idx,pendingId){
  const sugs=window[pendingId]; if(!sugs) return;
  const cleaned=sugs.map(cleanSuggestionObject_);
  // 2026-05-22: Refuse to persist any regen that drops the unit below the
  // >=2-App-Smashes-in-slots-1-5 floor. The previous "save with audited=false
  // and let the backend re-audit" branch was the silent wipe path responsible
  // for the 2026-04-15 incident AND the 2026-05-20 wipe (239 lost). The
  // pending suggestions stay in window[pendingId] so the user can adjust
  // and apply, or click Discard.
  const appSmashCount=appSmashCountInRegen_(cleaned);
  if(appSmashCount < 2){
    const res=document.getElementById('regen-all-result');
    if(res){
      res.innerHTML = `<div style="padding:10px;border:1px solid #f87171;border-radius:8px;background:rgba(248,113,113,0.08);font-size:12px;color:#f87171;line-height:1.5">
        <strong>App Smash floor not met</strong> — only ${appSmashCount} App Smash${appSmashCount===1?'':'es'} in slots 1-5 (need 2+). The original suggestions have been kept.<br>Click <em>Generate 6 new suggestions</em> again, or pick the smashes manually before applying.
      </div>` + res.innerHTML;
    }
    setStatus(`Regen refused — only ${appSmashCount} App Smash${appSmashCount===1?'':'es'} (need 2+). Original kept.`, 'error');
    return;
  }
  DATA[idx].s=cleaned;
  DATA[idx].audited=true;
  markEntryNeedsHumanRecheck_(idx, 'Regenerated suggestions after human verification');
  delete window[pendingId];
  setStatus('Saved');
  saveToDrive();
  renderEntry(idx);
}

function getSugs(e){ return normEntry(e); }

function sugTool(s){
  if(!s) return '';
  if(typeof s==='string') return s;
  return s.t||s.tool||s.technology||s.equipment||s.name||s.title||'';
}

function sugDesc(s){
  if(!s) return '';
  if(typeof s==='string') return '';
  return s.d||s.desc||s.description||s.integration_idea||s.activity_description
    ||s.justification||s.unit_connection||s.application||s.suggested_activity
    ||s.integration_suggestion||s.learning_experience||s.activity_idea
    ||s.implementation_idea||s.text||'';
}

function normSug(s){
  if(!s) return null;
  if(typeof s==='string') return s.trim()?{t:s.trim(),d:''}:null;
  const t=sugTool(s).trim();
  const d=sugDesc(s).trim();
  if(!t) return null;
  const out = {t, d};
  if(s.url) out.url = s.url;
  return out;
}

function normEntry(e){
  const s=e.s;
  let arr=[];
  if(Array.isArray(s)) arr=s;
  else if(s && typeof s==='object') arr=Object.values(s);
  else return [];
  return arr.map(normSug).filter(x=>x&&x.t&&x.t!=='TBA'&&x.t.trim()!=='');
}

function isRealSug(s){ return !!(s && sugTool(s).trim()); }

// Split any suggestion that has combined tools like "Minecraft & OneNote" into two separate suggestions
// Called during ingest and after any bulk operation
function splitCombinedSugs(data){
  return data.map(e=>{
    if(!e.s || !Array.isArray(e.s)) return e;
    const expanded = [];
    e.s.forEach(s=>{
      const tool = (s.t||'').trim();
      const parts = tool.split(/\s*[&+]\s*|\s+and\s+/i).map(t=>t.trim()).filter(Boolean);
      if(parts.length > 1){
        // Split into separate suggestions, keeping the description on the first one
        parts.forEach((t,i)=>expanded.push({t, d: i===0 ? (s.d||'') : ''}));
      } else {
        expanded.push(s);
      }
    });
    // Keep only first 5
    return {...e, s: expanded.slice(0,5)};
  });
}

function normCa(ca){
  return ca||'';  
}

function normaliseToolName(t){
  // Canonical forms for known variants
  const map = {
    'bee-bot':'Beebots','bee-bots':'Beebots','beebot':'Beebots','beebots':'Beebots',
    'micro:bit':'Micro:bit','microbit':'Micro:bit','micro:bits':'Micro:bit','microbits':'Micro:bit',
    'scratchjr':'ScratchJr','scratch jr':'ScratchJr','scratch junior':'ScratchJr',
    'chatterpix':'ChatterPix Kids','chatterpix kids':'ChatterPix Kids',
    'stop motion studio':'Stop Motion Studio','stopmotion':'Stop Motion Studio',
    'animating a character with adobe express':'Animating a Character with Adobe Express',
    'adobe express animate from audio':'Animating a Character with Adobe Express',
    'animate from audio':'Animating a Character with Adobe Express',
    'adobe express character animator':'Animating a Character with Adobe Express',
    'character animator':'Animating a Character with Adobe Express',
    'animate character':'Animating a Character with Adobe Express',
    'adobe express podcasting':'Podcasting using Canva',
    'podcasting using canva':'Podcasting using Canva',
    'canva podcast':'Podcasting using Canva',
    'canva podcasting':'Podcasting using Canva',
    'adobe express video':'Adobe Express Video',
    'lego spike prime':'Lego Spike Prime','lego spike essential':'Lego Spike Essential',
    'sphero bolt':'Sphero BOLT','sphero indi':'Sphero Indi',
    'microsoft onenote':'Microsoft OneNote','onenote':'Microsoft OneNote',
    'microsoft powerpoint':'Microsoft PowerPoint','powerpoint':'Microsoft PowerPoint',
    'microsoft word':'Microsoft Word','microsoft teams':'Microsoft Teams',
    'microsoft forms':'Microsoft Forms','forms':'Microsoft Forms','ms forms':'Microsoft Forms','office forms':'Microsoft Forms',
    'microsoft sway':'Microsoft Sway','sway':'Microsoft Sway','ms sway':'Microsoft Sway','office sway':'Microsoft Sway','m365 sway':'Microsoft Sway',
    'wise discussion chatbots':'Wise Discussion Chatbots','wise discussion chatbot':'Wise Discussion Chatbots','wise chatbot':'Wise Discussion Chatbots','wise chatbots':'Wise Discussion Chatbots','schoolbox discussion chatbots':'Wise Discussion Chatbots','schoolbox ai discussion chatbots':'Wise Discussion Chatbots','ai discussion chatbots':'Wise Discussion Chatbots','ai discussion chatbot':'Wise Discussion Chatbots',
    'microsoft excel':'Microsoft Excel','excel':'Microsoft Excel','ms excel':'Microsoft Excel','office excel':'Microsoft Excel',
    'word':'Microsoft Word','ms word':'Microsoft Word','office word':'Microsoft Word',
    'teams':'Microsoft Teams','ms teams':'Microsoft Teams','office teams':'Microsoft Teams',
    'google earth':'Google Earth','google maps':'Google Maps',
    'google streetview':'Google Streetview','google street view':'Google Streetview','google syncview':'Google Streetview',
    'google slides':'Google Slides','google docs':'Google Docs','google sheets':'Google Sheets',
    'flip':'Flip','microsoft flip':'Flip',
    'book creator':'Book Creator','garageband':'GarageBand',
    'imovie':'iMovie','piccollage':'PicCollage','tinkercad':'Tinkercad',
    'minecraft education':'Minecraft Education',
    'puppet pals':'Puppet Pals','padlet':'Padlet','seesaw':'Seesaw','canva':'Canva',
  };
  const key = t.toLowerCase().trim();
  if(map[key]) return map[key];
  // Pattern-based: collapse lesson-specific variants to the base tool name
  // e.g. "Minecraft: Ocean Heroes" → "Minecraft Education"
  // e.g. "Micro:bit — Helping Plants Grow" → "Micro:bit"
  if(key.startsWith('minecraft')) return 'Minecraft Education';
  if(key.startsWith('micro:bit') || key.startsWith('microbit')) return 'Micro:bit';
  // Handle "Tool Name Activity/Lesson" patterns: extract just the tool
  if(key.startsWith('bee-bot') || key.startsWith('beebot')) return 'Beebots';
  if(key.startsWith('sphero indi') || key === 'indi') return 'Sphero Indi';
  if(key.startsWith('sphero bolt') || key.startsWith('sphero b.o.l.t')) return 'Sphero BOLT';
  if(key.startsWith('sphero')) return 'Sphero';
  if(key.startsWith('lego spike essential')) return 'Lego Spike Essential';
  if(key.startsWith('lego spike prime')) return 'Lego Spike Prime';
  if(key.startsWith('lego spike') || key.startsWith('lego')) return 'Lego Spike';
  if(key.startsWith('codrone')) return 'CoDrone EDU';
  if(key.startsWith('chatterpix')) return 'ChatterPix Kids';
  if(key.startsWith('scratchjr') || key.startsWith('scratch jr') || key.startsWith('scratch junior')) return 'ScratchJR';
  if(key.startsWith('scratch')) return 'Scratch';
  if(key.startsWith('adobe express')) return 'Adobe Express';
  if(key.startsWith('stop motion')) return 'Stop Motion Studio';
  if(key.startsWith('puppet pals')) return 'Puppet Pals';
  if(key.startsWith('green screen')) return 'Green Screen';
  if(key.startsWith('merge cube')) return 'Merge Cubes';
  if(key.startsWith('classvr')) return 'ClassVR';
  if(key.startsWith('delightex') || key.startsWith('cospaces')) return 'Delightex';
  if(key.startsWith('google earth')) return 'Google Earth';
  if(key.startsWith('google maps')) return 'Google Maps';
  if(key.startsWith('google streetview') || key.startsWith('google street view') || key.startsWith('google syncview')) return 'Google Streetview';
  if(key.startsWith('google slides')) return 'Google Slides';
  if(key.startsWith('google docs')) return 'Google Docs';
  if(key.startsWith('google sheets')) return 'Google Sheets';
  if(key === 'flip' || key.startsWith('flip ') || key === 'flipgrid') return 'Flip';
  if(key.startsWith('makey makey') || key.startsWith('makeymakey')) return 'Makey Makey';
  if(key.startsWith('3d print')) return '3D Printers';
  if(key.startsWith('field guide')) return 'Field Guide to Victoria';
  if(key.startsWith('word cloud') || key.startsWith('abcya')) return 'Word Clouds ABCya';
  if(key.startsWith('explain everything')) return 'Explain Everything';
  if(key.startsWith('seesaw')) return 'Seesaw';
  if(key.startsWith('canva')) return 'Canva';
  if(key.startsWith('imovie')) return 'iMovie';
  if(key.startsWith('ipad')) return 'iPad';
  if(key.startsWith('book creator')) return 'Book Creator';
  if(key.startsWith('padlet')) return 'Padlet';
  if(key.startsWith('kahoot')) return 'Kahoot';
  if(key.startsWith('tinkercad')) return 'Tinkercad';
  if(key.startsWith('freeform')) return 'Freeform';
  if(key.startsWith('sketchbook')) return 'Sketchbook';
  if(key.startsWith('epic')) return 'Epic';
  if(key.startsWith('clickview')) return 'Clickview';
  if(key.startsWith('garageband')) return 'GarageBand';
  if(key.startsWith('piccollage')) return 'PicCollage';
  if(key.startsWith('brushes redux')) return 'Brushes Redux';
  if(key.startsWith('sky map')) return 'Sky Map';
  if(key.startsWith('geoboard')) return 'Geoboard';
  // Microsoft/Office aliases: treat bare and prefixed app names as the same tool.
  if(key === 'sway' || key.endsWith(' sway')) return 'Microsoft Sway';
  if(key === 'forms' || key.endsWith(' forms')) return 'Microsoft Forms';
  if(key === 'excel' || key.endsWith(' excel')) return 'Microsoft Excel';
  if(key === 'word' || key.endsWith(' word')) return 'Microsoft Word';
  if(key === 'powerpoint' || key.endsWith(' powerpoint') || key.endsWith(' power point')) return 'Microsoft PowerPoint';
  if(key === 'teams' || key.endsWith(' teams')) return 'Microsoft Teams';
  if(key === 'onenote' || key === 'one note' || key.endsWith(' onenote') || key.endsWith(' one note')) return 'Microsoft OneNote';
  if((key.includes('wise') && key.includes('chatbot')) || (key.includes('wise') && key.includes('discussion')) || (key.includes('schoolbox') && key.includes('chatbot')) || (key.includes('schoolbox') && key.includes('discussion')) || (key.includes('ai discussion') && key.includes('chatbot'))) return 'Wise Discussion Chatbots';
  if(key.startsWith('microsoft ')) return t; // keep other specific MS tools
  // "App Smashing: Tool" → extract the tool
  if(key.startsWith('app smash')){
    const afterColon = t.replace(/^App\s*Smash\w*[:\s]+/i, '').trim();
    return afterColon ? normaliseToolName(afterColon) : t;
  }
  // Remove parenthetical suffixes for any remaining: "Tool (stuff)" → "Tool"
  const parenMatch = t.match(/^([A-Za-z][A-Za-z0-9\s:'-]+?)\s*\(/);
  if(parenMatch) return parenMatch[1].trim();
  return t;
}

// Canonical key for comparing two tool names (normalises known variants, lowercases, trims)
function toolKey(t){
  return normaliseToolName((t||'').toString().trim()).toLowerCase().trim();
}

// Would placing `toolName` into `entry` (excluding slot `excludeSugIdx`) create a duplicate?
function wouldDupeInEntry(entry, toolName, excludeSugIdx){
  const key = toolKey(toolName);
  if(!key) return false;
  return getSugs(entry).some((s,i) => i !== excludeSugIdx && toolKey(sugTool(s)) === key);
}

// ========== PLANNER CONTEXT REFRESH ==========
// Forces the GAS backend to re-read .md planners from Drive and overwrite the
// cached plannerContextRich in data.json so the next AI call sees fresh content.
async function refreshAllPlannerContext(){
  if(!confirm('Re-read every audited planner .md from Drive and overwrite cached planner context? This usually takes 30-90 seconds and triggers a data.json push to GitHub.')) return;
  if(typeof setStatus === 'function') setStatus('Refreshing planner context from Drive…', 'loading');
  try {
    const payload = withGASToken({ action: 'refreshPlannerContext', all: true });
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if(result.error){ setStatus('Refresh error: ' + result.error, 'error'); return; }
    const msg = `Planner context refreshed: ${result.refreshed||0} updated, ${result.missing||0} missing .md`;
    if(typeof setStatus === 'function') setStatus(msg, 'success');
    if(typeof loadFromDrive === 'function') await loadFromDrive();
  } catch(err) {
    if(typeof setStatus === 'function') setStatus('Refresh failed: ' + err.message, 'error');
  }
}

async function refreshOnePlannerContext(entry){
  if(!entry || !entry.ca || !entry.yl || !entry.th){
    if(typeof setStatus === 'function') setStatus('refreshOnePlannerContext: missing ca/yl/th', 'error');
    return;
  }
  if(typeof setStatus === 'function') setStatus(`Refreshing ${entry.ca} ${entry.yl} — ${entry.th}…`, 'loading');
  try {
    const payload = withGASToken({ action: 'refreshPlannerContext', ca: entry.ca, yl: entry.yl, th: entry.th });
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if(result.error){ setStatus('Refresh error: ' + result.error, 'error'); return result; }
    const msg = `Refreshed ${result.refreshed||0} entr${(result.refreshed||0)===1?'y':'ies'} for "${entry.th}"`;
    if(typeof setStatus === 'function') setStatus(msg, 'success');
    if(typeof loadFromDrive === 'function') await loadFromDrive();
    return result;
  } catch(err) {
    if(typeof setStatus === 'function') setStatus('Refresh failed: ' + err.message, 'error');
  }
}

// ========== BULK AI QUICK ACTIONS UI ==========
// Injects a prompt-builder panel into the Bulk AI Edit card. Each card fills (or sends)
// the chat input with a structured request — Find opportunities / Replace a tool /
// Place lesson / Improve suggestions. Nothing is saved until the review popup is approved.
// Restored from commit a16c249 (2026-05-05), adapted to current helpers.
(function(){
  function bulkQAEl_(id){ return document.getElementById(id); }
  function bulkQAEsc_(value){
    if(typeof esc === 'function') return esc(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function bulkQAToolKey_(value){
    const v = String(value || '').trim();
    try {
      if(typeof normaliseToolName === 'function' && typeof toolInventoryKey === 'function'){
        return toolInventoryKey(normaliseToolName(v));
      }
      if(typeof toolInventoryKey === 'function') return toolInventoryKey(v);
    } catch(e){}
    return v.toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
  }
  function bulkQALibraryKeys_(){
    try {
      if(typeof getLibraryKeys === 'function'){
        const keys = getLibraryKeys();
        if(Array.isArray(keys) && keys.length) return keys.slice();
      }
      if(typeof LIBRARIES !== 'undefined' && LIBRARIES){
        return Object.keys(LIBRARIES).filter(k => k !== '_meta' && Array.isArray(LIBRARIES[k]));
      }
    } catch(e){}
    return [];
  }
  function bulkQALibraryLabel_(key){
    try {
      if(typeof getLibraryMeta === 'function'){
        const meta = getLibraryMeta(key);
        if(meta && meta.name) return meta.name;
      }
    } catch(e){}
    return String(key || '');
  }
  function bulkQASetInput_(value){
    const input = bulkQAEl_('bulk-chat-input');
    if(!input) return;
    input.value = String(value || '').trim();
    input.focus();
    try { input.scrollIntoView({behavior:'smooth', block:'center'}); } catch(e){}
  }
  function bulkQAGet_(id){
    const el = bulkQAEl_(id);
    return el ? String(el.value || '').trim() : '';
  }
  function bulkQANormaliseScope_(scope){
    return String(scope || '').trim().replace(/\s+/g, ' ');
  }
  function bulkQAOptionTag_(value, label){
    const v = bulkQAEsc_(value);
    const l = bulkQAEsc_(label || value);
    return `<option value="${v}">${l}</option>`;
  }
  function bulkQACanonicalQuickToolLabel_(value){
    let label = (typeof normaliseToolName === 'function') ? normaliseToolName(String(value||'').trim()) : String(value||'').trim();
    if(!label) return '';
    const key = bulkQAToolKey_(label);
    if(key === 'podcastequipment' || key === 'podcastequipmentgarageband' || key === 'podcastequipmentandgarageband'){
      return 'Podcast Equipment + GarageBand';
    }
    if(/^podcast\s+equipment(?:\s*(?:\+|&|and)\s*garageband)?$/i.test(label)){
      return 'Podcast Equipment + GarageBand';
    }
    return label;
  }
  function bulkQACollectApprovedTools_(){
    const fallback = ['Book Creator','Makey Makey','Lego Spike Prime','Lego Spike Essential','Adobe Express','Padlet','Minecraft Education','National Geographic MapMaker','Delightex','Scratch','ScratchJR','Sphero BOLT','Micro:bit','Tinkercad','Canva','Wise Discussion Chatbots'];
    const seen = new Set();
    const out = [];
    function add(v){
      const label = bulkQACanonicalQuickToolLabel_(v);
      if(!label) return;
      const k = bulkQAToolKey_(label);
      if(!k || seen.has(k)) return;
      seen.add(k); out.push(label);
    }
    try {
      if(typeof TOOL_INVENTORY !== 'undefined' && TOOL_INVENTORY && Array.isArray(TOOL_INVENTORY.approved)){ TOOL_INVENTORY.approved.forEach(add); }
      if(typeof LIBRARIES !== 'undefined' && LIBRARIES && LIBRARIES._meta && LIBRARIES._meta._inventory && Array.isArray(LIBRARIES._meta._inventory.approved)){ LIBRARIES._meta._inventory.approved.forEach(add); }
    } catch(e){}
    if(!out.length) fallback.forEach(add);
    return out.sort((a,b)=>a.localeCompare(b));
  }
  function bulkQALooksLikeToolName_(label, knownKeys){
    const raw = String(label || '').trim();
    if(!raw) return false;
    const key = bulkQAToolKey_(raw);
    if(knownKeys && knownKeys.has(key)) return true;
    // STEM/unit suggestion titles often look like "Calm Quest: personalized wellbeing maze".
    // Keep the replace list focused on actual technology tools, not lesson/activity titles.
    if(/[:;]/.test(raw)) return false;
    const words = raw.split(/\s+/).filter(Boolean);
    if(words.length > 5) return false;
    if(/\b(quest|maze|challenge|lesson|activity|project|poster|presentation|reflection|exhibition|community|wellbeing)\b/i.test(raw) && !(knownKeys && knownKeys.has(key))) return false;
    return true;
  }
  function bulkQACollectReplaceTools_(){
    const seen = new Set();
    const out = [];
    const knownKeys = new Set();
    function canonical(v){ return bulkQACanonicalQuickToolLabel_(v); }
    function rememberKnown(v){
      const label = canonical(v);
      const k = bulkQAToolKey_(label);
      if(k) knownKeys.add(k);
    }
    function add(v, forceKnown){
      const label = canonical(v);
      if(!label) return;
      const k = bulkQAToolKey_(label);
      if(!k || seen.has(k)) return;
      if(forceKnown) knownKeys.add(k);
      if(!forceKnown && !bulkQALooksLikeToolName_(label, knownKeys)) return;
      seen.add(k); out.push(label);
    }
    try {
      if(typeof TOOL_INVENTORY !== 'undefined' && TOOL_INVENTORY){
        (TOOL_INVENTORY.banned || []).forEach(rememberKnown);
        (TOOL_INVENTORY.approved || []).forEach(rememberKnown);
      }
      if(typeof LIBRARIES !== 'undefined' && LIBRARIES && LIBRARIES._meta && LIBRARIES._meta._inventory){
        (LIBRARIES._meta._inventory.banned || []).forEach(rememberKnown);
        (LIBRARIES._meta._inventory.approved || []).forEach(rememberKnown);
      }
      // Always include inventory/legacy tools first. These may include tools no longer used
      // in current suggestions but still need a removal workflow.
      if(typeof TOOL_INVENTORY !== 'undefined' && TOOL_INVENTORY){
        (TOOL_INVENTORY.banned || []).forEach(v => add(v, true));
        (TOOL_INVENTORY.approved || []).forEach(v => add(v, true));
      }
      if(typeof LIBRARIES !== 'undefined' && LIBRARIES && LIBRARIES._meta && LIBRARIES._meta._inventory){
        (LIBRARIES._meta._inventory.banned || []).forEach(v => add(v, true));
        (LIBRARIES._meta._inventory.approved || []).forEach(v => add(v, true));
      }
      if(Array.isArray(DATA)){
        DATA.forEach(e => (getSugs(e)||[]).forEach((s, idx) => {
          // Slot #6 / STEM extension often stores a lesson/activity title rather than a tool.
          // Do not let those titles flood the "tool to remove" dropdown.
          if(idx >= 5) return;
          if(isRealSug(s)) add(sugTool(s), false);
        }));
      }
    } catch(e){}
    ['Seesaw','ClassVR','Flip','Google Maps','Adobe Spark','CoSpaces','Delightex (CoSpaces)'].forEach(v => add(v, true));
    return out.sort((a,b)=>a.localeCompare(b));
  }
  function bulkQAToolOptions_(){
    return '<option value="">Select approved tool…</option>' + bulkQACollectApprovedTools_().map(t => bulkQAOptionTag_(t)).join('');
  }
  function bulkQAReplaceToolOptions_(){
    return '<option value="">Select tool to remove…</option>' + bulkQACollectReplaceTools_().map(t => bulkQAOptionTag_(t)).join('');
  }
  function bulkQAYearScopeOptions_(){
    return [
      ['Prep','Prep'],['Year 1','Year 1'],['Year 2','Year 2'],['Year 3','Year 3'],['Year 4','Year 4'],['Year 5','Year 5'],['Year 6','Year 6']
    ].map(x => bulkQAOptionTag_(x[0], x[1])).join('');
  }
  function bulkQAReplaceScopeOptions_(){
    return [
      ['All planners','All planners (Surgeon-style)'],
      ['Prep','Prep'],['Year 1','Year 1'],['Year 2','Year 2'],['Year 3','Year 3'],['Year 4','Year 4'],['Year 5','Year 5'],['Year 6','Year 6']
    ].map(x => bulkQAOptionTag_(x[0], x[1])).join('');
  }
  function bulkQALibraryOptions_(){
    let keys = bulkQALibraryKeys_();
    if(!keys.length) keys = ['minecraft'];
    keys.sort((a,b) => bulkQALibraryLabel_(a).localeCompare(bulkQALibraryLabel_(b)));
    if(keys.includes('minecraft')) keys = ['minecraft'].concat(keys.filter(k => k !== 'minecraft'));
    return keys.map(k => `<option value="${bulkQAEsc_(k)}">${bulkQAEsc_(bulkQALibraryLabel_(k))}</option>`).join('');
  }

  window.bulkQARefreshLibrarySelect_ = function bulkQARefreshLibrarySelect_(){
    const sel = bulkQAEl_('bulk-qa-lesson-library');
    if(!sel) return false;
    const before = sel.value;
    const html = bulkQALibraryOptions_();
    if(html && sel.getAttribute('data-options-html') !== html){
      sel.innerHTML = html;
      sel.setAttribute('data-options-html', html);
      if(before && Array.from(sel.options).some(o => o.value === before)) sel.value = before;
    }
    return true;
  };

  window.bulkQARefreshToolSelects_ = function bulkQARefreshToolSelects_(){
    const opp = bulkQAEl_('bulk-qa-tool');
    if(opp){ const before = opp.value; opp.innerHTML = bulkQAToolOptions_(); if(before && Array.from(opp.options).some(o => o.value === before)) opp.value = before; }
    const rep = bulkQAEl_('bulk-qa-replace-tool');
    if(rep){ const before = rep.value; rep.innerHTML = bulkQAReplaceToolOptions_(); if(before && Array.from(rep.options).some(o => o.value === before)) rep.value = before; }
    return true;
  };

  function bulkQAHideLegacyBulkCards_(){
    const panel = document.getElementById('panel-tools');
    if(!panel) return;
    Array.from(panel.querySelectorAll('.card')).forEach(card => {
      if(card.id === 'realism-audit-card') return;
      const txt = (card.textContent || '').toLowerCase().replace(/\s+/g,' ');
      if(txt.includes('playbooks') || txt.includes('side-by-side campus comparison') || txt.includes('run surgeon')){
        card.style.display = 'none';
        card.setAttribute('data-bulk-quick-actions-hidden','true');
      }
    });
  }

  function bulkQASetAdvancedOpen_(open){
    const chat = bulkQAEl_('bulk-chat-messages');
    if(!chat) return;
    const reasoning = bulkQAEl_('bulk-reasoning');
    const inputRow = bulkQAEl_('bulk-chat-input') ? bulkQAEl_('bulk-chat-input').parentNode : null;
    const btn = bulkQAEl_('bulk-qa-advanced-toggle');
    const show = !!open;
    chat.style.display = show ? '' : 'none';
    if(reasoning) reasoning.style.display = show ? (reasoning.getAttribute('data-was-open') === '1' ? '' : reasoning.style.display) : 'none';
    if(inputRow) inputRow.style.display = show ? 'flex' : 'none';
    if(btn) btn.textContent = show ? 'Hide advanced custom chat' : 'Show advanced custom chat';
    const hint = bulkQAEl_('bulk-qa-advanced-hint');
    if(hint) hint.style.display = show ? 'none' : 'block';
  }
  window.bulkQuickActionToggleAdvanced = function(){
    const chat = bulkQAEl_('bulk-chat-messages');
    const currentlyOpen = chat && chat.style.display !== 'none';
    bulkQASetAdvancedOpen_(!currentlyOpen);
  };

  window.bulkQuickActionFill = function(kind){
    const type = String(kind || '').toLowerCase();
    if(type === 'opportunity'){
      const tool = bulkQAGet_('bulk-qa-tool');
      const scope = bulkQANormaliseScope_(bulkQAGet_('bulk-qa-scope'));
      if(!tool){ alert('Choose a tool first, e.g. Book Creator or Makey Makey.'); return; }
      const prompt = scope
        ? `Find more opportunities in ${scope} to use ${tool}`
        : `Find more opportunities to use ${tool}`;
      bulkQASetInput_(prompt);
      bulkQASetAdvancedOpen_(true);
      return;
    }
    if(type === 'replace'){
      const tool = bulkQAGet_('bulk-qa-replace-tool');
      const scope = bulkQANormaliseScope_(bulkQAGet_('bulk-qa-replace-scope'));
      if(!tool){ alert('Choose the tool to replace first, e.g. Seesaw.'); return; }
      const prompt = /all\s+planners|all\s+years/i.test(scope)
        ? `Replace ${tool} across all planners`
        : (scope ? `Replace ${tool} in ${scope}` : `Replace ${tool}`);
      bulkQASetInput_(prompt);
      bulkQASetAdvancedOpen_(true);
      return;
    }
    if(type === 'lesson' || type === 'minecraft'){
      const libraryKey = bulkQAGet_('bulk-qa-lesson-library') || 'minecraft';
      const lesson = bulkQAGet_('bulk-qa-lesson-title') || bulkQAGet_('bulk-qa-minecraft-lesson');
      if(!lesson){ alert('Enter the exact curated lesson title first, e.g. Revamp Melbourne.'); return; }
      const cleanLesson = lesson.replace(/\s+Minecraft\s+lesson\s*$/i, '').replace(/\s+Minecraft\s*$/i, '').trim();
      const libraryLabel = bulkQALibraryLabel_(libraryKey || 'minecraft');
      if(String(libraryKey).toLowerCase() === 'minecraft' || /minecraft/i.test(libraryLabel)){
        bulkQASetInput_(`Where can the ${cleanLesson} Minecraft lesson fit?`);
      } else {
        bulkQASetInput_(`Where can the ${cleanLesson} lesson from the ${libraryLabel} library fit?`);
      }
      bulkQASetAdvancedOpen_(true);
      return;
    }
    if(type === 'improve'){
      const campus = bulkQANormaliseScope_(bulkQAGet_('bulk-qa-improve-campus'));
      const year = bulkQANormaliseScope_(bulkQAGet_('bulk-qa-improve-year'));
      if(!campus || !year){ alert('Choose both a campus and year level, e.g. Glen Waverley and Year 6.'); return; }
      bulkQASetInput_(`Improve ${campus} ${year} suggestions`);
      bulkQASetAdvancedOpen_(true);
      return;
    }
  };

  window.bulkQuickActionSend = function(kind){
    window.bulkQuickActionFill(kind);
    setTimeout(function(){
      const input = bulkQAEl_('bulk-chat-input');
      if(input && input.value && typeof bulkChatSend === 'function') bulkChatSend();
    }, 80);
  };

  function bulkQAInstall_(){
    if(bulkQAEl_('bulk-quick-actions-panel')) return true;
    const chat = bulkQAEl_('bulk-chat-messages');
    if(!chat || !chat.parentNode) return false;
    const panel = document.createElement('div');
    panel.id = 'bulk-quick-actions-panel';
    panel.innerHTML = `
      <div style="padding:14px 20px;background:var(--card);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div style="font-size:11px;font-weight:900;color:var(--lime);letter-spacing:1px;text-transform:uppercase">⚡ Bulk quick actions</div>
          <div style="font-size:11px;color:var(--dim);line-height:1.45">Use these safe workflows first. Nothing is saved until the review popup is approved.</div>
          <div style="flex:1"></div>
          <button type="button" class="btn-sm" onclick="refreshAllPlannerContext()" title="Re-read every audited planner .md from Drive so AI calls use the latest planner content (cache-bust).">↻ Refresh planner context</button>
          <button type="button" id="bulk-qa-advanced-toggle" class="btn-sm" onclick="bulkQuickActionToggleAdvanced()">Show advanced custom chat</button>
        </div>
        <div id="bulk-qa-advanced-hint" style="font-size:11px;color:var(--dim);padding:8px 10px;margin-bottom:10px;background:rgba(197,232,74,.05);border:1px solid rgba(197,232,74,.15);border-radius:9px">Advanced chat is collapsed. Use quick actions for common review-only workflows, or open custom chat for unusual requests.</div>
        <!-- Tool selectors are populated from the live Tool Inventory / current data. -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px">
          <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:var(--card2)">
            <div style="font-size:11px;font-weight:800;color:var(--text);margin-bottom:6px">➕ Find opportunities</div>
            <select id="bulk-qa-tool" class="inp" style="font-size:12px;padding:8px 10px;margin-bottom:6px">${bulkQAToolOptions_()}</select>
            <select id="bulk-qa-scope" class="inp" style="font-size:12px;padding:8px 10px;margin-bottom:8px">
              <option value="">All eligible years</option>${bulkQAYearScopeOptions_()}
            </select>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn-sm" onclick="bulkQuickActionFill('opportunity')">Fill prompt</button>
              <button type="button" class="btn-sm" onclick="bulkQuickActionSend('opportunity')" style="color:var(--lime);border-color:var(--lime)">Draft now</button>
            </div>
          </div>
          <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:var(--card2)">
            <div style="font-size:11px;font-weight:800;color:var(--text);margin-bottom:6px">🔁 Replace a tool</div>
            <select id="bulk-qa-replace-tool" class="inp" style="font-size:12px;padding:8px 10px;margin-bottom:6px">${bulkQAReplaceToolOptions_()}</select>
            <select id="bulk-qa-replace-scope" class="inp" style="font-size:12px;padding:8px 10px;margin-bottom:8px">
              ${bulkQAReplaceScopeOptions_()}
            </select>
            <div style="font-size:10px;color:var(--dim);margin:-3px 0 7px;line-height:1.35">Choose <strong>All planners</strong> for the old Surgeon-style remove-everywhere workflow.</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn-sm" onclick="bulkQuickActionFill('replace')">Fill prompt</button>
              <button type="button" class="btn-sm" onclick="bulkQuickActionSend('replace')" style="color:var(--lime);border-color:var(--lime)">Draft now</button>
            </div>
          </div>
          <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:var(--card2)">
            <div style="font-size:11px;font-weight:800;color:var(--text);margin-bottom:6px">📚 Place lesson</div>
            <div style="display:flex;gap:6px;margin-bottom:6px">
              <select id="bulk-qa-lesson-library" class="inp" style="font-size:12px;padding:8px 10px;margin-bottom:0;flex:1">
                ${bulkQALibraryOptions_()}
              </select>
              <button type="button" class="btn-sm" onclick="bulkQARefreshLibrarySelect_()" title="Refresh library list from loaded libraries.json">↻</button>
            </div>
            <input id="bulk-qa-lesson-title" class="inp" placeholder="Exact lesson title, e.g. Revamp Melbourne" style="font-size:12px;padding:8px 10px;margin-bottom:8px">
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn-sm" onclick="bulkQuickActionFill('lesson')">Fill prompt</button>
              <button type="button" class="btn-sm" onclick="bulkQuickActionSend('lesson')" style="color:var(--lime);border-color:var(--lime)">Draft now</button>
            </div>
          </div>
          <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:var(--card2)">
            <div style="font-size:11px;font-weight:800;color:var(--text);margin-bottom:6px">✨ Improve suggestions</div>
            <select id="bulk-qa-improve-campus" class="inp" style="font-size:12px;padding:8px 10px;margin-bottom:6px">
              <option value="">Select campus…</option>
              <option>Elsternwick</option>
              <option>Glen Waverley</option>
              <option>St Kilda Road</option>
            </select>
            <select id="bulk-qa-improve-year" class="inp" style="font-size:12px;padding:8px 10px;margin-bottom:8px">
              <option value="">Select year…</option>
              <option>Prep</option><option>Year 1</option><option>Year 2</option><option>Year 3</option><option>Year 4</option><option>Year 5</option><option>Year 6</option>
            </select>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn-sm" onclick="bulkQuickActionFill('improve')">Fill prompt</button>
              <button type="button" class="btn-sm" onclick="bulkQuickActionSend('improve')" style="color:var(--lime);border-color:var(--lime)">Draft now</button>
            </div>
          </div>
        </div>
      </div>`;
    chat.parentNode.insertBefore(panel, chat);
    bulkQARefreshLibrarySelect_();
    bulkQARefreshToolSelects_();
    bulkQAHideLegacyBulkCards_();
    bulkQASetAdvancedOpen_(false);
    // Libraries may load after this panel is injected. Refresh the selector for a short
    // window so newly-added libraries appear without a page reload.
    let refreshTries = 0;
    const refreshTimer = setInterval(function(){
      refreshTries++;
      bulkQARefreshLibrarySelect_();
      bulkQARefreshToolSelects_();
      bulkQAHideLegacyBulkCards_();
      if(refreshTries > 30) clearInterval(refreshTimer);
    }, 1000);
    return true;
  }

  function bulkQAStart_(){
    if(bulkQAInstall_()) return;
    let tries = 0;
    const timer = setInterval(function(){
      tries++;
      if(bulkQAInstall_() || tries > 40) clearInterval(timer);
    }, 250);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bulkQAStart_);
  else bulkQAStart_();
})();
