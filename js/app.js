// ── Storage ───────────────────────────────────────────────────────────────────
const S = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

// ── State ─────────────────────────────────────────────────────────────────────
let tokens    = S.get('tokens')    || [];
let tokenMeta = S.get('tokenMeta') || {}; // { token: { username, avatar, id } }
let dmMessage = S.get('dmMessage') || '';
let dmDelay   = parseFloat(S.get('dmDelay') || '1');
let actLog    = S.get('actLog')    || [];
let statSent = 0, statFailed = 0;
let dmRunning = false, dmStop = false;
// store check results separately so they survive tab switches
let tokenStatus = S.get('tokenStatus') || {}; // { token: 'valid'|'invalid' }
// per-token counters: { token: { sent, failed } }
let tokenStats = {};

const DISCORD = 'https://discord.com/api/v10';
const PROXY   = url => `https://super-unit-b274.60uhsss.workers.dev/?url=${encodeURIComponent(url)}`;

// ── Modal ─────────────────────────────────────────────────────────────────────
function modalShow(msg, buttons) {
  document.getElementById('modal-msg').textContent = msg;
  const a = document.getElementById('modal-actions');
  a.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.className = b.primary ? 'btn-run' : 'btn-ghost';
    el.onclick = () => { modalClose(); b.action && b.action(); };
    a.appendChild(el);
  });
  document.getElementById('modal').classList.add('open');
}
function modalClose() { document.getElementById('modal').classList.remove('open'); }
function modalAlert(msg) { modalShow(msg, [{ label: 'ok', primary: true }]); }
function modalConfirm(msg, onYes) {
  modalShow(msg, [
    { label: 'cancel' },
    { label: 'confirm', primary: true, action: onYes },
  ]);
}


function init() {
  renderTokens(); updateBadge(); updateStats();
  document.getElementById('dm-message').value = dmMessage;
  document.getElementById('dm-delay').value   = dmDelay;
  syncPreviews();
  renderActivityLog();
  playAudio();
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function playAudio() {
  const audio = document.getElementById('bg-audio');
  if (!audio) return;
  // Autoplay requires a user gesture on most browsers.
  // We try immediately, then fall back to playing on first click.
  const tryPlay = () => { audio.volume = 0.4; audio.play().catch(() => {}); };
  tryPlay();
  document.addEventListener('click', tryPlay, { once: true });
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  btn.classList.add('active');
  const titles = { massdm:'Mass DM', tokens:'Tokens', message:'Message', checker:'Token Checker', log:'Activity Log' };
  document.getElementById('page-title').textContent = titles[id] || id;
  if (id === 'massdm') syncPreviews();
}

function switchDMTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('dm-single').style.display = tab === 'single' ? '' : 'none';
  document.getElementById('dm-global').style.display = tab === 'global' ? '' : 'none';
}

function syncPreviews() {
  document.getElementById('msg-preview').value = dmMessage;
  const g = document.getElementById('msg-preview-global');
  if (g) g.value = dmMessage;
}

// ── Tokens ────────────────────────────────────────────────────────────────────
function saveTokens() {
  S.set('tokens', tokens);
  // prune meta for removed tokens
  Object.keys(tokenMeta).forEach(k => { if (!tokens.includes(k)) delete tokenMeta[k]; });
  S.set('tokenMeta', tokenMeta);
  updateBadge(); renderTokens(); updateStats();
}

function addToken() {
  const v = document.getElementById('new-token').value.trim();
  if (!v) return;
  if (tokens.includes(v)) { modalAlert('already added.'); return; }
  tokens.push(v);
  document.getElementById('new-token').value = '';
  saveTokens();
  log('info', `[+] Token added (${mask(v)})`);
}

function removeToken(i) {
  log('warn', `[-] Removed (${mask(tokens[i])})`);
  tokens.splice(i, 1);
  saveTokens();
}

function bulkImport() {
  const lines = document.getElementById('bulk-tokens').value.split('\n').map(l => l.trim()).filter(Boolean);
  let n = 0;
  lines.forEach(t => { if (!tokens.includes(t)) { tokens.push(t); n++; } });
  document.getElementById('bulk-tokens').value = '';
  saveTokens();
  log('info', `[+] Imported ${n} token(s)`);
}

function clearTokens() {
  modalConfirm('remove all tokens?', () => {
    tokens = [];
    tokenMeta = {}; tokenStatus = {};
    S.set('tokenMeta', {}); S.set('tokenStatus', {});
    saveTokens();
    log('warn', '[-] all tokens cleared');
  });
}

