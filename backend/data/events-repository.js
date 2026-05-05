import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import { appendJsonLine } from './local-json-store.js';
import { getSupabaseClient, warnSupabaseFallback } from './supabase-client.js';

const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');

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
