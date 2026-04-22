import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { testAPIKey } from './ai/gemini.js';
import { preflightMetaCollector } from './ad-research/meta-collector.js';
import { resolveEffectiveAIConfig, maskSecret } from './data/config-manager.js';
import { AUTH_DIR, CONFIG_FILE, DATA_DIR, DOCS_DIR, LEADS_FILE, PDF_CACHE_FILE } from './storage/paths.js';

function toSeverity(level = 'info') {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  return 'healthy';
}

function buildEvent(severity, title, message) {
  return {
    id: randomUUID(),
    severity,
    title,
    message,
    at: new Date().toISOString(),
  };
}

function formatPercent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function summarizeStorage(rootPath) {
  const authPresent = fs.existsSync(AUTH_DIR);
  const configPresent = fs.existsSync(CONFIG_FILE);
  const leadsPresent = fs.existsSync(LEADS_FILE);
  const docsPresent = fs.existsSync(DOCS_DIR);
  const cachePresent = fs.existsSync(PDF_CACHE_FILE);
  const docsCount = docsPresent
    ? fs.readdirSync(DOCS_DIR, { withFileTypes: true }).filter((entry) => entry.isFile()).length
    : 0;

  let severity = 'healthy';
  if (!configPresent || !leadsPresent) severity = 'warning';

  return {
    severity,
    root: rootPath,
    dataDir: DATA_DIR,
    authDir: AUTH_DIR,
    docsDir: DOCS_DIR,
    authPresent,
    configPresent,
    leadsPresent,
    cachePresent,
    docsPresent,
    docsCount,
  };
}

