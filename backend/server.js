import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import WhatsAppManager from './whatsapp.js';
import MessageQueue from './queue.js';
import { handleIncomingMessage } from './ai/agent.js';
import { startFollowUpCron } from './ai/follow-up.js';
import { startDailyReportCron } from './ai/daily-report.js';
import {
  getAIModelCatalog,
  isSupportedAIModel,
  loadConfig,
  maskSecret,
  resolveEffectiveAIConfig,
  sanitizeAIConfigUpdates,
  saveConfig,
} from './data/config-manager.js';
import {
  addInternalNote,
  bulkUpdateLeads,
  deleteInternalNote,
  exportLeadsCSV,
  getAllLeads,
  getDeletedLead,
  getDeletedLeads,
  getDuplicateLeadGroups,
  getLead,
  getLeadOverview,
  getLeadSettings,
  getLeadStats,
  subscribeLeadEvents,
  updateLeadSettings,
  updateLead,
} from './data/leads-manager.js';
import {
  archiveLeads,
  cleanupExpiredTrash,
  deleteLeadsPermanently,
  emptyTrashPermanently,
  getLeadTimeline,
  mergeLeads,
  previewLeadArchive,
  reclassifyHistoricalLeads,
  restoreLeads,
} from './data/lead-lifecycle-service.js';
import { extractAndSavePDF, getUploadedDocs, removePDF } from './knowledge/pdf-loader.js';
import { testAPIKey } from './ai/gemini.js';
import { createAdResearchService } from './ad-research/service.js';
import { createAdResearchAccessGuard } from './ad-research/access-guard.js';
import { createSystemStatusService } from './system-status.js';
import {
  createConsultant,
  deleteConsultant,
  listConsultants,
  setConsultantActive,
  updateConsultant,
} from './data/consultants-repository.js';
import {
  createFaqItem,
  listFaqItems,
  setFaqItemActive,
  updateFaqItem,
} from './data/faq-repository.js';
import { upsertLidPhoneMapping } from './data/lid-phone-map-repository.js';
import {
  createReminder,
  listOpenReminders,
  getLatestOpenReminderForLead,
  completeAllRemindersForLead,
  getReminderState,
  resumeRemindersForLead,
} from './data/reminders-repository.js';
import { isLidIdentifier, normalizeLidJid, normalizeRealWhatsAppPhone } from './phone-utils.js';
import { createLeadsAccessGuard } from './security/leads-access-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/vendor/lucide', express.static(path.join(__dirname, '../node_modules/lucide/dist/umd'), { maxAge: '1y' }));
app.use(express.static(path.join(__dirname, '../frontend')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 },
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

function buildSafeAIConfig() {
  const config = loadConfig();
  const effective = resolveEffectiveAIConfig(config);
  const safeConfig = {
    ...config,
    groqKey: '',
    geminiKey: '',
    hasGroqKey: !!config.groqKey,
    hasGeminiKey: !!config.geminiKey,
    groqKeyMasked: maskSecret(config.groqKey),
    geminiKeyMasked: maskSecret(config.geminiKey),
    effectiveProvider: effective.effectiveProvider,
    effectiveAiModel: effective.effectiveAiModel,
    effectiveQualificationModel: effective.effectiveQualificationModel,
    effectiveClassificationModel: effective.effectiveClassificationModel,
    groqKeySource: effective.groqKeySource,
    geminiKeySource: effective.geminiKeySource,
    hasEffectiveGroqKey: effective.hasEffectiveGroqKey,
    hasEffectiveGeminiKey: effective.hasEffectiveGeminiKey,
    hasEffectiveKey: effective.hasEffectiveKey,
    effectiveKeySource: effective.effectiveKeySource,
    effectiveKeyMasked: maskSecret(effective.effectiveKey),
    effectiveGroqKeyMasked: maskSecret(effective.effectiveGroqKey),
    effectiveGeminiKeyMasked: maskSecret(effective.effectiveGeminiKey),
    modelCatalog: getAIModelCatalog(),
  };

  return safeConfig;
}

function normalizeCampaignInputNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

function prepareCampaignNumbers(numbers = []) {
  const seen = new Set();
  const validNumbers = [];
  const invalid = [];
  const duplicates = [];

  for (const raw of Array.isArray(numbers) ? numbers : []) {
    const normalized = normalizeCampaignInputNumber(raw);
    if (!normalized) {
      invalid.push(String(raw || ''));
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.push(normalized);
      continue;
    }
    seen.add(normalized);
    validNumbers.push(normalized);
  }

  return {
    totalInput: Array.isArray(numbers) ? numbers.length : 0,
    queuedCount: validNumbers.length,
    invalidCount: invalid.length,
    duplicateCount: duplicates.length,
    invalid: invalid.slice(0, 20),
    duplicates: duplicates.slice(0, 20),
    validNumbers,
  };
}

function normalizeDebugRoute(route) {
  const value = String(route || 'auto').toLowerCase();
  return ['phone', 'lid', 'auto'].includes(value) ? value : 'auto';
}

function assertDebugToken(req) {
  const expected = String(process.env.DEBUG_SEND_TOKEN || '').trim();
  if (!expected) return true;
  return String(req.headers['x-debug-token'] || req.body?.debugToken || '').trim() === expected;
}

const wa = new WhatsAppManager(wss);
const queue = new MessageQueue(wa, wss, { loadConfig });
const adResearch = createAdResearchService({ loadConfig, broadcast });
const adResearchAccess = createAdResearchAccessGuard();
const leadsAccess = createLeadsAccessGuard();
const systemStatus = createSystemStatusService({ wa, queue, adResearch, loadConfig, broadcast });

subscribeLeadEvents((event) => broadcast(event));

wa.onMessage = handleIncomingMessage;
wa.on('contact-map-update', ({ alias, phone, source }) => {
  const normalizedPhone = normalizeRealWhatsAppPhone(phone);
  const aliasText = String(alias || '');
  const lidJid = isLidIdentifier(aliasText)
    ? normalizeLidJid(aliasText)
    : (/lid/i.test(String(source || '')) && !normalizeRealWhatsAppPhone(aliasText))
      ? normalizeLidJid(aliasText)
      : null;

  if (lidJid && normalizedPhone) {
    void upsertLidPhoneMapping({
      lid_jid: lidJid,
      phone: normalizedPhone,
      source: String(source || 'contact_sync'),
      confidence: /phoneNumberShare|onWhatsApp|contacts\.upsert/i.test(String(source || '')) ? 0.9 : 0.8,
    });
  }
});

startFollowUpCron(wa);
startDailyReportCron(wa);
wa.connect();

wss.on('connection', (ws) => {
  const waStatus = wa.getStatus();
  ws.send(JSON.stringify({ type: 'status', status: waStatus.status, details: waStatus.lastDisconnect || null }));
  if (waStatus.qrCode) {
    ws.send(JSON.stringify({ type: 'qr', qr: waStatus.qrCode }));
  }

  const progress = queue.getProgress();
  ws.send(JSON.stringify({ type: 'campaign_status', status: progress.status }));
  ws.send(JSON.stringify({
    type: 'stats',
    stats: progress.stats,
    flowControl: progress.flowControl,
    waitReason: progress.waitReason,
  }));
  if (progress.queue.length > 0) {
    ws.send(JSON.stringify({
      type: 'campaign_loaded',
      stats: progress.stats,
      queue: progress.queue,
      flowControl: progress.flowControl,
      waitReason: progress.waitReason,
      precheck: progress.precheck,
    }));
  }

  const config = loadConfig();
  ws.send(JSON.stringify({ type: 'ai_status', enabled: config.aiEnabled }));
  ws.send(JSON.stringify({ type: 'system_status', snapshot: systemStatus.buildSnapshot() }));
  ws.send(JSON.stringify({ type: 'lead_overview', overview: getLeadOverview() }));

  adResearch.listRecentJobs().forEach((job) => {
    ws.send(JSON.stringify({ type: 'ad_research_update', job }));
  });

  ws.on('error', console.error);
});

app.get('/api/status', (req, res) => res.json(wa.getStatus()));
app.get('/api/system/status', (req, res) => res.json(systemStatus.buildSnapshot()));

app.get('/api/debug/reachout-status', async (req, res) => {
  try {
    if (!assertDebugToken(req)) return res.status(403).json({ error: 'Debug token invalido.' });
    return res.json(await wa.fetchReachoutTimeLock());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/debug/send-test', async (req, res) => {
  try {
    if (!assertDebugToken(req)) return res.status(403).json({ error: 'Debug token invalido.' });
    if (wa.getStatus().status !== 'connected') return res.status(400).json({ error: 'WhatsApp nao esta conectado.' });

    const number = String(req.body?.number || '').trim();
    const message = String(req.body?.message || 'teste').trim() || 'teste';
    const route = normalizeDebugRoute(req.body?.route);
    if (!number) return res.status(400).json({ error: 'Informe number.' });

    let target = number;
    const options = {
      context: 'debug',
      routeLabel: `debug_${route}`,
      noInternalRetry: true,
      skipTyping: true,
    };
    let lookup = null;

    if (route === 'phone') {
      options.forcePhoneJid = true;
      if (req.body?.freshDevices === true) options.freshDevices = true;
      if (req.body?.peerPrimary === true) options.peerPrimary = true;
    } else if (route === 'lid') {
      const preferred = await wa.preferStoredLidForTarget(number);
      lookup = preferred?.lookup || null;
      if (!preferred?.preferredJid || !/@(?:hosted\.)?lid\b/.test(String(preferred.preferredJid))) {
        return res.status(400).json({
          error: 'Nenhuma rota LID encontrada para este numero.',
          preferred,
        });
      }
      target = preferred.preferredJid;
    }

    const accepted = await wa.sendMessage(target, message, null, options);
    const final = typeof wa.waitForOutboundFinal === 'function'
      ? await wa.waitForOutboundFinal(accepted.messageId)
      : { status: accepted.status || 'accepted' };

    res.json({
      accepted: !!accepted.messageId,
      messageId: accepted.messageId,
      targetResolved: final.targetResolved || accepted.resolvedJid,
      targetKind: final.targetKind || accepted.targetKind,
      routeLabel: final.routeLabel || options.routeLabel,
      route,
      lookup,
      finalStatus: final.status === 'delivery_timeout' ? 'delivery_timeout' : final.status,
      ackStatus: final.ackStatus ?? null,
      updates: final.updates || [],
      error: final.error || null,
      outbound: final,
    });
  } catch (error) {
    res.status(500).json({ error: error.message, targetResolved: error.targetResolved || null, targetKind: error.targetKind || null });
  }
});

app.post('/api/system/status/refresh', (req, res, next) => {
  const checks = Array.isArray(req.body?.checks) ? req.body.checks : [];
  if (checks.includes('ads')) return adResearchAccess.mutation(req, res, next);
  return next();
}, async (req, res) => {
  try {
    const snapshot = await systemStatus.refresh({ checks: req.body?.checks || [] });
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/disconnect', async (req, res) => {
  try {
    await wa.clearSession();
    setTimeout(() => wa.connect(), 1500);
    systemStatus.emitSnapshot();
    res.json({ success: true, message: 'Sessao encerrada. Novo QR gerado em breve.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/campaign/start', upload.single('image'), (req, res) => {
  try {
    const data = JSON.parse(req.body.data);
    const { numbers, message, pollEnabled, pollOptions, pollQuestion, scheduleConfig, antiRestriction } = data;

    const precheck = prepareCampaignNumbers(numbers);
    if (!precheck.validNumbers.length) return res.status(400).json({ error: 'Lista de contatos vazia ou sem numeros validos' });
    if (!message?.trim()) return res.status(400).json({ error: 'A mensagem nao pode ser vazia' });
    if (wa.getStatus().status !== 'connected') return res.status(400).json({ error: 'WhatsApp nao esta conectado.' });

    const imageBuffer = req.file ? req.file.buffer : null;
    queue.initCampaign({
      numbers: precheck.validNumbers,
      message,
      imageBuffer,
      pollEnabled,
      pollOptions,
      pollQuestion,
      scheduleConfig,
      antiRestriction,
      precheck,
    });
    queue.start();
    systemStatus.emitSnapshot();
    res.json({
      success: true,
      message: `Campanha iniciada com ${precheck.validNumbers.length} contato(s)`,
      precheck,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/campaign/pause', (req, res) => {
  queue.pause();
  systemStatus.emitSnapshot();
  res.json({ success: true });
});

app.post('/api/campaign/resume', (req, res) => {
  queue.resume();
  systemStatus.emitSnapshot();
  res.json({ success: true });
});

app.post('/api/campaign/stop', (req, res) => {
  queue.stop();
  systemStatus.emitSnapshot();
  res.json({ success: true });
});

app.get('/api/campaign/progress', (req, res) => res.json(queue.getProgress()));

app.post('/api/campaign/clear', (req, res) => {
  const success = queue.clear();
  systemStatus.emitSnapshot();
  success ? res.json({ success: true }) : res.status(400).json({ error: 'Pare a campanha antes de limpar.' });
});

app.get('/api/consultants', async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || 'true') !== 'false';
    const consultants = await listConsultants({ config: loadConfig(), includeInactive });
    res.json(consultants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/consultants', async (req, res) => {
  try {
    const consultant = await createConsultant(req.body || {});
    systemStatus.emitSnapshot();
    res.status(201).json(consultant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/consultants/:id', async (req, res) => {
  try {
    const consultant = await updateConsultant(req.params.id, req.body || {});
    if (!consultant) return res.status(404).json({ error: 'Consultor nao encontrado' });
    systemStatus.emitSnapshot();
    res.json(consultant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/consultants/:id/active', async (req, res) => {
  try {
    const consultant = await setConsultantActive(req.params.id, !!req.body?.active);
    if (!consultant) return res.status(404).json({ error: 'Consultor nao encontrado' });
    systemStatus.emitSnapshot();
    res.json(consultant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/consultants/:id', async (req, res) => {
  try {
    const deleted = await deleteConsultant(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Consultor nao encontrado' });
    systemStatus.emitSnapshot();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/faq', async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || 'true') !== 'false';
    const items = await listFaqItems({ includeInactive });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/faq', async (req, res) => {
  try {
    const item = await createFaqItem(req.body || {});
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/faq/:id', async (req, res) => {
  try {
    const item = await updateFaqItem(req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: 'FAQ nao encontrada' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/faq/:id/active', async (req, res) => {
  try {
    const item = await setFaqItemActive(req.params.id, !!req.body?.active);
    if (!item) return res.status(404).json({ error: 'FAQ nao encontrada' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ad-research/session', (req, res) => {
  const session = adResearchAccess.issue(req);
  if (!session) return res.status(403).json({ error: 'Origem da requisicao nao permitida.' });
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  res.cookie('zapbot_ad_session', session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure || forwardedProto === 'https',
    path: '/api/ad-research',
    maxAge: session.maxAgeMs,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json(session);
});

app.get('/api/ad-research/status', adResearchAccess.read, (req, res) => {
  res.json(adResearch.getStats());
});

app.get('/api/ad-research/history', adResearchAccess.read, (req, res) => {
  const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 20));
  res.json(adResearch.listRecentJobs(limit));
});

app.get('/api/ad-research/watchlists', adResearchAccess.read, (req, res) => {
  res.json(adResearch.listWatchlists());
});

app.post('/api/ad-research/watchlists', adResearchAccess.mutation, (req, res) => {
  try {
    const watchlist = adResearch.createWatchlist(req.body || {});
    if (!watchlist) return res.status(400).json({ error: 'Nao foi possivel criar o monitoramento.' });
    res.status(201).json(watchlist);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/ad-research/watchlists/:id', adResearchAccess.mutation, (req, res) => {
  try {
    const watchlist = adResearch.updateWatchlist(req.params.id, req.body || {});
    if (!watchlist) return res.status(404).json({ error: 'Monitoramento nao encontrado.' });
    res.json(watchlist);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/ad-research/watchlists/:id', adResearchAccess.mutation, (req, res) => {
  const deleted = adResearch.deleteWatchlist(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Monitoramento nao encontrado.' });
  res.json({ success: true });
});

app.post('/api/ad-research/watchlists/:id/run', adResearchAccess.search, (req, res) => {
  const job = adResearch.runWatchlist(req.params.id);
  if (!job) return res.status(404).json({ error: 'Monitoramento nao encontrado.' });
  res.status(202).json({ jobId: job.jobId, job });
});

app.get('/api/ad-research/snapshots', adResearchAccess.read, (req, res) => {
  res.json(adResearch.listSnapshots({
    watchlistId: req.query.watchlistId || null,
    limit: Math.min(80, Math.max(1, Number(req.query.limit) || 30)),
  }));
});

app.get('/api/ad-research/alerts', adResearchAccess.read, (req, res) => {
  res.json(adResearch.listAlerts({
    unreadOnly: String(req.query.unreadOnly || 'false') === 'true',
    limit: Math.min(120, Math.max(1, Number(req.query.limit) || 80)),
  }));
});

app.patch('/api/ad-research/alerts/read', adResearchAccess.mutation, (req, res) => {
  res.json(adResearch.markAlertsRead(Array.isArray(req.body?.ids) ? req.body.ids : []));
});

app.get('/api/ad-research/favorites', adResearchAccess.read, (req, res) => {
  res.json(adResearch.listFavorites());
});

app.post('/api/ad-research/favorites', adResearchAccess.mutation, (req, res) => {
  const favorite = adResearch.saveFavorite(req.body || {});
  if (!favorite) return res.status(404).json({ error: 'Anuncio nao encontrado para favoritar.' });
  res.status(201).json(favorite);
});

app.delete('/api/ad-research/favorites/:adId', adResearchAccess.mutation, (req, res) => {
  const deleted = adResearch.deleteFavorite(req.params.adId);
  if (!deleted) return res.status(404).json({ error: 'Favorito nao encontrado.' });
  res.json({ success: true });
});

app.post('/api/ad-research/compare', adResearchAccess.mutation, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length < 2) return res.status(400).json({ error: 'Selecione pelo menos dois anuncios.' });
  res.json(adResearch.compareAds(items));
});

app.get('/api/ad-research/insights/:jobId', adResearchAccess.read, (req, res) => {
  const insights = adResearch.getInsights(req.params.jobId);
  if (!insights) return res.status(404).json({ error: 'Busca nao encontrada.' });
  res.json(insights);
});

app.post('/api/ad-research/toolkit/:jobId/:adId', adResearchAccess.mutation, (req, res) => {
  const toolkit = adResearch.getToolkit(req.params.jobId, req.params.adId, req.body?.objective || 'gerar conversas');
  if (!toolkit) return res.status(404).json({ error: 'Anuncio nao encontrado.' });
  res.json(toolkit);
});

app.post('/api/ad-research/audit/:jobId/:adId', adResearchAccess.mutation, async (req, res) => {
  try {
    const audit = await adResearch.auditAdLanding(req.params.jobId, req.params.adId);
    res.json(audit);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/ad-research/export/:jobId.csv', adResearchAccess.read, (req, res) => {
  const csv = adResearch.exportCsv(req.params.jobId);
  if (csv === null) return res.status(404).json({ error: 'Busca nao encontrada.' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pesquisa_ads_${Date.now()}.csv"`);
  res.send(`\uFEFF${csv}`);
});

app.post('/api/ad-research/utm', adResearchAccess.mutation, (req, res) => {
  const url = adResearch.buildUtm(req.body?.url, req.body || {});
  if (!url) return res.status(400).json({ error: 'Informe uma URL valida.' });
  res.json({ url });
});

app.get('/api/ad-research/feedback', adResearchAccess.read, (req, res) => {
  res.json(adResearch.listFeedback({ adId: req.query.adId || null, limit: 100 }));
});

app.post('/api/ad-research/feedback', adResearchAccess.mutation, (req, res) => {
  const feedback = adResearch.saveFeedback(req.body || {});
  if (!feedback) return res.status(400).json({ error: 'Informe o anuncio avaliado.' });
  res.status(201).json(feedback);
});

app.post('/api/ad-research/search', adResearchAccess.search, (req, res) => {
  try {
    const job = adResearch.startSearch(req.body || {});
    systemStatus.emitSnapshot();
    res.status(202).json({ jobId: job.jobId, job });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/ad-research/:jobId/cancel', adResearchAccess.mutation, (req, res) => {
  const job = adResearch.cancelSearch(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Busca nao encontrada.' });
  res.json(job);
});

app.get('/api/ad-research/:jobId', adResearchAccess.read, (req, res) => {
  const job = adResearch.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Busca nao encontrada.' });
  res.json(job);
});

app.get('/api/ai/config', (req, res) => res.json(buildSafeAIConfig()));

app.post('/api/ai/config', (req, res) => {
  try {
    const current = loadConfig();
    const updates = sanitizeAIConfigUpdates(req.body, current);
    const prospective = resolveEffectiveAIConfig({ ...current, ...updates });
    if (prospective.aiEnabled && !prospective.hasEffectiveKey) {
      return res.status(400).json({ error: 'Cadastre uma chave valida para o provedor principal antes de ativar o agente.' });
    }
    saveConfig(updates);

    const enabled = prospective.aiEnabled;
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'ai_status', enabled }));
      }
    });

    systemStatus.emitSnapshot();
    res.json({ success: true, config: buildSafeAIConfig() });
  } catch (error) {
    const status = error instanceof TypeError ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/ai/test-key', async (req, res) => {
  const { key, provider, model } = req.body || {};
  const config = loadConfig();
  const selectedProvider = String(provider || config.aiProvider || 'groq').trim();
  if (!['groq', 'gemini'].includes(selectedProvider)) {
    return res.status(400).json({ error: 'Provedor de IA invalido.' });
  }
  if (model && !isSupportedAIModel(selectedProvider, model)) {
    return res.status(400).json({ error: 'Modelo indisponivel para o provedor selecionado.' });
  }
  const effective = resolveEffectiveAIConfig({
    ...config,
    aiProvider: selectedProvider,
    aiModel: model || (selectedProvider === config.aiProvider ? config.aiModel : ''),
  });

  const resolvedKey = String(key || '').trim()
    || (selectedProvider === 'gemini' ? effective.effectiveGeminiKey : effective.effectiveGroqKey);
  const resolvedModel = model || effective.effectiveAiModel;

  if (!resolvedKey) return res.status(400).json({ error: 'Chave nao fornecida' });

  const result = await testAPIKey(selectedProvider, resolvedKey, resolvedModel);
  res.json(result);
});

app.get('/api/ai/docs', (req, res) => res.json(getUploadedDocs()));

app.post('/api/ai/docs', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Somente PDFs sao aceitos' });

    const filename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const result = await extractAndSavePDF(req.file.buffer, filename);
    systemStatus.emitSnapshot();
    res.json({ success: true, filename, pages: result.pages, wordCount: result.wordCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/ai/docs/:filename', (req, res) => {
  try {
    removePDF(req.params.filename);
    systemStatus.emitSnapshot();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reminders', async (req, res) => {
  try {
    const list = await listOpenReminders({ limit: 50 });
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reminders', async (req, res) => {
  try {
    const reminder = await createReminder(req.body);
    if (!reminder) return res.status(400).json({ error: 'Dados invalidos para agenda.' });
    systemStatus.emitSnapshot();
    res.status(201).json(reminder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reminders/:lead_key', async (req, res) => {
  try {
    const reminder = await getLatestOpenReminderForLead(req.params.lead_key);
    res.json(reminder || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reminders/:lead_key/complete', async (req, res) => {
  try {
    await completeAllRemindersForLead(req.params.lead_key);
    systemStatus.emitSnapshot();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const CRM_STAGE_VALUES = new Set(['attention', 'active', 'qualified', 'waiting', 'closed']);
const LEAD_TAG_VALUES = new Set(['', 'quente', 'morno', 'frio', 'boleto', 'suporte']);
const DASHBOARD_UPDATE_FIELDS = new Set(['status', 'stage', 'operationalStatus', 'crmStage', 'tag']);

function sanitizeLeadDashboardUpdates(body = {}, { bulk = false } = {}) {
  const updates = {};
  for (const [key, rawValue] of Object.entries(body || {})) {
    if (!DASHBOARD_UPDATE_FIELDS.has(key)) continue;
    if (bulk && !['crmStage', 'tag'].includes(key)) continue;
    const value = rawValue == null ? '' : String(rawValue).trim();
    if (key === 'crmStage') {
      if (value && !CRM_STAGE_VALUES.has(value)) throw new Error('Categoria de CRM invalida.');
      updates.crmStage = value || null;
      continue;
    }
    if (key === 'tag') {
      if (!LEAD_TAG_VALUES.has(value)) throw new Error('Etiqueta invalida.');
      updates.tag = value;
      continue;
    }
    if (!/^[a-z0-9_]{1,64}$/i.test(value)) throw new Error(`Valor invalido para ${key}.`);
    updates[key] = value;
  }
  return updates;
}

function uniqueLeadNumbers(input) {
  const numbers = [...new Set((Array.isArray(input) ? input : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
  if (numbers.length > 5000) throw new Error('Selecione no maximo 5000 leads por operacao.');
  return numbers;
}

app.get('/api/leads/session', (req, res) => {
  const session = leadsAccess.issue(req);
  if (!session) return res.status(403).json({ error: 'Origem da requisicao nao permitida.' });
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  res.cookie('zapbot_leads_session', session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure || forwardedProto === 'https',
    path: '/api/leads',
    maxAge: session.maxAgeMs,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json(session);
});

app.get('/api/leads/overview', leadsAccess.read, (req, res) => {
  const overview = getLeadOverview();
  res.json({
    ...overview,
    trashCount: getDeletedLeads().length,
    settings: getLeadSettings(),
  });
});

app.get('/api/leads/trash', leadsAccess.read, (req, res) => {
  const leads = getDeletedLeads({ summary: req.query.view === 'summary' });
  res.json(leads.map((lead) => {
    const reminderState = getReminderState(lead.number);
    return {
      ...lead,
      reminderPaused: !!reminderState?.paused,
      reminderReviewRequired: !!reminderState?.review_required,
    };
  }));
});

app.get('/api/leads/settings', leadsAccess.read, (req, res) => {
  res.json(getLeadSettings());
});

app.patch('/api/leads/settings', leadsAccess.mutation, async (req, res) => {
  try {
    const settings = updateLeadSettings({ trashRetentionDays: req.body?.trashRetentionDays });
    const cleanup = await cleanupExpiredTrash();
    res.json({ success: true, settings, cleanup });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/reminders/:lead_key/resume', leadsAccess.mutation, async (req, res) => {
  try {
    await resumeRemindersForLead(req.params.lead_key);
    systemStatus.emitSnapshot();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leads/duplicates', leadsAccess.read, (req, res) => {
  res.json(getDuplicateLeadGroups());
});

app.post('/api/leads/delete-preview', leadsAccess.read, async (req, res) => {
  try {
    const numbers = req.body?.all
      ? getAllLeads().map((lead) => lead.number)
      : uniqueLeadNumbers(req.body?.numbers);
    if (numbers.length === 0) return res.status(400).json({ error: 'Nenhum lead selecionado.' });
    res.json(await previewLeadArchive(numbers));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/leads/merge', leadsAccess.mutation, async (req, res) => {
  try {
    const numbers = uniqueLeadNumbers(req.body?.numbers);
    if (req.body?.confirmation !== 'merge_duplicates') {
      return res.status(400).json({ error: 'Confirmacao de mesclagem invalida.' });
    }
    if (Number(req.body?.expectedCount) !== numbers.length || numbers.length < 2) {
      return res.status(409).json({ error: 'A selecao mudou. Revise os registros antes de mesclar.' });
    }
    const result = await mergeLeads(numbers, {
      targetNumber: String(req.body?.targetNumber || '').trim() || null,
      origin: 'dashboard',
    });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/leads/reclassify', leadsAccess.mutation, async (req, res) => {
  if (req.body?.confirmation !== 'reclassify_leads') {
    return res.status(400).json({ error: 'Confirmacao invalida.' });
  }
  try {
    const result = await reclassifyHistoricalLeads({ origin: 'dashboard' });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leads/trash/:number', leadsAccess.read, (req, res) => {
  const lead = getDeletedLead(req.params.number);
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado na lixeira.' });
  const reminderState = getReminderState(req.params.number);
  res.json({ ...lead, reminderState });
});

app.post('/api/leads/trash/restore', leadsAccess.mutation, async (req, res) => {
  try {
    const numbers = uniqueLeadNumbers(req.body?.numbers);
    if (numbers.length === 0) return res.status(400).json({ error: 'Nenhum lead selecionado.' });
    const result = await restoreLeads(numbers, { origin: 'dashboard' });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/leads/trash/permanent', leadsAccess.mutation, async (req, res) => {
  try {
    const numbers = uniqueLeadNumbers(req.body?.numbers);
    if (req.body?.confirmation !== 'EXCLUIR DEFINITIVAMENTE') {
      return res.status(400).json({ error: 'Digite EXCLUIR DEFINITIVAMENTE para confirmar.' });
    }
    if (Number(req.body?.expectedCount) !== numbers.length || numbers.length === 0) {
      return res.status(409).json({ error: 'A selecao mudou. Atualize a lixeira antes de excluir.' });
    }
    const result = await deleteLeadsPermanently(numbers, { origin: 'dashboard' });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview(), trashCount: getDeletedLeads().length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/leads/trash', leadsAccess.mutation, async (req, res) => {
  const currentCount = getDeletedLeads().length;
  if (req.body?.confirmation !== 'ESVAZIAR LIXEIRA') {
    return res.status(400).json({ error: 'Digite ESVAZIAR LIXEIRA para confirmar.' });
  }
  if (Number(req.body?.expectedCount) !== currentCount) {
    return res.status(409).json({ error: 'A lixeira mudou. Atualize a tela e confirme novamente.' });
  }
  try {
    const result = await emptyTrashPermanently({ origin: 'dashboard' });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview(), trashCount: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/leads/bulk', leadsAccess.mutation, (req, res) => {
  try {
    const numbers = uniqueLeadNumbers(req.body?.numbers);
    const updates = sanitizeLeadDashboardUpdates(req.body?.updates, { bulk: true });
    if (numbers.length === 0) return res.status(400).json({ error: 'Nenhum lead selecionado.' });
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nenhuma alteracao valida.' });
    const result = bulkUpdateLeads(numbers, updates, { origin: 'dashboard' });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/leads/bulk', leadsAccess.mutation, async (req, res) => {
  try {
    const numbers = uniqueLeadNumbers(req.body?.numbers);
    if (req.body?.confirmation !== 'delete_selected') {
      return res.status(400).json({ error: 'Confirmacao de exclusao invalida.' });
    }
    if (Number(req.body?.expectedCount) !== numbers.length || numbers.length === 0) {
      return res.status(409).json({ error: 'A selecao mudou. Revise os leads antes de excluir.' });
    }
    const result = await archiveLeads(numbers, { origin: 'dashboard', backup: numbers.length > 1 });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/leads', leadsAccess.read, (req, res) => {
  const { status } = req.query;
  let leads = getAllLeads({ summary: req.query.view === 'summary' });
  if (status && status !== 'all') leads = leads.filter((lead) => lead.status === status);
  res.json(leads.map((lead) => {
    const reminderState = getReminderState(lead.number);
    return {
      ...lead,
      reminderPaused: !!reminderState?.paused,
      reminderReviewRequired: !!reminderState?.review_required,
    };
  }));
});

app.get('/api/leads/stats', leadsAccess.read, (req, res) => res.json(getLeadStats()));

app.get('/api/leads/export', leadsAccess.read, (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads_${Date.now()}.csv"`);
  res.send('\uFEFF' + exportLeadsCSV());
});

app.post('/api/leads/clear', leadsAccess.mutation, async (req, res) => {
  const currentCount = getAllLeads().length;
  if (req.body?.confirmation !== 'EXCLUIR TUDO') {
    return res.status(400).json({ error: 'Digite EXCLUIR TUDO para confirmar.' });
  }
  if (Number(req.body?.expectedCount) !== currentCount) {
    return res.status(409).json({ error: 'A lista mudou. Atualize a tela e confirme novamente.' });
  }
  try {
    const numbers = getAllLeads().map((lead) => lead.number);
    const result = await archiveLeads(numbers, { origin: 'dashboard', backup: true, reason: 'archive_all' });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leads/:number/timeline', leadsAccess.read, async (req, res) => {
  try {
    const timeline = await getLeadTimeline(req.params.number);
    if (!timeline) return res.status(404).json({ error: 'Lead nao encontrado.' });
    res.json(timeline);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/leads/:number/notes', leadsAccess.mutation, (req, res) => {
  try {
    const note = addInternalNote(req.params.number, req.body?.text, { origin: 'dashboard' });
    if (!note) return res.status(404).json({ error: 'Lead nao encontrado.' });
    res.status(201).json(note);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/leads/:number/notes/:noteId', leadsAccess.mutation, (req, res) => {
  const deleted = deleteInternalNote(req.params.number, req.params.noteId, { origin: 'dashboard' });
  if (!deleted) return res.status(404).json({ error: 'Observacao nao encontrada.' });
  res.json({ success: true });
});

app.get('/api/leads/:number', leadsAccess.read, (req, res) => {
  const lead = getLead(req.params.number);
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });
  res.json({ ...lead, reminderState: getReminderState(req.params.number) });
});

app.patch('/api/leads/:number', leadsAccess.mutation, (req, res) => {
  try {
    const updates = sanitizeLeadDashboardUpdates(req.body);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nenhuma alteracao valida.' });
    const updated = updateLead(req.params.number, updates, { origin: 'dashboard' });
    if (!updated) return res.status(404).json({ error: 'Lead nao encontrado' });
    systemStatus.emitSnapshot();
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/leads/:number', leadsAccess.mutation, async (req, res) => {
  if (req.body?.confirmation !== 'delete_one') {
    return res.status(400).json({ error: 'Confirmacao de exclusao invalida.' });
  }
  try {
    const result = await archiveLeads([req.params.number], { origin: 'dashboard' });
    if (!result.deleted && !result.alreadyDeleted) return res.status(404).json({ error: 'Lead nao encontrado' });
    systemStatus.emitSnapshot();
    res.json({ success: true, ...result, overview: getLeadOverview() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('\n===================================');
  console.log('       MoOve IA');
  console.log('===================================');
  console.log(`\nAcesse: http://localhost:${PORT}`);
  console.log('Aguardando conexao WhatsApp...');
  console.log('Modulo IA: pronto\n');
});

void cleanupExpiredTrash().catch((error) => {
  console.warn(`[Leads] Falha ao aplicar a retencao da lixeira: ${error.message}`);
});
const trashRetentionTimer = setInterval(() => {
  void cleanupExpiredTrash().catch((error) => {
    console.warn(`[Leads] Falha ao aplicar a retencao da lixeira: ${error.message}`);
  });
}, 6 * 60 * 60 * 1000);
trashRetentionTimer.unref?.();

let shuttingDown = false;
function shutdownServer(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} recebido. Encerrando pesquisas e servidor HTTP...`);
  adResearch.shutdown();
  server.close(() => process.exit(0));
  const forcedExit = setTimeout(() => process.exit(0), 8_000);
  forcedExit.unref?.();
}

process.once('SIGINT', () => shutdownServer('SIGINT'));
process.once('SIGTERM', () => shutdownServer('SIGTERM'));
