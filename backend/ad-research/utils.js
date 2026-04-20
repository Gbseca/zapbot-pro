import crypto from 'crypto';

const PT_MONTHS = {
  jan: 0,
  janeiro: 0,
  fev: 1,
  fevereiro: 1,
  mar: 2,
  marco: 2,
  abril: 3,
  abr: 3,
  mai: 4,
  maio: 4,
  jun: 5,
  junho: 5,
  jul: 6,
  julho: 6,
  ago: 7,
  agosto: 7,
  set: 8,
  setembro: 8,
  out: 9,
  outubro: 9,
  nov: 10,
  novembro: 10,
  dez: 11,
  dezembro: 11,
};

const EN_MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export const SORT_MODES = new Set(['popular', 'relevant', 'recent']);

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function roundNumber(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function tokenizeText(value = '') {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function uniqueStrings(values = [], limit = Infinity) {
  const seen = new Set();
  const output = [];

  for (const rawValue of values) {
    const value = String(rawValue || '').trim();
    const key = normalizeText(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }

  return output;
}

export function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

export function buildMetaSearchUrl({ query, country = 'BR' }) {
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country,
    is_targeted_country: 'false',
    media_type: 'all',
    q: query,
    search_type: 'keyword_unordered',
    'sort_data[mode]': 'total_impressions',
    'sort_data[direction]': 'desc',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

export function buildMetaAdUrl(libraryId, country = 'BR') {
  return buildMetaSearchUrl({ query: String(libraryId || '').trim(), country });
}

export function decodeTrackingUrl(url) {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('l.facebook.com')) {
      return decodeURIComponent(parsed.searchParams.get('u') || '');
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function getDomainFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function parseLooseDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = normalizeText(raw).replace(/\./g, '');

  const ptMatch = normalized.match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/i);
  if (ptMatch) {
    const day = Number(ptMatch[1]);
    const month = PT_MONTHS[ptMatch[2]];
    const year = Number(ptMatch[3]);
    if (Number.isInteger(month)) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  const enMatch = normalized.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (enMatch) {
    const month = EN_MONTHS[enMatch[1]];
    const day = Number(enMatch[2]);
    const year = Number(enMatch[3]);
    if (Number.isInteger(month)) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  const timestamp = Date.parse(raw);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toISOString();
  }

  return null;
}

export function daysSince(dateValue) {
  if (!dateValue) return null;
  const timestamp = Date.parse(dateValue);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

export function summarizeCopyFallback(text = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Resumo indisponivel';

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length >= 2) {
    return `${sentences[0]} ${sentences[1]}`.slice(0, 260).trim();
  }

  if (clean.length <= 260) return clean;
  return `${clean.slice(0, 257).trim()}...`;
}

export function truncateText(text = '', maxLength = 260) {
  const clean = String(text || '').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3).trim()}...`;
}
