/**
 * Detects the [QUALIFICADO|...] marker injected by the AI.
 * Required format: [QUALIFICADO|placa=X|modelo=Y|nome=Z|perfil=sim]
 * The "perfil=sim" field is mandatory — prevents premature qualification
 * before the AI has asked at least one profile question.
 */

const MARKER_REGEX = /\[QUALIFICADO\|placa=([^|]+)\|modelo=([^|]+)\|nome=([^|]*)\|perfil=(sim|nao|não)\]/i;

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

  // Only qualify if plate + model present AND profile was captured
  const qualified = !!(plate && model && profileCaptured);

  if (!profileCaptured) {
    console.warn('[Detector] Qualification marker found but perfil=sim missing — not qualifying yet.');
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
