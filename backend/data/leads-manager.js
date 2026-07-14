import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { LEADS_FILE } from '../storage/paths.js';
import { getLeadInternalWhatsAppId, getLeadRealPhone } from '../phone-utils.js';

const DATA_DIR = path.dirname(LEADS_FILE);
const LEADS_TRASH_FILE = path.join(DATA_DIR, 'leads-trash.json');
const LEADS_SETTINGS_FILE = path.join(DATA_DIR, 'leads-settings.json');
const LEADS_BACKUP_DIR = path.join(DATA_DIR, 'backups', 'leads');
const CRM_STAGES = new Set(['attention', 'active', 'qualified', 'waiting', 'closed']);
const TRACKED_ACTIVITY_FIELDS = new Set(['status', 'stage', 'operationalStatus', 'crmStage', 'tag']);
const ACTIVITY_LIMIT = 200;
const BACKUP_LIMIT = 20;
const DEFAULT_SETTINGS = Object.freeze({ trashRetentionDays: 0 });
const ATTENTION_STATUSES = new Set([
  'human_requested',
  'awaiting_financial_review',
  'payment_claimed',
  'receipt_received',
  'inspection_pending',
  'inspection_disputed',
  'app_blocked',
  'billing_disputed',
  'awaiting_operational_data',
  'awaiting_phone_for_handoff',
  'awaiting_contact_for_handoff',
  'transferred_to_financial',
  'transferred_to_support',
  'handoff_client_confirmation_failed',
  'handoff_failed',
]);
const CLOSED_STATUSES = new Set(['cold', 'no_interest', 'blocked', 'resolved', 'archived']);
const QUALIFIED_STATUSES = new Set(['qualified', 'transferred']);
const ACTIVE_STATUSES = new Set(['new', 'talking', 'engaged', 'human_taken_over']);
const AUTOMATION_PAUSED_STATUSES = new Set([
  'blocked',
  'transferred',
  'human_taken_over',
  'human_requested',
  'awaiting_financial_review',
  'payment_claimed',
  'receipt_received',
  'inspection_pending',
  'inspection_disputed',
  'app_blocked',
  'billing_disputed',
  'transferred_to_financial',
  'transferred_to_support',
  'handoff_failed',
  'handoff_client_confirmation_failed',
]);
const INTENT_SUBJECTS = Object.freeze({
  angry_customer: 'Cliente insatisfeito',
  app_blocked: 'Aplicativo bloqueado',
  assistance_request: 'Solicitou reboque ou assist\u00eancia',
  billing_dispute: 'Contestou uma cobran\u00e7a',
  billing_disputed: 'Contestou uma cobran\u00e7a',
  boleto_request: 'Solicitou boleto ou segunda via',
  cancel_request: 'Solicitou cancelamento',
  event_report: 'Relatou um evento com o ve\u00edculo',
  accident_report: 'Relatou um evento com o ve\u00edculo',
  human_requested: 'Pediu atendimento humano',
  inspection_pending: 'Precisa de vistoria ou revistoria',
  inspection_request: 'Precisa de vistoria ou revistoria',
  no_interest: 'Informou que n\u00e3o tem interesse',
  payment_claimed: 'Informou que j\u00e1 realizou o pagamento',
  reactivation_request: 'Solicitou reativa\u00e7\u00e3o',
  receipt_available: 'Informou que possui comprovante',
  receipt_received: 'Enviou comprovante',
  receipt_sent: 'Enviou comprovante',
  regularization_request: 'Quer regularizar uma pend\u00eancia',
  sales_consultant_requested: 'Pediu um consultor',
  sales_price_request: 'Perguntou o valor da prote\u00e7\u00e3o veicular',
  sales_quote: 'Solicitou cota\u00e7\u00e3o de prote\u00e7\u00e3o veicular',
  system_check_request: 'Solicitou verifica\u00e7\u00e3o do cadastro',
});
const listeners = new Set();
let eventSequence = 0;

function ensureDir(file = LEADS_FILE) {
  const dir = path.extname(file) ? path.dirname(file) : file;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const raw = fs.readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/^\u00ef\u00bb\u00bf/, '');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error(`[Leads] Could not read ${path.basename(file)}: ${error.message}`);
    return {};
  }
}

function saveJsonAtomic(file, data) {
  ensureDir(file);
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
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

function loadAll() {
  return loadJson(LEADS_FILE);
}

function loadTrash() {
  return loadJson(LEADS_TRASH_FILE);
}

function cleanKey(value) {
  return String(value || '').trim();
}

function uniqueKeys(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanKey).filter(Boolean))];
}

function toTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function messageCount(lead, role) {
  return Array.isArray(lead?.history)
    ? lead.history.filter((entry) => entry?.role === role).length
    : 0;
}

