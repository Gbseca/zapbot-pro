const sleep = ms => new Promise(r => setTimeout(r, ms));

function calcNaturalDelay(receivedText = '', responseText = '') {
  const wordsReceived = receivedText.trim().split(/\s+/).filter(Boolean).length;
  const wordsResponse = responseText.trim().split(/\s+/).filter(Boolean).length;

  const readingTime = Math.min(wordsReceived * 18, 180);
  const typingTime = Math.min(wordsResponse * 22, 520);
  const variation = 0.85 + Math.random() * 0.35;

  return Math.max(180, Math.round((readingTime + typingTime) * variation));
}

function splitIntoChunks(text, forceSingle = false) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  if (forceSingle) return [text.trim()];
  if (words <= 18) return [text.trim()];

  const trimmed = text.trim();
  if ((trimmed.match(/\?/g) || []).length === 1 && words <= 30) return [trimmed];

  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2 && paragraphs.length <= 3) return paragraphs;

  if (paragraphs.length > 3) {
    const half = Math.ceil(paragraphs.length / 2);
    return [
      paragraphs.slice(0, half).join('\n\n'),
      paragraphs.slice(half).join('\n\n'),
    ];
  }

  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  if (sentences.length <= 2) return [text.trim()];

  const mid = Math.ceil(sentences.length / 2);
  const part1 = sentences.slice(0, mid).join('').trim();
  const part2 = sentences.slice(mid).join('').trim();
  return [part1, part2].filter(Boolean);
}

export async function sendHumanized(wa, number, responseText, receivedText = '', forceSingle = false, sendOptions = {}) {
  const chunks = splitIntoChunks(responseText, forceSingle);
  const acceptedChunks = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i].trim();
    if (!chunk) continue;

    const chunkWords = chunk.split(/\s+/).filter(Boolean).length;
    let delay;

    if (i === 0) {
      delay = calcNaturalDelay(receivedText, chunk);
    } else {
      delay = Math.min(chunkWords * 24, 650);
      delay = Math.round(delay * (0.9 + Math.random() * 0.25));
      await sleep(120 + Math.random() * 180);
    }

    await wa.sendTyping(number, delay, sendOptions);
    const accepted = await wa.sendMessage(number, chunk, null, sendOptions);
    acceptedChunks.push({ ...accepted, chunk });
  }

  if (acceptedChunks.length === 0) {
    return {
      status: 'failed',
      messageId: null,
      messageIds: [],
      targetJid: null,
      error: 'Nenhum bloco valido para envio',
      chunks: [],
    };
  }

  const acceptedOnlyChunks = acceptedChunks.map((accepted) => ({
    chunk: accepted.chunk,
    messageId: accepted.messageId,
    resolvedJid: accepted.resolvedJid,
    status: accepted.status || 'accepted',
    error: null,
  }));
  const lastChunk = acceptedOnlyChunks[acceptedOnlyChunks.length - 1];

  return {
    status: 'accepted',
    messageId: lastChunk?.messageId || null,
    messageIds: acceptedOnlyChunks.map(chunk => chunk.messageId).filter(Boolean),
    targetJid: lastChunk?.resolvedJid || null,
    error: null,
    chunks: acceptedOnlyChunks,
  };
}
