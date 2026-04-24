import { EventEmitter } from 'events';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, makeCacheableSignalKeyStore, generateWAMessage, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { inspect } from 'util';
import { createHash } from 'crypto';
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

function hashText(value) {
    return createHash('sha1')
        .update(String(value || ''), 'utf8')
        .digest('hex')
        .slice(0, 12);
}

function compactMessageContent(content = {}) {
    const text = typeof content.text === 'string'
        ? content.text
        : typeof content.caption === 'string'
            ? content.caption
            : '';
    return {
        keys: Object.keys(content || {}),
        textLength: text.length,
        textHash: text ? hashText(text) : '',
        hasImage: !!content.image,
        hasPoll: !!content.poll,
    };
}

function compactOutboundUpdate(item) {
    return {
        at: new Date().toISOString(),
        keyRemoteJid: item?.key?.remoteJid || item?.update?.key?.remoteJid || '',
        keyId: item?.key?.id || item?.update?.key?.id || '',
        participant: item?.key?.participant || item?.participant || '',
        status: item?.update?.status ?? item?.status ?? null,
        error: item?.update?.error?.message || item?.error?.message || item?.update?.error || item?.error || '',
        updateKeys: item?.update ? Object.keys(item.update) : Object.keys(item || {}),
    };
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
        this._authKeys = null;
        this.onMessage = null;
        this._contactMap = new Map();
        this._lidByPhone = new Map();
        this._preferredJidByPhone = new Map();
        this._outboundRecords = new Map();
        this._messageCache = new Map();
        this._recentOutbound = [];
        this._routeStats = { pn: 0, lid: 0, unknown: 0 };
        this._lastInboundRoute = null;
        this._reconnectCount = 0;
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
        this.emit('status-change', this.getStatus());
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

    _getSignalSessionPrefixesForJid(jid) {
        const target = String(jid || '').trim();
        const baseId = toBaseId(target);
        if (!baseId) return [];

        if (target.includes('@hosted.lid')) return [`${baseId}_129.`];
        if (target.includes('@lid')) return [`${baseId}_1.`];
        if (target.includes('@hosted')) return [`${baseId}_128.`];
        return [`${baseId}.`];
    }

    _getSignalSessionPrefixesForTargetInfo(targetInfo) {
        const jids = new Set();
        if (targetInfo?.resolvedJid) jids.add(targetInfo.resolvedJid);
        if (targetInfo?.originalTarget && String(targetInfo.originalTarget).includes('@')) {
            jids.add(targetInfo.originalTarget);
        }
        if (targetInfo?.resolvedPhone) {
            jids.add(WhatsAppManager.buildJid(targetInfo.resolvedPhone));
            const lidJid = this._lidByPhone.get(targetInfo.resolvedPhone);
            if (lidJid) jids.add(lidJid);
        }

        return [...new Set([...jids].flatMap(jid => this._getSignalSessionPrefixesForJid(jid)))];
    }

    _isOwnSignalSessionPrefix(prefix) {
        const ownJids = [
            this.sock?.user?.id,
            this.sock?.user?.lid,
        ].filter(Boolean);

        return ownJids.some(jid => this._getSignalSessionPrefixesForJid(jid).includes(prefix));
    }

    async _hydrateOutboundTarget(targetInfo) {
        if (!this.sock || typeof this.sock.onWhatsApp !== 'function' || !targetInfo?.resolvedPhone) {
            return null;
        }

        const phoneJid = WhatsAppManager.buildJid(targetInfo.resolvedPhone);
        try {
            const [result] = await this.sock.onWhatsApp(phoneJid);
            if (!result?.exists || !result?.jid) return null;
            const existingLid = this._lidByPhone.get(targetInfo.resolvedPhone)
                || (this._preferredJidByPhone.get(targetInfo.resolvedPhone)?.includes('@lid')
                    ? this._preferredJidByPhone.get(targetInfo.resolvedPhone)
                    : null);
            if (result.jid.includes('@lid') || result.jid.includes('@hosted.lid')) {
                this._registerPreferredJidForPhone(targetInfo.resolvedPhone, result.jid, 'onWhatsApp');
            } else if (!existingLid) {
                this._registerPhoneAlias(result.jid, targetInfo.resolvedPhone, 'onWhatsApp:phone');
            }
            console.log(`[WA] onWhatsApp target=${targetInfo.originalTarget} exists=${result.exists} jid=${result.jid}`);
            return result.jid;
        } catch (error) {
            console.warn(`[WA] onWhatsApp failed target=${targetInfo.originalTarget}: ${error.message}`);
            return null;
        }
    }

    async preferStoredLidForTarget(target, options = {}) {
        if (!this._authKeys) return { preferredJid: null, source: 'auth_unavailable' };

        const targetInfo = this.resolveOutboundTarget(target, options);
        if (!targetInfo?.resolvedPhone) return { preferredJid: targetInfo?.resolvedJid || null, source: 'no_phone' };

        const existingLid = this._lidByPhone.get(targetInfo.resolvedPhone)
            || (this._preferredJidByPhone.get(targetInfo.resolvedPhone)?.includes('@lid')
                ? this._preferredJidByPhone.get(targetInfo.resolvedPhone)
                : null);
        if (existingLid) return { preferredJid: existingLid, source: 'memory_lid' };

        try {
            const stored = await this._authKeys.get('lid-mapping', [targetInfo.resolvedPhone]);
            const lidUser = stored?.[targetInfo.resolvedPhone];
            if (!lidUser) return { preferredJid: targetInfo.resolvedJid, source: 'no_stored_lid' };

            const preferredJid = `${lidUser}@lid`;
            this._registerPreferredJidForPhone(targetInfo.resolvedPhone, preferredJid, 'lid-mapping:stored');
            return { preferredJid, source: 'stored_lid' };
        } catch (error) {
            return { preferredJid: targetInfo.resolvedJid, source: 'stored_lid_error', error: error.message };
        }
    }

    async resetSignalSessionsForTarget(target, options = {}) {
        if (!this._authKeys) return { purged: 0, hydratedJid: null, reason: 'auth_unavailable' };

        const targetInfo = this.resolveOutboundTarget(target, options);
        const hydratedJid = await this._hydrateOutboundTarget(targetInfo);
        const hydratedInfo = hydratedJid
            ? this.resolveOutboundTarget(target, options)
            : targetInfo;
        const prefixes = this._getSignalSessionPrefixesForTargetInfo(hydratedInfo);
        if (hydratedInfo?.resolvedPhone) {
            try {
                const stored = await this._authKeys.get('lid-mapping', [hydratedInfo.resolvedPhone]);
                const lidUser = stored?.[hydratedInfo.resolvedPhone];
                if (lidUser) {
                    this._registerPreferredJidForPhone(hydratedInfo.resolvedPhone, `${lidUser}@lid`, 'lid-mapping:stored');
                    prefixes.push(`${lidUser}_1.`);
                    prefixes.push(`${lidUser}_129.`);
                }
            } catch {
                // Best effort only: normal device refresh still runs after this cleanup.
            }
        }

        const safePrefixes = [...new Set(prefixes)]
            .filter(prefix => !this._isOwnSignalSessionPrefix(prefix));

        if (safePrefixes.length === 0) return { purged: 0, hydratedJid };

        let files = [];
        try {
            files = fs.readdirSync(this.authPath);
        } catch {
            return { purged: 0, hydratedJid, reason: 'auth_dir_unavailable' };
        }

        const sessionIds = [];
        for (const file of files) {
            if (!file.startsWith('session-') || !file.endsWith('.json')) continue;
            const sessionId = file.slice('session-'.length, -'.json'.length);
            if (safePrefixes.some(prefix => sessionId.startsWith(prefix))) {
                sessionIds.push(sessionId);
            }
        }

        if (sessionIds.length === 0) return { purged: 0, hydratedJid };

        const payload = {};
        for (const id of sessionIds) payload[id] = null;
        await this._authKeys.set({ session: payload });
        console.warn(`[WA] purged ${sessionIds.length} stale signal session(s) for ${targetInfo.originalTarget}`);
        return { purged: sessionIds.length, hydratedJid };
    }

    async refreshDevicesForTarget(target, options = {}) {
        if (!this.sock || typeof this.sock.getUSyncDevices !== 'function') {
            return { deviceCount: 0, deviceJids: [], hydratedJid: null, reason: 'devices_unavailable' };
        }

        const targetInfo = this.resolveOutboundTarget(target, options);
        const hydratedJid = await this._hydrateOutboundTarget(targetInfo);
        const refreshedInfo = hydratedJid ? this.resolveOutboundTarget(target, options) : targetInfo;
        const lookupJids = new Set();
        if (refreshedInfo.resolvedPhone) lookupJids.add(WhatsAppManager.buildJid(refreshedInfo.resolvedPhone));
        if (refreshedInfo.resolvedJid) lookupJids.add(refreshedInfo.resolvedJid);

        const devices = await this.sock.getUSyncDevices([...lookupJids], false, false);
        const deviceJids = [...new Set(devices.map(device => device.jid).filter(Boolean))];
        if (deviceJids.length && typeof this.sock.assertSessions === 'function') {
            await this.sock.assertSessions(deviceJids, true);
        }

        if (refreshedInfo.resolvedPhone) {
            for (const jid of deviceJids) {
                if (jid.includes('@lid') || jid.includes('@hosted.lid')) {
                    const server = jid.includes('@hosted.lid') ? 'hosted.lid' : 'lid';
                    this._registerPreferredJidForPhone(refreshedInfo.resolvedPhone, `${toBaseId(jid)}@${server}`, 'refreshDevicesForTarget');
                    break;
                }
            }
        }

        console.log(`[WA] refreshed devices target=${targetInfo.originalTarget} count=${deviceJids.length}${hydratedJid ? ` hydrated=${hydratedJid}` : ''}`);
        return { deviceCount: deviceJids.length, deviceJids, hydratedJid };
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

    resolveOutboundTarget(target, options = {}) {
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
            if (options?.forcePhoneJid) {
                return {
                    originalTarget,
                    baseId: normalizedPhone,
                    resolvedJid: WhatsAppManager.buildJid(normalizedPhone),
                    resolvedPhone: normalizedPhone,
                    targetKind: 'phone_forced',
                    resolutionSource: 'forced_phone_input',
                };
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
            resultKey: record.resultKey || null,
            routeOptions: record.routeOptions || null,
            routeLabel: record.routeLabel || '',
            campaignContext: record.campaignContext || null,
            contentSummary: record.contentSummary || null,
            updates: Array.isArray(record.updates) ? record.updates.slice(-8) : [],
            createdAt: record.createdAt,
            acceptedAt: record.acceptedAt || null,
            updatedAt: record.updatedAt || null,
            error: record.error || null,
        };
    }

    _emitOutboundStatus(record) {
        const snapshot = this._snapshotOutbound(record);
        if (!snapshot) return;
        this._recentOutbound.push(snapshot);
        if (this._recentOutbound.length > 12) {
            this._recentOutbound = this._recentOutbound.slice(-12);
        }
        this.emit('outbound-status', snapshot);
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

    _registerAcceptedOutbound(kind, targetInfo, result, meta = {}) {
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
            resultKey: {
                id: result?.key?.id || '',
                remoteJid: result?.key?.remoteJid || '',
                participant: result?.key?.participant || '',
                fromMe: result?.key?.fromMe ?? null,
            },
            routeOptions: meta.routeOptions || null,
            routeLabel: meta.routeLabel || '',
            campaignContext: meta.campaignContext || null,
            contentSummary: meta.contentSummary || null,
            updates: [],
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
            const record = this._outboundRecords.get(messageId);
            record.updates = [...(record.updates || []), compactOutboundUpdate(item)].slice(-12);

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
            const record = this._outboundRecords.get(messageId);
            record.updates = [...(record.updates || []), {
                at: new Date().toISOString(),
                type: 'message-receipt.update',
                keyRemoteJid: item?.key?.remoteJid || '',
                keyId: messageId,
                participant: item?.key?.participant || item?.participant || '',
                receipt: item?.receipt || item?.update || null,
            }].slice(-12);
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
            this._authKeys = authState.keys;
            const latest = await fetchLatestBaileysVersion().catch(() => null);
            const latestVersion = latest?.version || KNOWN_QR_FALLBACK_VERSION;
            const selectedVersion = this._envVersionOverride
                || (this._versionCursor > 0 ? KNOWN_QR_FALLBACK_VERSION : latestVersion);
            const usingEnvOverride = !!this._envVersionOverride && sameVersion(selectedVersion, this._envVersionOverride);
            const versionLabel = stringifyVersion(selectedVersion);
            const attemptState = { sawQr: false };
            this._activeConnectVersion = selectedVersion || null;
            this._latestWebVersion = selectedVersion || null;

            console.log(`[WhatsApp] Baileys ${this._baileysVersionRange} | WA Web ${versionLabel}${usingEnvOverride ? ` (override, latest ${stringifyVersion(latestVersion)})` : ''}`);

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

                    if (statusCode === 405 && !attemptState.sawQr && !this._envVersionOverride && this._versionCursor === 0) {
                        this._versionCursor = 1;
                        details.retryVersion = stringifyVersion(KNOWN_QR_FALLBACK_VERSION);
                        console.warn(`[WhatsApp] Pairing rejected with 405 before QR using ${versionLabel}. Retrying with ${details.retryVersion}...`);
                        this.broadcast({
                            type: 'log',
                            level: 'warning',
                            message: `WhatsApp rejeitou o pareamento antes do QR usando ${versionLabel}. Tentando modo compativel ${details.retryVersion}...`,
                        });
                    } else if (statusCode === 405 && !attemptState.sawQr && !this._envVersionOverride) {
                        shouldReconnect = false;
                        console.error(`[WhatsApp] Pairing blocked before QR even after fallback attempts. Last version: ${versionLabel}`);
                        this.broadcast({
                            type: 'log',
                            level: 'error',
                            message: 'WhatsApp bloqueou a criacao de uma nova sessao antes do QR (erro 405).',
                        });
                    }

                    this.status = 'disconnected';
                    this.qrCode = null;
                    this.sock = null;
                    this.reconnecting = false;
                    if (shouldReconnect) this._reconnectCount += 1;
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
                    const routeKey = addressingMode === 'lid' ? 'lid' : addressingMode === 'pn' ? 'pn' : 'unknown';
                    this._routeStats[routeKey] = (this._routeStats[routeKey] || 0) + 1;
                    this._lastInboundRoute = {
                        remoteJid,
                        remoteJidAlt: remoteJidAlt || '',
                        addressingMode: addressingMode || 'unknown',
                        at: new Date().toISOString(),
                    };
                    this.emit('route-update', {
                        routeStats: { ...this._routeStats },
                        lastInboundRoute: this._lastInboundRoute,
                    });

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

    async _sendTrackedPayload(kind, target, builder, options = {}) {
        if (!this.sock || this.status !== 'connected') {
            throw new Error('WhatsApp nao esta conectado');
        }

        const targetInfo = this.resolveOutboundTarget(target, options);
        const sendMeta = {
            routeOptions: {
                forcePhoneJid: !!options.forcePhoneJid,
                freshDevices: !!options.freshDevices,
                peerPrimary: !!options.peerPrimary,
            },
            routeLabel: options.routeLabel || '',
            campaignContext: options.campaignContext || null,
            contentSummary: compactMessageContent(options.contentForDiagnostics || {}),
        };
        console.log(`[WA] ${kind} targetOriginal=${targetInfo.originalTarget} targetResolved=${targetInfo.resolvedJid} targetKind=${targetInfo.targetKind} route=${sendMeta.routeLabel || 'default'} textLen=${sendMeta.contentSummary.textLength} textHash=${sendMeta.contentSummary.textHash || '-'}`);

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                const result = await builder(targetInfo.resolvedJid);
                const accepted = this._registerAcceptedOutbound(kind, targetInfo, result, sendMeta);
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

    async _sendFreshRelay(jid, content, relayOptions = {}) {
        if (!this.sock || !this.sock.user?.id || typeof this.sock.relayMessage !== 'function') {
            throw new Error('Sock do WhatsApp nao suporta relayMessage neste momento');
        }

        const fullMsg = await generateWAMessage(jid, content, {
            logger: this.logger,
            userJid: this.sock.user.id,
            getProfilePicUrl: this.sock.profilePictureUrl?.bind(this.sock),
            getCallLink: this.sock.createCallLink?.bind(this.sock),
        });

        await this.sock.relayMessage(jid, fullMsg.message, {
            messageId: fullMsg.key.id,
            useUserDevicesCache: relayOptions.useUserDevicesCache,
            useCachedGroupMetadata: relayOptions.useCachedGroupMetadata,
            additionalAttributes: relayOptions.additionalAttributes,
            additionalNodes: relayOptions.additionalNodes,
            statusJidList: relayOptions.statusJidList,
        });

        return fullMsg;
    }

    async _sendPeerPrimaryRelay(jid, content) {
        if (!this.sock || !this.sock.user?.id || typeof this.sock.relayMessage !== 'function') {
            throw new Error('Sock do WhatsApp nao suporta relayMessage direto neste momento');
        }

        const fullMsg = await generateWAMessage(jid, content, {
            logger: this.logger,
            userJid: this.sock.user.id,
            getProfilePicUrl: this.sock.profilePictureUrl?.bind(this.sock),
            getCallLink: this.sock.createCallLink?.bind(this.sock),
        });

        await this.sock.relayMessage(jid, fullMsg.message, {
            messageId: fullMsg.key.id,
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force',
            },
        });

        return fullMsg;
    }

    async sendMessage(number, text, imageBuffer = null, options = {}) {
        const contentForDiagnostics = imageBuffer
            ? { image: true, caption: text || '' }
            : { text: text || '' };
        return this._sendTrackedPayload('message', number, async (jid) => {
            if (options?.peerPrimary && !imageBuffer) {
                return this._sendPeerPrimaryRelay(jid, { text });
            }
            if (options?.freshDevices && !imageBuffer) {
                return this._sendFreshRelay(jid, { text }, { useUserDevicesCache: false });
            }
            if (imageBuffer) {
                return this.sock.sendMessage(jid, {
                    image: Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer),
                    caption: text || '',
                });
            }
            return this.sock.sendMessage(jid, { text });
        }, { ...options, contentForDiagnostics });
    }

    async sendPoll(number, question, options, sendOptions = {}) {
        const cleanOptions = options.filter(o => o && o.trim()).slice(0, 12);
        if (cleanOptions.length < 2) throw new Error('Enquete precisa de pelo menos 2 opcoes');

        return this._sendTrackedPayload('poll', number, async (jid) => {
            if (sendOptions?.peerPrimary) {
                return this._sendPeerPrimaryRelay(jid, {
                    poll: {
                        name: question.substring(0, 255),
                        values: cleanOptions,
                        selectableCount: 1,
                    },
                });
            }

            if (sendOptions?.freshDevices) {
                return this._sendFreshRelay(jid, {
                    poll: {
                        name: question.substring(0, 255),
                        values: cleanOptions,
                        selectableCount: 1,
                    },
                }, { useUserDevicesCache: false });
            }

            return this.sock.sendMessage(jid, {
                poll: {
                    name: question.substring(0, 255),
                    values: cleanOptions,
                    selectableCount: 1,
                },
            });
        }, {
            ...sendOptions,
            contentForDiagnostics: {
                poll: true,
                text: question || '',
            },
        });
    }

    async sendTyping(number, duration = 2500, options = {}) {
        if (!this.sock || this.status !== 'connected') return null;

        let targetInfo;
        try {
            targetInfo = this.resolveOutboundTarget(number, options);
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
        const predominantRoute = Object.entries(this._routeStats)
            .sort((left, right) => right[1] - left[1])[0]?.[0] || 'unknown';
        return {
            status: this.status,
            qrCode: this.qrCode,
            webVersion: this._getVersionLabel(this._activeConnectVersion || this._getCurrentConnectVersion()),
            baileysVersion: this._baileysVersionRange,
            lastDisconnect: this.lastDisconnect,
            reconnectCount: this._reconnectCount,
            routeStats: { ...this._routeStats },
            predominantRoute,
            lastInboundRoute: this._lastInboundRoute,
            recentOutbound: this._recentOutbound.slice(-20).reverse(),
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
        this._authKeys = null;
        this._clearLastDisconnect();
        if (fs.existsSync(this.authPath)) {
            fs.rmSync(this.authPath, { recursive: true, force: true });
        }
        this._broadcastStatus('disconnected');
        this.broadcast({ type: 'log', level: 'info', message: 'Sessao encerrada. Aguardando novo QR Code...' });
    }
}

export default WhatsAppManager;
