const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

class WhatsAppManager {
    constructor(wss) {
        this.sock = null;
        this.qrCode = null;
        this.status = 'disconnected'; // disconnected | qr_ready | connected
        this.wss = wss;
        this.authPath = path.join(__dirname, 'auth_info');
        this.reconnecting = false;
        this.logger = pino({ level: 'silent' });
    }

    broadcast(data) {
        if (!this.wss) return;
        this.wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(JSON.stringify(data));
            }
        });
    }

    async connect() {
        if (this.reconnecting) return;
        this.reconnecting = true;

        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                auth: state,
                logger: this.logger,
                browser: ['ZapBot Pro', 'Chrome', '120.0.0'],
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
            });

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    try {
                        this.qrCode = await qrcode.toDataURL(qr, { width: 280, margin: 2 });
                        this.status = 'qr_ready';
                        this.broadcast({ type: 'qr', qr: this.qrCode });
                        this.broadcast({ type: 'status', status: 'qr_ready' });
                        console.log('[WhatsApp] QR Code gerado. Aguardando escaneamento...');
                    } catch (e) {
                        console.error('[WhatsApp] Erro ao gerar QR:', e);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    this.status = 'disconnected';
                    this.qrCode = null;
                    this.sock = null;
                    this.reconnecting = false;
                    this.broadcast({ type: 'status', status: 'disconnected' });

                    if (shouldReconnect) {
                        console.log('[WhatsApp] Conexão perdida. Reconectando em 3s...');
                        setTimeout(() => this.connect(), 3000);
                    } else {
                        console.log('[WhatsApp] Sessão encerrada (logout).');
                        this.broadcast({ type: 'log', level: 'warning', message: '⚠️ Sessão do WhatsApp encerrada. Reconecte escaneando o QR.' });
                    }
                }

                if (connection === 'open') {
                    this.status = 'connected';
                    this.qrCode = null;
                    this.reconnecting = false;
                    console.log('[WhatsApp] Conectado com sucesso!');
                    this.broadcast({ type: 'status', status: 'connected' });
                    this.broadcast({ type: 'log', level: 'success', message: '✅ WhatsApp conectado com sucesso!' });
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

        } catch (error) {
            this.reconnecting = false;
            console.error('[WhatsApp] Erro ao conectar:', error.message);
            this.broadcast({ type: 'log', level: 'error', message: `Erro de conexão: ${error.message}` });
            setTimeout(() => this.connect(), 5000);
        }
    }

    async sendMessage(number, text, imageBuffer = null) {
        if (!this.sock || this.status !== 'connected') {
            throw new Error('WhatsApp não está conectado');
        }

        const jid = `55${number}@s.whatsapp.net`;

        if (imageBuffer) {
            await this.sock.sendMessage(jid, {
                image: Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer),
                caption: text || ''
            });
        } else {
            await this.sock.sendMessage(jid, { text });
        }
    }

    async sendTyping(number, duration = 2500) {
        if (!this.sock || this.status !== 'connected') return;
        const jid = `55${number}@s.whatsapp.net`;
        try {
            await this.sock.sendPresenceUpdate('composing', jid);
            await new Promise(r => setTimeout(r, duration));
            await this.sock.sendPresenceUpdate('paused', jid);
        } catch (e) {
            // Ignora erros de typing silenciosamente
        }
    }

    getStatus() {
        return { status: this.status, qrCode: this.qrCode };
    }

    async clearSession() {
        if (this.sock) {
            try { await this.sock.logout(); } catch (e) { /* ignora */ }
            this.sock = null;
        }
        this.status = 'disconnected';
        this.qrCode = null;
        this.reconnecting = false;
        if (fs.existsSync(this.authPath)) {
            fs.rmSync(this.authPath, { recursive: true, force: true });
        }
        this.broadcast({ type: 'status', status: 'disconnected' });
        this.broadcast({ type: 'log', level: 'info', message: '🔄 Sessão encerrada. Aguardando novo QR Code...' });
    }
}

module.exports = WhatsAppManager;
