function askNextClarification(){
  const remaining = bulkChatContext.pendingQuestions || [];
  if(!remaining.length){
    runStartBulkAnalysisSafely_();
    return;
  }
  const q = remaining.shift();
  if(!q.options.some(o => o.value === '__proceed__')){
    q.options.push({ label: 'Just go ahead', value: '__proceed__' });
  }
  bulkChatAddMessage('assistant', q.text, q.options);
}

function bulkInstructionIsDescriptionOnly_(text){
  const t = String(text || '').toLowerCase();
  const hasDescriptionQualitySignal = /(vague|brief|too\s*short|short\s*description|thin|generic|weak|weakly|lacks?\s+(?:a\s+)?concrete|concrete\s+student\s+action|student\s+action|student\s+product|student\s+output|needs?\s+(?:more\s+)?detail|bulk\s+up|make\s+.*(?:more\s+)?specific|add\s+detail|improve\s+(?:the\s+)?description|strengthen\s+(?:the\s+)?description|unit\s+connection|connection\s+to\s+the\s+unit|connect\s+.*unit|clearer\s+connection|better\s+connected|less\s+generic)/i.test(t);
  if(!hasDescriptionQualitySignal) return false;
  const asksForDifferentTools = /(diversif|replace\s+.*\s+with\s+other|swap\s+.*\s+with|different\s+(?:app|apps|tool|tools)|new\s+(?:app|apps|tool|tools)|opportunit(?:y|ies)\s+to\s+use|find\s+opportunit)/i.test(t);
  return !asksForDifferentTools;
}

function weakDescriptionTarget_(entry, sug, sugIdx, instruction){
  if(!entry || !sug || sugIdx === 5) return null;
  const desc = String(sugDesc(sug) || '').replace(/\s+/g,' ').trim();
  const tool = sugTool(sug);
  if(!tool || !desc) return null;
  const issues = suggestionAuditIssues(entry, sug, sugIdx).filter(i => ['vague','thin','connection'].includes(i.type));
  const weakPatterns = [
    /research online/i, /look up/i, /google (this|it)/i,
    /type (your|the)/i, /write (about|up)/i,
    /use (the|a) (app|tool|program)/i,
    /simply|basically|just to/i
  ];
  if(desc.length < 95 && issues.length === 0){
    issues.push({type:'thin', severity:'low', message:'Description is very short; it may need more practical detail.'});
  }
  if(weakPatterns.some(p => p.test(desc))){
    issues.push({type:'generic', severity:'medium', message:'Description uses generic wording and needs a clearer student task/product.'});
  }
  if(!issues.length) return null;
  return { issues, reason: issues.map(i=>i.message).join(' | ') };
}

async function buildSameToolDescriptionRewriteChange_(entryIdx, sugIdx, reason, instruction){
  const entry = DATA[entryIdx];
  const oldSug = getSugs(entry)[sugIdx];
  const oldTool = sugTool(oldSug);
  const oldDesc = sugDesc(oldSug);
  const safeToolForJson = JSON.stringify(String(oldTool || '')).slice(1, -1);
  const plannerCtx = entry.plannerContextRich || entry.plannerText || '';
  const prompt = `You are improving the wording of ONE digital learning suggestion for an IB PYP unit at Wesley College.

IMPORTANT: This is a DESCRIPTION-ONLY fix. Keep the SAME tool exactly: ${oldTool}
Do NOT suggest a different app, platform, device, or tool.
Keep the same basic classroom task unless the old task is unclear; make it more concrete rather than replacing it.

Unit: ${entry.ca} | ${entry.yl} | "${entry.th}"
Central Idea: ${entry.ci || ''}
Lines of Inquiry: ${entry.lo || ''}
Planner context: ${plannerCtx ? plannerCtx.slice(0, 1500) : 'No planner context available.'}

Issue to fix: ${reason || instruction || 'The description is vague or too brief.'}
Current tool: ${oldTool}
Current description: ${oldDesc}

Rewrite the description into ~6 vivid, practical sentences (target 500-800 characters) that follow the DESCRIPTION QUALITY RULES below. The central idea, lines of inquiry, and planner context above tell you what the unit is ABOUT — use that topic by name in your description, but NEVER quote the central idea or lines of inquiry directly.

${SUGGESTION_STYLE}

Return ONLY JSON: {"t":"${safeToolForJson}","d":"Improved description using the same tool."}`;

  const raw = await callAI([{role:'user', parts:[{text:prompt}]}], null, OPENAI_FAST_MODEL || OPENAI_MODEL);
  const clean = raw.replace(/```json|```/g,'').trim();
  const si = clean.indexOf('{'), ei = clean.lastIndexOf('}');
  if(si === -1 || ei === -1) throw new Error('AI did not return JSON.');
  const parsed = JSON.parse(clean.slice(si, ei + 1));
  const newDesc = String(parsed.d || parsed.desc || parsed.description || '').trim();
  if(!newDesc) throw new Error('AI returned an empty description.');
  if(newDesc.replace(/\s+/g,' ').trim() === String(oldDesc || '').replace(/\s+/g,' ').trim()){
    throw new Error('AI returned the same description.');
  }
  return {
    entryIdx,
    sugIdx,
    t: oldTool,
    d: newDesc,
    auditReason: reason || 'Description-only improvement requested.',
    auditSource: 'bulk-same-tool-description-rewrite',
    improvementConfidence: 'Description-only',
    improvementScore: 4,
    whyBetter: 'Keeps the same tool and adds clearer student action, product and unit connection.',
    remainingConcern: ''
  };
}

async function runBulkSameToolDescriptionRewrite_(enrichedInstruction, completeData, prog, lbl, bar){
  updateReasoningStep(0, 'done');
  updateReasoningStep(1, 'done');
  updateReasoningStep(2, 'done');
  updateReasoningStep(3, 'done');
  updateReasoningStep(4, 'active', 'Rewriting weak descriptions with the same tools');
  if(lbl) lbl.textContent = 'Finding vague / brief descriptions and keeping the same tools…';
  if(bar) bar.style.width = '25%';

  const targets = [];
  completeData.forEach(({e,i}) => {
    getSugs(e).forEach((sug, sugIdx) => {
      const target = weakDescriptionTarget_(e, sug, sugIdx, enrichedInstruction);
      if(target) targets.push({entryIdx:i, sugIdx, reason:target.reason});
    });
  });

  if(!targets.length){
    if(prog) prog.style.display = 'none';
    updateReasoningStep(4, 'done');
    setTimeout(hideReasoningSteps, 800);
    if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')){
      bulkChatHistory.pop();
    }
    bulkChatAddMessage('assistant', '✓ I could not find any non-STEM suggestions that are currently vague, brief, generic, or weakly connected.');
    bulkChatState = 'idle';
    stopProgress();
    return true;
  }

  const cap = Math.min(targets.length, 35);
  const changes = [];
  const failures = [];
  for(let i=0; i<cap; i++){
    const t = targets[i];
    const pct = Math.round(((i+1)/cap)*100);
    if(bar) bar.style.width = `${25 + Math.round(pct*0.65)}%`;
    if(lbl) lbl.textContent = `${i+1}/${cap}: bulking up same-tool description…`;
    try{
      const change = await buildSameToolDescriptionRewriteChange_(t.entryIdx, t.sugIdx, t.reason, enrichedInstruction);
      changes.push(change);
    }catch(err){
      failures.push({target:t, error:err.message});
    }
    if(i < cap-1) await sleep(350);
  }

  if(prog) prog.style.display = 'none';
  updateReasoningStep(4, 'done');
  updateReasoningStep(5, 'done');
  setTimeout(hideReasoningSteps, 1200);
  if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')){
    bulkChatHistory.pop();
  }

  if(changes.length){
    const cappedNote = targets.length > cap ? `<br><span style="font-size:12px;color:var(--dim)">I drafted the first ${cap} of ${targets.length} matching description fixes to avoid overloading the AI. Apply these, rescan, then run it again for the rest.</span>` : '';
    const failNote = failures.length ? `<br><span style="font-size:12px;color:#F5A623">${failures.length} draft${failures.length!==1?'s':''} failed and were skipped.</span>` : '';
    bulkChatAddMessage('assistant', `✅ <strong>${changes.length} same-tool description improvement${changes.length!==1?'s':''}</strong> ready for review.<br><br>These keep the original app/tool and only bulk up the description with clearer student action, product and unit connection.${cappedNote}${failNote}`);
    bulkChatMemory.push({ role:'assistant', content:`Proposed ${changes.length} same-tool description rewrites.` });
    window._snapshotReason = `Before same-tool description rewrites`;
    showChangesPopup(changes);
    bulkChatState = 'done';
  } else {
    const first = failures[0]?.error || 'No usable drafts were returned.';
    bulkChatAddMessage('assistant', `⚠️ I found ${targets.length} possible description-only targets, but could not draft usable same-tool rewrites. First issue: ${esc(first)}`);
    bulkChatState = 'idle';
  }
  stopProgress();
  return true;
}




// ========== TARGETED TOOL REMOVAL / REPLACEMENT FLOW ==========
// Handles requests such as "replace Seesaw in Year 5 and 6" or
// "remove all Seesaw suggestions from Years 5/6". The generic Bulk AI flow
// was too conservative for this because it scanned the whole library and often
// returned only a few replacements. This flow first finds every matching slot
// locally, then drafts one replacement per matching slot.
function bulkInstructionLooksLikeToolRemoval_(instruction){
  const t = String(instruction || '').toLowerCase();
  return /\b(replace|replaced|replacing|swap\s*out|swap|swapped|remove|removed|removing|get\s+rid\s+of|phase\s*out|stop\s+using|no\s+more|instead\s+of|change\s+all|change\s+the)\b/i.test(t);
}

