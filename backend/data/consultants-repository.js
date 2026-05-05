import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import { loadConfig, saveConfig } from './config-manager.js';
import {
  isLidIdentifier,
  normalizeLidJid,
  normalizeRealWhatsAppPhone,
} from '../phone-utils.js';
import { readJsonArray, writeJsonFile } from './local-json-store.js';
import { getSupabaseClient, warnSupabaseFallback } from './supabase-client.js';
import { recordEvent } from './events-repository.js';

const CONSULTANTS_FILE = path.join(DATA_DIR, 'consultants.json');

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') return /^(1|true|yes|sim|on)$/i.test(value.trim());
  return !!value;
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return role || 'general';
}

function normalizeConsultant(row = {}, source = 'unknown') {
  const phone = normalizeRealWhatsAppPhone(row.phone || row.number || row.whatsapp || '');
  const rawLid = row.lid_jid || row.lidJid || row.lid || '';
  const lidJid = isLidIdentifier(rawLid) ? normalizeLidJid(rawLid) : null;
  const now = new Date().toISOString();

  return {
    id: row.id || phone || randomUUID(),
    name: String(row.name || row.nome || row.label || 'Consultor').trim() || 'Consultor',
    phone,
    number: phone || String(row.number || row.phone || '').replace(/\D/g, ''),
    lid_jid: lidJid,
    role: normalizeRole(row.role || row.funcao),
    active: normalizeBoolean(row.active, true),
    is_internal_user: normalizeBoolean(row.is_internal_user, true),
    receive_sales: normalizeBoolean(row.receive_sales ?? row.receiveSales, true),
    receive_support: normalizeBoolean(row.receive_support ?? row.receiveSupport, true),
    priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 100,
    created_at: row.created_at || now,
    updated_at: row.updated_at || now,
    source,
  };
}

function readLocalConsultants() {
  return readJsonArray(CONSULTANTS_FILE)
    .map(item => normalizeConsultant(item, 'local'))
    .filter(item => item.phone || item.lid_jid);
}

function writeLocalConsultants(items) {
  writeJsonFile(CONSULTANTS_FILE, items);
}

function configConsultants(config = loadConfig()) {
  return (Array.isArray(config.consultors) ? config.consultors : [])
    .map(item => normalizeConsultant(item, 'config'))
    .filter(item => item.active && (item.phone || item.lid_jid));
}

function sortConsultants(items = []) {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return String(a.name).localeCompare(String(b.name));
  });
}

function dedupeConsultants(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = item.phone || item.lid_jid || item.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

async function listSupabaseConsultants() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('consultants')
      .select('*')
      .order('priority', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(item => normalizeConsultant(item, 'supabase'));
  } catch (error) {
    warnSupabaseFallback('consultants.list', error);
    return null;
  }
}

export async function listConsultants({ config = loadConfig(), includeInactive = true } = {}) {
  const supabaseItems = await listSupabaseConsultants();
  if (supabaseItems) {
    const filtered = includeInactive ? supabaseItems : supabaseItems.filter(item => item.active);
    if (filtered.length > 0) return sortConsultants(filtered);
  }

  const localItems = readLocalConsultants();
  const combined = dedupeConsultants([...localItems, ...configConsultants(config)]);
  const filtered = includeInactive ? combined : combined.filter(item => item.active);
  return sortConsultants(filtered);
}

export async function findActiveConsultant({ phone = null, lidJid = null, config = loadConfig() } = {}) {
  const normalizedPhone = normalizeRealWhatsAppPhone(phone);
  const normalizedLid = isLidIdentifier(lidJid) ? normalizeLidJid(lidJid) : null;
  if (!normalizedPhone && !normalizedLid) return null;

  const supabaseItems = await listSupabaseConsultants();
  const findMatch = (items = []) => items.find(item => {
    if (!item.active) return false;
    if (normalizedPhone && item.phone === normalizedPhone) return true;
    if (normalizedLid && item.lid_jid === normalizedLid) return true;
    return false;
  }) || null;

  const supabaseMatch = supabaseItems ? findMatch(supabaseItems) : null;
  if (supabaseMatch) return supabaseMatch;

  const localMatch = findMatch(dedupeConsultants([...readLocalConsultants(), ...configConsultants(config)]));
  return localMatch;
}

export async function listHandoffConsultants({ type = 'sales', config = loadConfig() } = {}) {
  const field = type === 'support' || type === 'financial' ? 'receive_support' : 'receive_sales';
  const supabaseItems = await listSupabaseConsultants();
  if (supabaseItems) {
    const compatible = sortConsultants(supabaseItems.filter(item => item.active && item[field]));
    if (compatible.length > 0) return compatible;
  }

  const fallback = dedupeConsultants([...readLocalConsultants(), ...configConsultants(config)])
    .filter(item => item.active && item[field]);
  return sortConsultants(fallback);
}

export async function createConsultant(input = {}) {
  const consultant = normalizeConsultant(input, 'local');
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('consultants')
        .insert({
          name: consultant.name,
          phone: consultant.phone,
          lid_jid: consultant.lid_jid,
          role: consultant.role,
          active: consultant.active,
          is_internal_user: consultant.is_internal_user,
          receive_sales: consultant.receive_sales,
          receive_support: consultant.receive_support,
          priority: consultant.priority,
        })
        .select()
        .single();
      if (error) throw error;
      return normalizeConsultant(data, 'supabase');
    } catch (error) {
      warnSupabaseFallback('consultants.create', error);
    }
  }

  const local = readLocalConsultants();
  local.push(consultant);
  writeLocalConsultants(local);
  return consultant;
}

