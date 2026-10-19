/* =============================================================
   04-audit-analytics-live.js  -  Live Analytics (ECharts)

   Reads the raw rows from the analytics Google Sheet, builds one model
   with js/03-analytics-model.js, and draws the four sub-tabs from it:
     Overview    is the DLA being used? (also the leadership snapshot)
     Adoption    which teams need a nudge?
     Engagement  which ideas and tools get used?
     Feedback    what teachers wrote, and every "I Used This" row

   Rebuilt 2026-10-09: docs/superpowers/specs/2026-10-09-analytics-rebuild-design.md
   The sheet's own Dashboard tab (old formulas) is no longer read.

   The sandbox demo (tools/browser/studio-shim.js) replaces
   readMultipleRanges, readSheetRange and getAnalyticsSheetTz, and serves
   sample rows keyed by the exact range strings in ANALYTICS_RANGES.
   ECharts is loaded via CDN in DLA_Studio.html.
   ============================================================= */

/* ---------- Palette + chart defaults ---------- */
const ANALYTICS_PALETTE = {
  lime:   '#C5E84A',
  gold:   '#D4A017',
  blue:   '#60B8F0',
  purple: '#9B8BFF',
  orange: '#F5A623',
  salmon: '#FF8080',
  green:  '#52B95C',
  dim:    '#888888',
  border: '#2e2e2e',
  card:   '#1a1a1a',
  card2:  '#222222',
  text:   '#ffffff'
};
// Keys are the canonical names amCampus() returns (js/03).
const CAMPUS_COLOURS = {
  'Elsternwick':       '#818cf8',
  'Glen Waverley':     '#34d399',
  'St Kilda Road':     '#fb923c',
  'Campus not chosen': '#4b5563'
};
const CAMPUS_SHORT = { 'Elsternwick': 'EL', 'Glen Waverley': 'GW', 'St Kilda Road': 'STK' };

// All ECharts instances we own. Keyed by DOM id so we can re-init and resize cleanly.
const ECHART_INSTANCES = {};
let ECHART_RESIZE_TIMER = null;

function echartsReady_(){ return typeof window !== 'undefined' && window.echarts; }

// Studio's CSS uses body{zoom:0.9} below 1400px. ECharts reads mouse events in
// pre-zoom internal coords but reads the chart's bounding rect in post-zoom CSS
// pixels, so the axis pointer drifts ~(1-zoom) to the left/right of the cursor.
// Applying the inverse zoom to the chart host cancels the parent's scaling for
// just that subtree, which keeps event coords consistent. Re-evaluated on every
// mount so it adapts to the responsive breakpoints.
function compensateBodyZoom_(el){
  const bodyZoom = parseFloat(getComputedStyle(document.body).zoom || '1') || 1;
  const factor = bodyZoom && bodyZoom !== 1 ? (1 / bodyZoom) : 1;
  el.style.zoom = factor === 1 ? '' : factor.toFixed(4);
}

function mountChart_(id, option){
  if(!echartsReady_()) return null;
  const el = document.getElementById(id);
  if(!el) return null;
  compensateBodyZoom_(el);
  let inst = ECHART_INSTANCES[id];
  if(!inst || inst.isDisposed()){
    el.innerHTML = '';   // clear any "No data yet" message left in the host
    inst = window.echarts.init(el, null, { renderer:'svg' });
    ECHART_INSTANCES[id] = inst;
  } else {
    inst.resize();
  }
  inst.setOption(option, true);
  return inst;
}

function disposeChart_(id){
  const inst = ECHART_INSTANCES[id];
  if(inst && !inst.isDisposed()) inst.dispose();
  delete ECHART_INSTANCES[id];
}

function resizeAllCharts_(){
  Object.entries(ECHART_INSTANCES).forEach(([id, inst]) => {
    if(!inst || inst.isDisposed()) return;
    const el = document.getElementById(id);
    if(el) compensateBodyZoom_(el);
    inst.resize();
  });
}

function scheduleChartResize_(){
  clearTimeout(ECHART_RESIZE_TIMER);
  ECHART_RESIZE_TIMER = setTimeout(resizeAllCharts_, 120);
}

// Standard look for any chart's grid + axes. Keeps every panel visually consistent.
function chartBase_(){
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: ANALYTICS_PALETTE.text },
    grid: { left: 56, right: 18, top: 28, bottom: 36, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: ANALYTICS_PALETTE.border,
      borderWidth: 1,
      textStyle: { color: ANALYTICS_PALETTE.text, fontSize: 12 },
      axisPointer: { lineStyle: { color: ANALYTICS_PALETTE.dim } }
    },
    legend: {
      textStyle: { color: ANALYTICS_PALETTE.dim, fontSize: 11 },
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      top: 2,
      right: 12
    }
  };
}

function axisStyle_(opts){
  return Object.assign({
    axisLine:  { lineStyle: { color: ANALYTICS_PALETTE.border } },
    axisTick:  { show: false },
    axisLabel: { color: ANALYTICS_PALETTE.dim, fontSize: 11 },
    splitLine: { lineStyle: { color: ANALYTICS_PALETTE.border, opacity: 0.4 } }
  }, opts || {});
}

/* ---------- Sub-tab switching ---------- */
let CURRENT_ANALYTICS_SUBTAB = 'overview';

function setAnalyticsSubtab(name){
  CURRENT_ANALYTICS_SUBTAB = name;
  document.querySelectorAll('.analytics-subtab').forEach(t => {
    t.classList.toggle('active', t.dataset.subtab === name);
  });
  document.querySelectorAll('.analytics-subpanel').forEach(p => {
    p.style.display = (p.dataset.subpanel === name) ? 'block' : 'none';
  });
  // ECharts canvases freeze if they were sized while hidden — resize on reveal.
  setTimeout(resizeAllCharts_, 30);
}

window.addEventListener('resize', scheduleChartResize_);
window.addEventListener('orientationchange', scheduleChartResize_);

