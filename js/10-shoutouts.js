// Shoutouts tab: curators check, edit and approve the Tech Champions
// posts for each campus. Talks to gas_backend/Shoutouts.js (handleShoutoutAction_).
// Plain classic script, everything global. The webhook link never reaches this
// file except while a person types it into the add form; it is never shown or logged.

const SHOUT_CAMPUS_LIST = ['Elsternwick', 'Glen Waverley', 'St Kilda Road'];
// Wording only (no team or channel IDs): where each campus's post goes.
const SHOUT_DEST_LABELS = {
  'Elsternwick': [
    { key: 'el-campus', text: 'Elsternwick Campus > Digital Learning and Practice, mentioning the PYP channel' },
    { key: 'el-pyp', text: 'PYP Elsternwick > DLP, mentioning the whole PYP Elsternwick team' }
  ],
  'Glen Waverley': [
    { key: 'gw-campus', text: 'Glen Waverley Campus > DLP, mentioning the PYP channel' }
  ],
  'St Kilda Road': [
    { key: 'skr-campus', text: 'SKR 577 Campus > DLP, mentioning the PYP channel' }
  ]
};
const SHOUT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHOUT_POLL_MS = 10000;
const SHOUT_POLL_MAX_MS = 10 * 60 * 1000;

window._shoutState = null;
window._shoutPollTimer = null;
window._shoutPollStarted = 0;
// Campuses whose subject or message box has edits that are not saved yet. Nothing may redraw these.
window._shoutDirty = {};

function shoutEsc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 'yyyy-MM-dd' -> '13 Oct'. Anything odd comes back as-is.
function shoutDateLabel_(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(key || '');
  return Number(m[3]) + ' ' + SHOUT_MONTHS[Number(m[2]) - 1];
}

