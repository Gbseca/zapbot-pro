/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   ZapBot Pro â€” Frontend Logic
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const state = {
  ws: null,
  wsRetry: 0,
  waStatus: 'disconnected',
  campaignStatus: 'idle',
  validNumbers: [],
  selectedImage: null,
  emojiCategory: 'smileys',
  reactionCount: 1,
  pollMode: false,
  queue: [],
  stats: { total: 0, sent: 0, failed: 0, pending: 0 },
  adResearch: {
    jobId: '',
    status: 'idle',
    query: '',
    region: '',
    sort: 'popular',
    progress: null,
    summary: null,
    warnings: [],
    results: [],
    error: '',
    diagnostics: {
      collectorReady: null,
      fatalReason: '',
      perTermErrors: [],
    },
  },
};

const AD_RESEARCH_STORAGE_KEY = 'zapbot_pro_ad_research_job_id';

// â”€â”€ Emoji Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const EMOJIS = {
  smileys: ['ðŸ˜€','ðŸ˜ƒ','ðŸ˜„','ðŸ˜','ðŸ˜†','ðŸ˜…','ðŸ¤£','ðŸ˜‚','ðŸ™‚','ðŸ˜Š','ðŸ˜‡','ðŸ¥°','ðŸ˜','ðŸ¤©','ðŸ˜˜','ðŸ˜š','ðŸ˜‹','ðŸ˜›','ðŸ˜œ','ðŸ¤ª','ðŸ˜','ðŸ¤‘','ðŸ¤—','ðŸ¤”','ðŸ¤','ðŸ˜‘','ðŸ˜¶','ðŸ˜','ðŸ˜’','ðŸ™„','ðŸ˜¬','ðŸ¤¥','ðŸ˜Œ','ðŸ˜”','ðŸ˜ª','ðŸ˜´','ðŸ˜·','ðŸ¤’','ðŸ¤•','ðŸ¤¢','ðŸ¤®','ðŸ¤§','ðŸ¥µ','ðŸ¥¶','ðŸ˜µ','ðŸ¤¯','ðŸ¤ ','ðŸ¥³','ðŸ¥¸','ðŸ˜Ž','ðŸ¤“','ðŸ§','ðŸ˜£','ðŸ˜–','ðŸ˜«','ðŸ˜©','ðŸ¥º','ðŸ˜¢','ðŸ˜­','ðŸ˜¤','ðŸ˜ ','ðŸ˜¡','ðŸ¤¬','ðŸ˜ˆ','ðŸ‘¿','ðŸ’€','â˜ ï¸','ðŸ’©','ðŸ¤¡','ðŸ‘¹','ðŸ‘º','ðŸ‘»','ðŸ‘½','ðŸ‘¾','ðŸ¤–'],
  gestures: ['ðŸ‘','ðŸ‘Ž','ðŸ‘Š','âœŠ','ðŸ¤›','ðŸ¤œ','ðŸ¤ž','âœŒï¸','ðŸ¤Ÿ','ðŸ¤˜','ðŸ¤™','ðŸ‘ˆ','ðŸ‘‰','ðŸ‘†','ðŸ‘‡','â˜ï¸','âœ‹','ðŸ¤š','ðŸ–ï¸','ðŸ––','ðŸ‘‹','ðŸ¤','ðŸ™Œ','ðŸ‘','ðŸ¤²','ðŸ™','âœï¸','ðŸ’…','ðŸ¤³','ðŸ’ª','ðŸ¦µ','ðŸ¦¶','ðŸ‘‚','ðŸ¦»','ðŸ‘ƒ','ðŸ«€','ðŸ«','ðŸ§ ','ðŸ¦·','ðŸ¦´','ðŸ‘€','ðŸ‘ï¸','ðŸ‘…','ðŸ‘„','ðŸ’‹','ðŸ«¦'],
  hearts: ['â¤ï¸','ðŸ§¡','ðŸ’›','ðŸ’š','ðŸ’™','ðŸ’œ','ðŸ¤Ž','ðŸ–¤','ðŸ¤','ðŸ’”','â£ï¸','ðŸ’•','ðŸ’ž','ðŸ’“','ðŸ’—','ðŸ’–','ðŸ’˜','ðŸ’','ðŸ’Ÿ','â™¥ï¸','â¤ï¸â€ðŸ”¥','â¤ï¸â€ðŸ©¹','ðŸ’Œ','ðŸŽ','ðŸŽ€','ðŸŽŠ','ðŸŽ‰','ðŸ¥‚','ðŸ¾','ðŸ«¶'],
  objects: ['ðŸ”¥','âœ¨','ðŸŒŸ','ðŸ’«','â­','ðŸŒˆ','â˜€ï¸','ðŸŒ™','âš¡','â„ï¸','ðŸŒŠ','ðŸ’Ž','ðŸ†','ðŸ¥‡','ðŸŽ¯','ðŸŽ®','ðŸŽµ','ðŸŽ¶','ðŸŽ¸','ðŸŽ¹','ðŸ“±','ðŸ’»','ðŸ“§','ðŸ“ž','â˜Žï¸','â°','ðŸ“…','ðŸ””','ðŸ”•','ðŸ“¢','ðŸ“£','ðŸ’¡','ðŸ”®','ðŸª„','ðŸŽ¬','ðŸ“·','ðŸ¤³','ðŸŽ¤','ðŸŽ§','ðŸŽ¼','ðŸ“š','âœï¸','ðŸ–Šï¸','ðŸ“','ðŸ—’ï¸','ðŸ“Œ','ðŸ”‘','ðŸ”’','ðŸ”“','ðŸ’°','ðŸ’µ','ðŸ’´','ðŸ’¶','ðŸ’·','ðŸ’¸','ðŸ ','ðŸš€','ðŸ›¸','âœˆï¸','ðŸš—','ðŸï¸'],
  symbols: ['âœ…','âŒ','âš ï¸','ðŸš¨','â„¹ï¸','â“','â—','â€¼ï¸','â‰ï¸','ðŸ”´','ðŸŸ ','ðŸŸ¡','ðŸŸ¢','ðŸ”µ','ðŸŸ£','âš«','âšª','ðŸ”¶','ðŸ”·','ðŸ”¸','ðŸ”¹','ðŸ’¯','ðŸ†•','ðŸ†—','ðŸ†’','ðŸ†™','ðŸ”','ðŸ”œ','ðŸ”›','ðŸ”š','â­•','ðŸ”ž','ðŸˆµ','ðŸˆ²','ðŸ†“','ðŸ†–','ðŸ…°ï¸','ðŸ…±ï¸','ðŸ†Ž','ðŸ†‘','ðŸ…¾ï¸','ðŸ†˜','ðŸš«','â›”','ðŸ“µ','ðŸ”‡','ðŸ”•','ðŸš·','ðŸš¯','ðŸš³','ðŸš±','ðŸ“¶','ðŸ”ˆ','ðŸ”‰','ðŸ”Š','ðŸ“³','ðŸ“´','â™»ï¸','ðŸ”ƒ','ðŸ”„'],
  numbers: ['0ï¸âƒ£','1ï¸âƒ£','2ï¸âƒ£','3ï¸âƒ£','4ï¸âƒ£','5ï¸âƒ£','6ï¸âƒ£','7ï¸âƒ£','8ï¸âƒ£','9ï¸âƒ£','ðŸ”Ÿ','ðŸ’¯','#ï¸âƒ£','*ï¸âƒ£','â–¶ï¸','â¸ï¸','â¹ï¸','âºï¸','â­ï¸','â®ï¸','â©','âª','â«','â¬','ðŸ”€','ðŸ”','ðŸ”‚','ðŸ”¼','ðŸ”½','âž•','âž–','âž—','âœ–ï¸','ðŸ’²','ðŸ’±','â„¢ï¸','Â©ï¸','Â®ï¸'],
};

const REACTION_EMOJIS = ['1ï¸âƒ£','2ï¸âƒ£','3ï¸âƒ£','4ï¸âƒ£','5ï¸âƒ£','6ï¸âƒ£','7ï¸âƒ£','8ï¸âƒ£','9ï¸âƒ£'];

// â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWebSocket();
  renderEmojiGrid();
  initReactions();
  updateEstimate();
  renderAdResearchState();
  restoreAdResearchJob();

  // Close emoji picker on outside click
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('emoji-picker');
    const btn = document.getElementById('emoji-btn');
    if (!picker.classList.contains('hidden') && !picker.contains(e.target) && e.target !== btn) {
      picker.classList.add('hidden');
    }
  });
});

