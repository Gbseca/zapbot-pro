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
import { loadConfig, saveConfig, resolveEffectiveAIConfig, maskSecret } from './data/config-manager.js';
import { getAllLeads, getLead, updateLead, deleteLead, clearAllLeads, exportLeadsCSV, getLeadStats } from './data/leads-manager.js';
import { extractAndSavePDF, getUploadedDocs, removePDF } from './knowledge/pdf-loader.js';
import { testAPIKey } from './ai/gemini.js';
import { createAdResearchService } from './ad-research/service.js';
import { createSystemStatusService } from './system-status.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
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
    groqKeySource: effective.groqKeySource,
    geminiKeySource: effective.geminiKeySource,
    hasEffectiveGroqKey: effective.hasEffectiveGroqKey,
    hasEffectiveGeminiKey: effective.hasEffectiveGeminiKey,
    hasEffectiveKey: effective.hasEffectiveKey,
    effectiveKeySource: effective.effectiveKeySource,
    effectiveKeyMasked: maskSecret(effective.effectiveKey),
    effectiveGroqKeyMasked: maskSecret(effective.effectiveGroqKey),
    effectiveGeminiKeyMasked: maskSecret(effective.effectiveGeminiKey),
  };

  return safeConfig;
}

const wa = new WhatsAppManager(wss);
const queue = new MessageQueue(wa, wss, { loadConfig });
const adResearch = createAdResearchService({ loadConfig, broadcast });
const systemStatus = createSystemStatusService({ wa, queue, adResearch, loadConfig, broadcast });

wa.onMessage = handleIncomingMessage;

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
  ws.send(JSON.stringify({ type: 'stats', stats: progress.stats }));
  if (progress.queue.length > 0) {
    ws.send(JSON.stringify({ type: 'campaign_loaded', stats: progress.stats, queue: progress.queue }));
  }

  const config = loadConfig();
  ws.send(JSON.stringify({ type: 'ai_status', enabled: config.aiEnabled }));
  ws.send(JSON.stringify({ type: 'system_status', snapshot: systemStatus.buildSnapshot() }));

  adResearch.listRecentJobs().forEach((job) => {
    ws.send(JSON.stringify({ type: 'ad_research_update', job }));
  });

  ws.on('error', console.error);
});

app.get('/api/status', (req, res) => res.json(wa.getStatus()));
app.get('/api/system/status', (req, res) => res.json(systemStatus.buildSnapshot()));

app.post('/api/system/status/refresh', async (req, res) => {
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

    if (!numbers || numbers.length === 0) return res.status(400).json({ error: 'Lista de contatos vazia' });
    if (!message?.trim()) return res.status(400).json({ error: 'A mensagem nao pode ser vazia' });
    if (wa.getStatus().status !== 'connected') return res.status(400).json({ error: 'WhatsApp nao esta conectado.' });

    const imageBuffer = req.file ? req.file.buffer : null;
    queue.initCampaign({ numbers, message, imageBuffer, pollEnabled, pollOptions, pollQuestion, scheduleConfig, antiRestriction });
    queue.start();
    systemStatus.emitSnapshot();
    res.json({ success: true, message: `Campanha iniciada com ${numbers.length} contato(s)` });
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

app.post('/api/ad-research/search', (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    const region = String(req.body?.region || '').trim();
    const sort = String(req.body?.sort || 'popular').trim();

    if (!query) return res.status(400).json({ error: 'Informe o nicho ou objetivo da busca.' });

    const job = adResearch.startSearch({ query, region, sort });
    systemStatus.emitSnapshot();
    res.status(202).json({ jobId: job.jobId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ad-research/:jobId', (req, res) => {
  const job = adResearch.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Busca nao encontrada.' });
  res.json(job);
});

app.get('/api/ai/config', (req, res) => res.json(buildSafeAIConfig()));

app.post('/api/ai/config', (req, res) => {
  try {
    const updates = { ...req.body };
    if (typeof updates.groqKey === 'string' && !updates.groqKey.trim()) delete updates.groqKey;
    if (typeof updates.geminiKey === 'string' && !updates.geminiKey.trim()) delete updates.geminiKey;
    saveConfig(updates);

    const enabled = updates.aiEnabled ?? loadConfig().aiEnabled;
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'ai_status', enabled }));
      }
    });

    systemStatus.emitSnapshot();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/test-key', async (req, res) => {
  const { key, provider, model } = req.body || {};
  const config = loadConfig();
  const selectedProvider = provider || config.aiProvider || 'groq';
  const effective = resolveEffectiveAIConfig({
    ...config,
    aiProvider: selectedProvider,
    aiModel: model || config.aiModel,
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

app.get('/api/leads', (req, res) => {
  const { status } = req.query;
  let leads = getAllLeads();
  if (status && status !== 'all') leads = leads.filter((lead) => lead.status === status);
  res.json(leads);
});

app.get('/api/leads/stats', (req, res) => res.json(getLeadStats()));

app.get('/api/leads/export', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads_${Date.now()}.csv"`);
  res.send('\uFEFF' + exportLeadsCSV());
});

app.get('/api/leads/:number', (req, res) => {
  const lead = getLead(req.params.number);
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });
  res.json(lead);
});

app.patch('/api/leads/:number', (req, res) => {
  const updated = updateLead(req.params.number, req.body);
  if (!updated) return res.status(404).json({ error: 'Lead nao encontrado' });
  systemStatus.emitSnapshot();
  res.json(updated);
});

app.delete('/api/leads/:number', (req, res) => {
  deleteLead(req.params.number);
  systemStatus.emitSnapshot();
  res.json({ success: true });
});

app.post('/api/leads/clear', (req, res) => {
  clearAllLeads();
  systemStatus.emitSnapshot();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('\n===================================');
  console.log('       ZapBot Pro v2.0');
  console.log('===================================');
  console.log(`\nAcesse: http://localhost:${PORT}`);
  console.log('Aguardando conexao WhatsApp...');
  console.log('Modulo IA: pronto\n');
});
