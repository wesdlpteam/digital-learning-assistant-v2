function esc(s){
  return cleanTextCorruption_(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function linkify(s){ return esc(cleanTextCorruption_(s)).replace(/(https?:\/\/[^\s)&<]+)/g, '<a href="$1" target="_blank" style="color:var(--mint);text-decoration:none;word-break:break-all">$1</a>'); }
function linkifyLight(s){ return esc(cleanTextCorruption_(s)).replace(/(https?:\/\/[^\s)&<]+)/g, '<a href="$1" target="_blank" style="color:#2563eb;text-decoration:none;word-break:break-all">$1</a>'); }
function caCol(ca){ return CAMPUS_COL[normCa(ca)]||CAMPUS_COL[ca]||'#818cf8'; }

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.body.classList.remove('app-mode');
  document.getElementById('app-content').style.display='none';
  const el=document.getElementById('screen-'+id);
  if(el) el.classList.add('active');
}

function showApp(){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('app-content').style.display='block';
  document.body.classList.add('app-mode');
}

let _progressTimer = null;
function showProgress(pct){
  const bar = document.getElementById('global-progress-bar');
  if(!bar) return;
  if(pct === null){
    bar.style.width = '100%';
    setTimeout(()=>{ bar.style.transition='none'; bar.style.width='0%'; setTimeout(()=>bar.style.transition='width .3s ease',50); }, 300);
  } else {
    bar.style.width = (pct||10)+'%';
  }
}
function startProgress(){
  showProgress(10);
  let p=10;
  _progressTimer = setInterval(()=>{ if(p<85){p+=2; showProgress(p);} },400);
}
function stopProgress(){
  clearInterval(_progressTimer);
  showProgress(null);
}

function setStatus(msg,type,html){
  const el=document.getElementById('status-bar'); if(!el) return;
  if(html){ el.innerHTML=msg; } else { el.textContent=msg; }
  el.style.color=type==='error'?'#f87171':type==='loading'?'#fbbf24':'#34d399';
}

async function reconnectDrive(){
  const el=document.getElementById('status-bar');
  if(el){ el.textContent='Reconnecting to Drive…'; el.style.color='#fbbf24'; }
  try{
    const tok=await getDriveToken();
    DRIVE_TOKEN=tok;
    getDriveFileModified().then(meta=>{ if(meta) LAST_KNOWN_MODIFIED=meta.modifiedTime; });
    startConflictPolling();
    setStatus('Reconnected to Drive ✓');
  }catch(e){
    setStatus('Could not reconnect — check your Google account','error');
  }
}

function showBackendScreen(){
  const current = getGASToken();
  const msg = 'Optional backend shared secret. Leave blank unless you have set DLA_SHARED_SECRET in Apps Script Script Properties.';
  const next = prompt(msg, current);
  if(next === null) return;
  if(next.trim()){
    localStorage.setItem('dla_shared_secret', next.trim());
    setStatus('Backend shared secret saved locally');
  } else {
    localStorage.removeItem('dla_shared_secret');
    setStatus('Backend shared secret cleared');
  }
}

async function getDriveToken(){
  
  if(DRIVE_TOKEN) return DRIVE_TOKEN;
  return new Promise((resolve,reject)=>{
    const client=google.accounts.oauth2.initTokenClient({
      client_id:CLIENT_ID,
      scope:'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',
      callback:async (resp)=>{
        if(resp.error){ reject(new Error(resp.error)); return; }
        
        // EMAIL ALLOWLIST — gate on the Studio screen so non-DLP staff get a clear
        // "access denied" instead of an opaque Drive failure. Note: this is UX
        // only — anyone can read this file and bypass it in DevTools. The real
        // gate is gas_backend Code.js DLA_ALLOWED_EMAILS, which verifies the
        // Google access token server-side. Keep this list in sync with that one.
        const ALLOWED_EMAILS = [
          'dlpteam@wesleycollege.edu.au',
          'nathan.benn@wesleycollege.edu.au',
          'david.howard@wesleycollege.edu.au',
          'andrew.delmastro@wesleycollege.edu.au',
          'delmastroa@wesleycollege.edu.au',
          'kathryn.white@wesleycollege.edu.au',
          'laura.sicklemore@wesleycollege.edu.au'
        ];
        
        let email = '';
        try{
          const info=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{
            headers:{'Authorization':'Bearer '+resp.access_token}
          });
          if(!info.ok) throw new Error('userinfo fetch failed');
          const user=await info.json();
          email=(user.email||'').toLowerCase().trim();
        }catch(e){
          // Silent fallback REMOVED — deny access if we can't verify the email
          showAccessDenied('(could not verify identity)');
          reject(new Error('Identity verification failed'));
          return;
        }
        
        if(!email || !ALLOWED_EMAILS.includes(email)){
          // Clear any stored hint so retrying shows the full account picker
          localStorage.removeItem('dla_user_email');
          showAccessDenied(email || '(no email)');
          reject(new Error('Access restricted to approved Wesley College DLP staff'));
          return;
        }
        
        DRIVE_TOKEN=resp.access_token;
        CURRENT_USER_EMAIL=email;
        localStorage.setItem('dla_user_email', email);
        resolve(resp.access_token);
      }
    });
    
    
    const hint = localStorage.getItem('dla_user_email') || '';
    client.requestAccessToken({ prompt: hint ? '' : 'select_account', login_hint: hint });
  });
}

