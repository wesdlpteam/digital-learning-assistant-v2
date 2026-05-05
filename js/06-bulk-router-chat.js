function bulkInstructionLooksLikeOpportunity(instruction){
  return /\b(find|look|search|scan|identify|where|opportunit|more uses?|add more|chance|integrate|incorporate|places? to use)\b/i.test(instruction || '');
}

function getBulkPlatformToolName(platform){
  if(!platform) return '';
  const name = platform.name || '';
  if(/micro.?bit/i.test(name)) return 'Micro:bit';
  if(/minecraft/i.test(name)) return 'Minecraft Education';
  return name;
}

function bulkUniqueToolsForDetection_(){
  normaliseToolInventory();
  const all = [
    ...(DEFAULT_APPROVED_TOOLS || []),
    ...((TOOL_INVENTORY && TOOL_INVENTORY.approved) || []),
    'Bee-Bots','ScratchJR','Sphero Indi','Sphero BOLT','Lego Spike Essential','Lego Spike Prime',
    'Book Creator','Canva','Padlet','Seesaw','Microsoft Forms','Microsoft Sway','Microsoft PowerPoint',
    'Microsoft Word','Microsoft Excel','Microsoft Teams','Microsoft OneNote','Wise Discussion Chatbots',
    'Micro:bit','Minecraft Education','GarageBand','iMovie','Adobe Express','Stop Motion Studio','Tinkercad'
  ];
  const seen = new Set();
  return all.map(t => normaliseToolName(String(t || '').trim())).filter(t => {
    const k = toolInventoryKey(t);
    if(!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a,b) => b.length - a.length);
}

function bulkEscapeRegExp_(value){
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}



function bulkTopProgressStep_(pct, label){
  try { if(typeof showProgress === 'function') showProgress(pct); } catch(e){}
  try { if(label && typeof setStatus === 'function') setStatus(label, 'loading'); } catch(e){}
}
function bulkTopProgressStop_(label){
  try { bulkTopProgressStep_(90, label || 'Almost ready…'); } catch(e){}
  setTimeout(function(){
    try { if(typeof stopProgress === 'function') stopProgress(); else if(typeof showProgress === 'function') showProgress(null); } catch(e){}
    try { if(typeof setStatus === 'function') setStatus(label || 'Ready ✓'); } catch(e){}
  }, 350);
}
function bulkRunWithTopProgress_(label, doneLabel, work, onError){
  // Local Bulk routes can finish quickly, so use explicit staged progress updates
  // instead of the old timer-only bar. This gives visible feedback without changing logic.
  bulkTopProgressStep_(12, label || 'Starting…');
  setTimeout(function(){
    bulkTopProgressStep_(35, 'Finding candidate units…');
    setTimeout(function(){
      bulkTopProgressStep_(65, 'Preparing safe review drafts…');
      setTimeout(function(){
        try {
          work();
          bulkTopProgressStop_(doneLabel || 'Ready ✓');
        } catch(e){
          bulkTopProgressStop_('Stopped safely');
          if(typeof onError === 'function') onError(e);
          else throw e;
        }
      }, 90);
    }, 120);
  }, 120);
}

function bulkDetectNamedToolOpportunity_(instruction){
  const text = String(instruction || '').toLowerCase().replace(/[’']/g, '');
  if(!bulkInstructionLooksLikeOpportunity(text)) return '';
  const aliases = {
    'makey makey':'Makey Makey',
    'the makey makey':'Makey Makey',
    'makey-makey':'Makey Makey',
    'makeymakey':'Makey Makey',
    'book creator':'Book Creator',
    'bookcreator':'Book Creator',
    'beebot':'Bee-Bots',
    'bee bot':'Bee-Bots',
    'bee-bot':'Bee-Bots',
    'bee bots':'Bee-Bots',
    'bee-bots':'Bee-Bots',
    'scratch jr':'ScratchJR',
    'scratchjr':'ScratchJR',
    'microbit':'Micro:bit',
    'micro bit':'Micro:bit',
    'micro:bit':'Micro:bit',
    'lego spike prime':'Lego Spike Prime',
    'lego spike essential':'Lego Spike Essential',
    'sphero bolt':'Sphero BOLT',
    'sphero indi':'Sphero Indi',
    'wise chatbots':'Wise Discussion Chatbots',
    'wise discussion chatbots':'Wise Discussion Chatbots',
    'schoolbox discussion chatbots':'Wise Discussion Chatbots'
  };
  for(const [alias, tool] of Object.entries(aliases)){
    const pattern = bulkEscapeRegExp_(alias).replace(/\s+/g, '\\s+');
    const re = new RegExp('(^|[^a-z0-9])' + pattern + '([^a-z0-9]|$)', 'i');
    if(re.test(text)) return tool;
  }
  const tools = bulkUniqueToolsForDetection_();
  for(const tool of tools){
    const phrase = tool.toLowerCase().replace(/[’']/g, '');
    if(!phrase || phrase.length < 4) continue;
    const pattern = bulkEscapeRegExp_(phrase).replace(/\s+/g, '\\s+');
    const re = new RegExp('(^|[^a-z0-9])' + pattern + '([^a-z0-9]|$)', 'i');
    if(re.test(text)) return tool;
  }
  return '';
}


// ========== BULK AI DIAGNOSTIC MODE ==========
// Diagnostic-only command. It does not call AI, does not draft changes, and does not save.
// Use: diagnose: Find more opportunities to use Makey Makey
function bulkDiagnosticEscape_(value){
  if(typeof esc === 'function') return esc(value);
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}

function bulkDiagnosticToolKey_(value){
  try { return toolInventoryKey(normaliseToolName(value)); }
  catch(e){ return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
}

function bulkDiagnosticDetectRoute_(instruction){
  const raw = String(instruction || '').trim();
  const lower = raw.toLowerCase();
  const namedTool = bulkDetectNamedToolOpportunity_(raw);
  const targetYears = bulkExtractTargetYears_(raw);
  const replacementTool = bulkDiagnosticDetectReplacementTool_(raw);
  let route = 'generic bulk edit';
  let confidence = 'low';
  let notes = [];

  if(/\b(where can|fit|place|places? for|opportunit)/i.test(raw) && /minecraft/i.test(raw) && /lesson/i.test(raw)){
    route = 'specific Minecraft lesson placement'; confidence = 'medium';
    notes.push('Minecraft + lesson-placement wording detected.');
  } else if(/\b(replace|remove|swap|change out|stop using|get rid of)\b/i.test(raw)){
    route = 'targeted replacement'; confidence = replacementTool ? 'high' : 'medium';
    notes.push('Replacement wording detected.');
    if(replacementTool) notes.push('Tool to remove detected locally.');
    else notes.push('Could not confidently detect which tool should be removed.');
  } else if(namedTool && bulkInstructionLooksLikeOpportunity(raw)){
    route = 'named-tool opportunity search'; confidence = 'high';
    notes.push('Opportunity wording plus a named tool detected.');
  } else if(bulkInstructionLooksLikeOpportunity(raw)){
    route = 'opportunity search, tool unclear'; confidence = 'medium';
    notes.push('Opportunity wording detected, but no known tool was confidently matched.');
  }

  return { route, confidence, namedTool, replacementTool, targetYears, notes };
}

function bulkDiagnosticScanNamedTool_(toolName, targetYears){
  const key = bulkDiagnosticToolKey_(toolName);
  let existingEntries = 0;
  let existingSlots = 0;
  let eligibleEntriesWithoutTool = 0;
  let skippedAlreadyHasTool = 0;
  let skippedYear = 0;
  let skippedNoNonStemSlot = 0;
  const examples = [];

  if(!key || !Array.isArray(DATA)) return { existingEntries, existingSlots, eligibleEntriesWithoutTool, skippedAlreadyHasTool, skippedYear, skippedNoNonStemSlot, examples };

  DATA.forEach((e, entryIdx) => {
    if(!e) return;
    const yl = e.yl || '';
    if(targetYears && targetYears.length && !targetYears.includes(yl)){ skippedYear++; return; }
    const sugs = getSugs(e).filter(isRealSug);
    let hasTool = false;
    let nonStemSlots = 0;
    sugs.forEach((s, sugIdx) => {
      if(sugIdx !== 5) nonStemSlots++;
      if(bulkDiagnosticToolKey_(sugTool(s)) === key){ hasTool = true; existingSlots++; }
    });
    if(hasTool){ existingEntries++; skippedAlreadyHasTool++; return; }
    if(!nonStemSlots){ skippedNoNonStemSlot++; return; }

    // Use the app's age helper if available. Diagnostics do not enforce; they report likely eligibility.
    let ageOk = true;
    try {
      if(typeof getAgeAppropriateTools === 'function'){
        const allowed = getAgeAppropriateTools(yl).map(t => bulkDiagnosticToolKey_(t));
        ageOk = !allowed.length || allowed.includes(key);
      }
    } catch(e){ ageOk = true; }
    if(!ageOk) return;

    eligibleEntriesWithoutTool++;
    if(examples.length < 8){
      examples.push(`${e.ca || 'Campus?'} · ${yl || 'Year?'} · ${e.th || e.theme || 'Untitled unit'}`);
    }
  });

  return { existingEntries, existingSlots, eligibleEntriesWithoutTool, skippedAlreadyHasTool, skippedYear, skippedNoNonStemSlot, examples };
}


function bulkDiagnosticAllKnownTools_(){
  const extras = ['Seesaw','Google Maps','National Geographic MapMaker','Makey Makey','Book Creator','Lego Spike Prime','Lego Spike Essential','Minecraft Education','Canva','Padlet','ScratchJR','Scratch','Adobe Express','Microsoft Forms','Microsoft Sway','GarageBand','iMovie'];
  const all = [
    ...extras,
    ...(typeof DEFAULT_APPROVED_TOOLS !== 'undefined' ? (DEFAULT_APPROVED_TOOLS || []) : []),
    ...((typeof TOOL_INVENTORY !== 'undefined' && TOOL_INVENTORY && TOOL_INVENTORY.approved) ? TOOL_INVENTORY.approved : []),
    ...((typeof TOOL_INVENTORY !== 'undefined' && TOOL_INVENTORY && TOOL_INVENTORY.banned) ? TOOL_INVENTORY.banned : [])
  ];
  const seen = new Set();
  return all.map(t => normaliseToolName(String(t || '').trim())).filter(t => {
    const k = bulkDiagnosticToolKey_(t);
    if(!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a,b) => b.length - a.length);
}

function bulkDiagnosticDetectReplacementTool_(instruction){
  const raw = String(instruction || '').trim();
  if(!/\b(replace|remove|swap|change out|stop using|get rid of)\b/i.test(raw)) return '';
  const lower = raw.toLowerCase().replace(/[’']/g, '');
  const aliases = {
    'seesaw':'Seesaw',
    'see saw':'Seesaw',
    'google maps':'Google Maps',
    'mapmaker':'National Geographic MapMaker',
    'national geographic mapmaker':'National Geographic MapMaker',
    'makey makey':'Makey Makey',
    'book creator':'Book Creator',
    'lego spike prime':'Lego Spike Prime',
    'lego spike essential':'Lego Spike Essential',
    'minecraft':'Minecraft Education',
    'minecraft education':'Minecraft Education'
  };
  for(const [alias, tool] of Object.entries(aliases)){
    const pattern = bulkEscapeRegExp_(alias).replace(/\s+/g, '\s+');
    const re = new RegExp('(^|[^a-z0-9])' + pattern + '([^a-z0-9]|$)', 'i');
    if(re.test(lower)) return tool;
  }
  const tools = bulkDiagnosticAllKnownTools_();
  for(const tool of tools){
    const phrase = String(tool || '').toLowerCase().replace(/[’']/g, '');
    if(!phrase || phrase.length < 4) continue;
    const pattern = bulkEscapeRegExp_(phrase).replace(/\s+/g, '\s+');
    const re = new RegExp('(^|[^a-z0-9])' + pattern + '([^a-z0-9]|$)', 'i');
    if(re.test(lower)) return tool;
  }
  return '';
}

function bulkReplacementYearKey_(value){
  const raw = String(value || '').toLowerCase().trim();
  if(!raw) return '';
  if(/\bprep\b|\bfoundation\b/.test(raw)) return 'Prep';
  const m = raw.match(/(?:year|yr|y)?\s*([1-6])\b/);
  return m ? ('Year ' + m[1]) : String(value || '').trim();
}

function bulkReplacementCandidateText_(s){
  if(!s) return '';
  const parts = [];
  ['t','tool','technology','name','title','platform','app','software','resource','d','desc','description','integration_idea','activity','suggestion'].forEach(k => {
    if(s[k] != null && typeof s[k] !== 'object') parts.push(String(s[k]));
  });
  return parts.join(' | ');
}

function bulkReplacementToolMatches_(s, toolName){
  const wantedKey = bulkDiagnosticToolKey_(toolName);
  const toolText = String(sugTool(s) || '').trim();
  const toolKey = bulkDiagnosticToolKey_(toolText);
  if(wantedKey && toolKey && toolKey === wantedKey) return true;

  const haystack = bulkReplacementCandidateText_(s).toLowerCase().replace(/[’']/g, '');
  if(!haystack) return false;

  if(wantedKey === 'seesaw'){
    // Some entries use labels such as "Seesaw Learning Journal", "See Saw", or put
    // the tool name in a description field rather than the compact tool field.
    return /(^|[^a-z0-9])see\s*saw([^a-z0-9]|$)/i.test(haystack) || /(^|[^a-z0-9])seesaw([^a-z0-9]|$)/i.test(haystack);
  }
  if(wantedKey === 'googlemaps') return /google\s+maps?/i.test(haystack);
  if(wantedKey === 'nationalgeographicmapmaker') return /mapmaker|national\s+geographic\s+mapmaker/i.test(haystack);

  const phrase = String(toolName || '').toLowerCase().replace(/[’']/g, '').trim();
  if(phrase && phrase.length >= 4){
    const re = new RegExp('(^|[^a-z0-9])' + bulkEscapeRegExp_(phrase).replace(/\s+/g, '\\s+') + '([^a-z0-9]|$)', 'i');
    return re.test(haystack);
  }
  return false;
}

function bulkDiagnosticScanReplacementTool_(toolName, targetYears){
  const key = bulkDiagnosticToolKey_(toolName);
  const matches = [];
  let skippedYear = 0;
  let skippedStemSlot = 0;
  let totalMatchingSlots = 0;
  let matchingEntries = 0;
  const entriesSeen = new Set();
  const requestedYears = (targetYears || []).map(bulkReplacementYearKey_).filter(Boolean);

  if(!key || !Array.isArray(DATA)) return { matches, skippedYear, skippedStemSlot, totalMatchingSlots, matchingEntries };

  DATA.forEach((e, entryIdx) => {
    if(!e) return;
    const yl = bulkReplacementYearKey_(e.yl || e.year || e.yearLevel || '');
    if(requestedYears.length && !requestedYears.includes(yl)){ skippedYear++; return; }
    const sugs = getSugs(e);
    sugs.forEach((s, sugIdx) => {
      if(!s || !isRealSug(s)) return;
      if(!bulkReplacementToolMatches_(s, toolName)) return;
      totalMatchingSlots++;
      entriesSeen.add(entryIdx);
      const record = {
        entryIdx,
        sugIdx,
        isStemSlot: sugIdx === 5,
        campus: e.ca || e.campus || 'Campus?',
        year: yl || e.yl || 'Year?',
        theme: e.th || e.theme || 'Untitled unit',
        currentTool: sugTool(s) || '(tool label missing; matched text in suggestion)',
        currentDesc: sugDesc(s)
      };
      if(record.isStemSlot) skippedStemSlot++;
      else matches.push(record);
    });
  });
  matchingEntries = entriesSeen.size;
  return { matches, skippedYear, skippedStemSlot, totalMatchingSlots, matchingEntries };
}

function bulkRunDiagnosticOnly_(text){
  const cleanText = String(text || '').replace(/^\s*(diagnose|debug|route)\s*:?\s*/i, '').trim();
  const info = bulkDiagnosticDetectRoute_(cleanText);
  const years = info.targetYears && info.targetYears.length ? info.targetYears.join(', ') : 'All years';
  let scanHtml = '';

  if(info.replacementTool){
    const scan = bulkDiagnosticScanReplacementTool_(info.replacementTool, info.targetYears || []);
    const examples = (scan.matches || []).slice(0, 10).map(m => {
      return `${m.campus} · ${m.year} · slot ${m.sugIdx + 1} · ${m.theme}`;
    });
    scanHtml = `
      <div style="margin-top:10px;padding:10px 12px;background:rgba(245,166,35,.06);border:1px solid rgba(245,166,35,.25);border-radius:10px">
        <div style="font-size:11px;color:#F5A623;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Targeted replacement scan</div>
        <div>Tool to remove: <strong>${bulkDiagnosticEscape_(info.replacementTool)}</strong></div>
        <div>Total matching slots in scope: <strong>${scan.totalMatchingSlots}</strong></div>
        <div>Matching entries: <strong>${scan.matchingEntries}</strong></div>
        <div>Draftable non-STEM slots: <strong>${scan.matches.length}</strong></div>
        <div>Protected STEM slot #6 matches skipped: <strong>${scan.skippedStemSlot}</strong></div>
        <div>Skipped by year filter: <strong>${scan.skippedYear}</strong></div>
        ${examples.length ? `<div style="margin-top:8px;color:var(--dim);font-size:12px">First draftable matches:<br>${examples.map(bulkDiagnosticEscape_).join('<br>')}</div>` : ''}
      </div>`;
  } else if(info.namedTool){
    const scan = bulkDiagnosticScanNamedTool_(info.namedTool, info.targetYears || []);
    scanHtml = `
      <div style="margin-top:10px;padding:10px 12px;background:rgba(197,232,74,.06);border:1px solid rgba(197,232,74,.2);border-radius:10px">
        <div style="font-size:11px;color:var(--lime);font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Named-tool scan</div>
        <div>Existing ${bulkDiagnosticEscape_(info.namedTool)} slots: <strong>${scan.existingSlots}</strong></div>
        <div>Units already using it: <strong>${scan.existingEntries}</strong></div>
        <div>Likely eligible units without it: <strong>${scan.eligibleEntriesWithoutTool}</strong></div>
        <div>Skipped by year filter: <strong>${scan.skippedYear}</strong></div>
        ${scan.examples.length ? `<div style="margin-top:8px;color:var(--dim);font-size:12px">First examples:<br>${scan.examples.map(bulkDiagnosticEscape_).join('<br>')}</div>` : ''}
      </div>`;
  }

  const notes = (info.notes || []).map(bulkDiagnosticEscape_).join('<br>') || 'No special route hints detected.';
  bulkChatAddMessage('assistant', `
    <div style="padding:2px 0">
      <div style="font-size:10px;color:var(--purple);font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">🧭 Bulk AI diagnostic only</div>
      <div>Route detected: <strong>${bulkDiagnosticEscape_(info.route)}</strong></div>
      <div>Confidence: <strong>${bulkDiagnosticEscape_(info.confidence)}</strong></div>
      <div>Named tool: <strong>${bulkDiagnosticEscape_(info.namedTool || 'None detected')}</strong></div>
      <div>Tool to remove: <strong>${bulkDiagnosticEscape_(info.replacementTool || 'None detected')}</strong></div>
      <div>Year scope: <strong>${bulkDiagnosticEscape_(years)}</strong></div>
      <div style="margin-top:8px;color:var(--dim);font-size:12px">${notes}</div>
      ${scanHtml}
      <div style="margin-top:10px;font-size:12px;color:#F5A623;font-style:italic">No AI call was made. No changes were drafted or saved.</div>
    </div>`);
}


// ========== BULK AI SAFE PREVIEW MODE ==========
// Safe command only. It finds candidate units locally and shows them; no AI, no review popup, no save.
// Use: safe: Find more opportunities to use Makey Makey
function bulkSafePreviewScanNamedTool_(toolName, targetYears){
  const key = bulkDiagnosticToolKey_(toolName);
  const candidates = [];
  const skipped = { alreadyHasTool:0, year:0, noNonStemSlot:0, age:0, missingData:0 };
  let existingSlots = 0;

  if(!key || !Array.isArray(DATA)) return { candidates, skipped, existingSlots };

  DATA.forEach((e, entryIdx) => {
    if(!e){ skipped.missingData++; return; }
    const yl = e.yl || '';
    if(targetYears && targetYears.length && !targetYears.includes(yl)){ skipped.year++; return; }

    const sugs = getSugs(e).filter(isRealSug);
    let hasTool = false;
    let firstReplaceableSlot = -1;

    sugs.forEach((s, sugIdx) => {
      if(bulkDiagnosticToolKey_(sugTool(s)) === key){ hasTool = true; existingSlots++; }
      // Slot #6 is index 5 and should not be used for bulk opportunity changes.
      if(firstReplaceableSlot < 0 && sugIdx !== 5) firstReplaceableSlot = sugIdx;
    });

    if(hasTool){ skipped.alreadyHasTool++; return; }
    if(firstReplaceableSlot < 0){ skipped.noNonStemSlot++; return; }

    let ageOk = true;
    try {
      if(typeof getAgeAppropriateTools === 'function'){
        const allowed = getAgeAppropriateTools(yl).map(t => bulkDiagnosticToolKey_(t));
        ageOk = !allowed.length || allowed.includes(key);
      }
    } catch(err){ ageOk = true; }
    if(!ageOk){ skipped.age++; return; }

    candidates.push({
      entryIdx,
      slotIdx:firstReplaceableSlot,
      campus:e.ca || 'Campus?',
      year:yl || 'Year?',
      theme:e.th || e.theme || 'Untitled unit',
      centralIdea:e.ci || e.centralIdea || '',
      loi:e.loi || e.linesOfInquiry || ''
    });
  });

  return { candidates, skipped, existingSlots };
}

function bulkRunSafePreviewOnly_(text){
  const cleanText = String(text || '').replace(/^\s*safe\s*:?\s*/i, '').trim();
  const info = bulkDiagnosticDetectRoute_(cleanText);
  const years = info.targetYears && info.targetYears.length ? info.targetYears : [];
  const yearsLabel = years.length ? years.join(', ') : 'All years';

  if(!info.namedTool){
    bulkChatAddMessage('assistant', `
      <div style="padding:2px 0">
        <div style="font-size:10px;color:var(--purple);font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">🧪 Safe preview only</div>
        <div>I could not confidently detect a named tool in that request.</div>
        <div style="margin-top:8px;color:var(--dim);font-size:12px">Try: <strong>safe: Find more opportunities to use Makey Makey</strong></div>
        <div style="margin-top:10px;font-size:12px;color:#F5A623;font-style:italic">No AI call was made. No changes were drafted or saved.</div>
      </div>`);
    return;
  }

  const scan = bulkSafePreviewScanNamedTool_(info.namedTool, years);
  const preview = scan.candidates.slice(0, 10);
  const rows = preview.length ? preview.map((c, i) => `
    <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)">
      <strong>${i + 1}. ${bulkDiagnosticEscape_(c.campus)} · ${bulkDiagnosticEscape_(c.year)}</strong><br>
      <span style="color:var(--dim)">${bulkDiagnosticEscape_(c.theme)}</span>
    </div>`).join('') : '<div style="color:var(--dim);padding:8px 0">No candidate units found.</div>';

  bulkChatAddMessage('assistant', `
    <div style="padding:2px 0">
      <div style="font-size:10px;color:var(--purple);font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">🧪 Safe preview only</div>
      <div>Request route: <strong>${bulkDiagnosticEscape_(info.route)}</strong></div>
      <div>Named tool: <strong>${bulkDiagnosticEscape_(info.namedTool)}</strong></div>
      <div>Year scope: <strong>${bulkDiagnosticEscape_(yearsLabel)}</strong></div>
      <div style="margin-top:10px;padding:10px 12px;background:rgba(197,232,74,.06);border:1px solid rgba(197,232,74,.2);border-radius:10px">
        <div>Existing ${bulkDiagnosticEscape_(info.namedTool)} slots: <strong>${scan.existingSlots}</strong></div>
        <div>Candidate units without it: <strong>${scan.candidates.length}</strong></div>
        <div style="color:var(--dim);font-size:12px;margin-top:6px">Skipped already using tool: ${scan.skipped.alreadyHasTool} · skipped by year: ${scan.skipped.year} · skipped by age range: ${scan.skipped.age}</div>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--dim)">First ${preview.length} candidate units:</div>
      <div style="margin-top:4px">${rows}</div>
      <div style="margin-top:10px;font-size:12px;color:#F5A623;font-style:italic">No AI call was made. No review popup opened. No changes were drafted or saved.</div>
    </div>`);
}


// ========== BULK AI SAFE DRAFT MODE ==========
// Draft-only command. It finds a small batch locally and opens the existing review popup.
// It does not call AI and it does not save unless a human approves in the popup.
// Use: draft: Find more opportunities to use Makey Makey
function bulkSafeDraftCleanUnitText_(value){
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function bulkSafeDraftShortContext_(e){
  const theme = bulkSafeDraftCleanUnitText_(e && (e.th || e.theme)) || 'this unit';
  const ci = bulkSafeDraftCleanUnitText_(e && (e.ci || e.centralIdea));
  let loi = e && (e.loi || e.linesOfInquiry || '');
  if(Array.isArray(loi)) loi = loi.join('; ');
  loi = bulkSafeDraftCleanUnitText_(loi);
  const connection = loi || ci || theme;
  return { theme, ci, loi, connection };
}

function bulkSafeDraftTrimEndPunctuation_(value){
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.。!?！？;；:：,，]+$/g, '')
    .trim();
}

function bulkSafeDraftDescriptionForTool_(toolName, e){
  const tool = normaliseToolName(toolName || '');
  const ctx = bulkSafeDraftShortContext_(e || {});
  const theme = bulkSafeDraftTrimEndPunctuation_(ctx.theme) || 'this unit';
  const connection = bulkSafeDraftTrimEndPunctuation_(ctx.connection) || theme;

  if(bulkDiagnosticToolKey_(tool) === bulkDiagnosticToolKey_('Makey Makey')){
    return `Students use Makey Makey to turn a simple cardboard, foil or playdough model into an interactive input device connected to ${theme}. They then create a short quiz in Scratch so classmates can press parts of the model to reveal key ideas about ${connection}.`;
  }
  if(bulkDiagnosticToolKey_(tool) === bulkDiagnosticToolKey_('Book Creator')){
    return `Students use Book Creator to build a short multimodal book about ${theme}. They combine drawings, photos, captions and voice recordings to explain what they have learned about ${connection}.`;
  }
  if(bulkDiagnosticToolKey_(tool) === bulkDiagnosticToolKey_('Lego Spike Prime')){
    return `Students use Lego Spike Prime to design and code a working prototype that models an idea from ${theme}. They test, improve and explain how their build demonstrates ${connection}.`;
  }
  if(bulkDiagnosticToolKey_(tool) === bulkDiagnosticToolKey_('Lego Spike Essential')){
    return `Students use Lego Spike Essential to build and code a simple moving model linked to ${theme}. They create a short demonstration explaining how the model helps show ${connection}.`;
  }
  if(bulkDiagnosticToolKey_(tool) === bulkDiagnosticToolKey_('Wise Discussion Chatbots')){
    return `Students question a Wise Discussion Chatbot acting as a unit expert connected to ${theme}. They ask prepared questions, compare the responses with class evidence, then produce a short reflection explaining what they now understand about ${connection}.`;
  }
  return `Students use ${tool} to create a practical digital product connected to ${theme}. They make, test and share their work to explain what they have learned about ${connection}.`;
}

function bulkSafeDraftSlotScore_(s, idx){
  // Higher score = safer/better candidate to replace in a draft-only opportunity flow.
  if(idx === 5) return -9999; // protected STEM slot #6
  if(!s || !isRealSug(s)) return 80;
  const tool = sugTool(s);
  const desc = sugDesc(s);
  let score = 0;
  const len = String(desc || '').length;
  if(len < 90) score += 25;
  if(len < 150) score += 10;
  if(/\b(students will|students use|explore|create|make|investigate)\b/i.test(desc || '')) score += 2;
  if(!/\b(create|produce|build|record|design|publish|explain|share)\b/i.test(desc || '')) score += 12;
  if(!/\b(unit|inquiry|because|connect|theme|central idea|line of inquiry)\b/i.test(desc || '')) score += 12;
  if(/\b(minecraft education|minecraft)\b/i.test(tool || '')) score -= 50; // curated lessons should not be casually replaced
  if(/\b(stem|lego spike|sphero|bee-bot|bee bots|makey makey)\b/i.test(tool || '')) score -= 10;
  return score;
}

function bulkSafeDraftPickSlot_(e, toolName){
  const targetKey = bulkDiagnosticToolKey_(toolName);
  const sugs = getSugs(e);
  let bestIdx = -1;
  let bestScore = -9999;
  for(let i=0; i<sugs.length; i++){
    if(i === 5) continue;
    const s = sugs[i];
    if(s && isRealSug(s) && bulkDiagnosticToolKey_(sugTool(s)) === targetKey) continue;
    const score = bulkSafeDraftSlotScore_(s, i);
    if(score > bestScore){ bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function bulkSafeDraftScanNamedTool_(toolName, targetYears){
  const base = bulkSafePreviewScanNamedTool_(toolName, targetYears);
  const candidates = [];
  (base.candidates || []).forEach(c => {
    const e = DATA[c.entryIdx];
    const slotIdx = bulkSafeDraftPickSlot_(e, toolName);
    if(slotIdx < 0) return;
    candidates.push(Object.assign({}, c, { slotIdx }));
  });
  return Object.assign({}, base, { candidates });
}

function bulkRunSafeDraftOnly_(text){
  const cleanText = String(text || '').replace(/^\s*(draft|draft-safe|safe-draft)\s*:?\s*/i, '').trim();
  const info = bulkDiagnosticDetectRoute_(cleanText);
  const years = info.targetYears && info.targetYears.length ? info.targetYears : [];
  const yearsLabel = years.length ? years.join(', ') : 'All years';

  if(!info.namedTool){
    bulkChatAddMessage('assistant', `
      <div style="padding:2px 0">
        <div style="font-size:10px;color:var(--purple);font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">🧪 Safe draft mode</div>
        <div>I could not confidently detect a named tool in that request.</div>
        <div style="margin-top:8px;color:var(--dim);font-size:12px">Try: <strong>draft: Find more opportunities to use Makey Makey</strong></div>
        <div style="margin-top:10px;font-size:12px;color:#F5A623;font-style:italic">No AI call was made. No changes were drafted or saved.</div>
      </div>`);
    return;
  }

  const scan = bulkSafeDraftScanNamedTool_(info.namedTool, years);
  const maxDrafts = 5;
  const selected = scan.candidates.slice(0, maxDrafts);

  if(!selected.length){
    bulkChatAddMessage('assistant', `
      <div style="padding:2px 0">
        <div style="font-size:10px;color:var(--purple);font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">🧪 Safe draft mode</div>
        <div>I found no safe candidate units for <strong>${bulkDiagnosticEscape_(info.namedTool)}</strong>${years.length?' in '+bulkDiagnosticEscape_(yearsLabel):''}.</div>
        <div style="margin-top:8px;color:var(--dim);font-size:12px">Existing slots: ${scan.existingSlots || 0} · skipped already using tool: ${scan.skipped?.alreadyHasTool || 0} · skipped by age range: ${scan.skipped?.age || 0}</div>
        <div style="margin-top:10px;font-size:12px;color:#F5A623;font-style:italic">No AI call was made. No changes were drafted or saved.</div>
      </div>`);
    return;
  }

  const changes = selected.map(c => {
    const e = DATA[c.entryIdx] || {};
    return {
      entryIdx: c.entryIdx,
      sugIdx: c.slotIdx,
      t: info.namedTool,
      d: bulkSafeDraftDescriptionForTool_(info.namedTool, e),
      reason: `Safe named-tool opportunity draft for ${info.namedTool}. This unit does not already use the tool. Slot #6/STEM is protected. Review before applying.`,
      improvementConfidence: 'Draft-only',
      whyBetter: 'Adds a concrete student action, student-created product and unit connection without calling AI or changing anything automatically.'
    };
  });

  const sample = selected.slice(0,5).map((c, i) => `• ${bulkDiagnosticEscape_(c.campus)} · ${bulkDiagnosticEscape_(c.year)} · ${bulkDiagnosticEscape_(c.theme)}`).join('<br>');
  const capped = scan.candidates.length > selected.length ? `<br><span style="font-size:12px;color:var(--dim)">I drafted the first ${selected.length} of ${scan.candidates.length} candidate units to keep this safe. Run again after reviewing if you want more.</span>` : '';
  bulkChatAddMessage('assistant', `✅ <strong>${changes.length} ${bulkDiagnosticEscape_(info.namedTool)} opportunit${changes.length!==1?'ies':'y'}</strong> ready for review.<br><br><span style="font-size:12px;color:var(--lime)">Safe draft mode:</span> found candidates locally, skipped units already using the tool, avoided STEM slot #6, made no AI calls and saved nothing automatically.${capped}<br><br><span style="font-size:12px;color:var(--lime)">Sample targets:</span><br>${sample}`);
  bulkChatMemory.push({ role:'assistant', content:`Safe-drafted ${changes.length} ${info.namedTool} opportunities.` });
  window._snapshotReason = `Before safe ${info.namedTool} opportunity drafts`;
  showChangesPopup(changes);
  bulkChatState = 'done';
}

function bulkExtractTargetYears_(instruction){
  const t = String(instruction || '').toLowerCase();
  const out = new Set();
  if(/\b(prep|foundation)\b/.test(t)) out.add('Prep');

  // Direct forms: Year 5, yr 6, y4
  const re = /\b(?:year|yr|y)\s*([1-6])\b/g;
  let m;
  while((m = re.exec(t)) !== null){ out.add('Year ' + m[1]); }

  // Compact or grouped forms: Years 5 and 6, Year 5/6, yrs 3-4, y5 & y6
  const groupRe = /\b(?:years?|yrs?|y)\s*([1-6])(?:\s*(?:and|&|,|\/|-)\s*([1-6]))?(?:\s*(?:and|&|,|\/)\s*([1-6]))?/g;
  while((m = groupRe.exec(t)) !== null){
    [m[1], m[2], m[3]].filter(Boolean).forEach(n => out.add('Year ' + n));
    if(m[1] && m[2] && t.slice(m.index, groupRe.lastIndex).includes('-')){
      const a = Number(m[1]), b = Number(m[2]);
      for(let n=Math.min(a,b); n<=Math.max(a,b); n++) out.add('Year ' + n);
    }
  }

  // Contextual shorthand after a year mention: "year 5 and 6" only gives the
  // first number to the simple regex above, so explicitly capture the trailing number.
  const trailing = t.match(/\b(?:year|yr|y)\s*([1-6])\s*(?:and|&|\/)\s*([1-6])\b/);
  if(trailing){ out.add('Year ' + trailing[1]); out.add('Year ' + trailing[2]); }

  return [...out].sort((a,b) => YR.indexOf(a) - YR.indexOf(b));
}
// Backward-compatible alias
function buildMinecraftContext(){ return buildLibraryContext('minecraft'); }

// ========== ADD LIBRARY DIALOG ==========

function showAddLibraryDialog(){
  const existing = document.getElementById('add-lib-overlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'add-lib-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';

  overlay.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:480px;width:100%">
      <h3 style="font-size:18px;font-weight:900;margin-bottom:6px">Add New Library</h3>
      <p style="font-size:13px;color:var(--dim);margin-bottom:20px;line-height:1.6">Create a new lesson library section. You can add lessons to it afterward.</p>

      <div style="font-size:11px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Library Name <span style="color:#f87171">*</span></div>
      <input id="add-lib-name" class="inp" placeholder="e.g. Code.org, Tinkercad, Common Sense Education" style="margin-bottom:14px;font-size:13px">

      <div style="font-size:11px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Icon (emoji)</div>
      <input id="add-lib-icon" class="inp" placeholder="e.g. 🧩 💻 🎨" style="margin-bottom:14px;font-size:13px;width:80px" maxlength="4">

      <div style="font-size:11px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">URL Pattern (for auto-detection)</div>
      <input id="add-lib-urlpattern" class="inp" placeholder="e.g. code.org or tinkercad.com" style="margin-bottom:14px;font-size:13px">

      <div style="font-size:11px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Lesson URL Prefix (for auto-extracting titles)</div>
      <input id="add-lib-urlprefix" class="inp" placeholder="e.g. https://code.org/curriculum/lesson/" style="margin-bottom:20px;font-size:13px">

      <div style="display:flex;gap:10px">
        <button class="btn-pri" onclick="createNewLibrary()" style="flex:1">Create Library</button>
        <button class="btn" onclick="document.getElementById('add-lib-overlay').remove()" style="padding:12px 20px">Cancel</button>
      </div>
      <div id="add-lib-status" style="font-size:12px;font-weight:600;margin-top:10px"></div>
    </div>`;

  document.body.appendChild(overlay);
  document.getElementById('add-lib-name').focus();
}

function createNewLibrary(){
  const name = document.getElementById('add-lib-name')?.value.trim();
  const icon = document.getElementById('add-lib-icon')?.value.trim() || '📚';
  const urlPattern = document.getElementById('add-lib-urlpattern')?.value.trim();
  const urlPrefix = document.getElementById('add-lib-urlprefix')?.value.trim();
  const statusEl = document.getElementById('add-lib-status');

  if(!name){ statusEl.textContent = '⚠ Name is required'; statusEl.style.color = '#f87171'; return; }

  // Generate key from name
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if(!key){ statusEl.textContent = '⚠ Invalid name'; statusEl.style.color = '#f87171'; return; }
  if(LIBRARIES[key]){ statusEl.textContent = '⚠ A library with this name already exists'; statusEl.style.color = '#f87171'; return; }

  // Create the library
  LIBRARIES[key] = [];
  LIBRARIES_META[key] = { name, icon, urlPattern, urlPrefix, urlHint: urlPattern ? `Paste a lesson URL from ${urlPattern}` : 'Paste a lesson URL', subjects: [...COMMON_SUBJECTS] };

  saveLibraries();
  renderLibraries();
  document.getElementById('add-lib-overlay').remove();
  setStatus(`Library "${name}" created ✓`);
}

// ========== DELETE LIBRARY ==========
function deleteLibrary(key){
  const meta = getLibraryMeta(key);
  const count = (LIBRARIES[key]||[]).length;
  if(!confirm(`Delete the "${meta.name}" library${count ? ` and its ${count} lesson${count!==1?'s':''}` : ''}?\n\nThis cannot be undone.`)) return;
  delete LIBRARIES[key];
  delete LIBRARIES_META[key];
  saveLibraries();
  renderLibraries();
  setStatus(`Library "${meta.name}" deleted`);
}

// ========== GENERIC LIBRARY FUNCTIONS ==========

function libToggleSection(key){
  const body = document.getElementById(`lib-${key}-body`);
  const arrow = document.getElementById(`lib-${key}-arrow`);
  if(!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if(arrow) arrow.style.transform = open ? '' : 'rotate(180deg)';
}

function libSlugToTitle(slug){
  if(!slug) return '';
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function libExtractFromUrl(key){
  const urlEl = document.getElementById(`lib-${key}-url`);
  const titleEl = document.getElementById(`lib-${key}-title`);
  if(!urlEl || !titleEl) return;
  const url = urlEl.value.trim();
  const m = url.match(/lessons?\/([a-z0-9-]+)/i);
  if(m && !titleEl.value.trim()){
    titleEl.value = libSlugToTitle(m[1]);
  }
}

function libClearForm(key){
  [`lib-${key}-url`,`lib-${key}-title`,`lib-${key}-desc`].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value='';
  });
  [`lib-${key}-ages`,`lib-${key}-subject`].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value='';
  });
  const s = document.getElementById(`lib-${key}-status`);
  if(s) s.textContent = '';
}

function libAddLesson(key){
  const url = document.getElementById(`lib-${key}-url`)?.value.trim() || '';
  const title = document.getElementById(`lib-${key}-title`)?.value.trim() || '';
  const ages = document.getElementById(`lib-${key}-ages`)?.value || '';
  const subject = document.getElementById(`lib-${key}-subject`)?.value || '';
  const desc = document.getElementById(`lib-${key}-desc`)?.value.trim() || '';
  const statusEl = document.getElementById(`lib-${key}-status`);

  if(!title){ if(statusEl){ statusEl.textContent='⚠ Title is required'; statusEl.style.color='#f87171'; } return; }
  if(!ages){ if(statusEl){ statusEl.textContent='⚠ Select an age rating'; statusEl.style.color='#f87171'; } return; }
  if(!subject){ if(statusEl){ statusEl.textContent='⚠ Select a subject'; statusEl.style.color='#f87171'; } return; }

  if(!LIBRARIES[key]) LIBRARIES[key] = [];
  const lessons = LIBRARIES[key];
  const k = title.toLowerCase().trim();
  const existingIdx = lessons.findIndex(l => l.title.toLowerCase().trim() === k);
  const entry = { title, desc, ages, subject };
  if(url) entry.url = url;

  let msg;
  if(existingIdx >= 0){
    lessons[existingIdx] = entry;
    msg = `✓ "${title}" updated`;
  } else {
    lessons.push(entry);
    msg = `✓ "${title}" added`;
  }

  libClearForm(key);
  if(statusEl){ statusEl.textContent = msg; statusEl.style.color='var(--lime)'; }
  saveLibraries();
  renderLibraries();
}

function libDeleteLesson(key, title){
  const meta = getLibraryMeta(key);
  if(!confirm(`Delete "${title}" from the ${meta.name} library?`)) return;
  if(!LIBRARIES[key]) return;
  LIBRARIES[key] = LIBRARIES[key].filter(l => l.title !== title);
  saveLibraries();
  renderLibraries();
}

function libEditLesson(key, title){
  const lessons = getLibraryLessons(key);
  const lesson = lessons.find(l => l.title === title);
  if(!lesson) return;
  document.getElementById(`lib-${key}-url`).value = lesson.url || '';
  document.getElementById(`lib-${key}-title`).value = lesson.title;
  document.getElementById(`lib-${key}-ages`).value = lesson.ages;
  document.getElementById(`lib-${key}-subject`).value = lesson.subject || '';
  document.getElementById(`lib-${key}-desc`).value = lesson.desc || '';
  // Expand section if collapsed
  const body = document.getElementById(`lib-${key}-body`);
  const arrow = document.getElementById(`lib-${key}-arrow`);
  if(body) body.style.display = 'block';
  if(arrow) arrow.style.transform = 'rotate(180deg)';
  document.getElementById(`lib-${key}-title`).focus();
  window.scrollTo({top:0, behavior:'smooth'});
}

function libExportAll(){
  const saveObj = { _meta: LIBRARIES_META };
  getLibraryKeys().forEach(k => { saveObj[k] = LIBRARIES[k] || []; });
  const blob = new Blob([JSON.stringify(saveObj, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `libraries-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Keep old name working for backward compat
function libExportLessons(){ libExportAll(); }

function libImportAllTrigger(){ document.getElementById('lib-import-all')?.click(); }
function libImportTrigger(){ libImportAllTrigger(); } // backward compat

function libImportAll(event){
  const file = event.target.files?.[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      let totalAdded = 0, totalUpdated = 0;

      // Handle _meta
      if(imported._meta && typeof imported._meta === 'object'){
        Object.assign(LIBRARIES_META, imported._meta);
      }

      // Process each library key
      Object.keys(imported).forEach(key => {
        if(key === '_meta') return;
        const mcLessons = Array.isArray(imported[key]) ? imported[key] : [];
        const valid = mcLessons.filter(l => l && l.title && l.ages && l.subject);
        if(!valid.length) return;

        if(!LIBRARIES[key]) LIBRARIES[key] = [];
        let added = 0, updated = 0;
        valid.forEach(l => {
          const k = l.title.toLowerCase().trim();
          const idx = LIBRARIES[key].findIndex(e => e.title.toLowerCase().trim() === k);
          const entry = { title: l.title, desc: l.desc||'', ages: l.ages, subject: l.subject };
          if(l.url) entry.url = l.url;
          if(idx >= 0){ LIBRARIES[key][idx] = entry; updated++; }
          else { LIBRARIES[key].push(entry); added++; }
        });
        totalAdded += added;
        totalUpdated += updated;
      });

      // Also support plain array import (old format — assumes minecraft)
      if(Array.isArray(imported)){
        const valid = imported.filter(l => l && l.title && l.ages && l.subject);
        if(valid.length){
          if(!LIBRARIES.minecraft) LIBRARIES.minecraft = [];
          valid.forEach(l => {
            const k = l.title.toLowerCase().trim();
            const idx = LIBRARIES.minecraft.findIndex(e => e.title.toLowerCase().trim() === k);
            const entry = { title: l.title, desc: l.desc||'', ages: l.ages, subject: l.subject };
            if(l.url) entry.url = l.url;
            if(idx >= 0){ LIBRARIES.minecraft[idx] = entry; totalUpdated++; }
            else { LIBRARIES.minecraft.push(entry); totalAdded++; }
          });
        }
      }

      saveLibraries();
      alert(`Imported: ${totalAdded} added, ${totalUpdated} updated`);
      renderLibraries();
    } catch(err){
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// Keep old name working
function libImportLessons(event){ libImportAll(event); }

// ========== LIBRARIES PANEL RENDERER ==========

function renderLibraries(){
  const container = document.getElementById('lib-sections');
  if(!container) return;

  const keys = getLibraryKeys();
  const ageOptions = `<option value="">Age rating…</option>
    <option value="5+">5+ (all year levels)</option>
    <option value="8+">8+ (Year 3+)</option>
    <option value="10+">10+ (Year 5+)</option>
    <option value="11+">11+ (Year 6 only)</option>`;

  container.innerHTML = keys.map(key => {
    const meta = getLibraryMeta(key);
    const lessons = getLibraryLessons(key);
    const isBuiltIn = key === 'minecraft' || key === 'microbit';
    const subjects = meta.subjects || COMMON_SUBJECTS;
    const subjectOptions = subjects.map(s => `<option value="${esc(s)}">${esc(s.split('&').map(p=>p.trim().charAt(0).toUpperCase()+p.trim().slice(1).toLowerCase()).join(' & '))}</option>`).join('');

    // Group lessons by subject
    const bySubject = {};
    lessons.forEach(l => {
      const s = l.subject || 'OTHER';
      if(!bySubject[s]) bySubject[s] = [];
      bySubject[s].push(l);
    });

    const lessonsHtml = !lessons.length
      ? '<div style="color:var(--dim);font-size:13px;padding:12px 0">No lessons saved yet. Add your first above, or import a libraries.json file.</div>'
      : Object.entries(bySubject).map(([subj, list]) => `
        <div style="margin-bottom:18px">
          <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:8px">${esc(subj)} <span style="color:var(--dim);font-weight:600">(${list.length})</span></div>
          ${list.map(l => `
            <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:6px;display:flex;align-items:center;gap:10px">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                  <span style="font-size:14px;font-weight:700;color:var(--text)">${esc(l.title)}</span>
                  <span style="font-size:10px;padding:2px 7px;border-radius:20px;background:rgba(197,232,74,0.12);color:var(--lime);font-weight:700">ages ${esc(l.ages)}</span>
                </div>
                ${l.desc ? `<div style="font-size:12px;color:var(--dim);line-height:1.5">${esc(l.desc)}</div>` : ''}
                ${l.url ? `<a href="${esc(l.url)}" target="_blank" style="font-size:11px;color:var(--mint);text-decoration:none;word-break:break-all">${esc(l.url)}</a>` : ''}
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn-sm" onclick="libEditLesson('${esc(key)}','${esc(l.title).replace(/'/g,"\\'")}')">Edit</button>
                <button class="btn-sm" onclick="libDeleteLesson('${esc(key)}','${esc(l.title).replace(/'/g,"\\'")}')" style="color:#FF8080">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');

    return `
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:14px">
      <div onclick="libToggleSection('${esc(key)}')" style="display:flex;align-items:center;gap:10px;padding:18px 24px;cursor:pointer;user-select:none;background:var(--card)">
        <span style="font-size:18px">${meta.icon}</span>
        <span style="font-size:15px;font-weight:800;color:var(--text);flex:1">${esc(meta.name)}</span>
        <span style="font-size:11px;color:var(--dim);font-weight:700">${lessons.length} lesson${lessons.length!==1?'s':''}</span>
        ${!isBuiltIn ? `<button class="btn-sm" onclick="event.stopPropagation();deleteLibrary('${esc(key)}')" style="color:#FF8080;font-size:11px;padding:3px 10px">Delete Library</button>` : ''}
        <span id="lib-${esc(key)}-arrow" style="font-size:14px;color:var(--dim);transition:transform .2s">▼</span>
      </div>
      <div id="lib-${esc(key)}-body" style="display:none;padding:0 24px 20px;border-top:1px solid var(--border)">
        <p style="font-size:13px;color:var(--dim);margin:14px 0;line-height:1.6">${esc(meta.urlHint || 'Add lessons to this library.')}${meta.urlPattern ? ` (<a href="https://${esc(meta.urlPattern)}" target="_blank" style="color:var(--lime)">${esc(meta.urlPattern)}</a>)` : ''}</p>

        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:10px">
          <input id="lib-${esc(key)}-url" class="inp" placeholder="Lesson URL (optional)" style="margin-bottom:0;font-size:13px" oninput="libExtractFromUrl('${esc(key)}')">
          <button class="btn-sm" onclick="libClearForm('${esc(key)}')" style="white-space:nowrap">Clear</button>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr 1.5fr;gap:8px;margin-bottom:10px">
          <input id="lib-${esc(key)}-title" class="inp" placeholder="Lesson title" style="margin-bottom:0;font-size:13px">
          <select id="lib-${esc(key)}-ages" class="inp" style="margin-bottom:0;font-size:13px">
            ${ageOptions}
          </select>
          <select id="lib-${esc(key)}-subject" class="inp" style="margin-bottom:0;font-size:13px">
            <option value="">Subject…</option>
            ${subjectOptions}
          </select>
        </div>

        <input id="lib-${esc(key)}-desc" class="inp" placeholder="Short description" style="margin-bottom:10px;font-size:13px">

        <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px">
          <button class="btn-pri" onclick="libAddLesson('${esc(key)}')" style="font-size:13px;padding:10px 16px">+ Add lesson</button>
          <span id="lib-${esc(key)}-status" style="font-size:12px;font-weight:600"></span>
        </div>

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-top:12px;border-top:1px solid var(--border)">
          <span style="font-size:10px;color:var(--dim);text-transform:uppercase;font-weight:700;letter-spacing:1.5px">Saved lessons · ${lessons.length}</span>
          <div style="flex:1"></div>
        </div>
        ${lessonsHtml}
      </div>
    </div>`;
  }).join('');
}

// ========== END LIBRARIES PANEL ==========

// Build KNOWN_PLATFORMS dynamically — includes all user-created libraries with lessons
function buildKnownPlatforms(){
  const platforms = [
    { match: /minecraft/i, name: 'Minecraft Education', key: 'minecraft',
      get context(){ return buildLibraryContext('minecraft'); } },
    { match: /microbit\.org|micro.?bit/i, name: 'Micro:bit', key: 'microbit',
      get context(){ return buildLibraryContext('microbit'); } },
    { match: /wise discussion|schoolbox.*discussion|schoolbox.*chatbot|ai discussion chatbot|discussion chatbot/i, name: 'Wise Discussion Chatbots',
      context: WISE_DISCUSSION_CHATBOTS_CONTEXT },
    { match: /code\.org/i, name: 'Code.org',
      context: 'You have strong knowledge of Code.org courses and lesson plans. Reference specific lessons, courses and activities from Code.org when proposing changes.' },
    { match: /scratch\.mit|scratchfoundation/i, name: 'Scratch',
      context: 'You know the Scratch educator resources and lesson library. Reference specific Scratch projects and activities when proposing changes.' },
    { match: /tinkercad/i, name: 'Tinkercad',
      context: 'You know the Tinkercad lesson library for 3D design and circuits. Reference specific Tinkercad lessons when proposing changes.' },
    { match: /commonsense/i, name: 'Common Sense Education',
      context: 'You know the Common Sense Education digital citizenship curriculum. Reference specific lessons when proposing changes.' },
    { match: /canva\.com\/edu/i, name: 'Canva for Education',
      context: 'You know the Canva for Education lesson templates and resources.' },
  ];

  // Add user-created libraries that have a URL pattern and lessons
  getLibraryKeys().forEach(key => {
    if(key === 'minecraft' || key === 'microbit') return; // already included
    const meta = getLibraryMeta(key);
    const lessons = getLibraryLessons(key);
    if(!meta.urlPattern || !lessons.length) return;
    // Check if already covered by a built-in pattern
    const alreadyCovered = platforms.some(p => p.match.test(meta.urlPattern));
    if(alreadyCovered) return;
    const pattern = meta.urlPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    platforms.push({
      match: new RegExp(pattern, 'i'),
      name: meta.name,
      key,
      get context(){ return buildLibraryContext(key); }
    });
  });

  return platforms;
}

// Use a getter so it always reflects current library state
const KNOWN_PLATFORMS_STATIC = []; // placeholder for direct array references
Object.defineProperty(window, 'KNOWN_PLATFORMS', {
  get(){ return buildKnownPlatforms(); },
  configurable: true
});

// ========== BULK AI EDIT — CHATBOT INTERFACE ==========

let bulkChatHistory = []; // [{role:'user'|'assistant', content:'...', options?:[{label,value}], selected?:string}]
let bulkChatState = 'idle'; // idle | clarifying | analysing | done
let bulkChatContext = {}; // stores resolved instruction, platform, etc.
let bulkChatMemory = []; // full multi-turn memory for GPT: [{role, content}]
let bulkInsightsComputed = false;

// Compute proactive insights about the library state
function computeBulkInsights(){
  const complete = DATA.filter(e => e.audited && getSugs(e).filter(isRealSug).length >= 6);
  if(!complete.length) return [];

  // Tool frequency across library (normalised)
  const freq = {};
  complete.forEach(e => {
    getSugs(e).forEach(s => {
      const t = normaliseToolName((s && s.t ? s.t.trim() : ''));
      if(!t) return;
      freq[t] = (freq[t] || 0) + 1;
    });
  });
  const sorted = Object.entries(freq).sort((a,b) => b[1] - a[1]);
  const totalSlots = complete.length * 6;

  const insights = [];

  // 1. Overused tool
  if(sorted.length && sorted[0][1] > 13){
    const [tool, count] = sorted[0];
    const pct = Math.round((count / totalSlots) * 100);
    insights.push({
      icon: '⚠️',
      title: `${tool} is overused`,
      body: `Appears in <strong>${count} suggestion slots</strong> (${pct}% of the library). Would you like me to find places to diversify?`,
      action: `Diversify ${tool} suggestions across the library`
    });
  }

  // 2. Minecraft underuse if library has entries
  if(typeof LIBRARIES !== 'undefined' && LIBRARIES.minecraft && LIBRARIES.minecraft.length > 20){
    const mcCount = freq['Minecraft Education'] || 0;
    if(mcCount < 8){
      insights.push({
        icon: '⛏️',
        title: `Minecraft Education underused`,
        body: `You've curated <strong>${LIBRARIES.minecraft.length} lessons</strong> in your Minecraft library but it only appears in <strong>${mcCount} slots</strong>. There may be unused matches.`,
        action: 'Find opportunities to use Minecraft Education'
      });
    }
  }

  // 3. Micro:bit underuse if library has entries
  if(typeof LIBRARIES !== 'undefined' && LIBRARIES.microbit && LIBRARIES.microbit.length > 10){
    const mbCount = freq['Micro:bit'] || 0;
    if(mbCount < 5){
      insights.push({
        icon: '🔌',
        title: `Micro:bit underused`,
        body: `You have <strong>${LIBRARIES.microbit.length} Micro:bit lessons</strong> curated but only <strong>${mbCount} slots</strong> use them. Let me scan for matches.`,
        action: 'Find opportunities to use Micro:bit'
      });
    }
  }

  // 4. Usage vs suggestion mismatch (requires live analytics)
  if(window._usedRowsCache){
    const usedRows = window._usedRowsCache.slice(1).filter(r => r && r[5]);
    const usedFreq = {};
    usedRows.forEach(r => {
      const t = normaliseToolName(String(r[5]||'').trim());
      if(t) usedFreq[t] = (usedFreq[t]||0) + 1;
    });
    // Find "dead" tools: suggested 5+ times, used 0 times
    const dead = Object.entries(freq).filter(([t, c]) => c >= 5 && !(usedFreq[t])).sort((a,b)=>b[1]-a[1]);
    if(dead.length){
      const [tool, count] = dead[0];
      insights.push({
        icon: '💤',
        title: `${tool} suggestions are ignored`,
        body: `Suggested <strong>${count}×</strong> but teachers have <strong>never</strong> clicked "I Used This" for it. Consider replacing or improving these.`,
        action: `Replace ${tool} suggestions with more appealing alternatives`
      });
    }
  }

  // 5. Weak/generic suggestions scan
  let weakCount = 0;
  const weakPatterns = [
    /research online/i, /look up/i, /google (this|it)/i,
    /type (your|the)/i, /write (about|up)/i,
    /use (the|a) (app|tool|program)/i,
    /simply|basic[ae]lly|just to/i
  ];
  DATA.forEach(e => {
    if(!e.audited) return;
    getSugs(e).forEach(s => {
      const d = (s && s.d ? s.d : '').toLowerCase();
      if(d.length < 60) { weakCount++; return; }
      if(weakPatterns.some(p => p.test(d))) weakCount++;
    });
  });
  if(weakCount >= 5){
    insights.push({
      icon: '🔎',
      title: `${weakCount} weak suggestions detected`,
      body: `Descriptions that are very short (<60 chars), generic ("research online", "just use the app"), or vague. These rarely get used by teachers.`,
      action: 'Scan the library for weak or generic suggestions and propose stronger replacements'
    });
  }

  return insights.slice(0, 4);
}

function renderBulkWelcome(){
  const container = document.getElementById('bulk-chat-messages');
  if(!container) return;
  const welcome = document.getElementById('bulk-chat-welcome');
  if(!welcome) return;

  const insights = computeBulkInsights();
  const totalEntries = DATA.filter(e => e.audited).length;
  const completeEntries = DATA.filter(e => e.audited && getSugs(e).filter(isRealSug).length >= 6).length;

  let html = `<div class="chat-bubble">👋 Hi! I've scanned your library — <strong>${completeEntries} of ${totalEntries}</strong> entries are complete.`;

  if(insights.length){
    html += `\n\nHere's what I noticed:</div>`;
    html += `<div style="margin-top:10px">`;
    insights.forEach(ins => {
      html += `<div class="insight-card"><div style="display:flex;align-items:flex-start;gap:10px"><span class="insight-icon">${ins.icon}</span><div style="flex:1"><div class="insight-title">${ins.title}</div><div class="insight-body">${ins.body}</div><span class="insight-action" onclick="bulkChatQuickStart('${ins.action.replace(/'/g,"\\'")}')">→ ${esc(ins.action)}</span></div></div></div>`;
    });
    html += `</div>`;
    html += `<div class="chat-bubble" style="margin-top:10px">Or ask me anything — "Find X opportunities", "Replace Y with Z", "Scan for weak suggestions", etc.</div>`;
  } else {
    html += `\n\nYour library looks well-balanced! Try:</div>`;
    html += `<div style="margin-top:10px"><div class="insight-card"><div style="display:flex;align-items:flex-start;gap:10px"><span class="insight-icon">💭</span><div style="flex:1"><div class="insight-title">Explore with "what if"</div><div class="insight-body">Ask hypothetical questions like <em>"What if I banned Book Creator?"</em> — I'll simulate the impact without changing anything.</div></div></div></div>`;
  }

  welcome.innerHTML = html;
  bulkInsightsComputed = true;
}

function bulkChatQuickStart(text){
  const input = document.getElementById('bulk-chat-input');
  if(input){ input.value = text; input.focus(); }
  // Auto-send after a brief pause so user sees what was filled
  setTimeout(() => bulkChatSend(), 300);
}

function bulkChatReset(){
  if(bulkChatState === 'analysing'){
    if(!confirm('Analysis in progress. Reset anyway?')) return;
  }
  bulkChatHistory = [];
  bulkChatContext = {};
  bulkChatMemory = [];
  bulkChatState = 'idle';
  hideReasoningSteps();
  renderBulkWelcome();
  renderBulkChat();
}

// ========== WHAT IF SIMULATIONS ==========
async function runWhatIfSimulation(text){
  const quickMatch = text.match(/what\s*if\s+(.+)/i);
  const scenario = quickMatch ? quickMatch[1].trim() : text;

  bulkChatAddMessage('assistant', `🔮 Simulating: "${esc(scenario)}"`);
  showReasoningSteps([
    { text: 'Reading your hypothesis', status: 'active' },
    { text: 'Scanning library for affected entries', status: 'pending' },
    { text: 'Computing ripple effects', status: 'pending' }
  ]);

  try {
    updateReasoningStep(0, 'done');
    updateReasoningStep(1, 'active');

    const freq = {};
    DATA.forEach(e => {
      getSugs(e).forEach(s => {
        const t = normaliseToolName((s && s.t ? s.t.trim() : ''));
        if(t) freq[t] = (freq[t] || 0) + 1;
      });
    });
    const topTools = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([t,c])=>`${t}(${c}x)`).join(', ');

    updateReasoningStep(1, 'done');
    updateReasoningStep(2, 'active');

    const prompt = `You are a digital-learning data analyst. A coordinator is asking a hypothetical "what if" question about their library of ${DATA.length} IB PYP unit planners.

Current tool distribution: ${topTools}

Scenario: "${scenario}"

Respond with a concise, well-formatted analysis answering the hypothetical. Include:
1. A one-sentence direct answer
2. Specific numbers: how many entries / slots would be affected
3. 2-3 concrete consequences (e.g. which tools would absorb the displaced slots, coverage gaps, age-level impacts)
4. A practical recommendation

Be concrete. Use <strong> tags for emphasis, <br> for line breaks. Keep under 250 words. Do NOT produce any APPLY_CHANGES block — this is analysis-only.`;

    const response = await callAI(
      [{role:'user', parts:[{text: prompt}]}],
      null, OPENAI_FAST_MODEL
    );

    updateReasoningStep(2, 'done');
    setTimeout(hideReasoningSteps, 800);

    const clean = response.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
    bulkChatAddMessage('assistant', `<div style="padding:4px 0"><div style="font-size:10px;color:var(--purple);font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px">🔮 Hypothetical analysis</div>${clean}<br><br><em style="font-size:12px;color:var(--dim)">Nothing was changed. Type a non-"what if" request to actually make changes.</em></div>`);
    bulkChatMemory.push({ role: 'user', content: 'WHAT IF: ' + scenario });
    bulkChatMemory.push({ role: 'assistant', content: 'Hypothetical analysis: ' + clean.replace(/<[^>]+>/g, '').slice(0, 500) });
  } catch(e){
    hideReasoningSteps();
    bulkChatAddMessage('assistant', `❌ Simulation error: ${e.message}`);
  }
}

// ========== VOICE INPUT ==========
let _voiceRec = null;
let _voiceActive = false;

function toggleBulkVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    alert('Voice input is not supported in this browser. Try Chrome or Edge.');
    return;
  }
  const btn = document.getElementById('btn-bulk-voice');
  const input = document.getElementById('bulk-chat-input');

  if(_voiceActive){
    try { _voiceRec && _voiceRec.stop(); } catch{}
    _voiceActive = false;
    if(btn){ btn.textContent = '🎤'; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
    return;
  }

  _voiceRec = new SR();
  _voiceRec.lang = 'en-AU';
  _voiceRec.interimResults = true;
  _voiceRec.continuous = false;

  let finalText = '';
  _voiceRec.onstart = () => {
    _voiceActive = true;
    if(btn){ btn.textContent = '🛑'; btn.style.background = '#FF6B6B'; btn.style.color = '#FFF'; btn.style.borderColor = '#FF6B6B'; }
    if(input) input.placeholder = 'Listening…';
  };
  _voiceRec.onresult = (e) => {
    let interim = '';
    for(let i = e.resultIndex; i < e.results.length; i++){
      const transcript = e.results[i][0].transcript;
      if(e.results[i].isFinal) finalText += transcript + ' ';
      else interim += transcript;
    }
    if(input) input.value = (finalText + interim).trim();
  };
  _voiceRec.onerror = (e) => {
    console.warn('Voice error:', e.error);
    _voiceActive = false;
    if(btn){ btn.textContent = '🎤'; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
    if(input) input.placeholder = 'Describe the change you want to make…';
    if(e.error === 'not-allowed') alert('Microphone access denied. Check browser permissions.');
  };
  _voiceRec.onend = () => {
    _voiceActive = false;
    if(btn){ btn.textContent = '🎤'; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
    if(input) input.placeholder = 'Describe the change you want to make…';
    if(finalText && input){ input.value = finalText.trim(); input.focus(); }
  };
  try { _voiceRec.start(); } catch(e){ console.warn(e); }
}

// ========== REASONING STREAM — shows AI thinking stages ==========
function showReasoningSteps(steps){
  const container = document.getElementById('bulk-reasoning');
  if(!container) return;
  container.style.display = 'block';
  container.innerHTML = steps.map((step, i) => {
    const status = step.status || 'pending';
    const icon = status === 'active' ? '⏳' : status === 'done' ? '✓' : status === 'error' ? '✗' : '○';
    return `<div class="reasoning-step ${status}" id="rstep-${i}">
      <span style="font-size:14px">${icon}</span>
      <span>${esc(step.text)}</span>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function updateReasoningStep(index, status, newText){
  const el = document.getElementById(`rstep-${index}`);
  if(!el) return;
  el.className = `reasoning-step ${status}`;
  const icon = status === 'active' ? '⏳' : status === 'done' ? '✓' : status === 'error' ? '✗' : '○';
  const textEl = el.querySelector('span:last-child');
  const iconEl = el.querySelector('span:first-child');
  if(iconEl) iconEl.textContent = icon;
  if(newText && textEl) textEl.textContent = newText;
}

function hideReasoningSteps(){
  const container = document.getElementById('bulk-reasoning');
  if(container){
    container.style.display = 'none';
    container.innerHTML = '';
  }
}

function bulkChatAddMessage(role, content, options){
  const msg = { role, content };
  if(options) msg.options = options;
  bulkChatHistory.push(msg);
  renderBulkChat();
}

function renderBulkChat(){
  const container = document.getElementById('bulk-chat-messages');
  if(!container) return;

  // Keep the welcome message + render history
  let html = '';
  bulkChatHistory.forEach((msg, idx) => {
    if(msg.role === 'user'){
      html += `<div class="chat-msg user"><div class="chat-bubble">${esc(msg.content)}</div></div>`;
    } else {
      html += `<div class="chat-msg model"><div class="chat-bubble">${msg.content}</div>`;
      // Render option buttons if present and not yet selected
      if(msg.options && !msg.selected){
        html += `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">`;
        msg.options.forEach((opt, oi) => {
          html += `<button class="btn" onclick="bulkChatSelectOption(${idx},${oi})" style="font-size:13px;padding:8px 16px;border-color:var(--lime);color:var(--lime)">${esc(opt.label)}</button>`;
        });
        html += `</div>`;
      } else if(msg.options && msg.selected){
        html += `<div style="margin-top:8px;font-size:12px;color:var(--lime);font-weight:700">✓ ${esc(msg.selected)}</div>`;
      }
      html += `</div>`;
    }
  });

  // Keep the initial welcome, then append history
  const welcomeMsg = container.querySelector('#bulk-chat-welcome');
  const welcomeHtml = welcomeMsg ? welcomeMsg.outerHTML : '';
  container.innerHTML = welcomeHtml + html;

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}


function handleBulkAnalysisError_(err){
  const message = err && err.message ? err.message : String(err || 'Unknown error');
  console.error('Bulk analysis failed safely:', err);
  try { hideReasoningSteps(); } catch(e){}
  try { stopProgress(); } catch(e){}
  try {
    const prog = document.getElementById('bulk-ai-progress');
    if(prog) prog.style.display = 'none';
  } catch(e){}
  bulkChatState = 'idle';
  const safe = (typeof esc === 'function') ? esc(message) : message.replace(/[&<>"']/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; });
  bulkChatAddMessage('assistant', '❌ Bulk analysis stopped safely instead of crashing the Studio.<br><br><span style="font-size:12px;color:#f87171">' + safe + '</span><br><br><span style="font-size:12px;color:var(--dim)">Try the request again, or click ↻ to reset the Bulk AI Chat if the conversation state looks stale.</span>');
}

function runStartBulkAnalysisSafely_(){
  return startBulkAnalysis().catch(handleBulkAnalysisError_);
}

function bulkChatUserTurns_(){
  return (bulkChatMemory || [])
    .filter(m => m && m.role === 'user')
    .map(m => String(m.content || '').trim())
    .filter(Boolean);
}

function bulkChatEffectiveInstruction_(rawInstruction){
  const raw = String(rawInstruction || '').trim();
  const userTurns = bulkChatUserTurns_();
  const priorTurns = userTurns.slice(0, -1);
  const isFollowUp = !!(bulkChatContext && bulkChatContext.isFollowUp);
  const refersBack = /\b(it|that|this|same|previous|above|those|them|connect|connected|relevant planners|all relevant planners|planners|units|entries)\b/i.test(raw);

  if(isFollowUp && priorTurns.length && refersBack){
    return priorTurns.join('\n') + '\n\nFollow-up instruction: ' + raw;
  }

  // If a follow-up is short and does not name the platform/lesson again, carry the previous user request forward.
  if(isFollowUp && priorTurns.length && raw.length < 120 && !/\b(minecraft|micro:?bit|wise|sphero|canva|book creator|lesson|tool|app)\b/i.test(raw)){
    return priorTurns.join('\n') + '\n\nFollow-up instruction: ' + raw;
  }

  return raw;
}

function bulkAppendClarifications_(instruction, clarifications){
  const list = Array.isArray(clarifications) ? clarifications : [];
  if(!list.length) return instruction;
  return String(instruction || '') + '\n\nAdditional context from conversation:\n' + list.map(c => 'Q: ' + (c.question || '') + '\nA: ' + (c.answer || '')).join('\n');
}

function bulkPlatformSearchText_(latestText){
  const userTurns = bulkChatUserTurns_();
  const base = userTurns.length ? userTurns.join('\n') : String(latestText || '');
  return base + '\n' + String(latestText || '');
}

function bulkChatSelectOption(msgIdx, optionIdx){
  const msg = bulkChatHistory[msgIdx];
  if(!msg || !msg.options) return;
  const selected = msg.options[optionIdx];
  msg.selected = selected.label;

  // Add user reply
  bulkChatAddMessage('user', selected.label);

  // Process the selection based on current state
  if(bulkChatState === 'clarifying'){
    bulkChatContext.clarifications = bulkChatContext.clarifications || [];
    bulkChatContext.clarifications.push({ question: msg.content, answer: selected.value || selected.label });

    // Check if we have enough clarification (max 3 rounds)
    if(bulkChatContext.clarifyRound >= 2 || selected.value === '__proceed__'){
      runStartBulkAnalysisSafely_();
    } else {
      bulkChatContext.clarifyRound++;
      askNextClarification();
    }
  }
}

async function bulkChatSend(){
  const input = document.getElementById('bulk-chat-input');
  if(!input) return;
  const text = input.value.trim();
  if(!text) return;
  input.value = '';

  // Safe-draft mode: locally draft a small batch and open review popup only. No AI calls, no auto-save.
  // Type: draft: Find more opportunities to use Makey Makey
  if(/^\s*(draft|draft-safe|safe-draft)\s*:?\s*/i.test(text)){
    if(bulkChatState === 'analysing'){
      bulkChatAddMessage('assistant', '⏳ Still analysing entries — wait for the current analysis to complete before running a safe draft.');
      return;
    }
    bulkChatAddMessage('user', text);
    bulkRunWithTopProgress_('Finding safe named-tool opportunities…', 'Safe draft ready for review ✓', function(){
      bulkRunSafeDraftOnly_(text);
    }, function(e){
      bulkChatAddMessage('assistant', '❌ Safe draft failed without changing anything: ' + bulkDiagnosticEscape_(e.message || e));
    });
    return;
  }

  // Safe-preview mode: find candidate units locally without calling AI, opening a review popup, or saving.
  // Type: safe: Find more opportunities to use Makey Makey
  if(/^\s*safe\s*:?\s*/i.test(text)){
    if(bulkChatState === 'analysing'){
      bulkChatAddMessage('assistant', '⏳ Still analysing entries — wait for the current analysis to complete before running a safe preview.');
      return;
    }
    bulkChatAddMessage('user', text);
    bulkRunWithTopProgress_('Scanning safe candidate units…', 'Safe preview ready ✓', function(){
      bulkRunSafePreviewOnly_(text);
    }, function(e){
      bulkChatAddMessage('assistant', '❌ Safe preview failed without changing anything: ' + bulkDiagnosticEscape_(e.message || e));
    });
    return;
  }

  // Diagnostic-only mode: classify a Bulk AI prompt without calling AI or drafting changes.
  // Type: diagnose: Find more opportunities to use Makey Makey
  if(/^\s*(diagnose|debug|route)\s*:?\s*/i.test(text)){
    if(bulkChatState === 'analysing'){
      bulkChatAddMessage('assistant', '⏳ Still analysing entries — wait for the current analysis to complete before running diagnostics.');
      return;
    }
    bulkChatAddMessage('user', text);
    bulkRunWithTopProgress_('Checking Bulk AI route…', 'Diagnostic ready ✓', function(){
      bulkRunDiagnosticOnly_(text);
    }, function(e){
      bulkChatAddMessage('assistant', '❌ Diagnostic failed safely: ' + bulkDiagnosticEscape_(e.message || e));
    });
    return;
  }

  // Normal named-tool opportunity prompts now use the tested safe draft route automatically.
  // Example: Find more opportunities to use Makey Makey
  // This avoids the old generic clarification path that asked about all 121 units.
  if(bulkChatState !== 'clarifying' && bulkChatState !== 'analysing'){
    let autoInfo = null;
    try { autoInfo = bulkDiagnosticDetectRoute_(text); } catch(e){ autoInfo = null; }
    if(autoInfo && autoInfo.route === 'named-tool opportunity search' && autoInfo.namedTool){
      bulkChatAddMessage('user', text);
      bulkRunWithTopProgress_('Finding safe ' + bulkDiagnosticEscape_(autoInfo.namedTool) + ' opportunities…', 'Safe draft ready for review ✓', function(){
        bulkRunSafeDraftOnly_(text);
      }, function(e){
        bulkChatAddMessage('assistant', '❌ Safe named-tool draft failed without changing anything: ' + bulkDiagnosticEscape_(e.message || e));
      });
      return;
    }
  }

  if(typeof ensureLibrariesLoadedForAI === 'function') await ensureLibrariesLoadedForAI();

  if(bulkChatState === 'analysing'){
    bulkChatAddMessage('assistant', '⏳ Still analysing entries — please wait for the current analysis to complete.');
    return;
  }

  // If we're in the middle of clarification and user types freely, treat as additional context
  if(bulkChatState === 'clarifying'){
    bulkChatAddMessage('user', text);
    bulkChatContext.clarifications = bulkChatContext.clarifications || [];
    bulkChatContext.clarifications.push({ question: 'Additional context from user', answer: text });
    runStartBulkAnalysisSafely_();
    return;
  }

  // Detect "what if" simulation requests — runs without applying
  const isWhatIf = /^\s*what\s*if\b/i.test(text);
  if(isWhatIf){
    bulkChatAddMessage('user', text);
    runWhatIfSimulation(text);
    return;
  }

  // Multi-turn: if a previous analysis completed and user types a new message,
  // treat it as a refinement of the previous run rather than reset.
  const isFollowUp = bulkChatMemory.length > 0 && bulkChatState === 'done';

  if(!isFollowUp){
    // New conversation
    bulkChatHistory = [];
    bulkChatContext = {};
    bulkChatMemory = [];
    bulkChatState = 'idle';
  }

  bulkChatAddMessage('user', text);
  bulkChatMemory.push({ role: 'user', content: text });

  // Detect platform from the full user conversation on follow-ups, so "connect it to all relevant planners"
  // still inherits the earlier Minecraft / specific-lesson request.
  const platforms = buildKnownPlatforms();
  const platformSearchText = bulkPlatformSearchText_(text);
  const platform = platforms.find(p => p.match.test(platformSearchText)) || bulkChatContext.platform || null;

  bulkChatContext.rawInstruction = text;
  bulkChatContext.platform = platform;
  bulkChatContext.clarifyRound = 0;
  bulkChatContext.isFollowUp = isFollowUp;

  // Show reasoning stream
  showReasoningSteps([
    { text: 'Reading your request', status: 'active' },
    { text: isFollowUp ? 'Recalling previous context' : 'Scanning tool distribution', status: 'pending' },
    { text: 'Deciding if clarification needed', status: 'pending' }
  ]);

  // Ask clarifying questions via AI
  bulkChatState = 'clarifying';

  try {
    updateReasoningStep(0, 'done');
    updateReasoningStep(1, 'active');
    
    const clarifyPrompt = buildClarifyPrompt(text, platform);
    
    setTimeout(() => updateReasoningStep(1, 'done'), 400);
    setTimeout(() => updateReasoningStep(2, 'active'), 500);
    
    const response = await callAI(
      [{role:'user', parts:[{text: clarifyPrompt}]}],
      null, OPENAI_FAST_MODEL
    );
    
    updateReasoningStep(2, 'done');
    setTimeout(hideReasoningSteps, 600);

    // Parse the AI's clarifying questions
    const parsed = parseClarifyResponse(response);

    if(parsed.readyToGo){
      // AI thinks the instruction is clear enough — proceed directly
      bulkChatAddMessage('assistant', `${parsed.summary || "Got it!"}\n\nI understand what you want — let me analyse all entries now.`);
      bulkChatMemory.push({ role: 'assistant', content: parsed.summary || 'Understood — analysing.' });
      runStartBulkAnalysisSafely_();
    } else {
      // Show the first clarifying question
      bulkChatContext.pendingQuestions = parsed.questions || [];
      showNextQuestion(parsed);
    }
  } catch(e){
    hideReasoningSteps();
    bulkChatState = 'idle';
    bulkChatAddMessage('assistant', `❌ Error: ${e.message}\n\nPlease try again.`);
  }
}

function buildClarifyPrompt(instruction, platform){
  const entryCount = DATA.filter(e => e.audited && getSugs(e).filter(isRealSug).length >= 6).length;
  const allTools = {};
  DATA.forEach(e => {
    getSugs(e).forEach(s => {
      const t = sugTool(s).trim();
      if(t) allTools[t] = (allTools[t]||0) + 1;
    });
  });
  const topTools = Object.entries(allTools).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([t,c])=>`${t} (${c}x)`).join(', ');

  // Include conversation memory for multi-turn context
  const memoryContext = bulkChatMemory.length > 1 ? `
PRIOR CONVERSATION (for context — the latest message is the current request):
${bulkChatMemory.slice(0, -1).map(m => `${m.role === 'user' ? 'Coordinator' : 'You'}: ${m.content}`).join('\n')}
` : '';

  return `You are a Digital Learning Coach assistant helping a coordinator make bulk changes to a library of ${entryCount} IB PYP unit planners at Wesley College.
${memoryContext}
The coordinator just said: "${instruction}"
${platform ? `\nDetected platform: ${platform.name}` : ''}

Current tool distribution (top 15): ${topTools}

Your task: Decide whether you need clarification before proceeding, or if the instruction is clear enough.

IMPORTANT: If the coordinator is refining a previous request (e.g. "now do that for Year 3 only", "remove the Minecraft ones", "also try Sphero"), treat the full conversation context as one continuous instruction and set readyToGo:true if the combined meaning is clear.

RESPOND IN THIS EXACT JSON FORMAT (no markdown fences, no preamble):
{
  "readyToGo": true/false,
  "summary": "Brief 1-sentence restatement of what you understood",
  "questions": [
    {
      "text": "Your clarifying question",
      "options": [
        {"label": "Short option text", "value": "value_to_use"},
        {"label": "Another option", "value": "value_to_use"}
      ]
    }
  ]
}

RULES:
- If the instruction is specific enough (names a tool, a clear action, and/or a lesson library), set readyToGo: true
- If unclear, ask 1-2 questions MAX (never more than 2). Each question should have 2-4 concise options.
- Always include a "Go ahead with my instruction as-is" option as the last option in the first question
- Questions should be SHORT and practical, not philosophical
- Focus on: scope (which year levels/campuses), replacement strategy, or which specific tools/lessons to target
- Keep option labels under 8 words`;
}

function parseClarifyResponse(response){
  try {
    const clean = response.replace(/```json|```/g,'').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if(start === -1 || end === -1) return { readyToGo: true, summary: '' };
    return JSON.parse(clean.slice(start, end+1));
  } catch(e){
    console.log('Clarify parse error:', e.message, response.slice(0,300));
    return { readyToGo: true, summary: '' };
  }
}

function showNextQuestion(parsed){
  if(!parsed.questions || !parsed.questions.length){
    bulkChatAddMessage('assistant', `${parsed.summary || "Got it!"}\n\nLet me analyse all entries now.`);
    runStartBulkAnalysisSafely_();
    return;
  }

  const q = parsed.questions[0];
  bulkChatContext.pendingQuestions = parsed.questions.slice(1);

  // Add a "proceed as-is" option if not already present
  const hasProceeed = q.options.some(o => o.value === '__proceed__');
  if(!hasProceeed){
    q.options.push({ label: 'Just go ahead as-is', value: '__proceed__' });
  }

  const summary = parsed.summary ? `${parsed.summary}\n\n` : '';
  bulkChatAddMessage('assistant', `${summary}${q.text}`, q.options);
}

