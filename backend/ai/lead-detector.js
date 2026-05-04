/**
 * lead-detector.js — v4
 * Parses structured JSON from the qualification model and validates it
 * deterministically before qualifying a lead.
 */

const FAKE_PLATE_VALUES = [
  'placa_aqui', 'placa_real', 'placa', 'não informada', 'nao informada',
  'sem placa', 'nenhuma', 'n/a', 'na', 'x', '?', '??', '???',
];

function sanitizeString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (['null', 'undefined', 'nenhum', 'nenhuma'].includes(text.toLowerCase())) return null;
  return text;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'sim', 'yes'].includes(normalized);
  }
  if (typeof value === 'number') return value === 1;
  return false;
}

function sanitizeYear(value) {
  const text = sanitizeString(value);
  if (!text) return null;
  const match = text.match(/\b(19[8-9]\d|20[0-3]\d)\b/);
  return match ? match[1] : null;
}

export function normalizePlate(raw) {
  const text = sanitizeString(raw);
  if (!text) return null;
  return text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function isValidBrazilPlate(raw) {
  const plate = normalizePlate(raw);
  if (!plate) return false;
  if (FAKE_PLATE_VALUES.includes(plate.toLowerCase())) return false;
  if (plate.includes('AQUI') || plate.includes('REAL')) return false;
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate);
}

function extractJsonPayload(rawText = '') {
  if (!rawText) return null;
  const cleaned = String(rawText)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to recover the first JSON object in the response.
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isRealPlate(plate) {
  return isValidBrazilPlate(plate);
}

function isRealPhone(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10;
}

/**
 * Normalizes a raw phone string to "5521972969475" format.
 */
export function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

/**
 * Extracts lead info from the structured qualification response.
 *
 * QUALIFICATION RULES:
 *   ✅ plate (real) + model + phone → qualifies
 *   ✅ plate (real) + model + profile=sim → qualifies
 *   ❌ missing plate or model → never qualifies
 */
export function detectAndExtract(aiResponse, currentLead = {}) {
  const parsed = extractJsonPayload(aiResponse) || {};

  const rawPlate = sanitizeString(parsed.plate) || currentLead.plate || null;
  const plate = isValidBrazilPlate(rawPlate) ? normalizePlate(rawPlate) : rawPlate;
  const model = sanitizeString(parsed.model) || currentLead.model || null;
  const year = sanitizeYear(parsed.year) || sanitizeYear(currentLead.year) || null;
  const name = sanitizeString(parsed.name) || currentLead.name || null;
  const phone = normalizePhone(parsed.phone) || currentLead.phone || null;
  const profileCaptured = parseBoolean(parsed.profileCaptured) || currentLead.profileCaptured || false;

  const hasRealPlate = isRealPlate(plate);
  const hasRealModel = !!(model && model.length > 1);
  const hasRealYear = !!year;
  const hasRealPhone = isRealPhone(phone);

  const fastQualify = hasRealPlate && hasRealModel && hasRealYear && hasRealPhone;
  const classicQualify = hasRealPlate && hasRealModel && hasRealYear && profileCaptured;
  const qualified = fastQualify || classicQualify;

  if (!hasRealPlate) {
    console.warn(`[Detector] Qualification rejected — plate "${plate}" is not a real plate value.`);
  } else if (!hasRealModel) {
    console.warn('[Detector] Qualification rejected — model missing.');
  } else if (!hasRealYear) {
    console.warn('[Detector] Qualification rejected - year missing.');
  } else if (!fastQualify && !classicQualify) {
    console.warn('[Detector] Qualification rejected — need phone OR profile=sim.');
  } else {
    const path = fastQualify ? 'fast (plate+model+year+phone)' : 'classic (plate+model+year+profile)';
    console.log(`[Detector] ✅ Qualified via ${path} — plate=${plate} model=${model} phone=${phone}`);
  }

  if (phone) console.log(`[Detector] Phone captured: ${phone}`);

  return {
    qualified,
    plate: hasRealPlate ? normalizePlate(plate) : null,
    model,
    year,
    name,
    phone,
    profileCaptured,
    reason: sanitizeString(parsed.reason) || null,
  };
}

/**
 * Tries to extract a phone number from a free-text message (backup capture).
 */
export function tryExtractPhone(message) {
  const digits = String(message || '').replace(/\D/g, '');
  if ((digits.length === 10 || digits.length === 11) && /^[1-9]{2}9?\d{7,8}$/.test(digits)) {
    return `55${digits}`;
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits;
  }
  return null;
}

/**
 * Simple heuristic name extractor (backup — AI handles this mainly).
 */
export function tryExtractName(message) {
  const patterns = [
    /(?:sou|chamo|me chamo|meu nome(?: é)?) ([A-Za-záÁàÀãÃâÂéÉêÊíÍóÓôÔõÕúÚçÇ]+)/i,
    /(?:aqui é|é o|é a) ([A-Za-záÁàÀãÃâÂéÉêÊíÍóÓôÔõÕúÚçÇ]+)/i,
  ];
  for (const pattern of patterns) {
    const match = String(message || '').match(pattern);
    if (match && match[1].length > 2) return match[1];
  }
  return null;
}