function showAccessDenied(email){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('app-content').style.display='none';
  document.body.classList.remove('app-mode');
  
  let el=document.getElementById('screen-denied');
  if(!el){
    el=document.createElement('div');
    el.id='screen-denied';
    el.style.cssText='min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center';
    el.innerHTML=`<div style="font-size:48px;margin-bottom:20px">🔒</div>
      <h2 style="font-size:24px;font-weight:900;color:var(--text);margin-bottom:10px">Access Restricted</h2>
      <p style="font-size:15px;color:var(--dim);margin-bottom:6px">DLA Studio is restricted to approved Wesley College DLP staff.</p>
      <p style="font-size:13px;color:var(--dim);margin-bottom:6px">If you need access, contact Nathan Benn.</p>
      <p style="font-size:13px;color:#FF8080;margin-bottom:30px">Signed in as: ${esc(email)}</p>
      <button class="btn-pri" onclick="location.reload()" style="padding:12px 28px">Try a different account</button>`;
    document.getElementById('main').appendChild(el);
  }
  el.style.display='flex';
}

async function loadFromDrive(){
  startProgress();
  const btn=document.getElementById('btn-drive');
  const err=document.getElementById('load-err');
  btn.disabled=true; btn.textContent='Connecting…'; err.style.display='none';
  try{
    const tok=await getDriveToken();
    DRIVE_FILE_ID='1x6h0G43CCUiY1H635Rbv2zI8T-6-wTXV';
    // 2026-05-26: Cache-bust query param + no-cache header. Without these
    // Google's CDN happily serves a stale media response for several minutes
    // after the underlying file changes — manifested as "fixes didn't stick"
    // when in fact Drive was already clean.
    const r2=await fetch(`https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media&supportsAllDrives=true&_=${Date.now()}`,{headers:{'Authorization':'Bearer '+tok,'Cache-Control':'no-cache'}});
    if(!r2.ok) throw new Error(`Failed to load canonical data.json (HTTP ${r2.status})`);
    // 2026-05-27: Fetch mtime BEFORE ingest so the cache stamp written
    // by ingest is fresh. Same reason as reloadFromDrive — otherwise
    // the next session's init-time staleness check has nothing valid
    // to compare against.
    DRIVE_TOKEN = tok;
    const initMeta = await getDriveFileModified();
    if(initMeta) LAST_KNOWN_MODIFIED = initMeta.modifiedTime;
    ingest(await r2.json());
    LIBRARIES_READY = false;
    ensureLibrariesLoaded().catch(e => console.warn('Libraries preload failed:', e)); // Load lesson libraries after Drive auth
  }catch(e){
    err.textContent=e.message; err.style.display='block';
    btn.disabled=false; btn.textContent='↑ Load from Google Drive';
  }
}

function localImportDisabled_(){
  alert('Local JSON import is disabled in production. Load data.json from Google Drive so Drive remains the single source of truth.');
  return false;
}

function loadFromFile(e){
  if(e && e.target) e.target.value = ''; 
  return localImportDisabled_();
}

function loadFromPaste(){
  return localImportDisabled_();
}

