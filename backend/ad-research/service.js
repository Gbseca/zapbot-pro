import { randomUUID } from 'crypto';
import { callAI } from '../ai/gemini.js';
import { collectMetaAds, preflightMetaCollector } from './meta-collector.js';
import { expandSearchQuery } from './query-expander.js';
import { rankAds, sortRankedAds } from './ranker.js';
import { SORT_MODES } from './utils.js';

function createDiagnostics() {
  return {
    collectorReady: null,
    fatalReason: '',
    perTermErrors: [],
  };
}

function sanitizeJob(job) {
  if (!job) return null;

  return {
    jobId: job.jobId,
    status: job.status,
    query: job.query,
    region: job.region,
    sort: job.sort,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    summary: job.summary,
    results: job.results,
    warnings: job.warnings,
    error: job.error,
    diagnostics: job.diagnostics,
  };
}

function makeTermWarning(searchTerm, message) {
  return `Falha ao consultar "${searchTerm}": ${message}`;
}

function summarizeCompletion(job, finalResults) {
  if (job.status === 'partial') {
    if (finalResults.length) {
      return `${finalResults.length} anuncios consolidados, mas algumas consultas falharam.`;
    }
    return 'Busca concluida com falhas parciais e sem anuncios consolidados.';
  }

  if (job.status === 'failed') {
    return job.error || job.diagnostics?.fatalReason || 'A busca falhou antes de gerar resultados utilizaveis.';
  }

  if (finalResults.length === 0) {
    return `Nenhum anuncio publico foi consolidado para ${job.query}.`;
  }

  return `${finalResults.length} anuncios consolidados para ${job.query}.`;
}

async function enrichSummariesWithAI(results, config) {
  const provider = config.aiProvider || 'groq';
  const hasKey = provider === 'gemini' ? !!config.geminiKey : !!config.groqKey;
  if (!hasKey || results.length === 0) return results;

  const topResults = results.slice(0, 6);

  const enriched = await Promise.all(topResults.map(async (result) => {
    try {
      const systemPrompt = [
        'Voce resume anuncios brasileiros de forma curta e pragmatica.',
        'Responda JSON puro com os campos copySummary e angle.',
        'copySummary deve ter no maximo 160 caracteres.',
        'angle deve explicar o angulo comercial em no maximo 120 caracteres.',
      ].join(' ');

      const userMessage = [
        `Anunciante: ${result.advertiserName}`,
        `Copy: ${result.adText}`,
        result.landingDomain ? `Dominio: ${result.landingDomain}` : '',
      ].filter(Boolean).join('\n');

      const response = await callAI(
        config,
        { systemPrompt, history: [], userMessage },
        { purpose: 'qualification' },
      );

      const parsed = JSON.parse(response || '{}');
      return {
        ...result,
        copySummary: String(parsed.copySummary || result.copySummary || '').trim() || result.copySummary,
        angleSummary: String(parsed.angle || '').trim(),
      };
    } catch {
      return result;
    }
  }));

  return results.map((result, index) => enriched[index] || result);
}

