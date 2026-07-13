import { randomUUID } from 'crypto';
import { callAI } from '../ai/gemini.js';
import { resolveEffectiveAIConfig } from '../data/config-manager.js';
import { createMetaCollectorSession, inspectCollectorRuntime } from './meta-collector.js';
import { expandSearchQuery } from './query-expander.js';
import { rankAds, sortRankedAds } from './ranker.js';
import { createAdResearchStore } from './store.js';
import {
  buildCampaignToolkit,
  buildCrossPlatformLinks,
  buildResearchInsights,
  buildUtmUrl,
} from './creative-analyzer.js';
import { auditLandingPage } from './landing-auditor.js';
import {
  clamp,
  csvCell,
  hashText,
  MEDIA_TYPES,
  normalizeText,
  SEARCH_MODES,
  SORT_MODES,
  truncateText,
} from './utils.js';

const FINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled', 'interrupted']);
const RETRYABLE_CODES = new Set(['timeout', 'navigation_failed', 'collector_error']);
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseJsonObject(value = '') {
  const text = String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Resposta da IA sem JSON valido.');
  return JSON.parse(text.slice(start, end + 1));
}

function safeSort(value) {
  const normalized = value === 'popular' ? 'strength' : String(value || 'strength');
  return SORT_MODES.has(normalized) ? normalized : 'strength';
}

function safeMode(value) {
  return SEARCH_MODES.has(value) ? value : 'broad';
}

function safeMediaType(value) {
  return MEDIA_TYPES.has(value) ? value : 'all';
}

