import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { LEADS_FILE } from '../storage/paths.js';
import { getLeadInternalWhatsAppId, getLeadRealPhone } from '../phone-utils.js';

const LEADS_TRASH_FILE = path.join(path.dirname(LEADS_FILE), 'leads-trash.json');
const CRM_STAGES = new Set(['attention', 'active', 'qualified', 'waiting', 'closed']);
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
const listeners = new Set();
let eventSequence = 0;

function ensureDir(file = LEADS_FILE) {
  const dir = path.dirname(file);
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

export function toLeadSummary(lead = {}) {
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

  return {
    number: lead.number,
    name: lead.name || null,
    phone: realPhone || lead.phone || lead.displayNumber || null,
    phoneResolved: !!realPhone,
    internalWhatsAppId: getLeadInternalWhatsAppId(lead) || null,
    status: lead.status || 'new',
    stage: lead.stage || null,
    crmStage: lead.crmStage || null,
    pipelineStage: deriveLeadPipelineStage(lead),
    source: normalizedSource(lead),
    lastIntent: lead.lastIntent || lead.lastDetectedIntent || null,
    conversationMode: lead.conversationMode || null,
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
    updatedAt: lead.updatedAt || lead.lastInteraction || lead.createdAt || null,
    deletedAt: lead.deletedAt || null,
  };
}

function buildOverviewFromLeads(leads) {
  const summaries = leads.map(toLeadSummary);
  const counts = {
    total: summaries.length,
    customerConversations: summaries.filter((lead) => lead.hasCustomerMessage).length,
    attention: 0,
    active: 0,
    qualified: 0,
    waiting: 0,
    closed: 0,
  };
  for (const lead of summaries) {
    if (Object.hasOwn(counts, lead.pipelineStage)) counts[lead.pipelineStage] += 1;
  }

  const today = new Date().toDateString();
  counts.today = summaries.filter((lead) => {
    if (!lead.createdAt) return false;
    return new Date(lead.createdAt).toDateString() === today;
  }).length;

  return {
    counts,
    generatedAt: new Date().toISOString(),
  };
}

export function getLeadOverview() {
  return buildOverviewFromLeads(getAllLeads());
}

function notificationFor(previous, current) {
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
    notification: notificationFor(previous, current),
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

export function saveLead(number, leadData, options = {}) {
  const key = String(number || '').trim();
  if (!key) throw new Error('Lead number is required.');
  const all = loadAll();
  const previous = all[key] || null;
  const current = {
    ...(previous || {}),
    ...(leadData || {}),
    number: key,
    updatedAt: new Date().toISOString(),
  };
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
  const key = String(number || '').trim();
  const all = loadAll();
  if (!all[key]) return null;
  const previous = all[key];
  const current = {
    ...previous,
    ...(updates || {}),
    number: key,
    updatedAt: new Date().toISOString(),
  };
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
  const keys = [...new Set((Array.isArray(numbers) ? numbers : []).map((value) => String(value || '').trim()).filter(Boolean))];
  const all = loadAll();
  const changed = [];
  const now = new Date().toISOString();
  for (const key of keys) {
    if (!all[key]) continue;
    all[key] = { ...all[key], ...(updates || {}), number: key, updatedAt: now };
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
    new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
  );
  return summary ? leads.map(toLeadSummary) : leads;
}

function moveToTrash(keys, options = {}) {
  const all = loadAll();
  const trash = loadTrash();
  const deletedAt = new Date().toISOString();
  const moved = [];

  for (const key of keys) {
    if (!all[key]) continue;
    trash[key] = { ...all[key], deletedAt };
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
  return moved;
}

export function deleteLead(number, options = {}) {
  return moveToTrash([String(number || '').trim()], options).length === 1;
}

export function bulkDeleteLeads(numbers, options = {}) {
  const keys = [...new Set((Array.isArray(numbers) ? numbers : []).map((value) => String(value || '').trim()).filter(Boolean))];
  const moved = moveToTrash(keys, options);
  return { deleted: moved.length, numbers: moved };
}

export function clearAllLeads(options = {}) {
  const keys = Object.keys(loadAll());
  return bulkDeleteLeads(keys, options).deleted;
}

export function getDeletedLeads({ summary = false } = {}) {
  const leads = Object.values(loadTrash()).sort((a, b) =>
    new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0)
  );
  return summary ? leads.map(toLeadSummary) : leads;
}

export function restoreDeletedLeads(numbers, options = {}) {
  const keys = [...new Set((Array.isArray(numbers) ? numbers : []).map((value) => String(value || '').trim()).filter(Boolean))];
  const all = loadAll();
  const trash = loadTrash();
  const restored = [];
  const skipped = [];

  for (const key of keys) {
    if (!trash[key]) continue;
    if (all[key]) {
      skipped.push(key);
      continue;
    }
    const { deletedAt, ...lead } = trash[key];
    all[key] = { ...lead, number: key, updatedAt: new Date().toISOString() };
    delete trash[key];
    restored.push(key);
  }

  if (restored.length > 0) {
    saveJsonAtomic(LEADS_FILE, all);
    saveJsonAtomic(LEADS_TRASH_FILE, trash);
    emitLeadEvent({
      action: 'restored',
      count: restored.length,
      origin: options.origin,
      overview: buildOverviewFromLeads(Object.values(all)),
    });
  }
  return { restored: restored.length, skipped: skipped.length, numbers: restored };
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function exportLeadsCSV() {
  const leads = getAllLeads();
  const headers = ['Telefone real', 'ID interno WhatsApp', 'Nome', 'Modelo', 'Placa', 'Status', 'Categoria CRM', 'Origem', 'Criado em', 'Atualizado em', 'Transferido para'];
  const rows = leads.map((lead) => [
    getLeadRealPhone(lead) || 'Nao resolvido',
    getLeadInternalWhatsAppId(lead) || '',
    lead.name || '',
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
