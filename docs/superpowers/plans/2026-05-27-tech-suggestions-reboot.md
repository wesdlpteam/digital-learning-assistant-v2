# Tech Suggestions Reboot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the App Smash rule from every prompt, validator, retry loop, and recovery path; restore Minecraft + Micro:bit lesson library injection inside the 6-sentence inspiring prompt with relaxed two-mode wording (library lesson OR custom UOI activity); add a one-time Inspire-All-powered sweep that cleans every existing App Smash entry from `data.json`.

**Architecture:** Surgical edits to two backend prompts (`inspiringBuildPrompt_`, `auditPlanners`) + one validator (`diversityValidateSugs_`) + retry notes; deletion of the entire App Smash recovery system (4 functions, ~175 lines) + the Surgeon's partner-preservation branch (~80 lines); deletion of frontend App Smash helpers + retry branches across `00-config-state-utils.js`, `05-bulk-setup-libraries.js`, `08-export-sync-hotfixes.js`; one new backend helper pair (`inspiringFindUnitsWithAppSmashes_` + `regenerateAllInspiringSweepAppSmashes`) and one new Studio button that reuses Inspire All's existing batch/abort/status infrastructure.

**Tech Stack:** Google Apps Script (`gas_backend/Code.js`, deployed via `clasp`), vanilla JS in `js/00..09-*.js` loaded by `DLA_Studio.html`, GitHub Pages for the static site, `data.json` + `libraries.json` source-of-truth in Drive.

**Spec reference:** [`docs/superpowers/specs/2026-05-27-tech-suggestions-reboot-design.md`](../specs/2026-05-27-tech-suggestions-reboot-design.md)

**Testing note:** This repo has no test runner (per [CLAUDE.md](../../../CLAUDE.md)). Verification at each task is by **(a) grep/code-inspection** for the targeted strings, **(b) `clasp push` / Studio open** to confirm no syntax errors, and **(c) manual click-through** at the integration tasks. The plan calls these out explicitly.

---

## Task 1: Pre-flight — remove live App Smash recovery trigger

The 10-minute time-based trigger `appSmashRecoveryTick` may be installed in the live GAS project. If we delete the handler before removing the trigger, GAS logs an error every 10 min. This step is **manual** and must run **before** any code deletion.

**Files:**
- Modify (runtime only): Live GAS project triggers for `gas_backend/Code.js`

- [ ] **Step 1: Open the GAS editor for the gas_backend project.**

From a browser, go to `script.google.com`, open the DLA backend project (the one whose `.clasp.json` lives in `gas_backend/`). Confirm via `View → Executions` that it's the right project.

- [ ] **Step 2: List current triggers.**

In the editor's Apps Script function picker, select `cleanupAppSmashRecoveryTrigger_` and click ▶ Run. If GAS prompts for the optional `reason` argument, paste a one-liner (e.g. `Pre-deletion safety 2026-05-27`).

Expected output in the execution log: either `App Smash recovery complete: Pre-deletion safety 2026-05-27. Trigger removed.` (trigger existed and was removed) or no `appSmashRecoveryTick` entries surfaced (trigger never installed).

- [ ] **Step 3: Verify no live trigger remains.**

Paste the following one-off function into the GAS editor and run it once:

```js
function listTriggers_oneOff() {
  ScriptApp.getProjectTriggers().forEach(t => {
    Logger.log(t.getHandlerFunction() + ' / ' + t.getEventType() + ' / ' + t.getUniqueId());
  });
}
```

Expected output: zero log lines mentioning `appSmashRecoveryTick`. Delete the one-off function before proceeding.

- [ ] **Step 4: No commit yet.**

This step changes runtime trigger state only, not code. Proceed to Task 2.

---

## Task 2: Add a cached lesson-library helper in gas_backend

Today, `libraries.json` is loaded twice (once in `auditPlanners` at line 1030-1041, once in the Surgeon at line 1397-1408) but **not** in `inspiringBuildPrompt_`. We add one shared helper, cached for the duration of a script execution, and have `inspiringBuildPrompt_` use it. The existing two sites will be migrated in Task 3.

**Files:**
- Modify: `gas_backend/Code.js` (insert helper just above `inspiringBuildPrompt_` at line 3903)

- [ ] **Step 1: Open the file and confirm line 3903 is `inspiringBuildPrompt_`.**

Use Read on `gas_backend/Code.js` at offset 3895, limit 15. Confirm line 3903 is `function inspiringBuildPrompt_(data, targetIdx, approvedToolsPrompt) {`.

- [ ] **Step 2: Insert the new helper above `inspiringBuildPrompt_`.**

Edit `gas_backend/Code.js`. Find the line above 3903 (a blank line followed by `function inspiringBuildPrompt_`) and replace with:

```js
// 2026-05-27: Cached per-execution loader for the Minecraft + Micro:bit
// lesson libraries from libraries.json. Used by inspiringBuildPrompt_ and
// auditPlanners' prompt builder so both 6-sentence generators surface the
// curated lessons. Falls back to '' if libraries.json is unreachable.
var _INSPIRING_LESSONS_CACHE = null;
function inspiringLessonsLibraryText_() {
  if (_INSPIRING_LESSONS_CACHE !== null) return _INSPIRING_LESSONS_CACHE;
  try {
    const libFile = DriveApp.getFileById(LIBRARIES_JSON_FILE_ID);
    const libraries = JSON.parse(libFile.getBlob().getDataAsString());
    let out = '';
    if (libraries.minecraft && libraries.minecraft.length > 0) {
      out += '\n\nAPPROVED MINECRAFT EDUCATION LESSONS LIBRARY:\n' +
        libraries.minecraft.map(m => `- [Ages ${m.ages}] ${m.title}: ${m.desc || ''} (URL: ${m.url || 'No URL'})${m.teaching_notes ? '\n    Teaching notes: ' + m.teaching_notes : ''}`).join('\n') +
        '\n\nYou may suggest Minecraft Education in TWO ways:\n' +
        '1. PREFERRED — pick a library lesson when one connects naturally to THIS unit\'s central idea. Set "t": "Minecraft: <exact title>" and include the exact URL in sentence 1 of "d". Use any Teaching notes shown to ground later sentences in concrete lesson stages.\n' +
        '2. CUSTOM — if no library lesson fits the central idea but Minecraft is still the right tool, design a custom Minecraft activity for THIS unit. Set "t": "Minecraft Education" (no colon, no title) and build the 6 sentences around the UOI directly.';
    }
    if (libraries.microbit && libraries.microbit.length > 0) {
      out += '\n\nAPPROVED MICRO:BIT LESSONS LIBRARY:\n' +
        libraries.microbit.map(m => `- [Ages ${m.ages}] ${m.title} (URL: ${m.url || 'No URL'})${m.desc ? ' — ' + m.desc : ''}${m.teaching_notes ? '\n    Teaching notes: ' + m.teaching_notes : ''}`).join('\n') +
        '\n\nSame two-mode rule as Minecraft: "Micro:bit: <Title>" + URL when a library lesson fits; plain "Micro:bit" with a custom unit-specific activity when none does.';
    }
    _INSPIRING_LESSONS_CACHE = out;
    return out;
  } catch (e) {
    Logger.log('inspiringLessonsLibraryText_: could not load libraries.json — ' + e.toString());
    _INSPIRING_LESSONS_CACHE = '';
    return '';
  }
}

function inspiringBuildPrompt_(data, targetIdx, approvedToolsPrompt) {
```

The exact `old_string` for the Edit (use this verbatim — the trailing line is `function inspiringBuildPrompt_(...`):

```
function inspiringBuildPrompt_(data, targetIdx, approvedToolsPrompt) {
```

And the `new_string` is the multi-line block ending in the same `function inspiringBuildPrompt_(...)` line.

- [ ] **Step 3: Verify by grep.**

Run Grep with pattern `inspiringLessonsLibraryText_` in `gas_backend/Code.js`. Expected: one function definition match (the new function).

- [ ] **Step 4: Commit.**

