/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   ZapBot Pro â€” Frontend Logic
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const state = {
  ws: null,
  wsRetry: 0,
  waStatus: 'disconnected',
  waDetails: null,
  campaignStatus: 'idle',
  validNumbers: [],
  contactPrecheck: { total: 0, valid: 0, invalid: [], duplicates: [] },
  selectedImage: null,
  emojiCategory: 'smileys',
  reactionCount: 1,
  pollMode: false,
  queue: [],
  stats: { total: 0, accepted: 0, acceptedUnconfirmed: 0, confirmed: 0, sent: 0, failed: 0, pending: 0, dailyOutboundAttempts: 0 },
  campaignFlow: null,
  campaignWaitReason: null,
  campaignLogs: [],
  lastCampaignDiagnostic: null,
  lastAiDiagnostic: null,
  systemStatus: null,
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
  const groqRadioDesc = document.querySelector('#radio-groq .radio-desc');
  if (groqRadioDesc) groqRadioDesc.textContent = 'Llama 3.3 70B - rapido e pronto para uso';
  renderEmojiGrid();
  initReactions();
  updateEstimate();
  renderAdResearchState();
  restoreAdResearchJob();
  loadSystemStatus();

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
    case 'status':       handleStatusUpdate(data.status, data.details || null); break;
    case 'qr':           handleQRCode(data.qr); break;
    case 'log':          appendLog(data.level, data.message); break;
    case 'stats':        updateStats(data.stats, data.flowControl, data.waitReason); break;
    case 'queue_update': updateQueueItem(data.index, data.status, data.sentAt, data.error, data.messageId, data.resolvedTarget, data.targetKind); break;
    case 'campaign_status': handleCampaignStatus(data.status); break;
    case 'campaign_loaded': handleCampaignLoaded(data); break;
    case 'campaign_cleared':
      state.queue = [];
      state.stats = { total: 0, accepted: 0, acceptedUnconfirmed: 0, confirmed: 0, sent: 0, failed: 0, pending: 0, dailyOutboundAttempts: 0 };
      state.campaignFlow = null;
      state.campaignWaitReason = null;
      state.lastCampaignDiagnostic = null;
      renderQueueList();
      renderCampaignDiagnosticPanel();
      updateStats(state.stats, null, null);
      handleCampaignStatus('idle');
      break;
    case 'ai_status':
      updateAIStatusUI(data.enabled);
      updateBadge('ai-agent', data.enabled ? 'â—' : null);
      break;
    case 'ad_research_update':
      handleAdResearchUpdate(data.job);
      break;
    case 'system_status':
      handleSystemStatusUpdate(data.snapshot);
      break;
  }
}

// â”€â”€ WhatsApp Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getConnectionDetailText(details) {
  if (!details) return '';
  if (details.statusCode === 405) {
    if (details.retryVersion) {
      return `Pareamento recusado antes do QR usando ${details.versionLabel || 'a versao atual'}. Tentando modo compativel ${details.retryVersion}...`;
    }
    return 'O WhatsApp Web recusou a criacao de uma nova sessao antes do QR (erro 405). Tente novamente mais tarde ou reutilize uma sessao ja autenticada.';
  }

  const parts = [];
  if (details.message) parts.push(details.message);
  if (details.statusCode) parts.push(`codigo ${details.statusCode}`);
  return parts.join(' - ');
}

