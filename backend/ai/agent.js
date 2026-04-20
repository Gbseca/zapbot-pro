import { loadConfig } from '../data/config-manager.js';
import { getLead, saveLead } from '../data/leads-manager.js';
import { buildContext, buildQualificationContext } from './context-builder.js';
import { callAI } from './gemini.js';
import { sendHumanized } from './humanizer.js';
import { detectAndExtract, normalizePhone, tryExtractPhone } from './lead-detector.js';
import { executeHandoff } from './handoff.js';
import { getCollectionsContextForPhone } from '../campaign-state.js';

const messageBuffers = new Map();
const ANTIFLOOD_MS = 3500;

const sessionTimers = new Map();

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STRONG_REFUSAL_PATTERNS = [
  /^n(a|ao|ão)?o?$/,
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
  /meu\s*irmão\s*e\s*(meu\s*)?(corretor|agente)/,
];

const INTERJECTION_PATTERNS = [
  /^(oxi|ata|uai|eita|po|puts|ih|ué|ue|hm|hmm|hum|kkk+|haha|rsrs+|rs|noo+|eee+|aaa+)$/,
];

function isStrongRefusal(normalizedText) {
  return STRONG_REFUSAL_PATTERNS.some(pattern => pattern.test(normalizedText));
}

function isSoftRefusal(normalizedText) {
  return SOFT_REFUSAL_PATTERNS.some(pattern => pattern.test(normalizedText));
}

function isAmbiguousInterjection(normalizedText) {
  if (normalizedText.split(' ').length > 4) return false;
  return INTERJECTION_PATTERNS.some(pattern => pattern.test(normalizedText));
}

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
  return REENGAGEMENT_PATTERNS.some(pattern => pattern.test(normalizedText));
}

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

function randomFrom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function isBusinessHours(config) {
  const now = new Date();
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
  if (!msg || !msg.message) return false;
  if (msg.key?.fromMe) return false;
  const jid = msg.key?.remoteJid || '';
  if (jid.includes('@g.us')) return false;
  if (jid.includes('@broadcast')) return false;
  return true;
}

function resolveConversationPhone(displayNum, jidId) {
  return normalizePhone(displayNum) || normalizePhone(jidId) || null;
}

function resolveLeadIdentity(jidId, conversationPhone) {
  const preferredId = conversationPhone || jidId;
  const preferredLead = getLead(preferredId);
  if (preferredLead) return { leadId: preferredId, lead: preferredLead };

  if (preferredId !== jidId) {
    const legacyLead = getLead(jidId);
    if (legacyLead) return { leadId: jidId, lead: legacyLead };
  }

  return { leadId: preferredId, lead: null };
}

function resolveConversationModeContext(config, lead, conversationPhone, jidId) {
  const candidates = [
    conversationPhone,
    lead?.phone,
    lead?.displayNumber,
    lead?.number,
    jidId,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const context = getCollectionsContextForPhone(candidate, config);
    if (context) return context;
  }

  return null;
}