// â”€â”€ WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;

  ws.onopen = () => {
    state.wsRetry = 0;
    appendLog('info', 'ðŸ”Œ Conectado ao servidor ZapBot Pro.');
  };

  ws.onmessage = (e) => {
    try {
      handleWsMessage(JSON.parse(e.data));
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  ws.onclose = () => {
    const delay = Math.min(1000 * Math.pow(2, state.wsRetry++), 10000);
    setTimeout(initWebSocket, delay);
  };

  ws.onerror = () => ws.close();
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'status':       handleStatusUpdate(data.status); break;
    case 'qr':           handleQRCode(data.qr); break;
    case 'log':          appendLog(data.level, data.message); break;
    case 'stats':        updateStats(data.stats); break;
    case 'queue_update': updateQueueItem(data.index, data.status, data.sentAt, data.error); break;
    case 'campaign_status': handleCampaignStatus(data.status); break;
    case 'campaign_loaded': handleCampaignLoaded(data); break;
    case 'campaign_cleared':
      state.queue = [];
      state.stats = { total: 0, sent: 0, failed: 0, pending: 0 };
      renderQueueList();
      updateStats(state.stats);
      handleCampaignStatus('idle');
      break;
    case 'ai_status':
      updateAIStatusUI(data.enabled);
      updateBadge('ai-agent', data.enabled ? 'â—' : null);
      break;
    case 'ad_research_update':
      handleAdResearchUpdate(data.job);
      break;
  }
}

// â”€â”€ WhatsApp Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleStatusUpdate(status) {
  state.waStatus = status;
  const dot = document.getElementById('pill-dot');
  const text = document.getElementById('pill-text');
  const statusEl = document.getElementById('status-text');
  const qrImg = document.getElementById('qr-image');
  const qrPH = document.getElementById('qr-placeholder');
  const qrConn = document.getElementById('qr-connected');
  const badge = document.getElementById('badge-connection');

  dot.className = 'pill-dot';
  qrImg.classList.add('hidden');
  qrPH.style.display = 'none';
  qrConn.classList.add('hidden');
  badge.classList.remove('visible');

  if (status === 'connected') {
    dot.classList.add('connected');
    text.textContent = 'Conectado';
    statusEl.textContent = 'â— Conectado';
    statusEl.className = 'status-value status-connected';
    qrConn.classList.remove('hidden');
    showToast('âœ… WhatsApp conectado!', 'success');
    updateBadge('connection', 'âœ“');
  } else if (status === 'qr_ready') {
    dot.classList.add('connecting');
    text.textContent = 'Aguardando scan...';
    statusEl.textContent = 'â— Aguardando QR';
    statusEl.className = 'status-value status-connecting';
    qrPH.style.display = 'flex';
    qrPH.innerHTML = '<p style="color:#888;font-size:13px">Carregando QR Code...</p>';
  } else {
    dot.classList.add('disconnected');
    text.textContent = 'Desconectado';
    statusEl.textContent = 'â— Desconectado';
    statusEl.className = 'status-value status-disconnected';
    qrPH.style.display = 'flex';
    qrPH.innerHTML = '<div class="qr-spinner-ring"></div><p>Conectando ao servidor...</p>';
  }
}

function handleQRCode(qrDataUrl) {
  const qrImg = document.getElementById('qr-image');
  const qrPH = document.getElementById('qr-placeholder');
  const qrConn = document.getElementById('qr-connected');
  qrPH.style.display = 'none';
  qrConn.classList.add('hidden');
  qrImg.src = qrDataUrl;
  qrImg.classList.remove('hidden');
}

async function disconnectWhatsApp() {
  if (!confirm('Tem certeza? Isso encerrarÃ¡ a sessÃ£o atual e gerarÃ¡ um novo QR Code.')) return;
  try {
    const r = await fetch('/api/disconnect', { method: 'POST' });
    const d = await r.json();
    showToast(d.message || 'SessÃ£o encerrada.', 'info');
  } catch (err) {
    showToast('Erro ao desconectar: ' + err.message, 'error');
  }
}

// â”€â”€ Tab Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initTabs() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tabId}`)?.classList.add('active');
  document.getElementById(`nav-${tabId}`)?.classList.add('active');

  if (tabId === 'schedule') updateEstimate();
  if (tabId === 'ai-agent') loadAIConfig();
  if (tabId === 'ad-research') loadAdResearchTab();
  if (tabId === 'leads') loadLeads();
}

function updateBadge(tabId, text) {
  const badge = document.getElementById(`badge-${tabId}`);
  if (!badge) return;
  if (text) { badge.textContent = text; badge.classList.add('visible'); }
  else { badge.classList.remove('visible'); }
}

// â”€â”€ Contacts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function validateContactsList() {
  const raw = document.getElementById('contacts-textarea').value;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const valid = [];
  const invalid = [];

  lines.forEach(line => {
    // Strip spaces, dashes, parens, plus sign
    let clean = line.replace(/[\s\-\(\)\+]/g, '');
    // Remove leading 55 only if total > 11 (country code present)
    if (clean.startsWith('55') && clean.length > 11) {
      clean = clean.slice(2);
    }
    if (/^\d{10,11}$/.test(clean)) {
      valid.push(clean);
    } else if (line.length > 0) {
      invalid.push(line);
    }
  });

  state.validNumbers = valid;
  document.getElementById('val-total').textContent = lines.length;
  document.getElementById('val-valid').textContent = valid.length;
  document.getElementById('val-invalid').textContent = invalid.length;

  const invalidList = document.getElementById('invalid-list');
  if (invalid.length > 0) {
    invalidList.classList.remove('hidden');
    document.getElementById('invalid-items').innerHTML = invalid
      .map(n => `<span class="invalid-tag">${n}</span>`).join('');
  } else {
    invalidList.classList.add('hidden');
  }

  // Badge
  if (valid.length > 0) {
    updateBadge('contacts', valid.length);
  } else {
    updateBadge('contacts', null);
  }

  updateEstimate();
}

function clearContacts() {
  document.getElementById('contacts-textarea').value = '';
  validateContactsList();
}

function importExample() {
  document.getElementById('contacts-textarea').value =
    '11999990001\n21988880002\n31977770003\n41966660004\n51955550005';
  validateContactsList();
}

// â”€â”€ Emoji Picker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toggleEmojiPicker(e) {
  e.stopPropagation();
  const picker = document.getElementById('emoji-picker');
  picker.classList.toggle('hidden');
  if (!picker.classList.contains('hidden')) {
    document.getElementById('emoji-search-input').focus();
  }
}

function renderEmojiGrid(filter = '') {
  const grid = document.getElementById('emoji-grid');
  const emojis = EMOJIS[state.emojiCategory] || EMOJIS.smileys;
  const filtered = filter
    ? Object.values(EMOJIS).flat().filter(e => e.includes(filter))
    : emojis;

  grid.innerHTML = filtered.map(emoji =>
    `<button class="emoji-btn-item" onclick="insertEmoji('${emoji}')" title="${emoji}">${emoji}</button>`
  ).join('');
}

function switchEmojiCat(cat, btn) {
  state.emojiCategory = cat;
  document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('emoji-search-input').value = '';
  renderEmojiGrid();
}

function filterEmojis(val) {
  if (val.length === 0) { renderEmojiGrid(); return; }
  // Simple search: show all emojis matching the unicode block
  const all = Object.values(EMOJIS).flat();
  const grid = document.getElementById('emoji-grid');
  grid.innerHTML = all.map(e =>
    `<button class="emoji-btn-item" onclick="insertEmoji('${e}')" title="${e}">${e}</button>`
  ).join('');
}

function insertEmoji(emoji) {
  const ta = document.getElementById('message-textarea');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  ta.value = val.slice(0, start) + emoji + val.slice(end);
  ta.selectionStart = ta.selectionEnd = start + emoji.length;
  ta.focus();
  updateMessagePreview();
  updateCharCount();
}

function wrapSelection(char) {
  const ta = document.getElementById('message-textarea');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.slice(start, end);
  const replacement = `${char}${selected || 'texto'}${char}`;
  ta.value = ta.value.slice(0, start) + replacement + ta.value.slice(end);
  ta.selectionStart = start + char.length;
  ta.selectionEnd = start + char.length + (selected || 'texto').length;
  ta.focus();
  updateMessagePreview();
  updateCharCount();
}

// â”€â”€ Reactions Builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initReactions() {
  renderReactions();
}

function renderReactions() {
  const list = document.getElementById('reactions-list');
  list.innerHTML = '';
  for (let i = 0; i < state.reactionCount; i++) {
    const div = document.createElement('div');
    div.className = 'reaction-item';
    div.innerHTML = `
      <span class="reaction-number">${REACTION_EMOJIS[i] || (i+1)}</span>
      <input type="text" class="reaction-input" id="reaction-${i}" placeholder="Ex: SIM, tenho interesse" />
      <button class="reaction-remove" onclick="removeReaction(${i})">âœ•</button>
    `;
    list.appendChild(div);
  }
}

function addReaction() {
  if (state.reactionCount >= 9) { showToast('MÃ¡ximo de 9 opÃ§Ãµes!', 'warning'); return; }
  state.reactionCount++;
  renderReactions();
}

function removeReaction(index) {
  if (state.reactionCount <= 1) { showToast('Pelo menos 1 opÃ§Ã£o Ã© necessÃ¡ria.', 'warning'); return; }
  // Collect current values
  const vals = collectReactionValues();
  vals.splice(index, 1);
  state.reactionCount--;
  renderReactions();
  // Restore values
  vals.forEach((v, i) => {
    const el = document.getElementById(`reaction-${i}`);
    if (el) el.value = v;
  });
}

