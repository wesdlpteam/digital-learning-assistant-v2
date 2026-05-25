// ========================================
// CONFIGURATION: WESLEY DLA STUDIO v5.21b — Combined Planner Extraction + Makerspace Reboot + GitHub SHA Retry
// ========================================
const DATA_JSON_FILE_ID = '1x6h0G43CCUiY1H635Rbv2zI8T-6-wTXV';
const LIBRARIES_JSON_FILE_ID = '13QhwQsT_GFP8buqhJOVWwdIciwXILKnY';
const PLANNERS_FOLDER_ID = '1NnTnbgpGFn-jzFvuoNNx2VF74QbZw-WU';
const TECH_RULES_SHEET_ID = '1uoLwkd768PEGzyBG7U6xCqrtckZR1X-Rs5uMcYdOXSI';
// OpenAI model policy — keep both constants here so a model upgrade is a
// single search-and-replace. Mirror naming with js/00-config-state-utils.js
// (Studio side) so the convention is identical across the two halves.
//   OPENAI_MODEL       — heavy paths: planner audit, surgeon, makerspace,
//                        unit extraction, callAIProxy default
//   OPENAI_FAST_MODEL  — light paths: public suggestTech, anything where
//                        latency/cost matters more than headroom
const OPENAI_MODEL = 'gpt-4.1';
const OPENAI_FAST_MODEL = 'gpt-4.1-mini';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

function getRequiredScriptProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Missing Script Property: ' + key);
  return value;
}

function getOptionalScriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function getOpenAIKey_() {
  return getRequiredScriptProperty_('OPENAI_API_KEY');
}

function getGitHubToken_() {
  return getRequiredScriptProperty_('GITHUB_TOKEN');
}

// Canonical DLP staff allowlist. Must stay in sync with the Studio-side
// list in js/02-ui-load-navigation.js — drift between the two lets a user
// either be blocked client-side but accepted server-side, or vice versa.
// 'dlpteam@wesleycollege.edu.au' was previously '@wesleycollege.net' — wrong
// domain; the DLA cloud resources are owned by the .edu.au team account.
const DLA_ALLOWED_EMAILS = [
  'dlpteam@wesleycollege.edu.au',
  'nathan.benn@wesleycollege.edu.au',
  'david.howard@wesleycollege.edu.au',
  'andrew.delmastro@wesleycollege.edu.au',
  'delmastroa@wesleycollege.edu.au',
  'kathryn.white@wesleycollege.edu.au',
  'laura.sicklemore@wesleycollege.edu.au'
];

function requireAllowedUser_(body) {
  body = body || {};
  // Shared-secret fast path. If DLA_SHARED_SECRET is set in Script Properties
  // and the caller supplies a matching token, skip the Google userinfo
  // verification (a ~500ms-2s round-trip per backend call). Removing this
  // bypass was tried 2026-05-25 and made Studio adjustments noticeably slow,
  // so it's back. Keep DLA_SHARED_SECRET out of source control and avoid
  // XSS sinks on the Studio side (the secret lives in localStorage).
  const expectedSecret = getOptionalScriptProperty_('DLA_SHARED_SECRET');
  const suppliedSecret = body.token || body.sharedSecret || body.authToken || '';
  if (expectedSecret && suppliedSecret && suppliedSecret === expectedSecret) {
    return 'shared-secret';
  }
  const token = body.googleAccessToken || body.driveToken || body.accessToken || '';
  if (!token) {
    throw new Error('Unauthorised request: missing Google access token');
  }
  const resp = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Unauthorised request: could not verify Google account');
  }
  const profile = JSON.parse(resp.getContentText() || '{}');
  const email = String(profile.email || '').toLowerCase().trim();
  if (!email || !DLA_ALLOWED_EMAILS.includes(email)) {
    throw new Error('Access denied for ' + (email || 'unknown account'));
  }
  return email;
}

function setCooldown_(minutes, reason) {
  const resumeAt = Date.now() + (minutes * 60 * 1000);
  PropertiesService.getScriptProperties().setProperty('DLA_RESUME_TIME', String(resumeAt));
  Logger.log('Cooldown set for ' + minutes + ' minute(s)' + (reason ? ': ' + reason : ''));
}

function isRetriableHttpCode_(code) {
  return code === 429 || code === 500 || code === 502 || code === 503;
}

const campusMap = {
  "Elsternwick": "EL",
  "Glen Waverley": "GW",
  "St Kilda": "STK"
};

// Hardcoded fallback — only used if Studio has never synced its Tool Inventory to GAS.
// Once a sync happens, getApprovedToolsPrompt_() reads from Script Properties instead.
const APPROVED_TOOLS = `APPROVED TOOLS ONLY (Wesley College — Microsoft school):
- Microsoft M365: Word, Excel, Forms
- Robotics/STEM: Bee-Bots, Sphero Indi, Sphero BOLT, Lego Spike Prime, Micro:bits, CoDrone EDU, Makey Makey
- Maker/A/V Hardware: 3D Printers, Merge Cubes, Podcast Equipment, iPads, Laptops
- Core Creation: Seesaw, Canva, Book Creator, Padlet, Delightex
- Video/Audio/Animation: GarageBand, ScratchJR, Stop Motion Studio, ChatterPix Kids, iMovie, Puppet Pals, Adobe Express, Podcasting using Canva, Animating a Character with Adobe Express
- Subject Specific: Google Maps, National Geographic MapMaker, Field Guide to Victoria, Sky Map, Geoboard
- Specialist: Wise Discussion Chatbots
- Other: Clickview, Epic, PicCollage, Brushes Redux, Word Clouds ABCya, Sketchbook, Explain Everything, Freeform, Kahoot, Tinkercad, Minecraft Education
PROHIBITED: Microsoft Teams, PowerPoint, Google Earth, Digital Cameras, Green Screen Kits, Lego Spike Essential, Banqer, Google Suite (Docs/Slides/Sheets), WeVideo, OneNote, Sway, Apple Keynote, ClassVR, Flipgrid, Flip, ChatGPT, Claude, Gemini, Copilot, Google Streetview, any tool NOT on the above list.
HARDWARE RULES: Instead of Digital Cameras, suggest using the iPad Camera app. Instead of Green Screen Kits, suggest using Canva's 'Remove Background' feature.`;

const REALISTIC_TOOL_USE_RULES = `REALISTIC CLASSROOM USE RULES (HARD RULE):
- Every suggestion must describe a practical classroom task a teacher could run.
- The tool's real affordance must be central. Do not use hardware/software as a vague metaphor for abstract content.
- Name concrete student actions: code, build, record, map, collect data, test, debug, publish, present.
- Robotics and drones should only be used when the unit genuinely involves movement, mapping, forces, systems, navigation, data collection, automation, measurement, environments or spatial thinking.
- CoDrone EDU rule: only Year 4+; it must involve actual drone actions such as flight paths, take-off/landing, waypoints, altitude, obstacle courses, mapping, aerial observation or sensor/data collection. Do NOT suggest CoDrone for body systems, emotions, wellbeing, fitness challenges, storytelling-only tasks, or purely abstract concepts.
- Bad example: CoDrone EDU drones model body systems or wellbeing. A flying drone cannot meaningfully model a circulatory system.
- If the real classroom task is unclear, choose a different tool.`;

function toolKey_(t) {
  return (t || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
}

// Clear the Studio-side "human verified" flags on an entry when any server
// path mutates its suggestions. Without this, a Surgeon swap or Makerspace
// reboot on a verified unit leaves the verified badge in place while the
// content underneath has changed — reviewers would never know to re-check.
// Mirrors what Studio's markEntryNeedsHumanRecheck_ does client-side.
function clearHumanVerifiedFlags_(entry, reason) {
  if (!entry) return false;
  if (!(entry.humanVerified === true || entry.humanVerifiedAt || entry.human_verified === true)) return false;
  entry.humanVerified = false;
  entry.humanVerifiedResetAt = new Date().toISOString();
  entry.humanVerifiedResetReason = reason || 'Suggestions changed by server-side action';
  delete entry.humanVerifiedAt;
  delete entry.humanVerifiedBy;
  return true;
}

function getYearNumber_(yearLevel) {
  const s = String(yearLevel || '').toLowerCase();
  if (s.includes('3 year old') || s.includes('3yo')) return -2;
  if (s.includes('4 year old') || s.includes('4yo')) return -1;
  if (s.includes('prep') || s.includes('foundation')) return 0;
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function unitContextText_(planner) {
  return [planner && planner.th, planner && planner.ci, planner && planner.lo, planner && planner.plannerText].filter(Boolean).join(' ');
}

function checkRealisticToolUse_(toolName, desc, planner) {
  const tool = String(toolName || '').toLowerCase();
  const d = String(desc || '').toLowerCase();
  const full = (d + ' ' + unitContextText_(planner).toLowerCase());
  const yr = getYearNumber_(planner && planner.yl);
  if (!toolName || !desc) return { ok:false, reason:'Missing tool or description' };

  if (tool.includes('codrone')) {
    if (yr < 4) return { ok:false, reason:'CoDrone EDU is only Year 4+' };
    const concreteDroneAction = /(drone|fly|flight|hover|land|take[- ]?off|waypoint|route|path|altitude|obstacle|mission|coordinate|sequence|sensor|data|measure|map|aerial|photo|video)/i.test(d);
    if (!concreteDroneAction) return { ok:false, reason:'CoDrone EDU suggestion lacks a concrete flight/coding/data task' };
    const abstractMisfit = /(body systems?|circulatory|digestive|respiratory|nervous|muscular|skeletal|heart|lungs|blood|wellbeing|fitness challenge|feelings?|emotion|identity|friendship|beliefs?)/i.test(d);
    const concreteCourseOrMap = /(flight path|route|pathway|map|mapping|course|obstacle course|mission|waypoint|model landscape|school grounds|aerial|survey)/i.test(d);
    if (abstractMisfit && !concreteCourseOrMap) return { ok:false, reason:'CoDrone EDU was used for an abstract/body/wellbeing idea' };
    const unitFit = /(force|motion|movement|flight|map|mapping|navigation|coordinate|environment|survey|aerial|data|sensor|weather|microclimate|obstacle|route|mission|system|algorithm|automation|energy|sustainability|habitat|landform|place|space|distance|speed|angle|measurement|rescue|transport|journey)/i.test(full);
    if (!unitFit) return { ok:false, reason:'CoDrone EDU does not strongly fit this unit context' };
  }
  if (/(sphero|bee-bot|beebot|lego spike|micro:bit|makey makey|3d printer|tinkercad)/i.test(tool)) {
    const concreteHardwareAction = /(code|program|build|prototype|test|debug|measure|collect|sensor|circuit|route|path|navigate|drive|move|design|model|print|construct|iterate)/i.test(d);
    if (!concreteHardwareAction) return { ok:false, reason: toolName + ' needs a concrete build/code/test action' };
  }
  return { ok:true, reason:'' };
}


// ==========================================
// DYNAMIC APPROVED TOOLS — reads Studio-synced lists from Script Properties
// ==========================================
// v5.18 FIX: This is now the SINGLE source of truth for both auditPlanners() and the Surgeon.
// Reads from DLA_TOOL_APPROVED / DLA_TOOL_BANNED / DLA_TOOL_AGE_RANGES
// (the properties that syncToolInventory_() writes to).

function getApprovedToolsPrompt_() {
  var props = PropertiesService.getScriptProperties();
  var syncedApproved = props.getProperty('DLA_TOOL_APPROVED');
  var syncedBanned = props.getProperty('DLA_TOOL_BANNED');

  if (syncedApproved) {
    var approved = JSON.parse(syncedApproved);
    var banned = syncedBanned ? JSON.parse(syncedBanned) : [];

    // v5.18: Also read age ranges so the LLM knows year-level constraints
    var ageRangesRaw = props.getProperty('DLA_TOOL_AGE_RANGES');
    var ageRanges = ageRangesRaw ? JSON.parse(ageRangesRaw) : {};

    var toolList = approved.map(function(t) {
      var key = t.toLowerCase().trim();
      var range = ageRanges[key];
      if (range && (range.min > -2 || range.max < 6)) {
        var minLabel = range.min === -2 ? '3YO Kinder' : range.min === -1 ? '4YO Kinder' : range.min === 0 ? 'Prep' : 'Year ' + range.min;
        var maxLabel = range.max === -2 ? '3YO Kinder' : range.max === -1 ? '4YO Kinder' : range.max === 0 ? 'Prep' : 'Year ' + range.max;
        return '- ' + t + ' [' + minLabel + '–' + maxLabel + ' only]';
      }
      return '- ' + t + ' [All year levels]';
    }).join('\n');
    var bannedList = banned.length ? banned.join(', ') : 'any tool NOT on the approved list';

    return 'APPROVED TOOLS ONLY (Wesley College — synced from Studio Tool Inventory):\n' +
      toolList +
      '\n\nPROHIBITED: ' + bannedList + ', any tool NOT on the approved list above.' +
      '\nHARDWARE RULES: Instead of Digital Cameras, suggest using the iPad Camera app. Instead of Green Screen Kits, suggest using Canva\'s \'Remove Background\' feature.';
  }

  return APPROVED_TOOLS;
}


// ==========================================
// WEB APP HANDLER
// ==========================================
function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : '';
    const body = JSON.parse(raw || '{}');
    const verifiedEmail = requireAllowedUser_(body);
    body._verifiedEmail = verifiedEmail;
    const actionRaw = String(body.action || '').trim();
    const action = actionRaw.toLowerCase();

    if (action === 'runsurgeon') {
      const bannedTool = body.bannedTool || '';
      const replacementTool = body.replacementTool || null;
      if (!bannedTool) return jsonResponse({ error: 'bannedTool is required' });
      const result = runSurgeon(bannedTool, replacementTool);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'addtoqueue') {
      const result = addToQueue(body);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'callai') {
      const result = callAIProxy_(body);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'getplannercontext') {
      const result = getPlannerContext_(body);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'synctoolinventory') {
      const result = syncToolInventory_(body);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }
    if (action === 'enrichplanners') {
      enrichPlannerContext();
      var dataFile = DriveApp.getFileById(DATA_JSON_FILE_ID);
      var allData = JSON.parse(dataFile.getBlob().getDataAsString());
      var audited = allData.filter(function(e) { return e.audited; });
      var enriched = allData.filter(function(e) { return e.plannerContextRich && e.plannerContextRich.length > 50; });
      var remaining = audited.length - enriched.length;
      return jsonResponse({ enriched: enriched.length, total: audited.length, remaining: remaining, user: verifiedEmail });
    }

    if (action === 'refreshplannercontext') {
      const result = refreshPlannerContext_(body);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'rebootmakerspace') {
      const filterCa = body.filterCa || null;
      const filterYl = body.filterYl || null;
      const result = rebootMakerspace(filterCa, filterYl);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'resetmakerspaceflags') {
      const filterCa = body.filterCa || null;
      const filterYl = body.filterYl || null;
      const result = resetMakerspaceFlags(filterCa, filterYl);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'extractunitdetails') {
      const filterCa = body.filterCa || null;
      const filterYl = body.filterYl || null;
      const result = extractUnitsFromCombinedPlanners(filterCa, filterYl);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    // 2026-05-25: Doorway for the one-time corpus-wide diversity repair
    // (see regenerateForDiversity above). Auth is already gated by
    // requireAllowedUser_ at the top of doPost, so this is no looser than
    // any other authenticated action.
    if (action === 'regeneratefordiversitydryrun') {
      const opts = { ca: body.ca || null, yl: body.yl || null };
      const result = regenerateForDiversityDryRun(opts);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'regeneratefordiversity') {
      const opts = {
        batch: body.batch || null,
        ca: body.ca || null,
        yl: body.yl || null
      };
      const result = regenerateForDiversity(opts);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    // 2026-05-25: bulk "inspiring" regen across every unit, 6-sentence style.
    if (action === 'regenerateallinspiring') {
      const opts = {
        batch: body.batch || null,
        ca: body.ca || null,
        yl: body.yl || null,
        redoAll: !!body.redoAll
      };
      const result = regenerateAllInspiring(opts);
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'regenerateallinspiringstatus') {
      const result = regenerateAllInspiringStatus({ ca: body.ca || null, yl: body.yl || null });
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    if (action === 'regenerateallinspiringreset') {
      const result = regenerateAllInspiringReset({ ca: body.ca || null, yl: body.yl || null });
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    // 2026-05-25: clears inspiringRegenAt for units whose current saved
    // suggestions contain off-whitelist or banned tools, so Inspire All
    // (now with whitelist validator) can redo only those.
    if (action === 'regenerateallinspiringrequeuebadtools') {
      const result = regenerateAllInspiringRequeueBadTools({ ca: body.ca || null, yl: body.yl || null });
      result.user = verifiedEmail;
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Unknown action: ' + actionRaw });
  } catch(err) {
    return jsonResponse({ error: err && err.message ? err.message : String(err) });
  }
}

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || '').toLowerCase();
    var cb = String(params.cb || params.callback || '').trim();

    if (action === 'suggesttech') {
      var result = suggestTechForPlanner_({
        ca: params.ca || '',
        yl: params.yl || '',
        th: params.th || '',
        tool: params.tool || '',
        regen: String(params.regen || '0') === '1',
        customCi: params.customCi || '',
        customLo: params.customLo || ''
      });
      return cb ? jsonpResponse(cb, result) : jsonResponse(result);
    }

    var status = { status: 'DLA Studio GAS v5.21 combined planner extraction online' };
    return cb ? jsonpResponse(cb, status) : jsonResponse(status);
  } catch(err) {
    var payload = { error: err && err.message ? err.message : String(err) };
    var cbName = (e && e.parameter && (e.parameter.cb || e.parameter.callback)) || '';
    return cbName ? jsonpResponse(cbName, payload) : jsonResponse(payload);
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpResponse(callback, obj) {
  var safe = String(callback).replace(/[^A-Za-z0-9_$.]/g, '');
  if (!safe) safe = 'callback';
  return ContentService
    .createTextOutput(safe + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}


// ==========================================
// PUBLIC: TEACHER-PICKED TOOL SUGGESTION
// ==========================================
// Lets a logged-out teacher on index.html pick an approved tool for a planner
// and get an AI-tailored "how to use this in this unit" suggestion. Cached per
// (ca|yl|th|tool) in ScriptProperties so repeats are free. Daily call cap
// protects the OpenAI bill if the endpoint is ever scraped.
var TECH_SUGGEST_DAILY_CAP = 500;
// Model lives at the top of the file as OPENAI_FAST_MODEL; reference it here
// so any rename only touches one place.
// v2 = 6-sentence inspiring descriptions + optional teacher-supplied CI/LOI
// override. Bumping the prefix abandons the old 3-sentence cached results so
// teachers don't see stale short descriptions.
var TECH_SUGGEST_CACHE_PREFIX = 'tech_sugg_v2_';

function suggestTechForPlanner_(args) {
  var ca = String(args.ca || '').trim();
  var yl = String(args.yl || '').trim();
  var th = String(args.th || '').trim();
  var tool = String(args.tool || '').trim();
  var regen = !!args.regen;
  var customCi = String(args.customCi || '').trim();
  var customLo = String(args.customLo || '').trim();
  var hasCustom = !!(customCi || customLo);

  if (!ca || !yl || !th || !tool) {
    return { error: 'suggestTech requires ca, yl, th, and tool' };
  }

  // index.html surfaces the campus as "St Kilda Rd", but data.json + campusMap
  // use the short form "St Kilda". Canonicalise here so the rest of the path
  // (campusMap lookup + e.ca match in loadPlannerContextForUnit_) just works.
  if (/^st\s*kilda(\s*(rd|road))?$/i.test(ca)) ca = 'St Kilda';

  var approved = getApprovedToolNames_();
  if (approved.length && !approved.some(function(t) { return t.toLowerCase() === tool.toLowerCase(); })) {
    return { error: 'Tool not on approved list: ' + tool };
  }

  // Cache key includes custom CI/LO when present so teachers' bespoke prompts
  // don't collide with (or overwrite) the canonical planner-driven cache.
  var keyParts = [ca, yl, th, tool];
  if (hasCustom) keyParts.push('c:' + customCi, 'l:' + customLo);
  var cacheKey = TECH_SUGGEST_CACHE_PREFIX + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, keyParts.join('|'))
  ).replace(/=+$/, '');

  var props = PropertiesService.getScriptProperties();
  if (!regen) {
    var cached = props.getProperty(cacheKey);
    if (cached) {
      try {
        var parsed = JSON.parse(cached);
        parsed.cached = true;
        return parsed;
      } catch (e) {}
    }
  }

  if (!underDailyCap_()) {
    return { error: 'Service is at capacity for today. Please try again tomorrow.' };
  }

  var plannerContext;
  if (hasCustom) {
    // Teacher supplied their own CI / LOI (new unit, or wants a different angle).
    // Build context from their input rather than the stored planner.
    var ciBlock = customCi ? 'CENTRAL IDEA: ' + customCi + '\n' : '';
    var loBlock = customLo ? 'LINES OF INQUIRY: ' + customLo + '\n' : '';
    plannerContext = ('UNIT: ' + th + '\n' + ciBlock + loBlock + '\n(Teacher-supplied unit details — treat as the authoritative description of this unit.)').trim();
  } else {
    plannerContext = loadPlannerContextForUnit_(ca, yl, th);
    if (!plannerContext) {
      return { error: 'No planner context found for ' + ca + ' / ' + yl + ' / ' + th };
    }
  }

  var systemPrompt = 'You are a visionary digital learning coach at Wesley College (IB PYP, Melbourne). You help primary-school teachers see possibilities with a specific approved technology that they would not have thought of on their own. Your descriptions inspire. They blend pedagogical rigour with creative ambition. They name authentic audiences, cross-disciplinary connections, real-world impact, and student agency. Output STRICT JSON only — no markdown, no commentary.';
  var userPrompt =
    'TOOL THE TEACHER WANTS TO USE: ' + tool + '\n' +
    'CAMPUS: ' + ca + '\n' +
    'YEAR LEVEL: ' + yl + '\n' +
    'UNIT OF INQUIRY: ' + th + '\n\n' +
    'PLANNER CONTEXT:\n' + plannerContext + '\n\n' +
    REALISTIC_TOOL_USE_RULES + '\n\n' +
    'YOUR MISSION: Write a description that makes the teacher stop and say "I never thought of using it like that." Push the learning into territory most ' + yl + ' classrooms have not explored. Reject the obvious. Reject the generic. Every sentence must be tailored to THIS unit.\n\n' +
    'The "description" field MUST be exactly 6 vivid, classroom-ready sentences that together do all of the following:\n' +
    '  1. Open with the bold creative premise — what students are actually making, investigating, or experiencing (name the unit\'s topic explicitly).\n' +
    '  2. Connect the activity directly to one of the unit\'s lines of inquiry or the central idea (name it).\n' +
    '  3. Reveal a less-obvious twist — a cross-disciplinary link, a counter-intuitive role-reversal, an authentic external audience, a real community/expert connection, an ethical or perspective-taking dimension, or a use of the tool that most teachers don\'t know about.\n' +
    '  4. Describe what the FINAL student artefact looks like, sounds like, or does — concrete and shareable.\n' +
    '  5. Name a specific advanced or under-used feature of the tool that powers the activity (not the basic feature everyone already uses).\n' +
    '  6. End with the inspiring "so what" — the disposition, agency, or real-world contribution the student takes away beyond the unit.\n\n' +
    'Return STRICT JSON with this exact shape:\n' +
    '{\n' +
    '  "description": "Exactly 6 sentences as specified above. No bullet points, no numbering — flowing prose.",\n' +
    '  "valueAdd": "2-3 sentences on the deeper learning value this adds (creative agency, transferable skills, authentic audience, future-of-work capability) that a non-digital or generic-digital task could not deliver.",\n' +
    '  "steps": ["4-6 short imperative steps a teacher would follow to run this lesson, including one unexpected element"],\n' +
    '  "fit": "good" | "stretch" | "poor",\n' +
    '  "fitNote": "If fit is stretch or poor, 1 sentence on why and what would work better. If good, leave empty."\n' +
    '}\n' +
    'Be honest in "fit": if this tool is a weak match for this unit, say so.';

  var aiResult;
  try {
    aiResult = callAIProxy_({
      model: OPENAI_FAST_MODEL,
      temperature: 0.75,
      maxTokens: 1400,
      systemPrompt: systemPrompt,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
    });
  } catch (err) {
    return { error: 'AI request failed: ' + (err && err.message ? err.message : String(err)) };
  }

  incrementDailyCounter_();

  var rawText = String(aiResult.text || '').trim();
  var jsonStart = rawText.indexOf('{');
  var jsonEnd = rawText.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    return { error: 'AI did not return JSON', raw: rawText };
  }
  var parsedAi;
  try {
    parsedAi = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
  } catch (err) {
    return { error: 'AI returned malformed JSON', raw: rawText };
  }

  var payload = {
    tool: tool,
    ca: ca,
    yl: yl,
    th: th,
    description: String(parsedAi.description || '').trim(),
    valueAdd: String(parsedAi.valueAdd || '').trim(),
    steps: Array.isArray(parsedAi.steps) ? parsedAi.steps.map(function(s) { return String(s).trim(); }).filter(Boolean) : [],
    fit: ['good', 'stretch', 'poor'].indexOf(String(parsedAi.fit || '').toLowerCase()) !== -1 ? String(parsedAi.fit).toLowerCase() : 'good',
    fitNote: String(parsedAi.fitNote || '').trim(),
    generatedAt: new Date().toISOString()
  };

  try {
    props.setProperty(cacheKey, JSON.stringify(payload));
  } catch (err) {
    Logger.log('Could not cache tech suggestion (ScriptProperties full?): ' + err);
  }

  payload.cached = false;
  return payload;
}

function getApprovedToolNames_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('DLA_TOOL_APPROVED');
  if (!raw) return [];
  try {
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

function loadPlannerContextForUnit_(ca, yl, th) {
  var caCode = campusMap[ca];
  if (!caCode) return '';

  try {
    var file = DriveApp.getFileById(DATA_JSON_FILE_ID);
    var data = JSON.parse(file.getBlob().getDataAsString());
    for (var i = 0; i < data.length; i++) {
      var e = data[i];
      if (e.ca === ca && e.yl === yl && e.th === th) {
        if (e.plannerContextRich && e.plannerContextRich.length > 50 && !/^ERROR/.test(e.plannerContextRich)) {
          return e.plannerContextRich;
        }
        var lo = e.lo ? '\nLINES OF INQUIRY: ' + e.lo : '';
        var ci = e.ci ? '\nCENTRAL IDEA: ' + e.ci : '';
        return ('UNIT: ' + e.th + ci + lo).trim();
      }
    }
  } catch (err) {
    Logger.log('loadPlannerContextForUnit_ failed: ' + err);
  }

  var folder;
  try { folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID); } catch (err) { return ''; }
  var md = readPlannerMarkdown_(folder, yl, th, caCode);
  return md ? md.text : '';
}

function underDailyCap_() {
  var key = 'tech_sugg_day_' + Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty(key) || '0', 10);
  return n < TECH_SUGGEST_DAILY_CAP;
}

function incrementDailyCounter_() {
  var key = 'tech_sugg_day_' + Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty(key) || '0', 10);
  props.setProperty(key, String(n + 1));
}


