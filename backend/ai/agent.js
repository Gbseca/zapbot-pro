import { loadConfig } from '../data/config-manager.js';
import { getLead, saveLead } from '../data/leads-manager.js';
import { buildContext } from './context-builder.js';
import { callAI } from './gemini.js';
import { sendHumanized } from './humanizer.js';
import { detectAndExtract, tryExtractPhone } from './lead-detector.js';
import { executeHandoff } from './handoff.js';

// Anti-flood: accumulate messages per JID before processing
const messageBuffers = new Map();
const ANTIFLOOD_MS = 10000; // 10s to accumulate rapid messages

// Session inactivity timers — clears history after N minutes of silence
const sessionTimers = new Map();

function isBusinessHours(config) {
  const now = new Date();
  const spTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const cur = spTime.getHours() * 60 + spTime.getMinutes();
  const [sh, sm] = (config.businessHoursStart || '08:00').split(':').map(Number);
  const [eh, em] = (config.businessHoursEnd   || '22:00').split(':').map(Number);
  return cur >= (sh * 60 + sm) && cur <= (eh * 60 + em);
}

function extractText(msg) {
  return (
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    msg?.message?.imageMessage?.caption ||
    ''
  ).trim();
}

function isValidIncoming(msg) {
  if (!msg || !msg.message) return false;
  if (msg.key?.fromMe) return false;
  const jid = msg.key?.remoteJid || '';
  if (jid.includes('@g.us'))      return false;
  if (jid.includes('@broadcast')) return false;
  return true;
}

/**
 * Resets the inactivity timer for a JID.
 * If the client goes silent for sessionTimeoutMinutes, the conversation history is cleared.
 */
function resetSessionTimer(jidId, config) {
  if (sessionTimers.has(jidId)) {
    clearTimeout(sessionTimers.get(jidId));
  }

  // Don't set timer if follow-up is enabled (follow-up will handle re-engagement)
  if (config.followUpEnabled) return;

  const timeoutMs = ((config.sessionTimeoutMinutes || 30) * 60 * 1000);

  const timer = setTimeout(() => {
    sessionTimers.delete(jidId);
    const lead = getLead(jidId);
    if (!lead) return;

    // Only clear if still in talking/new state (not transferred or blocked)
    if (lead.status === 'talking' || lead.status === 'new') {
      lead.history = [];
      lead.status  = 'new';
      saveLead(jidId, lead);
      console.log(`[Agent] 🕐 Session expired for ${jidId} (${config.sessionTimeoutMinutes}min inactivity) — history cleared`);
    }
  }, timeoutMs);

  sessionTimers.set(jidId, timer);
}

/**
 * Main entry point — called by WhatsApp manager on each incoming message.
 */
export async function handleIncomingMessage(wa, rawMsg) {
  if (!isValidIncoming(rawMsg)) return;

  const config = loadConfig();

  if (!config.aiEnabled) return;

  const provider = config.aiProvider || 'groq';
  const hasKey = provider === 'gemini' ? !!config.geminiKey : !!config.groqKey;
  if (!hasKey) {
    console.warn(`[Agent] No API key for provider "${provider}" — configure it in the AI panel.`);
    return;
  }

  const fullJid    = rawMsg.key.remoteJid;
  const jidId      = fullJid.split('@')[0].split(':')[0];
  const displayNum = wa.resolvePhone(fullJid);
  const text       = extractText(rawMsg);
  const pushName   = rawMsg.pushName || null;

  console.log(`[Agent] Incoming from ${displayNum} (jid: ${fullJid}): "${text.slice(0, 60)}"`);
  if (!text) return;

  const existingLead = getLead(jidId);
  if (existingLead?.status === 'blocked') return;

  if (!isBusinessHours(config)) {
    const today = new Date().toDateString();
    if (existingLead?.lastOutOfHoursMsg !== today) {
      const [sh] = (config.businessHoursStart || '08:00').split(':');
      const [eh] = (config.businessHoursEnd   || '22:00').split(':');
      const msg = `Oi! 😊 Nosso horário de atendimento é das ${sh}h às ${eh}h. Estarei aqui para te ajudar quando voltar! Até logo 👋`;
      await wa.sendMessage(fullJid, msg, null);
      const lead = existingLead || createNewLead(jidId, displayNum, pushName);
      saveLead(jidId, { ...lead, lastOutOfHoursMsg: today });
    }
    return;
  }

  // Reset inactivity timer every time client sends a message
  resetSessionTimer(jidId, config);

  accumulate(wa, fullJid, jidId, displayNum, text, pushName, config);
}

