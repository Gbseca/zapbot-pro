import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import { normalizeRealWhatsAppPhone } from '../phone-utils.js';
import { readJsonArray, readJsonFile, writeJsonFile } from './local-json-store.js';
import { getSupabaseClient, warnSupabaseFallback } from './supabase-client.js';
import { recordEvent } from './events-repository.js';

const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');
const REMINDER_STATES_FILE = path.join(DATA_DIR, 'reminder-states.json');

function cleanLeadKey(value) {
  return String(value || '').trim();
}

function uniqueLeadKeys(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanLeadKey).filter(Boolean))];
}

function readReminderStates() {
  const value = readJsonFile(REMINDER_STATES_FILE, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function writeReminderStates(states) {
  writeJsonFile(REMINDER_STATES_FILE, states);
}

function reminderStateFor(leadKey, states = readReminderStates()) {
  return states[cleanLeadKey(leadKey)] || null;
}

function withReminderState(reminder, states = readReminderStates()) {
  if (!reminder) return null;
  const state = reminderStateFor(reminder.lead_key, states);
  return {
    ...reminder,
    paused: !!state?.paused,
    pause_reason: state?.reason || null,
    paused_at: state?.paused_at || null,
    review_required: !!state?.review_required,
    restored_at: state?.restored_at || null,
  };
}

function clearReminderState(leadKey) {
  const key = cleanLeadKey(leadKey);
  if (!key) return;
  const states = readReminderStates();
  if (!states[key]) return;
  delete states[key];
  writeReminderStates(states);
}

function normalizeReminder(row = {}) {
  const now = new Date().toISOString();
  return {
    id: row.id || randomUUID(),
    lead_key: String(row.lead_key || row.leadKey || '').trim(),
    consultant_phone: normalizeRealWhatsAppPhone(row.consultant_phone || row.consultantPhone) || null,
    reminder_text: String(row.reminder_text || row.reminderText || '').trim(),
    due_at: row.due_at || row.dueAt || null,
    done: !!row.done,
    created_at: row.created_at || now,
    updated_at: row.updated_at || now,
  };
}

function readLocalReminders() {
  return readJsonArray(REMINDERS_FILE)
    .map(normalizeReminder)
    .filter(item => item.lead_key && item.reminder_text);
}

function writeLocalReminders(items) {
  writeJsonFile(REMINDERS_FILE, items);
}

export async function createReminder(input = {}) {
  const reminder = normalizeReminder(input);
  if (!reminder.lead_key || !reminder.reminder_text) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('reminders')
        .insert(reminder)
        .select()
        .single();
      if (error) throw error;
      await recordEvent({
        leadKey: reminder.lead_key,
        eventType: 'reminder_created',
        payload: { reminder_id: data.id, consultant_phone: reminder.consultant_phone, storage: 'supabase' },
      });
      clearReminderState(reminder.lead_key);
      return normalizeReminder(data);
    } catch (error) {
      warnSupabaseFallback('reminders.create', error);
    }
  }

  const local = readLocalReminders();
  local.push(reminder);
  writeLocalReminders(local);
  await recordEvent({
    leadKey: reminder.lead_key,
    eventType: 'reminder_created',
    payload: { reminder_id: reminder.id, consultant_phone: reminder.consultant_phone, storage: 'local' },
  });
  clearReminderState(reminder.lead_key);
  return reminder;
}

export async function listOpenReminders({ consultantPhone = null, limit = 10, includePaused = false } = {}) {
  const normalizedConsultantPhone = normalizeRealWhatsAppPhone(consultantPhone);
  const states = readReminderStates();
  let reminders = null;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      let query = supabase
        .from('reminders')
        .select('*')
        .eq('done', false)
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (normalizedConsultantPhone) query = query.eq('consultant_phone', normalizedConsultantPhone);
      const { data, error } = await query;
      if (error) throw error;
      reminders = (data || []).map(normalizeReminder);
    } catch (error) {
      warnSupabaseFallback('reminders.listOpen', error);
    }
  }

  if (!reminders) {
    reminders = readLocalReminders()
      .filter(item => !item.done)
      .filter(item => !normalizedConsultantPhone || item.consultant_phone === normalizedConsultantPhone)
      .sort((a, b) => {
        if (a.due_at && b.due_at) return new Date(a.due_at) - new Date(b.due_at);
        if (a.due_at) return -1;
        if (b.due_at) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });
  }

  return reminders
    .map(item => withReminderState(item, states))
    .filter(item => includePaused || !item.paused)
    .slice(0, limit);
}

export async function getLatestOpenReminderForLead(leadKey) {
  const states = readReminderStates();
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('reminders')
        .select('*')
        .eq('lead_key', leadKey)
        .eq('done', false)
        .order('due_at', { ascending: true })
        .limit(1);
      if (error) throw error;
      if (data && data.length > 0) return withReminderState(normalizeReminder(data[0]), states);
    } catch (error) {
      warnSupabaseFallback('reminders.getLatestOpen', error);
    }
  }

  const local = readLocalReminders();
  const leadReminders = local
    .filter(item => item.lead_key === leadKey && !item.done)
    .sort((a, b) => {
      if (a.due_at && b.due_at) return new Date(a.due_at) - new Date(b.due_at);
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return 0;
    });
  return leadReminders.length > 0 ? withReminderState(leadReminders[0], states) : null;
}

