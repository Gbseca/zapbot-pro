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
import { loadConfig, saveConfig } from './data/config-manager.js';
import { getAllLeads, getLead, updateLead, deleteLead, clearAllLeads, exportLeadsCSV, getLeadStats } from './data/leads-manager.js';
import { extractAndSavePDF, getUploadedDocs, removePDF } from './knowledge/pdf-loader.js';
import { testAPIKey } from './ai/gemini.js';
import { createAdResearchService } from './ad-research/service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

// Core instances
const wa = new WhatsAppManager(wss);
const queue = new MessageQueue(wa, wss, { loadConfig });
const adResearch = createAdResearchService({ loadConfig, broadcast });

// Connect WhatsApp AI message handler
wa.onMessage = handleIncomingMessage;

// Start automation crons
startFollowUpCron(wa);
startDailyReportCron(wa);

// Connect WhatsApp on startup
wa.connect();

// Send current state to newly connected WebSocket clients
wss.on('connection', (ws) => {
  const waStatus = wa.getStatus();
  ws.send(JSON.stringify({ type: 'status', status: waStatus.status }));
  if (waStatus.qrCode) ws.send(JSON.stringify({ type: 'qr', qr: waStatus.qrCode }));

  const progress = queue.getProgress();
  ws.send(JSON.stringify({ type: 'campaign_status', status: progress.status }));
  ws.send(JSON.stringify({ type: 'stats', stats: progress.stats }));
  if (progress.queue.length > 0) {
    ws.send(JSON.stringify({ type: 'campaign_loaded', stats: progress.stats, queue: progress.queue }));
  }

  // Send AI config state
  const config = loadConfig();
  ws.send(JSON.stringify({ type: 'ai_status', enabled: config.aiEnabled }));

  adResearch.listRecentJobs().forEach((job) => {
    ws.send(JSON.stringify({ type: 'ad_research_update', job }));
  });

  ws.on('error', console.error);
});

// â”€â”€ WhatsApp Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/api/status', (req, res) => res.json(wa.getStatus()));

