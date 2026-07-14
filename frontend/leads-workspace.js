(function createLeadsWorkspace() {
  'use strict';

  const STAGE_LABELS = {
    attention: 'A\u00e7\u00e3o imediata',
    active: 'Em conversa',
    qualified: 'Oportunidades',
    waiting: 'Aguardando resposta',
    closed: 'Encerrados',
  };

  const STATUS_LABELS = {
    new: 'Novo contato',
    talking: 'IA em conversa',
    engaged: 'Conversa ativa',
    qualified: 'Qualificado',
    transferred: 'Encaminhado ao consultor',
    cold: 'Contato frio',
    blocked: 'IA pausada',
    no_interest: 'Sem interesse',
    human_requested: 'Aguardando consultor',
    awaiting_financial_review: 'Aguardando consultor',
    payment_claimed: 'Pagamento informado',
    receipt_received: 'Comprovante recebido',
    inspection_pending: 'Revistoria pendente',
    inspection_disputed: 'Revistoria contestada',
    app_blocked: 'Aplicativo bloqueado',
    billing_disputed: 'Cobran\u00e7a contestada',
    transferred_to_financial: 'Encaminhado ao consultor',
    transferred_to_support: 'Encaminhado ao consultor',
    awaiting_operational_data: 'Aguardando dados',
    awaiting_phone_for_handoff: 'Aguardando telefone',
    awaiting_contact_for_handoff: 'Aguardando telefone',
    handoff_client_confirmation_failed: 'Falha ao confirmar encaminhamento',
    handoff_failed: 'Falha no encaminhamento',
    human_taken_over: 'Consultor assumiu',
    resolved: 'Resolvido',
    archived: 'Arquivado',
  };

  const INTENT_LABELS = {
    sales_quote: 'Cota\u00e7\u00e3o de prote\u00e7\u00e3o veicular',
    sales_price_request: 'Valor da prote\u00e7\u00e3o veicular',
    sales_consultant_requested: 'Consultor comercial',
    general_question: 'D\u00favida geral',
    regularization_request: 'Regulariza\u00e7\u00e3o de pend\u00eancia',
    boleto_request: 'Boleto / segunda via',
    payment_claimed: 'Pagamento j\u00e1 realizado',
    receipt_sent: 'Envio de comprovante',
    billing_dispute: 'Cobran\u00e7a contestada',
    app_blocked: 'Aplicativo bloqueado',
    cancel_request: 'Cancelamento',
    inspection_request: 'Vistoria / revistoria',
    assistance_request: 'Assist\u00eancia ou reboque',
    accident_report: 'Evento com o ve\u00edculo',
    human_requested: 'Atendimento humano',
    no_interest: 'Sem interesse',
    greeting: 'Sauda\u00e7\u00e3o',
  };

  const AUTOMATION_PAUSED_STATUSES = new Set([
    'transferred',
    'human_requested',
    'awaiting_financial_review',
    'payment_claimed',
    'receipt_received',
    'inspection_pending',
    'inspection_disputed',
    'app_blocked',
    'billing_disputed',
    'transferred_to_financial',
    'transferred_to_support',
    'handoff_client_confirmation_failed',
    'handoff_failed',
    'human_taken_over',
    'blocked',
  ]);

  const SOUND_STORAGE_KEY = 'zapbot_lead_sound_enabled';
  const baseDocumentTitle = String(document.title || 'ZapBot Pro').replace(/^\[\d+\]\s*/, '');
  const state = {
    initialized: false,
    sessionToken: '',
    leads: [],
    trash: [],
    overview: null,
    view: 'active',
    stage: 'customer',
    source: 'all',
    sort: 'updated_desc',
    query: '',
    page: 1,
    pageSize: 25,
    selected: new Set(),
    currentLead: null,
    lastFetchedAt: 0,
    loading: false,
    requestVersion: 0,
    refreshTimer: null,
    knownReady: false,
    knownAttention: new Set(),
    knownConversations: new Set(),
    skipNextDiffNotification: false,
    handledEvents: new Set(),
    notifications: [],
    unread: 0,
    soundEnabled: localStorage.getItem(SOUND_STORAGE_KEY) !== 'false',
    audioContext: null,
    pendingDelete: null,
    previousFocus: null,
  };

  const elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    const ids = [
      'lead-metrics', 'leads-page-summary', 'lead-count-customer', 'lead-count-attention',
      'lead-count-active', 'lead-count-qualified', 'lead-count-waiting', 'lead-count-closed',
      'lead-search-input', 'lead-source-filter', 'lead-sort-filter', 'lead-refresh-btn',
      'lead-export-btn', 'lead-trash-view-btn', 'lead-trash-count', 'lead-delete-all-btn',
      'lead-bulk-bar', 'lead-selected-count', 'lead-select-all-results', 'lead-bulk-stage',
      'lead-bulk-apply', 'lead-bulk-delete', 'lead-bulk-restore', 'lead-table-shell',
      'lead-table-loading', 'lead-table', 'lead-table-body', 'lead-empty-state',
      'lead-select-page', 'lead-results-summary', 'lead-page-size', 'lead-page-prev',
      'lead-page-next', 'lead-page-label', 'lead-modal', 'lead-modal-close',
      'modal-lead-avatar', 'modal-lead-name', 'modal-lead-number', 'modal-lead-statusline',
      'modal-actions', 'modal-lead-updated', 'modal-lead-summary', 'modal-lead-facts',
      'modal-lead-stage', 'modal-lead-tag', 'modal-lead-agenda', 'lead-reminder-save',
      'lead-reminder-complete', 'modal-chat', 'lead-delete-modal', 'lead-delete-title',
      'lead-delete-description', 'lead-delete-phrase-wrap', 'lead-delete-phrase',
      'lead-delete-cancel', 'lead-delete-confirm', 'lead-notification-trigger',
      'lead-notification-count', 'lead-notification-panel', 'lead-notification-clear',
      'lead-sound-toggle', 'lead-browser-notification-btn', 'lead-notification-list',
      'lead-live-region',
    ];
    for (const id of ids) elements[id] = byId(id);
  }

  function renderIcons() {
    try {
      window.lucide?.createIcons({ attrs: { 'stroke-width': 1.8 } });
    } catch (error) {
      console.warn('[Leads] Icons could not be rendered:', error.message);
    }
  }

  function setText(id, value) {
    if (elements[id]) elements[id].textContent = String(value ?? '');
  }

  function notifyToast(message, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
  }

  function announce(message) {
    if (!elements['lead-live-region']) return;
    elements['lead-live-region'].textContent = '';
    window.setTimeout(() => { elements['lead-live-region'].textContent = message; }, 20);
  }

  async function ensureSession(force = false) {
    if (state.sessionToken && !force) return state.sessionToken;
    const response = await fetch('/api/leads/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Nao foi possivel iniciar a Central de Leads.');
    const session = await response.json();
    state.sessionToken = String(session.token || '');
    return state.sessionToken;
  }

  async function api(path, options = {}, retry = true) {
    await ensureSession();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (state.sessionToken) headers.set('X-Leads-Token', state.sessionToken);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 403 && retry) {
      state.sessionToken = '';
      await ensureSession(true);
      return api(path, options, false);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Falha na operacao (${response.status}).`);
    return payload;
  }

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function stageLabel(stage) {
    return STAGE_LABELS[stage] || 'Sem categoria';
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || String(status || 'Estado indefinido').replaceAll('_', ' ');
  }

  function intentLabel(lead) {
    const intent = lead?.lastIntent;
    if (intent && INTENT_LABELS[intent]) return INTENT_LABELS[intent];
    if (!lead?.hasCustomerMessage && lead?.source === 'campaign') return 'Sem resposta do cliente';
    if (!intent) return 'Inten\u00e7\u00e3o ainda n\u00e3o definida';
    return String(intent).replaceAll('_', ' ');
  }

  function formatPhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
    if (digits.length === 11) return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return digits ? `+${digits}` : 'Telefone n\u00e3o resolvido';
  }

  function whatsappTarget(lead) {
    let digits = String(lead?.phone || lead?.displayNumber || '').replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 11) return digits;
    if (/^[1-9]\d{9,10}$/.test(digits)) return `55${digits}`;
    return '';
  }

  function timeSince(value) {
    const timestamp = new Date(value || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Sem data';
    const diff = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Agora';
    if (minutes < 60) return `H\u00e1 ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `H\u00e1 ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `H\u00e1 ${days} d`;
    return new Date(timestamp).toLocaleDateString('pt-BR');
  }

  function initials(name) {
    const parts = String(name || 'Lead').trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'L';
  }

  function currentDataset() {
    return state.view === 'trash' ? state.trash : state.leads;
  }

  function filteredLeads() {
    const query = normalizeSearch(state.query);
    let list = currentDataset().filter((lead) => {
      if (state.view === 'active') {
        if (state.stage === 'customer' && !lead.hasCustomerMessage) return false;
        if (state.stage !== 'customer' && state.stage !== 'all' && lead.pipelineStage !== state.stage) return false;
      }
      if (state.source !== 'all' && lead.source !== state.source) return false;
      if (!query) return true;
      const haystack = normalizeSearch([
        lead.name, lead.phone, lead.number, lead.plate, lead.model, lead.summary,
        lead.lastCustomerMessage, lead.lastIntent, statusLabel(lead.status), stageLabel(lead.pipelineStage),
      ].filter(Boolean).join(' '));
      return haystack.includes(query);
    });

    const priority = { attention: 0, active: 1, qualified: 2, waiting: 3, closed: 4 };
    list = list.slice().sort((a, b) => {
      if (state.sort === 'updated_asc') return new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0);
      if (state.sort === 'name_asc') return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
      if (state.sort === 'priority') {
        const stageDiff = (priority[a.pipelineStage] ?? 9) - (priority[b.pipelineStage] ?? 9);
        if (stageDiff) return stageDiff;
      }
      return new Date(b.updatedAt || b.deletedAt || 0) - new Date(a.updatedAt || a.deletedAt || 0);
    });
    return list;
  }

  function pageData() {
    const filtered = filteredLeads();
    const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.pageSize;
    return { filtered, pages, start, rows: filtered.slice(start, start + state.pageSize) };
  }

  function mergeOverview(overview) {
    if (!overview) return;
    const previousTrash = state.overview?.trashCount || 0;
    state.overview = {
      ...(state.overview || {}),
      ...overview,
      counts: { ...(state.overview?.counts || {}), ...(overview.counts || {}) },
      trashCount: overview.trashCount ?? previousTrash,
    };
  }

  function quantityLabel(value, singular, plural) {
    const count = Number(value) || 0;
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function renderOverview() {
    if (!state.initialized || !state.overview?.counts) return;
    const counts = state.overview.counts;
    setText('lead-count-customer', counts.customerConversations || 0);
    setText('lead-count-attention', counts.attention || 0);
    setText('lead-count-active', counts.active || 0);
    setText('lead-count-qualified', counts.qualified || 0);
    setText('lead-count-waiting', counts.waiting || 0);
    setText('lead-count-closed', counts.closed || 0);
    setText('lead-trash-count', state.overview.trashCount || 0);

    if (state.view === 'trash') {
      setText(
        'leads-page-summary',
        `${quantityLabel(state.trash.length, 'registro na lixeira', 'registros na lixeira')}. Restaure o que ainda precisa ser acompanhado.`,
      );
    } else {
      setText(
        'leads-page-summary',
        `${quantityLabel(counts.customerConversations, 'conversa real', 'conversas reais')} e ${quantityLabel(counts.waiting, 'contato aguardando resposta', 'contatos aguardando resposta')}.`,
      );
    }

    if (typeof window.updateBadge === 'function') {
      window.updateBadge('leads', counts.attention > 0 ? counts.attention : null);
    }
    if (elements['lead-delete-all-btn']) elements['lead-delete-all-btn'].disabled = !counts.total;
  }

  function makeIcon(name) {
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', name);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function createCell() {
    return document.createElement('td');
  }

  function buildLeadRow(lead, index) {
    const row = document.createElement('tr');
    row.dataset.leadId = lead.number;
    row.classList.toggle('is-selected', state.selected.has(lead.number));
    row.style.animationDelay = `${Math.min(index, 10) * 18}ms`;

    const checkCell = createCell();
    checkCell.className = 'lead-check-cell';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(lead.number);
    checkbox.dataset.leadSelect = lead.number;
    checkbox.setAttribute('aria-label', `Selecionar ${lead.name || 'lead'}`);
    checkCell.append(checkbox);

    const contactCell = createCell();
    const contact = document.createElement('div');
    contact.className = 'lead-contact';
    const avatar = document.createElement('span');
    avatar.className = 'lead-avatar';
    avatar.textContent = initials(lead.name);
    const contactCopy = document.createElement('div');
    contactCopy.className = 'lead-contact-copy';
    const name = document.createElement('span');
    name.className = 'lead-contact-name';
    name.textContent = lead.name || 'Contato sem nome';
    const phone = document.createElement('span');
    phone.className = 'lead-contact-phone';
    phone.textContent = formatPhone(lead.phone);
    contactCopy.append(name, phone);
    contact.append(avatar, contactCopy);
    contactCell.append(contact);

    const stageCell = createCell();
    const stage = document.createElement('span');
    stage.className = `lead-stage-pill lead-stage-${lead.pipelineStage}`;
    stage.textContent = stageLabel(lead.pipelineStage);
    stage.title = statusLabel(lead.status);
    stageCell.append(stage);

    const summaryCell = createCell();
    const intent = document.createElement('span');
    intent.className = 'lead-intent';
    intent.textContent = intentLabel(lead);
    const summary = document.createElement('span');
    summary.className = 'lead-summary';
    summary.textContent = lead.summary || lead.lastCustomerMessage || statusLabel(lead.status);
    summaryCell.append(intent, summary);

    const sourceCell = createCell();
    const source = document.createElement('span');
    source.className = 'lead-source-pill';
    source.append(makeIcon(lead.source === 'campaign' ? 'megaphone' : 'message-circle'));
    source.append(document.createTextNode(lead.source === 'campaign' ? 'Campanha' : 'Espontaneo'));
    sourceCell.append(source);

    const timeCell = createCell();
    const time = document.createElement('span');
    time.className = 'lead-time';
    time.textContent = timeSince(state.view === 'trash' ? lead.deletedAt : lead.updatedAt);
    timeCell.append(time);

    const actionCell = createCell();
    actionCell.className = 'lead-actions-cell';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'lead-icon-btn lead-row-action';
    action.dataset.leadAction = state.view === 'trash' ? 'restore' : 'open';
    action.dataset.leadId = lead.number;
    action.title = state.view === 'trash' ? 'Restaurar lead' : 'Abrir detalhes';
    action.setAttribute('aria-label', action.title);
    action.append(makeIcon(state.view === 'trash' ? 'rotate-ccw' : 'arrow-up-right'));
    actionCell.append(action);

    row.append(checkCell, contactCell, stageCell, summaryCell, sourceCell, timeCell, actionCell);
    return row;
  }

  function renderTable() {
    if (!state.initialized) return;
    const { filtered, pages, start, rows } = pageData();
    const body = elements['lead-table-body'];
    body.replaceChildren();
    const fragment = document.createDocumentFragment();
    rows.forEach((lead, index) => fragment.append(buildLeadRow(lead, index)));
    body.append(fragment);

    elements['lead-table-loading'].classList.add('hidden');
    elements['lead-table'].classList.toggle('hidden', rows.length === 0);
    elements['lead-empty-state'].classList.toggle('hidden', rows.length !== 0);
    elements['lead-table-shell'].setAttribute('aria-busy', 'false');

    const end = Math.min(start + rows.length, filtered.length);
    setText('lead-results-summary', filtered.length ? `${start + 1}-${end} de ${filtered.length} resultados` : '0 resultados');
    setText('lead-page-label', `${state.page} de ${pages}`);
    elements['lead-page-prev'].disabled = state.page <= 1;
    elements['lead-page-next'].disabled = state.page >= pages;

    updateSelectionUI(filtered, rows);
    renderIcons();
  }

  function updateSelectionUI(filtered = filteredLeads(), rows = pageData().rows) {
    const selectedCount = state.selected.size;
    elements['lead-bulk-bar'].classList.toggle('hidden', selectedCount === 0);
    setText('lead-selected-count', `${selectedCount} selecionado${selectedCount === 1 ? '' : 's'}`);

    const pageIds = rows.map((lead) => lead.number);
    const pageSelected = pageIds.filter((id) => state.selected.has(id)).length;
    elements['lead-select-page'].checked = pageIds.length > 0 && pageSelected === pageIds.length;
    elements['lead-select-page'].indeterminate = pageSelected > 0 && pageSelected < pageIds.length;
    elements['lead-select-page'].disabled = pageIds.length === 0;

    const selectionLink = elements['lead-select-all-results'];
    if (selectedCount > 0 && selectedCount === filtered.length) {
      selectionLink.textContent = 'Limpar selecao';
      selectionLink.dataset.mode = 'clear';
      selectionLink.classList.remove('hidden');
    } else if (pageIds.length > 0 && pageSelected === pageIds.length && filtered.length > pageIds.length) {
      selectionLink.textContent = `Selecionar todos os ${filtered.length} resultados`;
      selectionLink.dataset.mode = 'all';
      selectionLink.classList.remove('hidden');
    } else {
      selectionLink.classList.add('hidden');
    }

    const trashMode = state.view === 'trash';
    elements['lead-bulk-stage'].classList.toggle('hidden', trashMode);
    elements['lead-bulk-apply'].classList.toggle('hidden', trashMode);
    elements['lead-bulk-delete'].classList.toggle('hidden', trashMode);
    elements['lead-bulk-restore'].classList.toggle('hidden', !trashMode);
    const moveLabel = document.querySelector('.lead-bulk-move-label');
    moveLabel?.classList.toggle('hidden', trashMode);
  }

  function renderViewState() {
    const trashMode = state.view === 'trash';
    elements['lead-metrics'].classList.toggle('hidden', trashMode);
    elements['lead-delete-all-btn'].classList.toggle('hidden', trashMode);
    const trashButtonLabel = elements['lead-trash-view-btn']?.querySelector('span:not(.lead-toolbar-count)');
    if (trashButtonLabel) trashButtonLabel.textContent = trashMode ? 'Voltar aos leads' : 'Lixeira';
    elements['lead-trash-view-btn']?.classList.toggle('is-active', trashMode);
    elements['lead-source-filter'].value = state.source;
    elements['lead-sort-filter'].value = state.sort;
    elements['lead-page-size'].value = String(state.pageSize);
    document.querySelectorAll('[data-lead-stage]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.leadStage === state.stage);
    });
    renderOverview();
    renderTable();
  }

  function setLoading(loading) {
    state.loading = loading;
    elements['lead-table-shell']?.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (loading && currentDataset().length === 0) {
      elements['lead-table-loading']?.classList.remove('hidden');
      elements['lead-table']?.classList.add('hidden');
      elements['lead-empty-state']?.classList.add('hidden');
    }
    if (elements['lead-refresh-btn']) elements['lead-refresh-btn'].disabled = loading;
  }

  function syncKnownLeads(nextLeads, { notifyDiff = false } = {}) {
    const attention = new Set(nextLeads.filter((lead) => lead.pipelineStage === 'attention').map((lead) => lead.number));
    const conversations = new Set(nextLeads.filter((lead) => lead.hasCustomerMessage).map((lead) => lead.number));
    if (state.knownReady && notifyDiff && !state.skipNextDiffNotification) {
      const newAttention = [...attention].filter((id) => !state.knownAttention.has(id));
      const newConversations = [...conversations].filter((id) => !state.knownConversations.has(id));
      if (newAttention.length > 0) createGlobalAlert('attention_required', newAttention.length);
      else if (newConversations.length > 0) createGlobalAlert('new_conversation', newConversations.length);
    }
    state.knownAttention = attention;
    state.knownConversations = conversations;
    state.knownReady = true;
    state.skipNextDiffNotification = false;
  }

  async function refresh({ quiet = false, notifyDiff = false } = {}) {
    if (state.loading && !quiet) return;
    const version = ++state.requestVersion;
    if (!quiet) setLoading(true);
    try {
      const [leads, overview] = await Promise.all([
        api('/api/leads?view=summary'),
        api('/api/leads/overview'),
      ]);
      if (version !== state.requestVersion) return;
      syncKnownLeads(leads, { notifyDiff });
      state.leads = leads;
      mergeOverview(overview);
      state.lastFetchedAt = Date.now();
      if (state.view === 'active') renderViewState();
      else renderOverview();
      if (!quiet) announce('Lista de leads atualizada.');
    } catch (error) {
      console.error('[Leads] Refresh failed:', error);
      if (!quiet) notifyToast('Nao foi possivel atualizar os leads.', 'error');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function loadTrash() {
    setLoading(true);
    try {
      state.trash = await api('/api/leads/trash?view=summary');
      state.overview = { ...(state.overview || {}), trashCount: state.trash.length };
      renderViewState();
    } catch (error) {
      notifyToast('Nao foi possivel abrir a lixeira.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function toggleTrashView() {
    state.selected.clear();
    state.page = 1;
    if (state.view === 'active') {
      state.view = 'trash';
      await loadTrash();
    } else {
      state.view = 'active';
      renderViewState();
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => refresh({ quiet: true }), 220);
  }

  function handleOverview(overview) {
    mergeOverview(overview);
    renderOverview();
  }

  function handleEvent(event) {
    if (!event?.eventId || state.handledEvents.has(event.eventId)) return;
    state.handledEvents.add(event.eventId);
    if (state.handledEvents.size > 200) {
      const first = state.handledEvents.values().next().value;
      state.handledEvents.delete(first);
    }
    mergeOverview(event.overview);
    state.skipNextDiffNotification = true;
    renderOverview();
    scheduleRefresh();
    if (event.origin !== 'dashboard' && event.notification?.kind) {
      createGlobalAlert(event.notification.kind, Math.max(1, Number(event.count) || 1));
    }
  }

  function unlockAudio() {
    if (!state.soundEnabled) return;
    try {
      if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
    } catch {}
  }

  function playChime(priority = 'normal') {
    if (!state.soundEnabled) return;
    unlockAudio();
    const context = state.audioContext;
    if (!context || context.state !== 'running') return;
    const start = context.currentTime + .01;
    const master = context.createGain();
    master.connect(context.destination);
    master.gain.setValueAtTime(.0001, start);
    master.gain.exponentialRampToValueAtTime(priority === 'high' ? .16 : .11, start + .025);
    master.gain.exponentialRampToValueAtTime(.0001, start + .72);
    const notes = priority === 'high' ? [523.25, 659.25, 783.99] : [523.25, 659.25];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index % 2 === 0 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start + index * .095);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.7, start + index * .095 + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, start + index * .095 + .42);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start + index * .095);
      oscillator.stop(start + index * .095 + .45);
    });
  }

  function alertCopy(kind, count) {
    if (kind === 'attention_required') {
      return {
        title: count > 1 ? `${count} atendimentos precisam de a\u00e7\u00e3o` : 'Atendimento precisa de a\u00e7\u00e3o',
        message: 'Um cliente aguarda continuidade do consultor.',
        icon: 'circle-alert',
        priority: 'high',
      };
    }
    return {
      title: count > 1 ? `${count} novas conversas recebidas` : 'Nova conversa recebida',
      message: 'Um contato respondeu e entrou na fila de leads.',
      icon: 'message-circle-more',
      priority: 'normal',
    };
  }

  function createLeadToast(copy) {
    const container = byId('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast lead-alert-toast ${copy.priority === 'high' ? 'warning' : 'info'}`;
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.append(makeIcon(copy.icon));
    const body = document.createElement('div');
    body.className = 'toast-body';
    const title = document.createElement('strong');
    title.textContent = copy.title;
    const message = document.createElement('span');
    message.className = 'toast-msg';
    message.textContent = copy.message;
    body.append(title, message);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'lead-toast-open';
    open.textContent = 'Ver';
    open.addEventListener('click', () => {
      toast.remove();
      state.stage = copy.priority === 'high' ? 'attention' : 'customer';
      state.page = 1;
      if (typeof window.switchTab === 'function') window.switchTab('leads');
      renderViewState();
    });
    toast.append(icon, body, open);
    container.append(toast);
    renderIcons();
    window.setTimeout(() => {
      toast.classList.add('removing');
      window.setTimeout(() => toast.remove(), 300);
    }, 8000);
  }

  function createGlobalAlert(kind, count = 1) {
    const copy = alertCopy(kind, count);
    state.notifications.unshift({ ...copy, createdAt: new Date().toISOString() });
    state.notifications = state.notifications.slice(0, 20);
    state.unread += 1;
    renderNotifications();
    createLeadToast(copy);
    playChime(copy.priority);
    announce(`${copy.title}. ${copy.message}`);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notification = new Notification(`ZapBot Pro - ${copy.title}`, { body: copy.message, tag: `zapbot-${kind}` });
        notification.onclick = () => {
          window.focus();
          if (typeof window.switchTab === 'function') window.switchTab('leads');
          notification.close();
        };
      } catch {}
    }
    updateDocumentTitle();
  }

  function renderNotifications() {
    if (!state.initialized) return;
    const count = elements['lead-notification-count'];
    count.textContent = String(Math.min(99, state.unread));
    count.classList.toggle('hidden', state.unread === 0);
    elements['lead-notification-trigger'].classList.toggle('has-alert', state.unread > 0);
    const list = elements['lead-notification-list'];
    list.replaceChildren();
    if (state.notifications.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lead-notification-empty';
      empty.textContent = 'Nenhum alerta novo.';
      list.append(empty);
    } else {
      for (const item of state.notifications) {
        const row = document.createElement('div');
        row.className = 'lead-notification-item';
        const icon = document.createElement('span');
        icon.className = 'lead-notification-item-icon';
        icon.append(makeIcon(item.icon));
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = item.title;
        const message = document.createElement('p');
        message.textContent = item.message;
        const time = document.createElement('time');
        time.dateTime = item.createdAt;
        time.textContent = timeSince(item.createdAt);
        copy.append(title, message, time);
        row.append(icon, copy);
        list.append(row);
      }
    }
    renderIcons();
  }

  function updateDocumentTitle() {
    document.title = document.hidden && state.unread > 0 ? `[${state.unread}] ${baseDocumentTitle}` : baseDocumentTitle;
  }

  function toggleNotificationPanel(force) {
    const panel = elements['lead-notification-panel'];
    const shouldOpen = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !shouldOpen);
    elements['lead-notification-trigger'].setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  }

  function updateBrowserNotificationButton() {
    const button = elements['lead-browser-notification-btn'];
    if (!button || !('Notification' in window)) {
      button?.classList.add('hidden');
      return;
    }
    if (Notification.permission === 'granted') button.textContent = 'Alertas do navegador ativos';
    else if (Notification.permission === 'denied') button.textContent = 'Alertas bloqueados no navegador';
    else button.textContent = 'Ativar alerta do navegador';
    button.disabled = Notification.permission !== 'default';
  }

  async function requestBrowserNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    try { await Notification.requestPermission(); } catch {}
    updateBrowserNotificationButton();
  }

  function detailSummary(lead) {
    return String(
      lead.caseSummary
      || lead.leadSummary?.caseSummary
      || lead.leadSummary?.reason
      || [...(Array.isArray(lead.history) ? lead.history : [])].reverse().find((entry) => entry?.role === 'user')?.content
      || 'Sem resumo disponivel.',
    );
  }

  function addFact(list, label, value) {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value || 'Nao informado';
    wrapper.append(term, description);
    list.append(wrapper);
  }

  function appendActionButton(container, { label, icon, className = 'btn btn-outline btn-sm', action, href }) {
    const control = href ? document.createElement('a') : document.createElement('button');
    control.className = className;
    if (href) {
      control.href = href;
      control.target = '_blank';
      control.rel = 'noopener noreferrer';
    } else {
      control.type = 'button';
      control.dataset.detailAction = action;
    }
    control.append(makeIcon(icon), document.createTextNode(label));
    container.append(control);
  }

  function renderLeadActions(lead) {
    const container = elements['modal-actions'];
    container.replaceChildren();
    const target = whatsappTarget(lead);
    if (target) {
      appendActionButton(container, {
        label: 'Abrir WhatsApp', icon: 'message-circle', className: 'btn btn-primary btn-sm', href: `https://wa.me/${target}`,
      });
    }
    if (lead.status !== 'human_taken_over') {
      appendActionButton(container, { label: 'Assumir atendimento', icon: 'user-check', action: 'takeover' });
    }
    if (AUTOMATION_PAUSED_STATUSES.has(lead.status)) {
      appendActionButton(container, { label: 'Devolver para IA', icon: 'bot', action: 'return-ai' });
    } else if (!lead.automationPaused) {
      appendActionButton(container, { label: 'Pausar IA', icon: 'pause', action: 'pause-ai' });
    }
    appendActionButton(container, {
      label: 'Excluir', icon: 'trash-2', action: 'delete', className: 'btn btn-outline btn-sm lead-danger-btn',
    });
  }

  function renderChat(lead) {
    const chat = elements['modal-chat'];
    chat.replaceChildren();
    const history = Array.isArray(lead.history) ? lead.history : [];
    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lead-notification-empty';
      empty.textContent = 'Sem historico de conversa.';
      chat.append(empty);
      return;
    }
    for (const message of history) {
      const isUser = message.role === 'user';
      const wrapper = document.createElement('div');
      wrapper.className = `chat-bubble-wrap${isUser ? '' : ' outgoing'}`;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.textContent = String(message.content || '');
      const timestamp = document.createElement('div');
      timestamp.className = 'chat-ts';
      const time = message.ts ? new Date(message.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      timestamp.textContent = `${isUser ? 'Cliente' : 'Bot'}${time ? ` - ${time}` : ''}`;
      wrapper.append(bubble, timestamp);
      if (!isUser && message.deliveryStatus && !['confirmed', 'sent'].includes(message.deliveryStatus)) {
        const delivery = document.createElement('div');
        delivery.className = 'chat-ts';
        delivery.textContent = message.deliveryStatus === 'failed' ? 'Falha no envio' : 'Envio sem confirmacao';
        wrapper.append(delivery);
      }
      chat.append(wrapper);
    }
    window.setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 20);
  }

  async function loadReminder(number) {
    elements['modal-lead-agenda'].value = '';
    try {
      const response = await fetch(`/api/reminders/${encodeURIComponent(number)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const reminder = await response.json();
      if (!reminder?.due_at || state.currentLead?.number !== number) return;
      const date = new Date(reminder.due_at);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      elements['modal-lead-agenda'].value = local;
    } catch {}
  }

  function renderLeadDetail(lead) {
    state.currentLead = lead;
    setText('modal-lead-avatar', initials(lead.name));
    setText('modal-lead-name', lead.name || 'Contato sem nome');
    setText('modal-lead-number', formatPhone(lead.phone || lead.displayNumber));
    setText('modal-lead-updated', `Atualizado ${timeSince(lead.updatedAt || lead.lastInteraction)}`);
    setText('modal-lead-summary', detailSummary(lead));

    const statusline = elements['modal-lead-statusline'];
    statusline.replaceChildren();
    const stage = document.createElement('span');
    const pipelineStage = lead.pipelineStage || state.leads.find((item) => item.number === lead.number)?.pipelineStage || 'active';
    stage.className = `lead-stage-pill lead-stage-${pipelineStage}`;
    stage.textContent = stageLabel(pipelineStage);
    const status = document.createElement('span');
    status.className = 'lead-source-pill';
    status.textContent = statusLabel(lead.status);
    statusline.append(stage, status);
    if (lead.tag) {
      const tag = document.createElement('span');
      tag.className = 'lead-tag-pill';
      tag.textContent = lead.tag;
      statusline.append(tag);
    }

    const facts = elements['modal-lead-facts'];
    facts.replaceChildren();
    addFact(facts, 'Intencao', intentLabel({ ...lead, hasCustomerMessage: true }));
    addFact(facts, 'Veiculo', [lead.model, lead.year].filter(Boolean).join(' '));
    addFact(facts, 'Placa', lead.plate);
    addFact(facts, 'Origem', lead.source === 'campaign' || lead.campaignSentAt ? 'Campanha' : 'Contato espontaneo');
    addFact(facts, 'Estado da IA', lead.automationPaused ? 'Pausada' : statusLabel(lead.status));
    addFact(facts, 'Risco', lead.riskLevel || 'Nao classificado');
    addFact(facts, 'Criado em', lead.createdAt ? new Date(lead.createdAt).toLocaleString('pt-BR') : 'Nao informado');
    addFact(facts, 'Consultor', lead.transferredToName || 'Consultor principal');

    elements['modal-lead-stage'].value = pipelineStage;
    elements['modal-lead-tag'].value = lead.tag || '';
    renderLeadActions({ ...lead, pipelineStage });
    renderChat(lead);
    renderIcons();
    loadReminder(lead.number);
  }

  async function openLead(number) {
    if (!number || state.view === 'trash') return;
    try {
      const lead = await api(`/api/leads/${encodeURIComponent(number)}`);
      const summary = state.leads.find((item) => item.number === number);
      const detail = {
        ...(summary || {}),
        ...lead,
        pipelineStage: lead.pipelineStage || summary?.pipelineStage,
        automationPaused: summary?.automationPaused ?? AUTOMATION_PAUSED_STATUSES.has(lead.status),
      };
      state.previousFocus = document.activeElement;
      renderLeadDetail(detail);
      elements['lead-modal'].classList.remove('hidden');
      document.body.classList.add('modal-open');
      elements['lead-modal-close'].focus();
    } catch (error) {
      notifyToast('Nao foi possivel abrir esse lead.', 'error');
    }
  }

  function closeLeadModal() {
    elements['lead-modal']?.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.currentLead = null;
    state.previousFocus?.focus?.();
  }

  async function updateCurrentLead(updates, message) {
    const number = state.currentLead?.number;
    if (!number) return;
    try {
      const lead = await api(`/api/leads/${encodeURIComponent(number)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      renderLeadDetail(lead);
      await refresh({ quiet: true });
      if (message) notifyToast(message, 'success');
    } catch (error) {
      notifyToast(error.message || 'Nao foi possivel atualizar o lead.', 'error');
    }
  }

  async function saveReminder() {
    const lead = state.currentLead;
    const value = elements['modal-lead-agenda'].value;
    if (!lead || !value) return notifyToast('Escolha uma data para o retorno.', 'warning');
    try {
      const response = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_key: lead.number,
          reminder_text: 'Retorno agendado pela Central de Leads',
          due_at: new Date(value).toISOString(),
        }),
      });
      if (!response.ok) throw new Error();
      notifyToast('Retorno agendado.', 'success');
    } catch {
      notifyToast('Nao foi possivel agendar o retorno.', 'error');
    }
  }

  async function completeReminder() {
    const lead = state.currentLead;
    if (!lead) return;
    try {
      const response = await fetch(`/api/reminders/${encodeURIComponent(lead.number)}/complete`, { method: 'POST' });
      if (!response.ok) throw new Error();
      elements['modal-lead-agenda'].value = '';
      notifyToast('Retorno concluido.', 'success');
    } catch {
      notifyToast('Nao foi possivel concluir o retorno.', 'error');
    }
  }

  function openDeleteDialog(mode, numbers) {
    const unique = [...new Set((numbers || []).filter(Boolean))];
    if (mode !== 'all' && unique.length === 0) return;
    const count = mode === 'all' ? Number(state.overview?.counts?.total || state.leads.length) : unique.length;
    state.pendingDelete = { mode, numbers: unique, count };
    const all = mode === 'all';
    const single = mode === 'single';
    setText(
      'lead-delete-title',
      all ? 'Excluir todos os leads?' : single ? 'Excluir este lead?' : `Excluir ${count} ${count === 1 ? 'lead' : 'leads'}?`,
    );
    setText(
      'lead-delete-description',
      all
        ? `${count} registros serao movidos para a lixeira. Novos leads que chegarem depois desta confirmacao nao serao apagados.`
        : count === 1
          ? 'O registro sera movido para a lixeira e podera ser restaurado.'
          : 'Os registros serao movidos para a lixeira e poderao ser restaurados.',
    );
    elements['lead-delete-phrase-wrap'].classList.toggle('hidden', !all);
    elements['lead-delete-phrase'].value = '';
    elements['lead-delete-confirm'].disabled = all;
    state.previousFocus = document.activeElement;
    elements['lead-delete-modal'].classList.remove('hidden');
    if (all) elements['lead-delete-phrase'].focus();
    else elements['lead-delete-confirm'].focus();
  }

  function closeDeleteDialog() {
    elements['lead-delete-modal'].classList.add('hidden');
    state.pendingDelete = null;
    state.previousFocus?.focus?.();
  }

  async function confirmDelete() {
    const pending = state.pendingDelete;
    if (!pending) return;
    elements['lead-delete-confirm'].disabled = true;
    try {
      if (pending.mode === 'all') {
        await api('/api/leads/clear', {
          method: 'POST',
          body: JSON.stringify({ confirmation: 'EXCLUIR TUDO', expectedCount: pending.count }),
        });
      } else if (pending.mode === 'single') {
        await api(`/api/leads/${encodeURIComponent(pending.numbers[0])}`, {
          method: 'DELETE',
          body: JSON.stringify({ confirmation: 'delete_one' }),
        });
      } else {
        await api('/api/leads/bulk', {
          method: 'DELETE',
          body: JSON.stringify({
            numbers: pending.numbers,
            confirmation: 'delete_selected',
            expectedCount: pending.count,
          }),
        });
      }
      closeDeleteDialog();
      closeLeadModal();
      state.selected.clear();
      await refresh();
      notifyToast(`${pending.count} lead${pending.count === 1 ? '' : 's'} movido${pending.count === 1 ? '' : 's'} para a lixeira.`, 'success');
    } catch (error) {
      elements['lead-delete-confirm'].disabled = false;
      notifyToast(error.message, 'error');
    }
  }

  async function bulkMove() {
    const crmStage = elements['lead-bulk-stage'].value;
    if (!crmStage || state.selected.size === 0) return notifyToast('Escolha uma categoria.', 'warning');
    try {
      await api('/api/leads/bulk', {
        method: 'PATCH',
        body: JSON.stringify({ numbers: [...state.selected], updates: { crmStage } }),
      });
      const count = state.selected.size;
      state.selected.clear();
      elements['lead-bulk-stage'].value = '';
      await refresh();
      notifyToast(`${count} lead${count === 1 ? '' : 's'} reorganizado${count === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      notifyToast(error.message, 'error');
    }
  }

  async function restoreSelected(numbers = [...state.selected]) {
    if (!numbers.length) return;
    try {
      const result = await api('/api/leads/trash/restore', {
        method: 'POST',
        body: JSON.stringify({ numbers }),
      });
      state.selected.clear();
      await Promise.all([loadTrash(), refresh({ quiet: true })]);
      notifyToast(`${result.restored} lead${result.restored === 1 ? '' : 's'} restaurado${result.restored === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      notifyToast(error.message, 'error');
    }
  }

  function selectPage(checked) {
    const rows = pageData().rows;
    for (const lead of rows) {
      if (checked) state.selected.add(lead.number);
      else state.selected.delete(lead.number);
    }
    renderTable();
  }

  function handleTableChange(event) {
    const checkbox = event.target.closest('[data-lead-select]');
    if (!checkbox) return;
    if (checkbox.checked) state.selected.add(checkbox.dataset.leadSelect);
    else state.selected.delete(checkbox.dataset.leadSelect);
    renderTable();
  }

  function handleTableClick(event) {
    const button = event.target.closest('[data-lead-action]');
    if (!button) return;
    if (button.dataset.leadAction === 'restore') restoreSelected([button.dataset.leadId]);
    else openLead(button.dataset.leadId);
  }

  function selectAllResults() {
    const button = elements['lead-select-all-results'];
    if (button.dataset.mode === 'clear') state.selected.clear();
    else filteredLeads().forEach((lead) => state.selected.add(lead.number));
    renderTable();
  }

  function trapFocus(event, container) {
    if (event.key !== 'Tab' || !container || container.classList.contains('hidden')) return;
    const focusable = [...container.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)')]
      .filter((element) => !element.classList.contains('hidden'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-lead-stage]').forEach((button) => {
      button.addEventListener('click', () => {
        state.stage = button.dataset.leadStage;
        state.page = 1;
        state.selected.clear();
        renderViewState();
      });
    });
    elements['lead-search-input'].addEventListener('input', (event) => {
      state.query = event.target.value;
      state.page = 1;
      renderTable();
    });
    elements['lead-source-filter'].addEventListener('change', (event) => {
      state.source = event.target.value;
      state.page = 1;
      state.selected.clear();
      renderTable();
    });
    elements['lead-sort-filter'].addEventListener('change', (event) => {
      state.sort = event.target.value;
      state.page = 1;
      renderTable();
    });
    elements['lead-page-size'].addEventListener('change', (event) => {
      state.pageSize = Number(event.target.value) || 25;
      state.page = 1;
      renderTable();
    });
    elements['lead-page-prev'].addEventListener('click', () => { state.page -= 1; renderTable(); });
    elements['lead-page-next'].addEventListener('click', () => { state.page += 1; renderTable(); });
    elements['lead-select-page'].addEventListener('change', (event) => selectPage(event.target.checked));
    elements['lead-table-body'].addEventListener('change', handleTableChange);
    elements['lead-table-body'].addEventListener('click', handleTableClick);
    elements['lead-select-all-results'].addEventListener('click', selectAllResults);
    elements['lead-refresh-btn'].addEventListener('click', async () => {
      await refresh();
      notifyToast('Leads atualizados.', 'success');
    });
    elements['lead-export-btn'].addEventListener('click', async () => {
      await ensureSession();
      window.open('/api/leads/export', '_blank', 'noopener');
    });
    elements['lead-trash-view-btn'].addEventListener('click', toggleTrashView);
    elements['lead-delete-all-btn'].addEventListener('click', () => openDeleteDialog('all', []));
    elements['lead-bulk-apply'].addEventListener('click', bulkMove);
    elements['lead-bulk-delete'].addEventListener('click', () => openDeleteDialog('selected', [...state.selected]));
    elements['lead-bulk-restore'].addEventListener('click', () => restoreSelected());

    elements['lead-modal-close'].addEventListener('click', closeLeadModal);
    elements['lead-modal'].addEventListener('click', (event) => {
      if (event.target === elements['lead-modal']) closeLeadModal();
    });
    elements['modal-actions'].addEventListener('click', (event) => {
      const button = event.target.closest('[data-detail-action]');
      if (!button || !state.currentLead) return;
      if (button.dataset.detailAction === 'takeover') {
        updateCurrentLead({ status: 'human_taken_over', stage: 'human_taken_over', operationalStatus: 'human_taken_over' }, 'Atendimento assumido.');
      } else if (button.dataset.detailAction === 'return-ai') {
        updateCurrentLead({ status: 'talking', stage: 'engaged', operationalStatus: 'returned_to_ai' }, 'Lead devolvido para a IA.');
      } else if (button.dataset.detailAction === 'pause-ai') {
        updateCurrentLead({ status: 'blocked', stage: 'blocked', operationalStatus: 'blocked' }, 'IA pausada para este contato.');
      } else if (button.dataset.detailAction === 'delete') {
        openDeleteDialog('single', [state.currentLead.number]);
      }
    });
    elements['modal-lead-stage'].addEventListener('change', (event) => {
      updateCurrentLead({ crmStage: event.target.value }, 'Categoria atualizada.');
    });
    elements['modal-lead-tag'].addEventListener('change', (event) => {
      updateCurrentLead({ tag: event.target.value }, 'Etiqueta atualizada.');
    });
    elements['lead-reminder-save'].addEventListener('click', saveReminder);
    elements['lead-reminder-complete'].addEventListener('click', completeReminder);

    elements['lead-delete-cancel'].addEventListener('click', closeDeleteDialog);
    elements['lead-delete-modal'].addEventListener('click', (event) => {
      if (event.target === elements['lead-delete-modal']) closeDeleteDialog();
    });
    elements['lead-delete-phrase'].addEventListener('input', (event) => {
      elements['lead-delete-confirm'].disabled = event.target.value.trim() !== 'EXCLUIR TUDO';
    });
    elements['lead-delete-confirm'].addEventListener('click', confirmDelete);

    elements['lead-notification-trigger'].addEventListener('click', () => toggleNotificationPanel());
    elements['lead-notification-clear'].addEventListener('click', () => {
      state.unread = 0;
      state.notifications = [];
      renderNotifications();
      updateDocumentTitle();
    });
    elements['lead-sound-toggle'].checked = state.soundEnabled;
    elements['lead-sound-toggle'].addEventListener('change', (event) => {
      state.soundEnabled = event.target.checked;
      localStorage.setItem(SOUND_STORAGE_KEY, String(state.soundEnabled));
      if (state.soundEnabled) {
        unlockAudio();
        playChime('normal');
      }
    });
    elements['lead-browser-notification-btn'].addEventListener('click', requestBrowserNotifications);
    document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
    document.addEventListener('click', (event) => {
      const hub = byId('lead-notification-hub');
      if (hub && !hub.contains(event.target)) toggleNotificationPanel(false);
    });
    document.addEventListener('visibilitychange', updateDocumentTitle);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!elements['lead-delete-modal'].classList.contains('hidden')) closeDeleteDialog();
        else if (!elements['lead-modal'].classList.contains('hidden')) closeLeadModal();
        else toggleNotificationPanel(false);
      }
      trapFocus(event, !elements['lead-delete-modal'].classList.contains('hidden') ? elements['lead-delete-modal'] : elements['lead-modal']);
    });
  }

  async function init() {
    if (state.initialized) return;
    cacheElements();
    if (!elements['lead-table-body']) return;
    state.initialized = true;
    bindEvents();
    updateBrowserNotificationButton();
    renderIcons();
    renderNotifications();
    await refresh();
    window.setInterval(() => refresh({ quiet: true, notifyDiff: true }), 30000);
  }

  async function open() {
    if (!state.initialized) await init();
    if (state.view === 'trash') {
      state.view = 'active';
      state.selected.clear();
    }
    renderViewState();
    if (Date.now() - state.lastFetchedAt > 12000) await refresh({ quiet: true, notifyDiff: true });
  }

  const workspace = {
    init,
    open,
    refresh,
    handleEvent,
    handleOverview,
    openLead,
    closeLeadModal,
    playChime,
  };

  window.leadsWorkspace = workspace;
  window.loadLeads = () => workspace.open();
  window.refreshLeads = () => workspace.refresh();
  window.exportLeadsCSV = async () => {
    await ensureSession();
    window.open('/api/leads/export', '_blank', 'noopener');
  };
  window.openLeadModal = (number) => workspace.openLead(typeof number === 'object' ? number.number : number);
  window.closeLeadModal = () => workspace.closeLeadModal();
  window.deleteLead = (number) => openDeleteDialog('single', [number]);
  window.updateLeadTag = () => updateCurrentLead({ tag: elements['modal-lead-tag']?.value || '' }, 'Etiqueta atualizada.');
  window.saveLeadAgenda = saveReminder;
  window.completeLeadAgenda = completeReminder;
  window.playBeep = () => playChime('high');

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