export async function completeAllRemindersForLead(leadKey) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase
        .from('reminders')
        .update({ done: true, updated_at: new Date().toISOString() })
        .eq('lead_key', leadKey)
        .eq('done', false);
      if (error) throw error;
      await recordEvent({
        leadKey,
        eventType: 'reminders_completed',
        payload: { storage: 'supabase' }
      });
      clearReminderState(leadKey);
      return true;
    } catch (error) {
      warnSupabaseFallback('reminders.completeAll', error);
    }
  }

  const local = readLocalReminders();
  let updated = false;
  const newLocal = local.map(item => {
    if (item.lead_key === leadKey && !item.done) {
      updated = true;
      return { ...item, done: true, updated_at: new Date().toISOString() };
    }
    return item;
  });
  if (updated) {
    writeLocalReminders(newLocal);
    await recordEvent({
      leadKey,
      eventType: 'reminders_completed',
      payload: { storage: 'local' }
    });
  }
  clearReminderState(leadKey);
  return true;
}

export function getReminderState(leadKey) {
  const state = reminderStateFor(leadKey);
  return state ? { ...state } : null;
}

export async function pauseRemindersForLeads(leadKeys, {
  reason = 'lead_archived',
  reviewRequired = false,
  restoredAt = null,
} = {}) {
  const keys = uniqueLeadKeys(leadKeys);
  if (keys.length === 0) return { paused: 0, numbers: [] };
  const openReminders = await listOpenReminders({ limit: 5000, includePaused: true });
  const reminders = openReminders.filter((reminder) => keys.includes(reminder.lead_key));
  const eligibleKeys = [...new Set(reminders.map((reminder) => reminder.lead_key))];
  if (eligibleKeys.length === 0) return { paused: 0, reminderCount: 0, numbers: [] };
  const states = readReminderStates();
  const now = new Date().toISOString();
  for (const key of eligibleKeys) {
    states[key] = {
      paused: true,
      reason,
      paused_at: states[key]?.paused_at || now,
      review_required: !!reviewRequired,
      restored_at: restoredAt || states[key]?.restored_at || null,
      updated_at: now,
    };
  }
  writeReminderStates(states);
  await Promise.all(eligibleKeys.map((leadKey) => recordEvent({
    leadKey,
    eventType: reviewRequired ? 'reminder_review_required' : 'reminders_paused',
    payload: { reason },
  })));
  return { paused: eligibleKeys.length, reminderCount: reminders.length, numbers: eligibleKeys };
}

export async function markRemindersForReview(leadKeys, { reason = 'lead_restored' } = {}) {
  return pauseRemindersForLeads(leadKeys, {
    reason,
    reviewRequired: true,
    restoredAt: new Date().toISOString(),
  });
}

export async function resumeRemindersForLead(leadKey) {
  const key = cleanLeadKey(leadKey);
  if (!key) return false;
  clearReminderState(key);
  await recordEvent({ leadKey: key, eventType: 'reminders_resumed', payload: {} });
  return true;
}

export async function deleteRemindersForLeads(leadKeys) {
  const keys = uniqueLeadKeys(leadKeys);
  if (keys.length === 0) return { deleted: 0 };

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('reminders').delete().in('lead_key', keys);
      if (error) throw error;
    } catch (error) {
      warnSupabaseFallback('reminders.deleteForLeads', error);
    }
  }

  const local = readLocalReminders();
  const next = local.filter((item) => !keys.includes(item.lead_key));
  if (next.length !== local.length) writeLocalReminders(next);
  const states = readReminderStates();
  for (const key of keys) delete states[key];
  writeReminderStates(states);
  return { deleted: local.length - next.length };
}

export async function rekeyReminders(referenceMoves = []) {
  const moves = referenceMoves
    .map((move) => ({ from: cleanLeadKey(move?.from), to: cleanLeadKey(move?.to) }))
    .filter((move) => move.from && move.to && move.from !== move.to);
  if (moves.length === 0) return { updated: 0 };

  const supabase = getSupabaseClient();
  if (supabase) {
    for (const move of moves) {
      try {
        const { error } = await supabase.from('reminders').update({ lead_key: move.to }).eq('lead_key', move.from);
        if (error) throw error;
      } catch (error) {
        warnSupabaseFallback('reminders.rekey', error);
      }
    }
  }

  const local = readLocalReminders();
  let updated = 0;
  const next = local.map((item) => {
    const move = moves.find((candidate) => candidate.from === item.lead_key);
    if (!move) return item;
    updated += 1;
    return { ...item, lead_key: move.to, updated_at: new Date().toISOString() };
  });
  if (updated > 0) writeLocalReminders(next);

  const states = readReminderStates();
  for (const move of moves) {
    if (!states[move.from]) continue;
    states[move.to] = { ...(states[move.to] || {}), ...states[move.from] };
    delete states[move.from];
  }
  writeReminderStates(states);
  return { updated };
}
