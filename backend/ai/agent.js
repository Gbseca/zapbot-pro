import { loadConfig } from '../data/config-manager.js';
import { getLead, saveLead } from '../data/leads-manager.js';
import { buildContext } from './context-builder.js';
import { callAI } from './gemini.js';
import { sendHumanized } from './humanizer.js';
import { detectAndExtract, tryExtractPhone } from './lead-detector.js';
import { executeHandoff } from './handoff.js';

// Anti-flood buffer
const messageBuffers = new Map();
const ANTIFLOOD_MS = 10000;

// Session inactivity timers
const sessionTimers = new Map();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIX [1][2]: DETERMINISTIC INTENT PRE-PROCESSOR
// Runs BEFORE the AI — no LLM calls for these cases.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^\w\s]/g, ' ')         // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// Strong refusal: should NEVER get a follow-up AI response
const STRONG_REFUSAL_PATTERNS = [
  /^n(a|ao|ão)?o?$/,                    // "não", "nao", "n", "nao"
  /^nao\s*(quero|preciso|obrigad)/,
  /^não\s*(quero|preciso|obrigad)/,
  /sem\s*interesse/,
  /nao\s*tenho\s*interesse/,
  /não\s*tenho\s*interesse/,
  /to\s*procurando\s*nao/,
  /tou\s*procurando\s*nao/,
  /nao\s*senhora/,
  /não\s*senhora/,
  /pode\s*parar/,
  /nao\s*precisa/,
  /não\s*precisa/,
  /deixa\s*quieto/,
  /me\s*tira\s*da\s*lista/,
  /para\s*de\s*me\s*mandar/,
  /bloquei/,
  /denuncia/,
  /nao\s*quero\s*mais/,
  /não\s*quero\s*mais/,
  /chega/,
];

// Soft refusal: client has coverage or isn't looking — one gentle pitch, then respect.
// FIX [1]: Removed bare /ja\s*tenho/ — too broad, matches "já tenho a placa", "já tenho o doc", etc.
// Only match explicitly commercial/refusal contexts.
const SOFT_REFUSAL_PATTERNS = [
  /ja\s*tenho\s*(seguro|protecao|proteção|proteção\s*veicular|cobertura)/,
  /já\s*tenho\s*(seguro|protecao|proteção|proteção\s*veicular|cobertura)/,
  /ja\s*sou\s*(segurado|associado|cliente)/,
  /já\s*sou\s*(segurado|associado|cliente)/,
  /nao\s*estou\s*procurando/,
  /não\s*estou\s*procurando/,
  /nao\s*to\s*precisando/,
  /não\s*to\s*precisando/,
  /nao\s*to\s*procurando/,
  /não\s*to\s*procurando/,
  /meu\s*irmao\s*e\s*(meu\s*)?(corretor|agente)/,
  /meu\s*irmao\s*e\s*(meu\s*)?(corretor|agente)/,
];

// Ambiguous regional interjections — not vehicle data, not commercial intent.
// FIX [2]: Removed "sim", "oi", "ola", "opa", "ok", "okay", "certo", "entendi", "entendido", "nao", "n"
// Those are normal conversational words and should reach the AI.
// "não"/"nao" is already caught by STRONG_REFUSAL_PATTERNS above.
const INTERJECTION_PATTERNS = [
  /^(oxi|ata|uai|eita|po|puts|ih|ué|ue|hm|hmm|hum|kkk+|haha|rsrs+|rs|noo+|eee+|aaa+)$/,
];

function isStrongRefusal(normalizedText) {
  return STRONG_REFUSAL_PATTERNS.some(p => p.test(normalizedText));
}

function isSoftRefusal(normalizedText) {
  return SOFT_REFUSAL_PATTERNS.some(p => p.test(normalizedText));
}

