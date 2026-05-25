function detectBulkPlatform(){}

async function runSurgeon(){
  const bannedEl = document.getElementById('surgeon-banned');
  const replacementEl = document.getElementById('surgeon-replacement');
  const statusEl = document.getElementById('surgeon-status');
  const btn = document.getElementById('btn-surgeon');

  const bannedTool = bannedEl?.value.trim();
  if(!bannedTool){ statusEl.textContent='⚠ Please enter a tool to remove'; statusEl.style.color='#f87171'; return; }

  const replacementTool = replacementEl?.value.trim();
  const payload = { action:'runSurgeon', bannedTool };
  if(replacementTool) payload.replacementTool = replacementTool;

  btn.disabled = true;
  statusEl.style.color = '#fbbf24';
  statusEl.textContent = 'Running…';
  startProgress();

  try{
    const r = await fetch(SCRIPT_URL, {
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: JSON.stringify(withGASToken(payload))
    });
    // no-cors means we can't read the response — assume success and reload
    statusEl.style.color = 'var(--lime)';
    statusEl.textContent = '✓ Surgeon running — reloading data in 10s…';
    setStatus('Surgeon sent — waiting for GAS to process');
    await new Promise(res=>setTimeout(res, 10000));
    await loadFromDrive();
  }catch(e){
    statusEl.style.color = '#f87171';
    statusEl.textContent = '✗ ' + e.message;
  }
  btn.disabled = false;
}

async function runBulkRegen(){
  const ca=document.getElementById('bulk-regen-campus')?.value||'';
  const yr=document.getElementById('bulk-regen-year')?.value||'';
  const targets=DATA.map((e,idx)=>({e,idx})).filter(({e})=>{
    if(ca&&e.ca!==ca) return false;
    if(yr&&e.yl!==yr) return false;
    return getSugs(e).filter(isRealSug).length>=6;
  });
  if(!targets.length){ setStatus('No entries match the selected filters','error'); return; }

  const confirmed=confirm(`Regenerate ${targets.length} entr${targets.length!==1?'ies':'y'}${ca?' for '+ca:''}${yr?' '+yr:''}?\n\nThis will replace their current suggestions using GPT-4.1. The change history will let you undo if needed.`);
  if(!confirmed) return;

  const btn=document.getElementById('btn-bulk-regen');
  const prog=document.getElementById('bulk-regen-progress');
  const bar=document.getElementById('bulk-regen-bar');
  const lbl=document.getElementById('bulk-regen-label');
  const res=document.getElementById('bulk-regen-result');
  if(!btn || !prog || !bar || !lbl || !res){ setStatus('Bulk regenerate panel is not available in this Studio view','error'); return; }
  btn.disabled=true; prog.style.display='block'; res.innerHTML='';
  let done=0, fixed=0, failed=0;

  for(const {e,idx} of targets){
    done++;
    bar.style.width=`${Math.round((done/targets.length)*100)}%`;
    lbl.textContent=`${done}/${targets.length}: ${e.yl} — ${e.th}`;
    const prompt=`Generate exactly 6 digital technology suggestions for this IB PYP unit at Wesley College (Microsoft school).
Campus: ${e.ca} | Year Level: ${e.yl} | Theme: "${e.th}"${e.ci?`\nCentral Idea: "${e.ci}"`:''}${e.plannerText?`\nPlanner context: ${e.plannerText}`:''}
All 6 suggestions MUST use DIFFERENT tools
Suggestion #6 MUST be a STEM Design Cycle activity (Empathise → Define → Ideate → Prototype → Test) that connects specifically to the unit theme \u2014 no duplicates.
${SUGGESTION_STYLE}
${appSmashRequirementForEntry_(e)}
Return ONLY a JSON array: [{"t":"Tool Name or Tool A + Tool B","d":"2-3 vivid sentences for this unit."},...]`;
    try{
      let sugs = null;
      let dupedTool = null;
      let lastSmashCount = 0;
      let lastDupOpener = '';
      let lastFailReason = '';
      for(let attempt=0; attempt<3; attempt++){
        let retryNote = '';
        if(attempt>0 && lastFailReason === 'dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response used "${dupedTool}" twice. Every one of the 6 suggestions MUST use a DIFFERENT tool. #6 must be a STEM Design Cycle activity.`;
        } else if(attempt>0 && lastFailReason === 'smash'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response had only ${lastSmashCount} App Smash${lastSmashCount===1?'':'es'} in slots 1-5. You MUST return at least 2 entries whose "t" field uses the "Tool A + Tool B" format.`;
        } else if(attempt>0 && lastFailReason === 'opener-dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response used "${lastDupOpener}" as the slot-1 App Smash, but another unit in this campus + year level already opens with that exact pair. Slot 1 MUST be a DIFFERENT App Smash pair that specifically suits THIS unit's theme.`;
        }
        const raw=await callAI([{role:'user',parts:[{text:prompt+retryNote}]}],null,OPENAI_MODEL);
        const clean=raw.replace(/```json|```/g,'').trim();
        const si=clean.indexOf('['),ei=clean.lastIndexOf(']');
        if(si===-1||ei===-1) throw new Error('No JSON');
        const parsed=JSON.parse(clean.slice(si,ei+1));
        const keys=parsed.map(s=>toolKey(sugTool(s))).filter(Boolean);
        const dup=keys.find((k,i)=>keys.indexOf(k)!==i);
        if(dup){ const dupSug=parsed.find(s=>toolKey(sugTool(s))===dup); dupedTool = dupSug ? sugTool(dupSug) : dup; lastFailReason='dup'; continue; }
        lastSmashCount = appSmashCountInRegen_(parsed);
        if(lastSmashCount < 2){ lastFailReason='smash'; continue; }
        const openerDup = openerDupesSiblingInYear_(e, parsed);
        if(openerDup){ lastDupOpener = openerDup; lastFailReason='opener-dup'; continue; }
        sugs = parsed;
        break;
      }
      if(!sugs) throw new Error(
        lastFailReason === 'smash' ? `Only ${lastSmashCount} App Smash${lastSmashCount===1?'':'es'} after 3 attempts`
        : lastFailReason === 'opener-dup' ? `Opener stayed identical to a sibling unit ("${lastDupOpener}") after 3 attempts`
        : 'Duplicates in batch after retry');
      recordChange(idx, getSugs(DATA[idx]), sugs);
      DATA[idx].s=sugs; DATA[idx].audited=true; fixed++;
      saveToDrive();
    }catch(err){ failed++; }
    if(done<targets.length) await sleep(2000);
  }
  lbl.textContent=`Done — ${fixed} regenerated, ${failed} failed`;
  btn.disabled=false;
  setStatus(`Bulk regen complete — ${fixed} entries updated`);
  renderDashboard();
}

function updateCompareThemes(){
  const yr=document.getElementById('compare-year')?.value||'';
  const sel=document.getElementById('compare-theme'); if(!sel) return;
  const themes=[...new Set(DATA.filter(e=>!yr||e.yl===yr).map(e=>e.th))].sort();
  while(sel.options.length>1) sel.remove(1);
  themes.forEach(t=>sel.add(new Option(t,t)));
  document.getElementById('comparison-grid').innerHTML='';
}

function renderComparison(){
  const theme=document.getElementById('compare-theme')?.value||'';
  const yr=document.getElementById('compare-year')?.value||'';
  const grid=document.getElementById('comparison-grid'); if(!grid) return;
  if(!theme){ grid.innerHTML=''; return; }

  const entries=DATA.map((e,idx)=>({e,idx})).filter(({e})=>e.th===theme&&(!yr||e.yl===yr));
  if(!entries.length){ grid.innerHTML='<div style="color:var(--dim);font-size:13px">No entries found for this theme.</div>'; return; }

  
  const byCampus={};
  entries.forEach(({e,idx})=>{ if(!byCampus[e.ca]) byCampus[e.ca]=[]; byCampus[e.ca].push({e,idx}); });
  const campuses=Object.keys(byCampus).sort();
  const palette={'Elsternwick':'#818cf8','Glen Waverley':'#34d399','St Kilda':'#fb923c','St Kilda Road':'#fb923c'};

  const container=document.createElement('div');
  container.style.cssText=`display:grid;grid-template-columns:repeat(${campuses.length},1fr);gap:12px;margin-top:14px`;

  campuses.forEach(ca=>{
    const col=palette[ca]||'var(--lime)';
    const col_div=document.createElement('div');
    col_div.innerHTML=`<div style="font-size:13px;font-weight:800;color:${col};margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid ${col}">${esc(ca)}</div>`;

    byCampus[ca].forEach(({e,idx})=>{
      const sugs=getSugs(e);
      const yl_tag=`<span style="font-size:11px;background:var(--card2);padding:2px 8px;border-radius:10px;color:var(--gold);font-weight:700;margin-bottom:8px;display:inline-block">${esc(e.yl)}</span>`;
      const sug_rows=sugs.length
        ?sugs.map(s=>`<div style="padding:8px 10px;background:var(--card2);border-radius:6px;margin-bottom:6px;border-left:2px solid ${col}">
            <div style="font-size:12px;font-weight:700;margin-bottom:2px">${esc(sugTool(s))}</div>
            <div style="font-size:11px;color:var(--dim);line-height:1.5">${esc(sugDesc(s).slice(0,100)+(sugDesc(s).length>100?'…':''))}</div>
          </div>`).join('')
        :'<div style="color:var(--dim);font-size:12px;font-style:italic">No suggestions yet</div>';

      const entry_div=document.createElement('div');
      entry_div.style.cssText='margin-bottom:14px;cursor:pointer';
      entry_div.innerHTML=yl_tag+sug_rows;
      entry_div.onclick=()=>openEntry(idx);
      col_div.appendChild(entry_div);
    });
    container.appendChild(col_div);
  });

  grid.innerHTML='';
  grid.appendChild(container);
}

document.addEventListener('keydown', function(e){
  
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  
  if(document.getElementById('changes-popup-overlay')) return;

  switch(e.key){
    case 'j': 
      navigateBrowseEntry(1); break;
    case 'k': 
      navigateBrowseEntry(-1); break;
    case 'b': 
      if(CURRENT_ENTRY_IDX!==null){ closeEntry(); } break;
    case 'u': 
      if(e.metaKey||e.ctrlKey){ e.preventDefault(); undoLastChange(); } break;
    case '1': switchTabByKey('dashboard'); break;
    case '2': switchTabByKey('browse'); break;
    case '3': switchTabByKey('audit'); break;
    case '4': switchTabByKey('tools'); break;
    case '5': switchTabByKey('live'); break;
    case '/': 
      e.preventDefault();
      const searchEl=document.getElementById('f-search');
      if(searchEl){ switchTabByKey('browse'); searchEl.focus(); }
      break;
    case '?': showKeyboardHelp(); break;
    case 'Escape':
      document.getElementById('changes-popup-overlay')?.remove();
      document.getElementById('history-overlay')?.remove();
      document.getElementById('keyboard-help-overlay')?.remove();
      break;
  }
});

function switchTabByKey(tab){
  const btn=document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if(btn) switchTab(tab, btn);
}

let BROWSE_ENTRY_CACHE=[];
function navigateBrowseEntry(dir){
  if(CURRENT_ENTRY_IDX!==null){
    
    const newIdx=CURRENT_ENTRY_IDX+dir;
    if(newIdx>=0&&newIdx<DATA.length) openEntry(newIdx);
    return;
  }
  
  const rows=document.querySelectorAll('#browse-list .row');
  if(!rows.length) return;
  
  const cur=[...rows].findIndex(r=>r.classList.contains('kb-focus'));
  const next=cur===-1?0:Math.max(0,Math.min(rows.length-1,cur+dir));
  rows.forEach(r=>r.classList.remove('kb-focus'));
  rows[next].classList.add('kb-focus');
  rows[next].scrollIntoView({block:'nearest',behavior:'smooth'});
}

function showKeyboardHelp(){
  const existing=document.getElementById('keyboard-help-overlay');
  if(existing){ existing.remove(); return; }
  const overlay=document.createElement('div');
  overlay.id='keyboard-help-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:1000;display:flex;align-items:center;justify-content:center';
  overlay.onclick=e=>{ if(e.target===overlay) overlay.remove(); };
  const shortcuts=[
    ['j / k','Navigate entries in Browse'],
    ['b','Back from entry detail'],
    ['Ctrl/Cmd + U','Undo last change'],
    ['1–5','Switch tabs (Dashboard, Browse, Audit, Bulk Tools, Analytics)'],
    ['/','Focus search in Browse'],
    ['Escape','Close any open panel'],
    ['?','Show this help'],
  ];
  overlay.innerHTML=`<div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:480px;width:100%">
    <div style="display:flex;align-items:center;margin-bottom:18px">
      <span style="font-size:18px;font-weight:900">Keyboard Shortcuts</span>
      <button onclick="document.getElementById('keyboard-help-overlay').remove()" style="margin-left:auto;background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:18px">✕</button>
    </div>
    ${shortcuts.map(([key,desc])=>`<div style="display:flex;align-items:center;gap:14px;padding:8px 0;border-bottom:1px solid var(--border)">
      <kbd style="background:var(--card2);border:1px solid var(--border);border-radius:5px;padding:3px 10px;font-size:12px;font-weight:700;font-family:monospace;white-space:nowrap">${key}</kbd>
      <span style="font-size:13px;color:var(--dim)">${desc}</span>
    </div>`).join('')}
    <div style="margin-top:14px;font-size:12px;color:var(--dim)">Press <kbd style="background:var(--card2);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:11px">?</kbd> anytime to show this</div>
  </div>`;
  document.body.appendChild(overlay);
}

function renderCoverageHeatmap(){
  const el=document.getElementById('coverage-heatmap'); if(!el) return;
  const campuses=[...new Set(DATA.map(e=>e.ca))].sort();
  const palette={'Elsternwick':'#818cf8','Glen Waverley':'#34d399','St Kilda':'#fb923c','St Kilda Road':'#fb923c'};

  let html=`<table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr><th style="padding:8px 12px;text-align:left;border-bottom:1.5px solid var(--border);font-weight:700">Year Level</th>`;
  campuses.forEach(ca=>{
    html+=`<th style="padding:8px 12px;text-align:center;border-bottom:1.5px solid var(--border);color:${palette[ca]||'var(--lime)'};font-weight:700">${esc(ca)}</th>`;
  });
  html+='</tr></thead><tbody>';

  YR.forEach(yr=>{
    html+=`<tr><td style="padding:8px 12px;font-weight:700;border-bottom:1px solid var(--border)">${yr}</td>`;
    campuses.forEach(ca=>{
      const entries=DATA.filter(e=>e.ca===ca&&e.yl===yr);
      if(!entries.length){
        html+=`<td style="padding:8px 12px;text-align:center;border-bottom:1px solid var(--border);color:var(--dim)">—</td>`;
        return;
      }
      const complete=entries.filter(e=>getSugs(e).filter(isRealSug).length>=6).length;
      const total=entries.length;
      const pct=Math.round((complete/total)*100);
      const bg=pct===100?'rgba(197,232,74,0.2)':pct>=50?'rgba(245,166,35,0.2)':'rgba(255,128,128,0.2)';
      const col=pct===100?'var(--lime)':pct>=50?'#fbbf24':'#FF8080';
      html+=`<td style="padding:8px 12px;text-align:center;border-bottom:1px solid var(--border);background:${bg};cursor:pointer"
        onclick="jumpToBrowseGroup('${esc(ca)}','${esc(yr)}')"
        title="${complete}/${total} complete">
        <span style="font-size:14px;font-weight:800;color:${col}">${pct}%</span>
        <span style="font-size:11px;color:var(--dim);display:block">${complete}/${total}</span>
      </td>`;
    });
    html+='</tr>';
  });
  html+='</tbody></table>';
  el.innerHTML=html;
}

function jumpToBrowseGroup(ca, yr){
  switchTabByKey('browse');
  const caEl=document.getElementById('f-campus');
  const yrEl=document.getElementById('f-year');
  if(caEl) caEl.value=ca;
  if(yrEl) yrEl.value=yr;
  renderBrowse();
}

function exportHTML(){
  const ca=document.getElementById('export-campus')?.value||'';
  const yr=document.getElementById('export-year')?.value||'';
  const entries=DATA.filter(e=>(!ca||e.ca===ca)&&(!yr||e.yl===yr));
  if(!entries.length){ alert('No entries match the selected filters'); return; }

  const title=`DLA Suggestions — ${ca||'All Campuses'} ${yr||'All Year Levels'}`;
  const campusCols={'Elsternwick':'#818cf8','Glen Waverley':'#34d399','St Kilda':'#fb923c','St Kilda Road':'#fb923c'};

  let html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:40px 20px;color:#1a1a1a;line-height:1.6}h1{font-size:28px;font-weight:900;margin-bottom:4px}.meta{font-size:14px;color:#666;margin-bottom:40px}.entry{margin-bottom:32px;page-break-inside:avoid}.entry-header{padding:14px 18px;border-radius:8px;margin-bottom:12px}.entry-title{font-size:18px;font-weight:800;margin-bottom:2px}.entry-meta{font-size:12px;opacity:.7}.sug{padding:10px 14px;background:#f8f8f8;border-radius:6px;margin-bottom:8px;border-left:3px solid #ddd}.sug-tool{font-size:14px;font-weight:700;margin-bottom:2px}.sug-desc{font-size:13px;color:#555}@media print{.entry{page-break-inside:avoid}}@media (max-width:768px){#sidebar{width:100% !important;height:auto !important;top:auto !important;bottom:0 !important;left:0 !important;right:0 !important;flex-direction:row !important;padding:0 !important;border-right:none !important;border-top:1px solid var(--border) !important;z-index:200 !important;overflow-x:auto;overflow-y:hidden;}body.app-mode #main{margin-left:0 !important;margin-bottom:64px;}body.app-mode #sidebar{display:flex !important;}#logo{display:none !important;}#sidebar-footer{display:none !important;}.nav-item{flex-direction:column !important;gap:2px !important;padding:8px 12px !important;font-size:10px !important;border-radius:0 !important;margin-bottom:0 !important;min-width:60px;text-align:center;white-space:nowrap;flex:1;justify-content:center;}.nav-item span{font-size:18px;}.nav-item.active{background:rgba(212,160,23,0.15) !important;border-bottom:2px solid var(--gold) !important;}#app-content{padding:16px !important;}.page-title{font-size:24px !important;}.page-sub{font-size:13px !important;}.stat-grid{grid-template-columns:repeat(2,1fr) !important;}.card{padding:16px !important;border-radius:12px !important;}.sug-tool{font-size:15px !important;}.sug-desc{font-size:13px !important;}#panel-browse>div:first-child{flex-direction:column !important;}#f-campus,#f-year,#f-tool,#f-search{width:100% !important;min-width:unset !important;}.row{padding:12px 14px !important;flex-wrap:wrap;}#chat-messages{height:260px !important;}#bulk-chat-messages{height:260px !important;}.chat-bubble{font-size:12px !important;max-width:92% !important;}#comparison-grid>div{grid-template-columns:1fr !important;}#coverage-heatmap,#live-heatmap{overflow-x:auto;}#live-overview-grid{grid-template-columns:repeat(2,1fr) !important;}div[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr !important;}#changes-popup-overlay>div{max-width:100% !important;max-height:90vh !important;border-radius:16px 16px 0 0 !important;position:fixed !important;bottom:0 !important;left:0 !important;right:0 !important;}#history-overlay{left:0 !important;right:0 !important;bottom:70px !important;width:auto !important;}#screen-setup{flex-direction:column !important;}.setup-sidebar{width:100% !important;flex-direction:row !important;align-items:center;padding:12px 20px !important;height:56px;}.dla-wordmark{font-size:20px !important;margin-bottom:0 !important;margin-right:auto;}.setup-nav-item{display:none !important;}.setup-center{flex:none !important;width:100% !important;padding:24px 20px !important;}.setup-right{display:none !important;}#undo-bar{bottom:74px !important;left:8px !important;right:8px !important;flex-wrap:wrap;}#bulk-regen-campus,#bulk-regen-year,#compare-year,#compare-theme,#export-campus,#export-year{width:100% !important;}.back-btn{margin-bottom:14px !important;}#conflict-bar{font-size:12px !important;padding:8px 14px !important;}#status-bar{font-size:11px !important;}.sug-chat-window{border-radius:0 0 10px 10px;}#changes-popup-overlay{align-items:flex-end !important;padding:0 !important;}}@media (max-width:480px){.stat-grid{grid-template-columns:repeat(2,1fr) !important;}.stat-num{font-size:28px !important;}.page-title{font-size:22px !important;}#app-content{padding:12px !important;}}</style></head><body>
  <h1>${title}</h1>
  <div class="meta">Generated ${new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})} · ${entries.length} entries</div>`;

  entries.forEach(e=>{
    const sugs=getSugs(e);
    const col=campusCols[e.ca]||'#666';
    html+=`<div class="entry">
      <div class="entry-header" style="background:${col}18;border-left:4px solid ${col}">
        <div class="entry-title">${esc(e.th)}</div>
        <div class="entry-meta">${esc(e.ca)} · ${esc(e.yl)}${e.ci?` · ${esc(e.ci)}`:''}</div>
      </div>`;
    if(sugs.length){
      sugs.forEach((s,i)=>{
        html+=`<div class="sug" style="border-left-color:${col}">
          <div class="sug-tool">${i+1}. ${esc(sugTool(s))}</div>
          <div class="sug-desc">${linkifyLight(sugDesc(s))}</div>
        </div>`;
      });
    } else {
      html+=`<div class="sug"><div class="sug-desc" style="color:#999;font-style:italic">No suggestions yet</div></div>`;
    }
    html+='</div>';
  });
  html+='</body></html>';

  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`DLA-${(ca||'All').replace(/\s/g,'-')}-${(yr||'All').replace(/\s/g,'-')}.html`;
  a.click(); URL.revokeObjectURL(url);
}

function exportCSV(){
  const ca=document.getElementById('export-campus')?.value||'';
  const yr=document.getElementById('export-year')?.value||'';
  const entries=DATA.filter(e=>(!ca||e.ca===ca)&&(!yr||e.yl===yr));
  if(!entries.length){ alert('No entries match'); return; }

  const rows=[['Campus','Year Level','Theme','Central Idea','Suggestion #','Tool','Description']];
  entries.forEach(e=>{
    const sugs=getSugs(e);
    if(sugs.length){
      sugs.forEach((s,i)=>rows.push([e.ca,e.yl,e.th,e.ci||'',i+1,sugTool(s),sugDesc(s)]));
    } else {
      rows.push([e.ca,e.yl,e.th,e.ci||'','','','']);
    }
  });

  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`DLA-${(ca||'All').replace(/\s/g,'-')}-${(yr||'All').replace(/\s/g,'-')}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function clearSession(){
  if(!confirm('Clear session and return to the load screen?\n\nYour Drive data is safe — this just clears the local cache.')) return;
  localStorage.removeItem('dla_data');
  localStorage.removeItem('dla_file_id');
  localStorage.removeItem('dla_user_email');
  DATA=[];
  DRIVE_FILE_ID=null;
  DRIVE_TOKEN=null;
  LAST_KNOWN_MODIFIED=null;
  if(CONFLICT_POLL_INTERVAL){ clearInterval(CONFLICT_POLL_INTERVAL); CONFLICT_POLL_INTERVAL=null; }
  document.body.classList.remove('app-mode');
  document.getElementById('app-content').style.display='none';
  showScreen('load');
}

const LOCK_TTL = 5 * 60 * 1000; 
let LOCK_HEARTBEAT = null;
let MY_LOCK_IDX = null;
const MY_USER = 'User-' + Math.random().toString(36).slice(2,6).toUpperCase();

function getLocks(){
  
  return DATA._locks || {};
}

function isLocked(idx){
  const locks = getLocks();
  const lock = locks[String(idx)];
  if(!lock) return null;
  
  if(Date.now() - lock.ts > LOCK_TTL) return null;
  return lock;
}

function isLockedByMe(idx){
  const lock = isLocked(idx);
  return lock && lock.user === MY_USER;
}

async function acquireLock(idx){
  if(isLockedByMe(idx)) return true; 
  const existing = isLocked(idx);
  if(existing){
    return confirm(`⚠ ${existing.user} is currently editing "${DATA[idx]?.th}"\n\nOpen it anyway? Their unsaved changes may be overwritten.`);
  }
  
  if(!DATA._locks) DATA._locks = {};
  DATA._locks[String(idx)] = { user: MY_USER, ts: Date.now() };
  MY_LOCK_IDX = idx;
  await saveLocks();
  startLockHeartbeat(idx);
  return true;
}

