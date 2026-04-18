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

// Core instances
const wa = new WhatsAppManager(wss);
const queue = new MessageQueue(wa, wss);

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

  ws.on('error', console.error);
});

// ── WhatsApp Routes ───────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => res.json(wa.getStatus()));

app.post('/api/disconnect', async (req, res) => {
  try {
    await wa.clearSession();
    setTimeout(() => wa.connect(), 1500);
    res.json({ success: true, message: 'Sessão encerrada. Novo QR gerado em breve.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Campaign Routes ───────────────────────────────────────────────────────────

app.post('/api/campaign/start', upload.single('image'), (req, res) => {
  try {
    const data = JSON.parse(req.body.data);
    const { numbers, message, pollEnabled, pollOptions, pollQuestion, scheduleConfig, antiRestriction } = data;

    if (!numbers || numbers.length === 0) return res.status(400).json({ error: 'Lista de contatos vazia' });
    if (!message?.trim()) return res.status(400).json({ error: 'A mensagem não pode ser vazia' });
    if (wa.getStatus().status !== 'connected') return res.status(400).json({ error: 'WhatsApp não está conectado.' });

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

// ── AI Config Routes ──────────────────────────────────────────────────────────

app.get('/api/ai/config', (req, res) => {
  const config = loadConfig();
  const safeConfig = { ...config };
  // Mask both keys — never expose full API keys to the browser
  if (safeConfig.groqKey && safeConfig.groqKey.length > 8) {
    safeConfig.groqKeyMasked = safeConfig.groqKey.slice(0, 4) + '...' + safeConfig.groqKey.slice(-4);
    delete safeConfig.groqKey;
  }
  if (safeConfig.geminiKey && safeConfig.geminiKey.length > 8) {
    safeConfig.geminiKeyMasked = safeConfig.geminiKey.slice(0, 4) + '...' + safeConfig.geminiKey.slice(-4);
    delete safeConfig.geminiKey;
  }
  res.json(safeConfig);
});

app.post('/api/ai/config', (req, res) => {
  try {
    const updates = req.body;
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
  const { key, provider } = req.body;
  if (!key) return res.status(400).json({ error: 'Chave não fornecida' });
  const result = await testAPIKey(provider || 'groq', key);
  res.json(result);
});

// ── PDF/Document Routes ───────────────────────────────────────────────────────

app.get('/api/ai/docs', (req, res) => res.json(getUploadedDocs()));

app.post('/api/ai/docs', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Somente PDFs são aceitos' });

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

// ── Leads Routes ──────────────────────────────────────────────────────────────

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
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  res.json(lead);
});

app.patch('/api/leads/:number', (req, res) => {
  const updated = updateLead(req.params.number, req.body);
  if (!updated) return res.status(404).json({ error: 'Lead não encontrado' });
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

// ── Start Server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('\n╔═══════════════════════════════════╗');
  console.log('║       🤖  ZapBot Pro v2.0         ║');
  console.log('╚═══════════════════════════════════╝');
  console.log(`\n🌐 Acesse: http://localhost:${PORT}`);
  console.log('📱 Aguardando conexão WhatsApp...');
  console.log('🤖 Módulo IA: pronto\n');
});
