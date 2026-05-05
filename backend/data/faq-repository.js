import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import { readJsonArray, writeJsonFile } from './local-json-store.js';
import { getSupabaseClient, warnSupabaseFallback } from './supabase-client.js';
import { recordEvent } from './events-repository.js';

const FAQ_FILE = path.join(DATA_DIR, 'faq-items.json');

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeFaqItem(item = {}, source = 'unknown') {
  const now = new Date().toISOString();
  return {
    id: item.id || randomUUID(),
    title: String(item.title || '').trim(),
    category: String(item.category || '').trim(),
    keywords: normalizeKeywords(item.keywords),
    answer: String(item.answer || '').trim(),
    active: item.active === undefined ? true : !!item.active,
    created_at: item.created_at || now,
    updated_at: item.updated_at || now,
    source,
  };
}

function readLocalFaq() {
  return readJsonArray(FAQ_FILE).map(item => normalizeFaqItem(item, 'local'));
}

function writeLocalFaq(items) {
  writeJsonFile(FAQ_FILE, items);
}

function scoreFaqItem(item, term) {
  const needle = normalizeText(term);
  if (!needle) return 0;
  const haystacks = [
    item.title,
    item.category,
    ...(item.keywords || []),
  ].map(normalizeText);

  if (haystacks.some(value => value === needle)) return 100;
  if (haystacks.some(value => value.includes(needle) || needle.includes(value))) return 70;
  if (normalizeText(item.answer).includes(needle)) return 20;
  return 0;
}

async function listSupabaseFaq({ includeInactive = true } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    let query = supabase.from('faq_items').select('*').order('category').order('title');
    if (!includeInactive) query = query.eq('active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(item => normalizeFaqItem(item, 'supabase'));
  } catch (error) {
    warnSupabaseFallback('faq.list', error);
    return null;
  }
}

export async function listFaqItems({ includeInactive = true } = {}) {
  const supabaseItems = await listSupabaseFaq({ includeInactive });
  if (supabaseItems) return supabaseItems;
  const local = readLocalFaq();
  return includeInactive ? local : local.filter(item => item.active);
}

export async function searchFaq(term, { limit = 3 } = {}) {
  const items = await listFaqItems({ includeInactive: false });
  const matches = items
    .map(item => ({ item, score: scoreFaqItem(item, term) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(match => match.item);

  await recordEvent({
    leadKey: null,
    eventType: matches.length ? 'faq_used' : 'faq_not_found',
    payload: { term, matches: matches.map(item => item.id) },
  });

  return matches;
}

export async function createFaqItem(input = {}) {
  const item = normalizeFaqItem(input, 'local');
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('faq_items')
        .insert({
          title: item.title,
          category: item.category,
          keywords: item.keywords,
          answer: item.answer,
          active: item.active,
        })
        .select()
        .single();
      if (error) throw error;
      return normalizeFaqItem(data, 'supabase');
    } catch (error) {
      warnSupabaseFallback('faq.create', error);
    }
  }

  const local = readLocalFaq();
  local.push(item);
  writeLocalFaq(local);
  return item;
}

export async function updateFaqItem(id, updates = {}) {
  const safeId = String(id || '').trim();
  if (!safeId) return null;
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const payload = { ...updates, updated_at: new Date().toISOString() };
      if (payload.keywords !== undefined) payload.keywords = normalizeKeywords(payload.keywords);
      const { data, error } = await supabase
        .from('faq_items')
        .update(payload)
        .eq('id', safeId)
        .select()
        .single();
      if (error) throw error;
      return normalizeFaqItem(data, 'supabase');
    } catch (error) {
      warnSupabaseFallback('faq.update', error);
    }
  }

  const local = readLocalFaq();
  const index = local.findIndex(item => String(item.id) === safeId);
  if (index === -1) return null;
  local[index] = normalizeFaqItem({ ...local[index], ...updates, id: local[index].id }, 'local');
  writeLocalFaq(local);
  return local[index];
}

export async function setFaqItemActive(id, active) {
  return updateFaqItem(id, { active: !!active });
}