/* ---------- Small helpers ---------- */
function fmtDay_(d){ return d ? d.toLocaleDateString('en-AU', { day:'numeric', month:'short' }) : ''; }
function fmtWhen_(d){
  if(!d) return 'date unknown';
  return d.toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'2-digit' }) + ', ' +
    d.toLocaleTimeString('en-AU', { hour:'numeric', minute:'2-digit' });
}
function plural_(n, one, many){ return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function windowStart_(m, n){ return new Date(m.now.getTime() - (n || 1) * AM_WINDOW_DAYS * AM_DAY_MS); }
function campusColour_(c){ return CAMPUS_COLOURS[c] || ANALYTICS_PALETTE.lime; }
function byNewest_(a, b){ return (b.ts ? b.ts.getTime() : 0) - (a.ts ? a.ts.getTime() : 0); }

/* ---------- Sheet reads ---------- */
// Open-ended ranges: the old fixed A1:F5000 caps would silently drop the
// newest rows once a sheet outgrew them.
const ANALYTICS_RANGES = {
  analytics:    'Analytics!A:F',
  used:         'Used!A:G',
  feedback:     'Feedback!A:G',
  intent:       'Intent!A:G',
  interactions: 'Interactions!A:G'
};
// Raw cell values, not display text: timestamps arrive as serial numbers
// whatever format a cell has (half the Analytics column displays date-only).
const ANALYTICS_READ_OPTS = 'valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';

async function readSheetRange(range){
  const token = await getDriveToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values/${encodeURIComponent(range)}?${ANALYTICS_READ_OPTS}`;
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  const d = await r.json();
  if(d.error) throw new Error(d.error.message);
  return d.values || [];
}

async function readMultipleRanges(ranges){
  const token = await getDriveToken();
  const params = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values:batchGet?${params}&${ANALYTICS_READ_OPTS}`;
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  const d = await r.json();
  if(d.error) throw new Error(d.error.message);
  return d.valueRanges.map(vr => vr.values || []);
}

// Serial timestamps are wall clock in the spreadsheet's own timezone
// (America/Los_Angeles as of Oct 2026), so the model needs it.
async function getAnalyticsSheetTz(){
  if(window._analyticsSheetTz) return window._analyticsSheetTz;
  try{
    const token = await getDriveToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}?fields=properties.timeZone`;
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    const d = await r.json();
    const tz = d && d.properties && d.properties.timeZone;
    if(tz){ window._analyticsSheetTz = tz; return tz; }
  }catch(_){ /* fall through */ }
  // Not cached: a later refresh should try the real timezone again.
  return 'Australia/Melbourne';
}

/* ---------- Load + render ---------- */
async function loadLiveAnalytics(){
  const loading = document.getElementById('live-loading');
  const contentEl = document.getElementById('live-content');
  const lastUpdated = document.getElementById('live-last-updated');
  const btn = document.getElementById('btn-refresh-live');
  const dot = document.getElementById('live-dot');

  if(loading){
    // Keep the original loading message so a retry after an error does not show the old error.
    if(loading.dataset.origHtml === undefined) loading.dataset.origHtml = loading.innerHTML;
    else loading.innerHTML = loading.dataset.origHtml;
    loading.style.display = 'block';
  }
  if(contentEl) contentEl.style.display = 'none';
  if(btn) btn.disabled = true;
  if(dot) dot.style.background = '#fbbf24';

  try{
    const [tz, [analyticsRows, usedRows, feedbackRows]] = await Promise.all([
      getAnalyticsSheetTz(),
      readMultipleRanges([ANALYTICS_RANGES.analytics, ANALYTICS_RANGES.used, ANALYTICS_RANGES.feedback])
    ]);
    // Bulk chat (js/09) reads this for its "suggestions are ignored" hint.
    window._usedRowsCache = usedRows;
    // Intent and Interactions tabs only appear after their first click, and a
    // batched read fails outright on a missing tab, so read them on their own.
    const optional = range => readSheetRange(range).catch(err => {
      console.info(range + ' not readable yet:', (err && err.message) || err);
      return [];
    });
    const intentRows = await optional(ANALYTICS_RANGES.intent);
    const interactionRows = await optional(ANALYTICS_RANGES.interactions);

    window._analyticsModel = buildAnalyticsModel(
      { analytics: analyticsRows, used: usedRows, intent: intentRows, interactions: interactionRows, feedback: feedbackRows },
      {
        tz,
        now: new Date(),
        units: (typeof DATA !== 'undefined' && Array.isArray(DATA)) ? DATA : [],
        normaliseTool: (typeof normaliseToolName === 'function') ? normaliseToolName : null
      }
    );

    // Show the panel BEFORE drawing. ECharts measures its host when it mounts,
    // and a hidden host measures 0px wide (the old squashed growth chart).
    if(loading) loading.style.display = 'none';
    if(contentEl) contentEl.style.display = 'block';
    renderAnalyticsDashboard_();
    setTimeout(resizeAllCharts_, 30);

    if(dot) dot.style.background = 'var(--lime)';
    if(lastUpdated) lastUpdated.textContent = 'Last updated ' + new Date().toLocaleTimeString('en-AU') + '. Press Refresh for the newest clicks.';
  }catch(e){
    if(loading) loading.innerHTML = `<div style="color:#FF8080;font-size:14px">Failed to load: ${esc(e.message)}</div>`;
    if(dot) dot.style.background = '#FF8080';
    console.error(e);
  }
  if(btn) btn.disabled = false;
}

// One failing panel must not blank the rest of the page.
function renderAnalyticsDashboard_(){
  const m = window._analyticsModel;
  if(!m) return;
  [
    ['insights',      () => renderInsights(m)],
    ['ai summary',    () => restoreCachedAISummary_()],
    ['kpi strip',     () => renderKpiStrip(m)],
    ['growth chart',  () => renderGrowthChart(m)],
    ['team grid',     () => renderTeamGrid(m)],
    ['campus bar',    () => renderCampusBar(m)],
    ['used by team',  () => renderUsedByTeam(m)],
    ['steps',         () => renderEngagementSteps(m)],
    ['interactions',  () => renderInteractionsCard(m)],
    ['tool rankings', () => renderToolRankings(CURRENT_RANKING_SCOPE)],
    ['top pages',     () => renderTopPages(m)],
    ['latest used',   () => renderLatestUsed(m)],
    ['feedback',      () => renderFeedbackList(m)],
    ['click audit',   () => renderUsedAudit(m)]
  ].forEach(([name, fn]) => {
    try { fn(); } catch(e){ console.error('[analytics] ' + name + ' failed:', e); }
  });
}

// Tools the audited suggestion library offers, against how often teachers
// marked them used. scope: 'all' or a campus in any spelling.
function suggestionUsage_(m, scope){
  const campus = scope && scope !== 'all' ? amCampus(scope) : null;
  const tidy = t => (typeof normaliseToolName === 'function') ? (normaliseToolName(t) || t) : t;
  const suggested = {};
  if(typeof DATA !== 'undefined' && Array.isArray(DATA)){
    DATA.forEach(e => {
      if(!e || !e.audited) return;
      if(campus && amCampus(e.ca) !== campus) return;
      const sugs = (typeof getSugs === 'function') ? getSugs(e) : (e.sg || []);
      (sugs || []).forEach(s => {
        const tool = tidy(s && s.t ? String(s.t).trim() : '');
        if(tool) suggested[tool] = (suggested[tool] || 0) + 1;
      });
    });
  }
  const used = {};
  m.used.forEach(e => { if(e.tool && (!campus || e.campus === campus)) used[e.tool] = (used[e.tool] || 0) + 1; });
  return Object.keys(suggested)
    .map(tool => ({ tool, suggested: suggested[tool], used: used[tool] || 0 }))
    .sort((a, b) => b.suggested - a.suggested || a.tool.localeCompare(b.tool));
}

/* ========================= OVERVIEW ========================= */

/* ---------- Insights ----------
   Rule-based and free. Each rule gives zero or one card, most actionable
   first. Percent changes obey AM_MIN_FOR_PCT, so tiny numbers never
   produce a dramatic headline. */
function renderInsights(m){
  const el = document.getElementById('live-insights'); if(!el) return;
  const countEl = document.getElementById('live-insights-count');
  const h = amHeadline(m);
  const teams = amTeamActivity(m);
  const since = windowStart_(m);
  const ins = [];

  // 1. Visits trend, only when both 4-week windows are big enough to compare.
  if(h.visits.pct !== null && Math.abs(h.visits.pct) >= 15){
    const up = h.visits.pct > 0;
    ins.push({
      icon: up ? '📈' : '📉', tone: up ? 'positive' : 'warning',
      title: `Visits ${up ? 'up' : 'down'} ${Math.abs(h.visits.pct)}% on the 4 weeks before`,
      body: `${plural_(h.visits.cur, 'visit')} in the last 4 weeks, against ${h.visits.prev} in the 4 weeks before.` +
        (up ? ' A good moment to share a success story in staff comms.' : ' Check whether school holidays explain it before acting.')
    });
  } else if(h.visits.allTime >= 50 && h.visits.cur === 0){
    ins.push({ icon: '⚠️', tone: 'warning', title: 'No visits in the last 4 weeks',
      body: 'Nobody has opened the DLA for 4 weeks. Worth checking teachers can still find the link.' });
  }

  // 2. Teams that were active and have gone quiet.
  const quiet = teams.filter(t => t.status === 'quiet').sort((a, b) => b.last - a.last);
  if(quiet.length){
    const names = quiet.slice(0, 3).map(t => `${t.campus} ${t.year}`);
    ins.push({ icon: '🔕', tone: 'warning', title: `${plural_(quiet.length, 'team')} gone quiet`,
      body: `Active 2 to 6 weeks ago, nothing since: ${names.join(', ')}${quiet.length > 3 ? ', and others' : ''}. A short check-in often brings a team back.`,
      action: { label: 'See team grid', target: 'adoption' } });
  }

  // 3. Teams never seen at all.
  const never = teams.filter(t => t.status === 'never').length;
  if(never){
    ins.push({ icon: '👀', tone: 'neutral', title: `${never} of ${teams.length} teams never seen`,
      body: 'No unit-page visits or clicks from these teams yet. The team grid shows which ones.',
      action: { label: 'See team grid', target: 'adoption' } });
  }

  // 4. Tools suggested often and never used.
  const dead = suggestionUsage_(m, 'all').filter(t => t.suggested >= 5 && !t.used);
  if(dead.length >= 3){
    ins.push({ icon: '🪦', tone: 'neutral', title: `${dead.length} tools suggested but never used`,
      body: `Most suggested: ${dead.slice(0, 3).map(t => t.tool).join(', ')}. Each appears 5 or more times in the suggestion library with no "used" clicks, so they are candidates for a Bulk AI Edit refresh.`,
      action: { label: 'See never-used list', target: 'engagement' } });
  }

  // 5. A team well ahead of the rest.
  const byTeam = {};
  m.used.forEach(e => { byTeam[e.team] = (byTeam[e.team] || 0) + 1; });
  const ranked = Object.entries(byTeam).sort((a, b) => b[1] - a[1]);
  if(ranked.length >= 4){
    const [topTeam, topCount] = ranked[0];
    const median = ranked[Math.floor(ranked.length / 2)][1] || 1;
    if(topCount >= 5 && topCount >= median * 2){
      ins.push({ icon: '🌟', tone: 'positive', title: `${topTeam} is leading on use`,
        body: `${topCount} "used" clicks, ${(topCount / median).toFixed(1)} times the middle team. Worth asking what is working and sharing it.` });
    }
  }

  // 6. A campus visiting but not clicking, last 4 weeks.
  const visitsBy = {}, usedBy = {}, intentsBy = {};
  m.visits.forEach(v => { if(v.campus && v.ts >= since) visitsBy[v.campus] = (visitsBy[v.campus] || 0) + 1; });
  m.used.forEach(e => { if(e.ts && e.ts >= since) usedBy[e.campus] = (usedBy[e.campus] || 0) + 1; });
  m.intents.forEach(e => { if(e.ts && e.ts >= since) intentsBy[e.campus] = (intentsBy[e.campus] || 0) + 1; });
  const gap = Object.entries(visitsBy).filter(([c, n]) => n >= AM_MIN_FOR_PCT && !usedBy[c]).sort((a, b) => b[1] - a[1])[0];
  if(gap){
    const [campus, n] = gap;
    const planned = intentsBy[campus] || 0;
    ins.push({ icon: planned ? '🚧' : '🪞', tone: 'warning',
      title: planned ? `${campus} is planning but not following through` : `${campus} is visiting but not clicking`,
      body: planned
        ? `${n} visits and ${plural_(planned, '"going to try" click')} from ${campus} in the last 4 weeks, but no "used" clicks. Worth asking what is getting in the way.`
        : `${n} visits from ${campus} in the last 4 weeks, but no "going to try" or "used" clicks. Teachers may be browsing without acting, so a short demo could help.`,
      action: { label: 'See team grid', target: 'adoption' } });
  }

  // 7. "Going to try" with no follow-through after a week.
  const pending = {};
  amOpenIntents(m, 7).forEach(e => {
    const p = pending[e.team] || (pending[e.team] = { count: 0, oldest: e.ts });
    p.count++;
    if(e.ts < p.oldest) p.oldest = e.ts;
  });
  const topPending = Object.entries(pending).filter(([, p]) => p.count >= 2).sort((a, b) => b[1].count - a[1].count)[0];
  if(topPending){
    const [team, p] = topPending;
    const days = Math.round((m.now.getTime() - p.oldest.getTime()) / AM_DAY_MS);
    ins.push({ icon: '🟡', tone: 'warning', title: `${team} has ${p.count} open "going to try"`,
      body: `${p.count} ideas marked "going to try" over a week ago (the oldest ${days} days ago) with no "used" click yet. A quick "how did it go?" often closes the loop.`,
      action: { label: 'See engagement tab', target: 'engagement' } });
  }

  // 8. Calm baseline, only if nothing else fired.
  if(!ins.length){
    if(!m.used.length && !m.intents.length){
      ins.push({ icon: '👋', tone: 'neutral', title: 'Waiting for the first clicks',
        body: 'No "going to try" or "used" clicks yet. Once a few teams start, this panel will point out trends and gaps.' });
    } else {
      ins.push({ icon: '✅', tone: 'positive', title: 'Nothing urgent right now',
        body: 'No drops, quiet teams or stalled plans detected. Keep sharing wins in staff comms.' });
    }
  }

  if(countEl) countEl.textContent = plural_(ins.length, 'insight');
  el.innerHTML = `<div class="insights-grid">` + ins.map(i => `
    <div class="insight-card insight-${i.tone}">
      <div class="insight-head">
        <span class="insight-icon">${esc(i.icon)}</span>
        <span class="insight-title">${esc(i.title)}</span>
      </div>
      <div class="insight-body">${esc(i.body)}</div>
      ${i.action ? `<button class="insight-action" onclick="setAnalyticsSubtab('${esc(i.action.target)}')">${esc(i.action.label)} →</button>` : ''}
    </div>
  `).join('') + `</div>`;
}

/* ---------- AI executive summary ----------
   Sends counts only to the gas_backend callAI proxy: no rows, no names,
   no feedback text. Cached in sessionStorage so a page reload does not
   spend another call. */
function buildAISummaryBrief_(){
  const m = window._analyticsModel;
  if(!m) return {};
  const h = amHeadline(m);
  const since = windowStart_(m);
  const recent = list => list.filter(e => e.ts && e.ts >= since);
  const tally = (list, key) => list.reduce((o, e) => { const k = e[key]; if(k) o[k] = (o[k] || 0) + 1; return o; }, {});
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
  const teams = amTeamActivity(m);
  const status = s => teams.filter(t => t.status === s).length;
  return {
    period: 'last 28 days unless noted',
    today: m.now.toISOString().slice(0, 10),
    definitions: {
      visit: 'one sitting at the DLA, however many pages it covers',
      team: 'one campus and year level, for example Glen Waverley Year 4'
    },
    visits: { last28: h.visits.cur, previous28: h.visits.prev, allTime: h.visits.allTime, byCampusLast28: tally(recent(m.visits), 'campus') },
    teams: { total: teams.length, activeLast14Days: status('active'), quiet2to6Weeks: status('quiet'), notSeenFor6WeeksOrNever: status('idle') + status('never') },
    goingToTry: { last28: h.intents.cur, previous28: h.intents.prev, allTime: h.intents.allTime, openAfterAWeek: amOpenIntents(m, 7).length },
    used: { last28: h.used.cur, previous28: h.used.prev, allTime: h.used.allTime,
      topToolsLast28: top(tally(recent(m.used), 'tool'), 8), topTeamsLast28: top(tally(recent(m.used), 'team'), 5) },
    writtenFeedback: { allTime: m.feedback.length, last28: recent(m.feedback).length },
    suggestedButNeverUsed: suggestionUsage_(m, 'all').filter(t => t.suggested >= 5 && !t.used).slice(0, 6)
      .map(t => ({ tool: t.tool, suggested: t.suggested }))
  };
}

async function generateAISummary(){
  const btn   = document.getElementById('btn-ai-summary');
  const wrap  = document.getElementById('live-ai-summary');
  if(!wrap) return;
  if(typeof callAI !== 'function'){
    wrap.style.display = 'block';
    wrap.innerHTML = `<div class="ai-summary-card ai-error">AI proxy is not available in this session. Sign in via the Studio first.</div>`;
    return;
  }
  const originalLabel = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = 'Drafting…'; }
  wrap.style.display = 'block';
  wrap.innerHTML = `<div class="ai-summary-card ai-loading">
    <div class="ai-spinner"></div>
    <div>Reading the dashboard numbers and drafting a one-paragraph briefing…</div>
  </div>`;

  const brief = buildAISummaryBrief_();

  const system = `You are a clear, calm internal analyst writing a one-paragraph executive briefing for Wesley College's Digital Learning Programs (DLP) team about adoption of the Digital Learning Assistant (DLA). Your audience is school leadership: no jargon, no AI buzzwords. Lead with the most important fact. Be specific (cite numbers from the brief). End with ONE concrete suggested action. Write plain Australian English. Do not use em dashes.`;

  const userText = `Here is the latest analytics snapshot as JSON. Write a single tight paragraph (max ~140 words) summarising what it shows and what to do next. Do not invent numbers: only use what is in the brief. If the data is sparse, say so plainly. Small numbers are normal for a new tool, so do not dramatise small changes.

If a campus is missing from byCampusLast28, that means zero. Call it out only if it is meaningful.

BRIEF:
\`\`\`json
${JSON.stringify(brief, null, 2)}
\`\`\`

Return plain prose. No headings, no bullets, no quotes.`;

  try {
    const fastModel = (typeof OPENAI_FAST_MODEL !== 'undefined' && OPENAI_FAST_MODEL) ? OPENAI_FAST_MODEL : 'gpt-6.1-sol';
    const raw = await callAI([{ role: 'user', parts: [{ text: userText }] }], system, fastModel);
    const summary = String(raw || '').trim();
    const cleaned = (typeof cleanTextCorruption_ === 'function') ? cleanTextCorruption_(summary) : summary;
    const ts = new Date().toLocaleString('en-AU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    wrap.innerHTML = `
      <div class="ai-summary-card">
        <div class="ai-summary-head">
          <span class="ai-summary-icon">✨</span>
          <span class="ai-summary-title">AI executive summary</span>
          <span class="ai-summary-ts">${esc(ts)}</span>
        </div>
        <div class="ai-summary-body">${esc(cleaned)}</div>
        <div class="ai-summary-foot">
          <span>Drafted by ${esc(fastModel)} from the dashboard numbers. Sense-check before sharing.</span>
          <button class="btn-sm" onclick="generateAISummary()" style="margin-left:auto">↻ Redraft</button>
        </div>
      </div>`;
    try { sessionStorage.setItem('dla_ai_summary_cache', JSON.stringify({ ts, text: cleaned, model: fastModel })); } catch(_){}
  } catch(e){
    console.error(e);
    wrap.innerHTML = `<div class="ai-summary-card ai-error">
      <b>Could not draft summary:</b> ${esc(e.message || String(e))}
      <div style="margin-top:8px;font-size:11px;opacity:.7">If this is the first AI call this session, check you're signed in to the Studio.</div>
    </div>`;
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = originalLabel || '✨ AI exec summary'; }
  }
}

// Restore the latest summary from this browser session so a reload does not
// make the feature look broken.
function restoreCachedAISummary_(){
  try {
    const raw = sessionStorage.getItem('dla_ai_summary_cache');
    if(!raw) return;
    const { ts, text, model } = JSON.parse(raw);
    if(!text) return;
    const wrap = document.getElementById('live-ai-summary'); if(!wrap) return;
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="ai-summary-card">
        <div class="ai-summary-head">
          <span class="ai-summary-icon">✨</span>
          <span class="ai-summary-title">AI executive summary</span>
          <span class="ai-summary-ts">${esc(ts || '')}</span>
        </div>
        <div class="ai-summary-body">${esc(text)}</div>
        <div class="ai-summary-foot">
          <span>Cached from this session · drafted by ${esc(model || 'AI')}</span>
          <button class="btn-sm" onclick="generateAISummary()" style="margin-left:auto">↻ Redraft</button>
        </div>
      </div>`;
  } catch(_){}
}

/* ---------- Headline numbers ---------- */
function renderKpiStrip(m){
  const el = document.getElementById('live-kpi-strip'); if(!el) return;
  const h = amHeadline(m);
  const versus = c => c.pct !== null
    ? `${c.pct >= 0 ? '▲' : '▼'} ${Math.abs(c.pct)}% on the 4 weeks before`
    : `${c.prev} in the 4 weeks before`;
  const kpis = [
    { lbl: 'Visits',                num: h.visits.cur,      sub: versus(h.visits),  extra: `${h.visits.allTime} all-time`,  col: ANALYTICS_PALETTE.blue },
    { lbl: 'Teams active',          num: h.teamsActive.cur, sub: `of ${h.teamsActive.total} teams (a campus and year level)`, extra: '', col: ANALYTICS_PALETTE.lime },
    { lbl: '"Going to try" clicks', num: h.intents.cur,     sub: versus(h.intents), extra: `${h.intents.allTime} all-time`, col: ANALYTICS_PALETTE.gold },
    { lbl: '"Used" clicks',         num: h.used.cur,        sub: versus(h.used),    extra: `${h.used.allTime} all-time`,    col: ANALYTICS_PALETTE.lime }
  ];
  el.innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-lbl">${esc(k.lbl)}</div>
      <div class="kpi-num" style="color:${k.col}">${esc(String(k.num))}</div>
      <div class="kpi-sub">${esc(k.sub)}</div>
      ${k.extra ? `<div class="kpi-extra" style="color:${k.col}">${esc(k.extra)}</div>` : ''}
    </div>
  `).join('');
}

/* ---------- Visits over time ----------
   Top: visits per week (or month) stacked by campus. Bottom, on its own
   axis so small numbers stay readable: "going to try" and "used" clicks. */
let CURRENT_GROWTH_BUCKET = 'week';
let CURRENT_GROWTH_CAMPUS = 'all';

function setGrowthBucket(bucket){
  CURRENT_GROWTH_BUCKET = bucket === 'month' ? 'month' : 'week';
  document.querySelectorAll('.growth-bucket').forEach(b => b.classList.toggle('active', b.dataset.bucket === CURRENT_GROWTH_BUCKET));
  if(window._analyticsModel) renderGrowthChart(window._analyticsModel);
}

function setGrowthCampus(campus){
  CURRENT_GROWTH_CAMPUS = campus || 'all';
  document.querySelectorAll('.growth-campus').forEach(b => b.classList.toggle('active', b.dataset.campus === CURRENT_GROWTH_CAMPUS));
  if(window._analyticsModel) renderGrowthChart(window._analyticsModel);
}

function renderGrowthChart(m){
  const id = 'live-growth-chart';
  const chartEl = document.getElementById(id);
  const emptyEl = document.getElementById('live-growth-empty');
  const noteEl  = document.getElementById('live-growth-trend');
  const s = amSeries(m, { bucket: CURRENT_GROWTH_BUCKET, campus: CURRENT_GROWTH_CAMPUS });
  const names = Object.keys(s.visits).filter(n => n !== AM_NO_CAMPUS);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const totalVisits = names.reduce((a, n) => a + sum(s.visits[n]), 0);
  const totalUsed = sum(s.used), totalIntents = sum(s.intents);

  if(!totalVisits && !totalUsed && !totalIntents){
    disposeChart_(id);
    if(chartEl) chartEl.style.display = 'none';
    if(emptyEl){
      emptyEl.style.display = 'block';
      emptyEl.textContent = CURRENT_GROWTH_CAMPUS === 'all' ? 'No visits recorded yet.' : `No visits recorded yet for ${CURRENT_GROWTH_CAMPUS}.`;
    }
    if(noteEl) noteEl.innerHTML = '';
    return;
  }
  if(emptyEl) emptyEl.style.display = 'none';
  if(chartEl) chartEl.style.display = 'block';

  const monthly = CURRENT_GROWTH_BUCKET === 'month';
  const labels = s.starts.map(d => monthly
    ? d.toLocaleDateString('en-AU', { month:'short', year:'2-digit' })
    : d.toLocaleDateString('en-AU', { day:'numeric', month:'short' }));
  const unit = monthly ? 'month' : 'week';
  if(noteEl) noteEl.innerHTML = `
    <span><b>${totalVisits}</b> visits</span>
    <span><b>${totalIntents}</b> "going to try"</span>
    <span><b>${totalUsed}</b> "used"</span>
    <span style="margin-left:auto">per ${unit}, last ${plural_(labels.length, unit)}</span>`;

  const visitSeries = names.filter(n => s.visits[n].some(v => v)).map(n => ({
    name: n, type: 'bar', stack: 'visits', xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 28,
    itemStyle: { color: CAMPUS_COLOURS[n] || '#555' }, emphasis: { focus: 'series' },
    data: s.visits[n]
  }));
  const clickSeries = [
    { name: '"Going to try"', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 12,
      itemStyle: { color: ANALYTICS_PALETTE.gold }, data: s.intents },
    { name: '"Used"', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 12,
      itemStyle: { color: ANALYTICS_PALETTE.lime }, data: s.used }
  ];
  const base = chartBase_();
  const opt = Object.assign(base, {
    legend: [
      Object.assign({}, base.legend, { data: visitSeries.map(x => x.name), left: 0, right: 'auto', top: 0 }),
      Object.assign({}, base.legend, { data: ['"Going to try"', '"Used"'], left: 0, right: 'auto', top: '64%' })
    ],
    grid: [
      { left: 8, right: 12, top: 36, height: '48%', containLabel: true },
      { left: 8, right: 12, top: '74%', bottom: 8, containLabel: true }
    ],
    tooltip: Object.assign(base.tooltip, {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } }
    }),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    xAxis: [
      axisStyle_({ type: 'category', gridIndex: 0, data: labels, axisLabel: { show: false } }),
      axisStyle_({ type: 'category', gridIndex: 1, data: labels })
    ],
    yAxis: [
      axisStyle_({ type: 'value', gridIndex: 0, minInterval: 1 }),
      axisStyle_({ type: 'value', gridIndex: 1, minInterval: 1, splitNumber: 2 })
    ],
    series: visitSeries.concat(clickSeries)
  });
  mountChart_(id, opt);
}

/* ========================= ADOPTION ========================= */

/* ---------- Team grid: last activity per campus and year level ---------- */
function renderTeamGrid(m){
  const el = document.getElementById('live-reach-matrix'); if(!el) return;
  const teams = amTeamActivity(m);
  if(!teams.length){
    el.innerHTML = '<div class="empty-msg">No teams found in the unit data yet.</div>';
    return;
  }
  const extras = (list, known) => [...new Set(list)].filter(x => known.indexOf(x) < 0);
  const campuses = AM_CAMPUSES.filter(c => teams.some(t => t.campus === c)).concat(extras(teams.map(t => t.campus), AM_CAMPUSES));
  const years = AM_YEARS.filter(y => teams.some(t => t.year === y)).concat(extras(teams.map(t => t.year), AM_YEARS));
  const byKey = {};
  teams.forEach(t => { byKey[t.key] = t; });
  const count = s => teams.filter(t => t.status === s).length;

  let html = `<div class="reach-summary"><b>${count('active')} of ${teams.length} teams</b> active in the last 2 weeks · ${count('quiet')} quiet (2 to 6 weeks) · ${count('idle') + count('never')} not seen for 6+ weeks or never</div>`;
  html += '<div class="table-scroll"><table class="reach-table team-grid"><thead><tr><th></th>';
  campuses.forEach(c => { html += `<th style="color:${campusColour_(c)}">${esc(c)}</th>`; });
  html += '</tr></thead><tbody>';
  years.forEach(y => {
    html += `<tr><th>${esc(y)}</th>`;
    campuses.forEach(c => {
      const t = byKey[amTeamKey(c, y)];
      if(!t){ html += '<td class="team-cell team-none">·</td>'; return; }
      const tip = `${y} ${c}: ${plural_(t.views, 'unit-page view')}, ${t.intents} "going to try", ${t.used} "used"` +
        (t.last ? `. Last active ${fmtDay_(t.last)}.` : '. Never seen.');
      html += `<td class="team-cell team-${t.status}" title="${esc(tip)}">${esc(t.last ? fmtDay_(t.last) : 'Never')}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  html += '<div class="team-legend"><span><span class="team-key team-active"></span>active in the last 2 weeks</span>' +
    '<span><span class="team-key team-quiet"></span>2 to 6 weeks ago</span>' +
    '<span><span class="team-key team-idle"></span>longer ago, or never</span></div>';
  el.innerHTML = html;
}

/* ---------- Visits by campus ---------- */
function renderCampusBar(m){
  const id = 'live-campus-chart';
  const host = document.getElementById(id);
  const rows = amCampusTotals(m).filter(r => r.campus !== AM_NO_CAMPUS);
  if(!rows.some(r => r.visits)){
    disposeChart_(id);
    if(host){ host.style.height = ''; host.innerHTML = '<div class="empty-msg">No visits recorded yet.</div>'; }
    return;
  }
  const labels = rows.map(r => r.campus);
  const base = chartBase_();
  const opt = Object.assign(base, {
    legend: { show: false },
    grid: { left: 12, right: 40, top: 8, bottom: 24, containLabel: true },
    tooltip: Object.assign(base.tooltip, {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      formatter: params => {
        const r = rows[params[0].dataIndex];
        return `<b>${esc(r.campus)}</b><br/>Visits: <b>${r.visits}</b><br/>Page views: ${r.pageViews}<br/>Avg time per page: ${r.avgSeconds ? r.avgSeconds + 's' : 'n/a'}`;
      }
    }),
    xAxis: axisStyle_({ type: 'value', minInterval: 1 }),
    yAxis: axisStyle_({ type: 'category', data: labels, inverse: true,
      axisLabel: { color: ANALYTICS_PALETTE.text, fontWeight: 600, fontSize: 12 } }),
    series: [{
      name: 'Visits', type: 'bar', barWidth: 22,
      data: rows.map(r => ({ value: r.visits, itemStyle: { color: campusColour_(r.campus), borderRadius: [0, 6, 6, 0] } })),
      label: { show: true, position: 'right', color: ANALYTICS_PALETTE.dim, fontSize: 11 }
    }]
  });
  if(host) host.style.height = Math.max(140, labels.length * 40 + 30) + 'px';
  mountChart_(id, opt);
}

/* ---------- Teams who clicked "I Used This" ---------- */
function renderUsedByTeam(m){
  const el = document.getElementById('live-used-by-team'); if(!el) return;
  const countEl = document.getElementById('live-used-by-team-count');
  if(!m.used.length){
    if(countEl) countEl.textContent = '';
    el.innerHTML = '<div class="empty-msg">No "I Used This" clicks yet.</div>';
    return;
  }
  const tally = {};
  m.used.forEach(e => {
    const t = tally[e.team] || (tally[e.team] = { team: e.team, campus: e.campus, count: 0, last: null });
    t.count++;
    if(e.ts && (!t.last || e.ts > t.last)) t.last = e.ts;
  });
  const sorted = Object.values(tally).sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
  const max = sorted[0].count;
  if(countEl) countEl.textContent = `${plural_(sorted.length, 'team')} · ${plural_(m.used.length, 'click')}`;
  el.innerHTML = sorted.slice(0, 20).map((t, idx) => {
    const col = campusColour_(t.campus);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="width:18px;font-size:11px;color:var(--dim);text-align:right;flex-shrink:0">${idx + 1}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px;gap:8px">
          <span style="color:${col};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.team)}</span>
          <span style="color:var(--dim);flex-shrink:0">${t.count} · last ${esc(t.last ? fmtDay_(t.last) : 'date unknown')}</span>
        </div>
        <div style="height:6px;background:var(--card2);border-radius:3px">
          <div style="height:100%;border-radius:3px;background:${col};width:${Math.round((t.count / max) * 100)}%"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ========================= ENGAGEMENT ========================= */

/* ---------- Four steps: visit, open a unit, plan, use ---------- */
function renderEngagementSteps(m){
  const el = document.getElementById('live-steps'); if(!el) return;
  const s = amSteps(m);
  const steps = [
    { lbl: 'Visits',             v: s.visits,     col: ANALYTICS_PALETTE.blue,   hint: 'sittings at the DLA' },
    { lbl: 'Opened a unit page', v: s.teamVisits, col: ANALYTICS_PALETTE.purple, hint: 'visits that reached a year level or unit' },
    { lbl: '"Going to try"',     v: s.intents,    col: ANALYTICS_PALETTE.gold, hint: 'ideas teachers planned to try' },
    { lbl: '"Used"',             v: s.used,       col: ANALYTICS_PALETTE.lime,   hint: 'ideas teachers ran' }
  ];
  el.innerHTML = '<div class="step-row">' + steps.map((x, i) => `
    ${i ? '<div class="step-arrow" aria-hidden="true">→</div>' : ''}
    <div class="step-box">
      <div class="step-lbl">${esc(x.lbl)}</div>
      <div class="step-num" style="color:${x.col}">${x.v.allTime}</div>
      <div class="step-sub">${x.v.recent} in the last 4 weeks</div>
      <div class="step-hint">${esc(x.hint)}</div>
    </div>`).join('') + '</div>';
}

/* ---------- In-page teacher actions ----------
   The Interactions sheet, fed by index.html trackInteraction since
   2026-07-07. Headline is AI generations, because each is a paid model call. */
function renderInteractionsCard(m){
  const el = document.getElementById('live-interactions'); if(!el) return;
  const rows = m.interactions;
  if(!rows.length){
    el.innerHTML = '<div class="empty-msg">No in-page actions recorded yet. Collection started 7 Jul 2026.</div>';
    return;
  }
  const counts = {};
  rows.forEach(r => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
  const ai = (counts['tech_picker_generate'] || 0) + (counts['tech_picker_regen'] || 0) + (counts['tech_picker_custom'] || 0);
  const LABELS = [
    ['tech_picker_open', '🔧 Tool picker opened'],
    ['tech_picker_generate', '✨ AI idea generated from picker'],
    ['tech_picker_regen', '↻ AI idea regenerated'],
    ['tech_picker_custom', '✏️ AI idea with custom unit details'],
    ['tech_chip_reopen', '📌 Saved picker result reopened'],
    ['copilot_open', '🤖 "How do I teach this?" opened'],
    ['stem_reveal', '🔬 STEM activity revealed'],
    ['feedback_open', '💬 Feedback box opened'],
    ['uoi_submit', '📝 Unit details proposed']
  ];
  const max = Math.max(1, ...LABELS.map(([k]) => counts[k] || 0));
  const items = LABELS.map(([k, label]) => {
    const n = counts[k] || 0;
    return '<div style="display:flex;align-items:center;gap:10px;margin:5px 0;flex-wrap:wrap">'
      + '<div style="flex:0 1 250px;min-width:180px;font-size:12.5px;color:#ccc">' + label + '</div>'
      + '<div style="flex:1;min-width:80px;height:8px;background:var(--card2,#1a1a1a);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + Math.round(n / max * 100) + '%;background:var(--lime,#B5D334)"></div></div>'
      + '<div style="flex:0 0 46px;text-align:right;font-size:12.5px;font-weight:700;color:#fff">' + n + '</div></div>';
  }).join('');
  el.innerHTML = '<div style="display:flex;gap:18px;align-items:baseline;margin-bottom:8px;flex-wrap:wrap">'
    + '<div><span style="font-size:26px;font-weight:800;color:var(--lime,#B5D334)">' + ai + '</span>'
    + '<span style="font-size:12px;color:#999;margin-left:8px">AI generations (each is a paid model call)</span></div>'
    + '<div style="flex:1"></div><div style="font-size:12px;color:#999">' + plural_(rows.length, 'action') + ' total</div></div>'
    + items;
}

/* ---------- Tools teachers used or planned to try ---------- */
let CURRENT_RANKING_SCOPE = 'all';

function setRankingScope(scope){
  CURRENT_RANKING_SCOPE = scope || 'all';
  document.querySelectorAll('.ranking-scope').forEach(b => b.classList.toggle('active', b.dataset.scope === CURRENT_RANKING_SCOPE));
  renderToolRankings(CURRENT_RANKING_SCOPE);
}

function renderToolRankings(scope){
  const m = window._analyticsModel; if(!m) return;
  const mostId = 'rankings-most-used-chart';
  const host = document.getElementById(mostId);
  const tools = amToolUsage(m, scope).slice(0, 12);
  if(!tools.length){
    disposeChart_(mostId);
    if(host){ host.style.height = ''; host.innerHTML = '<div class="empty-msg">No "going to try" or "used" clicks yet for this campus.</div>'; }
  } else {
    const labels = tools.map(t => t.tool);
    const base = chartBase_();
    const opt = Object.assign(base, {
      legend: Object.assign(base.legend, { data: ['"Used"', '"Going to try"'] }),
      grid: { left: 12, right: 32, top: 28, bottom: 24, containLabel: true },
      tooltip: Object.assign(base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } }
      }),
      xAxis: axisStyle_({ type: 'value', minInterval: 1 }),
      yAxis: axisStyle_({ type: 'category', data: labels, inverse: true,
        axisLabel: { color: ANALYTICS_PALETTE.text, fontSize: 11, fontWeight: 600,
          formatter: v => v.length > 22 ? v.slice(0, 20) + '…' : v } }),
      series: [
        { name: '"Used"', type: 'bar', stack: 'clicks', barWidth: 14,
          itemStyle: { color: ANALYTICS_PALETTE.lime }, data: tools.map(t => t.used) },
        { name: '"Going to try"', type: 'bar', stack: 'clicks', barWidth: 14,
          itemStyle: { color: ANALYTICS_PALETTE.gold, borderRadius: [0, 4, 4, 0] }, data: tools.map(t => t.intents) }
      ]
    });
    if(host) host.style.height = Math.max(200, labels.length * 26 + 50) + 'px';
    mountChart_(mostId, opt);
  }

  const deadEl = document.getElementById('rankings-dead');
  if(!deadEl) return;
  const dead = suggestionUsage_(m, scope)
    .filter(t => t.suggested >= 3 && (t.used === 0 || t.suggested / t.used >= 10))
    .slice(0, 8);
  deadEl.innerHTML = dead.length
    ? dead.map(t => `<div class="dead-row">
        <div class="dead-tool">${esc(t.tool)}</div>
        <div class="dead-sub">Suggested ${t.suggested}× · Used ${t.used}×</div>
      </div>`).join('')
    : '<div class="empty-msg">Every tool that is suggested often also gets used.</div>';
}

/* ---------- Top 10 unit pages ---------- */
function renderTopPages(m){
  const id = 'live-top-pages';
  const host = document.getElementById(id);
  const rows = amTopPages(m, 10);
  if(!rows.length){
    disposeChart_(id);
    if(host){ host.style.height = ''; host.innerHTML = '<div class="empty-msg">No unit pages viewed yet.</div>'; }
    return;
  }
  const labels = rows.map(r => `${r.page} (${CAMPUS_SHORT[r.campus] || r.campus} ${r.year})`);
  const base = chartBase_();
  const opt = Object.assign(base, {
    legend: { show: false },
    grid: { left: 12, right: 32, top: 8, bottom: 24, containLabel: true },
    tooltip: Object.assign(base.tooltip, {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      formatter: params => {
        const r = rows[params[0].dataIndex];
        return `<b>${esc(r.page)}</b><br/>${esc(r.campus)}, ${esc(r.year)}<br/>Views: <b>${r.views}</b><br/>Avg time: ${r.avgSeconds}s`;
      }
    }),
    xAxis: axisStyle_({ type: 'value', minInterval: 1 }),
    yAxis: axisStyle_({ type: 'category', data: labels, inverse: true,
      axisLabel: { color: ANALYTICS_PALETTE.text, fontSize: 11, fontWeight: 500,
        formatter: v => v.length > 40 ? v.slice(0, 38) + '…' : v } }),
    series: [{
      name: 'Views', type: 'bar', data: rows.map(r => r.views), barWidth: 16,
      itemStyle: { color: ANALYTICS_PALETTE.blue, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', color: ANALYTICS_PALETTE.dim, fontSize: 10 }
    }]
  });
  if(host) host.style.height = Math.max(180, labels.length * 28 + 40) + 'px';
  mountChart_(id, opt);
}

/* ---------- Latest "I Used This" clicks ---------- */
function renderLatestUsed(m){
  const el = document.getElementById('live-used'); if(!el) return;
  const list = m.used.slice().sort(byNewest_).slice(0, 15);
  if(!list.length){ el.innerHTML = '<div class="empty-msg">No tools marked as used yet.</div>'; return; }
  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px">' + list.map(e => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--card2);border-radius:8px;font-size:12px;flex-wrap:wrap">
      <span style="color:var(--lime);font-size:16px">✓</span>
      <span style="color:${campusColour_(e.campus)};font-weight:700;min-width:100px">${esc(e.campus)}</span>
      <span style="color:var(--gold);font-weight:600;min-width:62px">${esc(e.year)}</span>
      <span style="flex:1;font-weight:600;min-width:120px">${esc(e.tool) || '(no tool)'}</span>
      <span style="color:var(--dim)">${esc(e.theme)}</span>
      <span style="color:var(--dim);flex-shrink:0">${esc(fmtWhen_(e.ts))}</span>
    </div>`).join('') + '</div>';
}

/* ========================= FEEDBACK & AUDIT ========================= */

function renderFeedbackList(m){
  const el = document.getElementById('live-feedback'); if(!el) return;
  const list = m.feedback.slice().sort(byNewest_).slice(0, 20);
  if(!list.length){ el.innerHTML = '<div class="empty-msg">No written feedback yet.</div>'; return; }
  el.innerHTML = list.map(f => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        <span style="font-size:11px;color:${campusColour_(f.campus)};font-weight:700">${esc(f.campus)}</span>
        <span style="font-size:11px;color:var(--gold);font-weight:600">${esc(f.year)}</span>
        <span style="font-size:11px;color:var(--dim)">${esc(f.theme)}</span>
        <span style="font-size:11px;color:var(--dim);margin-left:auto">${esc(fmtDay_(f.ts))}</span>
      </div>
      <div style="font-size:11px;color:#9B8BFF;margin-bottom:4px">${esc(f.tool)}${f.phase ? ' · ' + esc(f.phase) : ''}</div>
      <div style="font-size:13px;color:var(--text);line-height:1.5">${esc(f.text)}</div>
    </div>`).join('');
}

/* ---------- Click audit: every "I Used This" row ---------- */
let AUDIT_FILTERS = { campus: 'all', year: 'all', search: '' };

function renderUsedAudit(m){
  m = m || window._analyticsModel;
  if(!m) return;
  const el = document.getElementById('live-used-audit'); if(!el) return;
  const countEl = document.getElementById('live-used-audit-count');
  const events = m.used;

  const yearSel = document.getElementById('audit-year-filter');
  if(yearSel){
    const years = AM_YEARS.filter(y => events.some(e => e.year === y));
    yearSel.innerHTML = '<option value="all">All year levels</option>' + years.map(y => `<option value="${esc(y)}">${esc(y)}</option>`).join('');
    yearSel.value = years.indexOf(AUDIT_FILTERS.year) >= 0 ? AUDIT_FILTERS.year : 'all';
    AUDIT_FILTERS.year = yearSel.value;
  }

  const campus = AUDIT_FILTERS.campus === 'all' ? null : amCampus(AUDIT_FILTERS.campus);
  const q = AUDIT_FILTERS.search.trim().toLowerCase();
  const filtered = events
    .filter(e => !campus || e.campus === campus)
    .filter(e => AUDIT_FILTERS.year === 'all' || e.year === AUDIT_FILTERS.year)
    .filter(e => !q || [e.theme, e.tool, e.phase, e.team].some(v => String(v || '').toLowerCase().includes(q)))
    .sort(byNewest_);

  if(countEl) countEl.textContent = filtered.length === events.length
    ? plural_(filtered.length, 'click')
    : `${filtered.length} of ${plural_(events.length, 'click')}`;

  if(!filtered.length){
    el.innerHTML = '<div class="empty-msg">No matching clicks.</div>';
    return;
  }
  const cap = 300;
  el.innerHTML = filtered.slice(0, cap).map(e => `
    <div style="padding:8px 0;border-bottom:1px solid #2a2a2a;font-size:12px;line-height:1.5">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:2px">
        <span style="color:${campusColour_(e.campus)};font-weight:600">${esc(e.team)}</span>
        <span style="color:var(--dim);font-size:11px;flex-shrink:0">${esc(fmtWhen_(e.ts))}</span>
      </div>
      <div style="color:var(--text)">${esc(e.theme) || '<span style="color:var(--dim)">(no theme)</span>'}</div>
      <div style="color:var(--dim);font-size:11px">${esc(e.tool) || 'no tool'}${e.phase ? ' · ' + esc(e.phase) : ''}</div>
    </div>`).join('') +
    (filtered.length > cap ? `<div style="color:var(--dim);font-size:11px;padding:8px 0;text-align:center">Showing the newest ${cap}. Narrow the filters to see the rest.</div>` : '');
}

function setAuditCampus(c){
  AUDIT_FILTERS.campus = c || 'all';
  document.querySelectorAll('.audit-campus').forEach(b => b.classList.toggle('active', b.dataset.campus === AUDIT_FILTERS.campus));
  renderUsedAudit();
}
function setAuditYear(y){ AUDIT_FILTERS.year = y || 'all'; renderUsedAudit(); }
function setAuditSearch(s){ AUDIT_FILTERS.search = s || ''; renderUsedAudit(); }
