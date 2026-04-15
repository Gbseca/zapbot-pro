/**
 * Detects the [QUALIFICADO|...] marker injected by the AI.
 * Required format: [QUALIFICADO|placa=X|modelo=Y|nome=Z|perfil=sim]
 * The "perfil=sim" field is mandatory — prevents premature qualification.
 * Plate must also pass validation (no placeholder values).
 */

const MARKER_REGEX = /\[QUALIFICADO\|placa=([^|]+)\|modelo=([^|]+)\|nome=([^|]*)\|perfil=(sim|nao|não)\]/i;

// Plate values that obviously are not real plates (AI placeholder usage)
const FAKE_PLATE_VALUES = [
  'placa_aqui', 'placa', 'não informada', 'nao informada',
  'sem placa', 'nenhuma', 'n/a', 'na', 'x', '?', '??', '???',
];

function isRealPlate(plate) {
  if (!plate) return false;
  const p = plate.trim().toLowerCase();
  if (p.length < 5) return false;
  if (FAKE_PLATE_VALUES.includes(p)) return false;
  if (p.includes('_aqui') || p.includes('placa')) return false;
  return true;
}

/**
 * Extracts lead info from AI response if qualification marker is present.
 * @returns { qualified, plate, model, name, profileCaptured, cleanResponse }
 */
export function detectAndExtract(aiResponse, currentLead = {}) {
  const match = aiResponse.match(MARKER_REGEX);

  if (!match) {
    return {
      qualified: false,
      plate: currentLead.plate || null,
      model: currentLead.model || null,
      name: currentLead.name  || null,
      profileCaptured: currentLead.profileCaptured || false,
      cleanResponse: aiResponse.trim(),
    };
  }

  const plate          = (match[1] || '').trim() || currentLead.plate;
  const model          = (match[2] || '').trim() || currentLead.model;
  const name           = (match[3] || '').trim() || currentLead.name;
  const profileField   = (match[4] || '').toLowerCase();
  const profileCaptured = profileField === 'sim';

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

  return { qualified, plate, model, name, profileCaptured, cleanResponse };
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
