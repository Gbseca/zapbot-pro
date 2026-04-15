import { loadConfig } from '../data/config-manager.js';
import { getLead, saveLead } from '../data/leads-manager.js';
import { buildContext } from './context-builder.js';
import { callAI } from './gemini.js';
import { sendHumanized } from './humanizer.js';
import { detectAndExtract, tryExtractPhone } from './lead-detector.js';
import { executeHandoff } from './handoff.js';

// Anti-flood: buffer messages per number (by JID-id, not phone)
const messageBuffers = new Map();
const ANTIFLOOD_MS = 10000; // 10 seconds to accumulate

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
  if (jid.includes('@g.us'))        return false; // group
  if (jid.includes('@broadcast'))   return false; // broadcast
  return true;
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

  const fullJid     = rawMsg.key.remoteJid;
  const jidId       = fullJid.split('@')[0].split(':')[0]; // internal ID (may be LID)
  const displayNum  = wa.resolvePhone(fullJid);             // real phone if known, else LID
  const text        = extractText(rawMsg);
  const pushName    = rawMsg.pushName || null;

  console.log(`[Agent] Incoming from ${displayNum} (jid: ${fullJid}): "${text.slice(0, 60)}"`);
  if (!text) return;

  // Lead is keyed by jidId (stable for this WhatsApp account)
  const existingLead = getLead(jidId);

  // Blocked leads: ignore completely
  if (existingLead?.status === 'blocked') return;

  // Out-of-hours handling
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

  accumulate(wa, fullJid, jidId, displayNum, text, pushName, config);
}

function accumulate(wa, fullJid, jidId, displayNum, text, pushName, config) {
  if (!messageBuffers.has(jidId)) {
    messageBuffers.set(jidId, { texts: [], pushName, fullJid, displayNum, timer: null });
  }
  const buf = messageBuffers.get(jidId);
  buf.texts.push(text);
  buf.pushName   = buf.pushName   || pushName;
  buf.fullJid    = fullJid;   // keep latest
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
    phone: null,        // real phone captured from client during conversation
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

  // Load or create lead
  let lead = getLead(jidId) || createNewLead(jidId, displayNum, pushName);

  // Always update identifiers with the latest known values
  lead.jid           = fullJid;
  lead.displayNumber = displayNum;
  if (lead.status === 'new') lead.status = 'talking';

  // If already transferred, still respond but skip the handoff
  const alreadyTransferred = lead.status === 'transferred';

  // Reset cold status when client writes again
  if (lead.status === 'cold') lead.status = 'talking';

  // Update name from push name if not yet captured
  if (!lead.name && pushName) lead.name = pushName;

  // Append user message to history
  lead.history = lead.history || [];
  lead.history.push({ role: 'user', content: combinedText, ts: Date.now() });
  lead.lastInteraction = new Date().toISOString();
  lead.followUp1Sent = false;
  lead.followUp2Sent = false;

  // Backup phone extraction: if client typed a phone number, capture it immediately
  if (!lead.phone) {
    const extractedPhone = tryExtractPhone(combinedText);
    if (extractedPhone) {
      lead.phone = extractedPhone;
      lead.displayNumber = extractedPhone; // update what shows on the website
      console.log(`[Agent] Phone extracted from message: ${extractedPhone}`);
    }
  }

  saveLead(jidId, lead);

  // Build context and call AI
  const context = await buildContext(config, lead, alreadyTransferred);
  let aiResponse;
  try {
    aiResponse = await callAI(config, context);
  } catch (err) {
    console.error('[Agent] AI error:', err.message);
    return;
  }

  // Check for qualification marker
  const { qualified, plate, model, name, phone, profileCaptured, cleanResponse } = detectAndExtract(aiResponse, lead);

  // Update lead info from AI extraction
  if (plate) lead.plate = plate;
  if (model) lead.model = model;
  if (name && name.length > 1) lead.name = name;
  if (profileCaptured) lead.profileCaptured = true;
  if (phone) {
    lead.phone = phone;
    lead.displayNumber = phone; // also update what shows on the website
    console.log(`[Agent] Phone from marker: ${phone}`);
  }

  // Send humanized response
  console.log(`[Agent] Sending to ${fullJid} (${displayNum})`);
  try {
    await sendHumanized(wa, fullJid, cleanResponse, combinedText);
  } catch (err) {
    console.error(`[Agent] Failed to send to ${fullJid}:`, err.message);
    return;
  }

  // Save bot response to history
  lead.history.push({ role: 'assistant', content: cleanResponse, ts: Date.now() });

  // Execute handoff only if freshly qualified and not already done
  if (qualified && !alreadyTransferred) {
    lead.status      = 'transferred';
    lead.transferred = true;
    saveLead(jidId, lead);
    await executeHandoff(wa, lead, config);
  } else {
    saveLead(jidId, lead);
  }
}
