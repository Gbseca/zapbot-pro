import { createClient } from '@supabase/supabase-js';

let cachedClient = null;
const warnedScopes = new Set();

function readSupabaseEnv() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, serviceRoleKey };
}

export function isSupabaseConfigured() {
  const { url, serviceRoleKey } = readSupabaseEnv();
  return !!url && !!serviceRoleKey;
}

export function getSupabaseClient() {
  if (cachedClient) return cachedClient;

  const { url, serviceRoleKey } = readSupabaseEnv();
  if (!url || !serviceRoleKey) return null;

  cachedClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

export function warnSupabaseFallback(scope, error) {
  const message = error?.message || String(error || 'unknown error');
  const key = `${scope}:${message}`;
  if (warnedScopes.has(key)) return;
  warnedScopes.add(key);
  console.warn(`[Supabase:${scope}] ${message}. Using local fallback.`);
}
