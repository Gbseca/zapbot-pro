/* Campaign Studio - persistent, consent-aware WhatsApp campaign workspace. */
(() => {
  const CAMPAIGN_TABS = new Set(['contacts', 'message', 'schedule', 'campaign']);
  const EDIT_LOCKED_STATUSES = new Set(['running', 'scheduled', 'paused', 'recovering']);
  const STORAGE_KEY = 'zapbot_campaign_studio_active_id';
  const STATUS_LABELS = {
    idle: 'Aguardando',
    draft: 'Rascunho',
    scheduled: 'Agendada',
    running: 'Enviando',
    paused: 'Pausada',
    recovering: 'Revisao necessaria',
    stopped: 'Interrompida',
    completed: 'Concluida',
    cleared: 'Removida da fila',
    pending: 'Pendente',
    sending: 'Enviando',
    accepted: 'Aceito',
    accepted_unconfirmed: 'Sem confirmacao',
    confirmed: 'Confirmado',
    failed: 'Falhou',
    partial_failed: 'Falha parcial',
    skipped: 'Ignorado',
    delivery_timeout: 'Sem confirmacao',
  };

  const studio = {
    draft: null,
    history: [],
    suppressions: [],
    limits: null,
    preflight: null,
    sessionReady: false,
    saveTimer: null,
    savePromise: null,
    saving: false,
    dirty: false,
    changeVersion: 0,
    selectedRecipients: new Set(),
    audienceFilter: '',
    audiencePage: 0,
    importReport: null,
    lastFocusedEditor: null,
    aiReview: [],
    activeTab: 'contacts',
    activeCampaignId: null,
    uploadingBlocks: new Set(),
  };

  function id(prefix = 'item') {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toast(message, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
  }

  function icons() {
    requestAnimationFrame(() => window.lucide?.createIcons({ attrs: { 'stroke-width': 1.8 } }));
  }

  function emptyDraft() {
    return {
      name: `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
      objective: 'Gerar conversas qualificadas',
      intent: 'sales',
      audience: {
        recipients: [],
        source: 'manual',
        consentConfirmed: false,
        consentSource: '',
        consentAt: null,
        importedColumns: [],
      },
      content: {
        message: '',
        blocks: [{ id: id('text'), type: 'text', enabled: true, text: '' }],
        variants: [],
        variantMode: 'single',
        variableDefaults: {},
        appendOptOut: true,
        optOutText: 'Para nao receber novas mensagens, responda SAIR.',
        aiRepliesEnabled: true,
        aiInstructions: '',
      },
      delivery: {
        startMode: 'now',
        scheduledAt: null,
        timezone: 'America/Sao_Paulo',
        allowedWeekdays: [1, 2, 3, 4, 5],
        useWindow: true,
        windowStart: '08:00',
        windowEnd: '20:00',
        intervalMode: 'random',
        intervalFixed: 45,
        intervalMin: 30,
        intervalMax: 90,
        flowControl: { enabled: true, maxContacts: 15, windowMinutes: 10 },
        dailyLimit: { enabled: true, max: 50 },
        frequencyCap: { enabled: true, max: 2, days: 7 },
        typing: true,
        pauseAfterFailures: 3,
        pauseFailureRate: 35,
        pauseUnconfirmedRate: 50,
      },
      media: {},
    };
  }

  async function ensureSession() {
    if (studio.sessionReady) return;
    const response = await fetch('/api/campaign/session', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Nao foi possivel abrir o Estudio de Campanhas.');
    studio.sessionReady = true;
  }

  async function api(path, options = {}, retry = true) {
    await ensureSession();
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
    if (response.status === 403 && retry) {
      studio.sessionReady = false;
      await ensureSession();
      return api(path, options, false);
    }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    let data = {};
    if (contentType.includes('application/json')) data = await response.json().catch(() => ({}));
    else await response.text().catch(() => '');
    if (!response.ok) {
      const fallbackMessage = response.status === 413
        ? 'O arquivo e maior que o limite aceito pelo servidor.'
        : response.status === 415
          ? 'O formato deste arquivo nao e aceito.'
          : 'A operacao nao foi concluida.';
      const error = new Error(data.error || fallbackMessage);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function workflowTemplate() {
    return `
      <button type="button" data-campaign-step="contacts" onclick="switchTab('contacts')">
        <span class="campaign-step-index">1</span><span><strong>Publico</strong><small>Contatos e consentimento</small></span>
      </button><span class="campaign-step-line" aria-hidden="true"></span>
      <button type="button" data-campaign-step="message" onclick="switchTab('message')">
        <span class="campaign-step-index">2</span><span><strong>Conteudo</strong><small>Blocos e variacoes</small></span>
      </button><span class="campaign-step-line" aria-hidden="true"></span>
      <button type="button" data-campaign-step="schedule" onclick="switchTab('schedule')">
        <span class="campaign-step-index">3</span><span><strong>Entrega</strong><small>Data, ritmo e limites</small></span>
      </button><span class="campaign-step-line" aria-hidden="true"></span>
      <button type="button" data-campaign-step="campaign" onclick="switchTab('campaign')">
        <span class="campaign-step-index">4</span><span><strong>Revisao</strong><small>Teste, envio e resultados</small></span>
      </button>`;
  }

  function pageHeader(title, subtitle, actions = '') {
    return `<div class="cs-page-header"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="cs-page-actions"><span class="cs-save-state" data-cs-save-state><i data-lucide="cloud-check"></i>Salvo</span>${actions}</div></div>`;
  }

  function contactsTemplate() {
    return `
      ${pageHeader('Publico da campanha', 'Prepare a lista autorizada que recebera esta campanha.', `
        <button class="btn btn-outline" type="button" data-cs-action="new-draft"><i data-lucide="file-plus-2"></i>Novo rascunho</button>
        <button class="btn btn-outline" type="button" data-cs-action="open-history"><i data-lucide="history"></i>Historico</button>`)}
      <section class="cs-meta-band" aria-label="Identificacao da campanha">
        <label><span>Nome da campanha</span><input class="form-input" id="cs-campaign-name" maxlength="120"></label>
        <label><span>Objetivo</span><input class="form-input" id="cs-campaign-objective" maxlength="160"></label>
        <label><span>Tipo</span><select class="form-select" id="cs-campaign-intent"><option value="sales">Comercial</option><option value="relationship">Relacionamento</option><option value="informative">Informativa</option><option value="collections">Regularizacao</option></select></label>
      </section>
      <div class="cs-audience-layout">
        <section class="cs-panel cs-import-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Entrada</span><h2>Adicionar contatos</h2></div><div class="cs-segmented" role="tablist"><button type="button" class="active" data-import-view="paste">Colar</button><button type="button" data-import-view="csv">CSV</button></div></div>
          <div data-import-panel="paste">
            <label class="cs-field"><span>Telefone, nome e campos opcionais</span><textarea class="form-textarea mono" id="cs-audience-paste" rows="11" placeholder="11999990000, Ana, Campinas&#10;21988880000, Carlos, Niteroi"></textarea></label>
            <div class="cs-inline-actions"><button class="btn btn-primary" type="button" data-cs-action="import-paste"><i data-lucide="list-plus"></i>Adicionar a lista</button><button class="btn btn-outline" type="button" data-cs-action="paste-example"><i data-lucide="wand-sparkles"></i>Exemplo</button></div>
          </div>
          <div class="hidden" data-import-panel="csv">
            <label class="cs-dropzone" for="cs-csv-input"><i data-lucide="file-spreadsheet"></i><strong>Selecionar arquivo CSV</strong><span>Cabecalhos aceitos: telefone, nome e campos personalizados</span></label>
            <input type="file" id="cs-csv-input" accept=".csv,.txt,text/csv,text/plain" hidden>
          </div>
          <div class="cs-import-report hidden" id="cs-import-report"></div>
          <div class="cs-consent-box">
            <label class="cs-check-row"><input type="checkbox" id="cs-consent-confirmed"><span><strong>Contatos autorizaram mensagens da Moove</strong><small>Obrigatorio para liberar o envio.</small></span></label>
            <label class="cs-field"><span>Origem do consentimento</span><input class="form-input" id="cs-consent-source" maxlength="240" placeholder="Ex.: formulario do site, atendimento ou evento"></label>
          </div>
        </section>
        <section class="cs-panel cs-audience-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Lista final</span><h2>Contatos elegiveis</h2></div><div class="cs-inline-actions"><button class="cs-icon-btn" type="button" data-cs-action="remove-selected" title="Remover selecionados" aria-label="Remover selecionados"><i data-lucide="user-minus"></i></button><button class="cs-icon-btn danger" type="button" data-cs-action="clear-audience" title="Limpar lista" aria-label="Limpar lista"><i data-lucide="trash-2"></i></button></div></div>
          <div class="cs-audience-stats">
            <div><strong id="val-total">0</strong><span>Total</span></div><div class="positive"><strong id="val-valid">0</strong><span>Validos</span></div><div class="warning"><strong id="val-invalid">0</strong><span>Invalidos</span></div><div><strong id="val-duplicates">0</strong><span>Duplicados</span></div>
          </div>
          <div class="cs-table-tools"><label class="cs-search"><i data-lucide="search"></i><input id="cs-audience-filter" type="search" placeholder="Buscar nome ou telefone"></label><span id="contact-step-status">Lista vazia</span></div>
          <div class="cs-table-wrap"><table class="cs-table"><thead><tr><th><input type="checkbox" id="cs-select-all" aria-label="Selecionar todos"></th><th>Contato</th><th>Telefone</th><th>Campos</th><th></th></tr></thead><tbody id="cs-audience-rows"></tbody></table></div>
          <div class="cs-empty" id="cs-audience-empty"><i data-lucide="users"></i><strong>Nenhum contato adicionado</strong><span>Importe uma lista para montar o publico.</span></div>
        </section>
      </div>
      <section class="cs-panel cs-suppression-panel">
        <div class="cs-panel-head"><div><span class="cs-kicker">Privacidade</span><h2>Lista de nao contatar</h2></div><span class="cs-count-badge" id="cs-suppression-count">0 contatos</span></div>
        <div class="cs-suppression-layout">
          <div class="cs-suppression-form"><label class="cs-field"><span>WhatsApp com DDD</span><input class="form-input" id="cs-suppression-phone" inputmode="tel" placeholder="11999990000"></label><label class="cs-field"><span>Motivo</span><input class="form-input" id="cs-suppression-reason" maxlength="240" placeholder="Ex.: pedido do contato"></label><button class="btn btn-outline" id="cs-suppression-add" type="button" data-cs-action="add-suppression"><i data-lucide="shield-minus"></i>Bloquear contato</button></div>
          <div class="cs-suppression-list" id="cs-suppression-list"></div>
        </div>
      </section>
      <div class="cs-step-footer"><span>Supressoes e duplicados sao retirados antes da fila.</span><button class="btn btn-primary" type="button" onclick="switchTab('message')">Continuar<i data-lucide="arrow-right"></i></button></div>`;
  }

  function messageTemplate() {
    return `
      ${pageHeader('Conteudo da campanha', 'Monte a mensagem em blocos e confira exatamente o que sera enviado.', `
        <button class="btn btn-outline" type="button" data-cs-ai="review"><i data-lucide="scan-text"></i>Revisar com IA</button>`)}
      <div class="cs-composer-layout">
        <aside class="cs-panel cs-block-rail">
          <div class="cs-panel-head"><div><span class="cs-kicker">Blocos</span><h2>Adicionar</h2></div></div>
          <button type="button" data-add-block="text"><i data-lucide="type"></i><span>Texto</span></button>
          <button type="button" data-add-block="image"><i data-lucide="image"></i><span>Imagem</span></button>
          <button type="button" data-add-block="video"><i data-lucide="video"></i><span>Video</span></button>
          <button type="button" data-add-block="audio"><i data-lucide="mic-2"></i><span>Audio</span></button>
          <button type="button" data-add-block="document"><i data-lucide="file-text"></i><span>Documento</span></button>
          <button type="button" data-add-block="poll"><i data-lucide="list-checks"></i><span>Enquete</span></button>
        </aside>
        <section class="cs-panel cs-editor-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Editor</span><h2>Sequencia de envio</h2></div><div class="cs-variant-control"><label><input type="checkbox" id="cs-split-enabled"> Teste de variacoes</label></div></div>
          <div class="cs-variable-bar" id="cs-variable-bar"></div>
          <div class="cs-block-list" id="cs-block-list"></div>
          <div class="cs-optout-row"><label class="cs-check-row"><input type="checkbox" id="cs-optout-enabled"><span><strong>Incluir instrucao de saida</strong><small>Aplicada ao ultimo texto da campanha.</small></span></label><input class="form-input" id="cs-optout-text" maxlength="300"></div>
        </section>
        <aside class="cs-panel cs-phone-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Previa</span><h2>WhatsApp</h2></div><label class="cs-preview-person"><span>Contato</span><select id="cs-preview-recipient" class="form-select"></select></label></div>
          <div class="cs-phone"><div class="cs-phone-top"><span></span><strong>Moove</strong><small>agora</small></div><div class="cs-phone-body" id="cs-phone-preview"></div></div>
        </aside>
      </div>
      <section class="cs-panel cs-ai-panel">
        <div class="cs-panel-head"><div><span class="cs-kicker">Copiloto</span><h2>Assistente de campanha</h2></div><span class="cs-ai-source" id="cs-ai-source">Pronto</span></div>
        <div class="cs-ai-grid"><label class="cs-field"><span>Pedido para a IA</span><textarea class="form-textarea" id="cs-ai-prompt" rows="3" placeholder="Ex.: crie uma abordagem curta para associados que pediram uma cotacao no site"></textarea></label><div class="cs-ai-actions"><button type="button" class="btn btn-primary" data-cs-ai="compose"><i data-lucide="sparkles"></i>Criar</button><button type="button" class="btn btn-outline" data-cs-ai="improve">Melhorar</button><button type="button" class="btn btn-outline" data-cs-ai="shorten">Encurtar</button><button type="button" class="btn btn-outline" data-cs-ai="natural">Mais natural</button><button type="button" class="btn btn-outline" data-cs-ai="variants">Gerar variacoes</button></div></div>
        <div class="cs-ai-review hidden" id="cs-ai-review"></div><div class="cs-variants" id="cs-variants"></div>
      </section>
      <section class="cs-panel cs-reply-panel">
        <div class="cs-panel-head"><div><span class="cs-kicker">Depois do envio</span><h2>Atendimento das respostas</h2></div></div>
        <div class="cs-reply-grid"><label class="cs-check-row"><input type="checkbox" id="cs-ai-replies-enabled"><span><strong>IA atende as respostas</strong><small>Desativado encaminha a primeira resposta ao consultor.</small></span></label><label class="cs-field"><span>Orientacao desta campanha</span><textarea class="form-textarea" id="cs-ai-instructions" rows="3" maxlength="1000" placeholder="Ex.: responda primeiro sobre o beneficio apresentado e encaminhe quando houver interesse em cotar"></textarea></label></div>
      </section>
      <div class="cs-step-footer"><button class="btn btn-outline" type="button" onclick="switchTab('contacts')"><i data-lucide="arrow-left"></i>Voltar</button><button class="btn btn-primary" type="button" onclick="switchTab('schedule')">Continuar<i data-lucide="arrow-right"></i></button></div>`;
  }

  function scheduleTemplate() {
    const weekdays = [['0', 'Dom'], ['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sab']];
    return `
      ${pageHeader('Entrega da campanha', 'Defina quando a fila pode trabalhar e os limites de seguranca.')}
      <div class="cs-delivery-grid">
        <section class="cs-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Inicio</span><h2>Data e horario</h2></div></div>
          <div class="cs-segmented cs-wide"><label><input type="radio" name="cs-start-mode" value="now"><span>Assim que aprovada</span></label><label><input type="radio" name="cs-start-mode" value="scheduled"><span>Agendar</span></label></div>
          <label class="cs-field" id="cs-scheduled-wrap"><span>Data programada</span><input class="form-input" type="datetime-local" id="cs-scheduled-at"></label>
          <div class="cs-field"><span>Dias permitidos</span><div class="cs-weekdays">${weekdays.map(([value, label]) => `<label><input type="checkbox" value="${value}" data-weekday><span>${label}</span></label>`).join('')}</div></div>
          <label class="cs-check-row"><input type="checkbox" id="use-window"><span><strong>Usar janela de horario</strong><small>Fuso: America/Sao_Paulo</small></span></label>
          <div class="cs-two-fields"><label class="cs-field"><span>Inicio</span><input class="form-input" type="time" id="window-start"></label><label class="cs-field"><span>Fim</span><input class="form-input" type="time" id="window-end"></label></div>
        </section>
        <section class="cs-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Ritmo</span><h2>Intervalo e fluxo</h2></div></div>
          <div class="cs-segmented cs-wide"><label><input type="radio" name="interval-mode" value="random"><span>Aleatorio</span></label><label><input type="radio" name="interval-mode" value="fixed"><span>Fixo</span></label></div>
          <div id="cs-random-interval" class="cs-two-fields"><label class="cs-field"><span>Minimo (s)</span><input class="form-input" type="number" id="interval-min" min="5" max="3600"></label><label class="cs-field"><span>Maximo (s)</span><input class="form-input" type="number" id="interval-max" min="5" max="3600"></label></div>
          <label class="cs-field" id="cs-fixed-interval"><span>Intervalo (s)</span><input class="form-input" type="number" id="interval-fixed-val" min="5" max="3600"></label>
          <label class="cs-check-row"><input type="checkbox" id="flow-control-enabled"><span><strong>Controle de fluxo</strong><small>Limita contatos dentro de uma janela.</small></span></label>
          <div class="cs-two-fields"><label class="cs-field"><span>Contatos</span><input class="form-input" type="number" id="flow-max-contacts" min="1"></label><label class="cs-field"><span>Janela (min)</span><input class="form-input" type="number" id="flow-window-minutes" min="1"></label></div>
        </section>
        <section class="cs-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Protecoes</span><h2>Limites da conta</h2></div></div>
          <label class="cs-check-row"><input type="checkbox" id="anti-limit"><span><strong>Limite diario</strong><small>Contabilizado mesmo depois de reiniciar.</small></span></label>
          <label class="cs-field"><span>Envios por dia</span><input class="form-input" type="number" id="daily-limit" min="1" max="100000"></label>
          <label class="cs-check-row"><input type="checkbox" id="cs-frequency-enabled"><span><strong>Limite por contato</strong><small>Evita excesso entre campanhas.</small></span></label>
          <div class="cs-two-fields"><label class="cs-field"><span>Campanhas</span><input class="form-input" type="number" id="cs-frequency-max" min="1" max="100"></label><label class="cs-field"><span>Periodo (dias)</span><input class="form-input" type="number" id="cs-frequency-days" min="1" max="365"></label></div>
          <label class="cs-check-row"><input type="checkbox" id="anti-typing"><span><strong>Indicador de digitacao</strong><small>Usado antes do primeiro texto.</small></span></label>
        </section>
        <section class="cs-panel cs-estimate-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Estimativa</span><h2>Resumo da entrega</h2></div></div>
          <div class="estimate-grid"><div class="estimate-item"><span class="est-value" id="est-contacts">0</span><span class="est-label">Contatos</span></div><div class="estimate-item"><span class="est-value" id="est-interval">--</span><span class="est-label">Intervalo medio</span></div><div class="estimate-item"><span class="est-value" id="est-duration">--</span><span class="est-label">Duracao minima</span></div><div class="estimate-item"><span class="est-value" id="est-end">--</span><span class="est-label">Termino estimado</span></div><div class="estimate-item"><span class="est-value" id="est-flow">--</span><span class="est-label">Fluxo</span></div><div class="estimate-item"><span class="est-value" id="cs-est-payloads">0</span><span class="est-label">Partes previstas</span></div></div>
          <details class="cs-advanced"><summary>Parada automatica</summary><div class="cs-three-fields"><label class="cs-field"><span>Falhas seguidas</span><input class="form-input" id="cs-pause-failures" type="number" min="1" max="50"></label><label class="cs-field"><span>Taxa de falha (%)</span><input class="form-input" id="cs-pause-rate" type="number" min="1" max="100"></label><label class="cs-field"><span>Sem confirmacao (%)</span><input class="form-input" id="cs-pause-unconfirmed" type="number" min="1" max="100"></label></div></details>
        </section>
      </div>
      <div class="cs-step-footer"><button class="btn btn-outline" type="button" onclick="switchTab('message')"><i data-lucide="arrow-left"></i>Voltar</button><button class="btn btn-primary" type="button" onclick="switchTab('campaign')">Revisar campanha<i data-lucide="arrow-right"></i></button></div>`;
  }

  function campaignTemplate() {
    return `
      ${pageHeader('Revisao e envio', 'Valide a campanha, envie um teste e acompanhe cada contato.', `
        <button class="btn btn-outline" type="button" data-cs-action="refresh-review"><i data-lucide="refresh-cw"></i>Atualizar</button>`)}
      <section class="cs-review-band">
        <div class="cs-review-summary" id="cs-review-summary"></div>
        <div class="cs-preflight" id="cs-preflight"><div class="cs-empty compact"><i data-lucide="shield-check"></i><strong>Preflight pendente</strong><span>Execute a revisao antes do envio.</span></div></div>
        <div class="cs-review-actions"><button class="btn btn-outline" type="button" data-cs-action="run-preflight"><i data-lucide="list-checks"></i>Executar preflight</button><button class="btn btn-primary btn-lg" id="btn-start" type="button" data-cs-action="prepare-launch"><i data-lucide="send"></i>Iniciar campanha</button><button class="btn btn-warning btn-lg hidden" id="btn-pause" type="button" data-cs-control="pause"><i data-lucide="pause"></i>Pausar</button><button class="btn btn-success btn-lg hidden" id="btn-resume" type="button" data-cs-control="resume"><i data-lucide="play"></i>Retomar</button><button class="btn btn-danger btn-lg hidden" id="btn-stop" type="button" data-cs-control="stop"><i data-lucide="square"></i>Parar</button></div>
      </section>
      <div class="cs-review-grid">
        <section class="cs-panel">
          <div class="cs-panel-head"><div><span class="cs-kicker">Teste real</span><h2>Enviar para um numero</h2></div></div>
          <div class="cs-test-form"><label class="cs-field"><span>WhatsApp com DDD</span><input class="form-input" id="cs-test-phone" inputmode="tel" placeholder="11999990000"></label><label class="cs-field"><span>Nome na previa</span><input class="form-input" id="cs-test-name" value="Contato de teste"></label><button class="btn btn-outline" type="button" data-cs-action="send-test"><i data-lucide="send-horizontal"></i>Enviar teste</button></div>
        </section>
        <section class="cs-panel progress-card">
          <div class="progress-header"><div><span class="cs-kicker">Execucao</span><h2>Progresso</h2></div><span id="campaign-status-label" class="campaign-status-badge status-idle">Aguardando</span><span id="progress-pct">0%</span></div>
          <div class="progress-bar-track"><div class="progress-bar-fill" id="progress-bar" style="width:0%"></div></div>
          <div class="cs-run-stats"><div><strong id="stat-total">0</strong><span>Total</span></div><div><strong id="stat-accepted">0</strong><span>Aceitos</span></div><div class="warning"><strong id="stat-accepted-unconfirmed">0</strong><span>Sem confirmacao</span></div><div class="positive"><strong id="stat-confirmed">0</strong><span>Confirmados</span></div><div class="negative"><strong id="stat-failed">0</strong><span>Falhas</span></div><div><strong id="stat-pending">0</strong><span>Pendentes</span></div></div>
          <div id="campaign-flow-panel"></div>
        </section>
      </div>
      <div class="cs-monitor-grid">
        <section class="cs-panel"><div class="cs-panel-head"><div><span class="cs-kicker">Fila</span><h2>Contatos</h2></div><button class="cs-icon-btn" id="btn-clear-queue" type="button" data-cs-control="clear" title="Limpar fila" aria-label="Limpar fila"><i data-lucide="trash-2"></i></button></div><div class="queue-list" id="queue-list"><div class="queue-empty">Nenhuma campanha carregada ainda</div></div></section>
        <section class="cs-panel"><div class="cs-panel-head"><div><span class="cs-kicker">Eventos</span><h2>Registro da campanha</h2></div><button class="cs-icon-btn" type="button" data-cs-action="copy-log" title="Copiar registro" aria-label="Copiar registro"><i data-lucide="copy"></i></button></div><div class="log-console" id="log-console"></div><div class="campaign-diagnostic-panel" id="campaign-diagnostic-panel"><div class="campaign-diagnostic-empty">O diagnostico do ultimo envio aparecera aqui.</div></div></section>
      </div>
      <section class="cs-panel cs-history-panel"><div class="cs-panel-head"><div><span class="cs-kicker">Historico</span><h2>Campanhas recentes</h2></div><button class="btn btn-outline btn-sm" type="button" data-cs-action="new-draft"><i data-lucide="plus"></i>Novo</button></div><div id="cs-history-list" class="cs-history-list"></div></section>
      <dialog class="cs-dialog" id="cs-launch-dialog"><form method="dialog"><button class="cs-dialog-close" value="cancel" aria-label="Fechar"><i data-lucide="x"></i></button><i class="cs-dialog-icon" data-lucide="send"></i><h2>Confirmar inicio</h2><p id="cs-launch-copy"></p><label class="cs-check-row"><input type="checkbox" id="cs-launch-consent"><span><strong>Confirmo o publico e o conteudo</strong><small>A campanha seguira os limites configurados.</small></span></label><div class="cs-dialog-actions"><button class="btn btn-outline" value="cancel">Cancelar</button><button class="btn btn-primary" id="cs-launch-confirm" value="default" type="button">Iniciar agora</button></div></form></dialog>`;
  }

  function installShell() {
    const workflow = document.getElementById('campaign-workflow');
    if (workflow) workflow.innerHTML = workflowTemplate();
    document.getElementById('tab-contacts').innerHTML = contactsTemplate();
    document.getElementById('tab-message').innerHTML = messageTemplate();
    document.getElementById('tab-schedule').innerHTML = scheduleTemplate();
    document.getElementById('tab-campaign').innerHTML = campaignTemplate();
    icons();
  }

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
    return /^\d{10,11}$/.test(digits) ? digits : null;
  }

  function cleanFieldName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  }

  function detectDelimiter(line) {
    const candidates = [',', ';', '\t'];
    return candidates.map(delimiter => ({ delimiter, count: parseDelimited(line, delimiter)[0]?.length || 0 })).sort((a, b) => b.count - a.count)[0].delimiter;
  }

  function parseDelimited(text, delimiter = ',') {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < String(text).length; index += 1) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = !quoted;
      } else if (character === delimiter && !quoted) {
        row.push(field.trim()); field = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field.trim()); field = '';
        if (row.some(Boolean)) rows.push(row);
        row = [];
      } else field += character;
    }
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  function recipientsFromRows(rows) {
    if (!rows.length) return { recipients: [], invalid: [], duplicates: [], columns: [] };
    const first = rows[0].map(cleanFieldName);
    const phoneAliases = new Set(['telefone', 'phone', 'numero', 'whatsapp', 'celular', 'fone']);
    const nameAliases = new Set(['nome', 'name', 'contato', 'cliente']);
    const hasHeader = first.some(value => phoneAliases.has(value) || nameAliases.has(value));
    const headers = hasHeader ? first : rows[0].map((_value, index) => index === 0 ? 'telefone' : index === 1 ? 'nome' : `campo_${index + 1}`);
    const phoneIndex = Math.max(0, headers.findIndex(value => phoneAliases.has(value)));
    const nameIndex = headers.findIndex(value => nameAliases.has(value));
    const output = [];
    const invalid = [];
    const duplicates = [];
    const existing = new Set((studio.draft?.audience?.recipients || []).map(item => normalizePhone(item.phone)).filter(Boolean));
    for (const row of rows.slice(hasHeader ? 1 : 0)) {
      const phone = normalizePhone(row[phoneIndex]);
      if (!phone) { invalid.push(row[phoneIndex] || row.join(' ')); continue; }
      if (existing.has(phone)) { duplicates.push(phone); continue; }
      existing.add(phone);
      const fields = {};
      headers.forEach((header, index) => {
        if (index === phoneIndex || !header) return;
        fields[header] = String(row[index] || '').trim().slice(0, 300);
      });
      if (nameIndex >= 0) fields.nome = String(row[nameIndex] || '').trim().slice(0, 160);
      output.push({ id: phone, phone, fields, consent: false });
    }
    return { recipients: output, invalid, duplicates, columns: headers.filter(value => !phoneAliases.has(value)) };
  }

  function importText(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return;
    const firstLine = normalized.split(/\r?\n/, 1)[0];
    const delimiter = detectDelimiter(firstLine);
    const rows = parseDelimited(normalized, delimiter);
    const report = recipientsFromRows(rows);
    studio.draft.audience.recipients.push(...report.recipients);
    studio.draft.audience.importedColumns = [...new Set([...(studio.draft.audience.importedColumns || []), ...report.columns])];
    studio.importReport = report;
    studio.audiencePage = 0;
    renderAudience();
    renderImportReport();
    renderVariables();
    renderPreview();
    markDirty();
    toast(`${report.recipients.length} contato(s) adicionado(s).`, report.recipients.length ? 'success' : 'warning');
  }

  function renderImportReport() {
    const element = document.getElementById('cs-import-report');
    const report = studio.importReport;
    if (!element || !report) return element?.classList.add('hidden');
    element.classList.remove('hidden');
    element.innerHTML = `<strong>${report.recipients.length} adicionados</strong><span>${report.invalid.length} invalidos</span><span>${report.duplicates.length} duplicados</span>`;
  }

  function renderAudience() {
    if (!studio.draft) return;
    const recipients = studio.draft.audience.recipients || [];
    const filtered = recipients.filter((item) => {
      const haystack = `${item.phone} ${Object.values(item.fields || {}).join(' ')}`.toLowerCase();
      return haystack.includes(studio.audienceFilter.toLowerCase());
    });
    const tbody = document.getElementById('cs-audience-rows');
    const empty = document.getElementById('cs-audience-empty');
    const visible = filtered.slice(0, 250);
    if (tbody) {
      tbody.innerHTML = visible.map((recipient) => {
        const name = recipient.fields?.nome || 'Sem nome';
        const extra = Object.entries(recipient.fields || {}).filter(([key, value]) => key !== 'nome' && value).slice(0, 2);
        return `<tr><td><input type="checkbox" data-recipient-select="${escapeHtml(recipient.phone)}" ${studio.selectedRecipients.has(recipient.phone) ? 'checked' : ''}></td><td><strong>${escapeHtml(name)}</strong></td><td class="mono">+55 ${escapeHtml(recipient.phone)}</td><td>${extra.length ? extra.map(([key, value]) => `<span class="cs-field-chip">${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join('') : '<span class="muted">--</span>'}</td><td><button class="cs-icon-btn danger" type="button" data-remove-recipient="${escapeHtml(recipient.phone)}" title="Remover" aria-label="Remover contato"><i data-lucide="x"></i></button></td></tr>`;
      }).join('');
    }
    empty?.classList.toggle('hidden', recipients.length > 0);
    document.getElementById('val-total').textContent = String(recipients.length + (studio.importReport?.invalid.length || 0) + (studio.importReport?.duplicates.length || 0));
    document.getElementById('val-valid').textContent = String(recipients.length);
    document.getElementById('val-invalid').textContent = String(studio.importReport?.invalid.length || 0);
    document.getElementById('val-duplicates').textContent = String(studio.importReport?.duplicates.length || 0);
    document.getElementById('contact-step-status').textContent = recipients.length ? `${recipients.length} contato(s) na lista` : 'Lista vazia';
    document.getElementById('est-contacts')?.replaceChildren(document.createTextNode(String(recipients.length)));
    syncDraftLock();
    syncWorkflow();
    icons();
  }

  function mediaName(block) {
    return studio.draft?.media?.[block.mediaId]?.fileName || '';
  }

  function mediaAccept(type) {
    return {
      image: '.jpg,.jpeg,.png,.gif,.webp',
      video: '.mp4,.webm,.mov,.3gp,.m4v',
      audio: '.mp3,.wav,.ogg,.opus,.m4a,.aac,.mp4,.webm',
      document: '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.zip',
    }[type] || '';
  }

  function mediaHint(block) {
    const media = studio.draft?.media?.[block.mediaId];
    if (media?.size) return `${(media.size / (1024 * 1024)).toFixed(media.size >= 1024 * 1024 ? 1 : 2)} MB`;
    const limit = studio.limits?.media?.[block.type]?.maxBytes;
    return limit ? `Ate ${Math.round(limit / (1024 * 1024))} MB` : 'Selecione um arquivo deste bloco';
  }

  function blockIcon(type) {
    return { text: 'type', image: 'image', video: 'video', audio: 'mic-2', document: 'file-text', poll: 'list-checks' }[type] || 'box';
  }

  function renderBlocks() {
    const list = document.getElementById('cs-block-list');
    if (!list || !studio.draft) return;
    const blocks = studio.draft.content.blocks || [];
    let textIndex = 0;
    list.innerHTML = blocks.map((block, index) => {
      const textId = block.type === 'text' && textIndex++ === 0 ? 'message-textarea' : `cs-text-${block.id}`;
      const header = `<div class="cs-block-head"><span class="cs-block-type"><i data-lucide="${blockIcon(block.type)}"></i>${escapeHtml(block.type)}</span><div><button class="cs-icon-btn" type="button" data-move-block="up" data-block-id="${block.id}" ${index === 0 ? 'disabled' : ''} title="Mover para cima" aria-label="Mover para cima"><i data-lucide="arrow-up"></i></button><button class="cs-icon-btn" type="button" data-move-block="down" data-block-id="${block.id}" ${index === blocks.length - 1 ? 'disabled' : ''} title="Mover para baixo" aria-label="Mover para baixo"><i data-lucide="arrow-down"></i></button><button class="cs-icon-btn danger" type="button" data-remove-block="${block.id}" title="Remover bloco" aria-label="Remover bloco"><i data-lucide="trash-2"></i></button></div></div>`;
      if (block.type === 'text') return `<article class="cs-content-block" data-block="${block.id}">${header}<textarea id="${textId}" class="form-textarea cs-block-editor" rows="6" data-block-field="text" data-block-id="${block.id}" placeholder="Escreva uma mensagem curta e clara">${escapeHtml(block.text || '')}</textarea><span class="cs-char-count">${String(block.text || '').length} caracteres</span></article>`;
      if (block.type === 'poll') {
        const options = (block.options || ['', '']);
        return `<article class="cs-content-block" data-block="${block.id}">${header}<label class="cs-field"><span>Pergunta</span><input class="form-input" data-block-field="question" data-block-id="${block.id}" maxlength="255" value="${escapeHtml(block.question || '')}"></label><div class="cs-poll-options">${options.map((option, optionIndex) => `<label><span>${optionIndex + 1}</span><input class="form-input" data-poll-option="${optionIndex}" data-block-id="${block.id}" value="${escapeHtml(option)}"><button class="cs-icon-btn danger" type="button" data-remove-poll-option="${optionIndex}" data-block-id="${block.id}" aria-label="Remover opcao"><i data-lucide="x"></i></button></label>`).join('')}</div><button class="btn btn-outline btn-sm" type="button" data-add-poll-option="${block.id}"><i data-lucide="plus"></i>Adicionar opcao</button></article>`;
      }
      const name = mediaName(block);
      const uploading = studio.uploadingBlocks.has(block.id);
      const caption = block.type === 'audio' ? '' : `<label class="cs-field"><span>Legenda</span><textarea class="form-textarea" rows="3" data-block-field="caption" data-block-id="${block.id}">${escapeHtml(block.caption || '')}</textarea></label>`;
      return `<article class="cs-content-block" data-block="${block.id}">${header}<div class="cs-media-row"><div class="cs-media-file ${name ? 'ready' : ''} ${uploading ? 'uploading' : ''}" aria-live="polite"><i data-lucide="${uploading ? 'loader-circle' : name ? 'file-check-2' : 'upload-cloud'}"></i><div><strong>${escapeHtml(uploading ? 'Enviando arquivo...' : name || 'Nenhum arquivo')}</strong><span>${escapeHtml(uploading ? 'Aguarde a confirmacao' : mediaHint(block))}</span></div></div><button class="btn btn-outline btn-sm" type="button" data-open-media-picker="${block.id}" ${uploading ? 'disabled' : ''}><i data-lucide="paperclip"></i>${uploading ? 'Enviando' : name ? 'Trocar' : 'Anexar'}</button>${name && !uploading ? `<button class="cs-icon-btn danger" type="button" data-remove-media="${block.id}" title="Remover anexo" aria-label="Remover anexo"><i data-lucide="x"></i></button>` : ''}<input id="cs-file-${block.id}" type="file" hidden data-media-input="${block.id}" data-media-kind="${block.type}" accept="${mediaAccept(block.type)}" ${uploading ? 'disabled' : ''}></div>${caption}${block.type === 'audio' ? `<label class="cs-check-row compact"><input type="checkbox" data-block-field="ptt" data-block-id="${block.id}" ${block.ptt ? 'checked' : ''}><span><strong>Enviar como audio de voz</strong></span></label>` : ''}</article>`;
    }).join('');
    if (!blocks.some(block => block.type === 'text')) {
      const hidden = document.createElement('textarea');
      hidden.id = 'message-textarea';
      hidden.hidden = true;
      list.appendChild(hidden);
    }
    renderVariants();
    syncWorkflow();
    icons();
  }

  function availableVariables() {
    const keys = new Set(['nome', 'numero']);
    for (const recipient of studio.draft?.audience?.recipients || []) Object.keys(recipient.fields || {}).forEach(key => keys.add(key));
    Object.keys(studio.draft?.content?.variableDefaults || {}).forEach(key => keys.add(key));
    return [...keys].slice(0, 20);
  }

  function renderVariables() {
    const bar = document.getElementById('cs-variable-bar');
    if (!bar) return;
    bar.innerHTML = `<span>Variaveis</span>${availableVariables().map(variable => `<button type="button" data-insert-variable="${escapeHtml(variable)}">{{${escapeHtml(variable)}}}</button>`).join('')}`;
  }

  function renderText(text, recipient) {
    const fields = { numero: recipient?.phone || '', telefone: recipient?.phone || '', ...(studio.draft?.content?.variableDefaults || {}), ...(recipient?.fields || {}) };
    return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all, key) => fields[cleanFieldName(key)] || '');
  }

  function previewRecipient() {
    const select = document.getElementById('cs-preview-recipient');
    const recipients = studio.draft?.audience?.recipients || [];
    return recipients.find(item => item.phone === select?.value) || recipients[0] || { phone: '11999990000', fields: { nome: 'Contato' } };
  }

  function renderPreviewRecipients() {
    const select = document.getElementById('cs-preview-recipient');
    if (!select) return;
    const current = select.value;
    const recipients = studio.draft?.audience?.recipients || [];
    select.innerHTML = recipients.length
      ? recipients.slice(0, 100).map(item => `<option value="${item.phone}">${escapeHtml(item.fields?.nome || item.phone)}</option>`).join('')
      : '<option value="">Contato de exemplo</option>';
    if (recipients.some(item => item.phone === current)) select.value = current;
  }

  function renderPreview() {
    const container = document.getElementById('cs-phone-preview');
    if (!container || !studio.draft) return;
    renderPreviewRecipients();
    const recipient = previewRecipient();
    const previewBlocks = (studio.draft.content.blocks || []).filter(block => block.enabled !== false).map(block => ({ ...block }));
    if (studio.draft.content.appendOptOut !== false) {
      const lastText = [...previewBlocks].reverse().find(block => block.type === 'text');
      if (lastText) lastText.text = `${String(lastText.text || '').trim()}\n\n${studio.draft.content.optOutText || ''}`.trim();
      else previewBlocks.push({ id: 'preview-optout', type: 'text', text: studio.draft.content.optOutText || '' });
    }
    const bubbles = previewBlocks.map((block) => {
      if (block.type === 'text') return `<div class="cs-bubble">${escapeHtml(renderText(block.text, recipient)).replace(/\n/g, '<br>')}<small>agora</small></div>`;
      if (block.type === 'image' || block.type === 'video') {
        const media = studio.draft.media?.[block.mediaId];
        const src = media ? `/api/campaign/drafts/${encodeURIComponent(studio.draft.id)}/media/${encodeURIComponent(media.id)}` : '';
        return `<div class="cs-bubble media">${src && block.type === 'image' ? `<img src="${src}" alt="">` : `<div class="cs-media-placeholder"><i data-lucide="${block.type === 'video' ? 'play' : 'image'}"></i><span>${escapeHtml(media?.fileName || block.type)}</span></div>`}<p>${escapeHtml(renderText(block.caption, recipient)).replace(/\n/g, '<br>')}</p><small>agora</small></div>`;
      }
      if (block.type === 'audio') return `<div class="cs-bubble cs-audio-preview"><i data-lucide="play"></i><span></span><b>0:12</b><small>agora</small></div>`;
      if (block.type === 'document') return `<div class="cs-bubble cs-doc-preview"><i data-lucide="file-text"></i><strong>${escapeHtml(mediaName(block) || 'Documento')}</strong><p>${escapeHtml(renderText(block.caption, recipient))}</p><small>agora</small></div>`;
      if (block.type === 'poll') return `<div class="cs-bubble cs-poll-preview"><strong>${escapeHtml(renderText(block.question, recipient))}</strong>${(block.options || []).map(option => `<span>${escapeHtml(renderText(option, recipient))}</span>`).join('')}<small>agora</small></div>`;
      return '';
    });
    container.innerHTML = bubbles.filter(Boolean).join('') || '<div class="cs-phone-empty">A previa aparecera aqui.</div>';
    icons();
  }

  function renderVariants() {
    const container = document.getElementById('cs-variants');
    if (!container || !studio.draft) return;
    const variants = studio.draft.content.variants || [];
    container.innerHTML = variants.length ? `<div class="cs-variants-head"><strong>Variacoes</strong><span>A distribuicao usa o mesmo contato sempre na mesma versao.</span></div>${variants.map((variant, index) => `<article><div><input class="form-input" data-variant-name="${index}" value="${escapeHtml(variant.name || `Variante ${index + 1}`)}"><button class="cs-icon-btn danger" type="button" data-remove-variant="${index}" aria-label="Remover variante"><i data-lucide="trash-2"></i></button></div><textarea class="form-textarea" rows="4" data-variant-message="${index}">${escapeHtml(variant.message || '')}</textarea></article>`).join('')}` : '';
    icons();
  }

  function renderDelivery() {
    if (!studio.draft) return;
    const delivery = studio.draft.delivery;
    document.querySelectorAll('input[name="cs-start-mode"]').forEach(input => { input.checked = input.value === delivery.startMode; });
    document.getElementById('cs-scheduled-at').value = delivery.scheduledAt ? localDateTimeValue(delivery.scheduledAt) : '';
    document.getElementById('cs-scheduled-wrap').classList.toggle('hidden', delivery.startMode !== 'scheduled');
    document.querySelectorAll('[data-weekday]').forEach(input => { input.checked = delivery.allowedWeekdays.includes(Number(input.value)); });
    document.getElementById('use-window').checked = delivery.useWindow;
    document.getElementById('window-start').value = delivery.windowStart;
    document.getElementById('window-end').value = delivery.windowEnd;
    document.querySelectorAll('input[name="interval-mode"]').forEach(input => { input.checked = input.value === delivery.intervalMode; });
    document.getElementById('interval-min').value = delivery.intervalMin;
    document.getElementById('interval-max').value = delivery.intervalMax;
    document.getElementById('interval-fixed-val').value = delivery.intervalFixed;
    document.getElementById('cs-random-interval').classList.toggle('hidden', delivery.intervalMode !== 'random');
    document.getElementById('cs-fixed-interval').classList.toggle('hidden', delivery.intervalMode !== 'fixed');
    document.getElementById('flow-control-enabled').checked = delivery.flowControl.enabled;
    document.getElementById('flow-max-contacts').value = delivery.flowControl.maxContacts;
    document.getElementById('flow-window-minutes').value = delivery.flowControl.windowMinutes;
    document.getElementById('anti-limit').checked = delivery.dailyLimit.enabled;
    document.getElementById('daily-limit').value = delivery.dailyLimit.max;
    document.getElementById('cs-frequency-enabled').checked = delivery.frequencyCap.enabled;
    document.getElementById('cs-frequency-max').value = delivery.frequencyCap.max;
    document.getElementById('cs-frequency-days').value = delivery.frequencyCap.days;
    document.getElementById('anti-typing').checked = delivery.typing;
    document.getElementById('cs-pause-failures').value = delivery.pauseAfterFailures;
    document.getElementById('cs-pause-rate').value = delivery.pauseFailureRate;
    document.getElementById('cs-pause-unconfirmed').value = delivery.pauseUnconfirmedRate;
    renderEstimate();
  }

  function localDateTimeValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60 * 1000));
    return local.toISOString().slice(0, 16);
  }

  function renderEstimate() {
    if (!studio.draft) return;
    const delivery = studio.draft.delivery;
    const contacts = studio.draft.audience.recipients.length;
    const blocks = studio.draft.content.blocks.filter(block => block.enabled !== false).length + (studio.draft.content.appendOptOut && !studio.draft.content.blocks.some(block => block.type === 'text') ? 1 : 0);
    const average = delivery.intervalMode === 'random' ? (Number(delivery.intervalMin) + Number(delivery.intervalMax)) / 2 : Number(delivery.intervalFixed);
    let seconds = Math.max(0, contacts - 1) * average;
    if (delivery.flowControl.enabled && contacts > delivery.flowControl.maxContacts) {
      seconds = Math.max(seconds, Math.floor((contacts - 1) / delivery.flowControl.maxContacts) * delivery.flowControl.windowMinutes * 60);
    }
    document.getElementById('est-contacts').textContent = String(contacts);
    document.getElementById('est-interval').textContent = `${Math.round(average)}s`;
    document.getElementById('est-duration').textContent = seconds < 60 ? `${Math.round(seconds)}s` : seconds < 3600 ? `${Math.ceil(seconds / 60)}min` : `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}min`;
    document.getElementById('est-end').textContent = contacts ? new Date(Date.now() + seconds * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';
    document.getElementById('est-flow').textContent = delivery.flowControl.enabled ? `${delivery.flowControl.maxContacts}/${delivery.flowControl.windowMinutes}min` : 'Livre';
    document.getElementById('cs-est-payloads').textContent = String(contacts * blocks);
  }

  function renderMeta() {
    if (!studio.draft) return;
    document.getElementById('cs-campaign-name').value = studio.draft.name || '';
    document.getElementById('cs-campaign-objective').value = studio.draft.objective || '';
    document.getElementById('cs-campaign-intent').value = studio.draft.intent || 'sales';
    document.getElementById('cs-consent-confirmed').checked = studio.draft.audience.consentConfirmed === true;
    document.getElementById('cs-consent-source').value = studio.draft.audience.consentSource || '';
    document.getElementById('cs-optout-enabled').checked = studio.draft.content.appendOptOut !== false;
    document.getElementById('cs-optout-text').value = studio.draft.content.optOutText || '';
    document.getElementById('cs-split-enabled').checked = studio.draft.content.variantMode === 'split';
    document.getElementById('cs-ai-replies-enabled').checked = studio.draft.content.aiRepliesEnabled !== false;
    document.getElementById('cs-ai-instructions').value = studio.draft.content.aiInstructions || '';
  }

  function renderReviewSummary() {
    const container = document.getElementById('cs-review-summary');
    if (!container || !studio.draft) return;
    const activeBlocks = studio.draft.content.blocks.filter(block => block.enabled !== false);
    const delivery = studio.draft.delivery;
    const when = delivery.startMode === 'scheduled' && delivery.scheduledAt ? new Date(delivery.scheduledAt).toLocaleString('pt-BR') : 'Apos confirmacao';
    container.innerHTML = `<div><i data-lucide="users"></i><span>Publico</span><strong>${studio.draft.audience.recipients.length} contatos</strong></div><div><i data-lucide="layers-3"></i><span>Conteudo</span><strong>${activeBlocks.length} bloco(s)</strong></div><div><i data-lucide="calendar-clock"></i><span>Inicio</span><strong>${escapeHtml(when)}</strong></div><div><i data-lucide="shield-check"></i><span>Consentimento</span><strong>${studio.draft.audience.consentConfirmed ? 'Confirmado' : 'Pendente'}</strong></div><div><i data-lucide="bot"></i><span>Respostas</span><strong>${studio.draft.content.aiRepliesEnabled !== false ? 'IA ativa' : 'Direto ao consultor'}</strong></div><div><i data-lucide="message-square-text"></i><span>Orientacao</span><strong>${studio.draft.content.aiInstructions?.trim() ? 'Personalizada' : 'Padrao Moove'}</strong></div>`;
    icons();
  }

  function renderPreflight(preflight = studio.preflight) {
    const container = document.getElementById('cs-preflight');
    const start = document.getElementById('btn-start');
    if (!container) return;
    if (!preflight) {
      container.innerHTML = '<div class="cs-empty compact"><i data-lucide="shield-check"></i><strong>Preflight pendente</strong><span>Execute a revisao antes do envio.</span></div>';
      if (start) { start.disabled = false; start.title = 'A revisao sera executada antes de iniciar'; }
      icons();
      return;
    }
    const issues = [...(preflight.blockers || []).map(item => ({ ...item, severity: 'error' })), ...(preflight.warnings || []).map(item => ({ ...item, severity: 'warning' }))];
    container.innerHTML = `<div class="cs-preflight-head ${preflight.ok ? 'ok' : 'blocked'}"><i data-lucide="${preflight.ok ? 'circle-check' : 'circle-alert'}"></i><div><strong>${preflight.ok ? 'Pronta para envio' : `${preflight.blockers.length} bloqueio(s)`}</strong><span>${preflight.warnings.length} aviso(s) na revisao</span></div></div>${issues.length ? `<div class="cs-issue-list">${issues.map(item => `<div class="${item.severity}"><i data-lucide="${item.severity === 'error' ? 'circle-x' : 'triangle-alert'}"></i><span>${escapeHtml(item.message)}</span></div>`).join('')}</div>` : ''}`;
    if (start) { start.disabled = !preflight.ok; start.title = preflight.ok ? 'Iniciar campanha' : 'Corrija os bloqueios indicados'; }
    icons();
  }

  function renderHistory() {
    const container = document.getElementById('cs-history-list');
    if (!container) return;
    const activeStatuses = new Set(['scheduled', 'running', 'paused', 'recovering']);
    container.innerHTML = studio.history.length ? studio.history.slice(0, 12).map(item => `<article class="cs-history-item ${item.id === studio.draft?.id ? 'active' : ''}"><button class="cs-history-load" type="button" data-load-draft="${escapeHtml(item.id)}"><span class="cs-history-status ${escapeHtml(item.status)}"></span><div><strong>${escapeHtml(item.name)}</strong><small>${new Date(item.updatedAt).toLocaleString('pt-BR')} | ${item.recipients} contatos</small></div><em>${escapeHtml(STATUS_LABELS[item.status] || item.status)}</em></button><button class="cs-icon-btn danger" type="button" data-delete-draft="${escapeHtml(item.id)}" ${activeStatuses.has(item.status) ? 'disabled' : ''} title="${activeStatuses.has(item.status) ? 'Pare a campanha antes de excluir' : 'Excluir campanha'}" aria-label="Excluir campanha"><i data-lucide="trash-2"></i></button></article>`).join('') : '<div class="cs-empty compact"><i data-lucide="history"></i><strong>Nenhuma campanha anterior</strong></div>';
    icons();
  }

  function renderSuppressions() {
    const container = document.getElementById('cs-suppression-list');
    const count = document.getElementById('cs-suppression-count');
    if (count) count.textContent = `${studio.suppressions.length} contato(s)`;
    if (!container) return;
    container.innerHTML = studio.suppressions.length
      ? studio.suppressions.slice(0, 100).map(item => `<div class="cs-suppression-item"><i data-lucide="shield-off"></i><div><strong class="mono">+55 ${escapeHtml(item.phone)}</strong><span>${escapeHtml(item.reason || 'Pedido do contato')} | ${new Date(item.createdAt).toLocaleDateString('pt-BR')}</span></div><button class="cs-icon-btn" type="button" data-remove-suppression="${escapeHtml(item.phone)}" title="Permitir campanhas novamente" aria-label="Permitir campanhas novamente"><i data-lucide="rotate-ccw"></i></button></div>`).join('')
      : '<div class="cs-suppression-empty"><i data-lucide="shield-check"></i><span>Nenhum contato bloqueado para campanhas.</span></div>';
    icons();
  }

  function renderProgress(progress) {
    if (!progress) return;
    studio.activeCampaignId = progress.campaignId || null;
    if (studio.draft && progress.campaignId === studio.draft.id && progress.status) studio.draft.status = progress.status;
    const stats = progress.stats || {};
    const processed = (stats.confirmed || 0) + (stats.acceptedUnconfirmed || 0) + (stats.failed || 0) + (stats.skipped || 0);
    const percentage = stats.total ? Math.round((processed / stats.total) * 100) : 0;
    ['total', 'accepted', 'acceptedUnconfirmed', 'confirmed', 'failed', 'pending'].forEach((key) => {
      const element = document.getElementById(`stat-${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`);
      if (element) element.textContent = String(stats[key] || 0);
    });
    document.getElementById('progress-pct').textContent = `${percentage}%`;
    document.getElementById('progress-bar').style.width = `${percentage}%`;
    const label = document.getElementById('campaign-status-label');
    if (label) { label.textContent = STATUS_LABELS[progress.status] || progress.status || 'Aguardando'; label.className = `campaign-status-badge status-${progress.status || 'idle'}`; }
    const start = document.getElementById('btn-start');
    const pause = document.getElementById('btn-pause');
    const resume = document.getElementById('btn-resume');
    const stop = document.getElementById('btn-stop');
    [start, pause, resume, stop].forEach(button => button?.classList.add('hidden'));
    if (['idle', 'draft', 'stopped', 'completed', 'cleared'].includes(progress.status)) start?.classList.remove('hidden');
    if (progress.status === 'running' || progress.status === 'scheduled') { pause?.classList.remove('hidden'); stop?.classList.remove('hidden'); }
    if (progress.status === 'paused' || progress.status === 'recovering') { resume?.classList.remove('hidden'); stop?.classList.remove('hidden'); }
    const queue = document.getElementById('queue-list');
    if (queue && Array.isArray(progress.queue)) {
      queue.innerHTML = progress.queue.length ? progress.queue.map((item, index) => `<div class="queue-item" id="qi-${index}"><span class="queue-item-dot dot-${escapeHtml(item.status)}"></span><div><strong>${escapeHtml(item.name || 'Sem nome')}</strong><span class="mono">+55 ${escapeHtml(item.number)}</span></div><em class="queue-item-status ${escapeHtml(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</em></div>`).join('') : '<div class="queue-empty">Nenhuma campanha carregada ainda</div>';
    }
    syncDraftLock();
  }

  function isDraftLocked() {
    return EDIT_LOCKED_STATUSES.has(String(studio.draft?.status || '').toLowerCase());
  }

  function syncDraftLock() {
    const locked = isDraftLocked();
    const wasLocked = document.body.classList.contains('campaign-draft-locked');
    const selectors = [
      '#cs-campaign-name', '#cs-campaign-objective', '#cs-campaign-intent',
      '#cs-audience-paste', '#cs-csv-input', '#cs-consent-confirmed', '#cs-consent-source', '#cs-select-all',
      '#cs-audience-rows input', '#cs-audience-rows button',
      '[data-cs-action="import-paste"]', '[data-cs-action="paste-example"]', '[data-cs-action="remove-selected"]', '[data-cs-action="clear-audience"]',
      '#tab-message .cs-block-rail button', '#tab-message .cs-editor-panel input', '#tab-message .cs-editor-panel textarea', '#tab-message .cs-editor-panel button',
      '#tab-message .cs-ai-panel input', '#tab-message .cs-ai-panel textarea', '#tab-message .cs-ai-panel button', '#tab-message .cs-reply-panel input', '#tab-message .cs-reply-panel textarea',
      '#tab-message [data-cs-ai="review"]', '#tab-schedule input',
      '#tab-campaign [data-cs-action="run-preflight"]', '#tab-campaign [data-cs-action="refresh-review"]', '#tab-campaign [data-cs-action="send-test"]',
      '#tab-campaign #cs-test-phone', '#tab-campaign #cs-test-name',
    ];
    document.querySelectorAll(selectors.join(',')).forEach((control) => {
      if (locked && control.dataset.csDraftLocked !== 'true') {
        control.dataset.csDraftLocked = 'true';
        control.dataset.csWasDisabled = control.disabled ? 'true' : 'false';
        control.disabled = true;
      } else if (!locked && control.dataset.csDraftLocked === 'true') {
        control.disabled = control.dataset.csWasDisabled === 'true';
        delete control.dataset.csDraftLocked;
        delete control.dataset.csWasDisabled;
      }
    });
    document.body.classList.toggle('campaign-draft-locked', locked);
    if (locked) saveState('Pare para editar', 'locked');
    else if (wasLocked) saveState(studio.dirty ? 'Alteracoes pendentes' : 'Salvo', studio.dirty ? 'saving' : 'saved');
  }

  function renderAll() {
    renderMeta();
    renderAudience();
    renderImportReport();
    renderVariables();
    renderBlocks();
    renderPreview();
    renderDelivery();
    renderReviewSummary();
    renderPreflight();
    renderHistory();
    renderSuppressions();
    syncDraftLock();
    syncWorkflow();
    icons();
  }

  function saveState(text, state = '') {
    const elements = document.querySelectorAll('[data-cs-save-state]');
    if (!elements.length) return;
    const icon = state === 'saving' ? 'loader-circle' : state === 'error' ? 'cloud-off' : state === 'locked' ? 'lock-keyhole' : 'cloud-check';
    elements.forEach((element) => {
      element.className = `cs-save-state ${state}`;
      element.innerHTML = `<i data-lucide="${icon}"></i>${escapeHtml(text)}`;
    });
    icons();
  }

  function campaignPatch() {
    return {
      name: studio.draft.name,
      objective: studio.draft.objective,
      intent: studio.draft.intent,
      audience: studio.draft.audience,
      content: studio.draft.content,
      delivery: studio.draft.delivery,
    };
  }

  function markDirty() {
    if (!studio.draft) return;
    studio.dirty = true;
    studio.changeVersion += 1;
    studio.preflight = null;
    renderPreflight(null);
    saveState('Alteracoes pendentes', 'saving');
    clearTimeout(studio.saveTimer);
    studio.saveTimer = setTimeout(() => saveDraft(), 700);
    renderReviewSummary();
    syncWorkflow();
  }

  async function saveDraft(force = false) {
    if (!studio.draft) return null;
    if (isDraftLocked()) {
      studio.dirty = false;
      saveState('Pare para editar', 'locked');
      return studio.draft;
    }
    if (studio.savePromise) {
      await studio.savePromise;
      return studio.dirty ? saveDraft(true) : studio.draft;
    }
    if (!studio.dirty && !force) return studio.draft;
    const draftId = studio.draft.id;
    const changeVersion = studio.changeVersion;
    const patch = campaignPatch();
    studio.saving = true;
    saveState('Salvando...', 'saving');
    studio.savePromise = (async () => {
      try {
        const saved = await api(`/api/campaign/drafts/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
        if (studio.draft?.id === draftId) {
          studio.draft.updatedAt = saved.updatedAt;
          studio.draft.status = saved.status;
          studio.draft.media = studio.draft.media || saved.media || {};
          studio.dirty = studio.changeVersion !== changeVersion;
          saveState(studio.dirty ? 'Alteracoes pendentes' : 'Salvo', studio.dirty ? 'saving' : 'saved');
        }
        return studio.draft;
      } catch (error) {
        saveState('Falha ao salvar', 'error');
        toast(error.message, 'error');
        throw error;
      } finally {
        studio.saving = false;
        studio.savePromise = null;
      }
    })();
    return studio.savePromise;
  }

  async function loadHistory() {
    studio.history = await api('/api/campaign/history?limit=50');
    renderHistory();
  }

  async function loadSuppressions() {
    studio.suppressions = await api('/api/campaign/suppressions');
    renderSuppressions();
  }

  async function loadDraft(draftId) {
    if (studio.draft?.id && studio.draft.id !== draftId && studio.dirty) await saveDraft();
    const draft = await api(`/api/campaign/drafts/${encodeURIComponent(draftId)}`);
    studio.draft = { ...emptyDraft(), ...draft, audience: { ...emptyDraft().audience, ...(draft.audience || {}) }, content: { ...emptyDraft().content, ...(draft.content || {}) }, delivery: { ...emptyDraft().delivery, ...(draft.delivery || {}) } };
    studio.selectedRecipients.clear();
    studio.preflight = draft.audience?.precheck || null;
    localStorage.setItem(STORAGE_KEY, draft.id);
    renderAll();
  }

  async function createDraft() {
    const draft = await api('/api/campaign/drafts', { method: 'POST', body: JSON.stringify(emptyDraft()) });
    await loadDraft(draft.id);
    await loadHistory();
    toast('Novo rascunho criado.', 'success');
  }

  async function deleteDraft(draftId) {
    const item = studio.history.find(campaign => campaign.id === draftId);
    if (!item || !confirm(`Excluir permanentemente a campanha "${item.name}" e seus anexos?`)) return;
    const deletingCurrent = studio.draft?.id === draftId;
    if (deletingCurrent) {
      clearTimeout(studio.saveTimer);
      studio.dirty = false;
    }
    try {
      await api(`/api/campaign/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
      if (deletingCurrent) localStorage.removeItem(STORAGE_KEY);
      await loadHistory();
      if (deletingCurrent) {
        const next = studio.history.find(campaign => ['draft', 'stopped', 'completed'].includes(campaign.status)) || studio.history[0];
        if (next) await loadDraft(next.id); else await createDraft();
      }
      toast('Campanha excluida.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function addSuppression() {
    const phoneInput = document.getElementById('cs-suppression-phone');
    const reasonInput = document.getElementById('cs-suppression-reason');
    const phone = normalizePhone(phoneInput?.value);
    if (!phone) { toast('Informe um WhatsApp valido com DDD.', 'warning'); return; }
    try {
      await api('/api/campaign/suppressions', { method: 'POST', body: JSON.stringify({ phone, reason: reasonInput?.value || 'Bloqueio manual', source: 'painel' }) });
      if (phoneInput) phoneInput.value = '';
      if (reasonInput) reasonInput.value = '';
      await loadSuppressions();
      toast('Contato bloqueado para novas campanhas.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function removeSuppression(phone) {
    if (!confirm(`Permitir que +55 ${phone} volte a receber campanhas autorizadas?`)) return;
    try {
      await api(`/api/campaign/suppressions/${encodeURIComponent(phone)}`, { method: 'DELETE' });
      await loadSuppressions();
      toast('Contato removido da lista de bloqueio.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function runPreflight({ quiet = false } = {}) {
    await saveDraft(true);
    try {
      studio.preflight = await api(`/api/campaign/drafts/${encodeURIComponent(studio.draft.id)}/preflight`, { method: 'POST', body: '{}' });
    } catch (error) {
      if (error.status !== 422 || !error.data) throw error;
      studio.preflight = error.data;
    }
    renderPreflight();
    if (!quiet) toast(studio.preflight.ok ? 'Preflight aprovado.' : 'A revisao encontrou bloqueios.', studio.preflight.ok ? 'success' : 'warning');
    return studio.preflight;
  }

  async function runAI(action) {
    const button = document.querySelector(`[data-cs-ai="${action}"]`);
    button?.setAttribute('disabled', '');
    const textBlock = studio.draft.content.blocks.find(block => block.type === 'text');
    try {
      const result = await api('/api/campaign/ai', {
        method: 'POST',
        body: JSON.stringify({ action, input: { message: textBlock?.text || '', prompt: document.getElementById('cs-ai-prompt')?.value || '', objective: studio.draft.objective, audience: `${studio.draft.audience.recipients.length} contatos`, tone: 'humano, direto e respeitoso' } }),
      });
      if (action === 'review') {
        studio.aiReview = result.review || [];
      } else if (action === 'variants') {
        studio.draft.content.variants = result.variants || [];
        studio.draft.content.variantMode = studio.draft.content.variants.length ? 'split' : 'single';
        document.getElementById('cs-split-enabled').checked = studio.draft.content.variantMode === 'split';
      } else if (result.message) {
        if (textBlock) textBlock.text = result.message;
        else studio.draft.content.blocks.unshift({ id: id('text'), type: 'text', enabled: true, text: result.message });
      }
      const source = document.getElementById('cs-ai-source');
      if (source) source.textContent = result.source === 'ai' ? 'Gerado pela IA' : 'Fallback local';
      const review = document.getElementById('cs-ai-review');
      if (review) {
        review.classList.toggle('hidden', !(studio.aiReview.length || result.warning));
        review.innerHTML = `${result.warning ? `<div class="warning"><i data-lucide="triangle-alert"></i>${escapeHtml(result.warning)}</div>` : ''}${studio.aiReview.map(item => `<div class="${item.severity}"><i data-lucide="${item.severity === 'error' ? 'circle-x' : item.severity === 'warning' ? 'triangle-alert' : 'info'}"></i>${escapeHtml(item.message)}</div>`).join('')}`;
      }
      renderBlocks();
      renderPreview();
      markDirty();
      toast(action === 'review' ? 'Revisao concluida.' : 'Conteudo atualizado.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button?.removeAttribute('disabled');
      icons();
    }
  }

  async function uploadMedia(blockId, kind, file) {
    if (!file) return;
    if (studio.uploadingBlocks.has(blockId)) return;
    const rule = studio.limits?.media?.[kind];
    const extension = `.${String(file.name || '').split('.').pop().toLowerCase()}`;
    if (rule?.extensions?.length && !rule.extensions.includes(extension)) {
      toast('Este formato nao e permitido para o bloco escolhido.', 'warning');
      return;
    }
    if (rule?.maxBytes && file.size > rule.maxBytes) {
      toast(`O arquivo excede o limite de ${Math.round(rule.maxBytes / (1024 * 1024))} MB.`, 'warning');
      return;
    }
    studio.uploadingBlocks.add(blockId);
    renderBlocks();
    try {
      await saveDraft(true);
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      const block = studio.draft.content.blocks.find(item => item.id === blockId);
      if (!block) throw new Error('Este bloco nao existe mais na campanha.');
      const previousMediaId = block?.mediaId;
      const media = await api(`/api/campaign/drafts/${encodeURIComponent(studio.draft.id)}/media`, { method: 'POST', body: form });
      studio.draft.media = { ...(studio.draft.media || {}), [media.id]: media };
      block.mediaId = media.id;
      markDirty();
      await saveDraft(true);
      if (previousMediaId && previousMediaId !== media.id) {
        try {
          await api(`/api/campaign/drafts/${encodeURIComponent(studio.draft.id)}/media/${encodeURIComponent(previousMediaId)}`, { method: 'DELETE' });
          delete studio.draft.media[previousMediaId];
        } catch {
          toast('O novo anexo foi salvo, mas o arquivo anterior nao pode ser limpo.', 'warning');
        }
      }
      toast('Anexo adicionado.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      studio.uploadingBlocks.delete(blockId);
      renderBlocks();
      renderPreview();
    }
  }

  async function removeBlockMedia(blockId, { removeBlock = false } = {}) {
    const block = studio.draft.content.blocks.find(item => item.id === blockId);
    if (!block) return;
    if (block.mediaId) {
      try {
        await api(`/api/campaign/drafts/${encodeURIComponent(studio.draft.id)}/media/${encodeURIComponent(block.mediaId)}`, { method: 'DELETE' });
        delete studio.draft.media?.[block.mediaId];
      } catch (error) {
        toast(error.message, 'error');
        return;
      }
    }
    if (removeBlock) studio.draft.content.blocks = studio.draft.content.blocks.filter(item => item.id !== blockId);
    else block.mediaId = '';
    renderBlocks();
    renderPreview();
    markDirty();
    toast(removeBlock ? 'Bloco removido.' : 'Anexo removido.', 'success');
  }

  async function sendTest() {
    const phone = document.getElementById('cs-test-phone').value;
    const name = document.getElementById('cs-test-name').value;
    const button = document.querySelector('[data-cs-action="send-test"]');
    button.disabled = true;
    try {
      await saveDraft(true);
      const result = await api(`/api/campaign/drafts/${encodeURIComponent(studio.draft.id)}/test`, { method: 'POST', body: JSON.stringify({ phone, name }) });
      toast(result.success ? 'Teste enviado.' : 'Teste aceito com ressalvas.', result.success ? 'success' : 'warning');
    } catch (error) {
      if (error.data?.preflight) { studio.preflight = error.data.preflight; renderPreflight(); }
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function prepareLaunch() {
    try {
      const preflight = await runPreflight({ quiet: true });
      if (!preflight.ok) { toast('Corrija os bloqueios antes de iniciar.', 'warning'); return; }
      document.getElementById('cs-launch-consent').checked = false;
      document.getElementById('cs-launch-copy').textContent = `${preflight.audience.queuedCount} contato(s), ${preflight.messagesPerRecipient} parte(s) por contato e ${preflight.estimatedPayloads} envio(s) previstos.`;
      document.getElementById('cs-launch-dialog').showModal();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function launch() {
    if (!document.getElementById('cs-launch-consent').checked) { toast('Confirme o publico e o conteudo.', 'warning'); return; }
    const button = document.getElementById('cs-launch-confirm');
    button.disabled = true;
    try {
      const result = await api(`/api/campaign/drafts/${encodeURIComponent(studio.draft.id)}/launch`, { method: 'POST', body: '{}' });
      document.getElementById('cs-launch-dialog').close();
      renderProgress(result.progress);
      await loadHistory();
      toast(result.progress.status === 'scheduled' ? 'Campanha agendada.' : 'Campanha iniciada.', 'success');
    } catch (error) {
      if (error.data?.preflight) { studio.preflight = error.data.preflight; renderPreflight(); }
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function control(action) {
    if (action === 'stop' && !confirm('Parar a campanha atual?')) return;
    if (action === 'clear' && !confirm('Remover a campanha da fila ativa? O historico sera mantido.')) return;
    try {
      await api(`/api/campaign/${action}`, { method: 'POST', body: '{}' });
      renderProgress(await api('/api/campaign/progress'));
      await loadHistory();
      toast(action === 'pause' ? 'Campanha pausada.' : action === 'resume' ? 'Campanha retomada.' : action === 'stop' ? 'Campanha interrompida.' : 'Fila limpa.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function addBlock(type) {
    const block = { id: id(type), type, enabled: true };
    if (type === 'text') block.text = '';
    if (['image', 'video', 'document'].includes(type)) { block.mediaId = ''; block.caption = ''; }
    if (type === 'audio') { block.mediaId = ''; block.ptt = false; }
    if (type === 'poll') { block.question = ''; block.options = ['', '']; block.selectableCount = 1; }
    studio.draft.content.blocks.push(block);
    renderBlocks();
    renderPreview();
    markDirty();
  }

  function syncFromInput(target) {
    if (!studio.draft) return;
    if (target.id === 'cs-campaign-name') studio.draft.name = target.value;
    else if (target.id === 'cs-campaign-objective') studio.draft.objective = target.value;
    else if (target.id === 'cs-campaign-intent') studio.draft.intent = target.value;
    else if (target.id === 'cs-consent-confirmed') { studio.draft.audience.consentConfirmed = target.checked; studio.draft.audience.consentAt = target.checked ? new Date().toISOString() : null; }
    else if (target.id === 'cs-consent-source') studio.draft.audience.consentSource = target.value;
    else if (target.id === 'cs-optout-enabled') studio.draft.content.appendOptOut = target.checked;
    else if (target.id === 'cs-optout-text') studio.draft.content.optOutText = target.value;
    else if (target.id === 'cs-split-enabled') studio.draft.content.variantMode = target.checked ? 'split' : 'single';
    else if (target.id === 'cs-ai-replies-enabled') studio.draft.content.aiRepliesEnabled = target.checked;
    else if (target.id === 'cs-ai-instructions') studio.draft.content.aiInstructions = target.value;
    else return false;
    markDirty();
    renderPreview();
    return true;
  }

  function syncDelivery(target) {
    const delivery = studio.draft.delivery;
    if (target.name === 'cs-start-mode') delivery.startMode = target.value;
    else if (target.id === 'cs-scheduled-at') delivery.scheduledAt = target.value ? new Date(target.value).toISOString() : null;
    else if (target.matches('[data-weekday]')) delivery.allowedWeekdays = [...document.querySelectorAll('[data-weekday]:checked')].map(item => Number(item.value));
    else if (target.id === 'use-window') delivery.useWindow = target.checked;
    else if (target.id === 'window-start') delivery.windowStart = target.value;
    else if (target.id === 'window-end') delivery.windowEnd = target.value;
    else if (target.name === 'interval-mode') delivery.intervalMode = target.value;
    else if (target.id === 'interval-min') delivery.intervalMin = Number(target.value);
    else if (target.id === 'interval-max') delivery.intervalMax = Number(target.value);
    else if (target.id === 'interval-fixed-val') delivery.intervalFixed = Number(target.value);
    else if (target.id === 'flow-control-enabled') delivery.flowControl.enabled = target.checked;
    else if (target.id === 'flow-max-contacts') delivery.flowControl.maxContacts = Number(target.value);
    else if (target.id === 'flow-window-minutes') delivery.flowControl.windowMinutes = Number(target.value);
    else if (target.id === 'anti-limit') delivery.dailyLimit.enabled = target.checked;
    else if (target.id === 'daily-limit') delivery.dailyLimit.max = Number(target.value);
    else if (target.id === 'cs-frequency-enabled') delivery.frequencyCap.enabled = target.checked;
    else if (target.id === 'cs-frequency-max') delivery.frequencyCap.max = Number(target.value);
    else if (target.id === 'cs-frequency-days') delivery.frequencyCap.days = Number(target.value);
    else if (target.id === 'anti-typing') delivery.typing = target.checked;
    else if (target.id === 'cs-pause-failures') delivery.pauseAfterFailures = Number(target.value);
    else if (target.id === 'cs-pause-rate') delivery.pauseFailureRate = Number(target.value);
    else if (target.id === 'cs-pause-unconfirmed') delivery.pauseUnconfirmedRate = Number(target.value);
    else return false;
    document.getElementById('cs-scheduled-wrap')?.classList.toggle('hidden', delivery.startMode !== 'scheduled');
    document.getElementById('cs-random-interval')?.classList.toggle('hidden', delivery.intervalMode !== 'random');
    document.getElementById('cs-fixed-interval')?.classList.toggle('hidden', delivery.intervalMode !== 'fixed');
    renderEstimate();
    markDirty();
    return true;
  }

  function bindEvents() {
    document.addEventListener('focusin', (event) => {
      if (event.target.matches('#cs-block-list textarea, #cs-block-list input[type="text"]')) studio.lastFocusedEditor = event.target;
    });

    document.addEventListener('input', (event) => {
      const target = event.target;
      if (target.id === 'cs-audience-filter') { studio.audienceFilter = target.value; renderAudience(); return; }
      if (syncFromInput(target) || syncDelivery(target)) return;
      const blockId = target.dataset.blockId;
      if (blockId && target.dataset.blockField) {
        const block = studio.draft.content.blocks.find(item => item.id === blockId);
        if (block) block[target.dataset.blockField] = target.type === 'checkbox' ? target.checked : target.value;
        markDirty(); renderPreview();
      } else if (blockId && target.dataset.pollOption !== undefined) {
        const block = studio.draft.content.blocks.find(item => item.id === blockId);
        if (block) block.options[Number(target.dataset.pollOption)] = target.value;
        markDirty(); renderPreview();
      } else if (target.dataset.variantMessage !== undefined) {
        studio.draft.content.variants[Number(target.dataset.variantMessage)].message = target.value; markDirty();
      } else if (target.dataset.variantName !== undefined) {
        studio.draft.content.variants[Number(target.dataset.variantName)].name = target.value; markDirty();
      }
    });

    document.addEventListener('change', async (event) => {
      const target = event.target;
      if (target.id === 'cs-csv-input' && target.files?.[0]) {
        importText(await target.files[0].text());
        target.value = '';
      } else if (target.dataset.mediaInput) {
        await uploadMedia(target.dataset.mediaInput, target.dataset.mediaKind, target.files?.[0]);
        target.value = '';
      } else if (target.id === 'cs-preview-recipient') renderPreview();
      else if (target.id === 'cs-select-all') {
        document.querySelectorAll('[data-recipient-select]').forEach((input) => {
          input.checked = target.checked;
          if (target.checked) studio.selectedRecipients.add(input.dataset.recipientSelect); else studio.selectedRecipients.delete(input.dataset.recipientSelect);
        });
      } else if (target.dataset.recipientSelect) {
        if (target.checked) studio.selectedRecipients.add(target.dataset.recipientSelect); else studio.selectedRecipients.delete(target.dataset.recipientSelect);
      } else syncFromInput(target) || syncDelivery(target);
    });

    document.addEventListener('click', async (event) => {
      const button = event.target.closest('button, label');
      if (!button) return;
      if (button.dataset.importView) {
        document.querySelectorAll('[data-import-view]').forEach(item => item.classList.toggle('active', item === button));
        document.querySelectorAll('[data-import-panel]').forEach(item => item.classList.toggle('hidden', item.dataset.importPanel !== button.dataset.importView));
      } else if (button.dataset.openMediaPicker) {
        document.getElementById(`cs-file-${button.dataset.openMediaPicker}`)?.click();
      } else if (button.dataset.addBlock) addBlock(button.dataset.addBlock);
      else if (button.dataset.csAi) runAI(button.dataset.csAi);
      else if (button.dataset.insertVariable) {
        const editor = studio.lastFocusedEditor || document.querySelector('#cs-block-list textarea');
        if (!editor) return;
        const token = `{{${button.dataset.insertVariable}}}`;
        const start = editor.selectionStart ?? editor.value.length;
        editor.setRangeText(token, start, editor.selectionEnd ?? start, 'end');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.focus();
      } else if (button.dataset.removeBlock) {
        const block = studio.draft.content.blocks.find(item => item.id === button.dataset.removeBlock);
        if (block?.mediaId) await removeBlockMedia(block.id, { removeBlock: true });
        else {
          studio.draft.content.blocks = studio.draft.content.blocks.filter(item => item.id !== button.dataset.removeBlock);
          renderBlocks(); renderPreview(); markDirty();
        }
      } else if (button.dataset.removeMedia) {
        await removeBlockMedia(button.dataset.removeMedia);
      } else if (button.dataset.moveBlock) {
        const index = studio.draft.content.blocks.findIndex(item => item.id === button.dataset.blockId);
        const targetIndex = index + (button.dataset.moveBlock === 'up' ? -1 : 1);
        if (index >= 0 && targetIndex >= 0 && targetIndex < studio.draft.content.blocks.length) {
          [studio.draft.content.blocks[index], studio.draft.content.blocks[targetIndex]] = [studio.draft.content.blocks[targetIndex], studio.draft.content.blocks[index]];
          renderBlocks(); renderPreview(); markDirty();
        }
      } else if (button.dataset.addPollOption) {
        const block = studio.draft.content.blocks.find(item => item.id === button.dataset.addPollOption);
        if (block && block.options.length < 12) block.options.push('');
        renderBlocks(); markDirty();
      } else if (button.dataset.removePollOption !== undefined) {
        const block = studio.draft.content.blocks.find(item => item.id === button.dataset.blockId);
        if (block && block.options.length > 2) block.options.splice(Number(button.dataset.removePollOption), 1);
        renderBlocks(); renderPreview(); markDirty();
      } else if (button.dataset.removeVariant !== undefined) {
        studio.draft.content.variants.splice(Number(button.dataset.removeVariant), 1);
        if (!studio.draft.content.variants.length) studio.draft.content.variantMode = 'single';
        renderVariants(); markDirty();
      } else if (button.dataset.removeRecipient) {
        studio.draft.audience.recipients = studio.draft.audience.recipients.filter(item => item.phone !== button.dataset.removeRecipient);
        renderAudience(); renderVariables(); renderPreview(); markDirty();
      } else if (button.dataset.loadDraft) await loadDraft(button.dataset.loadDraft);
      else if (button.dataset.deleteDraft) await deleteDraft(button.dataset.deleteDraft);
      else if (button.dataset.removeSuppression) await removeSuppression(button.dataset.removeSuppression);
      else if (button.dataset.csControl) await control(button.dataset.csControl);
      else if (button.dataset.csAction) await handleAction(button.dataset.csAction);
    });

    document.addEventListener('click', (event) => {
      const nav = event.target.closest('.nav-item[data-tab]');
      if (!nav || !CAMPAIGN_TABS.has(nav.dataset.tab)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      switchCampaignTab(nav.dataset.tab);
    }, true);
  }

  async function handleAction(action) {
    if (action === 'import-paste') { importText(document.getElementById('cs-audience-paste').value); document.getElementById('cs-audience-paste').value = ''; }
    else if (action === 'paste-example') document.getElementById('cs-audience-paste').value = '11999990000,Ana,Campinas\n21988880000,Carlos,Niteroi';
    else if (action === 'remove-selected') {
      studio.draft.audience.recipients = studio.draft.audience.recipients.filter(item => !studio.selectedRecipients.has(item.phone));
      studio.selectedRecipients.clear(); renderAudience(); renderVariables(); renderPreview(); markDirty();
    } else if (action === 'clear-audience') {
      if (!studio.draft.audience.recipients.length || confirm('Remover todos os contatos deste rascunho?')) {
        studio.draft.audience.recipients = []; studio.selectedRecipients.clear(); studio.importReport = null; renderAudience(); renderImportReport(); renderPreview(); markDirty();
      }
    } else if (action === 'new-draft') await createDraft();
    else if (action === 'add-suppression') await addSuppression();
    else if (action === 'open-history') switchCampaignTab('campaign');
    else if (action === 'run-preflight' || action === 'refresh-review') await runPreflight();
    else if (action === 'send-test') await sendTest();
    else if (action === 'prepare-launch') await prepareLaunch();
    else if (action === 'copy-log') {
      const text = document.getElementById('log-console')?.innerText || '';
      await navigator.clipboard.writeText(text); toast('Registro copiado.', 'success');
    }
  }

  function syncWorkflow() {
    const workflow = document.getElementById('campaign-workflow');
    if (!workflow) return;
    workflow.classList.toggle('hidden', !CAMPAIGN_TABS.has(studio.activeTab));
    const complete = {
      contacts: (studio.draft?.audience?.recipients?.length || 0) > 0 && studio.draft?.audience?.consentConfirmed,
      message: (studio.draft?.content?.blocks || []).some(block => block.enabled !== false && (block.text?.trim() || block.mediaId || block.question?.trim())),
      schedule: (studio.draft?.delivery?.allowedWeekdays?.length || 0) > 0,
      campaign: studio.preflight?.ok === true,
    };
    workflow.querySelectorAll('[data-campaign-step]').forEach((button) => {
      const step = button.dataset.campaignStep;
      button.classList.toggle('active', step === studio.activeTab);
      button.classList.toggle('complete', complete[step]);
      button.setAttribute('aria-current', step === studio.activeTab ? 'step' : 'false');
    });
  }

  function switchCampaignTab(tabId) {
    if (!CAMPAIGN_TABS.has(tabId)) return;
    studio.activeTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById(`tab-${tabId}`)?.classList.add('active');
    document.getElementById(`nav-${tabId}`)?.classList.add('active');
    document.getElementById('topbar-section').textContent = { contacts: 'Publico', message: 'Conteudo', schedule: 'Entrega', campaign: 'Revisao e envio' }[tabId];
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'instant' });
    if (tabId === 'campaign') {
      renderReviewSummary();
      if (!isDraftLocked()) void runPreflight({ quiet: true }).catch(error => toast(error.message, 'error'));
      void refreshProgress();
    }
    if (tabId === 'schedule') renderDelivery();
    syncWorkflow(); icons();
    if (window.innerWidth <= 900) window.closeSidebar?.();
  }

  async function refreshProgress() {
    try { renderProgress(await api('/api/campaign/progress')); } catch {}
  }

  async function initialize() {
    installShell();
    studio.activeTab = document.querySelector('.tab-pane.active')?.id?.replace(/^tab-/, '') || 'connection';
    bindEvents();
    document.getElementById('cs-launch-confirm').addEventListener('click', launch);
    try {
      await ensureSession();
      studio.limits = await api('/api/campaign/limits');
      await Promise.all([loadHistory(), loadSuppressions()]);
      const preferred = localStorage.getItem(STORAGE_KEY);
      const candidate = studio.history.find(item => item.id === preferred)
        || studio.history.find(item => ['draft', 'paused', 'recovering', 'stopped'].includes(item.status))
        || studio.history[0];
      if (candidate) await loadDraft(candidate.id);
      else await createDraft();
      await refreshProgress();
    } catch (error) {
      toast(error.message, 'error');
      saveState('Indisponivel', 'error');
    }
  }

  window.addEventListener('beforeunload', (event) => {
    if (!studio.dirty && !studio.saving) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && studio.dirty && !studio.saving) void saveDraft().catch(() => {});
  });

  window.onCampaignStudioStatus = (status) => {
    if (!studio.draft || studio.activeCampaignId !== studio.draft.id) return;
    studio.draft.status = status;
    syncDraftLock();
  };

  const previousSwitchTab = window.switchTab;
  window.switchTab = function campaignStudioSwitch(tabId) {
    if (CAMPAIGN_TABS.has(tabId)) return switchCampaignTab(tabId);
    studio.activeTab = tabId;
    const result = previousSwitchTab?.(tabId);
    syncWorkflow();
    return result;
  };
  window.startCampaign = prepareLaunch;
  window.pauseCampaign = () => control('pause');
  window.resumeCampaign = () => control('resume');
  window.stopCampaign = () => control('stop');
  window.clearQueue = () => control('clear');
  window.campaignStudio = { studio, saveDraft, runPreflight, refreshProgress, switchTab: switchCampaignTab };

  document.addEventListener('DOMContentLoaded', initialize);
})();