function isAmbiguousInterjection(normalizedText) {
  // FIX [2]: Only flag true regional interjections/laughter.
  // Do NOT flag short but meaningful words ("sim", "oi", "ok", "certo", etc.).
  if (normalizedText.split(' ').length > 4) return false;
  return INTERJECTION_PATTERNS.some(p => p.test(normalizedText));
}

// FIX [3]: Re-engagement detection — leads that previously refused but now show clear intent
const REENGAGEMENT_PATTERNS = [
  /quero\s*(cotar|saber|fazer|ver|entender|conhecer)/,
  /tenho\s*interesse/,
  /me\s*passa\s*(mais|info|informac)/,
  /vamos\s*continuar/,
  /pode\s*me\s*explicar/,
  /agora\s*quero/,
  /mudei\s*de\s*ideia/,
  /ainda\s*tem\s*(vaga|disponib)/,
  /quanto\s*(custa|fica|seria)/,
  /como\s*(funciona|contrato|ader)/,
];

function isReengagement(normalizedText) {
  return REENGAGEMENT_PATTERNS.some(p => p.test(normalizedText));
}

// Varied closing messages — so it doesn't feel robotic
const REFUSAL_RESPONSES = [
  'Tudo bem! Fico à disposição caso mude de ideia. Até mais 😊',
  'Perfeito, sem problema. Não vou insistir. Se um dia quiser comparar, é só chamar.',
  'Entendido! Qualquer coisa é só mandar mensagem. Até mais 👋',
  'Ok, sem problemas. Boa sorte e qualquer dúvida pode chamar!',
];

const SOFT_REFUSAL_RESPONSES = [
  'Entendo! Cada caso é um caso né 😊 Se um dia quiser comparar valores ou coberturas, é só chamar. Abraço!',
  'Faz sentido! Se algum dia quiser ver se a Moove faz mais sentido pra você, estaremos aqui. Até mais 👋',
  'Tranquilo! Qualquer dúvida no futuro pode chamar sem compromisso 😊',
];

