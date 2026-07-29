/* Sample analytics for the Studio demo.
 *
 * Every figure here is illustrative. It is never presented as Wesley's real
 * adoption data: the Studio shim stamps "Sample data — demonstration only" on
 * the analytics and dashboard panels, on top of the sandbox badge.
 *
 * ── Sheet shapes, read out of the live renderers (do not guess these) ────────
 *
 * Dashboard!A1:F60   section-headed rows, located by findSection(rows, HEADER)
 *   'WEEKLY SCORECARD'          section.slice(1) → [metric, _, value, target, status, meaning]
 *                               js/09-legacy-restored.js:1303
 *                               status containing 'good' or '✓' renders lime
 *   'VIEWS BY CAMPUS'           section.slice(1) → [campus, views, avgSeconds]
 *                               js/04-audit-analytics-live.js:888
 *   'TOP 10 MOST VIEWED PAGES'  section.slice(2) → [page, views, totalSeconds]
 *                               js/04-audit-analytics-live.js:1036 (drops r[0]==='Page')
 *
 * Analytics!A1:F5000  header row + one row per page view
 *   [timestamp, ?, ?, campus, ...]      r[0] date, r[3] campus (js/04:313)
 *
 * Used!A1:G2000       header row + one row per "I Used This" click
 *   [timestamp, team, campus, year, theme, tool, phase]   (js/09:1423, verbatim)
 *
 * Intent!A1:G2000     same shape as Used ("I'm going to try this")
 * Interactions!A1:G5000  header row + [timestamp, session, kind, page, campus, year, detail]
 *
 * ── Timestamps ───────────────────────────────────────────────────────────────
 * The dashboard filters on rolling 7/14/30-day windows. Baking fixed dates would
 * leave every panel empty once the demo is a month old, which is exactly when
 * the conference happens. So timestamps are written as the sentinel
 *   @-<days>d<HH>:<MM>
 * and tools/browser/studio-shim.js turns them into real dates at page load.
 * The demo therefore always looks like it was captured this week.
 */

export const TIMESTAMP_SENTINEL = /^@-(\d+)d(\d{2}):(\d{2})$/;

export const CAMPUSES = ['Elsternwick', 'Glen Waverley', 'St Kilda'];
export const YEAR_LEVELS = ['Prep', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6'];

const THEMES = [
  'How We Express Ourselves',
  'How the World Works',
  'Sharing the Planet',
  'Who We Are',
  'Where We Are in Place and Time',
  'How We Organise Ourselves'
];

const PAGES = [
  'Elsternwick · Year 5', 'Glen Waverley · Year 3', 'St Kilda · Year 6',
  'Glen Waverley · Year 5', 'Elsternwick · Year 2', 'St Kilda · Year 4',
  'Glen Waverley · Prep', 'Elsternwick · Year 6', 'St Kilda · Year 1',
  'Glen Waverley · Year 4'
];

function stamp(daysAgo, hour, minute) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `@-${daysAgo}d${hh}:${mm}`;
}

// Deterministic spread — no Math.random, so rebuilds are byte-identical and the
// dataset can be asserted in tests.
function pick(list, i) { return list[i % list.length]; }

function buildUsedRows(tools) {
  const header = ['Timestamp', 'Team', 'Campus', 'Year', 'Theme', 'Tool', 'Phase'];
  const rows = [header];
  let i = 0;
  // Every campus × every year level active, several times each across 28 days.
  for (let round = 0; round < 7; round++) {
    for (const campus of CAMPUSES) {
      for (const year of YEAR_LEVELS) {
        const daysAgo = 1 + ((round * 4 + i) % 27);
        rows.push([
          stamp(daysAgo, 9 + (i % 8), (i * 7) % 60),
          `${campus} ${year} Team`,
          campus,
          year,
          pick(THEMES, i),
          pick(tools, i * 3),
          'Unit planning'
        ]);
        i++;
      }
    }
  }
  return rows;
}

function buildIntentRows(tools) {
  const header = ['Timestamp', 'Team', 'Campus', 'Year', 'Theme', 'Tool', 'Phase'];
  const rows = [header];
  let i = 0;
  for (let round = 0; round < 4; round++) {
    for (const campus of CAMPUSES) {
      for (const year of YEAR_LEVELS) {
        const daysAgo = 1 + ((round * 5 + i) % 26);
        rows.push([
          stamp(daysAgo, 8 + (i % 9), (i * 11) % 60),
          `${campus} ${year} Team`,
          campus,
          year,
          pick(THEMES, i + 2),
          pick(tools, i * 5 + 1),
          'Planning to try'
        ]);
        i++;
      }
    }
  }
  return rows;
}