function latestMessage(lead, role = null) {
  const history = Array.isArray(lead?.history) ? lead.history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || (role && entry.role !== role)) continue;
    const content = String(entry.content || '').trim();
    if (content) return entry;
  }
  return null;
}

function normalizedSource(lead = {}) {
  if (lead.source === 'campaign' || lead.campaignSentAt) return 'campaign';
  if (messageCount(lead, 'user') > 0) return 'inbound';
  return lead.source || 'unknown';
}

function activityEntry(type, { origin = 'system', details = {}, at = null } = {}) {
  return {
    id: randomUUID(),
    type: cleanKey(type) || 'updated',
    origin: cleanKey(origin) || 'system',
    details: details && typeof details === 'object' ? details : {},
    at: at || new Date().toISOString(),
  };
}

function appendActivity(lead, type, options = {}) {
  const current = Array.isArray(lead?.activity) ? lead.activity : [];
  return {
    ...(lead || {}),
    activity: [...current, activityEntry(type, options)].slice(-ACTIVITY_LIMIT),
  };
}

function trackedChanges(previous = {}, current = {}) {
  const changes = {};
  for (const field of TRACKED_ACTIVITY_FIELDS) {
    const before = previous[field] ?? null;
    const after = current[field] ?? null;
    if (before !== after) changes[field] = { from: before, to: after };
  }
  return changes;
}

function addTrackedUpdateActivity(previous, current, origin) {
  const changes = trackedChanges(previous, current);
  if (Object.keys(changes).length === 0) return current;
  return appendActivity(current, 'lead_updated', { origin, details: { changes } });
}

function mergeHistory(records) {
  const seen = new Set();
  const merged = [];
  for (const record of records) {
    for (const entry of Array.isArray(record?.history) ? record.history : []) {
      const signature = [entry?.role || '', entry?.content || '', entry?.ts || ''].join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);
      merged.push(entry);
    }
  }
  return merged.sort((a, b) => Number(a?.ts || 0) - Number(b?.ts || 0));
}

function mergeActivity(records) {
  const seen = new Set();
  const merged = [];
  for (const record of records) {
    for (const entry of Array.isArray(record?.activity) ? record.activity : []) {
      const signature = entry?.id || [entry?.type || '', entry?.at || '', JSON.stringify(entry?.details || {})].join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);
      merged.push(entry);
    }
  }
  return merged.sort((a, b) => toTimestamp(a?.at) - toTimestamp(b?.at)).slice(-ACTIVITY_LIMIT);
}

function pickRecentRecord(records) {
  return [...records].sort((a, b) => (
    toTimestamp(b?.updatedAt || b?.lastInteraction || b?.createdAt)
    - toTimestamp(a?.updatedAt || a?.lastInteraction || a?.createdAt)
  ))[0] || {};
}

function mergeRecords(records, targetKey, { origin = 'system', reason = 'duplicate_merge' } = {}) {
  const available = records.filter(Boolean);
  const recent = pickRecentRecord(available);
  const oldestCreatedAt = available
    .map((lead) => lead?.createdAt)
    .filter(Boolean)
    .sort((a, b) => toTimestamp(a) - toTimestamp(b))[0] || recent.createdAt || new Date().toISOString();
  const mergedFrom = [...new Set(available.flatMap((lead) => [lead?.number, ...(lead?.mergedFrom || [])]).filter(Boolean))]
    .filter((key) => key !== targetKey);
  let merged = {
    ...available.reduce((result, lead) => ({ ...result, ...Object.fromEntries(
      Object.entries(lead).filter(([, value]) => value !== null && value !== undefined && value !== ''),
    ) }), {}),
    ...recent,
    number: targetKey,
    history: mergeHistory(available),
    activity: mergeActivity(available),
    mergedFrom,
    createdAt: oldestCreatedAt,
    updatedAt: new Date().toISOString(),
  };
  merged = applyAttentionTracking(recent, merged, merged.updatedAt);
  return appendActivity(merged, 'leads_merged', {
    origin,
    details: { reason, mergedFrom },
  });
}

function clearDeletionMetadata(lead) {
  const current = { ...(lead || {}) };
  current.lastDeletedAt = current.deletedAt || current.lastDeletedAt || null;
  current.lastDeleteReason = current.deleteReason || current.lastDeleteReason || null;
  delete current.deletedAt;
  delete current.deletedBy;
  delete current.deleteReason;
  delete current.deletedFromStage;
  delete current.trashExpiresAt;
  return current;
}