function clearReactions() {
  state.reactionCount = 1;
  renderReactions();
}

// Ativa/desativa modo enquete nativa
function togglePollMode() {
  state.pollMode = document.getElementById('poll-mode').checked;
  const group = document.getElementById('poll-question-group');
  if (state.pollMode) {
    group.classList.remove('hidden');
    showToast('ðŸ“Š Modo enquete ativo! As opÃ§Ãµes serÃ£o enviadas como enquete nativa.', 'info');
  } else {
    group.classList.add('hidden');
  }
}

function collectReactionValues() {
  const vals = [];
  for (let i = 0; i < state.reactionCount; i++) {
    const el = document.getElementById(`reaction-${i}`);
    vals.push(el ? el.value : '');
  }
  return vals;
}

function insertReactionsInMessage() {
  const vals = collectReactionValues();
  // Usa valor preenchido ou texto padrÃ£o para campos vazios
  const options = vals.map((v, i) => v.trim() || `OpÃ§Ã£o ${i + 1}`);

  const block = '\n\n*Selecione uma opÃ§Ã£o:*\n' +
    options.map((v, i) => `${REACTION_EMOJIS[i]} ${v}`).join('\n') +
    '\n\n*Responda com o nÃºmero da sua escolha.*';

  const ta = document.getElementById('message-textarea');
  ta.value += block;
  updateMessagePreview();
  updateCharCount();
  showToast('OpÃ§Ãµes inseridas na mensagem!', 'success');
}

// â”€â”€ Image Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-area').classList.add('drag-over');
}
function handleDragLeave(e) {
  document.getElementById('upload-area').classList.remove('drag-over');
}
function handleImageDrop(e) {
  e.preventDefault();
  document.getElementById('upload-area').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
}
function handleImageSelect(e) {
  const file = e.target.files[0];
  if (file) loadImageFile(file);
}

function loadImageFile(file) {
  if (file.size > 16 * 1024 * 1024) { showToast('Imagem muito grande! MÃ¡x. 16MB.', 'error'); return; }
  state.selectedImage = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    const src = e.target.result;
    document.getElementById('preview-img').src = src;
    document.getElementById('upload-placeholder').classList.add('hidden');
    document.getElementById('upload-preview').classList.remove('hidden');
    // Update message bubble preview
    document.getElementById('bubble-img').src = src;
    document.getElementById('preview-image-bubble').classList.remove('hidden');
    updateBadge('message', 'ðŸ–¼');
  };
  reader.readAsDataURL(file);
}

function removeImage(e) {
  e.stopPropagation();
  state.selectedImage = null;
  document.getElementById('image-input').value = '';
  document.getElementById('upload-placeholder').classList.remove('hidden');
  document.getElementById('upload-preview').classList.add('hidden');
  document.getElementById('preview-image-bubble').classList.add('hidden');
  updateBadge('message', null);
}

// â”€â”€ Message Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateMessagePreview() {
  const text = document.getElementById('message-textarea').value;
  const preview = document.getElementById('preview-text');
  // Convert WhatsApp markdown: *bold*, _italic_, ~strike~
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/\n/g, '<br>');

  if (!html) {
    preview.innerHTML = '<em style="color:#666">Sua mensagem aparecerÃ¡ aqui...</em>';
  } else {
    preview.innerHTML = html;
  }

  if (text.trim()) updateBadge('message', 'âœ“');
  else updateBadge('message', null);
}

function updateCharCount() {
  const len = document.getElementById('message-textarea').value.length;
  document.getElementById('char-count').textContent = len;
}

// â”€â”€ Schedule Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateIntervalMode() {
  const mode = document.querySelector('input[name="interval-mode"]:checked').value;
  const fixedGroup = document.getElementById('interval-fixed-group');
  const randomGroup = document.getElementById('interval-random-group');
  if (mode === 'fixed') {
    fixedGroup.classList.remove('hidden');
    randomGroup.classList.add('hidden');
  } else {
    fixedGroup.classList.add('hidden');
    randomGroup.classList.remove('hidden');
  }
  updateEstimate();
}

function toggleTimeWindow() {
  const checked = document.getElementById('use-window').checked;
  const settings = document.getElementById('time-window-settings');
  if (checked) settings.classList.remove('hidden');
  else settings.classList.add('hidden');
}

function toggleDailyLimit() {
  const checked = document.getElementById('anti-limit').checked;
  const settings = document.getElementById('limit-settings');
  if (checked) settings.classList.remove('hidden');
  else settings.classList.add('hidden');
}

function updateEstimate() {
  const contacts = state.validNumbers.length;
  document.getElementById('est-contacts').textContent = contacts;

  const mode = document.querySelector('input[name="interval-mode"]:checked')?.value || 'fixed';
  let avgSec;
  if (mode === 'random') {
    const min = parseInt(document.getElementById('interval-min')?.value) || 20;
    const max = parseInt(document.getElementById('interval-max')?.value) || 90;
    avgSec = Math.round((min + max) / 2);
    document.getElementById('est-interval').textContent = `~${avgSec}s`;
  } else {
    avgSec = parseInt(document.getElementById('interval-fixed-val')?.value) || 45;
    document.getElementById('est-interval').textContent = `${avgSec}s`;
  }

  if (contacts > 0) {
    const totalSec = contacts * avgSec;
    document.getElementById('est-duration').textContent = formatDuration(totalSec);
    const end = new Date(Date.now() + totalSec * 1000);
    document.getElementById('est-end').textContent = end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } else {
    document.getElementById('est-duration').textContent = 'â€”';
    document.getElementById('est-end').textContent = 'â€”';
  }
}

