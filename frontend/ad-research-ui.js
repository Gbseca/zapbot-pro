(function registerAdResearchShell() {
  window.renderAdResearchShell = function renderAdResearchShell() {
    const root = document.getElementById('tab-ad-research');
    if (!root) return;
    root.innerHTML = `
      <div class="page-header ad-page-header">
        <div>
          <h1 class="page-title">Inteligencia de Anuncios</h1>
          <p class="page-sub">Pesquisa competitiva, monitoramento e planejamento de criativos.</p>
        </div>
        <div class="ad-health-indicator" id="ad-research-health">
          <span class="status-dot"></span>
          <span>Validando coletor</span>
        </div>
      </div>

      <div class="ad-view-switch" role="tablist" aria-label="Areas da pesquisa de anuncios">
        <button class="ad-view-button active" id="ad-view-discover" onclick="switchAdResearchView('discover')">Descobrir</button>
        <button class="ad-view-button" id="ad-view-monitor" onclick="switchAdResearchView('monitor')">Monitorar <span id="ad-alert-count"></span></button>
        <button class="ad-view-button" id="ad-view-library" onclick="switchAdResearchView('library')">Biblioteca <span id="ad-favorite-count"></span></button>
      </div>

      <div id="ad-research-view-discover" class="ad-research-view active">
        <div class="ad-workspace-band">
          <div class="ad-search-form-main">
            <div class="form-group ad-query-field">
              <label class="form-label" for="ad-search-query">Nicho, produto ou anunciante</label>
              <textarea id="ad-search-query" class="form-textarea" rows="3" maxlength="180" placeholder="Ex: protecao veicular"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label" for="ad-search-objective">Objetivo da campanha</label>
              <input id="ad-search-objective" class="form-input" type="text" maxlength="140" placeholder="Ex: gerar conversas no WhatsApp">
            </div>
          </div>

          <div class="ad-search-controls">
            <div class="form-group">
              <label class="form-label" for="ad-search-region">Regiao de interesse</label>
              <input id="ad-search-region" class="form-input" type="text" maxlength="100" placeholder="Ex: Sao Goncalo, RJ">
            </div>
            <div class="form-group">
              <label class="form-label" for="ad-search-mode">Modo</label>
              <select id="ad-search-mode" class="form-input">
                <option value="broad">Busca ampla</option>
                <option value="exact">Frase exata</option>
                <option value="advertiser">Anunciante</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="ad-search-media">Formato</label>
              <select id="ad-search-media" class="form-input">
                <option value="all">Todos</option>
                <option value="image">Imagem</option>
                <option value="video">Video</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="ad-search-sort">Ordenacao</label>
              <select id="ad-search-sort" class="form-input" onchange="handleAdResearchSortChange()">
                <option value="strength">Forca estimada</option>
                <option value="relevant">Relevancia</option>
                <option value="recent">Mais recentes</option>
                <option value="oldest">Mais antigos ativos</option>
                <option value="advertiser">Anunciante</option>
              </select>
            </div>
            <div class="form-group ad-range-field">
              <label class="form-label" for="ad-search-min-relevance">Relevancia minima <output id="ad-search-min-relevance-value">18</output></label>
              <input id="ad-search-min-relevance" type="range" min="0" max="70" value="18" step="2" oninput="syncAdResearchRange()">
            </div>
            <div class="form-group">
              <label class="form-label" for="ad-search-limit">Limite</label>
              <select id="ad-search-limit" class="form-input">
                <option value="20">20 anuncios</option>
                <option value="40" selected>40 anuncios</option>
                <option value="60">60 anuncios</option>
              </select>
            </div>
          </div>

          <div class="ad-search-actions">
            <button id="btn-start-ad-search" class="btn btn-primary" onclick="startAdResearch()">Pesquisar anuncios</button>
            <button id="btn-cancel-ad-search" class="btn btn-outline hidden" onclick="cancelAdResearch()">Cancelar</button>
            <button class="btn btn-outline" onclick="saveCurrentAdWatchlist()">Salvar monitoramento</button>
            <button class="btn btn-outline" onclick="restoreAdResearchJob(true)">Recuperar ultima</button>
          </div>
          <div class="ad-source-links" id="ad-source-links"></div>
        </div>

        <div class="ad-progress-band" id="ad-search-progress-panel">
          <div class="progress-header">
            <div>
              <div class="card-title">Status da pesquisa</div>
              <div class="hint-text" id="ad-search-progress-text">Nenhuma busca iniciada.</div>
            </div>
            <span class="campaign-status-badge status-idle" id="ad-search-status-badge">idle</span>
          </div>
          <div class="progress-bar-track"><div class="progress-bar-fill" id="ad-search-progress-fill" style="width:0%"></div></div>
          <div class="ad-search-meta" id="ad-search-meta">Sem consulta em andamento.</div>
          <div class="ad-search-chips" id="ad-search-expanded-terms"></div>
          <div class="ad-search-diagnostics" id="ad-search-diagnostics"></div>
          <div class="ad-search-warning-list" id="ad-search-warning-list"></div>
        </div>

        <div class="ad-insights-band hidden" id="ad-insights-panel">
          <div class="ad-section-heading">
            <div><h2>Leitura do mercado</h2><p id="ad-insights-summary">Sem dados consolidados.</p></div>
          </div>
          <div class="ad-insight-metrics" id="ad-insight-metrics"></div>
          <div class="ad-insight-columns" id="ad-insight-columns"></div>
        </div>

        <div class="ad-results-band">
          <div class="ad-section-heading">
            <div><h2>Resultados</h2><p id="ad-search-results-summary">Inicie uma busca para listar anuncios ativos.</p></div>
            <div class="ad-result-toolbar">
              <input id="ad-result-filter" class="form-input" type="search" placeholder="Filtrar resultados" oninput="renderAdResearchResults()">
              <select id="ad-result-format-filter" class="form-input" onchange="renderAdResearchResults()">
                <option value="all">Todos os formatos</option>
                <option value="image">Imagem</option>
                <option value="video">Video</option>
                <option value="unknown">Sem midia</option>
              </select>
              <button id="btn-compare-ads" class="btn btn-outline" onclick="compareSelectedAds()" disabled>Comparar</button>
              <button class="btn btn-outline" onclick="exportAdResearchCsv()">Exportar</button>
            </div>
          </div>
          <div class="ad-search-results" id="ad-search-results"><div class="queue-empty">Nenhum anuncio carregado.</div></div>
        </div>
      </div>

      <div id="ad-research-view-monitor" class="ad-research-view">
        <div class="ad-monitor-layout">
          <div class="ad-monitor-form">
            <div class="ad-section-heading"><h2>Novo monitoramento</h2></div>
            <div class="form-group">
              <label class="form-label" for="ad-watch-name">Nome</label>
              <input id="ad-watch-name" class="form-input" maxlength="80" placeholder="Ex: concorrentes do RJ">
            </div>
            <div class="form-group">
              <label class="form-label" for="ad-watch-query">Pesquisa</label>
              <input id="ad-watch-query" class="form-input" maxlength="180" placeholder="Ex: protecao veicular">
            </div>
            <div class="content-grid two-col">
              <div class="form-group">
                <label class="form-label" for="ad-watch-region">Regiao</label>
                <input id="ad-watch-region" class="form-input" maxlength="100" placeholder="Ex: Rio de Janeiro">
              </div>
              <div class="form-group">
                <label class="form-label" for="ad-watch-interval">Frequencia</label>
                <select id="ad-watch-interval" class="form-input">
                  <option value="6">A cada 6 horas</option>
                  <option value="12">A cada 12 horas</option>
                  <option value="24" selected>Diariamente</option>
                  <option value="168">Semanalmente</option>
                </select>
              </div>
            </div>
            <button class="btn btn-primary" onclick="createAdWatchlistFromForm()">Criar monitoramento</button>
          </div>
          <div class="ad-monitor-content">
            <div class="ad-section-heading">
              <h2>Monitoramentos</h2>
              <button class="btn btn-outline btn-sm" onclick="loadAdResearchWorkspace()">Atualizar</button>
            </div>
            <div id="ad-watchlist-list" class="ad-watchlist-list"><div class="queue-empty">Nenhum monitoramento.</div></div>
          </div>
        </div>
        <div class="ad-monitor-timeline">
          <div class="ad-section-heading">
            <h2>Mudancas detectadas</h2>
            <button class="btn btn-outline btn-sm" onclick="markAdAlertsRead()">Marcar como lidas</button>
          </div>
          <div id="ad-alert-list" class="ad-alert-list"><div class="queue-empty">Nenhuma mudanca detectada.</div></div>
        </div>
        <div class="ad-history-band">
          <div class="ad-section-heading"><h2>Historico de pesquisas</h2></div>
          <div id="ad-history-list" class="ad-history-list"><div class="queue-empty">Nenhuma pesquisa salva.</div></div>
        </div>
      </div>

      <div id="ad-research-view-library" class="ad-research-view">
        <div class="ad-section-heading">
          <div><h2>Biblioteca de referencias</h2><p>Favoritos, notas e retorno das campanhas testadas.</p></div>
        </div>
        <div id="ad-favorite-list" class="ad-search-results"><div class="queue-empty">Nenhum favorito salvo.</div></div>
      </div>

      <div id="ad-research-modal" class="ad-modal-backdrop hidden" onclick="closeAdResearchModal(event)">
        <div class="ad-modal" onclick="event.stopPropagation()">
          <div class="ad-modal-header">
            <div><div class="status-eyebrow" id="ad-modal-eyebrow">Pesquisa Ads</div><h2 id="ad-modal-title">Detalhes</h2></div>
            <button class="modal-close" onclick="closeAdResearchModal()" title="Fechar">&times;</button>
          </div>
          <div id="ad-modal-body" class="ad-modal-body"></div>
        </div>
      </div>
    `;
  };
})();
