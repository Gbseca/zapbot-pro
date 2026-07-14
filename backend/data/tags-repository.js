import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import { readJsonArray, writeJsonFile } from './local-json-store.js';
import { getSupabaseClient, warnSupabaseFallback } from './supabase-client.js';
import { recordEvent } from './events-repository.js';

const TAGS_FILE = path.join(DATA_DIR, 'lead-tags.json');

function normalizeTag(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function normalizeTagRow(row = {}) {
  return {
    id: row.id || randomUUID(),
    lead_key: String(row.lead_key || row.leadKey || '').trim(),
    tag: normalizeTag(row.tag),
    created_by: row.created_by || row.createdBy || null,
    created_at: row.created_at || new Date().toISOString(),
  };
}

function readLocalTags() {
  return readJsonArray(TAGS_FILE)
    .map(normalizeTagRow)
    .filter(item => item.lead_key && item.tag);
}

function writeLocalTags(items) {
  writeJsonFile(TAGS_FILE, items);
}

function cleanLeadKey(value) {
  return String(value || '').trim();
}

function uniqueLeadKeys(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanLeadKey).filter(Boolean))];
}

export async function addLeadTag({ leadKey, tag, createdBy = null } = {}) {
  const row = normalizeTagRow({ lead_key: leadKey, tag, created_by: createdBy });
  if (!row.lead_key || !row.tag) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('lead_tags')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      await recordEvent({
        leadKey: row.lead_key,
        eventType: 'tag_added',
        payload: { tag: row.tag, created_by: row.created_by, storage: 'supabase' },
      });
      return normalizeTagRow(data);
    } catch (error) {
      warnSupabaseFallback('tags.add', error);
    }
  }

  const local = readLocalTags();
  const exists = local.some(item => item.lead_key === row.lead_key && item.tag === row.tag);
  if (!exists) {
    local.push(row);
    writeLocalTags(local);
  }

  await recordEvent({
    leadKey: row.lead_key,
    eventType: 'tag_added',
    payload: { tag: row.tag, created_by: row.created_by, storage: 'local' },
  });
  return row;
}

export async function listLeadTags(leadKey) {
  const safeLeadKey = String(leadKey || '').trim();
  if (!safeLeadKey) return [];

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('lead_tags')
        .select('*')
        .eq('lead_key', safeLeadKey)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeTagRow);
    } catch (error) {
      warnSupabaseFallback('tags.list', error);
    }
  }

  return readLocalTags()
    .filter(item => item.lead_key === safeLeadKey)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function deleteTagsForLeads(leadKeys) {
  const keys = uniqueLeadKeys(leadKeys);
  if (keys.length === 0) return { deleted: 0 };

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('lead_tags').delete().in('lead_key', keys);
      if (error) throw error;
    } catch (error) {
      warnSupabaseFallback('tags.deleteForLeads', error);
    }
  }

  const local = readLocalTags();
  const next = local.filter((item) => !keys.includes(item.lead_key));
  if (next.length !== local.length) writeLocalTags(next);
  return { deleted: local.length - next.length };
}

export async function rekeyTags(referenceMoves = []) {
  const moves = referenceMoves
    .map((move) => ({ from: cleanLeadKey(move?.from), to: cleanLeadKey(move?.to) }))
    .filter((move) => move.from && move.to && move.from !== move.to);
  if (moves.length === 0) return { updated: 0 };

  const supabase = getSupabaseClient();
  if (supabase) {
    for (const move of moves) {
      try {
        const { error } = await supabase.from('lead_tags').update({ lead_key: move.to }).eq('lead_key', move.from);
        if (error) throw error;
      } catch (error) {
        warnSupabaseFallback('tags.rekey', error);
      }
    }
  }

  const local = readLocalTags();
  let updated = 0;
  const seen = new Set();
  const next = [];
  for (const item of local) {
    const move = moves.find((candidate) => candidate.from === item.lead_key);
    const row = move ? { ...item, lead_key: move.to } : item;
    if (move) updated += 1;
    const signature = `${row.lead_key}|${row.tag}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    next.push(row);
  }
  if (updated > 0 || next.length !== local.length) writeLocalTags(next);
  return { updated };
}
