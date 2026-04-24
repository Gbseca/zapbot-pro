import { getAllLeads, getLead, saveLead } from './data/leads-manager.js';
import {
    clearActiveCampaign,
    registerActiveCampaign,
    updateActiveCampaignStatus,
} from './campaign-state.js';

const MAX_CONSECUTIVE_FAILURES = 3;
const CAMPAIGN_ROUTE_MODE = String(process.env.WA_CAMPAIGN_ROUTE_MODE || 'phone_first').toLowerCase();

function normalizeCampaignNumber(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return null;
    return digits.startsWith('55') ? digits : `55${digits}`;
}

function createStats(total = 0) {
    return {
        total,
        accepted: 0,
        acceptedUnconfirmed: 0,
        confirmed: 0,
        sent: 0,
        failed: 0,
        pending: total,
        dailyOutboundAttempts: 0,
    };
}

function createFlowState() {
    return {
        windowStartedAt: null,
        sentInWindow: 0,
        nextWindowAt: null,
    };
}

function clampInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function buildAssistantHistoryEntry(content, delivery = {}) {
    return {
        role: 'assistant',
        content,
        ts: Date.now(),
        deliveryStatus: delivery.status || 'confirmed',
        messageId: delivery.messageId || null,
        targetJid: delivery.targetJid || null,
        error: delivery.error || null,
    };
}

class MessageQueue {
    constructor(wa, wss, options = {}) {
        this.wa = wa;
        this.wss = wss;
        this.loadConfig = typeof options.loadConfig === 'function' ? options.loadConfig : () => ({});
        this.onStatusEvent = typeof options.onStatusEvent === 'function' ? options.onStatusEvent : null;
        this.queue = [];
        this.status = 'idle';
        this.currentIndex = 0;
        this.config = null;
        this.timer = null;
        this.stats = createStats(0);
        this.dailySent = 0;
        this.dailyOutboundAttempts = 0;
        this.consecutiveFailures = 0;
        this.flowState = createFlowState();
        this.waitReason = null;
        this.precheck = null;
    }

    setStatusReporter(reporter) {
        this.onStatusEvent = typeof reporter === 'function' ? reporter : null;
    }

    _reportStatusEvent(event = {}) {
        if (!this.onStatusEvent) return;
        this.onStatusEvent({
            scope: 'campaign',
            ts: new Date().toISOString(),
            ...event,
            snapshot: this.getStatusSnapshot(),
        });
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
        this._reportStatusEvent({
            type: 'log',
            severity: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info',
            title: 'Campanha',
            message,
        });
    }

    initCampaign({ numbers, message, imageBuffer, pollEnabled, pollOptions, pollQuestion, scheduleConfig, antiRestriction, precheck }) {
        this.status = 'idle';
        this.currentIndex = 0;
        this.dailySent = 0;
        this.dailyOutboundAttempts = 0;
        this.consecutiveFailures = 0;
        this.flowState = createFlowState();
        this.waitReason = null;
        this.precheck = precheck || null;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.queue = numbers.map(n => ({
            number: n,
            message,
            imageBuffer: imageBuffer || null,
            pollEnabled: pollEnabled || false,
            pollOptions: pollOptions || [],
            pollQuestion: pollQuestion || '',
            status: 'pending',
            sentAt: null,
            error: null,
            messageId: null,
            resolvedTarget: null,
            targetKind: null,
        }));

        this.config = { scheduleConfig, antiRestriction };
        const total = numbers.length;
        this.stats = createStats(total);
        registerActiveCampaign({
            numbers,
            message: String(message || pollQuestion || '').trim(),
            config: this.loadConfig(),
        });

        this.broadcast({
            type: 'campaign_loaded',
            stats: this.stats,
            flowControl: this.getFlowControlSnapshot(),
            waitReason: this.waitReason,
            precheck: this.precheck,
            queue: this.queue.map(q => ({
                number: q.number,
                status: q.status,
                sentAt: q.sentAt,
                error: q.error,
                messageId: q.messageId,
                resolvedTarget: q.resolvedTarget,
                targetKind: q.targetKind,
            })),
        });

        const pollInfo = pollEnabled ? ' + enquete nativa' : '';
        this.log('info', `Campanha carregada com ${total} contatos${pollInfo}.`);
        if (this.precheck?.duplicateCount > 0) {
            this.log('warning', `${this.precheck.duplicateCount} contato(s) duplicado(s) ignorado(s) antes de entrar na fila.`);
        }
        if (this.precheck?.invalidCount > 0) {
            this.log('warning', `${this.precheck.invalidCount} contato(s) ignorado(s) por numero invalido.`);
        }
    }