```bash
cd "c:/Users/BennN/OneDrive - Wesley College/Documents/DLA_Workspace/digital-learning-assistant-v2"
git add gas_backend/Code.js
git commit -m "gas_backend: add inspiringLessonsLibraryText_ helper for two-mode lesson injection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 3: Rewrite `inspiringBuildPrompt_` — drop App Smash, inject lesson library

Strip every App-Smash sentence and inject the helper's output between `inspiringYearRule_(...)` and `INSPIRING_DESCRIPTION_RULES`.

**Files:**
- Modify: `gas_backend/Code.js` lines 3903-3931

- [ ] **Step 1: Read the current function body.**

Use Read on `gas_backend/Code.js` at offset 3903, limit 30, to refresh exact spacing.

- [ ] **Step 2: Replace the App-Smash language.**

Edit `gas_backend/Code.js`. Replace the existing structure block:

Old:
```
    'STRUCTURE: Return exactly 6 suggestions.\n' +
    '- Suggestions 1-5: Digital technology integrations. At LEAST 2 must be an App Smash ("Tool A + Tool B"). Each follows the 6-sentence inspiring style below.\n' +
    '- Suggestion 6: A Makerspace/STEM Design Cycle project (Empathise-Define-Ideate-Prototype-Test, physical-first focus). 4-5 sentences.\n\n' +
    'NO DUPLICATE TOOLS within this unit (HARD RULE): each of the 6 suggestions uses a DIFFERENT primary tool. App Smash components count — if slot 1 is "Padlet + iMovie", neither Padlet nor iMovie may appear in slots 2-6.\n\n' +
    'APP SMASH FORMAT: "Tool 1 + Tool 2" with a literal + sign. The description must explain how BOTH tools are used together (not just one tool that happens to be paired in the title).\n\n' +
```

New:
```
    'STRUCTURE: Return exactly 6 suggestions.\n' +
    '- Suggestions 1-5: Single-tool digital integrations — one approved tool per slot. Each follows the 6-sentence inspiring style below.\n' +
    '- Slot 1 sets the unit\'s tone — pick the tool that opens THIS unit\'s central idea in the most surprising, specific way.\n' +
    '- Suggestion 6: A Makerspace/STEM Design Cycle project (Empathise-Define-Ideate-Prototype-Test, physical-first focus). 4-5 sentences.\n\n' +
    'NO DUPLICATE TOOLS within this unit (HARD RULE): each of the 6 suggestions uses a DIFFERENT tool. No "+" pairings — every suggestion stands on one tool.\n\n' +
```

- [ ] **Step 3: Inject the lesson library helper.**

Edit `gas_backend/Code.js`. Find:

Old:
```
    'YEAR LEVEL GUIDANCE FOR ' + target.yl + ':\n' + inspiringYearRule_(target.yl) + '\n' +
    INSPIRING_DESCRIPTION_RULES + '\n\n' +
```

New:
```
    'YEAR LEVEL GUIDANCE FOR ' + target.yl + ':\n' + inspiringYearRule_(target.yl) + '\n' +
    inspiringLessonsLibraryText_() + '\n' +
    INSPIRING_DESCRIPTION_RULES + '\n\n' +
```

- [ ] **Step 4: Update the schema instruction.**

Edit `gas_backend/Code.js`. Find:

Old:
```
    '{ "s": [ { "t": "Tool Name or Tool A + Tool B", "d": "Exactly 6 inspiring sentences tailored to THIS unit (slot 6: 4-5 sentences for the STEM project)." }, ... 6 items ] }';
```

New:
```
    '{ "s": [ { "t": "Tool Name (or \\"Minecraft: <Title>\\" / \\"Micro:bit: <Title>\\" when picking a library lesson)", "d": "Exactly 6 inspiring sentences tailored to THIS unit (slot 6: 4-5 sentences for the STEM project)." }, ... 6 items ] }';
```

- [ ] **Step 5: Grep for residual App-Smash language inside the function.**

Run Grep with pattern `App.Smash|Tool A . Tool B|\+ Tool` in `gas_backend/Code.js`, with `-C 2` context, head_limit 20. Confirm the matches inside `inspiringBuildPrompt_` (3903-3935 range) are zero. Matches elsewhere (auditPlanners, Surgeon, recovery functions) are expected — those are removed in later tasks.

- [ ] **Step 6: Commit.**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: inspiringBuildPrompt_ drops App Smash + injects lesson libraries

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 4: Rewrite `auditPlanners` prompt — drop App Smash, relax lesson rule

`auditPlanners` is the legacy 6-sentence generator. Same surgery as Task 3 plus migrating its existing strict Minecraft/Micro:bit rule to the new helper.

**Files:**
- Modify: `gas_backend/Code.js` lines ~1030-1208

- [ ] **Step 1: Read the auditPlanners region.**

Use Read on `gas_backend/Code.js` at offset 1025, limit 200.

- [ ] **Step 2: Replace the inline library load with the helper call.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
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
```

New (same indentation, single helper call):
```js
    libraryText += inspiringLessonsLibraryText_();
```

Note: there's a wrapping `try { ... } catch (e) {` around this block at 1030-1041 — keep the try/catch wrapper since `inspiringLessonsLibraryText_` already has its own try, but the surrounding code may have additional state to protect. Leave the surrounding try/catch unchanged.

- [ ] **Step 3: Strip App Smash from the prompt body.**

Edit `gas_backend/Code.js`. Find:

Old:
```
TASK: Generate exactly 6 highly innovative suggestions for ${planner.yl}.
- Suggestions 1-5: Digital technology integrations. AT LEAST TWO MUST be an "App Smash".
- Suggestion 6: A Makerspace/STEM project (Physical-First focus).
```

New:
```
TASK: Generate exactly 6 highly innovative suggestions for ${planner.yl}.
- Suggestions 1-5: Single-tool digital technology integrations — one approved tool per slot.
- Suggestion 6: A Makerspace/STEM project (Physical-First focus).
```

- [ ] **Step 4: Strip the App Smash + title sync rules block.**

Edit `gas_backend/Code.js`. Find:

Old:
```
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
```

New:
```
RULES FOR SUGGESTIONS 1-5 (Digital):
- ONE TOOL PER SLOT: Each suggestion uses a single approved tool. No "+" pairings.
- WHITELIST: Only use tools from the APPROVED TOOLS list below. Do NOT use Google Streetview, Google Street View, Google Slides, Flip, or any other tool not explicitly listed.

NO DUPLICATE TOOLS (HARD RULE):
- Each of the 6 suggestions MUST use a DIFFERENT tool.
- Do NOT repeat the same tool (e.g. Canva, Book Creator) across multiple suggestions.
```

- [ ] **Step 5: Update the JSON schema string.**

Edit `gas_backend/Code.js`. Find:

Old:
```
      "t": "Tool Name (If App Smash, you MUST write Tool 1 + Tool 2)", 
```

New:
```
      "t": "Tool Name (or 'Minecraft: <Title>' / 'Micro:bit: <Title>' when picking a library lesson)", 
```

- [ ] **Step 6: Repeat library-helper migration for the Surgeon site (lines 1397-1408).**

Edit `gas_backend/Code.js`. Find the second copy of the same inline library load (around lines 1397-1408) and replace with `libraryText += inspiringLessonsLibraryText_();` using the same pattern as Step 2.

- [ ] **Step 7: Verify by grep.**

Run Grep with pattern `APP SMASH RULE|APP SMASH FORMAT|App Smash combinations|If App Smash, you MUST` in `gas_backend/Code.js`. Expected: zero matches.

- [ ] **Step 8: Commit.**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: auditPlanners + Surgeon prompts drop App Smash, use lesson helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 5: Delete the App Smash gate in `diversityValidateSugs_` + retry notes

**Files:**
- Modify: `gas_backend/Code.js` lines 3371-3373, 4629, 4785

- [ ] **Step 1: Read `diversityValidateSugs_`.**

Use Read on `gas_backend/Code.js` at offset 3357, limit 35.

- [ ] **Step 2: Delete the App Smash count check.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
  // >=2 App Smashes in slots 1-5
  const smashCount = sugs.slice(0, 5).filter(sg => /\+/.test(sg.t)).length;
  if (smashCount < 2) return { ok: false, reason: 'only ' + smashCount + ' App Smash(es) in slots 1-5 (need >=2)' };
  // Opener must not match a sibling opener
