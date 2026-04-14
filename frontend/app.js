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
  selectedImage: null,   // File object
  emojiCategory: 'smileys',
  reactionCount: 1,
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
  const hasContent = vals.some(v => v.trim());
  if (!hasContent) { showToast('Preencha ao menos uma opção de resposta.', 'warning'); return; }

  const block = '\n\n*Selecione uma opção:*\n' +
    vals.map((v, i) => `${REACTION_EMOJIS[i]} ${v || `Opção ${i+1}`}`).join('\n') +
    '\n\n*Responda com o número da sua escolha.*';

  const ta = document.getElementById('message-textarea');
  ta.value += block;
  updateMessagePreview();
  updateCharCount();
  showToast('Reações inseridas na mensagem!', 'success');
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
