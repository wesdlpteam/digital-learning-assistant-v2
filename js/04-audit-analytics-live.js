/* =============================================================
   04-audit-analytics-live.js  —  Live Analytics, ECharts edition

   Replaces the hand-rolled SVG/HTML chart renderers that used to
   live in 09-legacy-restored.js with an ECharts-driven dashboard
   organised into four sub-tabs (Overview / Adoption / Engagement /
   Feedback & Audit).

   Loads BEFORE 09. The dispatcher (loadLiveAnalytics) and the data
   fetchers (readSheetRange, readMultipleRanges, getAnalyticsSheetTz)
   still live in 09 — only the rendering layer moved here.

   List-style renderers that 09 still owns:
     - renderLiveScorecard, renderLiveUsedByTeam, renderLiveUsedAudit,
       renderLiveThumbsDown, renderLiveFeedback, renderLiveUsed

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
const CAMPUS_COLOURS = {
  'Elsternwick':   '#818cf8',
  'Glen Waverley': '#34d399',
  'St Kilda Rd':   '#fb923c',
  'St Kilda':      '#fb923c'
};

// All ECharts instances we own. Keyed by DOM id so we can re-init and resize cleanly.
const ECHART_INSTANCES = {};

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
  setTimeout(() => {
    Object.values(ECHART_INSTANCES).forEach(inst => {
      if(inst && !inst.isDisposed()) inst.resize();
    });
  }, 30);
}

window.addEventListener('resize', () => {
  Object.entries(ECHART_INSTANCES).forEach(([id, inst]) => {
    if(!inst || inst.isDisposed()) return;
    const el = document.getElementById(id);
    if(el) compensateBodyZoom_(el);
    inst.resize();
  });
});

/* ---------- Shared parsing helpers (mirror 09's helpers) ---------- */
function analyticsDate_(raw){
  // Reuse 09's parser if available so we honour the sheet timezone.
  if(typeof parseGrowthTimestamp_ === 'function') return parseGrowthTimestamp_(raw);
  const s = String(raw||'').trim();
  if(!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m) return new Date(Number(m[3]), Number(m[2])-1, Number(m[1]), Number(m[4]||0), Number(m[5]||0), Number(m[6]||0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function daysAgo_(n){
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - n);
  return d;
}

function teamKey_(campus, year){
  return `${String(campus||'').trim()}::${String(year||'').trim()}`;
}

// Distinct campuses/year levels we see in DATA — used to compute "total teams".
function teamUniverse_(){
  const set = new Set();
  if(typeof DATA !== 'undefined' && Array.isArray(DATA)){
    DATA.forEach(e => {
      if(e && e.ca && e.yl) set.add(teamKey_(e.ca, e.yl));
    });
  }
  return set;
}

/* ---------- Insights (Overview) ----------
   Rule-based, deterministic, free. Each rule produces zero or one card.
   Order matters — the most important / actionable ones come first so the
   grid layout puts them top-left. Keep each card body ≤ 200 chars so
   leadership can skim five of them in a glance. */
function renderInsights(){
  const el = document.getElementById('live-insights'); if(!el) return;
  const countEl = document.getElementById('live-insights-count');

  const cache         = window._growthRowsCache || {};
  const analyticsRows = cache.analytics || [];
  const usedRows      = cache.used      || window._usedRowsCache || [];
  const reactionsRows = window._reactionsCache || [];
  const feedbackRows  = window._feedbackCache  || [];

  const since7  = daysAgo_(7);
  const since14 = daysAgo_(14);
  const since30 = daysAgo_(30);

  const viewDates = analyticsRows.slice(1).map(r => analyticsDate_(r[0])).filter(Boolean);
  const usedEvents = usedRows.slice(1)
    .filter(r => r && (r[1] || (r[2] && r[3])))
    .map(r => ({
      ts: analyticsDate_(r[0]),
      team: String(r[1]||'').trim() || `${String(r[2]||'').trim()} ${String(r[3]||'').trim()} Team`,
      campus: String(r[2]||'').trim(),
      year:   String(r[3]||'').trim(),
      tool:   (typeof normaliseToolName === 'function') ? normaliseToolName(String(r[5]||'').trim()) : String(r[5]||'').trim()
    }));

  const ins = [];

  // ---- 1. Weekly velocity ----
  const viewsThisWk = viewDates.filter(d => d >= since7).length;
  const viewsPrevWk = viewDates.filter(d => d >= since14 && d < since7).length;
  const growthPct   = viewsPrevWk > 0 ? Math.round(((viewsThisWk - viewsPrevWk) / viewsPrevWk) * 100) : null;

  if(growthPct !== null && Math.abs(growthPct) >= 15){
    ins.push({
      icon: growthPct > 0 ? '📈' : '📉',
      tone: growthPct > 0 ? 'positive' : 'warning',
      title: growthPct > 0
        ? `Views are up ${growthPct}% this week`
        : `Views are down ${Math.abs(growthPct)}% this week`,
      body: growthPct > 0
        ? `${viewsThisWk} unit views in the last 7 days vs ${viewsPrevWk} the prior week. Good moment to surface success stories in the next staff comms.`
        : `Engagement dipped from ${viewsPrevWk} to ${viewsThisWk} unit views. Consider a short "have you tried…" nudge to quieter teams.`
    });
  } else if(viewDates.length > 50 && viewsThisWk === 0){
    ins.push({
      icon: '⚠️', tone: 'warning',
      title: 'No views logged this week',
      body: 'The DLA had no recorded page views in the last 7 days. Worth confirming the public site is reachable and the link is visible to teachers.'
    });
  }

  // ---- 2. Quiet campuses ----
  const lastSeenByCampus = {};
  usedEvents.forEach(e => {
    if(!e.ts || !e.campus) return;
    const key = e.campus.replace(/ Rd$/i, ' Rd');
    if(!lastSeenByCampus[key] || e.ts > lastSeenByCampus[key]) lastSeenByCampus[key] = e.ts;
  });
  const knownCampuses = ['Elsternwick','Glen Waverley','St Kilda Rd'];
  const quiet = knownCampuses.filter(c => {
    const last = lastSeenByCampus[c] || lastSeenByCampus[c.replace(' Rd','')];
    return !last || last < since14;
  });
  if(quiet.length && usedEvents.length > 0){
    ins.push({
      icon: '🔕', tone: 'warning',
      title: `${quiet.length === 3 ? 'All campuses' : quiet.join(' + ')} quiet for 2+ weeks`,
      body: `No "I Used This" clicks recently from ${quiet.join(', ')}. A short check-in or recap email often re-activates teams that have drifted.`,
      action: { label: 'See click audit', target: 'feedback' }
    });
  }

  // ---- 3. Worst-rated tool with enough reactions to be reliable ----
  const reactions = (typeof parseReactionRows === 'function') ? parseReactionRows(reactionsRows) : [];
  const reactCounts = {};
  reactions.forEach(ev => {
    const key = ev.tool || ev.rawTool; if(!key) return;
    if(!reactCounts[key]) reactCounts[key] = { up:0, down:0 };
    if(ev.reaction === 'up')   reactCounts[key].up++;
    if(ev.reaction === 'down') reactCounts[key].down++;
  });
  const worst = Object.entries(reactCounts)
    .map(([t,c]) => ({ tool:t, up:c.up, down:c.down, total:c.up+c.down, approval: (c.up+c.down) ? c.up/(c.up+c.down) : 1 }))
    .filter(r => r.total >= 3 && r.approval < 0.5)
    .sort((a,b) => b.down - a.down)[0];
  if(worst){
    ins.push({
      icon: '👎', tone: 'warning',
      title: `${worst.tool} has ${Math.round(worst.approval*100)}% approval`,
      body: `${worst.total} teachers reacted (${worst.down} 👎, ${worst.up} 👍). Highest-priority candidate for rewriting or replacing in the suggestion library.`,
      action: { label: 'Open review queue', target: 'feedback' }
    });
  }

  // ---- 4. Dead suggestions ----
  const usageCount = {};
  usedEvents.forEach(e => { if(e.tool) usageCount[e.tool] = (usageCount[e.tool]||0) + 1; });
  const suggestedCount = {};
  if(typeof DATA !== 'undefined' && Array.isArray(DATA)){
    DATA.forEach(entry => {
      if(!entry || !entry.audited) return;
      const sugs = (typeof getSugs === 'function') ? getSugs(entry) : (entry.sg || []);
      sugs.forEach(s => {
        const raw = s && s.t ? s.t.trim() : '';
        const tool = (typeof normaliseToolName === 'function') ? normaliseToolName(raw) : raw;
        if(tool) suggestedCount[tool] = (suggestedCount[tool]||0) + 1;
      });
    });
  }
  const deadList = Object.entries(suggestedCount)
    .filter(([t, n]) => n >= 5 && !usageCount[t])
    .sort((a,b) => b[1] - a[1]);
  if(deadList.length >= 3){
    const worstThree = deadList.slice(0,3).map(([t]) => t).join(', ');
    ins.push({
      icon: '🪦', tone: 'neutral',
      title: `${deadList.length} tools suggested but never used`,
      body: `Top offenders: ${worstThree}. These appear 5+ times in the suggestion library with zero confirmed uses — strong candidates for a Bulk AI Edit refresh.`,
      action: { label: 'See dead list', target: 'engagement' }
    });
  }

  // ---- 5. Champion team ----
  const teamCounts = {};
  usedEvents.forEach(e => { teamCounts[e.team] = (teamCounts[e.team]||0) + 1; });
  const teamList = Object.entries(teamCounts).sort((a,b) => b[1] - a[1]);
  if(teamList.length >= 4){
    const [topTeam, topCount] = teamList[0];
    const median = teamList[Math.floor(teamList.length/2)][1] || 1;
    if(topCount >= median * 2 && topCount >= 5){
      ins.push({
        icon: '🌟', tone: 'positive',
        title: `${topTeam} is leading on adoption`,
        body: `${topCount} confirmed uses — ${(topCount/median).toFixed(1)}× the median team. Worth a conversation about what's working and sharing it back to peers.`
      });
    }
  }

  // ---- 6. Reach gap (campuses with views but no uses) ----
  // Counts views-per-campus to compare against use-per-campus.
  const viewsByCampus = {}, usesByCampus = {};
  analyticsRows.slice(1).forEach(r => {
    const c = String(r[3]||'').trim();
    if(!c) return;
    const d = analyticsDate_(r[0]);
    if(d && d >= since30) viewsByCampus[c] = (viewsByCampus[c]||0) + 1;
  });
  usedEvents.forEach(e => {
    if(!e.ts || e.ts < since30 || !e.campus) return;
    usesByCampus[e.campus] = (usesByCampus[e.campus]||0) + 1;
  });
  const reachGap = Object.entries(viewsByCampus)
    .filter(([c, v]) => v >= 20 && !(usesByCampus[c] || usesByCampus[c.replace(' Rd','')] || usesByCampus[c + ' Rd']))
    .sort((a,b) => b[1] - a[1])[0];
  if(reachGap){
    ins.push({
      icon: '🪞', tone: 'warning',
      title: `${reachGap[0]} viewing without converting`,
      body: `${reachGap[1]} unit views from ${reachGap[0]} in the last 30 days but zero "I Used This" clicks. The suggestions may be browsed but not acted on — worth a workshop or follow-up.`,
      action: { label: 'See adoption tab', target: 'adoption' }
    });
  }

  // ---- 7. Conversion rate baseline ----
  const totalSug = Object.values(suggestedCount).reduce((a,b)=>a+b,0);
  const totalUse = Object.values(usageCount).reduce((a,b)=>a+b,0);
  if(totalSug > 50 && totalUse > 0){
    const conv = (totalUse / totalSug) * 100;
    if(conv < 3){
      ins.push({
        icon: '🔬', tone: 'neutral',
        title: `Suggestion-to-use conversion: ${conv.toFixed(1)}%`,
        body: `Only a small fraction of AI suggestions translate to confirmed uses. Normal early on, but if it stays under 3% the suggestions may not match how teachers plan — worth a small qualitative dive into the feedback log.`
      });
    }
  }

  // ---- 8. Healthy baseline (only if nothing else fired) ----
  if(!ins.length){
    if(usedEvents.length === 0){
      ins.push({
        icon: '👋', tone: 'neutral',
        title: 'Waiting for the first signal',
        body: 'No teachers have clicked "I Used This" yet. Once a few teams start engaging, this panel will surface trends, gaps, and quick wins automatically.'
      });
    } else {
      ins.push({
        icon: '✅', tone: 'positive',
        title: 'Nothing urgent right now',
        body: 'No engagement dips, low-approval tools, or quiet campuses detected. Keep the momentum — surface a recent win or success story in the next staff comms.'
      });
    }
  }

  // Render
  if(countEl) countEl.textContent = `${ins.length} insight${ins.length === 1 ? '' : 's'}`;
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

/* ---------- KPI strip (Overview) ---------- */
function renderKpiStrip(dashRows, usedRows, analyticsRows){
  const el = document.getElementById('live-kpi-strip'); if(!el) return;

  const used = (usedRows||[]).slice(1).filter(r => r && (r[1] || (r[2] && r[3])));
  const views = (analyticsRows||[]).slice(1);

  const since7  = daysAgo_(7);
  const since14 = daysAgo_(14);

  const isAfter = (d, since) => d && d >= since;
  const usedDates = used.map(r => ({ d: analyticsDate_(r[0]), team: teamKey_(r[2], r[3]) })).filter(x => x.d);
  const viewDates = views.map(r => analyticsDate_(r[0])).filter(Boolean);

  const usesThisWeek = usedDates.filter(x => isAfter(x.d, since7)).length;
  const usesTotal    = used.length;

  const activeTeamsThisWeek = new Set(usedDates.filter(x => isAfter(x.d, since7)).map(x => x.team));
  const teamUniverse = teamUniverse_();
  const reachPct = teamUniverse.size ? Math.round((activeTeamsThisWeek.size / teamUniverse.size) * 100) : 0;

  const avgPerActive = activeTeamsThisWeek.size ? (usesThisWeek / activeTeamsThisWeek.size).toFixed(1) : '0';

  const viewsThisWk = viewDates.filter(d => isAfter(d, since7)).length;
  const viewsPrevWk = viewDates.filter(d => d >= since14 && d < since7).length;
  const growth = viewsPrevWk > 0 ? Math.round(((viewsThisWk - viewsPrevWk) / viewsPrevWk) * 100) : (viewsThisWk > 0 ? 100 : 0);

  const kpis = [
    { num: activeTeamsThisWeek.size, sub: `of ${teamUniverse.size} teams this week`, lbl: 'Active teams', col: ANALYTICS_PALETTE.lime, extra: `${reachPct}% reach` },
    { num: usesThisWeek,             sub: 'tools marked used (7d)',                 lbl: 'Uses this week',   col: ANALYTICS_PALETTE.blue },
    { num: usesTotal,                sub: 'all-time confirmed uses',                 lbl: 'Total uses',       col: ANALYTICS_PALETTE.gold },
    { num: avgPerActive,             sub: 'uses per active team (7d)',               lbl: 'Avg per team',     col: ANALYTICS_PALETTE.purple },
    { num: (growth >= 0 ? '▲ ' : '▼ ') + Math.abs(growth) + '%', sub: 'views, 7d vs prior 7d', lbl: 'Weekly growth', col: growth >= 0 ? ANALYTICS_PALETTE.lime : ANALYTICS_PALETTE.salmon }
  ];

  el.innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-lbl">${esc(k.lbl)}</div>
      <div class="kpi-num" style="color:${k.col}">${esc(k.num)}</div>
      <div class="kpi-sub">${esc(k.sub)}</div>
      ${k.extra ? `<div class="kpi-extra" style="color:${k.col}">${esc(k.extra)}</div>` : ''}
    </div>
  `).join('');
}

/* ---------- Growth chart (Overview) — ECharts version ---------- */
function renderGrowthChart_eChart(bucket){
  const cache = window._growthRowsCache || {};
  const analyticsRows = cache.analytics || [];
  const usedRows = cache.used || [];
  const scope = (typeof CURRENT_GROWTH_CAMPUS !== 'undefined') ? CURRENT_GROWTH_CAMPUS : 'all';

  // Filter + parse
  const matches = (rowCampus) => {
    if(scope === 'all') return true;
    if(typeof campusMatchesGrowth_ === 'function') return campusMatchesGrowth_(rowCampus, scope);
    return String(rowCampus||'').trim() === scope;
  };
  const viewDates = analyticsRows.slice(1).filter(r => matches(r[3])).map(r => analyticsDate_(r[0])).filter(Boolean);
  const usedDates = usedRows.slice(1).filter(r => matches(r[2])).map(r => analyticsDate_(r[0])).filter(Boolean);

  const trendNoteEl = document.getElementById('live-growth-trend');
  const messageEl  = document.getElementById('live-growth-empty');
  const chartEl    = document.getElementById('live-growth-chart');

  if(!viewDates.length && !usedDates.length){
    if(chartEl) chartEl.style.display = 'none';
    if(messageEl){
      const label = scope === 'all' ? 'teachers start using the DLA' : 'activity is recorded for ' + scope;
      messageEl.style.display = 'block';
      messageEl.textContent = `No timestamped activity yet — graph appears once ${label}.`;
    }
    if(trendNoteEl) trendNoteEl.innerHTML = '';
    disposeChart_('live-growth-chart');
    return;
  }
  if(messageEl) messageEl.style.display = 'none';
  if(chartEl)   chartEl.style.display   = 'block';

  // Bucketing identical to 09's renderLiveGrowth so the numbers stay consistent.
  const now = new Date();
  let bucketsBack, startOf, keyOf, advance, fmtLabel, trendWindow, trendLabel;
  if(bucket === 'day'){
    bucketsBack = 30;
    startOf = d => dayStart_(d);
    keyOf   = d => isoKey_(dayStart_(d));
    advance = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    fmtLabel = d => d.toLocaleDateString('en-AU', { day:'numeric', month:'short' });
    trendWindow = 7;  trendLabel = 'last 7d vs prior 7d';
  } else if(bucket === 'month'){
    bucketsBack = 12;
    startOf = d => monthStart_(d);
    keyOf   = d => monthKey_(monthStart_(d));
    advance = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
    fmtLabel = d => d.toLocaleDateString('en-AU', { month:'short', year:'2-digit' });
    trendWindow = 3;  trendLabel = 'last 3mo vs prior 3mo';
  } else {
    bucketsBack = 12;
    startOf = d => weekStart_(d);
    keyOf   = d => isoKey_(weekStart_(d));
    advance = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n*7); return x; };
    fmtLabel = d => d.toLocaleDateString('en-AU', { day:'numeric', month:'short' });
    trendWindow = 4;  trendLabel = 'last 4w vs prior 4w';
  }

  const anchor = startOf(now);
  const buckets = [];
  for(let i = bucketsBack - 1; i >= 0; i--){
    const start = advance(anchor, -i);
    buckets.push({ key: keyOf(start), start, views: 0, used: 0 });
  }
  const idxByKey = Object.fromEntries(buckets.map((b,i)=>[b.key,i]));
  viewDates.forEach(d => { const k = keyOf(d); if(k in idxByKey) buckets[idxByKey[k]].views++; });
  usedDates.forEach(d => { const k = keyOf(d); if(k in idxByKey) buckets[idxByKey[k]].used++; });

  const labels = buckets.map(b => fmtLabel(b.start));
  const viewSeries = buckets.map(b => b.views);
  const usedSeries = buckets.map(b => b.used);

  const tail = buckets.slice(-trendWindow).reduce((a,b)=>a+b.views,0);
  const head = buckets.slice(-trendWindow*2,-trendWindow).reduce((a,b)=>a+b.views,0);
  const pct  = head > 0 ? Math.round(((tail - head) / head) * 100) : (tail > 0 ? 100 : 0);
  const trendCol = pct >= 0 ? ANALYTICS_PALETTE.lime : ANALYTICS_PALETTE.salmon;
  const trendArrow = pct >= 0 ? '▲' : '▼';
  const totalViews = viewSeries.reduce((a,b)=>a+b,0);
  const totalUsed  = usedSeries.reduce((a,b)=>a+b,0);
  if(trendNoteEl){
    trendNoteEl.innerHTML = `
      <span><span class="legend-dot" style="background:${ANALYTICS_PALETTE.blue}"></span>Views <b>${totalViews}</b></span>
      <span><span class="legend-dot" style="background:${ANALYTICS_PALETTE.lime}"></span>Used <b>${totalUsed}</b></span>
      <span style="margin-left:auto;color:${trendCol};font-weight:700">${trendArrow} ${Math.abs(pct)}% <span style="color:var(--dim);font-weight:400">views, ${trendLabel}</span></span>`;
  }

  const opt = Object.assign(chartBase_(), {
    legend: Object.assign(chartBase_().legend, { data: ['Views','Used'] }),
    xAxis: axisStyle_({ type: 'category', data: labels, boundaryGap: false }),
    yAxis: axisStyle_({ type: 'value', minInterval: 1 }),
    series: [
      {
        name: 'Views', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        lineStyle: { color: ANALYTICS_PALETTE.blue, width: 2.5 },
        itemStyle: { color: ANALYTICS_PALETTE.blue },
        areaStyle: { color: { type:'linear', x:0, y:0, x2:0, y2:1, colorStops:[
          { offset:0, color:'rgba(96,184,240,0.35)' }, { offset:1, color:'rgba(96,184,240,0.02)' }
        ]}},
        data: viewSeries
      },
      {
        name: 'Used', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        lineStyle: { color: ANALYTICS_PALETTE.lime, width: 2.5 },
        itemStyle: { color: ANALYTICS_PALETTE.lime },
        areaStyle: { color: { type:'linear', x:0, y:0, x2:0, y2:1, colorStops:[
          { offset:0, color:'rgba(197,232,74,0.30)' }, { offset:1, color:'rgba(197,232,74,0.02)' }
        ]}},
        data: usedSeries
      }
    ]
  });
  mountChart_('live-growth-chart', opt);
}

/* ---------- Reach matrix (Adoption) ---------- */
function renderReachMatrix(usedRows){
  const el = document.getElementById('live-reach-matrix'); if(!el) return;
  const used = (usedRows||[]).slice(1).filter(r => r && r[2] && r[3]);
  if(!used.length){
    el.innerHTML = '<div class="empty-msg">No "I Used This" clicks yet — reach matrix appears once teachers start logging use.</div>';
    return;
  }
  // Total teams per (campus, year) come from DATA — they're what we COULD reach.
  const totals = {};
  if(typeof DATA !== 'undefined'){
    DATA.forEach(e => {
      if(!e || !e.ca || !e.yl) return;
      const key = teamKey_(e.ca, e.yl);
      totals[key] = (totals[key]||0) + 1;
    });
  }
  // Active teams: distinct (campus, year) that have at least one Used row.
  const activeTeams = new Set(used.map(r => teamKey_(r[2], r[3])));

  // Unique campuses + year levels we know about, ordered.
  const yearOrder = (typeof YR !== 'undefined' && Array.isArray(YR)) ? YR : ['Prep','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6'];
  const allKeys = new Set([...Object.keys(totals), ...used.map(r => teamKey_(r[2], r[3]))]);
  const campusSet = new Set();
  const yearSet = new Set();
  allKeys.forEach(k => { const [c,y] = k.split('::'); if(c) campusSet.add(c); if(y) yearSet.add(y); });
  const campuses = [...campusSet].sort();
  const years    = [...yearSet].sort((a,b) => yearOrder.indexOf(a) - yearOrder.indexOf(b));

  // Build cells: active? + count of uses in cell
  const useCount = {};
  used.forEach(r => { const k = teamKey_(r[2], r[3]); useCount[k] = (useCount[k]||0) + 1; });

  const reachedCount = years.flatMap(y => campuses.map(c => activeTeams.has(teamKey_(c, y)) ? 1 : 0)).reduce((a,b)=>a+b,0);
  const totalCells   = campuses.length * years.length;
  const reachLabel   = `${reachedCount} of ${totalCells} active`;

  let html = `<div class="reach-summary"><b>${esc(reachLabel)}</b> — coverage by year level × campus</div>`;
  html += '<table class="reach-table"><thead><tr><th></th>';
  campuses.forEach(c => {
    const col = CAMPUS_COLOURS[c] || ANALYTICS_PALETTE.lime;
    html += `<th style="color:${col}">${esc(c)}</th>`;
  });
  html += '</tr></thead><tbody>';
  years.forEach(y => {
    html += `<tr><th>${esc(y)}</th>`;
    campuses.forEach(c => {
      const k = teamKey_(c, y);
      const active = activeTeams.has(k);
      const count = useCount[k] || 0;
      const col = CAMPUS_COLOURS[c] || ANALYTICS_PALETTE.lime;
      const bg = active ? `${col}33` : 'transparent';
      const fg = active ? col : ANALYTICS_PALETTE.dim;
      const label = active ? `${count}` : '—';
      html += `<td style="background:${bg};color:${fg}" title="${esc(y)} ${esc(c)}: ${count} uses">${esc(label)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

/* ---------- Views by campus (Adoption) — ECharts bar ---------- */
function renderCampusBar_eChart(dashRows){
  const section = typeof findSection === 'function' ? findSection(dashRows, 'VIEWS BY CAMPUS') : [];
  const data = section.slice(1).filter(r => r && r[0] && r[1]);
  if(!data.length){
    const el = document.getElementById('live-campus-chart');
    if(el) el.innerHTML = '<div class="empty-msg">No views data yet.</div>';
    disposeChart_('live-campus-chart');
    return;
  }
  const labels = data.map(r => r[0]);
  const views  = data.map(r => parseInt(r[1])||0);
  const avgs   = data.map(r => parseInt(r[2])||0);
  const colours = labels.map(l => CAMPUS_COLOURS[l] || ANALYTICS_PALETTE.lime);

  const opt = Object.assign(chartBase_(), {
    grid: { left: 100, right: 24, top: 14, bottom: 28, containLabel: true },
    tooltip: Object.assign(chartBase_().tooltip, {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      formatter: (params) => {
        const i = params[0].dataIndex;
        return `<b>${labels[i]}</b><br/>Views: <b>${views[i]}</b><br/>Avg time: ${avgs[i] ? avgs[i] + 's' : '—'}`;
      }
    }),
    xAxis: axisStyle_({ type: 'value' }),
    yAxis: axisStyle_({ type: 'category', data: labels, inverse: true, axisLabel: { color: ANALYTICS_PALETTE.text, fontWeight: 600, fontSize: 12 } }),
    series: [{
      name: 'Views',
      type: 'bar',
      data: views.map((v,i) => ({ value: v, itemStyle: { color: colours[i], borderRadius: [0,6,6,0] } })),
      barWidth: 22,
      label: { show: true, position: 'right', color: ANALYTICS_PALETTE.dim, fontSize: 11 }
    }]
  });
  // ECharts replaces the inner HTML, so make sure the host has height.
  const host = document.getElementById('live-campus-chart');
  if(host && !host.style.height) host.style.height = (Math.max(120, labels.length * 36 + 30)) + 'px';
  mountChart_('live-campus-chart', opt);
}

/* ---------- Year-level coverage (Adoption) — NEW ---------- */
function renderYearCoverage(usedRows){
  const id = 'live-year-coverage';
  const used = (usedRows||[]).slice(1).filter(r => r && r[3]);
  if(!used.length){
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="empty-msg">No usage logged yet.</div>';
    disposeChart_(id);
    return;
  }
  const yearOrder = (typeof YR !== 'undefined' && Array.isArray(YR)) ? YR : ['Prep','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6'];

  // distinct campuses per year level => the number of "teams reached"
  const teamsByYear = {};
  used.forEach(r => {
    const y = String(r[3]||'').trim();
    const c = String(r[2]||'').trim();
    if(!y) return;
    if(!teamsByYear[y]) teamsByYear[y] = new Set();
    if(c) teamsByYear[y].add(c);
  });
  const years = Object.keys(teamsByYear).sort((a,b) => yearOrder.indexOf(a) - yearOrder.indexOf(b));
  const counts = years.map(y => teamsByYear[y].size);
  const useCounts = years.map(y => used.filter(r => String(r[3]||'').trim() === y).length);

  const opt = Object.assign(chartBase_(), {
    grid: { left: 12, right: 24, top: 14, bottom: 28, containLabel: true },
    tooltip: Object.assign(chartBase_().tooltip, {
      trigger: 'axis',
      formatter: (params) => {
        const i = params[0].dataIndex;
        return `<b>${years[i]}</b><br/>Active campuses: <b>${counts[i]}</b><br/>Total uses: ${useCounts[i]}`;
      }
    }),
    xAxis: axisStyle_({ type: 'category', data: years }),
    yAxis: axisStyle_({ type: 'value', minInterval: 1, name: 'campuses', nameTextStyle: { color: ANALYTICS_PALETTE.dim, fontSize: 10, padding:[0,0,6,0] } }),
    series: [{
      type: 'bar',
      data: counts,
      barWidth: '52%',
      itemStyle: { color: ANALYTICS_PALETTE.gold, borderRadius: [6,6,0,0] },
      label: { show: true, position: 'top', color: ANALYTICS_PALETTE.text, fontWeight: 700, fontSize: 12 }
    }]
  });
  const host = document.getElementById(id);
  if(host && !host.style.height) host.style.height = '220px';
  mountChart_(id, opt);
}

/* ---------- Reactions by tool (Engagement) — ECharts diverging bar ---------- */
function renderReactionsBar_eChart(reactionsRows){
  const id = 'live-reactions';
  const events = typeof parseReactionRows === 'function' ? parseReactionRows(reactionsRows) : [];
  if(!events.length){
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="empty-msg">No reactions yet.</div>';
    disposeChart_(id);
    return;
  }
  const counts = {};
  events.forEach(ev => {
    const key = ev.tool || ev.rawTool || 'Unknown tool';
    if(!counts[key]) counts[key] = { up: 0, down: 0 };
    if(ev.reaction === 'up')   counts[key].up++;
    if(ev.reaction === 'down') counts[key].down++;
  });
  const sorted = Object.entries(counts).map(([t,c]) => [t, c.up, c.down, c.up + c.down])
                                       .sort((a,b) => b[3] - a[3]).slice(0, 10);
  const labels = sorted.map(r => r[0]);
  const ups    = sorted.map(r => r[1]);
  const downs  = sorted.map(r => -r[2]);

  const opt = Object.assign(chartBase_(), {
    grid: { left: 130, right: 28, top: 14, bottom: 30, containLabel: true },
    legend: Object.assign(chartBase_().legend, { data: ['👍 Up','👎 Down'] }),
    tooltip: Object.assign(chartBase_().tooltip, {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      formatter: (params) => {
        const i = params[0].dataIndex;
        const up = ups[i], down = -downs[i], total = up + down;
        const approval = total > 0 ? Math.round((up / total) * 100) : 0;
        return `<b>${labels[i]}</b><br/>👍 ${up} · 👎 ${down}<br/>Approval: <b>${approval}%</b>`;
      }
    }),
    xAxis: axisStyle_({ type: 'value', axisLabel: { color: ANALYTICS_PALETTE.dim, formatter: v => Math.abs(v) } }),
    yAxis: axisStyle_({ type: 'category', data: labels, inverse: true, axisLabel: { color: ANALYTICS_PALETTE.text, fontSize: 11, fontWeight: 600 } }),
    series: [
      { name:'👍 Up',   type:'bar', stack:'reactions', data: ups,   itemStyle:{ color: ANALYTICS_PALETTE.lime,   borderRadius:[0,4,4,0] }, label:{ show:true, position:'right', color: ANALYTICS_PALETTE.lime, fontSize:10 } },
      { name:'👎 Down', type:'bar', stack:'reactions', data: downs, itemStyle:{ color: ANALYTICS_PALETTE.salmon, borderRadius:[4,0,0,4] }, label:{ show:true, position:'left',  color: ANALYTICS_PALETTE.salmon, fontSize:10, formatter: v => v.value ? Math.abs(v.value) : '' } }
    ]
  });
  const host = document.getElementById(id);
  if(host && !host.style.height) host.style.height = (Math.max(160, labels.length * 30 + 50)) + 'px';
  mountChart_(id, opt);
}

/* ---------- Engagement funnel (Engagement) — NEW ---------- */
function renderEngagementFunnel(analyticsRows, reactionsRows, usedRows){
  const id = 'live-funnel';
  const views     = (analyticsRows||[]).slice(1).length;
  const reactions = (reactionsRows||[]).slice(1).filter(r => r && r[6]).length;
  const uses      = (usedRows||[]).slice(1).filter(r => r && r[5]).length;

  if(!views && !reactions && !uses){
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="empty-msg">No engagement data yet.</div>';
    disposeChart_(id);
    return;
  }

  const opt = {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: ANALYTICS_PALETTE.text },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: ANALYTICS_PALETTE.border,
      textStyle: { color: ANALYTICS_PALETTE.text, fontSize: 12 },
      formatter: (p) => {
        const ofViews = views ? Math.round((p.value / views) * 100) : 0;
        return `<b>${p.name}</b><br/>${p.value}<br/>${ofViews}% of total views`;
      }
    },
    series: [{
      name: 'Funnel',
      type: 'funnel',
      left: '8%',
      right: '8%',
      top: 18,
      bottom: 18,
      width: '84%',
      min: 0,
      max: Math.max(views, 1),
      sort: 'descending',
      gap: 4,
      label: { show: true, position: 'inside', color: '#111', fontWeight: 800, fontSize: 13 },
      labelLine: { show: false },
      itemStyle: { borderColor: '#0d0d0d', borderWidth: 1 },
      data: [
        { value: views,     name: `Views (${views})`,            itemStyle: { color: ANALYTICS_PALETTE.blue   } },
        { value: reactions, name: `Reactions (${reactions})`,    itemStyle: { color: ANALYTICS_PALETTE.purple } },
        { value: uses,      name: `Used (${uses})`,              itemStyle: { color: ANALYTICS_PALETTE.lime   } }
      ]
    }]
  };
  const host = document.getElementById(id);
  if(host && !host.style.height) host.style.height = '260px';
  mountChart_(id, opt);
}

/* ---------- Top 10 pages (Engagement) — ECharts bar ---------- */
function renderTopPages_eChart(dashRows){
  const id = 'live-top-pages';
  const section = typeof findSection === 'function' ? findSection(dashRows, 'TOP 10 MOST VIEWED PAGES') : [];
  const data = section.slice(2).filter(r => r && r[0] && r[1] && r[0] !== 'Page').slice(0,10);
  if(!data.length){
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="empty-msg">No page data yet.</div>';
    disposeChart_(id);
    return;
  }
  const labels = data.map(r => r[0]);
  const views  = data.map(r => parseInt(r[1])||0);
  const times  = data.map(r => parseInt(r[2])||0);
  const avgSec = data.map((r,i) => views[i] ? Math.round(times[i] / views[i]) : 0);

  const opt = Object.assign(chartBase_(), {
    grid: { left: 180, right: 32, top: 14, bottom: 26, containLabel: true },
    tooltip: Object.assign(chartBase_().tooltip, {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      formatter: (params) => {
        const i = params[0].dataIndex;
        return `<b>${labels[i]}</b><br/>Views: <b>${views[i]}</b><br/>Avg time: ${avgSec[i]}s`;
      }
    }),
    xAxis: axisStyle_({ type: 'value' }),
    yAxis: axisStyle_({
      type: 'category', data: labels, inverse: true,
      axisLabel: { color: ANALYTICS_PALETTE.text, fontSize: 11, fontWeight: 500,
        formatter: v => v.length > 26 ? v.slice(0,24) + '…' : v }
    }),
    series: [{
      name: 'Views', type: 'bar', data: views, barWidth: 16,
      itemStyle: { color: ANALYTICS_PALETTE.blue, borderRadius: [0,4,4,0] },
      label: { show: true, position: 'right', color: ANALYTICS_PALETTE.dim, fontSize: 10 }
    }]
  });
  const host = document.getElementById(id);
  if(host && !host.style.height) host.style.height = (Math.max(180, labels.length * 28 + 50)) + 'px';
  mountChart_(id, opt);
}

/* ---------- Tool rankings (Engagement) — ECharts bar, drives the same scope buttons ---------- */
function renderRankingsBar_eChart(scope){
  const mostId = 'rankings-most-used-chart';
  const deadEl = document.getElementById('rankings-dead');
  const rows = window._usedRowsCache || [];
  const usedEvents = rows.slice(1).filter(r => r && r[5]);

  const filtered = usedEvents.filter(r => {
    if(scope === 'all') return true;
    const campus = String(r[2]||'').trim();
    if(scope === 'St Kilda Rd' && (campus === 'St Kilda' || campus === 'St Kilda Rd')) return true;
    return campus === scope;
  });

  const usageCount = {};
  filtered.forEach(r => {
    const tool = (typeof normaliseToolName === 'function')
      ? normaliseToolName(String(r[5]||'').trim())
      : String(r[5]||'').trim();
    if(!tool) return;
    usageCount[tool] = (usageCount[tool] || 0) + 1;
  });

  const sorted = Object.entries(usageCount).sort((a,b) => b[1] - a[1]).slice(0, 12);

  if(!sorted.length){
    const host = document.getElementById(mostId);
    if(host) host.innerHTML = '<div class="empty-msg">No usage logged yet for this scope.</div>';
    disposeChart_(mostId);
  } else {
    const labels = sorted.map(r => r[0]);
    const vals   = sorted.map(r => r[1]);
    const max    = vals[0] || 1;
    const colours = vals.map(v => {
      const ratio = v / max;
      if(ratio > 0.75) return ANALYTICS_PALETTE.lime;
      if(ratio > 0.4)  return ANALYTICS_PALETTE.gold;
      return ANALYTICS_PALETTE.blue;
    });

    const opt = Object.assign(chartBase_(), {
      grid: { left: 160, right: 32, top: 8, bottom: 28, containLabel: true },
      tooltip: Object.assign(chartBase_().tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
        formatter: (params) => `<b>${params[0].name}</b><br/>${params[0].value} uses`
      }),
      xAxis: axisStyle_({ type: 'value', minInterval: 1 }),
      yAxis: axisStyle_({
        type: 'category', data: labels, inverse: true,
        axisLabel: { color: ANALYTICS_PALETTE.text, fontSize: 11, fontWeight: 600,
          formatter: v => v.length > 22 ? v.slice(0,20) + '…' : v }
      }),
      series: [{
        type: 'bar', data: vals.map((v,i) => ({ value: v, itemStyle:{ color: colours[i], borderRadius:[0,4,4,0] } })),
        barWidth: 16,
        label: { show: true, position: 'right', color: ANALYTICS_PALETTE.text, fontWeight: 600, fontSize: 11, formatter: '{c}×' }
      }]
    });
    const host = document.getElementById(mostId);
    if(host && !host.style.height) host.style.height = (Math.max(220, labels.length * 26 + 30)) + 'px';
    mountChart_(mostId, opt);
  }

  // Dead suggestions calc — same logic as 09's renderToolRankings.
  if(!deadEl) return;
  const suggestedCount = {};
  if(typeof DATA !== 'undefined'){
    DATA.forEach(e => {
      if(!e || !e.audited) return;
      if(scope !== 'all'){
        const campus = String(e.ca||'').trim();
        const match = scope === 'St Kilda Rd' ? (campus === 'St Kilda' || campus === 'St Kilda Rd') : campus === scope;
        if(!match) return;
      }
      const sugs = (typeof getSugs === 'function') ? getSugs(e) : (e.sg || []);
      sugs.forEach(s => {
        const raw = (s && s.t ? s.t.trim() : '');
        const tool = (typeof normaliseToolName === 'function') ? normaliseToolName(raw) : raw;
        if(!tool) return;
        suggestedCount[tool] = (suggestedCount[tool] || 0) + 1;
      });
    });
  }
  const dead = Object.entries(suggestedCount)
    .filter(([t, sCount]) => sCount >= 3 && ((usageCount[t]||0) === 0 || (sCount / (usageCount[t]||0.1)) >= 10))
    .sort((a,b) => b[1] - a[1]).slice(0, 8);
  if(!dead.length){
    deadEl.innerHTML = '<div class="empty-msg">No dead suggestions detected — every tool that gets suggested is being used.</div>';
  } else {
    deadEl.innerHTML = dead.map(([tool, sCount]) => {
      const used = usageCount[tool] || 0;
      return `<div class="dead-row">
        <div class="dead-tool">${esc(tool)}</div>
        <div class="dead-sub">Suggested ${sCount}× · Used ${used}×</div>
      </div>`;
    }).join('');
  }
}

/* ---------- Public renderers that the old code paths call ---------- */
// These names match what 09 expects so we can swap implementations without
// touching its loadLiveAnalytics dispatcher.
function renderLiveGrowth(bucket){ renderGrowthChart_eChart(bucket); }
function renderLiveCampusChart(rows){ renderCampusBar_eChart(rows); }
function renderLiveReactions(rows){ renderReactionsBar_eChart(rows); }
function renderLiveTopPages(rows){ renderTopPages_eChart(rows); }
function renderToolRankings(scope){ renderRankingsBar_eChart(scope); }

// The original "Usage Overview" stat-grid becomes the new KPI strip. We override
// renderLiveOverview to pull richer numbers — same call site, deeper content.
function renderLiveOverview(rows){
  const cache = window._growthRowsCache || {};
  renderKpiStrip(rows, cache.used || window._usedRowsCache || [], cache.analytics || []);
}

// Adoption + Engagement extras the dispatcher calls.
function renderLiveAdoptionExtras(){
  const cache = window._growthRowsCache || {};
  renderReachMatrix(cache.used || window._usedRowsCache || []);
  renderYearCoverage(cache.used || window._usedRowsCache || []);
}
function renderLiveEngagementExtras(){
  const cache = window._growthRowsCache || {};
  renderEngagementFunnel(cache.analytics || [], window._reactionsCache || [], cache.used || window._usedRowsCache || []);
}

// The campus heatmap from 09 is replaced by the reach matrix, so render a no-op.
// The host element still exists; we keep it empty for clean removal later.
function renderLiveHeatmap(){
  const el = document.getElementById('live-heatmap');
  if(el) el.innerHTML = '';
}
