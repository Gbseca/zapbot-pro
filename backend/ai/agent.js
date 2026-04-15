import { loadConfig } from '../data/config-manager.js';
import { getLead, saveLead } from '../data/leads-manager.js';
import { buildContext } from './context-builder.js';
import { callAI } from './gemini.js';
import { sendHumanized } from './humanizer.js';
import { detectAndExtract } from './lead-detector.js';
import { executeHandoff } from './handoff.js';

// Anti-flood: buffer messages per number
const messageBuffers = new Map();
const ANTIFLOOD_MS = 12000; // 12 seconds to accumulate messages

function isBusinessHours(config) {
  const now = new Date();
  // Use São Paulo timezone
  const spTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const cur = spTime.getHours() * 60 + spTime.getMinutes();
  const [sh, sm] = (config.businessHoursStart || '08:00').split(':').map(Number);
  const [eh, em] = (config.businessHoursEnd || '22:00').split(':').map(Number);
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
  // Ignore: fromMe, groups, broadcast, no message
  if (!msg || !msg.message) return false;
  if (msg.key?.fromMe) return false;
  const jid = msg.key?.remoteJid || '';
  if (jid.includes('@g.us')) return false; // group
  if (jid.includes('@broadcast')) return false; // broadcast
  return true;
}

/**
 * Main entry point — called by WhatsApp manager on each incoming message.
 */
export async function handleIncomingMessage(wa, rawMsg) {
  if (!isValidIncoming(rawMsg)) return;

  const config = loadConfig();
  if (!config.aiEnabled || !config.geminiKey) return;

  const jid = rawMsg.key.remoteJid;
  const number = jid.split('@')[0];
  const text = extractText(rawMsg);
  if (!text) return; // No text content

  // Check lead status
  const existingLead = getLead(number);
  if (existingLead?.status === 'transferred') return;
  if (existingLead?.status === 'blocked') return;

  // Check business hours
  if (!isBusinessHours(config)) {
    // Send out-of-hours message (only once per day)
    const today = new Date().toDateString();
    if (existingLead?.lastOutOfHoursMsg !== today) {
      const [sh] = (config.businessHoursStart || '08:00').split(':');
      const [eh] = (config.businessHoursEnd || '22:00').split(':');
      const msg = `Oi! 😊 Nosso horário de atendimento é das ${sh}h às ${eh}h. Estarei aqui para te ajudar quando voltar! Até logo 👋`;
      await wa.sendMessage(number, msg, null);
      const lead = existingLead || createNewLead(number, rawMsg.pushName);
      saveLead(number, { ...lead, lastOutOfHoursMsg: today });
    }
    return;
  }

  // Anti-flood: accumulate messages for 12s before processing
  accumulate(wa, number, text, rawMsg.pushName, config);
}

function accumulate(wa, number, text, pushName, config) {
  if (!messageBuffers.has(number)) {
    messageBuffers.set(number, { texts: [], pushName, timer: null });
  }
  const buf = messageBuffers.get(number);
  buf.texts.push(text);
  buf.pushName = buf.pushName || pushName;

  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(async () => {
    const texts = [...buf.texts];
    messageBuffers.delete(number);
    try {
      await processConversation(wa, number, texts, buf.pushName, config);
    } catch (err) {
      console.error(`[Agent] Error processing ${number}:`, err.message);
    }
  }, ANTIFLOOD_MS);
}

function createNewLead(number, pushName) {
  return {
    number,
    name: pushName || null,
    status: 'new',
    history: [],
    plate: null,
    model: null,
    createdAt: new Date().toISOString(),
    lastInteraction: new Date().toISOString(),
    followUp1Sent: false,
    followUp2Sent: false,
  };
}

async function processConversation(wa, number, texts, pushName, config) {
  const combinedText = texts.join('\n');

  // Load or create lead
  let lead = getLead(number) || createNewLead(number, pushName);
  if (lead.status === 'new') lead.status = 'talking';

  // Update name from WhatsApp push name if not yet captured
  if (!lead.name && pushName) lead.name = pushName;

  // Add user message(s) to history
  lead.history = lead.history || [];
  lead.history.push({ role: 'user', content: combinedText, ts: Date.now() });
  lead.lastInteraction = new Date().toISOString();
  lead.followUp1Sent = false; // Reset follow-up since they replied
  lead.followUp2Sent = false;
  saveLead(number, lead);

  // Build context and call AI
  const context = await buildContext(config, lead);
  let aiResponse;
  try {
    aiResponse = await callAI(config, context);
  } catch (err) {
    console.error('[Agent] AI error:', err.message);
    return;
  }

  // Check for lead qualification marker
  const { qualified, plate, model, name, cleanResponse } = detectAndExtract(aiResponse, lead);

  // Update lead info
  if (plate) lead.plate = plate;
  if (model) lead.model = model;
  if (name && name.length > 1) lead.name = name;

  // Send humanized response
  await sendHumanized(wa, number, cleanResponse, combinedText);

  // Save bot response to history
  lead.history.push({ role: 'assistant', content: cleanResponse, ts: Date.now() });

  if (qualified && !lead.transferred) {
    lead.status = 'qualified';
    lead.transferred = true;
    saveLead(number, lead);
    // Execute handoff (sends farewell + notifies consultant)
    await executeHandoff(wa, lead, config);
  } else {
    saveLead(number, lead);
  }
}
