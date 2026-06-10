/* =============================================================
   09-legacy-restored.js

   Restores ~3,400 lines of functionality that were dropped during
   the modular refactor. The "modular" files 00-08 only covered
   about two-thirds of the original DLA_Studio_legacy_backup.html
   inline script; this file fills the gap.

   Contents (in order):
     - Audit panel:  computeStats, renderAudit, renderAuditChart,
       setAuditView, setAnalyticsView, setYrCampus,
       suggestionAuditIssues, auditEntrySuggestions, etc.
     - Live Analytics:  loadLiveAnalytics, renderLiveOverview /
       CampusChart / Feedback / Heatmap / Scorecard / TopPages / Used,
       renderToolRankings, setRankingScope, sheet readers.
     - Libraries UI:  renderLibraries, libAddLesson / DeleteLesson
       / EditLesson / ExtractFromUrl / ExportAll / ImportAll /
       Trigger / ToggleSection, showAddLibraryDialog,
       createNewLibrary, deleteLibrary, libSlugToTitle.
     - Realism audit:  runFullRealismAudit, scanCurrentEntryRealism,
       renderRealismResults, draftAllRealismFixes,
       evaluateDraftImprovement, severityColour, etc.
     - Quality scoring:  scoreEntryQuality.
     - Misc:  initNetworkCanvas, showChangesPopup,
       applyChangesFromPopup, showBeforeAfterPreview,
       setChangeState, addToGASQueue, runWhatIfSimulation.
     - Bulk chat:  bulkChatSend, bulkChatAddMessage, bulkChatReset,
       bulkChatQuickStart, renderBulkChat, renderBulkWelcome, the
       clarification flow (askNextClarification, parseClarifyResponse,
       showNextQuestion, buildClarifyPrompt), reasoning step UI
       (showReasoningSteps, hideReasoningSteps, updateReasoningStep),
       and bulk insight computation.
     - Opportunity detection:  the family of bulkInstruction*
       /bulkDetectNamedToolOpportunity_ /chooseNamedToolOpportunitySlot_
       /buildNamedToolOpportunityChange_ /runBulkNamedToolOpportunityFlow_
       helpers used by Bulk AI Edit.

   Source: lifted verbatim from DLA_Studio_legacy_backup.html line
   ranges 2317-4264, 5203-6374, and 6828-7137. Order preserved so
   forward-references continue to resolve under script-element
   hoisting. Do not reorder without checking dependencies.

   Loaded before 08-export-sync-hotfixes.js so that 08's init IIFE
   can call initNetworkCanvas() at parse time, and so 08's patch
   wrappers (e.g. the bulkChatSend / bulkChatSelectOption / sendChat
   try/catch wrappers) can find the functions they wrap. Most of
   those wrappers are guarded by `if(typeof X === 'function')`,
   so they pass these definitions through unchanged.
   ============================================================= */


/* ----- Block: legacy lines 2317-4264 ----- */


function renderAudit(){
  renderAuditChart();
}



function setAuditView(btn){
  document.querySelectorAll('.view-tab[data-view]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const v=btn.dataset.view;
  document.getElementById('audit-analytics').style.display=v==='analytics'?'block':'none';

}

function setAnalyticsView(btn){
  document.querySelectorAll('.view-tab[data-av]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  AUDIT_VIEW=btn.dataset.av;
  AUDIT_YEAR_CAMPUS='';
  renderAuditChart();
}

function setYrCampus(ca,btn){
  AUDIT_YEAR_CAMPUS=ca;
  document.querySelectorAll('#year-campus-filter .view-tab').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderAuditChart();
}

function jumpToBrowse(toolName){
  switchTab('browse',document.querySelector('.nav-item[data-tab="browse"]'));
  document.getElementById('f-search').value=toolName;
  renderBrowse();
}

function toggleToolDrilldown(row, toolName){
  const dd=row.querySelector('.tool-drilldown');
  if(!dd) return;
  const isOpen=dd.style.display!=='none';
  
  document.querySelectorAll('.tool-drilldown').forEach(d=>d.style.display='none');
  if(!isOpen) dd.style.display='block';
}




function showChangesPopup(changes){
  changes = (changes || []).map(normaliseMinecraftChangeForEntry_);
  const existing=document.getElementById('changes-popup-overlay');
  if(existing) existing.remove();
  const states=changes.map(()=>'pending');

  const overlay=document.createElement('div');
  overlay.id='changes-popup-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';

  const popup=document.createElement('div');
  popup.style.cssText='background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:min(1180px,96vw);width:100%;height:92vh;max-height:920px;display:flex;flex-direction:column;gap:0;box-sizing:border-box';

  const header=document.createElement('div');
  header.style.cssText='display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-shrink:0';
  header.innerHTML=`<div style="width:10px;height:10px;border-radius:50%;background:var(--lime)"></div>
    <h3 style="font-size:18px;font-weight:900">Review Proposed Changes</h3>
    <span id="popup-counter" style="font-size:13px;color:var(--dim);margin-left:auto"></span>`;
  popup.appendChild(header);

  const subline=document.createElement('p');
  subline.style.cssText='font-size:13px;color:var(--dim);margin-bottom:18px;flex-shrink:0';
  subline.textContent='Approve or decline each suggestion individually, then apply your approved changes.';
  popup.appendChild(subline);

  const rowsEl=document.createElement('div');
  rowsEl.style.cssText='overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;margin-bottom:16px;padding-right:4px';

  function updateCounter(){
    const approved=states.filter(s=>s==='approved').length;
    const declined=states.filter(s=>s==='declined').length;
    const pending=states.filter(s=>s==='pending').length;
    document.getElementById('popup-counter').textContent=`${approved} approved · ${declined} declined · ${pending} pending`;
    const applyBtn=document.getElementById('popup-apply-btn');
    if(applyBtn){
      const n=states.filter(s=>s==='approved').length;
      applyBtn.textContent=`✓ Apply ${n} approved change${n!==1?'s':''}`;
      applyBtn.disabled=n===0;
      applyBtn.style.opacity=n===0?'0.4':'1';
    }
  }

  changes.forEach((c,ci)=>{
    const e=DATA[c.entryIdx];
    const oldSug=getSugs(e)[c.sugIdx];
    const oldTool=oldSug?sugTool(oldSug):'(empty slot)';
    const oldDesc=oldSug?sugDesc(oldSug):'';
    const newTool=c.t||c.tool||c.technology||c.name||'(unknown tool)';
    const newDesc=c.d||c.desc||c.description||c.integration_idea||c.activity||'';
    const newUrl=c.url||c.lessonUrl||'';
    const newUrlHtml=newUrl?`<div style="font-size:11px;margin-top:8px"><a href="${esc(newUrl)}" target="_blank" rel="noopener" style="color:var(--lime);text-decoration:none;font-weight:800">↗ Verified lesson link</a></div>`:'';
    const rawReason = c.auditReason || c.reason || c.flagReason || c.reviewReason || c.problem || '';
    const formattedReason = rawReason ? esc(rawReason).replace(/\s*\|\s*/g, '<br>') : '';
    const reasonHtml = formattedReason ? `<div style="padding:10px 12px;background:rgba(245,166,35,0.10);border:1px solid rgba(245,166,35,0.35);border-left:4px solid #F5A623;border-radius:9px;margin-bottom:10px">
      <div style="font-size:9px;color:#F5A623;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;font-weight:900">Reason flagged</div>
      <div style="font-size:12px;color:#F8D28A;line-height:1.55">${formattedReason}</div>
    </div>` : '';
    const improvementConfidence = (c.improvementConfidence || c.confidence || '').toString();
    const improvementScore = c.improvementScore != null ? c.improvementScore : '';
    const whyBetter = c.whyBetter || c.improvementRationale || c.qualityRationale || '';
    const remainingConcern = c.remainingConcern || c.remainingConcerns || '';
    const confKey = improvementConfidence.toLowerCase();
    const confColour = confKey.includes('high') ? 'var(--lime)' : confKey.includes('medium') ? '#F5A623' : '#FF8080';
    const improvementHtml = improvementConfidence ? `<div style="padding:10px 12px;background:rgba(155,139,255,0.09);border:1px solid rgba(155,139,255,0.35);border-left:4px solid ${confColour};border-radius:9px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <div style="font-size:9px;color:#A78BFA;text-transform:uppercase;letter-spacing:.8px;font-weight:900">AI quality check</div>
        <div style="font-size:11px;color:${confColour};font-weight:900;margin-left:auto">${esc(improvementConfidence)}${improvementScore!=='' ? ' · '+esc(improvementScore)+'/5' : ''}</div>
      </div>
      ${whyBetter ? `<div style="font-size:12px;color:#ddd;line-height:1.55;margin-bottom:${remainingConcern?'5px':'0'}"><b style="color:#A78BFA">Why this should be better:</b> ${esc(whyBetter)}</div>` : ''}
      ${remainingConcern ? `<div style="font-size:12px;color:#F8D28A;line-height:1.55"><b>Remaining concern:</b> ${esc(remainingConcern)}</div>` : ''}
    </div>` : '';

    const card=document.createElement('div');
    card.id=`change-card-${ci}`;
    card.style.cssText='background:var(--card2);border:1.5px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .15s;flex-shrink:0';

    const entryRow=document.createElement('div');
    entryRow.style.cssText='display:flex;align-items:center;gap:8px;padding:12px 16px;user-select:none';
    entryRow.innerHTML=`<span style="font-size:12px;color:var(--dim);width:90px;flex-shrink:0">${esc(e?e.ca:'')}</span>
      <span style="font-size:12px;color:var(--gold);font-weight:700;width:62px;flex-shrink:0">${esc(e?e.yl:'')}</span>
      <span style="font-size:14px;font-weight:700;flex:1">${esc(e?e.th:'')}</span>
      <span id="card-status-${ci}" style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:var(--card);color:var(--dim)">PENDING</span>`;

    const detail=document.createElement('div');
    detail.style.cssText='padding:0 16px 14px;display:block';
    detail.innerHTML=`${reasonHtml}${improvementHtml}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;margin-bottom:10px">
      <div style="padding:10px 12px;background:#1a0808;border:1px solid #3a1818;border-radius:10px;min-width:0">
        <div style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;font-weight:700">Current suggestion being replaced</div>
        <div style="font-size:14px;font-weight:900;color:#ff9999;margin-bottom:6px;line-height:1.25">${esc(oldTool)}</div>
        <div style="font-size:12px;color:#bbb;line-height:1.6;max-height:220px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;padding-right:6px">${linkify(oldDesc||'No description')}</div>
      </div>
      <div style="padding:10px 12px;background:#081808;border:1px solid #183818;border-radius:10px;min-width:0">
        <div style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;font-weight:700">Suggested replacement</div>
        <div style="font-size:14px;font-weight:900;color:var(--lime);margin-bottom:6px;line-height:1.25">${esc(newTool)}${c._styleWeak ? ` <span title="${(typeof esc==='function'?esc(c._styleNote||''):(c._styleNote||''))}" style="color:var(--gold);font-size:10px">⚠ style: ${(typeof esc==='function'?esc(c._styleNote||''):(c._styleNote||''))}</span>` : ''}</div>
        <div style="font-size:12px;color:#d8d8d8;line-height:1.6;max-height:220px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;padding-right:6px">${linkify(newDesc||'No description')}</div>
        ${newUrlHtml}
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="setChangeState(${ci},'approved')" id="btn-approve-${ci}"
        style="flex:1;padding:10px 8px;border-radius:9px;border:2px solid var(--lime);background:transparent;color:var(--lime);font-weight:900;font-size:14px;cursor:pointer;transition:all .12s"
        onmouseover="this.style.background='var(--lime)';this.style.color='#111'"
        onmouseout="this.style.background='transparent';this.style.color='var(--lime)'">✓ Approve</button>
      <button onclick="setChangeState(${ci},'declined')" id="btn-decline-${ci}"
        style="flex:1;padding:10px 8px;border-radius:9px;border:2px solid #FF8080;background:transparent;color:#FF8080;font-weight:900;font-size:14px;cursor:pointer;transition:all .12s"
        onmouseover="this.style.background='#FF8080';this.style.color='#111'"
        onmouseout="this.style.background='transparent';this.style.color='#FF8080'">✗ Decline</button>
    </div>`;

    card.appendChild(entryRow);
    card.appendChild(detail);
    rowsEl.appendChild(card);
  });

  popup.appendChild(rowsEl);

  const footer=document.createElement('div');
  footer.style.cssText='display:flex;gap:10px;flex-shrink:0;padding-top:12px;border-top:1px solid var(--border);flex-wrap:wrap';
  footer.innerHTML=`
    <button onclick="(function(){window._popupStates.forEach((_,i)=>setChangeState(i,'approved'));})()"
      style="padding:14px 20px;background:transparent;color:var(--lime);border:1.5px solid var(--lime);border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap">
      ✓ Approve All
    </button>
    <button onclick="showBeforeAfterPreview()"
      style="padding:14px 18px;background:transparent;color:var(--purple);border:1.5px solid var(--purple);border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap" title="See how tool frequency would change">
      👁 Preview
    </button>
    <button id="popup-apply-btn" disabled onclick="applyChangesFromPopup()"
      style="flex:1;min-width:180px;padding:14px;background:var(--lime);color:#111;border:none;border-radius:10px;font-weight:900;font-size:15px;cursor:pointer;opacity:0.4">
      ✓ Apply 0 approved changes
    </button>
    <button onclick="document.getElementById('changes-popup-overlay').remove()"
      style="padding:14px 20px;background:transparent;color:var(--dim);border:1.5px solid var(--border);border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;min-width:80px">
      Close
    </button>`;
  popup.appendChild(footer);
  overlay.appendChild(popup);
  overlay._changes=changes;
  overlay._states=states;
  document.body.appendChild(overlay);
  window._popupStates=states;
  window._popupChanges=changes;
  window._popupUpdateCounter=updateCounter;
  updateCounter();
}

function setChangeState(ci, state){
  const states=window._popupStates; if(!states) return;
  states[ci]=state;
  const card=document.getElementById(`change-card-${ci}`);
  const statusEl=document.getElementById(`card-status-${ci}`);
  const approveBtn=document.getElementById(`btn-approve-${ci}`);
  const declineBtn=document.getElementById(`btn-decline-${ci}`);
  if(state==='approved'){
    if(card) card.style.borderColor='var(--lime)';
    if(statusEl){ statusEl.textContent='APPROVED'; statusEl.style.background='var(--lime)'; statusEl.style.color='#111'; }
    if(approveBtn){ approveBtn.style.background='var(--lime)'; approveBtn.style.color='#111'; }
    if(declineBtn){ declineBtn.style.background='transparent'; declineBtn.style.color='#FF8080'; }
  } else {
    if(card) card.style.borderColor='#FF8080';
    if(statusEl){ statusEl.textContent='DECLINED'; statusEl.style.background='#FF8080'; statusEl.style.color='#111'; }
    if(declineBtn){ declineBtn.style.background='#FF8080'; declineBtn.style.color='#111'; }
    if(approveBtn){ approveBtn.style.background='transparent'; approveBtn.style.color='var(--lime)'; }
  }
  if(window._popupUpdateCounter) window._popupUpdateCounter();
}

function applyChangesFromPopup(){
  const overlay=document.getElementById('changes-popup-overlay');
  if(!overlay) return;
  const changes=window._popupChanges||[];
  const states=window._popupStates||[];
  let applied=0, skippedDupes=0;
  let appliedRealismFixes=false;
  
  // Auto-create a snapshot before applying bulk changes
  const approvedCount = states.filter(s => s === 'approved').length;
  if(approvedCount > 0){
    const snapName = window._snapshotReason || `Before applying ${approvedCount} bulk change${approvedCount!==1?'s':''}`;
    createSnapshot(snapName);
    delete window._snapshotReason;
  }

  changes.forEach((c,ci)=>{
    if(states[ci]!=='approved') return;
    const entryIdx=c.entryIdx;
    const sugIdx=c.sugIdx;
    const t=cleanSuggestionText_(c.t||c.tool||c.technology||c.name||'');
    const d=cleanSuggestionText_(c.d||c.desc||c.description||c.integration_idea||'');
    const url=cleanMinecraftLessonUrl_(c.url||c.lessonUrl||'');
    // Safety net: if an earlier approved change already put this tool in a sibling slot, skip
    if(entryIdx>=0 && entryIdx<DATA.length && wouldDupeToolProposalInEntry(DATA[entryIdx], t, sugIdx)){
      skippedDupes++;
      return;
    }
    if(entryIdx>=0&&entryIdx<DATA.length){
      const sugs=getSugs(DATA[entryIdx]);
      if(Array.isArray(DATA[entryIdx].s)){
        if(sugIdx>=0&&sugIdx<DATA[entryIdx].s.length){
          DATA[entryIdx].s[sugIdx]=url?{t,d,url}:{t,d};
          applied++;
          DATA[entryIdx].audited=true;
          if(isRealismAuditChange_(c)) appliedRealismFixes=true;
          markEntryNeedsHumanRecheck_(entryIdx, 'AI suggestion change applied after human verification');
        }
      } else {
        
        DATA[entryIdx].s=sugs.map((s,i)=>({t:sugTool(s),d:sugDesc(s)}));
        if(sugIdx>=0&&sugIdx<DATA[entryIdx].s.length){
          DATA[entryIdx].s[sugIdx]=url?{t,d,url}:{t,d};
          applied++;
          DATA[entryIdx].audited=true;
          if(isRealismAuditChange_(c)) appliedRealismFixes=true;
          markEntryNeedsHumanRecheck_(entryIdx, 'AI suggestion change applied after human verification');
        }
      }
    }
  });

  overlay.remove();
  delete window._popupStates;
  delete window._popupChanges;
  delete window._popupUpdateCounter;

  saveToDrive();
  const dupeNote = skippedDupes ? ` (skipped ${skippedDupes} duplicate${skippedDupes!==1?'s':''})` : '';
  if(appliedRealismFixes){
    setStatus(`${applied} suggestion${applied!==1?'s':''} updated and saved${dupeNote} — rescanning realism audit…`, 'loading');
    setTimeout(() => rescanRealismAfterApprovedFixes_(applied, skippedDupes), 250);
  } else {
    setStatus(`${applied} suggestion${applied!==1?'s':''} updated and saved${dupeNote}`);
  }
  renderAuditChart();
  if(typeof renderBrowse === 'function') renderBrowse();
}

// ========== BEFORE/AFTER PREVIEW ==========
function showBeforeAfterPreview(){
  const changes = window._popupChanges || [];
  const states = window._popupStates || [];
  const approvedChanges = changes.filter((c, i) => states[i] === 'approved');
  if(!approvedChanges.length){
    alert('No changes are currently approved. Approve some first, then preview.');
    return;
  }

  const beforeFreq = {};
  const afterFreq = {};
  DATA.forEach((e, ei) => {
    getSugs(e).forEach((s, si) => {
      const t = normaliseToolName((s && s.t ? s.t.trim() : ''));
      if(!t) return;
      beforeFreq[t] = (beforeFreq[t] || 0) + 1;
      const change = approvedChanges.find(c => c.entryIdx === ei && c.sugIdx === si);
      if(change){
        const newTool = normaliseToolName((change.t || '').trim());
        if(newTool) afterFreq[newTool] = (afterFreq[newTool] || 0) + 1;
      } else {
        afterFreq[t] = (afterFreq[t] || 0) + 1;
      }
    });
  });

  const allTools = new Set([...Object.keys(beforeFreq), ...Object.keys(afterFreq)]);
  const diff = [];
  allTools.forEach(t => {
    const b = beforeFreq[t] || 0;
    const a = afterFreq[t] || 0;
    if(b !== a) diff.push({ tool: t, before: b, after: a, delta: a - b });
  });
  diff.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const maxCount = Math.max(...Object.values(beforeFreq), ...Object.values(afterFreq), 1);

  const overlay = document.createElement('div');
  overlay.id = 'preview-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';

  overlay.innerHTML = `<div style="background:var(--card);border:2px solid var(--purple);border-radius:16px;padding:28px;max-width:720px;width:100%;max-height:90vh;overflow-y:auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <h3 style="font-size:18px;font-weight:900;color:var(--text);margin:0">👁 Before / After Impact</h3>
      <button onclick="document.getElementById('preview-overlay').remove()" style="background:var(--card2);border:1px solid var(--border);color:var(--text);width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px;font-family:inherit">✕</button>
    </div>
    <p style="font-size:13px;color:var(--dim);margin-bottom:20px;line-height:1.6">Applying the ${approvedChanges.length} approved change${approvedChanges.length!==1?'s':''} will shift the tool distribution as shown below. Green = gaining usage, red = losing usage.</p>
    <div style="font-size:11px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px">${diff.length} tool${diff.length!==1?'s':''} affected</div>
    ${diff.length ? diff.map(d => {
      const bPct = Math.round((d.before / maxCount) * 100);
      const aPct = Math.round((d.after / maxCount) * 100);
      const deltaColor = d.delta > 0 ? 'var(--lime)' : '#FF8080';
      const deltaSign = d.delta > 0 ? '+' : '';
      return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <span style="flex:1;font-size:14px;font-weight:700;color:var(--text)">${esc(d.tool)}</span>
          <span style="font-size:12px;color:${deltaColor};font-weight:800">${deltaSign}${d.delta}</span>
          <span style="font-size:11px;color:var(--dim);min-width:60px;text-align:right">${d.before} → ${d.after}</span>
        </div>
        <div style="display:grid;grid-template-columns:40px 1fr;gap:8px;align-items:center;margin-bottom:3px">
          <span style="font-size:10px;color:var(--dim);font-weight:700">Before</span>
          <div style="height:5px;background:var(--card2);border-radius:2px"><div style="height:100%;width:${bPct}%;background:#666;border-radius:2px"></div></div>
        </div>
        <div style="display:grid;grid-template-columns:40px 1fr;gap:8px;align-items:center">
          <span style="font-size:10px;color:${deltaColor};font-weight:700">After</span>
          <div style="height:5px;background:var(--card2);border-radius:2px"><div style="height:100%;width:${aPct}%;background:${deltaColor};border-radius:2px"></div></div>
        </div>
      </div>`;
    }).join('') : '<div style="color:var(--dim);padding:20px 0">No tool frequency change (changes might be descriptions only).</div>'}
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn" onclick="document.getElementById('preview-overlay').remove()" style="padding:10px 20px">Keep reviewing</button>
      <button class="btn-pri" onclick="document.getElementById('preview-overlay').remove();applyChangesFromPopup()" style="padding:10px 22px">Apply these ${approvedChanges.length} change${approvedChanges.length!==1?'s':''}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
}