// ==========================================
// AI PROXY FOR DLA STUDIO
// ==========================================
function callAIProxy_(body) {
  const contents = body.contents || [];
  const systemPrompt = body.systemPrompt || '';
  const model = body.model || OPENAI_MODEL;
  const maxTokens = Math.min(Number(body.maxTokens || 4096), 8192);
  const temperature = body.temperature == null ? 0.2 : Number(body.temperature);

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: String(systemPrompt) });

  for (let i = 0; i < contents.length; i++) {
    const turn = contents[i] || {};
    const role = turn.role === 'model' ? 'assistant' : (turn.role || 'user');
    let text = '';
    if (Array.isArray(turn.parts)) {
      text = turn.parts.map(p => (p && p.text) ? String(p.text) : '').join('\n');
    } else if (turn.content) {
      text = String(turn.content);
    }
    messages.push({ role: role, content: text });
  }

  if (!messages.length) throw new Error('callAI requires at least one message');

  const payload = {
    model: model,
    messages: messages,
    temperature: Number.isFinite(temperature) ? temperature : 0.2,
    max_tokens: Number.isFinite(maxTokens) ? maxTokens : 4096
  };

  let lastError = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = UrlFetchApp.fetch(OPENAI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + getOpenAIKey_() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const raw = response.getContentText() || '';

    if (code === 200) {
      const parsed = JSON.parse(raw);
      const text = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
      if (!text) throw new Error('OpenAI returned an empty response');
      return { text: text };
    }

    let errMsg = 'OpenAI HTTP ' + code;
    try {
      const errJson = JSON.parse(raw);
      errMsg = (errJson.error && errJson.error.message) ? errJson.error.message : errMsg;
    } catch (e) {}

    lastError = errMsg;
    if (/tokens per min|TPM|too large|maximum context|context length/i.test(errMsg)) {
      throw new Error(errMsg);
    }
    if (isRetriableHttpCode_(code) && attempt < 4) {
      Utilities.sleep([15000, 30000, 60000][attempt - 1]);
      continue;
    }
    throw new Error(errMsg);
  }
  throw new Error(lastError || 'OpenAI request failed');
}

function testOpenAIKey() {
  const result = callAIProxy_({
    action: 'callAI',
    model: 'gpt-4.1-mini',
    maxTokens: 40,
    contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: DLA API key working' }] }]
  });
  Logger.log(result.text);
}

function testAllowedEmails() {
  Logger.log('Allowed DLA Studio users: ' + DLA_ALLOWED_EMAILS.join(', '));
}


// ==========================================
// PLANNER FILE HELPERS — Shared by Auditor, Enrichment, and Context
// ==========================================
// v5.19: All planners are now Markdown files in Drive.
// These helpers centralise the file-lookup and text-read patterns.

function findPlannerFile_(folder, yl, th, caCode) {
  var possibleNames = [
    '2026 - ' + yl + ' - ' + th + ' (' + caCode + ') .md',
    '2026 - ' + yl + ' - ' + th + ' (' + caCode + ').md',
    '2026 - ' + yl + ' UOI Planner (' + caCode + ').md',
    '2026 - ' + yl + ' UOI Planners (' + caCode + ').md',
    '2025 - ' + yl + ' UOI Planner (' + caCode + ').md',
    '2025 - ' + yl + ' UOI Planners (' + caCode + ').md'
  ];
  for (var n = 0; n < possibleNames.length; n++) {
    var it = folder.getFilesByName(possibleNames[n]);
    if (it.hasNext()) return it.next();
  }

  // Kinder fallback: filenames in Drive use the short forms "3YO" / "4YO"
  // rather than "3 Year Old Kinder" / "4 Year Old Kinder". Fuzzy-match on
  // tokens + campus code so renames between years (2025 / 2026 / etc.)
  // don't break the lookup.
  var kinderTokens = null;
  if (yl === '3 Year Old Kinder') {
    kinderTokens = ['3yo', '3yearoldkinder', 'threeyearoldkinder'];
  } else if (yl === '4 Year Old Kinder') {
    kinderTokens = ['4yo', '4yearoldkinder', 'fouryearoldkinder'];
  }
  if (kinderTokens) {
    var caTag = '(' + caCode.toLowerCase() + ')';
    var iter = folder.getFiles();
    var matches = [];
    while (iter.hasNext()) {
      var f = iter.next();
      var nameLower = f.getName().toLowerCase();
      var stripped = nameLower.replace(/\s+/g, '');
      if (nameLower.indexOf(caTag) === -1) continue;
      var hit = kinderTokens.some(function(t) { return stripped.indexOf(t) !== -1; });
      if (hit) matches.push(f);
    }
    if (matches.length) {
      matches.sort(function(a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
      return matches[0];
    }
  }

  return null;
}

function readPlannerMarkdown_(folder, yl, th, caCode) {
  var mdFile = findPlannerFile_(folder, yl, th, caCode);
  if (!mdFile) return null;
  var text = mdFile.getBlob().getDataAsString();
  if (!text || !text.trim()) return null;
  return { text: text.trim(), fileName: mdFile.getName() };
}


// ==========================================
// 1. MAIN AUDITOR
// ==========================================
// v5.18 FIX: Now uses getApprovedToolsPrompt_() (same source as Surgeon)
//            instead of the orphaned TOOL_INVENTORY property.
//            Added duplicate-tool detection and NO DUPLICATES prompt rule.
// v5.18b FIX: Added optional filterCa/filterYl so targeted functions
//             (testGWYear4HTWW, goNuclearGWYear4) don't accidentally
//             audit unrelated entries that happen to sit earlier in the array.
function auditPlanners(filterCa, filterYl) {
  // 2026-05-18: Prevent concurrent audit runs (auditAndSync trigger +
  // appSmashRecoveryTick can fire in the same minute and otherwise both
  // pick the same unaudited unit, doubling OpenAI spend and racing on
  // the data.json write). tryLock(0) returns immediately if another
  // execution holds the lock so the second caller bails cleanly.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('auditPlanners: another audit run holds the lock — skipping this tick.');
    return;
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const resumeTime = props.getProperty('DLA_RESUME_TIME');
    if (resumeTime && Date.now() < parseInt(resumeTime)) {
      let resumeDate = new Date(parseInt(resumeTime)).toLocaleString('en-AU');
      Logger.log(`Quota Cooldown Active. Sleeping until ${resumeDate}`);
      return;
    }

    const folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());
  // Batch-write flag: set true whenever any entry in `data` is mutated; the
  // single file.setContent at the end of the loop persists every change in
  // one write instead of re-uploading the full 11 MB blob per entry.
  let dataDirty = false;

  let libraryText = "";
  try {
    const libFile = DriveApp.getFileById(LIBRARIES_JSON_FILE_ID);
    const libraries = JSON.parse(libFile.getBlob().getDataAsString());
    if (libraries.minecraft && libraries.minecraft.length > 0) {
      libraryText += "\nAPPROVED MINECRAFT LESSONS LIBRARY:\nIf you choose to suggest Minecraft Education, you MUST select exactly one from this list. Format the tool name as 'Minecraft: [Title]'. You MUST output the exact URL provided in your JSON.\nUse the Teaching notes (when shown) to ground the description in concrete lesson stages and connect them to the unit.\n" +
      libraries.minecraft.map(m => `- [Ages ${m.ages}] ${m.title}: ${m.desc || ''} (URL: ${m.url || 'No URL'})${m.teaching_notes ? '\n    Teaching notes: ' + m.teaching_notes : ''}`).join("\n");
    }
    if (libraries.microbit && libraries.microbit.length > 0) {
      libraryText += "\n\nAPPROVED MICRO:BIT LESSONS LIBRARY:\nIf you choose to suggest Micro:bits, you MUST select exactly one from this list. Format the tool name as 'Micro:bit: [Title]'. You MUST output the exact URL provided in your JSON.\nUse the Teaching notes (when shown) to ground the description in concrete lesson stages and connect them to the unit.\n" +
      libraries.microbit.map(m => `- [Ages ${m.ages}] ${m.title} (URL: ${m.url || 'No URL'})${m.desc ? ' — ' + m.desc : ''}${m.teaching_notes ? '\n    Teaching notes: ' + m.teaching_notes : ''}`).join("\n");
    }
  } catch(e) {
    Logger.log("Could not load libraries.json. Make sure LIBRARIES_JSON_FILE_ID is correct.");
  }

  // v5.18 FIX: Single source of truth — use the same function the Surgeon uses
  let approvedToolsPrompt = getApprovedToolsPrompt_();

  let processedCount = 0;
  const BATCH_LIMIT = 5;

  for (let i = 0; i < data.length; i++) {
    if (data[i].audited === true) continue;
    // 2026-05-18: Skip units we already know are missing planner content,
    // so they don't burn a Drive read every tick forever. Clear `auditSkipped`
    // (and re-run audit) once the unit's theme appears in the planner markdown.
    if (data[i].auditSkipped === true) continue;
    if (processedCount >= BATCH_LIMIT) break;

    let planner = data[i];

    // v5.18b FIX: Skip entries that don't match the optional filter
    if (filterCa && planner.ca !== filterCa) continue;
    if (filterYl && planner.yl !== filterYl) continue;

    let caCode = campusMap[planner.ca];
    if (!caCode) continue;

    let possibleNames = [
      `2026 - ${planner.yl} - ${planner.th} (${caCode}) .md`,
      `2026 - ${planner.yl} UOI Planner (${caCode}).md`,
      `2026 - ${planner.yl} UOI Planners (${caCode}).md`,
      `2025 - ${planner.yl} UOI Planner (${caCode}).md`,
      `2025 - ${planner.yl} UOI Planners (${caCode}).md`
    ];

    // v5.19: Read markdown planner as plain text — no base64, no vision tokens
    let mdResult = readPlannerMarkdown_(folder, planner.yl, planner.th, caCode);

    if (!mdResult) {
      Logger.log(`No planner markdown found for ${planner.ca} ${planner.yl} — ${planner.th}`);
      continue;
    }

    // v5.19: Verify the unit theme actually exists in the planner content.
    // Combined planner files contain multiple units — if this unit hasn't been
    // documented yet, GPT will hallucinate content instead of returning UNIT NOT FOUND.
    // Check for the theme name OR the common PYP acronym in the markdown.
    const themeLower = planner.th.toLowerCase();
    const mdLower = mdResult.text.toLowerCase();
    const pypAcronyms = {
      'who we are': 'wwa',
      'where we are in place and time': 'wwaipat',
      'how we express ourselves': 'hweo',
      'how the world works': 'htww',
      'how we organise ourselves': 'hwoo',
      'how we organize ourselves': 'hwoo',
      'sharing the planet': 'stp'
    };
    const acronym = pypAcronyms[themeLower] || '';
    const themeFound = mdLower.includes(themeLower)
      || (acronym && new RegExp('\\b' + acronym + '\\b', 'i').test(mdResult.text));
    if (!themeFound) {
      Logger.log(`Skipping ${planner.ca} ${planner.yl} — "${planner.th}" not found in planner markdown (${mdResult.fileName}). Unit likely not yet documented.`);
      data[i].auditSkipped = true;
      data[i].auditSkipReason = `Theme not found in ${mdResult.fileName}`;
      data[i].auditSkippedAt = new Date().toISOString();
      dataDirty = true;
      continue;
    }

    // v5.21: Prefer unit-scoped plannerContextRich if it has been extracted from a
    // combined planner. Without this, GPT reads the entire combined file (multiple units)
    // and either confuses content or generates suggestions disconnected from the actual unit.
    let plannerMarkdown;
    if (planner.plannerContextRich
        && planner.plannerContextRich.length > 200
        && !planner.plannerContextRich.startsWith('ERROR')
        && planner.plannerContextRich.toLowerCase().includes(themeLower)
        && planner.plannerContextRich.length < mdResult.text.length * 0.9) {
      // Unit-scoped context exists (markedly shorter than the full file → it's been extracted)
      plannerMarkdown = planner.plannerContextRich;
      Logger.log(`Auditing: ${planner.ca} ${planner.yl} — ${planner.th} (${plannerMarkdown.length} chars from extracted unit section)`);
    } else {
      plannerMarkdown = mdResult.text;
      Logger.log(`Auditing: ${planner.ca} ${planner.yl} — ${planner.th} (${plannerMarkdown.length} chars from full planner)`);
    }

    let upperPrimary = ["Year 4", "Year 5", "Year 6"];
    let midPrimary = ["Year 3"];
    let kinder = ["3 Year Old Kinder", "4 Year Old Kinder"];
    let yearRule = "";

    // v5.18b FIX: Year rules now list the ACTUAL eligible tool pool for each band,
    // aligned to the age ranges in the Studio Tool Inventory.
    // Previously the early years prompt listed Canva which is Year 3+.
    if (kinder.includes(planner.yl)) {
      yearRule = "Kindergarten (" + planner.yl + "): These are 3-4 year old children. Suggestions must be VERY simple, play-based, and hands-on. Use only: Bee-Bots, Sphero Indi, ScratchJR, ChatterPix Kids, Puppet Pals, PicCollage, Seesaw, Book Creator, Brushes Redux, Freeform, Epic, Animating a Character with Adobe Express (teacher-guided — teacher operates the tool while children record their voices and a character lip-syncs). All activities must be teacher-guided with minimal text. Focus on tapping, dragging, recording voice, taking photos, and physical play. Do NOT suggest any tool requiring reading, typing, or complex multi-step workflows. Maximise diversity — use 6 different tools.";
    } else if (upperPrimary.includes(planner.yl)) {
      yearRule = "Upper primary (Year 4-6): Wide tool pool. Canva, Book Creator, Padlet, Delightex, Adobe Express, Animating a Character with Adobe Express, M365 (Word/Excel/Forms), Minecraft Education, Lego Spike Prime, CoDrone EDU, Micro:bit, and all general tools are appropriate. Maximise diversity — use 6 different tools.";
    } else if (midPrimary.includes(planner.yl)) {
      yearRule = "Mid primary (Year 3): Canva, Book Creator, Delightex, Adobe Express, Animating a Character with Adobe Express, Padlet, Sphero BOLT, Micro:bit, Stop Motion Studio, Scratch, Kahoot, Explain Everything, and all general tools (Seesaw, PicCollage, GarageBand, iMovie, etc.) are appropriate. Maximise diversity — use 6 different tools.";
    } else if (planner.yl === "Year 2") {
      yearRule = "Early years (Year 2): Use a DIVERSE mix from the Prep-Year 2 pool: Seesaw, Book Creator, Delightex, Bee-Bots, Sphero Indi, ScratchJR, ChatterPix Kids, Puppet Pals, PicCollage, GarageBand, iMovie, Merge Cubes, Makey Makey, Brushes Redux, Freeform, Sketchbook, Epic, Word Clouds ABCya, Animating a Character with Adobe Express (teacher-guided). Do NOT suggest Canva, Padlet, the general Adobe Express editor, Minecraft, or any Year 3+ tool. Maximise diversity — use 6 different tools.";
    } else {
      yearRule = "Early years (Prep-Year 1): Use a DIVERSE mix from the Prep-Year 1 pool: Seesaw, Book Creator, Delightex, Bee-Bots, Sphero Indi, ScratchJR, ChatterPix Kids, Puppet Pals, PicCollage, GarageBand, iMovie, Merge Cubes, Makey Makey, Brushes Redux, Freeform, Sketchbook, Epic, Word Clouds ABCya, Animating a Character with Adobe Express (teacher-guided). Do NOT suggest Canva, Padlet, the general Adobe Express editor, Minecraft, Sphero BOLT, or any Year 3+ tool. Maximise diversity — use 6 different tools.";
    }

    let prompt = `You are a dual-role expert: a Digital Learning Coach AND a STEM/Makerspace Coordinator. 
Analyze the unit planner below for: "${planner.th}".

TASK: Generate exactly 6 highly innovative suggestions for ${planner.yl}.
- Suggestions 1-5: Digital technology integrations. AT LEAST TWO MUST be an "App Smash".
- Suggestion 6: A Makerspace/STEM project (Physical-First focus).

RULES FOR AGE-APPROPRIATE COMPLEXITY:
- CALIBRATE FOR ${planner.yl}: Adjust the complexity to the age group (Kinder: simple play-based, teacher-guided; Prep-2: play; 3-4: multi-step; 5-6: logic/impact).

RULES FOR SUGGESTIONS 1-5 (Digital):
- TITLE SYNC RULE: The "t" field MUST list all tools mentioned in the description. If you use Book Creator and Seesaw, the title MUST be "Book Creator + Seesaw". Do not omit the second tool.
- WHITELIST: Only use tools from the APPROVED TOOLS list below. Do NOT use Google Streetview, Google Street View, Google Slides, Flip, or any other tool not explicitly listed.
- APP SMASH RULE (HARD RULE): AT LEAST 2 of suggestions 1-5 MUST be an App Smash.
  - An App Smash combines two different tools where Tool 2 adds a capability Tool 1 lacks.
  - The "t" field MUST use the exact format: "Tool 1 + Tool 2" (with a literal + sign between the two tool names).
  - Examples: "Book Creator + Canva", "Seesaw + ChatterPix Kids", "Padlet + iMovie"
  - WRONG formats: "Book Creator with Canva", "Book Creator and Canva", "Book Creator / Canva", "Book Creator (with Canva)"
  - The description must explain how BOTH tools are used together and what the second tool adds.

NO DUPLICATE TOOLS (HARD RULE):
- Each of the 6 suggestions MUST use a DIFFERENT primary tool.
- Do NOT repeat the same tool (e.g. Canva, Book Creator) across multiple suggestions.
- App Smash combinations count as using both tools — neither tool may appear again in another suggestion.

RULES FOR SUGGESTION 6 (Makerspace):
- PHYSICAL CORE: Must involve construction (cardboard, circuitry, etc.).
- TECH ENHANCEMENT: Digital tools may be included if they serve the physical build.
- BEEFY DESCRIPTION: Write 3-4 sentences explaining the build, materials, and learning.

CRITICAL URL RULE:
- If a suggestion uses a specific lesson from the VERIFIED LESSON LIBRARY, you MUST include the exact URL provided.
- IF A SUGGESTION IS NOT FROM THE LIBRARY, THE "url" FIELD MUST BE AN EMPTY STRING: "". Do NOT invent, placeholder, or link to generic websites.

GENERAL RULES:
- All descriptions: 3-4 sentences.
- Return ONLY a valid JSON object. Use straight apostrophes (').

${approvedToolsPrompt}
${REALISTIC_TOOL_USE_RULES}

YEAR LEVEL GUIDANCE FOR ${planner.yl}:
${yearRule}

${libraryText}

Unit details: Campus: ${planner.ca} | Year Level: ${planner.yl} | Theme: ${planner.th}

--- UNIT PLANNER CONTENT ---
${plannerMarkdown}
--- END PLANNER ---

{
  "s": [
    {
      "t": "Tool Name (If App Smash, you MUST write Tool 1 + Tool 2)", 
      "d": "A detailed 3-4 sentence description calibrated for ${planner.yl}.", 
      "url": ""
    }
  ],
  "plannerText": "A summary of the unit content from the planner above."
}`;

    // v5.19: Plain text payload — no file attachment, no vision processing
    let payload = {
      "model": OPENAI_MODEL,
      "messages": [{
        "role": "user",
        "content": prompt
      }],
      "response_format": { "type": "json_object" },
      "temperature": 0.2,
      "max_tokens": 8192
    };

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let rawText = "";
      try {
        let response = UrlFetchApp.fetch(OPENAI_ENDPOINT, {
          "method": "post",
          "contentType": "application/json",
          "headers": { "Authorization": "Bearer " + getOpenAIKey_() },
          "payload": JSON.stringify(payload),
          "muteHttpExceptions": true
        });

        let code = response.getResponseCode();

        if (isRetriableHttpCode_(code)) {
          if (code === 429) setCooldown_(2, 'OpenAI rate limit during planner audit');
          Utilities.sleep(30000);
          continue;
        }

        if (code === 200) {
          let jsonResponse = JSON.parse(response.getContentText());
          rawText = jsonResponse?.choices?.[0]?.message?.content;
          let cleanText = rawText.replace(/```json|```/g, '').replace(/\n/g, " ").trim();
          cleanText = cleanText.replace(/[\u2018\u2019\u0060\u00B4]/g, "'").replace(/[\u201C\u201D]/g, '"');
          let result = JSON.parse(cleanText);

          if (result.plannerText === "UNIT NOT FOUND") {
            data[i].s = [];
            data[i].plannerText = "Not yet documented in PDF.";
            data[i].audited = true;
            dataDirty = true;
            processedCount++;
            success = true;
            break;
          }

          let validSugs = (Array.isArray(result.s) ? result.s : []).filter(s => s && s.t && s.d).map(s => {
            const sug = { t: s.t, d: s.d };
            if (s.url && s.url !== "No URL") sug.url = s.url;
            return sug;
          });

          if (validSugs.length !== 6) {
            Logger.log(`${planner.th}: expected 6 suggestions but received ${validSugs.length}. Retrying.`);
            if (attempt < 3) { Utilities.sleep(5000); continue; }
            Logger.log(`${planner.th}: skipped after 3 attempts.`);
            break;
          }

          // v5.18 FIX: Check for duplicate tools within the 6 suggestions
          const toolKeys = validSugs.map(sg => toolKey_(sg.t));
          const seenTools = new Set();
          let hasDuplicateTool = false;
          for (const tk of toolKeys) {
            // For app smashes like "Canva + Book Creator", check each component
            const parts = tk.split(/\s*\+\s*/);
            for (const part of parts) {
              const p = part.trim();
              if (!p) continue;
              if (seenTools.has(p)) {
                hasDuplicateTool = true;
                Logger.log(`${planner.th}: duplicate tool "${p}" found across suggestions. Retrying.`);
                break;
              }
              seenTools.add(p);
            }
            if (hasDuplicateTool) break;
          }
          if (hasDuplicateTool) {
            if (attempt < 3) { Utilities.sleep(5000); continue; }
            Logger.log(`${planner.th}: skipped — persistent duplicate tools after 3 attempts.`);
            break;
          }

          // v5.19: Validate App Smash count — at least 2 of suggestions 1-5 must have "+" in the title
          const digitalSugs = validSugs.slice(0, 5);
          const appSmashCount = digitalSugs.filter(sg => /\+/.test(sg.t)).length;
          if (appSmashCount < 2) {
            Logger.log(`${planner.th}: only ${appSmashCount} App Smash(es) found in suggestions 1-5 (need 2+). Titles: ${digitalSugs.map(sg => sg.t).join(' | ')}. Retrying.`);
            if (attempt < 3) { Utilities.sleep(5000); continue; }
            Logger.log(`${planner.th}: skipped — insufficient App Smashes after 3 attempts.`);
            break;
          }

          // v5.19: Validate title sync — if description mentions 2+ tools, title must have "+"
          let titleSyncFail = false;
          digitalSugs.forEach((sg, idx) => {
            const titleHasPlus = /\+/.test(sg.t);
            const desc = (sg.d || '').toLowerCase();
            const titleTools = sg.t.split(/\s*\+\s*/).map(t => t.trim().toLowerCase()).filter(Boolean);
            // Check: if title has "+", both tools should appear in description
            if (titleHasPlus && titleTools.length >= 2) {
              const secondToolInDesc = desc.includes(titleTools[1]) || desc.includes(titleTools[1].replace(/\s+/g, ''));
              if (!secondToolInDesc) {
                Logger.log(`${planner.th}: suggestion ${idx + 1} title has "${sg.t}" but description doesn't mention "${titleTools[1]}". Retrying.`);
                titleSyncFail = true;
              }
            }
          });
          if (titleSyncFail) {
            if (attempt < 3) { Utilities.sleep(5000); continue; }
            Logger.log(`${planner.th}: skipped — title sync failures after 3 attempts.`);
            break;
          }

          const unrealistic = validSugs.map((sg, idx) => ({ idx: idx, result: checkRealisticToolUse_(sg.t, sg.d, planner) })).find(x => !x.result.ok);
          if (unrealistic) {
            Logger.log(`${planner.th}: unrealistic suggestion #${unrealistic.idx + 1}: ${unrealistic.result.reason}. Retrying.`);
            if (attempt < 3) { Utilities.sleep(5000); continue; }
            Logger.log(`${planner.th}: skipped — unrealistic suggestions.`);
            break;
          }

          // 2026-05-20: Audit-time Makerspace heal. The suggestion-6 prompt
          // above produces the bland "PHYSICAL CORE" makerspace; the catchy
          // titles live in MAKERSPACE_MEMORY (written by rebootMakerspace).
          // If this unit has a cached catchy project, swap it in now so a
          // re-audit (triggered by flagAppSmashViolations / surgeon /
          // extractUnitsFromCombinedPlanners) doesn't quietly revert to bland.
          try {
            const memProps = PropertiesService.getScriptProperties();
            const memString = memProps.getProperty('MAKERSPACE_MEMORY');
            if (memString && validSugs.length >= 6) {
              const memory = JSON.parse(memString);
              const memKey = `${planner.ca}_${planner.yl}_${planner.th}`;
              if (memory[memKey] && memory[memKey].t && memory[memKey].d) {
                validSugs[5] = { t: memory[memKey].t, d: memory[memKey].d };
                data[i].stemRebooted = true;
                Logger.log(`Healed Makerspace from memory: ${planner.th} -> "${memory[memKey].t}"`);
              }
            }
          } catch (healErr) {
            Logger.log(`Makerspace heal failed for ${planner.th}: ${healErr}`);
          }

          data[i].s = validSugs;
          data[i].plannerText = result.plannerText || "";
          data[i].audited = true;
          dataDirty = true;
          processedCount++;
          success = true;
          Logger.log(`Audited: ${planner.th} — ${validSugs.length} suggestions saved`);
          break;
        }
      } catch (err) {
        if (attempt < 3) Utilities.sleep(5000);
      }
    }
    if (processedCount < BATCH_LIMIT) Utilities.sleep(5000);
  }
    // Single end-of-batch persist: one write covers every entry mutated this
    // tick (auditSkipped, UNIT NOT FOUND, and successful audits). Replaces
    // 5 × 11 MB writes per batch with 1.
    if (dataDirty) {
      try { file.setContent(JSON.stringify(data, null, 2)); }
      catch (writeErr) { Logger.log('auditPlanners end-of-batch save failed: ' + writeErr); }
    }
  } finally {
    lock.releaseLock();
  }
}