function resetAfterCustomerReturn(lead, previousStatus) {
  const current = clearDeletionMetadata(lead);
  const fieldsToClear = [
    'pendingOperationalHandoff', 'pendingOperationalEvent', 'pendingHandoffReason',
    'handoffClientError', 'handoffClientConfirmed', 'handoffError', 'handoffFailedAt',
    'transferredTo', 'transferredToName', 'transferredAt',
  ];
  for (const field of fieldsToClear) delete current[field];
  current.status = 'new';
  current.stage = 'new';
  current.operationalStatus = null;
  current.crmStage = 'attention';
  current.followUp1Sent = false;
  current.followUp2Sent = false;
  current.autoRestoredAt = new Date().toISOString();
  current.attentionStartedAt = current.autoRestoredAt;
  current.returnedFromTrashCount = Number(current.returnedFromTrashCount || 0) + 1;
  current.updatedAt = current.autoRestoredAt;
  return appendActivity(current, 'auto_restored_from_trash', {
    origin: 'customer_message',
    details: { previousStatus: previousStatus || null },
    at: current.autoRestoredAt,
  });
}

function recordMatchesIdentifiers(key, lead, identifiers) {
  if (identifiers.has(key)) return true;
  const candidates = [
    lead?.number,
    lead?.phone,
    lead?.displayNumber,
    lead?.jid,
    lead?.replyTargetJid,
    lead?.lidJid,
    lead?.internalWhatsAppId,
    getLeadRealPhone(lead),
    getLeadInternalWhatsAppId(lead),
  ].map(cleanKey).filter(Boolean);
  return candidates.some((candidate) => identifiers.has(candidate));
}

function duplicatePhoneMap(leads) {
  const counts = new Map();
  for (const lead of leads) {
    const phone = getLeadRealPhone(lead);
    if (phone) counts.set(phone, (counts.get(phone) || 0) + 1);
  }
  return counts;
}

export function deriveLeadPipelineStage(lead = {}) {
  const status = String(lead.status || 'new');
  if (ATTENTION_STATUSES.has(status)) return 'attention';
  if (CRM_STAGES.has(lead.crmStage)) return lead.crmStage;
  if (CLOSED_STATUSES.has(status)) return 'closed';
  if (QUALIFIED_STATUSES.has(status)) return 'qualified';

  const hasCustomerMessage = messageCount(lead, 'user') > 0;
  if (status === 'human_taken_over' || (ACTIVE_STATUSES.has(status) && hasCustomerMessage)) return 'active';
  if (normalizedSource(lead) === 'campaign' && !hasCustomerMessage) return 'waiting';
  if (hasCustomerMessage) return 'active';
  return 'waiting';
}

function applyAttentionTracking(previous, current, now = new Date().toISOString()) {
  const previousStage = previous ? deriveLeadPipelineStage(previous) : null;
  const currentStage = deriveLeadPipelineStage(current);

  if (currentStage === 'attention') {
    const startedAt = current.attentionStartedAt
      || previous?.attentionStartedAt
      || (previousStage === 'attention'
        ? previous?.transferredAt
          || previous?.handoffAttemptedAt
          || previous?.lastInteraction
          || previous?.updatedAt
        : current.transferredAt || current.handoffAttemptedAt || now);
    const timestamp = toTimestamp(startedAt) || toTimestamp(now) || Date.now();
    return { ...current, attentionStartedAt: new Date(timestamp).toISOString() };
  }

  if (!current.attentionStartedAt) return current;
  const next = {
    ...current,
    lastAttentionStartedAt: current.attentionStartedAt,
  };
  delete next.attentionStartedAt;
  return next;
}

export function buildLeadSubject(lead = {}) {
  const intent = lead.lastIntent || lead.lastDetectedIntent || '';
  if (INTENT_SUBJECTS[intent]) return INTENT_SUBJECTS[intent];
  if (!messageCount(lead, 'user') && normalizedSource(lead) === 'campaign') return 'Campanha sem resposta do contato';
  if (lead.status === 'human_taken_over') return 'Atendimento assumido pelo consultor';
  if (lead.status === 'blocked') return 'Automa\u00e7\u00e3o pausada';
  if (lead.status === 'resolved') return 'Atendimento resolvido';
  return 'Inten\u00e7\u00e3o ainda n\u00e3o definida';
}