function formatDuration(totalSec) {
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.round(totalSec / 60)}min`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// â”€â”€ Campaign â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function startCampaign() {
  if (state.waStatus !== 'connected') {
    showToast('Conecte o WhatsApp primeiro!', 'error');
    switchTab('connection');
    return;
  }
  if (state.validNumbers.length === 0) {
    showToast('Adicione contatos vÃ¡lidos!', 'error');
    switchTab('contacts');
    return;
  }
  const message = document.getElementById('message-textarea').value.trim();
  if (!message) {
    showToast('Digite uma mensagem!', 'error');
    switchTab('message');
    return;
  }

  // Coletar dados de enquete (se modo poll ativo)
  const pollMode = document.getElementById('poll-mode')?.checked || false;
  let pollOptions = [];
  let pollQuestion = '';
  if (pollMode) {
    const vals = collectReactionValues();
    pollOptions = vals.map((v, i) => v.trim() || `OpÃ§Ã£o ${i + 1}`);
    pollQuestion = document.getElementById('poll-question')?.value?.trim() || '';
    if (pollOptions.length < 2) {
      showToast('A enquete precisa de pelo menos 2 opÃ§Ãµes!', 'error');
      return;
    }
  }

  const mode = document.querySelector('input[name="interval-mode"]:checked').value;
  const scheduleConfig = {
    intervalMode: mode,
    intervalFixed: document.getElementById('interval-fixed-val').value,
    intervalMin: document.getElementById('interval-min').value,
    intervalMax: document.getElementById('interval-max').value,
    useWindow: document.getElementById('use-window').checked,
    windowStart: document.getElementById('window-start').value,
    windowEnd: document.getElementById('window-end').value,
  };

  const antiRestriction = {
    typing: document.getElementById('anti-typing').checked,
    variation: document.getElementById('anti-variation').checked,
    useLimit: document.getElementById('anti-limit').checked,
    dailyLimit: document.getElementById('daily-limit').value,
  };

  const payload = {
    numbers: state.validNumbers,
    message,
    pollEnabled: pollMode,
    pollOptions,
    pollQuestion,
    scheduleConfig,
    antiRestriction,
  };

  const formData = new FormData();
  formData.append('data', JSON.stringify(payload));
  if (state.selectedImage) {
    formData.append('image', state.selectedImage);
  }

  try {
    const btn = document.getElementById('btn-start');
    btn.disabled = true;
    btn.textContent = 'â³ Iniciando...';

    const r = await fetch('/api/campaign/start', { method: 'POST', body: formData });
    const d = await r.json();

    if (r.ok) {
      showToast(d.message || 'Campanha iniciada!', 'success');
      switchTab('campaign');
    } else {
      showToast(d.error || 'Erro ao iniciar.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexÃ£o: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('btn-start');
    btn.disabled = false;
    btn.textContent = 'ðŸš€ Iniciar Campanha';
  }
}

async function pauseCampaign() {
  await fetch('/api/campaign/pause', { method: 'POST' });
}
async function resumeCampaign() {
  await fetch('/api/campaign/resume', { method: 'POST' });
}
async function stopCampaign() {
  if (!confirm('Tem certeza que deseja parar a campanha?')) return;
  await fetch('/api/campaign/stop', { method: 'POST' });
}

async function clearQueue() {
  if (state.campaignStatus === 'running') {
    showToast('Pause ou pare a campanha antes de limpar.', 'warning');
    return;
  }
  if (!confirm('Limpar todo o histÃ³rico da fila?')) return;
  try {
    const r = await fetch('/api/campaign/clear', { method: 'POST' });
    const d = await r.json();
    if (r.ok) {
      showToast('HistÃ³rico limpo!', 'success');
    } else {
      showToast(d.error || 'Erro ao limpar.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

// â”€â”€ Campaign Status Updates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleCampaignLoaded(data) {
  state.stats = data.stats;
  state.queue = data.queue;
  renderQueueList();
  updateStats(data.stats);
}

function handleCampaignStatus(status) {
  state.campaignStatus = status;
  const label = document.getElementById('campaign-status-label');
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnResume = document.getElementById('btn-resume');
  const btnStop = document.getElementById('btn-stop');

  const map = {
    idle:      { text: 'ðŸ’¤ Aguardando', cls: 'status-idle' },
    running:   { text: 'ðŸš€ Enviando...', cls: 'status-running' },
    paused:    { text: 'â¸ï¸ Pausado', cls: 'status-paused' },
    stopped:   { text: 'ðŸ›‘ Parado', cls: 'status-stopped' },
    completed: { text: 'âœ… ConcluÃ­do', cls: 'status-completed' },
  };

  const info = map[status] || map.idle;
  label.textContent = info.text;
  label.className = `campaign-status-badge ${info.cls}`;

  // Show/hide buttons
  btnStart.classList.add('hidden');
  btnPause.classList.add('hidden');
  btnResume.classList.add('hidden');
  btnStop.classList.add('hidden');

  if (status === 'idle' || status === 'completed' || status === 'stopped') {
    btnStart.classList.remove('hidden');
  }
  if (status === 'running') {
    btnPause.classList.remove('hidden');
    btnStop.classList.remove('hidden');
  }
  if (status === 'paused') {
    btnResume.classList.remove('hidden');
    btnStop.classList.remove('hidden');
  }

  updateBadge('campaign', status === 'running' ? 'â—' : null);
}

function updateStats(stats) {
  state.stats = stats;
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-sent').textContent = stats.sent;
  document.getElementById('stat-failed').textContent = stats.failed;
  document.getElementById('stat-pending').textContent = stats.pending;

  const pct = stats.total > 0 ? Math.round(((stats.sent + stats.failed) / stats.total) * 100) : 0;
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('progress-pct').textContent = `${pct}%`;
}

function updateQueueItem(index, status, sentAt, error) {
  if (index >= state.queue.length) return;
  state.queue[index] = { ...state.queue[index], status, sentAt, error };

  const item = document.getElementById(`qi-${index}`);
  if (!item) {
    renderQueueList();
    return;
  }

  const dot = item.querySelector('.queue-item-dot');
  const statusEl = item.querySelector('.queue-item-status');
  dot.className = `queue-item-dot dot-${status}`;

  if (status === 'sent') {
    statusEl.textContent = 'âœ… Enviado';
    statusEl.className = 'queue-item-status sent';
    item.classList.remove('active-item');
  } else if (status === 'failed') {
    statusEl.textContent = `âŒ Falha`;
    statusEl.className = 'queue-item-status failed';
    item.classList.remove('active-item');
  } else if (status === 'sending') {
    statusEl.textContent = 'ðŸ“¤ Enviando...';
    statusEl.className = 'queue-item-status sending';
    item.classList.add('active-item');
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function renderQueueList() {
  const list = document.getElementById('queue-list');
  if (!state.queue || state.queue.length === 0) {
    list.innerHTML = '<div class="queue-empty">Nenhuma campanha carregada ainda</div>';
    return;
  }
  list.innerHTML = state.queue.map((item, i) => `
    <div class="queue-item" id="qi-${i}">
      <span class="queue-item-dot dot-${item.status}"></span>
      <span class="queue-item-num">+55 ${item.number}</span>
      <span class="queue-item-status ${item.status === 'sent' ? 'sent' : item.status === 'failed' ? 'failed' : ''}">
        ${item.status === 'sent' ? 'âœ… Enviado' : item.status === 'failed' ? 'âŒ Falha' : item.status === 'sending' ? 'ðŸ“¤ Enviando...' : 'â³ Pendente'}
      </span>
    </div>
  `).join('');
}

// â”€â”€ Log Console â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function appendLog(level, message) {
  const console_ = document.getElementById('log-console');
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  line.textContent = message;
  console_.appendChild(line);
  console_.scrollTop = console_.scrollHeight;
}

function clearLog() {
  document.getElementById('log-console').innerHTML = '';
}

// â”€â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ AI AGENT TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function loadAdResearchTab() {
  renderAdResearchState();
  restoreAdResearchJob();
}

function getStoredAdResearchJobId() {
  try {
    return localStorage.getItem(AD_RESEARCH_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredAdResearchJobId(jobId) {
  try {
    if (jobId) localStorage.setItem(AD_RESEARCH_STORAGE_KEY, jobId);
    else localStorage.removeItem(AD_RESEARCH_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function setAdResearchButtonBusy(isBusy) {
  const button = document.getElementById('btn-start-ad-search');
  if (!button) return;
  button.disabled = !!isBusy;
  button.textContent = isBusy ? 'Pesquisando...' : 'Pesquisar anuncios';
}

function syncAdResearchInputs() {
  const queryInput = document.getElementById('ad-search-query');
  const regionInput = document.getElementById('ad-search-region');
  const sortInput = document.getElementById('ad-search-sort');

  if (queryInput && state.adResearch.query && document.activeElement !== queryInput) {
    queryInput.value = state.adResearch.query;
  }
  if (regionInput && document.activeElement !== regionInput) {
    regionInput.value = state.adResearch.region || '';
  }
  if (sortInput) {
    sortInput.value = state.adResearch.sort || 'popular';
  }
}

function formatAdResearchDate(value) {
  if (!value) return 'Data nao informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data nao informada';
  return date.toLocaleDateString('pt-BR');
}

function sortAdResearchResults(results = [], sort = 'popular') {
  const list = [...results];
  if (sort === 'recent') {
    return list.sort((left, right) => {
      const leftDate = Date.parse(left.deliveryStart || 0);
      const rightDate = Date.parse(right.deliveryStart || 0);
      return rightDate - leftDate || (right.relevanceScore || 0) - (left.relevanceScore || 0);
    });
  }
  if (sort === 'relevant') {
    return list.sort((left, right) => (
      (right.relevanceScore || 0) - (left.relevanceScore || 0)
      || (right.popularityScore || 0) - (left.popularityScore || 0)
      || (right.metaImpressionHint || 0) - (left.metaImpressionHint || 0)
    ));
  }
  return list.sort((left, right) => (
    (right.popularityScore || 0) - (left.popularityScore || 0)
    || (right.metaImpressionHint || 0) - (left.metaImpressionHint || 0)
    || (right.relevanceScore || 0) - (left.relevanceScore || 0)
  ));
}

function renderAdResearchResults() {
  const container = document.getElementById('ad-search-results');
  if (!container) return;

  const results = sortAdResearchResults(state.adResearch.results || [], state.adResearch.sort || 'popular');
  if (!results.length) {
    container.innerHTML = `<div class="queue-empty">${escapeHtml(getAdResearchEmptyStateMessage())}</div>`;
    return;
  }

  container.innerHTML = results.map((result, index) => `
    <article class="ad-result-card">
      <div class="ad-result-top">
        <div>
          <div class="ad-result-rank">#${index + 1} em ${state.adResearch.sort === 'recent' ? 'mais recentes' : state.adResearch.sort === 'relevant' ? 'mais relevantes' : 'mais populares'}</div>
          <h3 class="ad-result-title">${escapeHtml(result.advertiserName || 'Anunciante')}</h3>
          <div class="ad-result-meta-line">
            <span>Meta Ads</span>
            <span>${formatAdResearchDate(result.deliveryStart)}</span>
            <span>${escapeHtml(result.regionLabel || 'Nao identificado')} (${escapeHtml(result.regionConfidence || 'baixa')})</span>
          </div>
        </div>
        <div class="ad-score-badge">
          <strong>${Number(result.popularityScore || 0)}</strong>
          <span>score</span>
        </div>
      </div>

      <div class="ad-result-summary">${escapeHtml(result.copySummary || 'Resumo indisponivel')}</div>
      <div class="ad-result-copy">${escapeHtml(result.adText || '')}</div>

      <div class="ad-result-reasons">
        ${(result.popularityReasons || []).map((reason) => `<span class="ad-chip">${escapeHtml(reason)}</span>`).join('')}
      </div>

      <div class="ad-result-details">
        <div><strong>Por que apareceu:</strong> ${escapeHtml(result.matchReason || 'Afinidade com o nicho pesquisado.')}</div>
        <div><strong>Leitura do ranking:</strong> ${escapeHtml(result.popularityExplanation || 'Score montado pelos sinais publicos da Meta.')}</div>
        <div><strong>Regiao:</strong> ${escapeHtml(result.regionSource || 'Sem pistas suficientes.')}</div>
        ${result.landingDomain ? `<div><strong>Dominio:</strong> ${escapeHtml(result.landingDomain)}</div>` : ''}
      </div>

      <div class="ad-result-actions">
        <button class="btn btn-purple btn-sm" onclick="copyAdResearchCopy('${String(result.id || '').replace(/'/g, '')}')">Copiar copy</button>
        <a class="btn btn-outline btn-sm" href="${result.adUrl || '#'}" target="_blank" rel="noopener noreferrer">Abrir anuncio</a>
      </div>
    </article>
  `).join('');
}

function renderAdResearchState() {
  syncAdResearchInputs();

  const statusBadge = document.getElementById('ad-search-status-badge');
  const progressText = document.getElementById('ad-search-progress-text');
  const progressFill = document.getElementById('ad-search-progress-fill');
  const meta = document.getElementById('ad-search-meta');
  const summary = document.getElementById('ad-search-results-summary');
  const terms = document.getElementById('ad-search-expanded-terms');

  if (statusBadge) {
    statusBadge.className = `campaign-status-badge ${getAdResearchBadgeClass(state.adResearch.status)}`;
    statusBadge.textContent = state.adResearch.status || 'idle';
  }

  if (progressText) {
    progressText.textContent = state.adResearch.progress?.message || 'Nenhuma busca iniciada ainda.';
  }

  if (progressFill) {
    progressFill.style.width = `${Math.max(0, Math.min(100, state.adResearch.progress?.percent || 0))}%`;
  }

  if (meta) {
    const pieces = [
      state.adResearch.progress?.step || 'Sem consulta em andamento.',
      Number.isFinite(state.adResearch.progress?.queriesCompleted) && Number.isFinite(state.adResearch.progress?.queriesTotal)
        ? `${state.adResearch.progress.queriesCompleted}/${state.adResearch.progress.queriesTotal} consultas`
        : '',
      Number.isFinite(state.adResearch.progress?.resultsFound)
        ? `${state.adResearch.progress.resultsFound} anuncios consolidados`
        : '',
      getAdResearchWarnings().length ? `${getAdResearchWarnings().length} aviso(s)` : '',
    ].filter(Boolean);
    meta.textContent = pieces.join(' • ') || 'Sem consulta em andamento.';
  }

  if (summary) {
    const searchTermsCount = state.adResearch.summary?.searchTerms?.length || 0;
    if (state.adResearch.results?.length) {
      summary.textContent = state.adResearch.status === 'partial'
        ? `${state.adResearch.results.length} anuncios consolidados em ${searchTermsCount || 0} consultas, com avisos no caminho.`
        : `${state.adResearch.results.length} anuncios consolidados em ${searchTermsCount || 0} consultas.`;
    } else if (state.adResearch.status === 'running') {
      summary.textContent = 'Buscando anuncios e montando ranking...';
    } else if (state.adResearch.status === 'failed') {
      summary.textContent = getAdResearchFatalReason() || state.adResearch.error || 'A busca falhou.';
    } else if (state.adResearch.status === 'partial') {
      summary.textContent = 'A busca terminou com avisos e sem anuncios consolidados.';
    } else if (state.adResearch.status === 'completed') {
      summary.textContent = 'A busca terminou, mas nenhum anuncio publico foi consolidado para esse recorte.';
    } else {
      summary.textContent = 'Inicie uma busca para listar os anuncios aqui.';
    }
  }

  if (terms) {
    const searchTerms = state.adResearch.summary?.searchTerms || [];
    terms.innerHTML = searchTerms.length
      ? searchTerms.map((term) => `<span class="ad-chip">${escapeHtml(term)}</span>`).join('')
      : '<span class="ad-chip muted">Sem expansao carregada ainda</span>';
  }

  renderAdResearchDiagnostics();
  renderAdResearchResults();
  updateBadge('ad-research', state.adResearch.status === 'running' ? '...' : (state.adResearch.results?.length || null));
  setAdResearchButtonBusy(state.adResearch.status === 'running');
}

function applyAdResearchJob(job) {
  if (!job) return;

  state.adResearch = {
    ...state.adResearch,
    jobId: job.jobId || state.adResearch.jobId,
    status: job.status || state.adResearch.status,
    query: job.query || state.adResearch.query,
    region: job.region || '',
    sort: job.sort || state.adResearch.sort || 'popular',
    progress: job.progress || null,
    summary: job.summary || null,
    warnings: job.warnings || [],
    results: Array.isArray(job.results) ? job.results : [],
    error: job.error || '',
    diagnostics: job.diagnostics || {
      collectorReady: null,
      fatalReason: '',
      perTermErrors: [],
    },
  };

  if (state.adResearch.jobId) setStoredAdResearchJobId(state.adResearch.jobId);
  renderAdResearchState();
}

function handleAdResearchUpdate(job) {
  const storedJobId = getStoredAdResearchJobId();
  if (!job?.jobId) return;

  if (!state.adResearch.jobId && !storedJobId) {
    applyAdResearchJob(job);
    return;
  }

  if (job.jobId === state.adResearch.jobId || job.jobId === storedJobId) {
    applyAdResearchJob(job);
  }
}

async function loadAdResearchJob(jobId, showErrors = false) {
  if (!jobId) return null;

  try {
    const response = await fetch(`/api/ad-research/${encodeURIComponent(jobId)}`);
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 404) {
        setStoredAdResearchJobId('');
        state.adResearch = {
          ...state.adResearch,
          jobId: '',
          status: 'idle',
          progress: null,
          summary: null,
          warnings: [],
          results: [],
          error: '',
          diagnostics: {
            collectorReady: null,
            fatalReason: '',
            perTermErrors: [],
          },
        };
        renderAdResearchState();
        if (showErrors) showToast('A ultima busca salva nao esta mais disponivel.', 'warning');
        return null;
      }
      throw new Error(payload.error || 'Nao foi possivel carregar a busca.');
    }

    applyAdResearchJob(payload);
    return payload;
  } catch (error) {
    if (showErrors) showToast(`Erro ao carregar busca: ${error.message}`, 'error');
    return null;
  }
}

async function restoreAdResearchJob(forceToast = false) {
  const storedJobId = getStoredAdResearchJobId();
  if (!storedJobId) {
    if (forceToast) showToast('Nenhuma busca salva para recuperar.', 'info');
    renderAdResearchState();
    return null;
  }

  return loadAdResearchJob(storedJobId, forceToast);
}

async function startAdResearch() {
  const queryInput = document.getElementById('ad-search-query');
  const regionInput = document.getElementById('ad-search-region');
  const sortInput = document.getElementById('ad-search-sort');

  const query = queryInput?.value.trim() || '';
  const region = regionInput?.value.trim() || '';
  const sort = sortInput?.value || 'popular';

  if (!query) {
    showToast('Informe o nicho ou objetivo da busca.', 'warning');
    queryInput?.focus();
    return;
  }

  state.adResearch = {
    ...state.adResearch,
    jobId: '',
    status: 'running',
    query,
    region,
    sort,
    progress: {
      percent: 1,
      step: 'Preparando',
      message: 'Criando a busca inteligente...',
      queriesTotal: 0,
      queriesCompleted: 0,
      resultsFound: 0,
    },
    summary: null,
    results: [],
    warnings: [],
    error: '',
    diagnostics: {
      collectorReady: null,
      fatalReason: '',
      perTermErrors: [],
    },
  };
  renderAdResearchState();

  try {
    const response = await fetch('/api/ad-research/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, region, sort }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Nao foi possivel iniciar a busca.');

    state.adResearch.jobId = payload.jobId;
    setStoredAdResearchJobId(payload.jobId);
    await loadAdResearchJob(payload.jobId, true);
    showToast('Busca iniciada. Estou montando o ranking dos anuncios.', 'success');
  } catch (error) {
    state.adResearch.status = 'failed';
    state.adResearch.error = error.message;
    state.adResearch.diagnostics = {
      collectorReady: null,
      fatalReason: error.message,
      perTermErrors: [],
    };
    renderAdResearchState();
    showToast(`Erro ao iniciar busca: ${error.message}`, 'error');
  }
}

function handleAdResearchSortChange() {
  const sortInput = document.getElementById('ad-search-sort');
  if (!sortInput) return;
  state.adResearch.sort = sortInput.value || 'popular';
  renderAdResearchState();
}

async function copyAdResearchCopy(resultId) {
  const result = (state.adResearch.results || []).find((item) => String(item.id) === String(resultId));
  if (!result?.copyToClipboardText) {
    showToast('Nao encontrei uma copy valida para copiar.', 'warning');
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(result.copyToClipboardText);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = result.copyToClipboardText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showToast('Copy copiada para a area de transferencia.', 'success');
  } catch (error) {
    showToast(`Nao foi possivel copiar a copy: ${error.message}`, 'error');
  }
}

function getAdResearchBadgeClass(status) {
  if (status === 'running') return 'status-running';
  if (status === 'completed') return 'status-completed';
  if (status === 'partial') return 'status-partial';
  if (status === 'failed') return 'status-stopped';
  return 'status-idle';
}

function getAdResearchWarnings() {
  return Array.isArray(state.adResearch.warnings) ? state.adResearch.warnings : [];
}

function getAdResearchFatalReason() {
  return state.adResearch.diagnostics?.fatalReason || state.adResearch.error || '';
}

function renderAdResearchDiagnostics() {
  const diagnostics = document.getElementById('ad-search-diagnostics');
  const warningsList = document.getElementById('ad-search-warning-list');
  if (!diagnostics || !warningsList) return;

  const warnings = getAdResearchWarnings();
  const fatalReason = getAdResearchFatalReason();
  const perTermErrors = Array.isArray(state.adResearch.diagnostics?.perTermErrors)
    ? state.adResearch.diagnostics.perTermErrors
    : [];
  const blocks = [];

  if (state.adResearch.status === 'failed' && fatalReason) {
    blocks.push(`
      <div class="warning-box compact">
        <h3>Falha principal</h3>
        <p>${escapeHtml(fatalReason)}</p>
      </div>
    `);
  } else if (state.adResearch.status === 'partial') {
    blocks.push(`
      <div class="warning-box compact">
        <h3>Busca parcial</h3>
        <p>Parte das consultas falhou, mas a busca continuou e consolidou o que conseguiu aproveitar.</p>
      </div>
    `);
  }

  if (state.adResearch.diagnostics?.collectorReady === true && perTermErrors.length > 0) {
    blocks.push(`
      <div class="info-box compact">
        <h3>Coletor pronto</h3>
        <p>O Chromium abriu corretamente. Os avisos abaixo vieram de termos ou navegacoes especificas, nao de uma falha total do coletor.</p>
      </div>
    `);
  }

  diagnostics.innerHTML = blocks.join('');
  warningsList.innerHTML = warnings.length
    ? `
      <div class="ad-warning-list-title">Avisos desta busca</div>
      ${warnings.map((warning, index) => `
        <div class="ad-warning-item">
          <span class="ad-warning-index">${index + 1}</span>
          <span>${escapeHtml(warning)}</span>
        </div>
      `).join('')}
    `
    : '';
}

function getAdResearchEmptyStateMessage() {
  if (state.adResearch.status === 'failed') {
    return getAdResearchFatalReason() || 'A busca falhou antes de consolidar anuncios.';
  }

  if (state.adResearch.status === 'partial') {
    return 'A busca terminou com falhas parciais e sem anuncios consolidados.';
  }

  if (state.adResearch.status === 'completed') {
    return 'A busca terminou sem anuncios publicos consolidados para essa combinacao.';
  }

  if (state.adResearch.status === 'running') {
    return 'Buscando anuncios e montando o ranking agora.';
  }

  return 'Nenhum anuncio consolidado ainda. Inicie uma busca para preencher esta lista.';
}

let aiConfig = {};
let consultorCount = 0;
const AI_PROVIDER_DEFAULTS = {
  groq: 'llama-3.1-8b-instant',
  gemini: 'gemini-2.5-flash',
};

function getProviderDefaultModel(provider = 'groq') {
  return AI_PROVIDER_DEFAULTS[provider] || AI_PROVIDER_DEFAULTS.groq;
}

function updateKeyField(inputId, statusId, hasKey, maskedKey, defaultPlaceholder) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  if (!input) return;

  input.value = '';
  input.placeholder = hasKey && maskedKey ? maskedKey : defaultPlaceholder;

  if (status) {
    status.textContent = hasKey
      ? `Chave salva: ${maskedKey || 'preenchida'}. Deixe em branco para manter.`
      : 'Nenhuma chave salva ainda.';
  }
}

function updateModelFields(provider, resetValues = true) {
  const mainInput = document.getElementById('ai-model');
  const qualificationInput = document.getElementById('qualification-model');
  const mainHint = document.getElementById('ai-model-hint');
  const qualificationHint = document.getElementById('qualification-model-hint');
  const defaultModel = getProviderDefaultModel(provider);

  if (mainInput) {
    mainInput.placeholder = defaultModel;
    if (resetValues) mainInput.value = defaultModel;
  }

  if (qualificationInput) {
    qualificationInput.placeholder = 'Em branco = usar o modelo principal';
    if (resetValues) qualificationInput.value = '';
  }

  if (mainHint) {
    mainHint.textContent = `Se deixar no padrao, usamos ${defaultModel}. Voce pode informar qualquer ID valido do ${provider === 'gemini' ? 'Gemini' : 'Groq'}.`;
  }

  if (qualificationHint) {
    qualificationHint.textContent = 'Deixe em branco para reaproveitar o modelo principal. Preencha somente se quiser um modelo separado para extracao e qualificacao.';
  }
}

function resetPDFUploadArea() {
  const area = document.getElementById('pdf-upload-area');
  if (!area) return;

  area.innerHTML = `
    <input type="file" id="pdf-input" accept=".pdf" hidden onchange="handlePDFUpload(event)">
    <span class="upload-icon">ðŸ“„</span>
    <p>Clique ou arraste o PDF aqui</p>
    <span class="upload-hint">Apenas arquivos PDF Â· max. 32MB</span>
  `;
}

function setPDFUploadLoading(message = 'Extraindo texto...') {
  const area = document.getElementById('pdf-upload-area');
  if (!area) return;
  area.innerHTML = `<span class="upload-icon">â³</span><p>${message}</p>`;
}

async function loadAIConfig() {
  try {
    const r = await fetch('/api/ai/config');
    aiConfig = await r.json();

    // Provider
    const provider = aiConfig.aiProvider || 'groq';
    const radios = document.querySelectorAll('input[name="ai-provider"]');
    radios.forEach(r => { r.checked = r.value === provider; });
    switchAIProvider(provider, false);

    // Keys
    updateKeyField('ai-groq-key', 'groq-key-status', !!aiConfig.hasGroqKey, aiConfig.groqKeyMasked, 'gsk_...');
    updateKeyField('ai-gemini-key', 'gemini-key-status', !!aiConfig.hasGeminiKey, aiConfig.geminiKeyMasked, 'AIza...');

    // Models
    document.getElementById('ai-model').value = aiConfig.aiModel || getProviderDefaultModel(provider);
    document.getElementById('qualification-model').value = aiConfig.qualificationModel || '';
    updateModelFields(provider, false);

    // Rest of fields
    document.getElementById('ai-agent-name').value = aiConfig.agentName || '';
    document.getElementById('ai-company-name').value = aiConfig.companyName || '';
    document.getElementById('ai-company-info').value = aiConfig.companyInfo || '';
    document.getElementById('ai-consultor-dist').value = aiConfig.consultorDistribution || 'alternated';
    document.getElementById('ai-hours-start').value = aiConfig.businessHoursStart || '08:00';
    document.getElementById('ai-hours-end').value = aiConfig.businessHoursEnd || '22:00';
    document.getElementById('ai-report-hour').value = aiConfig.reportHour || '18:00';
    document.getElementById('followup-enabled').checked = aiConfig.followUpEnabled !== false;
    document.getElementById('followup-h1').value = aiConfig.followUp1Hours || 4;
    document.getElementById('followup-h2').value = aiConfig.followUp2Hours || 24;
    document.getElementById('followup-cold').value = aiConfig.followUpColdHours || 48;
    document.getElementById('campaign-loop-enabled').checked = aiConfig.campaignLoopEnabled !== false;
    document.getElementById('collections-mode-enabled').checked = aiConfig.collectionsModeEnabled === true;
    document.getElementById('report-enabled').checked = aiConfig.reportEnabled !== false;

    // Phase 3: personality + aggression
    const personality = aiConfig.aiPersonality || 'human';
    const aggression  = aiConfig.aiAggression  || 'balanced';
    const pRadio = document.querySelector(`input[name="ai-personality"][value="${personality}"]`);
    if (pRadio) pRadio.checked = true;
    const aRadio = document.querySelector(`input[name="ai-aggression"][value="${aggression}"]`);
    if (aRadio) aRadio.checked = true;
    const sessionTimeoutEl = document.getElementById('ai-session-timeout');
    if (sessionTimeoutEl) sessionTimeoutEl.value = aiConfig.sessionTimeoutMinutes || 30;
    const knowledgeEl = document.getElementById('ai-company-info');
    if (knowledgeEl) updateKnowledgeCounter(knowledgeEl);

    updateAIStatusUI(aiConfig.aiEnabled);
    renderConsultors(aiConfig.consultors || []);
    resetPDFUploadArea();
    await loadDocs();
    await updateAIStats();
  } catch (err) {
    console.error('Failed to load AI config:', err);
  }
}

function switchAIProvider(provider, save = true) {
  const groqGroup = document.getElementById('groq-key-group');
  const geminiGroup = document.getElementById('gemini-key-group');
  if (provider === 'gemini') {
    groqGroup.classList.add('hidden');
    geminiGroup.classList.remove('hidden');
  } else {
    groqGroup.classList.remove('hidden');
    geminiGroup.classList.add('hidden');
  }

  updateModelFields(provider, save);
}

function updateAIStatusUI(enabled) {
  const toggle = document.getElementById('ai-enabled');
  const text = document.getElementById('ai-status-text');
  const icon = document.getElementById('ai-status-icon');
  toggle.checked = enabled;
  text.textContent = enabled ? 'âœ… Ativo' : 'Desativado';
  icon.textContent = enabled ? 'ðŸŸ¢' : 'âš¡';
}

function toggleAIEnabled() {
  const enabled = document.getElementById('ai-enabled').checked;
  const provider = document.querySelector('input[name="ai-provider"]:checked')?.value || 'groq';
  const typedKey = provider === 'gemini'
    ? document.getElementById('ai-gemini-key').value.trim()
    : document.getElementById('ai-groq-key').value.trim();
  const savedKey = provider === 'gemini' ? !!aiConfig.hasGeminiKey : !!aiConfig.hasGroqKey;

  if (enabled && !typedKey && !savedKey) {
    updateAIStatusUI(false);
    showToast('Cadastre uma API key antes de ativar o agente.', 'warning');
    return;
  }

  updateAIStatusUI(enabled);
  // Auto-save just the enabled flag
  fetch('/api/ai/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...collectAIFormData(), aiEnabled: enabled })
  });
  showToast(enabled ? 'ðŸ¤– Agente IA ativado!' : 'Agente IA desativado', enabled ? 'success' : 'info');
}

function collectAIFormData() {
  const consultors = [];
  document.querySelectorAll('.consultor-item').forEach(el => {
    const name = el.querySelector('input[data-role="name"]')?.value?.trim();
    const number = el.querySelector('input[data-role="number"]')?.value?.trim();
    if (number) consultors.push({ name: name || 'Consultor', number });
  });

  const provider = document.querySelector('input[name="ai-provider"]:checked')?.value || 'groq';
  const personality = document.querySelector('input[name="ai-personality"]:checked')?.value || 'human';
  const aggression  = document.querySelector('input[name="ai-aggression"]:checked')?.value  || 'balanced';
  const sessionTimeout = parseInt(document.getElementById('ai-session-timeout')?.value) || 30;

  return {
    aiEnabled: document.getElementById('ai-enabled').checked,
    aiProvider: provider,
    aiModel: document.getElementById('ai-model').value.trim(),
    qualificationModel: document.getElementById('qualification-model').value.trim(),
    groqKey: document.getElementById('ai-groq-key').value.trim() || undefined,
    geminiKey: document.getElementById('ai-gemini-key').value.trim() || undefined,
    agentName: document.getElementById('ai-agent-name').value.trim(),
    companyName: document.getElementById('ai-company-name').value.trim(),
    companyInfo: document.getElementById('ai-company-info').value.trim(),
    consultors,
    consultorDistribution: document.getElementById('ai-consultor-dist').value,
    businessHoursStart: document.getElementById('ai-hours-start').value,
    businessHoursEnd: document.getElementById('ai-hours-end').value,
    reportHour: document.getElementById('ai-report-hour').value,
    followUpEnabled: document.getElementById('followup-enabled').checked,
    followUp1Hours: parseInt(document.getElementById('followup-h1').value),
    followUp2Hours: parseInt(document.getElementById('followup-h2').value),
    followUpColdHours: parseInt(document.getElementById('followup-cold').value),
    campaignLoopEnabled: document.getElementById('campaign-loop-enabled').checked,
    collectionsModeEnabled: document.getElementById('collections-mode-enabled').checked,
    reportEnabled: document.getElementById('report-enabled').checked,
    aiPersonality: personality,
    aiAggression: aggression,
    sessionTimeoutMinutes: sessionTimeout,
  };
}

// Visual feedback for behavior card selection
function selectBehaviorCard(group, radioEl) {
  // No extra logic needed â€” CSS handles :checked state automatically
  // This function exists as an onchange hook for future analytics or validation
}

async function saveAIConfig() {
  const data = collectAIFormData();
  const savedKeyAvailable = data.aiProvider === 'groq' ? !!aiConfig.hasGroqKey : !!aiConfig.hasGeminiKey;
  const hasKey = data.aiProvider === 'groq'
    ? !!data.groqKey || savedKeyAvailable
    : !!data.geminiKey || savedKeyAvailable;
  if (!hasKey) {
    showToast('Informe a API Key antes de salvar.', 'warning');
    return;
  }
  try {
    const r = await fetch('/api/ai/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const payload = await r.json().catch(() => ({}));
    if (r.ok) {
      showToast('âœ… ConfiguraÃ§Ãµes salvas com sucesso!', 'success');
      await loadAIConfig();
    } else {
      showToast(payload.error || 'Erro ao salvar.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function testAIKey() {
  const provider = document.querySelector('input[name="ai-provider"]:checked')?.value || 'groq';
  const key = provider === 'gemini'
    ? document.getElementById('ai-gemini-key').value.trim()
    : document.getElementById('ai-groq-key').value.trim();
  const hasSavedKey = provider === 'gemini' ? !!aiConfig.hasGeminiKey : !!aiConfig.hasGroqKey;
  const model = document.getElementById('ai-model').value.trim() || getProviderDefaultModel(provider);
  if (!key && !hasSavedKey) { showToast('Informe uma API Key primeiro.', 'warning'); return; }
  const btn = document.getElementById(provider === 'gemini' ? 'btn-test-key-gem' : 'btn-test-key');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
  try {
    const r = await fetch('/api/ai/test-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, provider, model }),
    });
    const d = await r.json();
    showToast(d.ok ? '\u2705 ' + d.message : '\u274c ' + d.message, d.ok ? 'success' : 'error');
  } catch (err) {
    showToast('Erro de conex\u00e3o.', 'error');
  } finally {
    if (btn) { btn.textContent = 'Testar'; btn.disabled = false; }
  }
}

async function testGeminiKey() {
  return testAIKey();
}

// Consultors
function renderConsultors(consultors) {
  const list = document.getElementById('consultors-list');
  list.innerHTML = '';
  consultors.forEach((c, i) => addConsultorRow(c.name, c.number));
}

function addConsultor() {
  addConsultorRow('', '');
}

function addConsultorRow(name, number) {
  const list = document.getElementById('consultors-list');
  const idx = list.children.length;
  const div = document.createElement('div');
  div.className = 'consultor-item';
  div.innerHTML = `
    <span style="font-size:16px">ðŸ‘¤</span>
    <input type="text" data-role="name" placeholder="Nome (ex: Gabriel)" value="${name || ''}" style="width:35%">
    <input type="text" data-role="number" placeholder="DDD+NÃºmero (11999990000)" value="${number || ''}" style="flex:1;font-family:var(--mono)">
    <button class="consultor-remove" onclick="this.parentElement.remove()">âœ•</button>
  `;
  list.appendChild(div);
}

// PDFs
async function loadDocs() {
  try {
    const list = document.getElementById('docs-list');
    if (!list) return;
    const r = await fetch('/api/ai/docs');
    const docs = await r.json();
    renderDocs(docs);
  } catch {}
}

function renderDocs(docs) {
  const list = document.getElementById('docs-list');
  if (!list) return;
  if (!docs || docs.length === 0) {
    list.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0;">Nenhum documento carregado ainda.</div>';
    return;
  }
  list.innerHTML = docs.map(d => `
    <div class="doc-item">
      <span class="doc-icon">ðŸ“„</span>
      <div class="doc-info">
        <div class="doc-name">${escapeHtml(d.filename)}</div>
        <div class="doc-meta">${d.pages} pÃ¡ginas Â· ${(d.wordCount || 0).toLocaleString()} palavras Â· Importado em ${new Date(d.extractedAt).toLocaleDateString('pt-BR')}</div>
      </div>
      <button class="doc-remove" onclick="removePDF('${d.filename}')">ðŸ—‘ï¸</button>
    </div>
  `).join('');
}

async function handlePDFUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  await uploadPDF(file);
  event.target.value = '';
}

async function handlePDFDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') await uploadPDF(file);
}

async function uploadPDF(file) {
  const area = document.getElementById('pdf-upload-area');
  area.innerHTML = '<span class="upload-icon">â³</span><p>Extraindo texto...</p>';
  const formData = new FormData();
  formData.append('pdf', file);
  try {
    const r = await fetch('/api/ai/docs', { method: 'POST', body: formData });
    const d = await r.json();
    if (r.ok) {
      showToast(`âœ… ${d.filename} â€” ${d.pages} pÃ¡ginas, ${(d.wordCount||0).toLocaleString()} palavras`, 'success');
      await loadDocs();
    } else {
      showToast('Erro: ' + d.error, 'error');
    }
  } catch (err) {
    showToast('Erro ao fazer upload: ' + err.message, 'error');
  } finally {
    area.innerHTML = '<input type="file" id="pdf-input" accept=".pdf" hidden onchange="handlePDFUpload(event)"><span class="upload-icon">ðŸ“„</span><p>Clique ou arraste o PDF aqui</p><span class="upload-hint">Apenas arquivos PDF Â· mÃ¡x. 32MB</span>';
  }
}

async function removePDF(filename) {
  if (!confirm(`Remover "${filename}"?`)) return;
  await fetch(`/api/ai/docs/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  await loadDocs();
  showToast('PDF removido.', 'info');
}

