function initBulkTools(){
  const campuses=[...new Set(DATA.map(e=>e.ca))].sort();
  const yrs=[...new Set(DATA.map(e=>e.yl))].sort((a,b)=>YR.indexOf(a)-YR.indexOf(b));
  ['bulk-regen-campus'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    while(el.options.length>1) el.remove(1);
    campuses.forEach(c=>el.add(new Option(c,c)));
  });
  ['bulk-regen-year','compare-year'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    while(el.options.length>1) el.remove(1);
    yrs.forEach(y=>el.add(new Option(y,y)));
  });
  updateBulkRegenCount();
  updateCompareThemes();
  renderCoverageHeatmap();
  
  document.getElementById('bulk-regen-campus')?.addEventListener('change', updateBulkRegenCount);
  document.getElementById('bulk-regen-year')?.addEventListener('change', updateBulkRegenCount);
  
  ['export-campus'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    while(el.options.length>1) el.remove(1);
    campuses.forEach(c=>el.add(new Option(c,c)));
  });
  ['export-year'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    while(el.options.length>1) el.remove(1);
    yrs.forEach(y=>el.add(new Option(y,y)));
  });
}

function updateBulkRegenCount(){
  const ca=document.getElementById('bulk-regen-campus')?.value||'';
  const yr=document.getElementById('bulk-regen-year')?.value||'';
  const targets=DATA.filter(e=>{
    if(ca&&e.ca!==ca) return false;
    if(yr&&e.yl!==yr) return false;
    return getSugs(e).filter(isRealSug).length>=6;
  });
  const el=document.getElementById('bulk-regen-count');
  if(el) el.textContent=`${targets.length} entries selected`;
}

// Shared description quality + ordering instructions — referenced by all suggestion-generating prompts
const SUGGESTION_STYLE = `DESCRIPTION QUALITY RULES (CRITICAL — read these before writing ANY suggestion):

INNOVATION FIRST: The most innovative, unexpected, and out-of-the-box suggestion must always come first (slot 0). Teachers see the top suggestion first — lead with something that makes them think "I want to try that!" Save the more familiar tools (Seesaw, Canva, Book Creator) for later slots.

WRITING STYLE — every suggestion must be ~6 vivid, practical sentences (target 500-800 characters total) that paint a clear classroom picture matching the depth of a strong Inspire All / app-smash description. Never shorten to 2-3 sentences regardless of tool category — Minecraft, Micro:bit, Adobe Express verified-library suggestions are held to the same ~6-sentence standard as every other tool. The sentences below cover the minimum content; expand naturally with concrete examples, pedagogical arc and unit-specific anchoring to hit the ~6-sentence target:
1. STATE what students DO — name concrete actions: design, code, build, record, map, collect data, test, debug, publish, present, investigate, prototype, film, compose, interview, annotate, curate, survey, programme
2. STATE what students CREATE / PRODUCE / CAPTURE — name the specific artefact: campaign poster, explainer carousel, digital advocacy book, awareness video, collaborative debate wall, soundboard, data dashboard, guided virtual tour, short documentary, podcast episode, interactive quiz, annotated map, 3D prototype
3. WEAVE the unit connection naturally — show HOW the activity connects to what the class is actually studying. Use the central idea and lines of inquiry as invisible guides that shape the activity, but NEVER quote them directly.
4. Use clean Australian English punctuation: apostrophes must be straight ('), dashes must be em-dashes, and never output stray question marks as punctuation placeholders.

BANNED PHRASES — these make suggestions sound generic and lazy. NEVER write any of these:
- "connected to the central idea '...'"
- "linked to the line of inquiry '...'"
- "connected to How We Express Ourselves" (or any transdisciplinary theme name used as filler)
- "related to the unit theme"
- "for this unit" / "in this unit" / "about this unit"
- "the unit focus" / "the unit's focus" / "this unit's content"
- "connects to the unit focus"
- "share their learning"
- "use the app to present"
- "make a simple product"
- "create a digital product"
- "explore the topic"
- "connected to the unit"
- "present their findings"
- "record their thinking"
- "document their learning journey"
- "document their inquiry journey"
- "Students use [tool] to [vague verb] about [unit theme]."

NAME THE ACTUAL TOPIC — never use "this unit" or "unit focus" as a placeholder:
- BAD: "Students use Padlet as a collaborative evidence wall for this unit."
- GOOD: "Students use Padlet to build a collaborative debate wall about real-world government decisions, posting arguments, counterarguments and evidence."
- BAD: "Students use Book Creator to publish an exhibition-style digital companion for this unit."
- GOOD: "Students collaboratively author interactive digital books that document their inquiry journey, research findings, and action plans. These multimedia books can include embedded videos, audio reflections, and clickable links, serving as both a portfolio and a tool for advocacy."
- BAD: "Students use Canva to design an audience-facing campaign for this unit."
- GOOD: "Students design visually compelling digital media campaigns — such as infographics, social media posts, and posters — using Canva. They leverage Canva's Remove Background feature to create striking visuals and combine text, imagery, and data to communicate their message effectively."
The unit theme, central idea and lines of inquiry tell you WHAT the topic is. Use that topic by name in the suggestion. If the unit is about government decisions, say "government decisions." If it is about ecosystems, say "ecosystems." Never say "this unit" or "the unit focus" as a stand-in.

HOW TO CONNECT TO THE UNIT (DO THIS INSTEAD):
The planner context (central idea, lines of inquiry, activities) should guide the CONTENT of the suggestion in the background. Weave it into the specific task naturally:
- BAD: "Students use Canva to create a poster connected to the central idea 'Communities make decisions that impact people and places.'"
- GOOD: "Students use Canva to design an awareness campaign for a global issue they have investigated, such as climate action, access to education, food security or human rights. They create a campaign poster, short explainer carousel or exhibition panel that combines evidence, persuasive language and purposeful design choices to help an audience understand the issue and consider how they could respond."
- BAD: "Students use Book Creator to make a book about what they learned in the unit."
- GOOD: "Students create a digital advocacy book that explains a global issue through evidence, images, diagrams, captions and short reflective sections. Each page builds the audience's understanding of the issue, shows why it matters, and ends with a realistic action readers could take in their own community."
- BAD: "Students use Padlet to share their learning connected to the line of inquiry about governance."
- GOOD: "Students use Padlet to build a collaborative debate wall about real-world government decisions, posting arguments, counterarguments and evidence. They respond to peers with evidence-based feedback, then summarise how the debate connects to how governance affects citizens' lives."

TEACHER READABILITY: Write so a primary teacher can picture exactly what happens in the lesson. No jargon, no abstract framing. If a colleague reading the suggestion cannot immediately imagine what students are doing, rewrite it.

NAME THE TOOL'S FEATURES: Do not treat tools as black boxes. Name the specific feature, mode, or affordance that makes the activity work:
- BAD: "They combine evidence, concise copy and deliberate design choices" (could be any tool)
- GOOD: "They leverage Canva's Remove Background feature to create striking visuals and combine text, imagery, and data" (names the specific Canva feature)
- BAD: "Each page combines student-curated evidence, diagrams, captions, voice reflection" (generic)
- GOOD: "These multimedia books can include embedded videos, audio reflections, and clickable links, serving as both a portfolio and a tool for advocacy" (names Book Creator's specific multimedia affordances)
- BAD: "They post examples, questions and counterpoints" (could be any platform)
- GOOD: "Students post arguments, counterarguments, and evidence about real-world government decisions (e.g., social media bans, new laws). This interactive platform allows for peer feedback" (names what Padlet uniquely enables — threaded peer responses)

GIVE CONCRETE EXAMPLES: Where possible, include 2-3 specific examples of what students might create or investigate. Use phrases like "such as", "for example", "e.g.," to ground the activity in real content rather than abstract categories.

PRESERVE STRONG SUGGESTIONS: If an existing suggestion is already vivid, specific, and well-connected, do NOT rewrite it. Only rewrite clearly weak, vague, or generic suggestions.

MINECRAFT EDUCATION VERIFIED LESSON USE:
- Use the tool name "Minecraft Education".
- Minecraft suggestions must come from the verified Minecraft library only.
- Name the specific Minecraft library lesson and include its direct URL inline in the description.
- Write ~6 vivid, practical sentences (target 500-800 characters) — the SAME depth as every other tool category. The old 2-sentence cap is removed; do NOT default to 2 sentences anymore.
- Suggested sentence flow across the ~6 sentences: (1) name the verified lesson and the main classroom purpose; (2) describe what students actually DO in Minecraft — concrete actions like build, code with Code Builder / Agent, place blocks, capture screenshots, annotate signs; (3) name the platform-specific feature(s) the lesson hinges on (NPC dialogue, Code Builder, Agent commands, redstone, build templates, structure blocks); (4) name the concrete student product/evidence (annotated build screenshots, signposted world tour, short explainer screencast, captioned map, reflection slide); (5) anchor explicitly to the unit using the central idea, a Line of Inquiry or a named planner topic — never "this unit" / "the unit focus"; (6) close with how the product is shared or assessed (peer walkthrough, gallery, presentation, exhibition).
- HARD GUARDRAILS that still apply at 6-sentence depth:
  · Do NOT paste or paraphrase the full Minecraft lesson overview, standards text, NGSS codes, or verbatim library description. Write in your own words.
  · Do NOT use vague filler such as "launchpad", "unit-connected build", or "build or investigation".
  · Do NOT invent original Minecraft build challenges, fake lesson titles, or fake URLs.
  · Do NOT force a maths-only Minecraft lesson such as Area and Volume into non-maths units. Only use a verified Minecraft lesson when its lesson content genuinely connects to the unit.
  · If the lesson fit cannot be sustained authentically across ~6 sentences without padding or repetition, do NOT propose Minecraft for that unit.

VERIFIED LIBRARY LESSONS — NON-MINECRAFT (Micro:bit, Adobe Express, and any future user-curated library):
Treat these with the SAME ~6-sentence depth as every other tool — matching a strong app-smash / Inspire All description (e.g., the Padlet → iMovie documentary example or the Protecting Animals Micro:bit GOOD example below).
- Write ~6 vivid, practical sentences. Aim for 500-800 characters. The old 3-4 sentence / 70-130 word cap is removed; do NOT under-write to that size anymore.
- Name the specific library lesson AND include its direct URL inline in the description.
- Name the platform-specific feature the lesson actually uses — never use black-box phrasing like "the device", "a simple device", "the platform" or "the technology". For Micro:bit specifically: name the actual sensors or inputs (accelerometer, light sensor, temperature sensor, compass, radio, A/B buttons, LED matrix, MakeCode blocks, Python editor). For Adobe Express: name the specific Adobe Express feature being used (Animate from Audio, Quick Actions, Remove Background, Generative Fill, etc.).
- Name the concrete student artefact (data log, working prototype, paired-device alert, sensor map, annotated MakeCode screenshot, calibration report, edited podcast episode, infographic, awareness video, lip-synced explainer) — never just "a prototype" or "their product".
- Show the pedagogical arc — explore → prototype → test/iterate → present/justify — using the library lesson's teaching notes to ground concrete lesson stages across multiple sentences.
- Reference SPECIFIC unit content from the planner: the assessment task, an LoI elaboration, a weekly activity, or a named topic — never "this unit", "the unit focus", "their inquiry" as placeholders.
- Give 2-3 concrete topical examples ("such as the eastern barred bandicoot or platypus") rather than abstract categories.
- BAD example (too thin — under-written to the old 3-4 sentence cap): "Students use the Protecting Animals Micro:bit lesson (URL) to design and code a simple device that could help monitor or protect local wildlife. They present their prototype and explain how technology can support conservation efforts."
- GOOD example (~6 sentences, ~700 chars — this is the target depth): "Students follow the Protecting Animals Micro:bit lesson (https://microbit.org/teach/lessons/?selected=protecting-animals) to prototype a low-power motion-sensing alert that helps protect a local species the class has researched, such as the eastern barred bandicoot or platypus. Working in pairs, they programme the accelerometer and radio to broadcast a signal when movement is detected, then iterate the MakeCode blocks after testing the trigger sensitivity outdoors. Each pair logs sensor readings, captures annotated MakeCode screenshots and a 60-second demonstration video that shows the device responding in context. They link the prototype to the Line of Inquiry about how humans can take action for vulnerable habitats, presenting one concrete protective behaviour their technology could enable."

PODCASTING RULE: Whenever a suggestion involves podcasting, audio recording, audio storytelling, or audio interviews, ALWAYS use the tool name "Podcasting using Canva" — not GarageBand, not "Podcast Equipment", not Adobe Express. Podcasting using Canva is the school's preferred podcasting platform (it works on iPads, whereas Adobe Express Podcasting does not). Always include the URL https://www.canva.com in the description.

ANIMATE CHARACTER RULE: Whenever a suggestion involves a talking character, animated narration, a lip-synced explainer, an avatar telling a story, a character delivering information, or any animated character speaking, ALWAYS use the tool name "Animating a Character with Adobe Express" — not generic "Adobe Express", not ChatterPix Kids (which is Prep–Year 2 only), not Puppet Pals. This is Adobe Express's Animate from Audio feature: students record audio and a character automatically lip-syncs to it. Always include the URL https://new.express.adobe.com/home/tools/animate-from-audio in the description, and name the specific feature ("Animate from Audio") in the description text. For Kinder and Prep–Year 2, frame it as teacher-guided (the teacher operates the tool while children record their voices).

GREEN SCREEN RULE: Instead of physical Green Screen Kits (which are banned), suggest Canva Remove Background. Good example:
"Students record themselves as youth reporters presenting from a digital newsroom, protest site, disaster zone, gallery wall or community setting related to a global issue. Using Canva's Remove Background feature, they place themselves into a relevant visual scene and produce a short awareness video that explains the issue, its impact and a possible call to action."

ENCODING: Use standard straight apostrophes (') only. Do NOT use curly/smart quotes. Do NOT use line breaks inside JSON string values.`;

