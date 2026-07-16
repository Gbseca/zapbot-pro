/* MoOve IA workspace behavior */
(() => {
  const CAMPAIGN_TABS = ['contacts', 'message', 'schedule', 'campaign'];
  const TAB_LABELS = {
    connection: 'Conexao WhatsApp',
    contacts: 'Contatos',
    message: 'Mensagem',
    schedule: 'Agendamento',
    campaign: 'Revisao e envio',
    'ai-agent': 'Agente IA',
    leads: 'Leads',
    internal: 'Consultores e FAQ',
    'ad-research': 'Pesquisa de anuncios',
    status: 'Status do sistema',
  };

  let iconRefreshQueued = false;

  function refreshIcons() {
    if (iconRefreshQueued) return;
    iconRefreshQueued = true;
    requestAnimationFrame(() => {
      iconRefreshQueued = false;
      window.lucide?.createIcons({ attrs: { 'stroke-width': 1.8 } });
    });
  }

  function activeTabId() {
    const active = document.querySelector('.tab-pane.active');
    return active?.id?.replace(/^tab-/, '') || 'connection';
  }

  function contactsReady() {
    return Number(document.getElementById('val-valid')?.textContent || 0) > 0;
  }

  function messageReady() {
    return Boolean(document.getElementById('message-textarea')?.value.trim());
  }

  function scheduleReady() {
    const mode = document.querySelector('input[name="interval-mode"]:checked')?.value || 'fixed';
    if (mode === 'random') {
      const minimum = Number(document.getElementById('interval-min')?.value);
      const maximum = Number(document.getElementById('interval-max')?.value);
      return minimum >= 5 && maximum >= minimum;
    }
    return Number(document.getElementById('interval-fixed-val')?.value) >= 5;
  }

  function campaignFinished() {
    return typeof state !== 'undefined' && state.campaignStatus === 'completed';
  }

  function stepReady(step) {
    if (step === 'contacts') return contactsReady();
    if (step === 'message') return messageReady();
    if (step === 'schedule') return scheduleReady();
    if (step === 'campaign') return campaignFinished();
    return false;
  }

  function syncCampaignWorkflow() {
    const currentTab = activeTabId();
    const workflow = document.getElementById('campaign-workflow');
    if (!workflow) return;

    workflow.classList.toggle('hidden', !CAMPAIGN_TABS.includes(currentTab));
    workflow.querySelectorAll('[data-campaign-step]').forEach((button) => {
      const step = button.dataset.campaignStep;
      button.classList.toggle('active', step === currentTab);
      button.classList.toggle('complete', stepReady(step));
      button.setAttribute('aria-current', step === currentTab ? 'step' : 'false');
    });

    const validCount = Number(document.getElementById('val-valid')?.textContent || 0);
    const contactStatus = document.getElementById('contact-step-status');
    if (contactStatus) {
      contactStatus.textContent = validCount
        ? `${validCount} contato${validCount === 1 ? '' : 's'} pronto${validCount === 1 ? '' : 's'} para envio.`
        : 'A lista e validada automaticamente.';
    }

    const controlsHint = document.getElementById('controls-hint');
    if (controlsHint && currentTab === 'campaign') {
      const missing = [];
      if (!contactsReady()) missing.push('contatos validos');
      if (!messageReady()) missing.push('uma mensagem');
      if (!scheduleReady()) missing.push('um intervalo valido');
      controlsHint.textContent = missing.length
        ? `Antes de iniciar, configure ${missing.join(', ')}.`
        : 'Tudo pronto. Revise os dados e inicie quando desejar.';
    }
  }

  function syncWorkspace(tabId = activeTabId()) {
    const location = document.getElementById('topbar-section');
    if (location) location.textContent = TAB_LABELS[tabId] || tabId;
    document.title = `${TAB_LABELS[tabId] || 'Painel'} | MoOve IA`;
    syncCampaignWorkflow();
    refreshIcons();
  }

  window.showMessageWorkspaceView = function showMessageWorkspaceView(view) {
    const tab = document.getElementById('tab-message');
    const previewMode = view === 'preview';
    tab?.classList.toggle('message-preview-mode', previewMode);
    document.querySelectorAll('[data-message-view]').forEach((button) => {
      const active = button.dataset.messageView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  };

  window.clearCampaignMessage = function clearCampaignMessage() {
    const textarea = document.getElementById('message-textarea');
    if (!textarea) return;
    const hasImage = typeof state !== 'undefined' && Boolean(state.selectedImage);
    const hasOptions = typeof state !== 'undefined' && state.reactionCount > 1;
    if ((textarea.value.trim() || hasImage || hasOptions) && !window.confirm('Limpar a mensagem, a imagem e as opcoes de resposta?')) return;

    textarea.value = '';
    if (typeof clearReactions === 'function') clearReactions();
    if (hasImage && typeof removeImage === 'function') removeImage({ stopPropagation() {} });

    const poll = document.getElementById('poll-mode');
    if (poll) poll.checked = false;
    const pollQuestion = document.getElementById('poll-question');
    if (pollQuestion) pollQuestion.value = '';
    if (typeof state !== 'undefined') state.pollMode = false;
    document.getElementById('poll-question-group')?.classList.add('hidden');

    if (typeof updateMessagePreview === 'function') updateMessagePreview();
    if (typeof updateCharCount === 'function') updateCharCount();
    window.showMessageWorkspaceView('editor');
    syncCampaignWorkflow();
    textarea.focus();
  };

  window.showInternalWorkspaceSection = function showInternalWorkspaceSection(section) {
    document.querySelectorAll('[data-internal-section]').forEach((button) => {
      const active = button.dataset.internalSection === section;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll('[data-internal-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.internalPanel === section);
    });
    refreshIcons();
  };

  function installSwitchTabPatch() {
    const originalSwitchTab = window.switchTab;
    window.switchTab = function redesignedSwitchTab(tabId) {
      const result = originalSwitchTab?.(tabId);
      const workspace = document.querySelector('.main-content');
      if (workspace) workspace.scrollTop = 0;
      syncWorkspace(tabId);
      if (window.innerWidth <= 900 && typeof window.closeSidebar === 'function') window.closeSidebar();
      return result;
    };
  }

  function installStatusPatch() {
    const originalStatusHandler = window.handleStatusUpdate;
    window.handleStatusUpdate = function redesignedStatusHandler(status, details) {
      const result = originalStatusHandler?.(status, details);
      const pill = document.getElementById('topbar-wa-pill');
      const health = document.getElementById('topbar-wa-health');
      const text = document.getElementById('topbar-wa-text');
      if (pill) pill.className = `workspace-connection${status === 'connected' ? ' connected' : ''}`;
      if (text) text.textContent = status === 'connected' ? 'Conectado' : status === 'qr_ready' ? 'Aguardando QR' : 'Desconectado';
      if (health) health.textContent = status === 'connected' ? 'WhatsApp operacional' : status === 'qr_ready' ? 'Leia o QR Code' : 'WhatsApp indisponivel';
      refreshIcons();
      return result;
    };
  }

  function installCampaignStatusPatch() {
    const originalCampaignStatus = window.handleCampaignStatus;
    window.handleCampaignStatus = function redesignedCampaignStatus(status) {
      const result = originalCampaignStatus?.(status);
      const label = document.getElementById('campaign-status-label');
      const labels = {
        idle: 'Aguardando',
        running: 'Enviando',
        paused: 'Pausada',
        stopped: 'Interrompida',
        completed: 'Concluida',
      };
      if (label) label.textContent = labels[status] || labels.idle;
      syncCampaignWorkflow();
      refreshIcons();
      return result;
    };
  }

  function installToast() {
    const iconNames = {
      success: 'circle-check',
      error: 'circle-x',
      warning: 'triangle-alert',
      info: 'info',
    };

    window.showToast = function redesignedToast(message, type = 'info', duration = 4000) {
      const container = document.getElementById('toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

      const icon = document.createElement('span');
      icon.className = 'toast-icon';
      const iconNode = document.createElement('i');
      iconNode.setAttribute('data-lucide', iconNames[type] || iconNames.info);
      iconNode.setAttribute('aria-hidden', 'true');
      icon.appendChild(iconNode);

      const body = document.createElement('div');
      body.className = 'toast-body';
      const text = document.createElement('span');
      text.className = 'toast-msg';
      text.textContent = String(message || '');
      body.appendChild(text);

      const progress = document.createElement('div');
      progress.className = 'toast-progress';
      progress.style.animationDuration = `${duration}ms`;

      toast.append(icon, body, progress);
      container.appendChild(toast);
      refreshIcons();

      window.setTimeout(() => {
        toast.classList.add('removing');
        window.setTimeout(() => toast.remove(), 300);
      }, duration);
    };
  }

  function installLiveSync() {
    const selectors = [
      '#contacts-textarea',
      '#message-textarea',
      '#interval-fixed-val',
      '#interval-min',
      '#interval-max',
    ];
    document.querySelectorAll(selectors.join(',')).forEach((control) => {
      control.addEventListener('input', syncCampaignWorkflow);
      control.addEventListener('change', syncCampaignWorkflow);
    });

    document.querySelectorAll('input[name="interval-mode"]').forEach((control) => {
      control.addEventListener('change', syncCampaignWorkflow);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      document.getElementById('emoji-picker')?.classList.add('hidden');
      if (typeof window.closeSidebar === 'function') window.closeSidebar();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && typeof window.closeSidebar === 'function') window.closeSidebar();
    });

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node.nodeType === 1 && (node.matches?.('[data-lucide]') || node.querySelector?.('[data-lucide]'))))) {
        refreshIcons();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    installSwitchTabPatch();
    installStatusPatch();
    installCampaignStatusPatch();
    installToast();
    installLiveSync();
    syncWorkspace();
    window.showMessageWorkspaceView('editor');

    if (typeof state !== 'undefined') {
      window.handleStatusUpdate?.(state.waStatus, state.waDetails);
      window.handleCampaignStatus?.(state.campaignStatus);
    }
  });
})();