function ingest(arr, skipCache){
  DATA=Array.isArray(arr)?arr:Object.values(arr);
  if(!skipCache){
    try{
      localStorage.setItem('dla_data', JSON.stringify(DATA));
      if(DRIVE_FILE_ID) localStorage.setItem('dla_file_id', DRIVE_FILE_ID);
      // 2026-05-27: Stamp the cache with Drive's modifiedTime so the
      // init flow can detect staleness across sessions (e.g. when the
      // gas_backend Inspire All / Sweep writes to Drive while the
      // Studio tab is closed, localStorage stays at the old version).
      // Best-effort — if we don't have a fresh mtime yet, leave any
      // existing one in place rather than blanking it.
      if(LAST_KNOWN_MODIFIED) localStorage.setItem('dla_data_mtime', LAST_KNOWN_MODIFIED);
    }catch(e){ /* storage full — skip cache */ }
  }
  
  const campuses=[...new Set(DATA.map(e=>e.ca))].sort();
  const yrs=[...new Set(DATA.map(e=>e.yl))].sort((a,b)=>YR.indexOf(a)-YR.indexOf(b));
  ['f-campus'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    while(el.options.length>1) el.remove(1);
    campuses.forEach(c=>el.add(new Option(c,c)));
  });
  ['f-year'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    while(el.options.length>1) el.remove(1);
    yrs.forEach(y=>el.add(new Option(y,y)));
  });
  
  const allTools=[...new Set(DATA.flatMap(e=>getSugs(e).map(s=>sugTool(s)).filter(Boolean)))].sort();
  const toolEl=document.getElementById('f-tool');
  if(toolEl){ while(toolEl.options.length>1) toolEl.remove(1); allTools.forEach(t=>toolEl.add(new Option(t,t))); }
  
  getDriveFileModified().then(meta=>{ if(meta) LAST_KNOWN_MODIFIED=meta.modifiedTime; });
  startConflictPolling();
  
  const campuses2=[...new Set(DATA.map(e=>e.ca))].sort();
  const yrs2=[...new Set(DATA.map(e=>e.yl))].sort((a,b)=>YR.indexOf(a)-YR.indexOf(b));
  const qc=document.getElementById('q-campus');
  const qy=document.getElementById('q-year');
  if(qc){ while(qc.options.length>1) qc.remove(1); campuses2.forEach(c=>qc.add(new Option(c,c))); }
  if(qy){ while(qy.options.length>1) qy.remove(1); yrs2.forEach(y=>qy.add(new Option(y,y))); }
  showApp();
  
  const emailEl=document.getElementById('sidebar-user-email');
  if(emailEl&&CURRENT_USER_EMAIL) emailEl.textContent=CURRENT_USER_EMAIL;
  switchTab('dashboard',document.querySelector('.nav-item[data-tab="dashboard"]'));
  renderDashboard();
}

let LAST_KNOWN_MODIFIED = null;
let SAVE_USER_TAG = null; 

async function getDriveFileModified(){
  if(!DRIVE_FILE_ID||!DRIVE_TOKEN) return null;
  try{
    const r=await fetch(`https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?fields=modifiedTime,lastModifyingUser`,{
      headers:{'Authorization':'Bearer '+DRIVE_TOKEN}
    });
    const d=await r.json();
    return d;
  }catch{ return null; }
}