// ==========================================
// 2. THE SURGEON
// ==========================================
function runSurgeon(bannedTool, replacementTool) {
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());
  let totalSwaps = 0;
  const banned = bannedTool.toLowerCase();

  let libraryText = "";
  try {
    const libFile = DriveApp.getFileById(LIBRARIES_JSON_FILE_ID);
    const libraries = JSON.parse(libFile.getBlob().getDataAsString());
    if (libraries.minecraft && libraries.minecraft.length > 0) {
      libraryText += "\nAPPROVED MINECRAFT LESSONS LIBRARY:\nIf you choose to suggest Minecraft Education, you MUST select exactly one from this list. Format the tool name as 'Minecraft: [Title]'. You MUST output the exact URL provided in your JSON.\nUse the Teaching notes (when shown) to ground the description in concrete lesson stages and connect them to the unit.\n" +
      libraries.minecraft.map(m => `- [Ages ${m.ages}] ${m.title}: ${m.desc || ''} (URL: ${m.url || 'No URL'})${m.teaching_notes ? '\n    Teaching notes: ' + m.teaching_notes : ''}`).join("\n");
    }
    if (libraries.microbit && libraries.microbit.length > 0) {
      libraryText += "\n\nAPPROVED MICRO:BIT LESSONS LIBRARY:\nIf you choose to suggest Micro:bits, you MUST select exactly one from this list. Format the tool name as 'Micro:bit: [Title]'. You MUST output the exact URL provided in your JSON.\nUse the Teaching notes (when shown) to ground the description in concrete lesson stages and connect them to the unit.\n" +
      libraries.microbit.map(m => `- [Ages ${m.ages}] ${m.title} (URL: ${m.url || 'No URL'})${m.desc ? ' — ' + m.desc : ''}${m.teaching_notes ? '\n    Teaching notes: ' + m.teaching_notes : ''}`).join("\n");
    }
  } catch(e) {
    Logger.log("Could not load libraries.json for Surgeon.");
  }

  for (let i = 0; i < data.length; i++) {
    let planner = data[i];
    if (!planner.s) continue;
    let needsSave = false;

    let upperPrimary = ["Year 4", "Year 5", "Year 6"];
    let yearGuidance = "";
    if (planner.yl === "3 Year Old Kinder" || planner.yl === "4 Year Old Kinder") {
      yearGuidance = `Kindergarten (${planner.yl}): 3-4 year olds. Use only simple, play-based tools: Bee-Bots, Sphero Indi, ScratchJR, ChatterPix Kids, Puppet Pals, PicCollage, Seesaw, Book Creator, Brushes Redux, Freeform, Epic, Animating a Character with Adobe Express (teacher-guided). Teacher-guided, no reading/typing required.`;
    } else if (upperPrimary.includes(planner.yl)) {
      yearGuidance = "Upper primary (Year 4-6): Canva, Adobe Express, Animating a Character with Adobe Express, Delightex, or Book Creator are appropriate.";
    } else if (planner.yl === "Prep" || planner.yl === "Year 1") {
      yearGuidance = `Early years (Prep, Year 1): prefer Seesaw, Canva, Delightex, Book Creator, or Animating a Character with Adobe Express (teacher-guided). NO SPHERO BOLT. NO MINECRAFT.`;
    } else if (planner.yl === "Year 2") {
      yearGuidance = `Early years (Year 2): prefer Seesaw, Canva, Delightex, Book Creator, or Animating a Character with Adobe Express (teacher-guided). NO SPHERO BOLT.`;
    } else {
      yearGuidance = "Mid primary (Year 3): Canva, Book Creator, Delightex, Adobe Express, or Animating a Character with Adobe Express.";
    }
    yearGuidance += "\nPRESENTATION RULE: All presentation suggestions MUST use either Canva or Adobe Express. PowerPoint is BANNED.";
    yearGuidance += libraryText;

    for (let j = 0; j < planner.s.length; j++) {
      const originalTitle = planner.s[j].t || "";
      const toolName = originalTitle.toLowerCase();
      if (toolName.includes(banned)) {
        // Detect App Smash combos so we can preserve the partner tool.
        // A combo title uses "+", "&", " and " (case-insensitive).
        const comboParts = originalTitle.split(/\s*\+\s*|\s*&\s*|\s+and\s+/i).map(p => p.trim()).filter(Boolean);
        const isCombo = comboParts.length >= 2;
        let comboPartner = null;
        if (isCombo) {
          comboPartner = comboParts.find(p => !p.toLowerCase().includes(banned)) || null;
        }
        Logger.log(`Found "${bannedTool}" in [${planner.ca}] ${planner.yl} — ${planner.th}${comboPartner ? ` (App Smash — preserving "${comboPartner}")` : ''}`);
        const otherToolsInPlanner = planner.s
          .filter((s, idx) => idx !== j && s && s.t)
          .map(s => s.t);
        let newIdea = callOpenAIWithRetry(planner, planner.s[j].t, yearGuidance, replacementTool, otherToolsInPlanner, 1, comboPartner);
        if (newIdea) {
          planner.s[j] = newIdea;
          needsSave = true;
          totalSwaps++;
        }
      }
    }
    // 2026-05-18: After a Surgeon swap, count App Smashes in suggestions 1-5.
    // If we've dropped below v5.19's 2+ App Smash rule, re-queue this unit for
    // a fresh auditPlanners pass so the combos are rebuilt rather than left
    // single-tool. Prevents Surgeon runs from quietly eroding combos over time.
    if (needsSave && planner.audited === true && Array.isArray(planner.s) && planner.s.length >= 5) {
      const appSmashCount = planner.s.slice(0, 5).filter(sg => sg && sg.t && /\+/.test(sg.t)).length;
      if (appSmashCount < 2) {
        Logger.log(`  Post-Surgeon: only ${appSmashCount} App Smash(es) left in [${planner.ca}] ${planner.yl} — ${planner.th}. Re-queueing for audit.`);
        planner.audited = false;
        if (planner.stemRebooted) delete planner.stemRebooted;
      }
    }
    if (needsSave) {
      // If a human had already verified this unit, the verified badge is now
      // stale — at least one suggestion has been replaced by the Surgeon.
      clearHumanVerifiedFlags_(planner, `Surgeon replaced "${bannedTool}"`);
      file.setContent(JSON.stringify(data, null, 2));
    }
  }

  Logger.log(`Surgery Complete. Replaced "${bannedTool}" in ${totalSwaps} spots.`);
  return {
    message: `Surgeon complete — replaced "${bannedTool}" in ${totalSwaps} suggestion${totalSwaps !== 1 ? 's' : ''}`,
    swaps: totalSwaps
  };
}

function callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt, comboPartner) {
  attempt = attempt || 1;
  let replacementInstruction = forcedReplacement
    ? `You MUST use "${forcedReplacement}" as the replacement tool.`
    : `Choose the best replacement from the approved list.\n${yearGuidance}`;

  const otherToolsList = (otherToolsInPlanner && otherToolsInPlanner.length)
    ? `\nTOOLS ALREADY USED IN THIS UNIT — DO NOT PICK ANY OF THESE: ${otherToolsInPlanner.join(', ')}`
    : '';

  // When the original suggestion was an App Smash, keep it an App Smash —
  // swap only the banned half and preserve the partner tool.
  const comboInstruction = comboPartner
    ? `\nAPP SMASH PRESERVATION (HARD RULE): The original suggestion was an App Smash combining the banned tool with "${comboPartner}". The replacement MUST also be an App Smash that keeps "${comboPartner}" as the partner.\n- The "t" field MUST use the format: "<new tool> + ${comboPartner}" (literal + sign, exact partner name).\n- The description MUST explicitly describe how BOTH tools are used together and what each contributes.\n- Do NOT collapse this back to a single tool.`
    : '';

  const responseShape = comboPartner
    ? `{"t": "<new tool> + ${comboPartner}", "d": "Specific description that uses BOTH tools.", "url": "https://..."}`
    : `{"t": "Tool Name", "d": "Specific description for this unit.", "url": "https://..."}`;

  let prompt = `You are a Digital Learning Coach at Wesley College.\n${getApprovedToolsPrompt_()}\n${REALISTIC_TOOL_USE_RULES}\nReplace "${oldTool}" for this unit:\nCampus: ${planner.ca} | Year: ${planner.yl} | Theme: "${planner.th}"\n${planner.plannerText ? `Unit summary: ${planner.plannerText}` : ''}${otherToolsList}\n${replacementInstruction}${comboInstruction}\nThe description must be highly innovative, exciting, and connect specifically to this unit's content. Use standard apostrophes (') only.\nReturn ONLY JSON: ${responseShape}`;

  let payload = {
    "model": OPENAI_MODEL,
    "messages": [{ "role": "user", "content": prompt }],
    "response_format": { "type": "json_object" },
    "temperature": 0.2,
    "max_tokens": 1024
  };

  let options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + getOpenAIKey_() },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    let response = UrlFetchApp.fetch(OPENAI_ENDPOINT, options);
    let code = response.getResponseCode();

    if (isRetriableHttpCode_(code) && attempt <= 3) {
      if (code === 429) setCooldown_(2, 'OpenAI rate limit during Surgeon replacement');
      Utilities.sleep(30000);
      return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1, comboPartner);
    }

    if (code === 200) {
      let jsonResponse = JSON.parse(response.getContentText());
      let text = jsonResponse?.choices?.[0]?.message?.content;
      if (!text) throw new Error("OpenAI Surgeon response was empty.");
      text = text.replace(/[\u2018\u2019\u0060\u00B4]/g, "'").replace(/[\u201C\u201D]/g, '"');
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

      if (parsed && parsed.t && parsed.d) {
        const realism = checkRealisticToolUse_(parsed.t, parsed.d, planner);
        if (!realism.ok) {
          if (attempt <= 3) { Utilities.sleep(3000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1, comboPartner); }
          return null;
        }
      }
      // When we asked for an App Smash partner, enforce that the response actually kept it.
      if (parsed && parsed.t && comboPartner) {
        const titleHasPlus = /\+/.test(parsed.t);
        const partnerKey = toolKey_(comboPartner);
        const titleParts = parsed.t.split(/\s*\+\s*/).map(p => p.trim()).filter(Boolean);
        const partnerInTitle = titleParts.some(p => toolKey_(p) === partnerKey);
        const partnerInDesc = (parsed.d || '').toLowerCase().includes(comboPartner.toLowerCase());
        if (!(titleHasPlus && partnerInTitle && partnerInDesc)) {
          Logger.log(`Surgeon: combo response dropped partner "${comboPartner}" (got "${parsed.t}"). Retrying.`);
          if (attempt <= 3) { Utilities.sleep(3000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1, comboPartner); }
          return null;
        }
      }
      if (parsed && parsed.t && otherToolsInPlanner && otherToolsInPlanner.length) {
        const parsedParts = parsed.t.split(/\s*\+\s*/).map(p => p.trim()).filter(Boolean);
        const partKeys = parsedParts.length ? parsedParts.map(toolKey_) : [toolKey_(parsed.t)];
        const allowedKey = comboPartner ? toolKey_(comboPartner) : null;
        const hasDupe = partKeys.some(pk => pk !== allowedKey && otherToolsInPlanner.some(t => toolKey_(t) === pk));
        if (hasDupe && attempt <= 3) { Utilities.sleep(3000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1, comboPartner); }
        if (hasDupe) return null;
      }
      return parsed;
    }
  } catch (e) {
    if (attempt <= 3) { Utilities.sleep(5000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1, comboPartner); }
  }
  return null;
}


// ==========================================
// 3. ADD TO QUEUE
// ==========================================
function addToQueue(body) {
  const ca = (body.ca || '').toString().trim();
  const yl = (body.yl || '').toString().trim();
  const th = (body.th || '').toString().trim();
  const validCampuses = Object.keys(campusMap);
  const validYears = ['3 Year Old Kinder', '4 Year Old Kinder', 'Prep', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6'];
  if (!validCampuses.includes(ca)) return { error: 'Invalid campus: ' + ca };
  if (!validYears.includes(yl)) return { error: 'Invalid year level: ' + yl };
  if (!th) return { error: 'Unit theme is required' };

  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());
  const duplicate = data.some(e =>
    (e.ca || '').toLowerCase() === ca.toLowerCase() &&
    (e.yl || '').toLowerCase() === yl.toLowerCase() &&
    (e.th || '').toLowerCase() === th.toLowerCase()
  );
  if (duplicate) return { error: `Queue already contains "${th}" for ${ca} ${yl}` };

  data.push({ ca: ca, yl: yl, th: th, ci: '', lo: '', s: [], audited: false });
  file.setContent(JSON.stringify(data, null, 2));
  return { message: `"${th}" added to queue` };
}


// ==========================================
// 4. GITHUB SYNC
// ==========================================
const GITHUB_OWNER  = 'wesdlpteam';
const GITHUB_REPO   = 'digital-learning-assistant-v2';
const GITHUB_PATH   = 'data.json';
const GITHUB_BRANCH = 'main';