```

New:
```js
  // Opener must not match a sibling opener
```

- [ ] **Step 3: Strip the retry note at line 4629.**

Use Read on `gas_backend/Code.js` at offset 4625, limit 10 to confirm exact whitespace.

Edit `gas_backend/Code.js`. Find:

Old:
```
        retryNote = '\n\nRETRY ' + (attempt - 1) + ': Previous attempt failed validation (' + lastReason + '). Apply ALL constraints (tool whitelist, App Smash floor, no dup tools, opener differs from siblings, ~6 sentences per slot 1-5).' + toolReminder;
```

New:
```
        retryNote = '\n\nRETRY ' + (attempt - 1) + ': Previous attempt failed validation (' + lastReason + '). Apply ALL constraints (tool whitelist, no dup tools, opener differs from siblings, ~6 sentences per slot 1-5).' + toolReminder;
```

- [ ] **Step 4: Strip the duplicate retry note at line ~4785.**

Use Read on `gas_backend/Code.js` at offset 4780, limit 10. Apply the same edit as Step 3 (the string is identical at both sites; use `replace_all: true` on the Edit if you're confident both occurrences are within `gas_backend/Code.js` and identical).

- [ ] **Step 5: Verify.**

Run Grep with pattern `App Smash floor|smashCount < 2|>=2 App Smash` in `gas_backend/Code.js`. Expected: zero matches.

- [ ] **Step 6: Commit.**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: drop App Smash gate from diversityValidateSugs_ + retry notes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 6: Strip the Surgeon partner-preservation branch + post-Surgeon re-queue

**Files:**
- Modify: `gas_backend/Code.js` lines 1436-1467, 1493-1565

- [ ] **Step 1: Read the Surgeon detection + post-swap region.**

Use Read on `gas_backend/Code.js` at offset 1432, limit 45.

- [ ] **Step 2: Simplify the banned-tool detection to drop combo extraction.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
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
```

New:
```js
      if (toolName.includes(banned)) {
        Logger.log(`Found "${bannedTool}" in [${planner.ca}] ${planner.yl} — ${planner.th}`);
        const otherToolsInPlanner = planner.s
          .filter((s, idx) => idx !== j && s && s.t)
          .map(s => s.t);
        let newIdea = callOpenAIWithRetry(planner, planner.s[j].t, yearGuidance, replacementTool, otherToolsInPlanner, 1);
```

- [ ] **Step 3: Delete the post-Surgeon App Smash re-queue.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
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
```

New: (delete the entire block; immediate next line in the file remains the surrounding `if (needsSave) { … }` block).

- [ ] **Step 4: Simplify `callOpenAIWithRetry` signature.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
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
```

New:
```js
function callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt) {
  attempt = attempt || 1;
  let replacementInstruction = forcedReplacement
    ? `You MUST use "${forcedReplacement}" as the replacement tool.`
    : `Choose the best replacement from the approved list.\n${yearGuidance}`;

  const otherToolsList = (otherToolsInPlanner && otherToolsInPlanner.length)
    ? `\nTOOLS ALREADY USED IN THIS UNIT — DO NOT PICK ANY OF THESE: ${otherToolsInPlanner.join(', ')}`
    : '';

  const responseShape = `{"t": "Tool Name", "d": "Specific description for this unit.", "url": "https://..."}`;

  let prompt = `You are a Digital Learning Coach at Wesley College.\n${getApprovedToolsPrompt_()}\n${REALISTIC_TOOL_USE_RULES}\nReplace "${oldTool}" for this unit:\nCampus: ${planner.ca} | Year: ${planner.yl} | Theme: "${planner.th}"\n${planner.plannerText ? `Unit summary: ${planner.plannerText}` : ''}${otherToolsList}\n${replacementInstruction}\nThe description must be highly innovative, exciting, and connect specifically to this unit's content. Use standard apostrophes (') only.\nReturn ONLY JSON: ${responseShape}`;
```

- [ ] **Step 5: Remove the combo-enforcement validator branch inside the retry loop.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
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
```

New:
```js
      if (parsed && parsed.t && otherToolsInPlanner && otherToolsInPlanner.length) {
        const parsedKey = toolKey_(parsed.t);
        const hasDupe = parsedKey && otherToolsInPlanner.some(t => toolKey_(t) === parsedKey);
        if (hasDupe && attempt <= 3) { Utilities.sleep(3000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1); }
        if (hasDupe) return null;
      }
```

- [ ] **Step 6: Update the recursive call inside the realism-retry branch.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
        if (!realism.ok) {
          if (attempt <= 3) { Utilities.sleep(3000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1, comboPartner); }
          return null;
        }
```

New:
```js
        if (!realism.ok) {
          if (attempt <= 3) { Utilities.sleep(3000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1); }
          return null;
        }
```

- [ ] **Step 7: Update the HTTP-retry recursive call.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
    if (isRetriableHttpCode_(code) && attempt <= 3) {
      if (code === 429) setCooldown_(2, 'OpenAI rate limit during Surgeon replacement');
      Utilities.sleep(30000);
      return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1, comboPartner);
    }
```

New:
```js
    if (isRetriableHttpCode_(code) && attempt <= 3) {
      if (code === 429) setCooldown_(2, 'OpenAI rate limit during Surgeon replacement');
      Utilities.sleep(30000);
      return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1);
    }
```

- [ ] **Step 8: Update the catch-block recursive call.**

Edit `gas_backend/Code.js`. Find:

Old:
```js
  } catch (e) {
    if (attempt <= 3) { Utilities.sleep(5000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1, comboPartner); }
  }
```

New:
```js
  } catch (e) {
    if (attempt <= 3) { Utilities.sleep(5000); return callOpenAIWithRetry(planner, oldTool, yearGuidance, forcedReplacement, otherToolsInPlanner, attempt + 1); }
  }
```

- [ ] **Step 9: Verify all `comboPartner` references are gone.**

Run Grep with pattern `comboPartner|comboInstruction|comboParts` in `gas_backend/Code.js`. Expected: zero matches.

- [ ] **Step 10: Commit.**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: strip Surgeon App Smash partner-preservation branch

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 7: Delete the App Smash recovery system

Four functions — `flagUnitsMissingAppSmashes`, `kickoffFullAppSmashRecovery`, `appSmashRecoveryTick`, `cleanupAppSmashRecoveryTrigger_` — and any leftover references.

**Files:**
- Modify: `gas_backend/Code.js` (delete contiguous regions at lines ~2049-2140 and ~3004-3105)

- [ ] **Step 1: Find exact boundaries.**

Run Grep with pattern `^function flagUnitsMissingAppSmashes|^function kickoffFullAppSmashRecovery|^function appSmashRecoveryTick|^function cleanupAppSmashRecoveryTrigger_` in `gas_backend/Code.js`, output_mode `content`, `-n true`. Note the four start lines.

- [ ] **Step 2: Read each function's bounds.**

For each function start line, read 100 lines forward to find the closing `}` at column 0 immediately followed by either a blank line + comment or the next `function` declaration. The four functions are contiguous-ish: `flagUnitsMissingAppSmashes` stands alone around 2049, then `kickoffFullAppSmashRecovery` + `appSmashRecoveryTick` + `cleanupAppSmashRecoveryTrigger_` form a contiguous block around 3004-3105.

- [ ] **Step 3: Delete `flagUnitsMissingAppSmashes` and its banner comment block.**

Use Read on `gas_backend/Code.js` at offset 2045, limit 95 to capture the exact contents and the preceding `// 2026-05-…` banner. Use Edit with `old_string` = the full function (including its leading comment banner and trailing blank line) and `new_string` = empty string (or a single newline if the surrounding context needs spacing).

- [ ] **Step 4: Delete the three-function recovery block.**

Use Read on `gas_backend/Code.js` (after the Task 3 deletion, line numbers have shifted) — re-find the start of `kickoffFullAppSmashRecovery` via Grep, then read forward until the closing `}` of `cleanupAppSmashRecoveryTrigger_`. Edit to remove the entire region including the banner comments at the top.

- [ ] **Step 5: Search for any remaining references.**

