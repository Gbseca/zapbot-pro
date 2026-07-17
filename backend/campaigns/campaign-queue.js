import { randomUUID } from 'crypto';
import { getAllLeads, getLead, saveLead } from '../data/leads-manager.js';
import { upsertLidPhoneMapping } from '../data/lid-phone-map-repository.js';
import { findActiveConsultant } from '../data/consultants-repository.js';
import {
  clearActiveCampaign,
  registerActiveCampaign,
  updateActiveCampaignStatus,
} from '../campaign-state.js';
import { campaignStore as defaultCampaignStore } from './campaign-store.js';
import {
  normalizeCampaignPhone,
  normalizeContentBlocks,
  prepareCampaignAudience,
  renderCampaignText,
} from './campaign-validation.js';

const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

function fullPhone(value) {
  const local = normalizeCampaignPhone(value);
  return local ? `55${local}` : null;
}

function localPhone(value) {
  return normalizeCampaignPhone(value);
}

function createStats(total = 0) {
  return {
    total,
    accepted: 0,
    acceptedUnconfirmed: 0,
    confirmed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    pending: total,
    payloadsAccepted: 0,
    dailyOutboundAttempts: 0,
  };
}

function createFlowState() {
  return { windowStartedAt: null, sentInWindow: 0, nextWindowAt: null };
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeTimezone(value) {
  const timezone = String(value || 'America/Sao_Paulo');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'America/Sao_Paulo';
  }
}

function zonedParts(timestamp, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[values.weekday] ?? 0,
    minutes: (Number(values.hour) * 60) + Number(values.minute),
    dateKey: `${values.year}-${values.month}-${values.day}`,
  };
}

function timeToMinutes(value, fallback) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? (Number(match[1]) * 60) + Number(match[2]) : fallback;
}

function isInsideDeliveryWindow(delivery = {}, timestamp = Date.now()) {
  const parts = zonedParts(timestamp, delivery.timezone);
  const weekdays = Array.isArray(delivery.allowedWeekdays) ? delivery.allowedWeekdays.map(Number) : [1, 2, 3, 4, 5];
  if (!weekdays.includes(parts.weekday)) return false;
  if (!delivery.useWindow) return true;
  const start = timeToMinutes(delivery.windowStart, 8 * 60);
  const end = timeToMinutes(delivery.windowEnd, 20 * 60);
  if (start === end) return true;
  return start < end
    ? parts.minutes >= start && parts.minutes <= end
    : parts.minutes >= start || parts.minutes <= end;
}

function waitUntilDeliveryWindow(delivery = {}, timestamp = Date.now()) {
  if (isInsideDeliveryWindow(delivery, timestamp)) return 0;
  const minute = 60 * 1000;
  const aligned = timestamp - (timestamp % minute) + minute;
  for (let offset = 0; offset <= 8 * 24 * 60; offset += 1) {
    const candidate = aligned + (offset * minute);
    if (isInsideDeliveryWindow(delivery, candidate)) return Math.max(1000, candidate - timestamp);
  }
  return 60 * minute;
}

function buildAssistantHistoryEntry(content, delivery = {}) {
  return {
    role: 'assistant',
    content,
    ts: Date.now(),
    deliveryStatus: delivery.status || 'accepted',
    messageId: delivery.messageId || null,
    targetJid: delivery.targetJid || null,
    error: delivery.error || null,
  };
}

function summarizeBlocks(blocks = []) {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'poll') return `${block.question}\n${(block.options || []).join(' | ')}`;
    return block.caption || `[${block.type}]`;
  }).filter(Boolean).join('\n\n').trim();
}

function normalizeFinalRecord(record = {}) {
  if (record.status === 'confirmed') return { ...record, status: 'confirmed', error: null };
  if (record.status === 'delivery_timeout' || record.status === 'accepted_unconfirmed') {
    return { ...record, status: 'accepted_unconfirmed', error: record.error || 'Envio aceito sem confirmacao de entrega.' };
  }
  return { ...record, status: 'failed', error: record.error || 'Falha ao enviar pelo WhatsApp.' };
}

function rebuildRecipientStats(queue = [], previous = {}) {
  const stats = createStats(queue.length);
  for (const item of queue) {
    if (item.status === 'pending' || item.status === 'sending') continue;
    stats.pending = Math.max(0, stats.pending - 1);
    if (['accepted', 'accepted_unconfirmed', 'confirmed', 'partial_failed'].includes(item.status)) stats.accepted += 1;
    if (item.status === 'confirmed') stats.confirmed += 1;
    if (item.status === 'accepted_unconfirmed' || item.status === 'accepted') stats.acceptedUnconfirmed += 1;
    if (item.status === 'failed' || item.status === 'partial_failed') stats.failed += 1;
    if (item.status === 'skipped') stats.skipped += 1;
  }
  stats.payloadsAccepted = Math.max(
    Number(previous.payloadsAccepted) || 0,
    queue.flatMap(item => item.blockResults || []).filter(result => ['accepted', 'accepted_unconfirmed', 'confirmed'].includes(result?.status)).length,
  );
  stats.dailyOutboundAttempts = Number(previous.dailyOutboundAttempts) || 0;
  stats.sent = stats.confirmed;
  return stats;
}