function bulkDetectRemovalTool_(instruction){
  const text = String(instruction || '').toLowerCase().replace(/[’']/g, '');
  if(!bulkInstructionLooksLikeToolRemoval_(text)) return '';
  const aliases = {
    'seesaw':'Seesaw',
    'book creator':'Book Creator',
    'bookcreator':'Book Creator',
    'canva':'Canva',
    'padlet':'Padlet',
    'adobe express podcasting':'Podcasting using Canva',
    'adobe podcast':'Podcasting using Canva',
    'podcasting':'Podcasting using Canva',
    'podcasting using canva':'Podcasting using Canva',
    'canva podcast':'Podcasting using Canva',
    'canva podcasting':'Podcasting using Canva',
    'animating a character with adobe express':'Animating a Character with Adobe Express',
    'adobe express animate from audio':'Animating a Character with Adobe Express',
    'animate from audio':'Animating a Character with Adobe Express',
    'adobe express character animator':'Animating a Character with Adobe Express',
    'character animator':'Animating a Character with Adobe Express',
    'animate character':'Animating a Character with Adobe Express',
    'microbit':'Micro:bit',
    'micro bit':'Micro:bit',
    'micro:bit':'Micro:bit',
    'minecraft':'Minecraft Education',
    'minecraft education':'Minecraft Education',
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

function bulkSuggestionUsesTool_(sug, toolName){
  const wanted = toolInventoryKey(toolName);
  if(!wanted) return false;
  const raw = sugTool(sug);
  if(toolInventoryKey(raw) === wanted) return true;
  return proposalToolParts(raw).some(part => toolInventoryKey(part) === wanted);
}

function bulkInstructionTargetsToolRemoval_(instruction){
  return !!bulkDetectRemovalTool_(instruction);
}

// ========== DIVERSIFY FLOW ==========
// Detects "Diversify Seesaw suggestions across the library" (fired by the
// dashboard insight tile when a tool is overused, or typed directly into the
// Bulk chat) and routes it to runBulkDiversifyFlow_ below. Distinct from the
// removal flow because "diversify" misses the replace/swap/remove verbs the
// removal detector requires; previously it fell through to the generic
// GPT-4.1 flow which returned ~3 conservative proposals and often used the
// same replacement tool for every entry.
function bulkInstructionTargetsDiversify_(instruction){
  const text = String(instruction || '').toLowerCase().replace(/[’']/g, '');
  if(!/\b(?:diversif|spread\s+(?:out\s+)?the\s+use\s+of|reduce\s+the\s+use\s+of)\b/i.test(text)) return '';
  // Reuse bulkDetectRemovalTool_'s alias scanner by prepending a removal verb
  // so its existing alias map (Seesaw, Book Creator, Canva, Padlet, Micro:bit,
  // Adobe Express, Sphero, Wise, etc.) fires.
  return bulkDetectRemovalTool_('replace ' + text);
}

async function runBulkDiversifyFlow_(toolName, completeData, prog, lbl, bar){
  updateReasoningStep(0, 'done');
  updateReasoningStep(1, 'done');
  updateReasoningStep(2, 'done');
  updateReasoningStep(3, 'done');
  updateReasoningStep(4, 'active', `Drafting diverse replacements for ${toolName}`);
  if(lbl) lbl.textContent = `Finding every entry that uses ${toolName}…`;
  if(bar) bar.style.width = '15%';

  // 1) Every non-STEM slot currently using toolName.
  const candidates = [];
  completeData.forEach(({ e, i }) => {
    getSugs(e).forEach((sug, si) => {
      if(si === 5) return;
      if(!isRealSug(sug)) return;
      if(bulkSuggestionUsesTool_(sug, toolName)){
        candidates.push({ entryIdx: i, entry: e, sugIdx: si, sug });
      }
    });
  });

  if(!candidates.length){
    if(prog) prog.style.display = 'none';
    updateReasoningStep(4, 'done');
    setTimeout(hideReasoningSteps, 600);
    bulkChatAddMessage('assistant', `✓ I could not find any non-STEM suggestions currently using <strong>${esc(toolName)}</strong> to diversify.`);
    bulkChatState = 'idle';
    stopProgress();
    return true;
  }

  // 2) Library-wide tool frequency to define the underused pool.
  const toolEntryCount = {};
  completeData.forEach(({ e }) => {
    const seen = new Set();
    getSugs(e).filter(isRealSug).forEach(s => {
      const k = toolInventoryKey(sugTool(s));
      if(!k || seen.has(k)) return;
      seen.add(k);
      toolEntryCount[k] = (toolEntryCount[k] || 0) + 1;
    });
  });

  // 3) Build an age-appropriate underused pool spanning the year levels we saw.
  const yearSet = new Set();
  candidates.forEach(c => yearSet.add(c.entry.yl));
  const pooledTools = new Set();
  yearSet.forEach(yl => {
    const list = (typeof getAgeAppropriateTools === 'function') ? (getAgeAppropriateTools(yl) || []) : [];
    list.forEach(t => pooledTools.add(t));
  });
  const targetKey = toolInventoryKey(toolName);
  // Eligibility filter only — age-appropriate, not the target tool itself,
  // not banned or forbidden. No usage threshold here.
  const eligible = Array.from(pooledTools).filter(t => {
    const k = toolInventoryKey(t);
    if(!k || k === targetKey) return false;
    if(typeof toolContainsForbiddenKeyword === 'function' && toolContainsForbiddenKeyword(t)) return false;
    if(typeof toolViolatesInventoryBan === 'function' && toolViolatesInventoryBan(t)) return false;
    return true;
  });
  // Rank ascending by current library usage and take the bottom 60% as the
  // diverse pool, with a hard floor of 8 tools. The previous binary
  // "used <=2 times" filter often left only 1-2 survivors in libraries where
  // the popular tools dominate, which let the round-robin plan every swap
  // with the same single survivor (Nathan saw "5 swaps, all Animating a
  // Character with Adobe Express"). Dynamic ranking keeps the pool meaningful
  // while still preferring the truly underused tools first.
  const ranked = eligible
    .map(t => ({ t, count: toolEntryCount[toolInventoryKey(t)] || 0 }))
    .sort((a, b) => a.count - b.count);
  const poolCutoff = Math.max(8, Math.ceil(ranked.length * 0.6));
  const underused = ranked.slice(0, poolCutoff).map(r => r.t);

  if(!underused.length){
    if(prog) prog.style.display = 'none';
    updateReasoningStep(4, 'done');
    setTimeout(hideReasoningSteps, 600);
    bulkChatAddMessage('assistant', `⚠️ I found ${candidates.length} ${esc(toolName)} slot${candidates.length!==1?'s':''}, but no age-appropriate underused tools are available in the Tool Inventory to swap in. Check the inventory for ${esc(toolName)}'s typical year levels.`);
    bulkChatState = 'idle';
    stopProgress();
    return true;
  }

  // 4) Round-robin assign replacement tools across the batch so we don't get
  //    "Canva 10 times in a row" — every underused tool gets used in turn
  //    before any is repeated. Skips tools already present in each entry.
  const shuffled = (arr => {
    const a = arr.slice();
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  })(underused);
  const usageCount = new Map();
  shuffled.forEach(t => usageCount.set(toolInventoryKey(t), 0));

  const plan = [];
  candidates.forEach(c => {
    const usedInEntry = new Set(getSugs(c.entry).map(s => toolInventoryKey(sugTool(s))).filter(Boolean));
    const picks = shuffled
      .filter(t => !usedInEntry.has(toolInventoryKey(t)))
      .sort((a, b) => (usageCount.get(toolInventoryKey(a)) || 0) - (usageCount.get(toolInventoryKey(b)) || 0));
    const replacement = picks[0];
    if(replacement){
      usageCount.set(toolInventoryKey(replacement), (usageCount.get(toolInventoryKey(replacement)) || 0) + 1);
      plan.push({ ...c, newTool: replacement });
    }
  });

  if(!plan.length){
    if(prog) prog.style.display = 'none';
    updateReasoningStep(4, 'done');
    setTimeout(hideReasoningSteps, 600);
    bulkChatAddMessage('assistant', `⚠️ I found ${candidates.length} ${esc(toolName)} slot${candidates.length!==1?'s':''}, but every age-appropriate underused tool is already used in those same entries. Check the Tool Inventory.`);
    bulkChatState = 'idle';
    stopProgress();
    return true;
  }

  // 5) Cap per click so we don't kick off ~80 AI calls in one go.
  const PER_BATCH_CAP = 35;
  const toDraft = plan.slice(0, PER_BATCH_CAP);
  const cappedNote = plan.length > toDraft.length
    ? `<br><span style="font-size:12px;color:var(--dim)">I drafted the first ${toDraft.length} of ${plan.length} diversify swaps to avoid overloading the AI. Apply these, then re-run “Diversify ${esc(toolName)}” for the rest.</span>` : '';

  // 6) One AI call per swap to write the 6-sentence description for the new tool.
  const changes = [];
  const failures = [];
  for(let i = 0; i < toDraft.length; i++){
    const sw = toDraft[i];
    const pct = Math.round(((i + 1) / toDraft.length) * 100);
    if(bar) bar.style.width = `${15 + Math.round(pct * 0.75)}%`;
    if(lbl) lbl.textContent = `${i + 1}/${toDraft.length}: ${sw.entry.yl} — ${sw.entry.th} — ${toolName} → ${sw.newTool}`;
    try {
      const entry = sw.entry;
      const plannerCtx = entry.plannerContextRich || entry.plannerText || '';
      const yl = entry.yl || '';
      const constraintBlock = (typeof buildToolConstraints === 'function') ? buildToolConstraints(yl) : '';
      const prompt = `You are a Digital Learning Coach at Wesley College (IB PYP, Melbourne).
Rewrite this technology suggestion for a different tool to broaden tool variety across the library.

UNIT: ${entry.th || ''}
YEAR LEVEL: ${yl}
CAMPUS: ${entry.ca || ''}
${plannerCtx ? 'PLANNER CONTEXT: ' + plannerCtx.slice(0, 8000) : ''}

OLD TOOL: ${toolName}
OLD DESCRIPTION: ${sugDesc(sw.sug)}

NEW TOOL TO USE: ${sw.newTool}
${constraintBlock}

${SUGGESTION_STYLE}

Write ONE JSON object: {"t":"${sw.newTool}","d":"..."}
The description must be for ${sw.newTool} specifically, naming its real features and concrete student actions, following all writing-style and depth rules above.
Return ONLY the JSON object, no markdown fences, no extra text.`;
      const raw = await callAI([{ role: 'user', parts: [{ text: prompt }] }], '', OPENAI_FAST_MODEL || OPENAI_MODEL);
      const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
      const si = cleaned.indexOf('{'), ei = cleaned.lastIndexOf('}');
      if(si === -1 || ei === -1) throw new Error('AI did not return JSON.');
      const parsed = JSON.parse(cleaned.slice(si, ei + 1));
      if(!parsed.t || !parsed.d) throw new Error('AI returned malformed JSON (missing t or d).');
      const change = {
        entryIdx: sw.entryIdx,
        sugIdx: sw.sugIdx,
        t: parsed.t,
        d: parsed.d,
        auditReason: `Diversify ${toolName} (currently overused) — swap to ${sw.newTool} for variety.`,
        auditSource: 'bulk-chat-diversify',
        improvementConfidence: 'Diversify swap',
        improvementScore: 4,
        whyBetter: `Replaces ${toolName} with ${sw.newTool}, which is currently underused across the library.`,
        remainingConcern: ''
      };
      if(parsed.url) change.url = parsed.url;
      changes.push(change);
    } catch(err){
      failures.push({ swap: sw, error: err && err.message ? err.message : String(err) });
    }
    if(i < toDraft.length - 1) await sleep(350);
  }

  if(prog) prog.style.display = 'none';
  updateReasoningStep(4, 'done');
  updateReasoningStep(5, 'done');
  setTimeout(hideReasoningSteps, 1200);
  if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length - 1].content.includes('Analysing all entries')){
    bulkChatHistory.pop();
  }

  if(changes.length){
    const spread = {};
    changes.forEach(c => { spread[c.t] = (spread[c.t] || 0) + 1; });
    const spreadStr = Object.entries(spread)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${esc(t)} (${n})`)
      .join(', ');
    const failNote = failures.length ? `<br><span style="font-size:12px;color:#F5A623">${failures.length} swap${failures.length!==1?'s':''} failed and were skipped.</span>` : '';
    const poolPreview = underused.slice(0, 10).map(t => esc(t)).join(', ');
    const poolMoreNote = underused.length > 10 ? ` (+${underused.length - 10} more)` : '';
    bulkChatAddMessage('assistant', `🎯 <strong>Diversify flow</strong> — ${changes.length} swap${changes.length!==1?'s':''} ready for review.<br><br>Replacement spread: ${spreadStr}.<br><span style="font-size:12px;color:var(--dim)">Underused pool considered (least-used first): ${poolPreview}${poolMoreNote}.</span>${cappedNote}${failNote}`);
    bulkChatMemory.push({ role: 'assistant', content: `Proposed ${changes.length} diversify swaps for ${toolName}.` });
    window._snapshotReason = `Before diversifying ${toolName} (${changes.length} swaps)`;
    showChangesPopup(changes);
    bulkChatState = 'done';
  } else {
    const first = (failures[0] && failures[0].error) || 'No usable drafts were returned.';
    bulkChatAddMessage('assistant', `⚠️ I planned ${plan.length} ${esc(toolName)} swap${plan.length!==1?'s':''}, but could not draft usable replacements. First issue: ${esc(first)}`);
    bulkChatState = 'idle';
  }
  stopProgress();
  return true;
}

function bulkReplacementToolContext_(toolName){
  const t = toolInventoryKey(toolName);
  if(t === toolInventoryKey('Seesaw')){
    return 'The existing suggestion uses Seesaw. Replace it with a different tool that creates a richer Year 5/6 learning product. Do not use Seesaw again.';
  }
  return `The existing suggestion uses ${toolName}. Replace it with a different age-appropriate tool that better fits the unit. Do not use ${toolName} again.`;
}

function fallbackReplacementDescription_(entry, newTool, oldTool){
  const unit = cleanSuggestionText_(entry?.th || 'this unit');
  const ci = cleanSuggestionText_(entry?.ci || 'the central idea');
  const tool = cleanSuggestionText_(newTool || 'the selected tool');
  if(/book creator/i.test(tool)) return `Students use ${tool} to create a short multimodal book that explains one key idea from “${unit}” using text, images and voice recording. They include a page that connects their evidence back to the central idea: ${ci}.`;
  if(/canva|adobe express/i.test(tool)) return `Students use ${tool} to design a clear visual explanation connected to “${unit}”, combining concise text, images and labelled evidence. They share the finished design with a partner and explain how it connects to the central idea: ${ci}.`;
  if(/padlet|freeform/i.test(tool)) return `Students use ${tool} to collect, sort and connect examples from “${unit}” on a shared digital board. They add short notes explaining the pattern they notice and how it links to the central idea: ${ci}.`;
  if(/wise/i.test(tool)) return `Students use ${tool} to question a named virtual expert connected to “${unit}”, testing their thinking with prompts about evidence, perspectives and possible action. They turn the strongest ideas from the conversation into a short exit ticket or claim-evidence-reasoning response linked to ${ci}.`;
  if(/microsoft forms|forms/i.test(tool)) return `Students use ${tool} to design a short class survey connected to “${unit}” and collect responses from peers. They analyse the results and write a brief finding that explains what the data suggests about the central idea: ${ci}.`;
  if(/excel/i.test(tool)) return `Students use ${tool} to organise class data connected to “${unit}” in a simple table and chart. They interpret the chart by writing one evidence-based conclusion linked to the central idea: ${ci}.`;
  if(/google earth|google maps/i.test(tool)) return `Students use ${tool} to map places or examples connected to “${unit}” and add short annotations explaining each connection. They present the map as a guided tour that shows how location, evidence or perspective supports the central idea: ${ci}.`;
  return `Students use ${tool} to create a practical learning artefact connected to “${unit}” instead of using ${oldTool}. They include evidence from the unit and a short explanation of how their product connects to the central idea: ${ci}.`;
}

async function buildToolReplacementChange_(entryIdx, sugIdx, targetTool, instruction, freq){
  const entry = DATA[entryIdx];
  const currentSug = getSugs(entry)[sugIdx];
  const oldTool = sugTool(currentSug);
  const oldDesc = sugDesc(currentSug);
  let candidateTools = getRegenerateCandidateTools_(entry, currentSug, sugIdx, freq)
    .filter(t => toolInventoryKey(t) !== toolInventoryKey(targetTool))
    .filter(t => isAiToolSafeForEntry(t, entry))
    .filter(t => !wouldDupeToolProposalInEntry(entry, t, sugIdx));

  // Extra guard: when replacing Seesaw in upper primary, avoid swapping to another
  // low-value portfolio/capture tool unless the unit clearly calls for that format.
  if(toolInventoryKey(targetTool) === toolInventoryKey('Seesaw')){
    candidateTools = candidateTools.filter(t => !/seesaw/i.test(t));
  }

  candidateTools = candidateTools.slice(0, 16);
  if(!candidateTools.length) throw new Error(`No age-appropriate non-duplicate replacement tools available for ${entry.yl} ${entry.th}.`);

  const existingTools = getSugs(entry).map((s,i)=>i===sugIdx?null:sugTool(s)).filter(Boolean).join(', ');
  const candidatesKey = new Set(candidateTools.map(toolInventoryKey));
  let lastIssue = '';

  const promptBase = `You are a Digital Learning Coach at Wesley College.

Task: replace an existing ${targetTool} suggestion with a DIFFERENT tool.
${bulkReplacementToolContext_(targetTool)}

Unit: ${entry.ca} | ${entry.yl} | "${entry.th}"
Central Idea: ${entry.ci || ''}
Lines of Inquiry: ${entry.lo || ''}
Planner context: ${(entry.plannerContextRich || entry.plannerText) ? compactForPrompt(entry.plannerContextRich || entry.plannerText, 1200) : ''}

Current slot being replaced:
Tool: ${oldTool}
Description: ${oldDesc}

Other tools already in this unit, do not duplicate: ${existingTools || 'none'}

Allowed replacement tools for this exact slot:
${candidateTools.map(t => '- ' + t).join('\n')}

Hard rules:
- Choose exactly ONE tool from the allowed replacement tools list above.
- Do NOT use ${targetTool}, ${oldTool}, Seesaw, or any existing tool already in this unit.
- Do NOT target the STEM Design Cycle slot; this current slot is safe and already selected.
- Write ~6 vivid practical sentences (500-800 chars) following the DESCRIPTION QUALITY RULES below.
- Say exactly what students do, what students create/produce, and how it connects to the unit.
- Keep the wording clear for a primary teacher.
${SUGGESTION_STYLE}

Return ONLY JSON: {"t":"Tool Name from allowed list","d":"~6 vivid practical sentences (500-800 chars) following the writing-style and depth rules above."}`;

  for(let attempt=0; attempt<3; attempt++){
    try{
      const retry = lastIssue ? `\n\nRETRY because the previous answer was rejected: ${lastIssue}\nPick a DIFFERENT valid tool from this list only: ${candidateTools.join(', ')}` : '';
      const raw = await callAI([{role:'user', parts:[{text:promptBase + retry}]}], null, OPENAI_FAST_MODEL || OPENAI_MODEL);
      const clean = raw.replace(/```json|```/g,'').trim();
      const si = clean.indexOf('{'), ei = clean.lastIndexOf('}');
      if(si === -1 || ei === -1) throw new Error('AI did not return JSON.');
      const parsed = JSON.parse(clean.slice(si, ei + 1));
      const newTool = normaliseToolName(cleanSuggestionText_(parsed.t || parsed.tool || parsed.technology || ''));
      const newDesc = cleanSuggestionText_(parsed.d || parsed.desc || parsed.description || '');
      if(!newTool || !newDesc){ lastIssue = 'missing tool or description'; continue; }
      if(toolInventoryKey(newTool) === toolInventoryKey(targetTool) || toolInventoryKey(newTool) === toolInventoryKey(oldTool)){ lastIssue = `it reused ${targetTool}`; continue; }
      if(!candidatesKey.has(toolInventoryKey(newTool))){ lastIssue = `${newTool} was not in the allowed replacement list`; continue; }
      if(wouldDupeToolProposalInEntry(entry, newTool, sugIdx)){ lastIssue = `${newTool} already exists in this unit`; continue; }
      if(!isAiToolSafeForEntry(newTool, entry)){ lastIssue = `${newTool} is not age-appropriate or safe for ${entry.yl}`; continue; }
      const realism = checkRealisticToolUse(newTool, newDesc, entry);
      if(!realism.ok){ lastIssue = `${newTool} description failed realism check: ${realism.reason}`; continue; }
      return {
        entryIdx,
        sugIdx,
        t: newTool,
        d: newDesc,
        auditReason: `Targeted replacement: ${oldTool} removed from ${entry.yl}.`,
        auditSource: 'bulk-targeted-tool-replacement',
        improvementConfidence: 'Targeted replacement',
        improvementScore: 4,
        whyBetter: `Removes ${oldTool} from the selected year level and replaces it with a different age-appropriate tool connected to the unit.`,
        remainingConcern: ''
      };
    }catch(err){
      lastIssue = err.message || String(err);
    }
  }

  // Deterministic fallback: still produce a reviewable change rather than silently
  // offering only 1-2 replacements from a larger targeted set.
  const fallbackTool = candidateTools.find(t => !wouldDupeToolProposalInEntry(entry, t, sugIdx)) || candidateTools[0];
  return {
    entryIdx,
    sugIdx,
    t: fallbackTool,
    d: fallbackReplacementDescription_(entry, fallbackTool, oldTool),
    auditReason: `Targeted replacement: ${oldTool} removed from ${entry.yl}. Fallback drafted after AI retries.`,
    auditSource: 'bulk-targeted-tool-replacement-fallback',
    improvementConfidence: 'Needs human review',
    improvementScore: 3,
    whyBetter: `Removes ${oldTool} and gives the reviewer a concrete replacement to assess.`,
    remainingConcern: 'Fallback wording should be checked by a human before applying.'
  };
}

async function runBulkToolReplacementFlow_(enrichedInstruction, completeData, prog, lbl, bar){
  const targetTool = bulkDetectRemovalTool_(enrichedInstruction);
  if(!targetTool) return false;

  updateReasoningStep(0, 'done');
  updateReasoningStep(1, 'done');
  updateReasoningStep(2, 'done');
  updateReasoningStep(3, 'active', `Finding ${targetTool} suggestions to replace`);
  if(lbl) lbl.textContent = `Finding ${targetTool} suggestions to replace…`;
  if(bar) bar.style.width = '20%';

  const targetYears = bulkExtractTargetYears_(enrichedInstruction);
  const targets = [];
  let skippedYear = 0, skippedStem = 0;

  completeData.forEach(({e,i}) => {
    if(targetYears.length && !targetYears.includes(e.yl)){ skippedYear++; return; }
    getSugs(e).forEach((sug, sugIdx) => {
      if(!bulkSuggestionUsesTool_(sug, targetTool)) return;
      if(Number(sugIdx) === 5){ skippedStem++; return; }
      targets.push({entryIdx:i, sugIdx});
    });
  });

  const explicitCount = getBulkExplicitCount_(enrichedInstruction, null);
  const cap = explicitCount ? Math.min(explicitCount, targets.length, 45) : Math.min(targets.length, 45);
  const selected = targets.slice(0, cap);

  if(!selected.length){
    if(prog) prog.style.display = 'none';
    updateReasoningStep(3, 'done');
    setTimeout(hideReasoningSteps, 800);
    if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')) bulkChatHistory.pop();
    const yearText = targetYears.length ? ` in ${targetYears.join(', ')}` : '';
    const stemNote = skippedStem ? ` ${skippedStem} match${skippedStem!==1?'es were':' was'} in the protected STEM slot and was skipped.` : '';
    bulkChatAddMessage('assistant', `⚠️ I found no non-STEM ${esc(targetTool)} suggestions to replace${yearText}.${stemNote}`);
    bulkChatState = 'idle';
    stopProgress();
    return true;
  }

  const freq = {};
  DATA.forEach(e => getSugs(e).forEach(s => {
    const t = normaliseToolName((s && s.t ? s.t.trim() : sugTool(s)) || '');
    if(t) freq[t] = (freq[t] || 0) + 1;
  }));

  updateReasoningStep(3, 'done');
  updateReasoningStep(4, 'active', `Drafting ${selected.length} ${targetTool} replacement${selected.length!==1?'s':''}`);

  const changes = [];
  const failures = [];
  for(let idx=0; idx<selected.length; idx++){
    const t = selected[idx];
    if(bar) bar.style.width = `${25 + Math.round(((idx+1)/selected.length)*65)}%`;
    if(lbl) lbl.textContent = `${idx+1}/${selected.length}: drafting ${targetTool} replacement…`;
    try{
      const change = await buildToolReplacementChange_(t.entryIdx, t.sugIdx, targetTool, enrichedInstruction, freq);
      changes.push(change);
    }catch(err){
      failures.push({target:t, error:err.message || String(err)});
    }
    if(idx < selected.length - 1) await sleep(220);
  }

  if(bar) bar.style.width = '100%';
  if(prog) prog.style.display = 'none';
  updateReasoningStep(4, 'done');
  updateReasoningStep(5, 'done');
  setTimeout(hideReasoningSteps, 1200);
  if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')) bulkChatHistory.pop();

  if(changes.length){
    const yearText = targetYears.length ? ` in ${targetYears.join(', ')}` : '';
    const cappedNote = targets.length > selected.length ? `<br><span style="font-size:12px;color:var(--orange)">I found ${targets.length} matching ${targetTool} suggestions${yearText}, but drafted ${selected.length} this run to stay responsive. Apply these, then run again for the rest.</span>` : '';
    const stemNote = skippedStem ? `<br><span style="font-size:12px;color:var(--purple)">${skippedStem} ${targetTool} match${skippedStem!==1?'es were':' was'} in protected STEM Suggestion 6 and was left unchanged.</span>` : '';
    const failNote = failures.length ? `<br><span style="font-size:12px;color:#F5A623">${failures.length} replacement draft${failures.length!==1?'s':''} failed and were skipped.</span>` : '';
    const sample = changes.slice(0,5).map(c => { const e = DATA[c.entryIdx]; const old = getSugs(e)[c.sugIdx] ? sugTool(getSugs(e)[c.sugIdx]) : targetTool; return `• ${esc(e.yl)} ${esc(e.th)} — ${esc(old)} → ${esc(c.t)}`; }).join('<br>');
    bulkChatAddMessage('assistant', `✅ <strong>${changes.length} ${esc(targetTool)} replacement${changes.length!==1?'s':''}</strong> ready for review${yearText}.<br><br><span style="font-size:12px;color:var(--lime)">This targeted flow found the matching slots locally first, so it should not stop at 2 when there are more.</span>${cappedNote}${stemNote}${failNote}<br><br><span style="font-size:12px;color:var(--lime)">Sample:</span><br>${sample}${changes.length>5?'<br>• …':''}`);
    bulkChatMemory.push({ role:'assistant', content:`Proposed ${changes.length} targeted replacements for ${targetTool}.` });
    window._snapshotReason = `Before replacing ${targetTool}`;
    showChangesPopup(changes);
    bulkChatState = 'done';
  } else {
    const first = failures[0]?.error || 'No usable drafts were returned.';
    bulkChatAddMessage('assistant', `⚠️ I found ${selected.length} ${esc(targetTool)} target${selected.length!==1?'s':''}, but could not draft usable replacements. First issue: ${esc(first)}`);
    bulkChatState = 'idle';
  }
  stopProgress();
  return true;
}

function bulkInstructionTargetsWiseOpportunities_(instruction){
  const t = String(instruction || '').toLowerCase();
  const namesWise = /(wise\s+discussion|wise\s+chatbot|wise\s+chatbots|schoolbox.*(?:discussion|chatbot)|ai\s+discussion\s+chatbot|discussion\s+chatbot)/i.test(t);
  return namesWise && bulkInstructionLooksLikeOpportunity(t);
}

function getBulkExplicitCount_(instruction, fallback){
  const text = String(instruction || '');
  const patterns = [
    /\b(?:find|add|propose|suggest|need|want|get|give\s+me|identify|locate|spot|show\s+me|replace|remove|swap|change)\s+(?:at\s+least\s+|about\s+|around\s+|approximately\s+|up\s+to\s+|some\s+|more\s+|additional\s+|me\s+)?(\d{1,3})\b/i,
    /\b(\d{1,3})\s+(?:suggestions?|ideas?|lessons?|matches?|opportunities?)\b/i
  ];
  for(const re of patterns){
    const m = text.match(re);
    if(m){
      const n = Number(m[1]);
      if(Number.isFinite(n)) return Math.max(1, Math.min(n, 60));
    }
  }
  return fallback;
}
function instructionProtectsExistingTool_(instruction, toolName){
  const t = String(instruction || '').toLowerCase();
  const key = toolInventoryKey(toolName || '').toLowerCase();
  const names = new Set([key, String(toolName || '').toLowerCase()]);
  if(key === toolInventoryKey('Micro:bit').toLowerCase()) names.add('microbit'), names.add('micro bit'), names.add('micro:bit');
  if(key === toolInventoryKey('Minecraft Education').toLowerCase()) names.add('minecraft'), names.add('minecraft education');
  if(key === toolInventoryKey('Wise Discussion Chatbots').toLowerCase()) names.add('wise'), names.add('wise discussion chatbots'), names.add('discussion chatbots');
  const hasProtectPhrase = /(do\s*not|don't|never|avoid|without|but\s+not|not\s+replace|don't\s+replace|do\s+not\s+replace|leave|keep|preserve|protect)/i.test(t);
  if(!hasProtectPhrase) return false;
  return [...names].some(n => n && t.includes(n));
}

function entryAlreadyHasTool_(entry, toolName){
  const wanted = toolInventoryKey(toolName);
  return getSugs(entry).some(s => toolInventoryKey(sugTool(s)) === wanted || wouldDupeToolProposalInEntry(entry, toolName, -1));
}

function wiseScenarioForEntry_(entry){
  const text = unitContextTextForRealism(entry).toLowerCase();
  if(/(histor|perspective|persona|character|leader|community member|first nations|migration|settlement|explorer|interview|point of view|viewpoint|rights|responsibilit|culture|identity)/i.test(text)){
    return 'Character Interview';
  }
  if(/(design|prototype|solution|innovation|invent|create|project|action|sustainab|entrepreneur|campaign|proposal|improve|change|future|problem)/i.test(text)){
    return 'Project Ideation';
  }
  if(/(wellbeing|identity|growth|learning|goal|reflection|self|emotion|friendship|belong|mindset|strength|challenge|choice)/i.test(text)){
    return 'Self-Reflection';
  }
  return 'Socratic Tutor';
}

function wiseTopicForEntry_(entry){
  const theme = String(entry?.th || 'this unit').trim();
  const ci = String(entry?.ci || '').replace(/^['"]|['"]$/g,'').trim();
  if(ci && ci.length < 170) return `${theme}: ${ci}`;
  return theme;
}

function wiseCandidateSlotScore_(entry, sug, sugIdx, instruction){
  if(!entry || !sug || Number(sugIdx) === 5) return -9999;
  const existingTool = sugTool(sug);
  const existingKey = toolInventoryKey(existingTool);
  if(existingKey === toolInventoryKey('Wise Discussion Chatbots')) return -9999;
  if(instructionProtectsExistingTool_(instruction, 'Micro:bit') && existingKey === toolInventoryKey('Micro:bit')) return -9999;
  if(instructionProtectsExistingTool_(instruction, 'Minecraft Education') && existingKey === toolInventoryKey('Minecraft Education')) return -9999;

  const desc = String(sugDesc(sug) || '').replace(/\s+/g,' ').trim();
  const issues = (typeof suggestionAuditIssues === 'function') ? suggestionAuditIssues(entry, sug, sugIdx) : [];
  let score = 0;
  const typeSet = new Set(issues.map(i => i.type));
  if(typeSet.has('vague') || typeSet.has('thin') || typeSet.has('connection') || typeSet.has('generic')) score += 8;
  if(desc.length < 90) score += 5;
  if(!/(create|produce|record|build|design|publish|share|capture|explain|compare|reflect|draft|prototype|present|map|model|question|interview)/i.test(desc)) score += 3;

  const commonTool = toolInventoryKey(existingTool).toLowerCase();
  if(['seesaw','book creator','canva','padlet','adobe express','microsoft sway','sway','microsoft powerpoint','powerpoint'].some(k => commonTool.includes(k))) score += 4;
  if(/worksheet|research|poster|presentation|reflection/i.test(desc)) score += 2;

  // Do not eagerly displace curated/hands-on tools unless the slot is clearly weak.
  if(/micro:?bit|minecraft|sphero|lego spike|codrone|3d printer|tinkercad/i.test(existingTool)) score -= 4;
  if(sug.url) score -= 2;
  return score;
}

function chooseWiseReplacementSlot_(entry, instruction){
  let best = null;
  getSugs(entry).forEach((sug, sugIdx) => {
    const score = wiseCandidateSlotScore_(entry, sug, sugIdx, instruction);
    if(score <= -999) return;
    if(!best || score > best.score){
      best = {sugIdx, score, oldTool:sugTool(sug), oldDesc:sugDesc(sug)};
    }
  });
  return best;
}

function wiseSpecificPersonaForEntry_(entry, scenario){
  const text = unitContextTextForRealism(entry).toLowerCase();
  const theme = String(entry?.th || 'the unit').trim();

  if(scenario === 'Character Interview'){
    if(/adapt|survival|habitat|ecosystem|biodiversity|sustainab|environment|living thing|species|animal|plant|climate|water|ocean|pollution|waste|sharing the planet/i.test(text)){
      return {
        name: 'Dr Maya Chen, a wildlife ecologist advising the class about local habitats',
        examples: '“Which adaptation would help this species survive a hotter summer?” and “What human action is putting this habitat under pressure?”'
      };
    }
    if(/celebration|tradition|culture|community|identity|express|family|heritage|ritual|festival|belief/i.test(text)){
      return {
        name: 'Ava, a community celebration organiser explaining why particular traditions matter to different families',
        examples: '“How does this celebration show what your community values?” and “What might outsiders misunderstand about this tradition?”'
      };
    }
    if(/history|migration|settlement|explorer|colony|past|timeline|change over time|first nations|indigenous|elder|ancestor/i.test(text)){
      return {
        name: 'Samira, a museum curator preparing an exhibition about lived experiences from this period',
        examples: '“What object would you place in the exhibition and why?” and “Whose perspective is missing from this story?”'
      };
    }
    if(/rights|responsibilit|government|law|citizen|decision|leadership|democracy|conflict|peace|fairness/i.test(text)){
      return {
        name: 'Jordan, a youth council representative helping the class weigh different community viewpoints',
        examples: '“Who is affected by this decision?” and “What would make the solution fair for more people?”'
      };
    }
    return {
      name: 'Nina, a knowledgeable community member connected to '+theme,
      examples: '“What do you want students to understand from your perspective?” and “What evidence from the unit supports your view?”'
    };
  }

  if(scenario === 'Project Ideation'){
    if(/sustainab|environment|waste|adapt|habitat|climate|action|sharing the planet/i.test(text)){
      return {
        name: 'Leo, a student sustainability coach helping teams turn inquiry questions into realistic action projects',
        examples: '“What small change could our class actually test this week?” and “How will we know if our action helped?”'
      };
    }
    if(/design|prototype|machine|force|materials|engineering|innovation|how the world works/i.test(text)){
      return {
        name: 'Priya, an engineer-in-residence who challenges students to improve and test their designs',
        examples: '“Which part of your prototype is most likely to fail?” and “What evidence will prove your design works?”'
      };
    }
    return {
      name: 'Kai, a project coach who helps students narrow broad inquiry ideas into one practical proposal',
      examples: '“Which idea best connects to our central idea?” and “What resources, success criteria and next steps do you need?”'
    };
  }

  if(scenario === 'Self-Reflection'){
    return {
      name: 'Mia, a reflection coach who helps students explain how their thinking has changed',
      examples: '“What did you think at the start of the unit?” and “What evidence changed or strengthened your thinking?”'
    };
  }

  return {
    name: 'Dr Nova, a Socratic tutor who answers with probing questions rather than giving students the answer',
    examples: '“What evidence supports your claim?” and “What is another explanation or counterexample we should consider?”'
  };
}

function buildWiseOpportunityDescription_(entry, oldTool, instruction){
  const scenario = wiseScenarioForEntry_(entry);
  const topic = wiseTopicForEntry_(entry);
  const theme = String(entry?.th || 'the unit').trim();
  const persona = wiseSpecificPersonaForEntry_(entry, scenario);
  const productByScenario = {
    'Character Interview': 'a question bank plus a short perspective-and-evidence summary that compares the chatbot responses with unit sources',
    'Project Ideation': 'a one-page project proposal naming the chosen idea, success criteria, resources, first prototype/action step and how it connects to the unit',
    'Self-Reflection': 'a structured reflection note naming what changed in their thinking, the evidence that caused the change and one next learning goal',
    'Socratic Tutor': 'a claim-evidence-reasoning response or exit ticket that records the strongest question the bot asked and how the student improved their answer'
  };
  const purposeByScenario = {
    'Character Interview': 'explore a named perspective through guided questioning rather than general research',
    'Project Ideation': 'test and refine possible inquiry actions or design ideas before committing to one plan',
    'Self-Reflection': 'make their learning, misconceptions and next steps more visible',
    'Socratic Tutor': 'strengthen their reasoning through probing follow-up questions'
  };
  const product = productByScenario[scenario] || productByScenario['Socratic Tutor'];
  const purpose = purposeByScenario[scenario] || purposeByScenario['Socratic Tutor'];
  return `The teacher creates a Wise Discussion Chatbot using the ${scenario} scenario and sets the bot's role as ${persona.name}. The topic is “${topic}”. Students chat with the bot to ${purpose}; for example, they ask ${persona.examples}. After the chat, students produce ${product} linked explicitly to ${theme}.`;
}

function buildWiseOpportunityChange_(candidate, instruction){
  const entry = DATA[candidate.entryIdx];
  const desc = buildWiseOpportunityDescription_(entry, candidate.oldTool, instruction);
  return {
    entryIdx: candidate.entryIdx,
    sugIdx: candidate.sugIdx,
    t: 'Wise Discussion Chatbots',
    d: desc,
    auditReason: `Adds a Wise Discussion Chatbot opportunity while preserving protected tools such as Micro:bit/Minecraft when requested. Replaces: ${candidate.oldTool}.`,
    auditSource: 'bulk-wise-opportunity-targeted',
    improvementConfidence: 'Targeted local draft',
    improvementScore: 4,
    whyBetter: 'Adds a teacher-created Wise chatbot with a named scenario, student dialogue purpose and concrete student product.',
    remainingConcern: ''
  };
}

async function runBulkWiseOpportunityFlow_(enrichedInstruction, completeData, prog, lbl, bar){
  updateReasoningStep(0, 'done');
  updateReasoningStep(1, 'done');
  updateReasoningStep(2, 'done');
  updateReasoningStep(3, 'active', 'Finding safe Wise Discussion Chatbot opportunities');
  if(lbl) lbl.textContent = 'Finding safe Wise Discussion Chatbot opportunities…';
  if(bar) bar.style.width = '35%';

  const targetCount = getBulkExplicitCount_(enrichedInstruction, 10);
  const protectMicrobit = instructionProtectsExistingTool_(enrichedInstruction, 'Micro:bit');
  const protectMinecraft = instructionProtectsExistingTool_(enrichedInstruction, 'Minecraft Education');

  const candidates = [];
  let skippedExistingWise = 0;
  let skippedAge = 0;
  let skippedNoSlot = 0;
  completeData.forEach(({e,i}) => {
    if(!isAiToolSafeForEntry('Wise Discussion Chatbots', e)){ skippedAge++; return; }
    if(entryAlreadyHasTool_(e, 'Wise Discussion Chatbots')){ skippedExistingWise++; return; }
    const slot = chooseWiseReplacementSlot_(e, enrichedInstruction);
    if(!slot){ skippedNoSlot++; return; }
    candidates.push({entryIdx:i, ...slot, year:e.yl, theme:e.th});
  });

  candidates.sort((a,b) => b.score - a.score);
  const selected = candidates.slice(0, targetCount);
  const changes = selected.map(c => buildWiseOpportunityChange_(c, enrichedInstruction));

  if(bar) bar.style.width = '100%';
  if(prog) prog.style.display = 'none';
  updateReasoningStep(3, 'done');
  updateReasoningStep(4, 'done');
  updateReasoningStep(5, 'done');
  setTimeout(hideReasoningSteps, 1000);
  if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')){
    bulkChatHistory.pop();
  }

  if(changes.length){
    const protectNote = (protectMicrobit || protectMinecraft)
      ? `<br><span style="font-size:12px;color:var(--lime)">Protected existing ${[protectMicrobit?'Micro:bit':'', protectMinecraft?'Minecraft':''].filter(Boolean).join(' and ')} slots from being replaced.</span>`
      : '';
    const shortfall = changes.length < targetCount
      ? `<br><span style="font-size:12px;color:var(--orange)">I found ${changes.length} safe opportunities out of the ${targetCount} requested. ${skippedAge} were outside the Wise age range, ${skippedExistingWise} already had Wise, and ${skippedNoSlot} had no safe replaceable non-STEM slot.</span>`
      : '';
    const replaced = selected.slice(0,5).map(c => `• ${esc(DATA[c.entryIdx].yl)} ${esc(DATA[c.entryIdx].th)} — replacing ${esc(c.oldTool)}`).join('<br>');
    bulkChatAddMessage('assistant', `✅ <strong>${changes.length} Wise Discussion Chatbot opportunit${changes.length!==1?'ies':'y'}</strong> ready for review.${protectNote}${shortfall}<br><br><span style="font-size:12px;color:var(--lime)">Sample targets:</span><br>${replaced}${selected.length>5?'<br>• …':''}`);
    bulkChatMemory.push({ role:'assistant', content:`Proposed ${changes.length} Wise Discussion Chatbot opportunities.` });
    window._snapshotReason = `Before Wise Discussion Chatbot opportunities`;
    showChangesPopup(changes);
    bulkChatState = 'done';
  } else {
    bulkChatAddMessage('assistant', `⚠️ I found no safe Wise Discussion Chatbot opportunities. Checked ${completeData.length} complete entries: ${skippedAge} outside the configured Wise age range, ${skippedExistingWise} already contain Wise, and ${skippedNoSlot} had no safe replaceable non-STEM slot.${protectMicrobit||protectMinecraft?' I also protected existing Micro:bit/Minecraft slots as requested.':''}`);
    bulkChatMemory.push({ role:'assistant', content:'No safe Wise Discussion Chatbot opportunities found.' });
    bulkChatState = 'idle';
  }
  stopProgress();
  return true;
}


function bulkInstructionTargetsMinecraftOpportunities_(instruction){
  const t=String(instruction||'').toLowerCase();
  return /minecraft/.test(t) && bulkInstructionLooksLikeOpportunity(t);
}
function mcLessonMinYear_(l){
  const nums=(String(l&&l.ages||'').match(/\d+/g)||[]).map(Number);
  const a=nums.length?Math.min.apply(null,nums):9;
  return a<=5?0:a<=6?1:a<=7?2:a<=8?3:a<=9?4:a<=10?5:6;
}
function mcTokens_(v){
  return dlaTextForFit_(v).split(' ').filter(w=>w.length>3&&!/^(students|student|lesson|learning|inquiry|central|idea|using|create|build|design|this|that|with|from|their|unit)$/.test(w));
}
function mcLessonScore_(lesson,entry){
  if(!lesson||getYearNumber(entry&&entry.yl)<mcLessonMinYear_(lesson)) return -999;
  if(curatedLessonLooksMathOnly_(lesson)&&!unitHasMathMeasurementContext_(entry)) return -999;
  const u=(entry.th||'')+' '+(entry.ci||'')+' '+(entry.lo||'')+' '+(entry.plannerContextRich||entry.plannerText||'');
  const l=(lesson.title||'')+' '+(lesson.desc||'')+' '+(lesson.subject||'');
  const us=new Set(mcTokens_(u)); let sc=0; mcTokens_(l).forEach(t=>{if(us.has(t))sc++;});
  const un=dlaTextForFit_(u), ln=dlaTextForFit_(l);
  [[/sustain|environment|habitat|ecosystem|climate|adapt|water|waste|sharing planet/,/sustain|environment|habitat|ecosystem|climate|adapt|water|waste|conservation/],[/culture|community|identity|celebration|tradition|express/,/culture|community|identity|museum|story|tradition|society/],[/force|motion|energy|material|machine|system|science|world works/,/force|motion|energy|material|machine|system|science|redstone|engineering/],[/map|place|settlement|migration|journey|geography|history|where we are/,/map|place|settlement|journey|geography|history|biome/],[/area|volume|geometry|measurement|scale|coordinate|data|math/,/area|volume|geometry|measurement|scale|coordinate|data|math/]].forEach(p=>{if(p[0].test(un)&&p[1].test(ln))sc+=5;});
  return sc;
}
function mcBestLesson_(entry,used){
  let best=null; (getMinecraftLessons()||[]).forEach(l=>{const k=dlaTextForFit_(l&&l.title||''); if(used&&used.has(k))return; const sc=mcLessonScore_(l,entry); if(sc>1&&(!best||sc>best.score))best={lesson:l,score:sc};}); return best;
}
function mcTitleTokens_(value){
  return dlaTextForFit_(value).split(' ').filter(w=>w.length>2&&!/^(the|and|for|with|from|into|using|minecraft|education|lesson|lessons|activity|activities|world|student|students)$/.test(w));
}
function mcSpecificLessonFromInstruction_(instruction){
  const text = cleanSuggestionText_(instruction || '');
  const norm = dlaTextForFit_(text);
  const lessons = getMinecraftLessons() || [];
  if(!/minecraft|lesson|lessons|world/i.test(text) || !lessons.length) return null;
  const quoted = (text.match(/[“"]([^”"]+)[”"]/g) || [])
    .map(x => dlaTextForFit_(x.replace(/[“”"]/g,'')))
    .filter(Boolean);
  let best = null;
  lessons.forEach(l => {
    const title = String(l && l.title || '').trim();
    const titleNorm = dlaTextForFit_(title);
    if(!titleNorm) return;
    const titleTokens = mcTitleTokens_(title);
    let score = 0;
    if(norm.includes(titleNorm)) score += 120;
    if(quoted.some(q => q === titleNorm || q.includes(titleNorm) || titleNorm.includes(q))) score += 100;
    const normTokens = norm.split(' ').filter(Boolean);
    const overlap = titleTokens.filter(t => normTokens.includes(t));
    if(titleTokens.length && overlap.length === titleTokens.length) score += 80 + overlap.length;
    else if(titleTokens.length >= 3 && overlap.length >= Math.ceil(titleTokens.length * 0.75)) score += 45 + overlap.length;
    const beforeMinecraft = norm.split(/minecraft|lesson|world/)[0] || '';
    const beforeTokens = mcTitleTokens_(beforeMinecraft);
    const beforeOverlap = titleTokens.filter(t => beforeTokens.includes(t));
    if(titleTokens.length && beforeOverlap.length === titleTokens.length) score += 80;
    if(score && (!best || score > best.score)) best = { lesson:l, score, title };
  });
  return best && best.score >= 80 ? best.lesson : null;
}
function mcLessonFitForEntry_(lesson,entry){
  const score = mcLessonScore_(lesson, entry);
  return score > 1 ? { lesson, score } : null;
}
function mcSlotScore_(entry,sug,idx,instruction){
  if(idx===5||!sug)return-9999; const tool=sugTool(sug), key=toolInventoryKey(tool);
  if(key===toolInventoryKey('Minecraft Education'))return-9999;
  if(instructionProtectsExistingTool_(instruction,'Micro:bit')&&key===toolInventoryKey('Micro:bit'))return-9999;
  if(instructionProtectsExistingTool_(instruction,'Wise Discussion Chatbots')&&key===toolInventoryKey('Wise Discussion Chatbots'))return-9999;
  const d=String(sugDesc(sug)||''); let sc=0;
  const issues=(typeof suggestionAuditIssues==='function')?suggestionAuditIssues(entry,sug,idx):[]; const types=new Set(issues.map(i=>i.type));
  if(types.has('vague')||types.has('thin')||types.has('connection')||types.has('generic'))sc+=7;
  if(d.length<100)sc+=4; if(!/(create|produce|record|build|design|share|explain|compare|reflect|present|map|model)/i.test(d))sc+=3;
  if(/seesaw|book creator|canva|padlet|adobe express|sway|powerpoint/i.test(key))sc+=4;
  if(/micro:?bit|sphero|lego spike|codrone|3d printer|tinkercad|wise discussion/i.test(tool))sc-=4;
  if(sug.url)sc-=2; return sc;
}
function mcChooseSlot_(entry,instruction){
  let best=null; getSugs(entry).forEach((s,i)=>{const sc=mcSlotScore_(entry,s,i,instruction); if(sc<=-999)return; if(!best||sc>best.score)best={sugIdx:i,score:sc,oldTool:sugTool(s),oldDesc:sugDesc(s)};}); return best;
}
function mcCreativeDesc_(entry){
  const t=unitContextTextForRealism(entry).toLowerCase(), th=String(entry&&entry.th||'the unit'); let build='an original Minecraft inquiry world with zones that model key concepts, tensions, evidence and possible actions', product='a short portfolio or guided tour explaining how the build represents the central idea and lines of inquiry';
  if(/sustain|environment|habitat|ecosystem|adapt|water|waste|climate|sharing the planet/.test(t)){build='a habitat or sustainable community simulation with labelled zones for resources, risks, human impacts and possible actions';product='a conservation briefing or guided world tour using screenshots and signs as evidence';}
  else if(/identity|empathy|wellbeing|relationship|change|growth|who we are/.test(t)){build='an identity-and-empathy museum or decision maze where rooms represent challenges, supports, choices and turning points';product='a reflective gallery walk explaining personal change, empathy and support strategies';}
  else if(/culture|celebration|tradition|community|express/.test(t)){build='a cultural celebration gallery or community festival route with stations for symbols, stories, rituals and values';product='a narrated virtual tour comparing how communities express identity and belonging';}
  else if(/force|motion|energy|material|machine|system|world works|science/.test(t)){build='a test world where students change one variable at a time, such as material, slope, distance, redstone timing or machine design';product='a design explanation showing how the model demonstrates the scientific principle';}
  else if(/map|place|settlement|migration|journey|geography|history|where we are/.test(t)){build='a mapped settlement, journey route or historical place model with landmarks, barriers, resources and decision points';product='a comparative map tour explaining how place, resources and movement shaped choices';}
  return 'Original Minecraft build challenge: students collaboratively build '+build+'. They collect screenshots, annotations and student notes as evidence. The final product is '+product+', explicitly connected to '+th+'.';
}
function mcCleanTitle_(title){
  return cleanSuggestionText_(String(title || 'the selected Minecraft lesson'))
    .replace(/\bWatr\b/gi, 'Water')
    .replace(/\bAnd\b/g, 'and')
    .replace(/\s+/g, ' ')
    .trim();
}
function mcCleanUrl_(url){
  return cleanMinecraftLessonUrl_(url);
}
function mcFocusPhraseForEntry_(entry){
  const t = unitContextTextForRealism(entry).toLowerCase();
  if(/sustain|environment|habitat|ecosystem|adapt|water|waste|climate|sharing the planet|biodiversity|conservation/.test(t)) return 'human impact, habitats and possible environmental action';
  if(/identity|empathy|wellbeing|relationship|change|growth|who we are|belonging|perspective/.test(t)) return 'perspective, choices and how people respond to change';
  if(/culture|celebration|tradition|community|express|values/.test(t)) return 'how communities express identity, values and belonging';
  if(/force|motion|energy|material|machine|system|world works|science|engineering/.test(t)) return 'systems, variables and evidence from testing';
  if(/map|place|settlement|migration|journey|geography|history|where we are/.test(t)) return 'place, movement and how environments shape decisions';
  if(/area|volume|geometry|measurement|scale|coordinate|data|math/.test(t)) return 'measurement, spatial reasoning and evidence';
  return 'the unit\'s central idea and lines of inquiry';
}
function mcProductForEntry_(entry){
  const t = unitContextTextForRealism(entry).toLowerCase();
  if(/sustain|environment|habitat|ecosystem|adapt|water|waste|climate|sharing the planet|biodiversity|conservation/.test(t)) return 'a short conservation brief showing the issue, the evidence and one realistic action';
  if(/identity|empathy|wellbeing|relationship|change|growth|who we are|belonging|perspective/.test(t)) return 'a reflection slide or gallery note explaining the choice, challenge or perspective shown in the world';
  if(/culture|celebration|tradition|community|express|values/.test(t)) return 'a labelled gallery or tour explaining the symbols, places or stories represented in the world';
  if(/force|motion|energy|material|machine|system|world works|science|engineering/.test(t)) return 'a test log with screenshots showing what changed, what happened and what evidence supports their explanation';
  if(/map|place|settlement|migration|journey|geography|history|where we are/.test(t)) return 'an annotated map or guided tour explaining how place, resources or movement shaped decisions';
  if(/area|volume|geometry|measurement|scale|coordinate|data|math/.test(t)) return 'a labelled screenshot set explaining the measurements, model or data they used';
  return 'a short evidence note connecting the Minecraft task back to the unit';
}
function mcCleanLessonDesc_(d){
  // Sanitise the per-lesson description from libraries.json for use as a
  // standalone "Lesson focus: ..." sentence in the visible suggestion.
  //
  // Critical rules learned from the 2026-05-28 regression:
  // - DO NOT lowercase the leading letter. Many descs are imperative
  //   ("Explore hydropower...", "Design a pixel art image...") and reading
  //   them as commands inside "Lesson focus: ..." is grammatical; lowercasing
  //   turned them into subject-less fragments ("explore hydropower...").
  // - DO NOT truncate mid-word. If the desc is longer than the soft cap,
  //   cut at the last sentence boundary that fits; if none fits, return ''.
  //   Truncating mid-word produced visible artefacts like "play a." in place
  //   of "play a part in alternative energy".
  if(!d) return '';
  let t = String(d).replace(/\s+/g,' ').trim();
  const SOFT_MAX = 150;
  if(t.length > SOFT_MAX){
    // Walk backward from SOFT_MAX looking for ". " / "! " / "? ".
    let cut = -1;
    for(let i = SOFT_MAX; i >= 50; i--){
      const ch = t.charAt(i);
      if((ch==='.'||ch==='!'||ch==='?') && (i===t.length-1 || /\s/.test(t.charAt(i+1)))){
        cut = i + 1; // include the punctuation
        break;
      }
    }
    if(cut > 50) t = t.slice(0, cut).trim();
    else return ''; // No clean cut available; caller will fall back.
  }
  if(!/[.!?]$/.test(t)) t += '.';
  // First letter stays as the source has it; capitalise if it's lowercase
  // so it reads as a proper sentence after the "Lesson focus: " intro.
  if(t && /[a-z]/.test(t.charAt(0))) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}
function mcLessonDesc_(entry,l){
  const title = mcCleanTitle_(l&&l.title);
  const url = mcCleanUrl_(l&&l.url||'');
  const focus = mcFocusPhraseForEntry_(entry);
  const product = mcProductForEntry_(entry);
  const lessonDescClean = mcCleanLessonDesc_(l&&l.desc);
  const urlBit = url ? ' ('+url+')' : '';
  const lessonBit = lessonDescClean ? ' Lesson focus: '+lessonDescClean : '';
  const tail = ' Here they apply it to '+focus+' and turn 2–3 screenshots from the world into '+product+'.';
  // Richer 3-sentence form weaves the lesson's own description in.
  let out = 'Students use the verified Minecraft Education lesson “'+title+'”'+urlBit+'.'+lessonBit+tail;
  if(out.length <= 540) return out;
  // Fallback 1: drop the inline URL (the Verified lesson link badge still
  // shows it on the review card and via change.url on the public site).
  out = 'Students use the verified Minecraft Education lesson “'+title+'”.'+lessonBit+tail;
  if(out.length <= 540) return out;
  // Fallback 2: drop the lesson-focus sentence too — revert to the previous
  // 2-sentence shape with URL preserved.
  out = 'Students use the verified Minecraft Education lesson “'+title+'”'+urlBit+' to explore '+focus+'. They capture 2–3 screenshots or signs from the world and turn them into '+product+'.';
  if(out.length <= 540) return out;
  // Fallback 3: last resort — drop URL too.
  return 'Students use the verified Minecraft Education lesson “'+title+'” to explore '+focus+'. They capture 2–3 screenshots or signs from the world and turn them into '+product+'.';
}
function normaliseMinecraftChangeForEntry_(change){
  const c = cleanChangeObject_(change || {});
  const tool = c.t || c.tool || c.technology || c.name || '';
  const desc = c.d || c.desc || c.description || c.integration_idea || c.activity || c.suggestion || '';
  if(!/minecraft/i.test(tool)) return c;
  const entry = DATA && c.entryIdx != null ? DATA[c.entryIdx] : null;
  const quality = minecraftDescriptionQuality_(desc);
  const lesson = findCuratedLessonMention_('minecraft', tool, [desc, c.url, c.lessonUrl].filter(Boolean).join(' '));
  if(lesson && !quality.ok){
    c.t = 'Minecraft Education';
    c.d = mcLessonDesc_(entry || {}, lesson);
    c.url = mcCleanUrl_(lesson.url || c.url || c.lessonUrl || '');
    c.auditReason = cleanSuggestionText_((c.auditReason || c.reason || 'Verified Minecraft lesson') + ' | Auto-shortened to a two-sentence classroom task');
  }
  return c;
}
function mcChange_(c,mode,lesson){
  const e=DATA[c.entryIdx];
  const d=mode==='lesson'?mcLessonDesc_(e,lesson):mcCreativeDesc_(e);
  const out={entryIdx:c.entryIdx,sugIdx:c.sugIdx,t:'Minecraft Education',d,auditSource:mode==='lesson'?'bulk-minecraft-targeted-library':'bulk-minecraft-targeted-creative',auditReason:(mode==='lesson'?'Verified Minecraft lesson':'Original Minecraft build')+' replacing '+c.oldTool};
  if(mode==='lesson'&&lesson&&lesson.url) out.url=mcCleanUrl_(lesson.url);
  return out;
}
async function runBulkMinecraftOpportunityFlow_(instruction,completeData,prog,lbl,bar){
  updateReasoningStep(0,'done');updateReasoningStep(1,'done');updateReasoningStep(2,'done');updateReasoningStep(3,'active','Finding safe Minecraft Education opportunities'); if(lbl)lbl.textContent='Finding safe Minecraft Education opportunities…'; if(bar)bar.style.width='25%'; await ensureLibrariesLoadedForAI();
  const target=getBulkExplicitCount_(instruction,10), cand=[]; let age=0, existing=0, noslot=0, nofit=0;
  const specificLesson = mcSpecificLessonFromInstruction_(instruction);
  const specificLessonTitle = specificLesson ? mcCleanTitle_(specificLesson.title || 'the selected Minecraft lesson') : '';
  completeData.forEach(({e,i})=>{if(!isAiToolSafeForEntry('Minecraft Education',e)){age++;return;} if(entryAlreadyHasTool_(e,'Minecraft Education')){existing++;return;} const slot=mcChooseSlot_(e,instruction); if(!slot){noslot++;return;} cand.push({entryIdx:i,...slot});});
  // Per-teacher-cohort lesson dedup: a verified lesson can repeat across the
  // three Wesley campuses (e.g. GW Y6 and Coode Y6 may both get "Alternative
  // Energy") but must not repeat within the same campus + year-level (the
  // group of teachers who see the same suggestion set in their planner).
  const usedE = new Set();
  const usedLByCY = new Map(); // (entry.ca|entry.yl) -> Set of lesson-title keys
  function usedLForEntry(entry){
    const key = (entry && entry.ca || '') + '|' + (entry && entry.yl || '');
    let s = usedLByCY.get(key);
    if(!s){ s = new Set(); usedLByCY.set(key, s); }
    return s;
  }
  const changes=[]; const wantLib=target;
  let lib=[];
  if(specificLesson){
    // When a teacher names one Minecraft lesson, this flow must test ONLY that lesson.
    // It may reuse the same verified lesson across multiple units; it must not silently substitute others.
    lib = cand.map(c=>{const fit=mcLessonFitForEntry_(specificLesson, DATA[c.entryIdx]); if(!fit){nofit++; return null;} return {...c,lesson:specificLesson,score:c.score+fit.score};}).filter(Boolean).sort((a,b)=>b.score-a.score);
  } else {
    // Non-specific mode: rank candidates by the unit's intrinsic Minecraft-fit
    // only. Lesson selection happens per-iteration inside the main loop below
    // so the usedL dedup set is honoured — previously every candidate locked
    // in the same top-scoring lesson here (e.g. "Alternative Energy" assigned
    // to every unit) because usedL was still empty at this point.
    lib = cand.slice().sort((a,b)=>b.score-a.score);
  }
  for(const c of lib){
    if(changes.length>=wantLib)break;
    if(usedE.has(c.entryIdx))continue;
    const entry = DATA[c.entryIdx];
    let lesson;
    if(specificLesson){
      lesson = c.lesson;
    } else {
      const fit = mcBestLesson_(entry, usedLForEntry(entry));
      if(!fit)continue;
      lesson = fit.lesson;
    }
    const ch=mcChange_(c,'lesson',lesson);
    if(specificLesson){ch.auditReason='Specific verified Minecraft lesson “'+specificLessonTitle+'” replacing '+c.oldTool;}
    if(!checkRealisticToolUse(ch.t,ch.d,entry).ok)continue;
    changes.push(ch);
    usedE.add(c.entryIdx);
    if(!specificLesson) usedLForEntry(entry).add(dlaTextForFit_(lesson.title||''));
  }
  // Verified-only mode: do not generate original Minecraft build/challenge fallbacks.
  // For a named lesson, do not backfill with other lessons just to reach the requested count.
  // Backfill ALSO uses the per-campus-year dedup set so a lesson can repeat
  // across campuses but never within one campus + year-level cohort.
  if(!specificLesson && changes.length<target){
    for(const c of lib){
      if(changes.length>=target)break;
      if(usedE.has(c.entryIdx))continue;
      const entry = DATA[c.entryIdx];
      const fit = mcBestLesson_(entry, usedLForEntry(entry));
      if(!fit)continue;
      const ch=mcChange_(c,'lesson',fit.lesson);
      if(checkRealisticToolUse(ch.t,ch.d,entry).ok){
        changes.push(ch);
        usedE.add(c.entryIdx);
        usedLForEntry(entry).add(dlaTextForFit_(fit.lesson.title||''));
      }
    }
  }
  if(bar)bar.style.width='100%'; if(prog)prog.style.display='none'; updateReasoningStep(3,'done');updateReasoningStep(4,'done');updateReasoningStep(5,'done'); setTimeout(hideReasoningSteps,1000); if(bulkChatHistory.length&&bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries'))bulkChatHistory.pop();
  const vc=changes.filter(c=>c.auditSource==='bulk-minecraft-targeted-library').length;
  if(changes.length){
    const lessonNote = specificLesson ? '<br><span style="font-size:12px;color:var(--lime)">Constrained to the specific lesson: <strong>'+esc(specificLessonTitle)+'</strong>. No other Minecraft lessons were used.</span>' : '';
    const short=changes.length<target?'<br><span style="font-size:12px;color:var(--orange)">I found '+changes.length+' safe opportunities out of '+target+'. '+age+' outside age range, '+existing+' already had Minecraft, '+noslot+' had no safe non-STEM slot'+(specificLesson?', '+nofit+' did not strongly fit this specific lesson':'')+'.</span>':'';
    const sample=changes.slice(0,5).map(c=>{const e=DATA[c.entryIdx], old=getSugs(e)[c.sugIdx]?sugTool(getSugs(e)[c.sugIdx]):'existing suggestion'; return '• '+esc(e.yl)+' '+esc(e.th)+' — '+(specificLesson?esc(specificLessonTitle):'verified lesson')+', replacing '+esc(old);}).join('<br>');
    bulkChatAddMessage('assistant','✅ <strong>'+changes.length+' verified Minecraft Education lesson opportunities</strong> ready for review.'+lessonNote+'<br><span style="font-size:12px;color:var(--lime)">'+vc+' verified lesson matches</span>'+short+'<br><br><span style="font-size:12px;color:var(--lime)">Sample targets:</span><br>'+sample+(changes.length>5?'<br>• …':'')); bulkChatMemory.push({role:'assistant',content:'Proposed '+changes.length+(specificLesson?' opportunities for '+specificLessonTitle:' verified Minecraft lesson opportunities')+'.'}); window._snapshotReason=specificLesson?'Before '+specificLessonTitle+' Minecraft opportunities':'Before verified Minecraft Education opportunities'; showChangesPopup(changes); bulkChatState='done';}
  else{
    const missingSpecific = specificLesson ? ' I only tested the requested lesson “'+esc(specificLessonTitle)+'” and did not substitute other Minecraft lessons.' : '';
    bulkChatAddMessage('assistant','⚠️ I found no safe verified Minecraft Education lesson opportunities.'+missingSpecific+' Checked '+completeData.length+' entries: '+age+' outside age range, '+existing+' already contain Minecraft, '+noslot+' had no safe non-STEM slot'+(specificLesson?', '+nofit+' did not strongly fit this specific lesson':'')+'.'); bulkChatState='idle';}
  stopProgress(); return true;
}
async function startBulkAnalysis(){
  bulkChatState = 'analysing';

  const instruction = bulkChatEffectiveInstruction_(bulkChatContext.rawInstruction);
  const clarifications = bulkChatContext.clarifications || [];
  const enrichedInstruction = bulkAppendClarifications_(instruction, clarifications);
  bulkChatContext.effectiveInstruction = enrichedInstruction;


  bulkChatAddMessage('assistant', '🔍 Analysing all entries now — this may take a minute...');

  // Visible reasoning stream
  showReasoningSteps([
    { text: 'Scanning all library entries', status: 'active' },
    { text: 'Building tool frequency index', status: 'pending' },
    { text: 'Computing overused & underused tools', status: 'pending' },
    { text: 'Age-gating by year level', status: 'pending' },
    { text: 'Generating proposals with GPT-4.1', status: 'pending' },
    { text: 'Filtering duplicate proposals', status: 'pending' }
  ]);

  const prog = document.getElementById('bulk-ai-progress');
  const lbl = document.getElementById('bulk-ai-label');
  const bar = document.getElementById('bulk-ai-bar');
  if(prog) prog.style.display = 'block';

  // ===== Build the same system prompt as the old runBulkAIEdit =====
  const completeData = DATA.map((e,i)=>({e,i})).filter(({e})=>e.audited && getSugs(e).filter(isRealSug).length >= 6);

  // Description-quality requests should NOT swap apps. They should keep the original tool
  // and bulk up the detail/action/product/unit connection for that exact suggestion.
  if(bulkInstructionIsDescriptionOnly_(enrichedInstruction)){
    await runBulkSameToolDescriptionRewrite_(enrichedInstruction, completeData, prog, lbl, bar);
    return;
  }

  // Diversify intent: "Diversify Seesaw suggestions across the library" (fired
  // by the dashboard insight tile when a tool is overused, or typed directly).
  // Detected BEFORE the removal flow because "diversify" misses removal verbs
  // and the generic GPT flow returns ~3 conservative proposals with no
  // cross-batch tool variety.
  const diversifyTool = bulkInstructionTargetsDiversify_(enrichedInstruction);
  if(diversifyTool){
    await runBulkDiversifyFlow_(diversifyTool, completeData, prog, lbl, bar);
    return;
  }

  // Targeted removal/replacement requests should be handled locally first.
  // Example: “replace all Seesaw suggestions in Year 5 and 6”. The generic GPT
  // flow can be too conservative and return only a couple of changes.
  if(bulkInstructionTargetsToolRemoval_(enrichedInstruction)){
    await runBulkToolReplacementFlow_(enrichedInstruction, completeData, prog, lbl, bar);
    return;
  }

  // Wise Discussion Chatbots are a broad Schoolbox/Wise feature, not a curated lesson library.
  // Handle “find/add more Wise opportunities” locally and safely so GPT does not return zero
  // changes or replace protected Micro:bit/Minecraft suggestions.
  if(bulkInstructionTargetsWiseOpportunities_(enrichedInstruction)){
    await runBulkWiseOpportunityFlow_(enrichedInstruction, completeData, prog, lbl, bar);
    return;
  }

  // Minecraft "Scan for opportunities" used to route to a verified-library-only
  // specialised flow (runBulkMinecraftOpportunityFlow_), but Wesley decided
  // 2026-05-28 that the curated lesson library wasn't producing connected
  // enough suggestions for our PYP units. Minecraft now falls through to the
  // generic AI flow below and is treated like any other tool.

  setTimeout(() => updateReasoningStep(0, 'done'), 400);
  setTimeout(() => updateReasoningStep(1, 'active'), 450);
  
  const platforms = buildKnownPlatforms();
  const platform = bulkChatContext.platform
    || platforms.find(p=>p.match.test(enrichedInstruction))
    || null;
  const isOpportunityStyle = bulkInstructionLooksLikeOpportunity(enrichedInstruction);
  const namedOpportunityTool = (!platform && isOpportunityStyle) ? bulkDetectNamedToolOpportunity_(enrichedInstruction) : '';
  const platformToolName = getBulkPlatformToolName(platform) || namedOpportunityTool;
  const targetYears = bulkExtractTargetYears_(enrichedInstruction);

  // If this is a specific-tool/platform opportunity search (e.g. "find Prep Book Creator opportunities"),
  // pre-filter locally before GPT sees the data. This keeps prompts under token limits and
  // removes entries that would be rejected anyway because of year, age rules or duplicates.
  let analysisData = completeData;
  let filteredForPlatformOpportunity = false;
  if(targetYears.length){
    analysisData = analysisData.filter(({e}) => targetYears.includes(e.yl));
  }
  if(isOpportunityStyle && platformToolName){
    const filtered = analysisData.filter(({e}) =>
      isAiToolSafeForEntry(platformToolName, e) &&
      !wouldDupeToolProposalInEntry(e, platformToolName, -1)
    );
    if(filtered.length){
      analysisData = filtered;
      filteredForPlatformOpportunity = true;
    } else {
      if(prog) prog.style.display = 'none';
      hideReasoningSteps();
      const yearText = targetYears.length ? ` in ${targetYears.join(', ')}` : '';
      bulkChatAddMessage('assistant', `⚠️ I understood this as a request to find more opportunities${yearText} for <strong>${esc(platformToolName)}</strong>, but I couldn't find eligible units that do not already use it and where it is inside the current Tool Inventory age range. Check the Tool Inventory age range for ${esc(platformToolName)}, or ask for a different year level/tool.`);
      bulkChatState = 'idle';
      stopProgress();
      return;
    }
  }
  analysisData = analysisData.slice(0, 140); // defensive cap; current library is ~127 entries

  // Top up missing planner content for in-scope units (read-only, targeted) so each
  // suggestion can be grounded in real planner text rather than just the central idea /
  // lines of inquiry. fetchPlannerContext is in-memory cached and read-only (getPlannerContext
  // backend action) — nothing is written to data.json, so this is safe to interrupt.
  const fetchedCtx = {};
  if(typeof fetchPlannerContext === 'function'){
    const needCtx = analysisData
      .filter(({e}) => !(e.plannerContextRich || e.plannerText))
      .slice(0, 40); // perf cap: top up at most 40 units per scan
    if(needCtx.length){
      if(lbl) lbl.textContent = `Loading planner detail for ${needCtx.length} unit${needCtx.length!==1?'s':''}…`;
      const CONCURRENCY = 5;
      for(let n = 0; n < needCtx.length; n += CONCURRENCY){
        const batch = needCtx.slice(n, n + CONCURRENCY);
        await Promise.all(batch.map(async ({e, i:idx}) => {
          try { const ctx = await fetchPlannerContext(e); if(ctx) fetchedCtx[idx] = ctx; }
          catch(err){ /* read-only top-up; ignore one failure and proceed */ }
        }));
      }
    }
  }

  const toolIndex = {};
  analysisData.forEach(({e,i})=>{
    getSugs(e).forEach((s,si)=>{
      const t = sugTool(s).trim().toLowerCase();
      if(!t) return;
      if(!toolIndex[t]) toolIndex[t]=[];
      toolIndex[t].push({entryIdx:i, sugIdx:si});
    });
  });
  const toolIndexStr = Object.entries(toolIndex)
    .sort((a,b)=>b[1].length-a[1].length)
    .slice(0, 25)
    .map(([tool,entries])=>{
      const shown = entries.slice(0,18).map(e=>`[${e.entryIdx}]s${e.sugIdx}`).join(', ');
      const more = entries.length > 18 ? ` … +${entries.length-18}` : '';
      return `${tool} (${entries.length}x): ${shown}${more}`;
    })
    .join('\n');

  // Compute overused tools — anything appearing more than 13 times
  // These are tools GPT should AVOID suggesting as replacements
  const toolFrequency = Object.entries(toolIndex)
    .map(([tool, entries]) => ({tool, count: entries.length}))
    .sort((a,b) => b.count - a.count);
  const overusedTools = toolFrequency
    .filter(t => t.count > 13)
    .map(t => `"${t.tool}" (${t.count}x)`)
    .join(', ');
  const underusedTools = toolFrequency
    .filter(t => t.count <= 2)
    .slice(0, 15)
    .map(t => `"${t.tool}" (${t.count}x)`)
    .join(', ');

  const hasUrl = false; // chatbot mode doesn't use the URL field

  // Parse explicit count from coordinator's instruction (e.g. "find 15 opportunities", "at least 12", "give me 20")
  // This becomes a HARD TARGET for GPT — without it, GPT-4.1 tends to return conservative counts (5-7)
  const countMatch = (enrichedInstruction || '').match(/\b(?:find|add|propose|suggest|need|want|get|give\s+me|identify|locate|spot|show\s+me)\s+(?:at\s+least\s+|about\s+|around\s+|approximately\s+|up\s+to\s+|some\s+|me\s+)?(\d{1,3})\b/i);
  const explicitCount = countMatch ? Math.min(parseInt(countMatch[1], 10), 60) : null;
  const maxCap = explicitCount ? Math.max(explicitCount + 5, 25) : 20;

  const targetBlock = explicitCount ? `

TARGET COUNT (HARD RULE): The coordinator explicitly asked for ${explicitCount} proposals. You MUST aim to find at least ${explicitCount} genuine matches across the candidate entries.
- Do NOT stop at 5 or 6 — scan EVERY candidate entry below and identify the ${explicitCount} strongest curriculum connections.
- If you cannot find ${explicitCount} genuine matches, get as close as possible (within 1–2). Returning fewer than ${Math.max(1, explicitCount - 2)} is a failure.
- The prompt contains ${analysisData.length} candidate entries. Keep scanning until you find the strongest matches.` : '';

  const platformContextText = platform
    ? (platform.key && isOpportunityStyle ? buildLibraryContextCompact(platform.key) : (typeof platform.context === 'string' ? platform.context : platform.context))
    : '';
  const isMinecraftPlatform = !!(platform && /minecraft/i.test(platform.name || ''));
  const platformHeading = isMinecraftPlatform ? 'MINECRAFT EDUCATION MODE' : `LESSON LIBRARY — ${platform ? platform.name.toUpperCase() : ''}`;
  const platformMatchingRule = isMinecraftPlatform
    ? `MATCHING RULE: Propose Minecraft Education only when a verified Minecraft library lesson genuinely strengthens the unit. Every proposal must name a real Minecraft lesson from the library and include its URL inline in the description. Write ~6 vivid practical sentences (500-800 chars) matching the depth of every other tool category — the old 2-sentence Minecraft cap is removed; never default to 2 sentences. Use clean punctuation with no stray question marks. Do NOT paste, paraphrase or copy verbatim the lesson overview, standards text, NGSS codes, or library description — write in your own words. Cover across the ~6 sentences: the lesson name and classroom purpose, what students DO in Minecraft (concrete actions like build, code with Code Builder/Agent, place blocks, capture screenshots, annotate signs), the platform-specific feature(s) the lesson hinges on (Code Builder, Agent commands, NPC dialogue, redstone, structure blocks), the concrete student evidence/product (annotated build screenshots, signposted world tour, short screencast, captioned map, reflection slide), the unit-specific anchor using the central idea or a Line of Inquiry by name (never "this unit"/"the unit focus"), and how the work is shared or assessed. Do NOT use vague filler such as "launchpad", "unit-connected build", or "build or investigation". Do NOT create original Minecraft build/challenge ideas, and do NOT invent fake lesson titles or fake URLs. Avoid maths-only lessons like Area and Volume unless the unit genuinely involves maths, measurement, geometry, spatial design, scale, mapping or data.${targetBlock}`
    : `MATCHING RULE: Propose changes wherever a specific ${platform ? platform.name : 'platform'} lesson genuinely connects to the unit's activities or central idea. Be thorough — scan every candidate entry and propose ${platform ? platform.name : 'the platform'} wherever there is a reasonable curriculum connection. Name the specific lesson in every proposal AND include its URL inline.

DESCRIPTION STYLE (CRITICAL — match the full depth of every other tool category; the old Minecraft 2-sentence cap and the old 3-4 sentence verified-library cap are both removed):
- Write ~6 vivid, practical sentences (target 500-800 characters) that match the richness of a strong app-smash / Inspire All suggestion. Use the full DESCRIPTION QUALITY RULES from SUGGESTION_STYLE below.
- Cover across the ~6 sentences: (a) the specific ${platform ? platform.name : 'platform'} lesson name and what students DO (concrete verbs — sense, measure, code, prototype, log, broadcast, calibrate, debug, iterate); (b) the ${platform ? platform.name : 'platform'}-specific feature/affordance the lesson hinges on${isMinecraftPlatform ? '' : ` (for Micro:bit specifically name the actual sensors or inputs used — accelerometer, light/temperature sensor, compass, radio, A/B buttons, LED matrix, MakeCode blocks, Python editor — never just "the device" or "a simple device")`} — name the real classroom feature, not a black-box reference; (c) the concrete student artefact/product (data log, working prototype, paired-device alert system, sensor map, annotated MakeCode screenshot, brief calibration report) tied to a SPECIFIC aspect of the unit using the unit theme, central idea or a Line of Inquiry by name (never "this unit" / "the unit focus"); (d) the pedagogical arc — explore → prototype → test/iterate → present/justify — grounded in the library lesson's teaching notes and the planner content; (e) 2-3 concrete topical examples ("such as ...", "for example ...") drawn from the planner rather than abstract categories; (f) how the work is shared, presented or assessed.
- Use the planner snippet shown for each candidate entry to reference the actual assessment task, LoI elaboration, or weekly activity. Do not write a description that could apply to any unit.${targetBlock}`;
  const platformSection = platform ? `

${platformHeading}:
${platformContextText}
${platformMatchingRule}

QUANTITY CAP: Propose a maximum of ${maxCap} changes total. If you find more than ${maxCap} genuine matches, select only the ${maxCap} strongest connections.
` : '';

  const namedToolSection = (!platform && namedOpportunityTool) ? `

SPECIFIC TOOL OPPORTUNITY MODE:
The coordinator explicitly named the tool "${namedOpportunityTool}". This is already specific enough — do NOT ask for a named lesson library and do NOT switch to other tools.
- Every proposal MUST use exactly this tool name in the "t" field: "${namedOpportunityTool}".
- Scan every candidate entry below${targetYears.length ? ` (${targetYears.join(', ')} only)` : ''} and find genuine unit fits.
- SKIP entries that already contain ${namedOpportunityTool}; the candidate list has already been pre-filtered for this.
- Replace the weakest non-STEM suggestion slot only: sugIdx 0, 1, 2, 3 or 4. Never target sugIdx 5.
- DESCRIPTION DEPTH (CRITICAL — match the full depth of every other suggestion; do NOT under-write to 2-3 sentences): write ~6 vivid, practical sentences (target 500-800 characters) following the DESCRIPTION QUALITY RULES in SUGGESTION_STYLE below. Across the ~6 sentences cover: what students DO (concrete verbs), the specific ${namedOpportunityTool} feature/affordance they use (name it — never a black box), the concrete artefact/product they create, the unit-specific anchor (name the actual topic, central idea or a Line of Inquiry — never "this unit" / "the unit focus"), 2-3 concrete topical examples drawn from the planner, and how the work is shared or assessed.
- If the tool is a familiar creation tool such as Book Creator, Canva, Seesaw or Padlet, treat it as a classroom tool, not as a curated lesson library.
- ${explicitCount ? `TARGET: The coordinator asked for ${explicitCount}. Aim for at least ${explicitCount} proposals if there are enough genuine matches.` : 'Aim for 6-12 strong proposals if there are enough genuine matches.'}` : '';

  const isOpportunitySearch = isOpportunityStyle && !platform;
  const opportunitySection = isOpportunitySearch ? `

OPPORTUNITY SEARCH MODE:
The coordinator is asking you to scan the library for places where a specific tool could be added or used more. Be thorough:
- Scan every candidate entry below, not just the obvious candidates
- SKIP any entry that already has the requested tool in one of its suggestion slots — do not propose it again
- Propose changes wherever there is a reasonable curriculum connection — not just perfect matches
- ${explicitCount ? `TARGET: The coordinator asked for ${explicitCount}. Aim for at least ${explicitCount} proposals — do not stop early.` : 'Aim for 8-20 proposals rather than 2-3'}
- DESCRIPTION DEPTH (CRITICAL — match the full depth of every other suggestion; do NOT under-write to 2-3 sentences): for each proposal write ~6 vivid, practical sentences (target 500-800 characters) following the DESCRIPTION QUALITY RULES in SUGGESTION_STYLE below — name what students DO, the specific tool feature/affordance, the concrete product they create, the unit-specific anchor (the actual topic / central idea / a Line of Inquiry, never "this unit"), 2-3 concrete topical examples from the planner, and how the work is shared or assessed.
- Still respect the TOOL AGE GUIDE and duplicate prevention rules` : '';

  const compactOpportunityMode = isOpportunityStyle || (platformSection + namedToolSection + opportunitySection).length > 3000;
  const libraryContextLen = (platformSection + namedToolSection + opportunitySection).length;
  // Curated-lesson placement runs target a small set of candidates with a big lesson library
  // in the prompt. Give the model a much deeper view of each unit's planner so it can ground
  // the connection in specific assessment tasks / lines of inquiry rather than just the theme.
  const isCuratedLibraryRun = !!platform;
  const plannerLimit = compactOpportunityMode ? 0 : (libraryContextLen > 1500 ? 120 : 180);
  const descLimit = compactOpportunityMode ? 0 : (libraryContextLen > 1500 ? 70 : 110);
  const fullContext = analysisData.map(({e,i})=>{
    const sugs = getSugs(e);
    const toolStr = sugs.map((s,si)=>{
      const tool = compactForPrompt(sugTool(s), 70);
      if(si === 5) return `s${si}🔒STEM:${tool} [protected; do not replace]`;
      const dLimit = isCuratedLibraryRun ? Math.max(descLimit, 140) : descLimit;
      const desc = dLimit > 0 ? compactForPrompt(sugDesc(s), dLimit) : '';
      return `s${si}:${tool}${desc ? ' — '+desc : ''}`;
    }).join(' | ');
    // Use enriched planner context (plannerContextRich) when available — much richer than plannerText.
    // fetchedCtx[i] is the read-only top-up fetched above for units that had neither field loaded.
    const richCtx = e.plannerContextRich || e.plannerText || fetchedCtx[i] || '';
    let richLimit;
    if(isCuratedLibraryRun){
      richLimit = richCtx === e.plannerContextRich ? 1800 : 600;
    } else if(compactOpportunityMode){
      richLimit = 300;
    } else {
      richLimit = richCtx === e.plannerContextRich ? 500 : plannerLimit;
    }
    const plannerDisplay = richLimit > 0 && richCtx ? compactForPrompt(richCtx, richLimit) : '';
    return `[${i}] ${e.ca} | ${e.yl} | "${e.th}"${e.ci?' | CI: '+compactForPrompt(e.ci,160):''}${e.lo?' | LOI: '+compactForPrompt(e.lo,160):''}${plannerDisplay?' | Planner: '+plannerDisplay:''}\n  ${toolStr}`;
  }).join('\n');

  const candidateNote = filteredForPlatformOpportunity
    ? `\nCANDIDATE PREFILTER: To avoid token-limit errors and bad proposals, the data below has been pre-filtered to ${analysisData.length} age-appropriate entries that do not already contain ${platformToolName}. The full library has ${completeData.length} complete entries.`
    : '';

  const system = `You are a Digital Learning Coach at Wesley College, an IB PYP school.

APPROVED TOOLS (Wesley College — Microsoft school, from Studio Tool Inventory):
${buildApprovedToolsList()}

TOOLS NOT AVAILABLE / BANNED:
${buildBannedToolsList()}

TOOL SELECTION POLICY:
- By default, only use tools from the APPROVED TOOLS list above.
- COORDINATOR OVERRIDE: If the coordinator's instruction below explicitly names a specific tool, product, platform, or lesson library (even one NOT on the approved list), treat it as approved for this run only if it is not banned and is age-appropriate.

${buildDynamicToolAgeGuide()}

${WISE_DISCUSSION_CHATBOTS_CONTEXT}

${REALISTIC_TOOL_USE_RULES}

DUPLICATE PREVENTION (HARD RULE):
- Do NOT propose a change that would use the same tool as another suggestion already in the same entry.
- If an entry already contains the tool you're proposing, SKIP that entry entirely.
- Do NOT propose two different changes for the same entry that would both use the same tool.

ACTIVITY VARIETY ACROSS UNITS (HARD RULE):
- Every proposal must describe a genuinely DISTINCT activity. Do NOT reuse the same core activity, student product, or framing for more than one unit.
- Even when the SAME tool is used across many units (e.g. a single-tool opportunity scan), each unit's activity MUST be different and anchored to THAT unit's own central idea, lines of inquiry and planner content — never a copy-paste with the unit name swapped in.
- You can see every proposal you are about to make in one list. Before finalising, re-read them and ensure no two descriptions are near-duplicates; if two would be similar, change one so each unit gets its own distinct activity.
- When the coordinator has NOT named a specific tool, also spread proposals across DIFFERENT tools (see the TOOL DIVERSITY RULE below) instead of repeating one tool.

DESCRIPTION-AWARE EDITING:
- Each eligible slot below includes its current tool and a short version of its current description.
- If the coordinator asks to make suggestions stronger, more vivid, more hands-on, better connected, less generic, easier, harder, shorter, or clearer, you MAY keep the same tool and output an improved description for that same slot.
- If the coordinator asks for a tool swap or opportunity search, change the tool only when it genuinely improves the unit fit.
- When replacing a weak suggestion, use the current description to decide why that slot is weak; do not choose randomly.

PROTECTED SLOT — STEM DESIGN CYCLE (HARD RULE — ABSOLUTE, NO EXCEPTIONS):
- Suggestion 6 (stored in code as sugIdx:5) is the STEM Design Cycle activity. It is PROTECTED.
- You MUST NEVER propose any change with "sugIdx":5. EVER.
- In the entry data below, Suggestion 6 is marked with 🔒STEM — that lock symbol means "do not touch under any circumstance".
- Even if slot 5 looks like a perfect fit for the requested tool, you MUST target a different slot (0, 1, 2, 3, or 4) instead.
- If the only good fit in an entry is slot 5, SKIP that entry entirely — do NOT propose a change to slot 5.
- Any proposal with "sugIdx":5 will be hard-rejected by the coordinator and counted as a violation.
- Per entry, you have FIVE eligible slots (s0, s1, s2, s3, s4). Slot 5 is invisible for replacement purposes.
${platformSection}${namedToolSection}${opportunitySection}
TOOL INDEX:
${toolIndexStr}

INSTRUCTION FROM COORDINATOR: ${enrichedInstruction}

CRITICAL — PARSE NEGATIVE INSTRUCTIONS:
Read the instruction above carefully for any "do NOT" / "don't" / "avoid" / "not X" / "but not X" statements.
- If coordinator says "but not Lego Spike Prime" → you must NEVER propose Lego Spike Prime as a replacement
- If coordinator says "avoid Canva" → exclude Canva from all proposed changes
- If coordinator says "without using X" → X is banned for this entire run
- Re-read the instruction TWICE before generating each proposal to make sure you haven't violated a negative constraint.
- If you violate a negative constraint, the coordinator will reject every one of your proposals.

REPLACEMENT STRATEGY — when proposing a change, choose which suggestion slot to replace using this priority:
0. NEVER select Suggestion 6 (s5🔒STEM / sugIdx:5) — it is permanently off-limits. Only consider slots 0, 1, 2, 3, and 4.
1. For description-only requests, keep the existing tool and rewrite the description in the same slot.
2. For specific-tool requests, replace a suggestion that uses the SAME tool family, a weak/generic description, or an overused tool.
3. Replace one of the TOP 5 most overutilised tools when the new tool is a good curriculum fit.
4. Replace a vague or generic description.
5. Replace whichever slot has the weakest connection (excluding s5).

TOOL DIVERSITY RULE (HARD RULE — applies when the coordinator's instruction doesn't name a specific tool):
When choosing WHICH tool to use as a replacement:
- OVERUSED TOOLS (avoid unless absolutely necessary): ${overusedTools || '(none yet)'}
- UNDERUSED TOOLS (prefer these when they fit the unit): ${underusedTools || '(none yet)'}
- Never propose an overused tool UNLESS (a) the coordinator explicitly named it, OR (b) it's a clear perfect fit that no other tool could serve.
- When suggesting a replacement for an overused tool, always pick from the underused list or introduce variety — do NOT swap one overused tool for another.
- Aim to broaden tool variety across the library with every change.

Analyse ALL ${analysisData.length} candidate entries and propose changes wherever the instruction applies.${candidateNote}

Output ONLY the APPLY_CHANGES block — no preamble:
APPLY_CHANGES:[{"entryIdx":3,"sugIdx":1,"t":"Tool Name","d":"~6 vivid practical sentences (500-800 chars) following the writing-style and depth rules below..."},...]

${SUGGESTION_STYLE}
The JSON must be complete and valid. Include ALL proposed changes in one array.

CANDIDATE ENTRY DATA:
${fullContext}`;

  const estimatedTokens = Math.round(system.length / 4) + 100;
  console.log(`Bulk AI Chat: ${analysisData.length}/${completeData.length} candidate entries, ~${estimatedTokens.toLocaleString()} tokens`);

  let animPct = 30;
  let animInterval = null;

  try {
    updateReasoningStep(1, 'done');
    updateReasoningStep(2, 'done'); // overused/underused
    updateReasoningStep(3, 'done'); // age-gating
    updateReasoningStep(4, 'active', `Generating proposals with GPT-4.1 (~${Math.round(estimatedTokens/1000)}K tokens)`);
    
    if(bar) bar.style.width = '30%';
    if(lbl) lbl.textContent = `Analysing ${analysisData.length} candidate entries (~${Math.round(estimatedTokens/1000)}K tokens)…`;
    animInterval = setInterval(()=>{
      if(animPct < 88){ animPct += 0.5; if(bar) bar.style.width = animPct + '%'; }
    }, 1000);

    const response = await callAI(
      [{role:'user', parts:[{text:'Please carry out the instruction and propose changes.'}]}],
      system,
      OPENAI_MODEL
    );

    clearInterval(animInterval);
    updateReasoningStep(4, 'done');
    updateReasoningStep(5, 'active');
    if(bar) bar.style.width = '90%';
    if(lbl) lbl.textContent = 'Parsing proposed changes…';

    // Parse APPLY_CHANGES
    const changeMatch = response.match(/APPLY_CHANGES:\s*([\s\S]*)/s);
    let changes = null;
    let recoveredPartial = false; // true if the array was truncated and we salvaged objects
    if(changeMatch){
      try{
        const jsonStr = changeMatch[1].trim();
        const arrStart = jsonStr.indexOf('[');
        if(arrStart === -1) throw new Error('No array');
        let arrStr = jsonStr.slice(arrStart);
        const arrEnd = arrStr.lastIndexOf(']');
        if(arrEnd !== -1){
          const raw = JSON.parse(cleanJSON(arrStr.slice(0, arrEnd+1)));
          changes = normaliseChanges(raw);
        } else {
          recoveredPartial = true;
          const recovered = [];
          let depth = 0, objStart = -1;
          for(let i = 0; i < arrStr.length; i++){
            if(arrStr[i]==='{'){if(depth===0) objStart=i; depth++;}
            else if(arrStr[i]==='}'){
              depth--;
              if(depth===0 && objStart!==-1){
                try{
                  const obj = JSON.parse(cleanJSON(arrStr.slice(objStart, i+1)));
                  if(obj.entryIdx!=null) recovered.push(obj);
                }catch{}
                objStart=-1;
              }
            }
          }
          if(recovered.length) changes = normaliseChanges(recovered);
        }
      }catch(err){ console.error('Bulk AI parse error', err); }
    }

    // Capture the raw count from GPT before any filtering, so we can show the user
    // how many proposals were filtered out vs how many GPT actually returned.
    const rawAiCount = (changes && changes.length) || 0;
    if(explicitCount && rawAiCount < explicitCount){
      console.log(`Bulk AI: GPT returned ${rawAiCount} proposals (coordinator asked for ${explicitCount}). Likely conservative response — consider re-running.`);
    }

    // Hard filter for negative instructions — AI sometimes ignores "don't use X" even when told explicitly
    let filteredStem = 0;  // hoisted — needed by both the filter block and the result display
    let filteredNegative = 0, filteredForbidden = 0, filteredBanned = 0, filteredUnsafe = 0, filteredRealism = 0; // hoisted for the result-display breakdown
    if(changes && changes.length){
      const negativePatterns = [
        /(?:do\s*not|don't|never|avoid|exclude|not\s+to|but\s+not|without\s+using|except\s+for)\s+(?:use\s+|using\s+|swap\s+with\s+|replace\s+with\s+|suggest\s+)?([a-z][a-z0-9:'\s-]+?)(?:\.|,|;|$|\)|\s+or\s+|\s+and\s+(?:not|don't)\s+|\n)/gi,
      ];
      const bannedFromInstruction = new Set();
      const instrLower = enrichedInstruction.toLowerCase();
      negativePatterns.forEach(re => {
        let m;
        while((m = re.exec(instrLower)) !== null){
          const banned = m[1].trim().replace(/\s+/g, ' ');
          if(banned.length > 2 && banned.length < 40){
            bannedFromInstruction.add(normaliseToolName(banned).toLowerCase());
          }
        }
      });
      if(bannedFromInstruction.size > 0){
        const before = changes.length;
        changes = changes.filter(c => {
          const t = normaliseToolName((c.t || '').trim()).toLowerCase();
          for(const banned of bannedFromInstruction){
            if(t === banned || t.includes(banned) || banned.includes(t)){
              return false;
            }
          }
          return true;
        });
        filteredNegative = before - changes.length;
        if(filteredNegative > 0){
          console.log(`Bulk AI: filtered out ${filteredNegative} proposal(s) violating negative instruction. Banned from instruction:`, [...bannedFromInstruction]);
        }
      }

      // Second filter: reject proposals with forbidden tools (ChatGPT, Google Docs, etc)
      // App smashes are OK as long as both tools are approved — the forbidden-keyword
      // check catches things like "Padlet + ChatGPT" because ChatGPT is in the keyword list.
      const beforeForbid = changes.length;
      changes = changes.filter(c => {
        if(toolContainsForbiddenKeyword(c.t || '')){
          console.log(`Bulk AI: rejected proposal containing forbidden tool: "${c.t}"`);
          return false;
        }
        return true;
      });
      filteredForbidden = beforeForbid - changes.length;
      if(filteredForbidden > 0){
        console.log(`Bulk AI: filtered out ${filteredForbidden} proposal(s) with forbidden tools`);
      }

      // Third filter: respect TOOL_INVENTORY.banned (user-defined banned list)
      if(TOOL_INVENTORY.banned && TOOL_INVENTORY.banned.length){
        const beforeBanned = changes.length;
        changes = changes.filter(c => !toolViolatesInventoryBan(c.t || ''));
        filteredBanned = beforeBanned - changes.length;
        if(filteredBanned > 0){
          console.log(`Bulk AI: filtered out ${filteredBanned} proposal(s) using user-banned tools`);
        }
      }

      // Fourth filter: hard age/availability check using the actual entry year level
      const beforeSafeTool = changes.length;
      changes = changes.filter(c => {
        const entry = DATA[c.entryIdx];
        if(!entry) return false;
        if(!isAiToolSafeForEntry(c.t || '', entry)){
          console.log(`Bulk AI: rejected unsafe or age-inappropriate proposal for ${entry.yl}: "${c.t}"`);
          return false;
        }
        return true;
      });
      filteredUnsafe = beforeSafeTool - changes.length;
      if(filteredUnsafe > 0){ console.log(`Bulk AI: filtered out ${filteredUnsafe} unsafe / age-inappropriate proposal(s)`); }

      // Fifth filter: reject unrealistic hardware/tool uses (e.g. CoDrone used as a metaphor for body systems)
      const beforeRealism = changes.length;
      changes = changes.filter(c => {
        const entry = DATA[c.entryIdx];
        if(!entry) return false;
        const realism = checkRealisticToolUse(c.t || '', c.d || '', entry);
        if(!realism.ok){
          console.log(`Bulk AI: rejected unrealistic proposal for ${entry.yl} ${entry.th}: "${c.t}" — ${realism.reason}`);
          return false;
        }
        return true;
      });
      filteredRealism = beforeRealism - changes.length;
      if(filteredRealism > 0){ console.log(`Bulk AI: filtered out ${filteredRealism} unrealistic proposal(s)`); }

      // Sixth filter: PROTECT STEM SUGGESTION 6 (sugIdx:5) — never allow replacement of the Design Cycle slot
      // This is the hard safety net — even if GPT ignores the prompt-level ban, this catches it
      const beforeStemFilter = changes.length;
      changes = changes.filter(c => {
        if(Number(c.sugIdx) === 5){
          console.log(`Bulk AI: BLOCKED proposal targeting protected STEM suggestion (Suggestion 6 / sugIdx:5) in entry ${c.entryIdx}: "${c.t}"`);
          return false;
        }
        return true;
      });
      filteredStem = beforeStemFilter - changes.length;
      if(filteredStem > 0){
        console.log(`Bulk AI: filtered out ${filteredStem} proposal(s) targeting protected STEM suggestion 6 (sugIdx:5)`);
      }
    }

    if(bar) bar.style.width = '100%';
    if(prog) prog.style.display = 'none';

    // Remove "analysing" message
    if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')){
      bulkChatHistory.pop();
    }

    let skippedDupes = 0;
    if(changes && changes.length){
      const preCount = changes.length;
      changes = changes.filter(c => {
        const entry = DATA[c.entryIdx];
        if(!entry) return false;
        const existingSug = getSugs(entry)[c.sugIdx];
        // Allow description-only improvements for realism fixes: reject only if tool AND description are unchanged.
        if(existingSug && toolKey(sugTool(existingSug)) === toolKey(c.t)){
          const oldDesc = String(sugDesc(existingSug) || '').replace(/\s+/g,' ').trim();
          const newDesc = String(c.d || c.desc || c.description || c.integration_idea || c.activity || '').replace(/\s+/g,' ').trim();
          if(oldDesc === newDesc) return false;
        }
        return true;
      });
      changes = changes.filter(c => {
        const entry = DATA[c.entryIdx];
        if(!entry) return false;
        return !wouldDupeToolProposalInEntry(entry, c.t, c.sugIdx);
      });
      const seenByEntry = {};
      changes = changes.filter(c => {
        const k = `${c.entryIdx}::${toolKey(c.t)}`;
        if(seenByEntry[k]) return false;
        seenByEntry[k] = true;
        return true;
      });
      skippedDupes = preCount - changes.length;
    }

    if(changes && changes.length){
      updateReasoningStep(5, 'done');
      setTimeout(hideReasoningSteps, 1200);
      const dupeNote = skippedDupes ? ` (${skippedDupes} duplicate${skippedDupes!==1?'s':''} filtered out)` : '';
      const stemNote = filteredStem ? ` <span style="color:var(--purple);font-size:11px">· ${filteredStem} STEM Suggestion 6 proposal${filteredStem!==1?'s':''} blocked (Suggestion 6 protected)</span>` : '';
      const filterNote = (rawAiCount > changes.length) ? ` <span style="color:var(--dim);font-size:11px">· the AI proposed ${rawAiCount}, ${rawAiCount - changes.length} removed by safety checks</span>` : '';
      const reasonBits = [];
      if(skippedDupes) reasonBits.push(`${skippedDupes} duplicate${skippedDupes!==1?'s':''}`);
      if(filteredUnsafe) reasonBits.push(`${filteredUnsafe} not age-appropriate`);
      if(filteredRealism) reasonBits.push(`${filteredRealism} unrealistic for the tool`);
      if(filteredBanned) reasonBits.push(`${filteredBanned} on the banned list`);
      if(filteredNegative) reasonBits.push(`${filteredNegative} you asked to avoid`);
      if(filteredForbidden) reasonBits.push(`${filteredForbidden} not an approved tool`);
      if(filteredStem) reasonBits.push(`${filteredStem} protected STEM slot`);
      const reasonNote = reasonBits.length ? `<br><span style="color:var(--dim);font-size:11px">Set aside: ${reasonBits.join(', ')}.</span>` : '';
      const truncatedNote = recoveredPartial ? `<br><span style="color:var(--orange);font-size:11px">⚠ The AI's reply looked cut off, so some proposals may be missing — re-run if you need the full set.</span>` : '';
      const targetWarn = (explicitCount && rawAiCount < explicitCount - 1)
        ? `<div style="margin-top:8px;padding:8px 12px;background:rgba(245,166,35,.12);border:1px solid rgba(245,166,35,.35);border-radius:8px;font-size:12px;color:var(--orange)">⚠ You asked for <strong>${explicitCount}</strong> but GPT only returned <strong>${rawAiCount}</strong>. Try rephrasing as "scan EVERY entry and find at least ${explicitCount}" or click ↻ and retry — GPT-4.1 sometimes responds conservatively on the first pass.</div>`
        : '';

      const byTool = {};
      changes.forEach(c => {
        const t = c.t || 'Unknown';
        byTool[t] = (byTool[t]||0) + 1;
      });
      const toolBreakdown = Object.entries(byTool).sort((a,b)=>b[1]-a[1]).slice(0, 5)
        .map(([t,n]) => `• <strong>${n}×</strong> ${esc(t)}`).join('<br>');
      const moreCount = Object.keys(byTool).length - 5;
      const moreStr = moreCount > 0 ? `<br>• <em>+ ${moreCount} more tools</em>` : '';

      const resultMsg = `✅ <strong>${changes.length} proposed change${changes.length!==1?'s':''}</strong>${dupeNote}${stemNote}${filterNote}${reasonNote}${truncatedNote}<br><br><div style="font-size:12px;color:var(--lime)">Breakdown:</div>${toolBreakdown}${moreStr}${targetWarn}<br><br>💡 <em>I'll remember this — after reviewing, just type a refinement like "do the same for Year 3 only" or "replace the Minecraft ones with something else".</em>`;
      bulkChatAddMessage('assistant', resultMsg);
      bulkChatMemory.push({ role: 'assistant', content: `Proposed ${changes.length} changes${dupeNote}. Breakdown: ${Object.entries(byTool).map(([t,n])=>`${n}x ${t}`).join(', ')}` });
      window._snapshotReason = `Before: ${bulkChatContext.rawInstruction ? bulkChatContext.rawInstruction.slice(0, 60) : 'bulk edit'}`;
      showChangesPopup(changes);
      bulkChatState = 'done';
    } else {
      updateReasoningStep(5, 'done');
      setTimeout(hideReasoningSteps, 800);
      const stemBlockNote = filteredStem > 0
        ? ` (${filteredStem} proposal${filteredStem!==1?'s were':' was'} blocked because they targeted the protected STEM slot)`
        : '';
      const msg = skippedDupes
        ? `All ${skippedDupes} proposal${skippedDupes!==1?'s':''} would have created duplicates${stemBlockNote}. Try a different instruction.`
        : filteredStem > 0
        ? `GPT proposed ${rawAiCount} changes but all targeted the STEM Design Cycle suggestion (Suggestion 6 / sugIdx:5), which is protected. Try rephrasing — e.g. "replace one of the other 5 suggestions with Micro:bit".`
        : namedOpportunityTool
        ? `I understood the requested tool as ${namedOpportunityTool}, but GPT did not return any usable non-duplicate proposals after filtering. Try "find at least 10 ${namedOpportunityTool} opportunities in ${targetYears.length ? targetYears.join(', ') : 'all year levels'} and replace the weakest non-STEM suggestion".`
        : 'No changes proposed for this instruction. Try rephrasing — for example, name a specific tool or lesson library.';
      bulkChatAddMessage('assistant', `⚠️ ${msg}`);
      bulkChatMemory.push({ role: 'assistant', content: `No changes found. ${msg}` });
      bulkChatState = 'idle';
    }
  } catch(e){
    clearInterval(animInterval);
    if(prog) prog.style.display = 'none';
    updateReasoningStep(4, 'error');
    setTimeout(hideReasoningSteps, 2000);
    if(bulkChatHistory.length && bulkChatHistory[bulkChatHistory.length-1].content.includes('Analysing all entries')){
      bulkChatHistory.pop();
    }
    bulkChatAddMessage('assistant', `❌ Error: ${e.message}\n\nPlease try again.`);
    bulkChatState = 'idle';
  }
  stopProgress();
}

// Backward compatibility — detectBulkPlatform no longer needed but keep as no-op
