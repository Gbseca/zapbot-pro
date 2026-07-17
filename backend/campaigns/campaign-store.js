import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { CAMPAIGNS_FILE, CAMPAIGN_MEDIA_DIR } from '../storage/paths.js';

const MAX_CAMPAIGNS = 250;
const MAX_EVENTS_PER_CAMPAIGN = 500;
const ACTIVE_STATUSES = new Set(['scheduled', 'running', 'paused', 'recovering']);

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function defaultState() {
  return {
    version: 2,
    campaigns: {},
    order: [],
    suppressions: {},
    templates: {},
    usageByDay: {},
    updatedAt: nowIso(),
  };
}

function defaultDelivery() {
  return {
    startMode: 'now',
    scheduledAt: null,
    timezone: 'America/Sao_Paulo',
    allowedWeekdays: [1, 2, 3, 4, 5],
    useWindow: true,
    windowStart: '08:00',
    windowEnd: '20:00',
    intervalMode: 'random',
    intervalFixed: 45,
    intervalMin: 30,
    intervalMax: 90,
    flowControl: { enabled: true, maxContacts: 15, windowMinutes: 10 },
    dailyLimit: { enabled: true, max: 50 },
    frequencyCap: { enabled: true, max: 2, days: 7 },
    typing: true,
    pauseAfterFailures: 3,
    pauseFailureRate: 35,
    pauseUnconfirmedRate: 50,
  };
}

function defaultContent() {
  return {
    message: '',
    blocks: [{ id: randomUUID(), type: 'text', enabled: true, text: '' }],
    variants: [],
    variantMode: 'single',
    variableDefaults: {},
    appendOptOut: true,
    optOutText: 'Para nao receber novas mensagens, responda SAIR.',
    aiRepliesEnabled: true,
    aiInstructions: '',
  };
}

function defaultRuntime(total = 0) {
  return {
    currentIndex: 0,
    waitReason: null,
    queue: [],
    stats: {
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
    },
    flowState: {
      windowStartedAt: null,
      sentInWindow: 0,
      nextWindowAt: null,
    },
    consecutiveFailures: 0,
    startedAt: null,
    pausedAt: null,
    completedAt: null,
    restoredAt: null,
  };
}