const REALISTIC_TOOL_USE_RULES = `REALISTIC CLASSROOM USE RULES (HARD RULE):
- Suggestions must be practical enough for a teacher to run; name the concrete student action and product.
- The tool's real affordance must be central. Do not use a tool as a vague metaphor for an abstract idea.
- Robotics and drones should only be suggested when the unit genuinely involves movement, mapping, forces, systems, navigation, data collection, automation, measurement, environments or spatial thinking.
- CoDrone EDU rule: only use it within the Studio-configured year range; it must involve actual drone actions such as flight paths, take-off/landing, waypoints, altitude, obstacle courses, mapping, aerial observation or sensor/data collection. Do NOT suggest CoDrone for body systems, emotions, wellbeing, fitness challenges, storytelling-only tasks, or purely abstract concepts.
- Bad example: CoDrone EDU drones model body systems or wellbeing. A flying drone cannot meaningfully model a circulatory system.
- If you cannot explain exactly what students will do with the hardware/software, choose a different tool.`;

// ========== CENTRALISED TOOL CONSTRAINTS — used by every AI suggestion path ==========

// Tool inventory — persisted to libraries.json under _meta._inventory
// Editable from the Tool Inventory card in the Bulk tab.
// Structure: { approved: [...], banned: [...], ageRanges: { [normalisedToolName]: { min: 0, max: 6 } } }
// If approved is non-empty, it takes precedence over the default approved list.
// If banned includes a tool, AI will never suggest it (even if approved).
// ageRanges are editable from the whitelist UI and are persisted with libraries.json.
let TOOL_INVENTORY = { approved: [], banned: [], ageRanges: {} };

// Default seeds used when nothing is persisted yet (first time a coordinator visits after this update).
// The coordinator can add/remove freely from the Tool Inventory card.
const DEFAULT_APPROVED_TOOLS = [
  // Microsoft M365 (Teams, PowerPoint, OneNote, Sway are BANNED — only Word, Excel, Forms allowed)
  'Microsoft Word', 'Microsoft Excel', 'Microsoft Forms',
  // Specialist platform
  'Wise Discussion Chatbots',
  // Robotics / STEM hardware (Lego Spike Essential is BANNED — only Prime allowed)
  'Bee-Bots', 'Sphero Indi', 'Sphero BOLT', 'Lego Spike Prime',
  'Micro:bit', 'CoDrone EDU', 'Makey Makey',
  // Maker / AV hardware (ClassVR, Green Screen Kits, Digital Cameras are BANNED)
  '3D Printers', 'Merge Cubes', 'Podcast Equipment', 'iPads', 'Laptops',
  // Core creation
  'Seesaw', 'Canva', 'Book Creator', 'Padlet',
  // Video / audio / animation
  'GarageBand', 'ScratchJR', 'Stop Motion Studio', 'ChatterPix Kids', 'iMovie',
  'Puppet Pals', 'Adobe Express', 'Podcasting using Canva', 'Animating a Character with Adobe Express',
  // Subject specific (Google Earth + Google Maps are BANNED — students do not have
  // Google accounts so cannot edit maps; the approved tool is Google Street View only)
  'Google Street View', 'National Geographic MapMaker', 'Field Guide to Victoria', 'Sky Map', 'Geoboard',
  // Other
  'Clickview', 'Epic', 'PicCollage', 'Brushes Redux', 'Word Clouds ABCya',
  'Sketchbook', 'Explain Everything', 'Freeform', 'Delightex', 'Kahoot', 'Tinkercad',
  'Minecraft Education'
];

const DEFAULT_BANNED_TOOLS = [
  // AI chatbots
  'ChatGPT', 'Claude', 'Gemini', 'Copilot',
  // Google Suite
  'Google Docs', 'Google Slides', 'Google Sheets',
  // Microsoft banned
  'Microsoft Teams', 'Microsoft PowerPoint', 'Microsoft OneNote', 'Microsoft Sway',
  // Hardware banned
  'ClassVR', 'Green Screen Kits', 'Digital Cameras', 'Lego Spike Essential',
  // Other banned
  'WeVideo', 'Flipgrid', 'Google Earth', 'Google Maps', 'Banqer', 'Apple Keynote'
];

