// Ultra humanization module — delays, message splitting, typing simulation

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Calculates a realistic reading + typing delay based on message length.
 * Result: 2,000ms – 12,000ms
 */
function calcNaturalDelay(receivedText = '', responseText = '') {
  const wordsReceived = receivedText.trim().split(/\s+/).length;
  const wordsResponse = responseText.trim().split(/\s+/).length;

  // Reduced caps: reading 2s max, typing 3s max (was 4s/6s)
  // Commercial bots need consistency over simulation; 12s silence feels like a crash.
  const readingTime = Math.min(wordsReceived * 150, 2000);
  const typingTime  = Math.min(wordsResponse * 80,  3000);
  const variation   = 0.75 + Math.random() * 0.50;

  return Math.round((readingTime + typingTime) * variation);
}

/**
 * Splits a response into natural-feeling message chunks.
 * Prefers splitting at paragraph breaks, then at sentences.
 */
function splitIntoChunks(text, forceSingle = false) {
  const words = text.trim().split(/\s+/).length;

  // FIX [8]: Never split if forced single, or if the response is short (≤15 words),
  // or if it looks like a closure/clarification (single question or short statement).
  if (forceSingle) return [text.trim()];
  if (words <= 15) return [text.trim()];

  // If it's a single question or ends with '?' — don't split
  const trimmed = text.trim();
  if ((trimmed.match(/\?/g) || []).length === 1 && words <= 30) return [trimmed];

  // Try splitting by double newlines (paragraphs)
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2 && paragraphs.length <= 3) return paragraphs;

  if (paragraphs.length > 3) {
    const half = Math.ceil(paragraphs.length / 2);
    return [
      paragraphs.slice(0, half).join('\n\n'),
      paragraphs.slice(half).join('\n\n'),
    ];
  }

  // Otherwise split by sentences
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  if (sentences.length <= 2) return [text.trim()];

  const mid = Math.ceil(sentences.length / 2);
  const part1 = sentences.slice(0, mid).join('').trim();
  const part2 = sentences.slice(mid).join('').trim();
  return [part1, part2].filter(Boolean);
}

/**
 * Sends a humanized response: delays, typing indicators, split messages.
 * @param {WhatsAppManager} wa - The WhatsApp manager instance
 * @param {string} number - Phone number
 * @param {string} responseText - AI response text
 * @param {string} receivedText - What the user sent (for delay calc)
 */
export async function sendHumanized(wa, number, responseText, receivedText = '', forceSingle = false) {
  const chunks = splitIntoChunks(responseText, forceSingle);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i].trim();
    if (!chunk) continue;

    // Calculate per-chunk delay
    const chunkWords = chunk.split(/\s+/).length;
    let delay;

    if (i === 0) {
      // First message: also includes reading time
      delay = calcNaturalDelay(receivedText, chunk);
    } else {
      // Subsequent messages: just typing time + small pause
      delay = Math.min(chunkWords * 110, 4000);
      delay = Math.round(delay * (0.8 + Math.random() * 0.4));
      // Minimum 0.6s pause between messages (was 1.2s)
      await sleep(600 + Math.random() * 600);
    }

    // Show "typing..." for the calculated duration
    await wa.sendTyping(number, delay);

    // Send the message
    await wa.sendMessage(number, chunk, null);
  }
}