export async function updateConsultant(id, updates = {}) {
  const safeId = String(id || '').trim();
  if (!safeId) return null;
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const payload = { updated_at: new Date().toISOString() };
      if (updates.name !== undefined) payload.name = String(updates.name || '').trim();
      if (updates.phone !== undefined || updates.number !== undefined) {
        payload.phone = normalizeRealWhatsAppPhone(updates.phone || updates.number);
      }
      if (updates.lid_jid !== undefined || updates.lidJid !== undefined) {
        const rawLid = updates.lid_jid || updates.lidJid;
        payload.lid_jid = isLidIdentifier(rawLid) ? normalizeLidJid(rawLid) : null;
      }
      if (updates.role !== undefined) payload.role = normalizeRole(updates.role);
      if (updates.active !== undefined) payload.active = !!updates.active;
      if (updates.is_internal_user !== undefined) payload.is_internal_user = !!updates.is_internal_user;
      if (updates.receive_sales !== undefined || updates.receiveSales !== undefined) {
        payload.receive_sales = normalizeBoolean(updates.receive_sales ?? updates.receiveSales, true);
      }
      if (updates.receive_support !== undefined || updates.receiveSupport !== undefined) {
        payload.receive_support = normalizeBoolean(updates.receive_support ?? updates.receiveSupport, true);
      }
      if (updates.priority !== undefined) payload.priority = Number.isFinite(Number(updates.priority)) ? Number(updates.priority) : 100;

      const { data, error } = await supabase
        .from('consultants')
        .update(payload)
        .eq('id', safeId)
        .select()
        .single();
      if (error) throw error;
      return normalizeConsultant(data, 'supabase');
    } catch (error) {
      warnSupabaseFallback('consultants.update', error);
    }
  }

  const local = readLocalConsultants();
  const index = local.findIndex(item => String(item.id) === safeId || item.phone === safeId);
  if (index >= 0) {
    local[index] = normalizeConsultant({ ...local[index], ...updates, id: local[index].id }, 'local');
    writeLocalConsultants(local);
    return local[index];
  }

  const config = loadConfig();
  const configItems = Array.isArray(config.consultors) ? config.consultors : [];
  const configIndex = configItems.findIndex((item) => {
    const normalized = normalizeConsultant(item, 'config');
    return String(normalized.id) === safeId || normalized.phone === safeId;
  });
  if (configIndex === -1) return null;

  const merged = normalizeConsultant({ ...configItems[configIndex], ...updates }, 'config');
  const nextConsultors = configItems.map((item, idx) => (
    idx === configIndex
      ? {
        ...item,
        name: merged.name,
        number: merged.phone || merged.number,
        phone: merged.phone,
        lid_jid: merged.lid_jid,
        role: merged.role,
        active: merged.active,
        receive_sales: merged.receive_sales,
        receive_support: merged.receive_support,
        priority: merged.priority,
      }
      : item
  ));
  saveConfig({ consultors: nextConsultors });
  return merged;
}

export async function setConsultantActive(id, active) {
  return updateConsultant(id, { active: !!active });
}

export async function linkConsultantLid({ phone, lidJid, config = loadConfig() } = {}) {
  const normalizedPhone = normalizeRealWhatsAppPhone(phone);
  const normalizedLid = isLidIdentifier(lidJid) ? normalizeLidJid(lidJid) : null;
  if (!normalizedPhone || !normalizedLid) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: existing, error: findError } = await supabase
        .from('consultants')
        .select('*')
        .eq('phone', normalizedPhone)
        .eq('active', true)
        .limit(1);
      if (findError) throw findError;
      if (existing?.[0]) {
        const { data, error } = await supabase
          .from('consultants')
          .update({ lid_jid: normalizedLid, updated_at: new Date().toISOString() })
          .eq('id', existing[0].id)
          .select()
          .single();
        if (error) throw error;
        const consultant = normalizeConsultant(data, 'supabase');
        await recordEvent({
          leadKey: normalizedPhone,
          eventType: 'consultant_lid_linked',
          payload: { lid_jid: normalizedLid, consultant: consultant.name, storage: 'supabase' },
        });
        return consultant;
      }
    } catch (error) {
      warnSupabaseFallback('consultants.linkLid', error);
    }
  }

  const local = readLocalConsultants();
  const localIndex = local.findIndex(item => item.phone === normalizedPhone && item.active);
  if (localIndex >= 0) {
    local[localIndex] = { ...local[localIndex], lid_jid: normalizedLid, updated_at: new Date().toISOString() };
    writeLocalConsultants(local);
    return local[localIndex];
  }

  const configItems = Array.isArray(config.consultors) ? config.consultors : [];
  const configIndex = configItems.findIndex(item => normalizeRealWhatsAppPhone(item.phone || item.number) === normalizedPhone);
  if (configIndex >= 0) {
    const nextConsultors = configItems.map((item, index) => (
      index === configIndex ? { ...item, lid_jid: normalizedLid, lidJid: normalizedLid } : item
    ));
    saveConfig({ consultors: nextConsultors });
    const consultant = normalizeConsultant(nextConsultors[configIndex], 'config');
    await recordEvent({
      leadKey: normalizedPhone,
      eventType: 'consultant_lid_linked',
      payload: { lid_jid: normalizedLid, consultant: consultant.name, storage: 'config' },
    });
    return consultant;
  }

  return null;
}