const DEFAULT_TOOL_AGE_RANGES = {
  // Kinder–Year 6 (kinder-appropriate per the GAS audit prompt rules)
  'Seesaw': {min:-2,max:6}, 'Epic': {min:-2,max:6}, 'PicCollage': {min:-2,max:6},
  'Freeform': {min:-2,max:6}, 'Brushes Redux': {min:-2,max:6}, 'Book Creator': {min:-2,max:6},
  // All other Prep–Year 6
  'GarageBand': {min:0,max:6}, 'iMovie': {min:0,max:6}, 'Google Street View': {min:0,max:6},
  'Google Earth': {min:0,max:6}, 'Clickview': {min:0,max:6}, 'Green Screen': {min:0,max:6},
  'iPads': {min:0,max:6}, 'Laptops': {min:0,max:6}, 'Digital Cameras': {min:0,max:6},
  'Sketchbook': {min:0,max:6},
  'Delightex': {min:0,max:6}, 'Merge Cubes': {min:0,max:6}, 'Makey Makey': {min:0,max:6},
  'Word Clouds ABCya': {min:0,max:6}, 'Field Guide to Victoria': {min:0,max:6}, 'Sky Map': {min:0,max:6},
  'Geoboard': {min:0,max:6}, 'Podcasting using Canva': {min:0,max:6},
  'Animating a Character with Adobe Express': {min:-2,max:6},
  'Microsoft Excel': {min:0,max:6}, 'Microsoft Forms': {min:0,max:6}, 'Microsoft Sway': {min:0,max:6},
  'Wise Discussion Chatbots': {min:3,max:6},
  // Kinder–Year 2 (play-based hardware/apps for the youngest learners)
  'Bee-Bots': {min:-2,max:2}, 'ScratchJR': {min:-2,max:2}, 'ChatterPix Kids': {min:-2,max:2},
  'Puppet Pals': {min:-2,max:2}, 'Sphero Indi': {min:-2,max:2},
  // Year 3+
  'Sphero BOLT': {min:3,max:6}, 'Lego Spike Essential': {min:3,max:6}, 'Micro:bit': {min:3,max:6},
  'Scratch': {min:3,max:6}, 'Stop Motion Studio': {min:3,max:6}, 'Adobe Express': {min:3,max:6},
  'Canva': {min:3,max:6}, 'Padlet': {min:3,max:6},
  'Kahoot': {min:3,max:6}, 'Tinkercad': {min:3,max:6}, 'Explain Everything': {min:3,max:6},
  // Year 4+
  'Microsoft Teams': {min:4,max:6}, 'Microsoft Word': {min:4,max:6}, 'Microsoft PowerPoint': {min:4,max:6},
  'Microsoft OneNote': {min:4,max:6}, 'Lego Spike Prime': {min:4,max:6}, 'CoDrone EDU': {min:4,max:6},
  'Minecraft Education': {min:4,max:6},
  // Year 5+
  '3D Printers': {min:5,max:6}
};

function getDefaultToolAgeRange(toolName){
  const key = toolInventoryKey(toolName);
  const hit = Object.entries(DEFAULT_TOOL_AGE_RANGES).find(([name]) => toolInventoryKey(name) === key);
  return hit ? normaliseAgeRange(hit[1]) : { min: 0, max: 6 };
}

function getToolAgeRange(toolName){
  normaliseToolInventory();
  const key = toolInventoryKey(toolName);
  const stored = TOOL_INVENTORY.ageRanges && TOOL_INVENTORY.ageRanges[key];
  return stored ? normaliseAgeRange(stored) : getDefaultToolAgeRange(toolName);
}

function setToolAgeRange(toolName, min, max){
  normaliseToolInventory();
  const key = toolInventoryKey(toolName);
  if(!key) return;
  TOOL_INVENTORY.ageRanges[key] = normaliseAgeRange({min,max});
}

function buildApprovedToolsList(){
  normaliseToolInventory();
  const tools = (TOOL_INVENTORY.approved && TOOL_INVENTORY.approved.length)
    ? TOOL_INVENTORY.approved
    : DEFAULT_APPROVED_TOOLS;
  return tools.join(', ');
}

function buildBannedToolsList(){
  normaliseToolInventory();
  return (TOOL_INVENTORY.banned && TOOL_INVENTORY.banned.length)
    ? TOOL_INVENTORY.banned.join(', ')
    : 'None configured';
}

function buildDynamicToolAgeGuide(){
  normaliseToolInventory();
  const tools = (TOOL_INVENTORY.approved && TOOL_INVENTORY.approved.length)
    ? TOOL_INVENTORY.approved
    : DEFAULT_APPROVED_TOOLS;
  const lines = tools.map(t => `- ${t}: ${ageRangeLabel(getToolAgeRange(t))}`).join('\n');
  return `TOOL AGE GUIDE (HARD RULE — match Australian year levels):
3 Year Old Kinder = ages 3-4 | 4 Year Old Kinder = ages 4-5 | Prep = ages 5-6 | Year 1 = 6-7 | Year 2 = 7-8 | Year 3 = 8-9 | Year 4 = 9-10 | Year 5 = 10-11 | Year 6 = 11-12
Current Studio-approved tool age ranges:
${lines || '- No approved tools configured.'}
NEVER propose a tool for a year level outside its configured range.`;
}

// Populate defaults if inventory hasn't been loaded from Drive yet
function seedDefaultInventoryIfEmpty(){
  normaliseToolInventory();
  if(!TOOL_INVENTORY.approved || TOOL_INVENTORY.approved.length === 0){
    TOOL_INVENTORY.approved = [...DEFAULT_APPROVED_TOOLS];
  }
  if(!TOOL_INVENTORY.banned || TOOL_INVENTORY.banned.length === 0){
    TOOL_INVENTORY.banned = [...DEFAULT_BANNED_TOOLS];
  }
  TOOL_INVENTORY.ageRanges = TOOL_INVENTORY.ageRanges || {};

  // New Wesley/Schoolbox tool: keep it available after this update unless the coordinator has explicitly banned it.
  const wiseTool = 'Wise Discussion Chatbots';
  const wiseKey = toolInventoryKey(wiseTool);
  const wiseAlreadyApproved = (TOOL_INVENTORY.approved || []).some(t => toolInventoryKey(t) === wiseKey);
  const wiseAlreadyBanned = (TOOL_INVENTORY.banned || []).some(t => toolInventoryKey(t) === wiseKey);
  if(wiseKey && !wiseAlreadyApproved && !wiseAlreadyBanned){
    TOOL_INVENTORY.approved.push(wiseTool);
    TOOL_INVENTORY.ageRanges[wiseKey] = getDefaultToolAgeRange(wiseTool);
    if(typeof TOOL_INVENTORY_CLEANUP_PENDING !== 'undefined') TOOL_INVENTORY_CLEANUP_PENDING = true;
  }

  // Migration: older Studio builds seeded Book Creator as Year 3+. Wesley uses
  // Book Creator with younger learners too, so treat the old seeded range as stale
  // and open it to Prep-Year 6. Coordinators can still narrow it again manually.
  const bookCreatorKey = toolInventoryKey('Book Creator');
  const bookCreatorRange = TOOL_INVENTORY.ageRanges && TOOL_INVENTORY.ageRanges[bookCreatorKey];
  if(bookCreatorKey && (!bookCreatorRange || (Number(bookCreatorRange.min) === 3 && Number(bookCreatorRange.max) === 6))){
    TOOL_INVENTORY.ageRanges[bookCreatorKey] = {min:0,max:6};
    if(typeof TOOL_INVENTORY_CLEANUP_PENDING !== 'undefined') TOOL_INVENTORY_CLEANUP_PENDING = true;
  }

  TOOL_INVENTORY.approved.forEach(tool => {
    const key = toolInventoryKey(tool);
    if(key && !TOOL_INVENTORY.ageRanges[key]) TOOL_INVENTORY.ageRanges[key] = getDefaultToolAgeRange(tool);
  });
}

// Legacy alias kept for any old references
function getBannedTools(){ return TOOL_INVENTORY.banned || []; }
// Treat inventory.banned as the runtime "not available" list
Object.defineProperty(window, 'NOT_AVAILABLE_AT_WESLEY', {
  get(){ return TOOL_INVENTORY.banned || []; },
  configurable: true
});

const TOOL_AGE_GUIDE = `TOOL AGE GUIDE (HARD RULE — match Australian year levels):
3 Year Old Kinder = ages 3-4 | 4 Year Old Kinder = ages 4-5 | Prep = ages 5-6 | Year 1 = 6-7 | Year 2 = 7-8 | Year 3 = 8-9 | Year 4 = 9-10 | Year 5 = 10-11 | Year 6 = 11-12
- Kinder-Year 2 ONLY: Bee-Bots, ScratchJR, ChatterPix Kids, Puppet Pals, Sphero Indi
- Year 3+: Sphero BOLT, Lego Spike Essential, Micro:bits, Scratch, Stop Motion Studio, Adobe Express, Canva, Padlet, Kahoot, Tinkercad, Explain Everything, Wise Discussion Chatbots
- Year 4+: Microsoft Teams, Lego Spike Prime, CoDrone EDU, Minecraft Education (with scaffolding for Year 4)
- Year 5+: 3D Printers, Python-based coding
- Kinder-Year 6: Seesaw, Epic, PicCollage, Freeform, Brushes Redux, Book Creator
- Prep-Year 6: GarageBand, iMovie, Google Street View, Clickview, Green Screen, iPads, Laptops, Digital Cameras, Sketchbook
NEVER propose a tool for a year level below its minimum age.`;

