// Detects the [QUALIFICADO|...] marker injected by the AI when lead is fully captured

const MARKER_REGEX = /\[QUALIFICADO\|placa=([^|]+)\|modelo=([^|]+)\|nome=([^\]]*)\]/i;

/**
 * Extracts lead info from AI response if qualification marker is present.
 * @returns { qualified, plate, model, name, cleanResponse }
 */
export function detectAndExtract(aiResponse, currentLead = {}) {
  const match = aiResponse.match(MARKER_REGEX);

  if (!match) {
    return {
      qualified: false,
      plate: currentLead.plate || null,
      model: currentLead.model || null,
      name: currentLead.name || null,
      cleanResponse: aiResponse.trim(),
    };
  }

  const plate = (match[1] || '').trim() || currentLead.plate;
  const model = (match[2] || '').trim() || currentLead.model;
  const name = (match[3] || '').trim() || currentLead.name;

  // Remove the marker from the response sent to the client
  const cleanResponse = aiResponse.replace(MARKER_REGEX, '').trim();

  return { qualified: !!(plate && model), plate, model, name, cleanResponse };
}

/**
 * Tries to extract name from a message using simple heuristics.
 * (Backup: AI should handle this, but just in case)
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