    clear() {
        if (this.status === 'running') {
            this.log('warning', 'Pare a campanha antes de limpar o historico.');
            return false;
        }
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.queue = [];
        this.currentIndex = 0;
        this.stats = createStats(0);
        this.status = 'idle';
        this.consecutiveFailures = 0;
        this.dailySent = 0;
        this.dailyOutboundAttempts = 0;
        this.flowState = createFlowState();
        this.waitReason = null;
        this.precheck = null;
        clearActiveCampaign('Campanha limpa manualmente.');
        this.broadcast({ type: 'campaign_cleared' });
        this.log('info', 'Historico da fila limpo.');
        return true;
    }

    getRandomDelay(minSec, maxSec) {
        const min = parseInt(minSec, 10) || 20;
        const max = parseInt(maxSec, 10) || 60;
        return Math.floor((Math.random() * (max - min) + min) * 1000);
    }

    getFixedDelay(seconds) {
        return (parseInt(seconds, 10) || 30) * 1000;
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
        return this.dailyOutboundAttempts >= (parseInt(ar.dailyLimit, 10) || 50);
    }

    getFlowControlConfig() {
        const raw = this.config?.scheduleConfig?.flowControl || {};
        const enabled = raw.enabled === true || raw.enabled === 'true';
        const maxContacts = clampInt(raw.maxContacts, 15, 1, 10000);
        const windowMinutes = clampInt(raw.windowMinutes, 10, 1, 1440);
        return {
            enabled,
            maxContacts,
            windowMinutes,
            windowMs: windowMinutes * 60 * 1000,
        };
    }

    refreshFlowWindow(now = Date.now(), createIfMissing = true) {
        const flow = this.getFlowControlConfig();
        if (!flow.enabled) {
            this.flowState = createFlowState();
            return flow;
        }

        if (!this.flowState.windowStartedAt) {
            if (!createIfMissing) return flow;
            this.flowState.windowStartedAt = now;
            this.flowState.sentInWindow = 0;
        }

        if (now - this.flowState.windowStartedAt >= flow.windowMs) {
            this.flowState.windowStartedAt = now;
            this.flowState.sentInWindow = 0;
        }

        this.flowState.nextWindowAt = this.flowState.windowStartedAt + flow.windowMs;
        return flow;
    }

    getFlowWaitMs(now = Date.now()) {
        const flow = this.refreshFlowWindow(now, true);
        if (!flow.enabled) return 0;
        if (this.flowState.sentInWindow < flow.maxContacts) return 0;
        return Math.max(0, this.flowState.nextWindowAt - now);
    }

    recordAcceptedOutboundAttempt(count = 1) {
        const safeCount = Math.max(1, parseInt(count, 10) || 1);
        this.dailyOutboundAttempts += safeCount;
        this.dailySent = this.dailyOutboundAttempts;
        this.stats.dailyOutboundAttempts = this.dailyOutboundAttempts;

        const flow = this.refreshFlowWindow(Date.now(), true);
        if (flow.enabled) {
            this.flowState.sentInWindow += safeCount;
            this.flowState.nextWindowAt = this.flowState.windowStartedAt + flow.windowMs;
        }
    }