// Map year level string → numeric year for age filtering
function getYearNumber(yearLevel){
  const s = String(yearLevel || '').toLowerCase().trim();
  // Kinder year levels are stored as negative numbers so they slot in
  // before Prep on the same numeric scale. Mirror the GAS-side
  // getYearNumber_ so both halves of the system agree.
  if(s.includes('3 year old') || s.includes('3yo')) return -2;
  if(s.includes('4 year old') || s.includes('4yo')) return -1;
  if(s.includes('prep') || s === 'p' || s === 'f' || s.includes('foundation')) return 0;
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// Returns the approved tools that are age-appropriate AND available at Wesley,
// filtered by the unit's year level. Used to give the AI a constrained shortlist.
function getAgeAppropriateTools(yearLevel){
  const yr = getYearNumber(yearLevel);
  // Build from the master list, annotated with min-year
  // minYr = 0 means Prep & up
  const ALL = [
    // All ages
    {n:'Seesaw',      min:0}, {n:'Epic',         min:0}, {n:'GarageBand',   min:0},
    {n:'iMovie',      min:0}, {n:'PicCollage',   min:0}, {n:'Google Street View', min:0},
    {n:'Clickview',   min:0}, {n:'Green Screen', min:0},
    {n:'iPads',       min:0}, {n:'Freeform',     min:0}, {n:'Sketchbook',   min:0},
    {n:'Brushes Redux',min:0},{n:'Delightex',    min:0}, {n:'Merge Cubes',  min:0},
    {n:'Makey Makey', min:0}, {n:'Word Clouds ABCya', min:0},
    {n:'Field Guide to Victoria', min:0}, {n:'Sky Map', min:0},
    {n:'Geoboard',    min:0}, {n:'Podcasting using Canva', min:0},
    {n:'Animating a Character with Adobe Express', min:0},
    {n:'Book Creator', min:0},
    // Prep-Yr2 ONLY (max:2)
    {n:'Bee-Bots',      min:0, max:2},
    {n:'ScratchJR',     min:0, max:2},
    {n:'ChatterPix Kids',min:0, max:2},
    {n:'Puppet Pals',   min:0, max:2},
    {n:'Sphero Indi',   min:0, max:2},
    // Year 3+
    {n:'Sphero BOLT',      min:3},
    {n:'Lego Spike Essential', min:3},
    {n:'Micro:bit',        min:3},
    {n:'Scratch',          min:3},
    {n:'Stop Motion Studio', min:3},
    {n:'Adobe Express',    min:3},
    {n:'Canva',            min:3},
    {n:'Padlet',           min:3},
    {n:'Wise Discussion Chatbots', min:3},
    {n:'Kahoot',           min:3},
    {n:'Tinkercad',        min:3},
    {n:'Explain Everything', min:3},
    // Year 4+
    {n:'Microsoft Teams',   min:4},
    {n:'Microsoft Word',    min:4},
    {n:'Microsoft PowerPoint', min:4},
    {n:'Microsoft OneNote', min:4},
    {n:'Lego Spike Prime',  min:4},
    {n:'CoDrone EDU',       min:4},
    {n:'Minecraft Education',min:4},
    // Year 5+
    {n:'3D Printers', min:5},
  ];
  normaliseToolInventory();
  const isBanned = (tool) => (TOOL_INVENTORY.banned || []).some(na => toolInventoryKey(na) === toolInventoryKey(tool));
  const isInRange = (tool) => {
    const range = getToolAgeRange(tool);
    return yr >= range.min && yr <= range.max;
  };
  // First filter to age-appropriate tools that aren't banned, using editable Studio age ranges
  let filtered = ALL
    .filter(t => isInRange(t.n))
    .filter(t => !isBanned(t.n))
    .map(t => t.n);
  // If a custom whitelist is set, intersect with it
  if((TOOL_INVENTORY.approved || []).length){
    const approvedKeys = TOOL_INVENTORY.approved.map(toolInventoryKey);
    filtered = filtered.filter(t => approvedKeys.includes(toolInventoryKey(t)));
    // Allow any custom-approved tool through even if not in master list, but only inside its configured age range
    TOOL_INVENTORY.approved.forEach(customTool => {
      if(isBanned(customTool)) return;
      if(!isInRange(customTool)) return;
      if(!filtered.some(t => toolInventoryKey(t) === toolInventoryKey(customTool))){
        filtered.push(customTool);
      }
    });
  }
  return filtered;
}

// Check if a single tool is age-appropriate for a given year level
function isToolAgeAppropriate(toolName, yearLevel){
  const appropriate = getAgeAppropriateTools(yearLevel).map(t => t.toLowerCase());
  const normalised = normaliseToolName(toolName).toLowerCase();
  if(appropriate.includes(normalised)) return true;
  // Also accept partial matches for compound names
  return appropriate.some(a => normalised.includes(a) || a.includes(normalised));
}

function unitContextTextForRealism(entry){
  if(!entry) return '';
  return `${entry.th || ''} ${entry.ci || ''} ${entry.lo || ''} ${entry.plannerText || ''}`;
}
function realismResult(ok, reason){ return { ok, reason: reason || '' }; }
function dlaTextForFit_(value){
  return String(value || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&amp;/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function unitHasMathMeasurementContext_(entry){
  const unit = dlaTextForFit_(`${entry?.th || ''} ${entry?.ci || ''} ${entry?.lo || ''} ${entry?.plannerText || ''}`);
  return /\b(math|maths|mathematics|measure|measurement|area|volume|perimeter|geometry|geometric|shape|shapes|space|spatial|scale|map|mapping|coordinate|coordinates|angle|angles|length|width|height|capacity|data|graph|graphs|statistics|number|fractions?|decimal|probability|pattern|patterns|algebra|architect|architecture|blueprint|floorplan|floor plan)\b/i.test(unit);
}
function unitHasIdentityWellbeingContext_(entry){
  const unit = dlaTextForFit_(`${entry?.th || ''} ${entry?.ci || ''} ${entry?.lo || ''} ${entry?.plannerText || ''}`);
  return /\b(identity|identities|empathy|feelings|emotions|puberty|wellbeing|well being|relationships|friendship|friends|change|growth|personal|body|bodies|health|choices|resilience|belonging|culture|celebration|traditions|community|values|beliefs|perspective|perspectives)\b/i.test(unit);
}
function findCuratedLessonMention_(libraryKey, proposedTool, proposedDesc){
  const lessons = getLibraryLessons(libraryKey) || [];
  if(!lessons.length) return null;
  const hay = String((proposedTool || '') + ' ' + (proposedDesc || ''));
  const hayNorm = dlaTextForFit_(hay);
  const urls = (hay.match(/https?:\/\/[^\s)]+/g) || []).map(u => u.replace(/[.,;]+$/g, '').toLowerCase());
  return lessons.find(l => {
    if(!l) return false;
    const title = dlaTextForFit_(l.title || '');
    const url = String(l.url || '').toLowerCase();
    if(url && urls.some(u => u.includes(url) || url.includes(u))) return true;
    if(title && hayNorm.includes(title)) return true;
    if(url){
      const slug = dlaTextForFit_((url.split('/').filter(Boolean).pop() || '').replace(/-/g, ' '));
      if(slug && hayNorm.includes(slug)) return true;
    }
    return false;
  }) || null;
}
function curatedLessonLooksMathOnly_(lesson){
  const txt = dlaTextForFit_(`${lesson?.title || ''} ${lesson?.desc || ''} ${lesson?.subject || ''}`);
  const mathHits = /(\barea\b|\bvolume\b|perimeter|geometry|geometric|fractions?|decimals?|angles?|coordinates?|graphs?|probability|multiplication|division|algebra|measurement|mathematics|maths?)/i.test(txt);
  const widerContext = /(ecosystem|habitat|sustainability|climate|adaptation|culture|community|history|geography|water|weather|energy|forces?|materials?|animal|plants?|country|place|environment|civics|economy|story|narrative)/i.test(txt);
  return mathHits && !widerContext;
}
function minecraftDescriptionQuality_(desc){
  const text = String(desc || '').replace(/\s+/g, ' ').trim();
  if(!text) return { ok:false, reason:'Minecraft description is empty.' };
  if(text.length > 560) return { ok:false, reason:'Minecraft description is too long. Use two short classroom sentences, not the full lesson overview.' };
  if(/\b(NGSS|ACARA|Victorian Curriculum|HS-LS|MS-LS|K-ESS|standard[s]?|curriculum code[s]?)\b/i.test(text)){
    return { ok:false, reason:'Minecraft description appears to include standards/curriculum text rather than a practical classroom task.' };
  }
  if(/verified lesson focuses on|launchpad for a unit-connected build|unit-connected build or investigation|complex issues surrounding|students develop an understanding/i.test(text)){
    return { ok:false, reason:'Minecraft description is importing lesson-library wording or vague filler instead of a clear classroom activity.' };
  }
  if(/([A-Za-z])\?([A-Za-z])|([A-Za-z0-9)\]\}"”’])\s+\?\s+([A-Za-z0-9(\[\{"“])/i.test(text)){
    return { ok:false, reason:'Minecraft description contains punctuation corruption. It needs clean apostrophes and dashes.' };
  }
  const studentMentions = (text.match(/\bstudents\b/ig) || []).length;
  if(studentMentions > 3) return { ok:false, reason:'Minecraft description is repetitive. Use two concise sentences.' };
  if(!/(screenshot|sign|portfolio|brief|explanation|tour|map|model|reflection|evidence|annotat|journal|pitch|diagram|record)/i.test(text)){
    return { ok:false, reason:'Minecraft description needs a concrete student evidence/product such as screenshots, signs, a map, model, brief or explanation.' };
  }
  return { ok:true, reason:'' };
}

