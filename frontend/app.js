/* ─────────────────────────────────────────────────────────
   ZapBot Pro — Frontend Logic
   ───────────────────────────────────────────────────────── */

// ── State ──────────────────────────────────────────────────
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
};

// ── Emoji Data ─────────────────────────────────────────────
const EMOJIS = {
  smileys: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤔','🤐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  gestures: ['👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤝','🙌','👏','🤲','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁️','👅','👄','💋','🫦'],
  hearts: ['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','❤️‍🔥','❤️‍🩹','💌','🎁','🎀','🎊','🎉','🥂','🍾','🫶'],
  objects: ['🔥','✨','🌟','💫','⭐','🌈','☀️','🌙','⚡','❄️','🌊','💎','🏆','🥇','🎯','🎮','🎵','🎶','🎸','🎹','📱','💻','📧','📞','☎️','⏰','📅','🔔','🔕','📢','📣','💡','🔮','🪄','🎬','📷','🤳','🎤','🎧','🎼','📚','✏️','🖊️','📝','🗒️','📌','🔑','🔒','🔓','💰','💵','💴','💶','💷','💸','🏠','🚀','🛸','✈️','🚗','🏍️'],
  symbols: ['✅','❌','⚠️','🚨','ℹ️','❓','❗','‼️','⁉️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🔶','🔷','🔸','🔹','💯','🆕','🆗','🆒','🆙','🔝','🔜','🔛','🔚','⭕','🔞','🈵','🈲','🆓','🆖','🅰️','🅱️','🆎','🆑','🅾️','🆘','🚫','⛔','📵','🔇','🔕','🚷','🚯','🚳','🚱','📶','🔈','🔉','🔊','📳','📴','♻️','🔃','🔄'],
  numbers: ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','💯','#️⃣','*️⃣','▶️','⏸️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','🔀','🔁','🔂','🔼','🔽','➕','➖','➗','✖️','💲','💱','™️','©️','®️'],
};

const REACTION_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWebSocket();
  renderEmojiGrid();
  initReactions();
  updateEstimate();

  // Close emoji picker on outside click
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('emoji-picker');
    const btn = document.getElementById('emoji-btn');
    if (!picker.classList.contains('hidden') && !picker.contains(e.target) && e.target !== btn) {
      picker.classList.add('hidden');
    }
  });
});

// ── WebSocket ──────────────────────────────────────────────
function initWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;

  ws.onopen = () => {
    state.wsRetry = 0;
    appendLog('info', '🔌 Conectado ao servidor ZapBot Pro.');
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
      updateBadge('ai-agent', data.enabled ? '●' : null);
      break;
  }
}

// ── WhatsApp Status ────────────────────────────────────────
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
    statusEl.textContent = '● Conectado';
    statusEl.className = 'status-value status-connected';
    qrConn.classList.remove('hidden');
    showToast('✅ WhatsApp conectado!', 'success');
    updateBadge('connection', '✓');
  } else if (status === 'qr_ready') {
    dot.classList.add('connecting');
    text.textContent = 'Aguardando scan...';
    statusEl.textContent = '● Aguardando QR';
    statusEl.className = 'status-value status-connecting';
    qrPH.style.display = 'flex';
    qrPH.innerHTML = '<p style="color:#888;font-size:13px">Carregando QR Code...</p>';
  } else {
    dot.classList.add('disconnected');
    text.textContent = 'Desconectado';
    statusEl.textContent = '● Desconectado';
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
  if (!confirm('Tem certeza? Isso encerrará a sessão atual e gerará um novo QR Code.')) return;
  try {
    const r = await fetch('/api/disconnect', { method: 'POST' });
    const d = await r.json();
    showToast(d.message || 'Sessão encerrada.', 'info');
  } catch (err) {
    showToast('Erro ao desconectar: ' + err.message, 'error');
  }
}

// ── Tab Navigation ─────────────────────────────────────────
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
  if (tabId === 'leads') loadLeads();
}

function updateBadge(tabId, text) {
  const badge = document.getElementById(`badge-${tabId}`);
  if (!badge) return;
  if (text) { badge.textContent = text; badge.classList.add('visible'); }
  else { badge.classList.remove('visible'); }
}

// ── Contacts ───────────────────────────────────────────────
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

// ── Emoji Picker ───────────────────────────────────────────
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

