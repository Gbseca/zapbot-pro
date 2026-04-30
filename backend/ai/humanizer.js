const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeFinalStatus(status) {
  if (status === 'delivery_timeout') return 'accepted_unconfirmed';
  return status || 'accepted';
}

function isRetryableDelivery(status) {
  return status === 'accepted_unconfirmed' || status === 'delivery_timeout';
}

function mergeAcceptedAndFinal(accepted = {}, final = {}) {
  return {
    status: normalizeFinalStatus(final.status || accepted.status),
    messageId: accepted.messageId || final.messageId || null,
    targetJid: final.targetResolved || accepted.resolvedJid || null,
    resolvedJid: final.targetResolved || accepted.resolvedJid || null,
    targetKind: final.targetKind || accepted.targetKind || null,
    ackStatus: final.ackStatus ?? null,
    error: final.error || null,
  };
}

function buildRecoveryAttempts(sendOptions = {}) {
  if (sendOptions.disableDeliveryRecovery) return [sendOptions];
  const baseLabel = sendOptions.routeLabel || 'agent_reply';
  return [
    sendOptions,
    {
      ...sendOptions,
      forcePhoneJid: true,
      freshDevices: true,
      peerPrimary: false,
      noInternalRetry: true,
      skipTyping: true,
      routeLabel: `${baseLabel}_fresh_phone`,
    },
    {
      ...sendOptions,
      forcePhoneJid: true,
      freshDevices: false,
      peerPrimary: true,
      noInternalRetry: true,
      skipTyping: true,
      routeLabel: `${baseLabel}_peer_phone`,
    },
  ];
}

async function prepareDeliveryRecovery(wa, number) {
  try {
    if (typeof wa.refreshDevicesForTarget === 'function') {
      const refreshed = await wa.refreshDevicesForTarget(number, { forcePhoneJid: true });
      console.warn(`[Humanizer] Recovery refresh devices target=${number} count=${refreshed.deviceCount || 0}`);
    }
  } catch (error) {
    console.warn(`[Humanizer] Recovery refresh failed target=${number}: ${error.message}`);
  }

  try {
    if (typeof wa.resetSignalSessionsForTarget === 'function') {
      const reset = await wa.resetSignalSessionsForTarget(number, { forcePhoneJid: true });
      console.warn(`[Humanizer] Recovery reset sessions target=${number} purged=${reset.purged || 0}`);
    }
  } catch (error) {
    console.warn(`[Humanizer] Recovery reset failed target=${number}: ${error.message}`);
  }
}

export async function sendTextWithConfirmation(wa, number, text, sendOptions = {}) {
  const attempts = buildRecoveryAttempts(sendOptions);
  let lastDelivery = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attemptOptions = attempts[index];
    if (index > 0) {
      if (index === 1) await prepareDeliveryRecovery(wa, number);
      console.warn(`[Humanizer] Retrying WhatsApp delivery via ${attemptOptions.routeLabel || 'recovery'} target=${number}`);
    }

    let accepted;
    try {
      accepted = await wa.sendMessage(number, text, null, attemptOptions);
    } catch (error) {
      lastDelivery = {
        status: 'failed',
        messageId: error.messageId || null,
        targetJid: error.targetResolved || null,
        resolvedJid: error.targetResolved || null,
        targetKind: error.targetKind || null,
        error: error.message,
      };
      if (index < attempts.length - 1) continue;
      return lastDelivery;
    }

    if (typeof wa.waitForOutboundFinal !== 'function' || !accepted.messageId) {
      return {
        status: accepted.status || 'accepted',
        messageId: accepted.messageId || null,
        targetJid: accepted.resolvedJid || null,
        resolvedJid: accepted.resolvedJid || null,
        targetKind: accepted.targetKind || null,
        error: null,
      };
    }

    const final = await wa.waitForOutboundFinal(accepted.messageId);
    lastDelivery = mergeAcceptedAndFinal(accepted, final);
    if (lastDelivery.status === 'confirmed') return lastDelivery;
    if (!isRetryableDelivery(lastDelivery.status)) return lastDelivery;
  }

  return lastDelivery || {
    status: 'failed',
    messageId: null,
    targetJid: null,
    resolvedJid: null,
    error: 'Falha desconhecida no envio',
  };
}

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

    if (!sendOptions?.skipTyping) {
      await wa.sendTyping(number, delay, sendOptions);
    }
    const delivery = await sendTextWithConfirmation(wa, number, chunk, sendOptions);
    acceptedChunks.push({ ...delivery, chunk });
    if (delivery.status !== 'confirmed') break;
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
    resolvedJid: accepted.resolvedJid || accepted.targetJid,
    status: accepted.status || 'accepted',
    error: accepted.error || null,
  }));
  const finalChunks = [];

  if (typeof wa.waitForOutboundFinal === 'function' && acceptedChunks.some(chunk => chunk.status === 'accepted')) {
    for (const accepted of acceptedChunks) {
      const final = await wa.waitForOutboundFinal(accepted.messageId);
      finalChunks.push({
        chunk: accepted.chunk,
        messageId: accepted.messageId,
        resolvedJid: final.targetResolved || accepted.resolvedJid,
        status: normalizeFinalStatus(final.status),
        ackStatus: final.ackStatus ?? null,
        error: final.error || null,
      });
    }
  }

  const deliveryChunks = finalChunks.length ? finalChunks : acceptedOnlyChunks;
  const lastChunk = deliveryChunks[deliveryChunks.length - 1];
  const failedChunk = deliveryChunks.find(chunk => chunk.status === 'failed');
  const unconfirmedChunk = deliveryChunks.find(chunk => chunk.status === 'accepted_unconfirmed');
  const allConfirmed = deliveryChunks.length > 0 && deliveryChunks.every(chunk => chunk.status === 'confirmed');
  const finalStatus = failedChunk
    ? 'failed'
    : unconfirmedChunk
      ? 'accepted_unconfirmed'
      : (finalChunks.length || allConfirmed)
        ? 'confirmed'
        : 'accepted';

  return {
    status: finalStatus,
    messageId: lastChunk?.messageId || null,
    messageIds: deliveryChunks.map(chunk => chunk.messageId).filter(Boolean),
    targetJid: lastChunk?.resolvedJid || null,
    error: failedChunk?.error || unconfirmedChunk?.error || null,
    chunks: deliveryChunks,
  };
}