function sanitizeReply(text) {
  const reply = String(text || '').trim();
  if (!reply) {
    return 'Oi! Me conta um pouco mais sobre o seu veículo pra eu te ajudar melhor.';
  }
  return reply
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function resetSessionTimer(leadId, config) {
  if (sessionTimers.has(leadId)) clearTimeout(sessionTimers.get(leadId));
  if (config.followUpEnabled) return;

  const timeoutMs = (config.sessionTimeoutMinutes || 30) * 60 * 1000;
  const timer = setTimeout(() => {
    sessionTimers.delete(leadId);
    const lead = getLead(leadId);
    if (!lead) return;
    if (lead.status === 'talking' || lead.status === 'new') {
      lead.history = [];
      lead.status = 'new';
      saveLead(leadId, lead);
      console.log(`[Agent] 🕐 Session expired for ${leadId} — history cleared`);
    }
  }, timeoutMs);

  sessionTimers.set(leadId, timer);
}

function createNewLead(leadId, displayNum, pushName, fallbackPhone = null) {
  const phone = fallbackPhone || null;
  return {
    number: leadId,
    displayNumber: phone || displayNum,
    phone,
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
    campaignLoopHandled: false,
  };
}

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

  const fullJid = rawMsg.key.remoteJid;
  const jidId = fullJid.split('@')[0].split(':')[0];
  const displayNum = wa.resolvePhone(fullJid);
  const conversationPhone = resolveConversationPhone(displayNum, jidId);
  const { leadId, lead: leadFromStore } = resolveLeadIdentity(jidId, conversationPhone);
  const text = extractText(rawMsg);
  const pushName = rawMsg.pushName || null;

  console.log(`[Agent] Incoming from ${displayNum} (jid: ${fullJid}): "${text.slice(0, 60)}"`);
  if (!text) return;

  const existingLead = leadFromStore;
  const collectionsContext = resolveConversationModeContext(config, existingLead, conversationPhone, jidId);

  if (existingLead?.status === 'blocked') return;

  if (existingLead?.campaignSentAt && !existingLead?.campaignLoopHandled && config.campaignLoopEnabled === false) {
    console.log(`[Agent] Campaign loop disabled — ignoring reply from ${leadId}`);
    return;
  }

  if (existingLead?.status === 'no_interest' && !collectionsContext) {
    const normForReeng = normalizeText(text);
    if (!isReengagement(normForReeng)) {
      console.log(`[Agent] ⏭️ Silencing no_interest lead ${leadId}: "${text.slice(0, 40)}"`);
      return;
    }

    console.log(`[Agent] 🔄 Re-engagement detected for ${leadId}: "${text.slice(0, 40)}"`);
    existingLead.status = 'talking';
    existingLead.softRefusalSent = false;
    if (conversationPhone && !existingLead.phone) {
      existingLead.phone = conversationPhone;
      existingLead.displayNumber = conversationPhone;
    }
    saveLead(leadId, existingLead);
  }

  if (!isBusinessHours(config)) {
    const today = new Date().toDateString();
    if (existingLead?.lastOutOfHoursMsg !== today) {
      const [sh] = (config.businessHoursStart || '08:00').split(':');
      const [eh] = (config.businessHoursEnd || '22:00').split(':');
      const msg = `Oi! 😊 Nosso horário de atendimento é das ${sh}h às ${eh}h. Estarei aqui quando voltar! Até logo 👋`;
      await wa.sendMessage(fullJid, msg, null);
      const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
      saveLead(leadId, { ...lead, lastOutOfHoursMsg: today });
    }
    return;
  }

  resetSessionTimer(leadId, config);

  const norm = normalizeText(text);

  if (isStrongRefusal(norm)) {
    console.log(`[Agent] 🚫 Strong refusal detected from ${leadId}: "${text}"`);
    const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
    lead.status = 'no_interest';
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: text, ts: Date.now() });
    saveLead(leadId, lead);
    await wa.sendMessage(fullJid, randomFrom(REFUSAL_RESPONSES), null);
    return;
  }

  if (!collectionsContext && isSoftRefusal(norm)) {
    const alreadyPitched = existingLead?.softRefusalSent;
    if (alreadyPitched) {
      console.log(`[Agent] 🚫 2nd soft refusal — closing ${leadId}`);
      const lead = existingLead;
      lead.status = 'no_interest';
      saveLead(leadId, lead);
      await wa.sendMessage(fullJid, randomFrom(REFUSAL_RESPONSES), null);
      return;
    }

    console.log(`[Agent] 💬 Soft refusal from ${leadId} — sending gentle pitch`);
    const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
    lead.softRefusalSent = true;
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: text, ts: Date.now() });
    saveLead(leadId, lead);
    await wa.sendMessage(fullJid, randomFrom(SOFT_REFUSAL_RESPONSES), null);
    return;
  }

  if (!collectionsContext && isAmbiguousInterjection(norm)) {
    console.log(`[Agent] ❓ Ambiguous interjection from ${leadId}: "${text}"`);
    const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: text, ts: Date.now() });
    saveLead(leadId, lead);
    await wa.sendMessage(fullJid, randomFrom(CLARIFICATION_RESPONSES), null);
    return;
  }

  accumulate(wa, fullJid, leadId, jidId, displayNum, text, pushName, config);
}

function accumulate(wa, fullJid, leadId, jidId, displayNum, text, pushName, config) {
  if (!messageBuffers.has(leadId)) {
    messageBuffers.set(leadId, { texts: [], pushName, fullJid, displayNum, jidId, timer: null });
  }

  const buffer = messageBuffers.get(leadId);
  buffer.texts.push(text);
  buffer.pushName = buffer.pushName || pushName;
  buffer.fullJid = fullJid;
  buffer.displayNum = displayNum;
  buffer.jidId = jidId;

  if (buffer.timer) clearTimeout(buffer.timer);
  buffer.timer = setTimeout(async () => {
    const { texts, fullJid: jid, displayNum: phone, pushName: name, jidId: rawLeadId } = buffer;
    messageBuffers.delete(leadId);
    try {
      await processConversation(wa, jid, leadId, rawLeadId, phone, texts, name, config);
    } catch (err) {
      console.error(`[Agent] Error processing ${leadId}:`, err.message, err.stack);
    }
  }, ANTIFLOOD_MS);
}