function handleStatusUpdate(status, details = null) {
  state.waStatus = status;
  state.waDetails = details;
  const dot = document.getElementById('pill-dot');
  const text = document.getElementById('pill-text');
  const statusEl = document.getElementById('status-text');
  const statusDetailEl = document.getElementById('status-detail');
  const qrImg = document.getElementById('qr-image');
  const qrPH = document.getElementById('qr-placeholder');
  const qrConn = document.getElementById('qr-connected');
  const badge = document.getElementById('badge-connection');
  const detailText = getConnectionDetailText(details);

  dot.className = 'pill-dot';
  qrImg.classList.add('hidden');
  qrPH.style.display = 'none';
  qrConn.classList.add('hidden');
  badge.classList.remove('visible');
  if (statusDetailEl) {
    statusDetailEl.textContent = detailText;
    statusDetailEl.classList.toggle('hidden', !detailText);
  }

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
    if (detailText) {
      qrPH.innerHTML = `<p style="color:#f59e0b;font-size:13px;line-height:1.5;text-align:center">${detailText}</p>`;
    } else {
      qrPH.innerHTML = '<div class="qr-spinner-ring"></div><p>Conectando ao servidor...</p>';
    }
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
  if (tabId === 'status') loadSystemStatus();
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
  const duplicates = [];
  const seen = new Set();

  lines.forEach(line => {
    // Strip spaces, dashes, parens, plus sign
    let clean = line.replace(/[\s\-\(\)\+]/g, '');
    // Remove leading 55 only if total > 11 (country code present)
    if (clean.startsWith('55') && clean.length > 11) {
      clean = clean.slice(2);
    }
    if (/^\d{10,11}$/.test(clean)) {
      if (seen.has(clean)) {
        duplicates.push(clean);
      } else {
        seen.add(clean);
        valid.push(clean);
      }
    } else if (line.length > 0) {
      invalid.push(line);
    }
  });

  state.validNumbers = valid;
  state.contactPrecheck = { total: lines.length, valid: valid.length, invalid, duplicates };
  document.getElementById('val-total').textContent = lines.length;
  document.getElementById('val-valid').textContent = valid.length;
  document.getElementById('val-invalid').textContent = invalid.length;
  const duplicateCountEl = document.getElementById('val-duplicates');
  if (duplicateCountEl) duplicateCountEl.textContent = duplicates.length;

  const invalidList = document.getElementById('invalid-list');
  if (invalid.length > 0) {
    invalidList.classList.remove('hidden');
    document.getElementById('invalid-items').innerHTML = invalid
      .map(n => `<span class="invalid-tag">${n}</span>`).join('');
  } else {
    invalidList.classList.add('hidden');
  }

  const duplicateList = document.getElementById('duplicate-list');
  if (duplicateList) {
    if (duplicates.length > 0) {
      duplicateList.classList.remove('hidden');
      document.getElementById('duplicate-items').innerHTML = duplicates
        .map(n => `<span class="invalid-tag">${n}</span>`).join('');
    } else {
      duplicateList.classList.add('hidden');
    }
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
  updateEstimate();
}

function toggleFlowControl() {
  const checked = document.getElementById('flow-control-enabled')?.checked || false;
  const settings = document.getElementById('flow-control-settings');
  if (settings) settings.classList.toggle('hidden', !checked);
  updateEstimate();
}

function getFlowConfigFromUI() {
  return {
    enabled: document.getElementById('flow-control-enabled')?.checked || false,
    maxContacts: parseInt(document.getElementById('flow-max-contacts')?.value, 10) || 15,
    windowMinutes: parseInt(document.getElementById('flow-window-minutes')?.value, 10) || 10,
  };
}

function applySafeSendPreset() {
  const randomMode = document.querySelector('input[name="interval-mode"][value="random"]');
  if (randomMode) randomMode.checked = true;
  const minInput = document.getElementById('interval-min');
  const maxInput = document.getElementById('interval-max');
  if (minInput) minInput.value = 20;
  if (maxInput) maxInput.value = 40;

  const flowEnabled = document.getElementById('flow-control-enabled');
  const flowMax = document.getElementById('flow-max-contacts');
  const flowWindow = document.getElementById('flow-window-minutes');
  if (flowEnabled) flowEnabled.checked = true;
  if (flowMax) flowMax.value = 15;
  if (flowWindow) flowWindow.value = 10;

  const antiLimit = document.getElementById('anti-limit');
  const dailyLimit = document.getElementById('daily-limit');
  if (antiLimit) antiLimit.checked = true;
  if (dailyLimit) dailyLimit.value = 50;

  const typing = document.getElementById('anti-typing');
  const variation = document.getElementById('anti-variation');
  if (typing) typing.checked = true;
  if (variation) variation.checked = true;

  updateIntervalMode();
  toggleDailyLimit();
  toggleFlowControl();
  showToast('Modo seguro aplicado: 20-40s, 15 contatos/10min e 50 por dia.', 'success');
}

function estimateSecondsWithFlow(contacts, avgSec, flow) {
  if (!flow.enabled || contacts <= 0) return contacts * avgSec;
  const maxContacts = Math.max(1, flow.maxContacts || 15);
  const windowSec = Math.max(60, (flow.windowMinutes || 10) * 60);
  let elapsed = 0;
  let windowStartedAt = 0;
  let sentInWindow = 0;

  for (let i = 0; i < contacts; i += 1) {
    if (elapsed - windowStartedAt >= windowSec) {
      windowStartedAt = elapsed;
      sentInWindow = 0;
    }
    if (sentInWindow >= maxContacts) {
      elapsed = windowStartedAt + windowSec;
      windowStartedAt = elapsed;
      sentInWindow = 0;
    }
    sentInWindow += 1;
    elapsed += avgSec;
  }

  return elapsed;
}

function ensureFlowEstimateElement() {
  let flowEl = document.getElementById('est-flow');
  if (flowEl) return flowEl;
  const estimateGrid = document.querySelector('#tab-schedule .estimate-grid');
  if (!estimateGrid) return null;
  const item = document.createElement('div');
  item.className = 'estimate-item';
  item.innerHTML = '<span class="est-value" id="est-flow">Livre</span><span class="est-label">Fluxo</span>';
  estimateGrid.appendChild(item);
  return item.querySelector('#est-flow');
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

  const flow = getFlowConfigFromUI();
  const flowEl = ensureFlowEstimateElement();
  if (flowEl) {
    flowEl.textContent = flow.enabled ? `${flow.maxContacts}/${flow.windowMinutes}min` : 'Livre';
  }

  if (contacts > 0) {
    const totalSec = estimateSecondsWithFlow(contacts, avgSec, flow);
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
  const flowControl = getFlowConfigFromUI();
  const scheduleConfig = {
    intervalMode: mode,
    intervalFixed: document.getElementById('interval-fixed-val').value,
    intervalMin: document.getElementById('interval-min').value,
    intervalMax: document.getElementById('interval-max').value,
    useWindow: document.getElementById('use-window').checked,
    windowStart: document.getElementById('window-start').value,
    windowEnd: document.getElementById('window-end').value,
    flowControl,
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
      const skipped = (d.precheck?.duplicateCount || 0) + (d.precheck?.invalidCount || 0);
      showToast(skipped > 0
        ? `${d.message || 'Campanha iniciada!'} (${skipped} contato(s) ignorado(s) na pre-checagem)`
        : d.message || 'Campanha iniciada!', 'success');
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
  state.campaignFlow = data.flowControl || null;
  state.campaignWaitReason = data.waitReason || null;
  renderQueueList();
  state.queue.forEach((item, index) => {
    updateQueueItem(index, item.status, item.sentAt, item.error, item.messageId, item.resolvedTarget, item.targetKind);
  });
  updateStats(data.stats, data.flowControl, data.waitReason);
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

function waitReasonLabel(reason) {
  const labels = {
    flow_control: 'Aguardando fluxo de contatos',
    daily_limit: 'Limite diario atingido',
    time_window: 'Fora da janela de horario',
  };
  return labels[reason] || 'Sem espera ativa';
}

function formatFlowTime(value) {
  if (!value) return '--';
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function updateCampaignFlowPanel(flowControl, waitReason) {
  state.campaignFlow = flowControl || state.campaignFlow;
  state.campaignWaitReason = waitReason || null;
  let panel = document.getElementById('campaign-flow-panel');
  if (!panel) {
    const progressCard = document.querySelector('#tab-campaign .progress-card');
    if (progressCard) {
      panel = document.createElement('div');
      panel.id = 'campaign-flow-panel';
      progressCard.insertAdjacentElement('afterend', panel);
    }
  }
  if (!panel) return;

  const flow = state.campaignFlow;
  if (!flow?.enabled) {
    panel.innerHTML = `
      <div class="campaign-flow-title">${escapeHtml(state.campaignWaitReason ? waitReasonLabel(state.campaignWaitReason) : 'Fluxo de contatos livre')}</div>
      <div class="campaign-flow-sub">${escapeHtml(state.campaignWaitReason ? 'A campanha esta aguardando uma condicao operacional antes de continuar.' : 'Nenhum limite por janela esta ativo para esta campanha.')}</div>
    `;
    panel.className = `campaign-flow-panel ${state.campaignWaitReason ? 'waiting' : ''}`;
    return;
  }

  const remaining = flow.remainingInWindow ?? flow.maxContacts;
  const isWaiting = state.campaignWaitReason === 'flow_control' || (flow.waitMs || 0) > 0;
  const title = state.campaignWaitReason ? waitReasonLabel(state.campaignWaitReason) : 'Fluxo de contatos ativo';
  panel.className = `campaign-flow-panel ${isWaiting ? 'waiting' : ''}`;
  panel.innerHTML = `
    <div class="campaign-flow-title">${escapeHtml(title)}</div>
    <div class="campaign-flow-sub">
      Janela atual: <strong>${flow.sentInWindow || 0}/${flow.maxContacts}</strong> contatos usados.
      Restam <strong>${remaining}</strong>.
      Proxima janela: <strong>${formatFlowTime(flow.nextWindowAt)}</strong>.
    </div>
  `;
}

function updateStats(stats, flowControl = null, waitReason = null) {
  state.stats = stats;
  const accepted = stats.accepted ?? 0;
  const acceptedUnconfirmed = stats.acceptedUnconfirmed ?? 0;
  const confirmed = stats.confirmed ?? stats.sent ?? 0;
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-accepted').textContent = accepted;
  document.getElementById('stat-accepted-unconfirmed').textContent = acceptedUnconfirmed;
  document.getElementById('stat-confirmed').textContent = confirmed;
  document.getElementById('stat-failed').textContent = stats.failed;
  document.getElementById('stat-pending').textContent = stats.pending;

  const pct = stats.total > 0 ? Math.round(((confirmed + acceptedUnconfirmed + stats.failed) / stats.total) * 100) : 0;
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('progress-pct').textContent = `${pct}%`;
  updateCampaignFlowPanel(flowControl, waitReason);
}

function queueStatusMeta(status) {
  switch (status) {
    case 'sending':
      return { label: 'Enviando...', className: 'sending' };
    case 'accepted':
      return { label: 'Aceito pelo WhatsApp', className: 'accepted' };
    case 'confirmed':
    case 'sent':
      return { label: 'Confirmado', className: 'confirmed' };
    case 'accepted_unconfirmed':
    case 'delivery_timeout':
      return { label: 'Sem confirmacao', className: 'timeout' };
    case 'failed':
      return { label: 'Falha', className: 'failed' };
    default:
      return { label: 'Pendente', className: 'pending' };
  }
}

function updateQueueItem(index, status, sentAt, error, messageId, resolvedTarget, targetKind) {
  if (index >= state.queue.length) return;
  state.queue[index] = { ...state.queue[index], status, sentAt, error, messageId, resolvedTarget, targetKind };

  const item = document.getElementById(`qi-${index}`);
  if (!item) {
    renderQueueList();
    const rerenderedItem = document.getElementById(`qi-${index}`);
    if (rerenderedItem) updateQueueItem(index, status, sentAt, error, messageId, resolvedTarget);
    return;
  }

  const dot = item.querySelector('.queue-item-dot');
  const statusEl = item.querySelector('.queue-item-status');
  dot.className = `queue-item-dot dot-${status === 'confirmed' ? 'sent' : status === 'accepted_unconfirmed' || status === 'delivery_timeout' ? 'timeout' : status}`;

  if (status === 'accepted') {
    statusEl.textContent = 'Aceito pelo WhatsApp';
    statusEl.className = 'queue-item-status accepted';
    item.classList.add('active-item');
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (status === 'confirmed') {
    statusEl.textContent = 'Confirmado';
    statusEl.className = 'queue-item-status confirmed';
    item.classList.remove('active-item');
  } else if (status === 'accepted_unconfirmed' || status === 'delivery_timeout') {
    statusEl.textContent = 'Sem confirmacao';
    statusEl.className = 'queue-item-status timeout';
    item.classList.remove('active-item');
  } else if (status === 'sent') {
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
  renderCampaignDiagnosticPanel();
}

function renderQueueList() {
  const list = document.getElementById('queue-list');
  if (!state.queue || state.queue.length === 0) {
    list.innerHTML = '<div class="queue-empty">Nenhuma campanha carregada ainda</div>';
    return;
  }
  list.innerHTML = state.queue.map((item, i) => {
    const meta = queueStatusMeta(item.status);
    const dotClass = item.status === 'confirmed' || item.status === 'sent'
      ? 'sent'
      : item.status === 'accepted_unconfirmed' || item.status === 'delivery_timeout'
        ? 'timeout'
        : item.status;
    return `
      <div class="queue-item" id="qi-${i}">
        <span class="queue-item-dot dot-${dotClass}"></span>
        <span class="queue-item-num">+55 ${item.number}</span>
        <span class="queue-item-status ${meta.className}">${meta.label}</span>
      </div>
    `;
  }).join('');
  return;
  list.innerHTML = state.queue.map((item, i) => `
    <div class="queue-item" id="qi-${i}">
      <span class="queue-item-dot dot-${item.status === 'confirmed' ? 'sent' : item.status === 'delivery_timeout' ? 'failed' : item.status}"></span>
      <span class="queue-item-num">+55 ${item.number}</span>
      <span class="queue-item-status ${item.status === 'accepted' ? 'accepted' : item.status === 'confirmed' || item.status === 'sent' ? 'confirmed' : item.status === 'delivery_timeout' ? 'timeout' : item.status === 'failed' ? 'failed' : item.status === 'sending' ? 'sending' : ''}">
        ${item.status === 'sent' ? 'âœ… Enviado' : item.status === 'failed' ? 'âŒ Falha' : item.status === 'sending' ? 'ðŸ“¤ Enviando...' : 'â³ Pendente'}
      </span>
    </div>
  `).join('');
}

// â”€â”€ Log Console â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function appendLog(level, message) {
  state.campaignLogs.push({
    at: new Date().toISOString(),
    level,
    message,
  });
  state.campaignLogs = state.campaignLogs.slice(-300);

  const console_ = document.getElementById('log-console');
  if (!console_) return;
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  line.textContent = message;
  console_.appendChild(line);
  console_.scrollTop = console_.scrollHeight;
}

function clearLog() {
  state.campaignLogs = [];
  const console_ = document.getElementById('log-console');
  if (console_) console_.innerHTML = '';
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function outboundMatchesContext(item, context) {
  if (!item) return false;
  if (item.context === context) return true;
  if (context === 'campaign') return !!item.campaignContext;
  if (context === 'ai') return String(item.routeLabel || '').startsWith('agent_');
  return false;
}

function getRecentOutboundByContext(context) {
  const items = state.systemStatus?.whatsapp?.recentOutbound || [];
  return items.find(item => outboundMatchesContext(item, context)) || null;
}

function updateLastDiagnosticsFromStatus(snapshot = state.systemStatus) {
  const outbound = snapshot?.whatsapp?.recentOutbound || [];
  state.lastCampaignDiagnostic = outbound.find(item => outboundMatchesContext(item, 'campaign')) || state.lastCampaignDiagnostic;
  state.lastAiDiagnostic = outbound.find(item => outboundMatchesContext(item, 'ai')) || state.lastAiDiagnostic;
}

function compactDiagnosticForCopy(item) {
  if (!item) return null;
  return {
    attemptId: item.attemptId,
    context: item.context,
    status: item.status,
    decision: item.decision,
    explanation: item.explanation,
    kind: item.kind,
    messageId: item.messageId,
    ackStatus: item.ackStatus,
    targetOriginal: item.targetOriginal,
    targetResolved: item.targetResolved,
    resolvedPhone: item.resolvedPhone,
    targetKind: item.targetKind,
    resolutionSource: item.resolutionSource,
    routeLabel: item.routeLabel,
    routeOptions: item.routeOptions,
    inboundRoute: item.inboundRoute,
    campaignContext: item.campaignContext,
    resultKey: item.resultKey,
    contentSummary: item.contentSummary,
    timestamps: {
      createdAt: item.createdAt,
      acceptedAt: item.acceptedAt,
      confirmedAt: item.confirmedAt,
      timedOutAt: item.timedOutAt,
      updatedAt: item.updatedAt,
    },
    environment: {
      connectionStatus: item.connectionStatus,
      webVersion: item.webVersion,
      baileysVersion: item.baileysVersion,
    },
    updates: item.updates || [],
    error: item.error || null,
  };
}

function buildOutboundDiagnosticText(item, label = 'envio') {
  if (!item) return `Sem diagnostico de ${label} disponivel ainda.`;
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    label,
    outbound: compactDiagnosticForCopy(item),
    campaign: state.systemStatus?.campaign || null,
    whatsapp: {
      status: state.systemStatus?.whatsapp?.status,
      predominantRoute: state.systemStatus?.whatsapp?.predominantRoute,
      lastInboundRoute: state.systemStatus?.whatsapp?.lastInboundRoute,
    },
  }, null, 2);
}

async function copyCampaignLog() {
  const lines = state.campaignLogs.map(entry => `[${entry.at}] [${entry.level}] ${entry.message}`);
  if (!lines.length) lines.push('Nenhum log de campanha capturado nesta sessao do navegador.');
  try {
    await writeClipboardText(lines.join('\n'));
    showToast('Log da campanha copiado.', 'success');
  } catch (error) {
    showToast('Nao foi possivel copiar o log: ' + error.message, 'error');
  }
}

async function copyLastCampaignDiagnostic() {
  try {
    await refreshSystemStatus();
    const item = getRecentOutboundByContext('campaign') || state.lastCampaignDiagnostic;
    await writeClipboardText(buildOutboundDiagnosticText(item, 'ultimo envio de campanha'));
    showToast('Diagnostico do ultimo envio da campanha copiado.', item ? 'success' : 'warning');
  } catch (error) {
    showToast('Nao foi possivel copiar o diagnostico: ' + error.message, 'error');
  }
}

async function copyLastOutboundByContext(context) {
  const label = context === 'ai' ? 'ultimo envio IA' : context === 'campaign' ? 'ultimo envio Campanha' : 'ultimo envio';
  try {
    await refreshSystemStatus();
    const fallback = context === 'ai' ? state.lastAiDiagnostic : state.lastCampaignDiagnostic;
    const item = getRecentOutboundByContext(context) || fallback;
    await writeClipboardText(buildOutboundDiagnosticText(item, label));
    showToast(`${label} copiado.`, item ? 'success' : 'warning');
  } catch (error) {
    showToast('Nao foi possivel copiar o diagnostico: ' + error.message, 'error');
  }
}

function renderCampaignDiagnosticPanel() {
  const panel = document.getElementById('campaign-diagnostic-panel');
  if (!panel) return;
  const item = state.lastCampaignDiagnostic || getRecentOutboundByContext('campaign');
  if (!item) {
    panel.innerHTML = `
      <div class="campaign-diagnostic-title">Diagnostico do ultimo envio</div>
      <div class="campaign-diagnostic-empty">Rode uma campanha para preencher rota, alvo, ACK, messageId e decisao final aqui.</div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="campaign-diagnostic-title">Diagnostico do ultimo envio</div>
    <div class="campaign-diagnostic-grid">
      <div><span>Status</span><strong>${escapeHtml(item.status || '--')}</strong></div>
      <div><span>ACK</span><strong>${escapeHtml(String(item.ackStatus ?? '--'))}</strong></div>
      <div><span>Rota</span><strong>${escapeHtml(item.targetKind || '--')}</strong></div>
      <div><span>Origem</span><strong>${escapeHtml(item.resolutionSource || '--')}</strong></div>
      <div><span>Message ID</span><strong>${escapeHtml(item.messageId || '--')}</strong></div>
      <div><span>Alvo</span><strong>${escapeHtml(item.targetResolved || item.targetOriginal || '--')}</strong></div>
    </div>
    <div class="campaign-diagnostic-note">${escapeHtml(item.explanation || item.error || 'Sem explicacao disponivel.')}</div>
  `;
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

function severityWeight(severity = 'healthy') {
  const weights = { healthy: 0, warning: 1, degraded: 2, error: 3 };
  return weights[severity] ?? 0;
}

function overallSeverity(snapshot) {
  if (!snapshot) return 'warning';
  return ['whatsapp', 'ai', 'campaign', 'adResearch', 'automations', 'storage']
    .map((key) => snapshot[key]?.severity || 'healthy')
    .sort((left, right) => severityWeight(right) - severityWeight(left))[0] || 'healthy';
}

function severityLabel(severity = 'healthy') {
  const labels = {
    healthy: 'Saudavel',
    warning: 'Atencao',
    degraded: 'Degradado',
    error: 'Erro',
  };
  return labels[severity] || 'Saudavel';
}

function formatStatusDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusMetric(label, value) {
  return `
    <div class="status-metric">
      <span class="status-metric-label">${escapeHtml(label)}</span>
      <strong class="status-metric-value">${escapeHtml(String(value ?? '--'))}</strong>
    </div>
  `;
}

function statusDetail(label, value) {
  return `
    <div class="status-detail-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? '--'))}</strong>
    </div>
  `;
}

function renderStatusCard(elementId, section = {}, config = {}) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const severity = section.severity || 'warning';
  const extra = typeof config.extra === 'function' ? config.extra(section) : '';
  el.className = `status-card severity-${severity}`;
  el.innerHTML = `
    <div class="status-card-head">
      <div>
        <div class="status-card-eyebrow">${escapeHtml(config.eyebrow || 'Status')}</div>
        <h3 class="status-card-title">${escapeHtml(config.title || 'Modulo')}</h3>
      </div>
      <span class="status-severity-pill severity-${severity}">${escapeHtml(severityLabel(severity))}</span>
    </div>
    ${config.summary ? `<p class="status-card-summary">${escapeHtml(config.summary(section) || '')}</p>` : ''}
    ${Array.isArray(config.metrics?.(section)) ? `<div class="status-metrics">${config.metrics(section).join('')}</div>` : ''}
    ${Array.isArray(config.details?.(section)) ? `<div class="status-details">${config.details(section).join('')}</div>` : ''}
    ${extra || ''}
  `;
}

function renderOutboundMiniList(items = []) {
  const recent = Array.isArray(items) ? items.slice(0, 3) : [];
  if (!recent.length) return '<div class="status-mini-empty">Nenhum envio rastreado ainda.</div>';

  return `
    <div class="status-mini-list">
      ${recent.map((item) => `
        <div class="status-mini-item">
          <div class="status-mini-top">
            <strong>${escapeHtml(item.status || '--')}</strong>
            <span>${escapeHtml(item.messageId || '--')}</span>
          </div>
          <div class="status-mini-body">
            ${escapeHtml(item.targetResolved || item.targetOriginal || '--')}
            <br>
            contexto ${escapeHtml(item.context || '--')} | rota ${escapeHtml(item.targetKind || '--')} | ack ${escapeHtml(String(item.ackStatus ?? '--'))} | hash ${escapeHtml(item.contentSummary?.textHash || '--')}
            <br>
            ${escapeHtml(item.explanation || '')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderStatusEvents(events = []) {
  const list = document.getElementById('status-events');
  if (!list) return;
  if (!events.length) {
    list.innerHTML = '<div class="queue-empty">Ainda nao ha eventos consolidados para mostrar.</div>';
    return;
  }

  list.innerHTML = events.map((event) => `
    <div class="status-event severity-${event.severity || 'healthy'}">
      <div class="status-event-dot"></div>
      <div class="status-event-body">
        <div class="status-event-top">
          <strong>${escapeHtml(event.title || 'Evento')}</strong>
          <span>${escapeHtml(formatStatusDate(event.at))}</span>
        </div>
        <p>${escapeHtml(event.message || '')}</p>
      </div>
    </div>
  `).join('');
}

function renderSystemStatus() {
  const snapshot = state.systemStatus;
  if (!snapshot) return;

  const severity = overallSeverity(snapshot);
  const overallEl = document.getElementById('system-status-overall');
  const summaryEl = document.getElementById('system-status-summary');
  const updatedEl = document.getElementById('system-status-updated');

  if (overallEl) {
    overallEl.className = `campaign-status-badge status-${severity === 'error' ? 'stopped' : severity === 'degraded' ? 'partial' : severity === 'warning' ? 'paused' : 'running'}`;
    overallEl.textContent = severityLabel(severity);
  }

  if (summaryEl) {
    const pieces = [
      `WhatsApp: ${severityLabel(snapshot.whatsapp?.severity || 'warning')}`,
      `IA: ${severityLabel(snapshot.ai?.severity || 'warning')}`,
      `Campanhas: ${severityLabel(snapshot.campaign?.severity || 'warning')}`,
      `Ads: ${severityLabel(snapshot.adResearch?.severity || 'warning')}`,
    ];
    summaryEl.textContent = pieces.join(' | ');
  }

  if (updatedEl) {
    updatedEl.textContent = `Atualizado em ${formatStatusDate(snapshot.updatedAt)}`;
  }

  updateBadge('status', severity === 'error' ? '!' : severity === 'degraded' ? '!' : severity === 'warning' ? '•' : null);

  renderStatusCard('status-card-whatsapp', snapshot.whatsapp, {
    eyebrow: 'Conexao',
    title: 'WhatsApp',
    summary: (section) => `Estado atual: ${section.status || 'desconhecido'}.`,
    metrics: (section) => [
      statusMetric('Estado', section.status || '--'),
      statusMetric('WA Web', section.webVersion || '--'),
      statusMetric('Baileys', section.baileysVersion || '--'),
      statusMetric('Rota', section.predominantRoute || '--'),
    ],
    details: (section) => [
      statusDetail('Reconexoes', section.reconnectCount ?? 0),
      statusDetail('Ultimo erro', section.lastDisconnect?.message || 'Nenhum'),
      statusDetail('Ultima rota', section.lastInboundRoute?.addressingMode || '--'),
    ],
    extra: (section) => `
      <div class="status-diagnostic-block">
        <div class="status-diagnostic-title">Ultimos envios rastreados</div>
        ${renderOutboundMiniList(section.recentOutbound || [])}
      </div>
    `,
  });

  renderStatusCard('status-card-ai', snapshot.ai, {
    eyebrow: 'Inteligencia',
    title: 'IA',
    summary: (section) => `Provedor efetivo ${section.effectiveProvider || '--'} com modelo ${section.effectiveAiModel || '--'}.`,
    metrics: (section) => [
      statusMetric('Ativa', section.enabled ? 'Sim' : 'Nao'),
      statusMetric('Modelo', section.effectiveAiModel || '--'),
      statusMetric('Chave', section.hasEffectiveKey ? `Ativa (${section.effectiveKeySource || '--'})` : 'Ausente'),
    ],
    details: (section) => [
      statusDetail('Origem Groq', section.groqKeySource || '--'),
      statusDetail('Ultimo teste', section.lastKeyTest?.message || 'Nao testado'),
      statusDetail('Testado em', formatStatusDate(section.lastKeyTest?.checkedAt)),
    ],
  });

  renderStatusCard('status-card-campaign', snapshot.campaign, {
    eyebrow: 'Fila',
    title: 'Campanhas',
    summary: (section) => `Status da fila: ${section.status || 'idle'}.`,
    metrics: (section) => [
      statusMetric('Aceitas', section.stats?.accepted ?? 0),
      statusMetric('Confirmadas', section.stats?.confirmed ?? 0),
      statusMetric('Sem confirmacao', section.stats?.acceptedUnconfirmed ?? 0),
      statusMetric('Falhas', section.stats?.failed ?? 0),
    ],
    details: (section) => [
      statusDetail('Tentativas hoje', section.dailyOutboundAttempts ?? section.stats?.dailyOutboundAttempts ?? 0),
      statusDetail('Taxa confirmacao', `${section.confirmationRate ?? 0}%`),
      statusDetail('Taxa sem confirmacao', `${section.acceptedUnconfirmedRate ?? 0}%`),
      statusDetail('Fluxo', section.flowControl?.enabled
        ? `${section.flowControl.sentInWindow || 0}/${section.flowControl.maxContacts} na janela`
        : 'Desligado'),
      statusDetail('Proxima janela', section.flowControl?.enabled ? formatFlowTime(section.flowControl.nextWindowAt) : '--'),
      statusDetail('Espera atual', waitReasonLabel(section.waitReason)),
      statusDetail('Modo de rota', section.routeMode || '--'),
      statusDetail('Rota dominante', section.dominantRouteKind || '--'),
      statusDetail('Ultimo alvo', section.recentResolvedTargets?.[0]?.resolvedTarget || '--'),
    ],
  });

  renderStatusCard('status-card-ad-research', snapshot.adResearch, {
    eyebrow: 'Mercado',
    title: 'Pesquisa Ads',
    summary: (section) => section.latestJob
      ? `Ultima busca: ${section.latestJob.query || '--'} (${section.latestJob.status || '--'}).`
      : 'Nenhuma busca recente consolidada.',
    metrics: (section) => [
      statusMetric('Coletor', section.collectorReady === null ? 'Nao validado' : section.collectorReady ? 'Pronto' : 'Falhou'),
      statusMetric('Ultima busca', section.latestJob?.query || '--'),
      statusMetric('Avisos', section.latestJob?.warnings ?? 0),
    ],
    details: (section) => [
      statusDetail('Falha fatal', section.latestJob?.fatalReason || 'Nenhuma'),
      statusDetail('Ultima validacao', formatStatusDate(section.lastCollectorCheck?.checkedAt)),
      statusDetail('Mensagem', section.lastCollectorCheck?.message || '--'),
    ],
  });

  renderStatusCard('status-card-automations', snapshot.automations, {
    eyebrow: 'Rotinas',
    title: 'Automacoes',
    summary: (section) => `Follow-up ${section.followUpEnabled ? 'ativo' : 'desligado'} e relatorio ${section.reportEnabled ? 'ativo' : 'desligado'}.`,
    metrics: (section) => [
      statusMetric('Follow-up', section.followUpEnabled ? 'Ativo' : 'Off'),
      statusMetric('Relatorio', section.reportEnabled ? 'Ativo' : 'Off'),
      statusMetric('Horario', section.reportHour || '--'),
    ],
    details: (section) => [
      statusDetail('1o follow-up', `${section.followUp1Hours ?? 0}h`),
      statusDetail('2o follow-up', `${section.followUp2Hours ?? 0}h`),
      statusDetail('Frio apos', `${section.followUpColdHours ?? 0}h`),
    ],
  });

  renderStatusCard('status-card-storage', snapshot.storage, {
    eyebrow: 'Persistencia',
    title: 'Storage',
    summary: (section) => `Diretorio efetivo: ${section.root || '--'}.`,
    metrics: (section) => [
      statusMetric('Auth', section.authPresent ? 'OK' : 'Ausente'),
      statusMetric('Config', section.configPresent ? 'OK' : 'Ausente'),
      statusMetric('Leads', section.leadsPresent ? 'OK' : 'Ausente'),
      statusMetric('Docs', section.docsPresent ? `${section.docsCount || 0} arquivos` : 'Ausente'),
    ],
    details: (section) => [
      statusDetail('Data dir', section.dataDir || '--'),
      statusDetail('Auth dir', section.authDir || '--'),
      statusDetail('Docs dir', section.docsDir || '--'),
    ],
  });

  renderStatusEvents(snapshot.recentEvents || []);
}

function handleSystemStatusUpdate(snapshot) {
  state.systemStatus = snapshot;
  updateLastDiagnosticsFromStatus(snapshot);
  if (snapshot?.campaign) {
    updateCampaignFlowPanel(snapshot.campaign.flowControl, snapshot.campaign.waitReason);
  }
  if (Object.keys(aiConfig || {}).length > 0) {
    renderAIEffectiveSummary();
  }
  renderSystemStatus();
  renderCampaignDiagnosticPanel();
}

async function loadSystemStatus() {
  try {
    const response = await fetch('/api/system/status');
    const snapshot = await response.json();
    handleSystemStatusUpdate(snapshot);
  } catch (error) {
    console.error('Failed to load system status:', error);
  }
}

async function refreshSystemStatus() {
  try {
    const response = await fetch('/api/system/status/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks: [] }),
    });
    const snapshot = await response.json();
    handleSystemStatusUpdate(snapshot);
    showToast('Diagnostico atualizado.', 'success');
  } catch (error) {
    showToast('Erro ao atualizar diagnostico: ' + error.message, 'error');
  }
}

function buildSystemDiagnosticText(snapshot = state.systemStatus) {
  if (!snapshot) return 'Sem snapshot de status carregado.';
  const copy = {
    generatedAt: new Date().toISOString(),
    whatsapp: {
      status: snapshot.whatsapp?.status,
      severity: snapshot.whatsapp?.severity,
      webVersion: snapshot.whatsapp?.webVersion,
      baileysVersion: snapshot.whatsapp?.baileysVersion,
      lastDisconnect: snapshot.whatsapp?.lastDisconnect,
      routeStats: snapshot.whatsapp?.routeStats,
      predominantRoute: snapshot.whatsapp?.predominantRoute,
      lastInboundRoute: snapshot.whatsapp?.lastInboundRoute,
      recentOutbound: snapshot.whatsapp?.recentOutbound || [],
    },
    campaign: {
      status: snapshot.campaign?.status,
      waitReason: snapshot.campaign?.waitReason,
      routeMode: snapshot.campaign?.routeMode,
      stats: snapshot.campaign?.stats,
      confirmationRate: snapshot.campaign?.confirmationRate,
      acceptedUnconfirmedRate: snapshot.campaign?.acceptedUnconfirmedRate,
      dominantRouteKind: snapshot.campaign?.dominantRouteKind,
      routeKinds: snapshot.campaign?.routeKinds,
      recentResolvedTargets: snapshot.campaign?.recentResolvedTargets,
      flowControl: snapshot.campaign?.flowControl,
      precheck: snapshot.campaign?.precheck,
    },
    recentEvents: snapshot.recentEvents || [],
    lastAiOutbound: compactDiagnosticForCopy(getRecentOutboundByContext('ai') || state.lastAiDiagnostic),
    lastCampaignOutbound: compactDiagnosticForCopy(getRecentOutboundByContext('campaign') || state.lastCampaignDiagnostic),
    campaignLogs: state.campaignLogs.slice(-80),
  };
  return JSON.stringify(copy, null, 2);
}

async function copySystemDiagnostic() {
  try {
    await refreshSystemStatus();
    const text = buildSystemDiagnosticText(state.systemStatus);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showToast('Log diagnostico copiado. Cole ele aqui se a campanha ainda falhar.', 'success');
  } catch (error) {
    showToast('Nao foi possivel copiar o diagnostico: ' + error.message, 'error');
  }
}

async function testEffectiveAIStatus() {
  try {
    const response = await fetch('/api/system/status/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks: ['ai'] }),
    });
    const snapshot = await response.json();
    handleSystemStatusUpdate(snapshot);
    const message = snapshot?.ai?.lastKeyTest?.message || 'Teste concluido.';
    const ok = snapshot?.ai?.lastKeyTest?.status === 'ok';
    showToast(message, ok ? 'success' : 'error');
  } catch (error) {
    showToast('Erro ao testar a IA efetiva: ' + error.message, 'error');
  }
}

async function revalidateAdsCollector() {
  try {
    const response = await fetch('/api/system/status/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks: ['ads'] }),
    });
    const snapshot = await response.json();
    handleSystemStatusUpdate(snapshot);
    showToast('Coletor de anuncios revalidado.', 'success');
  } catch (error) {
    showToast('Erro ao revalidar o coletor: ' + error.message, 'error');
  }
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
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
};

function getProviderDefaultModel(provider = 'groq') {
  return AI_PROVIDER_DEFAULTS[provider] || AI_PROVIDER_DEFAULTS.groq;
}

function updateKeyField(inputId, statusId, hasSavedKey, maskedKey, defaultPlaceholder, effectiveInfo = {}) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  if (!input) return;

  input.value = '';
  input.placeholder = hasSavedKey && maskedKey ? maskedKey : defaultPlaceholder;

  if (status) {
    if (hasSavedKey) {
      status.textContent = `Chave salva: ${maskedKey || 'preenchida'}. Deixe em branco para manter.`;
      return;
    }

    if (effectiveInfo.hasEffectiveKey) {
      const sourceLabel = effectiveInfo.keySource === 'default'
        ? 'padrao'
        : effectiveInfo.keySource === 'env'
          ? 'env'
          : effectiveInfo.keySource || 'ativa';
      status.textContent = `Sem chave salva. Chave efetiva ativa via ${sourceLabel}.`;
      return;
    }

    status.textContent = 'Nenhuma chave efetiva disponivel ainda.';
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

function renderAIEffectiveSummary() {
  const box = document.getElementById('ai-effective-summary');
  if (!box) return;

  const aiState = state.systemStatus?.ai || {};
  const provider = aiConfig.effectiveProvider || aiState.effectiveProvider || aiConfig.aiProvider || 'groq';
  const model = aiConfig.effectiveAiModel || aiState.effectiveAiModel || getProviderDefaultModel(provider);
  const keySource = aiConfig.effectiveKeySource || aiState.effectiveKeySource || 'missing';
  const keySourceLabel = keySource === 'saved'
    ? 'salva'
    : keySource === 'env'
      ? 'env'
      : keySource === 'default'
        ? 'padrao'
        : 'ausente';
  const hasEffectiveKey = aiConfig.hasEffectiveKey ?? aiState.hasEffectiveKey;
  const keyText = hasEffectiveKey
    ? `chave ativa (${keySourceLabel})`
    : 'sem chave efetiva';

  box.innerHTML = `
    <h3>Configuracao efetiva</h3>
    <p><strong>Provedor:</strong> ${escapeHtml(provider)} | <strong>Modelo:</strong> ${escapeHtml(model)} | <strong>Chave:</strong> ${escapeHtml(keyText)}</p>
  `;
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
    updateKeyField('ai-groq-key', 'groq-key-status', !!aiConfig.hasGroqKey, aiConfig.groqKeyMasked, 'gsk_...', {
      hasEffectiveKey: !!aiConfig.hasEffectiveGroqKey,
      keySource: aiConfig.groqKeySource,
    });
    updateKeyField('ai-gemini-key', 'gemini-key-status', !!aiConfig.hasGeminiKey, aiConfig.geminiKeyMasked, 'AIza...', {
      hasEffectiveKey: !!aiConfig.hasEffectiveGeminiKey,
      keySource: aiConfig.geminiKeySource,
    });

    // Models
    document.getElementById('ai-model').value = aiConfig.aiModel || aiConfig.effectiveAiModel || getProviderDefaultModel(provider);
    document.getElementById('qualification-model').value = aiConfig.qualificationModel || '';
    updateModelFields(provider, false);
    renderAIEffectiveSummary();

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
    if (state.systemStatus) renderSystemStatus();
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
  const savedKey = provider === 'gemini'
    ? !!aiConfig.hasEffectiveGeminiKey
    : !!aiConfig.hasEffectiveGroqKey;

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
  const savedKeyAvailable = data.aiProvider === 'groq'
    ? !!aiConfig.hasEffectiveGroqKey
    : !!aiConfig.hasEffectiveGeminiKey;
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
  const hasSavedKey = provider === 'gemini'
    ? !!aiConfig.hasEffectiveGeminiKey
    : !!aiConfig.hasEffectiveGroqKey;
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

function deliveryStatusMeta(status) {
  switch (status) {
    case 'accepted':
      return { label: 'Aceita', className: 'accepted' };
    case 'confirmed':
    case 'sent':
      return { label: 'Confirmada', className: 'confirmed' };
    case 'delivery_timeout':
      return { label: 'Sem confirmacao', className: 'delivery_timeout' };
    case 'failed':
      return { label: 'Falhou', className: 'failed' };
    default:
      return null;
  }
}

function getLatestAssistantDelivery(lead) {
  const history = Array.isArray(lead?.history) ? lead.history : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (msg?.role !== 'assistant' || !msg.deliveryStatus) continue;
    const meta = deliveryStatusMeta(msg.deliveryStatus);
    if (!meta || meta.className === 'confirmed') continue;
    return meta;
  }
  return null;
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
    const deliveryMeta = getLatestAssistantDelivery(lead);
    return `
      <div class="lead-card" onclick="openLeadModal('${lead.number}')">
        <div class="lead-status-dot ${dotClass}"></div>
        <div class="lead-info">
          <div class="lead-name">${lead.name || 'Desconhecido'}</div>
          <div class="lead-number">${formatLeadPhone(lead)}</div>
          ${deliveryMeta ? `<div class="lead-delivery-badge ${deliveryMeta.className === 'delivery_timeout' ? 'pending' : deliveryMeta.className}">${deliveryMeta.label}</div>` : ''}
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
    chat.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:20px;">Sem historico de conversa.</div>';
  } else {
    chat.innerHTML = history.map(msg => {
      const isUser = msg.role === 'user';
      const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      const deliveryMeta = !isUser ? deliveryStatusMeta(msg.deliveryStatus) : null;
      return `
        <div class="chat-bubble-wrap ${isUser ? '' : 'outgoing'}">
          <div class="chat-bubble">${escapeHtml(msg.content)}</div>
          <div class="chat-ts">${isUser ? 'Cliente' : 'Bot'} ${time}</div>
          ${deliveryMeta ? `<div class="chat-ts"><span class="chat-delivery ${deliveryMeta.className}">${deliveryMeta.label}</span></div>` : ''}
          ${!isUser && msg.error ? `<div class="chat-ts">${escapeHtml(msg.error)}</div>` : ''}
        </div>
      `;
    }).join('');
    setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 50);
  }

  document.getElementById('lead-modal').classList.remove('hidden');
  return;

  if (history.length === 0) {
    chat.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:20px;">Sem histÃ³rico de conversa.</div>';
  } else {
    chat.innerHTML = history.map(msg => {
      const isUser = msg.role === 'user';
      const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      const deliveryMeta = !isUser ? deliveryStatusMeta(msg.deliveryStatus) : null;
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