Run Grep with pattern `flagUnitsMissingAppSmashes|kickoffFullAppSmashRecovery|appSmashRecoveryTick|cleanupAppSmashRecoveryTrigger_` in `gas_backend/Code.js`. Expected: zero matches.

- [ ] **Step 6: Commit.**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: delete App Smash recovery system (4 functions, ~175 lines)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 8: Add `inspiringFindUnitsWithAppSmashes_` + `regenerateAllInspiringSweepAppSmashes`

**Files:**
- Modify: `gas_backend/Code.js` — append helpers near the other Inspiring helpers (around the `inspiringCandidateIndexes_` function, ~line 4462)

- [ ] **Step 1: Locate insertion point.**

Run Grep with pattern `^function regenerateAllInspiringReset` in `gas_backend/Code.js`, output_mode `content`, `-n true`. Insert the new functions just above it (so they sit alongside the other sweep-related helpers).

- [ ] **Step 2: Insert finder + wrapper.**

Edit `gas_backend/Code.js`. Find:

```js
function regenerateAllInspiringReset(opts) {
```

Replace with:

```js
// 2026-05-27: One-time sweep helper. Returns the indices of every unit
// whose slots 1-5 contain any "+" in `s[i].t` — i.e. a legacy App Smash
// suggestion that needs to be regenerated under the new single-tool rule.
// Slot 6 (STEM) is intentionally excluded; it was never an App Smash slot.
function inspiringFindUnitsWithAppSmashes_(data) {
  const out = [];
  if (!Array.isArray(data)) return out;
  for (let i = 0; i < data.length; i++) {
    const u = data[i];
    if (!u || !Array.isArray(u.s)) continue;
    for (let s = 0; s < 5 && s < u.s.length; s++) {
      const sg = u.s[s];
      if (sg && typeof sg.t === 'string' && sg.t.indexOf('+') !== -1) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}

// 2026-05-27: Wrapper that targets the App Smash sweep through the existing
// regenerateAllInspiring batch infrastructure. Builds the index list once,
// then delegates. Reuses the existing per-unit timestamp marker, snapshot
// discipline, abort hook, and status endpoint.
function regenerateAllInspiringSweepAppSmashes(opts) {
  opts = opts || {};
  const data = loadDataJson_();
  const indices = inspiringFindUnitsWithAppSmashes_(data);
  if (!indices.length) {
    return { allDone: true, processed: 0, attempted: 0, errors: [], message: 'No App Smash units found.' };
  }
  return regenerateAllInspiring(Object.assign({}, opts, { indices: indices }));
}

function regenerateAllInspiringReset(opts) {
```