app.post('/api/disconnect', async (req, res) => {
  try {
    await wa.clearSession();
    setTimeout(() => wa.connect(), 1500);
    res.json({ success: true, message: 'SessÃ£o encerrada. Novo QR gerado em breve.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// â”€â”€ Campaign Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.post('/api/campaign/start', upload.single('image'), (req, res) => {
  try {
    const data = JSON.parse(req.body.data);
    const { numbers, message, pollEnabled, pollOptions, pollQuestion, scheduleConfig, antiRestriction } = data;

    if (!numbers || numbers.length === 0) return res.status(400).json({ error: 'Lista de contatos vazia' });
    if (!message?.trim()) return res.status(400).json({ error: 'A mensagem nÃ£o pode ser vazia' });
    if (wa.getStatus().status !== 'connected') return res.status(400).json({ error: 'WhatsApp nÃ£o estÃ¡ conectado.' });

    const imageBuffer = req.file ? req.file.buffer : null;
    queue.initCampaign({ numbers, message, imageBuffer, pollEnabled, pollOptions, pollQuestion, scheduleConfig, antiRestriction });
    queue.start();
    res.json({ success: true, message: `Campanha iniciada com ${numbers.length} contato(s)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaign/pause', (req, res) => { queue.pause(); res.json({ success: true }); });
app.post('/api/campaign/resume', (req, res) => { queue.resume(); res.json({ success: true }); });
app.post('/api/campaign/stop', (req, res) => { queue.stop(); res.json({ success: true }); });
app.get('/api/campaign/progress', (req, res) => res.json(queue.getProgress()));
app.post('/api/campaign/clear', (req, res) => {
  const success = queue.clear();
  success ? res.json({ success: true }) : res.status(400).json({ error: 'Pare a campanha antes de limpar.' });
});

app.post('/api/ad-research/search', (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    const region = String(req.body?.region || '').trim();
    const sort = String(req.body?.sort || 'popular').trim();

    if (!query) return res.status(400).json({ error: 'Informe o nicho ou objetivo da busca.' });

    const job = adResearch.startSearch({ query, region, sort });
    res.status(202).json({ jobId: job.jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ad-research/:jobId', (req, res) => {
  const job = adResearch.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Busca nao encontrada.' });
  res.json(job);
});

// â”€â”€ AI Config Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/api/ai/config', (req, res) => {
  const config = loadConfig();
  const safeConfig = {
    ...config,
    groqKey: '',
    geminiKey: '',
    hasGroqKey: !!config.groqKey,
    hasGeminiKey: !!config.geminiKey,
  };
  if (config.groqKey && config.groqKey.length > 8) {
    safeConfig.groqKeyMasked = config.groqKey.slice(0, 4) + '...' + config.groqKey.slice(-4);
  }
  if (config.geminiKey && config.geminiKey.length > 8) {
    safeConfig.geminiKeyMasked = config.geminiKey.slice(0, 4) + '...' + config.geminiKey.slice(-4);
  }
  res.json(safeConfig);
});

app.post('/api/ai/config', (req, res) => {
  try {
    const updates = req.body;
    if (typeof updates.groqKey === 'string' && !updates.groqKey.trim()) delete updates.groqKey;
    if (typeof updates.geminiKey === 'string' && !updates.geminiKey.trim()) delete updates.geminiKey;
    saveConfig(updates);
    // Notify all clients about AI status change
    wss.clients.forEach(c => {
      if (c.readyState === 1) c.send(JSON.stringify({ type: 'ai_status', enabled: updates.aiEnabled ?? loadConfig().aiEnabled }));
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/test-key', async (req, res) => {
  const { key, provider, model } = req.body;
  const config = loadConfig();
  const selectedProvider = provider || config.aiProvider || 'groq';
  const resolvedKey = String(key || '').trim()
    || (selectedProvider === 'gemini' ? config.geminiKey : config.groqKey);
  if (!resolvedKey) return res.status(400).json({ error: 'Chave nÃ£o fornecida' });
  const result = await testAPIKey(selectedProvider, resolvedKey, model);
  res.json(result);
});

// â”€â”€ PDF/Document Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/api/ai/docs', (req, res) => res.json(getUploadedDocs()));

app.post('/api/ai/docs', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Somente PDFs sÃ£o aceitos' });

    const filename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const result = await extractAndSavePDF(req.file.buffer, filename);
    res.json({ success: true, filename, pages: result.pages, wordCount: result.wordCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ai/docs/:filename', (req, res) => {
  try {
    removePDF(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ Leads Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/api/leads', (req, res) => {
  const { status } = req.query;
  let leads = getAllLeads();
  if (status && status !== 'all') leads = leads.filter(l => l.status === status);
  res.json(leads);
});

app.get('/api/leads/stats', (req, res) => res.json(getLeadStats()));

app.get('/api/leads/export', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads_${Date.now()}.csv"`);
  res.send('\uFEFF' + exportLeadsCSV()); // BOM for Excel compatibility
});

app.get('/api/leads/:number', (req, res) => {
  const lead = getLead(req.params.number);
  if (!lead) return res.status(404).json({ error: 'Lead nÃ£o encontrado' });
  res.json(lead);
});

app.patch('/api/leads/:number', (req, res) => {
  const updated = updateLead(req.params.number, req.body);
  if (!updated) return res.status(404).json({ error: 'Lead nÃ£o encontrado' });
  res.json(updated);
});

app.delete('/api/leads/:number', (req, res) => {
  deleteLead(req.params.number);
  res.json({ success: true });
});

app.post('/api/leads/clear', (req, res) => {
  clearAllLeads();
  res.json({ success: true });
});

// â”€â”€ Start Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('\nâ•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘       ðŸ¤–  ZapBot Pro v2.0         â•‘');
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`\nðŸŒ Acesse: http://localhost:${PORT}`);
  console.log('ðŸ“± Aguardando conexÃ£o WhatsApp...');
  console.log('ðŸ¤– MÃ³dulo IA: pronto\n');
});