// ── Reactions Builder ──────────────────────────────────────
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
      <button class="reaction-remove" onclick="removeReaction(${i})">✕</button>
    `;
    list.appendChild(div);
  }
}

function addReaction() {
  if (state.reactionCount >= 9) { showToast('Máximo de 9 opções!', 'warning'); return; }
  state.reactionCount++;
  renderReactions();
}

function removeReaction(index) {
  if (state.reactionCount <= 1) { showToast('Pelo menos 1 opção é necessária.', 'warning'); return; }
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
    showToast('📊 Modo enquete ativo! As opções serão enviadas como enquete nativa.', 'info');
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
  // Usa valor preenchido ou texto padrão para campos vazios
  const options = vals.map((v, i) => v.trim() || `Opção ${i + 1}`);

  const block = '\n\n*Selecione uma opção:*\n' +
    options.map((v, i) => `${REACTION_EMOJIS[i]} ${v}`).join('\n') +
    '\n\n*Responda com o número da sua escolha.*';

  const ta = document.getElementById('message-textarea');
  ta.value += block;
  updateMessagePreview();
  updateCharCount();
  showToast('Opções inseridas na mensagem!', 'success');
}

// ── Image Upload ───────────────────────────────────────────
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
  if (file.size > 16 * 1024 * 1024) { showToast('Imagem muito grande! Máx. 16MB.', 'error'); return; }
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
    updateBadge('message', '🖼');
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

// ── Message Preview ────────────────────────────────────────
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
    preview.innerHTML = '<em style="color:#666">Sua mensagem aparecerá aqui...</em>';
  } else {
    preview.innerHTML = html;
  }

  if (text.trim()) updateBadge('message', '✓');
  else updateBadge('message', null);
}

function updateCharCount() {
  const len = document.getElementById('message-textarea').value.length;
  document.getElementById('char-count').textContent = len;
}

// ── Schedule Settings ──────────────────────────────────────
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
    document.getElementById('est-duration').textContent = '—';
    document.getElementById('est-end').textContent = '—';
  }
}

function formatDuration(totalSec) {
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.round(totalSec / 60)}min`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ── Campaign ───────────────────────────────────────────────
async function startCampaign() {
  if (state.waStatus !== 'connected') {
    showToast('Conecte o WhatsApp primeiro!', 'error');
    switchTab('connection');
    return;
  }
  if (state.validNumbers.length === 0) {
    showToast('Adicione contatos válidos!', 'error');
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
    pollOptions = vals.map((v, i) => v.trim() || `Opção ${i + 1}`);
    pollQuestion = document.getElementById('poll-question')?.value?.trim() || '';
    if (pollOptions.length < 2) {
      showToast('A enquete precisa de pelo menos 2 opções!', 'error');
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
    btn.textContent = '⏳ Iniciando...';

    const r = await fetch('/api/campaign/start', { method: 'POST', body: formData });
    const d = await r.json();

    if (r.ok) {
      showToast(d.message || 'Campanha iniciada!', 'success');
      switchTab('campaign');
    } else {
      showToast(d.error || 'Erro ao iniciar.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('btn-start');
    btn.disabled = false;
    btn.textContent = '🚀 Iniciar Campanha';
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
  if (!confirm('Limpar todo o histórico da fila?')) return;
  try {
    const r = await fetch('/api/campaign/clear', { method: 'POST' });
    const d = await r.json();
    if (r.ok) {
      showToast('Histórico limpo!', 'success');
    } else {
      showToast(d.error || 'Erro ao limpar.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

// ── Campaign Status Updates ────────────────────────────────
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
    idle:      { text: '💤 Aguardando', cls: 'status-idle' },
    running:   { text: '🚀 Enviando...', cls: 'status-running' },
    paused:    { text: '⏸️ Pausado', cls: 'status-paused' },
    stopped:   { text: '🛑 Parado', cls: 'status-stopped' },
    completed: { text: '✅ Concluído', cls: 'status-completed' },
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

  updateBadge('campaign', status === 'running' ? '●' : null);
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
    statusEl.textContent = '✅ Enviado';
    statusEl.className = 'queue-item-status sent';
    item.classList.remove('active-item');
  } else if (status === 'failed') {
    statusEl.textContent = `❌ Falha`;
    statusEl.className = 'queue-item-status failed';
    item.classList.remove('active-item');
  } else if (status === 'sending') {
    statusEl.textContent = '📤 Enviando...';
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
        ${item.status === 'sent' ? '✅ Enviado' : item.status === 'failed' ? '❌ Falha' : item.status === 'sending' ? '📤 Enviando...' : '⏳ Pendente'}
      </span>
    </div>
  `).join('');
}

// ── Log Console ────────────────────────────────────────────
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

// ── Toast ──────────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════
// ── AI AGENT TAB ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════

let aiConfig = {};
let consultorCount = 0;

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
    document.getElementById('ai-groq-key').value = aiConfig.groqKey || '';
    document.getElementById('ai-gemini-key').value = aiConfig.geminiKey || '';

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

    updateAIStatusUI(aiConfig.aiEnabled);
    renderConsultors(aiConfig.consultors || []);
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
}

function updateAIStatusUI(enabled) {
  const toggle = document.getElementById('ai-enabled');
  const text = document.getElementById('ai-status-text');
  const icon = document.getElementById('ai-status-icon');
  toggle.checked = enabled;
  text.textContent = enabled ? '✅ Ativo' : 'Desativado';
  icon.textContent = enabled ? '🟢' : '⚡';
}

function toggleAIEnabled() {
  const enabled = document.getElementById('ai-enabled').checked;
  updateAIStatusUI(enabled);
  // Auto-save just the enabled flag
  fetch('/api/ai/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...collectAIFormData(), aiEnabled: enabled })
  });
  showToast(enabled ? '🤖 Agente IA ativado!' : 'Agente IA desativado', enabled ? 'success' : 'info');
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
    groqKey: document.getElementById('ai-groq-key').value.trim(),
    geminiKey: document.getElementById('ai-gemini-key').value.trim(),
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
    reportEnabled: document.getElementById('report-enabled').checked,
    aiPersonality: personality,
    aiAggression: aggression,
    sessionTimeoutMinutes: sessionTimeout,
  };
}

// Visual feedback for behavior card selection
function selectBehaviorCard(group, radioEl) {
  // No extra logic needed — CSS handles :checked state automatically
  // This function exists as an onchange hook for future analytics or validation
}

async function saveAIConfig() {
  const data = collectAIFormData();
  const hasKey = data.aiProvider === 'groq' ? !!data.groqKey : !!data.geminiKey;
  if (!hasKey) {
    showToast('Informe a API Key antes de salvar.', 'warning');
    return;
  }
  try {
    const r = await fetch('/api/ai/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (r.ok) {
      showToast('✅ Configurações salvas com sucesso!', 'success');
      aiConfig = data;
    } else {
      showToast('Erro ao salvar.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function testGeminiKey() {
  const provider = document.querySelector('input[name="ai-provider"]:checked')?.value || 'groq';
  const key = provider === 'gemini'
    ? document.getElementById('ai-gemini-key').value.trim()
    : document.getElementById('ai-groq-key').value.trim();
  if (!key) { showToast('Informe uma API Key primeiro.', 'warning'); return; }
  const btn = document.getElementById(provider === 'gemini' ? 'btn-test-key-gem' : 'btn-test-key');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
  try {
    const r = await fetch('/api/ai/test-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, provider }),
    });
    const d = await r.json();
    showToast(d.ok ? '\u2705 ' + d.message : '\u274c ' + d.message, d.ok ? 'success' : 'error');
  } catch (err) {
    showToast('Erro de conex\u00e3o.', 'error');
  } finally {
    if (btn) { btn.textContent = 'Testar'; btn.disabled = false; }
  }
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
    <span style="font-size:16px">👤</span>
    <input type="text" data-role="name" placeholder="Nome (ex: Gabriel)" value="${name || ''}" style="width:35%">
    <input type="text" data-role="number" placeholder="DDD+Número (11999990000)" value="${number || ''}" style="flex:1;font-family:var(--mono)">
    <button class="consultor-remove" onclick="this.parentElement.remove()">✕</button>
  `;
  list.appendChild(div);
}

// PDFs
async function loadDocs() {
  try {
    const r = await fetch('/api/ai/docs');
    const docs = await r.json();
    renderDocs(docs);
  } catch {}
}

function renderDocs(docs) {
  const list = document.getElementById('docs-list');
  if (!docs || docs.length === 0) {
    list.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0;">Nenhum documento carregado ainda.</div>';
    return;
  }
  list.innerHTML = docs.map(d => `
    <div class="doc-item">
      <span class="doc-icon">📄</span>
      <div class="doc-info">
        <div class="doc-name">${d.filename}</div>
        <div class="doc-meta">${d.pages} páginas · ${(d.wordCount || 0).toLocaleString()} palavras · Importado em ${new Date(d.extractedAt).toLocaleDateString('pt-BR')}</div>
      </div>
      <button class="doc-remove" onclick="removePDF('${d.filename}')">🗑️</button>
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
  area.innerHTML = '<span class="upload-icon">⏳</span><p>Extraindo texto...</p>';
  const formData = new FormData();
  formData.append('pdf', file);
  try {
    const r = await fetch('/api/ai/docs', { method: 'POST', body: formData });
    const d = await r.json();
    if (r.ok) {
      showToast(`✅ ${d.filename} — ${d.pages} páginas, ${(d.wordCount||0).toLocaleString()} palavras`, 'success');
      await loadDocs();
    } else {
      showToast('Erro: ' + d.error, 'error');
    }
  } catch (err) {
    showToast('Erro ao fazer upload: ' + err.message, 'error');
  } finally {
    area.innerHTML = '<input type="file" id="pdf-input" accept=".pdf" hidden onchange="handlePDFUpload(event)"><span class="upload-icon">📄</span><p>Clique ou arraste o PDF aqui</p><span class="upload-hint">Apenas arquivos PDF · máx. 32MB</span>';
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
    document.getElementById('ai-pill-rate').innerHTML = `<span>${s.conversationRate || 0}%</span> conversão`;
  } catch {}
}

// ════════════════════════════════════════════════════════════
// ── LEADS TAB ──────────────────────────────────────────────
// ════════════════════════════════════════════════════════════

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
  const talking = allLeads.filter(l => l.status === 'talking').length;
  const qualified = allLeads.filter(l => l.status === 'qualified' || l.status === 'transferred').length;
  const cold = allLeads.filter(l => l.status === 'cold').length;
  const today = new Date().toDateString();
  const todayLeads = allLeads.filter(l => new Date(l.createdAt).toDateString() === today);
  const rate = todayLeads.length > 0 ? Math.round((todayLeads.filter(l => l.status === 'qualified' || l.status === 'transferred').length / todayLeads.length) * 100) : 0;

  document.getElementById('ls-total').textContent = allLeads.length;
  document.getElementById('ls-talking').textContent = talking;
  document.getElementById('ls-qualified').textContent = qualified;
  document.getElementById('ls-cold').textContent = cold;
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
          <div class="lead-number">+55 ${formatPhone(lead.number)}</div>
        </div>
        <div class="lead-vehicle">
          ${lead.model ? `<div class="lead-model">🚗 ${lead.model}</div>` : ''}
          ${lead.plate ? `<span class="lead-plate">${lead.plate}</span>` : ''}
        </div>
        <div class="lead-since">${timeAgo}</div>
        <div class="lead-actions-mini" onclick="event.stopPropagation()">
          ${lead.status === 'talking' ? `<button class="lead-btn" onclick="blockLead('${lead.number}')">⛔</button>` : ''}
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
  if (!confirm('Parar o bot para este número?')) return;
  await fetch(`/api/leads/${number}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'blocked' }) });
  await loadLeads();
  showToast('Bot pausado para esse número.', 'info');
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
  document.getElementById('modal-lead-number').textContent = `+55 ${formatPhone(number)} · ${statusLabel(lead.status)}`;

  const vehicle = document.getElementById('modal-vehicle');
  vehicle.innerHTML = lead.model || lead.plate
    ? `<div class="modal-vehicle-item">🚗 <strong>${lead.model || '?'}</strong></div>
       <div class="modal-vehicle-item">🔑 <strong>${lead.plate || '?'}</strong></div>
       <div class="modal-vehicle-item" style="margin-left:auto">📅 ${new Date(lead.createdAt).toLocaleDateString('pt-BR')}</div>`
    : `<div class="modal-vehicle-item" style="color:var(--text-3)">Veículo não capturado ainda</div>`;

  const actions = document.getElementById('modal-actions');
  actions.innerHTML = `
    <a href="https://wa.me/55${number}" target="_blank" class="btn btn-primary btn-sm">💬 Abrir no WhatsApp</a>
    ${lead.status !== 'blocked' ? `<button class="btn btn-outline btn-sm" onclick="blockLead('${number}');closeLeadModal()">⛔ Pausar bot</button>` : ''}
    <button class="btn btn-outline btn-sm" onclick="deleteLead('${number}')">🗑️ Excluir lead</button>
  `;

  const chat = document.getElementById('modal-chat');
  const history = lead.history || [];
  if (history.length === 0) {
    chat.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:20px;">Sem histórico de conversa.</div>';
  } else {
    chat.innerHTML = history.map(msg => {
      const isUser = msg.role === 'user';
      const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="chat-bubble-wrap ${isUser ? '' : 'outgoing'}">
          <div class="chat-bubble">${escapeHtml(msg.content)}</div>
          <div class="chat-ts">${isUser ? '👤' : '🤖'} ${time}</div>
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
  showToast('Lead excluído.', 'info');
}

// ── Helpers ────────────────────────────────────────────────
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

function formatPhone(number) {
  const d = String(number).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return d;
}

function statusLabel(status) {
  const m = { new:'Novo', talking:'Em conversa', qualified:'Qualificado', transferred:'Transferido', cold:'Frio', blocked:'Bloqueado' };
  return m[status] || status;
}

function escapeHtml(text) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Knowledge base word counter ──────────────────────────────
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
  counter.textContent = `${len.toLocaleString()} / ${MAX.toLocaleString()} caracteres${remaining < 200 ? ' — quase no limite!' : ''}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('ai-company-info');
  if (ta) updateKnowledgeCounter(ta);
});