function sanitizeSearchInput(input = {}) {
  const query = String(input.query || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!query) throw new Error('Informe o nicho, anunciante ou objetivo da busca.');
  if (query.length < 2) throw new Error('A busca precisa ter pelo menos dois caracteres.');
  const countryCandidate = String(input.country || 'BR').trim().toUpperCase();
  return {
    query,
    region: String(input.region || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    objective: String(input.objective || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    country: /^[A-Z]{2}$/.test(countryCandidate) ? countryCandidate : 'BR',
    mode: safeMode(String(input.mode || 'broad')),
    mediaType: safeMediaType(String(input.mediaType || 'all')),
    sort: safeSort(input.sort),
    minimumRelevance: clamp(Number(input.minimumRelevance ?? 18) || 0, 0, 80),
    maxResults: clamp(Number(input.maxResults ?? 40) || 40, 5, 80),
    cacheBypass: input.cacheBypass === true,
    watchlistId: input.watchlistId ? String(input.watchlistId) : null,
    source: String(input.source || (input.watchlistId ? 'watchlist' : 'manual')),
  };
}

function initialDiagnostics() {
  return {
    collectorReady: null,
    collectorCode: 'not_checked',
    fatalReason: '',
    perTermErrors: [],
    artifacts: [],
    cacheHit: false,
  };
}

function createJob(input) {
  const now = new Date().toISOString();
  return {
    jobId: randomUUID(),
    status: 'queued',
    ...input,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    progress: {
      percent: 0,
      step: 'Na fila',
      message: 'A pesquisa esta aguardando o coletor.',
      queriesTotal: 0,
      queriesCompleted: 0,
      resultsFound: 0,
      queuePosition: null,
    },
    summary: {
      platform: 'Meta Ads',
      usedAI: false,
      provider: 'local',
      searchTerms: [],
      semanticTerms: [],
      intentSummary: '',
      angles: [],
      rawAds: 0,
      dedupedAds: 0,
      filteredAds: 0,
    },
    results: [],
    insights: null,
    warnings: [],
    error: '',
    diagnostics: initialDiagnostics(),
    metrics: {
      durationMs: 0,
      browserLaunches: 0,
      retries: 0,
      cacheHit: false,
      termsSucceeded: 0,
      termsFailed: 0,
    },
    externalLinks: buildCrossPlatformLinks(input.query, input.country),
  };
}

function cacheKey(job) {
  return hashText(JSON.stringify({
    query: normalizeText(job.query),
    region: normalizeText(job.region),
    country: job.country,
    mode: job.mode,
    mediaType: job.mediaType,
    sort: job.sort,
    minimumRelevance: job.minimumRelevance,
    maxResults: job.maxResults,
  }));
}

function wait(ms, signal = null) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener?.('abort', abort);
    const finish = () => {
      cleanup();
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      const error = new Error(signal?.reason?.message || 'Pesquisa cancelada.');
      error.code = 'aborted';
      reject(error);
    };
    timer = setTimeout(finish, ms);
    timer.unref?.();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

async function enrichSummariesInBatch(results, config, query) {
  const effective = resolveEffectiveAIConfig(config);
  if (!effective.hasEffectiveKey || !results.length) return { results, usedAI: false, warning: '' };
  const selected = results.slice(0, 8);
  try {
    const systemPrompt = [
      'Analise anuncios brasileiros para inteligencia competitiva.',
      'Responda apenas JSON valido no formato {"items":[{"id":"","summary":"","angle":""}]}.',
      'Summary deve ter ate 180 caracteres e angle ate 80.',
      'Nao copie frases longas; resuma de forma factual e nao invente desempenho.',
    ].join(' ');
    const userMessage = JSON.stringify({
      query,
      ads: selected.map((result) => ({
        id: result.id,
        advertiser: result.advertiserName,
        text: truncateText(result.adText, 650),
        cta: result.ctaLabel,
      })),
    });
    const response = await callAI(
      effective,
      { systemPrompt, history: [], userMessage },
      { purpose: 'qualification' },
    );
    const parsed = parseJsonObject(response);
    const byId = new Map((Array.isArray(parsed.items) ? parsed.items : []).map((item) => [String(item.id), item]));
    return {
      usedAI: true,
      warning: '',
      results: results.map((result) => {
        const enrichment = byId.get(String(result.id));
        if (!enrichment) return result;
        return {
          ...result,
          copySummary: truncateText(String(enrichment.summary || result.copySummary), 220),
          angleSummary: truncateText(String(enrichment.angle || ''), 100),
        };
      }),
    };
  } catch (error) {
    return {
      results,
      usedAI: false,
      warning: `Os resumos locais foram mantidos porque a IA nao respondeu corretamente: ${error.message}`,
    };
  }
}

function toCsv(job) {
  const columns = [
    'Posicao', 'Anunciante', 'Forca estimada', 'Relevancia', 'Confianca', 'Formato', 'Inicio', 'Dias ativo',
    'Regiao inferida', 'Confianca regional', 'CTA', 'Angulos', 'Ofertas', 'Dominio', 'URL do anuncio', 'Copy',
  ];
  const rows = (job.results || []).map((ad, index) => [
    index + 1,
    ad.advertiserName,
    ad.strengthScore,
    ad.relevanceScore,
    ad.confidence?.label,
    ad.mediaType,
    ad.deliveryStart,
    ad.deliveryAgeDays,
    ad.regionLabel,
    ad.regionConfidence,
    ad.ctaLabel,
    ad.analysis?.angles,
    ad.analysis?.offers,
    ad.landingDomain,
    ad.adUrl,
    ad.adText,
  ]);
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function createAdResearchService({
  loadConfig,
  broadcast = () => {},
  onStatusEvent,
  store = createAdResearchStore(),
  collectorFactory = createMetaCollectorSession,
  schedulerIntervalMs = 10 * 60 * 1000,
} = {}) {
  const jobs = new Map(store.listJobs().map((job) => [job.jobId, job]));
  const queue = [];
  const controllers = new Map();
  const persistenceTimers = new Map();
  let activeJobId = null;
  let statusReporter = typeof onStatusEvent === 'function' ? onStatusEvent : null;
  let schedulerTimer = null;
  let schedulerWarmup = null;

  function sanitizeJob(job) {
    return job ? clone(job) : null;
  }

  function report(event = {}) {
    statusReporter?.({ scope: 'ad-research', ts: new Date().toISOString(), ...event });
  }

  function emit(job) {
    broadcast({ type: 'ad_research_update', job: sanitizeJob(job) });
  }

  function persist(job, immediate = false) {
    if (!job?.jobId) return;
    const currentTimer = persistenceTimers.get(job.jobId);
    if (immediate) {
      if (currentTimer) clearTimeout(currentTimer);
      persistenceTimers.delete(job.jobId);
      store.saveJob(job);
      return;
    }
    if (currentTimer) return;
    const timer = setTimeout(() => {
      persistenceTimers.delete(job.jobId);
      store.saveJob(job);
    }, 350);
    timer.unref?.();
    persistenceTimers.set(job.jobId, timer);
  }

  function updateQueuePositions() {
    queue.forEach((jobId, index) => {
      const job = jobs.get(jobId);
      if (!job || job.status !== 'queued') return;
      job.progress = { ...job.progress, queuePosition: index + 1, message: `Posicao ${index + 1} na fila do coletor.` };
      job.updatedAt = new Date().toISOString();
      persist(job);
      emit(job);
    });
  }

  function updateJob(job, updates = {}, { immediate = false, silent = false } = {}) {
    Object.assign(job, updates, { updatedAt: new Date().toISOString() });
    jobs.set(job.jobId, job);
    persist(job, immediate || FINAL_STATUSES.has(job.status));
    if (!silent) emit(job);
    if (updates.status || updates.error) {
      report({
        type: 'job-update',
        severity: job.status === 'failed' ? 'error' : job.status === 'partial' ? 'warning' : 'info',
        title: 'Pesquisa Ads',
        message: job.error || job.progress?.message || `Busca ${job.status}.`,
        job: sanitizeJob(job),
      });
    }
    return job;
  }

  async function collectTermWithRetry(session, job, searchTerm, signal) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await session.collect({
          searchTerm,
          country: job.country,
          mode: job.mode,
          mediaType: job.mediaType,
          limit: Math.min(26, Math.max(12, Math.ceil(job.maxResults / Math.max(1, job.summary.searchTerms.length)) + 8)),
          signal,
          onProgress: ({ collected, message, round }) => {
            updateJob(job, {
              progress: {
                ...job.progress,
                message: `${message} (${collected} capturados, rodada ${round})`,
              },
            });
          },
        });
      } catch (error) {
        lastError = error;
        if (error?.diagnostic) job.diagnostics.artifacts.push({ searchTerm, ...error.diagnostic });
        if (!RETRYABLE_CODES.has(error?.code) || attempt >= 3 || signal.aborted) throw error;
        job.metrics.retries += 1;
        const delay = 900 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 350);
        updateJob(job, {
          progress: {
            ...job.progress,
            message: `Falha temporaria em "${searchTerm}". Nova tentativa ${attempt + 1}/3 em instantes.`,
          },
        });
        await wait(delay, signal);
      }
    }
    throw lastError;
  }

  function finishFromCache(job, cached) {
    const now = new Date().toISOString();
    job.results = sortRankedAds(cached.results || [], job.sort).slice(0, job.maxResults);
    job.summary = { ...cached.summary, cacheReusedAt: now };
    job.insights = cached.insights || buildResearchInsights(job.results, { query: job.query });
    job.warnings = [...(cached.warnings || []), 'Resultado reaproveitado do cache local para evitar uma nova coleta desnecessaria.'];
    job.diagnostics = { ...(cached.diagnostics || initialDiagnostics()), cacheHit: true };
    job.metrics = { ...job.metrics, cacheHit: true, durationMs: Date.now() - Date.parse(job.startedAt) };
    updateJob(job, {
      status: cached.status === 'partial' ? 'partial' : 'completed',
      completedAt: now,
      progress: {
        percent: 100,
        step: 'Resultado recuperado',
        message: `${job.results.length} anuncios carregados do cache local.`,
        queriesTotal: job.summary.searchTerms?.length || 0,
        queriesCompleted: job.summary.searchTerms?.length || 0,
        resultsFound: job.results.length,
      },
    }, { immediate: true });
    if (job.watchlistId) store.recordSnapshot({ watchlistId: job.watchlistId, job });
  }

  async function runJob(job) {
    const controller = new AbortController();
    controllers.set(job.jobId, controller);
    const { signal } = controller;
    let session = null;
    const startedMs = Date.now();
    const collectedAds = [];
    try {
      updateJob(job, {
        status: 'running',
        startedAt: new Date().toISOString(),
        progress: {
          ...job.progress,
          percent: 4,
          queuePosition: null,
          step: 'Planejando pesquisa',
          message: 'Montando termos objetivos para a Biblioteca da Meta.',
        },
      }, { immediate: true });

      const config = typeof loadConfig === 'function' ? loadConfig() : {};
      const expansion = await expandSearchQuery({
        query: job.query,
        region: job.region,
        mode: job.mode,
        objective: job.objective,
        config,
      });
      if (signal.aborted) throw Object.assign(new Error('Pesquisa cancelada.'), { code: 'aborted' });
      job.warnings.push(...(expansion.warnings || []));
      job.summary = {
        ...job.summary,
        usedAI: expansion.usedAI,
        provider: expansion.provider,
        searchTerms: expansion.searchTerms,
        semanticTerms: expansion.semanticTerms,
        intentSummary: expansion.intentSummary,
        angles: expansion.angles || [],
      };
      updateJob(job, {
        progress: {
          ...job.progress,
          percent: 12,
          step: 'Planejamento pronto',
          message: `${expansion.searchTerms.length} consultas preparadas.`,
          queriesTotal: expansion.searchTerms.length,
          queriesCompleted: 0,
        },
      });

      const key = cacheKey(job);
      const cached = job.cacheBypass ? null : store.getCache(key);
      if (cached) {
        finishFromCache(job, cached);
        return;
      }

      updateJob(job, {
        progress: {
          ...job.progress,
          percent: 16,
          step: 'Validando coletor',
          message: 'Abrindo o Chromium e validando o acesso a Meta.',
        },
      });
      session = await collectorFactory({ signal });
      job.metrics.browserLaunches = 1;
      const preflight = await session.preflight();
      job.diagnostics.collectorReady = !!preflight.collectorReady;
      job.diagnostics.collectorCode = preflight.code || 'ok';
      if (!preflight.collectorReady) throw Object.assign(new Error(preflight.message), { code: preflight.code, diagnostic: preflight.diagnostic });

      updateJob(job, {
        diagnostics: { ...job.diagnostics },
        progress: {
          ...job.progress,
          percent: 20,
          step: 'Coletando anuncios',
          message: 'Navegador pronto. Iniciando consultas sequenciais e controladas.',
        },
      });

      for (const [index, searchTerm] of expansion.searchTerms.entries()) {
        if (signal.aborted) throw Object.assign(new Error('Pesquisa cancelada.'), { code: 'aborted' });
        updateJob(job, {
          progress: {
            ...job.progress,
            percent: Math.min(78, 20 + Math.round((index / expansion.searchTerms.length) * 55)),
            step: 'Coletando anuncios',
            message: `Consultando "${searchTerm}"...`,
            queriesCompleted: index,
            resultsFound: job.results.length,
          },
        });
        try {
          const response = await collectTermWithRetry(session, job, searchTerm, signal);
          collectedAds.push(...(response.ads || []));
          job.metrics.termsSucceeded += 1;
          const rankedNow = rankAds(collectedAds, {
            query: job.query,
            region: job.region,
            searchTerms: expansion.searchTerms,
            semanticTerms: expansion.semanticTerms,
            sort: job.sort,
            minimumRelevance: 0,
          }).slice(0, job.maxResults);
          job.results = rankedNow;
          job.summary.rawAds = collectedAds.length;
          job.summary.dedupedAds = rankedNow.length;
          updateJob(job, {
            progress: {
              ...job.progress,
              percent: Math.min(82, 22 + Math.round(((index + 1) / expansion.searchTerms.length) * 58)),
              queriesCompleted: index + 1,
              resultsFound: rankedNow.length,
              message: `${rankedNow.length} anuncios unicos consolidados ate agora.`,
            },
          });
        } catch (error) {
          if (error?.code === 'aborted' || signal.aborted) throw error;
          const message = error?.message || 'Falha desconhecida no coletor.';
          job.metrics.termsFailed += 1;
          job.warnings.push(`Falha em "${searchTerm}": ${message}`);
          job.diagnostics.perTermErrors.push({
            searchTerm,
            code: error?.code || 'collector_error',
            message,
            diagnostic: error?.diagnostic || null,
          });
          if (error?.diagnostic) job.diagnostics.artifacts.push({ searchTerm, ...error.diagnostic });
          updateJob(job, {
            diagnostics: { ...job.diagnostics },
            progress: {
              ...job.progress,
              queriesCompleted: index + 1,
              message: `A consulta "${searchTerm}" falhou; seguindo com as demais.`,
            },
          });
          if (['browser_missing', 'system_libs_missing', 'blocked', 'auth_wall'].includes(error?.code)) throw error;
        }
      }

      updateJob(job, {
        progress: {
          ...job.progress,
          percent: 86,
          step: 'Qualificando resultados',
          message: 'Removendo repeticoes, validando relevancia e extraindo angulos.',
        },
      });
      let finalResults = rankAds(collectedAds, {
        query: job.query,
        region: job.region,
        searchTerms: expansion.searchTerms,
        semanticTerms: expansion.semanticTerms,
        sort: job.sort,
        minimumRelevance: job.minimumRelevance,
      }).slice(0, job.maxResults);
      job.summary.filteredAds = finalResults.length;
      const enrichment = await enrichSummariesInBatch(finalResults, config, job.query);
      finalResults = sortRankedAds(enrichment.results, job.sort);
      if (enrichment.warning) job.warnings.push(enrichment.warning);
      job.summary.usedAIForSummaries = enrichment.usedAI;
      job.results = finalResults;
      job.insights = buildResearchInsights(finalResults, { query: job.query });

      const failures = job.diagnostics.perTermErrors.length;
      let status = failures ? 'partial' : 'completed';
      let error = '';
      if (!finalResults.length && failures >= expansion.searchTerms.length) {
        status = 'failed';
        error = 'Todas as consultas falharam antes de gerar resultados utilizaveis.';
      }
      if (!finalResults.length && !failures) {
        job.warnings.push('Nenhum anuncio atingiu a relevancia minima. Reduza o filtro ou use busca ampla.');
      }
      const completedAt = new Date().toISOString();
      job.metrics.durationMs = Date.now() - startedMs;
      updateJob(job, {
        status,
        error,
        completedAt,
        results: finalResults,
        insights: job.insights,
        summary: { ...job.summary },
        diagnostics: { ...job.diagnostics },
        metrics: { ...job.metrics },
        progress: {
          ...job.progress,
          percent: 100,
          step: status === 'failed' ? 'Pesquisa falhou' : status === 'partial' ? 'Pesquisa parcial' : 'Pesquisa concluida',
          message: status === 'failed'
            ? error
            : `${finalResults.length} anuncios consolidados com score e confianca explicaveis.`,
          queriesCompleted: expansion.searchTerms.length,
          resultsFound: finalResults.length,
        },
      }, { immediate: true });

      if (status !== 'failed') {
        store.setCache(key, {
          status,
          results: finalResults,
          summary: job.summary,
          insights: job.insights,
          warnings: job.warnings,
          diagnostics: { ...job.diagnostics, artifacts: [] },
        }, CACHE_TTL_MS);
      }
      if (job.watchlistId && status !== 'failed') store.recordSnapshot({ watchlistId: job.watchlistId, job });
    } catch (error) {
      if (error?.code === 'aborted' || signal.aborted) {
        job.metrics.durationMs = Date.now() - startedMs;
        updateJob(job, {
          status: 'cancelled',
          error: '',
          completedAt: new Date().toISOString(),
          metrics: { ...job.metrics },
          progress: {
            ...job.progress,
            step: 'Pesquisa cancelada',
            message: 'A pesquisa foi cancelada e o navegador foi encerrado.',
          },
        }, { immediate: true });
      } else {
        const message = error?.message || 'Erro inesperado na pesquisa.';
        job.metrics.durationMs = Date.now() - startedMs;
        job.diagnostics.fatalReason = message;
        job.diagnostics.collectorCode = error?.code || job.diagnostics.collectorCode || 'collector_error';
        if (['browser_missing', 'system_libs_missing', 'blocked', 'auth_wall'].includes(error?.code)) {
          job.diagnostics.collectorReady = false;
        }
        if (error?.diagnostic) job.diagnostics.artifacts.push({ searchTerm: 'fatal', ...error.diagnostic });
        updateJob(job, {
          status: 'failed',
          error: message,
          completedAt: new Date().toISOString(),
          metrics: { ...job.metrics },
          diagnostics: { ...job.diagnostics },
          progress: {
            ...job.progress,
            step: 'Pesquisa falhou',
            message,
          },
        }, { immediate: true });
      }
    } finally {
      await session?.close().catch(() => {});
      controllers.delete(job.jobId);
      activeJobId = null;
      updateQueuePositions();
      queueMicrotask(pumpQueue);
    }
  }

  function pumpQueue() {
    if (activeJobId || !queue.length) return;
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job || job.status !== 'queued') {
      queueMicrotask(pumpQueue);
      return;
    }
    activeJobId = jobId;
    updateQueuePositions();
    runJob(job).catch((error) => {
      console.error('[AdResearch] Unhandled job error:', error?.stack || error);
      activeJobId = null;
      queueMicrotask(pumpQueue);
    });
  }

  function startSearch(input = {}) {
    const safeInput = sanitizeSearchInput(input);
    if (safeInput.watchlistId) {
      const duplicate = Array.from(jobs.values()).find((job) => (
        job.watchlistId === safeInput.watchlistId && ['queued', 'running', 'cancelling'].includes(job.status)
      ));
      if (duplicate) return sanitizeJob(duplicate);
    }
    const job = createJob(safeInput);
    jobs.set(job.jobId, job);
    queue.push(job.jobId);
    updateJob(job, {}, { immediate: true });
    updateQueuePositions();
    report({
      type: 'job-created',
      severity: 'info',
      title: 'Pesquisa Ads',
      message: `Nova pesquisa criada para ${job.query}.`,
      job: sanitizeJob(job),
    });
    queueMicrotask(pumpQueue);
    return sanitizeJob(job);
  }

  function cancelSearch(jobId) {
    const job = jobs.get(String(jobId || ''));
    if (!job) return null;
    if (FINAL_STATUSES.has(job.status)) return sanitizeJob(job);
    const queueIndex = queue.indexOf(job.jobId);
    if (queueIndex >= 0) {
      queue.splice(queueIndex, 1);
      updateJob(job, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
        progress: { ...job.progress, step: 'Pesquisa cancelada', message: 'A pesquisa foi removida da fila.' },
      }, { immediate: true });
      updateQueuePositions();
    } else {
      updateJob(job, {
        status: 'cancelling',
        progress: { ...job.progress, step: 'Cancelando', message: 'Encerrando o navegador com seguranca.' },
      }, { immediate: true });
      controllers.get(job.jobId)?.abort(new Error('Cancelada pelo usuario.'));
    }
    return sanitizeJob(job);
  }

  function findAd(jobId, adId) {
    const job = jobs.get(String(jobId || '')) || store.getJob(jobId);
    const ad = job?.results?.find((item) => String(item.id || item.libraryId) === String(adId || '')) || null;
    if (ad) return { job, ad };
    const favorite = store.listFavorites().find((item) => item.adId === String(adId || ''));
    return favorite ? { job: null, ad: favorite.ad } : { job: null, ad: null };
  }

  async function auditAdLanding(jobId, adId) {
    const { job, ad } = findAd(jobId, adId);
    if (!ad) throw new Error('Anuncio nao encontrado.');
    if (!ad.landingUrl) throw new Error('Este anuncio nao expos uma pagina de destino publica.');
    const audit = await auditLandingPage(ad.landingUrl);
    if (job) {
      job.results = job.results.map((item) => String(item.id) === String(adId) ? { ...item, landingAudit: audit } : item);
      updateJob(job, { results: job.results }, { immediate: true });
    }
    return audit;
  }

  function compareAds(items = []) {
    const selected = items.slice(0, 6).map((item) => findAd(item.jobId, item.adId).ad).filter(Boolean);
    return {
      ads: selected,
      dimensions: ['strengthScore', 'relevanceScore', 'deliveryAgeDays', 'mediaType', 'ctaLabel', 'regionLabel', 'confidence'],
      generatedAt: new Date().toISOString(),
    };
  }

  function createWatchlist(input = {}) {
    const search = sanitizeSearchInput(input);
    return store.saveWatchlist({
      ...search,
      name: input.name,
      active: input.active,
      intervalHours: input.intervalHours,
      nextRunAt: input.nextRunAt,
    });
  }

  function updateWatchlist(id, input = {}) {
    const existing = store.listWatchlists().find((item) => item.id === String(id || ''));
    if (!existing) return null;
    return store.saveWatchlist({ ...existing, ...input, id: existing.id });
  }

  function runWatchlist(id) {
    const watchlist = store.listWatchlists().find((item) => item.id === String(id || ''));
    if (!watchlist) return null;
    return startSearch({ ...watchlist, watchlistId: watchlist.id, cacheBypass: true, source: 'watchlist' });
  }

  function runDueWatchlists() {
    const now = Date.now();
    const due = store.listWatchlists().filter((item) => (
      item.active && Date.parse(item.nextRunAt || 0) <= now
    ));
    due.slice(0, 2).forEach((watchlist) => runWatchlist(watchlist.id));
    return due.length;
  }

  function startScheduler() {
    if (schedulerTimer) return;
    schedulerTimer = setInterval(runDueWatchlists, Math.max(60_000, schedulerIntervalMs));
    schedulerTimer.unref?.();
    schedulerWarmup = setTimeout(runDueWatchlists, 60_000);
    schedulerWarmup.unref?.();
  }

  function shutdown() {
    if (schedulerTimer) clearInterval(schedulerTimer);
    if (schedulerWarmup) clearTimeout(schedulerWarmup);
    schedulerTimer = null;
    schedulerWarmup = null;
    controllers.forEach((controller) => controller.abort(new Error('Servidor encerrando.')));
    persistenceTimers.forEach((timer) => clearTimeout(timer));
    persistenceTimers.clear();
  }

  function getStats() {
    return {
      activeJobId,
      queuedJobs: queue.length,
      running: !!activeJobId,
      runtime: inspectCollectorRuntime(),
      storage: store.stats(),
    };
  }

  startScheduler();

  return {
    setStatusReporter(reporter) {
      statusReporter = typeof reporter === 'function' ? reporter : null;
    },
    startSearch,
    cancelSearch,
    getJob(jobId) {
      return sanitizeJob(jobs.get(String(jobId || '')) || store.getJob(jobId));
    },
    listRecentJobs(limit = 20) {
      const merged = new Map(store.listJobs(limit * 2).map((job) => [job.jobId, job]));
      jobs.forEach((job) => merged.set(job.jobId, job));
      return Array.from(merged.values())
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, limit)
        .map(sanitizeJob);
    },
    getStats,
    listWatchlists: () => store.listWatchlists(),
    createWatchlist,
    updateWatchlist,
    deleteWatchlist: (id) => store.deleteWatchlist(id),
    runWatchlist,
    listSnapshots: (options) => store.listSnapshots(options),
    listAlerts: (options) => store.listAlerts(options),
    markAlertsRead: (ids) => store.markAlertsRead(ids),
    listFavorites: () => store.listFavorites(),
    saveFavorite(input) {
      const { job, ad } = findAd(input.jobId, input.adId);
      if (!ad && !input.ad) return null;
      return store.saveFavorite({
        ...input,
        query: input.query || job?.query || '',
        ad: input.ad || ad,
      });
    },
    deleteFavorite: (adId) => store.deleteFavorite(adId),
    compareAds,
    getInsights(jobId) {
      const job = jobs.get(String(jobId || '')) || store.getJob(jobId);
      return job ? (job.insights || buildResearchInsights(job.results || [], { query: job.query })) : null;
    },
    getToolkit(jobId, adId, objective = '') {
      const { job, ad } = findAd(jobId, adId);
      if (!ad) return null;
      return buildCampaignToolkit({ ad, query: job?.query || '', objective });
    },
    auditAdLanding,
    exportCsv(jobId) {
      const job = jobs.get(String(jobId || '')) || store.getJob(jobId);
      return job ? toCsv(job) : null;
    },
    buildUtm: (url, values) => buildUtmUrl(url, values),
    saveFeedback: (input) => store.saveFeedback(input),
    listFeedback: (options) => store.listFeedback(options),
    runDueWatchlists,
    shutdown,
  };
}
