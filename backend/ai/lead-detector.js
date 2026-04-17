/**
 * lead-detector.js — v3
 * Detects [QUALIFICADO|...] marker injected by the AI.
 * PHASE 3: profile is no longer mandatory — plate + model + phone is enough to qualify.
 */

const MARKER_REGEX = /\[QUALIFICADO\|placa=([^|]+)\|modelo=([^|]+)\|nome=([^|]*)\|phone=([^|]*)\|perfil=(sim|nao|não)\]/i;

const FAKE_PLATE_VALUES = [
  'placa_aqui', 'placa_real', 'placa', 'não informada', 'nao informada',
  'sem placa', 'nenhuma', 'n/a', 'na', 'x', '?', '??', '???',
];

function isRealPlate(plate) {
  if (!plate) return false;
  const p = plate.trim().toLowerCase();
  if (p.length < 5) return false;
  if (FAKE_PLATE_VALUES.includes(p)) return false;
  if (p.includes('_aqui') || p.includes('_real') || p === 'placa') return false;
  return true;
}

function isRealPhone(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10; // at least DDD + number
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
 * Extracts lead info from AI response if qualification marker is present.
 *
 * QUALIFICATION RULES (Phase 3):
 *   ✅ plate (real) + model + phone → ALWAYS qualifies (fastest path — client was direct)
 *   ✅ plate (real) + model + profile=sim → qualifies (classic path, phone optional in marker)
 *   ❌ missing plate or model → never qualifies
 */
export function detectAndExtract(aiResponse, currentLead = {}) {
  const match = aiResponse.match(MARKER_REGEX);

  if (!match) {
    return {
      qualified: false,
      plate: currentLead.plate || null,
      model: currentLead.model || null,
      name: currentLead.name  || null,
      phone: currentLead.phone || null,
      profileCaptured: currentLead.profileCaptured || false,
      cleanResponse: aiResponse.trim(),
    };
  }

  const plate         = (match[1] || '').trim() || currentLead.plate;
  const model         = (match[2] || '').trim() || currentLead.model;
  const name          = (match[3] || '').trim() || currentLead.name;
  const rawPhone      = (match[4] || '').trim();
  const profileField  = (match[5] || '').toLowerCase();
  const profileCaptured = profileField === 'sim';

  const phone = normalizePhone(rawPhone) || currentLead.phone || null;

  // Remove the marker from the response sent to the client
  const cleanResponse = aiResponse.replace(MARKER_REGEX, '').replace(/\n+$/, '').trim();

  const hasRealPlate  = isRealPlate(plate);
  const hasRealModel  = !!(model && model.length > 1);
  const hasRealPhone  = isRealPhone(phone);

  // Fast path: client gave plate + model + phone → qualify immediately, no profile needed
  const fastQualify = hasRealPlate && hasRealModel && hasRealPhone;

  // Classic path: plate + model + profile collected (phone preferred but not blocking)
  const classicQualify = hasRealPlate && hasRealModel && profileCaptured;

  const qualified = fastQualify || classicQualify;

  if (!hasRealPlate) {
    console.warn(`[Detector] Qualification rejected — plate "${plate}" is not a real plate value.`);
  } else if (!hasRealModel) {
    console.warn('[Detector] Qualification rejected — model missing.');
  } else if (!fastQualify && !classicQualify) {
    console.warn('[Detector] Qualification rejected — need phone OR profile=sim.');
  } else {
    const path = fastQualify ? 'fast (plate+model+phone)' : 'classic (plate+model+profile)';
    console.log(`[Detector] ✅ Qualified via ${path} — plate=${plate} model=${model} phone=${phone}`);
  }

  if (phone) console.log(`[Detector] Phone captured: ${phone}`);

  return { qualified, plate, model, name, phone, profileCaptured, cleanResponse };
}

/**
 * Tries to extract a phone number from a free-text message (backup capture).
 */
export function tryExtractPhone(message) {
  const digits = message.replace(/\D/g, '');
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
  for (const p of patterns) {
    const m = message.match(p);
    if (m && m[1].length > 2) return m[1];
  }
  return null;
}