function checkMinecraftEducationFit(toolName, desc, entry){
  // 2026-05-28: Wesley relaxed the verified-lesson-only requirement for
  // Minecraft. Original AI-generated Minecraft classroom activities are now
  // allowed; the curated library is a reference, not a gate. If the AI
  // chooses to anchor on a verified lesson, the lesson-specific maths-only
  // and identity/wellbeing safety checks still apply.
  const quality = minecraftDescriptionQuality_(desc);
  if(!quality.ok) return quality;
  const lesson = findCuratedLessonMention_('minecraft', toolName, desc);
  if(lesson){
    if(curatedLessonLooksMathOnly_(lesson) && !unitHasMathMeasurementContext_(entry)){
      return { ok:false, reason:`Minecraft lesson "${lesson.title}" appears to be maths/measurement-focused and does not fit this unit context.` };
    }
    if(/\barea\b/i.test(lesson.title || '') && /\bvolume\b/i.test(lesson.title || '') && unitHasIdentityWellbeingContext_(entry) && !unitHasMathMeasurementContext_(entry)){
      return { ok:false, reason:`Minecraft lesson "${lesson.title}" is an Area and Volume maths lesson, not a fit for this identity/wellbeing unit.` };
    }
  }
  return { ok:true, reason:'' };
}

function toolInventoryBannedHit(toolName, desc){
  normaliseToolInventory();
  const banned = [
    ...(TOOL_INVENTORY && Array.isArray(TOOL_INVENTORY.banned) ? TOOL_INVENTORY.banned : []),
    ...(typeof DEFAULT_BANNED_TOOLS !== 'undefined' && Array.isArray(DEFAULT_BANNED_TOOLS) ? DEFAULT_BANNED_TOOLS : [])
  ];
  const haystacks = [toolName, desc].map(v => String(v || '')).filter(Boolean);
  for(const bannedName of banned){
    const bk = toolInventoryKey(bannedName);
    if(!bk) continue;
    for(const hay of haystacks){
      const hk = toolInventoryKey(hay);
      if(!hk) continue;
      // Exact and composite/app-smash catches, e.g. "ClassVR & Merge Cubes".
      if(hk === bk || hk.includes(bk) || bk.includes(hk)) return bannedName;
    }
  }
  return '';
}

function checkRealisticToolUse(toolName, desc, entry){
  const bannedHit = toolInventoryBannedHit(toolName, desc);
  if(bannedHit) return realismResult(false, `${bannedHit} is banned/not available at Wesley.`);
  const rawTool = String(toolName || '').trim();
  const t = normaliseToolName(rawTool).toLowerCase();
  const d = String(desc || '').toLowerCase();
  const unit = unitContextTextForRealism(entry).toLowerCase();
  const full = `${d} ${unit}`;
  const yr = getYearNumber(entry && entry.yl);
  if(!rawTool || !desc) return realismResult(false, 'Missing tool or description.');
  if(t.includes('codrone')){
    const codroneRange = getToolAgeRange('CoDrone EDU');
    if(yr < codroneRange.min || yr > codroneRange.max) return realismResult(false, `CoDrone EDU is configured for ${ageRangeLabel(codroneRange)}.`);
    const concreteDroneAction = /(drone|fly|flight|hover|land|take[- ]?off|waypoint|route|path|altitude|obstacle|mission|coordinate|sequence|sensor|data|measure|map|aerial|photo|video)/i.test(d);
    if(!concreteDroneAction) return realismResult(false, 'CoDrone EDU suggestion does not describe an actual drone flight/coding/data task.');
    const abstractMisfit = /(body systems?|circulatory|digestive|respiratory|nervous|muscular|skeletal|heart|lungs|blood|wellbeing|fitness challenge|feelings?|emotion|identity|friendship|beliefs?)/i.test(d);
    const concreteCourseOrMap = /(flight path|route|pathway|map|mapping|course|obstacle course|mission|waypoint|model landscape|school grounds|aerial|survey)/i.test(d);
    if(abstractMisfit && !concreteCourseOrMap) return realismResult(false, 'CoDrone EDU was used for an abstract/body/wellbeing idea rather than a concrete flight, mapping or data task.');
    const unitFit = /(force|motion|movement|flight|map|mapping|navigation|coordinate|environment|survey|aerial|data|sensor|weather|microclimate|obstacle|route|mission|system|algorithm|automation|energy|sustainability|habitat|landform|place|space|distance|speed|angle|measurement|rescue|transport|journey)/i.test(full);
    if(!unitFit) return realismResult(false, 'CoDrone EDU does not appear to fit the unit context strongly enough.');
  }
  if(/minecraft/i.test(t)){
    const mcFit = checkMinecraftEducationFit(rawTool, desc, entry);
    if(!mcFit.ok) return realismResult(false, mcFit.reason);
  }
  if(/(sphero|bee-bot|beebot|lego spike|micro:bit|makey makey|3d printer|tinkercad)/i.test(t)){
    const concreteHardwareAction = /(code|program|build|prototype|test|debug|measure|collect|sensor|circuit|route|path|navigate|drive|move|design|model|print|construct|iterate)/i.test(d);
    if(!concreteHardwareAction) return realismResult(false, `${rawTool} needs a concrete build/code/test action, not a vague activity.`);
  }
  return realismResult(true, '');
}
function isRealisticToolUse(toolName, desc, entry){ return checkRealisticToolUse(toolName, desc, entry).ok; }

// Build a constraint block to inject into every regen/feedback prompt
function buildToolConstraints(yearLevel){
  const appropriate = getAgeAppropriateTools(yearLevel);
  const yr = getYearNumber(yearLevel);
  const yrLabel = yr === 0 ? 'Prep' : `Year ${yr}`;
  const unavailable = NOT_AVAILABLE_AT_WESLEY.length
    ? `\n\nTOOLS NOT AVAILABLE AT WESLEY (never suggest these): ${NOT_AVAILABLE_AT_WESLEY.join(', ')}`
    : '';
  return `${buildDynamicToolAgeGuide()}

THIS UNIT IS ${yrLabel.toUpperCase()} — you may ONLY choose from these age-appropriate tools:
${appropriate.join(', ')}${unavailable}

${REALISTIC_TOOL_USE_RULES}

CRITICAL: If you propose a tool NOT in the list above for this year level, your answer is rejected. Check your chosen tool against the list before responding.`;
}

// Detect if an instruction references a specific platform/library (Minecraft, Micro:bit, etc)
// and return its injected context. Shared between regen, feedback, and bulk AI.
function detectPlatformContext(text, yearLevel){
  if(!text) return { platform: null, contextBlock: '' };
  const platforms = (typeof buildKnownPlatforms === 'function') ? buildKnownPlatforms() : [];
  const platform = platforms.find(p => p.match.test(text));
  if(!platform) return { platform: null, contextBlock: '' };
  // Age-gate the platform itself
  const ageOK = isToolAgeAppropriate(platform.name, yearLevel);
  if(!ageOK){
    return {
      platform,
      contextBlock: `\n\nAGE CHECK: The teacher mentioned ${platform.name}, but this tool is NOT age-appropriate for ${yearLevel}. You MUST politely decline to use ${platform.name} and propose age-appropriate alternatives instead.`
    };
  }
  const ctx = typeof platform.context === 'string' ? platform.context : platform.context;
  if(/minecraft/i.test(platform.name || '')){
    return {
      platform,
      contextBlock: `\n\nDETECTED PLATFORM: ${platform.name}\n${ctx}\nMinecraft Education must use VERIFIED LESSON MODE only — choose a lesson from the curated Minecraft library when it genuinely matches the unit. Include the real lesson title and direct URL. Do NOT create original Minecraft build/challenge ideas, and do NOT invent fake lesson titles or fake URLs. Do not force a maths-only Minecraft lesson into a non-maths unit.`
    };
  }
  return {
    platform,
    contextBlock: `\n\nDETECTED PLATFORM: ${platform.name}\n${ctx}\nWhen suggesting ${platform.name}, name the specific lesson from the library above in every proposal. Only propose lessons whose minimum age allows this year level.`
  };
}


const WISE_DISCUSSION_CHATBOTS_CONTEXT = `WISE DISCUSSION CHATBOTS CONTEXT:
- Wesley uses Schoolbox under the name Wise.
- The approved tool name is "Wise Discussion Chatbots".
- Teachers create an AI Discussion chatbot by choosing a topic, connecting it to curriculum, and selecting a scenario.
- Available scenarios include Character Interview, Project Ideation, Self-Reflection, and Socratic Tutor.
- Use this when students should ask questions, test thinking, explore a perspective/persona, reflect on their learning, or develop project ideas through guided dialogue.
- A strong DLA suggestion MUST be specific: name the selected scenario, name the chatbot's role/persona as a concrete fictional character or expert (for example, "Dr Maya Chen, a wildlife ecologist" rather than "a relevant perspective"), include 1–2 example student questions/prompts, and specify the student product after the chat.
- Avoid generic wording such as "a relevant character", "a topic", or "explore perspectives". Make it easy for a teacher to imagine creating the Wise chatbot tomorrow.
- Good products include a reflection, question bank, comparison table, project proposal, exit ticket, revised inquiry plan, claim-evidence-reasoning response, or perspective summary.
- Keep the teacher in control: frame it as a teacher-created Wise chatbot with curriculum connection, not an open consumer AI assistant.`;