export function toLeadSummary(lead = {}, { duplicateCount = 1 } = {}) {
  const userMessage = latestMessage(lead, 'user');
  const anyMessage = latestMessage(lead);
  const realPhone = getLeadRealPhone(lead);
  const userMessages = messageCount(lead, 'user');
  const summary = String(
    lead.caseSummary
    || lead.leadSummary?.caseSummary
    || lead.leadSummary?.reason
    || userMessage?.content
    || anyMessage?.content
    || '',
  ).trim();
  const updatedAt = lead.updatedAt || lead.lastInteraction || lead.createdAt || null;
  const inactivityDays = updatedAt ? Math.max(0, Math.floor((Date.now() - toTimestamp(updatedAt)) / 86400000)) : null;
  const pipelineStage = deriveLeadPipelineStage(lead);
  const attentionStartedAt = pipelineStage === 'attention'
    ? lead.attentionStartedAt
      || lead.transferredAt
      || lead.handoffAttemptedAt
      || lead.lastInteraction
      || updatedAt
    : null;
  const waitingMinutes = attentionStartedAt
    ? Math.max(0, Math.floor((Date.now() - toTimestamp(attentionStartedAt)) / 60000))
    : null;

  return {
    number: lead.number,
    name: lead.name || null,
    phone: realPhone || lead.phone || lead.displayNumber || null,
    phoneResolved: !!realPhone,
    internalWhatsAppId: getLeadInternalWhatsAppId(lead) || null,
    status: lead.status || 'new',
    stage: lead.stage || null,
    crmStage: lead.crmStage || null,
    pipelineStage,
    source: normalizedSource(lead),
    lastIntent: lead.lastIntent || lead.lastDetectedIntent || null,
    conversationMode: lead.conversationMode || null,
    subject: buildLeadSubject(lead),
    summary: summary.slice(0, 220),
    lastCustomerMessage: String(userMessage?.content || '').trim().slice(0, 220),
    userMessageCount: userMessages,
    hasCustomerMessage: userMessages > 0,
    tag: lead.tag || null,
    model: lead.model || null,
    year: lead.year || null,
    plate: lead.plate || null,
    riskLevel: lead.riskLevel || null,
    automationPaused: AUTOMATION_PAUSED_STATUSES.has(String(lead.status || '')),
    createdAt: lead.createdAt || null,
    updatedAt,
    attentionStartedAt,
    deletedAt: lead.deletedAt || null,
    deleteReason: lead.deleteReason || null,
    deletedBy: lead.deletedBy || null,
    trashExpiresAt: lead.trashExpiresAt || null,
    autoRestoredAt: lead.autoRestoredAt || null,
    returnedFromTrashCount: Number(lead.returnedFromTrashCount || 0),
    inactivityDays,
    attentionWaitingMinutes: pipelineStage === 'attention' ? waitingMinutes : null,
    attentionOverdue: pipelineStage === 'attention' && waitingMinutes >= 15,
    duplicateCount,
    hasDuplicate: duplicateCount > 1,
    internalNoteCount: Array.isArray(lead.internalNotes) ? lead.internalNotes.length : 0,
    activityCount: Array.isArray(lead.activity) ? lead.activity.length : 0,
  };
}

function summarizeLeads(leads) {
  const phoneCounts = duplicatePhoneMap(leads);
  return leads.map((lead) => {
    const phone = getLeadRealPhone(lead);
    return toLeadSummary(lead, { duplicateCount: phone ? phoneCounts.get(phone) || 1 : 1 });
  });
}

function buildOverviewFromLeads(leads) {
  const summaries = summarizeLeads(leads);
  const counts = {
    total: summaries.length,
    customerConversations: summaries.filter((lead) => lead.hasCustomerMessage).length,
    attention: 0,
    active: 0,
    qualified: 0,
    waiting: 0,
    closed: 0,
    overdueAttention: summaries.filter((lead) => lead.attentionOverdue).length,
    returnedFromTrash: summaries.filter((lead) => lead.autoRestoredAt).length,
    duplicateGroups: new Set(summaries.filter((lead) => lead.hasDuplicate && lead.phoneResolved).map((lead) => lead.phone)).size,
  };
  for (const lead of summaries) {
    if (Object.hasOwn(counts, lead.pipelineStage)) counts[lead.pipelineStage] += 1;
  }

  const today = new Date().toDateString();
  counts.today = summaries.filter((lead) => {
    if (!lead.createdAt) return false;
    return new Date(lead.createdAt).toDateString() === today;
  }).length;

  return { counts, generatedAt: new Date().toISOString() };
}

export function getLeadOverview() {
  return buildOverviewFromLeads(getAllLeads());
}

function notificationFor(previous, current, action = '') {
  if (action === 'auto_restored') return { kind: 'returned_from_trash', priority: 'high' };
  if (!current) return null;
  const previousStage = previous ? deriveLeadPipelineStage(previous) : null;
  const currentStage = deriveLeadPipelineStage(current);
  const previousMessages = messageCount(previous, 'user');
  const currentMessages = messageCount(current, 'user');

  if (currentStage === 'attention' && (previousStage !== 'attention' || currentMessages > previousMessages)) {
    return { kind: 'attention_required', priority: 'high' };
  }
  if (previousMessages === 0 && currentMessages > 0) {
    return { kind: 'new_conversation', priority: 'normal' };
  }
  return null;
}

function emitLeadEvent({ action, previous = null, current = null, count = 1, origin = 'system', overview = null }) {
  if (listeners.size === 0) return;
  const event = {
    type: 'lead_event',
    eventId: `${Date.now()}-${++eventSequence}`,
    action,
    count,
    origin,
    previousPipelineStage: previous ? deriveLeadPipelineStage(previous) : null,
    pipelineStage: current ? deriveLeadPipelineStage(current) : null,
    notification: notificationFor(previous, current, action),
    overview: overview || getLeadOverview(),
    occurredAt: new Date().toISOString(),
  };
  for (const listener of listeners) {
    try { listener(event); } catch (error) {
      console.error(`[Leads] Event listener failed: ${error.message}`);
    }
  }
}