function pushToGitHub() {
  // v5.21b: Retry on 409 (SHA conflict). The remote SHA can go stale if another
  // GAS run, manual commit, or webhook touched the file between our GET and PUT.
  // We refetch the SHA and retry up to 3 times before giving up.
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const content = file.getBlob().getDataAsString();
  const base64Content = Utilities.base64Encode(content);
  const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}?ref=${GITHUB_BRANCH}`;
  const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Always refetch the latest SHA on every attempt — never trust a cached one
    const getResp = UrlFetchApp.fetch(getUrl, {
      headers: { 'Authorization': 'token ' + getGitHubToken_(), 'Accept': 'application/vnd.github.v3+json' },
      muteHttpExceptions: true
    });
    let sha = null;
    if (getResp.getResponseCode() === 200) {
      sha = JSON.parse(getResp.getContentText()).sha;
    } else if (getResp.getResponseCode() !== 404) {
      // 404 means file doesn't exist yet (first push) — that's fine, sha stays null
      throw new Error('GitHub data.json fetch failed: HTTP ' + getResp.getResponseCode() + ' — ' + getResp.getContentText().slice(0, 300));
    }

    const body = {
      // Use the Melbourne IANA zone so the commit timestamp respects AEDT (DST).
      // 'GMT+10' is off by an hour for ~half the year.
      message: 'Auto-update data.json — ' + Utilities.formatDate(new Date(), 'Australia/Melbourne', 'dd MMM HH:mm'),
      content: base64Content,
      branch: GITHUB_BRANCH,
      sha: sha
    };
    const putResp = UrlFetchApp.fetch(putUrl, {
      method: 'put',
      headers: { 'Authorization': 'token ' + getGitHubToken_(), 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const putCode = putResp.getResponseCode();

    if (putCode >= 200 && putCode < 300) {
      Logger.log('GitHub sync successful' + (attempt > 1 ? ' (after ' + attempt + ' attempts)' : ''));
      return;
    }

    if (putCode === 409 && attempt < 3) {
      Logger.log(`GitHub data.json SHA conflict on attempt ${attempt} — refetching SHA and retrying in 3s`);
      Utilities.sleep(3000);
      continue;
    }

    if (putCode === 422 && attempt < 3) {
      // 422 can also indicate stale SHA in some cases — treat similarly
      Logger.log(`GitHub data.json 422 on attempt ${attempt} — refetching SHA and retrying in 3s`);
      Utilities.sleep(3000);
      continue;
    }

    // GitHub ruleset validation can time out (>10s) on the "Restrict updates to
    // workflow files" rule even for non-workflow files. Body reads
    // "Rule was unable to be completed in N seconds". Transient — retry.
    if (putCode === 403 && putResp.getContentText().indexOf('Rule was unable to be completed') !== -1 && attempt < 3) {
      Logger.log(`GitHub data.json ruleset-eval timeout on attempt ${attempt} — retrying in 5s`);
      Utilities.sleep(5000);
      continue;
    }

    throw new Error('GitHub data.json sync failed: HTTP ' + putCode + ' — ' + putResp.getContentText().slice(0, 500));
  }
  throw new Error('GitHub data.json sync failed after 3 attempts (SHA kept conflicting)');
}

function pushLibrariesToGitHub() {
  // v5.21b: Same retry-on-409 pattern as pushToGitHub
  try {
    const file = DriveApp.getFileById(LIBRARIES_JSON_FILE_ID);
    const content = file.getBlob().getDataAsString();
    const base64Content = Utilities.base64Encode(content);
    const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/libraries.json?ref=${GITHUB_BRANCH}`;
    const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/libraries.json`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const getResp = UrlFetchApp.fetch(getUrl, {
        headers: { 'Authorization': 'token ' + getGitHubToken_(), 'Accept': 'application/vnd.github.v3+json' },
        muteHttpExceptions: true
      });
      let sha = null;
      if (getResp.getResponseCode() === 200) {
        sha = JSON.parse(getResp.getContentText()).sha;
      } else if (getResp.getResponseCode() !== 404) {
        throw new Error('GitHub libraries.json fetch failed: HTTP ' + getResp.getResponseCode());
      }

      const body = {
        message: 'Auto-update libraries.json — ' + Utilities.formatDate(new Date(), 'Australia/Melbourne', 'dd MMM HH:mm'),
        content: base64Content,
        branch: GITHUB_BRANCH,
        sha: sha
      };
      const putResp = UrlFetchApp.fetch(putUrl, {
        method: 'put',
        headers: { 'Authorization': 'token ' + getGitHubToken_(), 'Content-Type': 'application/json' },
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
      const putCode = putResp.getResponseCode();

      if (putCode >= 200 && putCode < 300) {
        Logger.log('Libraries GitHub sync successful' + (attempt > 1 ? ' (after ' + attempt + ' attempts)' : ''));
        return;
      }
      if ((putCode === 409 || putCode === 422) && attempt < 3) {
        Logger.log(`Libraries SHA conflict on attempt ${attempt} — retrying in 3s`);
        Utilities.sleep(3000);
        continue;
      }
      if (putCode === 403 && putResp.getContentText().indexOf('Rule was unable to be completed') !== -1 && attempt < 3) {
        Logger.log(`Libraries ruleset-eval timeout on attempt ${attempt} — retrying in 5s`);
        Utilities.sleep(5000);
        continue;
      }
      throw new Error('GitHub libraries.json sync failed: HTTP ' + putCode);
    }
  } catch (e) {
    Logger.log('Libraries GitHub sync failed: ' + e.toString());
  }
}


// ==========================================
// 4b. AUTO GITHUB SYNC — time-driven trigger
// ==========================================
// Studio writes lesson edits straight to Drive (saveToDriveConcurrentMerge_),
// bypassing GAS, so pushToGitHub never runs for those edits. This trigger
// closes that gap: every AUTO_SYNC_INTERVAL_MINUTES it checks Drive's
// modifiedTime against the last-pushed timestamp and only commits if newer.
const AUTO_SYNC_INTERVAL_MINUTES = 5;
const AUTO_SYNC_HANDLER_NAME = 'autoSyncDriveToGitHub';
const PROP_LAST_PUSHED_DATA = 'DLA_LAST_PUSHED_DATA_MTIME';
const PROP_LAST_PUSHED_LIBS = 'DLA_LAST_PUSHED_LIBS_MTIME';

function autoSyncDriveToGitHub() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  // If a previous tick is still running (rare, but possible during 429 retries),
  // skip rather than queue up duplicate commits.
  if (!lock.tryLock(1000)) {
    Logger.log('autoSyncDriveToGitHub: another tick is still running, skipping');
    return;
  }
  try {
    // One-time PUA glyph cleanup of the planner .md corpus, piggybacked on
    // the existing 5-min trigger so it auto-runs once without needing manual
    // execution from the editor. Becomes a no-op forever once the property
    // is set. Safe to remove this block after the first successful run.
    if (!props.getProperty('DLA_PUA_CLEANED_AT')) {
      try {
        const cleanResult = cleanPlannerPUAGlyphs();
        props.setProperty('DLA_PUA_CLEANED_AT', new Date().toISOString());
        props.setProperty('DLA_PUA_CLEANED_STATS', JSON.stringify({
          scanned: cleanResult.scanned,
          cleaned: cleanResult.cleaned,
          stripped: cleanResult.stripped
        }));
      } catch (puaErr) {
        Logger.log('autoSync: one-time PUA cleanup failed: ' + puaErr);
      }
    }

    autoSyncOne_(DATA_JSON_FILE_ID, PROP_LAST_PUSHED_DATA, 'data.json', pushToGitHub, props);
    autoSyncOne_(LIBRARIES_JSON_FILE_ID, PROP_LAST_PUSHED_LIBS, 'libraries.json', pushLibrariesToGitHub, props);
  } finally {
    lock.releaseLock();
  }
}

function autoSyncOne_(fileId, propKey, label, pushFn, props) {
  try {
    const driveMtime = DriveApp.getFileById(fileId).getLastUpdated().getTime();
    const lastPushed = Number(props.getProperty(propKey) || 0);
    if (driveMtime <= lastPushed) return;
    pushFn();
    // pushFn throws on failure, so we only reach here on success.
    props.setProperty(propKey, String(driveMtime));
    Logger.log('autoSync: ' + label + ' pushed (drive mtime ' + new Date(driveMtime).toISOString() + ')');
  } catch (e) {
    Logger.log('autoSync ' + label + ' failed: ' + (e && e.message ? e.message : e));
  }
}

// Run ONCE from the Apps Script editor to install the trigger.
function installAutoSyncTrigger() {
  removeAutoSyncTrigger();
  ScriptApp.newTrigger(AUTO_SYNC_HANDLER_NAME)
    .timeBased()
    .everyMinutes(AUTO_SYNC_INTERVAL_MINUTES)
    .create();
  Logger.log('Installed ' + AUTO_SYNC_HANDLER_NAME + ' every ' + AUTO_SYNC_INTERVAL_MINUTES + ' minutes');
}

function removeAutoSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === AUTO_SYNC_HANDLER_NAME) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  Logger.log('Removed ' + removed + ' existing auto-sync trigger(s)');
}


// ==========================================
// 5. PLANNER CONTEXT — On-demand + Batch Enrichment
// ==========================================

function buildPlannerExtractionPrompt_(unitTheme) {
  return 'You are extracting structured teaching context from an IB PYP unit planner PDF at Wesley College, Melbourne.\n\nFind the unit: "' + unitTheme + '" in the attached PDF.\n(PYP acronyms: WWA = Who We Are, WWAIPAT = Where We Are in Place and Time, HWEO = How We Express Ourselves, HTWW/HWWO = How the World Works, HWOO = How We Organize Ourselves, STP = Sharing the Planet.)\n\nIf this unit is NOT found or has no documented content yet, return exactly: NOT_FOUND\n\nIf found, extract the following in plain text (no JSON, no markdown headings):\n\nCENTRAL IDEA: [exactly as written]\n\nLINES OF INQUIRY: [each line, separated by semicolons]\n\nKEY CONCEPTS: [the key concepts]\n\nPROVOCATION / TUNING IN: [what provocation or tuning-in activity is planned - be specific about what students will do, see, or experience]\n\nLEARNING ENGAGEMENTS: [list the main learning activities, investigations, or tasks students will do - include named resources, excursions, guest speakers, experiments, projects. Be specific and practical.]\n\nASSESSMENT: [assessment tasks or evidence of learning - portfolios, presentations, performances, exhibitions]\n\nTEACHER NOTES: [any other relevant teaching context - action opportunities, transdisciplinary connections, integration notes that would help a digital learning coach suggest appropriate technology]\n\nBe thorough but concise. Extract what is actually written in the planner - do not invent content. If a section has no content in the PDF, write "Not specified."';
}

// v5.19: Reads markdown planner directly — no OpenAI API call needed.
function getPlannerContext_(body) {
  var ca = String(body.ca || '').trim();
  var yl = String(body.yl || '').trim();
  var th = String(body.th || '').trim();
  if (!ca || !yl || !th) throw new Error('getPlannerContext requires ca, yl, and th');
  var caCode = campusMap[ca];
  if (!caCode) throw new Error('Unknown campus: ' + ca);

  var folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);
  var mdResult = readPlannerMarkdown_(folder, yl, th, caCode);

  if (!mdResult) {
    return { plannerContext: '', found: false, message: 'No planner markdown found for ' + ca + ' ' + yl };
  }

  Logger.log('Read planner context directly: ' + th + ' — ' + mdResult.text.length + ' chars');
  return { plannerContext: mdResult.text, found: true, pdfName: mdResult.fileName };
}


// ==========================================
// PLANNER ENRICHMENT
// ==========================================
// v5.19: Reads markdown planners directly from Drive — zero API calls.
// v5.22: Re-enriches an entry when the .md file's lastUpdated is newer than
//        the stored plannerContextRichAt, so AI prompts never run on stale text.
function enrichPlannerContext() {
  var file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  var data = JSON.parse(file.getBlob().getDataAsString());
  var folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);
  var enrichedCount = 0, refreshedCount = 0, needsSave = false;

  for (var i = 0; i < data.length; i++) {
    var entry = data[i];
    if (!entry.audited) continue;

    var ca = entry.ca, yl = entry.yl, th = entry.th;
    var caCode = campusMap[ca];
    if (!caCode) continue;

    var hasRich = entry.plannerContextRich && entry.plannerContextRich.length > 50;
    var richIsError = hasRich && /^ERROR:/.test(entry.plannerContextRich);

    // Fast path: skip if already enriched AND the .md hasn't been edited since.
    // For entries we have no timestamp for yet, do a cheap stat-only check so
    // we don't read large blobs we don't need.
    if (hasRich && !richIsError) {
      var mdFile = findPlannerFile_(folder, yl, th, caCode);
      if (!mdFile) continue; // file deleted — keep cache rather than blank it
      var mdUpdated = mdFile.getLastUpdated().getTime();
      var cachedAt = entry.plannerContextRichAt ? new Date(entry.plannerContextRichAt).getTime() : 0;
      if (cachedAt && mdUpdated <= cachedAt) continue; // cache still fresh

      var text = mdFile.getBlob().getDataAsString();
      if (!text || !text.trim()) continue;
      data[i].plannerContextRich = text.trim();
      data[i].plannerContextRichAt = new Date(mdUpdated).toISOString();
      needsSave = true;
      refreshedCount++;
      Logger.log('Refreshed (md newer): "' + th + '" — ' + text.length + ' chars');
      continue;
    }

    // Initial enrichment (no cache yet, or cached as ERROR).
    var mdResult = readPlannerMarkdown_(folder, yl, th, caCode);

    if (!mdResult) {
      data[i].plannerContextRich = 'ERROR: No planner markdown could be found. Skipping to prevent loop.';
      needsSave = true;
      Logger.log('No markdown found for ' + th + '. Marked as error.');
      continue;
    }

    data[i].plannerContextRich = mdResult.text;
    var mdFileForTs = findPlannerFile_(folder, yl, th, caCode);
    if (mdFileForTs) data[i].plannerContextRichAt = mdFileForTs.getLastUpdated().toISOString();
    needsSave = true;
    enrichedCount++;
    Logger.log('Enriched: "' + th + '" — ' + mdResult.text.length + ' chars (direct read)');
  }

  if (needsSave) {
    file.setContent(JSON.stringify(data, null, 2));
    Logger.log('Saved data. Enriched ' + enrichedCount + ', refreshed ' + refreshedCount + ' entries.');
    if (typeof pushToGitHub === 'function') pushToGitHub();
  }

  var remaining = data.filter(function(e) { return e.audited && (!e.plannerContextRich || e.plannerContextRich.length <= 50); }).length;
  Logger.log(remaining + ' entries still need enrichment');
  return { enriched: enrichedCount, refreshed: refreshedCount, remaining: remaining };
}

// ==========================================
// PLANNER CONTEXT REFRESH (manual cache-bust)
// ==========================================
// Force-reads .md files from Drive and overwrites plannerContextRich,
// bypassing the timestamp gate. Body:
//   { all: true }                       → refresh every audited entry
//   { ca, yl, th }                      → refresh just that one
//   { ca, yl }                          → refresh all entries for that campus+year
function refreshPlannerContext_(body) {
  var file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  var data = JSON.parse(file.getBlob().getDataAsString());
  var folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);

  var all = body.all === true || String(body.all) === 'true';
  var ca = String(body.ca || '').trim();
  var yl = String(body.yl || '').trim();
  var th = String(body.th || '').trim();

  if (!all && !(ca && yl)) {
    throw new Error('refreshPlannerContext requires {all:true} or {ca, yl[, th]}');
  }

  var refreshed = 0, missing = 0, skipped = 0, needsSave = false;
  var perFileCache = {}; // avoid re-reading the same .md when many entries share one planner

  for (var i = 0; i < data.length; i++) {
    var entry = data[i];
    if (!all) {
      if (ca && entry.ca !== ca) continue;
      if (yl && entry.yl !== yl) continue;
      if (th && entry.th !== th) continue;
    }
    if (!entry.audited && !all) { skipped++; continue; }
    var caCode = campusMap[entry.ca];
    if (!caCode) { skipped++; continue; }

    var cacheKey = entry.yl + '|' + entry.th + '|' + caCode;
    var hit = perFileCache[cacheKey];
    var mdFile, text;
    if (hit) {
      mdFile = hit.mdFile;
      text = hit.text;
    } else {
      mdFile = findPlannerFile_(folder, entry.yl, entry.th, caCode);
      if (!mdFile) {
        perFileCache[cacheKey] = { mdFile: null, text: '' };
        missing++;
        Logger.log('refreshPlannerContext: no .md found for ' + entry.ca + ' ' + entry.yl + ' — ' + entry.th);
        continue;
      }
      text = mdFile.getBlob().getDataAsString();
      perFileCache[cacheKey] = { mdFile: mdFile, text: text };
    }

    if (!mdFile) { missing++; continue; }
    if (!text || !text.trim()) { missing++; continue; }

    data[i].plannerContextRich = text.trim();
    data[i].plannerContextRichAt = mdFile.getLastUpdated().toISOString();
    needsSave = true;
    refreshed++;
  }

  if (needsSave) {
    file.setContent(JSON.stringify(data, null, 2));
    if (typeof pushToGitHub === 'function') pushToGitHub();
  }

  Logger.log('refreshPlannerContext: refreshed ' + refreshed + ', missing ' + missing + ', skipped ' + skipped);
  return { refreshed: refreshed, missing: missing, skipped: skipped, scope: all ? 'all' : (th ? 'unit' : 'campus+year') };
}


// ==========================================
// 6. TOOL INVENTORY SYNC
// ==========================================
function syncToolInventory_(body) {
  var approved = body.approved || [];
  var banned = body.banned || [];
  var ageRanges = body.ageRanges || {};
  if (!Array.isArray(approved)) approved = [];
  if (!Array.isArray(banned)) banned = [];

  var props = PropertiesService.getScriptProperties();
  props.setProperty('DLA_TOOL_APPROVED', JSON.stringify(approved));
  props.setProperty('DLA_TOOL_BANNED', JSON.stringify(banned));
  props.setProperty('DLA_TOOL_AGE_RANGES', JSON.stringify(ageRanges));
  props.setProperty('DLA_TOOL_SYNC_TIME', new Date().toISOString());

  // v5.18: Clean up the orphaned TOOL_INVENTORY property if it exists
  // This was the old key that auditPlanners() incorrectly read from.
  props.deleteProperty('TOOL_INVENTORY');

  Logger.log('Tool inventory synced: ' + approved.length + ' approved, ' + banned.length + ' banned');
  return { message: 'Synced: ' + approved.length + ' approved, ' + banned.length + ' banned', syncTime: new Date().toISOString() };
}

function checkToolInventorySync() {
  var props = PropertiesService.getScriptProperties();
  var syncTime = props.getProperty('DLA_TOOL_SYNC_TIME');
  if (!syncTime) { Logger.log('No sync yet. Using hardcoded APPROVED_TOOLS.'); return; }
  var approved = JSON.parse(props.getProperty('DLA_TOOL_APPROVED') || '[]');
  var banned = JSON.parse(props.getProperty('DLA_TOOL_BANNED') || '[]');
  Logger.log('Last sync: ' + syncTime);
  Logger.log('Approved (' + approved.length + '): ' + approved.join(', '));
  Logger.log('Banned (' + banned.length + '): ' + banned.join(', '));
}


// ==========================================
// 7. UTILITIES
// ==========================================
function forceWakeUp() {
  PropertiesService.getScriptProperties().deleteProperty('DLA_RESUME_TIME');
  Logger.log("Cooldown removed.");
}

function auditAndSync() {
  auditPlanners();
  pushToGitHub();
  pushLibrariesToGitHub();
}

// 2026-05-18: One-shot recovery helper. Finds every audited unit whose
// first-5 digital suggestions contain fewer than 2 App Smashes (`+` in `s.t`)
// and re-queues them for audit. Combined with v5.19's enforcement in
// auditPlanners, this rebuilds the multi-tool App Smash combos that were lost
// when extractUnitsFromCombinedPlanners silently wiped 85 of them on 2026-04-15.
// Call from the GAS editor: flagUnitsMissingAppSmashes(); auditAndSync();
function flagUnitsMissingAppSmashes(filterCa, filterYl) {
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());
  const folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);
  let flagged = 0;
  let skippedNoPlanner = 0;
  const flaggedSummary = [];
  const skippedSummary = [];

  // 2026-05-18: Pre-check each candidate against the planner markdown so we
  // don't wipe suggestions for units that auditPlanners cannot rebuild (theme
  // not present in planner file). This was the root cause of the data-loss
  // incident earlier today — flagging set s=[] for units that then permanently
  // stayed un-audited because the markdown lookup failed.
  const pypAcronyms = {
    'who we are': 'wwa',
    'where we are in place and time': 'wwaipat',
    'how we express ourselves': 'hweo',
    'how the world works': 'htww',
    'how we organise ourselves': 'hwoo',
    'how we organize ourselves': 'hwoo',
    'sharing the planet': 'stp'
  };

  // Cache planner markdown reads — combined planner files are shared across
  // multiple units, so this avoids re-reading per unit (134 candidates × full
  // Drive blob fetch each would be ~minutes of wasted IO).
  const mdCache = {};
  const themeInMarkdown_ = (planner) => {
    const caCode = campusMap[planner.ca];
    if (!caCode) return false;
    const cacheKey = caCode + '|' + planner.yl;
    if (mdCache[cacheKey] === undefined) {
      const md = readPlannerMarkdown_(folder, planner.yl, planner.th, caCode);
      mdCache[cacheKey] = md ? { lower: md.text.toLowerCase(), raw: md.text, fileName: md.fileName } : null;
    }
    const cached = mdCache[cacheKey];
    if (!cached) return false;
    const themeLower = (planner.th || '').toLowerCase();
    const acronym = pypAcronyms[themeLower] || '';
    return cached.lower.includes(themeLower)
      || (!!acronym && new RegExp('\\b' + acronym + '\\b', 'i').test(cached.raw));
  };

  for (let i = 0; i < data.length; i++) {
    const e = data[i];
    if (filterCa && e.ca !== filterCa) continue;
    if (filterYl && e.yl !== filterYl) continue;
    if (!e.audited) continue;
    if (!Array.isArray(e.s) || e.s.length < 5) continue;

    const digital = e.s.slice(0, 5);
    const appSmashCount = digital.filter(sg => sg && sg.t && /\+/.test(sg.t)).length;
    if (appSmashCount >= 2) continue;

    // Pre-check: only wipe if the theme can be located in the planner markdown.
    if (!themeInMarkdown_(e)) {
      skippedNoPlanner++;
      skippedSummary.push(`[${e.ca}] ${e.yl} — ${e.th} (had ${appSmashCount} App Smash${appSmashCount === 1 ? '' : 'es'})`);
      continue;
    }

    data[i].audited = false;
    data[i].s = [];
    if (data[i].stemRebooted) delete data[i].stemRebooted;
    flagged++;
    flaggedSummary.push(`[${e.ca}] ${e.yl} — ${e.th} (had ${appSmashCount} App Smash${appSmashCount === 1 ? '' : 'es'})`);
  }

  if (flagged > 0) {
    file.setContent(JSON.stringify(data, null, 2));
    Logger.log(`Flagged ${flagged} units for App Smash re-audit:`);
    flaggedSummary.forEach(line => Logger.log('  ' + line));
  } else {
    Logger.log('No units need flagging — every eligible audited unit already has 2+ App Smashes.');
  }
  if (skippedNoPlanner > 0) {
    Logger.log(`Skipped ${skippedNoPlanner} unit(s) — theme not present in planner markdown (cannot be re-audited, suggestions preserved):`);
    skippedSummary.forEach(line => Logger.log('  ' + line));
  }
  return { flagged: flagged, skipped: skippedNoPlanner, units: flaggedSummary, skippedUnits: skippedSummary };
}

function enrichAndSync() {
  enrichPlannerContext();
  pushToGitHub();
}

// 2026-05-18: One-shot recovery for units that lost their suggestions during
// the App Smash flag pass. Pulls data.json from a known-good GitHub commit
// (PRE_FLAG_SHA) and, for every unit that is currently empty AND had >=5
// suggestions in that pre-flag snapshot, restores the old `s` array along
// with `audited` and `stemRebooted`. Units that have been successfully
// re-audited since (s.length > 0 now) are left untouched.
function restoreWipedSuggestionsFromGitHub() {
  const PRE_FLAG_SHA = '4bc1708';
  const apiUrl = 'https://api.github.com/repos/wesdlpteam/digital-learning-assistant-v2/contents/data.json?ref=' + PRE_FLAG_SHA;
  const token = getGitHubToken_();

  Logger.log(`Fetching pre-flag data.json from ${PRE_FLAG_SHA}…`);
  const resp = UrlFetchApp.fetch(apiUrl, {
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3.raw',
      'User-Agent': 'DLA-Restore'
    },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error(`Failed to fetch pre-flag data.json (HTTP ${code}): ${resp.getContentText().slice(0, 300)}`);
  }
  const preData = JSON.parse(resp.getContentText());
  Logger.log(`Loaded pre-flag snapshot: ${preData.length} units.`);

  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const currentData = JSON.parse(file.getBlob().getDataAsString());

  const preMap = {};
  preData.forEach(e => { preMap[`${e.ca}|${e.yl}|${e.th}`] = e; });

  let restored = 0;
  const restoredList = [];
  for (let i = 0; i < currentData.length; i++) {
    const e = currentData[i];
    if (e.s && e.s.length > 0) continue;
    const old = preMap[`${e.ca}|${e.yl}|${e.th}`];
    if (!old || !old.s || old.s.length < 5) continue;

    currentData[i].s = old.s;
    currentData[i].audited = old.audited === true;
    if (old.stemRebooted !== undefined) currentData[i].stemRebooted = old.stemRebooted;
    if (old.plannerText && !currentData[i].plannerText) currentData[i].plannerText = old.plannerText;
    restored++;
    restoredList.push(`[${e.ca}] ${e.yl} — ${e.th} (${old.s.length} suggestions)`);
  }

  if (restored === 0) {
    Logger.log('No units needed restoration — nothing to do.');
    return { restored: 0, units: [] };
  }

  file.setContent(JSON.stringify(currentData, null, 2));
  Logger.log(`Restored ${restored} units from ${PRE_FLAG_SHA}:`);
  restoredList.forEach(line => Logger.log('  ' + line));

  // Clear the recovery target list so any stragglers don't keep being tracked
  PropertiesService.getScriptProperties().deleteProperty('DLA_APP_SMASH_RECOVERY_TARGETS');

  if (typeof pushToGitHub === 'function') {
    Logger.log('Pushing restored data.json to GitHub…');
    pushToGitHub();
  }

  return { restored: restored, units: restoredList };
}

function testGWYear4HTWW() {
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID); 
  let data = JSON.parse(file.getBlob().getDataAsString());
  
  for (let i = 0; i < data.length; i++) {
    let planner = data[i];
    let isGW = planner.ca === "Glen Waverley" || planner.ca === "GW";
    let isYear4 = planner.yl === "Year 4";
    let isHTWW = String(planner.th).toLowerCase().includes("how the world works");
    
    if (isGW && isYear4 && isHTWW) {
      Logger.log("Found GW Year 4 HTWW. Resetting audit status to force generation...");
      
      data[i].audited = false; 
      data[i].s = []; 
      file.setContent(JSON.stringify(data, null, 2));
      
      // v5.18b FIX: Pass filter so only Glen Waverley Year 4 entries are audited.
      // Previously called auditPlanners() unfiltered, which processed
      // whatever unaudited entries came first in the array (often Prep).
      auditPlanners('Glen Waverley', 'Year 4'); 
      Logger.log("Audit complete. Check your DLA Studio for the new App Smash suggestions.");
      return;
    }
  }
  Logger.log("Could not find the GW Year 4 How the World Works planner in data.json.");
}

function goNuclearGWYear4() {
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());
  let count = 0;

  data.forEach(planner => {
    if (planner.ca === "Glen Waverley" && planner.yl === "Year 4") {
      planner.audited = false;
      planner.s = []; 
      count++;
    }
  });

  if (count > 0) {
    file.setContent(JSON.stringify(data, null, 2));
    SpreadsheetApp.flush(); 
  }
  
  Logger.log(`Reset successful! Found and reset ${count} planners.`);
  return count;
}

// One-off: reboot just the GW Year 4 "How We Express Ourselves" Makerspace
// suggestion so we can sanity-check the catchy/hands-on output before rolling
// the reboot out to everyone. Clears that single entry's stemRebooted flag
// (and its MAKERSPACE_MEMORY record) then calls rebootMakerspace scoped to
// that one unit.
function testRebootGWYear4HWEO() {
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());

  let targetIdx = -1;
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    const isGW = p.ca === 'Glen Waverley' || p.ca === 'GW';
    const isYear4 = p.yl === 'Year 4';
    const isHWEO = String(p.th).toLowerCase().includes('how we express ourselves');
    if (isGW && isYear4 && isHWEO) { targetIdx = i; break; }
  }

  if (targetIdx === -1) {
    Logger.log('Could not find GW Year 4 "How We Express Ourselves" in data.json.');
    return { message: 'Target unit not found', rebooted: 0 };
  }

  const target = data[targetIdx];
  Logger.log(`Found target: [${target.ca}] ${target.yl} — ${target.th}`);

  data[targetIdx].stemRebooted = false;

  const props = PropertiesService.getScriptProperties();
  const memoryString = props.getProperty('MAKERSPACE_MEMORY');
  if (memoryString) {
    const memory = JSON.parse(memoryString);
    const key = `${target.ca}_${target.yl}_${target.th}`;
    if (memory[key]) {
      delete memory[key];
      props.setProperty('MAKERSPACE_MEMORY', JSON.stringify(memory));
      Logger.log(`Cleared MAKERSPACE_MEMORY entry for ${key}.`);
    }
  }

  file.setContent(JSON.stringify(data, null, 2));

  const result = rebootMakerspace(target.ca, target.yl, 'How We Express Ourselves');
  Logger.log(JSON.stringify(result));
  return result;
}

// v5.19: Identical to enrichPlannerContext() now — kept as a separate
// entry point so existing triggers still work.
function runEnrichmentFix() {
  enrichPlannerContext();
}


function addKinderUnits() {
  var folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);
  var file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  var data = JSON.parse(file.getBlob().getDataAsString());
  var added = [];

  var kinderLevels = [
    { yl: '3 Year Old Kinder', tokens: ['3yo', '3yearoldkinder', 'threeyearoldkinder'] },
    { yl: '4 Year Old Kinder', tokens: ['4yo', '4yearoldkinder', 'fouryearoldkinder'] }
  ];
  var campus = 'Glen Waverley';
  var caCode = 'GW';

  // PYP transdisciplinary themes to search for in the markdown
  var themes = [
    'Who We Are',
    'Where We Are in Place and Time',
    'How We Express Ourselves',
    'How the World Works',
    'How We Organise Ourselves',
    'Sharing the Planet'
  ];

  // Build an in-memory index of every file in the Planners folder ONCE,
  // so we don't hammer Drive with one getFilesByName call per guess.
  var folderIndex = [];
  var iter = folder.getFiles();
  while (iter.hasNext()) {
    var f = iter.next();
    folderIndex.push({ file: f, name: f.getName(), nameLower: f.getName().toLowerCase() });
  }

  // Resolve a planner file by fuzzy-matching against the index. A file matches
  // if its filename (lowercased, spaces stripped) contains ANY of the kinder
  // tokens AND the campus code, regardless of year prefix or "Planner" vs
  // "Planners" pluralisation. Survives renames between e.g. 2025 and 2026.
  function findKinderPlanner(level) {
    var caCodeLower = '(' + caCode.toLowerCase() + ')';
    var matches = folderIndex.filter(function(entry) {
      var stripped = entry.nameLower.replace(/\s+/g, '');
      var hasCampus = entry.nameLower.indexOf(caCodeLower) !== -1;
      var hasToken = level.tokens.some(function(t) {
        return stripped.indexOf(t.replace(/\s+/g, '')) !== -1;
      });
      return hasCampus && hasToken;
    });
    if (matches.length === 0) return null;
    matches.sort(function(a, b) { return b.file.getLastUpdated() - a.file.getLastUpdated(); });
    return matches[0].file;
  }

  kinderLevels.forEach(function(level) {
    var mdFile = findKinderPlanner(level);

    if (!mdFile) {
      Logger.log('No planner file found for ' + level.yl + '.');
      Logger.log('Tokens tried: ' + level.tokens.join(', ') + ' (must also contain "(' + caCode + ')")');
      Logger.log('Files in folder containing "kinder", "3yo", or "4yo":');
      folderIndex.forEach(function(entry) {
        var n = entry.nameLower;
        if (n.indexOf('kinder') !== -1 || n.indexOf('3yo') !== -1 || n.indexOf('4yo') !== -1) {
          Logger.log('  -> ' + entry.name);
        }
      });
      return;
    }

    var content = mdFile.getBlob().getDataAsString().toLowerCase();
    Logger.log('Found: ' + mdFile.getName() + ' (' + content.length + ' chars) for ' + level.yl);

    themes.forEach(function(th) {
      if (!content.includes(th.toLowerCase())) {
        Logger.log('  X "' + th + '" not found in ' + level.yl + ' planner — skipping');
        return;
      }
      var exists = data.some(function(e) {
        return e.ca === campus && e.yl === level.yl && e.th.toLowerCase() === th.toLowerCase();
      });
      if (exists) {
        Logger.log('  - "' + th + '" already exists for ' + level.yl + ' — skipping');
        return;
      }
      data.push({ ca: campus, yl: level.yl, th: th, ci: '', lo: '', s: [], audited: false });
      added.push(level.yl + ' — ' + th);
      Logger.log('  + Added: ' + level.yl + ' — ' + th);
    });
  });

  if (added.length) {
    file.setContent(JSON.stringify(data, null, 2));
    Logger.log('Saved ' + added.length + ' new entries to data.json');
    pushToGitHub();
    Logger.log('Pushed to GitHub');
  } else {
    Logger.log('No new entries to add. Check the file names in the log above.');
  }
}

// ==========================================
// COMBINED PLANNER EXTRACTION
// ==========================================
// v5.21: Combined planner files (e.g. "2026 - 3 Year Old Kinder UOI Planner (GW).md")
// contain MULTIPLE units in one document, separated by "Theme:" markers.
// This function:
//   1. Splits each combined planner into per-unit sections
//   2. For each unit entry in data.json, finds the matching section
//   3. Uses GPT to extract clean ci (central idea) + lo (lines of inquiry)
//   4. Saves ci, lo, and the unit-scoped section text into plannerContextRich
//   5. Resets audited:false so the next auditPlanners run regenerates suggestions
//      using the correct unit's content (not the soup of all units combined).

function _splitCombinedPlannerByTheme_(markdown) {
  // Split the combined planner into sections by "Theme:" markers using a positive
  // lookahead so the marker stays with its section. The "Theme:" line is followed by
  // a unit name on the same line — usually a full PYP theme or an acronym.
  if (!markdown || typeof markdown !== 'string') return [];
  // Normalise common form-feed / page-break artefacts
  const cleaned = markdown.replace(/\f/g, '\n');
  const parts = cleaned.split(/(?=^|\n)\s*Theme:\s*/i);
  const sections = [];
  // First chunk before any Theme: marker → header / metadata, ignore unless there's only one
  // (i.e. file isn't a combined planner)
  if (parts.length <= 1) {
    if (cleaned.trim()) sections.push({ themeRaw: '', content: cleaned.trim() });
    return sections;
  }
  // Skip the first split chunk (everything before the first Theme:)
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    if (!chunk || !chunk.trim()) continue;
    const firstLineEnd = chunk.indexOf('\n');
    const themeLine = (firstLineEnd >= 0 ? chunk.slice(0, firstLineEnd) : chunk).trim();
    sections.push({ themeRaw: themeLine, content: 'Theme: ' + chunk.trim() });
  }
  return sections;
}

function _matchSectionToTheme_(sections, themeName) {
  // Theme markers may be the full name ("How the World Works"), an acronym ("HTWW"),
  // or a slight variant ("WWAIPAT"). Match flexibly.
  const themeLower = String(themeName || '').toLowerCase();
  const acronyms = {
    'who we are': ['wwa'],
    'where we are in place and time': ['wwaipat', 'where we are in place'],
    'how we express ourselves': ['hweo', 'how we express'],
    'how the world works': ['htww', 'how the world'],
    'how we organise ourselves': ['hwoo', 'how we organise', 'how we organize'],
    'how we organize ourselves': ['hwoo', 'how we organise', 'how we organize'],
    'sharing the planet': ['stp', 'sharing the planet']
  };
  const aliases = [themeLower, ...(acronyms[themeLower] || [])];

  for (const section of sections) {
    const sectionTheme = String(section.themeRaw || '').toLowerCase();
    if (!sectionTheme) continue;
    for (const alias of aliases) {
      if (alias && sectionTheme.includes(alias)) return section;
    }
  }
  return null;
}

function _extractCiAndLoFromSection_(unitTheme, sectionText) {
  // Use GPT to pull a clean central idea and lines-of-inquiry list out of the messy
  // PDF-converted markdown. Single small request per unit — cheap and reliable.
  const prompt = `You are extracting structured fields from an IB PYP unit planner section.