// '2026-10-26T01:02:03Z' -> readable local time, or ''.
function shoutTimeLabel_(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '';
  try { return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch (e) { return String(iso); }
}

// Default "Post as": the signed-in person if they can post, else Nathan, else the first person.
function shoutoutDefaultPoster_(posters, currentUser) {
  const list = posters || [];
  const me = String(currentUser || '').toLowerCase();
  const mine = list.filter(function (p) { return me && String(p.email || '').toLowerCase() === me; })[0];
  if (mine) return mine.email;
  const nathan = list.filter(function (p) { return /nathan/i.test(String(p.name || '') + ' ' + String(p.email || '')); })[0];
  if (nathan) return nathan.email;
  return list.length ? list[0].email : '';
}

function shoutTeamLine_(t) {
  const n = Number(t.count) || 0;
  let s = shoutEsc_(t.year) + ': ' + n + (n === 1 ? ' click' : ' clicks');
  if (t.rise) s += ' (up ' + Number(t.rise) + ')';
  return s;
}

function shoutFactsHtml_(facts, campus) {
  const c = facts && facts.campuses && facts.campuses[campus];
  if (!c) return '';
  let h = '<div style="font-size:12px;color:var(--dim);margin:6px 0">';
  h += '<b style="color:var(--text)">The numbers behind it</b> (teachers marking tools as used)<br>';
  if ((c.top || []).length) h += 'Top teams: ' + c.top.map(shoutTeamLine_).join('; ') + '<br>';
  else h += 'No teams used a tool in the last three weeks.<br>';
  if ((c.risers || []).length) h += 'Biggest riser: ' + c.risers.map(shoutTeamLine_).join('; ');
  else h += 'No biggest riser this round.';
  return h + '</div>';
}

// 'St Kilda Road' -> 'st-kilda-road' (safe in an id).
function shoutCampusSlug_(campus) {
  return String(campus || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// True when a destination's last real attempt could not be confirmed (test posts do not count).
function shoutoutHasUnknown_(draft) {
  const posts = (draft && draft.posts) || {};
  return Object.keys(posts).some(function (k) { return posts[k] && posts[k].status === 'unknown' && !posts[k].test; });
}

function shoutoutTestBannerHtml_(state) {
  if (!state || !state.testMode) return '';
  return '<div role="status" style="background:var(--card);border:1px solid var(--salmon);color:var(--salmon);border-radius:12px;padding:10px 16px;margin-bottom:16px;font-weight:700">Test mode is on: posts go to the DLA Test team</div>';
}

function shoutoutTestSwitchHtml_(state) {
  const on = !!(state && state.testMode);
  return '<label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-weight:600;cursor:pointer"><input type="checkbox" id="shout-testmode"' + (on ? ' checked' : '') +
    ' onchange="shoutToggleTestMode_(this)"> Test mode: posts go to the DLA Test team</label>';
}

function shoutoutBannerAreaHtml_(state) {
  return shoutoutTestBannerHtml_(state) + shoutoutTestSwitchHtml_(state);
}

async function shoutToggleTestMode_(box) {
  const want = !!box.checked;
  if (!want && !confirm("Turn off test mode? Approved posts will then go to the real campus channels.")) { box.checked = true; return; }
  box.disabled = true;
  try {
    const r = await shoutoutCall_({ action: 'shoutoutsSetTestMode', on: want });
    if (r && r.error) throw new Error(r.error);
    if (!window._shoutState) window._shoutState = {};
    window._shoutState.testMode = !!(r && r.testMode);
    const area = document.getElementById('shout-banner');
    if (area) area.innerHTML = shoutoutBannerAreaHtml_(window._shoutState);
  } catch (e) {
    box.checked = !want;
    alert('Could not change test mode: ' + (e && e.message ? e.message : e));
  } finally { box.disabled = false; }
}

function shoutStatusHtml_(draft) {
  const posts = draft.posts || {};
  const testPosts = draft.testPosts || {};
  const dests = SHOUT_DEST_LABELS[draft.campus] || [];
  const lines = dests.map(function (d) {
    const tp = testPosts[d.key];
    const testLine = tp ? '<div style="color:var(--dim)">Test post ' + (tp.status === 'posted' ? 'sent to the DLA Test team' : 'did not go through') +
      (shoutTimeLabel_(tp.at) ? ' at ' + shoutEsc_(shoutTimeLabel_(tp.at)) : '') + (tp.as ? ' as ' + shoutEsc_(tp.as) : '') + '. Nothing is marked as posted.</div>' : '';
    const p = posts[d.key];
    if (!p) return testLine;
    const when = shoutTimeLabel_(p.at);
    const who = p.as ? ' as ' + shoutEsc_(p.as) : '';
    const by = p.by ? ' (approved by ' + shoutEsc_(p.by) + ')' : '';
    const name = shoutEsc_(d.text.split(',')[0]);
    if (p.test) return testLine;
    if (p.status === 'posted') return '<div style="color:var(--green)">Posted to ' + name + (when ? ' at ' + shoutEsc_(when) : '') + who + by + '</div>' + testLine;
    if (p.status === 'unknown') return '<div style="color:var(--salmon)">Not sure this reached ' + name + '. Please check the channel before posting again.</div>' + testLine;
    return '<div style="color:var(--salmon)">Did not post to ' + name + (p.error ? ': ' + shoutEsc_(p.error) : '') + '</div>' + testLine;
  }).join('');
  return lines ? '<div style="font-size:12px;margin:8px 0">' + lines + '</div>' : '';
}

// The picture, or a marked "no picture" line (so a new picture can replace it in place).
function shoutImgHtml_(imageUrl, campus) {
  if (imageUrl && /^data:image\//.test(imageUrl)) {
    return '<img class="shout-pic" src="' + shoutEsc_(imageUrl) + '" alt="Picture for the ' + shoutEsc_(campus) + ' post" style="max-width:100%;width:320px;border-radius:10px;display:block;margin:8px 0">';
  }
  return '<div class="shout-noimg" style="font-size:12px;color:var(--dim);margin:8px 0">No picture for this post.</div>';
}

// Pure. One campus card. Everything from the server is escaped.
// Never touches a webhook link: posters only carry {name, email}.
function shoutoutCardHtml(draft, posters, imageUrl, defaultPosterEmail, factsHtml, fixedImage) {
  const d = draft || {};
  const campus = d.campus || '';
  const ce = shoutEsc_(campus);
  const status = d.status || 'pending';
  const dests = SHOUT_DEST_LABELS[campus] || [];
  const editable = status === 'draft' || status === 'failed';
  const canPost = status === 'draft' || status === 'failed' || status === 'partial';
  const writeFailed = status === 'failed' && !d.body;
  const label = writeFailed ? 'Could not write' :
    ({ pending: 'Being written', draft: 'Waiting for your OK', posted: 'Posted', partial: 'Partly posted', failed: 'Did not post', skipped: 'Skipped' }[status] || status);

  let h = '<div class="shout-card" data-campus="' + ce + '" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px">';
  h += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div style="font-weight:800;font-size:16px">' + ce + '</div>';
  h += '<div style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;border:1px solid var(--border);color:var(--dim)">' + shoutEsc_(label) + '</div></div>';
  h += '<div style="font-size:12px;color:var(--dim);margin:6px 0">Goes to:<ul style="margin:4px 0 0 18px;padding:0">' +
    dests.map(function (x) { return '<li>' + shoutEsc_(x.text) + '</li>'; }).join('') + '</ul></div>';
  if (d.isLaunch) h += '<div style="font-size:12px;color:var(--dim);margin:4px 0 6px">First post: includes the introduction to the Tech Champions updates.</div>';

  if (status === 'pending') {
    return h + '<div style="padding:18px 0;color:var(--dim)">Writing this post now. It will appear here in a minute.</div></div>';
  }

  if (writeFailed) {
    return h + '<div style="padding:14px 0;color:var(--salmon)">' + shoutEsc_(d.failReason || 'This post could not be written.') + '</div></div>';
  }

  h += shoutImgHtml_(imageUrl, campus);

  const ro = editable ? '' : ' readonly';
  h += '<label style="font-size:12px;font-weight:700">Subject</label>';
  h += '<input class="shout-subject" type="text" value="' + shoutEsc_(d.subject) + '"' + ro + ' style="width:100%;box-sizing:border-box;padding:8px;margin:4px 0 10px;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:8px;font-family:inherit">';
  h += '<label style="font-size:12px;font-weight:700">Message</label>';
  h += '<textarea class="shout-body" rows="10"' + ro + ' style="width:100%;box-sizing:border-box;padding:8px;margin:4px 0;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:8px;font-family:inherit">' + shoutEsc_(d.body) + '</textarea>';
  h += '<div class="shout-msg" style="font-size:12px;min-height:16px;margin:4px 0"></div>';
  h += factsHtml || '';
  h += shoutStatusHtml_(d);

  if (editable) {
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">' +
      '<button class="btn-sm" data-campus="' + ce + '" onclick="saveShoutout(this)">Save edits</button>' +
      '<button class="btn-sm" data-campus="' + ce + '" onclick="rewriteShoutout(this)">New wording</button>' +
      (fixedImage ? '' : '<button class="btn-sm" data-campus="' + ce + '" onclick="newShoutoutPicture(this)">New picture</button>') + '</div>';
  }

  if (canPost) {
    const list = posters || [];
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">';
    h += '<label style="font-size:12px;font-weight:700" for="shout-as-' + shoutCampusSlug_(campus) + '">Post as</label>';
    h += '<select class="shout-as" id="shout-as-' + shoutCampusSlug_(campus) + '" style="padding:7px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit">';
    list.forEach(function (p) {
      const sel = String(p.email || '').toLowerCase() === String(defaultPosterEmail || '').toLowerCase() ? ' selected' : '';
      h += '<option value="' + shoutEsc_(p.email) + '" data-name="' + shoutEsc_(p.name) + '"' + sel + '>' + shoutEsc_(p.name) + '</option>';
    });
    h += '</select>';
    h += '<button class="btn-sm" style="background:var(--lime);color:#000;border-color:var(--lime)" data-campus="' + ce + '" onclick="approveShoutout(this)"' + (list.length ? '' : ' disabled') + '>' +
      (status === 'draft' ? 'Approve and post' : 'Retry') + '</button>';
    if (status === 'draft' || status === 'failed') h += '<button class="btn-sm" data-campus="' + ce + '" onclick="skipShoutout(this)">Skip</button>';
    h += '</div>';
  }
  return h + '</div>';
}

function shoutoutCardWithFacts_(draft, state) {
  const facts = shoutFactsHtml_(state.cycle && state.cycle.facts, draft.campus);
  return shoutoutCardHtml(draft, state.posters, (state.images || {})[draft.campus] || '', shoutoutDefaultPoster_(state.posters, state.currentUser), facts, !!state.fixedImage);
}

// Pure. Pictures already fetched that are still the right ones (same cycle, same picture file).
function shoutoutCarryImages_(oldState, newState) {
  const out = {};
  const oc = oldState && oldState.cycle;
  const nc = newState && newState.cycle;
  if (!oc || !nc || oc.id !== nc.id) return out;
  const old = oldState.images || {};
  (nc.drafts || []).forEach(function (d) {
    const o = (oc.drafts || []).filter(function (x) { return x.campus === d.campus; })[0];
    if (o && o.imageFileId === d.imageFileId && old[d.campus]) out[d.campus] = old[d.campus];
  });
  return out;
}

// Pure. What to do with a fresh list from the server. full = draw everything (new or
// different round). Otherwise campuses = cards whose server status or picture changed AND
// that have no unsaved edits, so typing is never wiped. images = pictures to keep;
// needImages = some picture still has to be fetched.
function shoutoutRedrawPlan_(oldState, newState, dirty) {
  const oc = oldState && oldState.cycle;
  const nc = newState && newState.cycle;
  if (!oc || !nc || oc.id !== nc.id || (oc.drafts || []).length !== (nc.drafts || []).length) {
    return { full: true, campuses: [], images: {}, needImages: false };
  }
  const skip = dirty || {};
  const images = shoutoutCarryImages_(oldState, newState);
  const campuses = [];
  (nc.drafts || []).forEach(function (d) {
    const o = (oc.drafts || []).filter(function (x) { return x.campus === d.campus; })[0];
    const changed = !o || o.status !== d.status || o.imageFileId !== d.imageFileId;
    if (changed && !skip[d.campus]) campuses.push(d.campus);
  });
  const needImages = (nc.drafts || []).some(function (d) { return d.status !== 'skipped' && d.imageFileId && !images[d.campus]; });
  return { full: false, campuses: campuses, images: images, needImages: needImages };
}

// Pure. The cached state with ONE campus's draft replaced by the server's copy, so a
// change to that card does not hide a change to another card from the next poll.
function shoutoutMergeDraft_(state, serverState, campus) {
  if (!state || !state.cycle || !serverState || !serverState.cycle || state.cycle.id !== serverState.cycle.id) return state;
  const fresh = (serverState.cycle.drafts || []).filter(function (d) { return d.campus === campus; })[0];
  if (!fresh) return state;
  return Object.assign({}, state, {
    cycle: Object.assign({}, state.cycle, { drafts: (state.cycle.drafts || []).map(function (d) { return d.campus === campus ? fresh : d; }) }),
    testMode: serverState.testMode,
    posters: serverState.posters
  });
}

function shoutoutPostersBoxHtml_(state) {
  const posters = state.posters || [];
  let h = '<details id="shout-posters-box" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:16px"' + (posters.length ? '' : ' open') + '>';
  h += '<summary style="cursor:pointer;font-weight:700">People who can post</summary>';
  if (posters.length) {
    h += '<ul style="margin:8px 0 0 18px;padding:0">' + posters.map(function (p) { return '<li>' + shoutEsc_(p.name) + ' (' + shoutEsc_(p.email) + ')</li>'; }).join('') + '</ul>';
  } else {
    h += '<p style="margin:10px 0;color:var(--dim)">Nobody can post yet. Each person who wants posts to come from them needs to set up their own posting flow once in Power Automate, then add it here.</p>';
  }
  h += '<div style="font-size:12px;font-weight:700;margin:12px 0 4px">Add yourself</div>';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  h += '<input id="shout-add-name" type="text" placeholder="Your name" style="padding:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:8px;font-family:inherit">';
  h += '<input id="shout-add-email" type="email" placeholder="Your email" value="' + shoutEsc_(state.currentUser) + '" style="padding:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:8px;font-family:inherit">';
  h += '<input id="shout-add-link" type="password" autocomplete="off" placeholder="Link to your posting flow" style="padding:8px;min-width:220px;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:8px;font-family:inherit">';
  h += '<button class="btn-sm" onclick="addShoutoutPoster()">Add</button></div>';
  h += '<div id="shout-add-msg" style="font-size:12px;min-height:16px;margin-top:6px"></div>';
  return h + '</details>';
}

// Pure. The "Picture for every post" box.
function shoutoutFixedPictureBoxHtml_(state) {
  const fixed = !!(state && state.fixedImage);
  let h = '<details id="shout-picture-box" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:16px">';
  h += '<summary style="cursor:pointer;font-weight:700">Picture for every post</summary>';
  if (fixed && state.fixedImageUrl && /^data:image\//.test(state.fixedImageUrl)) {
    h += '<img src="' + shoutEsc_(state.fixedImageUrl) + '" alt="The Tech Champions picture used for every post" style="max-width:100%;width:240px;border-radius:10px;display:block;margin:10px 0">';
  }
  h += '<p style="margin:10px 0;color:var(--dim)">' + (fixed
    ? 'Every post uses this Tech Champions picture. Choose a different file to replace it.'
    : 'No picture chosen, so each post gets its own AI picture. Choose your Tech Champions picture to use it for every post.') + '</p>';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
  h += '<input id="shout-pic-file" type="file" accept="image/jpeg,image/png" style="font-family:inherit">';
  h += '<button class="btn-sm" onclick="useShoutoutPicture()">Use this picture</button>';
  if (fixed) h += '<button class="btn-sm" onclick="clearShoutoutPicture()">Go back to AI pictures</button>';
  h += '</div><div id="shout-pic-msg" style="font-size:12px;min-height:16px;margin-top:6px"></div>';
  return h + '</details>';
}

function shoutBindDirty_(el) {
  if (el._shoutBound) return;
  el._shoutBound = true;
  el.addEventListener('input', function (ev) {
    const t = ev.target;
    if (!t || !t.classList || !(t.classList.contains('shout-subject') || t.classList.contains('shout-body'))) return;
    const card = t.closest ? t.closest('.shout-card') : null;
    if (card) window._shoutDirty[card.getAttribute('data-campus')] = true;
  });
}

// Pure. Drafts that get a card on the page: skipped ones are hidden (kept in the store).
function shoutoutVisibleDrafts_(drafts) {
  return (drafts || []).filter(function (d) { return d.status !== 'skipped'; });
}

// Pure. The one small dim line naming skipped campuses, or ''.
function shoutoutSkippedLineHtml_(state) {
  const ds = (state && state.cycle && state.cycle.drafts) || [];
  const names = ds.filter(function (d) { return d.status === 'skipped'; }).map(function (d) { return shoutEsc_(d.campus); });
  if (!names.length) return '';
  return '<div style="font-size:12px;color:var(--dim);margin:0 0 12px">Skipped this round: ' + names.join(', ') + '. Press Make drafts now to write fresh ones.</div>';
}

// Pure. The empty-state message when no card is on the page, or ''.
function shoutoutEmptyHtml_(state) {
  const ds = (state && state.cycle && state.cycle.drafts) || [];
  if (shoutoutVisibleDrafts_(ds).length) return '';
  return '<div style="padding:30px;text-align:center;color:var(--dim)">No drafts yet. Press "Make drafts now" to write them.</div>';
}

// Draws everything. Only for the first load, a different round, or "Make drafts now".
function renderShoutouts(state) {
  const el = document.getElementById('shout-content');
  if (!el) return;
  window._shoutState = state;
  window._shoutDirty = {};
  shoutBindDirty_(el);
  shoutUpdateSub_(state);
  let h = '<div id="shout-banner">' + shoutoutBannerAreaHtml_(state) + '</div>' + shoutoutPostersBoxHtml_(state) + shoutoutFixedPictureBoxHtml_(state);
  const cyc = state && state.cycle;
  h += '<div id="shout-skipped-line">' + shoutoutSkippedLineHtml_(state) + '</div><div id="shout-empty">' + shoutoutEmptyHtml_(state) + '</div>';
  if (cyc && (cyc.drafts || []).length) {
    const order = SHOUT_CAMPUS_LIST;
    const drafts = shoutoutVisibleDrafts_(cyc.drafts).sort(function (a, b) { return order.indexOf(a.campus) - order.indexOf(b.campus); });
    h += drafts.map(function (d) { return shoutoutCardWithFacts_(d, state); }).join('');
  }
  el.innerHTML = h;
  shoutSyncPolling_(state);
}

function shoutUpdateSub_(state) {
  const sub = document.getElementById('shout-sub');
  const cyc = state && state.cycle;
  if (!sub) return;
  sub.textContent = cyc && cyc.facts && cyc.facts.window
    ? 'Counting ' + shoutDateLabel_(cyc.facts.window.start) + ' to ' + shoutDateLabel_(cyc.facts.window.end) + '. Check each post, then approve it to send it to Teams.'
    : 'No drafts yet for this round.';
}

function shoutSyncPolling_(state) {
  const cyc = state && state.cycle;
  const anyPending = cyc && (cyc.drafts || []).some(function (d) { return d.status === 'pending'; });
  if (anyPending) startShoutoutPolling_(); else stopShoutoutPolling_();
}

function shoutFindCard_(campus) {
  const el = document.getElementById('shout-content');
  if (!el) return null;
  const cards = el.querySelectorAll('.shout-card');
  for (let i = 0; i < cards.length; i++) if (cards[i].getAttribute('data-campus') === campus) return cards[i];
  return null;
}

// Refreshes the skipped line and the empty-state message from the cached state.
function shoutShowSkipped_(st) {
  const line = document.getElementById('shout-skipped-line');
  if (line) line.innerHTML = shoutoutSkippedLineHtml_(st);
  const empty = document.getElementById('shout-empty');
  if (empty) empty.innerHTML = shoutoutEmptyHtml_(st);
}

// Redraws ONE card from the cached state. Drops that card's unsaved-edit flag. A skipped
// draft has no card: its card is removed. A draft that has no card yet (it came back from
// skipped) gets one in campus order.
function shoutRedrawCard_(campus) {
  const st = window._shoutState;
  const card = shoutFindCard_(campus);
  const draft = st && st.cycle && (st.cycle.drafts || []).filter(function (d) { return d.campus === campus; })[0];
  if (!draft) return;
  if (draft.status === 'skipped') {
    if (card) card.remove();
    delete window._shoutDirty[campus];
    shoutShowSkipped_(st);
    return;
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = shoutoutCardWithFacts_(draft, st);
  const fresh = tmp.firstElementChild;
  if (!fresh) return;
  if (card) {
    card.replaceWith(fresh);
  } else {
    const el = document.getElementById('shout-content');
    if (!el) return;
    const order = SHOUT_CAMPUS_LIST;
    let before = null;
    const cards = el.querySelectorAll('.shout-card');
    for (let i = 0; i < cards.length && !before; i++) {
      if (order.indexOf(cards[i].getAttribute('data-campus')) > order.indexOf(campus)) before = cards[i];
    }
    if (before) el.insertBefore(fresh, before); else el.appendChild(fresh);
  }
  delete window._shoutDirty[campus];
  shoutShowSkipped_(st);
}

// Puts a picture into a card without redrawing it.
function shoutSetCardImage_(card, url, campus) {
  if (!card || !url) return;
  const img = card.querySelector('img.shout-pic');
  if (img) { img.src = url; return; }
  const none = card.querySelector('.shout-noimg');
  if (!none) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = shoutImgHtml_(url, campus);
  if (tmp.firstElementChild) none.replaceWith(tmp.firstElementChild);
}

// Pure. With a Google token, drop the shared secret so the backend identifies the real person
// (it checks the shared secret first and would otherwise see 'shared-secret').
function shoutoutPayload_(built) {
  const out = Object.assign({}, built);
  if (out.googleAccessToken) delete out.token;
  return out;
}

async function shoutoutCall_(payload) {
  const response = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(shoutoutPayload_(withGASToken(payload)))
  });
  const result = await response.json();
  if (result && result.error) throw new Error(result.error);
  return result || {};
}

function stopShoutoutPolling_() {
  if (window._shoutPollTimer) { clearInterval(window._shoutPollTimer); window._shoutPollTimer = null; }
}

// Fetches the list without pictures, then redraws only the cards whose server status or
// picture changed and have no unsaved edits. Pictures are fetched only when one changed.
async function shoutRefreshSoft_() {
  const old = window._shoutState;
  const s = await shoutoutCall_({ action: 'shoutoutsList', withImages: false });
  if (old && !!old.fixedImage !== !!s.fixedImage) { renderShoutouts(await shoutoutCall_({ action: 'shoutoutsList' })); return; }
  const plan = shoutoutRedrawPlan_(old, s, window._shoutDirty);
  if (plan.full) { renderShoutouts(await shoutoutCall_({ action: 'shoutoutsList' })); return; }
  s.images = plan.images;
  if (s.fixedImage && old && old.fixedImageUrl) s.fixedImageUrl = old.fixedImageUrl;
  if (plan.needImages) {
    try { const full = await shoutoutCall_({ action: 'shoutoutsList' }); s.images = full.images || {}; if (full.fixedImageUrl) s.fixedImageUrl = full.fixedImageUrl; } catch (e) { /* pictures can wait */ }
  }
  window._shoutState = s;
  shoutUpdateSub_(s);
  const banner = document.getElementById('shout-banner');
  if (banner) banner.innerHTML = shoutoutBannerAreaHtml_(s);
  plan.campuses.forEach(shoutRedrawCard_);
  shoutShowSkipped_(s);
  shoutSyncPolling_(s);
}

function startShoutoutPolling_() {
  if (window._shoutPollTimer) return;
  window._shoutPollStarted = Date.now();
  window._shoutPollTimer = setInterval(async function () {
    if (Date.now() - window._shoutPollStarted > SHOUT_POLL_MAX_MS) { stopShoutoutPolling_(); return; }
    try { await shoutRefreshSoft_(); } catch (e) { /* keep trying until the time limit */ }
  }, SHOUT_POLL_MS);
}

// First load draws everything. After that it only refreshes cards that changed, so a tab
// switch or the Refresh button never wipes edits. forceFull draws everything again.
async function loadShoutouts(forceFull) {
  const sub = document.getElementById('shout-sub');
  try {
    if (forceFull === true || !window._shoutState) renderShoutouts(await shoutoutCall_({ action: 'shoutoutsList' }));
    else await shoutRefreshSoft_();
  } catch (err) {
    if (sub) sub.textContent = 'Could not load the Shoutouts: ' + err.message;
  }
}

// ---- card helpers ----
function shoutCardOf_(btn) { return btn.closest ? btn.closest('.shout-card') : null; }
function shoutCardMsg_(card, text, bad) {
  const m = card && card.querySelector('.shout-msg');
  if (!m) return;
  m.style.color = bad ? 'var(--salmon)' : 'var(--dim)';
  m.textContent = text;
}
function shoutCycleId_() {
  const s = window._shoutState;
  return s && s.cycle ? s.cycle.id : '';
}

async function shoutSaveFromCard_(card, campus) {
  const result = await shoutoutCall_({
    action: 'shoutoutsSave', cycleId: shoutCycleId_(), campus: campus,
    subject: card.querySelector('.shout-subject').value,
    body: card.querySelector('.shout-body').value
  });
  delete window._shoutDirty[campus];
  return result;
}

function shoutProblemsText_(problems) {
  const p = (problems || []).filter(Boolean);
  return p.length ? 'Saved, but worth a look: ' + p.join(' ') : '';
}

function shoutDraftOf_(campus) {
  const st = window._shoutState;
  return (st && st.cycle && (st.cycle.drafts || []).filter(function (d) { return d.campus === campus; })[0]) || {};
}

// After approve or skip: fetch the server's copy of THAT card only and redraw only that card.
async function shoutRefreshCardFromServer_(campus) {
  const old = window._shoutState;
  const s = await shoutoutCall_({ action: 'shoutoutsList', withImages: false });
  const merged = shoutoutMergeDraft_(old, s, campus);
  if (merged === old) { await loadShoutouts(true); return; }   // the round was replaced
  window._shoutState = merged;
  shoutRedrawCard_(campus);
}

async function saveShoutout(btn) {
  const card = shoutCardOf_(btn); const campus = btn.dataset.campus;
  shoutCardMsg_(card, 'Saving...');
  try {
    const r = await shoutSaveFromCard_(card, campus);
    const warn = shoutProblemsText_(r.problems);
    if (warn) shoutCardMsg_(card, warn, true); else shoutCardMsg_(card, 'Saved.');
  } catch (err) { shoutCardMsg_(card, err.message, true); }
}

async function rewriteShoutout(btn) {
  const card = shoutCardOf_(btn); const campus = btn.dataset.campus;
  shoutCardMsg_(card, 'Writing new wording, this can take a little while...');
  try {
    const r = await shoutoutCall_({ action: 'shoutoutsRewrite', cycleId: shoutCycleId_(), campus: campus });
    card.querySelector('.shout-subject').value = r.subject || '';
    card.querySelector('.shout-body').value = r.body || '';
    delete window._shoutDirty[campus];
    shoutCardMsg_(card, 'New wording is in. It is already saved.');
  } catch (err) { shoutCardMsg_(card, err.message, true); }
}

async function newShoutoutPicture(btn) {
  const card = shoutCardOf_(btn); const campus = btn.dataset.campus;
  shoutCardMsg_(card, 'Making a new picture, this can take a little while...');
  try {
    const r = await shoutoutCall_({ action: 'shoutoutsNewPicture', cycleId: shoutCycleId_(), campus: campus });
    const st = window._shoutState;
    if (st && r.image) { st.images = st.images || {}; st.images[campus] = r.image; }
    if (r.image) shoutSetCardImage_(card, r.image, campus);
    shoutCardMsg_(card, r.image ? 'New picture is in. It is already saved.' : 'New picture saved. Press Refresh to see it.');
    // Keep the cached copy of this draft in step, so the next poll does not see a "change".
    try {
      const s = await shoutoutCall_({ action: 'shoutoutsList', withImages: false });
      window._shoutState = shoutoutMergeDraft_(window._shoutState, s, campus);
    } catch (e) { /* the next refresh sorts it out */ }
  } catch (err) { shoutCardMsg_(card, err.message, true); }
}

// Pure maths: size to fit inside max pixels on the longest side, never enlarged.
function shoutoutFitSize_(w, h, max) {
  const scale = Math.min(1, max/Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// Shrinks a chosen picture in the browser (longest side 1600 px, JPEG 0.85). Resolves to base64 without the prefix.
function shoutResizePicture_(file) {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      try {
        const sz = shoutoutFitSize_(img.naturalWidth || img.width, img.naturalHeight || img.height, 1600);
        const canvas = document.createElement('canvas');
        canvas.width = sz.w; canvas.height = sz.h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sz.w, sz.h);
        ctx.drawImage(img, 0, 0, sz.w, sz.h);
        const data = canvas.toDataURL('image/jpeg', 0.85);
        URL.revokeObjectURL(url);
        resolve(data.split(',')[1] || '');
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a picture.')); };
    img.src = url;
  });
}

async function useShoutoutPicture() {
  const msg = document.getElementById('shout-pic-msg');
  const input = document.getElementById('shout-pic-file');
  const file = input && input.files && input.files[0];
  if (!file) { msg.style.color = 'var(--salmon)'; msg.textContent = 'Please choose a picture file first.'; return; }
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') { msg.style.color = 'var(--salmon)'; msg.textContent = 'Please choose a JPEG or PNG picture.'; return; }
  msg.style.color = 'var(--dim)'; msg.textContent = 'Preparing and saving the picture...';
  try {
    const b64 = await shoutResizePicture_(file);
    await shoutoutCall_({ action: 'shoutoutsSetFixedImage', imageBase64: b64, mime: 'image/jpeg' });
    await loadShoutouts(true);
    const m2 = document.getElementById('shout-pic-msg');
    if (m2) { m2.style.color = 'var(--dim)'; m2.textContent = 'Saved. Every post now uses this picture.'; }
  } catch (err) { msg.style.color = 'var(--salmon)'; msg.textContent = err.message; }
}

async function clearShoutoutPicture() {
  const msg = document.getElementById('shout-pic-msg');
  if (!confirm('Go back to a new AI picture for each post? Posts already written keep the Tech Champions picture until you press New picture on them.')) return;
  try {
    await shoutoutCall_({ action: 'shoutoutsClearFixedImage' });
    await loadShoutouts(true);
  } catch (err) { if (msg) { msg.style.color = 'var(--salmon)'; msg.textContent = err.message; } }
}

async function approveShoutout(btn) {
  const card = shoutCardOf_(btn); const campus = btn.dataset.campus;
  const sel = card.querySelector('.shout-as');
  if (!sel || !sel.value) { shoutCardMsg_(card, 'Choose who to post as first.', true); return; }
  const draft = shoutDraftOf_(campus);
  const posted = draft.posts || {};
  const testMode = !!(window._shoutState && window._shoutState.testMode);
  const hasUnknown = !testMode && shoutoutHasUnknown_(draft);
  const channels = (SHOUT_DEST_LABELS[campus] || [])
    .filter(function (d) { return !(posted[d.key] && posted[d.key].status === 'posted' && !posted[d.key].test); })
    .map(function (d) { return d.text; }).join(' and ');
  const name = sel.options[sel.selectedIndex].getAttribute('data-name') || sel.value;
  const question = testMode ? 'Test mode is on. Send this to the DLA Test team (not the real channels) as ' + name + '?'
    : hasUnknown ? 'We could not confirm whether this posted. Please check the channel first. Post again anyway?'
    : 'Post this to ' + channels + ' as ' + name + '?';
  if (!confirm(question)) return;
  shoutCardMsg_(card, 'Posting...');
  let result;
  try {
    if (card.querySelector('.shout-body') && !card.querySelector('.shout-body').readOnly) await shoutSaveFromCard_(card, campus);
    result = await shoutoutCall_({ action: 'shoutoutsApprove', cycleId: shoutCycleId_(), campus: campus, posterEmail: sel.value, confirmUnknown: hasUnknown });
  } catch (err) {
    shoutCardMsg_(card, err.message, true);
    return;
  }
  try { await shoutRefreshCardFromServer_(campus); } catch (err) { shoutCardMsg_(card, 'Posted, but the card could not refresh: ' + err.message + ' Press Refresh.', true); return; }
  if (result && result.test) shoutCardMsg_(shoutFindCard_(campus), 'Test post sent to the DLA Test team. Nothing was marked as posted.');
}

async function skipShoutout(btn) {
  const card = shoutCardOf_(btn); const campus = btn.dataset.campus;
  if (!confirm('Skip the ' + campus + ' post this round?')) return;
  try {
    await shoutoutCall_({ action: 'shoutoutsSkip', cycleId: shoutCycleId_(), campus: campus });
    await shoutRefreshCardFromServer_(campus);
  } catch (err) { shoutCardMsg_(card, err.message, true); }
}

async function makeShoutoutsNow() {
  const sub = document.getElementById('shout-sub');
  const have = window._shoutState && window._shoutState.cycle && (window._shoutState.cycle.drafts || []).length;
  const force = !!have;
  if (force && !confirm('This will rewrite every draft that has not been posted yet, including skipped ones. Posts already sent are kept. Continue?')) return;
  if (sub) sub.textContent = 'Starting the drafts...';
  try {
    await shoutoutCall_({ action: 'shoutoutsMakeNow', force: force });
    await loadShoutouts(true);
    startShoutoutPolling_();
  } catch (err) { if (sub) sub.textContent = err.message; }
}

async function addShoutoutPoster() {
  const msg = document.getElementById('shout-add-msg');
  const name = document.getElementById('shout-add-name').value.trim();
  const email = document.getElementById('shout-add-email').value.trim();
  const linkEl = document.getElementById('shout-add-link');
  const link = linkEl.value.trim();
  if (!name || !email || !link) { msg.style.color = 'var(--salmon)'; msg.textContent = 'Please fill in your name, email and flow link.'; return; }
  msg.style.color = 'var(--dim)'; msg.textContent = 'Adding...';
  try {
    const r = await shoutoutCall_({ action: 'shoutoutsAddPoster', name: name, email: email, webhookUrl: link });
    linkEl.value = '';
    // Update the people list and the "Post as" lists, without touching cards with unsaved edits.
    const st = window._shoutState;
    if (st) {
      st.posters = r.posters || st.posters;
      const box = document.getElementById('shout-posters-box');
      if (box) {
        const tmp = document.createElement('div');
        tmp.innerHTML = shoutoutPostersBoxHtml_(st);
        const fresh = tmp.firstElementChild;
        if (fresh) { if (box.open) fresh.open = true; box.replaceWith(fresh); }
      }
      ((st.cycle && st.cycle.drafts) || []).forEach(function (d) {
        if (!window._shoutDirty[d.campus]) shoutRedrawCard_(d.campus);
      });
    }
  } catch (err) {
    msg.style.color = 'var(--salmon)'; msg.textContent = err.message;
  }
}