Note: `loadDataJson_` is assumed available (it's used throughout the existing Inspire infra). If the exact helper name differs, mirror whatever `regenerateAllInspiring` itself calls on its first line to get the planner array.

- [ ] **Step 3: Verify `loadDataJson_` exists.**

Run Grep with pattern `function loadDataJson_|function loadData_|getDataJson_` in `gas_backend/Code.js`. If the data-load helper has a different name, adjust the wrapper to use it. (Most likely name based on existing patterns: `loadDataJson_` — but confirm before pushing.)

- [ ] **Step 4: Verify the new functions land in the file.**

Run Grep with pattern `inspiringFindUnitsWithAppSmashes_|regenerateAllInspiringSweepAppSmashes` in `gas_backend/Code.js`. Expected: two function definition matches.

- [ ] **Step 5: Wire the wrapper into the doPost router.**

Run Grep with pattern `case 'regenerateAllInspiring'|case 'regenerateallinspiring'` in `gas_backend/Code.js` to find the existing dispatch. Add an adjacent case for the new action name `regenerateallinspiringsweepappsmashes`. Pattern:

```js
case 'regenerateallinspiring':
  // existing call …
  break;

case 'regenerateallinspiringsweepappsmashes':
  return jsonResponse_(regenerateAllInspiringSweepAppSmashes(body));
```

Match the existing case's response-wrapping convention exactly — copy the shape of the `regenerateAllInspiring` case rather than inventing a new pattern.

- [ ] **Step 6: Commit.**

```bash
git add gas_backend/Code.js
git commit -m "gas_backend: add App Smash sweep helpers + route action

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 9: Delete frontend App Smash helpers + constants

**Files:**
- Modify: `js/00-config-state-utils.js` lines ~168-292, 320-341

- [ ] **Step 1: Read the App Smash region.**

Use Read on `js/00-config-state-utils.js` at offset 165, limit 180.

- [ ] **Step 2: Delete `STRONG_PAIRING_EXAMPLES`, `APP_SMASH_REQUIREMENT`, `appSmashCountInRegen_`, `appSmashRequirementForEntry_`, `siblingOverusedComponentsForEntry_`.**

Edit `js/00-config-state-utils.js`. Find the contiguous block starting with the banner comment `// 2026-05-22: Hard rule injected into every Bulk regen prompt …` (~line 168) and ending with the closing `}` of `appSmashRequirementForEntry_` (~line 292). Delete entirely.

Also find the separate `siblingOverusedComponentsForEntry_` function (~line 320-341) and its banner comment — delete (it was only used by `appSmashRequirementForEntry_`).

Keep: `componentDupesInRegen_` (lines 223-257) — defensive code still relevant during the transition. Keep: `siblingOpenersForEntry_` (lines 298-312) — still used by `openerDupesSiblingInYear_`. Keep: `openerDupesSiblingInYear_` (lines 347-353) — opener-uniqueness check is independent of App Smash.

- [ ] **Step 3: Verify.**

Run Grep with pattern `STRONG_PAIRING_EXAMPLES|APP_SMASH_REQUIREMENT|appSmashCountInRegen_|appSmashRequirementForEntry_|siblingOverusedComponentsForEntry_` in `js/`. Expected: zero matches.

- [ ] **Step 4: Smoke-test the Studio.**

Open `DLA_Studio.html` in a browser. Wait for the Studio to load (sign in if prompted). Open the browser console and confirm no `ReferenceError` for the deleted identifiers.

- [ ] **Step 5: Commit.**

```bash
git add js/00-config-state-utils.js
git commit -m "Studio: delete App Smash prompt constant + helpers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 10: Strip App Smash from `js/05-bulk-setup-libraries.js`

**Files:**
- Modify: `js/05-bulk-setup-libraries.js` lines ~639-733

- [ ] **Step 1: Strip the encouragement block in `buildGASRules`.**

Edit `js/05-bulk-setup-libraries.js`. Find:

Old:
```
✓ APP SMASHES ARE ENCOURAGED:
- Combining two approved tools in a single suggestion is valued.
- Format app smashes in the "t" field with a " + " separator, e.g. "Delightex + Puppet Pals", or as "Seesaw (App Smash with PicCollage)".
- BOTH tools in an app smash must be on the approved list above and inside the year-level range.
- Never include a prohibited tool (ChatGPT etc.) in an app smash.

```

New: (delete the entire block — leave a single blank line separator before `${buildDynamicToolAgeGuide()}`).

- [ ] **Step 2: Drop the `appSmashRequirementForEntry_` call in `fixAllOfType`.**

Edit `js/05-bulk-setup-libraries.js`. Find:

Old:
```js
      const appSmashBlock = appSmashRequirementForEntry_(e);
      if(type==='incomplete'){
        prompt=`${buildGASRules(e.yl)}\n\nGenerate exactly 5 digital technology suggestions for this IB PYP unit.\nCampus: ${e.ca} | Year: ${e.yl} | Theme: "${e.th}"${e.ci?`\nCentral Idea: "${e.ci}"`:''}${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\n${appSmashBlock}\nReturn ONLY JSON array: [{"t":"Tool Name or Tool A + Tool B","d":"Specific description for this unit."},...]`;

      } else if(type==='banned'||type==='offwhitelist'){
        prompt=`${buildGASRules(e.yl)}\n\nReplace these non-approved suggestions for this unit. Return 6 total suggestions (the 6th must be a STEM Design Cycle activity).\nUnit: ${e.ca} | ${e.yl} | "${e.th}"${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nCurrent suggestions (keep ones that are approved AND already App Smashes, replace the rest):\n${currentSugs.map((s,i)=>`${i+1}. ${sugTool(s)}: ${sugDesc(s)}`).join('\n')}\n${appSmashBlock}\nReturn ONLY JSON array of exactly 6 (the 6th must be a STEM Design Cycle activity): [{"t":"Tool Name or Tool A + Tool B","d":"Specific description."},...]`;

      } else if(type==='duplicate'){
        prompt=`${buildGASRules(e.yl)}\n\nFix duplicate tools in this unit — each suggestion must use a DIFFERENT tool.\nUnit: ${e.ca} | ${e.yl} | "${e.th}"${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nCurrent suggestions (fix any duplicates, keep unique ones; preserve any existing App Smashes):\n${currentSugs.map((s,i)=>`${i+1}. ${sugTool(s)}: ${sugDesc(s)}`).join('\n')}\n${appSmashBlock}\nReturn ONLY JSON array of exactly 6 (the 6th must be a STEM Design Cycle activity) with NO repeated tools: [{"t":"Tool Name or Tool A + Tool B","d":"Specific description."},...]`;
      }
```

New:
```js
      if(type==='incomplete'){
        prompt=`${buildGASRules(e.yl)}\n\nGenerate exactly 5 digital technology suggestions for this IB PYP unit.\nCampus: ${e.ca} | Year: ${e.yl} | Theme: "${e.th}"${e.ci?`\nCentral Idea: "${e.ci}"`:''}${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nEvery suggestion uses ONE approved tool (no "+" pairings). All 5 must use DIFFERENT tools.\nReturn ONLY JSON array: [{"t":"Tool Name","d":"Specific description for this unit."},...]`;

      } else if(type==='banned'||type==='offwhitelist'){
        prompt=`${buildGASRules(e.yl)}\n\nReplace these non-approved suggestions for this unit. Return 6 total suggestions (the 6th must be a STEM Design Cycle activity).\nUnit: ${e.ca} | ${e.yl} | "${e.th}"${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nCurrent suggestions (keep approved ones; replace the rest with a single-tool suggestion):\n${currentSugs.map((s,i)=>`${i+1}. ${sugTool(s)}: ${sugDesc(s)}`).join('\n')}\nEvery suggestion uses ONE approved tool (no "+" pairings). All 6 must use DIFFERENT tools.\nReturn ONLY JSON array of exactly 6 (the 6th must be a STEM Design Cycle activity): [{"t":"Tool Name","d":"Specific description."},...]`;

      } else if(type==='duplicate'){
        prompt=`${buildGASRules(e.yl)}\n\nFix duplicate tools in this unit — each suggestion must use a DIFFERENT tool.\nUnit: ${e.ca} | ${e.yl} | "${e.th}"${e.plannerText?`\nPlanner: ${e.plannerText}`:''}\nCurrent suggestions:\n${currentSugs.map((s,i)=>`${i+1}. ${sugTool(s)}: ${sugDesc(s)}`).join('\n')}\nEvery suggestion uses ONE approved tool (no "+" pairings). All 6 must use DIFFERENT tools.\nReturn ONLY JSON array of exactly 6 (the 6th must be a STEM Design Cycle activity) with NO repeated tools: [{"t":"Tool Name","d":"Specific description."},...]`;
      }
```

- [ ] **Step 3: Strip the App Smash branches from the retry loop.**

Edit `js/05-bulk-setup-libraries.js`. Find:

Old:
```js
      let sugs = null;
      let lastSmashCount = 0;
      let lastDupOpener = '';
      let lastDupComponent = '';
      let lastFailReason = '';
      for(let attempt=0; attempt<3; attempt++){
        let retryNote = '';
        if(attempt>0 && lastFailReason === 'smash'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response had only ${lastSmashCount} App Smash${lastSmashCount===1?'':'es'} in slots 1-5. You MUST return at least 2 entries whose "t" field uses the "Tool A + Tool B" format. Both tools must be approved and age-appropriate.`;
        } else if(attempt>0 && lastFailReason === 'opener-dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response used "${lastDupOpener}" as the slot-1 App Smash, but another unit in this campus + year level already opens with that exact pair. Slot 1 MUST be a DIFFERENT App Smash pair that specifically suits THIS unit's theme.`;
        } else if(attempt>0 && lastFailReason === 'component-dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response reused "${lastDupComponent}" across slots 1-5 (either appearing in two different slots, or paired with itself as "${lastDupComponent} + ${lastDupComponent}"). Every tool component may appear AT MOST ONCE in slots 1-5, and both halves of every "+" pair MUST be DIFFERENT tools.`;
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
        const compDup = componentDupesInRegen_(parsed);
        if(compDup){
          lastDupComponent = compDup;
          lastFailReason = 'component-dup';
          if(attempt >= 2) throw new Error(`Tool component "${lastDupComponent}" kept repeating across slots 1-5 after 3 attempts`);
          continue;
        }
        lastSmashCount = appSmashCountInRegen_(parsed);
        if(lastSmashCount < 2){ lastFailReason = 'smash'; if(attempt < 2) continue; }
        const openerDup = openerDupesSiblingInYear_(e, parsed);
        if(openerDup){ lastDupOpener = openerDup; lastFailReason = 'opener-dup'; if(attempt < 2) continue; }
        sugs = parsed;
        break;
      }
      if(!sugs) throw new Error(
        lastFailReason === 'component-dup' ? `Tool component "${lastDupComponent}" kept repeating across slots 1-5 after 3 attempts`
        : lastFailReason === 'opener-dup' ? `Opener stayed identical to a sibling unit ("${lastDupOpener}") after 3 attempts`
        : `AI never met the >=2 App Smash floor (last attempt: ${lastSmashCount})`);
      if(appSmashCountInRegen_(sugs) < 2) throw new Error(`Refusing to save — only ${appSmashCountInRegen_(sugs)} App Smash${appSmashCountInRegen_(sugs)===1?'':'es'} in slots 1-5`);
```

New:
```js
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
```

- [ ] **Step 4: Verify.**

Run Grep with pattern `appSmashCountInRegen_|appSmashRequirementForEntry_|App Smash|App.Smash` in `js/05-bulk-setup-libraries.js`. Expected: zero matches.

- [ ] **Step 5: Commit.**

```bash
git add js/05-bulk-setup-libraries.js
git commit -m "Studio: strip App Smash from bulk fix-all retry loop

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 11: Strip App Smash from `js/08-export-sync-hotfixes.js`

The bulk regen helpers `runBulkRegen` (~line 60-124) and `scanAndFixComponentDupes` (~line 171-260) have parallel App Smash retry logic. Apply the same pattern as Task 10.

**Files:**
- Modify: `js/08-export-sync-hotfixes.js` lines ~60-260, plus dead regex parsers at 952-955

- [ ] **Step 1: Strip App Smash from `runBulkRegen` prompt + retry.**

Edit `js/08-export-sync-hotfixes.js`. Find the prompt template at line ~67-73 and the retry block at line ~75-113. Apply the same pattern as Task 10 Step 2-3: drop `appSmashRequirementForEntry_(e)`, drop the `lastSmashCount` / `lastFailReason === 'smash'` branches, replace the schema with single-tool guidance, simplify the throw message.

Old prompt:
```js
    const prompt=`Generate exactly 6 digital technology suggestions for this IB PYP unit at Wesley College (Microsoft school).
Campus: ${e.ca} | Year Level: ${e.yl} | Theme: "${e.th}"${e.ci?`\nCentral Idea: "${e.ci}"`:''}${e.plannerText?`\nPlanner context: ${e.plannerText}`:''}
All 6 suggestions MUST use DIFFERENT tools
Suggestion #6 MUST be a STEM Design Cycle activity (Empathise → Define → Ideate → Prototype → Test) that connects specifically to the unit theme — no duplicates.
${SUGGESTION_STYLE}
${appSmashRequirementForEntry_(e)}
Return ONLY a JSON array: [{"t":"Tool Name or Tool A + Tool B","d":"2-3 vivid sentences for this unit."},...]`;
```

New prompt:
```js
    const prompt=`Generate exactly 6 digital technology suggestions for this IB PYP unit at Wesley College (Microsoft school).
Campus: ${e.ca} | Year Level: ${e.yl} | Theme: "${e.th}"${e.ci?`\nCentral Idea: "${e.ci}"`:''}${e.plannerText?`\nPlanner context: ${e.plannerText}`:''}
Every suggestion uses ONE approved tool (no "+" pairings). All 6 suggestions MUST use DIFFERENT tools.
Suggestion #6 MUST be a STEM Design Cycle activity (Empathise → Define → Ideate → Prototype → Test) that connects specifically to the unit theme — no duplicates.
${SUGGESTION_STYLE}
Return ONLY a JSON array: [{"t":"Tool Name","d":"2-3 vivid sentences for this unit."},...]`;
```

Then in the retry loop (~lines 75-113), replace:

Old:
```js
      let sugs = null;
      let dupedTool = null;
      let lastSmashCount = 0;
      let lastDupOpener = '';
      let lastDupComponent = '';
      let lastFailReason = '';
      for(let attempt=0; attempt<3; attempt++){
        let retryNote = '';
        if(attempt>0 && lastFailReason === 'dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response used "${dupedTool}" twice. Every one of the 6 suggestions MUST use a DIFFERENT tool. #6 must be a STEM Design Cycle activity.`;
        } else if(attempt>0 && lastFailReason === 'smash'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response had only ${lastSmashCount} App Smash${lastSmashCount===1?'':'es'} in slots 1-5. You MUST return at least 2 entries whose "t" field uses the "Tool A + Tool B" format.`;
        } else if(attempt>0 && lastFailReason === 'opener-dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response used "${lastDupOpener}" as the slot-1 App Smash, but another unit in this campus + year level already opens with that exact pair. Slot 1 MUST be a DIFFERENT App Smash pair that specifically suits THIS unit's theme.`;
        } else if(attempt>0 && lastFailReason === 'component-dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response reused "${lastDupComponent}" across slots 1-5 (either appearing in two different slots, or paired with itself as "${lastDupComponent} + ${lastDupComponent}"). Every tool component may appear AT MOST ONCE in slots 1-5, and both halves of every "+" pair MUST be DIFFERENT tools.`;
        }
        const raw=await callAI([{role:'user',parts:[{text:prompt+retryNote}]}],null,OPENAI_MODEL);
        const clean=raw.replace(/```json|```/g,'').trim();
        const si=clean.indexOf('['),ei=clean.lastIndexOf(']');
        if(si===-1||ei===-1) throw new Error('No JSON');
        const parsed=JSON.parse(clean.slice(si,ei+1));
        const keys=parsed.map(s=>toolKey(sugTool(s))).filter(Boolean);
        const dup=keys.find((k,i)=>keys.indexOf(k)!==i);
        if(dup){ const dupSug=parsed.find(s=>toolKey(sugTool(s))===dup); dupedTool = dupSug ? sugTool(dupSug) : dup; lastFailReason='dup'; continue; }
        const compDup = componentDupesInRegen_(parsed);
        if(compDup){ lastDupComponent = compDup; lastFailReason='component-dup'; continue; }
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
        : lastFailReason === 'component-dup' ? `Tool component "${lastDupComponent}" kept repeating across slots 1-5 after 3 attempts`
        : 'Duplicates in batch after retry');
