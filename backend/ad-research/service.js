import { randomUUID } from 'crypto';
import { callAI } from '../ai/gemini.js';
import { collectMetaAds } from './meta-collector.js';
import { expandSearchQuery } from './query-expander.js';
import { rankAds, sortRankedAds } from './ranker.js';
import { SORT_MODES } from './utils.js';

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
  };
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
          percent: 15,
          step: 'Planejamento pronto',
          message: `Buscando em ${expansion.searchTerms.length} consultas inteligentes.`,
          queriesTotal: expansion.searchTerms.length,
          queriesCompleted: 0,
          resultsFound: 0,
        },
      });

      const collectedAds = [];

      for (const [index, searchTerm] of expansion.searchTerms.entries()) {
        updateJob(job, {
          progress: {
            ...job.progress,
            percent: Math.min(82, 20 + Math.round((index / expansion.searchTerms.length) * 55)),
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
          job.warnings.push(`Falha ao consultar "${searchTerm}": ${error.message}`);
          updateJob(job, {
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

      updateJob(job, {
        status: 'completed',
        progress: {
          ...job.progress,
          percent: 100,
          step: 'Busca finalizada',
          message: `${finalResults.length} anuncios consolidados para ${job.query}.`,
          resultsFound: finalResults.length,
        },
      });
    } catch (error) {
      updateJob(job, {
        status: 'failed',
        error: error.message,
        progress: {
          ...job.progress,
          percent: job.progress?.percent || 0,
          step: 'Erro na busca',
          message: error.message,
        },
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
      };

      jobs.set(job.jobId, job);
      emit(job);
      setTimeout(() => {
        runJob(job).catch((error) => {
          updateJob(job, { status: 'failed', error: error.message });
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