async function processConversation(wa, fullJid, leadId, jidId, displayNum, texts, pushName, config) {
  const combinedText = texts.join('\n');
  const conversationPhone = resolveConversationPhone(displayNum, jidId);

  let lead = getLead(leadId) || createNewLead(leadId, displayNum, pushName, conversationPhone);

  lead.number = leadId;
  lead.jid = fullJid;
  if (conversationPhone) {
    lead.phone = lead.phone || conversationPhone;
    lead.displayNumber = conversationPhone;
  } else {
    lead.displayNumber = lead.displayNumber || displayNum;
  }

  if (!lead.name && pushName) lead.name = pushName;
  if (lead.campaignSentAt && !lead.campaignLoopHandled) lead.campaignLoopHandled = true;

  lead.history = lead.history || [];
  lead.history.push({ role: 'user', content: combinedText, ts: Date.now() });
  lead.lastInteraction = new Date().toISOString();
  lead.followUp1Sent = false;
  lead.followUp2Sent = false;

  const extractedPhone = tryExtractPhone(combinedText);
  if (extractedPhone) {
    lead.phone = extractedPhone;
    lead.displayNumber = extractedPhone;
    console.log(`[Agent] Phone extracted from message: ${extractedPhone}`);
  }

  const conversationModeContext = resolveConversationModeContext(
    config,
    lead,
    lead.phone || conversationPhone,
    jidId,
  );

  if (conversationModeContext) {
    if (lead.status === 'new' || lead.status === 'cold' || lead.status === 'no_interest') {
      lead.status = 'talking';
    }
    console.log(`[Agent] Collections mode active for ${leadId} via campaign ${conversationModeContext.campaignId}`);
  } else if (lead.status === 'new' || lead.status === 'cold') {
    lead.status = 'talking';
  }

  const alreadyTransferred = lead.status === 'transferred';

  saveLead(leadId, lead);

  const replyContext = await buildContext(
    config,
    lead,
    alreadyTransferred,
    conversationModeContext || { conversationMode: 'sales' },
  );

  let cleanResponse = '';

  if (conversationModeContext) {
    try {
      cleanResponse = sanitizeReply(await callAI(config, replyContext, { purpose: 'reply' }));
    } catch (error) {
      console.error('[Agent] Collections reply error:', error.message || error);
      return;
    }
  } else {
    const qualificationContext = await buildQualificationContext(config, lead, combinedText);

    const [replyResult, qualificationResult] = await Promise.allSettled([
      callAI(config, replyContext, { purpose: 'reply' }),
      callAI(config, qualificationContext, { purpose: 'qualification' }),
    ]);

    if (replyResult.status !== 'fulfilled') {
      console.error('[Agent] AI reply error:', replyResult.reason?.message || replyResult.reason);
      return;
    }

    cleanResponse = sanitizeReply(replyResult.value);

    let extraction = {
      qualified: false,
      plate: lead.plate || null,
      model: lead.model || null,
      name: lead.name || null,
      phone: lead.phone || null,
      profileCaptured: !!lead.profileCaptured,
    };

    if (qualificationResult.status === 'fulfilled') {
      extraction = detectAndExtract(qualificationResult.value, lead);
    } else {
      console.warn('[Agent] Qualification extraction failed:', qualificationResult.reason?.message || qualificationResult.reason);
    }

    if (extraction.plate) lead.plate = extraction.plate;
    if (extraction.model) lead.model = extraction.model;
    if (extraction.name && extraction.name.length > 1) lead.name = extraction.name;
    if (extraction.profileCaptured) lead.profileCaptured = true;
    if (extraction.phone) {
      lead.phone = extraction.phone;
      lead.displayNumber = extraction.phone;
      console.log(`[Agent] Phone from extraction: ${extraction.phone}`);
    }

    console.log(`[Agent] Sending to ${fullJid} (${displayNum})`);
    try {
      await sendHumanized(wa, fullJid, cleanResponse, combinedText);
    } catch (err) {
      console.error(`[Agent] Failed to send to ${fullJid}:`, err.message);
      return;
    }

    lead.history.push({ role: 'assistant', content: cleanResponse, ts: Date.now() });

    if (extraction.qualified && !alreadyTransferred) {
      lead.status = 'qualified';
      lead.qualifiedAt = new Date().toISOString();
      saveLead(leadId, lead);
      await executeHandoff(wa, lead, config);
    } else {
      saveLead(leadId, lead);
    }
    return;
  }

  console.log(`[Agent] Sending to ${fullJid} (${displayNum})`);
  try {
    await sendHumanized(wa, fullJid, cleanResponse, combinedText);
  } catch (err) {
    console.error(`[Agent] Failed to send to ${fullJid}:`, err.message);
    return;
  }

  lead.history.push({ role: 'assistant', content: cleanResponse, ts: Date.now() });
  saveLead(leadId, lead);
}