```

New:
```js
      let sugs = null;
      let dupedTool = null;
      let lastDupOpener = '';
      let lastFailReason = '';
      for(let attempt=0; attempt<3; attempt++){
        let retryNote = '';
        if(attempt>0 && lastFailReason === 'dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response used "${dupedTool}" twice. Every one of the 6 suggestions MUST use a DIFFERENT tool. #6 must be a STEM Design Cycle activity.`;
        } else if(attempt>0 && lastFailReason === 'opener-dup'){
          retryNote = `\n\nRETRY ${attempt}: Your previous response used "${lastDupOpener}" as the slot-1 tool, but another unit in this campus + year level already opens with that tool. Slot 1 MUST be a DIFFERENT tool that specifically suits THIS unit's theme.`;
        }
        const raw=await callAI([{role:'user',parts:[{text:prompt+retryNote}]}],null,OPENAI_MODEL);
        const clean=raw.replace(/```json|```/g,'').trim();
        const si=clean.indexOf('['),ei=clean.lastIndexOf(']');
        if(si===-1||ei===-1) throw new Error('No JSON');
        const parsed=JSON.parse(clean.slice(si,ei+1));
        const keys=parsed.map(s=>toolKey(sugTool(s))).filter(Boolean);
        const dup=keys.find((k,i)=>keys.indexOf(k)!==i);
        if(dup){ const dupSug=parsed.find(s=>toolKey(sugTool(s))===dup); dupedTool = dupSug ? sugTool(dupSug) : dup; lastFailReason='dup'; continue; }
        const openerDup = openerDupesSiblingInYear_(e, parsed);
        if(openerDup){ lastDupOpener = openerDup; lastFailReason='opener-dup'; continue; }
        sugs = parsed;
        break;
      }
      if(!sugs) throw new Error(
        lastFailReason === 'opener-dup' ? `Opener stayed identical to a sibling unit ("${lastDupOpener}") after 3 attempts`
        : 'Duplicates in batch after retry');
