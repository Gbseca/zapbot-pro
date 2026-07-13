(function createAdResearchApp() {
  const FINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled', 'interrupted']);
  const RUNNING_STATUSES = new Set(['queued', 'running', 'cancelling']);
  const STORAGE_KEY = 'zapbot_pro_ad_research_job_id';
  let workspacePromise = null;
  let accessPromise = null;

  function researchState() {
    return state.adResearch;
  }

  function element(id) {
    return document.getElementById(id);
  }

  function escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(value) {
    try {
      const parsed = new URL(String(value || ''));
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
    } catch {
      return '';
    }
  }

  function formatDate(value, includeTime = false) {
    if (!value) return 'Nao informado';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Nao informado';
    return new Intl.DateTimeFormat('pt-BR', includeTime
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { dateStyle: 'short' }).format(date);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
  }

  function notify(message, type = 'info') {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function setHtml(id, html) {
    const target = element(id);
    if (target) target.innerHTML = html;
  }

  function setText(id, text) {
    const target = element(id);
    if (target) target.textContent = text;
  }

  async function ensureAccessToken(force = false) {
    const current = researchState();
    const expiresAt = Date.parse(current.accessTokenExpiresAt || 0);
    if (!force && current.accessToken && expiresAt > Date.now() + 60_000) return current.accessToken;
    if (accessPromise) return accessPromise;
    accessPromise = fetch('/api/ad-research/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.token) throw new Error(payload.error || 'Nao foi possivel abrir a sessao da Pesquisa Ads.');
        current.accessToken = payload.token;
        current.accessTokenExpiresAt = payload.expiresAt || '';
        return current.accessToken;
      })
      .finally(() => { accessPromise = null; });
    return accessPromise;
  }

  async function request(path, options = {}, retry = true) {
    const method = String(options.method || 'GET').toUpperCase();
    const protectedRequest = method !== 'GET'
      || (path.startsWith('/api/ad-research/') && path !== '/api/ad-research/session')
      || options.protected === true;
    const headers = { ...(options.headers || {}) };
    if (protectedRequest) headers['X-Ad-Research-Token'] = await ensureAccessToken();
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
      cache: method === 'GET' ? 'no-store' : 'default',
    });
    if (response.status === 403 && protectedRequest && retry) {
      await ensureAccessToken(true);
      return request(path, options, false);
    }
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text();
    if (!response.ok) {
      const error = new Error(payload?.error || payload || `Falha HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function readSearchInputs() {
    const current = researchState();
    return {
      query: element('ad-search-query')?.value.trim() || '',
      objective: element('ad-search-objective')?.value.trim() || '',
      region: element('ad-search-region')?.value.trim() || '',
      country: current.country || 'BR',
      mode: element('ad-search-mode')?.value || 'broad',
      mediaType: element('ad-search-media')?.value || 'all',
      sort: element('ad-search-sort')?.value || 'strength',
      minimumRelevance: Number(element('ad-search-min-relevance')?.value || 18),
      maxResults: Number(element('ad-search-limit')?.value || 40),
    };
  }

  function syncSearchInputs(force = false) {
    const current = researchState();
    const values = {
      'ad-search-query': current.query,
      'ad-search-objective': current.objective,
      'ad-search-region': current.region,
      'ad-search-mode': current.mode || 'broad',
      'ad-search-media': current.mediaType || 'all',
      'ad-search-sort': current.sort || 'strength',
      'ad-search-min-relevance': current.minimumRelevance ?? 18,
      'ad-search-limit': current.maxResults || 40,
    };
    Object.entries(values).forEach(([id, value]) => {
      const input = element(id);
      if (input && (force || document.activeElement !== input)) input.value = value ?? '';
    });
    syncRange();
  }

  function applyJob(job, { silent = false } = {}) {
    if (!job?.jobId) return;
    const current = researchState();
    const previousStatus = current.status;
    Object.assign(current, {
      jobId: job.jobId,
      status: job.status || 'idle',
      query: job.query || '',
      objective: job.objective || '',
      region: job.region || '',
      country: job.country || 'BR',
      mode: job.mode || 'broad',
      mediaType: job.mediaType || 'all',
      sort: job.sort || 'strength',
      minimumRelevance: job.minimumRelevance ?? 18,
      maxResults: job.maxResults || 40,
      progress: job.progress || null,
      summary: job.summary || null,
      insights: job.insights || null,
      externalLinks: job.externalLinks || {},
      metrics: job.metrics || null,
      warnings: Array.isArray(job.warnings) ? job.warnings : [],
      results: Array.isArray(job.results) ? job.results : [],
      error: job.error || '',
      diagnostics: job.diagnostics || {},
    });
    current.selectedAds = current.selectedAds.filter((id) => current.results.some((ad) => String(ad.id) === String(id)));
    localStorage.setItem(STORAGE_KEY, job.jobId);
    syncSearchInputs();
    render();
    if (RUNNING_STATUSES.has(job.status)) startPolling();
    else stopPolling();

    if (!silent && FINAL_STATUSES.has(job.status) && !FINAL_STATUSES.has(previousStatus)) {
      const type = job.status === 'failed' ? 'error' : job.status === 'partial' ? 'warning' : 'success';
      notify(job.status === 'completed'
        ? `Pesquisa concluida com ${formatNumber(job.results?.length)} anuncio(s).`
        : job.error || job.progress?.message || 'Pesquisa finalizada.', type);
      loadWorkspace(true);
    }
  }

  async function pollCurrentJob() {
    const current = researchState();
    if (!current.jobId || !RUNNING_STATUSES.has(current.status)) return stopPolling();
    try {
      applyJob(await request(`/api/ad-research/${encodeURIComponent(current.jobId)}`), { silent: true });
    } catch (error) {
      if (error.status === 404) stopPolling();
    }
  }

  function startPolling() {
    const current = researchState();
    if (current.pollTimer) return;
    current.pollTimer = setInterval(pollCurrentJob, 2000);
  }

  function stopPolling() {
    const current = researchState();
    if (current.pollTimer) clearInterval(current.pollTimer);
    current.pollTimer = null;
  }

  async function startSearch() {
    const input = readSearchInputs();
    if (input.query.length < 2) return notify('Informe o que voce quer pesquisar.', 'warning');
    const current = researchState();
    Object.assign(current, input, {
      status: 'queued',
      error: '',
      warnings: [],
      results: [],
      insights: null,
      selectedAds: [],
      progress: { percent: 0, step: 'Iniciando', message: 'Preparando a pesquisa.' },
    });
    render();
    try {
      const payload = await request('/api/ad-research/search', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      applyJob(payload.job || payload);
      notify('Pesquisa adicionada a fila.', 'success');
    } catch (error) {
      current.status = 'failed';
      current.error = error.message;
      render();
      notify(error.message, 'error');
    }
  }

  async function cancelSearch() {
    const current = researchState();
    if (!current.jobId || !RUNNING_STATUSES.has(current.status)) return;
    try {
      current.status = 'cancelling';
      render();
      applyJob(await request(`/api/ad-research/${encodeURIComponent(current.jobId)}/cancel`, { method: 'POST' }));
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function restore(forceToast = false) {
    let jobId = localStorage.getItem(STORAGE_KEY) || '';
    try {
      if (!jobId) {
        const history = await request('/api/ad-research/history?limit=1');
        jobId = history?.[0]?.jobId || '';
      }
      if (!jobId) {
        if (forceToast) notify('Ainda nao existe uma pesquisa salva.', 'info');
        return;
      }
      const job = await request(`/api/ad-research/${encodeURIComponent(jobId)}`);
      applyJob(job, { silent: true });
      if (forceToast) notify('Ultima pesquisa recuperada.', 'success');
    } catch (error) {
      if (error.status === 404) localStorage.removeItem(STORAGE_KEY);
      if (forceToast) notify(error.message, 'warning');
    }
  }

  async function loadWorkspace(force = false) {
    const current = researchState();
    if (workspacePromise && !force) return workspacePromise;
    workspacePromise = Promise.all([
      request('/api/ad-research/history?limit=30'),
      request('/api/ad-research/watchlists'),
      request('/api/ad-research/alerts?limit=80'),
      request('/api/ad-research/favorites'),
      request('/api/ad-research/snapshots?limit=40'),
      request('/api/ad-research/feedback'),
      request('/api/ad-research/status'),
    ]).then(([history, watchlists, alerts, favorites, snapshots, feedback, health]) => {
      Object.assign(current, {
        history: history || [],
        watchlists: watchlists || [],
        alerts: alerts || [],
        favorites: favorites || [],
        snapshots: snapshots || [],
        feedback: feedback || [],
        health: { ...(current.health || {}), stats: health },
        workspaceLoaded: true,
      });
      render();
      return current;
    }).catch((error) => {
      notify(`Nao foi possivel carregar o historico: ${error.message}`, 'warning');
      return current;
    }).finally(() => {
      workspacePromise = null;
    });
    return workspacePromise;
  }

  async function revalidate() {
    const health = element('ad-research-health');
    if (health) health.innerHTML = '<span class="status-dot"></span><span>Testando coletor</span>';
    try {
      const snapshot = await request('/api/system/status/refresh', {
        method: 'POST',
        body: JSON.stringify({ checks: ['ads'] }),
      });
      researchState().health = { ...(researchState().health || {}), system: snapshot?.adResearch || null };
      if (snapshot) state.systemStatus = snapshot;
      renderHealth();
      const check = snapshot?.adResearch?.lastCollectorCheck;
      notify(check?.message || 'Coletor revalidado.', check?.collectorReady ? 'success' : 'warning');
      return snapshot;
    } catch (error) {
      notify(error.message, 'error');
      renderHealth();
      return null;
    }
  }

  function switchView(view) {
    const current = researchState();
    current.view = ['discover', 'monitor', 'library'].includes(view) ? view : 'discover';
    ['discover', 'monitor', 'library'].forEach((name) => {
      element(`ad-view-${name}`)?.classList.toggle('active', current.view === name);
      element(`ad-research-view-${name}`)?.classList.toggle('active', current.view === name);
    });
    if (current.view !== 'discover') loadWorkspace();
  }

  function renderHealth() {
    const current = researchState();
    const system = current.health?.system || state.systemStatus?.adResearch || null;
    const stats = current.health?.stats || {};
    const runtime = system?.runtime || stats.runtime || {};
    const ready = system?.collectorReady ?? current.diagnostics?.collectorReady ?? (runtime.executablePresent ? null : false);
    const queued = system?.queue?.queuedJobs ?? stats.queuedJobs ?? 0;
    let label = ready === true ? 'Coletor pronto' : ready === false ? 'Coletor indisponivel' : 'Coletor nao validado';
    if (stats.running || system?.queue?.running) label = `Coletando${queued ? `, ${queued} na fila` : ''}`;
    setHtml('ad-research-health', `
      <button class="ad-health-button status-${ready === true ? 'ready' : ready === false ? 'error' : 'idle'}" onclick="revalidateAdsCollector()" title="Revalidar coletor">
        <span class="status-dot"></span><span>${escape(label)}</span>
      </button>`);
  }

  function renderProgress() {
    const current = researchState();
    const progress = current.progress || {};
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    setText('ad-search-progress-text', progress.message || current.error || 'Nenhuma busca iniciada.');
    setText('ad-search-status-badge', current.status || 'idle');
    const badge = element('ad-search-status-badge');
    if (badge) badge.className = `campaign-status-badge status-${escape(current.status || 'idle')}`;
    const fill = element('ad-search-progress-fill');
    if (fill) fill.style.width = `${percent}%`;
    const meta = [];
    if (current.jobId) meta.push(`Busca ${current.jobId.slice(0, 8)}`);
    if (progress.queriesTotal) meta.push(`${progress.queriesCompleted || 0}/${progress.queriesTotal} termos`);
    if (progress.resultsFound !== undefined) meta.push(`${formatNumber(progress.resultsFound)} encontrados`);
    if (current.metrics?.durationMs) meta.push(`${Math.round(current.metrics.durationMs / 1000)}s`);
    if (current.diagnostics?.cacheHit) meta.push('cache recente');
    setText('ad-search-meta', meta.join(' | ') || 'Sem consulta em andamento.');
    const terms = current.summary?.searchTerms || [];
    setHtml('ad-search-expanded-terms', terms.map((term) => `<span class="ad-chip">${escape(term)}</span>`).join(''));

    const diagnostics = [];
    if (current.error) diagnostics.push(`<div class="ad-diagnostic error"><strong>Falha:</strong> ${escape(current.error)}</div>`);
    if (current.diagnostics?.fatalReason) diagnostics.push(`<div class="ad-diagnostic error">${escape(current.diagnostics.fatalReason)}</div>`);
    (current.diagnostics?.perTermErrors || []).slice(0, 5).forEach((item) => {
      diagnostics.push(`<div class="ad-diagnostic warning"><strong>${escape(item.searchTerm || 'Termo')}:</strong> ${escape(item.message || item.error || '')}</div>`);
    });
    setHtml('ad-search-diagnostics', diagnostics.join(''));
    setHtml('ad-search-warning-list', (current.warnings || []).map((warning) => `<div class="ad-diagnostic warning">${escape(warning)}</div>`).join(''));

    const running = RUNNING_STATUSES.has(current.status);
    element('btn-start-ad-search')?.toggleAttribute('disabled', running);
    element('btn-cancel-ad-search')?.classList.toggle('hidden', !running);
  }

  function countList(items, emptyText = 'Sem sinais suficientes') {
    if (!items?.length) return `<span class="ad-empty-inline">${escape(emptyText)}</span>`;
    return items.map((item) => `<span class="ad-count-row"><span>${escape(item.label)}</span><strong>${formatNumber(item.count)}</strong></span>`).join('');
  }

  function renderInsights() {
    const insights = researchState().insights;
    const panel = element('ad-insights-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !insights || !insights.totalAds);
    if (!insights?.totalAds) return;
    setText('ad-insights-summary', `Leitura automatica de ${formatNumber(insights.totalAds)} anuncios publicos. Os scores sao estimativas, nao dados de vendas.`);
    setHtml('ad-insight-metrics', `
      <div class="ad-metric"><strong>${formatNumber(insights.totalAds)}</strong><span>Anuncios</span></div>
      <div class="ad-metric"><strong>${formatNumber(insights.advertisers?.length)}</strong><span>Anunciantes</span></div>
      <div class="ad-metric"><strong>${formatNumber(insights.riskyAds)}</strong><span>Com alertas</span></div>
      <div class="ad-metric"><strong>${formatNumber(insights.opportunityAngles?.length)}</strong><span>Oportunidades</span></div>`);
    setHtml('ad-insight-columns', `
      <section><h3>Angulos recorrentes</h3>${countList(insights.angles)}</section>
      <section><h3>Chamadas para acao</h3>${countList(insights.ctas)}</section>
      <section><h3>Anunciantes recorrentes</h3>${countList(insights.advertisers)}</section>
      <section><h3>Espacos pouco explorados</h3>${(insights.opportunityAngles || []).map((label) => `<span class="ad-chip opportunity">${escape(label)}</span>`).join('') || '<span class="ad-empty-inline">Sem lacunas claras</span>'}</section>`);
  }

  function filteredResults() {
    const current = researchState();
    const term = String(element('ad-result-filter')?.value || '').trim().toLocaleLowerCase('pt-BR');
    const format = element('ad-result-format-filter')?.value || 'all';
    let results = [...(current.results || [])].filter((ad) => {
      if (format !== 'all' && (ad.mediaType || 'unknown') !== format) return false;
      if (!term) return true;
      return `${ad.advertiserName || ''} ${ad.adText || ''} ${(ad.matchedTerms || []).join(' ')}`.toLocaleLowerCase('pt-BR').includes(term);
    });
    const dateValue = (ad, fallback) => {
      const parsed = Date.parse(ad.deliveryStart || '');
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    if (current.sort === 'recent') results.sort((a, b) => dateValue(b, 0) - dateValue(a, 0));
    else if (current.sort === 'oldest') results.sort((a, b) => dateValue(a, Number.MAX_SAFE_INTEGER) - dateValue(b, Number.MAX_SAFE_INTEGER));
    else if (current.sort === 'relevant') results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    else if (current.sort === 'advertiser') results.sort((a, b) => String(a.advertiserName || '').localeCompare(String(b.advertiserName || ''), 'pt-BR'));
    else results.sort((a, b) => (b.strengthScore || 0) - (a.strengthScore || 0));
    return results;
  }

  function resultCard(ad, { favorite = false, favoriteRecord = null } = {}) {
    const current = researchState();
    const id = String(ad.id || ad.libraryId || '');
    const selected = current.selectedAds.includes(id);
    const preview = safeUrl(ad.mediaPreviewUrl);
    const adUrl = safeUrl(ad.adUrl);
    const advertiserUrl = safeUrl(ad.advertiserProfileUrl);
    const compliance = ad.compliance || ad.analysis?.compliance || {};
    const tags = ad.analysis?.angles || [];
    const reasons = ad.strengthReasons || [];
    const scoreParts = ad.scoreBreakdown || {};
    const isSaved = favorite || current.favorites.some((item) => String(item.adId) === id);
    const sourceJobId = favoriteRecord?.jobId || current.jobId || '';
    return `
      <article class="ad-result-card ${selected ? 'selected' : ''}">
        <div class="ad-media-frame ${preview ? '' : 'empty'}">
          ${preview ? `<img src="${escape(preview)}" alt="Criativo publico de ${escape(ad.advertiserName || 'anunciante')}" loading="lazy" referrerpolicy="no-referrer">` : '<span>Midia nao exposta pela biblioteca</span>'}
          <span class="ad-media-format">${escape(ad.mediaType || 'sem midia')}</span>
          ${!favorite ? `<label class="ad-select-control" title="Selecionar para comparar"><input type="checkbox" ${selected ? 'checked' : ''} onchange="toggleAdSelection('${escape(id)}', this.checked)"><span>Comparar</span></label>` : ''}
        </div>
        <div class="ad-result-content">
          <div class="ad-result-topline">
            <div><h3>${escape(ad.advertiserName || 'Anunciante nao identificado')}</h3><span>Inicio ${escape(formatDate(ad.deliveryStart))}${ad.deliveryAgeDays ? ` | ${formatNumber(ad.deliveryAgeDays)} dias` : ''}</span></div>
            <button class="ad-favorite-button ${isSaved ? 'active' : ''}" onclick="${isSaved ? `editAdFavorite('${escape(id)}')` : `saveAdFavorite('${escape(id)}')`}" title="${isSaved ? 'Editar favorito' : 'Favoritar'}">${isSaved ? 'Salvo' : 'Salvar'}</button>
          </div>
          <div class="ad-score-row">
            <span class="ad-score strength"><strong>${formatNumber(ad.strengthScore)}</strong> forca</span>
            <span class="ad-score"><strong>${formatNumber(ad.relevanceScore)}</strong> relevancia</span>
            <span class="ad-score"><strong>${formatNumber(ad.confidence?.score)}</strong> confianca</span>
            <span class="ad-score region">${escape(ad.regionLabel || 'Regiao nao inferida')}</span>
          </div>
          <p class="ad-copy-summary">${escape(ad.copySummary || ad.adText || 'Texto nao exposto.')}</p>
          <div class="ad-card-chips">${tags.slice(0, 4).map((tag) => `<span class="ad-chip">${escape(tag)}</span>`).join('')}${ad.ctaLabel ? `<span class="ad-chip cta">${escape(ad.ctaLabel)}</span>` : ''}</div>
          <details class="ad-score-details">
            <summary>Como a forca foi estimada</summary>
            <p>${escape(ad.strengthExplanation || 'Estimativa baseada em sinais publicos disponiveis.')}</p>
            <div class="ad-score-grid">
              ${['relevance', 'stability', 'creative', 'advertiser', 'commercial', 'region'].filter((key) => scoreParts[key] !== null && scoreParts[key] !== undefined).map((key) => `<span><small>${escape({ relevance: 'Relevancia', stability: 'Estabilidade', creative: 'Criativo', advertiser: 'Recorrencia', commercial: 'Estrutura', region: 'Regiao' }[key])}</small><strong>${formatNumber(scoreParts[key])}</strong></span>`).join('')}
            </div>
            ${reasons.length ? `<p>Sinais: ${escape(reasons.join(', '))}.</p>` : ''}
            ${compliance.safe === false ? `<div class="ad-compliance-warning">Atencao: ${(compliance.risks || []).map((risk) => escape(risk.label || risk)).join(', ')}</div>` : '<div class="ad-compliance-safe">Nenhum alerta textual automatico.</div>'}
          </details>
          ${favoriteRecord ? `<div class="ad-favorite-notes"><strong>Notas</strong><p>${escape(favoriteRecord.notes || 'Sem notas.')}</p><div>${(favoriteRecord.tags || []).map((tag) => `<span class="ad-chip">${escape(tag)}</span>`).join('')}</div></div>` : ''}
          <div class="ad-card-actions">
            ${adUrl ? `<a class="btn btn-outline btn-sm" href="${escape(adUrl)}" target="_blank" rel="noopener noreferrer">Ver anuncio</a>` : ''}
            ${advertiserUrl ? `<a class="btn btn-outline btn-sm" href="${escape(advertiserUrl)}" target="_blank" rel="noopener noreferrer">Anunciante</a>` : ''}
            <button class="btn btn-outline btn-sm" onclick="openAdToolkit('${escape(sourceJobId)}','${escape(id)}')">Plano de teste</button>
            ${ad.landingUrl ? `<button class="btn btn-outline btn-sm" onclick="auditAdLanding('${escape(sourceJobId)}','${escape(id)}')">Analisar destino</button>` : ''}
            <button class="btn btn-outline btn-sm" onclick="copyAdStrategy('${escape(id)}')">Copiar resumo</button>
            <button class="btn btn-outline btn-sm" onclick="openAdFeedback('${escape(sourceJobId)}','${escape(id)}')">Registrar resultado</button>
            ${favorite ? `<button class="btn btn-danger btn-sm" onclick="removeAdFavorite('${escape(id)}')">Remover</button>` : ''}
          </div>
        </div>
      </article>`;
  }

  function renderResults() {
    const current = researchState();
    const results = filteredResults();
    const summary = current.results.length
      ? `${formatNumber(results.length)} de ${formatNumber(current.results.length)} anuncios exibidos. Forca e relevancia sao estimativas explicaveis.`
      : current.status === 'completed' ? 'A coleta terminou sem anuncios compativeis com os filtros.' : 'Inicie uma busca para listar anuncios ativos.';
    setText('ad-search-results-summary', summary);
    setHtml('ad-search-results', results.length
      ? results.map((ad) => resultCard(ad)).join('')
      : `<div class="queue-empty">${escape(current.error || (RUNNING_STATUSES.has(current.status) ? 'Aguardando os primeiros resultados.' : 'Nenhum anuncio carregado.'))}</div>`);
    const compare = element('btn-compare-ads');
    if (compare) {
      compare.disabled = current.selectedAds.length < 2;
      compare.textContent = current.selectedAds.length ? `Comparar (${current.selectedAds.length})` : 'Comparar';
    }
  }

  function renderWatchlists() {
    const current = researchState();
    setHtml('ad-watchlist-list', current.watchlists.length ? current.watchlists.map((watch) => `
      <article class="ad-watch-row">
        <div><h3>${escape(watch.name)}</h3><p>${escape(watch.query)}${watch.region ? ` | ${escape(watch.region)}` : ''}</p><small>Proxima: ${escape(formatDate(watch.nextRunAt, true))} | a cada ${formatNumber(watch.intervalHours)}h</small></div>
        <div class="ad-row-actions">
          <label class="ad-toggle"><input type="checkbox" ${watch.active ? 'checked' : ''} onchange="toggleAdWatchlist('${escape(watch.id)}', this.checked)"><span>${watch.active ? 'Ativo' : 'Pausado'}</span></label>
          <button class="btn btn-outline btn-sm" onclick="runAdWatchlist('${escape(watch.id)}')">Executar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteAdWatchlist('${escape(watch.id)}')">Excluir</button>
        </div>
      </article>`).join('') : '<div class="queue-empty">Nenhum monitoramento salvo.</div>');

    const unread = current.alerts.filter((alert) => !alert.read).length;
    setText('ad-alert-count', unread ? `(${unread})` : '');
    setHtml('ad-alert-list', current.alerts.length ? current.alerts.map((alert) => `
      <article class="ad-alert-row ${alert.read ? '' : 'unread'}">
        <span class="status-dot"></span>
        <div><h3>${escape(alert.title)}</h3><p>${escape(alert.message)}</p><small>${escape(formatDate(alert.createdAt, true))}</small></div>
        ${alert.jobId ? `<button class="btn btn-outline btn-sm" onclick="loadAdResearchJob('${escape(alert.jobId)}')">Abrir</button>` : ''}
      </article>`).join('') : '<div class="queue-empty">Nenhuma mudanca detectada.</div>');

    setHtml('ad-history-list', current.history.length ? current.history.map((job) => `
      <button class="ad-history-row" onclick="loadAdResearchJob('${escape(job.jobId)}')">
        <span><strong>${escape(job.query || 'Pesquisa')}</strong><small>${escape(job.region || 'Brasil')} | ${escape(formatDate(job.updatedAt, true))}</small></span>
        <span class="campaign-status-badge status-${escape(job.status)}">${escape(job.status)}</span>
        <span>${formatNumber(job.results?.length)} anuncios</span>
      </button>`).join('') : '<div class="queue-empty">Nenhuma pesquisa salva.</div>');
  }

  function renderFavorites() {
    const current = researchState();
    setText('ad-favorite-count', current.favorites.length ? `(${current.favorites.length})` : '');
    setHtml('ad-favorite-list', current.favorites.length
      ? current.favorites.map((favorite) => resultCard(favorite.ad || {}, { favorite: true, favoriteRecord: favorite })).join('')
      : '<div class="queue-empty">Nenhum favorito salvo.</div>');
  }

  function render() {
    if (!element('tab-ad-research')) return;
    syncSearchInputs();
    switchView(researchState().view || 'discover');
    renderHealth();
    renderProgress();
    renderInsights();
    renderResults();
    renderWatchlists();
    renderFavorites();
    renderSourceLinks();
  }

  function renderSourceLinks() {
    const links = researchState().externalLinks || {};
    const labels = { meta: 'Abrir na Meta', google: 'Ver no Google', tiktok: 'Explorar no TikTok' };
    setHtml('ad-source-links', Object.entries(labels).map(([key, label]) => {
      const href = safeUrl(links[key]);
      return href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : '';
    }).join(''));
  }

  function syncRange() {
    setText('ad-search-min-relevance-value', element('ad-search-min-relevance')?.value || researchState().minimumRelevance || 18);
  }

  function handleSortChange() {
    researchState().sort = element('ad-search-sort')?.value || 'strength';
    renderResults();
  }

  function toggleSelection(id, checked) {
    const selected = new Set(researchState().selectedAds);
    if (checked) selected.add(String(id));
    else selected.delete(String(id));
    researchState().selectedAds = Array.from(selected).slice(0, 6);
    renderResults();
  }

  function findAd(id) {
    const current = researchState();
    return current.results.find((ad) => String(ad.id) === String(id))
      || current.favorites.find((item) => String(item.adId) === String(id))?.ad
      || null;
  }

  async function compareSelected() {
    const current = researchState();
    if (current.selectedAds.length < 2) return notify('Selecione pelo menos dois anuncios.', 'warning');
    try {
      const comparison = await request('/api/ad-research/compare', {
        method: 'POST',
        body: JSON.stringify({ items: current.selectedAds.map((adId) => ({ jobId: current.jobId, adId })) }),
      });
      openModal('Comparacao', 'Sinais publicos lado a lado', comparisonTable(comparison.ads || []));
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function comparisonTable(ads) {
    return `<div class="ad-comparison-wrap"><table class="ad-comparison-table"><thead><tr><th>Indicador</th>${ads.map((ad) => `<th>${escape(ad.advertiserName)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Forca estimada</td>${ads.map((ad) => `<td>${formatNumber(ad.strengthScore)}</td>`).join('')}</tr>
      <tr><td>Relevancia</td>${ads.map((ad) => `<td>${formatNumber(ad.relevanceScore)}</td>`).join('')}</tr>
      <tr><td>Dias ativo</td>${ads.map((ad) => `<td>${formatNumber(ad.deliveryAgeDays)}</td>`).join('')}</tr>
      <tr><td>Formato</td>${ads.map((ad) => `<td>${escape(ad.mediaType || 'nao informado')}</td>`).join('')}</tr>
      <tr><td>CTA</td>${ads.map((ad) => `<td>${escape(ad.ctaLabel || 'nao identificado')}</td>`).join('')}</tr>
      <tr><td>Regiao</td>${ads.map((ad) => `<td>${escape(ad.regionLabel || 'nao inferida')}</td>`).join('')}</tr>
      <tr><td>Angulos</td>${ads.map((ad) => `<td>${escape((ad.analysis?.angles || []).join(', ') || 'geral')}</td>`).join('')}</tr>
    </tbody></table></div>`;
  }

  async function saveFavorite(id, values = {}) {
    const current = researchState();
    const ad = findAd(id);
    if (!ad) return notify('Anuncio nao encontrado.', 'error');
    try {
      await request('/api/ad-research/favorites', {
        method: 'POST',
        body: JSON.stringify({ jobId: current.jobId, adId: id, ad, notes: values.notes || '', tags: values.tags || [] }),
      });
      await loadWorkspace(true);
      notify('Referencia salva na biblioteca.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function editFavorite(id) {
    const favorite = researchState().favorites.find((item) => String(item.adId) === String(id));
    if (!favorite) return saveFavorite(id);
    openModal('Editar referencia', favorite.ad?.advertiserName || 'Anuncio salvo', `
      <form class="ad-modal-form" onsubmit="submitAdFavorite(event, '${escape(id)}')">
        <label>Notas<textarea id="ad-favorite-notes" class="form-textarea" rows="5" maxlength="1200">${escape(favorite.notes || '')}</textarea></label>
        <label>Etiquetas<input id="ad-favorite-tags" class="form-input" maxlength="240" value="${escape((favorite.tags || []).join(', '))}" placeholder="Ex: video, prova social, RJ"></label>
        <div class="ad-modal-actions"><button class="btn btn-primary" type="submit">Salvar</button></div>
      </form>`);
  }

  async function submitFavorite(event, id) {
    event.preventDefault();
    const favorite = researchState().favorites.find((item) => String(item.adId) === String(id));
    const ad = favorite?.ad || findAd(id);
    try {
      await request('/api/ad-research/favorites', {
        method: 'POST',
        body: JSON.stringify({
          jobId: favorite?.jobId || researchState().jobId,
          adId: id,
          ad,
          notes: element('ad-favorite-notes')?.value || '',
          tags: String(element('ad-favorite-tags')?.value || '').split(',').map((item) => item.trim()).filter(Boolean),
        }),
      });
      closeModal();
      await loadWorkspace(true);
      notify('Referencia atualizada.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function removeFavorite(id) {
    try {
      await request(`/api/ad-research/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadWorkspace(true);
      notify('Referencia removida.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function openToolkit(jobId, adId) {
    try {
      const toolkit = await request(`/api/ad-research/toolkit/${encodeURIComponent(jobId || researchState().jobId)}/${encodeURIComponent(adId)}`, {
        method: 'POST',
        body: JSON.stringify({ objective: researchState().objective || 'gerar conversas no WhatsApp' }),
      });
      const variants = (toolkit.variants || []).map((variant) => `
        <article class="ad-toolkit-variant"><div><h3>${escape(variant.name)}</h3><span class="ad-compliance-${variant.compliance?.safe === false ? 'warning' : 'safe'}">${variant.compliance?.safe === false ? 'Revisar termos' : 'Texto seguro'}</span></div><strong>${escape(variant.headline)}</strong><p>${escape(variant.primaryText)}</p><small>CTA: ${escape(variant.cta)}</small></article>`).join('');
      const matrix = (toolkit.matrix || []).map((row) => `<tr><td>${escape(row.test)}</td><td>${escape(row.variable)}</td><td>${escape(row.control)}</td><td>${escape(row.variation)}</td><td>${escape(row.metric)}</td></tr>`).join('');
      openModal('Plano de teste', toolkit.note || 'Variacoes originais', `
        <div class="ad-toolkit-variants">${variants}</div>
        <h3>Matriz A/B</h3><div class="ad-comparison-wrap"><table class="ad-comparison-table"><thead><tr><th>Teste</th><th>Variavel</th><th>Controle</th><th>Variacao</th><th>Metrica</th></tr></thead><tbody>${matrix}</tbody></table></div>
        <form class="ad-modal-form ad-utm-form" onsubmit="buildAdUtm(event)">
          <h3>Gerador UTM</h3>
          <label>URL de destino<input id="ad-utm-url" class="form-input" type="url" required value="${escape(findAd(adId)?.landingUrl || '')}"></label>
          <div class="content-grid two-col"><label>Campanha<input id="ad-utm-campaign" class="form-input" value="${escape((researchState().query || 'campanha').toLowerCase().replace(/[^a-z0-9]+/g, '_'))}"></label><label>Criativo<input id="ad-utm-content" class="form-input" value="criativo_a"></label></div>
          <button class="btn btn-primary" type="submit">Gerar URL</button><div id="ad-utm-result"></div>
        </form>`);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function buildUtm(event) {
    event.preventDefault();
    try {
      const result = await request('/api/ad-research/utm', {
        method: 'POST',
        body: JSON.stringify({
          url: element('ad-utm-url')?.value,
          utm_source: 'meta',
          utm_medium: 'paid_social',
          utm_campaign: element('ad-utm-campaign')?.value,
          utm_content: element('ad-utm-content')?.value,
        }),
      });
      setHtml('ad-utm-result', `<div class="ad-generated-url"><input class="form-input" readonly value="${escape(result.url)}"><button type="button" class="btn btn-outline" onclick="copyTextValue('${escape(result.url)}')">Copiar</button></div>`);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function auditLanding(jobId, adId) {
    openModal('Analise do destino', 'Verificando pagina publica', '<div class="queue-empty">Analisando seguranca, conversao e rastreamento...</div>');
    try {
      const audit = await request(`/api/ad-research/audit/${encodeURIComponent(jobId || researchState().jobId)}/${encodeURIComponent(adId)}`, { method: 'POST' });
      const tracking = audit.tracking || {};
      setHtml('ad-modal-body', `
        <div class="ad-audit-summary status-${audit.ok ? 'ready' : 'error'}"><strong>${audit.ok ? 'Pagina acessivel' : 'Pagina com falha'}</strong><span>${escape(audit.error || `${audit.status} em ${audit.responseTimeMs} ms`)}</span></div>
        <dl class="ad-audit-grid"><div><dt>Titulo</dt><dd>${escape(audit.title || 'Nao identificado')}</dd></div><div><dt>Dominio</dt><dd>${escape(audit.domain || 'Nao identificado')}</dd></div><div><dt>Formularios</dt><dd>${formatNumber(audit.formCount)}</dd></div><div><dt>Links WhatsApp</dt><dd>${formatNumber(audit.whatsappLinks)}</dd></div><div><dt>HTTPS</dt><dd>${audit.isHttps ? 'Sim' : 'Nao'}</dd></div><div><dt>UTM</dt><dd>${audit.hasUtm ? 'Presente' : 'Ausente'}</dd></div></dl>
        <h3>Rastreamento detectado</h3><div class="ad-card-chips"><span class="ad-chip">Meta Pixel: ${tracking.metaPixel ? 'sim' : 'nao'}</span><span class="ad-chip">Google Tag: ${tracking.googleTag ? 'sim' : 'nao'}</span><span class="ad-chip">Analytics: ${tracking.googleAnalytics ? 'sim' : 'nao'}</span></div>
        ${(audit.warnings || []).length ? `<h3>Alertas</h3>${audit.warnings.map((warning) => `<div class="ad-diagnostic warning">${escape(warning)}</div>`).join('')}` : '<div class="ad-compliance-safe">Nenhum alerta basico detectado.</div>'}`);
    } catch (error) {
      setHtml('ad-modal-body', `<div class="ad-diagnostic error">${escape(error.message)}</div>`);
    }
  }

  function openFeedback(jobId, adId) {
    const existing = researchState().feedback.find((item) => String(item.adId) === String(adId)) || {};
    openModal('Resultado da campanha', findAd(adId)?.advertiserName || 'Referencia', `
      <form class="ad-modal-form" onsubmit="submitAdFeedback(event, '${escape(jobId)}', '${escape(adId)}')">
        <label>Situacao<select id="ad-feedback-outcome" class="form-input"><option value="testing">Em teste</option><option value="winner">Vencedor</option><option value="neutral">Neutro</option><option value="loser">Descartado</option></select></label>
        <div class="content-grid three-col"><label>Leads<input id="ad-feedback-leads" class="form-input" type="number" min="0" value="${formatNumber(existing.leads)}"></label><label>Conversoes<input id="ad-feedback-conversions" class="form-input" type="number" min="0" value="${formatNumber(existing.conversions)}"></label><label>Investimento<input id="ad-feedback-spend" class="form-input" type="number" min="0" step="0.01" value="${Number(existing.spend || 0)}"></label></div>
        <label>Notas<textarea id="ad-feedback-notes" class="form-textarea" rows="4" maxlength="1200">${escape(existing.notes || '')}</textarea></label>
        <button class="btn btn-primary" type="submit">Registrar resultado</button>
      </form>`);
    if (element('ad-feedback-outcome')) element('ad-feedback-outcome').value = existing.outcome || 'testing';
  }

  async function submitFeedback(event, jobId, adId) {
    event.preventDefault();
    try {
      await request('/api/ad-research/feedback', {
        method: 'POST',
        body: JSON.stringify({
          jobId: jobId || researchState().jobId,
          adId,
          campaignKey: 'default',
          outcome: element('ad-feedback-outcome')?.value,
          leads: Number(element('ad-feedback-leads')?.value || 0),
          conversions: Number(element('ad-feedback-conversions')?.value || 0),
          spend: Number(element('ad-feedback-spend')?.value || 0),
          notes: element('ad-feedback-notes')?.value || '',
        }),
      });
      closeModal();
      await loadWorkspace(true);
      notify('Resultado registrado.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function createWatchlist(input) {
    if (!input.query?.trim()) return notify('Informe a pesquisa do monitoramento.', 'warning');
    try {
      await request('/api/ad-research/watchlists', { method: 'POST', body: JSON.stringify(input) });
      await loadWorkspace(true);
      notify('Monitoramento criado.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function saveCurrentWatchlist() {
    const input = readSearchInputs();
    if (!input.query) return notify('Informe uma pesquisa antes de salvar o monitoramento.', 'warning');
    return createWatchlist({ ...input, name: input.region ? `${input.query} - ${input.region}` : input.query, intervalHours: 24, active: true });
  }

  function createWatchlistFromForm() {
    return createWatchlist({
      name: element('ad-watch-name')?.value || element('ad-watch-query')?.value,
      query: element('ad-watch-query')?.value,
      region: element('ad-watch-region')?.value,
      country: 'BR', mode: 'broad', mediaType: 'all', sort: 'strength', minimumRelevance: 18, maxResults: 40,
      intervalHours: Number(element('ad-watch-interval')?.value || 24), active: true,
    });
  }

  async function toggleWatchlist(id, active) {
    try {
      await request(`/api/ad-research/watchlists/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ active }) });
      await loadWorkspace(true);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function runWatchlist(id) {
    try {
      const payload = await request(`/api/ad-research/watchlists/${encodeURIComponent(id)}/run`, { method: 'POST' });
      switchView('discover');
      applyJob(payload.job || payload);
      notify('Monitoramento adicionado a fila.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function deleteWatchlist(id) {
    try {
      await request(`/api/ad-research/watchlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadWorkspace(true);
      notify('Monitoramento excluido.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function markAlertsRead() {
    try {
      await request('/api/ad-research/alerts/read', { method: 'PATCH', body: JSON.stringify({ ids: [] }) });
      await loadWorkspace(true);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function loadJob(jobId) {
    try {
      switchView('discover');
      applyJob(await request(`/api/ad-research/${encodeURIComponent(jobId)}`), { silent: true });
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function exportCsv() {
    const jobId = researchState().jobId;
    if (!jobId) return notify('Conclua uma pesquisa antes de exportar.', 'warning');
    window.location.assign(`/api/ad-research/export/${encodeURIComponent(jobId)}.csv`);
  }

  async function copyStrategy(id) {
    const ad = findAd(id);
    if (!ad) return;
    const text = [
      `Anunciante: ${ad.advertiserName || 'nao identificado'}`,
      `Resumo: ${ad.copySummary || ad.adText || 'nao exposto'}`,
      `Angulos: ${(ad.analysis?.angles || []).join(', ') || 'geral'}`,
      `CTA: ${ad.ctaLabel || 'nao identificado'}`,
      `Forca estimada: ${ad.strengthScore || 0}/100`,
      `Observacao: referencia estrategica; nao copiar o texto do concorrente.`,
    ].join('\n');
    await copyText(text);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      notify('Texto copiado.', 'success');
    } catch {
      const area = document.createElement('textarea');
      area.value = String(text || '');
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      notify('Texto copiado.', 'success');
    }
  }

  function openModal(title, eyebrow, body) {
    setText('ad-modal-title', title);
    setText('ad-modal-eyebrow', eyebrow);
    setHtml('ad-modal-body', body);
    element('ad-research-modal')?.classList.remove('hidden');
  }

  function closeModal(event) {
    if (event && event.target !== element('ad-research-modal')) return;
    element('ad-research-modal')?.classList.add('hidden');
  }

  async function load() {
    window.renderAdResearchShell?.();
    render();
    await Promise.allSettled([ensureAccessToken(), loadWorkspace(), restore()]);
    render();
  }

  function handleUpdate(job) {
    const current = researchState();
    if (!job?.jobId) return;
    if (job.jobId === current.jobId || (!current.jobId && RUNNING_STATUSES.has(job.status))) applyJob(job);
    else if (FINAL_STATUSES.has(job.status)) loadWorkspace(true);
  }

  window.adResearchApp = { load, render, restore, handleUpdate, revalidate, loadWorkspace };
  Object.assign(window, {
    startAdResearch: startSearch,
    cancelAdResearch: cancelSearch,
    restoreAdResearchJob: restore,
    revalidateAdsCollector: revalidate,
    switchAdResearchView: switchView,
    syncAdResearchRange: syncRange,
    handleAdResearchSortChange: handleSortChange,
    renderAdResearchResults: renderResults,
    toggleAdSelection: toggleSelection,
    compareSelectedAds: compareSelected,
    saveAdFavorite: saveFavorite,
    editAdFavorite: editFavorite,
    submitAdFavorite: submitFavorite,
    removeAdFavorite: removeFavorite,
    openAdToolkit: openToolkit,
    buildAdUtm: buildUtm,
    auditAdLanding: auditLanding,
    openAdFeedback: openFeedback,
    submitAdFeedback: submitFeedback,
    saveCurrentAdWatchlist: saveCurrentWatchlist,
    createAdWatchlistFromForm: createWatchlistFromForm,
    toggleAdWatchlist: toggleWatchlist,
    runAdWatchlist: runWatchlist,
    deleteAdWatchlist: deleteWatchlist,
    markAdAlertsRead: markAlertsRead,
    loadAdResearchWorkspace: () => loadWorkspace(true),
    loadAdResearchJob: loadJob,
    exportAdResearchCsv: exportCsv,
    copyAdStrategy: copyStrategy,
    copyTextValue: copyText,
    closeAdResearchModal: closeModal,
  });
})();