function initNetworkCanvas(){
  const canvas=document.getElementById('bg-canvas');
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  let W=0,H=0,nodes=[];
  function resize(){
    W=canvas.width=window.innerWidth;
    H=canvas.height=window.innerHeight;
    nodes=Array.from({length:55},()=>({
      x:Math.random()*W, y:Math.random()*H,
      vx:(Math.random()-.5)*.25, vy:(Math.random()-.5)*.25,
      r:Math.random()*1.5+.5
    }));
  }
  resize();
  window.addEventListener('resize',resize);
  function draw(){
    ctx.clearRect(0,0,W,H);
    for(let i=0;i<nodes.length;i++){
      for(let j=i+1;j<nodes.length;j++){
        const dx=nodes[i].x-nodes[j].x, dy=nodes[i].y-nodes[j].y;
        const d=Math.sqrt(dx*dx+dy*dy);
        if(d<160){
          ctx.beginPath();
          ctx.moveTo(nodes[i].x,nodes[i].y);
          ctx.lineTo(nodes[j].x,nodes[j].y);
          ctx.strokeStyle=`rgba(52,211,153,${0.09*(1-d/160)})`;
          ctx.lineWidth=.6;
          ctx.stroke();
        }
      }
    }
    nodes.forEach(n=>{
      ctx.beginPath();
      ctx.arc(n.x,n.y,n.r,0,Math.PI*2);
      ctx.fillStyle='rgba(0,230,118,0.45)';
      ctx.fill();
      n.x+=n.vx; n.y+=n.vy;
      if(n.x<0||n.x>W) n.vx*=-1;
      if(n.y<0||n.y>H) n.vy*=-1;
    });
    requestAnimationFrame(draw);
  }
  draw();
}

async function addToGASQueue(){
  const ca=document.getElementById('q-campus')?.value||'';
  const yl=document.getElementById('q-year')?.value||'';
  const th=document.getElementById('q-theme')?.value.trim()||'';
  const statusEl=document.getElementById('q-status');
  const btn=document.getElementById('btn-add-queue');

  if(!ca||!yl||!th){
    statusEl.textContent='Please fill in all three fields';
    statusEl.style.color='#FF8080'; return;
  }

  btn.disabled=true; btn.textContent='Submitting…';
  startProgress();
  statusEl.textContent=''; statusEl.style.color='var(--lime)';

  try{
    await fetch(SCRIPT_URL, {
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body:JSON.stringify(withGASToken({action:'addToQueue', ca, yl, th, ci:''}))
    });
    
    statusEl.textContent=`✓ "${th}" queued — the auditor will process it within 10 minutes`;
    statusEl.style.color='var(--lime)';
    document.getElementById('q-theme').value='';
  }catch(e){
    statusEl.textContent='Failed to submit: '+e.message;
    statusEl.style.color='#FF8080';
  }
  stopProgress();
  btn.disabled=false; btn.textContent='Add to Queue →';
}

