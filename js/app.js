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
let serverCache = S.get('serverCache') || {}; // { guildId: { ...info } }
let templates   = S.get('templates')   || []; // [{ id, name, content }]
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
function modalClose() {
  document.getElementById('modal').classList.remove('open');
  // remove any injected prompt input
  const injected = document.querySelector('#modal-msg + input');
  if (injected) injected.remove();
}
function modalAlert(msg) { modalShow(msg, [{ label: 'ok', primary: true }]); }
function modalConfirm(msg, onYes) {
  modalShow(msg, [
    { label: 'cancel' },
    { label: 'confirm', primary: true, action: onYes },
  ]);
}
function modalPrompt(msg, defaultVal, onSubmit) {
  document.getElementById('modal-msg').textContent = msg;
  const a = document.getElementById('modal-actions');
  a.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text'; input.value = defaultVal || '';
  input.className = ''; input.style.cssText = 'width:100%;margin-bottom:12px;background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:8px 10px;border-radius:3px;font-family:inherit;font-size:12.5px;outline:none;';
  document.getElementById('modal-msg').after(input);
  input.focus(); input.select();
  const submit = () => { const v = input.value.trim(); modalClose(); if (v) onSubmit(v); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') modalClose(); });
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'cancel'; cancelBtn.className = 'btn-ghost';
  cancelBtn.onclick = () => modalClose();
  const okBtn = document.createElement('button');
  okBtn.textContent = 'ok'; okBtn.className = 'btn-run';
  okBtn.onclick = submit;
  a.appendChild(cancelBtn); a.appendChild(okBtn);
  document.getElementById('modal').classList.add('open');
}


function init() {
  renderTokens(); updateBadge(); updateStats();
  document.getElementById('dm-message').value = dmMessage;
  document.getElementById('dm-delay').value   = dmDelay;
  syncPreviews();
  renderActivityLog();
  renderTemplates();
  playAudio();
  restoreServerCache();

  const savedPage = S.get('activePage') || 'massdm';
  const navBtn = document.querySelector(`#sidebar button[onclick="showPage('${savedPage}',this)"]`);
  if (navBtn) showPage(savedPage, navBtn);

  if (S.get('sidebarCollapsed')) document.getElementById('sidebar').classList.add('sidebar-collapsed');
}

// ── Audio (bg) ────────────────────────────────────────────────────────────────
function playAudio() {
  const audio = document.getElementById('bg-audio');
  if (!audio) return;
  const tryPlay = () => { audio.volume = 0.4; audio.play().catch(() => {}); };
  tryPlay();
  document.addEventListener('click', tryPlay, { once: true });
}

// ── Navigation ────────────────────────────────────────────────────────────────
function toggleSidebar() {
  const collapsed = document.getElementById('sidebar').classList.toggle('sidebar-collapsed');
  S.set('sidebarCollapsed', collapsed);
}

function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#sidebar button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  btn.classList.add('active');
  S.set('activePage', id);
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

function copyToken(i) {
  navigator.clipboard.writeText(tokens[i]).then(() => {
    const btn = document.querySelectorAll('.token-item')[i]?.querySelector('[onclick^="copyToken"]');
    if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '⎘', 1200); }
  });
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
      <button class="btn-ghost btn-xs" onclick="copyToken(${i})" title="copy">⎘</button>
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

// ── Templates ─────────────────────────────────────────────────────────────────
function saveTemplates() {
  S.set('templates', templates);
  renderTemplates();
}

function saveMessageAs() {
  const content = document.getElementById('dm-message').value.trim();
  if (!content) { modalAlert('write a message first.'); return; }
  modalPrompt('template name:', '', name => {
    templates.push({ id: Date.now(), name, content });
    saveTemplates();
  });
}

function loadTemplate(id) {
  const t = templates.find(t => t.id === id);
  if (!t) return;
  document.getElementById('dm-message').value = t.content;
}