    getFlowControlSnapshot() {
        const flow = this.refreshFlowWindow(Date.now(), false);
        if (!flow.enabled) {
            return {
                enabled: false,
                maxContacts: flow.maxContacts,
                windowMinutes: flow.windowMinutes,
                sentInWindow: 0,
                remainingInWindow: null,
                windowStartedAt: null,
                nextWindowAt: null,
                waitMs: 0,
            };
        }

        const now = Date.now();
        const waitMs = this.flowState.windowStartedAt ? this.getFlowWaitMs(now) : 0;
        const remaining = Math.max(0, flow.maxContacts - this.flowState.sentInWindow);
        return {
            enabled: true,
            maxContacts: flow.maxContacts,
            windowMinutes: flow.windowMinutes,
            sentInWindow: this.flowState.sentInWindow,
            remainingInWindow: remaining,
            windowStartedAt: this.flowState.windowStartedAt ? new Date(this.flowState.windowStartedAt).toISOString() : null,
            nextWindowAt: this.flowState.nextWindowAt ? new Date(this.flowState.nextWindowAt).toISOString() : null,
            waitMs,
        };
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

    resolveCampaignSendTarget(item) {
        const normalized = normalizeCampaignNumber(item?.number);
        if (!normalized) {
            return {
                target: item?.number,
                source: 'raw_number',
                normalized: null,
            };
        }

        const lead = getLead(normalized)
            || getAllLeads().find((candidate) => {
                const values = [
                    candidate?.phone,
                    candidate?.displayNumber,
                    candidate?.number,
                ].map(normalizeCampaignNumber).filter(Boolean);
                return values.includes(normalized);
            });
        if (lead?.jid && String(lead.jid).includes('@')) {
            return {
                target: lead.jid,
                source: 'lead_jid',
                normalized,
            };
        }

        return {
            target: item.number,
            source: 'number',
            normalized,
        };
    }

    seedCampaignLead(number, message, delivery = {}) {
        const normalized = normalizeCampaignNumber(number);
        if (!normalized) return;

        const now = new Date().toISOString();
        const existing = getLead(normalized) || {};
        const history = Array.isArray(existing.history) ? [...existing.history] : [];
        const cleanMessage = String(message || '').trim();

        if (cleanMessage) {
            const lastEntry = history[history.length - 1];
            if (!lastEntry || lastEntry.role !== 'assistant' || lastEntry.content !== cleanMessage) {
                history.push(buildAssistantHistoryEntry(cleanMessage, delivery));
            }
        }

        saveLead(normalized, {
            number: normalized,
            displayNumber: existing.displayNumber || normalized,
            phone: existing.phone || normalized,
            name: existing.name || null,
            status: existing.status || 'new',
            history,
            plate: existing.plate || null,
            model: existing.model || null,
            profileCaptured: !!existing.profileCaptured,
            softRefusalSent: !!existing.softRefusalSent,
            jid: existing.jid || null,
            createdAt: existing.createdAt || now,
            lastInteraction: existing.lastInteraction || now,
            followUp1Sent: !!existing.followUp1Sent,
            followUp2Sent: !!existing.followUp2Sent,
            source: existing.source || 'campaign',
            campaignSentAt: now,
            campaignLoopHandled: false,
            lastCampaignMessage: cleanMessage || existing.lastCampaignMessage || '',
        });
    }

    async start() {
        if (this.status === 'running') return;
        if (this.queue.length === 0) {
            this.log('error', 'Nenhum contato na fila.');
            return;
        }
        this.status = 'running';
        this.waitReason = null;
        updateActiveCampaignStatus('running');
        this.broadcast({ type: 'campaign_status', status: 'running' });
        this._reportStatusEvent({ type: 'state', severity: 'info', title: 'Campanha', message: 'Campanha iniciada.' });
        this.log('info', `Campanha iniciada! ${this.stats.total} mensagens na fila.`);
        await this.processNext();
    }

    pause(reason = 'Campanha pausada.') {
        if (this.status !== 'running') return;
        this.status = 'paused';
        if (/limite diario/i.test(reason)) this.waitReason = 'daily_limit';
        else if (!this.waitReason) this.waitReason = null;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        updateActiveCampaignStatus('paused');
        this.broadcast({ type: 'campaign_status', status: 'paused' });
        this._reportStatusEvent({ type: 'state', severity: 'warning', title: 'Campanha', message: reason });
        this.log('warning', reason);
    }

    resume() {
        if (this.status !== 'paused') return;
        this.status = 'running';
        this.consecutiveFailures = 0;
        this.waitReason = null;
        updateActiveCampaignStatus('running');
        this.broadcast({ type: 'campaign_status', status: 'running' });
        this._reportStatusEvent({ type: 'state', severity: 'info', title: 'Campanha', message: 'Campanha retomada.' });
        this.log('info', 'Campanha retomada.');
        this.processNext();
    }

    stop() {
        this.status = 'stopped';
        this.waitReason = null;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        updateActiveCampaignStatus('stopped');
        this.broadcast({ type: 'campaign_status', status: 'stopped' });
        this._reportStatusEvent({ type: 'state', severity: 'warning', title: 'Campanha', message: 'Campanha interrompida pelo usuario.' });
        this.log('warning', 'Campanha interrompida pelo usuario.');
    }

    _syncSentAlias() {
        this.stats.sent = this.stats.confirmed;
        this.stats.dailyOutboundAttempts = this.dailyOutboundAttempts;
    }

    _broadcastStats() {
        this._syncSentAlias();
        this.broadcast({
            type: 'stats',
            stats: this.stats,
            flowControl: this.getFlowControlSnapshot(),
            waitReason: this.waitReason,
        });
    }

    _markConsecutiveFailure(item, status, errorMessage) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures < MAX_CONSECUTIVE_FAILURES || this.status !== 'running') return;