// One row per page view, weighted so the trend rises towards today.
function buildAnalyticsRows() {
  const header = ['Timestamp', 'Session', 'Page', 'Campus', 'Year', 'Seconds'];
  const rows = [header];
  let i = 0;
  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const viewsToday = 18 + Math.round((29 - daysAgo) * 1.4);
    for (let v = 0; v < viewsToday; v++) {
      const campus = pick(CAMPUSES, i);
      rows.push([
        stamp(daysAgo, 8 + (i % 10), (i * 13) % 60),
        `s${(i % 140) + 1}`,
        pick(PAGES, i),
        campus,
        pick(YEAR_LEVELS, i),
        45 + ((i * 17) % 90)
      ]);
      i++;
    }
  }
  return rows;
}

function buildInteractionRows(tools) {
  const header = ['Timestamp', 'Session', 'Kind', 'Page', 'Campus', 'Year', 'Detail'];
  const kinds = ['tech_picker_open', 'tech_picker_generate', 'lesson_link_click', 'copy_idea', 'tech_chip_reopen'];
  const rows = [header];
  for (let i = 0; i < 180; i++) {
    rows.push([
      stamp(1 + (i % 27), 9 + (i % 8), (i * 19) % 60),
      `s${(i % 140) + 1}`,
      pick(kinds, i),
      pick(PAGES, i),
      pick(CAMPUSES, i),
      pick(YEAR_LEVELS, i),
      pick(tools, i * 2)
    ]);
  }
  return rows;
}

function buildFeedbackRows(tools) {
  const header = ['Timestamp', 'Campus', 'Year', 'Theme', 'Tool', 'Rating', 'Comment'];
  const comments = [
    'Worked really well with my class, the kids were engaged the whole session.',
    'Great starting point, I adapted it slightly for our unit and it landed.',
    'Saved me a whole planning afternoon. More like this please.',
    'The step-by-step made it easy to run without prep.',
    'My team ran this across all three classes and it went down a treat.'
  ];
  const rows = [header];
  for (let i = 0; i < 24; i++) {
    rows.push([
      stamp(1 + (i % 25), 10 + (i % 6), (i * 23) % 60),
      pick(CAMPUSES, i),
      pick(YEAR_LEVELS, i),
      pick(THEMES, i),
      pick(tools, i * 4),
      'positive',
      pick(comments, i)
    ]);
  }
  return rows;
}

function buildDashboardRows() {
  const blank = ['', '', '', '', '', ''];
  return [
    ['DLA ANALYTICS DASHBOARD', '', '', '', '', ''],
    blank,
    ['WEEKLY SCORECARD', '', '', '', '', ''],
    ['Metric', '', 'Value', 'Target', 'Status', 'What it means'],
    ['🏫 Campus Reach', '', '3', '3 campuses', 'good ✓', 'All 3 campuses active this week.'],
    ['👥 Weekly Sessions', '', '112', '10+ teachers', 'good ✓', '112 teachers used the app this week. Strong adoption.'],
    ['⏱️ Avg Time on Page', '', '78', '20+ seconds', 'good ✓', 'Teachers spend 78 sec per page. Reading suggestions properly.'],
    ['📚 Year Level Coverage', '', '7', '5 of 7', 'good ✓', '7 of 7 year levels viewed. Great spread across the school.'],
    ['✅ Ideas Marked Used', '', '147', '20+ per week', 'good ✓', '147 ideas marked as used. Teachers are running them, not just reading.'],
    blank,
    ['VIEWS BY CAMPUS', '', '', '', '', ''],
    ['Campus', 'Views', 'Avg seconds', '', '', ''],
    ['Elsternwick', '412', '81', '', '', ''],
    ['Glen Waverley', '438', '76', '', '', ''],
    ['St Kilda', '397', '79', '', '', ''],
    blank,
    ['TOP 10 MOST VIEWED PAGES', '', '', '', '', ''],
    // The renderer does section.slice(2), so there are two rows before the data.
    // This spacer must NOT be entirely empty — findSection() treats a fully blank
    // row as the end of the section and would return nothing.
    ['Last 30 days', '', '', '', '', ''],
    ['Page', 'Views', 'Total seconds', '', '', ''],
    ...PAGES.map((p, i) => [p, String(148 - i * 9), String((148 - i * 9) * (72 + i * 2)), '', '', '']),
    blank
  ];
}

export function buildSampleAnalytics(approvedTools) {
  const tools = (approvedTools && approvedTools.length)
    ? approvedTools
    : ['Book Creator', 'Scratch', 'Adobe Express', 'Canva', 'Epic', 'Apple Clips'];

  return {
    'Dashboard!A1:F60': buildDashboardRows(),
    'Analytics!A1:F5000': buildAnalyticsRows(),
    'Feedback!A1:G100': buildFeedbackRows(tools),
    'Used!A1:G2000': buildUsedRows(tools),
    'Intent!A1:G2000': buildIntentRows(tools),
    'Interactions!A1:G5000': buildInteractionRows(tools)
  };
}