async function scoreEntryQuality(){
  if(CURRENT_ENTRY_IDX===null) return;
  const idx=CURRENT_ENTRY_IDX;
  const entry=DATA[idx];
  const sugs=getSugs(entry);
  const btn=document.getElementById('btn-score-quality');
  const res=document.getElementById('quality-score-result');
  if(!sugs.length){ res.innerHTML='<div style="color:var(--dim);font-size:13px">No suggestions to score yet.</div>'; return; }

  btn.disabled=true; btn.textContent='Scoring…';
  startProgress();
  res.innerHTML='<div style="font-size:12px;color:#fbbf24">Analysing suggestion quality…</div>';

  const prompt=`You are reviewing technology suggestions for an IB PYP unit.
Unit: ${entry.ca} | ${entry.yl} | "${entry.th}"${entry.ci?`\nCentral Idea: "${entry.ci}"`:''}${entry.plannerText?`\nPlanner context: ${entry.plannerText}`:''}

Rate each suggestion as one of:
- GENERIC: Could apply to any unit, no specific connection to this unit's content
- GOOD: Clear connection to the unit theme, reasonably specific
- EXCELLENT: References specific activities, vocabulary, assessments or planner content

Suggestions:
${sugs.map((s,i)=>`${i+1}. ${sugTool(s)}: ${sugDesc(s)}`).join('\n')}

Return ONLY a JSON array with no markdown:
[{"idx":0,"rating":"EXCELLENT","reason":"One sentence why."},...]`;

  try{
    const raw=await callAI([{role:'user',parts:[{text:prompt}]}],null,OPENAI_MODEL);
    const clean=raw.replace(/```json|```/g,'').trim();
    const si=clean.indexOf('['), ei=clean.lastIndexOf(']');
    if(si===-1||ei===-1) throw new Error('No JSON');
    const scores=JSON.parse(clean.slice(si,ei+1));
    const colours={EXCELLENT:'var(--lime)',GOOD:'#fbbf24',GENERIC:'#FF8080'};
    const icons={EXCELLENT:'★★★',GOOD:'★★☆',GENERIC:'★☆☆'};
    res.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px">
      ${scores.map(({idx:si,rating,reason})=>{
        const sug=sugs[si];
        if(!sug) return '';
        const col=colours[rating]||'var(--dim)';
        return `<div style="padding:10px 14px;background:var(--card2);border-radius:8px;border-left:3px solid ${col}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:13px;font-weight:700;color:${col}">${icons[rating]||'?'} ${rating}</span>
            <span style="font-size:13px;font-weight:700;color:var(--text)">${esc(sugTool(sug))}</span>
          </div>
          <div style="font-size:12px;color:var(--dim);line-height:1.5">${esc(reason)}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--dim)">
      ${scores.filter(s=>s.rating==='EXCELLENT').length} excellent · ${scores.filter(s=>s.rating==='GOOD').length} good · ${scores.filter(s=>s.rating==='GENERIC').length} generic
    </div>`;
  }catch(e){
    res.innerHTML=`<div style="font-size:12px;color:#FF8080">${esc(e.message)}</div>`;
  }
  stopProgress();
  btn.disabled=false; btn.textContent='Score with AI';
}



// ========== REALISM & AGE AUDIT ==========
let REALISM_AUDIT_RESULTS = [];

function extractUnitKeywords(entry){
  const raw = `${entry?.th || ''} ${entry?.ci || ''} ${entry?.lo || ''} ${entry?.plannerText || ''}`.toLowerCase();
  const stop = new Set('the a an and or but for with from into onto over under about across through their there this that these those students learners learning unit inquiry central idea lines place world works who we are how where when why what can will use using used they them our your has have had was were be been being to of in on at by as is it its can may might should would could do does did'.split(' '));
  const words = (raw.match(/[a-z]{4,}/g) || []).filter(w => !stop.has(w));
  const counts = {};
  words.forEach(w => counts[w] = (counts[w] || 0) + 1);
  return Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,18);
}

function descHasUnitConnection(desc, entry){
  const d = String(desc || '').toLowerCase();
  const keywords = extractUnitKeywords(entry);
  if(!keywords.length) return true;
  return keywords.some(k => d.includes(k));
}

function hasConcreteStudentAction(desc){
  return /(design|create|build|construct|prototype|code|program|record|film|photograph|map|model|test|debug|measure|collect|analyse|compare|survey|interview|animate|publish|present|compose|draw|label|simulate|investigate|explore|document|sequence|classify|sort|graph|explain|reflect|iterate|make)/i.test(String(desc || ''));
}

function suggestionAuditIssues(entry, sug, sugIdx){
  const issues = [];
  const tool = sugTool(sug);
  const desc = sugDesc(sug);
  const isStem = sugIdx === 5;
  const full = `${tool} ${desc}`.toLowerCase();

  if(!isRealSug(sug)){
    issues.push({type:'missing', severity:'high', message:'Suggestion is missing or incomplete.'});
    return issues;
  }

  if(toolContainsForbiddenKeyword(tool) || toolContainsForbiddenKeyword(desc) || toolViolatesInventoryBan(tool)){
    issues.push({type:'banned', severity:'high', message:'Uses a banned or unavailable tool.'});
  }

  if(!isStem && !isToolAgeAppropriate(tool, entry.yl)){
    issues.push({type:'age', severity:'high', message:`${tool} may not be age-appropriate for ${entry.yl}.`});
  }

  // STEM slot is allowed to be more flexible, but still should be hands-on and age-aware.
  if(isStem){
    const lowerYr = getYearNumber(entry.yl);
    if(lowerYr < 4 && /(codrone|drone|sphero bolt|lego spike prime|tinkercad|3d printer|python)/i.test(full)){
      issues.push({type:'stem-age', severity:'high', message:'Protected STEM Suggestion 6 uses hardware/software that is too advanced for this year level.'});
    }
    if(!/(design cycle|empathise|empathize|define|ideate|prototype|test|iterate|build|construct|make|model|materials|cardboard|recycled|popsticks|clay|maker|makerspace)/i.test(full)){
      issues.push({type:'stem-realism', severity:'medium', message:'Protected STEM Suggestion 6 should clearly include hands-on making and the design cycle.'});
    }
  } else {
    const realism = checkRealisticToolUse(tool, desc, entry);
    if(!realism.ok){
      issues.push({type:'realism', severity:'high', message:realism.reason || 'Tool use may not be realistic for the classroom.'});
    }
  }

  if(!hasConcreteStudentAction(desc)){
    issues.push({type:'vague', severity:'medium', message:'Description lacks a concrete student action/product.'});
  }

  if(String(desc || '').replace(/\s+/g,' ').trim().length < 95){
    issues.push({type:'thin', severity:'low', message:'Description is very short; it may need more practical detail.'});
  }

  if(!descHasUnitConnection(desc, entry)){
    issues.push({type:'connection', severity:'low', message:'Description may not clearly reference this unit\'s content or vocabulary.'});
  }

  return issues;
}

function auditEntrySuggestions(entry, entryIdx){
  const sugs = getSugs(entry);
  const results = [];
  sugs.forEach((sug, sugIdx) => {
    const issues = suggestionAuditIssues(entry, sug, sugIdx);
    if(issues.length){
      results.push({
        entryIdx,
        sugIdx,
        ca: entry.ca,
        yl: entry.yl,
        th: entry.th,
        tool: sugTool(sug),
        desc: sugDesc(sug),
        isStem: sugIdx === 5,
        issues
      });
    }
  });
  return results;
}

function severityColour(sev){
  return sev === 'high' ? '#FF8080' : sev === 'medium' ? '#F5A623' : 'var(--blue)';
}
function resultHighestSeverity(result){
  if(result.issues.some(i=>i.severity==='high')) return 'high';
  if(result.issues.some(i=>i.severity==='medium')) return 'medium';
  return 'low';
}

function renderRealismResults(results, containerId, opts){
  const container = document.getElementById(containerId);
  if(!container) return;
  opts = opts || {};
  if(!results.length){
    container.innerHTML = `<div style="padding:12px 14px;background:rgba(197,232,74,0.08);border:1px solid rgba(197,232,74,0.2);border-radius:10px;font-size:13px;color:var(--lime);font-weight:700">✓ No obvious realism or age issues found.</div>`;
    return;
  }
  const high = results.filter(r=>resultHighestSeverity(r)==='high').length;
  const medium = results.filter(r=>resultHighestSeverity(r)==='medium').length;
  const low = results.filter(r=>resultHighestSeverity(r)==='low').length;
  const display = results.slice(0, opts.limit || 80);
  container.innerHTML = `<div style="padding:12px 14px;background:rgba(255,128,128,0.08);border:1px solid rgba(255,128,128,0.25);border-radius:10px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:800;color:#FF8080;margin-bottom:4px">${results.length} suggestion${results.length!==1?'s':''} flagged</div>
      <div style="font-size:12px;color:var(--dim)">${high} high priority · ${medium} medium · ${low} low</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn-sm btn-realism-fix-all" onclick="draftAllRealismFixes('high')" style="color:#FF8080;border-color:#FF8080">✨ Draft fixes for high priority</button>
        <button class="btn-sm btn-realism-fix-all" onclick="draftAllRealismFixes('all')" style="color:var(--gold);border-color:var(--gold)">✨ Draft fixes for all flagged</button>
      </div>
      <div id="realism-batch-progress" style="display:none;margin-top:10px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px">
        <div id="realism-batch-label" style="font-size:12px;color:var(--lime);font-weight:700;margin-bottom:7px">Preparing…</div>
        <div style="height:5px;background:var(--card2);border-radius:3px;overflow:hidden"><div id="realism-batch-bar" style="height:100%;width:0%;background:var(--lime);border-radius:3px;transition:width .25s"></div></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:${opts.maxHeight || '520px'};overflow-y:auto;padding-right:4px">
      ${display.map((r,idx)=>{
        const sev = resultHighestSeverity(r);
        const col = severityColour(sev);
        const globalIdx = REALISM_AUDIT_RESULTS.indexOf(r);
        const btnIdx = globalIdx >= 0 ? globalIdx : idx;
        return `<div style="padding:12px 14px;background:var(--card2);border:1px solid var(--border);border-left:4px solid ${col};border-radius:10px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
            <span style="font-size:11px;font-weight:800;color:${col};text-transform:uppercase">${sev}</span>
            <span style="font-size:12px;color:#9ab89a">${esc(r.ca || '')}</span>
            <span style="font-size:12px;color:var(--gold);font-weight:700">${esc(r.yl || '')}</span>
            <span style="font-size:12px;color:var(--dim)">Suggestion ${r.sugIdx + 1}${r.isStem ? ' · STEM' : ''}</span>
            <span style="flex:1"></span>
            <button class="btn-sm" onclick="openEntry(${r.entryIdx})">Open</button>
            <button class="btn-sm" onclick="draftRealismReplacementFromAudit(${btnIdx})" style="color:var(--lime);border-color:var(--lime)">✨ Draft fix</button>
          </div>
          <div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:3px">${esc(r.tool || '(missing tool)')}</div>
          <div style="font-size:12px;color:var(--dim);margin-bottom:6px">${esc(r.th || '')}</div>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#ccc;line-height:1.55">
            ${r.issues.map(i=>`<li><b style="color:${severityColour(i.severity)}">${esc(i.type)}</b>: ${esc(i.message)}</li>`).join('')}
          </ul>
        </div>`;
      }).join('')}
      ${results.length > display.length ? `<div style="font-size:12px;color:var(--dim);padding:8px 2px">Showing first ${display.length} flagged suggestions. Fix or filter, then rescan.</div>` : ''}
    </div>`;
}

function scanCurrentEntryRealism(){
  if(CURRENT_ENTRY_IDX === null) return;
  const entry = DATA[CURRENT_ENTRY_IDX];
  const btn = document.getElementById('btn-entry-realism-scan');
  if(btn){ btn.disabled = true; btn.textContent = 'Scanning…'; }
  const results = auditEntrySuggestions(entry, CURRENT_ENTRY_IDX);
  REALISM_AUDIT_RESULTS = results;
  renderRealismResults(results, 'entry-realism-result', {maxHeight:'none', limit:20});
  if(btn){ btn.disabled = false; btn.textContent = 'Scan this entry'; }
}

function runFullRealismAudit(){
  const btn = document.getElementById('btn-full-realism-audit');
  if(btn){ btn.disabled = true; btn.textContent = 'Scanning…'; }
  const all = [];
  DATA.forEach((entry, entryIdx) => {
    all.push(...auditEntrySuggestions(entry, entryIdx));
  });
  all.sort((a,b) => {
    const weight = {high:0, medium:1, low:2};
    return weight[resultHighestSeverity(a)] - weight[resultHighestSeverity(b)] || String(a.yl).localeCompare(String(b.yl)) || String(a.th).localeCompare(String(b.th));
  });
  REALISM_AUDIT_RESULTS = all;
  renderRealismResults(all, 'realism-audit-result', {maxHeight:'560px', limit:100});
  setStatus(all.length ? `Realism audit complete — ${all.length} flagged` : 'Realism audit complete — no issues found');
  if(btn){ btn.disabled = false; btn.textContent = 'Scan all suggestions'; }
}

function draftRealismReplacementFromAudit(idx){
  const result = REALISM_AUDIT_RESULTS[idx];
  if(!result){ alert('Audit result not found. Please rescan.'); return; }
  draftRealismReplacement(result.entryIdx, result.sugIdx, result.issues.map(i=>i.message).join(' | '));
}


function extractFirstJsonObject_(text){
  const clean = String(text || '').replace(/```json|```/g,'').trim();
  const si = clean.indexOf('{');
  const ei = clean.lastIndexOf('}');
  if(si === -1 || ei === -1 || ei <= si) throw new Error('AI did not return JSON.');
  return JSON.parse(clean.slice(si, ei + 1));
}

function normaliseImprovementCheck_(raw){
  const confidenceRaw = String(raw.confidence || raw.improvementConfidence || raw.rating || '').trim().toLowerCase();
  let confidence = confidenceRaw.includes('high') ? 'High' : confidenceRaw.includes('medium') ? 'Medium' : confidenceRaw.includes('low') ? 'Low' : '';
  let score = Number(raw.score || raw.improvementScore || raw.ratingScore || 0);
  if(!confidence){
    if(score >= 4) confidence = 'High';
    else if(score >= 3) confidence = 'Medium';
    else confidence = 'Low';
  }
  if(!score){
    score = confidence === 'High' ? 5 : confidence === 'Medium' ? 3 : 1;
  }
  score = Math.max(1, Math.min(5, Math.round(score)));
  return {
    confidence,
    score,
    whyBetter: raw.whyBetter || raw.rationale || raw.reason || raw.improvementRationale || '',
    remainingConcern: raw.remainingConcern || raw.concern || raw.remainingConcerns || ''
  };
}

async function evaluateDraftImprovement(entry, oldSug, draft, flagReason, isStem){
  const oldTool = sugTool(oldSug);
  const oldDesc = sugDesc(oldSug);
  const prompt = `You are the DLP quality gate for Wesley College's Digital Learning Assistant.
Your job is to compare an OLD suggestion with a DRAFT replacement and decide whether the draft is genuinely better.
Be strict. Do NOT rubber-stamp. If the new draft still has the same problem, mark it Low.

Unit context:
Campus: ${entry.ca}
Year level: ${entry.yl}
Theme: ${entry.th}
Central Idea: ${entry.ci || ''}
Lines of Inquiry: ${entry.lo || ''}
Planner summary: ${entry.plannerText || ''}
Suggestion type: ${isStem ? 'Protected STEM Design Cycle Suggestion 6' : 'Digital learning suggestion'}

Original flagged problem:
${flagReason || 'May be unrealistic, weakly connected or not age appropriate.'}

OLD suggestion:
Tool/project: ${oldTool}
Description: ${oldDesc}

DRAFT replacement:
Tool/project: ${draft.t || ''}
Description: ${draft.d || ''}

Score the draft against these criteria:
1. realistic classroom use
2. age appropriateness
3. specific connection to this unit
4. teacher practicality
5. clear student task/product
6. whether it actually fixes the original flagged problem

Return ONLY JSON:
{
  "confidence": "High" | "Medium" | "Low",
  "score": 1-5,
  "whyBetter": "one concise sentence explaining the improvement",
  "remainingConcern": "one concise sentence, or empty string if none"
}`;
  const raw = await callAI([{role:'user',parts:[{text:prompt}]}], null, OPENAI_FAST_MODEL || OPENAI_MODEL);
  const parsed = normaliseImprovementCheck_(extractFirstJsonObject_(raw));
  if(parsed.confidence === 'Low' || parsed.score < 3){
    throw new Error(`Draft failed quality check (${parsed.confidence} ${parsed.score}/5): ${parsed.remainingConcern || parsed.whyBetter || 'It was not clearly better than the current suggestion.'}`);
  }
  return parsed;
}


function realismAuditReasonText_(result){
  return ((result && result.issues) || []).map(i => i && i.message ? i.message : '').filter(Boolean).join(' | ') || 'May be unrealistic or not age appropriate.';
}

function realismAuditIssueTypes_(result){
  return new Set(((result && result.issues) || []).map(i => String(i && i.type || '').toLowerCase()).filter(Boolean));
}

function auditResultIsDescriptionOnlyIssue_(result){
  const types = realismAuditIssueTypes_(result);
  const reason = realismAuditReasonText_(result).toLowerCase();
  return types.has('vague') || types.has('thin') || types.has('connection') || types.has('generic') ||
    /description|too long|lesson overview|punctuation|corruption|lesson-library wording|vague|brief|thin|generic|student action|student product|unit connection/i.test(reason);
}

function findMinecraftLessonForExistingSuggestion_(entry, oldSug){
  const oldTool = sugTool(oldSug);
  const oldDesc = sugDesc(oldSug);
  const hay = [oldTool, oldDesc, oldSug && oldSug.url, oldSug && oldSug.lessonUrl].filter(Boolean).join(' ');
  let lesson = null;
  try { lesson = findCuratedLessonMention_('minecraft', oldTool, hay); } catch(e) { lesson = null; }
  if(lesson) return lesson;

  // Fallback for existing suggestions titled like "Minecraft: Revamp Melbourne" where the
  // description was corrupted or overlong and no URL survived in the suggestion object.
  const titleFromTool = String(oldTool || '').match(/minecraft\s*[:—-]\s*(.+)$/i);
  const wantedTitle = titleFromTool ? titleFromTool[1].trim() : '';
  if(!wantedTitle) return null;
  const wanted = dlaTextForFit_(wantedTitle);
  const lessons = getLibraryLessons('minecraft') || [];
  return lessons.find(l => dlaTextForFit_(l && l.title || '') === wanted || dlaTextForFit_(l && l.title || '').includes(wanted) || wanted.includes(dlaTextForFit_(l && l.title || ''))) || null;
}

function buildDeterministicMinecraftAuditFix_(result){
  const entryIdx = result.entryIdx;
  const sugIdx = result.sugIdx;
  const entry = DATA[entryIdx];
  if(!entry) return null;
  const oldSug = getSugs(entry)[sugIdx];
  if(!oldSug) return null;
  const oldTool = sugTool(oldSug);
  const oldDesc = sugDesc(oldSug);
  if(!/minecraft/i.test(oldTool + ' ' + oldDesc)) return null;

  const lesson = findMinecraftLessonForExistingSuggestion_(entry, oldSug);
  if(!lesson) return null;

  const newDesc = mcLessonDesc_(entry, lesson);
  const realism = checkRealisticToolUse('Minecraft Education', newDesc, entry);
  if(!realism.ok){
    throw new Error('Deterministic Minecraft clean-up failed: ' + realism.reason);
  }

  const reason = realismAuditReasonText_(result);
  return {
    entryIdx,
    sugIdx,
    t: 'Minecraft Education',
    d: newDesc,
    url: mcCleanUrl_(lesson.url || oldSug.url || ''),
    auditReason: cleanSuggestionText_(reason + ' | Auto-shortened to a verified two-sentence Minecraft classroom task.'),
    auditIssues: result.issues || [],
    auditSource: 'realism-age-audit-deterministic-minecraft-cleanup',
    improvementConfidence: 'High',
    improvementScore: 5,
    whyBetter: 'Keeps the same verified Minecraft lesson, removes copied lesson-overview wording, and gives teachers a concise classroom task with a clear student product.',
    remainingConcern: ''
  };
}

function buildDeterministicRealismFix_(result){
  // Some audit flags do not need AI at all. In particular, Minecraft length/grammar
  // flags should keep the same verified lesson and rewrite only the description.
  const entry = DATA[result && result.entryIdx];
  const oldSug = entry ? getSugs(entry)[result.sugIdx] : null;
  const oldTool = oldSug ? sugTool(oldSug) : '';
  const oldDesc = oldSug ? sugDesc(oldSug) : '';
  if(/minecraft/i.test(oldTool + ' ' + oldDesc) && auditResultIsDescriptionOnlyIssue_(result)){
    return buildDeterministicMinecraftAuditFix_(result);
  }
  return null;
}

function renderRealismBatchFailureSummary_(failures){
  const old = document.getElementById('realism-batch-failure-summary');
  if(old) old.remove();
  if(!failures || !failures.length) return;
  const host = document.getElementById('realism-audit-result') || document.getElementById('entry-realism-result');
  if(!host) return;
  const html = `<div id="realism-batch-failure-summary" style="padding:12px 14px;background:rgba(245,166,35,0.10);border:1px solid rgba(245,166,35,0.35);border-radius:10px;margin-bottom:10px">
    <div style="font-size:13px;font-weight:900;color:#F5A623;margin-bottom:5px">${failures.length} flagged suggestion${failures.length!==1?'s':''} could not be drafted</div>
    <div style="font-size:12px;color:#ddd;line-height:1.55;margin-bottom:8px">The accepted drafts are still shown for review. These remaining flags were not auto-applied or hidden.</div>
    <details style="font-size:12px;color:#bbb;line-height:1.55"><summary style="cursor:pointer;color:#F5A623;font-weight:800">Show failed draft reasons</summary>
      <ul style="margin:8px 0 0;padding-left:18px">${failures.slice(0,12).map(f => `<li><b>${esc((f.result && f.result.yl) || '')} ${esc((f.result && f.result.th) || '')}</b> — ${esc(f.message || 'Unknown error')}</li>`).join('')}${failures.length>12?`<li>…and ${failures.length-12} more.</li>`:''}</ul>
    </details>
  </div>`;
  host.insertAdjacentHTML('afterbegin', html);
}

async function buildRealismReplacementChange(result){
  const entryIdx = result.entryIdx;
  const sugIdx = result.sugIdx;
  const reason = (result.issues || []).map(i=>i.message).join(' | ') || 'May be unrealistic or not age appropriate.';
  const entry = DATA[entryIdx];
  if(!entry) throw new Error('Entry not found');
  const oldSug = getSugs(entry)[sugIdx];
  if(!oldSug) throw new Error('Suggestion not found');
  const deterministicFix = buildDeterministicRealismFix_(result);
  if(deterministicFix) return deterministicFix;
  const isStem = sugIdx === 5;
  const oldTool = sugTool(oldSug);
  const oldDesc = sugDesc(oldSug);
  const otherTools = getSugs(entry).filter((s,i)=>i!==sugIdx && isRealSug(s)).map(s=>sugTool(s)).join(', ');
  const constraints = isStem ? REALISTIC_TOOL_USE_RULES : buildToolConstraints(entry.yl);
  const prompt = isStem ? `You are replacing protected Suggestion 6, the STEM Design Cycle idea, for this IB PYP unit. This is a manual DLP-approved action, not a bulk edit.
Campus: ${entry.ca}
Year level: ${entry.yl}
Theme: ${entry.th}
Central Idea: ${entry.ci || ''}
Lines of Inquiry: ${entry.lo || ''}
Planner summary: ${entry.plannerText || ''}
Current STEM suggestion: ${oldTool}: ${oldDesc}
Problem flagged: ${reason}

Create ONE replacement STEM Design Cycle activity that is realistic for this year level. It must include tangible making/prototyping materials and a clear Empathise → Define → Ideate → Prototype → Test cycle. It may include age-appropriate technology only when the tech is genuinely useful.
${REALISTIC_TOOL_USE_RULES}
Return ONLY JSON: {"t":"Project name","d":"~6 vivid practical sentences (500-800 chars) describing exactly what students build, test and improve, following the writing-style rules above."}`
  : `You are replacing one unrealistic, vague, weakly connected, banned or not age-appropriate digital learning suggestion for an IB PYP unit.
Campus: ${entry.ca}
Year level: ${entry.yl}
Theme: ${entry.th}
Central Idea: ${entry.ci || ''}
Lines of Inquiry: ${entry.lo || ''}
Planner summary: ${entry.plannerText || ''}
Current suggestion to replace: ${oldTool}: ${oldDesc}
Problem flagged: ${reason}
Other tools already used in this unit — avoid duplicates unless you are only improving the same tool's description: ${otherTools || 'none'}

${constraints}
${SUGGESTION_STYLE}
${REALISTIC_TOOL_USE_RULES}
${(typeof aiRealWorldRulesBlock_ === 'function') ? aiRealWorldRulesBlock_() : ''}

Create ONE replacement suggestion that is classroom-realistic, age-appropriate, and directly connected to the unit. If the current tool is actually appropriate, you may keep the same tool but must substantially improve the description so the classroom activity is practical and specific. Return ONLY JSON: {"t":"Tool Name","d":"~6 vivid practical sentences (500-800 chars) following the writing-style and depth rules above.","url":"optional direct lesson URL"}`;

  const raw = await callAI([{role:'user',parts:[{text:prompt}]}], null, OPENAI_FAST_MODEL || OPENAI_MODEL);
  const clean = raw.replace(/```json|```/g,'').trim();
  const si = clean.indexOf('{'), ei = clean.lastIndexOf('}');
  if(si === -1 || ei === -1) throw new Error('AI did not return JSON.');
  const parsed = JSON.parse(clean.slice(si, ei + 1));
  if(!parsed.t || !parsed.d) throw new Error('AI replacement was missing a tool/project name or description.');
  if(!isStem){
    if(!isAiToolSafeForEntry(parsed.t, entry)) throw new Error(`${parsed.t} is banned or not age-appropriate for ${entry.yl}.`);
    // Allow same-tool description improvements, but reject duplicates with any other slot.
    if(toolKey(parsed.t) !== toolKey(oldTool) && wouldDupeToolProposalInEntry(entry, parsed.t, sugIdx)) throw new Error(`${parsed.t} duplicates another suggestion in this unit.`);
  }
  const realism = checkRealisticToolUse(parsed.t, parsed.d, entry);
  if(!realism.ok) throw new Error('Draft rejected as unrealistic: ' + realism.reason);
  const quality = await evaluateDraftImprovement(entry, oldSug, parsed, reason, isStem);
  const change = {
    entryIdx,
    sugIdx,
    t: parsed.t,
    d: parsed.d,
    auditReason: reason,
    auditIssues: result.issues || [],
    auditSource: 'realism-age-audit',
    improvementConfidence: quality.confidence,
    improvementScore: quality.score,
    whyBetter: quality.whyBetter,
    remainingConcern: quality.remainingConcern
  };
  if(parsed.url) change.url = parsed.url;
  return change;
}

async function draftAllRealismFixes(scope){
  const source = (REALISM_AUDIT_RESULTS || []).slice();
  if(!source.length){
    alert('Run the realism audit first.');
    return;
  }
  const targets = source.filter(r => scope === 'high' ? resultHighestSeverity(r) === 'high' : true);
  if(!targets.length){
    alert(scope === 'high' ? 'No high-priority flags to fix.' : 'No flagged suggestions to fix.');
    return;
  }

  const label = scope === 'high' ? 'high-priority flagged suggestion' : 'flagged suggestion';
  const confirmed = confirm(`Draft AI fixes for ${targets.length} ${label}${targets.length!==1?'s':''}?\n\nThis will generate replacement drafts one by one, then run an AI quality check comparing each draft against the original. Low-confidence drafts will be rejected before the review popup. Nothing will be saved automatically — all accepted drafts still need human approval.`);
  if(!confirmed) return;

  const buttons = Array.from(document.querySelectorAll('.btn-realism-fix-all'));
  buttons.forEach(b => { b.disabled = true; });
  const prog = document.getElementById('realism-batch-progress');
  const bar = document.getElementById('realism-batch-bar');
  const lbl = document.getElementById('realism-batch-label');
  if(prog) prog.style.display = 'block';
  startProgress();

  const changes = [];
  const failures = [];
  const seenSlots = new Set();

  for(let i=0; i<targets.length; i++){
    const r = targets[i];
    const pct = Math.round(((i+1)/targets.length)*100);
    const slotKey = `${r.entryIdx}:${r.sugIdx}`;
    if(seenSlots.has(slotKey)) continue;
    seenSlots.add(slotKey);
    if(bar) bar.style.width = pct + '%';
    if(lbl) lbl.textContent = `${i+1}/${targets.length}: ${r.yl} — ${r.th} — Suggestion ${r.sugIdx + 1}`;
    setStatus(`Drafting realism fix ${i+1}/${targets.length}: ${r.yl} — ${r.th}`, 'loading');
    try{
      const change = await buildRealismReplacementChange(r);
      if(change) changes.push(change);
    }catch(e){
      failures.push({result:r, message:e.message});
      console.warn('Realism fix failed:', r, e.message);
    }
    if(i < targets.length - 1) await sleep(350);
  }

  buttons.forEach(b => { b.disabled = false; });
  if(prog) prog.style.display = 'none';
  stopProgress();
  renderRealismBatchFailureSummary_(failures);

  if(!changes.length){
    const msg = failures.length ? `No fixes were drafted. First error: ${failures[0].message}` : 'No fixes were drafted.';
    setStatus(msg, 'error');
    alert(msg);
    return;
  }

  const failNote = failures.length ? ` (${failures.length} could not be drafted — see the failure summary below the audit results)` : '';
  window._snapshotReason = `Before applying ${changes.length} realism/age fix${changes.length!==1?'es':''}`;
  showChangesPopup(changes);
  setStatus(`${changes.length} realism fix draft${changes.length!==1?'s':''} ready for review${failNote}`);
}

async function draftRealismReplacement(entryIdx, sugIdx, reason){
  const entry = DATA[entryIdx];
  if(!entry) return;
  const oldSug = getSugs(entry)[sugIdx];
  if(!oldSug) return;
  const isStem = sugIdx === 5;
  const oldTool = sugTool(oldSug);
  const oldDesc = sugDesc(oldSug);
  try{
    const deterministicFix = buildDeterministicRealismFix_({
      entryIdx,
      sugIdx,
      issues: [{type:'description', severity:'high', message: reason || 'May be unrealistic or not age appropriate.'}]
    });
    if(deterministicFix){
      showChangesPopup([deterministicFix]);
      setStatus('Minecraft description clean-up drafted — review before applying');
      return;
    }
  }catch(detErr){
    console.warn('Deterministic realism fix failed, falling back to AI:', detErr.message);
  }
  const otherTools = getSugs(entry).filter((s,i)=>i!==sugIdx && isRealSug(s)).map(s=>sugTool(s)).join(', ');
  const constraints = isStem ? REALISTIC_TOOL_USE_RULES : buildToolConstraints(entry.yl);
  const prompt = isStem ? `You are replacing protected Suggestion 6, the STEM Design Cycle idea, for this IB PYP unit. This is a manual DLP-approved action, not a bulk edit.
Campus: ${entry.ca}
Year level: ${entry.yl}
Theme: ${entry.th}
Central Idea: ${entry.ci || ''}
Lines of Inquiry: ${entry.lo || ''}
Planner summary: ${entry.plannerText || ''}
Current STEM suggestion: ${oldTool}: ${oldDesc}
Problem flagged: ${reason || 'May be unrealistic or not age appropriate.'}

Create ONE replacement STEM Design Cycle activity that is realistic for this year level. It must include tangible making/prototyping materials and a clear Empathise → Define → Ideate → Prototype → Test cycle. It may include age-appropriate technology only when the tech is genuinely useful.
${REALISTIC_TOOL_USE_RULES}
Return ONLY JSON: {"t":"Project name","d":"~6 vivid practical sentences (500-800 chars) describing exactly what students build, test and improve, following the writing-style rules above."}`
  : `You are replacing one unrealistic or not age-appropriate digital learning suggestion for an IB PYP unit.
Campus: ${entry.ca}
Year level: ${entry.yl}
Theme: ${entry.th}
Central Idea: ${entry.ci || ''}
Lines of Inquiry: ${entry.lo || ''}
Planner summary: ${entry.plannerText || ''}
Current suggestion to replace: ${oldTool}: ${oldDesc}
Problem flagged: ${reason || 'May be unrealistic or not age appropriate.'}
Other tools already used in this unit — avoid duplicates: ${otherTools || 'none'}

${constraints}
${SUGGESTION_STYLE}

Create ONE replacement suggestion that is classroom-realistic, age-appropriate, and directly connected to the unit. Return ONLY JSON: {"t":"Tool Name","d":"~6 vivid practical sentences (500-800 chars) following the writing-style and depth rules above.","url":"optional direct lesson URL"}`;

  startProgress();
  setStatus(`Drafting replacement for ${entry.yl} — ${entry.th}…`, 'loading');
  try{
    const raw = await callAI([{role:'user',parts:[{text:prompt}]}], null, OPENAI_FAST_MODEL || OPENAI_MODEL);
    const clean = raw.replace(/```json|```/g,'').trim();
    const si = clean.indexOf('{'), ei = clean.lastIndexOf('}');
    if(si === -1 || ei === -1) throw new Error('AI did not return JSON.');
    const parsed = JSON.parse(clean.slice(si, ei + 1));
    if(!parsed.t || !parsed.d) throw new Error('AI replacement was missing a tool/project name or description.');
    if(!isStem){
      if(!isAiToolSafeForEntry(parsed.t, entry)) throw new Error(`Draft rejected: ${parsed.t} is banned or not age-appropriate for ${entry.yl}.`);
      if(wouldDupeToolProposalInEntry(entry, parsed.t, sugIdx)) throw new Error(`Draft rejected: ${parsed.t} duplicates another suggestion in this unit.`);
    }
    const realism = checkRealisticToolUse(parsed.t, parsed.d, entry);
    if(!realism.ok) throw new Error('Draft rejected as unrealistic: ' + realism.reason);
    const quality = await evaluateDraftImprovement(entry, oldSug, parsed, reason || 'May be unrealistic or not age appropriate.', isStem);
    const change = {
      entryIdx,
      sugIdx,
      t: parsed.t,
      d: parsed.d,
      auditReason: reason || 'May be unrealistic or not age appropriate.',
      auditSource: 'realism-age-audit',
      improvementConfidence: quality.confidence,
      improvementScore: quality.score,
      whyBetter: quality.whyBetter,
      remainingConcern: quality.remainingConcern
    };
    if(parsed.url) change.url = parsed.url;
    showChangesPopup([change]);
    setStatus('Replacement drafted — review before applying');
  }catch(e){
    alert('Could not draft replacement: ' + e.message);
    setStatus('Replacement draft failed: ' + e.message, 'error');
  }finally{
    stopProgress();
  }
}


async function readSheetRange(range){
  const token = await getDriveToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values/${encodeURIComponent(range)}`;
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  const d = await r.json();
  if(d.error) throw new Error(d.error.message);
  return d.values || [];
}

async function readMultipleRanges(ranges){
  const token = await getDriveToken();
  const params = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values:batchGet?${params}`;
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  const d = await r.json();
  if(d.error) throw new Error(d.error.message);
  return d.valueRanges.map(vr => vr.values || []);
}

async function getAnalyticsSheetTz(){
  if(window._analyticsSheetTz) return window._analyticsSheetTz;
  try{
    const token = await getDriveToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}?fields=properties.timeZone`;
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    const d = await r.json();
    window._analyticsSheetTz = (d && d.properties && d.properties.timeZone) || 'Australia/Sydney';
  }catch(_){
    window._analyticsSheetTz = 'Australia/Sydney';
  }
  return window._analyticsSheetTz;
}

async function loadLiveAnalytics(){
  const loading = document.getElementById('live-loading');
  const contentEl = document.getElementById('live-content');
  const lastUpdated = document.getElementById('live-last-updated');
  const btn = document.getElementById('btn-refresh-live');
  const dot = document.getElementById('live-dot');

  if(loading) loading.style.display = 'block';
  if(contentEl) contentEl.style.display = 'none';
  if(btn) btn.disabled = true;
  if(dot) dot.style.background = '#fbbf24';

  try{
    const [tz, [dashRows, analyticsRows, feedbackRows, usedRows]] = await Promise.all([
      getAnalyticsSheetTz(),
      readMultipleRanges([
        'Dashboard!A1:F60',
        'Analytics!A1:F5000',
        'Feedback!A1:G100',
        'Used!A1:G2000'
      ])
    ]);

    // Intent sheet is fetched separately and tolerated as missing — it only
    // auto-creates the first time a teacher clicks "I'm going to try this",
    // so on a fresh deploy a batched read would 400 and break the whole dashboard.
    let intentRows = [];
    try {
      intentRows = await readSheetRange('Intent!A1:G2000');
    } catch (intentErr) {
      console.info('Intent sheet not yet present (will appear after first click):', intentErr && intentErr.message || intentErr);
      intentRows = [];
    }

    // Cache datasets first so any renderer that switches tabs/scopes can re-pull.
    window._growthRowsCache = { analytics: analyticsRows, used: usedRows, intent: intentRows };
    window._usedRowsCache   = usedRows;
    window._intentRowsCache = intentRows;
    window._feedbackCache   = feedbackRows;
    window._dashRowsCache   = dashRows;

    // Overview
    if(typeof renderInsights === 'function') renderInsights();  // insights & suggested actions
    if(typeof restoreCachedAISummary_ === 'function') restoreCachedAISummary_();
    renderLiveOverview(dashRows);         // → KPI strip (04-audit-analytics-live.js)
    renderLiveGrowth(CURRENT_GROWTH_BUCKET); // → ECharts growth line
    renderLiveScorecard(dashRows);

    // Adoption
    renderLiveAdoptionExtras();           // reach matrix + year coverage
    renderLiveCampusChart(dashRows);
    renderLiveUsedByTeam(usedRows);

    // Engagement
    renderLiveEngagementExtras();         // funnel
    renderToolRankings('all');
    renderLiveTopPages(dashRows);
    renderLiveUsed(usedRows);

    // Feedback & Audit
    renderLiveFeedback(feedbackRows);
    renderLiveUsedAudit(usedRows);

    // Heatmap is replaced by the reach matrix — keep call so the host clears cleanly.
    renderLiveHeatmap(dashRows);

    if(loading) loading.style.display = 'none';
    if(contentEl) contentEl.style.display = 'block';
    if(dot) dot.style.background = 'var(--lime)';
    if(lastUpdated) lastUpdated.textContent = 'Last updated ' + new Date().toLocaleTimeString('en-AU') + ' — auto-updates as teachers use the app';
  }catch(e){
    if(loading) loading.innerHTML = `<div style="color:#FF8080;font-size:14px">Failed to load: ${esc(e.message)}</div>`;
    if(dot) dot.style.background = '#FF8080';
    console.error(e);
  }
  if(btn) btn.disabled = false;
}

function findSection(rows, headerText){
  
  let startIdx = -1;
  for(let i=0; i<rows.length; i++){
    if(rows[i].some(c => String(c||'').includes(headerText))){ startIdx = i; break; }
  }
  if(startIdx === -1) return [];
  const result = [];
  for(let i=startIdx+1; i<rows.length; i++){
    if(!rows[i] || !rows[i].length || rows[i].every(c=>!c)) break;
    result.push(rows[i]);
  }
  return result;
}

function renderLiveScorecard(rows){
  const el = document.getElementById('live-scorecard'); if(!el) return;
  const section = findSection(rows, 'WEEKLY SCORECARD');
  
  const data = section.slice(1);
  if(!data.length){ el.innerHTML = '<div style="color:var(--dim);font-size:13px">No data</div>'; return; }

  const statusColour = s => {
    const v = String(s||'').toLowerCase();
    if(v.includes('good') || v.includes('✓')) return 'var(--lime)';
    if(v.includes('no data') || v.includes('⚪')) return 'var(--dim)';
    if(v.includes('none') || v.includes('🔴')) return '#FF8080';
    return '#fbbf24';
  };

  el.innerHTML = data.map(row => {
    const [metric, , value, target, status, meaning] = row;
    if(!metric) return '';
    const col = statusColour(status);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0"></div>
      <div style="width:160px;flex-shrink:0;font-size:13px;font-weight:600">${esc(metric)}</div>
      <div style="width:50px;font-size:20px;font-weight:900;color:${col}">${esc(value||'—')}</div>
      <div style="width:80px;font-size:11px;color:var(--dim)">${esc(target||'')}</div>
      <div style="flex:1;font-size:12px;color:#aaa">${esc(meaning||'')}</div>
    </div>`;
  }).join('');
}