export default class CampaignQueue {
  constructor(wa, wss, options = {}) {
    this.wa = wa;
    this.wss = wss;
    this.loadConfig = typeof options.loadConfig === 'function' ? options.loadConfig : () => ({});
    this.store = options.campaignStore || defaultCampaignStore;
    this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
    this.setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout;
    this.clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout;
    this.onStatusEvent = typeof options.onStatusEvent === 'function' ? options.onStatusEvent : null;
    this.getAllLeads = options.leads?.getAll || getAllLeads;
    this.getLead = options.leads?.get || getLead;
    this.saveLead = options.leads?.save || saveLead;
    this.findActiveConsultant = options.findActiveConsultant || findActiveConsultant;
    this.upsertLidPhoneMapping = options.upsertLidPhoneMapping || upsertLidPhoneMapping;
    this.queue = [];
    this.status = 'idle';
    this.currentIndex = 0;
    this.campaignId = null;
    this.campaign = null;
    this.timer = null;
    this.stats = createStats(0);
    this.flowState = createFlowState();
    this.waitReason = null;
    this.precheck = null;
    this.consecutiveFailures = 0;
    this.runtimeMeta = {};
    this._restorePersistentCampaign();
  }

  setStatusReporter(reporter) {
    this.onStatusEvent = typeof reporter === 'function' ? reporter : null;
  }

  _reportStatusEvent(event = {}) {
    if (!this.onStatusEvent) return;
    this.onStatusEvent({
      scope: 'campaign',
      ts: new Date(this.clock()).toISOString(),
      ...event,
      snapshot: this.getStatusSnapshot(),
    });
  }