UNIT THEME: "${unitTheme}"

PLANNER SECTION:
${sectionText.slice(0, 6000)}

TASK: Extract these two fields:

1. CENTRAL IDEA: The single sentence that represents the actual central idea / enduring understanding for THIS unit. It is NOT the IB transdisciplinary theme description (sentences starting with "An inquiry into..."). It is NOT just the theme name repeated. It is a complete statement about what students will understand. Examples of valid central ideas:
   - "Light and shadows change in a variety of ways."
   - "Connecting with others helps us to establish a sense of belonging."
   - "Our experiences shape the way we grow and change over time"
   - "People use a range of materials and resources to express ideas and respond to provocations."

2. LINES OF INQUIRY: The 2-4 lines of inquiry listed for this unit. Strip prefixes like "LOI#1:", "1.", "?", "•". Each should be a complete idea-phrase.

If the section does not contain a clear central idea or lines of inquiry, set the field to an empty string / empty array.

Return ONLY a JSON object in exactly this shape — no commentary, no markdown fences:
{"ci": "Central idea sentence here.", "lo": ["First line of inquiry", "Second line of inquiry", "Third line of inquiry"]}`;

  const payload = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 600
  };

  const response = UrlFetchApp.fetch(OPENAI_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getOpenAIKey_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log(`Extraction HTTP ${code} for ${unitTheme}: ${response.getContentText().slice(0, 200)}`);
    if (code === 429) setCooldown_(2, 'OpenAI rate limit during unit extraction');
    return null;
  }

  try {
    const json = JSON.parse(response.getContentText());
    let text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) return null;
    text = text.replace(/[\u2018\u2019\u0060\u00B4]/g, "'").replace(/[\u201C\u201D]/g, '"');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      ci: String(parsed.ci || '').trim(),
      lo: Array.isArray(parsed.lo) ? parsed.lo.map(s => String(s).trim()).filter(Boolean) : []
    };
  } catch (e) {
    Logger.log(`Extraction parse failed for ${unitTheme}: ${e.toString()}`);
    return null;
  }
}

function extractUnitsFromCombinedPlanners(filterCa, filterYl) {
  const props = PropertiesService.getScriptProperties();
  const resumeTime = props.getProperty('DLA_RESUME_TIME');
  if (resumeTime && Date.now() < parseInt(resumeTime)) {
    Logger.log('Cooldown active — skipping extraction.');
    return { message: 'Cooldown active', extracted: 0 };
  }

  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());
  const folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);

  // Cache of file content + section split per (campus, yearLevel) — combined planners
  // are shared across multiple units, so this avoids re-reading and re-splitting.
  const fileCache = {};

  let extractedCount = 0;
  let skippedCount = 0;
  let needsSync = false;
  let processedThisRun = 0;
  const BATCH_LIMIT = 12; // 12 small extraction calls is fine in a single GAS run

  for (let i = 0; i < data.length; i++) {
    if (processedThisRun >= BATCH_LIMIT) break;
    const entry = data[i];
    if (filterCa && entry.ca !== filterCa) continue;
    if (filterYl && entry.yl !== filterYl) continue;

    const caCode = campusMap[entry.ca];
    if (!caCode) continue;

    // Skip if already cleanly extracted (has ci AND lo set)
    if (entry.ci && String(entry.ci).trim() && entry.lo && String(entry.lo).trim()) {
      skippedCount++;
      continue;
    }

    const cacheKey = entry.ca + '|' + entry.yl;
    if (fileCache[cacheKey] === undefined) {
      const md = readPlannerMarkdown_(folder, entry.yl, entry.th, caCode);
      if (!md) {
        Logger.log(`No planner markdown for ${entry.ca} ${entry.yl} — skipping all of its units`);
        fileCache[cacheKey] = null;
      } else {
        fileCache[cacheKey] = {
          fullText: md.text,
          sections: _splitCombinedPlannerByTheme_(md.text)
        };
      }
    }

    const cached = fileCache[cacheKey];
    if (!cached) continue;

    let sectionContent = '';
    if (cached.sections.length > 1) {
      // Combined planner — find the matching section
      const match = _matchSectionToTheme_(cached.sections, entry.th);
      if (!match) {
        Logger.log(`No section matched "${entry.th}" in ${entry.ca} ${entry.yl} planner — skipping`);
        continue;
      }
      sectionContent = match.content;
    } else {
      // Single-unit planner — use the whole file
      sectionContent = cached.fullText;
    }

    Logger.log(`Extracting: ${entry.ca} ${entry.yl} — ${entry.th} (${sectionContent.length} chars)`);
    const result = _extractCiAndLoFromSection_(entry.th, sectionContent);
    processedThisRun++;

    if (!result) {
      Logger.log(`Extraction returned null for ${entry.th} — leaving entry untouched`);
      continue;
    }

    // Update the entry
    const oldCi = (entry.ci || '').trim();
    const oldLo = (entry.lo || '').trim();
    const newCi = (result.ci || '').trim();
    const newLo = (result.lo || []).join('; ').trim();
    data[i].ci = newCi;
    data[i].lo = newLo;
    data[i].plannerContextRich = sectionContent;

    // 2026-05-18 fix: only wipe suggestions when the freshly extracted Ci/Lo
    // *materially differ* from what was already there. The previous logic
    // wiped `s` for every audited unit on every re-extraction, which is what
    // detonated 85 multi-tool App Smash suggestions on 2026-04-15 22:18.
    // Now: if Ci/Lo are unchanged (or were previously empty), keep the
    // existing suggestions intact so teachers don't lose curated content.
    const ciChanged = oldCi && newCi && oldCi !== newCi;
    const loChanged = oldLo && newLo && oldLo !== newLo;
    if (entry.audited && (ciChanged || loChanged)) {
      Logger.log('  Ci/Lo materially changed — wiping suggestions and queueing for re-audit.');
      data[i].audited = false;
      data[i].s = [];
      if (data[i].stemRebooted) delete data[i].stemRebooted;
    } else if (entry.audited) {
      Logger.log(`  Ci/Lo unchanged — preserving existing ${(entry.s || []).length} suggestion(s).`);
    }

    extractedCount++;
    needsSync = true;
    Logger.log(`  ci: "${result.ci}"`);
    Logger.log(`  lo: ${result.lo.length} lines`);
  }

  if (needsSync) {
    file.setContent(JSON.stringify(data, null, 2));
    Logger.log(`Saved ${extractedCount} extracted units to data.json.`);
    if (typeof pushToGitHub === 'function') pushToGitHub();
  }

  // Count how many entries still need extraction (matching the filter)
  const remaining = data.filter(e =>
    (!filterCa || e.ca === filterCa) &&
    (!filterYl || e.yl === filterYl) &&
    (!e.ci || !e.lo)
  ).length;

  return {
    message: extractedCount > 0
      ? `Extracted ${extractedCount} unit${extractedCount !== 1 ? 's' : ''} (${remaining} remaining, ${skippedCount} already done)`
      : (remaining === 0 ? 'All units already extracted' : `No extractions this batch — ${remaining} still need extraction`),
    extracted: extractedCount,
    skipped: skippedCount,
    remaining: remaining
  };
}

function extractAndSync() {
  const result = extractUnitsFromCombinedPlanners();
  Logger.log(JSON.stringify(result));
  return result;
}


// ==========================================
// MAKERSPACE REBOOT
// ==========================================
// v5.20: Replaces ONLY the 6th (Makerspace) suggestion in each planner with a
// new, catchy, hands-on physical project. Preserves suggestions 1-5 entirely.
// Diversity rule prevents repeating projects across the same year level.
// Memory persistence via Script Properties heals from Drive cache delays.

function rebootMakerspace(filterCa, filterYl, filterTh) {
  const props = PropertiesService.getScriptProperties();
  const resumeTime = props.getProperty('DLA_RESUME_TIME');
  if (resumeTime && Date.now() < parseInt(resumeTime)) {
    Logger.log('Cooldown active — skipping reboot.');
    return { message: 'Cooldown active', rebooted: 0 };
  }
  const themeNeedle = filterTh ? String(filterTh).toLowerCase() : '';

  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());

  // Memory heal: restore any rebooted projects that Drive's cache may have lost
  let memoryString = props.getProperty('MAKERSPACE_MEMORY');
  let memory = memoryString ? JSON.parse(memoryString) : {};
  let healedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    const key = `${entry.ca}_${entry.yl}_${entry.th}`;
    if (memory[key] && !entry.stemRebooted && entry.s && entry.s.length >= 5) {
      const firstFive = entry.s.slice(0, 5);
      firstFive.push(memory[key]);
      data[i].s = firstFive;
      data[i].stemRebooted = true;
      healedCount++;
    }
  }
  if (healedCount > 0) Logger.log(`Memory heal: restored ${healedCount} cached makerspace projects.`);

  let processedCount = 0;
  const BATCH_LIMIT = 4;
  let needsSync = false;
  let rebootedThisRun = 0;

  for (let i = 0; i < data.length; i++) {
    const planner = data[i];
    if (!planner.audited || !planner.s || planner.s.length < 5) continue;
    if (planner.stemRebooted === true) continue;

    if (filterCa && planner.ca !== filterCa) continue;
    if (filterYl && planner.yl !== filterYl) continue;
    if (themeNeedle && !String(planner.th).toLowerCase().includes(themeNeedle)) continue;
    if (processedCount >= BATCH_LIMIT) break;

    Logger.log(`Rebooting Makerspace: [${planner.ca}] ${planner.yl} — ${planner.th}`);

    const existingTools = planner.s.slice(0, 5).map(s => s.t).join(', ');

    // Diversity: collect makerspace project titles already used for this year level
    const usedStemProjects = data
      .filter(p => p.yl === planner.yl && p.stemRebooted && p.s && p.s.length >= 6)
      .map(p => `"${p.s[5].t}"`)
      .join(', ');

    const diversityRule = usedStemProjects
      ? `\n5. DIVERSITY RULE: You have ALREADY assigned the following Makerspace projects to ${planner.yl} for other units: ${usedStemProjects}. You MUST NOT repeat these concepts. Invent a completely new, distinct project.`
      : '';

    const yearGuidance = (() => {
      if (/kinder/i.test(planner.yl)) {
        return 'KINDER GUIDANCE: 3-4 year olds. Use simple, sensory, play-based building. Materials must be soft, safe, and tactile (paper plates, fabric scraps, cotton wool, finger paint, large blocks). No hot glue guns, no sharp tools — use sticky tape and child-safe glue sticks. Activities must be heavily teacher-supported.';
      }
      const yr = parseInt(String(planner.yl).replace(/\D/g, ''), 10) || 0;
      if (planner.yl === 'Prep' || yr <= 2) return 'EARLY YEARS GUIDANCE: Prep-Year 2 — keep tools simple. Avoid hot glue guns; prefer tape, child-safe glue, scissors with adult support.';
      if (yr <= 4) return 'MID PRIMARY GUIDANCE: Year 3-4 — full prototyping kit available including hot glue guns with supervision.';
      return 'UPPER PRIMARY GUIDANCE: Year 5-6 — full prototyping kit including hot glue guns, soldering with supervision, complex multi-stage builds.';
    })();

    const prompt = `You are a STEM Makerspace Coordinator at Wesley College.
We are replacing the 6th suggestion (the Makerspace/STEM project) for this unit to make it far more creative, hands-on, and memorable.
Campus: ${planner.ca} | Year: ${planner.yl} | Theme: "${planner.th}"
Unit summary: ${planner.plannerText || planner.plannerContextRich || ''}

Digital tools already used in suggestions 1-5 (DO NOT REUSE THESE): ${existingTools}

