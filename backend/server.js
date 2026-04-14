const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const WhatsAppManager = require('./whatsapp');
const MessageQueue = require('./queue');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 } // 16MB
});

// Core instances
const wa = new WhatsAppManager(wss);
const queue = new MessageQueue(wa, wss);

// Connect WhatsApp on startup
wa.connect();

// Send current state to newly connected WebSocket clients
wss.on('connection', (ws) => {
    // Current WhatsApp state
    const waStatus = wa.getStatus();
    ws.send(JSON.stringify({ type: 'status', status: waStatus.status }));
    if (waStatus.qrCode) {
        ws.send(JSON.stringify({ type: 'qr', qr: waStatus.qrCode }));
    }

    // Current campaign state
    const progress = queue.getProgress();
    ws.send(JSON.stringify({ type: 'campaign_status', status: progress.status }));
    ws.send(JSON.stringify({ type: 'stats', stats: progress.stats }));

    if (progress.queue.length > 0) {
        ws.send(JSON.stringify({
            type: 'campaign_loaded',
            stats: progress.stats,
            queue: progress.queue
        }));
    }

    ws.on('error', console.error);
});

// ── REST API ──────────────────────────────────────────────────────────────────

// WhatsApp status
app.get('/api/status', (req, res) => {
    res.json(wa.getStatus());
});

// Disconnect / reset session
app.post('/api/disconnect', async (req, res) => {
    try {
        await wa.clearSession();
        setTimeout(() => wa.connect(), 1500);
        res.json({ success: true, message: 'Sessão encerrada. Novo QR gerado em breve.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start campaign — accepts multipart/form-data with optional image
app.post('/api/campaign/start', upload.single('image'), (req, res) => {
    try {
        const data = JSON.parse(req.body.data);
        const { numbers, message, scheduleConfig, antiRestriction } = data;

        if (!numbers || numbers.length === 0) {
            return res.status(400).json({ error: 'Lista de contatos vazia' });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'A mensagem não pode ser vazia' });
        }
        if (wa.getStatus().status !== 'connected') {
            return res.status(400).json({ error: 'WhatsApp não está conectado. Escaneie o QR Code primeiro.' });
        }

        const imageBuffer = req.file ? req.file.buffer : null;

        queue.initCampaign({ numbers, message, imageBuffer, scheduleConfig, antiRestriction });
        queue.start();

        res.json({ success: true, message: `Campanha iniciada com ${numbers.length} contato(s)` });

    } catch (err) {
        console.error('[API] Erro ao iniciar campanha:', err);
        res.status(500).json({ error: err.message });
    }
});

// Campaign controls
app.post('/api/campaign/pause', (req, res) => {
    queue.pause();
    res.json({ success: true });
});

app.post('/api/campaign/resume', (req, res) => {
    queue.resume();
    res.json({ success: true });
});

app.post('/api/campaign/stop', (req, res) => {
    queue.stop();
    res.json({ success: true });
});

// Campaign progress
app.get('/api/campaign/progress', (req, res) => {
    res.json(queue.getProgress());
});

// ── Start Server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log('\n╔═══════════════════════════════════╗');
    console.log('║       🤖  ZapBot Pro v1.0         ║');
    console.log('╚═══════════════════════════════════╝');
    console.log(`\n🌐 Acesse: http://localhost:${PORT}`);
    console.log('📱 Aguardando conexão WhatsApp...\n');
});
