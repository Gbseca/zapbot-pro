import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import { normalizeRealWhatsAppPhone } from '../phone-utils.js';
import { readJsonArray, writeJsonFile } from './local-json-store.js';
import { getSupabaseClient, warnSupabaseFallback } from './supabase-client.js';
import { recordEvent } from './events-repository.js';

const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');

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
  return reminder;
}

export async function listOpenReminders({ consultantPhone = null, limit = 10 } = {}) {
  const normalizedConsultantPhone = normalizeRealWhatsAppPhone(consultantPhone);

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
      return (data || []).map(normalizeReminder);
    } catch (error) {
      warnSupabaseFallback('reminders.listOpen', error);
    }
  }

  return readLocalReminders()
    .filter(item => !item.done)
    .filter(item => !normalizedConsultantPhone || item.consultant_phone === normalizedConsultantPhone)
    .sort((a, b) => {
      if (a.due_at && b.due_at) return new Date(a.due_at) - new Date(b.due_at);
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    })
    .slice(0, limit);
}

export async function getLatestOpenReminderForLead(leadKey) {
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
      if (data && data.length > 0) return normalizeReminder(data[0]);
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
  return leadReminders.length > 0 ? leadReminders[0] : null;
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
  return true;
}