RULES:
1. Generate exactly ONE highly innovative, hands-on Makerspace project utilising the Design Cycle.
2. CATCHY TITLE (HARD RULE): The "t" field MUST be a catchy, descriptive project name — not just a tool name. Examples: "Recycled Cardboard Galaxy Cities", "The Great Bee-Bot Migration Maze", "Mini Volcano Engineers", "Paper Plate Planet Parade". The title should excite a child and hint at what they'll build.
3. HYBRID MAKERSPACE (TECH + PHYSICAL): You may suggest age-appropriate digital tools or robotics (e.g., Bee-Bots, iPads, Sphero Indi), but they MUST be deeply integrated with physical crafting and building. Do NOT just suggest using tech by itself.
4. TANGIBLE BUILDING: You MUST explicitly feature physical prototyping materials (e.g., cardboard, popsticks, recycled materials, clay, fabric scraps, foil, paper plates). For example: instead of "Program a Bee-Bot," suggest "Design and build a 3D recycled cardboard city for the Bee-Bot to navigate."
5. DESCRIPTION: 3-4 sentences. Describe what students build, what materials they use, and how it connects to the unit theme "${planner.th}".
6. Use standard straight apostrophes (').${diversityRule}

${yearGuidance}

Return ONLY JSON in this exact format:
{"t": "Catchy Project Name", "d": "Specific 3-4 sentence description for this unit."}`;

    const payload = {
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 1024
    };

    try {
      const response = UrlFetchApp.fetch(OPENAI_ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + getOpenAIKey_() },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const code = response.getResponseCode();
      if (isRetriableHttpCode_(code)) {
        if (code === 429) setCooldown_(2, 'OpenAI rate limit during makerspace reboot');
        Utilities.sleep(15000);
        continue;
      }
      if (code !== 200) {
        Logger.log(`HTTP ${code} for ${planner.th}: ${response.getContentText().slice(0, 300)}`);
        continue;
      }

      const json = JSON.parse(response.getContentText());
      let text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (!text) continue;
      text = text.replace(/[\u2018\u2019\u0060\u00B4]/g, "'").replace(/[\u201C\u201D]/g, '"');
      let parsed;
      try {
        parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      } catch (e) {
        Logger.log(`JSON parse failed for ${planner.th}`);
        continue;
      }

      if (parsed && parsed.t && parsed.d) {
        const firstFive = planner.s.slice(0, 5);
        const newProject = { t: parsed.t, d: parsed.d };
        firstFive.push(newProject);
        data[i].s = firstFive;
        data[i].stemRebooted = true;
        // Suggestion 6 just changed under any human-verified badge — drop it
        // so reviewers re-check the new makerspace project.
        clearHumanVerifiedFlags_(data[i], 'Makerspace project rebooted');

        // Save to script-property memory so Drive cache hiccups can be healed
        const key = `${planner.ca}_${planner.yl}_${planner.th}`;
        memory[key] = newProject;

        needsSync = true;
        processedCount++;
        rebootedThisRun++;
        Logger.log(`Rebooted: ${planner.th} -> "${parsed.t}"`);
      }
    } catch (e) {
      Logger.log(`Error rebooting ${planner.th}: ${e.toString()}`);
    }
  }

  if (needsSync || healedCount > 0) {
    props.setProperty('MAKERSPACE_MEMORY', JSON.stringify(memory));
    file.setContent(JSON.stringify(data, null, 2));
    Logger.log(`Saved updates. ${rebootedThisRun} new reboots, ${healedCount} healed from memory.`);
    if (typeof pushToGitHub === 'function') pushToGitHub();
  }

  // Count remaining
  const remaining = data.filter(p => p.audited && p.s && p.s.length >= 5 && !p.stemRebooted
    && (!filterCa || p.ca === filterCa) && (!filterYl || p.yl === filterYl)
    && (!themeNeedle || String(p.th).toLowerCase().includes(themeNeedle))).length;

  return {
    message: rebootedThisRun > 0
      ? `Rebooted ${rebootedThisRun} makerspace project${rebootedThisRun !== 1 ? 's' : ''} (${remaining} remaining)`
      : (remaining === 0 ? 'All makerspace projects already rebooted' : 'No reboots this batch'),
    rebooted: rebootedThisRun,
    healed: healedCount,
    remaining: remaining
  };
}

function resetMakerspaceFlags(filterCa, filterYl) {
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  let data = JSON.parse(file.getBlob().getDataAsString());
  let count = 0;

  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    if (filterCa && entry.ca !== filterCa) continue;
    if (filterYl && entry.yl !== filterYl) continue;
    if (entry.stemRebooted) {
      data[i].stemRebooted = false;
      count++;
    }
  }

  // Also clear the script-property memory for this scope
  const props = PropertiesService.getScriptProperties();
  let memoryString = props.getProperty('MAKERSPACE_MEMORY');
  if (memoryString) {
    let memory = JSON.parse(memoryString);
    Object.keys(memory).forEach(k => {
      const parts = k.split('_');
      const ca = parts[0], yl = parts[1];
      if ((!filterCa || ca === filterCa) && (!filterYl || yl === filterYl)) delete memory[k];
    });
    props.setProperty('MAKERSPACE_MEMORY', JSON.stringify(memory));
  }

  file.setContent(JSON.stringify(data, null, 2));
  Logger.log(`Reset stemRebooted flag on ${count} entries.`);
  return { message: `Reset ${count} flags. Run Reboot Makerspace next.`, reset: count };
}

// 2026-05-20: Free scan-and-restore. Walks every entry, and for any unit
// where MAKERSPACE_MEMORY has a cached catchy project AND the current s[5]
// doesn't match it, restores from memory. Catches drift the existing
// rebootMakerspace heal misses (which only fires for !stemRebooted). Zero
// OpenAI calls — safe to run on a frequent trigger.
function healMakerspaceFromMemory() {
  const props = PropertiesService.getScriptProperties();
  const memString = props.getProperty('MAKERSPACE_MEMORY');
  if (!memString) {
    Logger.log('No MAKERSPACE_MEMORY — nothing to heal.');
    return { healed: 0, message: 'No MAKERSPACE_MEMORY — nothing to heal.', units: [] };
  }
  const memory = JSON.parse(memString);

  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const data = JSON.parse(file.getBlob().getDataAsString());
  let healed = 0;
  const healedSummary = [];

  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    if (!entry.s || entry.s.length < 5) continue;
    const key = `${entry.ca}_${entry.yl}_${entry.th}`;
    const cached = memory[key];
    if (!cached || !cached.t || !cached.d) continue;

    const current = entry.s[5];
    if (current && current.t === cached.t && current.d === cached.d) continue;

    const firstFive = entry.s.slice(0, 5);
    firstFive.push({ t: cached.t, d: cached.d });
    data[i].s = firstFive;
    data[i].stemRebooted = true;
    healed++;
    healedSummary.push(`[${entry.ca}] ${entry.yl} — ${entry.th} -> "${cached.t}"`);
  }

  if (healed > 0) {
    file.setContent(JSON.stringify(data, null, 2));
    Logger.log(`Healed ${healed} Makerspace suggestion(s) from memory:`);
    healedSummary.forEach(l => Logger.log('  ' + l));
    if (typeof pushToGitHub === 'function') pushToGitHub();
  } else {
    Logger.log('No Makerspace drift detected — nothing to heal.');
  }

  return { healed: healed, message: `Healed ${healed} Makerspace project${healed !== 1 ? 's' : ''} from memory.`, units: healedSummary };
}

// Idempotent: installs a daily 4am trigger that runs healMakerspaceFromMemory.
// Removes any existing heal trigger first so repeat runs don't pile up.
function installMakerspaceHealTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'healMakerspaceFromMemory') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('healMakerspaceFromMemory').timeBased().everyDays(1).atHour(4).create();
  Logger.log('Installed daily Makerspace heal trigger at 4am.');
  return { message: 'Daily Makerspace heal trigger installed at 4am.' };
}

// 2026-05-20: Now an INCREMENTAL improver, not a full wipe. Heals any
// clobbered units from memory (free) and then installs a 10-minute trigger
// that generates catchy Makerspace projects only for units that have NEVER
// been rebooted (audited && !stemRebooted). Already-improved units are left
// untouched — no MAKERSPACE_MEMORY wipe, no flag reset. Trigger self-deletes
// when nothing remains. Suggestions 1-5 are never touched.
// To force a full regenerate from scratch, call resetMakerspaceFlags() first.
function kickoffFullMakerspaceReboot() {
  Logger.log('=== KICKOFF: improve old Makerspace versions ===');
  PropertiesService.getScriptProperties().deleteProperty('DLA_RESUME_TIME');

  // 1. Free heal pass: restore any drifted projects from memory
  const healResult = healMakerspaceFromMemory();
  Logger.log('Heal: ' + JSON.stringify({ healed: healResult.healed }));

  // 2. Remove any existing tick triggers so we don't double up
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'makerspaceRebootTick') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('makerspaceRebootTick').timeBased().everyMinutes(10).create();
  Logger.log('Trigger installed: makerspaceRebootTick every 10 minutes.');

  // 3. Run one tick immediately so progress is visible without waiting
  makerspaceRebootTick();
  return {
    message: `Kicked off. Healed ${healResult.healed} from memory; trigger will generate catchy versions for any un-rebooted units (4 per 10 min).`,
    healed: healResult.healed
  };
}

function makerspaceRebootTick() {
  const result = rebootMakerspace();
  Logger.log('Tick: ' + JSON.stringify(result));
  if (result && result.remaining === 0) {
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === 'makerspaceRebootTick') ScriptApp.deleteTrigger(t);
    });
    Logger.log('All makerspace projects rebooted. Trigger removed.');
  }
}

function rebootAndSync() {
  const result = rebootMakerspace();
  Logger.log(JSON.stringify(result));
  return result;
}

// 2026-05-18: One-click full App Smash recovery. Flags every audited unit
// whose first-5 digital suggestions have fewer than 2 App Smashes ("+" in
// the title), then installs a 10-minute trigger that processes batches via
// auditPlanners (which now enforces the v5.19 2+ App Smash rule). The
// trigger self-deletes when there are no flagged units left to re-audit.
// Click Run on this function once and walk away — the whole catalogue gets
// rebuilt with multi-tool combos.
function kickoffFullAppSmashRecovery() {
  Logger.log('=== KICKOFF: full App Smash recovery ===');
  PropertiesService.getScriptProperties().deleteProperty('DLA_RESUME_TIME');

  // Flag the work
  const flagResult = flagUnitsMissingAppSmashes();
  Logger.log('Flagged: ' + JSON.stringify({ flagged: flagResult.flagged }));

  if (flagResult.flagged === 0) {
    Logger.log('Nothing to recover — every audited unit already has 2+ App Smashes.');
    return { message: 'No units needed flagging.', flagged: 0 };
  }

  // Park the original ids of flagged units in script properties so the tick
  // function knows when it's done (vs. picking up unrelated unaudited units).
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const data = JSON.parse(file.getBlob().getDataAsString());
  const targetKeys = data
    .filter(e => e.audited === false && Array.isArray(e.s) && e.s.length === 0)
    .map(e => `${e.ca}|${e.yl}|${e.th}`);
  PropertiesService.getScriptProperties().setProperty(
    'DLA_APP_SMASH_RECOVERY_TARGETS',
    JSON.stringify(targetKeys)
  );
  Logger.log(`Parked ${targetKeys.length} target keys for the recovery run.`);

  // Remove any existing tick triggers so we don't double up
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'appSmashRecoveryTick') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('appSmashRecoveryTick').timeBased().everyMinutes(10).create();
  Logger.log('Trigger installed: appSmashRecoveryTick every 10 minutes.');

  // Run one tick immediately so the user sees progress without waiting 10 min
  appSmashRecoveryTick();
  return {
    message: `Kicked off. ${flagResult.flagged} units flagged; first batch running now, trigger will continue every 10 min until done.`,
    flagged: flagResult.flagged
  };
}

function appSmashRecoveryTick() {
  const props = PropertiesService.getScriptProperties();

  // Respect any quota cooldown set by OpenAI rate-limit handling
  const resumeTime = props.getProperty('DLA_RESUME_TIME');
  if (resumeTime && Date.now() < parseInt(resumeTime)) {
    Logger.log(`appSmashRecoveryTick: cooldown active until ${new Date(parseInt(resumeTime)).toLocaleString('en-AU')} — skipping this tick.`);
    return;
  }

  // Process the next batch (auditPlanners has BATCH_LIMIT=5 baked in)
  auditPlanners();

  // Push updated data.json so the public site sees the new App Smashes as they land
  try {
    if (typeof pushToGitHub === 'function') pushToGitHub();
  } catch (e) {
    Logger.log('appSmashRecoveryTick: pushToGitHub failed: ' + e.toString());
  }

  // Are any of the originally-flagged units still un-audited?
  const targetsRaw = props.getProperty('DLA_APP_SMASH_RECOVERY_TARGETS');
  if (!targetsRaw) {
    // No target list parked — treat as done
    cleanupAppSmashRecoveryTrigger_('No target list found');
    return;
  }

  let targets;
  try { targets = JSON.parse(targetsRaw); } catch (e) { targets = []; }
  const targetSet = new Set(targets);

  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const data = JSON.parse(file.getBlob().getDataAsString());
  const remaining = data.filter(e => {
    const key = `${e.ca}|${e.yl}|${e.th}`;
    return targetSet.has(key) && e.audited !== true;
  });

  Logger.log(`appSmashRecoveryTick: ${remaining.length} flagged unit(s) still need audit.`);

  if (remaining.length === 0) {
    cleanupAppSmashRecoveryTrigger_(`All ${targets.length} flagged units recovered`);
  }
}

function cleanupAppSmashRecoveryTrigger_(reason) {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'appSmashRecoveryTick') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty('DLA_APP_SMASH_RECOVERY_TARGETS');
  Logger.log(`App Smash recovery complete: ${reason}. Trigger removed.`);
}


// ==========================================
// PLANNER MARKDOWN — PUA GLYPH CLEANUP
// ==========================================
// The WiSE PDF-export pipeline drops Unicode Private Use Area characters
// (U+E000–U+F8FF) into the .md planner files. They render as `?` or `□` in
// most viewers and confuse the audit prompt. Two helpers below:
//
//   scanPlannerPUAGlyphs()   — dry run; prints per-file counts, makes no edits
//   cleanPlannerPUAGlyphs()  — DESTRUCTIVE; overwrites each .md file in Drive
//                              with the PUA chars stripped. Run scan first.
//
// Both walk PLANNERS_FOLDER_ID. Run from the Apps Script editor.

// Unicode Private Use Area block. Apps Script runs V8 so \u escapes
// in regex character classes work (these are BMP code units).
const PUA_GLYPH_RE_ = /[\uE000-\uF8FF]/g;

function scanPlannerPUAGlyphs() {
  const folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);
  const iter = folder.getFiles();
  const report = [];
  let totalFiles = 0, totalDirty = 0, totalGlyphs = 0;
  while (iter.hasNext()) {
    const f = iter.next();
    if (!/\.md$/i.test(f.getName())) continue;
    totalFiles++;
    const text = f.getBlob().getDataAsString();
    const matches = text.match(PUA_GLYPH_RE_) || [];
    if (!matches.length) continue;
    totalDirty++;
    totalGlyphs += matches.length;
    report.push({ name: f.getName(), count: matches.length });
  }
  report.sort((a, b) => b.count - a.count);
  Logger.log(`Scanned ${totalFiles} .md file(s); ${totalDirty} contain PUA glyphs (${totalGlyphs} total).`);
  report.forEach(r => Logger.log(`  ${r.count.toString().padStart(4)}  ${r.name}`));
  if (!totalDirty) Logger.log('No PUA glyphs detected — nothing to clean.');
  return { scanned: totalFiles, dirty: totalDirty, totalGlyphs: totalGlyphs, files: report };
}

function cleanPlannerPUAGlyphs() {
  const folder = DriveApp.getFolderById(PLANNERS_FOLDER_ID);
  const iter = folder.getFiles();
  const report = [];
  let totalFiles = 0, totalCleaned = 0, totalGlyphsStripped = 0;
  while (iter.hasNext()) {
    const f = iter.next();
    if (!/\.md$/i.test(f.getName())) continue;
    totalFiles++;
    const text = f.getBlob().getDataAsString();
    const matches = text.match(PUA_GLYPH_RE_) || [];
    if (!matches.length) continue;
    // Strip (don't replace with space) — the glyphs were standalone icons,
    // not text substitutes; surrounding whitespace is already present in the
    // PDF-export output.
    const cleaned = text.replace(PUA_GLYPH_RE_, '');
    f.setContent(cleaned);
    totalCleaned++;
    totalGlyphsStripped += matches.length;
    report.push({ name: f.getName(), stripped: matches.length });
    Logger.log(`Cleaned ${matches.length} PUA glyph(s) from ${f.getName()}`);
  }
  Logger.log(`Scanned ${totalFiles} .md file(s); cleaned ${totalCleaned} (${totalGlyphsStripped} glyphs stripped).`);
  if (!totalCleaned) Logger.log('Nothing to clean — every .md file is already PUA-free.');
  return { scanned: totalFiles, cleaned: totalCleaned, stripped: totalGlyphsStripped, files: report };
}


// ==========================================================================
// 2026-05-25: regenerateForDiversity
// Repairs the corpus-wide tool-monoculture identified on 2026-05-25 (6/6 GW
// Year 4 units opening with "Padlet + iMovie" and matching patterns across
// every Y3-6 group + early-years Seesaw collapse). The prevention fix in the
// Studio-side js files (commit db748e1) stops new regens from re-introducing
// the bias, but doesn't repair the historical data — this function does.
//
// Run from the Apps Script editor:
//   regenerateForDiversityDryRun()  — lists affected groups + units, no API calls
//   regenerateForDiversity()        — regenerates every affected unit; default
//                                     batch is 25/run to stay under the
//                                     30-min Apps Script execution cap. Re-run
//                                     until the dry-run reports 0 affected.
//   regenerateForDiversity({ batch: 10, ca: 'Glen Waverley', yl: 'Year 4' })
//                                   — scoped + smaller batch for a single
//                                     campus+year smoke test.
//
// "Bias cluster" = a campus+year group where any single tool key appears in
// 3+ slot-1 positions, in 3+ slot-2 positions, or where any tool component
// (after splitting "Tool A + Tool B" pairs) is used in 4+ unit-slots across
// the group. Every unit in such a group is regenerated so the model gets a
// clean slate to diversify, not just the offending units.
// ==========================================================================
const DIVERSITY_OPENER_DUP_THRESHOLD = 3;
const DIVERSITY_COMPONENT_DUP_THRESHOLD = 4;
const DIVERSITY_DEFAULT_BATCH = 25;

function diversitySlotTool_(unit, slotIdx) {
  if (!unit || !Array.isArray(unit.s)) return '';
  const s = unit.s[slotIdx];
  return s && typeof s.t === 'string' ? s.t.trim() : '';
}

function diversityToolComponents_(tool) {
  if (!tool || typeof tool !== 'string') return [];
  return tool.split(/\s*\+\s*/).map(p => p.trim()).filter(Boolean);
}

function diversityToolKey_(tool) {
  return String(tool || '').toLowerCase().trim();
}

function diversityGroupKey_(unit) {
  return (unit && (unit.ca || '') + '||' + (unit.yl || '')) || '';
}

function diversityFindAffectedUnits_(data) {
  if (!Array.isArray(data)) return { groups: {}, affectedIdx: [] };
  const groups = {};
  data.forEach((unit, idx) => {
    if (!unit || !unit.ca || !unit.yl) return;
    const k = diversityGroupKey_(unit);
    (groups[k] = groups[k] || { ca: unit.ca, yl: unit.yl, units: [] }).units.push({ unit: unit, idx: idx });
  });

  const affectedSet = {};
  Object.keys(groups).forEach(k => {
    const g = groups[k];
    if (g.units.length < DIVERSITY_OPENER_DUP_THRESHOLD) return;

    // Slot-0 and slot-1 clusters
    const slotClusters = [{}, {}];
    g.units.forEach(({ unit, idx }) => {
      for (let slot = 0; slot < 2; slot++) {
        const t = diversityToolKey_(diversitySlotTool_(unit, slot));
        if (!t) continue;
        (slotClusters[slot][t] = slotClusters[slot][t] || []).push(idx);
      }
    });
    [0, 1].forEach(slot => {
      Object.keys(slotClusters[slot]).forEach(toolKey => {
        if (slotClusters[slot][toolKey].length >= DIVERSITY_OPENER_DUP_THRESHOLD) {
          // Every unit in this group becomes a regen target — even the ones
          // that already differ, because their differing choice still has
          // to dodge the now-larger sibling-tool footprint we'll re-pick.
          g.units.forEach(({ idx }) => { affectedSet[idx] = true; });
        }
      });
    });

    // Component-level overuse across slots 1-5 (covers app-smashes like
    // "Padlet + Canva" and "Padlet + iMovie" both contributing to Padlet's
    // count, even if neither slot-0 nor slot-1 clusters tripped).
    const componentCounts = {};
    g.units.forEach(({ unit }) => {
      for (let slot = 0; slot < 5; slot++) {
        const tool = diversitySlotTool_(unit, slot);
        if (!tool) continue;
        diversityToolComponents_(tool).forEach(c => {
          const ck = diversityToolKey_(c);
          if (!ck) return;
          componentCounts[ck] = (componentCounts[ck] || 0) + 1;
        });
      }
    });
    const overused = Object.keys(componentCounts).filter(c => componentCounts[c] >= DIVERSITY_COMPONENT_DUP_THRESHOLD);
    if (overused.length) {
      g.units.forEach(({ idx }) => { affectedSet[idx] = true; });
    }
  });

  return { groups: groups, affectedIdx: Object.keys(affectedSet).map(n => parseInt(n, 10)).sort((a, b) => a - b) };
}

function diversitySiblingToolFootprint_(data, targetIdx) {
  if (!Array.isArray(data) || !data[targetIdx]) return { overused: [], underused: [], allUsed: [] };
  const target = data[targetIdx];
  const ca = target.ca || '';
  const yl = target.yl || '';

  const componentCounts = {};
  data.forEach((unit, idx) => {
    if (idx === targetIdx) return;
    if (!unit || unit.ca !== ca || unit.yl !== yl) return;
    for (let slot = 0; slot < 5; slot++) {
      const tool = diversitySlotTool_(unit, slot);
      if (!tool) continue;
      diversityToolComponents_(tool).forEach(c => {
        const ck = diversityToolKey_(c);
        if (!ck) return;
        if (!componentCounts[ck]) componentCounts[ck] = { label: c, count: 0 };
        componentCounts[ck].count++;
      });
    }
  });

  const entries = Object.values(componentCounts).sort((a, b) => b.count - a.count);
  const overused = entries.filter(e => e.count >= 2).map(e => `${e.label} (used ${e.count}x)`);
  const allUsed = entries.map(e => e.label);
  return { overused: overused, allUsed: allUsed };
}

function diversityYearRule_(yl) {
  const upperPrimary = ['Year 4', 'Year 5', 'Year 6'];
  const midPrimary = ['Year 3'];
  const kinder = ['3 Year Old Kinder', '4 Year Old Kinder'];
  if (kinder.indexOf(yl) !== -1) {
    return 'Kindergarten (' + yl + '): VERY simple, play-based, teacher-guided. Use only: Bee-Bots, Sphero Indi, ScratchJR, ChatterPix Kids, Puppet Pals, PicCollage, Seesaw, Book Creator, Brushes Redux, Freeform, Epic, Animating a Character with Adobe Express. Maximise diversity — 6 different tools.';
  }
  if (upperPrimary.indexOf(yl) !== -1) {
    return 'Upper primary (Year 4-6): Wide tool pool. Canva, Book Creator, Padlet, Delightex, Adobe Express, Animating a Character with Adobe Express, M365 (Word/Excel/Forms), Minecraft Education, Lego Spike Prime, CoDrone EDU, Micro:bit, and all general tools are appropriate. Maximise diversity — 6 different tools.';
  }
  if (midPrimary.indexOf(yl) !== -1) {
    return 'Mid primary (Year 3): Canva, Book Creator, Delightex, Adobe Express, Animating a Character with Adobe Express, Padlet, Sphero BOLT, Micro:bit, Stop Motion Studio, Scratch, Kahoot, Explain Everything, plus general tools. Maximise diversity — 6 different tools.';
  }
  if (yl === 'Year 2') {
    return 'Early years (Year 2): DIVERSE mix from Prep-Year 2 pool: Seesaw, Book Creator, Delightex, Bee-Bots, Sphero Indi, ScratchJR, ChatterPix Kids, Puppet Pals, PicCollage, GarageBand, iMovie, Merge Cubes, Makey Makey, Brushes Redux, Freeform, Sketchbook, Epic, Word Clouds ABCya, Animating a Character with Adobe Express. NO Canva, Padlet, general Adobe Express editor, Minecraft, or Year 3+ tool. Maximise diversity — 6 different tools.';
  }
  return 'Early years (Prep-Year 1): DIVERSE mix from Prep-Year 1 pool: Seesaw, Book Creator, Delightex, Bee-Bots, Sphero Indi, ScratchJR, ChatterPix Kids, Puppet Pals, PicCollage, GarageBand, iMovie, Merge Cubes, Makey Makey, Brushes Redux, Freeform, Sketchbook, Epic, Word Clouds ABCya, Animating a Character with Adobe Express. NO Canva, Padlet, general Adobe Express editor, Minecraft, Sphero BOLT, or Year 3+ tool. Maximise diversity — 6 different tools.';
}

function diversityBuildPrompt_(data, targetIdx, approvedToolsPrompt) {
  const target = data[targetIdx];
  const footprint = diversitySiblingToolFootprint_(data, targetIdx);
  const overusedLine = footprint.overused.length
    ? '\n- DO NOT REUSE these tools that are already heavily used by sibling units in this campus + year level (avoid adding to the over-used pile unless absolutely necessary for THIS unit\'s theme): ' + footprint.overused.join(', ') + '.'
    : '';
  const allUsedLine = footprint.allUsed.length
    ? '\n- For context, every tool currently used by ANY sibling unit in this campus + year level: ' + footprint.allUsed.join(', ') + '. Reach for tools NOT on this list first when they suit the theme; only repeat from this list when the alternative would be a poor pedagogical fit.'
    : '';

  return 'You are a Digital Learning Coach. Regenerate the 6 digital technology suggestions for this IB PYP unit, optimising for CORPUS-WIDE TOOL VARIETY across the year level.\n\n' +
    'Campus: ' + target.ca + ' | Year Level: ' + target.yl + ' | Theme: "' + target.th + '"' +
    (target.ci ? '\nCentral Idea: "' + target.ci + '"' : '') +
    (target.lo ? '\nLines of Inquiry: "' + target.lo + '"' : '') +
    (target.plannerText ? '\nPlanner context: ' + String(target.plannerText).slice(0, 4000) : '') + '\n\n' +
    'STRUCTURE: Return exactly 6 suggestions.\n' +
    '- Suggestions 1-5: Digital technology integrations. At LEAST 2 must be an App Smash ("Tool A + Tool B").\n' +
    '- Suggestion 6: A Makerspace/STEM project (Physical-First focus, cardboard/circuitry, 3-4 sentence description).\n\n' +
    'NO DUPLICATE TOOLS within this unit (HARD RULE): each of the 6 suggestions uses a DIFFERENT primary tool. App Smash components count — if slot 1 is "Padlet + iMovie", neither Padlet nor iMovie may appear in slots 2-6.\n\n' +
    'APP SMASH FORMAT: "Tool 1 + Tool 2" with a literal + sign. The description must explain how BOTH tools are used together.\n\n' +
    'DIVERSITY CONSTRAINTS FOR THIS UNIT (the reason you\'re being asked to regenerate):' + overusedLine + allUsedLine + '\n' +
    '- VARY YOUR OPENER — slot 1 should specifically suit THIS unit\'s theme; do not default to one canonical App Smash pair.\n' +
    '- If multiple tools fit equally well, pick the one that\'s LEAST used in the year level.\n\n' +
    approvedToolsPrompt + '\n' + REALISTIC_TOOL_USE_RULES + '\n\n' +
    'YEAR LEVEL GUIDANCE FOR ' + target.yl + ':\n' + diversityYearRule_(target.yl) + '\n\n' +
    'Return ONLY a valid JSON object (no markdown, no backticks). Use straight apostrophes (\'). Schema:\n' +
    '{ "s": [ { "t": "Tool Name or Tool A + Tool B", "d": "3-4 sentence description tailored to THIS unit." }, ... 6 items ] }';
}

function diversityValidateSugs_(sugs, target, data, targetIdx) {
  if (!Array.isArray(sugs) || sugs.length !== 6) return { ok: false, reason: 'expected 6 suggestions, got ' + (Array.isArray(sugs) ? sugs.length : 'non-array') };
  // Component-level dedup within the unit
  const seen = {};
  for (let i = 0; i < sugs.length; i++) {
    const sg = sugs[i];
    if (!sg || !sg.t || !sg.d) return { ok: false, reason: 'slot ' + (i + 1) + ' missing t/d' };
    const comps = diversityToolComponents_(sg.t);
    for (let j = 0; j < comps.length; j++) {
      const ck = diversityToolKey_(comps[j]);
      if (seen[ck]) return { ok: false, reason: 'duplicate tool component "' + comps[j] + '" across slots' };
      seen[ck] = true;
    }
  }
  // >=2 App Smashes in slots 1-5
  const smashCount = sugs.slice(0, 5).filter(sg => /\+/.test(sg.t)).length;
  if (smashCount < 2) return { ok: false, reason: 'only ' + smashCount + ' App Smash(es) in slots 1-5 (need >=2)' };
  // Opener must not match a sibling opener
  const opener = diversityToolKey_(sugs[0].t);
  if (data && Array.isArray(data)) {
    const ca = target.ca, yl = target.yl;
    for (let k = 0; k < data.length; k++) {
      if (k === targetIdx) continue;
      const u = data[k];
      if (!u || u.ca !== ca || u.yl !== yl) continue;
      if (diversityToolKey_(diversitySlotTool_(u, 0)) === opener) return { ok: false, reason: 'opener "' + sugs[0].t + '" matches sibling unit "' + (u.th || '') + '"' };
    }
  }
  return { ok: true };
}

function diversityCallOnce_(prompt) {
  const payload = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.4,
    max_tokens: 4096
  };
  const response = UrlFetchApp.fetch(OPENAI_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getOpenAIKey_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code === 429) { setCooldown_(2, 'OpenAI rate limit during diversity regen'); return { retriable: true, error: 'HTTP 429' }; }
  if (isRetriableHttpCode_(code)) return { retriable: true, error: 'HTTP ' + code };
  if (code !== 200) return { retriable: false, error: 'HTTP ' + code + ': ' + response.getContentText().slice(0, 200) };
  let rawText;
  try {
    const parsed = JSON.parse(response.getContentText());
    rawText = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
  } catch (e) { return { retriable: false, error: 'malformed OpenAI envelope' }; }
  if (!rawText) return { retriable: false, error: 'empty content' };
  let clean = rawText.replace(/```json|```/g, '').trim();
  clean = clean.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"');
  try {
    const obj = JSON.parse(clean);
    return { ok: true, sugs: Array.isArray(obj.s) ? obj.s : [] };
  } catch (e) { return { retriable: true, error: 'JSON parse: ' + e.message }; }
}

function regenerateForDiversityDryRun(opts) {
  opts = opts || {};
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const data = JSON.parse(file.getBlob().getDataAsString());
  const arr = Array.isArray(data) ? data : Object.values(data).filter(u => u && typeof u === 'object');
  const { groups, affectedIdx } = diversityFindAffectedUnits_(arr);
  let candidates = affectedIdx;
  if (opts.ca) candidates = candidates.filter(i => arr[i] && arr[i].ca === opts.ca);
  if (opts.yl) candidates = candidates.filter(i => arr[i] && arr[i].yl === opts.yl);
  const summary = {};
  candidates.forEach(i => {
    const u = arr[i];
    const gk = diversityGroupKey_(u);
    (summary[gk] = summary[gk] || { ca: u.ca, yl: u.yl, count: 0, sample: [] });
    summary[gk].count++;
    if (summary[gk].sample.length < 3) summary[gk].sample.push(u.th + ' (s[0]=' + diversitySlotTool_(u, 0) + ')');
  });
  Logger.log('--- regenerateForDiversity DRY RUN ---');
  Logger.log('Total groups: ' + Object.keys(groups).length + ' | Affected units in scope: ' + candidates.length);
  Object.keys(summary).sort().forEach(k => {
    const s = summary[k];
    Logger.log('  ' + s.ca + ' / ' + s.yl + ': ' + s.count + ' unit(s) — e.g. ' + s.sample.join('; '));
  });
  Logger.log('Run regenerateForDiversity(' + (opts.ca || opts.yl ? JSON.stringify(opts) : '') + ') to execute (default batch ' + DIVERSITY_DEFAULT_BATCH + ').');
  return { totalGroups: Object.keys(groups).length, affectedInScope: candidates.length, summary: summary };
}

function regenerateForDiversity(opts) {
  opts = opts || {};
  const batch = Number.isFinite(opts.batch) ? Math.max(1, Math.min(50, Number(opts.batch))) : DIVERSITY_DEFAULT_BATCH;

  // Wait up to 2 min for the script lock so we queue politely behind
  // auditPlanners / auditAndSync runs instead of bailing instantly. Both
  // those functions hold the script-wide LockService while making OpenAI
  // calls and write the same data[i].s field we touch, so they DO race.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) { Logger.log('regenerateForDiversity: lock still held after 2 min wait — bailing.'); return { skipped: true, reason: 'lock-held' }; }

  try {
    const props = PropertiesService.getScriptProperties();
    const resumeTime = props.getProperty('DLA_RESUME_TIME');
    if (resumeTime && Date.now() < parseInt(resumeTime, 10)) {
      const until = new Date(parseInt(resumeTime, 10)).toLocaleString('en-AU');
      Logger.log('Cooldown active until ' + until + ' — bailing.');
      return { skipped: true, reason: 'cooldown', until: until };
    }

    const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
    let raw = JSON.parse(file.getBlob().getDataAsString());
    const isArr = Array.isArray(raw);
    const data = isArr ? raw : Object.values(raw).filter(u => u && typeof u === 'object');

    let dataDirty = false;

    // Backfill protection for units regenerated by earlier runs of this
    // function. Pre-2026-05-25 the function set audited=false, which left
    // those units exposed to the auditAndSync / appSmashRecoveryTick
    // triggers re-auditing them with a non-sibling-aware prompt and
    // overwriting the diversity work. Any unit with diversityRegenAt set
    // should be audited=true to be safe.
    let backfilled = 0;
    for (let k = 0; k < data.length; k++) {
      if (data[k] && data[k].diversityRegenAt && data[k].audited !== true) {
        data[k].audited = true;
        backfilled++;
      }
    }
    if (backfilled) { Logger.log('regenerateForDiversity: backfilled audited=true on ' + backfilled + ' previously-regenerated unit(s).'); dataDirty = true; }

    const { affectedIdx } = diversityFindAffectedUnits_(data);
    let candidates = affectedIdx;
    if (opts.ca) candidates = candidates.filter(i => data[i] && data[i].ca === opts.ca);
    if (opts.yl) candidates = candidates.filter(i => data[i] && data[i].yl === opts.yl);

    Logger.log('regenerateForDiversity: ' + candidates.length + ' affected in scope; processing up to ' + batch + ' this run.');
    if (!candidates.length) {
      Logger.log('Nothing to do — corpus is already diverse for this scope.');
      // Still persist the backfill if it happened.
      if (dataDirty) {
        const toWrite = isArr ? data : raw;
        file.setContent(JSON.stringify(toWrite, null, 2));
        try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e) { Logger.log('pushToGitHub after backfill failed: ' + e); }
      }
      return { processed: 0, affected: 0, fixed: 0, failed: 0, backfilled: backfilled };
    }

    const approvedToolsPrompt = getApprovedToolsPrompt_();
    let processed = 0, fixed = 0, failed = 0;
    const failures = [];

    for (let n = 0; n < candidates.length && processed < batch; n++) {
      const idx = candidates[n];
      const target = data[idx];
      processed++;
      // Rebuild the prompt each call so the sibling footprint reflects any
      // units we've already updated this run — diversity is dynamic.
      const prompt = diversityBuildPrompt_(data, idx, approvedToolsPrompt);
      let success = false;
      let lastReason = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        const call = diversityCallOnce_(prompt + (attempt > 1 ? '\n\nRETRY ' + (attempt - 1) + ': Previous attempt failed validation (' + lastReason + '). Apply the diversity constraints more strictly.' : ''));
        if (!call.ok) {
          lastReason = call.error || 'unknown';
          if (call.retriable && attempt < 3) { Utilities.sleep(8000); continue; }
          break;
        }
        const verdict = diversityValidateSugs_(call.sugs, target, data, idx);
        if (!verdict.ok) {
          lastReason = verdict.reason;
          if (attempt < 3) { Utilities.sleep(4000); continue; }
          break;
        }
        // Persist into the in-memory data so the next sibling regen sees the
        // updated footprint. audited=true PROTECTS the diversity work from
        // being overwritten by auditPlanners (run via auditAndSync /
        // appSmashRecoveryTick triggers every 5-10 min, which re-audits any
        // audited!==true unit with a non-sibling-aware prompt). The
        // diversityRegenAt timestamp + cleared humanVerified flags surface
        // these units in the Studio's "needs review" view so a human can
        // confirm the new suggestions without the audit trigger reverting
        // them in the meantime.
        data[idx].s = call.sugs.map(s => ({ t: s.t, d: s.d }));
        data[idx].audited = true;
        data[idx].diversityRegenAt = new Date().toISOString();
        clearHumanVerifiedFlags_(data[idx], 'Regenerated by regenerateForDiversity for corpus-wide tool variety');
        dataDirty = true;
        success = true;
        Logger.log('  [' + (n + 1) + '/' + candidates.length + '] ' + target.ca + ' ' + target.yl + ' — ' + target.th + ' -> s[0]=' + call.sugs[0].t);
        break;
      }
      if (success) fixed++;
      else { failed++; failures.push({ ca: target.ca, yl: target.yl, th: target.th, reason: lastReason }); Logger.log('  [' + (n + 1) + '/' + candidates.length + '] FAILED ' + target.ca + ' ' + target.yl + ' — ' + target.th + ' (' + lastReason + ')'); }
      Utilities.sleep(1500);
    }

    if (dataDirty) {
      const toWrite = isArr ? data : raw;
      if (!isArr) {
        // raw is a {0: unit, 1: unit, ...} object — mutating data[i] mutated
        // the same underlying unit refs since Object.values returned refs.
        // No remap needed, just write raw back.
      }
      file.setContent(JSON.stringify(toWrite, null, 2));
      try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e) { Logger.log('pushToGitHub after diversity regen failed: ' + e); }
    }

    Logger.log('regenerateForDiversity: processed ' + processed + ', fixed ' + fixed + ', failed ' + failed + ', remaining in scope ' + Math.max(0, candidates.length - processed));
    if (failures.length) Logger.log('Failures:\n' + failures.map(f => '  ' + f.ca + ' / ' + f.yl + ' / ' + f.th + ': ' + f.reason).join('\n'));
    return { processed: processed, fixed: fixed, failed: failed, remaining: Math.max(0, candidates.length - processed), failures: failures };
  } finally {
    lock.releaseLock();
  }
}


// ==========================================
// 2026-05-25: BULK "INSPIRING" REGEN
// Rewrites every unit's 6 suggestions in the new 6-sentence inspiring
// style (matches the public suggestTech endpoint introduced same day).
// Reuses every safeguard the diversity-regen path already proved:
//   - LockService (queues behind auditPlanners / auditAndSync)
//   - Cooldown awareness
//   - 3-attempt retry with validator-driven reasons
//   - Component-level tool dedup within a unit
//   - >=2 App Smash floor in slots 1-5
//   - Opener differs from siblings
//   - audited=true + inspiringRegenAt to protect from re-audit overwrite
//   - Per-batch save + pushToGitHub heartbeat
// Adds a one-time Drive snapshot to `data.json.pre_6sentence_<ts>` on
// first run, and treats every unit (not just diversity-affected ones)
// as a target. Skips units already marked inspiringRegenAt so the action
// can be re-invoked safely to resume past the Apps Script 6-min timeout.
// ==========================================

const INSPIRING_BATCH_DEFAULT = 12;
const INSPIRING_SNAPSHOT_PROP = 'INSPIRING_SNAPSHOT_FILE_ID';
const INSPIRING_STARTED_AT_PROP = 'INSPIRING_STARTED_AT';

function inspiringYearRule_(yl) {
  const earlyKinder = ['3 Year Old Kinder', '4 Year Old Kinder'];
  const prep = ['Prep'];
  if (earlyKinder.indexOf(yl) !== -1) {
    return 'EARLY-YEARS HANDS-ON + SCREEN-FREE PRIORITY (' + yl + '): These children are 3-4 years old. EVERY suggestion must be predominantly HANDS-ON, sensory, tactile, dramatic-play, or movement-based. Screen time must be brief, purposeful, and teacher-operated where possible. Prefer SCREEN-FREE tech when it fits the theme: Bee-Bots (physical floor robots — directional buttons, no screen), Cubetto, KIBO, Code-a-pillar, talking pegs, Makey Makey paired with real objects (fruit, foil, playdough), Sphero Indi (colour-tile programming, no app needed for basic play). When a screen tool is genuinely the best fit, the teacher operates the device and children direct what happens (e.g. teacher records audio in ChatterPix Kids while a child speaks; teacher captures children\'s block-tower in Seesaw for a class slideshow). Activities must involve children\'s WHOLE BODIES, real materials they can pick up, role-play, music, or outdoor exploration — never a child silently swiping. Allowed tool pool: Bee-Bots, Sphero Indi, Cubetto, KIBO, Code-a-pillar, Makey Makey, Merge Cubes, ChatterPix Kids, Puppet Pals, PicCollage, Seesaw, Book Creator, Brushes Redux, Freeform, Epic, Animating a Character with Adobe Express. NO Canva, Padlet, Adobe Express general editor, Minecraft, Micro:bit, Sphero BOLT, or any Year 3+ tool.';
  }
  if (prep.indexOf(yl) !== -1) {
    return 'EARLY-YEARS HANDS-ON + SCREEN-FREE PRIORITY (Prep): Prep children are 5 years old and still need predominantly HANDS-ON, multisensory, play-based learning. Open with screen-free or minimal-screen options where they fit the theme: Bee-Bots (physical floor robots — programmed with directional buttons, no app), Cubetto, KIBO, Code-a-pillar, Makey Makey wired to real objects (fruit pianos, foil canvases, playdough switches), Sphero Indi colour-tile pathways laid out on the carpet. When a screen tool genuinely suits the theme, keep screen time brief and pair it with a physical artefact (e.g. a ChatterPix Kids talking-portrait of a hand-drawn animal; a Seesaw photo of a real block tower). At LEAST 2 of the 6 suggestions must be predominantly screen-free or minimal-screen tactile activities. Allowed tool pool: Bee-Bots, Sphero Indi, Cubetto, KIBO, Code-a-pillar, Makey Makey, Merge Cubes, ScratchJR, ChatterPix Kids, Puppet Pals, PicCollage, Seesaw, Book Creator, Brushes Redux, Freeform, Sketchbook, Epic, Word Clouds ABCya, Animating a Character with Adobe Express. NO Canva, Padlet, Adobe Express general editor, Minecraft, Micro:bit, Sphero BOLT, or any Year 3+ tool.';
  }
  // Years 1-6 reuse the diversity year rules verbatim — they\'re already
  // pitched correctly. Only kinder + Prep get the new hands-on overlay.
  return diversityYearRule_(yl);
}

const INSPIRING_DESCRIPTION_RULES = '\nDESCRIPTION STYLE — INSPIRING + INNOVATIVE (the whole point of this regen):\n' +
  'Every description in slots 1-5 must be EXACTLY 6 vivid, classroom-ready sentences. Each sentence has a job:\n' +
  '  Sentence 1: Bold creative premise — what students are actually making, investigating, or experiencing. Name the unit\'s topic explicitly (not "this unit").\n' +
  '  Sentence 2: Connect the activity to one of the unit\'s lines of inquiry or the central idea by NAME (paraphrase if quoting feels stilted; never use banned filler like "connected to the central idea").\n' +
  '  Sentence 3: Reveal an under-considered TWIST — a cross-disciplinary link, a role reversal (students teach a younger class, students are journalists/curators/town planners/scientists, students publish for a real external audience), an ethical/perspective-taking dimension, or a real community/expert connection.\n' +
  '  Sentence 4: Describe the FINAL student artefact concretely — what it looks like, sounds like, or does. It must be shareable beyond the classroom (with a year-level audience, the school community, families, or a real-world stakeholder).\n' +
  '  Sentence 5: Name a SPECIFIC advanced or under-used feature of the tool that powers the activity (not the basic feature everyone already uses). Use named features: "Canva\'s Magic Write", "Book Creator\'s comic templates", "Padlet\'s map view", "iMovie\'s split-screen", "Adobe Express Animate from Audio", "Bee-Bot\'s sequence-and-repeat function", etc.\n' +
  '  Sentence 6: End with the inspiring "so what" — the disposition, agency, or real-world contribution the student takes away beyond the unit (action, voice, identity, civic awareness, creative confidence).\n' +
  'STEM slot 6 (Makerspace/Physical-First): 4-5 sentences naming concrete materials (cardboard, circuits, recycled materials, Lego, paper engineering, copper tape, cup-and-string mechanisms etc.), what is prototyped, how iteration happens, and what the student demonstrates at the end. The "wow" twist still applies — propose something most teachers haven\'t tried.\n\n' +
  'PUSH PAST THE OBVIOUS. Teachers must read these and think "I never thought of using it like that." Reject generic descriptions. Every sentence tailored to THIS unit.\n\n' +
  'BANNED PHRASES — do not write any of these (they make suggestions feel lazy and templated):\n' +
  '  - "connected to the central idea \'...\'"\n' +
  '  - "linked to the line of inquiry \'...\'"\n' +
  '  - "for this unit" / "in this unit" / "about this unit" / "this unit\'s focus"\n' +
  '  - "share their learning" / "present their findings" / "document their learning journey"\n' +
  '  - "create a digital product" / "make a simple product"\n' +
  '  - "Students use [tool] to [vague verb] about [unit theme]"\n' +
  'Name the actual topic. If the unit is about ecosystems, say "ecosystems". If it is about migration, say "migration".\n\n' +
  'WRITING MECHANICS: Use straight apostrophes (\'), em-dashes (—), Australian English. No curly quotes. No line breaks inside JSON string values.';

function inspiringBuildPrompt_(data, targetIdx, approvedToolsPrompt) {
  const target = data[targetIdx];
  const footprint = diversitySiblingToolFootprint_(data, targetIdx);
  const overusedLine = footprint.overused.length
    ? '\n- DO NOT REUSE these tools that are already heavily used by sibling units in this campus + year level (avoid adding to the over-used pile unless absolutely necessary for THIS unit): ' + footprint.overused.join(', ') + '.'
    : '';
  const allUsedLine = footprint.allUsed.length
    ? '\n- For context, every tool currently used by ANY sibling unit in this campus + year level: ' + footprint.allUsed.join(', ') + '. Reach for tools NOT on this list first; only repeat from it when the alternative would be a poor pedagogical fit.'
    : '';

  return 'You are a visionary Digital Learning Coach at Wesley College (IB PYP, Melbourne). You help primary-school teachers see possibilities they would never have thought of on their own. Your job RIGHT NOW is to regenerate all 6 digital technology suggestions for ONE specific unit in the new 6-sentence inspiring style. Output STRICT JSON only.\n\n' +
    'Campus: ' + target.ca + ' | Year Level: ' + target.yl + ' | Theme: "' + target.th + '"' +
    (target.ci ? '\nCentral Idea: "' + target.ci + '"' : '') +
    (target.lo ? '\nLines of Inquiry: "' + target.lo + '"' : '') +
    (target.plannerText ? '\nPlanner context: ' + String(target.plannerText).slice(0, 4000) : '') + '\n\n' +
    'STRUCTURE: Return exactly 6 suggestions.\n' +
    '- Suggestions 1-5: Digital technology integrations. At LEAST 2 must be an App Smash ("Tool A + Tool B"). Each follows the 6-sentence inspiring style below.\n' +
    '- Suggestion 6: A Makerspace/STEM Design Cycle project (Empathise-Define-Ideate-Prototype-Test, physical-first focus). 4-5 sentences.\n\n' +
    'NO DUPLICATE TOOLS within this unit (HARD RULE): each of the 6 suggestions uses a DIFFERENT primary tool. App Smash components count — if slot 1 is "Padlet + iMovie", neither Padlet nor iMovie may appear in slots 2-6.\n\n' +
    'APP SMASH FORMAT: "Tool 1 + Tool 2" with a literal + sign. The description must explain how BOTH tools are used together (not just one tool that happens to be paired in the title).\n\n' +
    'DIVERSITY CONSTRAINTS:' + overusedLine + allUsedLine + '\n' +
    '- VARY YOUR OPENER — slot 1 sets the unit\'s tone and must specifically suit THIS unit\'s theme; do not default to one canonical App Smash pair.\n' +
    '- If multiple tools fit equally well, pick the one LEAST used in the year level.\n\n' +
    approvedToolsPrompt + '\n' + REALISTIC_TOOL_USE_RULES + '\n\n' +
    'YEAR LEVEL GUIDANCE FOR ' + target.yl + ':\n' + inspiringYearRule_(target.yl) + '\n' +
    INSPIRING_DESCRIPTION_RULES + '\n\n' +
    'Return ONLY a valid JSON object (no markdown, no backticks). Use straight apostrophes (\'). Schema:\n' +
    '{ "s": [ { "t": "Tool Name or Tool A + Tool B", "d": "Exactly 6 inspiring sentences tailored to THIS unit (slot 6: 4-5 sentences for the STEM project)." }, ... 6 items ] }';
}

function inspiringCallOnce_(prompt, temperature) {
  // Default temperature 0.75 gives creativity. Caller lowers it on retries
  // (typically to 0.45) so the model snaps back to the approved-tools list
  // instead of inventing rogue tool names — the whitelist validator
  // otherwise burns 3 retries × ~15s per unit and blows past the 6-min
  // Apps Script execution limit.
  const temp = (typeof temperature === 'number') ? temperature : 0.75;
  const payload = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: temp,
    max_tokens: 5000
  };
  const response = UrlFetchApp.fetch(OPENAI_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getOpenAIKey_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code === 429) { setCooldown_(2, 'OpenAI rate limit during inspiring regen'); return { retriable: true, error: 'HTTP 429' }; }
  if (isRetriableHttpCode_(code)) return { retriable: true, error: 'HTTP ' + code };
  if (code !== 200) return { retriable: false, error: 'HTTP ' + code + ': ' + response.getContentText().slice(0, 200) };
  let rawText;
  try {
    const parsed = JSON.parse(response.getContentText());
    rawText = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
  } catch (e) { return { retriable: false, error: 'malformed OpenAI envelope' }; }
  if (!rawText) return { retriable: false, error: 'empty content' };
  let clean = rawText.replace(/```json|```/g, '').trim();
  clean = clean.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"');
  try {
    const obj = JSON.parse(clean);
    return { ok: true, sugs: Array.isArray(obj.s) ? obj.s : [] };
  } catch (e) { return { retriable: true, error: 'JSON parse: ' + e.message }; }
}

function inspiringSentenceCount_(text) {
  if (!text) return 0;
  // Count sentence-ending punctuation outside common abbreviations. Good enough
  // for a soft validator — we accept 5-7 sentences for slots 1-5 to allow
  // the model a small amount of natural variation, and 3-6 for the STEM slot.
  const t = String(text)
    .replace(/\be\.g\./gi, 'eg').replace(/\bi\.e\./gi, 'ie').replace(/Mr\./g, 'Mr').replace(/Mrs\./g, 'Mrs').replace(/Dr\./g, 'Dr');
  const matches = t.match(/[.!?](?=\s+[A-Z]|\s*$)/g);
  return matches ? matches.length : 0;
}

// 2026-05-25: Added to gate inspiring regen against off-whitelist / banned
// tools. The existing diversity validator deliberately didn't whitelist-check
// because temperature 0.4 + heavy prompt rarely produced rogue tools. At
// temperature 0.75 (inspiring prompt) the AI gets more inventive about tool
// names — first Inspire All run produced 8 off-whitelist + 15 banned tools
// across the corpus, so we now hard-validate every component against the
// synced DLA_TOOL_APPROVED / DLA_TOOL_BANNED Script Properties.
function getBannedToolNames_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('DLA_TOOL_BANNED');
  if (!raw) return [];
  try {
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

function inspiringCheckToolMembership_(sugs, approvedSet, bannedSet) {
  // approvedSet / bannedSet are Sets of lowercased trimmed tool names.
  // Walk every "+"-split component of every slot. First failure returned.
  for (let i = 0; i < sugs.length; i++) {
    const sg = sugs[i];
    if (!sg || typeof sg.t !== 'string') continue;
    const comps = diversityToolComponents_(sg.t);
    for (let c = 0; c < comps.length; c++) {
      const key = diversityToolKey_(comps[c]);
      if (!key) continue;
      if (bannedSet.has(key)) {
        return { ok: false, reason: 'slot ' + (i + 1) + ' uses BANNED tool "' + comps[c] + '" — pick a different approved tool' };
      }
      if (approvedSet.size > 0 && !approvedSet.has(key)) {
        return { ok: false, reason: 'slot ' + (i + 1) + ' uses OFF-WHITELIST tool "' + comps[c] + '" — must be one of the approved tools listed in the prompt' };
      }
    }
  }
  return { ok: true };
}

function inspiringValidateSugs_(sugs, target, data, targetIdx, approvedSet, bannedSet) {
  // Re-use the diversity validator first (length, t/d presence, tool dedup,
  // >=2 App Smashes, opener differs from siblings).
  const base = diversityValidateSugs_(sugs, target, data, targetIdx);
  if (!base.ok) return base;
  // Hard tool-list check (added 2026-05-25 after Inspire All v1 leaked
  // off-whitelist + banned tools at temperature 0.75).
  if (approvedSet && bannedSet) {
    const membership = inspiringCheckToolMembership_(sugs, approvedSet, bannedSet);
    if (!membership.ok) return membership;
  }
  // Soft sentence-count check for slots 1-5 only. STEM slot is allowed to be
  // shorter. We accept 5-8 sentences for the inspiring slots (target is 6 —
  // the AI sometimes lands on 5 or 7 with natural prose; rejecting those
  // would balloon retries without quality improvement).
  for (let i = 0; i < 5; i++) {
    const n = inspiringSentenceCount_(sugs[i].d);
    if (n < 5) return { ok: false, reason: 'slot ' + (i + 1) + ' description is only ' + n + ' sentence(s); need ~6' };
  }
  return { ok: true };
}

// Scan the live data.json for units whose current suggestions include any
// off-whitelist or banned tool component. Used by the requeue action to
// surface units that the first Inspire All v1 run wrote with rogue tools.
function inspiringFindBadToolUnits_(data, opts) {
  opts = opts || {};
  const approvedSet = new Set(getApprovedToolNames_().map(diversityToolKey_));
  const bannedSet = new Set(getBannedToolNames_().map(diversityToolKey_));
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    if (!inspiringInScope_(u, opts)) continue;
    if (!Array.isArray(u.s) || !u.s.length) continue;
    const offending = [];
    for (let s = 0; s < u.s.length; s++) {
      const sg = u.s[s];
      if (!sg || typeof sg.t !== 'string') continue;
      const comps = diversityToolComponents_(sg.t);
      for (let c = 0; c < comps.length; c++) {
        const key = diversityToolKey_(comps[c]);
        if (!key) continue;
        if (bannedSet.has(key)) offending.push({ slot: s + 1, tool: comps[c], reason: 'banned' });
        else if (approvedSet.size > 0 && !approvedSet.has(key)) offending.push({ slot: s + 1, tool: comps[c], reason: 'off-whitelist' });
      }
    }
    if (offending.length) out.push({ idx: i, ca: u.ca, yl: u.yl, th: u.th, offending: offending });
  }
  return out;
}

// One-shot helper: scan for bad-tool units, clear their inspiringRegenAt
// markers, save data.json. The user then clicks Inspire All again and the
// tightened validator regenerates them with the whitelist check active.
function regenerateAllInspiringRequeueBadTools(opts) {
  opts = opts || {};
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const raw = JSON.parse(file.getBlob().getDataAsString());
  const isArr = Array.isArray(raw);
  const data = isArr ? raw : Object.values(raw).filter(u => u && typeof u === 'object');
  const bad = inspiringFindBadToolUnits_(data, opts);
  let cleared = 0;
  for (let n = 0; n < bad.length; n++) {
    const u = data[bad[n].idx];
    if (u && u.inspiringRegenAt) { delete u.inspiringRegenAt; cleared++; }
  }
  if (cleared) {
    const toWrite = isArr ? data : raw;
    file.setContent(JSON.stringify(toWrite, null, 2));
    try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e) { Logger.log('pushToGitHub after requeueBadTools failed: ' + e); }
  }
  Logger.log('regenerateAllInspiringRequeueBadTools: flagged ' + bad.length + ' unit(s) with off-whitelist or banned tools; cleared ' + cleared + ' inspiringRegenAt marker(s).');
  if (bad.length) Logger.log('Bad-tool units:\n' + bad.map(b => '  ' + b.ca + ' / ' + b.yl + ' / ' + b.th + ' — ' + b.offending.map(o => 'slot ' + o.slot + ' "' + o.tool + '" (' + o.reason + ')').join('; ')).join('\n'));
  return { found: bad.length, cleared: cleared, units: bad };
}

function inspiringSnapshotDataJson_() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty(INSPIRING_SNAPSHOT_PROP);
  if (existing) {
    try {
      const f = DriveApp.getFileById(existing);
      return { snapshotFileId: existing, snapshotName: f.getName(), alreadyExisted: true };
    } catch (e) {
      // Stored ID is stale (file deleted) — fall through and snapshot again.
    }
  }
  const src = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const ts = Utilities.formatDate(new Date(), 'GMT', "yyyyMMdd_HHmmss");
  const name = 'data.json.pre_6sentence_' + ts;
  const parent = src.getParents().hasNext() ? src.getParents().next() : DriveApp.getRootFolder();
  const copy = src.makeCopy(name, parent);
  props.setProperty(INSPIRING_SNAPSHOT_PROP, copy.getId());
  props.setProperty(INSPIRING_STARTED_AT_PROP, new Date().toISOString());
  return { snapshotFileId: copy.getId(), snapshotName: name, alreadyExisted: false };
}

// A unit is eligible for inspiring regen only if it has BOTH a non-empty
// Central Idea (ci) and Lines of Inquiry (lo). Without those the new
// 6-sentence prompt has nothing to anchor on and would produce a weaker
// result than the existing data; better to skip and let a human fill in
// the planner first. Surfaced via inspiringSkippedUnits_() so the Studio
// card can show what's been excluded.
function inspiringHasUnitDetails_(u) {
  if (!u) return false;
  const ci = u.ci ? String(u.ci).trim() : '';
  const lo = u.lo ? String(u.lo).trim() : '';
  return !!(ci && lo);
}

function inspiringInScope_(u, opts) {
  if (!u || !u.ca || !u.yl) return false;
  if (opts.ca && u.ca !== opts.ca) return false;
  if (opts.yl && u.yl !== opts.yl) return false;
  return true;
}

function inspiringSkippedUnits_(data, opts) {
  opts = opts || {};
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    if (!inspiringInScope_(u, opts)) continue;
    if (inspiringHasUnitDetails_(u)) continue;
    const missing = [];
    if (!u.ci || !String(u.ci).trim()) missing.push('Central Idea');
    if (!u.lo || !String(u.lo).trim()) missing.push('Lines of Inquiry');
    out.push({ ca: u.ca, yl: u.yl, th: u.th, missing: missing });
  }
  return out;
}

function inspiringCandidateIndexes_(data, opts) {
  opts = opts || {};
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    if (!inspiringInScope_(u, opts)) continue;
    if (!inspiringHasUnitDetails_(u)) continue;
    // Skip units already inspiring-regenerated, unless caller asks to redo.
    if (!opts.redoAll && u.inspiringRegenAt) continue;
    out.push(i);
  }
  return out;
}

function regenerateAllInspiringStatus(opts) {
  opts = opts || {};
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const raw = JSON.parse(file.getBlob().getDataAsString());
  const data = Array.isArray(raw) ? raw : Object.values(raw).filter(u => u && typeof u === 'object');
  const inScope = data.filter(u => inspiringInScope_(u, opts));
  const eligible = inScope.filter(inspiringHasUnitDetails_);
  const done = eligible.filter(u => u.inspiringRegenAt).length;
  const skipped = inspiringSkippedUnits_(data, opts);
  const props = PropertiesService.getScriptProperties();
  return {
    total: eligible.length,
    done: done,
    remaining: eligible.length - done,
    skipped: skipped,
    skippedCount: skipped.length,
    snapshotFileId: props.getProperty(INSPIRING_SNAPSHOT_PROP) || null,
    startedAt: props.getProperty(INSPIRING_STARTED_AT_PROP) || null
  };
}

function regenerateAllInspiringReset(opts) {
  // Clears the inspiringRegenAt marker so re-running will reprocess every
  // unit. Also forgets the snapshot pointer so the next start creates a
  // fresh `data.json.pre_6sentence_<ts>` copy. Does NOT touch the previous
  // snapshot file in Drive (keep that as a manual rollback option).
  opts = opts || {};
  const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
  const raw = JSON.parse(file.getBlob().getDataAsString());
  const isArr = Array.isArray(raw);
  const data = isArr ? raw : Object.values(raw).filter(u => u && typeof u === 'object');
  let cleared = 0;
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    if (!u) continue;
    if (opts.ca && u.ca !== opts.ca) continue;
    if (opts.yl && u.yl !== opts.yl) continue;
    if (u.inspiringRegenAt) { delete u.inspiringRegenAt; cleared++; }
  }
  if (cleared) {
    const toWrite = isArr ? data : raw;
    file.setContent(JSON.stringify(toWrite, null, 2));
    try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e) { Logger.log('pushToGitHub after inspiring reset failed: ' + e); }
  }
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(INSPIRING_SNAPSHOT_PROP);
  props.deleteProperty(INSPIRING_STARTED_AT_PROP);
  return { cleared: cleared };
}

function regenerateAllInspiring(opts) {
  opts = opts || {};
  const batch = Number.isFinite(opts.batch) ? Math.max(1, Math.min(50, Number(opts.batch))) : INSPIRING_BATCH_DEFAULT;

  const lock = LockService.getScriptLock();
  // Use `paused:true` (not `skipped:true`) for lock/cooldown bail-outs so it
  // doesn't collide with the `skipped:[...]` array of CI/LOI-less units that
  // we return on a normal successful batch — an empty array is truthy, which
  // previously made the frontend mistake every successful batch for a pause.
  if (!lock.tryLock(120000)) { Logger.log('regenerateAllInspiring: lock still held after 2 min wait — bailing.'); return { paused: true, reason: 'lock-held' }; }

  try {
    const props = PropertiesService.getScriptProperties();
    const resumeTime = props.getProperty('DLA_RESUME_TIME');
    if (resumeTime && Date.now() < parseInt(resumeTime, 10)) {
      const until = new Date(parseInt(resumeTime, 10)).toLocaleString('en-AU');
      Logger.log('Cooldown active until ' + until + ' — bailing.');
      return { paused: true, reason: 'cooldown', until: until };
    }

    // One-time snapshot on first run.
    const snap = inspiringSnapshotDataJson_();

    const file = DriveApp.getFileById(DATA_JSON_FILE_ID);
    let raw = JSON.parse(file.getBlob().getDataAsString());
    const isArr = Array.isArray(raw);
    const data = isArr ? raw : Object.values(raw).filter(u => u && typeof u === 'object');

    const candidates = inspiringCandidateIndexes_(data, opts);
    // totalInScope counts ELIGIBLE units only (ci + lo present). Units
    // missing planner details are reported separately via `skipped` so the
    // Studio can flag them for manual fill-in without confusing the progress
    // numerator/denominator.
    const eligibleUnits = data.filter(u => inspiringInScope_(u, opts) && inspiringHasUnitDetails_(u));
    const totalInScope = eligibleUnits.length;
    const skipped = inspiringSkippedUnits_(data, opts);
    const alreadyDone = totalInScope - candidates.length;

    Logger.log('regenerateAllInspiring: ' + candidates.length + ' remaining of ' + totalInScope + ' eligible (' + skipped.length + ' skipped for missing ci/lo); processing up to ' + batch + ' this run.');
    if (skipped.length) {
      Logger.log('Skipped units (need ci + lo before regen):\n' + skipped.map(s => '  ' + s.ca + ' / ' + s.yl + ' / ' + s.th + ' (missing: ' + s.missing.join(', ') + ')').join('\n'));
    }

    if (!candidates.length) {
      return { processed: 0, fixed: 0, failed: 0, remaining: 0, total: totalInScope, done: alreadyDone, skipped: skipped, skippedCount: skipped.length, snapshot: snap, allDone: true };
    }

    const approvedToolsPrompt = getApprovedToolsPrompt_();
    // Build approved + banned tool sets once per batch invocation so the
    // validator can hard-reject any rogue tool the AI invents. Keys are
    // lowercased + trimmed via diversityToolKey_.
    const approvedSet = new Set(getApprovedToolNames_().map(diversityToolKey_));
    const bannedSet = new Set(getBannedToolNames_().map(diversityToolKey_));
    let processed = 0, fixed = 0, failed = 0;
    const failures = [];
    let dataDirty = false;

    for (let n = 0; n < candidates.length && processed < batch; n++) {
      const idx = candidates[n];
      const target = data[idx];
      processed++;
      const prompt = inspiringBuildPrompt_(data, idx, approvedToolsPrompt);
      let success = false;
      let lastReason = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        // Retry feedback: if the validator caught a rogue tool, repeat the
        // approved-tools constraint at the END of the prompt so it's the
        // freshest thing in the model's context. Drop temperature 0.75 -> 0.45
        // on retries to make the model less creative about tool names — the
        // whole point of retries is COMPLIANCE, not more creative variation.
        let retryNote = '';
        let retryTemp = 0.75;
        if (attempt > 1) {
          retryTemp = 0.45;
          const toolStrayed = /OFF-WHITELIST|BANNED/.test(lastReason);
          const toolReminder = toolStrayed ? '\n\nCRITICAL: You MUST pick every tool from the approved list above. Re-read the APPROVED TOOLS section. Do not invent tool names, do not use deprecated tools, do not substitute similar-sounding tools. If you are unsure whether a tool is approved, pick a different tool from the list that you can verify IS listed.' : '';
          retryNote = '\n\nRETRY ' + (attempt - 1) + ': Previous attempt failed validation (' + lastReason + '). Apply ALL constraints (tool whitelist, App Smash floor, no dup tools, opener differs from siblings, ~6 sentences per slot 1-5).' + toolReminder;
        }
        const call = inspiringCallOnce_(prompt + retryNote, retryTemp);
        if (!call.ok) {
          lastReason = call.error || 'unknown';
          if (call.retriable && attempt < 3) { Utilities.sleep(8000); continue; }
          break;
        }
        const verdict = inspiringValidateSugs_(call.sugs, target, data, idx, approvedSet, bannedSet);
        if (!verdict.ok) {
          lastReason = verdict.reason;
          if (attempt < 3) { Utilities.sleep(4000); continue; }
          break;
        }
        data[idx].s = call.sugs.map(s => ({ t: s.t, d: s.d }));
        data[idx].audited = true;
        data[idx].inspiringRegenAt = new Date().toISOString();
        clearHumanVerifiedFlags_(data[idx], 'Regenerated by regenerateAllInspiring (6-sentence inspiring style)');
        dataDirty = true;
        success = true;
        Logger.log('  [' + (n + 1) + '/' + candidates.length + '] ' + target.ca + ' ' + target.yl + ' — ' + target.th + ' -> s[0]=' + call.sugs[0].t);
        break;
      }
      if (success) fixed++;
      else { failed++; failures.push({ ca: target.ca, yl: target.yl, th: target.th, reason: lastReason }); Logger.log('  [' + (n + 1) + '/' + candidates.length + '] FAILED ' + target.ca + ' ' + target.yl + ' — ' + target.th + ' (' + lastReason + ')'); }
      Utilities.sleep(1500);
    }

    if (dataDirty) {
      const toWrite = isArr ? data : raw;
      file.setContent(JSON.stringify(toWrite, null, 2));
      try { if (typeof pushToGitHub === 'function') pushToGitHub(); } catch (e) { Logger.log('pushToGitHub after inspiring regen failed: ' + e); }
    }

    const remaining = Math.max(0, candidates.length - processed);
    const doneCount = totalInScope - remaining;
    Logger.log('regenerateAllInspiring: processed ' + processed + ', fixed ' + fixed + ', failed ' + failed + ', remaining ' + remaining + ' of ' + totalInScope);
    if (failures.length) Logger.log('Failures:\n' + failures.map(f => '  ' + f.ca + ' / ' + f.yl + ' / ' + f.th + ': ' + f.reason).join('\n'));
    return {
      processed: processed,
      fixed: fixed,
      failed: failed,
      remaining: remaining,
      total: totalInScope,
      done: doneCount,
      skipped: skipped,
      skippedCount: skipped.length,
      snapshot: snap,
      allDone: remaining === 0,
      failures: failures
    };
  } finally {
    lock.releaseLock();
  }
}