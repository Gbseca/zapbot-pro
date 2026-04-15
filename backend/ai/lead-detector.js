/**
 * Detects the [QUALIFICADO|...] marker injected by the AI.
 * Required format: [QUALIFICADO|placa=X|modelo=Y|nome=Z|phone=N|perfil=sim]
 * All fields must be real values — placeholder text is rejected.
 */

const MARKER_REGEX = /\[QUALIFICADO\|placa=([^|]+)\|modelo=([^|]+)\|nome=([^|]*)\|phone=([^|]*)\|perfil=(sim|nao|não)\]/i;

// Plate values that are obviously placeholders (AI didn't have the real value)
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

/**
 * Normalizes a raw phone string to the format "5521972969475".
 * Accepts: "(21) 97296-9475", "21 97296 9475", "21972969475", etc.
 * Returns null if it doesn't look like a real phone.
 */
export function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null; // too short

  // Already has country code 55
  if (digits.startsWith('55') && digits.length >= 12) return digits;

  // Add Brazil country code
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;

  return null; // Unknown format
}

/**
 * Extracts lead info from AI response if qualification marker is present.
 * @returns { qualified, plate, model, name, phone, profileCaptured, cleanResponse }
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

  // Only qualify if ALL required fields are real values
  const qualified = !!(isRealPlate(plate) && model && profileCaptured);

  if (!isRealPlate(plate)) {
    console.warn(`[Detector] Qualification rejected — plate "${plate}" is not a real plate value.`);
  }
  if (!profileCaptured) {
    console.warn('[Detector] Qualification rejected — perfil=sim missing.');
  }
  if (phone) {
    console.log(`[Detector] Phone captured: ${phone}`);
  }

  return { qualified, plate, model, name, phone, profileCaptured, cleanResponse };
}

/**
 * Tries to extract a phone number from a free-text message.
 * Used as a backup to capture phone when the client types it directly.
 */
export function tryExtractPhone(message) {
  const digits = message.replace(/\D/g, '');
  // Look for a standalone phone: 10-11 digits (without 55) or 12-13 digits (with 55)
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