function defaultCampaign(input = {}) {
  const timestamp = nowIso();
  const id = randomUUID();
  const base = {
    id,
    name: 'Nova campanha',
    objective: 'Gerar conversas',
    intent: 'sales',
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    launchedAt: null,
    archivedAt: null,
    audience: {
      recipients: [],
      source: 'manual',
      consentConfirmed: false,
      consentSource: '',
      consentAt: null,
      importedColumns: [],
      precheck: null,
    },
    content: defaultContent(),
    delivery: defaultDelivery(),
    media: {},
    runtime: defaultRuntime(0),
    events: [],
  };

  const recipients = Array.isArray(input.audience?.recipients)
    ? clone(input.audience.recipients)
    : base.audience.recipients;
  const total = recipients.length;
  const runtimeInput = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};

  return {
    ...base,
    name: String(input.name || base.name).trim().slice(0, 120) || base.name,
    objective: String(input.objective || base.objective).trim().slice(0, 160) || base.objective,
    intent: String(input.intent || base.intent).trim().slice(0, 60) || base.intent,
    status: String(input.status || base.status).trim().slice(0, 30) || base.status,
    createdAt: input.createdAt || base.createdAt,
    updatedAt: input.updatedAt || base.updatedAt,
    launchedAt: input.launchedAt || null,
    archivedAt: input.archivedAt || null,
    audience: { ...base.audience, ...(clone(input.audience) || {}), recipients },
    content: { ...base.content, ...(clone(input.content) || {}) },
    delivery: {
      ...base.delivery,
      ...(clone(input.delivery) || {}),
      flowControl: { ...base.delivery.flowControl, ...(clone(input.delivery?.flowControl) || {}) },
      dailyLimit: { ...base.delivery.dailyLimit, ...(clone(input.delivery?.dailyLimit) || {}) },
      frequencyCap: { ...base.delivery.frequencyCap, ...(clone(input.delivery?.frequencyCap) || {}) },
    },
    media: input.media && typeof input.media === 'object' ? clone(input.media) : {},
    runtime: {
      ...defaultRuntime(total),
      ...clone(runtimeInput),
      stats: { ...defaultRuntime(total).stats, ...(clone(runtimeInput.stats) || {}) },
      flowState: { ...defaultRuntime(total).flowState, ...(clone(runtimeInput.flowState) || {}) },
    },
    events: Array.isArray(input.events) ? clone(input.events).slice(-MAX_EVENTS_PER_CAMPAIGN) : [],
    id,
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ensureDirectory(fileOrDirectory, isDirectory = false) {
  const directory = isDirectory ? fileOrDirectory : path.dirname(fileOrDirectory);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

function readState(file) {
  if (!fs.existsSync(file)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultState();
    return {
      ...defaultState(),
      ...parsed,
      campaigns: parsed.campaigns && typeof parsed.campaigns === 'object' ? parsed.campaigns : {},
      order: Array.isArray(parsed.order) ? parsed.order : [],
      suppressions: parsed.suppressions && typeof parsed.suppressions === 'object' ? parsed.suppressions : {},
      templates: parsed.templates && typeof parsed.templates === 'object' ? parsed.templates : {},
      usageByDay: parsed.usageByDay && typeof parsed.usageByDay === 'object' ? parsed.usageByDay : {},
    };
  } catch (error) {
    console.warn(`[CampaignStore] Falha ao ler ${path.basename(file)}: ${error.message}`);
    return defaultState();
  }
}

function writeAtomic(file, value) {
  ensureDirectory(file);
  const temp = `${file}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.copyFileSync(temp, file);
      fs.unlinkSync(temp);
    } catch {
      try { fs.unlinkSync(temp); } catch {}
      throw error;
    }
  }
}

function safeExtension(fileName = '') {
  const extension = path.extname(String(fileName || '')).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return extension.slice(0, 12);
}

function safeFileName(fileName = 'arquivo') {
  const extension = safeExtension(fileName);
  const base = path.basename(String(fileName || 'arquivo'), extension)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'arquivo';
  return `${base}${extension}`;
}

function resolveInside(rootDirectory, ...parts) {
  const root = path.resolve(rootDirectory);
  const candidate = path.resolve(root, ...parts);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error('Caminho de campanha invalido.');
  }
  return candidate;
}

function canonicalPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
}

export function createCampaignStore({
  file = CAMPAIGNS_FILE,
  mediaDirectory = CAMPAIGN_MEDIA_DIR,
  clock = () => Date.now(),
} = {}) {
  let state = readState(file);

  function persist() {
    state.updatedAt = nowIso(clock());
    writeAtomic(file, state);
  }

  function campaignOrThrow(id) {
    const campaign = state.campaigns[String(id || '')];
    if (!campaign) throw new Error('Campanha nao encontrada.');
    return campaign;
  }

  function appendEvent(campaign, event = {}) {
    const entry = {
      id: randomUUID(),
      at: nowIso(clock()),
      level: String(event.level || 'info').slice(0, 20),
      type: String(event.type || 'update').slice(0, 50),
      message: String(event.message || '').slice(0, 800),
      details: event.details && typeof event.details === 'object' ? clone(event.details) : null,
    };
    campaign.events = [...(Array.isArray(campaign.events) ? campaign.events : []), entry]
      .slice(-MAX_EVENTS_PER_CAMPAIGN);
    return entry;
  }

  function pruneCampaigns() {
    if (state.order.length <= MAX_CAMPAIGNS) return;
    const removable = state.order
      .map(id => state.campaigns[id])
      .filter(campaign => campaign && !ACTIVE_STATUSES.has(campaign.status))
      .sort((left, right) => new Date(left.updatedAt || 0) - new Date(right.updatedAt || 0));
    while (state.order.length > MAX_CAMPAIGNS && removable.length) {
      const campaign = removable.shift();
      delete state.campaigns[campaign.id];
      state.order = state.order.filter(id => id !== campaign.id);
    }
  }

  function createCampaign(input = {}) {
    const campaign = defaultCampaign(input);
    state.campaigns[campaign.id] = campaign;
    state.order = [campaign.id, ...state.order.filter(id => id !== campaign.id)];
    appendEvent(campaign, { type: 'created', message: 'Rascunho criado.' });
    pruneCampaigns();
    persist();
    return clone(campaign);
  }

  function getCampaign(id) {
    const campaign = state.campaigns[String(id || '')];
    return campaign ? clone(campaign) : null;
  }

  function listCampaigns({ limit = 50, status = '' } = {}) {
    const normalizedStatus = String(status || '').trim();
    return state.order
      .map(id => state.campaigns[id])
      .filter(Boolean)
      .filter(campaign => !normalizedStatus || campaign.status === normalizedStatus)
      .slice(0, Math.max(1, Math.min(250, Number(limit) || 50)))
      .map(campaign => ({
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        intent: campaign.intent,
        status: campaign.status,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        launchedAt: campaign.launchedAt,
        archivedAt: campaign.archivedAt,
        recipients: campaign.audience?.recipients?.length || 0,
        stats: clone(campaign.runtime?.stats || defaultRuntime(0).stats),
      }));
  }

  function updateCampaign(id, patch = {}, { event } = {}) {
    const campaign = campaignOrThrow(id);
    const allowed = ['name', 'objective', 'intent', 'status', 'audience', 'content', 'delivery', 'media', 'runtime', 'launchedAt', 'archivedAt'];
    for (const key of allowed) {
      if (!(key in patch)) continue;
      if (['audience', 'content', 'delivery', 'media', 'runtime'].includes(key)) {
        const value = clone(patch[key]) || {};
        const previous = campaign[key] || {};
        campaign[key] = { ...previous, ...value };
        if (key === 'delivery') {
          campaign.delivery.flowControl = { ...(previous.flowControl || {}), ...(value.flowControl || {}) };
          campaign.delivery.dailyLimit = { ...(previous.dailyLimit || {}), ...(value.dailyLimit || {}) };
          campaign.delivery.frequencyCap = { ...(previous.frequencyCap || {}), ...(value.frequencyCap || {}) };
        }
        if (key === 'runtime') {
          campaign.runtime.stats = { ...(previous.stats || {}), ...(value.stats || {}) };
          campaign.runtime.flowState = { ...(previous.flowState || {}), ...(value.flowState || {}) };
        }
      } else {
        campaign[key] = clone(patch[key]);
      }
    }
    campaign.updatedAt = nowIso(clock());
    state.order = [campaign.id, ...state.order.filter(value => value !== campaign.id)];
    if (event) appendEvent(campaign, event);
    persist();
    return clone(campaign);
  }

  function saveRuntime(id, runtime = {}, event = null) {
    const campaign = campaignOrThrow(id);
    campaign.runtime = { ...(campaign.runtime || defaultRuntime(0)), ...clone(runtime) };
    campaign.updatedAt = nowIso(clock());
    if (event) appendEvent(campaign, event);
    persist();
    return clone(campaign.runtime);
  }

  function deleteCampaign(id) {
    const campaign = campaignOrThrow(id);
    if (ACTIVE_STATUSES.has(campaign.status)) throw new Error('Pare a campanha antes de excluir.');
    delete state.campaigns[campaign.id];
    state.order = state.order.filter(value => value !== campaign.id);
    const directory = resolveInside(mediaDirectory, campaign.id);
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
    persist();
    return true;
  }

  function getRecoverableCampaign() {
    const campaign = state.order
      .map(id => state.campaigns[id])
      .find(item => item && ACTIVE_STATUSES.has(item.status));
    return campaign ? clone(campaign) : null;
  }

  function addSuppression(phone, input = {}) {
    const key = canonicalPhone(phone);
    if (!/^\d{10,11}$/.test(key)) throw new Error('Telefone invalido para supressao.');
    const entry = {
      phone: key,
      reason: String(input.reason || 'Pedido do contato').trim().slice(0, 240),
      source: String(input.source || 'manual').trim().slice(0, 80),
      createdAt: nowIso(clock()),
      campaignId: input.campaignId ? String(input.campaignId) : null,
    };
    state.suppressions[key] = entry;
    persist();
    return clone(entry);
  }

  function removeSuppression(phone) {
    const key = canonicalPhone(phone);
    const existed = !!state.suppressions[key];
    delete state.suppressions[key];
    if (existed) persist();
    return existed;
  }

  function listSuppressions() {
    return Object.values(state.suppressions)
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
      .map(clone);
  }

  function isSuppressed(phone) {
    return !!state.suppressions[canonicalPhone(phone)];
  }

  function saveMedia(campaignId, fileInput = {}) {
    const campaign = campaignOrThrow(campaignId);
    const buffer = Buffer.isBuffer(fileInput.buffer) ? fileInput.buffer : Buffer.from(fileInput.buffer || []);
    if (!buffer.length) throw new Error('Arquivo vazio.');
    const id = randomUUID();
    const fileName = safeFileName(fileInput.originalname || fileInput.fileName || 'arquivo');
    const extension = safeExtension(fileName);
    const relativePath = path.join(campaign.id, `${id}${extension}`);
    const absolutePath = resolveInside(mediaDirectory, relativePath);
    ensureDirectory(path.dirname(absolutePath), true);
    fs.writeFileSync(absolutePath, buffer);
    const metadata = {
      id,
      fileName,
      mimeType: String(fileInput.mimetype || fileInput.mimeType || 'application/octet-stream').slice(0, 120),
      kind: String(fileInput.kind || '').toLowerCase().slice(0, 20),
      size: buffer.length,
      relativePath: relativePath.replace(/\\/g, '/'),
      createdAt: nowIso(clock()),
    };
    campaign.media = { ...(campaign.media || {}), [id]: metadata };
    appendEvent(campaign, { type: 'media_added', message: `Anexo adicionado: ${fileName}.`, details: { mediaId: id, size: buffer.length } });
    persist();
    return clone(metadata);
  }

  function getMedia(campaignId, mediaId, { includeBuffer = false } = {}) {
    const campaign = campaignOrThrow(campaignId);
    const metadata = campaign.media?.[String(mediaId || '')];
    if (!metadata) return null;
    let absolutePath;
    try {
      absolutePath = resolveInside(mediaDirectory, metadata.relativePath);
    } catch {
      return null;
    }
    if (!fs.existsSync(absolutePath)) return null;
    return {
      ...clone(metadata),
      absolutePath,
      ...(includeBuffer ? { buffer: fs.readFileSync(absolutePath) } : {}),
    };
  }

  function removeMedia(campaignId, mediaId) {
    const campaign = campaignOrThrow(campaignId);
    const metadata = campaign.media?.[String(mediaId || '')];
    if (!metadata) return false;
    const absolutePath = resolveInside(mediaDirectory, metadata.relativePath);
    if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    delete campaign.media[mediaId];
    appendEvent(campaign, { type: 'media_removed', message: `Anexo removido: ${metadata.fileName}.` });
    persist();
    return true;
  }

  function incrementDailyUsage(count = 1, dateKey = nowIso(clock()).slice(0, 10)) {
    const safeCount = Math.max(0, Number(count) || 0);
    state.usageByDay[dateKey] = Math.max(0, Number(state.usageByDay[dateKey]) || 0) + safeCount;
    const keys = Object.keys(state.usageByDay).sort().reverse();
    for (const key of keys.slice(45)) delete state.usageByDay[key];
    persist();
    return state.usageByDay[dateKey];
  }

  function getDailyUsage(dateKey = nowIso(clock()).slice(0, 10)) {
    return Math.max(0, Number(state.usageByDay[dateKey]) || 0);
  }

  function getRecentRecipientSends(phone, since) {
    const digits = canonicalPhone(phone);
    const sinceMs = new Date(since || 0).getTime();
    const output = [];
    for (const campaign of Object.values(state.campaigns)) {
      for (const item of campaign.runtime?.queue || []) {
        const itemPhone = canonicalPhone(item.normalizedNumber || item.phone || item.number);
        const sentAt = new Date(item.sentAt || item.acceptedAt || 0).getTime();
        if (itemPhone && itemPhone === digits && sentAt >= sinceMs) {
          output.push({ campaignId: campaign.id, sentAt: item.sentAt || item.acceptedAt, status: item.status });
        }
      }
    }
    return output.sort((left, right) => new Date(right.sentAt || 0) - new Date(left.sentAt || 0));
  }

  return {
    createCampaign,
    getCampaign,
    listCampaigns,
    updateCampaign,
    saveRuntime,
    deleteCampaign,
    getRecoverableCampaign,
    addSuppression,
    removeSuppression,
    listSuppressions,
    isSuppressed,
    saveMedia,
    getMedia,
    removeMedia,
    incrementDailyUsage,
    getDailyUsage,
    getRecentRecipientSends,
    appendEvent(id, event) {
      const campaign = campaignOrThrow(id);
      const entry = appendEvent(campaign, event);
      campaign.updatedAt = nowIso(clock());
      persist();
      return clone(entry);
    },
    defaultRuntime,
    reload() {
      state = readState(file);
    },
  };
}

export const campaignStore = createCampaignStore();