function mask(t) { return t.length > 12 ? t.slice(0,6)+'...'+t.slice(-4) : '***'; }

function renderTokens() {
  const el = document.getElementById('token-list');
  if (!tokens.length) { el.innerHTML = '<p class="empty">no tokens loaded.</p>'; return; }
  el.innerHTML = tokens.map((t, i) => {
    const meta   = tokenMeta[t];
    const status = tokenStatus[t] || 'pending';
    const initial = meta ? meta.username[0].toUpperCase() : '?';

    // wsrv.nl proxies the image with proper CORS headers
    const avatarHtml = (meta && meta.avatarUrl)
      ? `<img class="bot-avatar" src="${meta.avatarUrl}" onerror="this.outerHTML='<div class=bot-avatar-placeholder>${initial}</div>'">`
      : `<div class="bot-avatar-placeholder">${initial}</div>`;

    const nameHtml = meta
      ? `<span class="bot-name">${esc(meta.username)}</span>`
      : `<span class="token-val">${mask(t)}</span>`;

    const statusLabel = status === 'pending' ? '—' : status;
    const statusClass = `status status-${status}`;

    return `<div class="token-item">
      ${avatarHtml}
      ${nameHtml}
      <span class="${statusClass}" id="ts-${i}">${statusLabel}</span>
      <button class="btn-ghost btn-xs" onclick="removeToken(${i})">✕</button>
    </div>`;
  }).join('');
}

function makeInitialAvatar(letter) {
  const d = document.createElement('div');
  d.className = 'bot-avatar-placeholder';
  d.textContent = letter;
  return d;
}

function updateTokenItem(i, token, statusType) {
  const list = document.getElementById('token-list');
  const items = list.querySelectorAll('.token-item');
  if (!items[i]) return;
  const meta = tokenMeta[token];
  if (!meta) return;
  const item = items[i];
  // replace avatar
  const oldAvatar = item.querySelector('.bot-avatar, .bot-avatar-placeholder');
  const initial = meta.username[0].toUpperCase();
  if (meta.avatarUrl) {
    const img = document.createElement('img');
    img.className = 'bot-avatar';
    img.src = meta.avatarUrl;
    img.onerror = function() { this.replaceWith(makeInitialAvatar(initial)); };
    if (oldAvatar) oldAvatar.replaceWith(img); else item.prepend(img);
  } else {
    const ph = makeInitialAvatar(initial);
    if (oldAvatar) oldAvatar.replaceWith(ph); else item.prepend(ph);
  }
  // replace name
  const oldName = item.querySelector('.token-val, .bot-name');
  const nameEl = document.createElement('span');
  nameEl.className = 'bot-name';
  nameEl.textContent = meta.username;
  if (oldName) oldName.replaceWith(nameEl);
  // update status badge
  const badge = document.getElementById('ts-' + i);
  if (badge) {
    badge.textContent = statusType;
    badge.className = `status status-${statusType}`;
  }
}

function updateBadge() {
  const txt = tokens.length + ' token' + (tokens.length !== 1 ? 's' : '');
  document.getElementById('token-count-badge-top').textContent = txt;
  const lc = document.getElementById('token-list-count');
  if (lc) lc.textContent = tokens.length;
}

// ── Message ───────────────────────────────────────────────────────────────────
function saveMessage() {
  dmMessage = document.getElementById('dm-message').value;
  dmDelay   = parseFloat(document.getElementById('dm-delay').value) || 1;
  S.set('dmMessage', dmMessage); S.set('dmDelay', dmDelay);
  syncPreviews();
  const el = document.getElementById('msg-saved');
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 2000);
  log('info', '[~] Message saved');
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-sent').textContent   = statSent;
  document.getElementById('stat-failed').textContent = statFailed;
  document.getElementById('stat-tokens').textContent = tokens.length;
}
function setStatus(s) { document.getElementById('stat-status').textContent = s; }
function setProgress(p) { document.getElementById('dm-progress').style.width = Math.min(100, p) + '%'; }