function editTemplate(id) {
  const t = templates.find(t => t.id === id);
  if (!t) return;
  modalPrompt('rename template:', t.name, name => {
    t.name = name;
    saveTemplates();
  });
}

function deleteTemplate(id) {
  modalConfirm('delete this template?', () => {
    templates = templates.filter(t => t.id !== id);
    saveTemplates();
  });
}

function renderTemplates() {
  const el = document.getElementById('tpl-list');
  const count = document.getElementById('tpl-count');
  if (!el) return;
  count.textContent = templates.length;
  if (!templates.length) { el.innerHTML = '<p class="empty">no templates saved.</p>'; return; }
  el.innerHTML = templates.map(t => `
    <div class="tpl-item">
      <div class="tpl-name" onclick="loadTemplate(${t.id})" title="click to load">${esc(t.name)}</div>
      <div class="tpl-preview">${esc(t.content.slice(0, 80))}${t.content.length > 80 ? '…' : ''}</div>
      <div class="tpl-actions">
        <button class="btn-ghost btn-xs" onclick="loadTemplate(${t.id})">load</button>
        <button class="btn-ghost btn-xs" onclick="editTemplate(${t.id})">rename</button>
        <button class="btn-del btn-xs" onclick="deleteTemplate(${t.id})">✕</button>
      </div>
    </div>`).join('');
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

// ── Server Checker ────────────────────────────────────────────────────────────
let scRunning = false;

async function checkAllServers() {
  if (scRunning) return;
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  scRunning = true;

  const statusEl = document.getElementById('sc-status');
  const el       = document.getElementById('sc-result');
  el.innerHTML   = '<p class="dim-text">collecting guilds...</p>';
  document.getElementById('sc-count').textContent = '0';

  // step 1: collect unique guild ids across all tokens
  const guildTokenMap = {}; // { guildId: firstWorkingToken }
  for (let i = 0; i < tokens.length; i++) {
    statusEl.textContent = `token ${i+1}/${tokens.length}...`;
    try {
      const guilds = await dGet('/users/@me/guilds', tokens[i]);
      for (const g of guilds) {
        if (!guildTokenMap[g.id]) guildTokenMap[g.id] = tokens[i];
      }
    } catch {}
    await sleep(300);
  }

  const guildIds = Object.keys(guildTokenMap);
  if (!guildIds.length) {
    el.innerHTML = '<p class="empty">no servers found.</p>';
    statusEl.textContent = '';
    scRunning = false;
    return;
  }

  // step 2: fetch full info for each unique guild
  el.innerHTML = '';
  let fetched = 0;
  for (const gid of guildIds) {
    statusEl.textContent = `fetching ${fetched+1}/${guildIds.length}...`;
    try {
      const guild = await dGet(`/guilds/${gid}?with_counts=true`, guildTokenMap[gid]);
      serverCache[gid] = guild;
      fetched++;
      document.getElementById('sc-count').textContent = fetched;
      el.innerHTML += buildServerCard(guild);
    } catch {
      // skip guilds we can't fetch
    }
    await sleep(300);
  }

  S.set('serverCache', serverCache);
  statusEl.textContent = '';
  if (!fetched) el.innerHTML = '<p class="empty">could not fetch any server info.</p>';
  scRunning = false;
}

function clearServerCache() {
  serverCache = {};
  S.set('serverCache', {});
  document.getElementById('sc-result').innerHTML = '<p class="empty">run server checker to see results.</p>';
  document.getElementById('sc-count').textContent = '0';
}

function buildServerCard(g) {
  const iconUrl = g.icon
    ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
    : null;
  const iconHtml = iconUrl
    ? `<img class="server-icon" src="${iconUrl}" onerror="this.outerHTML='<div class=server-icon-ph>${esc(g.name[0])}</div>'">`
    : `<div class="server-icon-ph">${esc(g.name[0])}</div>`;

  const rows = [
    ['id',          esc(g.id)],
    ['owner',       esc(g.owner_id)],
    ['members',     g.approximate_member_count   != null ? g.approximate_member_count.toLocaleString()   : '—'],
    ['online',      g.approximate_presence_count != null ? g.approximate_presence_count.toLocaleString() : '—'],
    ['boost lvl',   g.premium_tier != null ? `level ${g.premium_tier}` : '—'],
    ['verified',    g.verified ? 'yes' : 'no'],
  ];

  return `<div class="sc-card">
    <div class="sc-header">
      ${iconHtml}
      <span class="sc-name">${esc(g.name)}</span>
    </div>
    <div class="sc-grid">
      ${rows.map(([k,v]) => `<span class="sc-key">${k}</span><span class="sc-val">${v}</span>`).join('')}
    </div>
  </div>`;
}

function restoreServerCache() {
  const ids = Object.keys(serverCache);
  if (!ids.length) return;
  const el = document.getElementById('sc-result');
  el.innerHTML = ids.map(id => buildServerCard(serverCache[id])).join('');
  document.getElementById('sc-count').textContent = ids.length;
}


// ── Embed Builder ─────────────────────────────────────────────────────────────
function getEmbedPayload() {
  const title      = document.getElementById('eb-title').value.trim();
  const desc       = document.getElementById('eb-desc').value.trim();
  const url        = document.getElementById('eb-url').value.trim();
  const color      = parseInt(document.getElementById('eb-color').value.replace('#',''), 16);
  const authorName = document.getElementById('eb-author-name').value.trim();
  const authorIcon = document.getElementById('eb-author-icon').value.trim();
  const thumbnail  = document.getElementById('eb-thumbnail').value.trim();
  const image      = document.getElementById('eb-image').value.trim();
  const footerText = document.getElementById('eb-footer-text').value.trim();
  const footerIcon = document.getElementById('eb-footer-icon').value.trim();

  const embed = { color };
  if (title)      embed.title = title;
  if (url)        embed.url   = url;
  if (desc)       embed.description = desc;
  if (authorName) embed.author = { name: authorName, ...(authorIcon && { icon_url: authorIcon }) };
  if (thumbnail)  embed.thumbnail = { url: thumbnail };
  if (image)      embed.image     = { url: image };
  if (footerText) embed.footer = { text: footerText, ...(footerIcon && { icon_url: footerIcon }) };
  return embed;
}

function renderEmbedPreview() {
  const color      = document.getElementById('eb-color').value;
  const title      = document.getElementById('eb-title').value.trim();
  const desc       = document.getElementById('eb-desc').value.trim();
  const url        = document.getElementById('eb-url').value.trim();
  const authorName = document.getElementById('eb-author-name').value.trim();
  const authorIcon = document.getElementById('eb-author-icon').value.trim();
  const thumbnail  = document.getElementById('eb-thumbnail').value.trim();
  const image      = document.getElementById('eb-image').value.trim();
  const footerText = document.getElementById('eb-footer-text').value.trim();
  const footerIcon = document.getElementById('eb-footer-icon').value.trim();

  document.getElementById('de-pill').style.background = color;

  const authorEl = document.getElementById('de-author');
  if (authorName) {
    authorEl.style.display = 'flex';
    document.getElementById('de-author-name').textContent = authorName;
    const ai = document.getElementById('de-author-icon');
    if (authorIcon) { ai.src = authorIcon; ai.style.display = ''; }
    else ai.style.display = 'none';
  } else { authorEl.style.display = 'none'; }

  const titleEl = document.getElementById('de-title');
  if (title) {
    titleEl.innerHTML = url ? `<a href="${esc(url)}" target="_blank">${esc(title)}</a>` : esc(title);
    titleEl.style.display = '';
  } else { titleEl.style.display = 'none'; }

  const descEl = document.getElementById('de-desc');
  descEl.textContent = desc;
  descEl.style.display = desc ? '' : 'none';

  const imgEl = document.getElementById('de-image');
  if (image) { imgEl.src = image; imgEl.style.display = ''; }
  else imgEl.style.display = 'none';

  const thumbEl = document.getElementById('de-thumbnail');
  if (thumbnail) { thumbEl.src = thumbnail; thumbEl.style.display = ''; }
  else thumbEl.style.display = 'none';

  const footerEl = document.getElementById('de-footer');
  if (footerText) {
    footerEl.style.display = 'flex';
    document.getElementById('de-footer-text').textContent = footerText;
    const fi = document.getElementById('de-footer-icon');
    if (footerIcon) { fi.src = footerIcon; fi.style.display = ''; }
    else fi.style.display = 'none';
  } else { footerEl.style.display = 'none'; }

  document.getElementById('eb-json').textContent = JSON.stringify({ embeds: [getEmbedPayload()] }, null, 2);
}

async function sendEmbed() {
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  const channelId = document.getElementById('eb-channel-id').value.trim();
  if (!channelId) { modalAlert('enter a channel id.'); return; }
  const statusEl = document.getElementById('eb-status');
  statusEl.textContent = 'sending...';
  const embed = getEmbedPayload();
  let sent = false;
  for (const t of tokens) {
    try {
      const res = await dPost(`/channels/${channelId}/messages`, t, { embeds: [embed] });
      if (res.ok) { sent = true; break; }
    } catch {}
  }
  statusEl.textContent = sent ? '✓ sent to channel' : '✗ failed';
  setTimeout(() => statusEl.textContent = '', 3000);
}

async function sendEmbedDM() {
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  const guildId = document.getElementById('eb-guild-id').value.trim();
  if (!guildId) { modalAlert('enter a guild id.'); return; }
  const statusEl = document.getElementById('eb-status');
  const embed = getEmbedPayload();

  statusEl.textContent = 'fetching members...';
  let members = [];
  for (const t of tokens) {
    try {
      members = await fetchGuildMembers(guildId, t);
      if (members.length) break;
    } catch {}
  }
  if (!members.length) { statusEl.textContent = '✗ no members found'; return; }

  statusEl.textContent = `sending to ${members.length} members...`;
  let sent = 0, failed = 0;
  for (let i = 0; i < members.length; i++) {
    const uid   = members[i].id;
    const token = tokens[i % tokens.length];
    try {
      const chanRes = await dPost('/users/@me/channels', token, { recipient_id: uid });
      if (!chanRes.ok) throw new Error();
      const chan   = await chanRes.json();
      const msgRes = await dPost(`/channels/${chan.id}/messages`, token, { embeds: [embed] });
      if (msgRes.ok) sent++; else failed++;
    } catch { failed++; }
    await sleep(dmDelay * 1000);
  }
  statusEl.textContent = `✓ sent: ${sent}, failed: ${failed}`;
  setTimeout(() => statusEl.textContent = '', 5000);
}

// ── Webhook ───────────────────────────────────────────────────────────────────
function renderWebhookPreview() {
  const username = document.getElementById('wh-username').value.trim();
  const avatar   = document.getElementById('wh-avatar').value.trim();
  const content  = document.getElementById('wh-content').value;
  const useEmbed = document.getElementById('wh-embed').checked;

  // name
  document.getElementById('wh-preview-name').textContent = username || 'webhook';

  // avatar
  const img = document.getElementById('wh-avatar-img');
  if (avatar) { img.src = avatar; img.style.display = ''; }
  else img.style.display = 'none';

  // content
  const contentEl = document.getElementById('wh-preview-content');
  contentEl.textContent = content;
  contentEl.style.display = content ? '' : 'none';

  // embed mirror
  const embedWrap = document.getElementById('wh-preview-embed-wrap');
  if (useEmbed) {
    embedWrap.style.display = '';
    const color      = document.getElementById('eb-color').value;
    const title      = document.getElementById('eb-title').value.trim();
    const desc       = document.getElementById('eb-desc').value.trim();
    const url        = document.getElementById('eb-url').value.trim();
    const authorName = document.getElementById('eb-author-name').value.trim();
    const authorIcon = document.getElementById('eb-author-icon').value.trim();
    const thumbnail  = document.getElementById('eb-thumbnail').value.trim();
    const image      = document.getElementById('eb-image').value.trim();
    const footerText = document.getElementById('eb-footer-text').value.trim();
    const footerIcon = document.getElementById('eb-footer-icon').value.trim();

    document.getElementById('wh-de-pill').style.background = color;

    const authorEl = document.getElementById('wh-de-author');
    if (authorName) {
      authorEl.style.display = 'flex';
      document.getElementById('wh-de-author-name').textContent = authorName;
      const ai = document.getElementById('wh-de-author-icon');
      if (authorIcon) { ai.src = authorIcon; ai.style.display = ''; } else ai.style.display = 'none';
    } else authorEl.style.display = 'none';

    const titleEl = document.getElementById('wh-de-title');
    if (title) {
      titleEl.innerHTML = url ? `<a href="${esc(url)}" target="_blank">${esc(title)}</a>` : esc(title);
      titleEl.style.display = '';
    } else titleEl.style.display = 'none';

    const descEl = document.getElementById('wh-de-desc');
    descEl.textContent = desc; descEl.style.display = desc ? '' : 'none';

    const imgEl = document.getElementById('wh-de-image');
    if (image) { imgEl.src = image; imgEl.style.display = ''; } else imgEl.style.display = 'none';

    const thumbEl = document.getElementById('wh-de-thumbnail');
    if (thumbnail) { thumbEl.src = thumbnail; thumbEl.style.display = ''; } else thumbEl.style.display = 'none';

    const footerEl = document.getElementById('wh-de-footer');
    if (footerText) {
      footerEl.style.display = 'flex';
      document.getElementById('wh-de-footer-text').textContent = footerText;
      const fi = document.getElementById('wh-de-footer-icon');
      if (footerIcon) { fi.src = footerIcon; fi.style.display = ''; } else fi.style.display = 'none';
    } else footerEl.style.display = 'none';
  } else {
    embedWrap.style.display = 'none';
  }
}
async function sendWebhook() {
  const url      = document.getElementById('wh-url').value.trim();
  const content  = document.getElementById('wh-content').value.trim();
  const username = document.getElementById('wh-username').value.trim();
  const avatar   = document.getElementById('wh-avatar').value.trim();
  const useEmbed = document.getElementById('wh-embed').checked;
  const logEl    = document.getElementById('wh-log');
  const statusEl = document.getElementById('wh-status');

  if (!url) { modalAlert('enter a webhook url.'); return; }
  if (!content && !useEmbed) { modalAlert('add a message or attach an embed.'); return; }

  const body = {};
  if (content)  body.content  = content;
  if (username) body.username = username;
  if (avatar)   body.avatar_url = avatar;
  if (useEmbed) body.embeds = [getEmbedPayload()];

  statusEl.textContent = 'sending...';
  logEl.innerHTML += `<div class="log-line log-info">[~] posting to webhook...</div>`;

  try {
    const res = await fetch(PROXY(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok || res.status === 204) {
      logEl.innerHTML += `<div class="log-line log-ok">[✓] delivered.</div>`;
      statusEl.textContent = '✓ sent';
    } else {
      const b = await res.json().catch(() => ({}));
      logEl.innerHTML += `<div class="log-line log-err">[✗] HTTP ${res.status} — ${b.message || ''}</div>`;
      statusEl.textContent = '✗ failed';
    }
  } catch(e) {
    logEl.innerHTML += `<div class="log-line log-err">[✗] ${e.message}</div>`;
    statusEl.textContent = '✗ error';
  }
  logEl.scrollTop = logEl.scrollHeight;
  setTimeout(() => statusEl.textContent = '', 3000);
}

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
  const seen = new Map(); // id -> { id, username }
  for (let gi = 0; gi < guildIds.length; gi++) {
    if (dmStop) break;
    const gid = guildIds[gi];
    log('info', `[~] Guild ${gi+1}/${guildIds.length} — ${gid}`);
    let ok = false;
    for (const t of guildMap[gid]) {
      try {
        const members = await fetchGuildMembers(gid, t);
        members.forEach(u => { if (!seen.has(u.id)) seen.set(u.id, u); });
        log('ok', `[✓] ${members.length} member(s) from ${gid}`);
        ok = true; break;
      } catch(e) { log('err', `[✗] ${gid}: ${e.message}`); }
    }
    if (!ok) log('warn', `[~] Skipped ${gid}`);
    setProgress((gi+1) / guildIds.length * 50);
  }
  const allEntries = [...seen.values()];
  log('info', `[~] ${allEntries.length} unique user(s). Sending DMs...`);
  await dmMembers(allEntries, tokens);
}

async function fetchGuildMembers(guildId, token) {
  const members = [];
  let after = '0';
  while (true) {
    const chunk = await dGet(`/guilds/${guildId}/members?limit=1000&after=${after}`, token);
    if (!chunk.length) break;
    chunk.forEach(m => {
      if (!m.user.bot) members.push({ id: m.user.id, username: m.user.username });
    });
    if (chunk.length < 1000) break;
    after = chunk[chunk.length - 1].user.id;
  }
  return members;
}

// ── Variable substitution ─────────────────────────────────────────────────────
const DISCORD_ERRORS = {
  50007: 'cannot send messages to this user (DMs closed)',
  50278: 'user cannot be DMed (no mutual server or DMs disabled)',
  50013: 'missing permissions',
  50001: 'missing access',
  10013: 'unknown user',
  40001: 'unauthorized',
  20009: 'explicit content blocked',
  50035: 'invalid form body',
};

function applyVars(template, user) {
  // user = { id, username }
  return template
    .replace(/\{username\}/gi,  user.username || 'user')
    .replace(/\{userid\}/gi,    user.id)
    .replace(/\{mention\}/gi,   `<@${user.id}>`)
    .replace(/<@userid>/gi,     `<@${user.id}>`);
}

async function dmMembers(userEntries, toks) {
  if (!toks.length) return;

  // split entries evenly across tokens and run all concurrently
  const chunks = toks.map((_, ti) =>
    userEntries.filter((_, i) => i % toks.length === ti)
  );

  const total = userEntries.length;
  let done = 0;

  await Promise.all(chunks.map(async (chunk, ti) => {
    const token = toks[ti];
    for (const entry of chunk) {
      if (dmStop) break;
      const uid = typeof entry === 'string' ? entry : entry.id;
      const user = typeof entry === 'string' ? { id: entry, username: 'user' } : entry;
      try {
        const chanRes = await dPost('/users/@me/channels', token, { recipient_id: uid });
        if (!chanRes.ok) {
          const b = await chanRes.json().catch(() => ({}));
          const reason = DISCORD_ERRORS[b.code] || b.message || '?';
          throw new Error(`open DM failed — ${reason}`);
        }
        const chan    = await chanRes.json();
        const content = applyVars(dmMessage, user);
        const msgRes  = await dPost(`/channels/${chan.id}/messages`, token, { content });
        if (msgRes.ok) {
          statSent++;
          if (tokenStats[token]) tokenStats[token].sent++;
          const botName = tokenMeta[token]?.username || mask(token);
          log('ok', `[✓] ${uid} | ${user.username} — via ${botName}`);
        } else {
          const b = await msgRes.json().catch(() => ({}));
          const reason = DISCORD_ERRORS[b.code] || b.message || '?';
          throw new Error(`HTTP ${msgRes.status} — ${reason}`);
        }
      } catch(e) {
        statFailed++;
        if (tokenStats[token]) tokenStats[token].failed++;
        log('err', `[✗] ${uid} | ${user.username} — ${e.message}`);
      }
      done++;
      updateStats();
      setProgress(50 + done / total * 50);
      await sleep(dmDelay * 1000);
    }
  }));
}

init();