async function releaseLock(idx){
  if(!DATA._locks) return;
  delete DATA._locks[String(idx)];
  MY_LOCK_IDX = null;
  stopLockHeartbeat();
  await saveLocks();
  renderLockIndicators();
}

async function saveLocks(){
  if(!DRIVE_FILE_ID || !DRIVE_TOKEN) return;
  try{
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${DRIVE_FILE_ID}?uploadType=media`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+DRIVE_TOKEN},
      body: JSON.stringify(DATA, null, 2)
    });
  }catch{}
}

function startLockHeartbeat(idx){
  stopLockHeartbeat();
  
  LOCK_HEARTBEAT = setInterval(async()=>{
    if(!DATA._locks) DATA._locks = {};
    DATA._locks[String(idx)] = { user: MY_USER, ts: Date.now() };
    await saveLocks();
  }, 2 * 60 * 1000);
  
  window.addEventListener('beforeunload', ()=>{ releaseLock(idx); });
}

function stopLockHeartbeat(){
  if(LOCK_HEARTBEAT){ clearInterval(LOCK_HEARTBEAT); LOCK_HEARTBEAT = null; }
}

function renderLockIndicators(){
  
  document.querySelectorAll('[data-entry-idx]').forEach(el=>{
    const idx = parseInt(el.dataset.entryIdx);
    const lock = isLocked(idx);
    const badge = el.querySelector('.lock-badge');
    if(lock && !isLockedByMe(idx)){
      if(badge) badge.textContent = '🔒 '+lock.user;
      else {
        const b = document.createElement('span');
        b.className = 'lock-badge';
        b.style.cssText = 'font-size:10px;color:#fbbf24;font-weight:700;margin-left:6px';
        b.textContent = '🔒 '+lock.user;
        el.appendChild(b);
      }
    } else if(badge){
      badge.remove();
    }
  });
}

setInterval(async()=>{
  if(!DRIVE_FILE_ID || !DRIVE_TOKEN || document.hidden) return;
  try{
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media`,{
      headers:{'Authorization':'Bearer '+DRIVE_TOKEN}
    });
    const fresh = await r.json();
    if(fresh._locks){
      DATA._locks = fresh._locks;
      renderLockIndicators();
    }
  }catch{}
}, 30000);

(function init(){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('app-content').style.display='none';
  initNetworkCanvas();
  try{
    const cached=localStorage.getItem('dla_data');
    const cachedFileId=localStorage.getItem('dla_file_id');
    if(cached){
      const arr=JSON.parse(cached);
      if(Array.isArray(arr)&&arr.length>0){
        if(cachedFileId) DRIVE_FILE_ID=cachedFileId;
        ingest(arr, true);
        // Wait for GSI library to load before attempting silent re-auth
        const waitForGSI = (resolve) => {
          if(window.google && window.google.accounts) resolve();
          else setTimeout(()=>waitForGSI(resolve), 200);
        };
        new Promise(waitForGSI).then(()=>getDriveToken()).then(tok=>{
          DRIVE_TOKEN=tok;
          getDriveFileModified().then(meta=>{ if(meta) LAST_KNOWN_MODIFIED=meta.modifiedTime; });
          ensureLibrariesLoaded().catch(e => console.warn('Libraries preload failed:', e));
          startConflictPolling();
          setStatus('Session restored — connected to Drive');
        }).catch(()=>{ setStatus('Session restored — <span onclick="reconnectDrive()" style="text-decoration:underline;cursor:pointer;font-weight:700">click here to reconnect Drive</span> to save changes','error',true); });
        return;
      }
    }
  }catch(e){}

  showScreen('load');
  document.getElementById('chat-input')?.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); }
  });
})();


/* =========================================================
   DLA Studio Patch — Tool Inventory click + alias hardening
   Fixes remove X/add buttons and treats equivalent names as one tool.
   ========================================================= */
