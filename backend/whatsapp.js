import { EventEmitter } from 'events';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { inspect } from 'util';
import { AUTH_DIR } from './storage/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 25_000;
const OUTBOUND_RECORD_TTL_MS = 5 * 60 * 1000;
const KNOWN_QR_FALLBACK_VERSION = [2, 3000, 1035194821];

function readBaileysVersionRange() {
    try {
        const pkgPath = path.resolve(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg?.dependencies?.['@whiskeysockets/baileys'] || 'unknown';
    } catch {
        return 'unknown';
    }
}

function parseVersionOverride(raw) {
    const parts = String(raw || '')
        .split(/[^\d]+/)
        .map(part => Number(part))
        .filter(Number.isFinite);

    return parts.length >= 3 ? parts.slice(0, 3) : null;
}

function stringifyVersion(version) {
    return Array.isArray(version) ? version.join('.') : String(version || 'unknown');
}

function sameVersion(a, b) {
    return stringifyVersion(a) === stringifyVersion(b);
}

function toBaseId(value) {
    return String(value || '').split('@')[0].split(':')[0];
}

function normalizePhoneCandidate(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    if (/^55\d{10,11}$/.test(digits)) return digits;
    if (/^\d{10,11}$/.test(digits)) return `55${digits}`;
    return null;
}

function ensureTrackedError(error, extras = {}) {
    const err = error instanceof Error ? error : new Error(String(error || 'Unknown error'));
    Object.entries(extras).forEach(([key, value]) => {
        if (value !== undefined && value !== null) err[key] = value;
    });
    return err;
}

function describeSignalSessionError(error) {
    const dump = inspect(error, { depth: 3 });
    const text = [
        error?.message || '',
        error?.stack || '',
        dump,
    ].join('\n');

    const matched = /closing stale open session|closing session:\s*sessionentry|prekey|sessionentry/i.test(text);
    return { matched, dump };
}

function normalizeListPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload == null) return [];
    return [payload];
}

function createUnresolvedLidError(target) {
    const err = new Error(`Nao foi possivel resolver o numero real para ${target}`);
    err.code = 'UNRESOLVED_LID_TARGET';
    return err;
}

class WhatsAppManager extends EventEmitter {
    constructor(wss) {
        super();
        this.sock = null;
        this.qrCode = null;
        this.status = 'disconnected';
        this.wss = wss;
        this.authPath = AUTH_DIR;
        this.reconnecting = false;
        this.logger = pino({ level: 'silent' });
        this.onMessage = null;
        this._contactMap = new Map();
        this._lidByPhone = new Map();
        this._preferredJidByPhone = new Map();
        this._outboundRecords = new Map();
        this._messageCache = new Map();
        this._baileysVersionRange = readBaileysVersionRange();
        this._latestWebVersion = null;
        this._envVersionOverride = parseVersionOverride(process.env.WA_WEB_VERSION_OVERRIDE);
        this._versionCandidates = this._envVersionOverride
            ? [this._envVersionOverride]
            : [null, KNOWN_QR_FALLBACK_VERSION];
        this._versionCursor = 0;
        this._activeConnectVersion = this._versionCandidates[0] || null;
        this.lastDisconnect = null;
    }

    static buildJid(number) {
        const s = String(number || '');
        if (s.includes('@')) return s;
        const clean = s.replace(/\D/g, '');
        if (clean.startsWith('55')) return `${clean}@s.whatsapp.net`;
        return `55${clean}@s.whatsapp.net`;
    }

    resolvePhone(jid) {
        const baseId = toBaseId(jid);
        if (this._contactMap.has(baseId)) return this._contactMap.get(baseId);
        return normalizePhoneCandidate(baseId) || baseId;
    }