// ── Log ───────────────────────────────────────────────────────────────────────
function log(type, msg) {
  const ts = new Date().toLocaleTimeString();
  actLog.push({ type, msg, ts });
  if (actLog.length > 500) actLog.shift();
  S.set('actLog', actLog);
  const line = `<div class="log-line log-${type}">[${ts}] ${esc(msg)}</div>`;
  const d = document.getElementById('dm-log');
  const a = document.getElementById('activity-log');
  if (d) { d.innerHTML += line; d.scrollTop = d.scrollHeight; }
  if (a) { a.innerHTML += line; a.scrollTop = a.scrollHeight; }
}

function clearLog() {
  actLog = []; S.set('actLog', []);
  document.getElementById('activity-log').innerHTML = '<div class="log-line log-info">[~] Cleared.</div>';
  document.getElementById('dm-log').innerHTML       = '<div class="log-line log-info">[~] Ready.</div>';
}

function renderActivityLog() {
  const el = document.getElementById('activity-log');
  if (!actLog.length) { el.innerHTML = '<div class="log-line log-info">[~] No activity yet.</div>'; return; }
  el.innerHTML = actLog.map(e => `<div class="log-line log-${e.type}">[${e.ts}] ${esc(e.msg)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Discord API ───────────────────────────────────────────────────────────────
async function dGet(path, token) {
  const r = await fetch(PROXY(`${DISCORD}${path}`), {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!r.ok) { let b = ''; try { b = JSON.stringify(await r.json()); } catch {} throw new Error(`HTTP ${r.status} ${b}`); }
  return r.json();
}

async function dPost(path, token, body) {
  return fetch(PROXY(`${DISCORD}${path}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
    body: JSON.stringify(body),
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Token Checker ─────────────────────────────────────────────────────────────
async function checkTokens() {
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  const el = document.getElementById('checker-results');
  el.innerHTML = '';
  renderTokens();
  log('info', `[~] checking ${tokens.length} token(s)...`);
  for (let i = 0; i < tokens.length; i++) {
    try {
      const d    = await dGet('/users/@me', tokens[i]);
      const name = d.username + (d.discriminator && d.discriminator !== '0' ? '#' + d.discriminator : '');
      const avatarUrl = d.avatar
        ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=32`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(d.id) >> 22n) % 6}.png`;
      tokenMeta[tokens[i]] = { username: name, id: d.id, avatar: d.avatar, avatarUrl };
      S.set('tokenMeta', tokenMeta);
      tokenStatus[tokens[i]] = 'valid';
      S.set('tokenStatus', tokenStatus);
      updateTokenItem(i, tokens[i], 'valid');
      el.innerHTML += `
        <div class="token-item">
          <img class="bot-avatar" src="${avatarUrl}" onerror="this.style.display='none'">
          <span class="bot-name">${esc(name)}</span>
          <span class="token-id">${d.id}</span>
          <span class="status status-valid">valid</span>
        </div>`;
      log('ok', `[✓] bot ${i+1}: ${name} (${d.id})`);
    } catch(e) {
      el.innerHTML += `<div class="token-item"><div class="bot-avatar-placeholder"></div><span class="token-val">${mask(tokens[i])}</span><span class="status status-invalid">invalid</span></div>`;
      tokenStatus[tokens[i]] = 'invalid';
      S.set('tokenStatus', tokenStatus);
      updateTokenItem(i, tokens[i], 'invalid');
      log('err', `[✗] bot ${i+1}: ${e.message}`);
    }
    await sleep(400);
  }
  renderTokens(); // refresh sidebar list with avatars
  log('info', '[~] done.');
}

// ── Mass DM ───────────────────────────────────────────────────────────────────
function stopDM() { dmStop = true; log('warn', '[■] Stopping...'); }

async function startMassDM(mode) {
  if (dmRunning) { alert('Already running.'); return; }
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  if (!dmMessage.trim()) { modalAlert('no message set.'); return; }
  if (mode === 'single' && !document.getElementById('guild-id').value.trim()) {
    modalAlert('enter a guild id.'); return;
  }
  dmRunning = true; dmStop = false;
  statSent = 0; statFailed = 0;
  tokenStats = {};
  tokens.forEach(t => { tokenStats[t] = { sent: 0, failed: 0 }; });
  setStatus('Running'); updateStats(); setProgress(0);
  document.getElementById('dm-log').innerHTML = '';
  log('info', `[~] Starting (${mode}) with ${tokens.length} token(s)...`);
  try {
    if (mode === 'single') await dmSingleServer(document.getElementById('guild-id').value.trim());
    else await dmGlobal();
  } catch(e) {
    log('err', '[✗] Fatal: ' + e.message);
  }
  dmRunning = false;
  setStatus(dmStop ? 'Stopped' : 'Done');
  log('info', `[✓] done — sent: ${statSent}, failed: ${statFailed}`);
  // per-token breakdown
  tokens.forEach((t, i) => {
    const s = tokenStats[t];
    if (!s || (s.sent === 0 && s.failed === 0)) return;
    const meta = tokenMeta[t];
    const name = meta ? meta.username : `bot ${i+1}`;
    log('info', `    ${name} → sent: ${s.sent}, failed: ${s.failed}`);
  });
  updateStats();
}

async function dmSingleServer(guildId) {
  log('info', `[~] Fetching members for guild ${guildId}...`);
  let members = [];
  for (const t of tokens) {
    try {
      members = await fetchGuildMembers(guildId, t);
      if (members.length) { log('ok', `[✓] Fetched ${members.length} member(s)`); break; }
    } catch(e) { log('warn', `[~] Token failed: ${e.message}`); }
  }
  if (!members.length) { log('err', '[✗] Could not fetch members.'); return; }
  await dmMembers(members, tokens);
}

async function dmGlobal() {
  log('info', '[~] Collecting guilds...');
  const guildMap = {};
  for (let i = 0; i < tokens.length; i++) {
    try {
      const guilds = await dGet('/users/@me/guilds', tokens[i]);
      guilds.forEach(g => {
        if (!guildMap[g.id]) guildMap[g.id] = [];
        guildMap[g.id].push(tokens[i]);
      });
      log('ok', `[✓] Token ${i+1}: ${guilds.length} guild(s)`);
    } catch(e) { log('err', `[✗] Token ${i+1}: ${e.message}`); }
    if (dmStop) return;
  }
  const guildIds = Object.keys(guildMap);
  log('info', `[~] ${guildIds.length} guild(s). Fetching members...`);
  const seen = new Set();
  for (let gi = 0; gi < guildIds.length; gi++) {
    if (dmStop) break;
    const gid = guildIds[gi];
    log('info', `[~] Guild ${gi+1}/${guildIds.length} — ${gid}`);
    let ok = false;
    for (const t of guildMap[gid]) {
      try {
        const members = await fetchGuildMembers(gid, t);
        members.forEach(u => seen.add(u));
        log('ok', `[✓] ${members.length} member(s) from ${gid}`);
        ok = true; break;
      } catch(e) { log('err', `[✗] ${gid}: ${e.message}`); }
    }
    if (!ok) log('warn', `[~] Skipped ${gid}`);
    setProgress((gi+1) / guildIds.length * 50);
  }
  const allIds = [...seen];
  log('info', `[~] ${allIds.length} unique user(s). Sending DMs...`);
  await dmMembers(allIds, tokens);
}

async function fetchGuildMembers(guildId, token) {
  const members = [];
  let after = '0';
  while (true) {
    const chunk = await dGet(`/guilds/${guildId}/members?limit=1000&after=${after}`, token);
    if (!chunk.length) break;
    chunk.forEach(m => { if (!m.user.bot) members.push(m.user.id); });
    if (chunk.length < 1000) break;
    after = chunk[chunk.length - 1].user.id;
  }
  return members;
}

async function dmMembers(userIds, toks) {
  for (let i = 0; i < userIds.length; i++) {
    if (dmStop) break;
    const uid   = userIds[i];
    const token = toks[i % toks.length];
    try {
      const chanRes = await dPost('/users/@me/channels', token, { recipient_id: uid });
      if (!chanRes.ok) throw new Error('open DM HTTP ' + chanRes.status);
      const chan   = await chanRes.json();
      const msgRes = await dPost(`/channels/${chan.id}/messages`, token, { content: dmMessage });
      if (msgRes.ok) {
        statSent++;
        if (tokenStats[token]) tokenStats[token].sent++;
        log('ok', `[✓] sent → ${uid}`);
      } else {
        const b = await msgRes.json().catch(() => ({}));
        throw new Error(`HTTP ${msgRes.status} code=${b.code||'?'}`);
      }
    } catch(e) {
      statFailed++;
      if (tokenStats[token]) tokenStats[token].failed++;
      log('err', `[✗] failed → ${uid} (${e.message})`);
    }
    updateStats();
    setProgress(50 + (i+1) / userIds.length * 50);
    await sleep(dmDelay * 1000);
  }
}

init();