        this.pause(`Falhas seguidas demais (${MAX_CONSECUTIVE_FAILURES}). Campanha pausada para seguranca.`);
        item.error = errorMessage || item.error;
        this.broadcast({
            type: 'queue_update',
            index: this.currentIndex,
            status,
            error: item.error,
            messageId: item.messageId,
            resolvedTarget: item.resolvedTarget,
            targetKind: item.targetKind,
        });
    }

    _normalizeDeliveryResult(acceptedRecords, finalRecords) {
        const lastAccepted = acceptedRecords[acceptedRecords.length - 1] || null;
        const firstProblem = finalRecords.find(record => record.status === 'failed' || record.status === 'delivery_timeout');
        if (firstProblem) {
            const status = firstProblem.status === 'delivery_timeout' ? 'accepted_unconfirmed' : firstProblem.status;
            return {
                status,
                error: firstProblem.error || 'Falha na confirmacao do WhatsApp',
                messageId: firstProblem.messageId || lastAccepted?.messageId || null,
                targetJid: firstProblem.targetResolved || lastAccepted?.resolvedJid || null,
                resolvedTarget: firstProblem.targetResolved || lastAccepted?.resolvedJid || null,
                targetKind: firstProblem.targetKind || lastAccepted?.targetKind || null,
                acceptedAttempts: acceptedRecords.length,
            };
        }

        return {
            status: 'confirmed',
            error: null,
            messageId: lastAccepted?.messageId || null,
            targetJid: lastAccepted?.resolvedJid || null,
            resolvedTarget: lastAccepted?.resolvedJid || null,
            targetKind: lastAccepted?.targetKind || null,
            acceptedAttempts: acceptedRecords.length,
        };
    }

    async _sendCampaignItemOnce(item, text, target, routeOptions = {}) {
        const acceptedRecords = [];
        const hasPoll = item.pollEnabled && item.pollOptions && item.pollOptions.length >= 2;

        if (hasPoll) {
            if (item.imageBuffer) {
                acceptedRecords.push(await this.wa.sendMessage(target, text, item.imageBuffer, routeOptions));
            } else if (text && text.trim()) {
                acceptedRecords.push(await this.wa.sendMessage(target, text, null, routeOptions));
            }

            const pollQ = (item.pollQuestion && item.pollQuestion.trim())
                ? item.pollQuestion.trim()
                : (text.substring(0, 100) || 'Selecione uma opcao:');
            acceptedRecords.push(await this.wa.sendPoll(target, pollQ, item.pollOptions, routeOptions));
        } else {
            acceptedRecords.push(await this.wa.sendMessage(
                target,
                text,
                item.imageBuffer,
                routeOptions
            ));
        }

        const finalRecords = await Promise.all(
            acceptedRecords.map(accepted => this.wa.waitForOutboundFinal(accepted.messageId))
        );

        return this._normalizeDeliveryResult(acceptedRecords, finalRecords);
    }

    async _sendCampaignItem(item, text) {
        const targetInfo = this.resolveCampaignSendTarget(item);
        const target = targetInfo.target;
        const routeMode = CAMPAIGN_ROUTE_MODE;

        if (targetInfo.source === 'lead_jid') {
            this.log('info', `Usando JID salvo do lead para ${item.number}: ${target}.`);
        } else {
            this.log('info', `Modo de rota da campanha para ${item.number}: ${routeMode}.`);
        }

        if (routeMode === 'lid_first' && typeof this.wa.preferStoredLidForTarget === 'function') {
            const preferred = await this.wa.preferStoredLidForTarget(item.number);
            if (preferred?.preferredJid?.includes('@lid')) {
                this.log('info', `Rota LID preferida para ${item.number}: ${preferred.preferredJid}.`);
            }
        }

        if (this.config?.antiRestriction?.typing) {
            this.log('info', `Simulando digitacao para ${item.number}...`);
            await this.wa.sendTyping(target, 2500, targetInfo.source === 'lead_jid' ? {} : { forcePhoneJid: true });
        }

        const routeAttempts = targetInfo.source === 'lead_jid'
            ? [{ label: 'jid salvo do lead', options: {} }]
            : routeMode === 'lid_first'
                ? [
                    { label: 'rota preferida do WhatsApp', options: {} },
                    { label: 'numero real', options: { forcePhoneJid: true } },
                ]
                : [{ label: 'numero real', options: { forcePhoneJid: true } }];

        let acceptedAttempts = 0;
        let lastDelivery = null;

        for (let attemptIndex = 0; attemptIndex < routeAttempts.length; attemptIndex += 1) {
            const attempt = routeAttempts[attemptIndex];
            const isLastAttempt = attemptIndex === routeAttempts.length - 1;
            const routeOptions = {
                ...attempt.options,
                routeLabel: attempt.label,
                campaignContext: {
                    number: item.number,
                    targetSource: targetInfo.source,
                    routeMode,
                },
            };
            if (attemptIndex > 0) {
                this.log('warning', `Tentando rota alternativa (${attempt.label}) para ${item.number}...`);
            }

            let delivery;
            try {
                delivery = await this._sendCampaignItemOnce(item, text, target, routeOptions);
            } catch (err) {
                lastDelivery = {
                    status: 'failed',
                    error: err.message || 'Falha ao enviar pela rota atual',
                    messageId: err.messageId || null,
                    targetJid: err.targetResolved || null,
                    resolvedTarget: err.targetResolved || null,
                    targetKind: err.targetKind || null,
                    acceptedAttempts: 0,
                };

                if (!isLastAttempt) {
                    this.log('warning', `Tentativa "${attempt.label}" falhou para ${item.number}: ${lastDelivery.error}`);
                    continue;
                }

                return { ...lastDelivery, acceptedAttempts };
            }

            acceptedAttempts += delivery.acceptedAttempts || 0;
            lastDelivery = delivery;

            if (delivery.status === 'confirmed') {
                return { ...delivery, acceptedAttempts };
            }

            if (delivery.status === 'accepted_unconfirmed') {
                return { ...delivery, acceptedAttempts };
            }

            if (delivery.status !== 'accepted_unconfirmed' && !isLastAttempt) {
                this.log('warning', `Tentativa "${attempt.label}" nao concluiu para ${item.number}: ${delivery.error || delivery.status}`);
                continue;
            }

            if (delivery.status !== 'accepted_unconfirmed') {
                return { ...delivery, acceptedAttempts };
            }
        }

        return {
            ...lastDelivery,
            acceptedAttempts,
            error: lastDelivery?.error || 'WhatsApp aceitou, mas nenhuma rota confirmou entrega.',
        };
    }

    async processNext() {
        if (this.status !== 'running') return;

        if (this.currentIndex >= this.queue.length) {
            this.status = 'completed';
            this.waitReason = null;
            updateActiveCampaignStatus('completed');
            this.broadcast({ type: 'campaign_status', status: 'completed' });
            this.log('success', `Concluida! Confirmadas: ${this.stats.confirmed} | Sem confirmacao: ${this.stats.acceptedUnconfirmed} | Falhas: ${this.stats.failed}`);
            return;
        }

        if (!this.isInTimeWindow()) {
            this.waitReason = 'time_window';
            this.log('warning', 'Fora da janela de horario. Verificando em 60s...');
            this._broadcastStats();
            this.timer = setTimeout(() => this.processNext(), 60000);
            return;
        }

        if (this.isDailyLimitReached()) {
            this.waitReason = 'daily_limit';
            this.log('warning', 'Limite diario atingido. Campanha pausada.');
            this.pause('Limite diario atingido. Campanha pausada.');
            return;
        }

        const flowWaitMs = this.getFlowWaitMs();
        if (flowWaitMs > 0) {
            this.waitReason = 'flow_control';
            const waitSec = Math.max(1, Math.ceil(flowWaitMs / 1000));
            const nextAt = this.flowState.nextWindowAt
                ? new Date(this.flowState.nextWindowAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : 'em breve';
            this.log('warning', `Aguardando controle de fluxo: proxima janela em ${formatDurationForLog(waitSec)} (${nextAt}).`);
            this._broadcastStats();
            this.timer = setTimeout(() => {
                this.waitReason = null;
                this.processNext();
            }, flowWaitMs);
            return;
        }

        this.waitReason = null;

        const item = this.queue[this.currentIndex];
        item.status = 'sending';
        item.error = null;
        this.broadcast({ type: 'queue_update', index: this.currentIndex, status: 'sending' });

        try {
            let text = this.personalize(item.message, item.number);
            if (this.config?.antiRestriction?.variation && text) {
                text = this.addVariation(text);
            }

            const delivery = await this._sendCampaignItem(item, text);
            item.messageId = delivery.messageId;
            item.resolvedTarget = delivery.resolvedTarget;
            item.targetKind = delivery.targetKind;

            const acceptedAttempts = Math.max(1, delivery.acceptedAttempts || 1);
            this.stats.accepted += acceptedAttempts;
            this.recordAcceptedOutboundAttempt(acceptedAttempts);
            this.stats.pending = Math.max(0, this.stats.pending - 1);
            item.status = 'accepted';
            this.broadcast({
                type: 'queue_update',
                index: this.currentIndex,
                status: 'accepted',
                messageId: item.messageId,
                resolvedTarget: item.resolvedTarget,
                targetKind: item.targetKind,
            });
            this._broadcastStats();

            if (delivery.status !== 'confirmed') {
                item.status = delivery.status;
                item.error = delivery.error;
                if (delivery.status === 'accepted_unconfirmed') {
                    this.stats.acceptedUnconfirmed += 1;
                    this.consecutiveFailures = 0;
                    this.log('warning', `Sem confirmacao para ${item.number}: ${delivery.error}`);
                } else {
                    this.stats.failed += 1;
                    this.log('error', `Falha para ${item.number}: ${delivery.error}`);
                }
                this.broadcast({
                    type: 'queue_update',
                    index: this.currentIndex,
                    status: item.status,
                    error: item.error,
                    messageId: item.messageId,
                    resolvedTarget: item.resolvedTarget,
                    targetKind: item.targetKind,
                });
                if (delivery.status !== 'accepted_unconfirmed') {
                    this._markConsecutiveFailure(item, item.status, item.error);
                }
            } else {
                item.status = 'confirmed';
                item.sentAt = new Date().toISOString();
                this.stats.confirmed += 1;
                this.consecutiveFailures = 0;
                this.seedCampaignLead(item.number, text || item.pollQuestion || '', {
                    status: 'confirmed',
                    messageId: item.messageId,
                    targetJid: item.resolvedTarget,
                });

                this.log('success', `Confirmado para +55 ${item.number}`);
                this.broadcast({
                    type: 'queue_update',
                    index: this.currentIndex,
                    status: 'confirmed',
                    sentAt: item.sentAt,
                    messageId: item.messageId,
                    resolvedTarget: item.resolvedTarget,
                    targetKind: item.targetKind,
                });
            }

        } catch (err) {
            item.status = 'failed';
            item.error = err.message;
            item.messageId = err.messageId || item.messageId || null;
            item.resolvedTarget = err.targetResolved || item.resolvedTarget || null;
            item.targetKind = err.targetKind || item.targetKind || null;
            this.stats.failed += 1;
            this.stats.pending = Math.max(0, this.stats.pending - 1);

            this.log('error', `Falha para ${item.number}: ${err.message}`);
            this.broadcast({
                type: 'queue_update',
                index: this.currentIndex,
                status: 'failed',
                error: err.message,
                messageId: item.messageId,
                resolvedTarget: item.resolvedTarget,
                targetKind: item.targetKind,
            });
            this._markConsecutiveFailure(item, 'failed', err.message);
        }

        this._broadcastStats();
        this.currentIndex += 1;

        if (this.currentIndex >= this.queue.length) {
            await this.processNext();
            return;
        }

        if (this.status === 'running') {
            const sc = this.config.scheduleConfig;
            const delay = sc.intervalMode === 'random'
                ? this.getRandomDelay(sc.intervalMin, sc.intervalMax)
                : this.getFixedDelay(sc.intervalFixed);

            this.log('info', `Aguardando ${(delay / 1000).toFixed(0)}s...`);
            this.timer = setTimeout(() => this.processNext(), delay);
        }
    }

    getStatusSnapshot() {
        const routeKinds = {};
        const recentResolvedTargets = [];

        for (const item of this.queue) {
            if (item.targetKind) {
                routeKinds[item.targetKind] = (routeKinds[item.targetKind] || 0) + 1;
            }
            if (item.resolvedTarget) {
                recentResolvedTargets.push({
                    number: item.number,
                    resolvedTarget: item.resolvedTarget,
                    targetKind: item.targetKind || null,
                    status: item.status,
                });
            }
        }

        const dominantRouteKind = Object.entries(routeKinds)
            .sort((left, right) => right[1] - left[1])[0]?.[0] || '';

        return {
            status: this.status,
            currentIndex: this.currentIndex,
            consecutiveFailures: this.consecutiveFailures,
            waitReason: this.waitReason,
            dailyOutboundAttempts: this.dailyOutboundAttempts,
            precheck: this.precheck,
            stats: { ...this.stats, sent: this.stats.confirmed },
            flowControl: this.getFlowControlSnapshot(),
            routeMode: CAMPAIGN_ROUTE_MODE,
            dominantRouteKind,
            routeKinds,
            recentResolvedTargets: recentResolvedTargets.slice(-5).reverse(),
        };
    }

    getProgress() {
        this._syncSentAlias();
        return {
            status: this.status,
            stats: this.stats,
            queue: this.queue.map(q => ({
                number: q.number,
                status: q.status,
                sentAt: q.sentAt,
                error: q.error,
                messageId: q.messageId,
                resolvedTarget: q.resolvedTarget,
                targetKind: q.targetKind,
            })),
            currentIndex: this.currentIndex,
            waitReason: this.waitReason,
            flowControl: this.getFlowControlSnapshot(),
            precheck: this.precheck,
        };
    }
}

function formatDurationForLog(totalSec) {
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return sec > 0 ? `${min}min ${sec}s` : `${min}min`;
}

export default MessageQueue;