    broadcast(data) {
        if (!this.wss) return;
        this.wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(JSON.stringify(data));
        });
    }

    _getCurrentConnectVersion() {
        return this._versionCandidates[this._versionCursor] ?? null;
    }

    _getVersionLabel(version = this._getCurrentConnectVersion()) {
        return version ? stringifyVersion(version) : 'default-internal-v7';
    }

    _setLastDisconnect(error, extras = {}) {
        const statusCode = extras.statusCode
            ?? error?.output?.statusCode
            ?? error?.statusCode
            ?? null;

        this.lastDisconnect = {
            statusCode,
            message: error?.output?.payload?.message || error?.message || extras.message || '',
            reason: error?.data?.reason || extras.reason || '',
            location: error?.data?.location || extras.location || '',
            failedBeforeQr: !!extras.failedBeforeQr,
            retryVersion: extras.retryVersion || '',
            versionLabel: extras.versionLabel || this._getVersionLabel(this._activeConnectVersion),
            at: new Date().toISOString(),
        };
        return this.lastDisconnect;
    }

    _clearLastDisconnect() {
        this.lastDisconnect = null;
    }

    _broadcastStatus(status = this.status) {
        this.broadcast({ type: 'status', status, details: this.lastDisconnect });
    }

    _registerPhoneAlias(alias, phone, source = 'unknown') {
        const baseAlias = toBaseId(alias);
        const normalizedPhone = normalizePhoneCandidate(phone);
        if (!baseAlias || !normalizedPhone) return false;

        this._contactMap.set(baseAlias, normalizedPhone);
        this._contactMap.set(normalizedPhone, normalizedPhone);
        if (String(alias || '').includes('@lid')) {
            const lidJid = `${baseAlias}@lid`;
            this._lidByPhone.set(normalizedPhone, lidJid);
            this._preferredJidByPhone.set(normalizedPhone, lidJid);
        } else if (!this._preferredJidByPhone.has(normalizedPhone)) {
            this._preferredJidByPhone.set(normalizedPhone, WhatsAppManager.buildJid(normalizedPhone));
        }
        this.emit('contact-map-update', { alias: baseAlias, phone: normalizedPhone, source });
        return true;
    }

    _registerPreferredJidForPhone(phone, jid, source = 'unknown') {
        const normalizedPhone = normalizePhoneCandidate(phone);
        const normalizedJid = String(jid || '').trim();
        if (!normalizedPhone || !normalizedJid.includes('@')) return false;

        this._preferredJidByPhone.set(normalizedPhone, normalizedJid);
        if (normalizedJid.includes('@lid')) {
            this._lidByPhone.set(normalizedPhone, normalizedJid);
        }
        this.emit('contact-map-update', { alias: normalizedJid, phone: normalizedPhone, source });
        return true;
    }

    _extractPhoneCandidates(msg) {
        const rawCandidates = [
            msg?.senderPn,
            msg?.participantPn,
            msg?.key?.participant,
            msg?.participant,
            msg?.key?.remoteJid,
            msg?.key?.remoteJidAlt,
            msg?.message?.extendedTextMessage?.contextInfo?.participant,
            msg?.message?.imageMessage?.contextInfo?.participant,
            msg?.message?.videoMessage?.contextInfo?.participant,
            msg?.message?.documentMessage?.contextInfo?.participant,
        ];

        return [...new Set(rawCandidates.map(normalizePhoneCandidate).filter(Boolean))];
    }

    resolveOutboundTarget(target) {
        const originalTarget = String(target || '').trim();
        if (!originalTarget) {
            const err = new Error('Destino de WhatsApp invalido');
            err.code = 'INVALID_TARGET';
            throw err;
        }

        if (!originalTarget.includes('@')) {
            const normalizedPhone = normalizePhoneCandidate(originalTarget);
            if (!normalizedPhone) {
                const err = new Error(`Numero invalido para envio: ${originalTarget}`);
                err.code = 'INVALID_PHONE_TARGET';
                throw err;
            }
            const preferredJid = this._preferredJidByPhone.get(normalizedPhone) || this._lidByPhone.get(normalizedPhone);
            return {
                originalTarget,
                baseId: normalizedPhone,
                resolvedJid: preferredJid || WhatsAppManager.buildJid(normalizedPhone),
                resolvedPhone: normalizedPhone,
                targetKind: preferredJid?.includes('@lid') ? 'phone_via_lid' : 'phone',
                resolutionSource: preferredJid?.includes('@lid') ? 'phone_preferred_lid' : 'direct_input',
            };
        }

        const baseId = toBaseId(originalTarget);

        if (originalTarget.includes('@lid')) {
            const mappedPhone = this._contactMap.get(baseId) || normalizePhoneCandidate(baseId);
            if (!mappedPhone) throw createUnresolvedLidError(originalTarget);
            this._registerPreferredJidForPhone(mappedPhone, originalTarget, 'resolveOutboundTarget:lid');

            return {
                originalTarget,
                baseId,
                resolvedJid: originalTarget,
                resolvedPhone: mappedPhone,
                targetKind: 'lid',
                resolutionSource: this._contactMap.has(baseId) ? 'contact_lid' : 'inline_lid',
            };
        }

        const normalizedPhone = normalizePhoneCandidate(baseId);
        const preferredJid = normalizedPhone
            ? (this._preferredJidByPhone.get(normalizedPhone) || this._lidByPhone.get(normalizedPhone))
            : null;
        return {
            originalTarget,
            baseId,
            resolvedJid: preferredJid || (normalizedPhone ? WhatsAppManager.buildJid(normalizedPhone) : originalTarget),
            resolvedPhone: normalizedPhone || this._contactMap.get(baseId) || null,
            targetKind: preferredJid?.includes('@lid') ? 'jid_preferred_lid' : (normalizedPhone ? 'jid_phone' : 'jid'),
            resolutionSource: preferredJid?.includes('@lid') ? 'preferred_lid' : (normalizedPhone ? 'jid_digits' : 'full_jid'),
        };
    }

    _snapshotOutbound(record) {
        if (!record) return null;
        return {
            messageId: record.messageId,
            status: record.status,
            kind: record.kind,
            targetOriginal: record.targetOriginal,
            targetResolved: record.targetResolved,
            resolvedPhone: record.resolvedPhone,
            targetKind: record.targetKind,
            resolutionSource: record.resolutionSource,
            ackStatus: record.ackStatus ?? null,
            createdAt: record.createdAt,
            acceptedAt: record.acceptedAt || null,
            updatedAt: record.updatedAt || null,
            error: record.error || null,
        };
    }

    _emitOutboundStatus(record) {
        const snapshot = this._snapshotOutbound(record);
        if (snapshot) this.emit('outbound-status', snapshot);
    }

    _scheduleOutboundCleanup(messageId) {
        const record = this._outboundRecords.get(messageId);
        if (!record) return;

        if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
        record.cleanupTimer = setTimeout(() => {
            const stale = this._outboundRecords.get(messageId);
            if (!stale) return;
            if (stale.timeoutHandle) clearTimeout(stale.timeoutHandle);
            this._outboundRecords.delete(messageId);
            this._messageCache.delete(messageId);
        }, OUTBOUND_RECORD_TTL_MS);
    }

    _finalizeOutbound(messageId, status, extra = {}) {
        const record = this._outboundRecords.get(messageId);
        if (!record) return null;
        if (['confirmed', 'failed', 'delivery_timeout'].includes(record.status)) {
            return this._snapshotOutbound(record);
        }

        record.status = status;
        record.updatedAt = new Date().toISOString();
        if (extra.ackStatus !== undefined) record.ackStatus = extra.ackStatus;
        if (extra.error) record.error = extra.error;
        if (record.timeoutHandle) {
            clearTimeout(record.timeoutHandle);
            record.timeoutHandle = null;
        }

        const snapshot = this._snapshotOutbound(record);
        if (record.resolveFinal) {
            record.resolveFinal(snapshot);
            record.resolveFinal = null;
        }
        this._emitOutboundStatus(record);
        this._scheduleOutboundCleanup(messageId);
        return snapshot;
    }

    _touchOutbound(messageId, extra = {}) {
        const record = this._outboundRecords.get(messageId);
        if (!record) return null;
        Object.assign(record, extra, { updatedAt: new Date().toISOString() });
        this._emitOutboundStatus(record);
        return this._snapshotOutbound(record);
    }

    _registerAcceptedOutbound(kind, targetInfo, result) {
        const messageId = result?.key?.id;
        if (!messageId) {
            const err = new Error('WhatsApp aceitou o envio, mas nao retornou messageId');
            err.code = 'MISSING_MESSAGE_ID';
            throw err;
        }

        const createdAt = new Date().toISOString();
        let resolveFinal;
        const finalPromise = new Promise(resolve => {
            resolveFinal = resolve;
        });

        const record = {
            messageId,
            kind,
            status: 'accepted',
            targetOriginal: targetInfo.originalTarget,
            targetResolved: targetInfo.resolvedJid,
            resolvedPhone: targetInfo.resolvedPhone || null,
            targetKind: targetInfo.targetKind,
            resolutionSource: targetInfo.resolutionSource,
            ackStatus: result?.status ?? null,
            createdAt,
            acceptedAt: createdAt,
            updatedAt: createdAt,
            finalPromise,
            resolveFinal,
            timeoutHandle: setTimeout(() => {
                this._finalizeOutbound(messageId, 'delivery_timeout', {
                    error: `Sem confirmacao do WhatsApp apos ${Math.round(DEFAULT_CONFIRMATION_TIMEOUT_MS / 1000)}s`,
                });
            }, DEFAULT_CONFIRMATION_TIMEOUT_MS),
            cleanupTimer: null,
        };

        this._outboundRecords.set(messageId, record);
        if (result?.message) {
            this._messageCache.set(messageId, result);
        }
        this._emitOutboundStatus(record);

        return {
            messageId,
            resolvedJid: targetInfo.resolvedJid,
            resolvedPhone: targetInfo.resolvedPhone || null,
            targetKind: targetInfo.targetKind,
            resolutionSource: targetInfo.resolutionSource,
            status: 'accepted',
        };
    }

    async waitForOutboundFinal(messageId) {
        const record = this._outboundRecords.get(messageId);
        if (!record) {
            return {
                messageId,
                status: 'failed',
                error: 'Outbound nao encontrado para confirmacao',
            };
        }

        if (['confirmed', 'failed', 'delivery_timeout'].includes(record.status)) {
            return this._snapshotOutbound(record);
        }

        return record.finalPromise;
    }

    _handleMessagesUpdate(payload) {
        for (const item of normalizeListPayload(payload)) {
            const key = item?.key || item?.update?.key;
            const messageId = key?.id;
            if (!messageId || !this._outboundRecords.has(messageId)) continue;

            const statusValue = item?.update?.status ?? item?.status;
            const numericStatus = Number(statusValue);
            const errorMessage = item?.update?.error?.message
                || item?.error?.message
                || item?.update?.error
                || item?.error;

            if (errorMessage) {
                this._finalizeOutbound(messageId, 'failed', {
                    error: String(errorMessage),
                    ackStatus: Number.isFinite(numericStatus) ? numericStatus : undefined,
                });
                continue;
            }

            if (!Number.isFinite(numericStatus)) continue;
            if (numericStatus >= 3) {
                this._finalizeOutbound(messageId, 'confirmed', { ackStatus: numericStatus });
                continue;
            }

            this._touchOutbound(messageId, { ackStatus: numericStatus });
        }
    }

    _handleReceiptUpdate(payload) {
        for (const item of normalizeListPayload(payload)) {
            const messageId = item?.key?.id || item?.id || item?.messageId || item?.update?.key?.id;
            if (!messageId || !this._outboundRecords.has(messageId)) continue;
            this._finalizeOutbound(messageId, 'confirmed', { ackStatus: 3 });
        }
    }

    async connect() {
        if (this.reconnecting) return;
        this.reconnecting = true;
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            const authState = {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, this.logger),
            };
            const selectedVersion = this._getCurrentConnectVersion();
            const usingEnvOverride = !!this._envVersionOverride && sameVersion(selectedVersion, this._envVersionOverride);
            const versionLabel = this._getVersionLabel(selectedVersion);
            const attemptState = { sawQr: false };
            this._activeConnectVersion = selectedVersion || null;
            this._latestWebVersion = selectedVersion || null;

            console.log(`[WhatsApp] Baileys ${this._baileysVersionRange} | WA Web ${versionLabel}${usingEnvOverride ? ' (override)' : ''}`);

            const socketConfig = {
                auth: authState,
                logger: this.logger,
                browser: Browsers.ubuntu('Chrome'),
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                emitOwnEvents: true,
                markOnlineOnConnect: false,
                getMessage: async (key) => {
                    if (!key?.id) return undefined;
                    const cached = this._messageCache.get(key.id);
                    return cached?.message;
                },
            };

            if (selectedVersion) {
                socketConfig.version = selectedVersion;
            }

            this.sock = makeWASocket(socketConfig);

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    try {
                        attemptState.sawQr = true;
                        this.qrCode = await qrcode.toDataURL(qr, { width: 280, margin: 2 });
                        this.status = 'qr_ready';
                        this._clearLastDisconnect();
                        this.broadcast({ type: 'qr', qr: this.qrCode });
                        this._broadcastStatus('qr_ready');
                        console.log('[WhatsApp] QR Code gerado. Aguardando escaneamento...');
                    } catch (e) {
                        console.error('[WhatsApp] Erro ao gerar QR:', e);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    let shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    const details = this._setLastDisconnect(lastDisconnect?.error, {
                        statusCode,
                        failedBeforeQr: !attemptState.sawQr,
                        versionLabel,
                    });

                    if (statusCode === 405 && !attemptState.sawQr && !this._envVersionOverride) {
                        const nextVersion = this._versionCandidates[this._versionCursor + 1];
                        if (nextVersion) {
                            this._versionCursor += 1;
                            details.retryVersion = this._getVersionLabel(nextVersion);
                            console.warn(`[WhatsApp] Pairing rejected with 405 before QR using ${versionLabel}. Retrying with ${details.retryVersion}...`);
                            this.broadcast({
                                type: 'log',
                                level: 'warning',
                                message: `WhatsApp rejeitou o pareamento antes do QR usando ${versionLabel}. Tentando modo compativel ${details.retryVersion}...`,
                            });
                        } else {
                            shouldReconnect = false;
                            console.error(`[WhatsApp] Pairing blocked before QR even after fallback attempts. Last version: ${versionLabel}`);
                            this.broadcast({
                                type: 'log',
                                level: 'error',
                                message: 'WhatsApp bloqueou a criacao de uma nova sessao antes do QR (erro 405).',
                            });
                        }
                    }

                    this.status = 'disconnected';
                    this.qrCode = null;
                    this.sock = null;
                    this.reconnecting = false;
                    this._broadcastStatus('disconnected');
                    if (shouldReconnect) {
                        console.log('[WhatsApp] Reconectando em 3s...');
                        setTimeout(() => this.connect(), 3000);
                    } else {
                        this.broadcast({ type: 'log', level: 'warning', message: 'Sessao encerrada. Reconecte escaneando o QR.' });
                    }
                }

                if (connection === 'open') {
                    this.status = 'connected';
                    this.qrCode = null;
                    this.reconnecting = false;
                    this._clearLastDisconnect();
                    console.log('[WhatsApp] Conectado com sucesso!');
                    this._broadcastStatus('connected');
                    this.broadcast({ type: 'log', level: 'success', message: 'WhatsApp conectado com sucesso!' });
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('contacts.upsert', (contacts) => {
                let mapped = 0;
                for (const contact of contacts) {
                    const phoneJid = contact?.id || '';
                    const lidJid = contact?.lid || '';
                    const phone = normalizePhoneCandidate(phoneJid);
                    const lid = toBaseId(lidJid);

                    if (phone && this._registerPhoneAlias(phone, phone, 'contacts.upsert:phone')) mapped++;
                    if (phone && lid && lid !== phone && this._registerPhoneAlias(lid, phone, 'contacts.upsert:lid')) mapped++;
                    if (phone && lidJid) this._registerPreferredJidForPhone(phone, lidJid, 'contacts.upsert:preferred');
                }
                if (mapped > 0) {
                    console.log(`[WA] Contacts synced: ${mapped} mapped (total in map: ${this._contactMap.size})`);
                }
            });

            this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                for (const msg of messages) {
                    const remoteJid = msg?.key?.remoteJid || '';
                    const remoteJidAlt = msg?.key?.remoteJidAlt || '';
                    const addressingMode = msg?.key?.addressingMode || '';
                    const baseId = toBaseId(remoteJid);
                    for (const phone of this._extractPhoneCandidates(msg)) {
                        this._registerPhoneAlias(baseId, phone, 'messages.upsert');
                        if (remoteJidAlt) this._registerPhoneAlias(remoteJidAlt, phone, 'messages.upsert:remoteJidAlt');
                        if (remoteJid.includes('@lid')) this._registerPreferredJidForPhone(phone, remoteJid, 'messages.upsert:remoteJid');
                        else if (remoteJidAlt.includes('@lid')) this._registerPreferredJidForPhone(phone, remoteJidAlt, 'messages.upsert:remoteJidAlt');
                    }

                    if (remoteJidAlt || addressingMode) {
                        console.log(`[WA] inbound route remoteJid=${remoteJid} remoteJidAlt=${remoteJidAlt || '-'} addressingMode=${addressingMode || '-'}`);
                    }

                    if (this.onMessage) {
                        try {
                            await this.onMessage(this, msg);
                        } catch (err) {
                            console.error('[WhatsApp] onMessage error:', err.message);
                        }
                    }
                }
            });

            this.sock.ev.on('messages.update', (updates) => this._handleMessagesUpdate(updates));
            this.sock.ev.on('message-receipt.update', (updates) => this._handleReceiptUpdate(updates));

        } catch (error) {
            this.reconnecting = false;
            this.status = 'disconnected';
            this._setLastDisconnect(error, {
                message: error.message,
                versionLabel: this._getVersionLabel(this._activeConnectVersion),
            });
            console.error('[WhatsApp] Erro ao conectar:', error.message);
            this._broadcastStatus('disconnected');
            this.broadcast({ type: 'log', level: 'error', message: `Erro de conexao: ${error.message}` });
            setTimeout(() => this.connect(), 5000);
        }
    }

    async _sendTrackedPayload(kind, target, builder) {
        if (!this.sock || this.status !== 'connected') {
            throw new Error('WhatsApp nao esta conectado');
        }

        const targetInfo = this.resolveOutboundTarget(target);
        console.log(`[WA] ${kind} targetOriginal=${targetInfo.originalTarget} targetResolved=${targetInfo.resolvedJid} targetKind=${targetInfo.targetKind}`);

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                const result = await builder(targetInfo.resolvedJid);
                const accepted = this._registerAcceptedOutbound(kind, targetInfo, result);
                console.log(`[WA] ${kind} accepted targetOriginal=${targetInfo.originalTarget} targetResolved=${accepted.resolvedJid} targetKind=${accepted.targetKind} messageId=${accepted.messageId}`);
                return accepted;
            } catch (error) {
                const err = ensureTrackedError(error, {
                    targetOriginal: targetInfo.originalTarget,
                    targetResolved: targetInfo.resolvedJid,
                    targetKind: targetInfo.targetKind,
                    resolvedPhone: targetInfo.resolvedPhone || null,
                });
                const signalSession = describeSignalSessionError(err);
                const errorSummary = {
                    name: err.name || 'Error',
                    code: err.code || null,
                    message: err.message,
                    data: err.data || null,
                    output: err.output?.payload || null,
                    stack: err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : null,
                };

                if (signalSession.matched && attempt < 2) {
                    console.warn(`[WA] ${kind} signal session retry targetOriginal=${targetInfo.originalTarget} targetResolved=${targetInfo.resolvedJid} attempt=${attempt}`, errorSummary);
                    this.broadcast({
                        type: 'log',
                        level: 'warning',
                        message: 'WhatsApp encontrou uma sessao antiga desta conversa e vai tentar reenviar automaticamente.',
                    });
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    continue;
                }

                console.error(`[WA] ${kind} failed targetOriginal=${targetInfo.originalTarget} targetResolved=${targetInfo.resolvedJid} targetKind=${targetInfo.targetKind}`, errorSummary);
                if (signalSession.matched) {
                    this.broadcast({
                        type: 'log',
                        level: 'error',
                        message: 'WhatsApp falhou ao cifrar a mensagem desta conversa (erro de sessao Signal/prekey).',
                    });
                }
                throw err;
            }
        }
    }

    async sendMessage(number, text, imageBuffer = null) {
        return this._sendTrackedPayload('message', number, async (jid) => {
            if (imageBuffer) {
                return this.sock.sendMessage(jid, {
                    image: Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer),
                    caption: text || '',
                });
            }
            return this.sock.sendMessage(jid, { text });
        });
    }

    async sendPoll(number, question, options) {
        const cleanOptions = options.filter(o => o && o.trim()).slice(0, 12);
        if (cleanOptions.length < 2) throw new Error('Enquete precisa de pelo menos 2 opcoes');

        return this._sendTrackedPayload('poll', number, async (jid) => (
            this.sock.sendMessage(jid, {
                poll: {
                    name: question.substring(0, 255),
                    values: cleanOptions,
                    selectableCount: 1,
                },
            })
        ));
    }

    async sendTyping(number, duration = 2500) {
        if (!this.sock || this.status !== 'connected') return null;

        let targetInfo;
        try {
            targetInfo = this.resolveOutboundTarget(number);
        } catch (error) {
            if (error?.code === 'UNRESOLVED_LID_TARGET') {
                console.warn(`[WA] typing skipped targetOriginal=${number} reason=${error.code}`);
                return null;
            }
            throw error;
        }

        try {
            await this.sock.sendPresenceUpdate('composing', targetInfo.resolvedJid);
            await new Promise(r => setTimeout(r, duration));
            await this.sock.sendPresenceUpdate('paused', targetInfo.resolvedJid);
            return targetInfo;
        } catch {
            return null;
        }
    }

    getStatus() {
        return {
            status: this.status,
            qrCode: this.qrCode,
            webVersion: this._getVersionLabel(this._activeConnectVersion || this._getCurrentConnectVersion()),
            baileysVersion: this._baileysVersionRange,
            lastDisconnect: this.lastDisconnect,
        };
    }

    async clearSession() {
        if (this.sock) {
            try { await this.sock.logout(); } catch { /* ignore */ }
            this.sock = null;
        }

        for (const record of this._outboundRecords.values()) {
            if (record.timeoutHandle) clearTimeout(record.timeoutHandle);
            if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
        }
        this._outboundRecords.clear();
        this._messageCache.clear();

        this.status = 'disconnected';
        this.qrCode = null;
        this.reconnecting = false;
        this._clearLastDisconnect();
        if (fs.existsSync(this.authPath)) {
            fs.rmSync(this.authPath, { recursive: true, force: true });
        }
        this._broadcastStatus('disconnected');
        this.broadcast({ type: 'log', level: 'info', message: 'Sessao encerrada. Aguardando novo QR Code...' });
    }
}

export default WhatsAppManager;