async function saveToDrive(){
  if(!DRIVE_FILE_ID||!DRIVE_TOKEN) return;

  
  const meta=await getDriveFileModified();
  if(meta&&LAST_KNOWN_MODIFIED&&meta.modifiedTime!==LAST_KNOWN_MODIFIED){
    const who=meta.lastModifyingUser?.displayName||'someone else';
    const when=new Date(meta.modifiedTime).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
    const confirmed=confirm(`⚠ Conflict detected!

${who} saved changes at ${when}.

If you save now, their changes will be overwritten.

Save anyway?`);
    if(!confirmed){ setStatus('Save cancelled — reload to get latest changes','error'); return; }
  }

  startProgress();
  try{
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${DRIVE_FILE_ID}?uploadType=media`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+DRIVE_TOKEN},
      body:JSON.stringify(DATA,null,2)
    });
    
    const updated=await getDriveFileModified();
    if(updated) LAST_KNOWN_MODIFIED=updated.modifiedTime;
    const now=new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
    setStatus(`Saved to Drive at ${now}`);
    try{
      localStorage.setItem('dla_data', JSON.stringify(DATA));
      if(LAST_KNOWN_MODIFIED) localStorage.setItem('dla_data_mtime', LAST_KNOWN_MODIFIED);
    }catch(e){}
    updateConflictBar(null);
  stopProgress();
  }catch(e){ stopProgress(); setStatus('Drive save failed: '+e.message,'error'); }
}

let CONFLICT_POLL_INTERVAL=null;
function startConflictPolling(){
  if(CONFLICT_POLL_INTERVAL) return;
  CONFLICT_POLL_INTERVAL=setInterval(async()=>{
    if(document.hidden||!DRIVE_FILE_ID||!DRIVE_TOKEN) return;
    const meta=await getDriveFileModified();
    if(meta&&LAST_KNOWN_MODIFIED&&meta.modifiedTime!==LAST_KNOWN_MODIFIED){
      const who=meta.lastModifyingUser?.displayName||'Someone';
      const when=new Date(meta.modifiedTime).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
      updateConflictBar(`${who} updated the file at ${when} — your view may be out of date.`);
    }
  }, 60000);
}

function updateConflictBar(msg){
  if(msg){
    setStatus('⚠ '+msg+' — ', 'error', true);
    const el=document.getElementById('status-bar');
    if(el){
      const link=document.createElement('span');
      link.textContent='Reload latest';
      link.style.cssText='text-decoration:underline;cursor:pointer;font-weight:700';
      link.onclick=reloadFromDrive;
      el.appendChild(link);
    }
  }
}

async function reloadFromDrive(){
  if(!DRIVE_FILE_ID||!DRIVE_TOKEN) return;
  updateConflictBar(null);
  setStatus('Reloading…','loading');
  startProgress();
  try{
    // 2026-05-26: Cache-bust query param + no-cache header. Without these
    // Google's CDN serves a stale media response after recent Drive writes,
    // making reloadFromDrive return data that doesn't reflect the current
    // file. This was the root cause of the 2026-05-26 "fixes don't stick"
    // debug — Drive was clean, but the CDN kept replaying the pre-fix blob.
    const r=await fetch(`https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media&_=${Date.now()}`,{
      headers:{'Authorization':'Bearer '+DRIVE_TOKEN,'Cache-Control':'no-cache'}
    });
    const arr=await r.json();
    // 2026-05-27: Fetch fresh mtime BEFORE ingest so the cache stamp
    // written by ingest reflects Drive's truth-at-fetch-time, not the
    // previously-stamped LAST_KNOWN_MODIFIED. Without this, the cache
    // mtime stays stale and the next init-time staleness check
    // re-triggers an unnecessary reload on every page open.
    const meta=await getDriveFileModified();
    if(meta) LAST_KNOWN_MODIFIED=meta.modifiedTime;
    // Route through ingest() so the localStorage cache (including its
    // mtime stamp) is refreshed. Previously this set DATA in-memory but
    // left dla_data pointing at the stale pre-reload snapshot, which
    // meant the next page refresh would re-load the OLD data.
    ingest(arr);
    const now=new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
    setStatus(`Reloaded at ${now} — showing latest version`);
    renderDashboard();
    if(CURRENT_ENTRY_IDX!==null) renderEntry(CURRENT_ENTRY_IDX);
  stopProgress();
  }catch(e){ stopProgress(); setStatus('Reload failed: '+e.message,'error'); }
}

function downloadJSON(){
  const b=new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'});
  const u=URL.createObjectURL(b);
  const a=document.createElement('a');
  a.href=u; a.download='data.json'; a.click();
  URL.revokeObjectURL(u);
  if(DRIVE_FILE_ID) saveToDrive();
}

// OpenAI chat-completions adapter.
// Accepts Gemini-style message shape — [{role:'user', parts:[{text:'...'}]}] —
// for minimal diff against call sites, and converts internally to OpenAI format.
async function callAI(contents, systemPrompt, model, _attempt=0){
  const body = withGASToken({
    action: 'callAI',
    contents: contents || [],
    systemPrompt: systemPrompt || '',
    model: model || OPENAI_MODEL,
    maxTokens: 4096,
    temperature: 0.2
  });

  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 90000);

  let r, text;
  try {
    r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    text = await r.text();
  } catch(fetchErr) {
    clearTimeout(timeout);
    if(fetchErr.name === 'AbortError') throw new Error('Request timed out after 90s — try narrowing the request.');
    throw new Error('Could not reach the Apps Script AI backend. Check the GAS deployment URL and access permissions. ' + (fetchErr.message || fetchErr));
  }
  clearTimeout(timeout);

  let d;
  try { d = JSON.parse(text); }
  catch(e){
    const preview = String(text || '').slice(0, 220);
    throw new Error('Apps Script returned a non-JSON response. Check the web app deployment. ' + preview);
  }

  if(!r.ok || d.error){
    const errMsg = d.error || ('Apps Script error ' + r.status);
    if((/rate|429|500|502|503|temporar|overload/i.test(errMsg)) && !/tokens per min|TPM|too large|maximum context/i.test(errMsg) && _attempt < 3){
      const delay = [15000, 30000, 60000][_attempt];
      console.log(`AI backend busy — retrying in ${delay/1000}s (attempt ${_attempt+1}/3)`);
      await new Promise(res=>setTimeout(res, delay));
      return callAI(contents, systemPrompt, model, _attempt+1);
    }
    throw new Error(errMsg);
  }

  const out = d.text || d.content || d.message;
  if(!out) throw new Error('Empty response from Apps Script AI backend — try rephrasing your instruction.');
  return out;
}

// 2026-06-07: live quality grader — POSTs one suggestion to the shared server
// grader (action 'gradesuggestion') and returns {pass, reasons, note}. Any
// failure returns pass:true so the curator is never blocked.
async function gradeSuggestionLive(entry, sugIdx, t, d) {
  try {
    const body = withGASToken({
      action: 'gradesuggestion',
      ca: entry.ca || '', yl: entry.yl || '', th: entry.th || '',
      ci: entry.ci || '', lo: entry.lo || '', sugIdx: sugIdx, t: t || '', d: d || ''
    });
    const r = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const j = JSON.parse(await r.text());
    return (typeof j.pass === 'boolean') ? j : { pass: true, reasons: [], note: '' };
  } catch (e) { console.warn('gradeSuggestionLive failed, passing by default:', e.message); return { pass: true, reasons: [], note: '' }; }
}

function switchTab(tab,btn){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const panel=document.getElementById('panel-'+tab);
  if(panel) panel.classList.add('active');
  PREV_TAB=tab; CURRENT_ENTRY_IDX=null;
  // Always re-scan the dashboard when it's shown so whitelist/banned/age changes
  // made on the Bulk tab are reflected immediately (no stale "off whitelist" flags).
  if(tab==='dashboard' && typeof renderDashboard==='function') renderDashboard();
  if(tab==='browse') renderBrowse();
  if(tab==='audit') renderAudit();
  if(tab==='live') loadLiveAnalytics();
  if(tab==='tools'){
    initBulkTools();
    renderBulkWelcome();
    renderSnapshotsList();
    renderPlaybooksList();
    if(typeof pollSuggestionAudit === 'function') pollSuggestionAudit();
    ensureLibrariesLoaded().then(() => {
      renderToolInventory();
      renderBulkWelcome();
    }).catch(e => setStatus(`Libraries failed to load: ${e.message}`, 'error'));
  }
  if(tab==='libraries'){
    ensureLibrariesLoaded().then(() => renderLibraries()).catch(e => setStatus(`Libraries failed to load: ${e.message}`, 'error'));
  }

}

async function deleteEntry(idx){
  const e = DATA[idx];
  if(!e) return;
  if(!confirm(`Delete "${e.th}" (${e.ca} ${e.yl})?\n\nThis cannot be undone.`)) return;
  DATA.splice(idx, 1);
  await saveToDrive();
  setStatus(`"${e.th}" deleted`);
  closeEntry();
  renderBrowse();
  renderDashboard();
}

async function openEntry(idx){
  // Check for existing lock (instant — local data only)
  const existing = isLocked(idx) && !isLockedByMe(idx) ? isLocked(idx) : null;
  if(existing){
    if(!confirm(`⚠ ${existing.user} is currently editing "${DATA[idx]?.th}"\n\nOpen it anyway? Their unsaved changes may be overwritten.`)) return;
  }

  // Render immediately — don't wait for Drive
  CURRENT_ENTRY_IDX=idx;
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-entry').classList.add('active');
  renderEntry(idx);

  // Save lock in background (non-blocking)
  if(!isLockedByMe(idx)){
    if(!DATA._locks) DATA._locks = {};
    DATA._locks[String(idx)] = { user: MY_USER, ts: Date.now() };
    MY_LOCK_IDX = idx;
    startLockHeartbeat(idx);
    saveLocks(); // fire-and-forget — no await
  }
}