function buildGASRules(yearLevel){
  const allowedForYear = yearLevel
    ? `\n\nTHIS UNIT IS ${String(yearLevel).toUpperCase()} — only choose from these age-appropriate tools: ${getAgeAppropriateTools(yearLevel).join(', ')}`
    : '';
  return `You are an Expert Digital Learning Coach at Wesley College (MICROSOFT school).
APPROVED TOOLS ONLY — you may not invent or infer other tool names:
${buildApprovedToolsList()}

⛔ STRICTLY PROHIBITED — you will be rejected if you propose any of these:
${buildBannedToolsList()}
- ChatGPT, Claude, Gemini, Copilot, or any other consumer AI assistant (not approved for student use)
- Google Docs, Google Slides, Google Sheets (use Microsoft M365 equivalents — we are a Microsoft school)
- WeVideo, Flipgrid, any tool NOT explicitly listed above
- NEVER invent tool names. If unsure whether a tool is approved, DON'T USE IT.

${buildDynamicToolAgeGuide()}

${WISE_DISCUSSION_CHATBOTS_CONTEXT}${allowedForYear}
${SUGGESTION_STYLE}`;
}



async function fixAllOfType(type){
  const {incomplete,banned,duplicates,offWhitelist,ageMismatch}=getIssues();
  const typeMap={incomplete,banned,duplicate:duplicates,offwhitelist:offWhitelist,agemismatch:ageMismatch};
  const issues=typeMap[type]||[];
  if(!issues.length) return;

  const prog=document.getElementById('fix-all-progress');
  const bar=document.getElementById('fix-all-bar');
  const lbl=document.getElementById('fix-all-label');
  if(prog) prog.style.display='block';

  let done=0, fixed=0, failed=0, fixedSinceSave=0;
  // Save progress in small batches so an interruption (closed tab, sleeping
  // laptop) loses at most this many units of work instead of the whole run.
  // A re-run re-scans first, so anything already saved is skipped automatically.
  const SAVE_BATCH=5;

  const byEntry={};
  issues.forEach(iss=>{ if(!byEntry[iss.idx]) byEntry[iss.idx]=[]; byEntry[iss.idx].push(iss); });
  const entries=Object.keys(byEntry);

  for(const idxStr of entries){
    const idx=parseInt(idxStr);
    const e=DATA[idx];
    done++;
    if(bar) bar.style.width=`${Math.round((done/entries.length)*100)}%`;
    if(lbl) lbl.textContent=`${done}/${entries.length}: ${e.yl} — ${e.th}`;

    try{
      const currentSugs=getSugs(e);
      let prompt='';

      if(type==='incomplete'){
        prompt=`${buildGASRules(e.yl)}\n\nGenerate exactly 5 digital technology suggestions for this IB PYP unit.\nCampus: ${e.ca} | Year: ${e.yl} | Theme: "${e.th}"${e.ci?`\nCentral Idea: "${e.ci}"`:''}${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nEvery suggestion uses ONE approved tool (no "+" pairings). All 5 must use DIFFERENT tools.\nReturn ONLY JSON array: [{"t":"Tool Name","d":"Specific description for this unit."},...]`;

      } else if(type==='banned'||type==='offwhitelist'){
        prompt=`${buildGASRules(e.yl)}\n\nReplace these non-approved suggestions for this unit. Return 6 total suggestions (the 6th must be a STEM Design Cycle activity).\nUnit: ${e.ca} | ${e.yl} | "${e.th}"${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nCurrent suggestions (keep approved ones; replace the rest):\n${currentSugs.map((s,i)=>`${i+1}. ${sugTool(s)}: ${sugDesc(s)}`).join('\n')}\nEvery suggestion uses ONE approved tool (no "+" pairings). All 6 must use DIFFERENT tools.\nReturn ONLY JSON array of exactly 6 (the 6th must be a STEM Design Cycle activity): [{"t":"Tool Name","d":"Specific description."},...]`;

      } else if(type==='duplicate'){
        prompt=`${buildGASRules(e.yl)}\n\nFix duplicate tools in this unit — each suggestion must use a DIFFERENT tool.\nUnit: ${e.ca} | ${e.yl} | "${e.th}"${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nCurrent suggestions:\n${currentSugs.map((s,i)=>`${i+1}. ${sugTool(s)}: ${sugDesc(s)}`).join('\n')}\nEvery suggestion uses ONE approved tool (no "+" pairings). All 6 must use DIFFERENT tools.\nReturn ONLY JSON array of exactly 6 (the 6th must be a STEM Design Cycle activity) with NO repeated tools: [{"t":"Tool Name","d":"Specific description."},...]`;

      } else if(type==='agemismatch'){
        const yv = yearLevelValueFromLabel(e.yl);
        const badList = currentSugs
          .map((s,i)=>({i, tool:sugTool(s), range:toolAgeRangeFor(sugTool(s))}))
          .filter(x=> x.tool && x.range && yv!==null && (yv < x.range.min || yv > x.range.max));
        const badDesc = badList.map(x=>`#${x.i+1} ${x.tool} (allowed ${ageRangeLabel(x.range)})`).join('; ');
        const allowed = approvedToolsForYear_(yv);
        prompt=`${buildGASRules(e.yl)}\n\nSome suggestions in this unit use a tool whose allowed year-level range does NOT include ${e.yl}. Replace ONLY those tools; keep every other suggestion exactly as it is. Return 6 total suggestions (the 6th must be a STEM Design Cycle activity).\nUnit: ${e.ca} | ${e.yl} | "${e.th}"${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nCurrent suggestions:\n${currentSugs.map((s,i)=>`${i+1}. ${sugTool(s)}: ${sugDesc(s)}`).join('\n')}\nTools to REPLACE (wrong year level for ${e.yl}): ${badDesc}\nEach replacement MUST be an approved tool whose age range includes ${e.yl}. Approved tools that fit ${e.yl}: ${allowed.join(', ')}.\nEvery suggestion uses ONE approved tool (no "+" pairings). All 6 must use DIFFERENT tools.\nReturn ONLY JSON array of exactly 6 (the 6th must be a STEM Design Cycle activity): [{"t":"Tool Name","d":"Specific description."},...]`;
      }

      let sugs = null;
      let lastDupOpener = '';
      let lastFailReason = '';
      for(let attempt=0; attempt<3; attempt++){
        let retryNote = '';
        if(attempt>0 && lastFailReason === 'opener-dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response used "${lastDupOpener}" as the slot-1 tool, but another unit in this campus + year level already opens with that tool. Slot 1 MUST be a DIFFERENT tool that specifically suits THIS unit's theme.`;
        }
        const raw=await callAI([{role:'user',parts:[{text:prompt+retryNote}]}],null,OPENAI_MODEL);
        const clean=raw.replace(/```json|```/g,'').trim();
        const si=clean.indexOf('['),ei=clean.lastIndexOf(']');
        if(si===-1||ei===-1) throw new Error('No JSON array in response');
        const parsed=JSON.parse(clean.slice(si,ei+1));
        if(!parsed.length) throw new Error('Empty suggestions returned');
        const toolNames = parsed.map(s=>(s.t||'').toLowerCase().trim());
        const uniqueTools = new Set(toolNames);
        if(uniqueTools.size < toolNames.length){ if(attempt>=2) throw new Error('AI returned duplicates again after retry'); continue; }
        const openerDup = openerDupesSiblingInYear_(e, parsed);
        if(openerDup){ lastDupOpener = openerDup; lastFailReason = 'opener-dup'; if(attempt < 2) continue; }
        sugs = parsed;
        break;
      }
      if(!sugs) throw new Error(
        lastFailReason === 'opener-dup' ? `Opener stayed identical to a sibling unit ("${lastDupOpener}") after 3 attempts`
        : 'Regen retry loop exhausted');

      recordChange(idx,getSugs(DATA[idx]),sugs);
      DATA[idx].s=sugs;
      DATA[idx].audited=false;
      fixed++;
      fixedSinceSave++;
      if(lbl) lbl.textContent=`${done}/${entries.length}: ✓ ${e.yl} — ${e.th}`;
    }catch(err){
      failed++;
      console.error('fixAllOfType error for entry',idx,err);
      if(lbl) lbl.textContent=`${done}/${entries.length}: ✗ ${e.yl} — ${e.th} (${err.message})`;
      await sleep(1000);
    }
    // Persist the batch as soon as it fills up so completed units survive an
    // interruption. saveToDrive uploads the whole corpus, so we batch rather
    // than save every unit to keep the upload count (and conflict checks) sane.
    if(fixedSinceSave>=SAVE_BATCH){
      if(lbl) lbl.textContent=`Saving progress — ${fixed} fixed so far…`;
      await saveToDrive();
      fixedSinceSave=0;
    }
    if(done<entries.length) await sleep(2000);
  }

  if(lbl) lbl.textContent=`Saving ${fixed} fix${fixed!==1?'es':''}…`;
  // Save the final partial batch (anything fixed since the last batch save).
  if(fixedSinceSave>0) await saveToDrive();
  if(lbl) lbl.textContent=`Done — ${fixed} fixed, ${failed} failed`;
  renderDashboard();
  setStatus(`Fixed ${fixed} ${type} issue${fixed!==1?'s':''}`);
}

// ========== LIBRARIES — stored in libraries.json on Drive/GitHub ==========

const LIBRARIES_GITHUB_URL = 'https://wesdlpteam.github.io/digital-learning-assistant-v2/libraries.json';
let LIBRARIES = { minecraft: [], microbit: [] };
let LIBRARIES_META = {};
let LIBRARIES_FILE_ID = null;

// Default metadata for known libraries — used when meta isn't in libraries.json
const LIBRARY_DEFAULTS = {
  minecraft: {
    name: 'Minecraft Education', icon: '⛏',
    urlPattern: 'education.minecraft.net',
    urlPrefix: 'https://education.minecraft.net/en-us/lessons/',
    urlHint: 'Paste a lesson URL from education.minecraft.net',
    subjects: ['MATHEMATICS','SCIENCE','LANGUAGE & LITERACY','SOCIAL STUDIES & HISTORY','CODING & COMPUTER SCIENCE','ARTS & DESIGN','SEL & LIFE SKILLS','BUILD CHALLENGES']
  },
  microbit: {
    name: 'Micro:bit', icon: '🔌',
    urlPattern: 'microbit.org',
    urlPrefix: 'https://microbit.org/teach/lessons/?selected=',
    urlHint: 'Paste a lesson URL from microbit.org',
    subjects: ['MATHEMATICS','SCIENCE','CODING & COMPUTER SCIENCE','SEL & LIFE SKILLS','ARTS & DESIGN']
  }
};

// Common subject list for custom libraries
const COMMON_SUBJECTS = ['MATHEMATICS','SCIENCE','LANGUAGE & LITERACY','SOCIAL STUDIES & HISTORY','CODING & COMPUTER SCIENCE','ARTS & DESIGN','SEL & LIFE SKILLS','BUILD CHALLENGES','DIGITAL CITIZENSHIP','OTHER'];

function getLibraryMeta(key){
  return LIBRARIES_META[key] || LIBRARY_DEFAULTS[key] || { name: key, icon: '📚', urlPattern: '', urlPrefix: '', urlHint: 'Paste a lesson URL', subjects: COMMON_SUBJECTS };
}

function getLibraryKeys(){
  // Return all library keys (excluding _meta), with known ones first
  const known = ['minecraft','microbit'];
  const all = Object.keys(LIBRARIES).filter(k => k !== '_meta' && Array.isArray(LIBRARIES[k]));
  const ordered = known.filter(k => all.includes(k));
  all.forEach(k => { if(!ordered.includes(k)) ordered.push(k); });
  return ordered;
}

// Load libraries.json — tries Drive (if authed), falls back to GitHub Pages, falls back to empty
async function refreshLibrariesFromDrive(){
  try { localStorage.removeItem('dla_libraries_backup'); } catch{}
  LIBRARIES_FILE_ID = null;
  LIBRARIES = {};
  LIBRARIES_META = {};
  TOOL_INVENTORY = { approved: [], banned: [], ageRanges: {} };
  LIBRARIES_READY = false;
  LIBRARIES_LOADING_PROMISE = null;
  setStatus('Refreshing libraries from Drive…');
  await ensureLibrariesLoaded(true);
  renderLibraries();
  renderToolInventory();
  setStatus('Libraries refreshed from Drive ✓');
}

async function pullLibrariesFromGitHub(){
  const GITHUB_RAW = 'https://raw.githubusercontent.com/wesdlpteam/digital-learning-assistant-v2/main/libraries.json';
  if(!confirm(`This will:\n\n1. Fetch libraries.json from GitHub (${GITHUB_RAW})\n2. Overwrite the Drive copy with whatever GitHub has\n3. Discard any unsaved Studio changes\n\nUse this ONLY if you edited libraries.json directly in GitHub and need those edits back in Drive.\n\nContinue?`)) return;
  
  setStatus('Pulling libraries.json from GitHub…');
  try {
    // Cache-bust the GitHub fetch to avoid CDN staleness
    const url = GITHUB_RAW + '?cb=' + Date.now();
    const r = await fetch(url);
    if(!r.ok) throw new Error(`GitHub returned ${r.status}`);
    const githubData = await r.json();
    if(!githubData || typeof githubData !== 'object') throw new Error('Invalid JSON');
    
    // Summary of what we pulled
    const libKeys = Object.keys(githubData).filter(k => !k.startsWith('_'));
    const summary = libKeys.map(k => {
      const lessons = githubData[k] || [];
      const withDesc = lessons.filter(l => l && l.desc).length;
      const withUrl = lessons.filter(l => l && l.url).length;
      return `${k}: ${lessons.length} lessons (${withDesc} with descriptions, ${withUrl} with URLs)`;
    }).join('\n');
    
    if(!confirm(`Pulled from GitHub:\n\n${summary}\n\nApply to Drive?`)){
      setStatus('GitHub pull cancelled');
      return;
    }
    
    // Load the GitHub data into memory
    LIBRARIES = {};
    LIBRARIES_META = githubData._meta || {};
    libKeys.forEach(k => { LIBRARIES[k] = githubData[k] || []; });
    loadToolInventoryFromMeta(LIBRARIES_META);
    
    // Save to Drive (overwrites the Drive copy)
    await saveLibraries();
    
    // Re-render
    renderLibraries();
    renderToolInventory();
    setStatus(`GitHub pull complete ✓ ${libKeys.length} libraries synced to Drive`);
  } catch(e){
    console.error('GitHub pull failed:', e);
    setStatus(`GitHub pull failed: ${e.message}`, 'error');
    alert(`Failed to pull from GitHub:\n${e.message}\n\nCheck that:\n• The file exists at ${GITHUB_RAW}\n• You have internet connection\n• Your edits have been committed to the main branch`);
  }
}

async function loadLibraries(){
  function processLoaded(data){
    if(!data || typeof data !== 'object') return false;
    // Extract meta if present
    if(data._meta && typeof data._meta === 'object'){
      LIBRARIES_META = data._meta;
    }
    // Load persisted Tool Inventory, including editable age ranges, then seed defaults if needed
    loadToolInventoryFromMeta(LIBRARIES_META);
    // Copy lesson arrays
    const cleaned = {};
    Object.keys(data).forEach(k => {
      if(k === '_meta') return;
      if(Array.isArray(data[k])) cleaned[k] = data[k];
    });
    if(Object.keys(cleaned).length === 0) return false;
    LIBRARIES = cleaned;
    // Ensure known keys exist
    if(!LIBRARIES.minecraft) LIBRARIES.minecraft = [];
    if(!LIBRARIES.microbit) LIBRARIES.microbit = [];
    return true;
  }

  // Try Drive first — load by canonical file ID (matches gas_backend/Code.js LIBRARIES_JSON_FILE_ID)
  if(DRIVE_TOKEN){
    try {
      LIBRARIES_FILE_ID = '13QhwQsT_GFP8buqhJOVWwdIciwXILKnY';
      const r2 = await fetch(`https://www.googleapis.com/drive/v3/files/${LIBRARIES_FILE_ID}?alt=media&supportsAllDrives=true`,{
        headers:{'Authorization':'Bearer '+DRIVE_TOKEN}
      });
      if(r2.ok){
        const data = await r2.json();
        if(processLoaded(data)){
          const counts = getLibraryKeys().map(k => `${(LIBRARIES[k]||[]).length} ${getLibraryMeta(k).name}`).join(', ');
          console.log(`Libraries loaded from Drive — ${counts}`);
          return;
        }
      }
    } catch(e){ console.log('Libraries Drive load failed, trying GitHub:', e.message); }
  }
  // Fallback: GitHub Pages
  try {
    const r = await fetch(LIBRARIES_GITHUB_URL + '?t=' + Date.now());
    if(r.ok){
      const data = await r.json();
      if(processLoaded(data)){
        const counts = getLibraryKeys().map(k => `${(LIBRARIES[k]||[]).length} ${getLibraryMeta(k).name}`).join(', ');
        console.log(`Libraries loaded from GitHub — ${counts}`);
        return;
      }
    }
  } catch(e){ console.log('Libraries GitHub load failed:', e.message); }
  // Fallback: localStorage
  try {
    const backup = localStorage.getItem('dla_libraries_backup');
    if(backup){
      const data = JSON.parse(backup);
      if(processLoaded(data)){
        const counts = getLibraryKeys().map(k => `${(LIBRARIES[k]||[]).length} ${getLibraryMeta(k).name}`).join(', ');
        console.log(`Libraries restored from local backup — ${counts}`);
        setStatus('Libraries loaded from local backup — reconnect Drive to sync','error');
        return;
      }
    }
  } catch(e){ console.log('Libraries backup load failed:', e.message); }
  console.log('Libraries: using empty defaults');
}