// renderLiveOverview replaced by KPI strip in 04-audit-analytics-live.js

let CURRENT_GROWTH_BUCKET = 'week';
let CURRENT_GROWTH_CAMPUS = 'all';

function setGrowthBucket(bucket){
  CURRENT_GROWTH_BUCKET = bucket;
  document.querySelectorAll('.growth-bucket').forEach(b => {
    b.classList.toggle('active', b.dataset.bucket === bucket);
  });
  renderLiveGrowth(bucket);
}

function setGrowthCampus(campus){
  CURRENT_GROWTH_CAMPUS = campus;
  document.querySelectorAll('.growth-campus').forEach(b => {
    b.classList.toggle('active', b.dataset.campus === campus);
  });
  renderLiveGrowth(CURRENT_GROWTH_BUCKET);
}

// Loose campus equality — handles "St Kilda" vs "St Kilda Rd" and case/whitespace.
function campusMatchesGrowth_(rowCampus, scope){
  if(scope === 'all') return true;
  const a = String(rowCampus||'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
  const b = String(scope    ||'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
  if(!a) return false;
  if(a === b) return true;
  if(b.startsWith('stkilda') && a.startsWith('stkilda')) return true;
  return false;
}

// Build the JS Date for a wall-clock that occurred in `tz`. Without a TZ library, we
// use Intl to derive the offset: pretend the parts are UTC, ask what wall-clock that
// instant looks like in `tz`, and the difference is the TZ offset to subtract.
function instantFromPartsInTz_(year, month, day, hour, min, sec, tz){
  const asIfUtc = Date.UTC(year, month-1, day, hour, min, sec);
  try{
    const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12:false,
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const p = {};
    dtf.formatToParts(new Date(asIfUtc)).forEach(x => { if(x.type !== 'literal') p[x.type] = parseInt(x.value, 10); });
    if(p.hour === 24) p.hour = 0;
    const inTz = Date.UTC(p.year, p.month-1, p.day, p.hour, p.minute, p.second);
    const offset = inTz - asIfUtc; // ms; positive when tz is ahead of UTC
    return new Date(asIfUtc - offset);
  }catch(_){
    return new Date(year, month-1, day, hour, min, sec);
  }
}

function parseGrowthTimestamp_(raw){
  const s = String(raw||'').trim();
  if(!s) return null;
  const tz = window._analyticsSheetTz || 'Australia/Sydney';
  // Sheets DD/MM/YYYY HH:MM[:SS] in the spreadsheet's TZ
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){
    return instantFromPartsInTz_(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4]||0), Number(m[5]||0), Number(m[6]||0), tz);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function dayStart_(date){
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function weekStart_(date){
  const d = dayStart_(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); // Monday
  return d;
}
function monthStart_(date){
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function isoKey_(date){
  const m = String(date.getMonth()+1).padStart(2,'0');
  const dd = String(date.getDate()).padStart(2,'0');
  return `${date.getFullYear()}-${m}-${dd}`;
}
function monthKey_(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}

// renderLiveGrowth replaced by ECharts version in 04-audit-analytics-live.js

function renderLiveUsedByTeam(rows){
  const el = document.getElementById('live-used-by-team'); if(!el) return;
  const countEl = document.getElementById('live-used-by-team-count');
  // Used columns: 0 Timestamp, 1 Team, 2 Campus, 3 Year, 4 Theme, 5 Tool, 6 Phase
  const events = (rows||[]).slice(1).filter(r => r && (r[1] || (r[2] && r[3])));
  if(!events.length){
    if(countEl) countEl.textContent = '';
    el.innerHTML = '<div style="color:var(--dim);font-size:13px;padding:8px 0">No "I Used This" clicks yet.</div>';
    return;
  }
  const tally = {};
  events.forEach(r => {
    const team = String(r[1]||'').trim() || (String(r[2]||'').trim()+' '+String(r[3]||'').trim()+' Team');
    const campus = String(r[2]||'').trim();
    if(!tally[team]) tally[team] = { count:0, campus, lastTs:null };
    tally[team].count++;
    const ts = parseGrowthTimestamp_(r[0]);
    if(ts && (!tally[team].lastTs || ts > tally[team].lastTs)) tally[team].lastTs = ts;
  });
  const sorted = Object.entries(tally).map(([team,info]) => ({ team, ...info })).sort((a,b) => b.count - a.count);
  const total = sorted.reduce((a,b) => a + b.count, 0);
  const max = Math.max(1, ...sorted.map(t => t.count));
  const campusCol = {'Elsternwick':'#818cf8','Glen Waverley':'#34d399','St Kilda Rd':'#fb923c','St Kilda':'#fb923c'};

  if(countEl) countEl.textContent = `${sorted.length} team${sorted.length===1?'':'s'} · ${total} click${total===1?'':'s'}`;

  el.innerHTML = sorted.slice(0,20).map((t, idx) => {
    const col = campusCol[t.campus] || 'var(--lime)';
    const pct = Math.round((t.count/max)*100);
    const lastLbl = t.lastTs ? t.lastTs.toLocaleDateString('en-AU',{day:'numeric',month:'short'}) : '—';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="width:18px;font-size:11px;color:var(--dim);text-align:right;flex-shrink:0">${idx+1}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px;gap:8px">
          <span style="color:${col};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.team)}</span>
          <span style="color:var(--dim);flex-shrink:0">${t.count} · last ${esc(lastLbl)}</span>
        </div>
        <div style="height:6px;background:var(--card2);border-radius:3px">
          <div style="height:100%;border-radius:3px;background:${col};width:${pct}%"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

let AUDIT_FILTERS = { campus:'all', year:'all', search:'' };

function renderLiveUsedAudit(rows){
  const el = document.getElementById('live-used-audit'); if(!el) return;
  const countEl = document.getElementById('live-used-audit-count');
  window._usedAuditRowsCache = rows || [];

  // Used columns: 0 Timestamp, 1 Team, 2 Campus, 3 Year, 4 Theme, 5 Tool, 6 Phase
  const events = (rows||[]).slice(1)
    .filter(r => r && (r[1] || (r[2] && r[3])))
    .map(r => ({
      ts: parseGrowthTimestamp_(r[0]),
      team: String(r[1]||'').trim() || (String(r[2]||'').trim()+' '+String(r[3]||'').trim()+' Team'),
      campus: String(r[2]||'').trim(),
      year: String(r[3]||'').trim(),
      theme: String(r[4]||'').trim(),
      tool: String(r[5]||'').trim(),
      phase: String(r[6]||'').trim()
    }));

  // Populate the year-level dropdown from the data (sorted, with "all" as the first option).
  const yearSel = document.getElementById('audit-year-filter');
  if(yearSel){
    const existing = AUDIT_FILTERS.year;
    const years = Array.from(new Set(events.map(e => e.year).filter(Boolean))).sort();
    yearSel.innerHTML = '<option value="all">All year levels</option>' + years.map(y => `<option value="${esc(y)}">${esc(y)}</option>`).join('');
    yearSel.value = years.indexOf(existing) >= 0 ? existing : 'all';
    AUDIT_FILTERS.year = yearSel.value;
  }

  const q = AUDIT_FILTERS.search.trim().toLowerCase();
  const filtered = events
    .filter(e => AUDIT_FILTERS.campus === 'all' || e.campus === AUDIT_FILTERS.campus)
    .filter(e => AUDIT_FILTERS.year === 'all' || e.year === AUDIT_FILTERS.year)
    .filter(e => !q || (e.theme.toLowerCase().includes(q) || e.tool.toLowerCase().includes(q) || e.phase.toLowerCase().includes(q) || e.team.toLowerCase().includes(q)))
    .sort((a,b) => (b.ts ? b.ts.getTime() : 0) - (a.ts ? a.ts.getTime() : 0));

  if(countEl) countEl.textContent = filtered.length === events.length
    ? `${filtered.length} click${filtered.length===1?'':'s'}`
    : `${filtered.length} of ${events.length} clicks`;

  if(!filtered.length){
    el.innerHTML = '<div style="color:var(--dim);font-size:13px;padding:8px 0">No matching clicks.</div>';
    return;
  }

  const campusCol = {'Elsternwick':'#818cf8','Glen Waverley':'#34d399','St Kilda Rd':'#fb923c','St Kilda':'#fb923c'};
  const cap = 300;
  const head = filtered.slice(0, cap);
  el.innerHTML = head.map(e => {
    const col = campusCol[e.campus] || 'var(--lime)';
    const dt = e.ts
      ? e.ts.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'2-digit'}) + ' · ' + e.ts.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})
      : '—';
    return `<div style="padding:8px 0;border-bottom:1px solid #2a2a2a;font-size:12px;line-height:1.5">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:2px">
        <span style="color:${col};font-weight:600">${esc(e.team)}</span>
        <span style="color:var(--dim);font-size:11px;flex-shrink:0">${esc(dt)}</span>
      </div>
      <div style="color:var(--text)">${esc(e.theme) || '<span style="color:var(--dim)">(no theme)</span>'}</div>
      <div style="color:var(--dim);font-size:11px">${esc(e.tool) || '—'}${e.phase ? ' · ' + esc(e.phase) : ''}</div>
    </div>`;
  }).join('') + (filtered.length > cap ? `<div style="color:var(--dim);font-size:11px;padding:8px 0;text-align:center">Showing first ${cap} — narrow the filters to see the rest.</div>` : '');
}

function setAuditCampus(c){
  AUDIT_FILTERS.campus = c;
  document.querySelectorAll('.audit-campus').forEach(b => b.classList.toggle('active', b.dataset.campus === c));
  if(window._usedAuditRowsCache) renderLiveUsedAudit(window._usedAuditRowsCache);
}
function setAuditYear(y){
  AUDIT_FILTERS.year = y;
  if(window._usedAuditRowsCache) renderLiveUsedAudit(window._usedAuditRowsCache);
}
function setAuditSearch(s){
  AUDIT_FILTERS.search = s || '';
  if(window._usedAuditRowsCache) renderLiveUsedAudit(window._usedAuditRowsCache);
}

// renderLiveCampusChart / renderLiveHeatmap replaced in 04-audit-analytics-live.js
// (heatmap is superseded by the reach matrix on the Adoption sub-tab).

function formatAnalyticsTimestamp(ts){
  const raw = String(ts||'').trim();
  if(!raw) return '';
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){
    const d = new Date(Number(m[3]), Number(m[2])-1, Number(m[1]), Number(m[4]||0), Number(m[5]||0), Number(m[6]||0));
    if(!isNaN(d)) return d.toLocaleDateString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  }
  const d = new Date(raw);
  if(!isNaN(d)) return d.toLocaleDateString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  return raw;
}

// renderLiveTopPages replaced by ECharts horizontal bar in 04-audit-analytics-live.js

function renderLiveFeedback(rows){
  const el = document.getElementById('live-feedback'); if(!el) return;
  
  const data = rows.slice(1).filter(r=>r[6]).reverse(); 
  if(!data.length){ el.innerHTML='<div style="color:var(--dim);font-size:13px">No feedback yet</div>'; return; }

  el.innerHTML = data.slice(0,20).map(row => {
    const [ts,campus,yl,theme,tool,phase,feedback] = row;
    const date = ts ? new Date(ts).toLocaleDateString('en-AU',{day:'numeric',month:'short'}) : '';
    const campusCol = {'Elsternwick':'#818cf8','Glen Waverley':'#34d399','St Kilda Rd':'#fb923c'}[campus]||'var(--dim)';
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        <span style="font-size:11px;color:${campusCol};font-weight:700">${esc(campus)}</span>
        <span style="font-size:11px;color:var(--gold);font-weight:600">${esc(yl)}</span>
        <span style="font-size:11px;color:var(--dim)">${esc(theme)}</span>
        <span style="font-size:11px;color:var(--dim);margin-left:auto">${date}</span>
      </div>
      <div style="font-size:11px;color:#9B8BFF;margin-bottom:4px">${esc(tool)} · ${esc(phase)}</div>
      <div style="font-size:13px;color:var(--text);line-height:1.5">${esc(feedback)}</div>
    </div>`;
  }).join('');
}

function renderLiveUsed(rows){
  const el = document.getElementById('live-used'); if(!el) return;
  
  const data = rows.slice(1).filter(r=>r[5]).reverse();
  if(!data.length){ el.innerHTML='<div style="color:var(--dim);font-size:13px">No tools marked as used yet</div>'; return; }

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">` +
    data.slice(0,15).map(row => {
      const [ts,team,campus,yl,theme,tool] = row;
      const date = ts ? new Date(ts).toLocaleDateString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      const campusCol = {'Elsternwick':'#818cf8','Glen Waverley':'#34d399','St Kilda Rd':'#fb923c','St Kilda':'#fb923c'}[campus]||'var(--dim)';
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--card2);border-radius:8px;font-size:12px">
        <span style="color:var(--lime);font-size:16px">✓</span>
        <span style="color:${campusCol};font-weight:700;width:100px;flex-shrink:0">${esc(campus)}</span>
        <span style="color:var(--gold);font-weight:600;width:62px;flex-shrink:0">${esc(yl)}</span>
        <span style="flex:1;font-weight:600">${esc(tool)}</span>
        <span style="color:var(--dim)">${esc(theme)}</span>
        <span style="color:var(--dim);flex-shrink:0">${date}</span>
      </div>`;
    }).join('') + '</div>';
}

// ========== TOOL USAGE RANKINGS ==========
let CURRENT_RANKING_SCOPE = 'all';

function setRankingScope(scope){
  CURRENT_RANKING_SCOPE = scope;
  document.querySelectorAll('.ranking-scope').forEach(b => {
    b.classList.toggle('active', b.dataset.scope === scope);
  });
  renderToolRankings(scope);
}

// renderToolRankings replaced by ECharts horizontal bar in 04-audit-analytics-live.js.
// setRankingScope (above) still calls renderToolRankings(scope), which now resolves
// to the ECharts version defined earlier (since 04 loads first, the 04 binding wins
// once these older definitions are removed).




/* ----- Block: legacy lines 5203-6374 ----- */

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

function bulkDetectNamedToolOpportunity_(instruction){
  const text = String(instruction || '').toLowerCase().replace(/[’']/g, '');
  if(!bulkInstructionLooksLikeOpportunity(text)) return '';
  const aliases = {
    'book creator':'Book Creator',
    'bookcreator':'Book Creator',
    'beebot':'Bee-Bots',
    'bee bot':'Bee-Bots',
    'bee-bot':'Bee-Bots',
    'bee bots':'Bee-Bots',
    'bee-bots':'Bee-Bots',
    'scratch jr':'ScratchJR',
    'scratchjr':'ScratchJR',
    'makey makey':'Makey Makey',
    'makeymakey':'Makey Makey',
    'the makey makey':'Makey Makey',
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
  [`lib-${key}-url`,`lib-${key}-title`,`lib-${key}-desc`,`lib-${key}-notes`].forEach(id=>{
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
  const teaching_notes = document.getElementById(`lib-${key}-notes`)?.value.trim() || '';
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
  if(teaching_notes) entry.teaching_notes = teaching_notes;

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
  const notesEl = document.getElementById(`lib-${key}-notes`);
  if(notesEl) notesEl.value = lesson.teaching_notes || '';
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


function libImportAllTrigger(){ document.getElementById('lib-import-all')?.click(); }

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
                ${l.teaching_notes ? `<div style="font-size:11px;color:var(--mint);line-height:1.5;margin-top:4px;padding:6px 10px;background:rgba(197,232,74,0.05);border-left:2px solid rgba(197,232,74,0.4);border-radius:4px"><span style="font-weight:700;letter-spacing:.5px;text-transform:uppercase;font-size:9px;color:var(--lime)">Teaching notes</span><br>${esc(l.teaching_notes)}</div>` : ''}
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

        <input id="lib-${esc(key)}-desc" class="inp" placeholder="Short description (elevator pitch — 1-2 sentences, max ~200 chars)" style="margin-bottom:8px;font-size:13px">
        <textarea id="lib-${esc(key)}-notes" class="inp" placeholder="Teaching notes (optional — pedagogy, lesson stages, assessment cues, ~400-800 chars). Used to help the AI write a deeper unit-connection." style="margin-bottom:10px;font-size:13px;min-height:64px;resize:vertical;line-height:1.5"></textarea>

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
  if(!(isFollowUp && priorTurns.length)) return raw;

  const refersBack = /\b(it|that|this|same|previous|above|those|them|connect|connected|relevant planners|all relevant planners|planners|units|entries|instead|too|also|as well|now)\b/i.test(raw);
  // A follow-up that does not itself state a fresh, complete action (find/replace/improve/
  // place/scan a specific tool) is almost certainly a refinement of the previous request,
  // so carry the earlier turns forward rather than treating it as a brand-new instruction.
  const hasOwnAction = /\b(find|add|replace|swap|remove|improve|place|scan|suggest|propose)\b/i.test(raw);
  const isShort = raw.length < 160;

  if(refersBack || isShort || !hasOwnAction){
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


function bulkInstructionCanSkipClarification_(instruction, platform){
  const text = String(instruction || '').trim();
  if(!text) return false;
  // High-confidence deterministic flows should not ask GPT-4.1-mini to reinterpret the request.
  // These intents are handled by local routing inside startBulkAnalysis().
  if(bulkInstructionIsDescriptionOnly_(text)) return true;
  if(typeof bulkInstructionTargetsDiversify_ === 'function' && bulkInstructionTargetsDiversify_(text)) return true;
  if(bulkInstructionTargetsToolRemoval_(text)) return true;
  if(bulkInstructionTargetsNamedToolOpportunity_(text)) return true;
  if(typeof bulkInstructionTargetsWiseOpportunities_ === 'function' && bulkInstructionTargetsWiseOpportunities_(text)) return true;
  if(typeof bulkInstructionTargetsMinecraftOpportunities_ === 'function' && bulkInstructionTargetsMinecraftOpportunities_(text)) return true;
  // Curated platform requests such as Minecraft/Micro:bit that are already detected can also proceed.
  if(platform && bulkInstructionLooksLikeOpportunity(text)) return true;
  return false;
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
  // Do not preload libraries for every Bulk Chat message.
  // Patch 12: named-tool opportunity requests such as "find more opportunities to use Makey Makey"
  // do not need libraries.json, and preloading/rendering the library inventory here can freeze Studio.
  // Library loading stays inside the specialised flows that genuinely need curated lessons, such as Minecraft.
  if(/minecraft|lesson\s+library|curated\s+lesson|specific\s+lesson/i.test(text) && typeof ensureLibrariesLoadedForAI === 'function'){
    await ensureLibrariesLoadedForAI();
  }

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

  // High-confidence local flows should not be reinterpreted by the clarification model.
  // Example: “find more opportunities to use Makey Makey” should go straight to the
  // named-tool opportunity flow, not become a replacement of the existing Makey slot.
  if(bulkInstructionCanSkipClarification_(text, platform)){
    updateReasoningStep(0, 'done');
    updateReasoningStep(1, 'done');
    updateReasoningStep(2, 'done');
    setTimeout(hideReasoningSteps, 500);
    bulkChatAddMessage('assistant', 'Got it — I’ll scan for eligible non-STEM units and show draft changes for review.');
    bulkChatMemory.push({ role: 'assistant', content: 'Understood — using the local targeted flow.' });
    runStartBulkAnalysisSafely_();
    return;
  }

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


/* ----- Block: legacy lines 6828-7137 ----- */

function bulkInstructionTargetsNamedToolOpportunity_(instruction){
  const tool = bulkDetectNamedToolOpportunity_(instruction);
  if(!tool || !bulkInstructionLooksLikeOpportunity(instruction)) return false;
  const key = toolInventoryKey(tool);
  // Keep these on their existing specialised flows.
  if(key === toolInventoryKey('Wise Discussion Chatbots')) return false;
  if(key === toolInventoryKey('Minecraft Education')) return false;
  if(key === toolInventoryKey('Micro:bit')) return false;
  return true;
}

function bulkToolOpportunityFamily_(toolName){
  const key = toolInventoryKey(toolName).toLowerCase();
  if(/lego spike|sphero|bee-bot|beebot|micro:bit|codrone|makey makey|tinkercad|3d printer|minecraft/.test(key)) return 'stem-hardware';
  if(/book creator|canva|adobe express|imovie|garageband|green screen|stop motion|chatterpix|puppet pals/.test(key)) return 'creation';
  if(/forms|excel|word clouds|geoboard/.test(key)) return 'data';
  if(/google earth|google maps|field guide/.test(key)) return 'place';
  if(/padlet|freeform|teams|onenote|sway|powerpoint|word/.test(key)) return 'collaboration';
  return 'general';
}

function bulkToolOpportunityUnitScore_(entry, toolName, instruction){
  const family = bulkToolOpportunityFamily_(toolName);
  const key = toolInventoryKey(toolName).toLowerCase();
  const unit = unitContextTextForRealism(entry).toLowerCase();
  let score = 5;

  // A named request is already coordinator intent, but still rank the strongest fits first.
  if(family === 'stem-hardware'){
    score += 3;
    if(/how the world works|force|motion|energy|material|machine|simple machine|system|cause and effect|electric|circuit|sensor|automation|robot|code|algorithm|prototype|design|engineering|model|test|debug|iterate|innovation|solution|sustainab|waste|water|habitat|ecosystem|environment|transport|journey|map|navigation|measurement|data/.test(unit)) score += 12;
    if(/sharing the planet|how we organise ourselves/.test(unit) && /problem|solution|sustainab|community|system|service|resource|environment|waste|water|energy|transport/.test(unit)) score += 8;
    if(/who we are|wellbeing|identity|belief|friendship|emotion|self|relationship/.test(unit) && !/design|solution|prototype|system|model|assistive|accessibility|community/.test(unit)) score -= 10;
    if(/how we express ourselves|art|story|culture|celebration|performance|music/.test(unit) && !/interactive|mechanism|prototype|design|model/.test(unit)) score -= 6;
  } else if(family === 'creation'){
    if(/express|story|identity|culture|perspective|report|explain|present|communication|reflection|portfolio|narrative|information|publish|audience|art|media/.test(unit)) score += 10;
    if(/how the world works|sharing the planet|where we are|organise/.test(unit)) score += 4;
  } else if(family === 'data'){
    if(/data|survey|graph|chart|measure|pattern|compare|questionnaire|statistics|evidence|results|investigation|experiment|poll/.test(unit)) score += 12;
  } else if(family === 'place'){
    if(/place|location|map|migration|journey|settlement|country|community|environment|habitat|landform|geography|where we are/.test(unit)) score += 12;
  } else if(family === 'collaboration'){
    if(/collaborat|perspective|discussion|brainstorm|compare|reflect|organise|community|systems|inquiry|research|share/.test(unit)) score += 8;
  }

  // Tool-specific nudges.
  if(/lego spike prime/i.test(toolName)){
    if(/year 5|year 6/i.test(entry?.yl || '')) score += 2;
    if(/force|motion|energy|machine|mechanism|sensor|automated|robot|prototype|design|engineering|system|solution|sustainab|waste|transport|accessibility/.test(unit)) score += 8;
  }
  if(/book creator/i.test(toolName) && /prep|year 1|year 2/i.test(entry?.yl || '')) score += 4;

  // If the coordinator named a year level, that filtering happens elsewhere.
  return score;
}

function bulkNamedToolOpportunitySlotScore_(entry, sug, sugIdx, targetTool){
  if(!entry || !sug || Number(sugIdx) === 5) return -9999;
  const existingTool = sugTool(sug);
  const existingKey = toolInventoryKey(existingTool).toLowerCase();
  if(existingKey === toolInventoryKey(targetTool).toLowerCase()) return -9999;
  const desc = String(sugDesc(sug) || '').replace(/\s+/g,' ').trim();
  const issues = (typeof suggestionAuditIssues === 'function') ? suggestionAuditIssues(entry, sug, sugIdx) : [];
  let score = 0;
  const typeSet = new Set(issues.map(i => i.type));
  if(typeSet.has('vague') || typeSet.has('thin') || typeSet.has('connection') || typeSet.has('generic')) score += 9;
  if(desc.length < 90) score += 5;
  if(!/(create|produce|record|build|design|publish|share|capture|explain|compare|reflect|draft|prototype|present|map|model|question|interview|test|code|collect|analyse|analyze)/i.test(desc)) score += 3;

  // Prefer replacing familiar, lower-impact capture tools over curated or hands-on ideas.
  if(['seesaw','canva','book creator','padlet','microsoft sway','microsoft powerpoint','microsoft word','freeform','piccollage'].some(k => existingKey.includes(k))) score += 5;
  if(/worksheet|research|poster|presentation|reflection|journal/i.test(desc)) score += 2;
  if(/micro:?bit|minecraft|sphero|lego spike|codrone|3d printer|tinkercad|makey makey/i.test(existingTool)) score -= 6;
  if(sug.url) score -= 3;
  return score;
}

function chooseNamedToolOpportunitySlot_(entry, targetTool){
  let best = null;
  getSugs(entry).forEach((sug, sugIdx) => {
    const score = bulkNamedToolOpportunitySlotScore_(entry, sug, sugIdx, targetTool);
    if(score <= -999) return;
    if(!best || score > best.score){
      best = {sugIdx, score, oldTool:sugTool(sug), oldDesc:sugDesc(sug)};
    }
  });
  return best;
}

function fallbackNamedToolOpportunityDescription_(entry, targetTool){
  const unit = cleanSuggestionText_(entry?.th || 'this unit');
  const ci = cleanSuggestionText_(entry?.ci || 'the central idea');
  const tool = cleanSuggestionText_(targetTool || 'the selected tool');
  const context = unitContextTextForRealism(entry).toLowerCase();
  if(/lego spike prime/i.test(tool)){
    if(/force|motion|energy|machine|mechanism|material|system|how the world works/i.test(context)){
      return `Students use ${tool} to build and code a working model that tests one system, force or mechanism connected to “${unit}”. They run trials, adjust the build or code, and record a short evidence note explaining how the model helps prove or challenge an idea from the unit.`;
    }
    if(/sustain|environment|waste|water|habitat|ecosystem|sharing the planet/i.test(context)){
      return `Students use ${tool} to prototype an automated solution for an environmental or sustainability challenge connected to “${unit}”, such as sorting, sensing, warning or moving materials. They test the prototype, photograph the final design, and explain how one design choice connects to the central idea: ${ci}.`;
    }
    return `Students use ${tool} to build and code a small prototype that models a problem, system or possible solution connected to “${unit}”. They test the prototype, improve one part of the build or program, and create a short design note explaining how it connects to the central idea: ${ci}.`;
  }
  if(/makey makey/i.test(tool)) return `Students use ${tool} to build a simple interactive model, poster or prototype connected to “${unit}”, using everyday conductive materials to trigger sounds, labels or responses. They test the circuit, refine one interaction, and record a short explanation of how their physical-digital product connects to the central idea: ${ci}.`;
  if(/book creator/i.test(tool)) return `Students use ${tool} to create a short multimodal book that explains one important idea from “${unit}” using text, images and voice recording. They include a final reflection page explaining how their evidence connects to the central idea: ${ci}.`;
  if(/canva|adobe express/i.test(tool)) return `Students use ${tool} to create a clear visual product connected to “${unit}”, combining concise text, images and labelled evidence. They share the finished design with a partner and explain how it supports the central idea: ${ci}.`;
  if(/padlet|freeform/i.test(tool)) return `Students use ${tool} to collect, sort and connect examples from “${unit}” on a shared board. They add short notes explaining the pattern they notice and how it links to the central idea: ${ci}.`;
  return `Students use ${tool} to create a practical learning product connected to “${unit}”. They include evidence from the unit and a short explanation of how their product connects to the central idea: ${ci}.`;
}

async function buildNamedToolOpportunityChange_(entryIdx, slot, targetTool, instruction){
  const entry = DATA[entryIdx];
  const currentSug = getSugs(entry)[slot.sugIdx];
  const oldTool = sugTool(currentSug);
  const oldDesc = sugDesc(currentSug);
  const existingTools = getSugs(entry).map((s,i)=>i===slot.sugIdx?null:sugTool(s)).filter(Boolean).join(', ');
  const plannerCtx = entry.plannerContextRich || entry.plannerText || '';
  const affordanceNote = (typeof toolAffordanceNote_ === 'function') ? toolAffordanceNote_(targetTool) : '';
  const prompt = `You are a Digital Learning Coach at Wesley College.

Task: add a strong opportunity to use the named tool: ${targetTool}.

Unit: ${entry.ca} | ${entry.yl} | "${entry.th}"
Central Idea: ${entry.ci || ''}
Lines of Inquiry: ${entry.lo || ''}
Planner context: ${plannerCtx ? plannerCtx.slice(0, 1500) : 'No planner context available.'}

Current suggestion slot to replace:
Tool: ${oldTool}
Description: ${oldDesc}

Other tools already in this unit, do not duplicate: ${existingTools || 'none'}
${affordanceNote ? '\n' + affordanceNote + '\n' : ''}
Tool rules:
- The "t" field MUST start with exactly: ${targetTool}
- You MAY pair the target tool with ONE secondary tool when it genuinely strengthens the activity. Use the format: "${targetTool} + SecondaryTool" (e.g. "${targetTool} + Freeform"). The secondary must be a Wesley-approved tool that is age-appropriate for ${entry.yl} (good pairings include Freeform, Padlet, Book Creator, Canva, Seesaw, iMovie, GarageBand, PicCollage). Do not pair with any tool already listed above.
- Otherwise return just "${targetTool}" in "t".
- Do not target the STEM Design Cycle slot; this slot has already been selected from slots 0-4.

Description rules:
- Write ~6 vivid practical sentences (500-800 chars) following the DESCRIPTION QUALITY RULES below.
- Name a specific student action and the concrete product/artefact they create.
- Anchor the action to the planner content above — refer to the unit's specific topic, concepts, or learning goals by name (drawn from the planner context, central idea, and lines of inquiry) — but NEVER quote the central idea or lines of inquiry directly.
- If pairing tools, briefly say how the two tools work together (e.g. one captures, the other displays/collects/extends).
- If using robotics/hardware such as Lego Spike Prime, describe a real build/code/test action, not a metaphor.
- Keep the wording clear for a primary teacher.
${SUGGESTION_STYLE}

Return ONLY JSON: {"t":"${targetTool}" OR "${targetTool} + Secondary","d":"~6 vivid practical sentences (500-800 chars) anchored in the planner, following the rules above."}`;

  const targetKey = toolInventoryKey(targetTool);
  let lastIssue = '';
  for(let attempt=0; attempt<3; attempt++){
    try{
      const retry = lastIssue ? `\n\nRETRY because the previous answer was rejected: ${lastIssue}. Start "t" with exactly ${targetTool}, make the classroom action concrete, and anchor it to the planner above.` : '';
      const raw = await callAI([{role:'user', parts:[{text:prompt + retry}]}], null, OPENAI_FAST_MODEL || OPENAI_MODEL);
      const clean = raw.replace(/```json|```/g,'').trim();
      const si = clean.indexOf('{'), ei = clean.lastIndexOf('}');
      if(si === -1 || ei === -1) throw new Error('AI did not return JSON.');
      const parsed = JSON.parse(clean.slice(si, ei + 1));
      const rawT = cleanSuggestionText_(parsed.t || parsed.tool || parsed.technology || targetTool);
      const newDesc = cleanSuggestionText_(parsed.d || parsed.desc || parsed.description || '');
      // Accept "X" or "X + Y" where X canonically equals targetTool.
      const parts = String(rawT).split(/\s*\+\s*/).map(s => normaliseToolName(s.trim())).filter(Boolean);
      if(!parts.length || toolInventoryKey(parts[0]) !== targetKey){
        lastIssue = `it returned ${rawT} instead of ${targetTool}`; continue;
      }
      const secondaries = parts.slice(1);
      let secondaryIssue = '';
      for(const sec of secondaries){
        if(toolInventoryKey(sec) === targetKey){ secondaryIssue = `duplicated ${targetTool} as secondary`; break; }
        if(!isAiToolSafeForEntry(sec, entry)){ secondaryIssue = `secondary tool ${sec} is not approved or age-appropriate for ${entry.yl}`; break; }
      }
      if(secondaryIssue){ lastIssue = secondaryIssue; continue; }
      const finalTool = secondaries.length ? `${targetTool} + ${secondaries.join(' + ')}` : targetTool;
      if(!newDesc){ lastIssue = 'missing description'; continue; }
      if(wouldDupeToolProposalInEntry(entry, finalTool, slot.sugIdx)){ lastIssue = `${finalTool} already exists in this unit`; continue; }
      if(!isAiToolSafeForEntry(targetTool, entry)){ lastIssue = `${targetTool} is not age-appropriate or safe for ${entry.yl}`; continue; }
      const realism = checkRealisticToolUse(targetTool, newDesc, entry);
      if(!realism.ok){ lastIssue = `realism check failed: ${realism.reason}`; continue; }
      const multiNote = secondaries.length ? ` (paired with ${secondaries.join(', ')})` : '';
      return {
        entryIdx,
        sugIdx: slot.sugIdx,
        t: finalTool,
        d: newDesc,
        auditReason: `Named tool opportunity: adds ${finalTool} to a suitable ${entry.yl} unit. Replaces: ${oldTool}.`,
        auditSource: 'bulk-named-tool-opportunity',
        improvementConfidence: 'Named tool opportunity',
        improvementScore: 4,
        whyBetter: `Uses the coordinator-requested tool (${targetTool})${multiNote} in a unit where it can create a practical student product anchored in the planner.`,
        oldTool
      };
    }catch(err){
      lastIssue = err.message || String(err);
    }
  }

  // Fallback is still reviewable and practical rather than silently returning too few.
  const fallback = fallbackNamedToolOpportunityDescription_(entry, targetTool);
  return {
    entryIdx,
    sugIdx: slot.sugIdx,
    t: targetTool,
    d: fallback,
    auditReason: `Named tool opportunity fallback: adds ${targetTool} after AI drafting failed. Replaces: ${oldTool}.`,
    auditSource: 'bulk-named-tool-opportunity-fallback',
    improvementConfidence: 'Fallback draft — review carefully',
    improvementScore: 3,
    whyBetter: `Creates a reviewable ${targetTool} opportunity instead of stopping after only a couple of AI drafts.`,
    remainingConcern: 'Generated by fallback wording; please review the unit fit before applying.',
    oldTool
  };
}

async function runBulkNamedToolOpportunityFlow_(instruction, completeData, prog, lbl, bar){
  const enrichedInstruction = bulkChatEffectiveInstruction_(instruction);
  const targetTool = bulkDetectNamedToolOpportunity_(enrichedInstruction);
  if(!targetTool) return false;

  updateReasoningStep(0, 'done');
  updateReasoningStep(1, 'active', `Finding ${targetTool} opportunity targets locally`);
  if(lbl) lbl.textContent = `Finding eligible units for ${targetTool}…`;
  if(bar) bar.style.width = '18%';

  const targetYears = bulkExtractTargetYears_(enrichedInstruction);
  const explicitCount = getBulkExplicitCount_(enrichedInstruction, null);
  const allCandidates = [];
  let skippedYear = 0, skippedAge = 0, skippedExisting = 0, skippedNoSlot = 0;

  completeData.forEach(({e,i}) => {
    if(targetYears.length && !targetYears.includes(e.yl)){ skippedYear++; return; }
    if(!isAiToolSafeForEntry(targetTool, e)){ skippedAge++; return; }
    if(entryAlreadyHasTool_(e, targetTool)){ skippedExisting++; return; }
    const slot = chooseNamedToolOpportunitySlot_(e, targetTool);
    if(!slot){ skippedNoSlot++; return; }
    const unitScore = bulkToolOpportunityUnitScore_(e, targetTool, enrichedInstruction);
    const slotScore = Math.max(0, slot.score || 0);
    allCandidates.push({entryIdx:i, slot, score: unitScore + Math.min(slotScore, 10), unitScore, slotScore});
  });

  allCandidates.sort((a,b) => b.score - a.score);
  const defaultCap = Math.min(12, allCandidates.length);
  const cap = explicitCount ? Math.min(explicitCount, allCandidates.length, 45) : defaultCap;
  const selected = allCandidates.slice(0, cap);

  if(!selected.length){
    if(prog) prog.style.display = 'none';
    updateReasoningStep(1, 'done');
    setTimeout(hideReasoningSteps, 800);
    if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')) bulkChatHistory.pop();
    const yearText = targetYears.length ? ` in ${targetYears.join(', ')}` : '';
    const parts = [];
    if(skippedAge) parts.push(`${skippedAge} outside the Tool Inventory age range`);
    if(skippedExisting) parts.push(`${skippedExisting} already contain ${targetTool}`);
    if(skippedNoSlot) parts.push(`${skippedNoSlot} had no safe non-STEM slot to replace`);
    bulkChatAddMessage('assistant', `⚠️ I understood this as a request to find more ${esc(targetTool)} opportunities${yearText}, but I could not find eligible non-STEM units to change.${parts.length ? '<br><br><span style="font-size:12px;color:var(--dim)">Skipped: '+esc(parts.join(' · '))+'</span>' : ''}`);
    bulkChatState = 'idle';
    stopProgress();
    return true;
  }

  updateReasoningStep(1, 'done');
  updateReasoningStep(2, 'done');
  updateReasoningStep(3, 'done');
  updateReasoningStep(4, 'active', `Drafting ${selected.length} ${targetTool} opportunities`);
  if(lbl) lbl.textContent = `Drafting ${selected.length} ${targetTool} opportunities…`;

  const changes = [];
  const failures = [];

  // AI-driven drafts with planner context. buildNamedToolOpportunityChange_ has its
  // own retry + deterministic fallback so a single bad response will not abort the run.
  // Sequential with sleep(350) between calls — same shape as runBulkSameToolDescriptionRewrite_,
  // which has proven stable in-browser at this concurrency.
  for(let idx=0; idx<selected.length; idx++){
    const c = selected[idx];
    if(bar) bar.style.width = `${25 + Math.round(((idx+1)/selected.length)*65)}%`;
    if(lbl) lbl.textContent = `${idx+1}/${selected.length}: drafting ${targetTool} opportunity…`;
    try{
      const change = await buildNamedToolOpportunityChange_(c.entryIdx, c.slot, targetTool, enrichedInstruction);
      if(change) changes.push(change);
    }catch(err){
      failures.push({target:c, error:err.message || String(err)});
    }
    if(idx < selected.length-1) await sleep(350);
  }

  if(bar) bar.style.width = '100%';
  if(prog) prog.style.display = 'none';
  updateReasoningStep(4, 'done');
  updateReasoningStep(5, 'done');
  setTimeout(hideReasoningSteps, 1200);
  if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')) bulkChatHistory.pop();

  if(changes.length){
    const yearText = targetYears.length ? ` in ${targetYears.join(', ')}` : '';
    const cappedNote = allCandidates.length > selected.length ? `<br><span style="font-size:12px;color:var(--orange)">I found ${allCandidates.length} eligible ${targetTool} candidate unit${allCandidates.length!==1?'s':''}${yearText}, but drafted ${selected.length} this run to stay responsive. Apply these, then run again for the next set.</span>` : '';
    const failNote = failures.length ? `<br><span style="font-size:12px;color:#F5A623">${failures.length} draft${failures.length!==1?'s':''} failed and were skipped.</span>` : '';
    const sample = changes.slice(0,6).map(c => { const e = DATA[c.entryIdx]; const old = getSugs(e)[c.sugIdx] ? sugTool(getSugs(e)[c.sugIdx]) : 'existing suggestion'; return `• ${esc(e.yl)} ${esc(e.th)} — ${esc(old)} → ${esc(c.t)}`; }).join('<br>');
    bulkChatAddMessage('assistant', `✅ <strong>${changes.length} ${esc(targetTool)} opportunit${changes.length!==1?'ies':'y'}</strong> ready for review${yearText}.<br><br><span style="font-size:12px;color:var(--lime)">This targeted flow found eligible units locally first, so it should not stop at 2 when there are more genuine fits.</span>${cappedNote}${failNote}<br><br><span style="font-size:12px;color:var(--lime)">Sample:</span><br>${sample}${changes.length>6?'<br>• …':''}`);
    bulkChatMemory.push({ role:'assistant', content:`Proposed ${changes.length} named-tool opportunities for ${targetTool}.` });
    window._snapshotReason = `Before adding ${targetTool} opportunities`;
    showChangesPopup(changes);
    bulkChatState = 'done';
  } else {
    const first = failures[0]?.error || 'No usable drafts were returned.';
    bulkChatAddMessage('assistant', `⚠️ I found ${selected.length} ${esc(targetTool)} candidate unit${selected.length!==1?'s':''}, but could not draft usable ${esc(targetTool)} opportunities. First issue: ${esc(first)}`);
    bulkChatState = 'idle';
  }
  stopProgress();
  return true;
}