  broadcast(data) {
    if (!this.wss) return;
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(JSON.stringify(data));
    });
  }

  log(level, message) {
    const ts = new Date(this.clock()).toLocaleTimeString('pt-BR');
    this.broadcast({ type: 'log', level, message: `[${ts}] ${message}` });
    console.log(`[${String(level).toUpperCase()}] ${message}`);
    this._reportStatusEvent({
      type: 'log',
      severity: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info',
      title: 'Campanha',
      message,
    });
  }

  _clearTimer() {
    if (!this.timer) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  _schedule(callback, delayMs) {
    this._clearTimer();
    const safeDelay = Math.max(25, Math.min(MAX_TIMER_MS, Number(delayMs) || 25));
    this.timer = this.setTimer(() => {
      this.timer = null;
      callback();
    }, safeDelay);
  }

  _runtimeSnapshot() {
    return {
      ...this.runtimeMeta,
      currentIndex: this.currentIndex,
      waitReason: this.waitReason,
      queue: this.queue,
      stats: this.stats,
      flowState: this.flowState,
      consecutiveFailures: this.consecutiveFailures,
      restoredAt: this.runtimeMeta.restoredAt || null,
    };
  }

  _persist(event = null) {
    if (!this.campaignId) return;
    this.campaign = this.store.updateCampaign(this.campaignId, {
      status: this.status,
      runtime: this._runtimeSnapshot(),
      launchedAt: this.campaign?.launchedAt || (this.status !== 'draft' ? new Date(this.clock()).toISOString() : null),
    }, event ? { event } : {});
  }

  _restorePersistentCampaign() {
    const campaign = this.store.getRecoverableCampaign();
    if (!campaign) return;
    this._hydrate(campaign, { preserveRuntime: true });
    const wasScheduled = campaign.status === 'scheduled';
    const now = this.clock();
    const scheduledAt = new Date(campaign.delivery?.scheduledAt || 0).getTime();

    for (const item of this.queue) {
      if (item.status !== 'sending' && item.status !== 'accepted') continue;
      item.status = 'accepted_unconfirmed';
      item.error = 'O servidor reiniciou durante este envio. O contato nao sera reenviado automaticamente.';
      item.acceptedAt = item.acceptedAt || new Date(now).toISOString();
    }
    this.stats = rebuildRecipientStats(this.queue, this.stats);

    this.runtimeMeta.restoredAt = new Date(now).toISOString();
    if (wasScheduled && scheduledAt > now) {
      this.status = 'scheduled';
      this.waitReason = 'scheduled_start';
      this._persist({ type: 'restored', message: 'Agendamento restaurado depois da reinicializacao.' });
      this._schedule(() => this._activateScheduled(), scheduledAt - now);
      return;
    }

    this.status = 'recovering';
    this.waitReason = 'restart_recovery';
    this._persist({
      level: 'warning',
      type: 'recovery_required',
      message: 'Campanha restaurada pausada para revisao. Envios incertos nao serao repetidos.',
    });
  }

  _hydrate(campaign, { preserveRuntime = false } = {}) {
    this._clearTimer();
    this.campaign = campaign;
    this.campaignId = campaign.id;
    this.precheck = campaign.audience?.precheck || null;
    const runtime = campaign.runtime || {};
    const prepared = prepareCampaignAudience({
      recipients: campaign.audience?.recipients || [],
      isSuppressed: phone => this.store.isSuppressed(phone),
    });
    const canReuse = preserveRuntime && Array.isArray(runtime.queue) && runtime.queue.length > 0;
    this.queue = canReuse
      ? runtime.queue.map(item => ({ ...item, blockResults: Array.isArray(item.blockResults) ? item.blockResults : [] }))
      : prepared.validRecipients.map(recipient => this._createQueueItem(recipient));
    this.currentIndex = canReuse ? Math.max(0, Number(runtime.currentIndex) || 0) : 0;
    this.stats = canReuse ? { ...createStats(this.queue.length), ...(runtime.stats || {}) } : createStats(this.queue.length);
    this.flowState = canReuse ? { ...createFlowState(), ...(runtime.flowState || {}) } : createFlowState();
    this.consecutiveFailures = canReuse ? Math.max(0, Number(runtime.consecutiveFailures) || 0) : 0;
    this.waitReason = canReuse ? runtime.waitReason || null : null;
    this.runtimeMeta = {
      startedAt: runtime.startedAt || null,
      pausedAt: runtime.pausedAt || null,
      completedAt: runtime.completedAt || null,
      restoredAt: runtime.restoredAt || null,
    };
    this.status = campaign.status || 'draft';
  }

  _createQueueItem(recipient) {
    return {
      id: randomUUID(),
      recipient,
      number: recipient.phone,
      normalizedNumber: fullPhone(recipient.phone),
      status: 'pending',
      variantId: null,
      blockResults: [],
      acceptedAt: null,
      sentAt: null,
      error: null,
      messageId: null,
      resolvedTarget: null,
      targetKind: null,
      contextError: null,
    };
  }

  loadCampaign(campaignId, { preserveRuntime = false, precheck = null } = {}) {
    if (this.status === 'running' || this.status === 'scheduled') {
      throw new Error('Pare a campanha atual antes de carregar outra.');
    }
    if (this.campaignId && this.campaignId !== campaignId && ['paused', 'recovering'].includes(this.status)) {
      this.store.updateCampaign(this.campaignId, { status: 'stopped' }, {
        event: { level: 'warning', type: 'replaced', message: 'Campanha retirada da fila para carregar outro rascunho.' },
      });
    }
    const campaign = this.store.getCampaign(campaignId);
    if (!campaign) throw new Error('Campanha nao encontrada.');
    this._hydrate(campaign, { preserveRuntime });
    if (precheck) {
      this.precheck = precheck;
      this.campaign = this.store.updateCampaign(campaign.id, {
        audience: { precheck },
      });
    }
    if (!preserveRuntime) {
      this.status = 'draft';
      this._applyFrequencyCap();
      this._persist({ type: 'loaded', message: 'Campanha carregada na fila.' });
    }
    this._broadcastLoaded();
    return this.getProgress();
  }

  initCampaign(input = {}) {
    if (input.campaignId) return this.loadCampaign(input.campaignId, { precheck: input.precheck || null });

    const recipients = (input.recipients || input.numbers || []).map(value => (
      typeof value === 'object' ? value : { phone: value, fields: {} }
    ));
    const delivery = {
      intervalMode: input.scheduleConfig?.intervalMode || 'random',
      intervalFixed: Number(input.scheduleConfig?.intervalFixed) || 45,
      intervalMin: Number(input.scheduleConfig?.intervalMin) || 30,
      intervalMax: Number(input.scheduleConfig?.intervalMax) || 90,
      useWindow: input.scheduleConfig?.useWindow === true,
      windowStart: input.scheduleConfig?.windowStart || '08:00',
      windowEnd: input.scheduleConfig?.windowEnd || '20:00',
      flowControl: input.scheduleConfig?.flowControl || { enabled: true, maxContacts: 15, windowMinutes: 10 },
      dailyLimit: {
        enabled: input.antiRestriction?.useLimit === true,
        max: Number(input.antiRestriction?.dailyLimit) || 50,
      },
      typing: input.antiRestriction?.typing !== false,
    };
    const blocks = [{ id: randomUUID(), type: 'text', enabled: true, text: String(input.message || '') }];
    const campaign = this.store.createCampaign({
      name: input.name || `Campanha ${new Date(this.clock()).toLocaleDateString('pt-BR')}`,
      objective: input.objective || 'Gerar conversas',
      intent: input.intent || 'sales',
      audience: {
        recipients,
        source: 'manual',
        consentConfirmed: input.consentConfirmed === true,
        consentSource: String(input.consentSource || ''),
        consentAt: input.consentConfirmed === true ? new Date(this.clock()).toISOString() : null,
        precheck: input.precheck || null,
      },
      content: { message: String(input.message || ''), blocks },
      delivery,
    });

    if (input.imageBuffer) {
      const media = this.store.saveMedia(campaign.id, {
        buffer: input.imageBuffer,
        originalname: input.imageName || 'imagem-campanha.jpg',
        mimetype: input.imageMimeType || 'image/jpeg',
        kind: 'image',
      });
      blocks.push({ id: randomUUID(), type: 'image', enabled: true, mediaId: media.id, caption: '' });
    }
    if (input.pollEnabled && Array.isArray(input.pollOptions) && input.pollOptions.length >= 2) {
      blocks.push({
        id: randomUUID(),
        type: 'poll',
        enabled: true,
        question: String(input.pollQuestion || input.message || 'Escolha uma opcao:'),
        options: input.pollOptions,
        selectableCount: 1,
      });
    }
    this.store.updateCampaign(campaign.id, { content: { message: String(input.message || ''), blocks } });
    return this.loadCampaign(campaign.id, { precheck: input.precheck || null });
  }

  _applyFrequencyCap() {
    const cap = this.campaign?.delivery?.frequencyCap || {};
    if (!cap.enabled) return;
    const days = clampInt(cap.days, 7, 1, 365);
    const max = clampInt(cap.max, 2, 1, 100);
    const since = new Date(this.clock() - (days * 24 * 60 * 60 * 1000)).toISOString();
    for (const item of this.queue) {
      if (this.store.getRecentRecipientSends(item.number, since).length < max) continue;
      item.status = 'skipped';
      item.error = `Limite de frequencia: ${max} campanha(s) em ${days} dia(s).`;
      this.stats.skipped += 1;
      this.stats.pending = Math.max(0, this.stats.pending - 1);
    }
  }

  _selectVariant(recipient) {
    const content = this.campaign?.content || {};
    const variants = Array.isArray(content.variants)
      ? content.variants.filter(variant => variant && variant.enabled !== false && (variant.message || variant.blocks?.length))
      : [];
    if (content.variantMode === 'single' || !variants.length) return null;
    const choices = [{ id: 'original', weight: 1, blocks: content.blocks, message: content.message }, ...variants];
    const weighted = choices.flatMap(choice => Array.from({ length: clampInt(choice.weight, 1, 1, 100) }, () => choice));
    return weighted[stableHash(recipient.phone) % weighted.length] || null;
  }

  _blocksForItem(item) {
    const content = this.campaign?.content || {};
    const variant = this._selectVariant(item.recipient);
    item.variantId = variant?.id || 'original';
    const sourceContent = variant
      ? { ...content, message: variant.message || '', blocks: variant.blocks || (variant.message ? [] : content.blocks) }
      : content;
    let blocks = normalizeContentBlocks(sourceContent).filter(block => block.enabled !== false);
    if (!blocks.length && sourceContent.message) {
      blocks = [{ id: 'message', type: 'text', enabled: true, text: sourceContent.message }];
    }
    blocks = blocks.map((block) => {
      const rendered = { ...block };
      if (block.type === 'text') rendered.text = renderCampaignText(block.text, item.recipient, content.variableDefaults).text;
      if (['image', 'video', 'document'].includes(block.type)) {
        rendered.caption = renderCampaignText(block.caption, item.recipient, content.variableDefaults).text;
      }
      if (block.type === 'poll') {
        rendered.question = renderCampaignText(block.question, item.recipient, content.variableDefaults).text;
        rendered.options = block.options.map(option => renderCampaignText(option, item.recipient, content.variableDefaults).text).filter(Boolean);
      }
      return rendered;
    });

    if (content.appendOptOut !== false) {
      const optOut = renderCampaignText(content.optOutText || 'Para nao receber novas mensagens, responda SAIR.', item.recipient, content.variableDefaults).text;
      const lastTextIndex = blocks.map(block => block.type).lastIndexOf('text');
      if (lastTextIndex >= 0) blocks[lastTextIndex].text = `${blocks[lastTextIndex].text.trim()}\n\n${optOut}`.trim();
      else blocks.push({ id: 'opt-out', type: 'text', enabled: true, text: optOut });
    }
    return blocks;
  }

  _broadcastLoaded() {
    this.broadcast({
      type: 'campaign_loaded',
      campaignId: this.campaignId,
      campaign: this.campaign ? {
        id: this.campaign.id,
        name: this.campaign.name,
        objective: this.campaign.objective,
        status: this.status,
      } : null,
      stats: this.stats,
      flowControl: this.getFlowControlSnapshot(),
      waitReason: this.waitReason,
      precheck: this.precheck,
      queue: this._publicQueue(),
    });
  }

  _publicQueue() {
    return this.queue.map(item => ({
      id: item.id,
      number: item.number,
      name: item.recipient?.fields?.nome || '',
      normalizedNumber: item.normalizedNumber,
      status: item.status,
      variantId: item.variantId,
      sentAt: item.sentAt,
      acceptedAt: item.acceptedAt,
      error: item.error,
      messageId: item.messageId,
      resolvedTarget: item.resolvedTarget,
      targetKind: item.targetKind,
      contextError: item.contextError || null,
      blockResults: item.blockResults,
    }));
  }

  _broadcastQueueItem(index) {
    const item = this.queue[index];
    if (!item) return;
    this.broadcast({ type: 'queue_update', index, ...this._publicQueue()[index] });
  }

  _syncSentAlias() {
    this.stats.sent = this.stats.confirmed;
    this.stats.dailyOutboundAttempts = this.store.getDailyUsage(this._dateKey());
  }

  _broadcastStats() {
    this._syncSentAlias();
    this.broadcast({
      type: 'stats',
      stats: this.stats,
      flowControl: this.getFlowControlSnapshot(),
      waitReason: this.waitReason,
      campaignId: this.campaignId,
    });
  }

  _dateKey() {
    return zonedParts(this.clock(), this.campaign?.delivery?.timezone).dateKey;
  }

  _dailyLimitReached(payloads = 1) {
    const daily = this.campaign?.delivery?.dailyLimit || {};
    if (!daily.enabled) return false;
    const used = this.store.getDailyUsage(this._dateKey());
    return used + Math.max(1, payloads) > clampInt(daily.max, 50, 1, 100000);
  }

  getFlowControlConfig() {
    const raw = this.campaign?.delivery?.flowControl || {};
    return {
      enabled: raw.enabled === true || raw.enabled === 'true',
      maxContacts: clampInt(raw.maxContacts, 15, 1, 10000),
      windowMinutes: clampInt(raw.windowMinutes, 10, 1, 1440),
      windowMs: clampInt(raw.windowMinutes, 10, 1, 1440) * 60 * 1000,
    };
  }

  refreshFlowWindow(now = this.clock(), createIfMissing = true) {
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

  getFlowWaitMs(now = this.clock()) {
    const flow = this.refreshFlowWindow(now, true);
    if (!flow.enabled || this.flowState.sentInWindow < flow.maxContacts) return 0;
    return Math.max(0, this.flowState.nextWindowAt - now);
  }

  getFlowControlSnapshot() {
    const flow = this.refreshFlowWindow(this.clock(), false);
    if (!flow.enabled) {
      return { enabled: false, maxContacts: flow.maxContacts, windowMinutes: flow.windowMinutes, sentInWindow: 0, remainingInWindow: null, windowStartedAt: null, nextWindowAt: null, waitMs: 0 };
    }
    const waitMs = this.flowState.windowStartedAt ? this.getFlowWaitMs() : 0;
    return {
      enabled: true,
      maxContacts: flow.maxContacts,
      windowMinutes: flow.windowMinutes,
      sentInWindow: this.flowState.sentInWindow,
      remainingInWindow: Math.max(0, flow.maxContacts - this.flowState.sentInWindow),
      windowStartedAt: this.flowState.windowStartedAt ? new Date(this.flowState.windowStartedAt).toISOString() : null,
      nextWindowAt: this.flowState.nextWindowAt ? new Date(this.flowState.nextWindowAt).toISOString() : null,
      waitMs,
    };
  }

  _recordContactAttempt() {
    const flow = this.refreshFlowWindow(this.clock(), true);
    if (flow.enabled) {
      this.flowState.sentInWindow += 1;
      this.flowState.nextWindowAt = this.flowState.windowStartedAt + flow.windowMs;
    }
  }

  _registerCampaignContext() {
    if (!this.campaign) return;
    registerActiveCampaign({
      id: this.campaign.id,
      numbers: this.queue.map(item => item.number),
      message: summarizeBlocks(normalizeContentBlocks(this.campaign.content || {})),
      intent: this.campaign.intent,
      subIntent: this.campaign.subIntent,
      config: this.loadConfig(),
    });
  }

  async start() {
    if (this.status === 'running') return this.getProgress();
    if (!this.campaign || !this.queue.length) throw new Error('Nenhuma campanha carregada.');
    const scheduledAt = this.campaign.delivery?.startMode === 'scheduled'
      ? new Date(this.campaign.delivery.scheduledAt || 0).getTime()
      : 0;
    if (scheduledAt > this.clock()) {
      this.status = 'scheduled';
      this.waitReason = 'scheduled_start';
      this._persist({ type: 'scheduled', message: `Campanha agendada para ${new Date(scheduledAt).toISOString()}.` });
      this._broadcastLoaded();
      this.broadcast({ type: 'campaign_status', status: this.status });
      this._schedule(() => this._activateScheduled(), scheduledAt - this.clock());
      return this.getProgress();
    }
    return this._activateScheduled();
  }

  async _activateScheduled() {
    if (!this.campaign || ['stopped', 'completed', 'cleared'].includes(this.status)) return;
    this.status = 'running';
    this.waitReason = null;
    this.runtimeMeta.startedAt = this.runtimeMeta.startedAt || new Date(this.clock()).toISOString();
    this._registerCampaignContext();
    updateActiveCampaignStatus('running');
    this._persist({ type: 'started', message: 'Campanha iniciada.' });
    this.broadcast({ type: 'campaign_status', status: 'running' });
    this._reportStatusEvent({ type: 'state', severity: 'info', title: 'Campanha', message: 'Campanha iniciada.' });
    this.log('info', `Campanha iniciada com ${this.queue.length} contato(s).`);
    void this.processNext();
    return this.getProgress();
  }

  pause(reason = 'Campanha pausada.') {
    if (!['running', 'scheduled', 'recovering'].includes(this.status)) return false;
    this._clearTimer();
    this.status = 'paused';
    this.waitReason = this.waitReason || 'manual_pause';
    this.runtimeMeta.pausedAt = new Date(this.clock()).toISOString();
    updateActiveCampaignStatus('paused');
    this._persist({ level: 'warning', type: 'paused', message: reason });
    this.broadcast({ type: 'campaign_status', status: 'paused' });
    this._broadcastStats();
    this.log('warning', reason);
    return true;
  }

  resume() {
    if (!['paused', 'recovering'].includes(this.status)) return false;
    const scheduledAt = this.campaign?.delivery?.startMode === 'scheduled'
      ? new Date(this.campaign.delivery.scheduledAt || 0).getTime()
      : 0;
    if (scheduledAt > this.clock()) {
      this.status = 'draft';
      this.waitReason = null;
      void this.start();
      return true;
    }
    this.status = 'running';
    this.waitReason = null;
    this.consecutiveFailures = 0;
    this.runtimeMeta.pausedAt = null;
    this._registerCampaignContext();
    updateActiveCampaignStatus('running');
    this._persist({ type: 'resumed', message: 'Campanha retomada.' });
    this.broadcast({ type: 'campaign_status', status: 'running' });
    this.log('info', 'Campanha retomada.');
    void this.processNext();
    return true;
  }

  stop() {
    if (!this.campaign) return false;
    this._clearTimer();
    this.status = 'stopped';
    this.waitReason = null;
    updateActiveCampaignStatus('stopped');
    this._persist({ level: 'warning', type: 'stopped', message: 'Campanha interrompida pelo usuario.' });
    this.broadcast({ type: 'campaign_status', status: 'stopped' });
    this.log('warning', 'Campanha interrompida pelo usuario.');
    return true;
  }

  clear() {
    if (this.status === 'running' || this.status === 'scheduled') return false;
    this._clearTimer();
    if (this.campaignId) {
      this.store.updateCampaign(this.campaignId, {
        status: this.status === 'completed' ? 'completed' : 'cleared',
        runtime: this._runtimeSnapshot(),
      }, { event: { type: 'queue_cleared', message: 'Campanha removida da fila ativa.' } });
    }
    this.queue = [];
    this.currentIndex = 0;
    this.stats = createStats(0);
    this.status = 'idle';
    this.waitReason = null;
    this.precheck = null;
    this.campaignId = null;
    this.campaign = null;
    this.flowState = createFlowState();
    this.runtimeMeta = {};
    clearActiveCampaign('Campanha removida da fila ativa.');
    this.broadcast({ type: 'campaign_cleared' });
    return true;
  }

  _nextPendingIndex() {
    for (let index = this.currentIndex; index < this.queue.length; index += 1) {
      if (this.queue[index].status === 'pending') return index;
    }
    return this.queue.length;
  }

  resolveCampaignSendTarget(item) {
    const normalized = fullPhone(item?.number);
    if (!normalized) return { target: item?.number, source: 'raw_number', normalized: null };
    const lead = this.getLead(normalized) || this.getAllLeads().find((candidate) => (
      [candidate?.phone, candidate?.displayNumber, candidate?.number].map(fullPhone).filter(Boolean).includes(normalized)
    ));
    const reusableJid = [lead?.replyTargetJid, lead?.jid].find(value => value && String(value).includes('@') && !String(value).includes('@lid'));
    return reusableJid
      ? { target: reusableJid, source: 'lead_jid', normalized }
      : { target: item.number, source: 'number', normalized };
  }

  async seedCampaignLead(item, blocks, delivery = {}) {
    const normalized = fullPhone(item.number);
    if (!normalized) return;
    const consultant = await this.findActiveConsultant({ phone: normalized, config: this.loadConfig() });
    if (consultant) return;
    const now = new Date(this.clock()).toISOString();
    const existing = this.getLead(normalized) || {};
    const history = Array.isArray(existing.history) ? [...existing.history] : [];
    const message = summarizeBlocks(blocks);
    if (message) {
      const last = history[history.length - 1];
      if (!last || last.role !== 'assistant' || last.content !== message) {
        history.push(buildAssistantHistoryEntry(message, delivery));
      }
    }
    this.saveLead(normalized, {
      ...existing,
      number: normalized,
      displayNumber: existing.displayNumber || normalized,
      phone: existing.phone || normalized,
      name: existing.name || item.recipient?.fields?.nome || null,
      status: existing.status || 'new',
      history,
      jid: existing.jid || null,
      createdAt: existing.createdAt || now,
      lastInteraction: now,
      source: existing.source || 'campaign',
      campaignId: this.campaignId,
      campaignMessage: message,
      campaignIntent: this.campaign?.intent || 'sales',
      campaignSubIntent: this.campaign?.subIntent || null,
      campaignVariantId: item.variantId || 'original',
      campaignName: this.campaign?.name || '',
      campaignObjective: this.campaign?.objective || '',
      campaignAiRepliesEnabled: this.campaign?.content?.aiRepliesEnabled !== false,
      campaignAiInstructions: String(this.campaign?.content?.aiInstructions || '').trim().slice(0, 1000),
      campaignSentAt: now,
      campaignLoopHandled: false,
      lastCampaignMessage: message || existing.lastCampaignMessage || '',
    });
  }

  async _sendBlock(item, block, targetInfo, blockIndex) {
    const media = block.mediaId ? this.store.getMedia(this.campaignId, block.mediaId) : null;
    const options = {
      context: 'campaign',
      routeLabel: targetInfo.source === 'lead_jid' ? 'campaign_lead_jid' : 'campaign_auto',
      noInternalRetry: true,
      campaignContext: {
        campaignId: this.campaignId,
        number: item.number,
        blockId: block.id,
        blockType: block.type,
        variantId: item.variantId,
      },
    };
    const accepted = typeof this.wa.sendCampaignBlock === 'function'
      ? await this.wa.sendCampaignBlock(targetInfo.target, block, media, options)
      : await this.wa.sendMessage(targetInfo.target, block.text || block.caption || '', block.type === 'image' ? media?.buffer : null, options);

    const acceptedAt = new Date(this.clock()).toISOString();
    const result = {
      blockId: block.id,
      type: block.type,
      index: blockIndex,
      status: 'accepted',
      acceptedAt,
      confirmedAt: null,
      messageId: accepted.messageId,
      resolvedTarget: accepted.resolvedJid || null,
      targetKind: accepted.targetKind || null,
      error: null,
    };
    item.blockResults[blockIndex] = result;
    item.acceptedAt = item.acceptedAt || acceptedAt;
    item.messageId = accepted.messageId;
    item.resolvedTarget = accepted.resolvedJid || item.resolvedTarget;
    item.targetKind = accepted.targetKind || item.targetKind;
    item.status = 'accepted';
    this.stats.payloadsAccepted += 1;
    this.store.incrementDailyUsage(1, this._dateKey());
    this._persist();
    this._broadcastQueueItem(this.currentIndex);
    this._broadcastStats();

    let finalRecord;
    try {
      finalRecord = typeof this.wa.waitForOutboundFinal === 'function'
        ? await this.wa.waitForOutboundFinal(accepted.messageId)
        : { status: accepted.status || 'accepted_unconfirmed', messageId: accepted.messageId };
    } catch (error) {
      finalRecord = { status: 'accepted_unconfirmed', messageId: accepted.messageId, error: error.message };
    }
    const final = normalizeFinalRecord(finalRecord);
    result.status = final.status;
    result.confirmedAt = final.status === 'confirmed' ? new Date(this.clock()).toISOString() : null;
    result.error = final.error || null;
    result.resolvedTarget = final.targetResolved || result.resolvedTarget;
    result.targetKind = final.targetKind || result.targetKind;
    item.blockResults[blockIndex] = result;
    item.resolvedTarget = result.resolvedTarget || item.resolvedTarget;
    item.targetKind = result.targetKind || item.targetKind;
    this._persist();
    return result;
  }

  _deliveryDelay() {
    const delivery = this.campaign?.delivery || {};
    if (delivery.intervalMode === 'fixed') return clampInt(delivery.intervalFixed, 45, 5, 3600) * 1000;
    const min = clampInt(delivery.intervalMin, 30, 5, 3600);
    const max = clampInt(delivery.intervalMax, 90, min, 3600);
    return Math.floor((Math.random() * ((max - min) + 1) + min) * 1000);
  }

  _shouldSafetyPause() {
    const delivery = this.campaign?.delivery || {};
    const attempted = this.stats.confirmed + this.stats.acceptedUnconfirmed + this.stats.failed;
    const failureThreshold = clampInt(delivery.pauseAfterFailures, MAX_CONSECUTIVE_FAILURES, 1, 50);
    if (this.consecutiveFailures >= failureThreshold) {
      this.pause(`Campanha pausada apos ${failureThreshold} falha(s) seguida(s).`);
      return true;
    }
    if (attempted < 5) return false;
    const failureRate = (this.stats.failed / attempted) * 100;
    const unconfirmedRate = (this.stats.acceptedUnconfirmed / attempted) * 100;
    if (failureRate >= clampInt(delivery.pauseFailureRate, 35, 1, 100)) {
      this.pause(`Campanha pausada: taxa de falha em ${failureRate.toFixed(0)}%.`);
      return true;
    }
    if (unconfirmedRate >= clampInt(delivery.pauseUnconfirmedRate, 50, 1, 100)) {
      this.pause(`Campanha pausada: ${unconfirmedRate.toFixed(0)}% dos envios estao sem confirmacao.`);
      return true;
    }
    return false;
  }

  async processNext() {
    try {
      return await this._processNext();
    } catch (error) {
      const message = String(error?.message || 'Erro interno desconhecido').slice(0, 500);
      this.waitReason = 'internal_error';
      try { this.log('error', `A fila encontrou um erro interno e foi pausada: ${message}`); } catch {}
      if (this.status === 'running') {
        try {
          this.pause('Campanha pausada por erro interno. Revise o diagnostico antes de retomar.');
        } catch {
          this._clearTimer();
          this.status = 'paused';
          updateActiveCampaignStatus('paused');
          this.broadcast({ type: 'campaign_status', status: 'paused' });
        }
      }
      return null;
    }
  }

  async _processNext() {
    if (this.status !== 'running') return;
    this.currentIndex = this._nextPendingIndex();
    if (this.currentIndex >= this.queue.length) {
      this.status = 'completed';
      this.waitReason = null;
      this.runtimeMeta.completedAt = new Date(this.clock()).toISOString();
      updateActiveCampaignStatus('completed');
      this._persist({ type: 'completed', message: 'Campanha concluida.' });
      this.broadcast({ type: 'campaign_status', status: 'completed' });
      this._broadcastStats();
      this.log('success', `Campanha concluida: ${this.stats.confirmed} confirmada(s), ${this.stats.acceptedUnconfirmed} sem confirmacao e ${this.stats.failed} falha(s).`);
      return;
    }

    if (this.wa.getStatus?.().status !== 'connected') {
      this.waitReason = 'whatsapp_connection';
      this._persist();
      this._broadcastStats();
      this._schedule(() => this.processNext(), 30000);
      return;
    }

    const windowWait = waitUntilDeliveryWindow(this.campaign?.delivery || {}, this.clock());
    if (windowWait > 0) {
      this.waitReason = 'time_window';
      this._persist();
      this._broadcastStats();
      this._schedule(() => this.processNext(), windowWait);
      return;
    }

    const flowWait = this.getFlowWaitMs();
    if (flowWait > 0) {
      this.waitReason = 'flow_control';
      this._persist();
      this._broadcastStats();
      this._schedule(() => this.processNext(), flowWait);
      return;
    }

    const item = this.queue[this.currentIndex];
    if (this.store.isSuppressed(item.number)) {
      item.status = 'skipped';
      item.error = 'Contato em lista de supressao.';
      this.stats.skipped += 1;
      this.stats.pending = Math.max(0, this.stats.pending - 1);
      this.currentIndex += 1;
      this._persist();
      this._broadcastQueueItem(this.currentIndex - 1);
      this._schedule(() => this.processNext(), 25);
      return;
    }

    const blocks = this._blocksForItem(item);
    if (!blocks.length) {
      item.status = 'skipped';
      item.error = 'Campanha sem conteudo para este contato.';
      this.stats.skipped += 1;
      this.stats.pending = Math.max(0, this.stats.pending - 1);
      this.currentIndex += 1;
      this._persist();
      this._schedule(() => this.processNext(), 25);
      return;
    }
    if (this._dailyLimitReached(blocks.length)) {
      this.waitReason = 'daily_limit';
      this.pause('Limite diario atingido. A campanha foi pausada antes do proximo contato.');
      return;
    }

    item.status = 'sending';
    item.error = null;
    this.waitReason = null;
    this._persist();
    this._broadcastQueueItem(this.currentIndex);
    const targetInfo = this.resolveCampaignSendTarget(item);
    item.normalizedNumber = targetInfo.normalized || item.normalizedNumber;

    if (this.campaign?.delivery?.typing && blocks.some(block => block.type === 'text')) {
      await this.wa.sendTyping(targetInfo.target, 1200, { noInternalRetry: true }).catch(() => null);
    }

    let acceptedCount = 0;
    let uncertainCount = 0;
    let failure = null;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const previous = item.blockResults[blockIndex];
      if (previous && ['confirmed', 'accepted_unconfirmed', 'accepted'].includes(previous.status)) {
        acceptedCount += 1;
        if (previous.status !== 'confirmed') uncertainCount += 1;
        continue;
      }
      try {
        const result = await this._sendBlock(item, blocks[blockIndex], targetInfo, blockIndex);
        if (result.status === 'failed') {
          failure = Object.assign(new Error(result.error || 'O WhatsApp rejeitou o envio.'), { messageId: result.messageId });
          break;
        }
        acceptedCount += 1;
        if (result.status === 'accepted_unconfirmed') uncertainCount += 1;
      } catch (error) {
        failure = error;
        item.blockResults[blockIndex] = {
          blockId: blocks[blockIndex].id,
          type: blocks[blockIndex].type,
          index: blockIndex,
          status: 'failed',
          messageId: error.messageId || null,
          error: error.message,
        };
        break;
      }
    }

    this.stats.pending = Math.max(0, this.stats.pending - 1);
    if (acceptedCount > 0) this.stats.accepted += 1;
    if (failure) {
      item.status = acceptedCount > 0 ? 'partial_failed' : 'failed';
      item.error = failure.message;
      this.stats.failed += 1;
      this.consecutiveFailures += 1;
    } else if (uncertainCount > 0) {
      item.status = 'accepted_unconfirmed';
      item.error = `${uncertainCount} parte(s) aceita(s) sem confirmacao de entrega.`;
      this.stats.acceptedUnconfirmed += 1;
      this.consecutiveFailures = 0;
    } else {
      item.status = 'confirmed';
      item.sentAt = new Date(this.clock()).toISOString();
      item.error = null;
      this.stats.confirmed += 1;
      this.consecutiveFailures = 0;
    }
    if (acceptedCount > 0) {
      this._recordContactAttempt();
      if (item.normalizedNumber && String(item.resolvedTarget || '').includes('@lid')) {
        void this.upsertLidPhoneMapping({
          lid_jid: item.resolvedTarget,
          phone: item.normalizedNumber,
          source: 'campaign_recipient',
          confidence: 0.9,
        });
      }
      try {
        await this.seedCampaignLead(item, blocks, {
          status: item.status,
          messageId: item.messageId,
          targetJid: item.resolvedTarget,
          error: item.error,
        });
        item.contextError = null;
      } catch (error) {
        item.contextError = String(error?.message || 'Falha ao registrar contexto no CRM.').slice(0, 500);
        this.log('warning', `Envio concluido, mas o contexto de ${item.number} nao foi salvo no CRM: ${item.contextError}`);
      }
    }
    this._persist();
    this._broadcastQueueItem(this.currentIndex);
    this._broadcastStats();
    this.currentIndex += 1;
    this._persist();
    if (this._shouldSafetyPause()) return;
    if (this.status !== 'running') return;
    if (this._nextPendingIndex() >= this.queue.length) {
      await this.processNext();
      return;
    }
    const delay = this._deliveryDelay();
    this._schedule(() => this.processNext(), delay);
  }

  async sendTest(campaignId, recipientInput = {}) {
    const campaign = this.store.getCampaign(campaignId);
    if (!campaign) throw new Error('Campanha nao encontrada.');
    const phone = localPhone(recipientInput.phone || recipientInput.number);
    if (!phone) throw new Error('Informe um WhatsApp valido para o teste.');
    if (this.wa.getStatus?.().status !== 'connected') throw new Error('WhatsApp nao esta conectado.');
    const previousCampaign = this.campaign;
    const previousCampaignId = this.campaignId;
    this.campaign = campaign;
    this.campaignId = campaign.id;
    const item = this._createQueueItem({
      phone,
      fields: { nome: String(recipientInput.name || 'Contato de teste'), ...(recipientInput.fields || {}) },
    });
    const blocks = this._blocksForItem(item);
    const targetInfo = { target: phone, source: 'test', normalized: fullPhone(phone) };
    const results = [];
    try {
      for (let index = 0; index < blocks.length; index += 1) {
        const media = blocks[index].mediaId ? this.store.getMedia(campaign.id, blocks[index].mediaId) : null;
        const accepted = await this.wa.sendCampaignBlock(targetInfo.target, blocks[index], media, {
          context: 'campaign_test',
          routeLabel: 'campaign_test',
          noInternalRetry: true,
          campaignContext: { campaignId: campaign.id, test: true, blockId: blocks[index].id },
        });
        this.store.incrementDailyUsage(1, zonedParts(this.clock(), campaign.delivery?.timezone).dateKey);
        let finalRecord;
        try {
          finalRecord = await this.wa.waitForOutboundFinal(accepted.messageId);
        } catch (error) {
          finalRecord = { status: 'accepted_unconfirmed', error: error.message };
        }
        const final = normalizeFinalRecord(finalRecord);
        results.push({ blockId: blocks[index].id, type: blocks[index].type, messageId: accepted.messageId, status: final.status, error: final.error || null });
        if (final.status === 'failed') break;
      }
      this.store.appendEvent(campaign.id, { type: 'test_sent', message: `Teste enviado para final ${phone.slice(-4)}.`, details: { results } });
      return { success: results.length > 0 && results.every(result => result.status !== 'failed'), results };
    } finally {
      this.campaign = previousCampaign;
      this.campaignId = previousCampaignId;
    }
  }

  getStatusSnapshot() {
    const routeKinds = {};
    const recentResolvedTargets = [];
    for (const item of this.queue) {
      if (item.targetKind) routeKinds[item.targetKind] = (routeKinds[item.targetKind] || 0) + 1;
      if (item.resolvedTarget) recentResolvedTargets.push({ number: item.number, resolvedTarget: item.resolvedTarget, targetKind: item.targetKind, status: item.status });
    }
    const dominantRouteKind = Object.entries(routeKinds).sort((left, right) => right[1] - left[1])[0]?.[0] || '';
    this._syncSentAlias();
    return {
      campaignId: this.campaignId,
      campaignName: this.campaign?.name || '',
      status: this.status,
      currentIndex: this.currentIndex,
      consecutiveFailures: this.consecutiveFailures,
      waitReason: this.waitReason,
      dailyOutboundAttempts: this.stats.dailyOutboundAttempts,
      precheck: this.precheck,
      stats: { ...this.stats },
      flowControl: this.getFlowControlSnapshot(),
      routeMode: 'single_safe_route',
      retryPhoneOnLidTimeout: false,
      dominantRouteKind,
      routeKinds,
      recentResolvedTargets: recentResolvedTargets.slice(-5).reverse(),
    };
  }

  getProgress() {
    this._syncSentAlias();
    return {
      campaignId: this.campaignId,
      campaign: this.campaign ? { id: this.campaign.id, name: this.campaign.name, objective: this.campaign.objective } : null,
      status: this.status,
      stats: { ...this.stats },
      queue: this._publicQueue(),
      currentIndex: this.currentIndex,
      waitReason: this.waitReason,
      flowControl: this.getFlowControlSnapshot(),
      precheck: this.precheck,
    };
  }
}