async function updateAIStats() {
  try {
    const r = await fetch('/api/leads/stats');
    const s = await r.json();
    document.getElementById('ai-pill-leads').innerHTML = `<span>${s.todayTotal || 0}</span> leads hoje`;
    document.getElementById('ai-pill-qualified').innerHTML = `<span>${s.todayQualified || 0}</span> qualificados`;
    document.getElementById('ai-pill-talking').innerHTML = `<span>${s.talking || 0}</span> em conversa`;
    document.getElementById('ai-pill-rate').innerHTML = `<span>${s.conversationRate || 0}%</span> conversÃ£o`;
  } catch {}
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ LEADS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let allLeads = [];
let currentFilter = 'all';

async function loadLeads() {
  try {
    const r = await fetch('/api/leads');
    allLeads = await r.json();
    renderLeadsStats();
    renderLeadsList(currentFilter);
    updateLeadBadge();
  } catch {}
}

function renderLeadsStats() {
  const talking    = allLeads.filter(l => l.status === 'talking').length;
  const qualified  = allLeads.filter(l => l.status === 'qualified' || l.status === 'transferred').length;
  const cold       = allLeads.filter(l => l.status === 'cold').length;
  const noInterest = allLeads.filter(l => l.status === 'no_interest').length; // FIX [4c]
  const today = new Date().toDateString();
  const todayLeads = allLeads.filter(l => new Date(l.createdAt).toDateString() === today);
  const rate = todayLeads.length > 0 ? Math.round((todayLeads.filter(l => l.status === 'qualified' || l.status === 'transferred').length / todayLeads.length) * 100) : 0;

  document.getElementById('ls-total').textContent = allLeads.length;
  document.getElementById('ls-talking').textContent = talking;
  document.getElementById('ls-qualified').textContent = qualified;
  document.getElementById('ls-cold').textContent = cold + (noInterest > 0 ? ` (+${noInterest} sem interesse)` : '');
  document.getElementById('ls-rate').textContent = rate + '%';
}

function renderLeadsList(filter) {
  const list = document.getElementById('leads-list');
  let leads = filter === 'all' ? allLeads : allLeads.filter(l => l.status === filter);

  if (leads.length === 0) {
    list.innerHTML = '<div class="queue-empty">Nenhum lead encontrado para este filtro.</div>';
    return;
  }

  list.innerHTML = leads.map(lead => {
    const dotClass = `status-dot-${lead.status || 'new'}`;
    const timeAgo = timeSince(lead.updatedAt || lead.createdAt);
    return `
      <div class="lead-card" onclick="openLeadModal('${lead.number}')">
        <div class="lead-status-dot ${dotClass}"></div>
        <div class="lead-info">
          <div class="lead-name">${lead.name || 'Desconhecido'}</div>
          <div class="lead-number">${formatLeadPhone(lead)}</div>
        </div>
        <div class="lead-vehicle">
          ${lead.model ? `<div class="lead-model">ðŸš— ${lead.model}</div>` : ''}
          ${lead.plate ? `<span class="lead-plate">${lead.plate}</span>` : ''}
        </div>
        <div class="lead-since">${timeAgo}</div>
        <div class="lead-actions-mini" onclick="event.stopPropagation()">
          ${lead.status === 'talking' ? `<button class="lead-btn" onclick="blockLead('${lead.number}')">â›”</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function filterLeads(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderLeadsList(filter);
}

async function refreshLeads() {
  await loadLeads();
  await updateAIStats();
  showToast('Leads atualizados!', 'success');
}

async function exportLeadsCSV() {
  window.open('/api/leads/export', '_blank');
}

async function blockLead(number) {
  if (!confirm('Parar o bot para este nÃºmero?')) return;
  await fetch(`/api/leads/${number}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'blocked' }) });
  await loadLeads();
  showToast('Bot pausado para esse nÃºmero.', 'info');
}

function updateLeadBadge() {
  const talking = allLeads.filter(l => l.status === 'talking').length;
  updateBadge('leads', talking > 0 ? talking : null);
}

// Lead Modal
function openLeadModal(number) {
  const lead = allLeads.find(l => l.number === number);
  if (!lead) return;

  document.getElementById('modal-lead-name').textContent = lead.name || 'Desconhecido';
  document.getElementById('modal-lead-number').textContent = `${formatLeadPhone(lead)} Â· ${statusLabel(lead.status)}`;

  const vehicle = document.getElementById('modal-vehicle');
  vehicle.innerHTML = lead.model || lead.plate
    ? `<div class="modal-vehicle-item">ðŸš— <strong>${lead.model || '?'}</strong></div>
       <div class="modal-vehicle-item">ðŸ”‘ <strong>${lead.plate || '?'}</strong></div>
       <div class="modal-vehicle-item" style="margin-left:auto">ðŸ“… ${new Date(lead.createdAt).toLocaleDateString('pt-BR')}</div>`
    : `<div class="modal-vehicle-item" style="color:var(--text-3)">VeÃ­culo nÃ£o capturado ainda</div>`;

  const actions = document.getElementById('modal-actions');
  const waTarget = getLeadWhatsAppTarget(lead);
  actions.innerHTML = `
    ${waTarget ? `<a href="https://wa.me/${waTarget}" target="_blank" class="btn btn-primary btn-sm">ðŸ’¬ Abrir no WhatsApp</a>` : ''}
    ${lead.status !== 'blocked' ? `<button class="btn btn-outline btn-sm" onclick="blockLead('${number}');closeLeadModal()">â›” Pausar bot</button>` : ''}
    <button class="btn btn-outline btn-sm" onclick="deleteLead('${number}')">ðŸ—‘ï¸ Excluir lead</button>
  `;

  const chat = document.getElementById('modal-chat');
  const history = lead.history || [];
  if (history.length === 0) {
    chat.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:20px;">Sem histÃ³rico de conversa.</div>';
  } else {
    chat.innerHTML = history.map(msg => {
      const isUser = msg.role === 'user';
      const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="chat-bubble-wrap ${isUser ? '' : 'outgoing'}">
          <div class="chat-bubble">${escapeHtml(msg.content)}</div>
          <div class="chat-ts">${isUser ? 'ðŸ‘¤' : 'ðŸ¤–'} ${time}</div>
        </div>
      `;
    }).join('');
    setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 50);
  }

  document.getElementById('lead-modal').classList.remove('hidden');
}

function closeLeadModal(event) {
  if (!event || event.target === document.getElementById('lead-modal')) {
    document.getElementById('lead-modal').classList.add('hidden');
  }
}

async function deleteLead(number) {
  if (!confirm('Excluir este lead permanentemente?')) return;
  await fetch(`/api/leads/${number}`, { method: 'DELETE' });
  closeLeadModal();
  await loadLeads();
  showToast('Lead excluÃ­do.', 'info');
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function timeSince(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function normalizeBrazilPhone(number) {
  let digits = String(number || '').replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  return digits;
}

function formatPhone(number) {
  const d = normalizeBrazilPhone(number);
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return d;
}

function getLeadContactValue(lead) {
  return lead?.displayNumber || lead?.phone || lead?.number || '';
}

function formatLeadPhone(lead) {
  const digits = normalizeBrazilPhone(getLeadContactValue(lead));
  if (!digits) return 'Nao informado';
  if (digits.length === 10 || digits.length === 11) {
    return `+55 ${formatPhone(digits)}`;
  }
  return formatPhone(digits);
}

function getLeadWhatsAppTarget(lead) {
  let digits = String(getLeadContactValue(lead)).replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  return digits;
}

function statusLabel(status) {
  const m = {
    new: 'Novo',
    talking: 'Em conversa',
    qualified: 'Qualificado',
    transferred: 'Transferido',
    cold: 'Frio',
    blocked: 'Bloqueado',
    no_interest: 'Sem interesse', // FIX [4b]
  };
  return m[status] || status;
}

function escapeHtml(text) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// â”€â”€ Knowledge base word counter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateKnowledgeCounter(textarea) {
  const len = textarea.value.length;
  const MAX = 4000;
  const counter = document.getElementById('knowledge-counter');
  if (!counter) return;
  const remaining = MAX - len;
  let color = '#22c55e';
  if (remaining < 200)      { color = '#ef4444'; }
  else if (remaining < 800) { color = '#f59e0b'; }
  counter.style.color = color;
  counter.textContent = `${len.toLocaleString()} / ${MAX.toLocaleString()} caracteres${remaining < 200 ? ' â€” quase no limite!' : ''}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('ai-company-info');
  if (ta) updateKnowledgeCounter(ta);
});