const CLARIFICATION_RESPONSES = [
  'Rsrs — isso foi só uma reação ou você quis me dizer alguma coisa sobre seu veículo?',
  'Entendi a reação 😄 Me conta mais, o que você tá procurando?',
  'Haha — pode falar! O que você precisava?',
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUSINESS HOURS + VALIDATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION TIMEOUT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function resetSessionTimer(jidId, config) {
  if (sessionTimers.has(jidId)) clearTimeout(sessionTimers.get(jidId));
  if (config.followUpEnabled) return;

  const timeoutMs = (config.sessionTimeoutMinutes || 30) * 60 * 1000;
  const timer = setTimeout(() => {
    sessionTimers.delete(jidId);
    const lead = getLead(jidId);
    if (!lead) return;
    if (lead.status === 'talking' || lead.status === 'new') {
      lead.history = [];
      lead.status  = 'new';
      saveLead(jidId, lead);
      console.log(`[Agent] 🕐 Session expired for ${jidId} — history cleared`);
    }
  }, timeoutMs);
  sessionTimers.set(jidId, timer);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN ENTRY POINT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function handleIncomingMessage(wa, rawMsg) {
  if (!isValidIncoming(rawMsg)) return;

  const config = loadConfig();
  if (!config.aiEnabled) return;

  const provider = config.aiProvider || 'groq';
  const hasKey = provider === 'gemini' ? !!config.geminiKey : !!config.groqKey;
  if (!hasKey) {
    console.warn(`[Agent] No API key for "${provider}"`);
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

  // Blocked = total silence always
  if (existingLead?.status === 'blocked') return;

  // FIX [3]: no_interest leads can re-engage if they send a clear intent phrase.
  // Otherwise, keep silence (no follow-up spam, no AI calls).
  if (existingLead?.status === 'no_interest') {
    const normForReeng = normalizeText(text);
    if (!isReengagement(normForReeng)) {
      console.log(`[Agent] ⏭️ Silencing no_interest lead ${jidId}: "${text.slice(0, 40)}"`);
      return;
    }
    // Re-engagement detected: reactivate and fall through to normal flow
    console.log(`[Agent] 🔄 Re-engagement detected for ${jidId}: "${text.slice(0, 40)}"`);
    existingLead.status = 'talking';
    existingLead.softRefusalSent = false;
    saveLead(jidId, existingLead);
  }


  if (!isBusinessHours(config)) {
    const today = new Date().toDateString();
    if (existingLead?.lastOutOfHoursMsg !== today) {
      const [sh] = (config.businessHoursStart || '08:00').split(':');
      const [eh] = (config.businessHoursEnd   || '22:00').split(':');
      const msg = `Oi! 😊 Nosso horário de atendimento é das ${sh}h às ${eh}h. Estarei aqui quando voltar! Até logo 👋`;
      await wa.sendMessage(fullJid, msg, null);
      const lead = existingLead || createNewLead(jidId, displayNum, pushName);
      saveLead(jidId, { ...lead, lastOutOfHoursMsg: today });
    }
    return;
  }

  resetSessionTimer(jidId, config);

  // ── DETERMINISTIC INTENT LAYER (runs before AI) ──────────────
  const norm = normalizeText(text);

  if (isStrongRefusal(norm)) {
    console.log(`[Agent] 🚫 Strong refusal detected from ${jidId}: "${text}"`);
    const lead = existingLead || createNewLead(jidId, displayNum, pushName);
    lead.status = 'no_interest';
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: text, ts: Date.now() });
    saveLead(jidId, lead);
    // Single message, no splitting, no AI
    await wa.sendMessage(fullJid, randomFrom(REFUSAL_RESPONSES), null);
    return;
  }

  // Soft refusal: check if they already got the soft pitch (2nd refusal = close)
  if (isSoftRefusal(norm)) {
    const alreadyPitched = existingLead?.softRefusalSent;
    if (alreadyPitched) {
      console.log(`[Agent] 🚫 2nd soft refusal — closing ${jidId}`);
      const lead = existingLead;
      lead.status = 'no_interest';
      saveLead(jidId, lead);
      await wa.sendMessage(fullJid, randomFrom(REFUSAL_RESPONSES), null);
      return;
    } else {
      console.log(`[Agent] 💬 Soft refusal from ${jidId} — sending gentle pitch`);
      const lead = existingLead || createNewLead(jidId, displayNum, pushName);
      lead.softRefusalSent = true;
      lead.history = lead.history || [];
      lead.history.push({ role: 'user', content: text, ts: Date.now() });
      saveLead(jidId, lead);
      await wa.sendMessage(fullJid, randomFrom(SOFT_REFUSAL_RESPONSES), null);
      return;
    }
  }

  // Ambiguous interjection: ask for clarification without AI qualification logic
  if (isAmbiguousInterjection(norm)) {
    console.log(`[Agent] ❓ Ambiguous interjection from ${jidId}: "${text}"`);
    const lead = existingLead || createNewLead(jidId, displayNum, pushName);
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: text, ts: Date.now() });
    saveLead(jidId, lead);
    await wa.sendMessage(fullJid, randomFrom(CLARIFICATION_RESPONSES), null);
    return;
  }
  // ── END DETERMINISTIC LAYER ──────────────────────────────────

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
    softRefusalSent: false,
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

  const alreadyTransferred = lead.status === 'transferred';

  lead.history = lead.history || [];
  lead.history.push({ role: 'user', content: combinedText, ts: Date.now() });
  lead.lastInteraction = new Date().toISOString();
  lead.followUp1Sent = false;
  lead.followUp2Sent = false;

  // Backup phone capture — only if text looks like a phone number (not interjection)
  if (!lead.phone) {
    const extractedPhone = tryExtractPhone(combinedText);
    if (extractedPhone) {
      lead.phone = extractedPhone;
      lead.displayNumber = extractedPhone;
      console.log(`[Agent] Phone extracted from message: ${extractedPhone}`);
    }
  }

  saveLead(jidId, lead);

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