export function createSystemStatusService({ wa, queue, adResearch, loadConfig, broadcast }) {
  const state = {
    recentEvents: [],
    lastAiTest: {
      status: 'idle',
      message: 'Ainda nao testada.',
      checkedAt: null,
    },
    lastAdCollectorCheck: {
      status: 'idle',
      collectorReady: null,
      message: 'Ainda nao revalidado.',
      checkedAt: null,
    },
    lastWhatsAppStatus: wa.getStatus().status,
  };

  let emitTimer = null;

  function pushEvent(severity, title, message) {
    state.recentEvents.unshift(buildEvent(severity, title, message));
    state.recentEvents = state.recentEvents.slice(0, 14);
  }

  function queueSnapshot() {
    const snapshot = typeof queue.getStatusSnapshot === 'function'
      ? queue.getStatusSnapshot()
      : { status: 'idle', stats: { total: 0, accepted: 0, acceptedUnconfirmed: 0, confirmed: 0, failed: 0, pending: 0 } };
    const stats = snapshot.stats || {};
    const processed = (stats.confirmed || 0) + (stats.acceptedUnconfirmed || 0) + (stats.failed || 0);
    const confirmationRate = formatPercent(stats.confirmed || 0, processed || stats.accepted || 0);
    const unconfirmedRate = formatPercent(stats.acceptedUnconfirmed || 0, stats.accepted || 0);

    let severity = 'healthy';
    if (snapshot.status === 'paused' && (stats.failed || 0) > 0) severity = 'error';
    else if ((stats.failed || 0) > 0 || (stats.acceptedUnconfirmed || 0) > 0) severity = 'degraded';
    else if (snapshot.status === 'running') severity = 'healthy';
    else if (snapshot.status === 'idle' && (stats.total || 0) === 0) severity = 'warning';

    return {
      severity,
      ...snapshot,
      confirmationRate,
      acceptedUnconfirmedRate: unconfirmedRate,
    };
  }

  function aiSnapshot() {
    const config = resolveEffectiveAIConfig(loadConfig());
    let severity = 'healthy';
    if (config.aiEnabled && !config.hasEffectiveKey) severity = 'error';
    else if (!config.aiEnabled) severity = 'warning';
    else if (state.lastAiTest.status === 'error') severity = 'degraded';

    return {
      severity,
      enabled: !!config.aiEnabled,
      provider: config.aiProvider || 'groq',
      effectiveProvider: config.effectiveProvider || 'groq',
      effectiveAiModel: config.effectiveAiModel,
      qualificationModel: config.qualificationModel || '',
      groqKeySource: config.groqKeySource,
      geminiKeySource: config.geminiKeySource,
      hasGroqKey: !!config.groqKey,
      hasGeminiKey: !!config.geminiKey,
      hasEffectiveGroqKey: !!config.hasEffectiveGroqKey,
      hasEffectiveGeminiKey: !!config.hasEffectiveGeminiKey,
      hasEffectiveKey: !!config.hasEffectiveKey,
      effectiveKeySource: config.effectiveKeySource,
      effectiveKeyMasked: maskSecret(config.effectiveKey),
      lastKeyTest: state.lastAiTest,
    };
  }

  function adResearchSnapshot() {
    const latestJob = adResearch.listRecentJobs(1)[0] || null;
    const collectorReady = state.lastAdCollectorCheck.collectorReady ?? latestJob?.diagnostics?.collectorReady ?? null;
    let severity = 'healthy';
    if (collectorReady === false) severity = 'error';
    else if (latestJob?.status === 'partial') severity = 'degraded';
    else if (latestJob?.status === 'failed') severity = 'error';
    else if (!latestJob) severity = 'warning';

    return {
      severity,
      collectorReady,
      lastCollectorCheck: state.lastAdCollectorCheck,
      latestJob: latestJob
        ? {
            jobId: latestJob.jobId,
            status: latestJob.status,
            query: latestJob.query,
            region: latestJob.region,
            warnings: latestJob.warnings?.length || 0,
            fatalReason: latestJob.diagnostics?.fatalReason || '',
            collectorReady: latestJob.diagnostics?.collectorReady ?? null,
            updatedAt: latestJob.updatedAt,
          }
        : null,
    };
  }

  function automationsSnapshot() {
    const config = loadConfig();
    let severity = 'healthy';
    if (!config.followUpEnabled && !config.reportEnabled) severity = 'warning';

    return {
      severity,
      followUpEnabled: config.followUpEnabled !== false,
      followUpSchedule: 'A cada 30 minutos',
      followUp1Hours: config.followUp1Hours || 4,
      followUp2Hours: config.followUp2Hours || 24,
      followUpColdHours: config.followUpColdHours || 48,
      reportEnabled: config.reportEnabled !== false,
      reportHour: config.reportHour || '18:00',
      reportSchedule: `Diario as ${config.reportHour || '18:00'}`,
    };
  }

  function whatsappSnapshot() {
    const status = wa.getStatus();
    let severity = 'healthy';
    if (status.status === 'disconnected') severity = status.lastDisconnect ? 'error' : 'warning';
    else if (status.status === 'qr_ready') severity = 'warning';

    return {
      severity,
      ...status,
    };
  }

  function buildSnapshot() {
    const whatsapp = whatsappSnapshot();
    const ai = aiSnapshot();
    const campaign = queueSnapshot();
    const adResearchState = adResearchSnapshot();
    const automations = automationsSnapshot();
    const storage = summarizeStorage(process.env.APP_STORAGE_DIR ? path.resolve(process.env.APP_STORAGE_DIR) : path.resolve(DATA_DIR, '..'));

    return {
      updatedAt: new Date().toISOString(),
      whatsapp,
      ai,
      campaign,
      adResearch: adResearchState,
      automations,
      storage,
      recentEvents: state.recentEvents,
    };
  }

  function emitSnapshot() {
    const snapshot = buildSnapshot();
    broadcast({ type: 'system_status', snapshot });
    return snapshot;
  }

  function emitSnapshotDebounced() {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = setTimeout(() => {
      emitTimer = null;
      emitSnapshot();
    }, 120);
  }

  async function refresh(options = {}) {
    const checks = Array.isArray(options.checks) ? options.checks : [];
    const shouldTestAI = checks.includes('ai');
    const shouldCheckAds = checks.includes('ads');

    if (shouldTestAI) {
      const effective = resolveEffectiveAIConfig(loadConfig());
      if (!effective.hasEffectiveKey) {
        state.lastAiTest = {
          status: 'error',
          message: 'Nenhuma chave efetiva disponivel para o provedor atual.',
          checkedAt: new Date().toISOString(),
        };
        pushEvent('error', 'IA', state.lastAiTest.message);
      } else {
        const result = await testAPIKey(effective.effectiveProvider, effective.effectiveKey, effective.effectiveAiModel);
        state.lastAiTest = {
          status: result.ok ? 'ok' : 'error',
          message: result.message,
          checkedAt: new Date().toISOString(),
        };
        pushEvent(result.ok ? 'healthy' : 'error', 'IA', result.message);
      }
    }

    if (shouldCheckAds) {
      const result = await preflightMetaCollector();
      state.lastAdCollectorCheck = {
        status: result.collectorReady ? 'ok' : 'error',
        collectorReady: !!result.collectorReady,
        message: result.message,
        checkedAt: new Date().toISOString(),
      };
      pushEvent(result.collectorReady ? 'healthy' : 'error', 'Pesquisa Ads', result.message);
    }

    return emitSnapshot();
  }

  wa.on('status-change', (status) => {
    const nextStatus = status?.status || 'disconnected';
    if (nextStatus !== state.lastWhatsAppStatus) {
      const messageMap = {
        connected: 'WhatsApp conectado com sucesso.',
        qr_ready: 'QR Code aguardando leitura.',
        disconnected: status?.lastDisconnect?.message || 'WhatsApp desconectado.',
      };
      pushEvent(toSeverity(nextStatus === 'disconnected' ? 'warning' : 'info'), 'WhatsApp', messageMap[nextStatus] || `WhatsApp em ${nextStatus}.`);
      state.lastWhatsAppStatus = nextStatus;
    }
    emitSnapshotDebounced();
  });

  wa.on('route-update', () => emitSnapshotDebounced());
  wa.on('outbound-status', (event) => {
    if (event.status === 'failed') {
      pushEvent('error', 'WhatsApp', `Falha ao enviar para ${event.targetResolved || event.targetOriginal}.`);
    } else if (event.status === 'delivery_timeout') {
      pushEvent('warning', 'WhatsApp', `Aceito sem confirmacao para ${event.targetResolved || event.targetOriginal}.`);
    }
    emitSnapshotDebounced();
  });

  queue.setStatusReporter((event) => {
    if (event?.message && !/^Aguardando \d+s/i.test(event.message) && !/^Simulando digitacao/i.test(event.message)) {
      pushEvent(event.severity || 'healthy', event.title || 'Campanha', event.message);
    }
    emitSnapshotDebounced();
  });

  if (typeof adResearch.setStatusReporter === 'function') {
    adResearch.setStatusReporter((event) => {
      if (event?.message) {
        pushEvent(event.severity || 'healthy', event.title || 'Pesquisa Ads', event.message);
      }
      emitSnapshotDebounced();
    });
  }

  return {
    buildSnapshot,
    emitSnapshot,
    refresh,
  };
}