function accumulate(wa, fullJid, jidId, displayNum, text, pushName, config) {
  if (!messageBuffers.has(jidId)) {
    messageBuffers.set(jidId, { texts: [], pushName, fullJid, displayNum, timer: null });
  }
  const buf = messageBuffers.get(jidId);
  buf.texts.push(text);
  buf.pushName   = buf.pushName   || pushName;
  buf.fullJid    = fullJid;
  buf.displayNum = displayNum;

  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(async () => {
    const { texts, fullJid: jid, displayNum: phone, pushName: name } = buf;
    messageBuffers.delete(jidId);
    try {
      await processConversation(wa, jid, jidId, phone, texts, name, config);
    } catch (err) {
      console.error(`[Agent] Error processing ${jidId}:`, err.message, err.stack);
    }
  }, ANTIFLOOD_MS);
}

function createNewLead(jidId, displayNum, pushName) {
  return {
    number: jidId,
    displayNumber: displayNum,
    phone: null,
    name: pushName || null,
    status: 'new',
    history: [],
    plate: null,
    model: null,
    profileCaptured: false,
    jid: null,
    createdAt: new Date().toISOString(),
    lastInteraction: new Date().toISOString(),
    followUp1Sent: false,
    followUp2Sent: false,
  };
}

async function processConversation(wa, fullJid, jidId, displayNum, texts, pushName, config) {
  const combinedText = texts.join('\n');

  let lead = getLead(jidId) || createNewLead(jidId, displayNum, pushName);

  lead.jid           = fullJid;
  lead.displayNumber = displayNum;
  if (lead.status === 'new') lead.status = 'talking';
  if (lead.status === 'cold') lead.status = 'talking';
  if (!lead.name && pushName) lead.name = pushName;

  lead.history = lead.history || [];
  lead.history.push({ role: 'user', content: combinedText, ts: Date.now() });
  lead.lastInteraction = new Date().toISOString();
  lead.followUp1Sent = false;
  lead.followUp2Sent = false;

  // If already transferred, still respond but skip the handoff
  const alreadyTransferred = lead.status === 'transferred';

  // Backup phone capture from free text
  if (!lead.phone) {
    const extractedPhone = tryExtractPhone(combinedText);
    if (extractedPhone) {
      lead.phone = extractedPhone;
      lead.displayNumber = extractedPhone;
      console.log(`[Agent] Phone extracted from message text: ${extractedPhone}`);
    }
  }

  saveLead(jidId, lead);

  // Build AI context and call
  const context = await buildContext(config, lead, alreadyTransferred);
  let aiResponse;
  try {
    aiResponse = await callAI(config, context);
  } catch (err) {
    console.error('[Agent] AI error:', err.message);
    return;
  }

  const { qualified, plate, model, name, phone, profileCaptured, cleanResponse } = detectAndExtract(aiResponse, lead);

  if (plate) lead.plate = plate;
  if (model) lead.model = model;
  if (name && name.length > 1) lead.name = name;
  if (profileCaptured) lead.profileCaptured = true;
  if (phone) {
    lead.phone = phone;
    lead.displayNumber = phone;
    console.log(`[Agent] Phone from marker: ${phone}`);
  }

  console.log(`[Agent] Sending to ${fullJid} (${displayNum})`);
  try {
    await sendHumanized(wa, fullJid, cleanResponse, combinedText);
  } catch (err) {
    console.error(`[Agent] Failed to send to ${fullJid}:`, err.message);
    return;
  }

  lead.history.push({ role: 'assistant', content: cleanResponse, ts: Date.now() });

  if (qualified && !alreadyTransferred) {
    lead.status      = 'transferred';
    lead.transferred = true;
    saveLead(jidId, lead);
    await executeHandoff(wa, lead, config);
  } else {
    saveLead(jidId, lead);
  }
}