export function subscribeLeadEvents(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLead(number) {
  return loadAll()[number] || null;
}

export function getDeletedLead(number) {
  return loadTrash()[number] || null;
}

export function saveLead(number, leadData, options = {}) {
  const key = cleanKey(number);
  if (!key) throw new Error('Lead number is required.');
  const all = loadAll();
  const previous = all[key] || null;
  const now = new Date().toISOString();
  let current = {
    ...(previous || {}),
    ...(leadData || {}),
    number: key,
    updatedAt: now,
  };
  current = applyAttentionTracking(previous, current, now);
  if (previous) current = addTrackedUpdateActivity(previous, current, options.origin || 'system');
  all[key] = current;
  saveJsonAtomic(LEADS_FILE, all);
  emitLeadEvent({
    action: previous ? 'updated' : 'created',
    previous,
    current,
    origin: options.origin,
    overview: buildOverviewFromLeads(Object.values(all)),
  });
  return current;
}

export function updateLead(number, updates, options = {}) {
  const key = cleanKey(number);
  const all = loadAll();
  if (!all[key]) return null;
  const previous = all[key];
  const now = new Date().toISOString();
  let current = {
    ...previous,
    ...(updates || {}),
    number: key,
    updatedAt: now,
  };
  current = applyAttentionTracking(previous, current, now);
  current = addTrackedUpdateActivity(previous, current, options.origin || 'system');
  all[key] = current;
  saveJsonAtomic(LEADS_FILE, all);
  emitLeadEvent({
    action: 'updated',
    previous,
    current,
    origin: options.origin,
    overview: buildOverviewFromLeads(Object.values(all)),
  });
  return current;
}

export function bulkUpdateLeads(numbers, updates, options = {}) {
  const keys = uniqueKeys(numbers);
  const all = loadAll();
  const changed = [];
  const now = new Date().toISOString();
  for (const key of keys) {
    if (!all[key]) continue;
    const previous = all[key];
    let current = { ...previous, ...(updates || {}), number: key, updatedAt: now };
    current = applyAttentionTracking(previous, current, now);
    current = addTrackedUpdateActivity(previous, current, options.origin || 'system');
    all[key] = current;
    changed.push(key);
  }
  if (changed.length > 0) {
    saveJsonAtomic(LEADS_FILE, all);
    emitLeadEvent({
      action: 'bulk_updated',
      count: changed.length,
      origin: options.origin,
      overview: buildOverviewFromLeads(Object.values(all)),
    });
  }
  return { updated: changed.length, numbers: changed };
}

export function getAllLeads({ summary = false } = {}) {
  const leads = Object.values(loadAll()).sort((a, b) =>
    toTimestamp(b.updatedAt || b.createdAt) - toTimestamp(a.updatedAt || a.createdAt)
  );
  return summary ? summarizeLeads(leads) : leads;
}

function moveToTrash(keys, options = {}) {
  const all = loadAll();
  const trash = loadTrash();
  const deletedAt = new Date().toISOString();
  const retentionDays = Number(getLeadSettings().trashRetentionDays || 0);
  const moved = [];
  const alreadyDeleted = [];

  for (const key of uniqueKeys(keys)) {
    if (!all[key]) {
      if (trash[key]) alreadyDeleted.push(key);
      continue;
    }
    const previous = all[key];
    let archived = appendActivity(previous, 'moved_to_trash', {
      origin: options.origin || 'system',
      details: {
        reason: options.reason || 'manual_delete',
        previousStage: deriveLeadPipelineStage(previous),
      },
      at: deletedAt,
    });
    archived = {
      ...archived,
      deletedAt,
      deletedBy: options.actor || options.origin || 'system',
      deleteReason: options.reason || 'manual_delete',
      deletedFromStage: deriveLeadPipelineStage(previous),
      trashExpiresAt: retentionDays > 0
        ? new Date(toTimestamp(deletedAt) + retentionDays * 86400000).toISOString()
        : null,
    };
    trash[key] = trash[key]
      ? mergeRecords([trash[key], archived], key, { origin: options.origin, reason: 'trash_conflict' })
      : archived;
    delete all[key];
    moved.push(key);
  }

  if (moved.length > 0) {
    saveJsonAtomic(LEADS_TRASH_FILE, trash);
    saveJsonAtomic(LEADS_FILE, all);
    emitLeadEvent({
      action: 'deleted',
      count: moved.length,
      origin: options.origin,
      overview: buildOverviewFromLeads(Object.values(all)),
    });
  }
  return { moved, alreadyDeleted };
}

export function deleteLead(number, options = {}) {
  const result = moveToTrash([cleanKey(number)], options);
  return result.moved.length === 1 || result.alreadyDeleted.length === 1;
}

export function bulkDeleteLeads(numbers, options = {}) {
  const result = moveToTrash(numbers, options);
  return {
    deleted: result.moved.length,
    alreadyDeleted: result.alreadyDeleted.length,
    numbers: result.moved,
  };
}

export function clearAllLeads(options = {}) {
  const keys = Object.keys(loadAll());
  return bulkDeleteLeads(keys, options).deleted;
}

export function getDeletedLeads({ summary = false } = {}) {
  const leads = Object.values(loadTrash()).sort((a, b) =>
    toTimestamp(b.deletedAt) - toTimestamp(a.deletedAt)
  );
  return summary ? summarizeLeads(leads) : leads;
}

function findActiveDuplicate(all, lead, excludedKey = '') {
  const phone = getLeadRealPhone(lead);
  if (!phone) return null;
  return Object.entries(all).find(([key, candidate]) => key !== excludedKey && getLeadRealPhone(candidate) === phone) || null;
}

export function restoreDeletedLeads(numbers, options = {}) {
  const keys = uniqueKeys(numbers);
  const all = loadAll();
  const trash = loadTrash();
  const restored = [];
  const merged = [];
  const missing = [];
  const referenceMoves = [];

  for (const key of keys) {
    const archived = trash[key];
    if (!archived) {
      missing.push(key);
      continue;
    }
    const duplicate = all[key] ? [key, all[key]] : findActiveDuplicate(all, archived, key);
    const targetKey = duplicate?.[0] || key;
    let current = duplicate
      ? mergeRecords([duplicate[1], archived], targetKey, { origin: options.origin, reason: 'restore_conflict' })
      : clearDeletionMetadata(archived);
    current = appendActivity(current, duplicate ? 'restored_and_merged' : 'restored_from_trash', {
      origin: options.origin || 'dashboard',
      details: { from: key, to: targetKey },
    });
    current.number = targetKey;
    current.updatedAt = new Date().toISOString();
    if (current.status !== 'blocked') current.crmStage = 'attention';
    current.attentionStartedAt = current.updatedAt;
    all[targetKey] = current;
    delete trash[key];
    referenceMoves.push({ from: key, to: targetKey });
    if (duplicate) merged.push(targetKey);
    else restored.push(targetKey);
  }

  if (restored.length > 0 || merged.length > 0) {
    saveJsonAtomic(LEADS_FILE, all);
    saveJsonAtomic(LEADS_TRASH_FILE, trash);
    emitLeadEvent({
      action: merged.length > 0 ? 'restored_with_merge' : 'restored',
      count: restored.length + merged.length,
      origin: options.origin,
      overview: buildOverviewFromLeads(Object.values(all)),
    });
  }
  return {
    restored: restored.length,
    merged: merged.length,
    skipped: missing.length,
    numbers: [...restored, ...merged],
    referenceMoves,
  };
}

export function recoverDeletedLeadForIncoming({ identifiers = [], preferredKey = null } = {}) {
  const identifierSet = new Set(uniqueKeys([preferredKey, ...identifiers]));
  if (identifierSet.size === 0) return null;
  const all = loadAll();
  const trash = loadTrash();
  const trashMatches = Object.entries(trash).filter(([key, lead]) => recordMatchesIdentifiers(key, lead, identifierSet));
  if (trashMatches.length === 0) return null;

  const archivedRecords = trashMatches.map(([, lead]) => lead);
  const realPhone = archivedRecords.map(getLeadRealPhone).find(Boolean) || null;
  const activeMatch = Object.entries(all).find(([key, lead]) => (
    recordMatchesIdentifiers(key, lead, identifierSet)
    || (realPhone && getLeadRealPhone(lead) === realPhone)
  ));
  const targetKey = activeMatch?.[0] || cleanKey(preferredKey) || trashMatches[0][0];
  const previousStatus = pickRecentRecord(archivedRecords).status || null;
  const records = [...(activeMatch ? [activeMatch[1]] : []), ...archivedRecords];
  let current = mergeRecords(records, targetKey, { origin: 'customer_message', reason: 'customer_returned' });
  current = resetAfterCustomerReturn(current, previousStatus);
  all[targetKey] = current;

  const referenceMoves = [];
  for (const [key] of trashMatches) {
    delete trash[key];
    referenceMoves.push({ from: key, to: targetKey });
  }
  if (activeMatch && activeMatch[0] !== targetKey) {
    delete all[activeMatch[0]];
    referenceMoves.push({ from: activeMatch[0], to: targetKey });
  }

  saveJsonAtomic(LEADS_FILE, all);
  saveJsonAtomic(LEADS_TRASH_FILE, trash);
  emitLeadEvent({
    action: 'auto_restored',
    previous: archivedRecords[0],
    current,
    count: 1,
    origin: 'customer_message',
    overview: buildOverviewFromLeads(Object.values(all)),
  });
  return { lead: current, key: targetKey, referenceMoves, merged: records.length > 1 };
}

export function getDuplicateLeadGroups() {
  const groups = new Map();
  for (const lead of getAllLeads()) {
    const phone = getLeadRealPhone(lead);
    if (!phone) continue;
    if (!groups.has(phone)) groups.set(phone, []);
    groups.get(phone).push(lead);
  }
  return [...groups.entries()]
    .filter(([, leads]) => leads.length > 1)
    .map(([phone, leads]) => ({ phone, count: leads.length, leads: summarizeLeads(leads) }))
    .sort((a, b) => b.count - a.count);
}

export function mergeActiveLeads(numbers, { targetNumber = null, origin = 'dashboard', reason = 'manual_merge' } = {}) {
  const keys = uniqueKeys(numbers);
  const all = loadAll();
  const entries = keys.filter((key) => all[key]).map((key) => [key, all[key]]);
  if (entries.length < 2) throw new Error('Selecione pelo menos dois leads existentes para mesclar.');
  const phones = [...new Set(entries.map(([, lead]) => getLeadRealPhone(lead)).filter(Boolean))];
  if (phones.length !== 1 || entries.some(([, lead]) => !getLeadRealPhone(lead))) {
    throw new Error('A mesclagem so e permitida para registros com o mesmo telefone confirmado.');
  }
  const targetKey = entries.some(([key]) => key === targetNumber)
    ? targetNumber
    : entries.find(([key]) => key === phones[0])?.[0] || entries[0][0];
  const current = mergeRecords(entries.map(([, lead]) => lead), targetKey, { origin, reason });
  for (const [key] of entries) delete all[key];
  all[targetKey] = current;
  saveJsonAtomic(LEADS_FILE, all);
  emitLeadEvent({
    action: 'merged',
    current,
    count: entries.length,
    origin,
    overview: buildOverviewFromLeads(Object.values(all)),
  });
  return {
    merged: entries.length,
    targetNumber: targetKey,
    removedNumbers: entries.map(([key]) => key).filter((key) => key !== targetKey),
    referenceMoves: entries.map(([key]) => ({ from: key, to: targetKey })),
    lead: current,
  };
}

export function permanentlyDeleteLeads(numbers, options = {}) {
  const keys = uniqueKeys(numbers);
  const trash = loadTrash();
  const deleted = [];
  const missing = [];
  for (const key of keys) {
    if (!trash[key]) {
      missing.push(key);
      continue;
    }
    delete trash[key];
    deleted.push(key);
  }
  if (deleted.length > 0) {
    saveJsonAtomic(LEADS_TRASH_FILE, trash);
    emitLeadEvent({
      action: 'permanently_deleted',
      count: deleted.length,
      origin: options.origin,
      overview: buildOverviewFromLeads(getAllLeads()),
    });
  }
  return { permanentlyDeleted: deleted.length, numbers: deleted, missing: missing.length };
}

export function emptyTrash(options = {}) {
  return permanentlyDeleteLeads(Object.keys(loadTrash()), options);
}

export function getLeadSettings() {
  const stored = loadJson(LEADS_SETTINGS_FILE);
  const retention = Number(stored.trashRetentionDays);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    trashRetentionDays: [0, 30, 60, 90].includes(retention) ? retention : 0,
  };
}

