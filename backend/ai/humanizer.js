// Ultra humanization module — delays, message splitting, typing simulation

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Calculates a realistic reading + typing delay based on message length.
 * Result: 2,000ms – 12,000ms
 */
function calcNaturalDelay(receivedText = '', responseText = '') {
  const wordsReceived = receivedText.trim().split(/\s+/).length;
  const wordsResponse = responseText.trim().split(/\s+/).length;

  // Reading time: ~250ms per word, max 4s
  const readingTime = Math.min(wordsReceived * 250, 4000);
  // Typing time: ~100ms per word, max 6s
  const typingTime = Math.min(wordsResponse * 100, 6000);
  // Human variation: ±30%
  const variation = 0.70 + Math.random() * 0.60;

  return Math.round((readingTime + typingTime) * variation);
}

/**
 * Splits a response into natural-feeling message chunks.
 * Prefers splitting at paragraph breaks, then at sentences.
 */
function splitIntoChunks(text) {
  // If short enough, send as one message
  const words = text.trim().split(/\s+/).length;
  if (words <= 20) return [text.trim()];

  // Try splitting by double newlines first (paragraphs)
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2 && paragraphs.length <= 3) return paragraphs;

  // If too many paragraphs, group them
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
export async function sendHumanized(wa, number, responseText, receivedText = '') {
  const chunks = splitIntoChunks(responseText);

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
      // Minimum 1.5s pause between messages
      await sleep(1200 + Math.random() * 800);
    }

    // Show "typing..." for the calculated duration
    await wa.sendTyping(number, delay);

    // Send the message
    await wa.sendMessage(number, chunk, null);
  }
}
