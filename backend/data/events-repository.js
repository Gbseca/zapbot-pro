import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import { appendJsonLine } from './local-json-store.js';
import { getSupabaseClient, warnSupabaseFallback } from './supabase-client.js';

const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');

function cleanLeadKey(value) {
  return String(value || '').trim();
}

function uniqueLeadKeys(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanLeadKey).filter(Boolean))];
}

function readLocalEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  try {
    return fs.readFileSync(EVENTS_FILE, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (error) {
    console.warn(`[Events] Failed to read local events: ${error.message}`);
    return [];
  }
}

function writeLocalEvents(events) {
  const dir = path.dirname(EVENTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const temp = `${EVENTS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''), 'utf8');
  try {
    fs.renameSync(temp, EVENTS_FILE);
  } catch (error) {
    try {
      fs.copyFileSync(temp, EVENTS_FILE);
      fs.unlinkSync(temp);
    } catch {
      try { fs.unlinkSync(temp); } catch {}
      throw error;
    }
  }
}

export async function recordEvent({ leadKey = null, eventType, payload = {} } = {}) {
  const safeEventType = String(eventType || '').trim();
  if (!safeEventType) return null;

  const event = {
    id: randomUUID(),
    lead_key: leadKey ? String(leadKey) : null,
    event_type: safeEventType,
    payload_json: payload && typeof payload === 'object' ? payload : { value: payload },
    created_at: new Date().toISOString(),
  };

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('events').insert(event);
      if (error) throw error;
      return event;
    } catch (error) {
      warnSupabaseFallback('events.insert', error);
    }
  }

  try {
    appendJsonLine(EVENTS_FILE, event);
  } catch (error) {
    console.warn(`[Events] Failed to write local event: ${error.message}`);
  }

  return event;
}

export async function listEventsForLeads(leadKeys, { limit = 200 } = {}) {
  const keys = uniqueLeadKeys(leadKeys);
  if (keys.length === 0) return [];
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .in('lead_key', keys)
        .order('created_at', { ascending: false })
        .limit(safeLimit);
      if (error) throw error;
      return data || [];
    } catch (error) {
      warnSupabaseFallback('events.listForLeads', error);
    }
  }

  return readLocalEvents()
    .filter((event) => keys.includes(cleanLeadKey(event.lead_key)))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, safeLimit);
}

export async function deleteEventsForLeads(leadKeys) {
  const keys = uniqueLeadKeys(leadKeys);
  if (keys.length === 0) return { deleted: 0 };

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('events').delete().in('lead_key', keys);
      if (error) throw error;
    } catch (error) {
      warnSupabaseFallback('events.deleteForLeads', error);
    }
  }

  const local = readLocalEvents();
  const next = local.filter((event) => !keys.includes(cleanLeadKey(event.lead_key)));
  if (next.length !== local.length) writeLocalEvents(next);
  return { deleted: local.length - next.length };
}

export async function rekeyEvents(referenceMoves = []) {
  const moves = referenceMoves
    .map((move) => ({ from: cleanLeadKey(move?.from), to: cleanLeadKey(move?.to) }))
    .filter((move) => move.from && move.to && move.from !== move.to);
  if (moves.length === 0) return { updated: 0 };

  const supabase = getSupabaseClient();
  if (supabase) {
    for (const move of moves) {
      try {
        const { error } = await supabase.from('events').update({ lead_key: move.to }).eq('lead_key', move.from);
        if (error) throw error;
      } catch (error) {
        warnSupabaseFallback('events.rekey', error);
      }
    }
  }

  const local = readLocalEvents();
  let updated = 0;
  const next = local.map((event) => {
    const move = moves.find((candidate) => candidate.from === cleanLeadKey(event.lead_key));
    if (!move) return event;
    updated += 1;
    return { ...event, lead_key: move.to };
  });
  if (updated > 0) writeLocalEvents(next);
  return { updated };
}
