import {
  bulkDeleteLeads,
  buildLeadSubject,
  createLeadsBackup,
  emptyTrash as emptyTrashRecords,
  getAllLeads,
  getDeletedLead,
  getDeletedLeads,
  getExpiredTrashKeys,
  getLead,
  mergeActiveLeads,
  permanentlyDeleteLeads,
  recoverDeletedLeadForIncoming,
  restoreDeletedLeads,
  updateLead,
} from './leads-manager.js';
import {
  deleteRemindersForLeads,
  listOpenReminders,
  markRemindersForReview,
  pauseRemindersForLeads,
  rekeyReminders,
} from './reminders-repository.js';
import { deleteEventsForLeads, listEventsForLeads, recordEvent, rekeyEvents } from './events-repository.js';
import { deleteTagsForLeads, rekeyTags } from './tags-repository.js';
import { classifyDeterministicIntent } from '../ai/deterministic-intent.js';
import { getLeadRealPhone } from '../phone-utils.js';

function uniqueKeys(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

async function rekeyLeadReferences(referenceMoves = []) {
  const moves = referenceMoves.filter((move) => move?.from && move?.to && move.from !== move.to);
  if (moves.length === 0) return;
  await Promise.all([
    rekeyReminders(moves),
    rekeyTags(moves),
    rekeyEvents(moves),
  ]);
}

async function recordLifecycleEvents(numbers, eventType, payload = {}) {
  await Promise.all(uniqueKeys(numbers).map((leadKey) => recordEvent({ leadKey, eventType, payload })));
}

export async function archiveLeads(numbers, {
  origin = 'dashboard',
  actor = 'Consultor principal',
  reason = 'manual_delete',
  backup = false,
} = {}) {
  const keys = uniqueKeys(numbers);
  const backupInfo = backup || keys.length > 1 ? createLeadsBackup(`archive:${reason}`) : null;
  const result = bulkDeleteLeads(keys, { origin, actor, reason });
  let reminderResult = { paused: 0, reminderCount: 0, numbers: [] };
  if (result.numbers.length > 0) {
    reminderResult = await pauseRemindersForLeads(result.numbers, { reason: 'lead_archived' });
    await recordLifecycleEvents(result.numbers, 'lead_moved_to_trash', { reason, actor });
  }
  return {
    ...result,
    remindersPaused: reminderResult.paused,
    reminderCount: reminderResult.reminderCount,
    backup: backupInfo,
  };
}

export async function restoreLeads(numbers, { origin = 'dashboard' } = {}) {
  const result = restoreDeletedLeads(numbers, { origin });
  await rekeyLeadReferences(result.referenceMoves);
  if (result.numbers.length > 0) {
    await markRemindersForReview(result.numbers, { reason: 'lead_restored' });
    await recordLifecycleEvents(result.numbers, 'lead_restored_from_trash', {
      merged: result.merged > 0,
    });
  }
  return result;
}

export async function recoverLeadWhenCustomerReturns({ identifiers = [], preferredKey = null } = {}) {
  const result = recoverDeletedLeadForIncoming({ identifiers, preferredKey });
  if (!result) return null;
  await rekeyLeadReferences(result.referenceMoves);
  await markRemindersForReview([result.key], { reason: 'customer_returned' });
  await recordEvent({
    leadKey: result.key,
    eventType: 'lead_auto_restored_from_trash',
    payload: { merged: !!result.merged },
  });
  return result;
}

export async function mergeLeads(numbers, { targetNumber = null, origin = 'dashboard' } = {}) {
  const backup = createLeadsBackup('merge_duplicates');
  const result = mergeActiveLeads(numbers, { targetNumber, origin, reason: 'manual_duplicate_merge' });
  await rekeyLeadReferences(result.referenceMoves);
  await recordEvent({
    leadKey: result.targetNumber,
    eventType: 'duplicate_leads_merged',
    payload: { merged_count: result.merged, removed_count: result.removedNumbers.length },
  });
  return { ...result, backup };
}

async function purgeAuxiliaryLeadData(numbers) {
  const keys = uniqueKeys(numbers);
  await Promise.all([
    deleteRemindersForLeads(keys),
    deleteTagsForLeads(keys),
    deleteEventsForLeads(keys),
  ]);
}

export async function deleteLeadsPermanently(numbers, { origin = 'dashboard', reason = 'manual_permanent_delete' } = {}) {
  const keys = uniqueKeys(numbers);
  const backup = createLeadsBackup(`permanent:${reason}`);
  const result = permanentlyDeleteLeads(keys, { origin });
  await purgeAuxiliaryLeadData(result.numbers);
  return { ...result, backup };
}

export async function emptyTrashPermanently({ origin = 'dashboard', reason = 'empty_trash' } = {}) {
  const backup = createLeadsBackup(`permanent:${reason}`);
  const result = emptyTrashRecords({ origin });
  await purgeAuxiliaryLeadData(result.numbers);
  return { ...result, backup };
}

export async function cleanupExpiredTrash({ origin = 'retention_policy' } = {}) {
  const expired = getExpiredTrashKeys();
  if (expired.length === 0) return { permanentlyDeleted: 0, numbers: [] };
  return deleteLeadsPermanently(expired, { origin, reason: 'retention_expired' });
}

export async function previewLeadArchive(numbers) {
  const keys = uniqueKeys(numbers);
  const openReminders = await listOpenReminders({ limit: 5000, includePaused: true });
  const reminders = openReminders.filter((reminder) => keys.includes(String(reminder.lead_key)));
  return {
    count: keys.length,
    reminderCount: reminders.length,
    leadsWithReminders: new Set(reminders.map((reminder) => reminder.lead_key)).size,
  };
}

function recentCustomerText(lead) {
  return (Array.isArray(lead?.history) ? lead.history : [])
    .filter((entry) => entry?.role === 'user' && entry.content)
    .slice(-5)
    .map((entry) => String(entry.content))
    .join('\n');
}

export async function reclassifyHistoricalLeads({ origin = 'maintenance' } = {}) {
  const leads = getAllLeads();
  const candidates = leads.filter((lead) => recentCustomerText(lead));
  if (candidates.length === 0) return { reviewed: 0, updated: 0 };
  const backup = createLeadsBackup('reclassify_historical_intents');
  let updated = 0;

  for (const lead of candidates) {
    const result = classifyDeterministicIntent(recentCustomerText(lead));
    if (!result?.explicit || result.mode === 'ambiguous' || !result.intent) continue;
    const currentIntent = lead.lastIntent || lead.lastDetectedIntent || '';
    if (currentIntent === result.intent && lead.leadSubject) continue;
    updateLead(lead.number, {
      lastIntent: result.intent,
      lastDetectedIntent: result.intent,
      leadSubject: buildLeadSubject({ ...lead, lastIntent: result.intent }),
      intentReclassifiedAt: new Date().toISOString(),
    }, { origin });
    updated += 1;
  }

  await recordEvent({
    eventType: 'historical_leads_reclassified',
    payload: { reviewed: candidates.length, updated },
  });
  return { reviewed: candidates.length, updated, backup };
}

export async function consolidateAllDuplicateLeads({ origin = 'maintenance' } = {}) {
  const groups = new Map();
  for (const lead of getAllLeads()) {
    const phone = getLeadRealPhone(lead);
    if (!phone) continue;
    if (!groups.has(phone)) groups.set(phone, []);
    groups.get(phone).push(lead.number);
  }
  const duplicates = [...groups.values()].filter((numbers) => numbers.length > 1);
  if (duplicates.length === 0) return { groups: 0, merged: 0 };
  let merged = 0;
  for (const numbers of duplicates) {
    try {
      const result = await mergeLeads(numbers, { origin });
      merged += result.removedNumbers.length;
    } catch (error) {
      console.warn(`[Leads] Could not consolidate duplicate group: ${error.message}`);
    }
  }
  return { groups: duplicates.length, merged };
}

export async function getLeadTimeline(number) {
  const lead = getLead(number) || getDeletedLead(number);
  if (!lead) return null;
  const aliases = uniqueKeys([number, ...(lead.mergedFrom || [])]);
  const events = await listEventsForLeads(aliases, { limit: 250 });
  const messages = (Array.isArray(lead.history) ? lead.history : []).map((message, index) => ({
    id: `message-${message.ts || index}-${index}`,
    kind: 'message',
    type: message.role === 'user' ? 'customer_message' : 'bot_message',
    at: message.ts ? new Date(message.ts).toISOString() : lead.createdAt || null,
    content: String(message.content || ''),
    role: message.role || 'unknown',
    deliveryStatus: message.deliveryStatus || null,
  }));
  const activity = (Array.isArray(lead.activity) ? lead.activity : []).map((item) => ({
    id: item.id,
    kind: 'activity',
    type: item.type,
    at: item.at,
    origin: item.origin,
    details: item.details || {},
  }));
  const repositoryEvents = events.map((event) => ({
    id: event.id,
    kind: 'event',
    type: event.event_type,
    at: event.created_at,
    details: event.payload_json || {},
  }));
  const seen = new Set();
  return [...messages, ...activity, ...repositoryEvents]
    .filter((item) => {
      const signature = `${item.kind}|${item.type}|${item.at}|${item.id}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 400);
}

export function getTrashSummary() {
  return getDeletedLeads({ summary: true });
}