(function(){
  const PATCH_ID = 'inventory-click-alias-hardening-v2';
  if(window.__DLA_INVENTORY_PATCH_ID === PATCH_ID) return;
  window.__DLA_INVENTORY_PATCH_ID = PATCH_ID;

  const MICROSOFT_ALIAS_DISPLAY = {
    'sway': 'Microsoft Sway',
    'forms': 'Microsoft Forms',
    'excel': 'Microsoft Excel',
    'word': 'Microsoft Word',
    'powerpoint': 'Microsoft PowerPoint',
    'power point': 'Microsoft PowerPoint',
    'teams': 'Microsoft Teams',
    'onenote': 'Microsoft OneNote',
    'one note': 'Microsoft OneNote',
    'wise discussion chatbots': 'Wise Discussion Chatbots',
    'wise discussion chatbot': 'Wise Discussion Chatbots',
    'wise chatbot': 'Wise Discussion Chatbots',
    'wise chatbots': 'Wise Discussion Chatbots',
    'schoolbox discussion chatbots': 'Wise Discussion Chatbots',
    'schoolbox ai discussion chatbots': 'Wise Discussion Chatbots',
    'ai discussion chatbots': 'Wise Discussion Chatbots',
    'ai discussion chatbot': 'Wise Discussion Chatbots'
  };

  function invNormText(value){
    return String(value || '')
      .toLowerCase()
      .replace(/&amp;/g, ' and ')
      .replace(/\b(microsoft|ms|office|m365|microsoft 365)\b/g, '')
      .replace(/[^a-z0-9:+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function invCanonicalDisplay(value){
    const raw = String(value || '').trim();
    if(!raw) return '';
    const stripped = invNormText(raw);
    if(MICROSOFT_ALIAS_DISPLAY[stripped]) return MICROSOFT_ALIAS_DISPLAY[stripped];
    try {
      const normalised = normaliseToolName(raw);
      const strippedNormalised = invNormText(normalised);
      if(MICROSOFT_ALIAS_DISPLAY[strippedNormalised]) return MICROSOFT_ALIAS_DISPLAY[strippedNormalised];
      return String(normalised || raw).trim();
    } catch(e){ return raw; }
  }

  function invCanonicalKey(value){
    const display = invCanonicalDisplay(value);
    return invNormText(display || value);
  }

  try {
    toolInventoryKey = function patchedToolInventoryKey(tool){ return invCanonicalKey(tool); };
    window.toolInventoryKey = toolInventoryKey;
  } catch(e){ window.toolInventoryKey = invCanonicalKey; }

  function invAttr(value){
    return String(value || '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function invEnsureShape(){
    if(!TOOL_INVENTORY || typeof TOOL_INVENTORY !== 'object') TOOL_INVENTORY = { approved: [], banned: [], ageRanges: {} };
    if(!Array.isArray(TOOL_INVENTORY.approved)) TOOL_INVENTORY.approved = [];
    if(!Array.isArray(TOOL_INVENTORY.banned)) TOOL_INVENTORY.banned = [];
    if(!TOOL_INVENTORY.ageRanges || typeof TOOL_INVENTORY.ageRanges !== 'object') TOOL_INVENTORY.ageRanges = {};
  }

  function invDedupe(list){
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach(item => {
      const display = invCanonicalDisplay(item);
      const key = invCanonicalKey(display);
      if(!display || !key || seen.has(key)) return;
      seen.add(key);
      out.push(display);
    });
    return out.sort((a,b)=>a.localeCompare(b));
  }

  function invCleanup(preferList){
    invEnsureShape();
    TOOL_INVENTORY.approved = invDedupe(TOOL_INVENTORY.approved);
    TOOL_INVENTORY.banned = invDedupe(TOOL_INVENTORY.banned);
    const approvedKeys = new Set(TOOL_INVENTORY.approved.map(invCanonicalKey));
    const bannedKeys = new Set(TOOL_INVENTORY.banned.map(invCanonicalKey));
    if(preferList === 'approved'){
      TOOL_INVENTORY.banned = TOOL_INVENTORY.banned.filter(t => !approvedKeys.has(invCanonicalKey(t)));
    } else {
      TOOL_INVENTORY.approved = TOOL_INVENTORY.approved.filter(t => !bannedKeys.has(invCanonicalKey(t)));
      bannedKeys.forEach(k => { delete TOOL_INVENTORY.ageRanges[k]; });
    }
    const nextRanges = {};
    Object.entries(TOOL_INVENTORY.ageRanges || {}).forEach(([tool, range]) => {
      const key = invCanonicalKey(tool);
      if(!key) return;
      try { nextRanges[key] = normaliseAgeRange(range); }
      catch(e){ nextRanges[key] = range; }
    });
    TOOL_INVENTORY.ageRanges = nextRanges;
  }

  function invPersist(){
    try {
      if(typeof saveLibraries === 'function'){
        const result = saveLibraries();
        if(result && typeof result.catch === 'function') result.catch(e => setStatus(`Tool inventory save failed: ${e.message}`, 'error'));
      }
    } catch(e){
      console.warn('[DLA Inventory Patch] saveLibraries failed', e);
      if(typeof setStatus === 'function') setStatus(`Tool inventory save failed: ${e.message}`, 'error');
    }
  }

  invAddTool = function patchedInvAddTool(listKey){
    const safeList = listKey === 'banned' ? 'banned' : 'approved';
    const inputId = safeList === 'approved' ? 'inv-whitelist-input' : 'inv-banned-input';
    const input = document.getElementById(inputId);
    if(!input) return false;
    const raw = String(input.value || '').trim();
    if(!raw) return false;
    invEnsureShape();
    const display = invCanonicalDisplay(raw);
    const key = invCanonicalKey(display);
    if(!display || !key) return false;
    const sameList = TOOL_INVENTORY[safeList].some(t => invCanonicalKey(t) === key);
    if(sameList){
      input.value = '';
      if(typeof setStatus === 'function') setStatus(`"${display}" is already in the ${safeList === 'approved' ? 'whitelist' : 'banned list'}`, 'error');
      if(typeof renderToolInventory === 'function') renderToolInventory();
      return false;
    }
    if(safeList === 'banned'){
      TOOL_INVENTORY.approved = TOOL_INVENTORY.approved.filter(t => invCanonicalKey(t) !== key);
      delete TOOL_INVENTORY.ageRanges[key];
    } else {
      TOOL_INVENTORY.banned = TOOL_INVENTORY.banned.filter(t => invCanonicalKey(t) !== key);
      const minEl = document.getElementById('inv-whitelist-min');
      const maxEl = document.getElementById('inv-whitelist-max');
      try { TOOL_INVENTORY.ageRanges[key] = normaliseAgeRange({ min: minEl?.value ?? 0, max: maxEl?.value ?? 6 }); }
      catch(e){ TOOL_INVENTORY.ageRanges[key] = { min: 0, max: 6 }; }
    }
    TOOL_INVENTORY[safeList].push(display);
    invCleanup(safeList);
    input.value = '';
    renderToolInventory();
    invPersist();
    if(typeof setStatus === 'function') setStatus(`Added "${display}" to ${safeList === 'approved' ? 'whitelist' : 'banned list'}`);
    return false;
  };
  window.invAddTool = invAddTool;

  invRemoveTool = function patchedInvRemoveTool(listKey, tool){
    const safeList = listKey === 'banned' ? 'banned' : 'approved';
    invEnsureShape();
    const key = invCanonicalKey(tool);
    const before = TOOL_INVENTORY[safeList].length;
    TOOL_INVENTORY[safeList] = TOOL_INVENTORY[safeList].filter(t => invCanonicalKey(t) !== key);
    if(safeList === 'approved') delete TOOL_INVENTORY.ageRanges[key];
    invCleanup('banned');
    renderToolInventory();
    invPersist();
    const removed = before - TOOL_INVENTORY[safeList].length;
    if(typeof setStatus === 'function') setStatus(removed ? `Removed "${invCanonicalDisplay(tool) || tool}" from ${safeList === 'approved' ? 'whitelist' : 'banned list'}` : `"${tool}" was already removed`);
    return false;
  };
  window.invRemoveTool = invRemoveTool;

  invUpdateToolAge = function patchedInvUpdateToolAge(tool, edge, value){
    invEnsureShape();
    const display = invCanonicalDisplay(tool);
    const key = invCanonicalKey(display);
    const current = (typeof getToolAgeRange === 'function') ? getToolAgeRange(display) : {min:0,max:6};
    let next = { min: current.min, max: current.max };
    if(edge === 'min') next.min = clampYearLevelValue(value);
    if(edge === 'max') next.max = clampYearLevelValue(value);
    if(next.min > next.max){ if(edge === 'min') next.max = next.min; if(edge === 'max') next.min = next.max; }
    TOOL_INVENTORY.ageRanges[key] = next;
    renderToolInventory();
    invPersist();
    if(typeof setStatus === 'function') setStatus(`Updated ${display} age range to ${ageRangeLabel(next)}`);
    return false;
  };
  window.invUpdateToolAge = invUpdateToolAge;

  renderToolInventory = function patchedRenderToolInventory(){
    const whitelistEl = document.getElementById('inv-whitelist-pills');
    const bannedEl = document.getElementById('inv-banned-pills');
    const whCountEl = document.getElementById('inv-whitelist-count');
    const banCountEl = document.getElementById('inv-banned-count');
    const totalEl = document.getElementById('inv-count');
    if(!whitelistEl || !bannedEl) return;
    invCleanup('banned');
    const approved = TOOL_INVENTORY.approved || [];
    const banned = TOOL_INVENTORY.banned || [];
    if(whCountEl) whCountEl.textContent = approved.length ? `(${approved.length})` : '';
    if(banCountEl) banCountEl.textContent = banned.length ? `(${banned.length})` : '';
    if(totalEl) totalEl.textContent = (approved.length || banned.length) ? `${approved.length + banned.length} entries` : '';
    whitelistEl.innerHTML = approved.length ? approved.map(t => {
      const range = (typeof getToolAgeRange === 'function') ? getToolAgeRange(t) : {min:0,max:6};
      const toolAttr = invAttr(t);
      return `<div style="display:grid;grid-template-columns:minmax(150px,1fr) 105px 105px auto;gap:6px;align-items:center;padding:7px 8px;background:rgba(197,232,74,0.08);border:1px solid rgba(197,232,74,0.3);border-radius:12px;font-size:12px;color:var(--lime)">
        <div style="min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t)}</div><div style="font-size:10px;color:var(--dim);font-weight:600">${ageRangeLabel(range)}</div></div>
        <select class="inp" data-inv-age-tool="${toolAttr}" data-inv-age-edge="min" title="Minimum year level" style="margin-bottom:0;font-size:11px;padding:5px 7px;color:var(--lime);border-color:rgba(197,232,74,.3)">${yearSelectOptions(range.min)}</select>
        <select class="inp" data-inv-age-tool="${toolAttr}" data-inv-age-edge="max" title="Maximum year level" style="margin-bottom:0;font-size:11px;padding:5px 7px;color:var(--lime);border-color:rgba(197,232,74,.3)">${yearSelectOptions(range.max)}</select>
        <button type="button" data-inv-remove="approved" data-inv-tool="${toolAttr}" style="background:transparent;border:none;color:var(--lime);cursor:pointer;padding:0 6px;font-size:18px;line-height:1;opacity:.8" title="Remove">×</button>
      </div>`;
    }).join('') : '<span style="font-size:11px;color:var(--dim);font-style:italic">No whitelist — all approved tools allowed.</span>';
    bannedEl.innerHTML = banned.length ? banned.map(t => `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 4px 4px 10px;background:rgba(255,128,128,0.08);border:1px solid rgba(255,128,128,0.3);border-radius:99px;font-size:12px;font-weight:600;color:#FF8080">${esc(t)}<button type="button" data-inv-remove="banned" data-inv-tool="${invAttr(t)}" style="background:transparent;border:none;color:#FF8080;cursor:pointer;padding:0 6px;font-size:14px;line-height:1;opacity:.7" title="Remove">×</button></span>`).join('') : '<span style="font-size:11px;color:var(--dim);font-style:italic">No bans.</span>';
  };
  window.renderToolInventory = renderToolInventory;

  if(!window.__DLA_INVENTORY_DELEGATED_EVENTS){
    window.__DLA_INVENTORY_DELEGATED_EVENTS = true;
    document.addEventListener('click', function(e){
      const removeBtn = e.target && e.target.closest ? e.target.closest('[data-inv-remove]') : null;
      if(removeBtn){
        e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation();
        invRemoveTool(removeBtn.getAttribute('data-inv-remove'), removeBtn.getAttribute('data-inv-tool'));
        return false;
      }
      const addBtn = e.target && e.target.closest ? e.target.closest('[data-inv-add],#inv-whitelist-add,#inv-banned-add') : null;
      if(addBtn){
        e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation();
        const listKey = addBtn.getAttribute('data-inv-add') || (addBtn.id === 'inv-banned-add' ? 'banned' : 'approved');
        invAddTool(listKey);
        return false;
      }
    }, true);
    document.addEventListener('keydown', function(e){
      if(e.key !== 'Enter') return;
      if(e.target && e.target.id === 'inv-whitelist-input'){ e.preventDefault(); e.stopPropagation(); invAddTool('approved'); }
      if(e.target && e.target.id === 'inv-banned-input'){ e.preventDefault(); e.stopPropagation(); invAddTool('banned'); }
    }, true);
    document.addEventListener('change', function(e){
      const sel = e.target && e.target.matches && e.target.matches('[data-inv-age-tool][data-inv-age-edge]') ? e.target : null;
      if(!sel) return;
      e.preventDefault(); e.stopPropagation();
      invUpdateToolAge(sel.getAttribute('data-inv-age-tool'), sel.getAttribute('data-inv-age-edge'), sel.value);
    }, true);
  }
  setTimeout(() => { try { if(document.getElementById('inv-whitelist-pills') && document.getElementById('inv-banned-pills')) renderToolInventory(); } catch(e){ console.warn('[DLA Inventory Patch] initial render failed', e); } }, 0);
  console.log('[DLA PATCH] Tool Inventory click + alias hardening installed');
})();

/* ===== DLA hotfix: audit section consistency patch =====
   Makes counts, drilldowns, campus view and year view use the same tool-indexing logic.
   Fixes the Lego Spike Prime issue where the headline count excluded STEM slot #6 but the drilldown included it. */
(function(){
  var AUDIT_INCLUDE_STEM_LOCAL = false;

  function auditIsStemSlot_(slotIdx){ return Number(slotIdx) === 5; }
  function auditIsAuditedEntry_(entry){ return !!entry && entry.audited !== false; }
  function auditRawTool_(suggestion){
    var t = (typeof sugTool === 'function') ? sugTool(suggestion) : (suggestion && suggestion.t);
    t = String(t || '').trim();
    return t && t !== 'TBA' ? t : '';
  }
  function auditToolParts_(raw){
    var text = String(raw || '').trim();
    if(!text || text === 'TBA') return [];

    var parts = [];
    var appSmashParen = text.match(/^(.+?)\s*\(\s*App\s*Smash\s+with\s+(.+?)\s*\)/i);
    var appSmashPlus = text.match(/^(.+?)\s*[+]\s*(.+?)\s+App\s*Smash/i);
    if(appSmashParen){
      parts = [appSmashParen[1].trim(), appSmashParen[2].trim()];
    } else if(appSmashPlus){
      parts = [appSmashPlus[1].trim(), appSmashPlus[2].trim()];
    } else if(/[&+]/.test(text)){
      parts = text.split(/\s*[&+]\s*/).map(function(t){ return t.trim(); }).filter(Boolean);
    } else {
      // Normalise the whole tool first. This catches lesson-specific names such as
      // "Minecraft: Area and Volume" -> "Minecraft Education" without splitting titles.
      parts = [text];
    }

    var seen = new Set();
    return parts.map(function(t){ return normaliseToolName(t).trim(); }).filter(Boolean).filter(function(t){
      var key = toolKey(t);
      if(!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function auditRows_(entries, includeStem){
    var rows = [];
    (entries || DATA || []).forEach(function(entry, sourceIdx){
      if(!auditIsAuditedEntry_(entry)) return;
      var dataIdx = (DATA || []).indexOf(entry);
      var entryIdx = dataIdx >= 0 ? dataIdx : sourceIdx;
      getSugs(entry).forEach(function(suggestion, slotIdx){
        if(!includeStem && auditIsStemSlot_(slotIdx)) return;
        var raw = auditRawTool_(suggestion);
        if(!raw) return;
        auditToolParts_(raw).forEach(function(tool){
          rows.push({
            entry: entry,
            entryIdx: entryIdx,
            slotIdx: slotIdx,
            rawTool: raw,
            tool: tool,
            key: toolKey(tool),
            desc: sugDesc(suggestion)
          });
        });
      });
    });
    return rows;
  }

  computeStats = window.computeStats = function(options){
    options = options || {};
    var includeStem = !!options.includeStem;
    var entries = Array.isArray(options.entries) ? options.entries : DATA;
    var toolCounts = Object.create(null);
    var campusTools = Object.create(null);
    var yearTools = Object.create(null);
    var toolRows = Object.create(null);
    var total = 0;
    var coreSuggestionTotal = 0;
    var stemSuggestionTotal = 0;

    (entries || []).forEach(function(entry){
      if(!auditIsAuditedEntry_(entry)) return;
      getSugs(entry).forEach(function(suggestion, slotIdx){
        if(!auditRawTool_(suggestion)) return;
        if(auditIsStemSlot_(slotIdx)) stemSuggestionTotal++;
        else coreSuggestionTotal++;
      });
    });

    auditRows_(entries, includeStem).forEach(function(row){
      var tool = row.tool;
      var campus = normCa(row.entry.ca);
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      if(!campusTools[campus]) campusTools[campus] = Object.create(null);
      campusTools[campus][tool] = (campusTools[campus][tool] || 0) + 1;
      if(!yearTools[row.entry.yl]) yearTools[row.entry.yl] = Object.create(null);
      yearTools[row.entry.yl][tool] = (yearTools[row.entry.yl][tool] || 0) + 1;
      if(!toolRows[tool]) toolRows[tool] = [];
      toolRows[tool].push(row);
      total++;
    });

    var incompleteEntries = (DATA || []).filter(function(entry){
      return entry.audited === false || getSugs(entry).length < 6 || getSugs(entry).some(function(s){ return !s || !s.t || !String(s.t).trim() || String(s.t).trim() === 'TBA'; });
    });
    var sorted = Object.entries(toolCounts)
      .sort(function(a,b){ return b[1] - a[1] || a[0].localeCompare(b[0]); })
      .map(function(pair){ return { name: pair[0], count: pair[1], pct: total ? Math.round(pair[1] / total * 100) : 0 }; });

    return { sorted: sorted, campusTools: campusTools, yearTools: yearTools, total: total, incompleteCount: incompleteEntries.length, toolRows: toolRows, includeStem: includeStem, coreSuggestionTotal: coreSuggestionTotal, stemSuggestionTotal: stemSuggestionTotal };
  };

  window.setAuditStemScope = function(includeStem){
    AUDIT_INCLUDE_STEM_LOCAL = !!includeStem;
    renderAuditChart();
  };

  function auditScopeHtml_(stats){
    var coreActive = !AUDIT_INCLUDE_STEM_LOCAL;
    var stemActive = AUDIT_INCLUDE_STEM_LOCAL;
    var scopeText = AUDIT_INCLUDE_STEM_LOCAL
      ? 'Including STEM slot #6 · ' + stats.total + ' counted tool occurrence' + (stats.total !== 1 ? 's' : '')
      : 'Core suggestions only, slots 1–5 · ' + stats.total + ' counted tool occurrence' + (stats.total !== 1 ? 's' : '');
    return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;padding:10px 12px;background:var(--card2);border:1px solid var(--border);border-radius:10px">'
      + '<span style="font-size:12px;color:var(--dim);font-weight:700">Audit scope:</span>'
      + '<button class="btn-sm" onclick="setAuditStemScope(false)" style="' + (coreActive ? 'background:var(--lime);color:#111;border-color:var(--lime)' : '') + '">Core slots 1–5</button>'
      + '<button class="btn-sm" onclick="setAuditStemScope(true)" style="' + (stemActive ? 'background:var(--lime);color:#111;border-color:var(--lime)' : '') + '">Include STEM slot 6</button>'
      + '<span style="font-size:12px;color:var(--dim);margin-left:auto">' + esc(scopeText) + '</span>'
      + '</div>';
  }

  renderAuditChart = window.renderAuditChart = function(){
    var stats = computeStats({ includeStem: AUDIT_INCLUDE_STEM_LOCAL });
    var container = document.getElementById('audit-chart');
    var filterEl = document.getElementById('year-campus-filter');
    if(!container) return;

    container.innerHTML = '';
    if(filterEl) filterEl.innerHTML = '';

    var campusDebug = [...new Set((DATA || []).map(function(e){ return e.ca; }))];
    var debugEl = document.getElementById('audit-campus-debug');
    if(debugEl){
      debugEl.innerHTML = 'Campuses in data: ' + campusDebug.map(function(campus){
        return '<span style="margin-right:8px;color:' + caCol(campus) + '">' + esc(campus) + ' (' + (DATA || []).filter(function(e){ return e.ca === campus; }).length + ')</span>';
      }).join('');
    }

    container.innerHTML = auditScopeHtml_(stats);

    if(!stats.sorted.length){
      container.innerHTML += '<div style="padding:40px;text-align:center;color:var(--dim);font-size:14px">No suggestion data found in this audit scope.</div>';
      return;
    }

    if(AUDIT_VIEW === 'tools'){
      var card = document.createElement('div');
      card.className = 'card';
      var warningNote = stats.incompleteCount > 0
        ? ' <span style="color:#FF8080;font-size:11px;font-weight:600">· ' + stats.incompleteCount + ' entries pending audit</span>'
        : '';
      card.innerHTML = '<span class="label">Tool frequency — ' + stats.total + ' total — click a bar to see matching suggestions</span>' + warningNote;

      var top = stats.sorted.slice(0,50);
      var mx = top[0].count || 1;
      top.forEach(function(item, rankIdx){
        var name = item.name;
        var count = item.count;
        var pct = item.pct;
        var isWarn = name.startsWith('\u26a0');
        var barCol = isWarn ? '#FF8080' : 'var(--lime)';
        var nameCol = isWarn ? '#FF8080' : 'var(--text)';
        var uid = 'dd_' + rankIdx + '_' + name.replace(/\W/g,'').slice(0,18) + '_' + count;

        var wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:14px;cursor:pointer';

        var labelRow = document.createElement('div');
        labelRow.style.cssText = 'display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:5px';
        labelRow.innerHTML = '<span style="color:' + nameCol + '">' + esc(name) + '</span><span style="color:var(--dim)">' + count + '\u00d7 (' + pct + '%)</span>';

        var track = document.createElement('div');
        track.style.cssText = 'height:6px;background:var(--card2);border-radius:3px;margin-bottom:0';
        var fill = document.createElement('div');
        fill.style.cssText = 'height:100%;border-radius:3px;background:' + barCol + ';width:' + Math.round((count/mx)*100) + '%';
        track.appendChild(fill);

        var dd = document.createElement('div');
        dd.id = uid;
        dd.style.cssText = 'display:none;margin-top:10px;padding:8px;background:var(--card2);border-radius:8px;border:1px solid var(--border)';
        (stats.toolRows[name] || []).forEach(function(rowData){
          var entry = rowData.entry;
          var slotLabel = auditIsStemSlot_(rowData.slotIdx) ? 'Slot 6 · STEM' : 'Slot ' + (rowData.slotIdx + 1);
          var rawNote = rowData.rawTool && normaliseToolName(rowData.rawTool) !== name
            ? '<span style="font-size:10px;color:var(--dim);margin-left:6px">from ' + esc(rowData.rawTool) + '</span>'
            : '';
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-radius:6px;font-size:12px';
          row.innerHTML = '<span style="color:var(--dim);width:100px;flex-shrink:0">' + esc(entry.ca) + '</span>'
            + '<span style="color:var(--gold);font-weight:600;width:62px;flex-shrink:0">' + esc(entry.yl) + '</span>'
            + '<span style="font-size:10px;color:' + (auditIsStemSlot_(rowData.slotIdx) ? '#60B8F0' : 'var(--dim)') + ';font-weight:800;width:86px;flex-shrink:0">' + slotLabel + '</span>'
            + '<span style="flex:1">' + esc(entry.th) + rawNote + '</span>'
            + '<span style="color:var(--dim)">\u203a</span>';
          row.onmouseover = function(){ row.style.background = 'var(--card)'; };
          row.onmouseout = function(){ row.style.background = ''; };
          row.onclick = function(ev){ ev.stopPropagation(); openEntry(rowData.entryIdx); };
          dd.appendChild(row);
        });
        if(!dd.children.length) dd.innerHTML = '<div style="color:var(--dim);font-size:12px;padding:6px">No matching suggestions found in this audit scope</div>';

        wrap.onclick = function(){
          var open = dd.style.display !== 'none';
          container.querySelectorAll('[id^="dd_"]').forEach(function(el){ el.style.display = 'none'; });
          dd.style.display = open ? 'none' : 'block';
        };
        wrap.appendChild(labelRow);
        wrap.appendChild(track);
        wrap.appendChild(dd);
        card.appendChild(wrap);
      });
      container.appendChild(card);
      return;
    }

    if(AUDIT_VIEW === 'campus'){
      var campuses = [...new Set((DATA || []).map(function(e){ return normCa(e.ca); }))].sort();
      var palette = ['#F5A623','#C5E84A','#60B8F0','#9B8BFF','#52B95C','#FF8080'];
      campuses.forEach(function(campus, ci){
        var tools = stats.campusTools[campus] || {};
        var totalSugs = Object.values(tools).reduce(function(a,b){ return a+b; }, 0);
        var sorted = Object.entries(tools).sort(function(a,b){ return b[1]-a[1] || a[0].localeCompare(b[0]); }).slice(0,12);
        var mx = sorted[0]?.[1] || 1;
        var col = palette[ci % palette.length];
        var card = document.createElement('div');
        card.className = 'card';
        card.style.marginBottom = '14px';
        var html = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">'
          + '<div style="width:10px;height:10px;border-radius:3px;background:' + col + '"></div>'
          + '<span style="font-weight:800;font-size:16px">' + esc(campus) + '</span>'
          + '<span style="color:var(--dim);font-size:12px">' + totalSugs + ' counted tool occurrence' + (totalSugs!==1?'s':'') + '</span></div>';
        if(totalSugs === 0){
          html += '<div style="color:var(--dim);font-size:13px;padding:8px 0">No audited suggestions in this scope</div>';
          card.innerHTML = html;
          container.appendChild(card);
          return;
        }
        sorted.forEach(function(pair){
          html += '<div style="margin-bottom:12px">'
            + '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:4px"><span>' + esc(pair[0]) + '</span><span style="color:var(--dim)">' + pair[1] + '\u00d7</span></div>'
            + '<div style="height:6px;background:var(--card2);border-radius:3px"><div style="height:100%;border-radius:3px;background:' + col + ';width:' + Math.round((pair[1]/mx)*100) + '%"></div></div>'
            + '</div>';
        });
        card.innerHTML = html;
        container.appendChild(card);
      });
      return;
    }

    var campusesForYear = [...new Set((DATA || []).map(function(e){ return normCa(e.ca); }))].sort();
    var paletteForYear = ['#F5A623','#C5E84A','#9B8BFF'];

    var allBtn = document.createElement('button');
    allBtn.className = 'view-tab' + (AUDIT_YEAR_CAMPUS === '' ? ' active' : '');
    allBtn.textContent = 'All';
    allBtn.onclick = function(){ setYrCampus('', allBtn); };
    if(filterEl) filterEl.appendChild(allBtn);

    campusesForYear.forEach(function(campus){
      var b = document.createElement('button');
      b.className = 'view-tab' + (AUDIT_YEAR_CAMPUS === campus ? ' active' : '');
      b.textContent = campus;
      b.onclick = function(){ setYrCampus(campus, b); };
      if(filterEl) filterEl.appendChild(b);
    });

    var fd = AUDIT_YEAR_CAMPUS ? (DATA || []).filter(function(e){ return normCa(e.ca) === AUDIT_YEAR_CAMPUS; }) : DATA;
    var scopedStats = computeStats({ entries: fd, includeStem: AUDIT_INCLUDE_STEM_LOCAL });
    var colForYear = AUDIT_YEAR_CAMPUS ? paletteForYear[campusesForYear.indexOf(AUDIT_YEAR_CAMPUS) % paletteForYear.length] : '#C5E84A';
    var yearsWithData = YR.filter(function(year){ return scopedStats.yearTools[year]; });
    if(!yearsWithData.length){
      container.innerHTML += '<div style="padding:40px;text-align:center;color:var(--dim);font-size:14px">No year-level data found in this audit scope.</div>';
      return;
    }
    yearsWithData.forEach(function(year){
      var sorted = Object.entries(scopedStats.yearTools[year]).sort(function(a,b){ return b[1]-a[1] || a[0].localeCompare(b[0]); }).slice(0,10);
      var mx = sorted[0]?.[1] || 1;
      var card = document.createElement('div');
      card.className = 'card';
      card.style.marginBottom = '14px';
      var html = '<div style="font-weight:800;font-size:17px;color:var(--lime);margin-bottom:14px">' + year + (AUDIT_YEAR_CAMPUS ? ' — ' + AUDIT_YEAR_CAMPUS : '') + '</div>';
      sorted.forEach(function(pair){
        html += '<div style="margin-bottom:12px">'
          + '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:4px"><span>' + esc(pair[0]) + '</span><span style="color:var(--dim)">' + pair[1] + '\u00d7</span></div>'
          + '<div style="height:6px;background:var(--card2);border-radius:3px"><div style="height:100%;border-radius:3px;background:' + colForYear + ';width:' + Math.round((pair[1]/mx)*100) + '%"></div></div>'
          + '</div>';
      });
      card.innerHTML = html;
      container.appendChild(card);
    });
  };
})();
/* ===== end DLA hotfix: audit section consistency patch ===== */



/* =========================================================
   DLA Studio Patch — Bulk collapsible sections + manual Tool Inventory save
   - Restores collapsible Bulk cards with remembered open/closed state.
   - Adds an explicit Save changes button for Tool Inventory edits.
   - Suppresses Tool Inventory auto-save so edits are clearly saved on demand.
   ========================================================= */
(function(){
  const PATCH_ID = 'bulk-collapsible-inventory-save-v1';
  if(window.__DLA_BULK_COLLAPSE_SAVE_PATCH_ID === PATCH_ID) return;
  window.__DLA_BULK_COLLAPSE_SAVE_PATCH_ID = PATCH_ID;

  const BULK_STATE_KEY = 'dla_bulk_collapsible_state_v1';
  let inventoryDirty = false;
  let inventorySaving = false;
  const realSaveLibraries = (typeof saveLibraries === 'function') ? saveLibraries : null;

  function loadBulkState_(){
    try { return JSON.parse(localStorage.getItem(BULK_STATE_KEY) || '{}') || {}; }
    catch(e){ return {}; }
  }
  function saveBulkState_(state){
    try { localStorage.setItem(BULK_STATE_KEY, JSON.stringify(state || {})); }
    catch(e){}
  }
  function bulkCardTitle_(card){
    const label = card.querySelector('.label');
    return (label && label.textContent ? label.textContent : 'Bulk section').replace(/\s+/g,' ').trim();
  }
  function bulkCardKey_(card, idx){
    const title = bulkCardTitle_(card).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    return (card.id || title || ('section-'+idx));
  }
  function stopBulkToggleFromControl_(event){
    const interactive = event.target && event.target.closest && event.target.closest('button,input,select,textarea,a,[contenteditable="true"]');
    return !!interactive;
  }
  function setBulkCardOpen_(card, open, persist){
    const body = card.querySelector(':scope > .bulk-card-body');
    const caret = card.querySelector(':scope > .bulk-card-header .bulk-collapse-caret');
    const stateText = card.querySelector(':scope > .bulk-card-header .bulk-collapse-state');
    if(body) body.style.display = open ? 'block' : 'none';
    if(caret) caret.textContent = open ? '▾' : '▸';
    if(stateText) stateText.textContent = open ? 'Hide' : 'Show';
    card.classList.toggle('bulk-card-open', !!open);
    card.classList.toggle('bulk-card-collapsed', !open);
    if(persist){
      const key = card.getAttribute('data-bulk-section-key');
      const state = loadBulkState_();
      state[key] = open ? 'open' : 'closed';
      saveBulkState_(state);
    }
  }

  function ensureBulkStyle_(){
    if(document.getElementById('bulk-collapsible-inventory-style')) return;
    const style = document.createElement('style');
    style.id = 'bulk-collapsible-inventory-style';
    style.textContent = `
      #panel-tools > .card.bulk-collapsible-card{overflow:hidden;}
      #panel-tools > .card.bulk-collapsible-card > .bulk-card-header{cursor:pointer;user-select:none;position:relative;}
      #panel-tools > .card.bulk-collapsible-card > .bulk-card-header:hover .label{color:var(--lime)!important;}
      .bulk-collapse-caret{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:var(--card2);border:1px solid var(--border);color:var(--lime);font-size:13px;font-weight:900;line-height:1;flex-shrink:0;}
      .bulk-collapse-state{font-size:10px;color:var(--dim);font-weight:800;letter-spacing:.7px;text-transform:uppercase;margin-left:4px;}
      .bulk-card-collapsed{border-color:#242424;}
      .bulk-card-collapsed > .bulk-card-header{margin-bottom:0!important;}
      .bulk-card-body{transition:opacity .12s ease;}
      #inv-save-btn{transition:all .12s ease;}
      #inv-save-btn.inv-dirty{background:var(--gold)!important;color:#111!important;border-color:var(--gold)!important;opacity:1!important;}
      #inv-save-status{font-size:11px;color:var(--dim);font-weight:700;white-space:nowrap;}
    `;
    document.head.appendChild(style);
  }

  function makeHeaderForCard_(card){
    let header = card.firstElementChild;
    if(header && header.classList && header.classList.contains('bulk-card-header')) return header;

    if(header && header.matches && header.matches('div') && header.querySelector('.label')){
      // Use the card's existing title/action row as the collapsible header.
    } else {
      const newHeader = document.createElement('div');
      newHeader.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap';
      if(header && header.matches && header.matches('.label')){
        card.insertBefore(newHeader, header);
        newHeader.appendChild(header);
      } else {
        const label = card.querySelector(':scope > .label') || card.querySelector('.label');
        card.insertBefore(newHeader, card.firstChild);
        if(label) newHeader.appendChild(label);
        else {
          const fallback = document.createElement('span');
          fallback.className = 'label';
          fallback.style.margin = '0';
          fallback.textContent = 'Bulk section';
          newHeader.appendChild(fallback);
        }
      }
      header = newHeader;
    }

    header.classList.add('bulk-card-header');
    header.setAttribute('role','button');
    header.setAttribute('tabindex','0');
    if(!header.querySelector('.bulk-collapse-caret')){
      const caret = document.createElement('span');
      caret.className = 'bulk-collapse-caret';
      caret.textContent = '▸';
      header.insertBefore(caret, header.firstChild);
    }
    const label = header.querySelector('.label');
    if(label) label.style.margin = '0';
    if(!header.querySelector('.bulk-collapse-state')){
      const stateText = document.createElement('span');
      stateText.className = 'bulk-collapse-state';
      stateText.textContent = 'Show';
      const flex = document.createElement('div');
      flex.className = 'bulk-collapse-flex-spacer';
      flex.style.cssText = 'flex:1;min-width:12px';
      if(!Array.from(header.children).some(el => el.style && String(el.style.flex).startsWith('1'))){
        header.appendChild(flex);
      }
      header.appendChild(stateText);
    }
    return header;
  }

  function wrapBulkCardBody_(card){
    if(card.querySelector(':scope > .bulk-card-body')) return;
    const body = document.createElement('div');
    body.className = 'bulk-card-body';
    while(card.children.length > 1){
      body.appendChild(card.children[1]);
    }
    card.appendChild(body);
  }

  function setupBulkCollapsibleSections(){
    const panel = document.getElementById('panel-tools');
    if(!panel) return;
    ensureBulkStyle_();
    injectToolInventorySaveButton_();
    const state = loadBulkState_();
    const cards = Array.from(panel.querySelectorAll(':scope > .card'));
    cards.forEach((card, idx) => {
      if(!card.getAttribute('data-bulk-section-key')) card.setAttribute('data-bulk-section-key', bulkCardKey_(card, idx));
      if(card.getAttribute('data-bulk-collapsible-ready') === '1') return;
      card.classList.add('bulk-collapsible-card');
      const header = makeHeaderForCard_(card);
      wrapBulkCardBody_(card);
      const key = card.getAttribute('data-bulk-section-key');
      const open = state[key] === 'open'; // default collapsed unless previously opened
      setBulkCardOpen_(card, open, false);
      header.addEventListener('click', function(event){
        if(stopBulkToggleFromControl_(event)) return;
        setBulkCardOpen_(card, !card.classList.contains('bulk-card-open'), true);
      });
      header.addEventListener('keydown', function(event){
        if(event.key !== 'Enter' && event.key !== ' ') return;
        if(stopBulkToggleFromControl_(event)) return;
        event.preventDefault();
        setBulkCardOpen_(card, !card.classList.contains('bulk-card-open'), true);
      });
      card.setAttribute('data-bulk-collapsible-ready','1');
    });
    updateInventorySaveButton_();
  }
  window.setupBulkCollapsibleSections = setupBulkCollapsibleSections;

  function injectToolInventorySaveButton_(){
    const invCount = document.getElementById('inv-count');
    if(!invCount || document.getElementById('inv-save-btn')) return;
    const saveBtn = document.createElement('button');
    saveBtn.id = 'inv-save-btn';
    saveBtn.type = 'button';
    saveBtn.className = 'btn-sm';
    saveBtn.style.cssText = 'color:var(--dim);border-color:var(--border);padding:6px 12px';
    saveBtn.textContent = 'Saved';
    saveBtn.onclick = function(event){
      event.stopPropagation();
      invSaveChanges();
    };
    const status = document.createElement('span');
    status.id = 'inv-save-status';
    status.textContent = '';
    invCount.parentNode.insertBefore(status, invCount);
    invCount.parentNode.insertBefore(saveBtn, invCount);
  }

  function updateInventorySaveButton_(){
    injectToolInventorySaveButton_();
    const btn = document.getElementById('inv-save-btn');
    const status = document.getElementById('inv-save-status');
    if(!btn) return;
    btn.disabled = inventorySaving || !inventoryDirty;
    btn.classList.toggle('inv-dirty', inventoryDirty && !inventorySaving);
    if(inventorySaving){
      btn.textContent = 'Saving…';
      if(status) status.textContent = 'Saving inventory…';
      return;
    }
    if(inventoryDirty){
      btn.textContent = 'Save changes';
      if(status) { status.textContent = 'Unsaved Tool Inventory changes'; status.style.color = 'var(--gold)'; }
    } else {
      btn.textContent = 'Saved';
      if(status) { status.textContent = ''; status.style.color = 'var(--dim)'; }
    }
  }

  function markInventoryDirty_(message){
    inventoryDirty = true;
    updateInventorySaveButton_();
    if(message) setStatus(message, 'loading');
  }
  window.invMarkDirty = markInventoryDirty_;

  window.invSaveChanges = async function invSaveChanges(){
    if(!realSaveLibraries){ setStatus('Could not save Tool Inventory — saveLibraries() was not found', 'error'); return; }
    if(inventorySaving) return;
    if(!inventoryDirty){ setStatus('Tool Inventory already saved ✓'); return; }
    inventorySaving = true;
    updateInventorySaveButton_();
    try{
      await realSaveLibraries.call(this);
      inventoryDirty = false;
      setStatus('Tool Inventory saved to libraries.json ✓');
    }catch(e){
      setStatus('Tool Inventory save failed: ' + (e && e.message ? e.message : e), 'error');
    }finally{
      inventorySaving = false;
      updateInventorySaveButton_();
    }
  };

  function inventorySnapshot_(){
    try{
      if(typeof normaliseToolInventory === 'function') normaliseToolInventory();
      return JSON.stringify({
        approved: TOOL_INVENTORY && TOOL_INVENTORY.approved || [],
        banned: TOOL_INVENTORY && TOOL_INVENTORY.banned || [],
        ageRanges: TOOL_INVENTORY && TOOL_INVENTORY.ageRanges || {}
      });
    }catch(e){ return ''; }
  }

  function runInventoryEditWithoutAutosave_(fn){
    const before = inventorySnapshot_();
    const previousSaveLibraries = saveLibraries;
    saveLibraries = window.saveLibraries = function(){ return Promise.resolve(); };
    try { return fn(); }
    finally {
      saveLibraries = window.saveLibraries = previousSaveLibraries;
      const after = inventorySnapshot_();
      if(before !== after) markInventoryDirty_('Tool Inventory changed — click “Save changes” to update libraries.json');
      else updateInventorySaveButton_();
    }
  }

  if(typeof invAddTool === 'function'){
    const oldInvAddTool = invAddTool;
    invAddTool = window.invAddTool = function(){
      return runInventoryEditWithoutAutosave_(() => oldInvAddTool.apply(this, arguments));
    };
  }
  if(typeof invRemoveTool === 'function'){
    const oldInvRemoveTool = invRemoveTool;
    invRemoveTool = window.invRemoveTool = function(){
      return runInventoryEditWithoutAutosave_(() => oldInvRemoveTool.apply(this, arguments));
    };
  }
  if(typeof invUpdateToolAge === 'function'){
    const oldInvUpdateToolAge = invUpdateToolAge;
    invUpdateToolAge = window.invUpdateToolAge = function(){
      return runInventoryEditWithoutAutosave_(() => oldInvUpdateToolAge.apply(this, arguments));
    };
  }
  if(typeof renderToolInventory === 'function'){
    const oldRenderToolInventory = renderToolInventory;
    renderToolInventory = window.renderToolInventory = function(){
      const out = oldRenderToolInventory.apply(this, arguments);
      injectToolInventorySaveButton_();
      updateInventorySaveButton_();
      return out;
    };
  }

  if(typeof switchTab === 'function'){
    const oldSwitchTab = switchTab;
    switchTab = window.switchTab = function(tab, btn){
      const result = oldSwitchTab.apply(this, arguments);
      if(tab === 'tools') setTimeout(setupBulkCollapsibleSections, 0);
      return result;
    };
  }

  // If the Bulk panel is already visible when this patch loads, apply immediately.
  setTimeout(setupBulkCollapsibleSections, 0);
})();

/* ===== DLA hotfix: auto-remove Human Verified when suggestions change =====
   Keeps the gold tick as a true human-audit marker. Any edit/swap/regeneration
   to a verified unit's suggestions removes the tick so the unit must be checked again. */
(function(){
  const SIG_FIELD = 'humanVerifiedSuggestionSignature';

  function hvClean_(value){
    try { if(typeof cleanSuggestionText_ === 'function') return cleanSuggestionText_(value); } catch(e){}
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function hvIsVerified_(entry){
    try { if(typeof isHumanVerifiedEntry_ === 'function') return isHumanVerifiedEntry_(entry); } catch(e){}
    return !!(entry && (entry.humanVerified === true || entry.humanVerifiedAt || entry.human_verified === true));
  }

  function hvSuggestionSignature_(entry){
    try{
      const sugs = (typeof getSugs === 'function') ? getSugs(entry) : (Array.isArray(entry && entry.s) ? entry.s : []);
      const compact = sugs.map(function(s){
        const tool = (typeof sugTool === 'function') ? sugTool(s) : (s && (s.t || s.tool || s.technology || s.name) || '');
        const desc = (typeof sugDesc === 'function') ? sugDesc(s) : (s && (s.d || s.desc || s.description || s.integration_idea || s.activity) || '');
        return {
          t: hvClean_(tool),
          d: hvClean_(desc),
          url: hvClean_(s && (s.url || s.lessonUrl || ''))
        };
      });
      return JSON.stringify(compact);
    }catch(e){
      return '';
    }
  }

  function hvDeleteVerificationFields_(entry, reason){
    if(!entry) return;
    entry.humanVerified = false;
    delete entry.human_verified;
    delete entry.humanVerifiedAt;
    delete entry.humanVerifiedBy;
    delete entry.humanVerifiedReason;
    delete entry[SIG_FIELD];
    entry.humanVerifiedResetAt = new Date().toISOString();
    entry.humanVerifiedResetReason = reason || 'Suggestion changed after human verification';
  }

  function hvSeedVerifiedSignatures_(){
    try{
      if(typeof DATA === 'undefined' || !Array.isArray(DATA)) return;
      DATA.forEach(function(entry){
        if(hvIsVerified_(entry) && !entry[SIG_FIELD]) entry[SIG_FIELD] = hvSuggestionSignature_(entry);
      });
    }catch(e){}
  }

  function hvRemoveTicksForChangedSuggestions_(){
    const changed = [];
    try{
      if(typeof DATA === 'undefined' || !Array.isArray(DATA)) return changed;
      DATA.forEach(function(entry, idx){
        if(!hvIsVerified_(entry)) return;
        const currentSig = hvSuggestionSignature_(entry);
        if(!entry[SIG_FIELD]){
          // Existing verified data from before this patch: treat the loaded state as the human-checked baseline.
          entry[SIG_FIELD] = currentSig;
          return;
        }
        if(entry[SIG_FIELD] !== currentSig){
          const label = [entry.yl, entry.th].filter(Boolean).join(' — ') || ('Entry ' + (idx + 1));
          hvDeleteVerificationFields_(entry, 'Suggestion edited, swapped, regenerated or changed after human verification');
          changed.push(label);
        }
      });
    }catch(e){ console.warn('Human verification dirty-check failed:', e); }
    return changed;
  }

  // Patch the verifier so every new human tick stores a snapshot of the currently approved suggestions.
  if(typeof setHumanVerifiedForEntry_ === 'function'){
    const oldSetHumanVerifiedForEntry = setHumanVerifiedForEntry_;
    setHumanVerifiedForEntry_ = window.setHumanVerifiedForEntry_ = function(idx, verified){
      const out = oldSetHumanVerifiedForEntry.apply(this, arguments);
      try{
        const entry = (typeof DATA !== 'undefined' && DATA) ? DATA[idx] : null;
        if(entry && verified){
          entry[SIG_FIELD] = hvSuggestionSignature_(entry);
          delete entry.humanVerifiedResetAt;
          delete entry.humanVerifiedResetReason;
        } else if(entry && !verified){
          delete entry[SIG_FIELD];
        }
      }catch(e){}
      return out;
    };
  }

  // Patch the existing re-check marker so it also clears the stored baseline signature.
  if(typeof markEntryNeedsHumanRecheck_ === 'function'){
    const oldMarkEntryNeedsHumanRecheck = markEntryNeedsHumanRecheck_;
    markEntryNeedsHumanRecheck_ = window.markEntryNeedsHumanRecheck_ = function(idx, reason){
      const entry = (typeof DATA !== 'undefined' && DATA) ? DATA[idx] : null;
      const wasVerified = hvIsVerified_(entry);
      const out = oldMarkEntryNeedsHumanRecheck.apply(this, arguments);
      if(entry && wasVerified) delete entry[SIG_FIELD];
      return out;
    };
  }

  // Seed signatures after data loads from Drive.
  if(typeof ingest === 'function'){
    const oldIngest = ingest;
    ingest = window.ingest = function(){
      const out = oldIngest.apply(this, arguments);
      hvSeedVerifiedSignatures_();
      return out;
    };
  }

  // Final safety net: any code path that edits DATA and then saves will remove stale human ticks.
  if(typeof saveToDrive === 'function'){
    const oldSaveToDrive = saveToDrive;
    saveToDrive = window.saveToDrive = async function(){
      hvSeedVerifiedSignatures_();
      const removed = hvRemoveTicksForChangedSuggestions_();
      const result = await oldSaveToDrive.apply(this, arguments);
      if(removed.length){
        try{
          if(typeof renderBrowse === 'function') renderBrowse();
          if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX !== null && typeof renderEntry === 'function') renderEntry(CURRENT_ENTRY_IDX);
          const sample = removed.slice(0,3).join('; ');
          const extra = removed.length > 3 ? ' and ' + (removed.length - 3) + ' more' : '';
          if(typeof setStatus === 'function') setStatus('Human verification removed for ' + removed.length + ' changed unit' + (removed.length!==1?'s':'') + ': ' + sample + extra,'loading');
        }catch(e){}
      }
      return result;
    };
  }

  // If data was already loaded before this patch ran, baseline it now.
  setTimeout(hvSeedVerifiedSignatures_, 0);
})();
/* ===== end DLA hotfix ===== */


/* ===== DLA hotfix: make Human Verified gold glow immediate and obvious =====
   Fixes cases where the tick saved but the Browse row did not visibly glow. */
(function(){
  const SIG_FIELD = 'humanVerifiedSuggestionSignature';

  function hvGlowSignature_(entry){
    try{
      const sugs = (typeof getSugs === 'function') ? getSugs(entry) : (Array.isArray(entry && entry.s) ? entry.s : []);
      return JSON.stringify(sugs.map(function(s){
        const tool = (typeof sugTool === 'function') ? sugTool(s) : (s && (s.t || s.tool || s.technology || s.name) || '');
        const desc = (typeof sugDesc === 'function') ? sugDesc(s) : (s && (s.d || s.desc || s.description || s.integration_idea || s.activity) || '');
        const clean = function(v){
          try { if(typeof cleanSuggestionText_ === 'function') return cleanSuggestionText_(v); } catch(e){}
          return String(v == null ? '' : v).replace(/\s+/g,' ').trim();
        };
        return { t:clean(tool), d:clean(desc), url:clean(s && (s.url || s.lessonUrl || '')) };
      }));
    }catch(e){ return ''; }
  }

  function hvGlowIsVerified_(entry){
    try { if(typeof isHumanVerifiedEntry_ === 'function') return isHumanVerifiedEntry_(entry); } catch(e){}
    return !!(entry && (entry.humanVerified === true || entry.humanVerifiedAt || entry.human_verified === true));
  }

  // Replace the original style block with a stronger, unmistakable gold treatment.
  ensureHumanVerificationStyles_ = window.ensureHumanVerificationStyles_ = function(){
    const existing = document.getElementById('human-verify-styles');
    if(existing) existing.remove();
    const style = document.createElement('style');
    style.id = 'human-verify-styles';
    style.textContent = `
      .human-verified-unit{
        position:relative!important;
        isolation:isolate;
        border:1.5px solid rgba(212,160,23,1)!important;
        border-left:6px solid var(--gold)!important;
        background:
          radial-gradient(circle at 22px 50%,rgba(212,160,23,.30),rgba(212,160,23,.08) 36%,rgba(26,26,26,.98) 70%),
          linear-gradient(90deg,rgba(212,160,23,.18),rgba(26,26,26,.98) 48%,rgba(197,232,74,.06))!important;
        box-shadow:
          0 0 0 1px rgba(212,160,23,.62),
          0 0 26px rgba(212,160,23,.32),
          0 0 60px rgba(212,160,23,.14),
          inset 0 0 30px rgba(212,160,23,.08)!important;
      }
      .human-verified-unit::after{
        content:'';
        position:absolute;
        inset:-3px;
        border-radius:14px;
        border:1px solid rgba(212,160,23,.28);
        pointer-events:none;
        z-index:-1;
        filter:blur(.2px);
      }
      .human-verified-unit:hover{
        border-color:var(--gold)!important;
        box-shadow:
          0 0 0 1px rgba(212,160,23,.85),
          0 0 34px rgba(212,160,23,.45),
          0 0 78px rgba(212,160,23,.18),
          inset 0 0 34px rgba(212,160,23,.10)!important;
      }
      .human-verify-flash{animation:humanVerifyGoldFlash 1.35s ease-out 1!important;}
      @keyframes humanVerifyGoldFlash{
        0%{transform:scale(.992);filter:brightness(1);box-shadow:0 0 0 0 rgba(212,160,23,.95),0 0 0 rgba(212,160,23,0),inset 0 0 0 rgba(212,160,23,0)}
        32%{transform:scale(1.008);filter:brightness(1.18);box-shadow:0 0 0 5px rgba(212,160,23,.42),0 0 52px rgba(212,160,23,.70),inset 0 0 32px rgba(212,160,23,.16)}
        100%{transform:scale(1);filter:brightness(1)}
      }
      .human-verified-tick{
        display:inline-flex;align-items:center;gap:5px;margin-left:10px;padding:4px 11px;border-radius:999px;
        background:linear-gradient(180deg,rgba(212,160,23,.25),rgba(212,160,23,.10));
        border:1px solid rgba(212,160,23,.88);color:var(--gold);
        font-size:10px;font-weight:950;letter-spacing:.72px;text-transform:uppercase;vertical-align:middle;white-space:nowrap;
        box-shadow:0 0 18px rgba(212,160,23,.30),inset 0 0 10px rgba(212,160,23,.08);
      }
      .human-verified-btn,.human-verified-entry-btn{
        padding:7px 12px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--dim);
        font-size:11px;font-weight:900;font-family:inherit;cursor:pointer;letter-spacing:.45px;text-transform:uppercase;white-space:nowrap;
        transition:all .12s ease;
      }
      .human-verified-btn:hover,.human-verified-entry-btn:hover{border-color:var(--gold);color:var(--gold);background:rgba(212,160,23,.09);}
      .human-verified-btn.verified,.human-verified-entry-btn.verified{
        border-color:rgba(212,160,23,1);background:rgba(212,160,23,.18);color:var(--gold);
        box-shadow:0 0 16px rgba(212,160,23,.24),inset 0 0 8px rgba(212,160,23,.08);
      }
      .human-verified-entry-banner{
        padding:10px 14px;background:rgba(212,160,23,.12);border:1px solid rgba(212,160,23,.72);border-left:5px solid var(--gold);border-radius:11px;margin-bottom:10px;
        color:var(--gold);font-size:12px;font-weight:900;box-shadow:0 0 24px rgba(212,160,23,.18),inset 0 0 18px rgba(212,160,23,.05);
      }
      .human-verified-entry-glow{
        border-color:rgba(212,160,23,.85)!important;
        box-shadow:0 0 0 1px rgba(212,160,23,.38),0 0 28px rgba(212,160,23,.22),inset 0 0 24px rgba(212,160,23,.055)!important;
      }
    `;
    document.head.appendChild(style);
  };

  function hvApplyGoldDomState_(idx, flash){
    try{
      if(typeof DATA === 'undefined' || !DATA || !DATA[idx]) return;
      ensureHumanVerificationStyles_();
      const verified = hvGlowIsVerified_(DATA[idx]);
      const row = document.getElementById('browse-row-' + idx);
      if(row){
        row.classList.toggle('human-verified-unit', verified);
        row.classList.remove('human-verify-flash');
        if(verified && flash){
          void row.offsetWidth;
          row.classList.add('human-verify-flash');
          row.scrollIntoView({behavior:'smooth', block:'center'});
        }
      }
      const entryHeader = document.getElementById('entry-header');
      if(entryHeader && typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX === idx){
        entryHeader.classList.toggle('human-verified-entry-glow', verified);
        entryHeader.classList.remove('human-verify-flash');
        if(verified && flash){ void entryHeader.offsetWidth; entryHeader.classList.add('human-verify-flash'); }
      }
    }catch(e){ console.warn('Human verified glow update failed:', e); }
  }

  // Keep the gold classes in sync after each Browse render, even if another patch re-renders the rows.
  if(typeof renderBrowse === 'function'){
    const oldRenderBrowse = renderBrowse;
    renderBrowse = window.renderBrowse = function(){
      ensureHumanVerificationStyles_();
      const out = oldRenderBrowse.apply(this, arguments);
      try{
        if(Array.isArray(DATA)) DATA.forEach(function(entry, idx){ hvApplyGoldDomState_(idx, window._lastHumanVerifiedIdx === idx); });
      }catch(e){}
      return out;
    };
  }

  if(typeof renderEntry === 'function'){
    const oldRenderEntry = renderEntry;
    renderEntry = window.renderEntry = function(idx){
      ensureHumanVerificationStyles_();
      const out = oldRenderEntry.apply(this, arguments);
      hvApplyGoldDomState_(idx, false);
      return out;
    };
  }

  if(typeof setHumanVerifiedForEntry_ === 'function'){
    const oldSetHumanVerifiedForEntry = setHumanVerifiedForEntry_;
    setHumanVerifiedForEntry_ = window.setHumanVerifiedForEntry_ = function(idx, verified){
      const out = oldSetHumanVerifiedForEntry.apply(this, arguments);
      try{
        const entry = (typeof DATA !== 'undefined' && DATA) ? DATA[idx] : null;
        if(entry && verified){
          entry[SIG_FIELD] = hvGlowSignature_(entry);
          delete entry.humanVerifiedResetAt;
          delete entry.humanVerifiedResetReason;
        } else if(entry && !verified){
          delete entry[SIG_FIELD];
        }
      }catch(e){}
      return out;
    };
  }

  // Immediate visual feedback: update the page first, then save to Drive.
  toggleHumanVerified = window.toggleHumanVerified = function(idx){
    const entry = (typeof DATA !== 'undefined' && DATA) ? DATA[idx] : null;
    if(!entry) return;
    const next = !hvGlowIsVerified_(entry);
    setHumanVerifiedForEntry_(idx, next);
    window._lastHumanVerifiedIdx = next ? idx : null;

    try { if(typeof setStatus === 'function') setStatus(next ? `Human verified: ${entry.yl} — ${entry.th}` : `Human verification removed: ${entry.yl} — ${entry.th}`); } catch(e){}
    try { if(typeof renderBrowse === 'function') renderBrowse(); } catch(e){}
    try { if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX === idx && typeof renderEntry === 'function') renderEntry(idx); } catch(e){}
    setTimeout(function(){ hvApplyGoldDomState_(idx, next); }, 30);
    setTimeout(function(){ hvApplyGoldDomState_(idx, next); }, 250);

    try { if(typeof saveToDrive === 'function') saveToDrive(); } catch(e){ console.warn('Human verify save failed:', e); }
  };

  // Apply the stronger CSS immediately for already-rendered verified rows.
  ensureHumanVerificationStyles_();
  setTimeout(function(){
    try { if(Array.isArray(DATA)) DATA.forEach(function(entry, idx){ hvApplyGoldDomState_(idx, false); }); } catch(e){}
  }, 0);
})();
/* ===== end DLA hotfix ===== */


/* ===== DLA hotfix: Human Verify glows all entry suggestion cards + quiet background save =====
   Makes verification feel instant in the unit detail view and removes the top loading bar. */
(function(){
  const SIG_FIELD = 'humanVerifiedSuggestionSignature';

  function hvEntryGlowIsVerified_(entry){
    try { if(typeof isHumanVerifiedEntry_ === 'function') return isHumanVerifiedEntry_(entry); } catch(e){}
    return !!(entry && (entry.humanVerified === true || entry.humanVerifiedAt || entry.human_verified === true));
  }

  function hvEntryGlowSignature_(entry){
    try{
      const sugs = (typeof getSugs === 'function') ? getSugs(entry) : (Array.isArray(entry && entry.s) ? entry.s : []);
      const clean = function(v){
        try { if(typeof cleanSuggestionText_ === 'function') return cleanSuggestionText_(v); } catch(e){}
        return String(v == null ? '' : v).replace(/\s+/g,' ').trim();
      };
      return JSON.stringify(sugs.map(function(s){
        const tool = (typeof sugTool === 'function') ? sugTool(s) : (s && (s.t || s.tool || s.technology || s.name) || '');
        const desc = (typeof sugDesc === 'function') ? sugDesc(s) : (s && (s.d || s.desc || s.description || s.integration_idea || s.activity) || '');
        return { t:clean(tool), d:clean(desc), url:clean(s && (s.url || s.lessonUrl || '')) };
      }));
    }catch(e){ return ''; }
  }

  function hvEnsureEntryLessonGlowStyles_(){
    if(typeof ensureHumanVerificationStyles_ === 'function') ensureHumanVerificationStyles_();
    const old = document.getElementById('human-verify-entry-lesson-glow-styles');
    if(old) old.remove();
    const style = document.createElement('style');
    style.id = 'human-verify-entry-lesson-glow-styles';
    style.textContent = `
      .human-verified-entry-glow{
        border-color:rgba(212,160,23,.95)!important;
        box-shadow:0 0 0 1px rgba(212,160,23,.5),0 0 32px rgba(212,160,23,.28),inset 0 0 24px rgba(212,160,23,.065)!important;
      }
      #entry-sugs .sug.human-verified-lesson-glow{
        position:relative!important;
        border-color:rgba(212,160,23,1)!important;
        background:linear-gradient(135deg,rgba(212,160,23,.12),rgba(26,26,26,.96) 46%,rgba(212,160,23,.055))!important;
        box-shadow:0 0 0 1px rgba(212,160,23,.54),0 0 28px rgba(212,160,23,.27),inset 0 0 24px rgba(212,160,23,.06)!important;
      }
      #entry-sugs .sug.human-verified-lesson-glow .sug-main{
        background:linear-gradient(135deg,rgba(212,160,23,.105),rgba(26,26,26,.98) 44%,rgba(212,160,23,.04))!important;
      }
      #entry-sugs .sug.human-verified-lesson-glow::after{
        content:'✓ HUMAN VERIFIED';
        position:absolute;
        top:10px;
        right:12px;
        padding:3px 9px;
        border-radius:999px;
        border:1px solid rgba(212,160,23,.72);
        background:rgba(212,160,23,.13);
        color:var(--gold);
        font-size:9px;
        font-weight:950;
        letter-spacing:.75px;
        box-shadow:0 0 14px rgba(212,160,23,.20);
        pointer-events:none;
      }
      #entry-sugs .sug.human-verified-lesson-flash{animation:humanVerifyLessonGoldFlash 1.25s ease-out 1!important;}
      @keyframes humanVerifyLessonGoldFlash{
        0%{transform:scale(.993);filter:brightness(1);}
        36%{transform:scale(1.006);filter:brightness(1.18);box-shadow:0 0 0 5px rgba(212,160,23,.36),0 0 54px rgba(212,160,23,.62),inset 0 0 28px rgba(212,160,23,.14)!important;}
        100%{transform:scale(1);filter:brightness(1);}
      }
    `;
    document.head.appendChild(style);
  }

  function hvApplyEntryLessonGlow_(idx, flash){
    try{
      hvEnsureEntryLessonGlowStyles_();
      const entry = (typeof DATA !== 'undefined' && DATA) ? DATA[idx] : null;
      const verified = hvEntryGlowIsVerified_(entry);
      const onEntry = (typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX === idx);
      if(!onEntry) return;

      const header = document.getElementById('entry-header');
      if(header){
        header.classList.toggle('human-verified-entry-glow', verified);
        header.classList.remove('human-verify-flash');
        if(verified && flash){ void header.offsetWidth; header.classList.add('human-verify-flash'); }
      }

      document.querySelectorAll('#entry-sugs .sug').forEach(function(card){
        card.classList.toggle('human-verified-lesson-glow', verified);
        card.classList.remove('human-verified-lesson-flash');
        if(verified && flash){ void card.offsetWidth; card.classList.add('human-verified-lesson-flash'); }
      });
    }catch(e){ console.warn('Human verified lesson glow failed:', e); }
  }

  function hvUpdateEntryVerifyButton_(idx){
    try{
      const entry = (typeof DATA !== 'undefined' && DATA) ? DATA[idx] : null;
      const verified = hvEntryGlowIsVerified_(entry);
      document.querySelectorAll('.human-verified-entry-btn').forEach(function(btn){
        btn.classList.toggle('verified', verified);
        btn.textContent = verified ? '✓ Human verified' : 'Human verify';
        btn.title = verified ? 'Remove human verification' : 'Mark this unit as manually checked by a human';
      });
      document.querySelectorAll('.human-verified-entry-banner').forEach(function(b){ b.remove(); });
      const header = document.getElementById('entry-header');
      if(header && verified && !header.querySelector('.human-verified-entry-banner')){
        const meta = (typeof humanVerifiedMeta_ === 'function') ? humanVerifiedMeta_(entry) : '';
        const banner = document.createElement('div');
        banner.className = 'human-verified-entry-banner human-verify-flash';
        banner.textContent = '✓ Human verified' + (meta ? ' · ' + meta : '');
        header.insertBefore(banner, header.firstChild ? header.firstChild.nextSibling : null);
      }
    }catch(e){}
  }

  async function hvQuietSaveToDrive_(){
    if(typeof saveToDrive !== 'function') return;
    const oldStart = window.startProgress;
    const oldStop = window.stopProgress;
    const oldShow = window.showProgress;
    try{
      window.startProgress = function(){};
      window.stopProgress = function(){};
      window.showProgress = function(){};
      const maybe = saveToDrive();
      if(maybe && typeof maybe.then === 'function') await maybe;
    }catch(e){
      console.warn('Human verification background save failed:', e);
      try { if(typeof setStatus === 'function') setStatus('Human verification changed locally, but Drive save failed: ' + (e.message || e), 'error'); } catch(_){}
    }finally{
      window.startProgress = oldStart;
      window.stopProgress = oldStop;
      window.showProgress = oldShow;
    }
  }

  if(typeof renderEntry === 'function'){
    const oldRenderEntry = renderEntry;
    renderEntry = window.renderEntry = function(idx){
      hvEnsureEntryLessonGlowStyles_();
      const out = oldRenderEntry.apply(this, arguments);
      hvApplyEntryLessonGlow_(idx, false);
      return out;
    };
  }

  // Override click behaviour: no page-level loading bar, immediate unit-detail glow on every suggestion card.
  toggleHumanVerified = window.toggleHumanVerified = function(idx){
    const entry = (typeof DATA !== 'undefined' && DATA) ? DATA[idx] : null;
    if(!entry) return;
    hvEnsureEntryLessonGlowStyles_();

    const next = !hvEntryGlowIsVerified_(entry);
    if(typeof setHumanVerifiedForEntry_ === 'function') setHumanVerifiedForEntry_(idx, next);
    else {
      entry.humanVerified = next;
      if(next){ entry.humanVerifiedAt = new Date().toISOString(); entry.humanVerifiedBy = (typeof CURRENT_USER_EMAIL !== 'undefined' && CURRENT_USER_EMAIL) || localStorage.getItem('dla_user_email') || 'DLP team'; }
      else { delete entry.humanVerifiedAt; delete entry.humanVerifiedBy; delete entry.humanVerifiedReason; }
    }
    if(next){
      entry[SIG_FIELD] = hvEntryGlowSignature_(entry);
      delete entry.humanVerifiedResetAt;
      delete entry.humanVerifiedResetReason;
    } else {
      delete entry[SIG_FIELD];
    }
    window._lastHumanVerifiedIdx = next ? idx : null;

    // Immediate UI update in the current unit view.
    if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX === idx){
      try { if(typeof renderEntry === 'function') renderEntry(idx); } catch(e){}
      hvUpdateEntryVerifyButton_(idx);
      hvApplyEntryLessonGlow_(idx, next);
    } else {
      try { if(typeof renderBrowse === 'function') renderBrowse(); } catch(e){}
      try { if(typeof hvApplyGoldDomState_ === 'function') hvApplyGoldDomState_(idx, next); } catch(e){}
    }

    try { if(typeof setStatus === 'function') setStatus(next ? `Human verified: ${entry.yl} — ${entry.th}` : `Human verification removed: ${entry.yl} — ${entry.th}`); } catch(e){}

    // Persist quietly in the background without the top progress/loading bar.
    setTimeout(hvQuietSaveToDrive_, 0);
  };

  hvEnsureEntryLessonGlowStyles_();
  setTimeout(function(){
    try{
      if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX !== null) hvApplyEntryLessonGlow_(CURRENT_ENTRY_IDX, false);
    }catch(e){}
  }, 0);
})();
/* ===== end DLA hotfix ===== */



/* ===== DLA hotfix: Bulk AI Chat crash guard + safe apply =====
   Prevents Bulk AI errors from taking down the Studio and makes approved changes apply defensively. */
(function(){
  const BULK_GUARD_VERSION = 'bulk-ai-chat-crash-guard-v1';
  if(window.__DLA_BULK_CRASH_GUARD__ === BULK_GUARD_VERSION) return;
  window.__DLA_BULK_CRASH_GUARD__ = BULK_GUARD_VERSION;

  function bgEsc_(value){
    try { if(typeof esc === 'function') return esc(value); } catch(e){}
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function bgStopUi_(){
    try { if(typeof hideReasoningSteps === 'function') hideReasoningSteps(); } catch(e){}
    try { if(typeof stopProgress === 'function') stopProgress(); } catch(e){}
    try {
      const prog = document.getElementById('bulk-ai-progress');
      if(prog) prog.style.display = 'none';
    } catch(e){}
    try {
      const send = document.getElementById('btn-bulk-chat-send');
      if(send){ send.disabled = false; send.textContent = 'Send →'; }
    } catch(e){}
    try {
      const apply = document.getElementById('popup-apply-btn');
      if(apply){ apply.disabled = false; apply.style.opacity = '1'; }
    } catch(e){}
  }

  function bgReport_(err, where){
    const msg = err && err.message ? err.message : String(err || 'Unknown error');
    console.error('DLA Bulk AI Chat crash guard caught error' + (where ? ' in ' + where : '') + ':', err);
    bgStopUi_();
    try { if(typeof bulkChatState !== 'undefined') bulkChatState = 'idle'; } catch(e){}
    const html = '❌ Bulk AI Chat stopped safely instead of crashing the Studio.' +
      (where ? '<br><span style="font-size:11px;color:var(--dim)">Where: '+bgEsc_(where)+'</span>' : '') +
      '<br><br><span style="font-size:12px;color:#f87171">' + bgEsc_(msg) + '</span>' +
      '<br><br><span style="font-size:12px;color:var(--dim)">No further changes were applied after this error. Click ↻ to reset the Bulk AI Chat, then try a smaller or more specific request.</span>';
    try {
      if(typeof bulkChatAddMessage === 'function') bulkChatAddMessage('assistant', html);
      else if(typeof setStatus === 'function') setStatus('Bulk AI Chat error: ' + msg, 'error');
    } catch(e){
      try { if(typeof setStatus === 'function') setStatus('Bulk AI Chat error: ' + msg, 'error'); } catch(_){}
    }
  }

  function bgCleanText_(value){
    try { if(typeof cleanSuggestionText_ === 'function') return cleanSuggestionText_(value); } catch(e){}
    return String(value == null ? '' : value).replace(/\s+/g,' ').trim();
  }

  function bgCleanUrl_(value){
    try { if(typeof cleanMinecraftLessonUrl_ === 'function') return cleanMinecraftLessonUrl_(value); } catch(e){}
    return String(value == null ? '' : value).trim();
  }

  function bgNormaliseIndex_(value, fallback){
    try { if(typeof normaliseChangeIndex === 'function') return normaliseChangeIndex(value, fallback); } catch(e){}
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function bgNormaliseChange_(raw){
    const c = raw || {};
    let out = c;
    try { if(typeof normaliseMinecraftChangeForEntry_ === 'function') out = normaliseMinecraftChangeForEntry_(c); } catch(e){ out = c; }
    return {
      ...out,
      entryIdx: bgNormaliseIndex_(out.entryIdx != null ? out.entryIdx : out.entry_idx, -1),
      sugIdx: bgNormaliseIndex_(out.sugIdx != null ? out.sugIdx : out.sug_idx, 0),
      t: bgCleanText_(out.t || out.tool || out.technology || out.name || ''),
      d: bgCleanText_(out.d || out.desc || out.description || out.integration_idea || out.activity || out.suggestion || ''),
      url: bgCleanUrl_(out.url || out.lessonUrl || ''),
      auditReason: bgCleanText_(out.auditReason || out.reason || out.flagReason || out.reviewReason || out.problem || '')
    };
  }

  function bgValidChange_(c){
    if(!c || !Number.isFinite(Number(c.entryIdx)) || !Number.isFinite(Number(c.sugIdx))) return false;
    if(typeof DATA === 'undefined' || !Array.isArray(DATA) || !DATA[c.entryIdx]) return false;
    if(!String(c.t || '').trim() && !String(c.d || '').trim()) return false;
    return true;
  }

  function bgSafeSave_(){
    try{
      if(typeof saveToDrive !== 'function') return;
      const result = saveToDrive();
      if(result && typeof result.catch === 'function'){
        result.catch(function(err){ bgReport_(err, 'saveToDrive after Bulk AI changes'); });
      }
    }catch(err){
      bgReport_(err, 'saveToDrive after Bulk AI changes');
    }
  }

  // Catch unhandled errors while Bulk AI is active or while its review popup is open.
  window.addEventListener('error', function(ev){
    try{
      const bulkActive = (typeof bulkChatState !== 'undefined' && bulkChatState && bulkChatState !== 'idle') || !!document.getElementById('changes-popup-overlay');
      if(!bulkActive) return;
      ev.preventDefault();
      bgReport_(ev.error || ev.message, 'browser error');
    }catch(e){}
  });
  window.addEventListener('unhandledrejection', function(ev){
    try{
      const bulkActive = (typeof bulkChatState !== 'undefined' && bulkChatState && bulkChatState !== 'idle') || !!document.getElementById('changes-popup-overlay');
      if(!bulkActive) return;
      ev.preventDefault();
      bgReport_(ev.reason, 'unhandled promise');
    }catch(e){}
  });

  if(typeof bulkChatSend === 'function'){
    const oldBulkChatSend = bulkChatSend;
    bulkChatSend = window.bulkChatSend = async function(){
      try{
        const btn = document.getElementById('btn-bulk-chat-send');
        if(btn){ btn.disabled = true; btn.textContent = 'Working…'; }
        await oldBulkChatSend.apply(this, arguments);
      }catch(err){
        bgReport_(err, 'bulkChatSend');
      }finally{
        try{
          const btn = document.getElementById('btn-bulk-chat-send');
          if(btn){ btn.disabled = false; btn.textContent = 'Send →'; }
        }catch(e){}
      }
    };
  }

  if(typeof bulkChatSelectOption === 'function'){
    const oldBulkChatSelectOption = bulkChatSelectOption;
    bulkChatSelectOption = window.bulkChatSelectOption = function(){
      try{
        return oldBulkChatSelectOption.apply(this, arguments);
      }catch(err){
        bgReport_(err, 'bulkChatSelectOption');
      }
    };
  }

  if(typeof showChangesPopup === 'function'){
    const oldShowChangesPopup = showChangesPopup;
    showChangesPopup = window.showChangesPopup = function(changes){
      try{
        const cleaned = (changes || []).map(bgNormaliseChange_).filter(bgValidChange_);
        if(!cleaned.length){
          if(typeof bulkChatAddMessage === 'function'){
            bulkChatAddMessage('assistant', '⚠️ I generated possible changes, but none were safe to show in the review popup. This usually means the AI returned invalid entry/slot numbers or empty suggestions. Try running the request again with a smaller scope.');
          }
          return;
        }
        return oldShowChangesPopup.call(this, cleaned);
      }catch(err){
        bgReport_(err, 'showChangesPopup');
      }
    };
  }

  // Replace the popup apply flow with a defensive version that cannot take the whole Studio down.
  applyChangesFromPopup = window.applyChangesFromPopup = function(){
    const overlay = document.getElementById('changes-popup-overlay');
    if(!overlay) return;
    const applyBtn = document.getElementById('popup-apply-btn');
    try{
      if(applyBtn){ applyBtn.disabled = true; applyBtn.textContent = 'Applying…'; applyBtn.style.opacity = '0.65'; }
      const changes = (window._popupChanges || []).map(bgNormaliseChange_).filter(bgValidChange_);
      const states = window._popupStates || [];
      const approved = changes.filter(function(c, i){ return states[i] === 'approved'; });
      let applied = 0;
      let skippedDupes = 0;
      let skippedInvalid = 0;
      let appliedRealismFixes = false;

      if(approved.length > 0 && typeof createSnapshot === 'function'){
        try{
          const snapName = window._snapshotReason || `Before applying ${approved.length} bulk change${approved.length!==1?'s':''}`;
          createSnapshot(snapName);
          delete window._snapshotReason;
        }catch(e){ console.warn('Snapshot before bulk apply failed:', e); }
      }

      approved.forEach(function(c){
        try{
          const entryIdx = Number(c.entryIdx);
          const sugIdx = Number(c.sugIdx);
          const t = bgCleanText_(c.t || c.tool || c.technology || c.name || '');
          const d = bgCleanText_(c.d || c.desc || c.description || c.integration_idea || c.activity || c.suggestion || '');
          const url = bgCleanUrl_(c.url || c.lessonUrl || '');
          if(!DATA[entryIdx]){ skippedInvalid++; return; }
          if(!t || !d){ skippedInvalid++; return; }
          if(typeof wouldDupeToolProposalInEntry === 'function' && wouldDupeToolProposalInEntry(DATA[entryIdx], t, sugIdx)){
            skippedDupes++;
            return;
          }
          const currentSugs = (typeof getSugs === 'function') ? getSugs(DATA[entryIdx]) : (Array.isArray(DATA[entryIdx].s) ? DATA[entryIdx].s : []);
          if(!Array.isArray(DATA[entryIdx].s)){
            DATA[entryIdx].s = currentSugs.map(function(s){
              return {
                t: (typeof sugTool === 'function') ? sugTool(s) : (s && (s.t || s.tool || s.technology || s.name) || ''),
                d: (typeof sugDesc === 'function') ? sugDesc(s) : (s && (s.d || s.desc || s.description || s.integration_idea || s.activity) || ''),
                ...(s && (s.url || s.lessonUrl) ? {url:s.url || s.lessonUrl} : {})
              };
            });
          }
          if(sugIdx < 0 || sugIdx >= DATA[entryIdx].s.length){ skippedInvalid++; return; }
          DATA[entryIdx].s[sugIdx] = url ? {t:t, d:d, url:url} : {t:t, d:d};
          DATA[entryIdx].audited = true;
          applied++;
          try { if(typeof isRealismAuditChange_ === 'function' && isRealismAuditChange_(c)) appliedRealismFixes = true; } catch(e){}
          try { if(typeof markEntryNeedsHumanRecheck_ === 'function') markEntryNeedsHumanRecheck_(entryIdx, 'AI suggestion change applied after human verification'); } catch(e){}
        }catch(oneErr){
          skippedInvalid++;
          console.warn('Skipped one Bulk AI change after apply error:', oneErr, c);
        }
      });

      try { overlay.remove(); } catch(e){}
      delete window._popupStates;
      delete window._popupChanges;
      delete window._popupUpdateCounter;

      bgSafeSave_();

      const bits = [];
      if(skippedDupes) bits.push(`skipped ${skippedDupes} duplicate${skippedDupes!==1?'s':''}`);
      if(skippedInvalid) bits.push(`skipped ${skippedInvalid} invalid change${skippedInvalid!==1?'s':''}`);
      const note = bits.length ? ' (' + bits.join(', ') + ')' : '';

      if(appliedRealismFixes && typeof rescanRealismAfterApprovedFixes_ === 'function'){
        try { if(typeof setStatus === 'function') setStatus(`${applied} suggestion${applied!==1?'s':''} updated and saved${note} — rescanning realism audit…`, 'loading'); } catch(e){}
        setTimeout(function(){
          try { rescanRealismAfterApprovedFixes_(applied, skippedDupes); }
          catch(err){ bgReport_(err, 'rescanRealismAfterApprovedFixes'); }
        }, 250);
      } else {
        try { if(typeof setStatus === 'function') setStatus(`${applied} suggestion${applied!==1?'s':''} updated and saved${note}`); } catch(e){}
      }

      try { if(typeof renderAuditChart === 'function') renderAuditChart(); } catch(e){ console.warn('renderAuditChart after bulk apply failed:', e); }
      try { if(typeof renderBrowse === 'function') renderBrowse(); } catch(e){ console.warn('renderBrowse after bulk apply failed:', e); }
      try { if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX !== null && typeof renderEntry === 'function') renderEntry(CURRENT_ENTRY_IDX); } catch(e){ console.warn('renderEntry after bulk apply failed:', e); }
    }catch(err){
      if(applyBtn){ applyBtn.disabled = false; applyBtn.textContent = '✓ Apply approved changes'; applyBtn.style.opacity = '1'; }
      bgReport_(err, 'applyChangesFromPopup');
    }
  };
})();
/* ===== end DLA hotfix ===== */


/* ===== DLA hotfix: prevent Page Unresponsive during Bulk/Realism apply =====
   Moves heavy Bulk AI apply and Realism rescan work into small browser-yielding chunks,
   and avoids expensive off-screen re-renders after applying changes. */
(function(){
  const PERF_YIELD_MS = 0;
  const PERF_APPLY_CHUNK = 8;
  const PERF_AUDIT_CHUNK = 6;

  function perfYield_(){ return new Promise(function(resolve){ setTimeout(resolve, PERF_YIELD_MS); }); }

  function perfPanelActive_(id){
    try{ const el = document.getElementById(id); return !!(el && el.classList.contains('active')); }
    catch(e){ return false; }
  }

  function perfSetStatus_(msg, type){
    try{ if(typeof setStatus === 'function') setStatus(msg, type); } catch(e){}
  }

  function perfCleanText_(value){
    try { if(typeof cleanSuggestionText_ === 'function') return cleanSuggestionText_(value); } catch(e){}
    return String(value == null ? '' : value).replace(/\s+/g,' ').trim();
  }

  function perfCleanUrl_(value){
    try { if(typeof cleanMinecraftLessonUrl_ === 'function') return cleanMinecraftLessonUrl_(value); } catch(e){}
    return String(value == null ? '' : value).trim();
  }

  function perfNormIndex_(value, fallback){
    try { if(typeof normaliseChangeIndex === 'function') return normaliseChangeIndex(value, fallback); } catch(e){}
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function perfNormChange_(raw){
    const original = raw || {};
    let c = original;
    try { if(typeof normaliseMinecraftChangeForEntry_ === 'function') c = normaliseMinecraftChangeForEntry_(original); } catch(e){ c = original; }
    return Object.assign({}, c, {
      entryIdx: perfNormIndex_(c.entryIdx != null ? c.entryIdx : c.entry_idx, -1),
      sugIdx: perfNormIndex_(c.sugIdx != null ? c.sugIdx : c.sug_idx, 0),
      t: perfCleanText_(c.t || c.tool || c.technology || c.name || ''),
      d: perfCleanText_(c.d || c.desc || c.description || c.integration_idea || c.activity || c.suggestion || ''),
      url: perfCleanUrl_(c.url || c.lessonUrl || ''),
      auditReason: perfCleanText_(c.auditReason || c.reason || c.flagReason || c.reviewReason || c.problem || '')
    });
  }

  function perfValidChange_(c){
    if(!c || !Number.isFinite(Number(c.entryIdx)) || !Number.isFinite(Number(c.sugIdx))) return false;
    if(typeof DATA === 'undefined' || !Array.isArray(DATA) || !DATA[c.entryIdx]) return false;
    return !!(String(c.t || '').trim() || String(c.d || '').trim());
  }

  function perfSafeSave_(){
    try{
      if(typeof saveToDrive !== 'function') return;
      const result = saveToDrive();
      if(result && typeof result.catch === 'function'){
        result.catch(function(err){
          console.warn('Drive save failed after Bulk/Realism apply:', err);
          perfSetStatus_('Changes applied locally, but Drive save failed: ' + (err && err.message ? err.message : err), 'error');
        });
      }
    }catch(err){
      console.warn('Drive save failed after Bulk/Realism apply:', err);
      perfSetStatus_('Changes applied locally, but Drive save failed: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  function perfRenderAfterApply_(changedIdxs){
    const ids = Array.from(changedIdxs || []);
    setTimeout(function(){
      try{
        // Do not rebuild every Browse row while the user is in Bulk/Realism. That large DOM rebuild was one source of freezes.
        if(perfPanelActive_('panel-browse') && typeof renderBrowse === 'function') renderBrowse();
      }catch(e){ console.warn('Deferred Browse render failed:', e); }
    }, 80);
    setTimeout(function(){
      try{
        // Audit chart is only visible in the Audit tab, not Bulk Tools.
        if(perfPanelActive_('panel-audit') && typeof renderAuditChart === 'function') renderAuditChart();
      }catch(e){ console.warn('Deferred Audit chart render failed:', e); }
    }, 140);
    setTimeout(function(){
      try{
        if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX !== null && ids.indexOf(CURRENT_ENTRY_IDX) !== -1 && typeof renderEntry === 'function'){
          renderEntry(CURRENT_ENTRY_IDX);
        }
      }catch(e){ console.warn('Deferred Entry render failed:', e); }
    }, 180);
  }

  // Cooperative, non-blocking Realism scan.
  if(typeof auditEntrySuggestions === 'function'){
    runFullRealismAudit = window.runFullRealismAudit = async function(){
      const btn = document.getElementById('btn-full-realism-audit');
      if(btn){ btn.disabled = true; btn.textContent = 'Scanning…'; }
      const all = [];
      const total = (Array.isArray(DATA) ? DATA.length : 0);
      try{
        for(let i = 0; i < total; i++){
          all.push(...auditEntrySuggestions(DATA[i], i));
          if(i % PERF_AUDIT_CHUNK === PERF_AUDIT_CHUNK - 1){
            if(btn) btn.textContent = `Scanning ${i + 1}/${total}…`;
            perfSetStatus_(`Scanning suggestions ${i + 1}/${total}…`, 'loading');
            await perfYield_();
          }
        }
        all.sort(function(a,b){
          const weight = {high:0, medium:1, low:2};
          return (weight[resultHighestSeverity(a)] || 9) - (weight[resultHighestSeverity(b)] || 9)
            || String(a.yl).localeCompare(String(b.yl))
            || String(a.th).localeCompare(String(b.th));
        });
        REALISM_AUDIT_RESULTS = all;
        await perfYield_();
        if(typeof renderRealismResults === 'function'){
          renderRealismResults(all, 'realism-audit-result', {maxHeight:'560px', limit:100});
        }
        perfSetStatus_(all.length ? `Realism audit complete — ${all.length} flagged` : 'Realism audit complete — no issues found');
        return all;
      }catch(err){
        console.error('Realism audit failed:', err);
        perfSetStatus_('Realism audit failed: ' + (err && err.message ? err.message : err), 'error');
        return all;
      }finally{
        if(btn){ btn.disabled = false; btn.textContent = 'Scan all suggestions'; }
      }
    };
  }

  rescanRealismAfterApprovedFixes_ = window.rescanRealismAfterApprovedFixes_ = async function(appliedCount, skippedDupes){
    try{
      const before = (REALISM_AUDIT_RESULTS || []).length;
      const results = await runFullRealismAudit();
      const after = (results || REALISM_AUDIT_RESULTS || []).length;
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
      perfSetStatus_('Fixes saved, but automatic rescan failed — run Scan all suggestions again.', 'error');
    }
  };

  // Main fix: applying approved changes now yields between small batches so Chrome does not flag the page as unresponsive.
  applyChangesFromPopup = window.applyChangesFromPopup = async function(){
    const overlay = document.getElementById('changes-popup-overlay');
    if(!overlay) return;
    const applyBtn = document.getElementById('popup-apply-btn');
    try{
      if(applyBtn){ applyBtn.disabled = true; applyBtn.textContent = 'Applying…'; applyBtn.style.opacity = '0.65'; }
      const rawChanges = window._popupChanges || [];
      const states = window._popupStates || [];
      const approved = [];
      rawChanges.forEach(function(raw, i){
        if(states[i] === 'approved'){
          const c = perfNormChange_(raw);
          if(perfValidChange_(c)) approved.push(c);
        }
      });

      let applied = 0;
      let skippedDupes = 0;
      let skippedInvalid = 0;
      let appliedRealismFixes = false;
      const changedIdxs = new Set();

      if(approved.length > 0 && typeof createSnapshot === 'function'){
        try{
          const snapName = window._snapshotReason || `Before applying ${approved.length} bulk change${approved.length!==1?'s':''}`;
          createSnapshot(snapName);
          delete window._snapshotReason;
        }catch(e){ console.warn('Snapshot before apply failed:', e); }
      }

      for(let i = 0; i < approved.length; i++){
        const c = approved[i];
        try{
          const entryIdx = Number(c.entryIdx);
          const sugIdx = Number(c.sugIdx);
          const t = perfCleanText_(c.t || c.tool || c.technology || c.name || '');
          const d = perfCleanText_(c.d || c.desc || c.description || c.integration_idea || c.activity || c.suggestion || '');
          const url = perfCleanUrl_(c.url || c.lessonUrl || '');
          if(!DATA[entryIdx] || !t || !d){ skippedInvalid++; continue; }
          if(typeof wouldDupeToolProposalInEntry === 'function' && wouldDupeToolProposalInEntry(DATA[entryIdx], t, sugIdx)){
            skippedDupes++;
            continue;
          }
          const currentSugs = (typeof getSugs === 'function') ? getSugs(DATA[entryIdx]) : (Array.isArray(DATA[entryIdx].s) ? DATA[entryIdx].s : []);
          if(!Array.isArray(DATA[entryIdx].s)){
            DATA[entryIdx].s = currentSugs.map(function(s){
              const tool = (typeof sugTool === 'function') ? sugTool(s) : (s && (s.t || s.tool || s.technology || s.name) || '');
              const desc = (typeof sugDesc === 'function') ? sugDesc(s) : (s && (s.d || s.desc || s.description || s.integration_idea || s.activity) || '');
              const item = {t:tool, d:desc};
              if(s && (s.url || s.lessonUrl)) item.url = s.url || s.lessonUrl;
              return item;
            });
          }
          if(sugIdx < 0 || sugIdx >= DATA[entryIdx].s.length){ skippedInvalid++; continue; }
          DATA[entryIdx].s[sugIdx] = url ? {t:t, d:d, url:url} : {t:t, d:d};
          DATA[entryIdx].audited = true;
          applied++;
          changedIdxs.add(entryIdx);
          try { if(typeof isRealismAuditChange_ === 'function' && isRealismAuditChange_(c)) appliedRealismFixes = true; } catch(e){}
          try { if(typeof markEntryNeedsHumanRecheck_ === 'function') markEntryNeedsHumanRecheck_(entryIdx, 'AI suggestion change applied after human verification'); } catch(e){}
        }catch(oneErr){
          skippedInvalid++;
          console.warn('Skipped one approved change:', oneErr, c);
        }

        if(i % PERF_APPLY_CHUNK === PERF_APPLY_CHUNK - 1){
          if(applyBtn) applyBtn.textContent = `Applying ${i + 1}/${approved.length}…`;
          perfSetStatus_(`Applying approved changes ${i + 1}/${approved.length}…`, 'loading');
          await perfYield_();
        }
      }

      try { overlay.remove(); } catch(e){}
      delete window._popupStates;
      delete window._popupChanges;
      delete window._popupUpdateCounter;

      await perfYield_();
      perfSafeSave_();

      const bits = [];
      if(skippedDupes) bits.push(`skipped ${skippedDupes} duplicate${skippedDupes!==1?'s':''}`);
      if(skippedInvalid) bits.push(`skipped ${skippedInvalid} invalid change${skippedInvalid!==1?'s':''}`);
      const note = bits.length ? ' (' + bits.join(', ') + ')' : '';

      if(appliedRealismFixes){
        perfSetStatus_(`${applied} suggestion${applied!==1?'s':''} updated${note} — rescanning realism audit…`, 'loading');
        setTimeout(function(){ rescanRealismAfterApprovedFixes_(applied, skippedDupes); }, 120);
      } else {
        perfSetStatus_(`${applied} suggestion${applied!==1?'s':''} updated${note} — saving in background`);
      }
      perfRenderAfterApply_(changedIdxs);
    }catch(err){
      console.error('Apply approved changes failed:', err);
      if(applyBtn){ applyBtn.disabled = false; applyBtn.textContent = '✓ Apply approved changes'; applyBtn.style.opacity = '1'; }
      try{
        if(typeof bulkChatAddMessage === 'function') bulkChatAddMessage('assistant', '⚠️ I could not apply those changes without freezing the page. Error: ' + (err && err.message ? err.message : err));
      }catch(e){}
      perfSetStatus_('Apply failed: ' + (err && err.message ? err.message : err), 'error');
    }
  };
})();
/* ===== end DLA hotfix ===== */


/* ===== DLA hotfix: concurrent admin merge-save protection =====
   Allows Nathan/Andrew to work at the same time by saving changed entries into
   the latest Drive data.json instead of overwriting the whole file from a stale tab. */
(function(){
  const BASELINE_FIELD = '__dlaMergeBaseline_v1';
  const SIG_FIELD = 'humanVerifiedSuggestionSignature';
  const VOLATILE_ENTRY_FIELDS = new Set([
    '_locks', '_mergeLocalTouchedAt', '_mergeLocalTouchedBy'
  ]);

  function mergeDeepClone_(value){
    try { return JSON.parse(JSON.stringify(value)); }
    catch(e){ return value; }
  }

  function mergeEntryKey_(entry){
    if(!entry) return '';
    const ca = String(entry.ca || entry.campus || '').trim().toLowerCase();
    const yl = String(entry.yl || entry.year || entry.yearLevel || '').trim().toLowerCase();
    const th = String(entry.th || entry.theme || entry.unit || entry.title || '').trim().toLowerCase();
    return [ca, yl, th].join('||');
  }

  function mergeOrdered_(value){
    if(Array.isArray(value)) return value.map(mergeOrdered_);
    if(value && typeof value === 'object'){
      const out = {};
      Object.keys(value).filter(k => !VOLATILE_ENTRY_FIELDS.has(k)).sort().forEach(k => out[k] = mergeOrdered_(value[k]));
      return out;
    }
    return value;
  }

  function mergeEntrySig_(entry){
    try { return JSON.stringify(mergeOrdered_(entry || {})); }
    catch(e){ return String(Date.now()) + Math.random(); }
  }

  function mergeSuggestionSig_(entry){
    try{
      const sugs = (typeof getSugs === 'function') ? getSugs(entry) : (Array.isArray(entry && entry.s) ? entry.s : []);
      const clean = function(v){
        try { if(typeof cleanSuggestionText_ === 'function') return cleanSuggestionText_(v); } catch(e){}
        return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
      };
      return JSON.stringify(sugs.map(function(s){
        const tool = (typeof sugTool === 'function') ? sugTool(s) : (s && (s.t || s.tool || s.technology || s.name) || '');
        const desc = (typeof sugDesc === 'function') ? sugDesc(s) : (s && (s.d || s.desc || s.description || s.integration_idea || s.activity) || '');
        return { t: clean(tool), d: clean(desc), url: clean(s && (s.url || s.lessonUrl || '')) };
      }));
    }catch(e){ return ''; }
  }

  function mergeIsHumanVerified_(entry){
    try { if(typeof isHumanVerifiedEntry_ === 'function') return isHumanVerifiedEntry_(entry); } catch(e){}
    return !!(entry && (entry.humanVerified === true || entry.humanVerifiedAt || entry.human_verified === true));
  }

  function mergeClearHumanVerified_(entry, reason){
    if(!entry) return;
    entry.humanVerified = false;
    delete entry.human_verified;
    delete entry.humanVerifiedAt;
    delete entry.humanVerifiedBy;
    delete entry.humanVerifiedReason;
    delete entry[SIG_FIELD];
    entry.humanVerifiedResetAt = new Date().toISOString();
    entry.humanVerifiedResetReason = reason || 'Suggestion changed after human verification';
  }

  function mergeDirtyCheckChangedEntries_(entries){
    let removed = 0;
    try{
      (entries || []).forEach(function(entry){
        if(!mergeIsHumanVerified_(entry)) return;
        const current = mergeSuggestionSig_(entry);
        if(!entry[SIG_FIELD]){
          entry[SIG_FIELD] = current;
          return;
        }
        if(entry[SIG_FIELD] !== current){
          mergeClearHumanVerified_(entry, 'Suggestion edited, swapped, regenerated or changed after human verification');
          removed++;
        }
      });
    }catch(e){ console.warn('Concurrent merge dirty human-check failed:', e); }
    return removed;
  }

  function mergeMakeBaselineFromData_(arr){
    const map = {};
    (Array.isArray(arr) ? arr : []).forEach(function(entry){
      const key = mergeEntryKey_(entry);
      if(key) map[key] = mergeEntrySig_(entry);
    });
    return map;
  }

  function mergeCaptureBaseline_(arr){
    try{
      window[BASELINE_FIELD] = mergeMakeBaselineFromData_(Array.isArray(arr) ? arr : DATA);
      window.__dlaMergeBaselineCapturedAt = Date.now();
    }catch(e){ window[BASELINE_FIELD] = {}; }
  }

  function mergeLocalMap_(){
    const map = new Map();
    (Array.isArray(DATA) ? DATA : []).forEach(function(entry, idx){
      const key = mergeEntryKey_(entry);
      if(key) map.set(key, { entry, idx });
    });
    return map;
  }

  function mergeLatestMap_(latest){
    const map = new Map();
    (Array.isArray(latest) ? latest : []).forEach(function(entry, idx){
      const key = mergeEntryKey_(entry);
      if(key) map.set(key, { entry, idx });
    });
    return map;
  }

  function mergeChangedLocalEntries_(){
    const baseline = window[BASELINE_FIELD] || {};
    const changed = [];
    const currentKeys = new Set();
    const local = mergeLocalMap_();
    local.forEach(function(info, key){
      currentKeys.add(key);
      if(!baseline[key] || baseline[key] !== mergeEntrySig_(info.entry)){
        changed.push({ key, type:'upsert', idx: info.idx, entry: info.entry, baselineSig: baseline[key] || '' });
      }
    });
    Object.keys(baseline).forEach(function(key){
      if(!currentKeys.has(key)) changed.push({ key, type:'delete', baselineSig: baseline[key] });
    });
    return changed;
  }

  async function mergeFetchLatestData_(){
    if(!DRIVE_FILE_ID || !DRIVE_TOKEN) throw new Error('Drive is not connected');
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media&cacheBust=${Date.now()}`, {
      headers: { 'Authorization': 'Bearer ' + DRIVE_TOKEN, 'Cache-Control': 'no-cache' }
    });
    if(!r.ok) throw new Error('Could not read latest data.json from Drive before saving');
    const d = await r.json();
    return Array.isArray(d) ? d : Object.values(d || {});
  }

  async function mergeUploadData_(arr){
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${DRIVE_FILE_ID}?uploadType=media`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+DRIVE_TOKEN},
      body:JSON.stringify(arr,null,2)
    });
    if(!r.ok) throw new Error('Drive save failed while uploading merged data.json');
  }

  function mergeConflictLabel_(entry, key){
    if(entry) return [entry.ca, entry.yl, entry.th].filter(Boolean).join(' · ');
    return key.replace(/\|\|/g, ' · ');
  }

  function mergeApplyLocalChangesToLatest_(latest, changes){
    const latestMap = mergeLatestMap_(latest);
    const conflicts = [];
    const changedEntriesForDirtyCheck = [];

    changes.forEach(function(change){
      if(change.type !== 'upsert') return;
      changedEntriesForDirtyCheck.push(change.entry);
    });
    mergeDirtyCheckChangedEntries_(changedEntriesForDirtyCheck);

    // Recompute local changes after possible human-verified reset fields were changed.
    changes = mergeChangedLocalEntries_();

    changes.forEach(function(change){
      const latestInfo = latestMap.get(change.key);
      const latestSig = latestInfo ? mergeEntrySig_(latestInfo.entry) : '';
      const latestMoved = !!(change.baselineSig && latestInfo && latestSig !== change.baselineSig);
      const sameAsLocal = latestInfo && latestSig === mergeEntrySig_(change.entry);
      if(latestMoved && !sameAsLocal){
        conflicts.push({ change, latestInfo, label: mergeConflictLabel_(latestInfo.entry, change.key) });
      }
    });

    let overwriteConflicts = true;
    if(conflicts.length){
      const names = conflicts.slice(0,8).map(c => '• ' + c.label).join('\n');
      const more = conflicts.length > 8 ? `\n…and ${conflicts.length - 8} more` : '';
      overwriteConflicts = confirm(`⚠ Same-unit conflict detected\n\nSomeone else has changed ${conflicts.length} unit${conflicts.length!==1?'s':''} you also changed since you loaded Studio.\n\n${names}${more}\n\nClick OK to overwrite those same units with your changes.\nClick Cancel to keep their latest version for those conflicted units and save only your non-conflicting changes.`);
    }

    const conflictKeys = new Set(conflicts.map(c => c.change.key));
    let applied = 0, skipped = 0, deleted = 0;

    changes.forEach(function(change){
      if(conflictKeys.has(change.key) && !overwriteConflicts){ skipped++; return; }
      const latestInfo = latestMap.get(change.key);
      if(change.type === 'delete'){
        if(latestInfo){
          const latestSig = mergeEntrySig_(latestInfo.entry);
          if(change.baselineSig && latestSig !== change.baselineSig && !overwriteConflicts){ skipped++; return; }
          latest.splice(latestInfo.idx, 1);
          deleted++;
          // Rebuild map indexes after splice.
          latestMap.clear();
          latest.forEach(function(entry, idx){ const key = mergeEntryKey_(entry); if(key) latestMap.set(key, {entry, idx}); });
        }
        return;
      }
      const cloned = mergeDeepClone_(change.entry);
      if(latestInfo){ latest[latestInfo.idx] = cloned; }
      else { latest.push(cloned); }
      applied++;
    });

    return { latest, applied, skipped, deleted, conflicts: conflicts.length };
  }

  async function saveToDriveConcurrentMerge_(){
    if(!DRIVE_FILE_ID || !DRIVE_TOKEN) return;

    if(!window[BASELINE_FIELD]) mergeCaptureBaseline_(DATA);

    try { if(typeof cleanAllDataSuggestionsHotfix_ === 'function') cleanAllDataSuggestionsHotfix_(); } catch(e){}

    const localChanges = mergeChangedLocalEntries_();
    const oldStart = window.startProgress || function(){};
    const oldStop = window.stopProgress || function(){};
    const quietMode = oldStart && String(oldStart).indexOf('function(){}') !== -1;

    if(!quietMode) startProgress();
    try{
      const latest = await mergeFetchLatestData_();
      let merged = latest;
      let summary = { applied:0, skipped:0, deleted:0, conflicts:0 };

      if(localChanges.length){
        summary = mergeApplyLocalChangesToLatest_(latest, localChanges);
        merged = summary.latest;
        await mergeUploadData_(merged);
      } else {
        // No local content changes: refresh this tab to the latest Drive copy without writing over anyone.
      }

      DATA = Array.isArray(merged) ? merged : Object.values(merged || {});
      mergeCaptureBaseline_(DATA);
      try{ localStorage.setItem('dla_data', JSON.stringify(DATA)); }catch(e){}

      const updated = await getDriveFileModified();
      if(updated) LAST_KNOWN_MODIFIED = updated.modifiedTime;

      const now = new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
      let msg = localChanges.length
        ? `Merged save at ${now}: ${summary.applied} unit${summary.applied!==1?'s':''} updated${summary.deleted?`, ${summary.deleted} deleted`:''}`
        : `Already up to date at ${now}`;
      if(summary.skipped) msg += ` · ${summary.skipped} same-unit conflict${summary.skipped!==1?'s':''} kept from Drive`;
      if(typeof setStatus === 'function') setStatus(msg, summary.skipped ? 'loading' : undefined);

      try{
        if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX !== null && typeof renderEntry === 'function') renderEntry(CURRENT_ENTRY_IDX);
      }catch(e){}
      return summary;
    }catch(e){
      if(typeof setStatus === 'function') setStatus('Merged Drive save failed: ' + (e.message || e), 'error');
      console.error('DLA concurrent merge save failed:', e);
      throw e;
    }finally{
      if(!quietMode) stopProgress();
    }
  }

  // Replace full-file saves with merge saves.
  saveToDrive = window.saveToDrive = saveToDriveConcurrentMerge_;

  // Important: the old lock heartbeat wrote the whole stale DATA array to Drive.
  // Disable Drive lock saves so opening/releasing an entry cannot overwrite Andrew's work.
  saveLocks = window.saveLocks = async function(){ return; };

  // Baseline the exact Drive version whenever data is loaded or reloaded.
  if(typeof ingest === 'function'){
    const oldIngest = ingest;
    ingest = window.ingest = function(){
      const out = oldIngest.apply(this, arguments);
      mergeCaptureBaseline_(DATA);
      return out;
    };
  }

  if(typeof reloadFromDrive === 'function'){
    const oldReloadFromDrive = reloadFromDrive;
    reloadFromDrive = window.reloadFromDrive = async function(){
      const out = await oldReloadFromDrive.apply(this, arguments);
      mergeCaptureBaseline_(DATA);
      return out;
    };
  }

  // Make the existing conflict banner less scary now that save is merge-safe.
  if(typeof updateConflictBar === 'function'){
    const oldUpdateConflictBar = updateConflictBar;
    updateConflictBar = window.updateConflictBar = function(msg){
      if(!msg) return oldUpdateConflictBar.apply(this, arguments);
      try{
        setStatus('⚠ ' + msg + ' Merge-save is on: your next save will fetch the latest Drive file and only merge your changed units. — ', 'loading', true);
        const el=document.getElementById('status-bar');
        if(el){
          const link=document.createElement('span');
          link.textContent='Reload latest now';
          link.style.cssText='text-decoration:underline;cursor:pointer;font-weight:700';
          link.onclick=reloadFromDrive;
          el.appendChild(link);
        }
      }catch(e){ oldUpdateConflictBar.apply(this, arguments); }
    };
  }

  // Initial baseline if this patch loads after DATA is already present.
  setTimeout(function(){
    try{ if(Array.isArray(DATA) && DATA.length && !window[BASELINE_FIELD]) mergeCaptureBaseline_(DATA); }catch(e){}
  }, 0);

  window.dlaConcurrentMergeDebug = function(){
    return {
      baselineEntries: Object.keys(window[BASELINE_FIELD] || {}).length,
      localChanges: mergeChangedLocalEntries_().map(c => ({ type:c.type, key:c.key, idx:c.idx }))
    };
  };
})();
/* ===== end DLA hotfix ===== */



/* ===== DLA hotfix: live multi-admin sync from Drive =====
   Keeps Nathan/Andrew tabs in sync after Human Verify or other saves.
   Polls Drive, fetches latest data.json, and merges remote changes for units this tab has not edited locally. */
(function(){
  const RT_BASELINE_FIELD = '__dlaRealtimeSyncBaseline_v1';
  const MERGE_BASELINE_FIELD = '__dlaMergeBaseline_v1';
  const RT_INTERVAL_MS = 5000;
  const RT_SYNC_BUTTON_ID = 'dla-manual-sync-btn';
  const RT_SYNC_LABEL_ID = 'dla-sync-status-chip';
  const VOLATILE_FIELDS = new Set(['_locks','_mergeLocalTouchedAt','_mergeLocalTouchedBy']);
  let rtTimer = null;
  let rtBusy = false;
  let rtLastSeenModified = null;
  let rtLastStatusAt = 0;

  function rtClone_(value){
    try { return JSON.parse(JSON.stringify(value)); }
    catch(e){ return value; }
  }

  function rtKey_(entry){
    if(!entry) return '';
    const ca = String(entry.ca || entry.campus || '').trim().toLowerCase();
    const yl = String(entry.yl || entry.year || entry.yearLevel || '').trim().toLowerCase();
    const th = String(entry.th || entry.theme || entry.unit || entry.title || '').trim().toLowerCase();
    return [ca, yl, th].join('||');
  }

  function rtOrdered_(value){
    if(Array.isArray(value)) return value.map(rtOrdered_);
    if(value && typeof value === 'object'){
      const out = {};
      Object.keys(value).filter(k => !VOLATILE_FIELDS.has(k)).sort().forEach(k => out[k] = rtOrdered_(value[k]));
      return out;
    }
    return value;
  }

  function rtSig_(entry){
    try { return JSON.stringify(rtOrdered_(entry || {})); }
    catch(e){ return String(Date.now()) + Math.random(); }
  }

  function rtMakeBaseline_(arr){
    const out = {};
    (Array.isArray(arr) ? arr : []).forEach(function(entry){
      const key = rtKey_(entry);
      if(key) out[key] = rtSig_(entry);
    });
    return out;
  }

  function rtGetBaseline_(){
    const mergeBase = window[MERGE_BASELINE_FIELD];
    if(mergeBase && typeof mergeBase === 'object') return mergeBase;
    if(window[RT_BASELINE_FIELD] && typeof window[RT_BASELINE_FIELD] === 'object') return window[RT_BASELINE_FIELD];
    const fresh = rtMakeBaseline_(DATA);
    window[RT_BASELINE_FIELD] = fresh;
    return fresh;
  }

  function rtSetBaseline_(arrOrMap){
    const map = Array.isArray(arrOrMap) ? rtMakeBaseline_(arrOrMap) : (arrOrMap || {});
    window[RT_BASELINE_FIELD] = map;
    // Keep the concurrent merge-save patch aligned so later saves only contain genuine local changes.
    window[MERGE_BASELINE_FIELD] = rtClone_(map);
    return map;
  }

  function rtMap_(arr){
    const map = new Map();
    (Array.isArray(arr) ? arr : []).forEach(function(entry, idx){
      const key = rtKey_(entry);
      if(key) map.set(key, {entry, idx});
    });
    return map;
  }

  function rtLocalChangedKeys_(){
    const baseline = rtGetBaseline_();
    const localMap = rtMap_(DATA);
    const changed = new Set();
    localMap.forEach(function(info, key){
      if(!baseline[key] || baseline[key] !== rtSig_(info.entry)) changed.add(key);
    });
    Object.keys(baseline).forEach(function(key){
      if(!localMap.has(key)) changed.add(key);
    });
    return changed;
  }

  async function rtFetchLatestData_(){
    if(!DRIVE_FILE_ID || !DRIVE_TOKEN) throw new Error('Drive is not connected');
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media&cacheBust=${Date.now()}`, {
      headers: { 'Authorization':'Bearer ' + DRIVE_TOKEN, 'Cache-Control':'no-cache' }
    });
    if(!r.ok) throw new Error('Could not fetch latest data.json from Drive');
    const d = await r.json();
    return Array.isArray(d) ? d : Object.values(d || {});
  }

  function rtActivePanelId_(){
    try { return document.querySelector('.panel.active')?.id || ''; }
    catch(e){ return ''; }
  }

  function rtHasReviewPopup_(){
    return !!document.getElementById('changes-popup-overlay');
  }

  function rtRememberCurrentEntryKey_(){
    try{
      if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX !== null && DATA && DATA[CURRENT_ENTRY_IDX]) return rtKey_(DATA[CURRENT_ENTRY_IDX]);
    }catch(e){}
    return '';
  }

  function rtRestoreCurrentEntryIdx_(key){
    if(!key) return;
    try{
      const found = (DATA || []).findIndex(e => rtKey_(e) === key);
      if(found >= 0) CURRENT_ENTRY_IDX = found;
    }catch(e){}
  }

  function rtRenderAfterSync_(changedKeys, currentKey){
    try { rtRestoreCurrentEntryIdx_(currentKey); } catch(e){}
    const active = rtActivePanelId_();
    try{
      if(typeof CURRENT_ENTRY_IDX !== 'undefined' && CURRENT_ENTRY_IDX !== null && typeof renderEntry === 'function'){
        renderEntry(CURRENT_ENTRY_IDX);
      } else if(active === 'panel-browse' && typeof renderBrowse === 'function') renderBrowse();
      else if(active === 'panel-dashboard' && typeof renderDashboard === 'function') renderDashboard();
      else if(active === 'panel-audit' && typeof renderAuditChart === 'function') renderAuditChart();
      else if(active === 'panel-tools'){
        if(typeof renderBulkWelcome === 'function') renderBulkWelcome();
        if(typeof renderToolInventory === 'function') renderToolInventory();
      }
    }catch(e){ console.warn('Realtime sync render failed:', e); }
  }

  function rtStatus_(msg, type){
    // Avoid spamming the status bar while Andrew/Nathan are saving frequently.
    if(Date.now() - rtLastStatusAt < 3500) return;
    rtLastStatusAt = Date.now();
    try { if(typeof setStatus === 'function') setStatus(msg, type); } catch(e){}
    rtUpdateSyncChip_(msg);
  }

  function rtUpdateSyncChip_(msg){
    try{
      const chip = document.getElementById(RT_SYNC_LABEL_ID);
      if(!chip) return;
      const now = new Date();
      const time = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
      chip.textContent = msg ? ('Last sync: ' + time) : ('Sync every 5s');
      chip.title = msg || 'Drive sync checks every 5 seconds while this tab is visible.';
    }catch(e){}
  }

  function rtInstallManualSyncButton_(){
    try{
      if(document.getElementById(RT_SYNC_BUTTON_ID)) return;
      const status = document.getElementById('status-bar');
      if(!status) return;
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:10px;vertical-align:middle';
      const chip = document.createElement('span');
      chip.id = RT_SYNC_LABEL_ID;
      chip.textContent = 'Sync every 5s';
      chip.style.cssText = 'font-size:10px;color:var(--dim);font-weight:700;border:1px solid var(--border);border-radius:999px;padding:3px 8px;background:rgba(255,255,255,.03)';
      const btn = document.createElement('button');
      btn.id = RT_SYNC_BUTTON_ID;
      btn.type = 'button';
      btn.textContent = '↻ Sync now';
      btn.title = 'Pull the latest data.json changes from Drive now.';
      btn.className = 'btn-sm';
      btn.style.cssText = 'font-size:10px;padding:3px 8px;border-radius:999px';
      btn.onclick = async function(){
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = 'Syncing…';
        try{
          await syncFromDriveNow_('manual');
          rtUpdateSyncChip_('Manual sync complete');
        }finally{
          btn.disabled = false;
          btn.textContent = old;
        }
      };
      wrap.appendChild(chip);
      wrap.appendChild(btn);
      status.appendChild(wrap);
    }catch(e){ console.warn('Could not install sync button', e); }
  }

  function rtReplaceAll_(latest, currentKey){
    DATA = Array.isArray(latest) ? latest : Object.values(latest || {});
    rtSetBaseline_(DATA);
    try { localStorage.removeItem('dla_data'); } catch(e){}
    rtRenderAfterSync_(new Set(), currentKey);
  }

  function rtMergeUntouched_(latest, localChangedKeys, currentKey){
    const latestMap = rtMap_(latest);
    const localMap = rtMap_(DATA);
    const baseline = rtClone_(rtGetBaseline_());
    const changedKeys = new Set();

    latestMap.forEach(function(info, key){
      if(localChangedKeys.has(key)) return; // preserve this tab's unsaved local work
      const localInfo = localMap.get(key);
      const latestSig = rtSig_(info.entry);
      if(!localInfo){
        DATA.push(rtClone_(info.entry));
        changedKeys.add(key);
      } else if(rtSig_(localInfo.entry) !== latestSig){
        DATA[localInfo.idx] = rtClone_(info.entry);
        changedKeys.add(key);
      }
      baseline[key] = latestSig;
    });

    // Remove entries deleted remotely only if this tab has not changed them locally.
    const remoteKeys = new Set(latestMap.keys());
    for(let i = DATA.length - 1; i >= 0; i--){
      const key = rtKey_(DATA[i]);
      if(!key || remoteKeys.has(key) || localChangedKeys.has(key)) continue;
      DATA.splice(i, 1);
      delete baseline[key];
      changedKeys.add(key);
    }

    rtSetBaseline_(baseline);
    try { localStorage.removeItem('dla_data'); } catch(e){}
    if(changedKeys.size) rtRenderAfterSync_(changedKeys, currentKey);
    return changedKeys.size;
  }

  async function syncFromDriveNow_(reason){
    if(rtBusy || !DRIVE_FILE_ID || !DRIVE_TOKEN) return {synced:false, reason:'busy-or-disconnected'};
    if(document.hidden && reason !== 'manual' && reason !== 'visible') return {synced:false, reason:'hidden'};
    rtBusy = true;
    try{
      const meta = await getDriveFileModified();
      if(!meta || !meta.modifiedTime) return {synced:false, reason:'no-meta'};
      const remoteModified = meta.modifiedTime;
      const known = rtLastSeenModified || LAST_KNOWN_MODIFIED;
      if(!['manual','force','after-save','human-verify'].includes(reason) && known && remoteModified === known) return {synced:false, reason:'same-modified'};
      if(reason === 'manual' && known && remoteModified === known){
        rtStatus_('Already up to date with Drive ✓');
        return {synced:false, reason:'same-modified'};
      }
      // force/after-save/human-verify deliberately bypass the modified-time shortcut so
      // the tab can pull any merge-preserved edits immediately after a local save.

      rtLastSeenModified = remoteModified;
      LAST_KNOWN_MODIFIED = remoteModified;

      // Do not disrupt the review popup while someone is approving a batch. The next poll will sync.
      if(rtHasReviewPopup_() && reason !== 'manual') return {synced:false, reason:'review-popup-open'};

      const currentKey = rtRememberCurrentEntryKey_();
      const latest = await rtFetchLatestData_();
      const localChanged = rtLocalChangedKeys_();

      if(!localChanged.size){
        rtReplaceAll_(latest, currentKey);
        const who = meta.lastModifyingUser?.displayName || 'another admin';
        rtStatus_('Synced latest Drive changes from ' + who + ' ✓');
        return {synced:true, full:true};
      }

      const count = rtMergeUntouched_(latest, localChanged, currentKey);
      if(count){
        const who = meta.lastModifyingUser?.displayName || 'another admin';
        rtStatus_('Synced ' + count + ' update' + (count!==1?'s':'') + ' from ' + who + ' · your local edits were preserved', 'loading');
      }
      return {synced:!!count, partial:true, count};
    }catch(e){
      console.warn('DLA realtime sync failed:', e);
      if(reason === 'manual') rtStatus_('Sync failed: ' + (e.message || e), 'error');
      return {synced:false, error:e};
    }finally{
      rtBusy = false;
    }
  }

  function startRealtimeSync_(){
    try{
      if(typeof CONFLICT_POLL_INTERVAL !== 'undefined' && CONFLICT_POLL_INTERVAL){
        clearInterval(CONFLICT_POLL_INTERVAL);
        CONFLICT_POLL_INTERVAL = null;
      }
    }catch(e){}
    rtInstallManualSyncButton_();
    if(rtTimer) return;
    rtLastSeenModified = LAST_KNOWN_MODIFIED || rtLastSeenModified;
    rtSetBaseline_(DATA || []);
    rtTimer = setInterval(function(){ syncFromDriveNow_('poll'); }, RT_INTERVAL_MS);
    rtUpdateSyncChip_('Drive sync checks every 5 seconds');
  }

  // Replace the old conflict-only polling with live sync polling.
  startConflictPolling = window.startConflictPolling = startRealtimeSync_;

  // Keep baselines aligned after initial load/reload/save.
  if(typeof ingest === 'function'){
    const oldIngest = ingest;
    ingest = window.ingest = function(){
      const out = oldIngest.apply(this, arguments);
      rtSetBaseline_(DATA || []);
      rtLastSeenModified = LAST_KNOWN_MODIFIED || rtLastSeenModified;
      startRealtimeSync_();
      return out;
    };
  }

  if(typeof reloadFromDrive === 'function'){
    const oldReloadFromDrive = reloadFromDrive;
    reloadFromDrive = window.reloadFromDrive = async function(){
      const out = await oldReloadFromDrive.apply(this, arguments);
      rtSetBaseline_(DATA || []);
      rtLastSeenModified = LAST_KNOWN_MODIFIED || rtLastSeenModified;
      return out;
    };
  }

  if(typeof saveToDrive === 'function'){
    const oldSaveToDrive = saveToDrive;
    saveToDrive = window.saveToDrive = async function(){
      const out = await oldSaveToDrive.apply(this, arguments);
      rtSetBaseline_(DATA || []);
      rtLastSeenModified = LAST_KNOWN_MODIFIED || rtLastSeenModified;
      return out;
    };
  }

  document.addEventListener('visibilitychange', function(){
    if(!document.hidden) syncFromDriveNow_('visible');
  });

  // Expose a small manual helper for testing with Andrew.
  window.syncLatestDLAChangesNow = function(){ return syncFromDriveNow_('manual'); };
  window.syncLatestDLAChangesNowForced = function(reason){ return syncFromDriveNow_(reason || 'force'); };
  window.ensureDLASyncControls = rtInstallManualSyncButton_;
  window.updateDLASyncChip = rtUpdateSyncChip_;

  setTimeout(function(){
    try{
      if(Array.isArray(DATA) && DATA.length){
        rtSetBaseline_(DATA);
        startRealtimeSync_();
        syncFromDriveNow_('initial');
      }
    }catch(e){}
  }, 0);
})();
/* ===== end DLA hotfix ===== */



/* ===== DLA hotfix: map tools, Delightex naming, Year 6 maintenance, Minecraft links ===== */
(function(){
  const NATGEO_TOOL = 'National Geographic MapMaker';
  const NATGEO_URL = 'https://education.nationalgeographic.org/resource/mapmaker/';

  function dqText_(value){
    let s = String(value || '');
    if(typeof cleanSuggestionText_ === 'function') s = cleanSuggestionText_(s);
    s = s
      .replace(/\bDelightex\s*\(\s*CoSpaces\s*\)/gi, 'Delightex')
      .replace(/\bCoSpaces\s*\(\s*Delightex\s*\)/gi, 'Delightex')
      .replace(/\bCoSpaces\b/gi, 'Delightex')
      .replace(/\bCoSpace\b/gi, 'Delightex');
    return s.trim();
  }

  function dqKey_(tool){
    try { return toolInventoryKey(tool); }
    catch(e){ return String(tool || '').toLowerCase().trim(); }
  }

  function dqTool_(tool){
    const raw = dqText_(tool);
    const k = raw.toLowerCase().replace(/[’']/g,'').trim();
    if(/^(nat\s*geo|national geographic)\s*map\s*maker$/.test(k) || k === 'national geographic mapmaker' || k === 'mapmaker') return NATGEO_TOOL;
    if(/^(delightex|cospaces|cospaces edu|cospaces edu pro|delightex cospaces|delightex \(cospaces\))$/i.test(raw)) return 'Delightex';
    if(typeof normaliseToolName === 'function'){
      const n = normaliseToolName(raw);
      if(/cospaces/i.test(n)) return 'Delightex';
      return dqText_(n);
    }
    return raw;
  }

  function dqDescriptionSuggestsAnnotatedMap_(desc){
    const s = String(desc || '').toLowerCase();
    return /\b(annotat|label|layer|data layer|custom map|map maker|mapmaker|gis|heat ?map|choropleth|measure distance|measure area|plot data|plot points|overlay|spatial data|thematic map)\b/.test(s)
      && !/\bstreet\s*view\b/.test(s);
  }

  function dqDescriptionSuggestsStreetView_(desc){
    return /\bstreet\s*view\b|\b360\b|\bvirtual walk\b|\bwalk through\b|\bground[- ]level\b/i.test(String(desc || ''));
  }

  function dqRewriteMapDescription_(tool, desc){
    let d = dqText_(desc);
    if(dqKey_(tool) === dqKey_(NATGEO_TOOL)){
      d = d
        .replace(/\bGoogle Maps\b/gi, NATGEO_TOOL)
        .replace(/\bStreet View\b/gi, 'map layers')
        .replace(/\bannotate in maps\b/gi, 'add labels and data layers in MapMaker');
      if(!/mapmaker|map maker|data layer|layer|annotat|label|gis/i.test(d)){
        d += ' Students add labels, map layers or simple spatial evidence so their map becomes an explanation rather than just a location search.';
      }
    }
    if(dqKey_(tool) === dqKey_('Google Maps')){
      d = d.replace(/\bannotat(e|ed|ing|ions?)\b/gi, 'observe').replace(/\blayer(s|ed)?\b/gi, 'Street View evidence');
      if(!dqDescriptionSuggestsStreetView_(d)){
        d += ' Students use Street View to observe ground-level evidence, compare places and capture notes that connect directly to the unit.';
      }
    }
    return d.replace(/\s{2,}/g,' ').trim();
  }

  function dqSanitiseSuggestion_(sug){
    if(!sug) return sug;
    const out = Object.assign({}, sug);
    const originalTool = (typeof sugTool === 'function') ? sugTool(out) : (out.t || out.tool || out.name || '');
    const originalDesc = (typeof sugDesc === 'function') ? sugDesc(out) : (out.d || out.desc || out.description || '');
    let tool = dqTool_(originalTool);
    let desc = dqText_(originalDesc);

    if(dqKey_(tool) === dqKey_('Google Maps') && dqDescriptionSuggestsAnnotatedMap_(desc)){
      tool = NATGEO_TOOL;
    }
    if(dqKey_(tool) === dqKey_('Google Maps')) desc = dqRewriteMapDescription_(tool, desc);
    if(dqKey_(tool) === dqKey_(NATGEO_TOOL)) desc = dqRewriteMapDescription_(tool, desc);

    out.t = tool;
    out.d = desc;
    if(out.tool != null) out.tool = tool;
    if(out.technology != null) out.technology = tool;
    if(out.name != null) out.name = tool;
    if(out.desc != null) out.desc = desc;
    if(out.description != null) out.description = desc;
    if(out.integration_idea != null) out.integration_idea = desc;
    if(out.activity != null) out.activity = desc;
    if(out.url != null) out.url = dqText_(out.url);
    return out;
  }

  function dqSanitiseDataSet_(data){
    if(!Array.isArray(data)) return data;
    data.forEach(entry => {
      if(!entry) return;
      if(Array.isArray(entry.s)) entry.s = entry.s.map(dqSanitiseSuggestion_);
      else if(entry.s && typeof entry.s === 'object') Object.keys(entry.s).forEach(k => { entry.s[k] = dqSanitiseSuggestion_(entry.s[k]); });
    });
    return data;
  }

  function dqAddNatGeoToInventory_(){
    try{
      if(Array.isArray(DEFAULT_APPROVED_TOOLS) && !DEFAULT_APPROVED_TOOLS.some(t => dqKey_(t) === dqKey_(NATGEO_TOOL))){
        DEFAULT_APPROVED_TOOLS.push(NATGEO_TOOL);
      }
      if(typeof DEFAULT_TOOL_AGE_RANGES === 'object' && DEFAULT_TOOL_AGE_RANGES){
        DEFAULT_TOOL_AGE_RANGES[NATGEO_TOOL] = {min:3,max:6};
      }
      if(typeof TOOL_WHITELIST !== 'undefined' && Array.isArray(TOOL_WHITELIST)){
        ['national geographic mapmaker','national geographic map maker','nat geo mapmaker','mapmaker','delightex'].forEach(v => { if(!TOOL_WHITELIST.includes(v)) TOOL_WHITELIST.push(v); });
      }
      if(typeof TOOL_INVENTORY !== 'undefined'){
        normaliseToolInventory?.();
        TOOL_INVENTORY.approved = TOOL_INVENTORY.approved || [];
        TOOL_INVENTORY.ageRanges = TOOL_INVENTORY.ageRanges || {};
        const banned = (TOOL_INVENTORY.banned || []).some(t => dqKey_(t) === dqKey_(NATGEO_TOOL));
        const already = TOOL_INVENTORY.approved.some(t => dqKey_(t) === dqKey_(NATGEO_TOOL));
        if(!banned && !already){
          TOOL_INVENTORY.approved.push(NATGEO_TOOL);
          TOOL_INVENTORY.ageRanges[dqKey_(NATGEO_TOOL)] = {min:3,max:6};
        }
      }
    }catch(e){ console.warn('NatGeo inventory seed failed:', e); }
  }

  dqAddNatGeoToInventory_();

  if(typeof normaliseToolName === 'function'){
    const oldNormaliseToolName = normaliseToolName;
    normaliseToolName = window.normaliseToolName = function(t){
      const raw = dqText_(t);
      const k = raw.toLowerCase().replace(/[’']/g,'').trim();
      if(/^(nat\s*geo|national geographic)\s*map\s*maker$/.test(k) || k === 'national geographic mapmaker' || k === 'mapmaker') return NATGEO_TOOL;
      if(/cospaces/i.test(raw)) return 'Delightex';
      return dqText_(oldNormaliseToolName.call(this, raw));
    };
  }

  if(typeof getDefaultToolAgeRange === 'function'){
    const oldGetDefaultToolAgeRange = getDefaultToolAgeRange;
    getDefaultToolAgeRange = window.getDefaultToolAgeRange = function(toolName){
      if(dqKey_(toolName) === dqKey_(NATGEO_TOOL)) return {min:3,max:6};
      return oldGetDefaultToolAgeRange.apply(this, arguments);
    };
  }

  if(typeof getAgeAppropriateTools === 'function'){
    const oldGetAgeAppropriateTools = getAgeAppropriateTools;
    getAgeAppropriateTools = window.getAgeAppropriateTools = function(yearLevel){
      const list = oldGetAgeAppropriateTools.apply(this, arguments) || [];
      const yr = (typeof getYearNumber === 'function') ? getYearNumber(yearLevel) : 0;
      const banned = (typeof TOOL_INVENTORY !== 'undefined' && (TOOL_INVENTORY.banned || []).some(t => dqKey_(t) === dqKey_(NATGEO_TOOL)));
      if(yr >= 3 && !banned && !list.some(t => dqKey_(t) === dqKey_(NATGEO_TOOL))) list.push(NATGEO_TOOL);
      return list.map(dqTool_).filter((t,i,a) => a.findIndex(x => dqKey_(x) === dqKey_(t)) === i);
    };
  }

  if(typeof buildToolConstraints === 'function'){
    const oldBuildToolConstraints = buildToolConstraints;
    buildToolConstraints = window.buildToolConstraints = function(yearLevel){
      return oldBuildToolConstraints.apply(this, arguments) + `\n\nMAP TOOL RULES (HARD):\n- Google Maps is for Street View only: virtual walks, ground-level observation, comparing places through Street View, and gathering visual evidence.\n- Do NOT use Google Maps for annotated maps, custom maps, layers, data overlays or GIS-style mapping.\n- For annotated maps, labels, layers, plotted data or GIS-style map products, use ${NATGEO_TOOL}.\n- If a prompt asks for an annotated map, choose ${NATGEO_TOOL}, not Google Maps.\n\nNAMING RULE (HARD):\n- Do not write CoSpaces. The current tool name is Delightex. Use tool name \"Delightex\" only.`;
    };
  }

  if(typeof seedDefaultInventoryIfEmpty === 'function'){
    const oldSeedDefaultInventoryIfEmpty = seedDefaultInventoryIfEmpty;
    seedDefaultInventoryIfEmpty = window.seedDefaultInventoryIfEmpty = function(){
      const out = oldSeedDefaultInventoryIfEmpty.apply(this, arguments);
      dqAddNatGeoToInventory_();
      return out;
    };
  }

  if(typeof buildApprovedToolsList === 'function'){
    const oldBuildApprovedToolsList = buildApprovedToolsList;
    buildApprovedToolsList = window.buildApprovedToolsList = function(){
      dqAddNatGeoToInventory_();
      return oldBuildApprovedToolsList.apply(this, arguments).replace(/CoSpaces/gi, 'Delightex');
    };
  }

  if(typeof buildDynamicToolAgeGuide === 'function'){
    const oldBuildDynamicToolAgeGuide = buildDynamicToolAgeGuide;
    buildDynamicToolAgeGuide = window.buildDynamicToolAgeGuide = function(){
      dqAddNatGeoToInventory_();
      let out = oldBuildDynamicToolAgeGuide.apply(this, arguments).replace(/CoSpaces/gi, 'Delightex');
      if(!/National Geographic MapMaker/.test(out)) out += `\n- ${NATGEO_TOOL}: Year 3–Year 6`;
      out += `\nGoogle Maps: Street View only. ${NATGEO_TOOL}: annotated maps, map layers, plotted data and GIS-style map products.`;
      return out;
    };
  }

  if(typeof cleanSuggestionObject_ === 'function'){
    const oldCleanSuggestionObject = cleanSuggestionObject_;
    cleanSuggestionObject_ = window.cleanSuggestionObject_ = function(s){ return dqSanitiseSuggestion_(oldCleanSuggestionObject.apply(this, arguments)); };
  }

  if(typeof normaliseChanges === 'function'){
    const oldNormaliseChanges = normaliseChanges;
    normaliseChanges = window.normaliseChanges = function(raw){
      return (oldNormaliseChanges.apply(this, arguments) || []).map(c => {
        const fixed = dqSanitiseSuggestion_(c);
        return Object.assign(c, fixed, { t: fixed.t || c.t, d: fixed.d || c.d });
      });
    };
  }

  if(typeof showChangesPopup === 'function'){
    const oldShowChangesPopup = showChangesPopup;
    showChangesPopup = window.showChangesPopup = function(changes){
      return oldShowChangesPopup.call(this, (changes || []).map(c => Object.assign(c, dqSanitiseSuggestion_(c))));
    };
  }

  // Lesson-library matching helpers for missing Minecraft links.
  function dqLessonTitleFromSuggestion_(sug){
    const tool = (typeof sugTool === 'function') ? sugTool(sug) : (sug.t || '');
    const desc = (typeof sugDesc === 'function') ? sugDesc(sug) : (sug.d || '');
    const text = dqText_(tool + ' ' + desc);
    const patterns = [
      /lesson\s+[“\"]([^”\"]+)[”\"]/i,
      /verified\s+Minecraft\s+Education\s+lesson\s+[“\"]([^”\"]+)[”\"]/i,
      /Minecraft\s*(?:Education)?\s*[:—-]\s*([^\n.()]+)/i
    ];
    for(const re of patterns){ const m = text.match(re); if(m && m[1]) return dqText_(m[1]); }
    return '';
  }

  function dqFindMinecraftLesson_(sug){
    try{
      const lessons = (typeof LIBRARIES !== 'undefined' && Array.isArray(LIBRARIES.minecraft)) ? LIBRARIES.minecraft : [];
      if(!lessons.length) return null;
      const desc = dqText_(((typeof sugDesc === 'function') ? sugDesc(sug) : (sug.d || '')) + ' ' + ((typeof sugTool === 'function') ? sugTool(sug) : (sug.t || '')));
      const wanted = dqLessonTitleFromSuggestion_(sug).toLowerCase();
      if(wanted){
        const exact = lessons.find(l => dqText_(l.title || '').toLowerCase() === wanted);
        if(exact) return exact;
        const loose = lessons.find(l => dqText_(l.title || '').toLowerCase().includes(wanted) || wanted.includes(dqText_(l.title || '').toLowerCase()));
        if(loose) return loose;
      }
      const inText = lessons.find(l => l.title && desc.toLowerCase().includes(dqText_(l.title).toLowerCase()));
      return inText || null;
    }catch(e){ return null; }
  }

  function dqPatchMinecraftLink_(sug){
    const out = dqSanitiseSuggestion_(sug);
    const tool = (typeof sugTool === 'function') ? sugTool(out) : (out.t || '');
    const desc = (typeof sugDesc === 'function') ? sugDesc(out) : (out.d || '');
    if(!/minecraft/i.test(tool + ' ' + desc)) return out;
    if(out.url || /https?:\/\//i.test(desc)) return out;
    const lesson = dqFindMinecraftLesson_(out);
    if(lesson && lesson.url){
      out.t = 'Minecraft Education';
      out.url = lesson.url;
      const cleanDesc = dqText_(desc);
      out.d = /verified lesson link/i.test(cleanDesc) ? cleanDesc : cleanDesc + ' Verified lesson link: ' + lesson.url;
      if(out.desc != null) out.desc = out.d;
      if(out.description != null) out.description = out.d;
    }
    return out;
  }

  function dqSanitiseDataWithLinks_(data){
    dqSanitiseDataSet_(data);
    if(!Array.isArray(data)) return data;
    data.forEach(entry => {
      if(!entry || !entry.s) return;
      if(Array.isArray(entry.s)) entry.s = entry.s.map(dqPatchMinecraftLink_);
      else if(typeof entry.s === 'object') Object.keys(entry.s).forEach(k => { entry.s[k] = dqPatchMinecraftLink_(entry.s[k]); });
    });
    return data;
  }

  if(typeof saveToDrive === 'function'){
    const oldSaveToDrive = saveToDrive;
    saveToDrive = window.saveToDrive = async function(){
      dqSanitiseDataWithLinks_(DATA);
      return oldSaveToDrive.apply(this, arguments);
    };
  }

  if(typeof ingest === 'function'){
    const oldIngest = ingest;
    ingest = window.ingest = function(arr){
      dqSanitiseDataSet_(arr);
      const out = oldIngest.apply(this, arguments);
      dqAddNatGeoToInventory_();
      return out;
    };
  }

  function dqIsStKildaYear6_(e){
    return e && /^year\s*6$/i.test(String(e.yl || '').trim()) && /st\s*kilda/i.test(String(e.ca || ''));
  }

  function dqSplitLooseLoi_(lo){
    // Robustly split LOIs that were pasted/exported with corrupted bullet symbols.
    // St Kilda Road Year 6 had separators such as  , â€¢, Â•, ï‚· and other odd glyphs,
    // so this recognises far more than just semicolons and normal bullets.
    let s = dqText_(lo)
      .replace(/\u00a0/g, ' ')
      .replace(/â\s*[€¢·]/gi, '; ')
      .replace(/Â\s*[•·]/gi, '; ')
      .replace(/ï\s*‚\s*·/gi, '; ')
      .replace(/[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25AA\u25AB\u25A0\u25A1\u25C6\u25C7\u25B8\u25B6\uF0B7]+/g, '; ')
      .replace(/\s*[|¦§]+\s*/g, '; ')
      .replace(/\s*[ ]+\s*/g, '; ')
      .replace(/\s+/g,' ')
      .trim();
    if(!s) return '';

    function cleanPart_(x){
      return dqText_(x)
        .replace(/^(?:\d+[.)]|LOI\s*\d+[:.)-]?|Line\s+of\s+Inquiry\s*\d+[:.)-]?)\s*/i,'')
        .replace(/^[\-–—:;,.\s]+|[\-–—:;,.\s]+$/g,'')
        .trim();
    }

    let parts = s.split(/\s*;\s*/).map(cleanPart_).filter(Boolean);
    if(parts.length <= 1){
      parts = s.split(/\s+(?=(?:\d+[.)]|LOI\s*\d+|Line\s+of\s+Inquiry\s*\d+))/i).map(cleanPart_).filter(Boolean);
    }
    if(parts.length <= 1){
      // Split common planner phrasing only when it appears to mark a new LOI.
      parts = s.split(/\s+(?=(?:How|Why|The ways?|Ways?|Factors?|The impact|Impact|Connections?|Relationships?|Responsibilities?|Perspectives?|Systems?|Strategies?|Changes?|Different ways?|Our role|People can|People use|Communities?|Environments?)\b)/g).map(cleanPart_).filter(Boolean);
    }
    // Remove accidental duplicates while keeping original order.
    const seen = new Set();
    parts = parts.filter(p => {
      const key = p.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      if(!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if(parts.length > 1) return parts.slice(0,4).join('; ');
    return s;
  }

  async function dqBuildYear6StKildaPatch_(entryIdx){
    const entry = DATA[entryIdx];
    const oldLo = dqText_(entry.lo || '');
    const roughLo = dqSplitLooseLoi_(oldLo);
    const libraryContext = (typeof buildLibraryContextCompact === 'function') ? buildLibraryContextCompact('minecraft') : '';
    const constraints = (typeof buildToolConstraints === 'function') ? buildToolConstraints(entry.yl) : '';
    const prompt = `You are repairing one Wesley College DLA unit record.\n\nUnit: ${entry.ca} | ${entry.yl} | ${entry.th}\nCentral idea: ${entry.ci || ''}\nCurrent grouped Lines of Inquiry: ${oldLo}\nPlanner summary: ${entry.plannerText ? compactForPrompt(entry.plannerText, 1200) : ''}\n\nTask:\n1. Split the grouped Lines of Inquiry into 2-4 clear, separate lines. Use semicolons between lines. Do not invent a completely new unit.\n2. Regenerate exactly 6 practical technology suggestions for this unit. Suggestions 1-5 are normal classroom technology ideas. Suggestion 6 must be a STEM Design Cycle idea.\n\n${constraints}\n\n${libraryContext}\n\nExtra hard rules:\n- Google Maps = Street View only. If students annotate maps or use data layers, use National Geographic MapMaker.\n- Use Delightex, not CoSpaces.\n- If Minecraft is used, use a verified lesson from the library and include the direct lesson URL.\n- Keep wording practical for a Year 6 teacher.\n${typeof SUGGESTION_STYLE !== 'undefined' ? SUGGESTION_STYLE : ''}\n\nReturn ONLY JSON:\n{"lo":"Line 1; Line 2; Line 3","s":[{"t":"Tool","d":"Description","url":"optional direct lesson URL"}]}`;
    const raw = await callAI([{role:'user', parts:[{text:prompt}]}], null, OPENAI_MODEL || OPENAI_FAST_MODEL);
    const clean = raw.replace(/```json|```/g,'').trim();
    const si = clean.indexOf('{'), ei = clean.lastIndexOf('}');
    if(si === -1 || ei === -1) throw new Error('No JSON object returned');
    const parsed = JSON.parse(clean.slice(si, ei + 1));
    let newLo = dqSplitLooseLoi_(parsed.lo || roughLo);
    let sugs = Array.isArray(parsed.s) ? parsed.s : [];
    sugs = sugs.map(dqPatchMinecraftLink_).filter(s => s && (s.t || s.tool));
    if(!newLo || newLo === oldLo) newLo = roughLo;
    if(!sugs.length) throw new Error('No suggestions returned');
    if(sugs.length < 6) throw new Error('Only '+sugs.length+' suggestions returned');
    return {entryIdx, oldLo, newLo, oldSugs:getSugs(entry), newSugs:sugs.slice(0,6), reason:'St Kilda Road Year 6 LOI split + regenerated suggestions'};
  }

  function dqPatchSummary_(p){
    const e = DATA[p.entryIdx] || {};
    return `${e.ca || ''} · ${e.yl || ''} · ${e.th || ''}`;
  }

  function dqShowMaintenancePopup_(patches, title){
    const existing = document.getElementById('dq-maint-overlay');
    if(existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'dq-maint-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:20px';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:min(1160px,96vw);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--border);border-radius:18px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.45)';
    modal.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px"><div style="font-size:24px">🛠️</div><div><div style="font-size:20px;font-weight:900">${esc(title || 'Review data maintenance fixes')}</div><div style="font-size:13px;color:var(--dim)">${patches.length} change${patches.length!==1?'s':''} ready for review. Nothing applies until you click Apply.</div></div><button class="btn-sm" style="margin-left:auto" id="dq-maint-close">✕</button></div>`;
    patches.forEach((p,idx) => {
      const e = DATA[p.entryIdx] || {};
      const oldSugs = p.oldSugs || getSugs(e);
      const newSugs = p.newSugs || oldSugs;
      modal.innerHTML += `<div style="background:var(--card2);border:1px solid var(--border);border-radius:14px;padding:14px;margin:12px 0"><div style="font-size:14px;font-weight:900;color:var(--gold);margin-bottom:6px">${idx+1}. ${esc(dqPatchSummary_(p))}</div>${p.reason?`<div style="font-size:12px;color:var(--dim);margin-bottom:10px">${esc(p.reason)}</div>`:''}${p.oldLo!=null?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px"><div style="padding:10px;background:#1a0808;border:1px solid #3a1818;border-radius:10px"><div style="font-size:10px;color:#ff9999;font-weight:800;text-transform:uppercase">Current Lines of Inquiry</div><div style="font-size:12px;line-height:1.55;color:#ddd">${esc(p.oldLo || '(empty)')}</div></div><div style="padding:10px;background:#081808;border:1px solid #1e3a1e;border-radius:10px"><div style="font-size:10px;color:var(--lime);font-weight:800;text-transform:uppercase">Proposed Lines of Inquiry</div><div style="font-size:12px;line-height:1.55;color:#ddd">${esc(p.newLo || '(empty)').replace(/;\s*/g,'<br>')}</div></div></div>`:''}<details><summary style="cursor:pointer;font-size:12px;color:var(--lime);font-weight:800">Show suggestion changes</summary><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px"><div>${oldSugs.map(s=>`<div style="font-size:12px;color:#bbb;padding:7px 0;border-bottom:1px solid #333"><b style="color:#ff9999">${esc(sugTool(s))}</b><br>${esc(sugDesc(s)).slice(0,260)}</div>`).join('')}</div><div>${newSugs.map(s=>`<div style="font-size:12px;color:#bbb;padding:7px 0;border-bottom:1px solid #333"><b style="color:var(--lime)">${esc(sugTool(s))}</b><br>${esc(sugDesc(s)).slice(0,260)}${s.url?`<br><span style="color:var(--gold)">${esc(s.url)}</span>`:''}</div>`).join('')}</div></div></details></div>`;
    });
    modal.innerHTML += `<div style="display:flex;gap:10px;justify-content:flex-end;position:sticky;bottom:0;background:var(--card);padding-top:12px"><button class="btn-sm" id="dq-maint-cancel">Cancel</button><button class="btn-pri" id="dq-maint-apply">Apply ${patches.length} change${patches.length!==1?'s':''}</button></div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.getElementById('dq-maint-close').onclick = document.getElementById('dq-maint-cancel').onclick = () => overlay.remove();
    document.getElementById('dq-maint-apply').onclick = async function(){
      this.disabled = true;
      this.textContent = 'Applying…';
      const changed = [];
      patches.forEach(p => {
        const e = DATA[p.entryIdx];
        if(!e) return;
        if(p.newLo != null) e.lo = p.newLo;
        if(p.newSugs) e.s = p.newSugs.map(dqPatchMinecraftLink_);
        if(typeof markHumanVerifyDirtyIfNeeded_ === 'function') markHumanVerifyDirtyIfNeeded_(p.entryIdx, 'Data maintenance changed this unit after verification.');
        else { e.humanVerified = false; e.verified = false; }
        changed.push(p.entryIdx);
      });
      await saveToDrive();
      overlay.remove();
      try{ if(CURRENT_ENTRY_IDX != null) renderEntry(CURRENT_ENTRY_IDX); }catch(e){}
      try{ renderBrowse?.(); renderDashboard?.(); }catch(e){}
      setStatus('Data maintenance applied ✓');
    };
  }

  function dqBuildSimpleSuggestionPatch_(entryIdx, sugIdx, newSug, reason){
    const e = DATA[entryIdx];
    const oldSugs = getSugs(e);
    const newSugs = oldSugs.map((s,i) => i === sugIdx ? dqPatchMinecraftLink_(newSug) : dqPatchMinecraftLink_(s));
    return {entryIdx, oldSugs, newSugs, reason};
  }

  function dqFindGoogleMapsAnnotationPatches_(){
    const patches = [];
    (DATA || []).forEach((e,entryIdx) => getSugs(e).forEach((s,sugIdx) => {
      const tool = sugTool(s), desc = sugDesc(s);
      if(dqKey_(tool) === dqKey_('Google Maps') && dqDescriptionSuggestsAnnotatedMap_(desc)){
        const newSug = dqSanitiseSuggestion_(Object.assign({}, s, {t:NATGEO_TOOL, d:desc}));
        patches.push(dqBuildSimpleSuggestionPatch_(entryIdx, sugIdx, newSug, 'Google Maps annotation task moved to National Geographic MapMaker'));
      }
    }));
    return patches;
  }

  function dqFindCospacesPatches_(){
    const patches = [];
    (DATA || []).forEach((e,entryIdx) => getSugs(e).forEach((s,sugIdx) => {
      const tool = sugTool(s), desc = sugDesc(s);
      if(/cospaces/i.test(tool + ' ' + desc)){
        const newSug = dqSanitiseSuggestion_(s);
        patches.push(dqBuildSimpleSuggestionPatch_(entryIdx, sugIdx, newSug, 'Renamed CoSpaces reference to Delightex'));
      }
    }));
    return patches;
  }

  function dqFindMinecraftMissingLinkPatches_(){
    const patches = [];
    (DATA || []).forEach((e,entryIdx) => getSugs(e).forEach((s,sugIdx) => {
      const tool = sugTool(s), desc = sugDesc(s);
      if(!/minecraft/i.test(tool + ' ' + desc)) return;
      if(s.url || /https?:\/\//i.test(desc)) return;
      const linked = dqPatchMinecraftLink_(s);
      if(linked.url || /https?:\/\//i.test(sugDesc(linked))){
        patches.push(dqBuildSimpleSuggestionPatch_(entryIdx, sugIdx, linked, 'Added missing verified Minecraft lesson URL from the Minecraft library'));
      }
    }));
    return patches;
  }

  async function runDlaDataQualityMaintenanceFlow_(instruction){
    if(typeof ensureLibrariesLoadedForAI === 'function') await ensureLibrariesLoadedForAI();
    const t = String(instruction || '').toLowerCase();
    const allMode = /all|maintenance|everything|these changes|data quality|google maps|cospaces|minecraft.*link|missing.*link|st kilda/.test(t);
    let patches = [];
    if(/google maps|mapmaker|map maker|annotat|maintenance|all|these changes/.test(t)) patches = patches.concat(dqFindGoogleMapsAnnotationPatches_());
    if(/cospaces|co spaces|delightex|maintenance|all|these changes/.test(t)) patches = patches.concat(dqFindCospacesPatches_());
    if(/minecraft|missing.*link|lesson link|maintenance|all|these changes/.test(t)) patches = patches.concat(dqFindMinecraftMissingLinkPatches_());

    if(/st\s*kilda|skr|year\s*6|lines? of inquiry|loi|regenerate|maintenance|all|these changes/.test(t)){
      const targets = (DATA || []).map((e,i)=>({e,i})).filter(({e}) => dqIsStKildaYear6_(e));
      for(let n=0; n<targets.length; n++){
        try{
          setStatus(`Regenerating St Kilda Road Year 6 unit ${n+1}/${targets.length}…`, 'loading');
          const p = await dqBuildYear6StKildaPatch_(targets[n].i);
          patches.push(p);
        }catch(err){
          console.warn('St Kilda Year 6 repair failed for entry', targets[n].i, err);
        }
        if(typeof sleep === 'function') await sleep(220);
      }
    }

    // Deduplicate exact same entry/slot simple patches by retaining latest newSugs for entry.
    const byEntry = new Map();
    patches.forEach(p => {
      if(!byEntry.has(p.entryIdx)) byEntry.set(p.entryIdx, p);
      else {
        const prev = byEntry.get(p.entryIdx);
        const merged = Object.assign({}, prev, p, { oldSugs: prev.oldSugs || p.oldSugs, reason: [prev.reason, p.reason].filter(Boolean).join(' | ') });
        byEntry.set(p.entryIdx, merged);
      }
    });
    patches = Array.from(byEntry.values());

    if(!patches.length){
      bulkChatAddMessage?.('assistant', 'I checked for Google Maps annotation tasks, CoSpaces naming, missing Minecraft links and St Kilda Road Year 6 LOI issues, but I could not find any reviewable fixes in the currently loaded data.');
      setStatus('No maintenance fixes found');
      return true;
    }
    bulkChatAddMessage?.('assistant', `✅ I found ${patches.length} data-quality maintenance change${patches.length!==1?'s':''} ready for review.`);
    dqShowMaintenancePopup_(patches, 'Review DLA data-quality maintenance fixes');
    return true;
  }

  function dqInstructionTargetsMaintenance_(instruction){
    const t = String(instruction || '').toLowerCase();
    return /(google maps.*street view|national geographic map\s*maker|mapmaker|st\s*kilda.*year\s*6|year\s*6.*st\s*kilda|lines? of inquiry|minecraft.*missing.*link|missing.*minecraft.*link|cospaces|co spaces|delightex)/i.test(t)
      && /(fix|replace|change|regenerate|repair|update|move|rename|missing|link|street view|annotat|grouped|maintenance)/i.test(t);
  }

  if(typeof startBulkAnalysis === 'function'){
    const oldStartBulkAnalysis = startBulkAnalysis;
    startBulkAnalysis = window.startBulkAnalysis = async function(){
      const instruction = (typeof bulkChatEffectiveInstruction_ === 'function') ? bulkChatEffectiveInstruction_(bulkChatContext.rawInstruction) : (bulkChatContext.rawInstruction || '');
      if(dqInstructionTargetsMaintenance_(instruction)){
        bulkChatState = 'analysing';
        showReasoningSteps?.([{text:'Scanning for data-quality maintenance targets',status:'active'},{text:'Preparing reviewable fixes',status:'pending'}]);
        try{
          updateReasoningStep?.(0,'done'); updateReasoningStep?.(1,'active');
          await runDlaDataQualityMaintenanceFlow_(instruction);
          updateReasoningStep?.(1,'done'); setTimeout(function(){ hideReasoningSteps?.(); }, 800);
          bulkChatState = 'done';
        }catch(err){
          handleBulkAnalysisError_ ? handleBulkAnalysisError_(err) : console.error(err);
        }finally{ stopProgress?.(); }
        return;
      }
      return oldStartBulkAnalysis.apply(this, arguments);
    };
  }

  // Expose helpers for console/manual testing.
  window.runDlaDataQualityMaintenanceFlow_ = runDlaDataQualityMaintenanceFlow_;
  window.dlaSanitiseSuggestionsForMapAndDelightex_ = function(){ dqSanitiseDataWithLinks_(DATA); renderBrowse?.(); if(CURRENT_ENTRY_IDX!=null) renderEntry(CURRENT_ENTRY_IDX); };

  setTimeout(function(){
    try{ dqAddNatGeoToInventory_(); if(Array.isArray(DATA) && DATA.length) dqSanitiseDataSet_(DATA); }
    catch(e){}
  },0);
})();
/* ===== end DLA hotfix ===== */


/* ===== DLA hotfix: persistent Sync Now button + immediate post-verify sync =====
   Keeps the manual sync controls visible even when the status bar is re-rendered,
   and triggers one forced Drive pull after Human Verify / save completes. */
(function(){
  const BTN_ID = 'dla-manual-sync-btn';
  const CHIP_ID = 'dla-sync-status-chip';
  let postSaveTimer = null;

  function installPersistentSyncControls_(){
    try{
      if(typeof window.ensureDLASyncControls === 'function'){
        window.ensureDLASyncControls();
      }
      const status = document.getElementById('status-bar');
      if(!status || document.getElementById(BTN_ID)) return;

      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:10px;vertical-align:middle';

      const chip = document.createElement('span');
      chip.id = CHIP_ID;
      chip.textContent = 'Sync every 5s';
      chip.style.cssText = 'font-size:10px;color:var(--dim);font-weight:700;border:1px solid var(--border);border-radius:999px;padding:3px 8px;background:rgba(255,255,255,.03)';

      const btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = '↻ Sync now';
      btn.title = 'Pull the latest data.json changes from Drive now.';
      btn.className = 'btn-sm';
      btn.style.cssText = 'font-size:10px;padding:3px 8px;border-radius:999px';
      btn.onclick = async function(){
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = 'Syncing…';
        try{
          if(typeof window.syncLatestDLAChangesNowForced === 'function') await window.syncLatestDLAChangesNowForced('force');
          else if(typeof window.syncLatestDLAChangesNow === 'function') await window.syncLatestDLAChangesNow();
          if(typeof window.updateDLASyncChip === 'function') window.updateDLASyncChip('Manual sync complete');
        }catch(e){
          try{ if(typeof setStatus === 'function') setStatus('Sync failed: ' + (e.message || e), 'error'); }catch(_e){}
        }finally{
          btn.disabled = false;
          btn.textContent = old;
          setTimeout(installPersistentSyncControls_, 0);
        }
      };

      wrap.appendChild(chip);
      wrap.appendChild(btn);
      status.appendChild(wrap);
    }catch(e){ console.warn('Persistent sync controls failed:', e); }
  }

  function schedulePostSaveSync_(reason){
    clearTimeout(postSaveTimer);
    postSaveTimer = setTimeout(async function(){
      try{
        installPersistentSyncControls_();
        if(typeof window.syncLatestDLAChangesNowForced === 'function'){
          await window.syncLatestDLAChangesNowForced(reason || 'after-save');
        }
      }catch(e){ console.warn('Post-save sync failed:', e); }
      finally{ installPersistentSyncControls_(); }
    }, 1200);
  }

  // Wrap the final saveToDrive function after all earlier hotfix wrappers have loaded.
  setTimeout(function(){
    try{
      if(typeof saveToDrive === 'function' && !saveToDrive.__dlaPostSaveSyncWrapped){
        const oldSave = saveToDrive;
        const wrapped = async function(){
          const out = await oldSave.apply(this, arguments);
          schedulePostSaveSync_('after-save');
          return out;
        };
        wrapped.__dlaPostSaveSyncWrapped = true;
        saveToDrive = window.saveToDrive = wrapped;
      }
    }catch(e){ console.warn('Could not wrap saveToDrive for post-save sync:', e); }

    try{
      if(typeof toggleHumanVerified === 'function' && !toggleHumanVerified.__dlaImmediateSyncWrapped){
        const oldToggle = toggleHumanVerified;
        const wrappedToggle = function(){
          const out = oldToggle.apply(this, arguments);
          schedulePostSaveSync_('human-verify');
          setTimeout(installPersistentSyncControls_, 0);
          setTimeout(installPersistentSyncControls_, 800);
          return out;
        };
        wrappedToggle.__dlaImmediateSyncWrapped = true;
        toggleHumanVerified = window.toggleHumanVerified = wrappedToggle;
      }
    }catch(e){ console.warn('Could not wrap Human Verify for immediate sync:', e); }

    installPersistentSyncControls_();
  }, 0);

  // Some render/status calls replace status-bar contents. Re-install the controls when needed.
  const mo = new MutationObserver(function(){ installPersistentSyncControls_(); });
  setTimeout(function(){
    try{
      const status = document.getElementById('status-bar');
      if(status) mo.observe(status, {childList:true, subtree:true});
    }catch(e){}
  }, 500);
  setInterval(installPersistentSyncControls_, 2500);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) setTimeout(installPersistentSyncControls_, 0); });
  document.addEventListener('DOMContentLoaded', installPersistentSyncControls_);
})();
/* ===== end DLA hotfix ===== */


/* ===== DLA hotfix: app-smash regression guard =====
   On 2026-05-20 at 10:37, a Bulk regen flow saved over 239 multitool entries
   ("Tool A + Tool B" -> "Tool A"), wiping nearly every app smash across the
   corpus. The system rule (mirrored in gas_backend auditPlanners and in
   applyRegenAll's audited=false branch) requires >=2 App Smashes in slots
   1-5 of each lesson. This guard wraps saveToDrive: if any entry would drop
   below that floor in this save, the offending entry's `s` array is reverted
   to the last-known-good baseline before the save proceeds. The user is
   notified, but the save is NOT aborted so dependent flows (UI status,
   post-save sync, etc.) continue cleanly. */
(function(){
  function entryKey_(e){ return (e && (e.ca||'') + '|' + (e.yl||'') + '|' + (e.th||'')) || ''; }
  function appSmashCount_(sugs){
    const arr = Array.isArray(sugs) ? sugs : [];
    let n = 0;
    for(let i=0; i<Math.min(5, arr.length); i++){
      const s = arr[i];
      if(s && typeof s.t === 'string' && /\+/.test(s.t)) n++;
    }
    return n;
  }

  let BASELINE = null;
  function buildBaseline_(){
    if(!Array.isArray(window.DATA)) return null;
    const map = {};
    window.DATA.forEach((e, i) => {
      if(!e) return;
      const k = entryKey_(e);
      if(!k) return;
      const cnt = appSmashCount_(e.s);
      // Capture entries with at least one App Smash. Storing the baseline
      // count alongside the snapshot lets the pre-save check use a "reduced
      // below baseline" rule instead of a hard >=2 floor, so single-smash
      // entries are also protected from a regression to zero.
      if(cnt >= 1){
        try { map[k] = { idx: i, s: JSON.parse(JSON.stringify(e.s)), cnt: cnt }; }
        catch(err){ /* skip uncloneable entries */ }
      }
    });
    return map;
  }
  function ensureBaseline_(){
    if(BASELINE !== null) return;
    if(Array.isArray(window.DATA) && window.DATA.length){
      BASELINE = buildBaseline_();
    }
  }
  setTimeout(ensureBaseline_, 1500);
  setTimeout(ensureBaseline_, 4000);
  setTimeout(ensureBaseline_, 10000);

  setTimeout(function(){
    try{
      if(typeof saveToDrive !== 'function' || saveToDrive.__dlaAppSmashGuardWrapped) return;
      const orig = saveToDrive;
      const wrapped = async function(){
        try{
          ensureBaseline_();
          if(BASELINE && Array.isArray(window.DATA)){
            const reverted = [];
            window.DATA.forEach((e, i) => {
              if(!e) return;
              const k = entryKey_(e);
              const base = BASELINE[k];
              if(!base) return;
              const now = appSmashCount_(e.s);
              // Restore on ANY reduction below the captured baseline count.
              // The legacy `< 2` rule only caught regressions on entries that
              // started with 2+ smashes; a 1-smash entry dropping to 0 slipped
              // through. False positives (deliberate user edits that reduce a
              // smash) are mitigated by the alert + "refresh and retry" path.
              if(typeof base.cnt === 'number' ? (now < base.cnt) : (now < 2)){
                try{
                  window.DATA[i].s = JSON.parse(JSON.stringify(base.s));
                  reverted.push(`${e.yl||''} - ${e.th||''} (${now} -> ${appSmashCount_(window.DATA[i].s)})`);
                }catch(err){ /* skip */ }
              }
            });
            if(reverted.length){
              const msg = 'App-smash guard restored ' + reverted.length + ' entr' + (reverted.length===1?'y':'ies') +
                ' whose app smashes were stripped in this session:\n\n' +
                reverted.slice(0,10).join('\n') +
                (reverted.length>10 ? '\n... and ' + (reverted.length-10) + ' more' : '') +
                '\n\nSave proceeding with restored data. If this was intentional, refresh and retry.';
              try { if(typeof setStatus === 'function') setStatus('App-smash guard restored ' + reverted.length + ' entr' + (reverted.length===1?'y':'ies'), 'error'); } catch(e){}
              try { console.warn('[app-smash-guard]', reverted); } catch(e){}
              try { alert(msg); } catch(e){}
              try { if(typeof renderBrowse === 'function') renderBrowse(); } catch(e){}
              try { if(typeof renderAuditChart === 'function') renderAuditChart(); } catch(e){}
            }
          }
        }catch(err){ try { console.warn('[app-smash-guard] pre-save check failed:', err); } catch(e){} }

        const out = await orig.apply(this, arguments);

        try{
          if(Array.isArray(window.DATA)){
            const fresh = buildBaseline_();
            if(fresh) BASELINE = fresh;
          }
        }catch(err){ /* baseline refresh failure is non-fatal */ }

        return out;
      };
      wrapped.__dlaAppSmashGuardWrapped = true;
      saveToDrive = window.saveToDrive = wrapped;
    }catch(err){ try { console.warn('[app-smash-guard] wrap install failed:', err); } catch(e){} }
  }, 200);
})();
/* ===== end DLA hotfix ===== */


/* ===== DLA hotfix: opener-bias monitor =====
   On 2026-05-25 the corpus was found to have 6/6 GW Year 4 units (and most
   Y3-6 units across all campuses) opening with the identical "Padlet +
   iMovie" App Smash, caused by prompt anchoring in APP_SMASH_REQUIREMENT
   (Padlet + iMovie listed first in "Strong pairings"). The prompt has been
   de-biased and the 4 regen call sites now reject duplicate openers via
   openerDupesSiblingInYear_(). This monitor is the tripwire: after every
   save, count how many units in each campus+year share their slot-1 tool
   label, and warn (console + status bar) if any group has 3+ identical
   openers. Warn-only — does NOT auto-revert (unlike the wipe-guard above),
   because cross-unit opener choice is a legitimate user decision and a
   false-positive revert would frustrate manual editing. */
(function(){
  function openerOf_(e){
    const s0 = e && Array.isArray(e.s) && e.s[0];
    return s0 && typeof s0.t === 'string' ? s0.t.trim() : '';
  }
  function findOpenerClusters_(){
    if(!Array.isArray(window.DATA)) return [];
    const groups = {};
    window.DATA.forEach(e => {
      if(!e) return;
      const opener = openerOf_(e);
      if(!opener) return;
      const k = (e.ca||'') + '|' + (e.yl||'');
      const gk = k + '||' + opener.toLowerCase();
      (groups[gk] = groups[gk] || { ca: e.ca||'', yl: e.yl||'', opener: opener, count: 0 }).count++;
    });
    return Object.values(groups).filter(g => g.count >= 3);
  }

  setTimeout(function(){
    try{
      if(typeof saveToDrive !== 'function' || saveToDrive.__dlaOpenerBiasMonitorWrapped) return;
      const orig = saveToDrive;
      const wrapped = async function(){
        const out = await orig.apply(this, arguments);
        try{
          const clusters = findOpenerClusters_();
          if(clusters.length){
            const summary = clusters
              .sort((a,b) => b.count - a.count)
              .map(c => `${c.ca} ${c.yl}: ${c.count}x "${c.opener}"`);
            try { console.warn('[opener-bias-monitor] duplicate openers detected:', summary); } catch(e){}
            try { if(typeof setStatus === 'function') setStatus('Opener-bias monitor: ' + clusters.length + ' year group' + (clusters.length===1?'':'s') + ' have 3+ identical slot-1 tools (see console)', 'error'); } catch(e){}
          }
        }catch(err){ try { console.warn('[opener-bias-monitor] post-save check failed:', err); } catch(e){} }
        return out;
      };
      wrapped.__dlaOpenerBiasMonitorWrapped = true;
      // Preserve the wipe-guard flag so it isn't re-wrapped on top of itself.
      if(orig.__dlaAppSmashGuardWrapped) wrapped.__dlaAppSmashGuardWrapped = true;
      saveToDrive = window.saveToDrive = wrapped;
    }catch(err){ try { console.warn('[opener-bias-monitor] wrap install failed:', err); } catch(e){} }
  }, 400);
})();
/* ===== end DLA hotfix ===== */