export function updateLeadSettings(updates = {}) {
  const current = getLeadSettings();
  const retention = Number(updates.trashRetentionDays ?? current.trashRetentionDays);
  if (![0, 30, 60, 90].includes(retention)) throw new Error('Prazo da lixeira invalido.');
  const next = { ...current, trashRetentionDays: retention, updatedAt: new Date().toISOString() };
  saveJsonAtomic(LEADS_SETTINGS_FILE, next);
  const trash = loadTrash();
  let trashChanged = false;
  for (const [key, lead] of Object.entries(trash)) {
    const expiresAt = retention > 0 && lead.deletedAt
      ? new Date(toTimestamp(lead.deletedAt) + retention * 86400000).toISOString()
      : null;
    if ((lead.trashExpiresAt || null) === expiresAt) continue;
    trash[key] = { ...lead, trashExpiresAt: expiresAt };
    trashChanged = true;
  }
  if (trashChanged) saveJsonAtomic(LEADS_TRASH_FILE, trash);
  return next;
}

export function getExpiredTrashKeys(now = Date.now()) {
  return Object.entries(loadTrash())
    .filter(([, lead]) => lead.trashExpiresAt && toTimestamp(lead.trashExpiresAt) <= now)
    .map(([key]) => key);
}

export function createLeadsBackup(reason = 'manual') {
  ensureDir(LEADS_BACKUP_DIR);
  const createdAt = new Date().toISOString();
  const backupId = createdAt.replace(/[:.]/g, '-') + `-${randomBytes(3).toString('hex')}`;
  const file = path.join(LEADS_BACKUP_DIR, `${backupId}.json`);
  saveJsonAtomic(file, {
    backupId,
    reason: cleanKey(reason) || 'manual',
    createdAt,
    active: loadAll(),
    trash: loadTrash(),
    settings: getLeadSettings(),
  });
  const backups = fs.readdirSync(LEADS_BACKUP_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, file: path.join(LEADS_BACKUP_DIR, name), timestamp: fs.statSync(path.join(LEADS_BACKUP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.timestamp - a.timestamp);
  for (const backup of backups.slice(BACKUP_LIMIT)) {
    try { fs.unlinkSync(backup.file); } catch {}
  }
  return { backupId, createdAt };
}

export function addInternalNote(number, text, { author = 'Consultor principal', origin = 'dashboard' } = {}) {
  const key = cleanKey(number);
  const noteText = String(text || '').trim().slice(0, 1200);
  if (!noteText) throw new Error('Escreva uma observa\u00e7\u00e3o antes de salvar.');
  const all = loadAll();
  if (!all[key]) return null;
  const now = new Date().toISOString();
  const note = { id: randomUUID(), text: noteText, author, createdAt: now };
  let current = {
    ...all[key],
    internalNotes: [...(Array.isArray(all[key].internalNotes) ? all[key].internalNotes : []), note].slice(-100),
    updatedAt: now,
  };
  current = applyAttentionTracking(all[key], current, now);
  current = appendActivity(current, 'internal_note_added', { origin, details: { noteId: note.id } });
  all[key] = current;
  saveJsonAtomic(LEADS_FILE, all);
  emitLeadEvent({ action: 'note_added', previous: null, current, origin, overview: buildOverviewFromLeads(Object.values(all)) });
  return note;
}

export function deleteInternalNote(number, noteId, { origin = 'dashboard' } = {}) {
  const key = cleanKey(number);
  const all = loadAll();
  if (!all[key]) return false;
  const notes = Array.isArray(all[key].internalNotes) ? all[key].internalNotes : [];
  const nextNotes = notes.filter((note) => note.id !== noteId);
  if (nextNotes.length === notes.length) return false;
  const now = new Date().toISOString();
  let current = { ...all[key], internalNotes: nextNotes, updatedAt: now };
  current = applyAttentionTracking(all[key], current, now);
  current = appendActivity(current, 'internal_note_deleted', { origin, details: { noteId } });
  all[key] = current;
  saveJsonAtomic(LEADS_FILE, all);
  emitLeadEvent({ action: 'note_deleted', current, origin, overview: buildOverviewFromLeads(Object.values(all)) });
  return true;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function exportLeadsCSV() {
  const leads = getAllLeads();
  const headers = ['Telefone real', 'ID interno WhatsApp', 'Nome', 'Assunto', 'Modelo', 'Placa', 'Status', 'Categoria CRM', 'Origem', 'Criado em', 'Atualizado em', 'Transferido para'];
  const rows = leads.map((lead) => [
    getLeadRealPhone(lead) || 'N\u00e3o resolvido',
    getLeadInternalWhatsAppId(lead) || '',
    lead.name || '',
    buildLeadSubject(lead),
    lead.model || '',
    lead.plate || '',
    lead.status || '',
    deriveLeadPipelineStage(lead),
    normalizedSource(lead),
    lead.createdAt ? new Date(lead.createdAt).toLocaleString('pt-BR') : '',
    lead.updatedAt ? new Date(lead.updatedAt).toLocaleString('pt-BR') : '',
    lead.transferredTo || '',
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function getLeadStats() {
  const leads = getAllLeads();
  const legacyQualified = leads.filter((lead) => lead.status === 'qualified' || lead.status === 'transferred');
  const today = new Date().toDateString();
  const todayLeads = leads.filter((lead) => lead.createdAt && new Date(lead.createdAt).toDateString() === today);
  const todayQualified = todayLeads.filter((lead) => lead.status === 'qualified' || lead.status === 'transferred');
  const overview = buildOverviewFromLeads(leads);
  return {
    total: leads.length,
    todayTotal: todayLeads.length,
    talking: leads.filter((lead) => lead.status === 'talking').length,
    qualified: legacyQualified.length,
    todayQualified: todayQualified.length,
    transferred: leads.filter((lead) => lead.status === 'transferred').length,
    cold: leads.filter((lead) => lead.status === 'cold').length,
    blocked: leads.filter((lead) => lead.status === 'blocked').length,
    no_interest: leads.filter((lead) => lead.status === 'no_interest').length,
    conversationRate: todayLeads.length > 0 ? Math.round((todayQualified.length / todayLeads.length) * 100) : 0,
    pipeline: overview.counts,
  };
}