let LIBRARIES_READY = false;
let LIBRARIES_LOADING_PROMISE = null;
function librariesHaveLessons(){
  return Object.keys(LIBRARIES || {}).some(k => k !== '_meta' && Array.isArray(LIBRARIES[k]) && LIBRARIES[k].length);
}
async function ensureLibrariesLoaded(force){
  if(!force && LIBRARIES_READY){
    normaliseToolInventory();
    return librariesHaveLessons();
  }
  if(LIBRARIES_LOADING_PROMISE) return LIBRARIES_LOADING_PROMISE;
  LIBRARIES_LOADING_PROMISE = loadLibraries().then(() => {
    LIBRARIES_READY = true;
    normaliseToolInventory();
    // The dashboard can render before tool age ranges have loaded, leaving the
    // "wrong year level" count stuck at a stale 0. Now that the ranges are
    // ready, redraw it so the count is correct.
    if(typeof renderDashboard === 'function'){ try { renderDashboard(); } catch(e){} }
    return librariesHaveLessons();
  }).catch(e => {
    LIBRARIES_READY = false;
    throw e;
  }).finally(() => {
    LIBRARIES_LOADING_PROMISE = null;
  });
  return LIBRARIES_LOADING_PROMISE;
}
async function ensureLibrariesLoadedForAI(){
  if(librariesHaveLessons() && LIBRARIES_READY) return true;
  setStatus('Loading lesson libraries for AI context…', 'loading');
  return ensureLibrariesLoaded().then((hasLessons) => {
    if(hasLessons){ renderToolInventory?.(); setStatus('Lesson libraries ready for AI ✓'); return true; }
    setStatus('AI ready — no lesson libraries found yet', 'loading'); return false;
  }).catch(e => { console.warn('Library preload failed:', e); setStatus('AI will continue without lesson-library context', 'error'); return false; });
}

