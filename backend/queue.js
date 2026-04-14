class MessageQueue {
    constructor(wa, wss) {
        this.wa = wa;
        this.wss = wss;
        this.queue = [];
        this.status = 'idle';
        this.currentIndex = 0;
        this.config = null;
        this.timer = null;
        this.stats = { total: 0, sent: 0, failed: 0, pending: 0 };
        this.dailySent = 0;
    }

    broadcast(data) {
        if (!this.wss) return;
        this.wss.clients.forEach(c => {
            if (c.readyState === 1) c.send(JSON.stringify(data));
        });
    }

    log(level, message) {
        const ts = new Date().toLocaleTimeString('pt-BR');
        this.broadcast({ type: 'log', level, message: `[${ts}] ${message}` });
        console.log(`[${level.toUpperCase()}] ${message}`);
    }

    // Inicializa a campanha com suporte a enquetes nativas
    initCampaign({ numbers, message, imageBuffer, pollEnabled, pollOptions, pollQuestion, scheduleConfig, antiRestriction }) {
        this.status = 'idle';
        this.currentIndex = 0;
        this.dailySent = 0;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }

        this.queue = numbers.map(n => ({
            number: n,
            message,
            imageBuffer: imageBuffer || null,
            pollEnabled: pollEnabled || false,
            pollOptions: pollOptions || [],
            pollQuestion: pollQuestion || '',
            status: 'pending',
            sentAt: null,
            error: null
        }));

        this.config = { scheduleConfig, antiRestriction };
        const total = numbers.length;
        this.stats = { total, sent: 0, failed: 0, pending: total };

        this.broadcast({
            type: 'campaign_loaded',
            stats: this.stats,
            queue: this.queue.map(q => ({ number: q.number, status: q.status }))
        });

        const pollInfo = pollEnabled ? ' + enquete nativa' : '';
        this.log('info', `📋 Campanha carregada com ${total} contatos${pollInfo}.`);
    }

    // Limpa toda a fila e redefine estado
    clear() {
        if (this.status === 'running') {
            this.log('warning', '⛔ Pare a campanha antes de limpar o histórico.');
            return false;
        }
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.queue = [];
        this.currentIndex = 0;
        this.stats = { total: 0, sent: 0, failed: 0, pending: 0 };
        this.status = 'idle';
        this.broadcast({ type: 'campaign_cleared' });
        this.log('info', '🗑️ Histórico da fila limpo.');
        return true;
    }

    getRandomDelay(minSec, maxSec) {
        const min = parseInt(minSec) || 20;
        const max = parseInt(maxSec) || 60;
        return Math.floor((Math.random() * (max - min) + min) * 1000);
    }

    getFixedDelay(seconds) {
        return (parseInt(seconds) || 30) * 1000;
    }

    isInTimeWindow() {
        const sc = this.config?.scheduleConfig;
        if (!sc?.useWindow) return true;
        const now = new Date();
        const cur = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = (sc.windowStart || '08:00').split(':').map(Number);
        const [eh, em] = (sc.windowEnd || '20:00').split(':').map(Number);
        return cur >= (sh * 60 + sm) && cur <= (eh * 60 + em);
    }

    isDailyLimitReached() {
        const ar = this.config?.antiRestriction;
        if (!ar?.useLimit) return false;
        return this.dailySent >= (parseInt(ar.dailyLimit) || 50);
    }

    addVariation(text) {
        const chars = ['\u200b', '\u200c', '\u200d'];
        const char = chars[Math.floor(Math.random() * chars.length)];
        const pos = Math.max(1, Math.floor(Math.random() * (text.length - 1)));
        return text.slice(0, pos) + char + text.slice(pos);
    }

    personalize(text, number) {
        return text.replace(/\{\{numero\}\}/gi, number);
    }

    async start() {
        if (this.status === 'running') return;
        if (this.queue.length === 0) {
            this.log('error', '❌ Nenhum contato na fila!');
            return;
        }
        this.status = 'running';
        this.broadcast({ type: 'campaign_status', status: 'running' });
        this.log('info', `🚀 Campanha iniciada! ${this.stats.total} mensagens na fila.`);
        await this.processNext();
    }

    pause() {
        if (this.status !== 'running') return;
        this.status = 'paused';
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.broadcast({ type: 'campaign_status', status: 'paused' });
        this.log('warning', '⏸️ Campanha pausada.');
    }

    resume() {
        if (this.status !== 'paused') return;
        this.status = 'running';
        this.broadcast({ type: 'campaign_status', status: 'running' });
        this.log('info', '▶️ Campanha retomada.');
        this.processNext();
    }

    stop() {
        this.status = 'stopped';
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.broadcast({ type: 'campaign_status', status: 'stopped' });
        this.log('warning', '🛑 Campanha interrompida pelo usuário.');
    }

    async processNext() {
        if (this.status !== 'running') return;

        if (this.currentIndex >= this.queue.length) {
            this.status = 'completed';
            this.broadcast({ type: 'campaign_status', status: 'completed' });
            this.log('success', `🎉 Concluída! ✅ ${this.stats.sent} enviadas | ❌ ${this.stats.failed} falhas`);
            return;
        }

        if (!this.isInTimeWindow()) {
            this.log('warning', '⏰ Fora da janela de horário. Verificando em 60s...');
            this.timer = setTimeout(() => this.processNext(), 60000);
            return;
        }

        if (this.isDailyLimitReached()) {
            this.log('warning', '⚠️ Limite diário atingido. Campanha pausada.');
            this.status = 'paused';
            this.broadcast({ type: 'campaign_status', status: 'paused' });
            return;
        }

        const item = this.queue[this.currentIndex];
        item.status = 'sending';
        this.broadcast({ type: 'queue_update', index: this.currentIndex, status: 'sending' });

        try {
            let text = this.personalize(item.message, item.number);

            if (this.config?.antiRestriction?.variation && text) {
                text = this.addVariation(text);
            }

            if (this.config?.antiRestriction?.typing) {
                this.log('info', `✍️ Simulando digitação para ${item.number}...`);
                await this.wa.sendTyping(item.number);
            }

            const hasPoll = item.pollEnabled && item.pollOptions && item.pollOptions.length >= 2;

            if (hasPoll) {
                // 1. Envia imagem ou texto primeiro (contexto)
                if (item.imageBuffer) {
                    await this.wa.sendMessage(item.number, text, item.imageBuffer);
                } else if (text && text.trim()) {
                    await this.wa.sendMessage(item.number, text, null);
                }
                // 2. Envia a enquete nativa do WhatsApp
                const pollQ = (item.pollQuestion && item.pollQuestion.trim())
                    ? item.pollQuestion.trim()
                    : (text.substring(0, 100) || 'Selecione uma opção:');
                await this.wa.sendPoll(item.number, pollQ, item.pollOptions);
                this.log('info', `📊 Enquete enviada para ${item.number}`);
            } else {
                // Envio normal (texto / imagem)
                await this.wa.sendMessage(item.number, text, item.imageBuffer);
            }

            item.status = 'sent';
            item.sentAt = new Date().toISOString();
            this.stats.sent++;
            this.stats.pending--;
            this.dailySent++;

            this.log('success', `✅ Enviado para +55 ${item.number}`);
            this.broadcast({ type: 'queue_update', index: this.currentIndex, status: 'sent', sentAt: item.sentAt });

        } catch (err) {
            item.status = 'failed';
            item.error = err.message;
            this.stats.failed++;
            this.stats.pending--;

            this.log('error', `❌ Falha para ${item.number}: ${err.message}`);
            this.broadcast({ type: 'queue_update', index: this.currentIndex, status: 'failed', error: err.message });
        }

        this.broadcast({ type: 'stats', stats: this.stats });
        this.currentIndex++;

        if (this.currentIndex >= this.queue.length) {
            await this.processNext();
            return;
        }

        if (this.status === 'running') {
            const sc = this.config.scheduleConfig;
            const delay = sc.intervalMode === 'random'
                ? this.getRandomDelay(sc.intervalMin, sc.intervalMax)
                : this.getFixedDelay(sc.intervalFixed);

            this.log('info', `⏳ Aguardando ${(delay / 1000).toFixed(0)}s...`);
            this.timer = setTimeout(() => this.processNext(), delay);
        }
    }

    getProgress() {
        return {
            status: this.status,
            stats: this.stats,
            queue: this.queue.map(q => ({
                number: q.number,
                status: q.status,
                sentAt: q.sentAt,
                error: q.error
            })),
            currentIndex: this.currentIndex
        };
    }
}

export default MessageQueue;
