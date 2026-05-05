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