// Save libraries.json to Drive (includes _meta)
async function saveLibraries(){
  // Sync TOOL_INVENTORY into LIBRARIES_META so it persists with libraries.json
  LIBRARIES_META._inventory = serialiseToolInventoryForMeta();
  const saveObj = { _meta: LIBRARIES_META };
  getLibraryKeys().forEach(k => { saveObj[k] = LIBRARIES[k] || []; });

  try { localStorage.setItem('dla_libraries_backup', JSON.stringify(saveObj)); } catch{}

  if(!DRIVE_TOKEN){
    try { DRIVE_TOKEN = await getDriveToken(); } catch{
      alert('⚠ Libraries NOT saved — Drive is disconnected.\n\nYour changes are backed up locally and will sync when Drive reconnects.\n\nClick "reconnect Drive" in the status bar or refresh the page.');
      setStatus('Libraries backed up locally — reconnect Drive to save','error');
      return;
    }
  }
  try {
    if(!LIBRARIES_FILE_ID){
      const createR = await fetch('https://www.googleapis.com/drive/v3/files',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+DRIVE_TOKEN},
        body:JSON.stringify({name:'libraries.json', mimeType:'application/json'})
      });
      if(createR.status === 401) throw new Error('Drive token expired');
      const created = await createR.json();
      if(!created.id) throw new Error('Drive file creation failed');
      LIBRARIES_FILE_ID = created.id;
    }
    const saveR = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${LIBRARIES_FILE_ID}?uploadType=media`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+DRIVE_TOKEN},
      body:JSON.stringify(saveObj, null, 2)
    });
    if(saveR.status === 401) throw new Error('Drive token expired');
    if(!saveR.ok) throw new Error(`Drive responded ${saveR.status}`);
    setStatus('Libraries saved to Drive ✓');

    // Auto-sync tool inventory to GAS so auditor/surgeon always use the same lists
    syncToolInventoryToGAS_().catch(err => console.warn('GAS inventory sync failed:', err.message));

  } catch(e){
    if(e.message.includes('expired') || e.message.includes('401')) DRIVE_TOKEN = null;
    alert(`⚠ Libraries save failed: ${e.message}\n\nYour changes are backed up locally. Refresh the page to reconnect Drive.`);
    setStatus('Libraries save failed — backed up locally', 'error');
  }
}

function getLibraryLessons(key){ return LIBRARIES[key] || []; }

// ===== AUTO-SYNC TOOL INVENTORY TO GAS =====
// Pushes the Studio's approved/banned lists to GAS Script Properties
// so the auditor, surgeon, and all GAS-side AI calls use the same lists.
// Called automatically every time saveLibraries() succeeds.
async function syncToolInventoryToGAS_() {
  if (!SCRIPT_URL) return;
  normaliseToolInventory();
  const body = withGASToken({
    action: 'syncToolInventory',
    approved: TOOL_INVENTORY.approved || [],
    banned: TOOL_INVENTORY.banned || [],
    ageRanges: TOOL_INVENTORY.ageRanges || {}
  });
  try {
    const r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.error) console.warn('GAS inventory sync error:', d.error);
    else console.log('Tool inventory synced to GAS ✓', d.message || '');
  } catch (err) {
    console.warn('GAS inventory sync failed:', err.message);
  }
}
// Backward-compatible alias
function getMinecraftLessons(){ return getLibraryLessons('minecraft'); }

function buildLibraryContext(key){
  const lessons = getLibraryLessons(key);
  const meta = getLibraryMeta(key);
  if(!lessons.length) return `No ${meta.name} lessons have been curated in the Libraries panel yet.`;

  const bySubject = {};
  lessons.forEach(l => {
    const s = l.subject || 'OTHER';
    if(!bySubject[s]) bySubject[s] = [];
    const notes = (l.teaching_notes || '').trim();
    const notesLine = notes ? `\n    Teaching notes: ${notes}` : '';
    bySubject[s].push(`- ${l.title} (${l.desc || 'no description'}; ages ${l.ages})${l.url ? ' URL: '+l.url : ''}${notesLine}`);
  });
  const sections = Object.entries(bySubject)
    .map(([s, lines]) => `${s}:\n${lines.join('\n')}`)
    .join('\n\n');

  if(key === 'minecraft'){
    return `${meta.name.toUpperCase()} — VERIFIED LESSON LIBRARY (${lessons.length} lessons):
Use the verified lessons below when there is a genuine content match. Do NOT force a lesson just because it is in the library. Do NOT create original Minecraft Education build/challenge ideas, fake lesson titles, or fake URLs.

AGE GATING FOR VERIFIED LESSONS: Each lesson has a minimum age. Match against Australian year levels:
  Prep = ages 5-6 | Year 1 = 6-7 | Year 2 = 7-8 | Year 3 = 8-9 | Year 4 = 9-10 | Year 5 = 10-11 | Year 6 = 11-12
  "ages 5+" = all year levels | "ages 8+" = Year 3+ only | "ages 10+" = Year 5+ only | "ages 11+" = Year 6 only
  NEVER propose a verified lesson for a year level below its minimum age.

LESSON-FIT HARD RULE: If a verified lesson is mainly mathematics/measurement (for example Area and Volume), only use it for units that genuinely involve mathematics, measurement, geometry, spatial design, scale, mapping or data. Do not force maths-only lessons into identity, wellbeing, empathy, culture, change or relationship units.

VERIFIED LESSONS AVAILABLE:
${sections}

When suggesting ${meta.name}, use tool name "${meta.name}" and include the lesson's URL from the list above directly in the description.`;
  }

  return `${meta.name.toUpperCase()} — VERIFIED LESSON LIBRARY (${lessons.length} lessons):
IMPORTANT: ONLY propose lessons from the list below. Do NOT invent or guess lesson titles — every title here has been verified. If no lesson below connects to a unit, do not force a match — skip that entry.

AGE GATING (HARD RULE): Each lesson has a minimum age. Match against Australian year levels:
  Prep = ages 5-6 | Year 1 = 6-7 | Year 2 = 7-8 | Year 3 = 8-9 | Year 4 = 9-10 | Year 5 = 10-11 | Year 6 = 11-12
  "ages 5+" = all year levels | "ages 8+" = Year 3+ only | "ages 10+" = Year 5+ only | "ages 11+" = Year 6 only
  NEVER propose a lesson for a year level below its minimum age.

${sections}

When suggesting ${meta.name}, use tool name "${meta.name}" and include the lesson's URL from the list above directly in the description. Do NOT tell teachers to search the website — give them the direct link.`;
}

// Compact version for Bulk AI opportunity scans. Prevents OpenAI TPM/request-size errors
// when a lesson library (for example Micro:bit with 20+ lessons) is scanned against many units.
function buildLibraryContextCompact(key){
  const lessons = getLibraryLessons(key);
  const meta = getLibraryMeta(key);
  if(!lessons.length) return `No ${meta.name} lessons have been curated in the Libraries panel yet.`;
  const lines = lessons.map(l => {
    const bits = [
      `- ${l.title}`,
      l.subject ? `subject ${l.subject}` : '',
      l.ages ? `ages ${l.ages}` : '',
      l.desc ? compactForPrompt(l.desc, 95) : '',
      l.teaching_notes ? `notes ${compactForPrompt(l.teaching_notes, 140)}` : '',
      l.url ? `URL: ${l.url}` : ''
    ].filter(Boolean);
    return bits.join(' | ');
  }).join('\n');
  if(key === 'minecraft'){
    return `${meta.name.toUpperCase()} — Reference library (${lessons.length} lessons available):
The verified Minecraft Education lessons below are a STARTING POINT, not a hard constraint. You may propose original classroom-Minecraft activities that genuinely fit the unit's central idea and lines of inquiry — students don't have to follow a published lesson. If you DO reference a verified lesson, use its real title and URL (do not invent titles or URLs), and avoid maths-only lessons like Area and Volume unless the unit involves maths/measurement/spatial design. Respect each lesson's age range where mentioned.
${lines}`;
  }
  return `${meta.name.toUpperCase()} — VERIFIED LESSON LIBRARY (${lessons.length} lessons):\nUse ONLY these verified lessons. Do NOT invent lesson titles. Respect lesson age ranges. Include the lesson URL in the description.\n${lines}`;
}