export function createAdResearchService({ loadConfig, broadcast }) {
  const jobs = new Map();

  function emit(job) {
    broadcast({ type: 'ad_research_update', job: sanitizeJob(job) });
  }

  function trimJobs() {
    const entries = Array.from(jobs.values()).sort((left, right) => (
      Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt)
    ));

    entries.slice(12).forEach((job) => jobs.delete(job.jobId));
  }

  function updateJob(job, updates = {}) {
    Object.assign(job, updates, { updatedAt: new Date().toISOString() });
    emit(job);
  }

  async function failJob(job, message, diagnostics = {}) {
    job.diagnostics = {
      ...createDiagnostics(),
      ...job.diagnostics,
      ...diagnostics,
      fatalReason: diagnostics.fatalReason || message,
    };

    updateJob(job, {
      status: 'failed',
      error: message,
      progress: {
        ...job.progress,
        percent: Math.max(job.progress?.percent || 0, 12),
        step: 'Erro na busca',
        message,
      },
    });
  }

  async function runJob(job) {
    try {
      updateJob(job, {
        status: 'running',
        progress: {
          percent: 5,
          step: 'Entendendo o nicho',
          message: 'Expandindo a busca para nao depender de palavra exata.',
          queriesTotal: 0,
          queriesCompleted: 0,
          resultsFound: 0,
        },
      });

      const config = loadConfig();
      const expansion = await expandSearchQuery({ query: job.query, region: job.region, config });
      job.warnings.push(...(expansion.warnings || []));
      job.summary = {
        platform: 'Meta Ads',
        usedAI: expansion.usedAI,
        provider: expansion.provider,
        searchTerms: expansion.searchTerms,
        semanticTerms: expansion.semanticTerms,
        intentSummary: expansion.intentSummary,
        angles: expansion.angles || [],
        rawAds: 0,
        dedupedAds: 0,
      };

      updateJob(job, {
        progress: {
          percent: 14,
          step: 'Planejamento pronto',
          message: `Buscando em ${expansion.searchTerms.length} consultas inteligentes.`,
          queriesTotal: expansion.searchTerms.length,
          queriesCompleted: 0,
          resultsFound: 0,
        },
      });

      updateJob(job, {
        progress: {
          ...job.progress,
          percent: 18,
          step: 'Validando coletor',
          message: 'Testando o Chromium antes de abrir a Meta Ad Library.',
        },
      });

      const preflight = await preflightMetaCollector();
      job.diagnostics.collectorReady = preflight.collectorReady;

      if (!preflight.collectorReady) {
        console.error('[AdResearch] Collector preflight failed:', preflight.originalMessage || preflight.message);
        await failJob(job, preflight.message, {
          collectorReady: false,
          fatalReason: preflight.message,
        });
        return;
      }

      updateJob(job, {
        diagnostics: {
          ...job.diagnostics,
          collectorReady: true,
        },
        progress: {
          ...job.progress,
          percent: 22,
          step: 'Varrendo a Meta Ad Library',
          message: 'Coletor pronto. Iniciando as consultas na Meta.',
        },
      });

      const collectedAds = [];

      for (const [index, searchTerm] of expansion.searchTerms.entries()) {
        updateJob(job, {
          progress: {
            ...job.progress,
            percent: Math.min(82, 22 + Math.round((index / expansion.searchTerms.length) * 54)),
            step: 'Varrendo a Meta Ad Library',
            message: `Consultando "${searchTerm}"...`,
            queriesTotal: expansion.searchTerms.length,
            queriesCompleted: index,
            resultsFound: job.results.length,
          },
        });

        try {
          const response = await collectMetaAds({
            searchTerm,
            limit: 14,
            onProgress: ({ collected, message }) => {
              updateJob(job, {
                progress: {
                  ...job.progress,
                  message: `${message} (${collected} capturados nesta consulta)`,
                },
              });
            },
          });

          collectedAds.push(...response.ads);

          const rankedNow = rankAds(collectedAds, {
            query: job.query,
            region: job.region,
            searchTerms: expansion.searchTerms,
            semanticTerms: expansion.semanticTerms,
            sort: job.sort,
          });

          job.summary.rawAds = collectedAds.length;
          job.summary.dedupedAds = rankedNow.length;
          job.results = rankedNow;

          updateJob(job, {
            progress: {
              ...job.progress,
              queriesCompleted: index + 1,
              resultsFound: rankedNow.length,
              percent: Math.min(86, 24 + Math.round(((index + 1) / expansion.searchTerms.length) * 58)),
            },
          });
        } catch (error) {
          const message = error?.message || 'Falha desconhecida no coletor.';
          console.error(`[AdResearch] Term failed for "${searchTerm}":`, error?.cause?.message || message);
          job.warnings.push(makeTermWarning(searchTerm, message));
          job.diagnostics.perTermErrors.push({
            searchTerm,
            code: error?.code || 'collector_error',
            message,
          });

          updateJob(job, {
            diagnostics: { ...job.diagnostics },
            progress: {
              ...job.progress,
              queriesCompleted: index + 1,
              message: `Falha em "${searchTerm}", seguindo para a proxima consulta.`,
            },
          });
        }
      }

      updateJob(job, {
        progress: {
          ...job.progress,
          percent: 90,
          step: 'Consolidando resultados',
          message: 'Removendo duplicados, resumindo copys e calculando ranking.',
          resultsFound: job.results.length,
        },
      });

      let finalResults = rankAds(collectedAds, {
        query: job.query,
        region: job.region,
        searchTerms: expansion.searchTerms,
        semanticTerms: expansion.semanticTerms,
        sort: job.sort,
      });

      finalResults = await enrichSummariesWithAI(finalResults, config);
      finalResults = sortRankedAds(finalResults, job.sort);

      job.summary.rawAds = collectedAds.length;
      job.summary.dedupedAds = finalResults.length;
      job.results = finalResults;

      const perTermFailures = job.diagnostics.perTermErrors.length;
      const totalTerms = expansion.searchTerms.length;
      let finalStatus = 'completed';
      let finalError = '';

      if (perTermFailures > 0 && finalResults.length > 0) {
        finalStatus = 'partial';
      } else if (perTermFailures === totalTerms && finalResults.length === 0) {
        finalStatus = 'failed';
        finalError = 'Todas as consultas falharam antes de gerar resultados utilizaveis.';
      } else if (perTermFailures > 0) {
        finalStatus = 'partial';
      }

      if (finalStatus === 'failed' && !job.diagnostics.fatalReason) {
        job.diagnostics.fatalReason = finalError;
      }

      job.status = finalStatus;
      job.error = finalError;

      updateJob(job, {
        status: finalStatus,
        error: finalError,
        diagnostics: { ...job.diagnostics },
        progress: {
          ...job.progress,
          percent: 100,
          step: finalStatus === 'failed' ? 'Busca falhou' : finalStatus === 'partial' ? 'Busca finalizada com avisos' : 'Busca finalizada',
          message: summarizeCompletion(job, finalResults),
          resultsFound: finalResults.length,
        },
      });
    } catch (error) {
      console.error('[AdResearch] Fatal job error:', error?.stack || error?.message || error);
      await failJob(job, error?.message || 'Erro inesperado ao montar a busca.', {
        collectorReady: job.diagnostics?.collectorReady,
      });
    } finally {
      trimJobs();
    }
  }

  return {
    startSearch({ query, region = '', sort = 'popular' }) {
      const safeSort = SORT_MODES.has(sort) ? sort : 'popular';
      const job = {
        jobId: randomUUID(),
        status: 'queued',
        query: String(query || '').trim(),
        region: String(region || '').trim(),
        sort: safeSort,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: {
          percent: 0,
          step: 'Na fila',
          message: 'Preparando a busca.',
          queriesTotal: 0,
          queriesCompleted: 0,
          resultsFound: 0,
        },
        summary: {
          platform: 'Meta Ads',
          usedAI: false,
          provider: 'groq',
          searchTerms: [],
          semanticTerms: [],
          intentSummary: '',
          angles: [],
          rawAds: 0,
          dedupedAds: 0,
        },
        results: [],
        warnings: [],
        error: '',
        diagnostics: createDiagnostics(),
      };

      jobs.set(job.jobId, job);
      emit(job);
      setTimeout(() => {
        runJob(job).catch((error) => {
          void failJob(job, error.message || 'Erro inesperado ao iniciar a busca.', {
            collectorReady: job.diagnostics?.collectorReady,
          });
        });
      }, 0);

      return sanitizeJob(job);
    },

    getJob(jobId) {
      return sanitizeJob(jobs.get(jobId));
    },

    listRecentJobs(limit = 4) {
      return Array.from(jobs.values())
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, limit)
        .map((job) => sanitizeJob(job));
    },
  };
}
