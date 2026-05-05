import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import {
  isLidIdentifier,
  normalizeLidJid,
  normalizeRealWhatsAppPhone,
} from '../phone-utils.js';
import { readJsonArray, writeJsonFile } from './local-json-store.js';
import { getSupabaseClient, warnSupabaseFallback } from './supabase-client.js';
import { recordEvent } from './events-repository.js';

const LID_PHONE_MAP_FILE = path.join(DATA_DIR, 'lid-phone-map.json');
const MIN_TRUSTED_CONFIDENCE = 0.7;

function normalizeMapping(input = {}) {
  const lidJid = normalizeLidJid(input.lid_jid || input.lidJid || input.lid || '');
  const phone = normalizeRealWhatsAppPhone(input.phone);
  if (!lidJid || !isLidIdentifier(lidJid) || !phone) return null;

  const now = new Date().toISOString();
  return {
    id: input.id || randomUUID(),
    lid_jid: lidJid,
    phone,
    source: String(input.source || 'unknown').trim() || 'unknown',
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0.8,
    created_at: input.created_at || now,
    updated_at: now,
  };
}

function readLocalMappings() {
  return readJsonArray(LID_PHONE_MAP_FILE)
    .map(normalizeMapping)
    .filter(Boolean);
}

function writeLocalMappings(mappings) {
  writeJsonFile(LID_PHONE_MAP_FILE, mappings);
}

function chooseTrustedMapping(mappings = []) {
  return mappings
    .filter(item => item.confidence >= MIN_TRUSTED_CONFIDENCE)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
    })[0] || null;
}

export async function upsertLidPhoneMapping(input = {}) {
  const mapping = normalizeMapping(input);
  if (!mapping) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('lid_phone_map')
        .upsert(mapping, { onConflict: 'lid_jid' })
        .select()
        .single();
      if (error) throw error;
      await recordEvent({
        leadKey: mapping.phone,
        eventType: 'lid_phone_resolved',
        payload: {
          lid_jid: mapping.lid_jid,
          phone: mapping.phone,
          source: mapping.source,
          confidence: mapping.confidence,
        },
      });
      return data || mapping;
    } catch (error) {
      warnSupabaseFallback('lid_phone_map.upsert', error);
    }
  }

  const local = readLocalMappings();
  const existingIndex = local.findIndex(item => item.lid_jid === mapping.lid_jid);
  if (existingIndex >= 0) {
    local[existingIndex] = {
      ...local[existingIndex],
      ...mapping,
      created_at: local[existingIndex].created_at || mapping.created_at,
      updated_at: new Date().toISOString(),
    };
  } else {
    local.push(mapping);
  }
  writeLocalMappings(local);

  await recordEvent({
    leadKey: mapping.phone,
    eventType: 'lid_phone_resolved',
    payload: {
      lid_jid: mapping.lid_jid,
      phone: mapping.phone,
      source: mapping.source,
      confidence: mapping.confidence,
      storage: 'local',
    },
  });

  return mapping;
}

export async function resolvePhoneByLid(lidJid) {
  const normalizedLid = normalizeLidJid(lidJid);
  if (!normalizedLid || !isLidIdentifier(normalizedLid)) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('lid_phone_map')
        .select('*')
        .eq('lid_jid', normalizedLid)
        .gte('confidence', MIN_TRUSTED_CONFIDENCE)
        .order('confidence', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const mapping = data?.[0] ? normalizeMapping(data[0]) : null;
      if (mapping) return mapping.phone;
    } catch (error) {
      warnSupabaseFallback('lid_phone_map.resolvePhoneByLid', error);
    }
  }

  const localMapping = chooseTrustedMapping(readLocalMappings().filter(item => item.lid_jid === normalizedLid));
  if (localMapping) return localMapping.phone;

  await recordEvent({
    leadKey: normalizedLid,
    eventType: 'lid_phone_unresolved',
    payload: { lid_jid: normalizedLid },
  });
  return null;
}

export async function resolveLidByPhone(phone) {
  const normalizedPhone = normalizeRealWhatsAppPhone(phone);
  if (!normalizedPhone) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('lid_phone_map')
        .select('*')
        .eq('phone', normalizedPhone)
        .gte('confidence', MIN_TRUSTED_CONFIDENCE)
        .order('confidence', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const mapping = data?.[0] ? normalizeMapping(data[0]) : null;
      if (mapping) return mapping.lid_jid;
    } catch (error) {
      warnSupabaseFallback('lid_phone_map.resolveLidByPhone', error);
    }
  }

  const localMapping = chooseTrustedMapping(readLocalMappings().filter(item => item.phone === normalizedPhone));
  return localMapping?.lid_jid || null;
}