```

Note: `componentDupesInRegen_` is dropped from this retry loop because the new prompt forbids `+` pairings entirely — the function only fires on `+`-split tool reuse. The existing `dup`-on-full-`t`-key check still catches single-tool duplicates.

- [ ] **Step 2: Apply the identical surgery to `scanAndFixComponentDupes`.**

The prompt template (~line 194-200) and retry block (~line 202-239) are near-duplicates of Step 1. Apply the same two edits:

Prompt — Old:
```js
    const prompt = `Generate exactly 6 digital technology suggestions for this IB PYP unit at Wesley College (Microsoft school).
Campus: ${e.ca} | Year Level: ${e.yl} | Theme: "${e.th}"${e.ci?`\nCentral Idea: "${e.ci}"`:''}${e.plannerText?`\nPlanner context: ${e.plannerText}`:''}
All 6 suggestions MUST use DIFFERENT tools
Suggestion #6 MUST be a STEM Design Cycle activity (Empathise → Define → Ideate → Prototype → Test) that connects specifically to the unit theme — no duplicates.
${SUGGESTION_STYLE}
${appSmashRequirementForEntry_(e)}
Return ONLY a JSON array: [{"t":"Tool Name or Tool A + Tool B","d":"2-3 vivid sentences for this unit."},...]`;
```

Prompt — New:
```js
    const prompt = `Generate exactly 6 digital technology suggestions for this IB PYP unit at Wesley College (Microsoft school).
Campus: ${e.ca} | Year Level: ${e.yl} | Theme: "${e.th}"${e.ci?`\nCentral Idea: "${e.ci}"`:''}${e.plannerText?`\nPlanner context: ${e.plannerText}`:''}
Every suggestion uses ONE approved tool (no "+" pairings). All 6 suggestions MUST use DIFFERENT tools.
Suggestion #6 MUST be a STEM Design Cycle activity (Empathise → Define → Ideate → Prototype → Test) that connects specifically to the unit theme — no duplicates.
${SUGGESTION_STYLE}
Return ONLY a JSON array: [{"t":"Tool Name","d":"2-3 vivid sentences for this unit."},...]`;
```

For the retry loop in `scanAndFixComponentDupes`, the structure is identical to `runBulkRegen`'s retry loop above — apply the same Old→New replacement verbatim. The replacement strips `lastSmashCount`, the `'smash'` branch, the `componentDupesInRegen_` call, the `'component-dup'` branch, and the corresponding throw arms.

**Decision (full amputation):** delete the entire `scanAndFixComponentDupes` apparatus rather than maintaining it. Its sole purpose was cleaning up legacy `+` component duplicates; after Task 15 sweeps, that data class no longer exists, and the new single-tool prompt cannot generate component-dup violations.

Delete from `js/08-export-sync-hotfixes.js`:
- `findComponentDupeTargets_` (~line 131-140)
- `renderComponentDupAuditList` (~line 142-169)
- `scanAndFixComponentDupes` (~line 171-260, the entire function whose retry loop you would otherwise have edited)

Then run Grep with pattern `findComponentDupeTargets_|renderComponentDupAuditList|scanAndFixComponentDupes|btn-component-dup-scan|btn-component-dup-fix|component-dup-audit` across `DLA_Studio.html` and `js/*.js`. For each remaining match, delete the calling code (HTML buttons, sidebar wiring, event handlers). Expected after cleanup: zero matches across the whole repo.

- [ ] **Step 3: Delete the dead `appSmashParen` / `appSmashPlus` regex parsers.**

Edit `js/08-export-sync-hotfixes.js`. Find:

Old:
```js
    var appSmashParen = text.match(/^(.+?)\s*\(\s*App\s*Smash\s+with\s+(.+?)\s*\)/i);
    var appSmashPlus = text.match(/^(.+?)\s*[+]\s*(.+?)\s+App\s*Smash/i);
    if(appSmashParen){
      parts = [appSmashParen[1].trim(), appSmashParen[2].trim()];
    } else if(appSmashPlus){
      parts = [appSmashPlus[1].trim(), appSmashPlus[2].trim()];
    } else if(/[&+]/.test(text)){
      parts = text.split(/\s*[&+]\s*/).map(function(t){ return t.trim(); }).filter(Boolean);
    } else {
```

New:
```js
    if(/[&+]/.test(text)){
      parts = text.split(/\s*[&+]\s*/).map(function(t){ return t.trim(); }).filter(Boolean);
    } else {
```

Keep the generic `[&+]` split — `auditToolParts_` is a defensive parser and the split path stays useful while legacy data is in flight during the cleanup sweep.

- [ ] **Step 4: Verify.**

Run Grep with pattern `appSmashCountInRegen_|appSmashRequirementForEntry_|appSmashParen|appSmashPlus|App Smash` in `js/08-export-sync-hotfixes.js`. Expected: zero matches.

- [ ] **Step 5: Commit.**

```bash
git add js/08-export-sync-hotfixes.js
git commit -m "Studio: strip App Smash from bulk-regen + scan-and-fix retry loops

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 12: Strip the `+` recursion in `normaliseToolName`

Once data is clean, the recursion-on-`+` branch in `normaliseToolName` is dead code. Removing it per the full-amputation philosophy.

**Files:**
- Modify: `js/06-bulk-router-chat.js` lines ~2213-2228

- [ ] **Step 1: Read the function.**

Use Read on `js/06-bulk-router-chat.js` at offset 2210, limit 30.

- [ ] **Step 2: Remove the `+` recursion branch.**

Edit `js/06-bulk-router-chat.js`. Find:

Old:
```js
function normaliseToolName(t){
  \ 2026-05-26: Compound App Smash tools ("Tool A + Tool B") must NOT be
  // truncated by the startsWith fallback patterns further down (e.g.
  // "Seesaw + Seesaw" was matching `startsWith('seesaw')` and collapsing to
  // just "Seesaw", which silently turned compound t-fields into duplicates
  // at load time via dqSanitiseDataSet_'s ingest hook). Recurse on each
  // component and rejoin.
  if(t){
    const raw0 = String(t).trim();
    if(raw0.indexOf('+') !== -1){
      const parts = raw0.split(/\s*\+\s*/).map(p => p.trim()).filter(Boolean);
      if(parts.length > 1){
        return parts.map(p => normaliseToolName(p)).filter(Boolean).join(' + ');
      }
    }
  }
  // Canonical forms for known variants
```

New:
```js
function normaliseToolName(t){
  // Canonical forms for known variants
```

⚠️ The first line `\ 2026-05-26:` in the original is a syntax bug (`\` instead of `//`) but only inside what JS treats as a regex/comment depending on parse. **Don't preserve it** — the new code drops it entirely.

- [ ] **Step 3: Run the cleanup pass first to confirm no `+` data remains** before deploying this change.

Note: defer the actual Edit + commit of this task until **after** Task 15 (the cleanup sweep) completes. Mark the Task 12 step list complete in plan-tracking only after the sweep has verified zero `+` entries.

- [ ] **Step 4: Commit (post-sweep).**

```bash
git add js/06-bulk-router-chat.js
git commit -m "Studio: remove dead + recursion in normaliseToolName

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 13: Add the "Sweep App Smashes" Studio button

Sit it next to the existing Inspire All button on the same card so progress UI is shared.

**Files:**
- Modify: `js/06-bulk-router-chat.js` — locate the Inspire All card HTML (the `inspireSummaryHtml` block around line 1242 and the original button rendering around line 1190-1244) and add a second button + handler

- [ ] **Step 1: Find the Inspire All button HTML.**

Run Grep with pattern `btn-inspire-all` in `js/06-bulk-router-chat.js`, output_mode `content`, `-n true`. Note the line where the button is rendered (it's used both for the existing button and the abort wiring).

- [ ] **Step 2: Add a count helper for the sweep target.**

Edit `js/06-bulk-router-chat.js`. Find a sensible insertion point near the other Inspire All helpers (search for `function runInspireAll` or similar). Insert:

```js
// 2026-05-27: Client-side mirror of inspiringFindUnitsWithAppSmashes_ —
// counts units whose slots 1-5 contain any "+" in t. Used to label the
// Sweep button and gate its enabled state.
function findAppSmashUnitsLocal_(){
  if(!Array.isArray(window.DATA)) return [];
  const out = [];
  for(let i=0; i<DATA.length; i++){
    const u = DATA[i];
    if(!u || !Array.isArray(u.s)) continue;
    for(let s=0; s<5 && s<u.s.length; s++){
      const sg = u.s[s];
      if(sg && typeof sg.t === 'string' && sg.t.indexOf('+') !== -1){ out.push(i); break; }
    }
  }
  return out;
}
```

- [ ] **Step 3: Add the Sweep button alongside the existing Inspire All button.**

Edit `js/06-bulk-router-chat.js`. Find the existing Inspire All button (e.g. `<button id="btn-inspire-all" …>`) and add the new Sweep button as an adjacent sibling. Use the same styling pattern. Wire its onclick to a new `runSweepAppSmashes()` handler defined below the existing `runInspireAll()` function.

The button label should include the live count, e.g.:

```js
const sweepCount = findAppSmashUnitsLocal_().length;
const sweepBtn = sweepCount
  ? `<button id="btn-sweep-appsmashes" onclick="runSweepAppSmashes()" style="…same as inspire-all but distinct colour…">🔥 Sweep App Smashes (${sweepCount})</button>`
  : '';
```

Inject `sweepBtn` into the card HTML next to the Inspire All button.

- [ ] **Step 4: Add `runSweepAppSmashes` handler.**

Edit `js/06-bulk-router-chat.js`. Find `runInspireAll` or wherever the Inspire All driver lives, and add immediately above/below it:

```js
async function runSweepAppSmashes(){
  const ca = document.getElementById('f-campus')?.value || '';
  const yr = document.getElementById('f-year')?.value || '';
  const targets = findAppSmashUnitsLocal_();
  if(!targets.length){ alert('No App Smash units found.'); return; }
  if(!confirm(`Regenerate ${targets.length} unit${targets.length===1?'':'s'} still holding App Smash suggestions?\n\n• Every "+" suggestion becomes a single-tool suggestion in the 6-sentence inspiring style.\n• Routed through the same regenerateAllInspiring pipeline as Inspire All — resumable if your laptop sleeps.\n• ~3 min per 12-unit batch; estimated total ${Math.ceil(targets.length / 12 * 3)} min.\n\nProceed?`)) return;

  const btn = document.getElementById('btn-sweep-appsmashes');
  if(btn) btn.disabled = true;
  await pollInspiringSweep_({ action: 'regenerateallinspiringsweepappsmashes', label: 'App Smash sweep' });
  if(btn) btn.disabled = false;
  renderDashboard();
}
```

Where `pollInspiringSweep_` is whatever shared polling helper `runInspireAll` already uses. If `runInspireAll`'s polling is inlined rather than extracted, **extract it now** to a shared helper named `pollInspiringSweep_(opts)` so both flows reuse it — that's a small refactor, but it keeps the new handler from re-implementing the batch loop.

- [ ] **Step 5: Smoke-test in Studio.**

Open `DLA_Studio.html` in a browser. Open the Bulk tab (or wherever Inspire All renders). Confirm the new "Sweep App Smashes (N)" button appears alongside Inspire All when N > 0, and that it shows no count or is hidden when N = 0. **Do not click it yet** — that's Task 15.

- [ ] **Step 6: Commit.**

```bash
git add js/06-bulk-router-chat.js
git commit -m "Studio: add Sweep App Smashes button next to Inspire All

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 14: Deploy backend + push static site

**Files:** none (deploy step)

- [ ] **Step 1: Push the gas_backend project to head.**

```bash
cd "c:/Users/BennN/OneDrive - Wesley College/Documents/DLA_Workspace/digital-learning-assistant-v2/gas_backend"
clasp push
```

Expected: `Pushed N files.`

- [ ] **Step 2: List deployments to find the pinned ID.**

```bash
clasp deployments
```

Expected output shape: `-- 1 - @HEAD\n- AKfycb… 12 - <description>`. Note the deployment ID of the version pinned to the public `/exec` URL (the one with a description like "DLA backend v…" — anything except `@HEAD`).

- [ ] **Step 3: Bump the pinned deployment to head.**

```bash
clasp deploy --deploymentId <ID_FROM_STEP_2> --description "Tech suggestion reboot: drop App Smash, restore lesson libraries"
```

Expected: `Created version <N>` then `Deployed <ID> @<N>`.

- [ ] **Step 4: Confirm Studio still loads.**

Open `DLA_Studio.html` in a browser (or visit the live Pages URL). Check the browser console for errors. Sign in if prompted. Confirm the Inspire All card renders with the new "Sweep App Smashes" button.

- [ ] **Step 5: No commit needed.**

Static-site changes are already pushed by their per-task git operations. The deploy step doesn't introduce new files locally.

---

## Task 15: Run the cleanup sweep + verify

**Files:** none (runtime step)

- [ ] **Step 1: Trigger a manual data.json snapshot from Studio.**

In DLA Studio, find the snapshot/backup action (Studio sidebar → "Create Snapshot" or similar — search the UI for a backup button). Trigger it. This is the rollback safety net.

- [ ] **Step 2: Click "Sweep App Smashes".**

In Studio → Inspire All card → click the new "🔥 Sweep App Smashes (N)" button. Confirm the dialog. The card switches to in-flight progress UI identical to Inspire All.

- [ ] **Step 3: Wait for completion.**

Each 12-unit batch is ~3 min. The Studio polls every ~30s. Don't close the tab; if the laptop sleeps, the per-unit `inspiringRegenAt` marker means re-clicking the button resumes from where it stopped.

- [ ] **Step 4: Verify zero App Smashes remain.**

After the card shows "Sweep complete":

```javascript
// In the Studio browser console:
DATA.filter(u => Array.isArray(u.s) && u.s.slice(0, 5).some(sg => sg && typeof sg.t === 'string' && sg.t.indexOf('+') !== -1)).length
```

Expected: `0`.

- [ ] **Step 5: Spot-check 5-10 freshly regenerated units.**

In Studio, navigate to a campus + year level. Open a unit. Confirm:
- All 6 suggestions are present.
- Slots 1-5 each have a single tool name (no `+`).
- Slot 6 is a STEM Design Cycle activity.
- Each `d` is roughly 6 sentences in inspiring prose.
- For Year 3+ units, check whether Minecraft or Micro:bit suggestions surface — when they do, the title is either `Minecraft: <Title>` / `Micro:bit: <Title>` (library lesson, with URL in sentence 1) or just `Minecraft Education` / `Micro:bit` (custom UOI activity).

- [ ] **Step 6: Verify on the public site.**

Visit the deployed GitHub Pages URL (`https://wesdlpteam.github.io/digital-learning-assistant-v2/`). Browse a Year 4-6 unit. Confirm the rendered suggestions look right and any Minecraft / Micro:bit lesson URLs are clickable.

- [ ] **Step 7: Run Task 12 now** (the `normaliseToolName` `+`-recursion removal). With zero `+` data remaining, that branch is verifiably dead. Complete Task 12's steps 2 + 4 (the deferred Edit + commit + push).

---

## Task 16: Memory update + status pin

Capture the outcome in memory so future sessions know the reboot landed.

**Files:**
- Create: `C:\Users\BennN\.claude\projects\c--Users-BennN-OneDrive---Wesley-College-Documents-DLA-Workspace\memory\project_dla_tech_suggestions_reboot.md`
- Modify: `C:\Users\BennN\.claude\projects\c--Users-BennN-OneDrive---Wesley-College-Documents-DLA-Workspace\memory\MEMORY.md` (add one index line)

- [ ] **Step 1: Write the memory file.**

```markdown
---
name: project-dla-tech-suggestions-reboot
description: Tech suggestion corpus rebooted 2026-05-27 — App Smash rule removed everywhere; Minecraft/Micro:bit lesson library injection restored in the 6-sentence prompt with two-mode (library lesson OR custom UOI activity) wording.
metadata:
  type: project
---

The DLA tech suggestion pipeline was rebooted on 2026-05-27. Every "Tool A + Tool B" App Smash was removed from data.json via a one-time Inspire-All-powered sweep. The App Smash rule was deleted from every prompt, validator, retry loop, and the entire recovery system (4 backend functions + frontend helpers in 00/05/08).

**Why:** The user's observation was that single-tool 6-sentence suggestions worked great and App Smash suggestions were where output stopped making sense. The rule had also accumulated significant maintenance cost (opener bias 2026-05-25, intra-unit dup 2026-05-26, 239-suggestion wipe 2026-05-20, scheduled recovery loop).

**How to apply:**
- Do not reintroduce App Smash language in any new prompt or validator.
- Minecraft / Micro:bit suggestions can now appear as either `Minecraft: <Library Title>` (preferred when a library lesson fits) or `Minecraft Education` (custom UOI activity). The audit-side normaliser collapses both to "Minecraft Education" already.
- The Sweep button on the Inspire All card stays in place as a safety net for any future stray `+` data — if a future regen ever produces `+`, clicking it will clean up.

Related: [[project-dla-app-smash-regression]], [[project-dla-app-smash-opener-bias]], [[project-dla-app-smash-intra-unit-dup]] — all obsoleted by this reboot.
```

- [ ] **Step 2: Update `MEMORY.md` index.**

Edit `MEMORY.md` (in the auto-memory directory). Add this line in topical order (project memories cluster together):

```
- [DLA tech suggestions reboot — App Smash removed](project_dla_tech_suggestions_reboot.md) — 2026-05-27: every "+" entry swept, lesson libraries restored in 6-sentence prompt.
```

- [ ] **Step 3: Optionally mark related memories obsolete.**

Edit the three superseded memory files (`project_dla_app_smash_regression.md`, `project_dla_app_smash_opener_bias.md`, `project_dla_app_smash_intra_unit_dup.md`) — append a note at the top: `**SUPERSEDED 2026-05-27** by [[project-dla-tech-suggestions-reboot]] — App Smash rule retired entirely.`

- [ ] **Step 4: No git commit needed for memory files** (memory lives outside the repo).

---

## Final verification checklist

After all tasks complete, run these three commands and confirm the expected output:

```bash
cd "c:/Users/BennN/OneDrive - Wesley College/Documents/DLA_Workspace/digital-learning-assistant-v2"

# 1. No App Smash language survives in source
grep -rE 'App[ _]?Smash|appSmashCount|appSmashRequirement|appSmashRecovery|comboPartner' \
  gas_backend/Code.js js/*.js
# Expected: zero output

# 2. No live `+` data in data.json
node -e "const d=JSON.parse(require('fs').readFileSync('data.json'));console.log(d.filter(u=>Array.isArray(u.s)&&u.s.slice(0,5).some(s=>s&&typeof s.t==='string'&&s.t.includes('+'))).length)"
# Expected: 0

# 3. Lesson helper is called from both 6-sentence prompts
grep -n 'inspiringLessonsLibraryText_' gas_backend/Code.js
# Expected: 3 matches (helper definition + 2 call sites)
```

If any check fails, the corresponding task wasn't complete — go back and re-run the verification step.
