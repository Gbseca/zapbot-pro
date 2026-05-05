import { loadConfig, resolveEffectiveAIConfig } from '../data/config-manager.js';
import { getAllLeads, getLead, saveLead } from '../data/leads-manager.js';
import {
  getLeadRealPhone,
  isLidIdentifier,
  normalizeRealWhatsAppPhone as normalizePhone,
  normalizeLidJid,
} from '../phone-utils.js';
import { buildContext, buildQualificationContext } from './context-builder.js';
import { callAI } from './gemini.js';
import { sendHumanized, sendTextWithConfirmation } from './humanizer.js';
import { detectAndExtract } from './lead-detector.js';
import { executeFinancialHandoff, executeHandoff } from './handoff.js';
import { getCollectionsContextForPhone } from '../campaign-state.js';
import { handleConsultantMessage, isConsultantLinkCommand, resolveConsultantForRoute } from './consultant-agent.js';
import {
  extractIncomingContent,
  isOperationalStopStatus,
} from './collections-guard.js';
import {
  applyConversationDecisionToLead,
  makeConversationDecision,
} from './conversation-decision.js';
import {
  applySalesEventToLead,
  applySalesFactsToLead,
  detectSalesEvent,
  getSalesHandoffFailedReply,
  isSalesStopStatus,
  markSalesHandoffFailure,
} from './sales-guard.js';
import {
  applyDeterministicFactsToLead,
  buildRecentUserText,
  hasKnownPlate,
} from './deterministic-facts.js';
import { recordEvent } from '../data/events-repository.js';
import { resolvePhoneByLid, upsertLidPhoneMapping } from '../data/lid-phone-map-repository.js';

const messageBuffers = new Map();
const sessionTimers = new Map();
const ANTIFLOOD_MS = 3500;

const STRONG_REFUSAL_PATTERNS = [
  /^n(a|ao)?o?$/,
  /^nao\s*(quero|preciso|obrigad)/,
  /^nao\s*tenho\s*interesse/,
  /sem\s*interesse/,
  /to\s*procurando\s*nao/,
  /tou\s*procurando\s*nao/,
  /nao\s*senhora/,
  /pode\s*parar/,
  /nao\s*precisa/,
  /deixa\s*quieto/,
  /me\s*tira\s*da\s*lista/,
  /para\s*de\s*me\s*mandar/,
  /bloquei/,
  /denuncia/,
  /nao\s*quero\s*mais/,
  /chega/,
];

const SOFT_REFUSAL_PATTERNS = [
  /ja\s*tenho\s*(seguro|protecao|protecao\s*veicular|cobertura)/,
  /ja\s*sou\s*(segurado|associado|cliente)/,
  /nao\s*estou\s*procurando/,
  /nao\s*to\s*precisando/,
  /nao\s*to\s*procurando/,
  /meu\s*irmao\s*e\s*(meu\s*)?(corretor|agente)/,
];

const INTERJECTION_PATTERNS = [
  /^(oxi|ata|uai|eita|po|puts|ih|ue|hm|hmm|hum|kkk+|haha|rsrs+|rs|noo+|eee+|aaa+)$/,
];

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

const REFUSAL_RESPONSES = [
  'Tudo bem! Fico a disposicao caso mude de ideia. Ate mais.',
  'Perfeito, sem problema. Nao vou insistir. Se um dia quiser comparar, e so chamar.',
  'Entendido! Qualquer coisa e so mandar mensagem. Ate mais.',
  'Ok, sem problemas. Boa sorte e qualquer duvida pode chamar.',
];

const SOFT_REFUSAL_RESPONSES = [
  'Entendo! Cada caso e um caso. Se um dia quiser comparar valores ou coberturas, e so chamar.',
  'Faz sentido! Se algum dia quiser ver se a Moove faz mais sentido pra voce, estaremos aqui.',
  'Tranquilo! Qualquer duvida no futuro pode chamar sem compromisso.',
];

const CLARIFICATION_RESPONSES = [
  'Rsrs, isso foi so uma reacao ou voce quis me dizer alguma coisa sobre seu veiculo?',
  'Entendi a reacao. Me conta mais, o que voce ta procurando?',
  'Haha, pode falar! O que voce precisava?',
];

const ASK_PHONE_FOR_HANDOFF_REPLY = 'Recebi os dados. Para eu encaminhar corretamente para o consultor, me passa seu WhatsApp com DDD? O numero nao apareceu certinho por aqui.';
const HANDOFF_RECOVERY_REPLY = 'Recebi seus dados, mas tive uma falha ao confirmar o encaminhamento por aqui. Para encaminhar corretamente, me passa seu WhatsApp com DDD?';
const OPERATIONAL_PENDING_DATA_STATUS = 'awaiting_operational_data';

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function randomFrom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

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

function isReengagement(normalizedText) {
  return REENGAGEMENT_PATTERNS.some(pattern => pattern.test(normalizedText));
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
    msg?.message?.conversation
    || msg?.message?.extendedTextMessage?.text
    || msg?.message?.imageMessage?.caption
    || ''
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

function resolveConversationPhone(displayNum, jidId, inboundRoute = null) {
  return inboundRoute?.mappedPhone
    || inboundRoute?.phoneCandidates?.[0]
    || normalizePhone(displayNum)
    || normalizePhone(jidId)
    || null;
}

function resolveInboundLidJid(fullJid, inboundRoute = null) {
  return inboundRoute?.lidJid
    || (isLidIdentifier(fullJid) ? fullJid : null)
    || null;
}

async function resolvePersistentPhoneForLid(fullJid, inboundRoute = null) {
  const lidJid = resolveInboundLidJid(fullJid, inboundRoute);
  if (!lidJid) return null;
  return resolvePhoneByLid(lidJid);
}

async function persistLidPhonePair({ lidJid = null, phone = null, source = 'unknown', confidence = 0.8 } = {}) {
  const normalizedPhone = normalizePhone(phone);
  if (!lidJid || !normalizedPhone) return null;
  return upsertLidPhoneMapping({
    lid_jid: lidJid,
    phone: normalizedPhone,
    source,
    confidence,
  });
}

function isLidJid(value) {
  const text = String(value || '');
  return text.includes('@lid') || text.includes('@hosted.lid');
}

function shouldPauseSalesLead(lead) {
  if (!lead) return false;
  if (lead.status === 'transferred' && (lead.handoffClientError || lead.handoffClientConfirmed === false)) {
    return false;
  }
  return isSalesStopStatus(lead.status);
}

function rememberLeadContactRoute(lead, {
  conversationPhone = null,
  displayNum = null,
  fullJid = null,
  inboundRoute = null,
} = {}) {
  if (!lead) return lead;

  const realPhone = normalizePhone(conversationPhone)
    || normalizePhone(inboundRoute?.mappedPhone)
    || normalizePhone(inboundRoute?.phoneCandidates?.[0])
    || normalizePhone(displayNum)
    || getLeadRealPhone(lead);
  const lidJid = inboundRoute?.lidJid
    || (isLidIdentifier(fullJid) ? fullJid : null)
    || (isLidIdentifier(lead.jid) ? lead.jid : null)
    || (isLidIdentifier(lead.replyTargetJid) ? lead.replyTargetJid : null);

  if (realPhone) {
    lead.phone = realPhone;
    lead.displayNumber = realPhone;
    lead.phoneResolved = true;
  } else {
    if (!normalizePhone(lead.phone)) lead.phone = null;
    if (!normalizePhone(lead.displayNumber)) lead.displayNumber = null;
    lead.phoneResolved = false;
  }

  if (lidJid) {
    lead.lidJid = normalizeLidJid(lidJid);
    lead.internalWhatsAppId = lead.lidJid;
  }

  return lead;
}

function buildLeadFactText(lead, currentText = '') {
  return buildRecentUserText(lead, currentText, 8);
}

async function applyLatestFactsToLead(lead, {
  currentText = '',
  fullJid = null,
  inboundRoute = null,
  source = 'message',
} = {}) {
  if (!lead) return {};
  const beforePlate = lead.plate || null;
  const beforePhone = getLeadRealPhone(lead);
  const facts = applyDeterministicFactsToLead(lead, buildLeadFactText(lead, currentText));
  const lidJid = lead.lidJid || resolveInboundLidJid(fullJid, inboundRoute);

  if (facts.plate && facts.plate !== beforePlate) {
    console.log(`[Agent] Plate captured deterministically: ${facts.plate}`);
  }

  if (facts.phone && facts.phone !== beforePhone) {
    console.log(`[Agent] Phone extracted from message: ${facts.phone}`);
    void persistLidPhonePair({
      lidJid,
      phone: facts.phone,
      source,
      confidence: 0.95,
    });
  }

  return facts;
}

function getOperationalEventType(event = {}) {
  return event.type || event.lastIntent || '';
}

function shouldRequirePlateBeforeOperationalHandoff(event = {}, lead = {}, text = '') {
  if (hasKnownPlate(lead, text) || lead.receiptReceived || event.receiptReceived || event.billingDisputed || event.inspectionDisputed) {
    return false;
  }

  return [
    'boleto_request',
    'regularization_request',
    'payment_claimed',
    'inspection_pending',
    'system_check_request',
  ].includes(getOperationalEventType(event));
}

function shouldRequirePhoneBeforeOperationalHandoff(event = {}, lead = {}, config = {}) {
  if (getLeadRealPhone(lead)) return false;
  if (config.allowHandoffWithoutPhone === true || process.env.WA_ALLOW_HANDOFF_WITHOUT_PHONE === 'true') return false;

  const type = getOperationalEventType(event);
  if (type === 'human_requested' || type === 'cancel_request' || type === 'angry_customer') return false;
  return true;
}

function rememberPendingOperationalHandoff(lead, event = {}) {
  lead.pendingOperationalHandoff = true;
  lead.pendingOperationalEvent = {
    ...event,
    reply: event.reply || '',
    reason: event.reason || '',
  };
  lead.pendingHandoffReason = event.reason || lead.pendingHandoffReason || null;
  lead.conversationMode = event.conversationMode || lead.conversationMode || 'collections';
  return lead;
}

function clearPendingOperationalHandoff(lead) {
  delete lead.pendingOperationalHandoff;
  delete lead.pendingOperationalEvent;
  delete lead.pendingHandoffReason;
  return lead;
}

function buildOperationalPhoneRequest(lead = {}) {
  if (lead.plate) {
    return `Recebi a placa ${lead.plate}. Para eu encaminhar corretamente para o consultor, me passa seu WhatsApp com DDD? O numero nao apareceu certinho por aqui.`;
  }
  return 'Entendi. Para eu encaminhar corretamente para o consultor, me passa seu WhatsApp com DDD? O numero nao apareceu certinho por aqui.';
}

function buildOperationalPlateRequest(event = {}) {
  const type = getOperationalEventType(event);
  if (type === 'inspection_pending') {
    return 'Entendi. Para encaminhar sua revistoria certinho, pode me passar a placa do veiculo?';
  }
  if (type === 'payment_claimed') {
    return 'Entendi. Se o pagamento ja foi feito, o consultor precisa conferir a baixa pelo financeiro. Para localizar mais rapido, pode me passar a placa do veiculo?';
  }
  return event.reply || 'Entendi. Para localizar mais rapido, pode me passar a placa do veiculo?';
}

function buildOperationalReply(event = {}, lead = {}) {
  const type = getOperationalEventType(event);
  if (!lead.plate) return event.reply || '';

  if (type === 'boleto_request' || type === 'regularization_request' || type === 'system_check_request') {
    return `Recebi a placa ${lead.plate}. Vou encaminhar para um consultor verificar a melhor forma de regularizar seu caso.`;
  }

  if (type === 'payment_claimed') {
    return `Recebi a placa ${lead.plate}. Se o pagamento ja foi feito, o consultor precisa conferir a baixa pelo financeiro. Vou encaminhar seu caso para continuidade.`;
  }

  if (type === 'inspection_pending') {
    return `Recebi a placa ${lead.plate}. Vou encaminhar para um consultor acompanhar sua revistoria e dar continuidade por aqui.`;
  }

  return event.reply || '';
}

function refreshOperationalCaseSummary(lead, event = {}, content = {}) {
  if (!lead) return lead;
  const latestText = content.historyText || content.text || '';
  const userHistory = (lead.history || [])
    .filter((entry) => entry?.role === 'user' && entry.content)
    .slice(-4)
    .map((entry) => entry.content)
    .join(' | ');
  const facts = [
    'Atendimento operacional/regularizacao.',
    event.reason || lead.operationalReason || '',
    lead.plate ? `Placa informada: ${lead.plate}.` : '',
    getLeadRealPhone(lead) ? `Telefone real resolvido: ${getLeadRealPhone(lead)}.` : 'Telefone real ainda nao resolvido.',
    lead.paymentClaimed ? 'Cliente informou pagamento.' : '',
    lead.receiptReceived ? 'Comprovante recebido ou mencionado.' : '',
    lead.appBlocked ? 'Cliente relatou app bloqueado.' : '',
    lead.billingDisputed ? 'Cliente contestou cobranca/vencimento.' : '',
    lead.inspectionDisputed ? 'Cliente contestou revistoria.' : '',
    latestText ? `Ultima mensagem: "${String(latestText).slice(0, 160)}".` : '',
    userHistory ? `Historico recente: ${userHistory.slice(0, 260)}.` : '',
  ].filter(Boolean);

  lead.caseSummary = facts.join(' ');
  lead.leadSummary = {
    ...(typeof lead.leadSummary === 'object' && lead.leadSummary ? lead.leadSummary : {}),
    caseSummary: lead.caseSummary,
    lastUserMessage: latestText || lead.leadSummary?.lastUserMessage || '',
    updatedAt: new Date().toISOString(),
  };
  return lead;
}

function findStoredLeadByJid(fullJid, jidId) {
  return getAllLeads().find((lead) => (
    lead?.jid === fullJid
    || lead?.replyTargetJid === fullJid
    || lead?.number === jidId
  )) || null;
}

function resolveReplyRoute(fullJid, fullJidAlt, conversationPhone, inboundRoute = null, existingLead = null) {
  const altPhone = normalizePhone(fullJidAlt);
  const inboundPhone = inboundRoute?.mappedPhone || inboundRoute?.phoneCandidates?.[0] || null;
  const leadPhone = normalizePhone(existingLead?.phone)
    || normalizePhone(existingLead?.displayNumber)
    || normalizePhone(existingLead?.number)
    || null;
  const commonOptions = { context: 'ai', noInternalRetry: true, inboundRoute };

  if (altPhone) {
    return {
      target: altPhone,
      options: { ...commonOptions, forcePhoneJid: true, routeLabel: 'agent_remote_jid_alt' },
      source: 'remoteJidAlt',
    };
  }

  if (inboundPhone) {
    return {
      target: inboundPhone,
      options: { ...commonOptions, forcePhoneJid: true, routeLabel: 'agent_inbound_phone' },
      source: 'inboundPhone',
    };
  }

  if (leadPhone) {
    return {
      target: leadPhone,
      options: { ...commonOptions, forcePhoneJid: true, routeLabel: 'agent_lead_phone' },
      source: 'leadPhone',
    };
  }

  if (conversationPhone) {
    return {
      target: conversationPhone,
      options: { ...commonOptions, forcePhoneJid: true, routeLabel: 'agent_phone' },
      source: 'conversationPhone',
    };
  }

  if (isLidJid(fullJid)) {
    return {
      target: fullJid,
      options: { ...commonOptions, allowRawLid: true, skipTyping: true, routeLabel: 'agent_raw_lid' },
      source: 'raw_lid_allowed',
    };
  }

  return {
    target: fullJid,
    options: { ...commonOptions, routeLabel: 'agent_jid' },
    source: 'jid',
  };
}

function resolveLeadIdentity(jidId, conversationPhone, fullJid) {
  const preferredId = conversationPhone || jidId;
  const preferredLead = getLead(preferredId);
  if (preferredLead) return { leadId: preferredId, lead: preferredLead };

  if (preferredId !== jidId) {
    const legacyLead = getLead(jidId);
    if (legacyLead) return { leadId: jidId, lead: legacyLead };
  }

  const storedLead = findStoredLeadByJid(fullJid, jidId);
  if (storedLead) return { leadId: storedLead.number || preferredId, lead: storedLead };

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

  const collectionsStatuses = new Set([
    'payment_claimed',
    'receipt_received',
    'awaiting_financial_review',
    'inspection_pending',
    'inspection_disputed',
    'app_blocked',
    'billing_disputed',
    'transferred_to_financial',
    'transferred_to_support',
  ]);
  if (lead?.conversationMode === 'collections' || collectionsStatuses.has(lead?.status)) {
    return {
      conversationMode: 'collections',
      campaignId: lead?.campaignId || 'lead_state',
      campaignMessage: lead?.campaignMessage || '',
      campaignIntent: 'collections',
      campaignSubIntent: lead?.campaignSubIntent || lead?.lastIntent || 'collections_unknown',
      campaignIntentReason: 'Lead ja estava marcado como atendimento operacional.',
    };
  }

  return null;
}

function sanitizeReply(text) {
  const reply = String(text || '').trim();
  if (!reply) {
    return 'Oi! Me conta um pouco mais sobre o seu veiculo pra eu te ajudar melhor.';
  }
  return reply
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function buildAssistantHistoryEntry(content, delivery = {}) {
  return {
    role: 'assistant',
    content,
    ts: Date.now(),
    deliveryStatus: delivery.status || 'accepted',
    messageId: delivery.messageId || null,
    targetJid: delivery.targetJid || null,
    error: delivery.error || null,
  };
}

function appendAssistantMessage(lead, content, delivery) {
  lead.history = lead.history || [];
  lead.history.push(buildAssistantHistoryEntry(content, delivery));
}

async function sendSingleReplyTracked(wa, target, text, sendOptions = {}) {
  return sendTextWithConfirmation(wa, target, text, sendOptions);
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
      console.log(`[Agent] Session expired for ${leadId} - history cleared`);
    }
  }, timeoutMs);

  sessionTimers.set(leadId, timer);
}

function createNewLead(leadId, displayNum, pushName, fallbackPhone = null) {
  const phone = normalizePhone(fallbackPhone || displayNum);
  return {
    number: leadId,
    displayNumber: phone || null,
    phone,
    phoneResolved: !!phone,
    lidJid: null,
    internalWhatsAppId: null,
    name: pushName || null,
    status: 'new',
    history: [],
    plate: null,
    model: null,
    year: null,
    stage: 'new',
    lastIntent: null,
    lastObjection: null,
    leadSummary: null,
    lastQualifiedSignalAt: null,
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

async function persistSimpleReply(wa, leadId, lead, target, reply, extraUpdates = () => ({}), sendOptions = {}) {
  try {
    const delivery = await sendSingleReplyTracked(wa, target, reply, sendOptions);
    appendAssistantMessage(lead, reply, delivery);
    Object.assign(lead, extraUpdates(delivery));
  } catch (err) {
    appendAssistantMessage(lead, reply, {
      status: 'failed',
      targetJid: err.targetResolved || null,
      error: err.message,
    });
  }
  saveLead(leadId, lead);
}

async function handleSalesEvent(wa, leadId, lead, route, config, event, content = {}) {
  applySalesEventToLead(lead, event, content);
  saveLead(leadId, lead);

  if (!event.shouldHandoff) {
    await persistSimpleReply(wa, leadId, lead, route.target, event.reply, () => ({}), route.options);
    return;
  }

  if (!getLeadRealPhone(lead)) {
    lead.status = 'awaiting_phone_for_handoff';
    lead.stage = 'awaiting_phone_for_handoff';
    lead.phoneResolved = false;
    lead.pendingHandoffReason = event.reason;
    saveLead(leadId, lead);
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      ASK_PHONE_FOR_HANDOFF_REPLY,
      () => ({}),
      route.options,
    );
    return;
  }

  try {
    const handoffResult = await executeHandoff(wa, lead, config, {
      reason: event.reason,
      clientMessage: event.clientMessage || event.reply,
      clientSendOptions: route.options,
    });
    lead.status = handoffResult.clientNotified ? 'transferred' : 'handoff_client_confirmation_failed';
    lead.stage = lead.status;
    lead.transferredAt = new Date().toISOString();
    lead.transferredTo = handoffResult.consultor?.number || null;
    lead.transferredToName = handoffResult.consultor?.name || null;
    lead.handoffReason = event.reason;
    lead.handoffClientConfirmed = !!handoffResult.clientNotified;
    saveLead(leadId, lead);
  } catch (err) {
    console.error(`[Agent] Commercial handoff failed for ${leadId}: ${err.message}`);
    markSalesHandoffFailure(lead, err);
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      getSalesHandoffFailedReply(),
      () => ({ handoffError: err.message }),
      route.options,
    );
  }
}

async function handlePendingCommercialHandoff(wa, leadId, lead, route, config) {
  const realPhone = getLeadRealPhone(lead);
  if (!realPhone) {
    lead.status = 'awaiting_phone_for_handoff';
    lead.stage = 'awaiting_phone_for_handoff';
    lead.phoneResolved = false;
    saveLead(leadId, lead);
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      lead.handoffClientError ? HANDOFF_RECOVERY_REPLY : ASK_PHONE_FOR_HANDOFF_REPLY,
      () => ({}),
      route.options,
    );
    return true;
  }

  try {
    const handoffResult = await executeHandoff(wa, lead, config, {
      reason: lead.pendingHandoffReason || lead.handoffReason || 'Cliente comercial aguardava encaminhamento.',
      clientMessage: 'Recebi seus dados. Vou encaminhar para um consultor preparar sua cotacao e continuar o atendimento por aqui.',
      clientSendOptions: route.options,
    });
    lead.status = handoffResult.clientNotified ? 'transferred' : 'handoff_client_confirmation_failed';
    lead.stage = lead.status;
    lead.transferredAt = new Date().toISOString();
    lead.transferredTo = handoffResult.consultor?.number || null;
    lead.transferredToName = handoffResult.consultor?.name || null;
    lead.handoffClientConfirmed = !!handoffResult.clientNotified;
    saveLead(leadId, lead);
  } catch (err) {
    console.error(`[Agent] Pending commercial handoff failed for ${leadId}: ${err.message}`);
    markSalesHandoffFailure(lead, err);
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      getSalesHandoffFailedReply(),
      () => ({ handoffError: err.message }),
      route.options,
    );
  }

  return true;
}

async function handleOperationalEventAction(wa, leadId, lead, route, config, event, content = {}) {
  if (!event) return false;
  const text = content.historyText || content.text || '';

  if (!event.shouldNotifyHuman) {
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      buildOperationalReply(event, lead) || event.reply,
      () => ({}),
      route.options,
    );
    return true;
  }

  rememberPendingOperationalHandoff(lead, event);

  if (shouldRequirePlateBeforeOperationalHandoff(event, lead, text)) {
    lead.status = OPERATIONAL_PENDING_DATA_STATUS;
    lead.stage = OPERATIONAL_PENDING_DATA_STATUS;
    lead.operationalStatus = 'awaiting_plate_for_handoff';
    saveLead(leadId, lead);
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      buildOperationalPlateRequest(event),
      () => ({}),
      route.options,
    );
    return true;
  }

  if (shouldRequirePhoneBeforeOperationalHandoff(event, lead, config)) {
    lead.status = 'awaiting_phone_for_handoff';
    lead.stage = 'awaiting_phone_for_handoff';
    lead.phoneResolved = false;
    lead.operationalStatus = 'awaiting_phone_for_handoff';
    saveLead(leadId, lead);
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      buildOperationalPhoneRequest(lead),
      () => ({}),
      route.options,
    );
    return true;
  }

  lead.status = event.status || lead.status || 'awaiting_financial_review';
  lead.stage = event.stage || lead.stage || lead.status;
  lead.operationalStatus = 'handoff_ready';
  refreshOperationalCaseSummary(lead, event, content);

  const reply = buildOperationalReply(event, lead) || event.reply;
  await persistSimpleReply(
    wa,
    leadId,
    lead,
    route.target,
    reply,
    () => ({}),
    route.options,
  );

  await executeFinancialHandoff(wa, lead, config, event);
  const storedLead = getLead(leadId) || lead;
  clearPendingOperationalHandoff(storedLead);
  saveLead(leadId, storedLead);
  return true;
}

async function handlePendingOperationalHandoff(wa, leadId, lead, route, config, content = {}) {
  const event = lead.pendingOperationalEvent || {
    type: lead.lastIntent || 'regularization_request',
    status: lead.status || 'awaiting_financial_review',
    stage: lead.stage || 'awaiting_financial_review',
    reply: 'Recebi. Vou encaminhar para um consultor dar continuidade por aqui.',
    reason: lead.pendingHandoffReason || lead.operationalReason || 'Cliente aguardava encaminhamento operacional.',
    shouldNotifyHuman: true,
    shouldStopAutomation: true,
    lastIntent: lead.lastIntent || 'regularization_request',
    conversationMode: lead.conversationMode || 'collections',
  };

  return handleOperationalEventAction(wa, leadId, lead, route, config, event, content);
}

export async function handleIncomingMessage(wa, rawMsg) {
  if (!isValidIncoming(rawMsg)) return;

  const config = resolveEffectiveAIConfig(loadConfig());
  const fullJid = rawMsg.key.remoteJid;
  const fullJidAlt = rawMsg.key.remoteJidAlt || '';
  const jidId = fullJid.split('@')[0].split(':')[0];
  const inboundRoute = typeof wa.getInboundRouteContext === 'function' ? wa.getInboundRouteContext(rawMsg) : null;
  const persistentPhone = await resolvePersistentPhoneForLid(fullJid, inboundRoute);
  const displayNum = persistentPhone || inboundRoute?.mappedPhone || inboundRoute?.phoneCandidates?.[0] || wa.resolvePhone(fullJidAlt || fullJid);
  const conversationPhone = persistentPhone || resolveConversationPhone(displayNum, jidId, inboundRoute);
  const { leadId, lead: leadFromStore } = resolveLeadIdentity(jidId, conversationPhone, fullJid);
  const replyRoute = resolveReplyRoute(fullJid, fullJidAlt, conversationPhone, inboundRoute, leadFromStore);
  const incomingContent = extractIncomingContent(rawMsg);
  const text = incomingContent.text;
  const pushName = rawMsg.pushName || null;
  const inboundLidJid = resolveInboundLidJid(fullJid, inboundRoute);

  console.log(`[Agent] Incoming from ${displayNum} (jid: ${fullJid}${fullJidAlt ? ` alt: ${fullJidAlt}` : ''}): "${incomingContent.historyText.slice(0, 60)}"`);
  console.log(`[Agent] Reply route for ${displayNum}: ${replyRoute.target} (${replyRoute.source}) candidates=${inboundRoute?.phoneCandidates?.join(',') || '-'} mapped=${inboundRoute?.mappedPhone || '-'}`);

  if (inboundLidJid && conversationPhone) {
    void persistLidPhonePair({
      lidJid: inboundLidJid,
      phone: conversationPhone,
      source: persistentPhone ? 'previous_lead' : 'contact_sync',
      confidence: persistentPhone ? 0.95 : 0.85,
    });
  }

  const consultant = await resolveConsultantForRoute({
    phone: conversationPhone || displayNum,
    lidJid: inboundLidJid,
    config,
  });
  if (consultant || isConsultantLinkCommand(incomingContent.historyText)) {
    await handleConsultantMessage({
      wa,
      consultant,
      message: incomingContent.historyText,
      route: replyRoute,
      config,
      inboundRoute,
      fullJid,
    });
    return;
  }

  if (!config.aiEnabled) return;

  const provider = config.effectiveProvider || 'groq';
  const hasKey = !!config.hasEffectiveKey;
  if (!hasKey) {
    console.warn(`[Agent] No API key for "${provider}"`);
    return;
  }

  void recordEvent({
    leadKey: conversationPhone || leadId,
    eventType: 'client_message_received',
    payload: {
      jid: fullJid,
      phoneResolved: !!conversationPhone,
      hasLid: !!inboundLidJid,
      textLength: incomingContent.historyText.length,
    },
  });

  const existingLead = leadFromStore;
  const collectionsContext = resolveConversationModeContext(config, existingLead, conversationPhone, jidId);
  if (!incomingContent.historyText) return;

  if (existingLead?.status === 'blocked' || isOperationalStopStatus(existingLead?.status) || shouldPauseSalesLead(existingLead)) {
    void recordEvent({
      leadKey: conversationPhone || leadId,
      eventType: 'ai_reply_blocked',
      payload: { status: existingLead?.status || 'unknown', reason: 'paused_status' },
    });
    return;
  }

  if (existingLead?.campaignSentAt && !existingLead?.campaignLoopHandled && config.campaignLoopEnabled === false) {
    console.log(`[Agent] Campaign loop disabled - ignoring reply from ${leadId}`);
    return;
  }

  const decisionLeadSeed = existingLead
    ? { ...existingLead, history: existingLead.history || [] }
    : createNewLead(leadId, displayNum, pushName, conversationPhone);
  rememberLeadContactRoute(decisionLeadSeed, { conversationPhone, displayNum, fullJid, inboundRoute });
  applyDeterministicFactsToLead(
    decisionLeadSeed,
    buildRecentUserText(existingLead || {}, incomingContent.historyText, 8),
  );

  const decision = makeConversationDecision({
    text,
    lead: decisionLeadSeed,
    collectionsContext,
    incomingContent,
  });
  const operationalEvent = decision.operationalEvent;

  if (operationalEvent) {
    console.log(`[Agent] Operational event ${operationalEvent.type} for ${leadId}: ${operationalEvent.reason}`);
    const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
    lead.number = leadId;
    lead.jid = fullJid;
    lead.replyTargetJid = replyRoute.target;
    lead.replyTargetSource = replyRoute.source;
    rememberLeadContactRoute(lead, { conversationPhone, displayNum, fullJid, inboundRoute });
    if (!lead.name && pushName) lead.name = pushName;
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: incomingContent.historyText, ts: Date.now() });
    lead.lastInteraction = new Date().toISOString();
    await applyLatestFactsToLead(lead, {
      fullJid,
      inboundRoute,
      source: 'phone_extracted_from_user',
    });
    applyConversationDecisionToLead(lead, decision, incomingContent);

    await handleOperationalEventAction(wa, leadId, lead, replyRoute, config, operationalEvent, incomingContent);
    return;
  }

  if (!text) return;

  if (existingLead?.status === 'no_interest' && !collectionsContext) {
    const normForReeng = normalizeText(text);
    if (!isReengagement(normForReeng)) {
      console.log(`[Agent] Silencing no_interest lead ${leadId}: "${text.slice(0, 40)}"`);
      return;
    }

    console.log(`[Agent] Re-engagement detected for ${leadId}: "${text.slice(0, 40)}"`);
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
      const msg = `Oi! Nosso horario de atendimento e das ${sh}h as ${eh}h. Estarei aqui quando voltar! Ate logo.`;
      const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
      await persistSimpleReply(wa, leadId, lead, replyRoute.target, msg, (delivery) => (
        delivery.status !== 'failed' ? { lastOutOfHoursMsg: today } : {}
      ), replyRoute.options);
    }
    return;
  }

  resetSessionTimer(leadId, config);

  const norm = normalizeText(text);

  if (isStrongRefusal(norm)) {
    console.log(`[Agent] Strong refusal detected from ${leadId}: "${text}"`);
    const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
    lead.status = 'no_interest';
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: text, ts: Date.now() });
    await persistSimpleReply(wa, leadId, lead, replyRoute.target, randomFrom(REFUSAL_RESPONSES), () => ({}), replyRoute.options);
    return;
  }

  if (!collectionsContext && isSoftRefusal(norm)) {
    if (existingLead?.softRefusalSent) {
      console.log(`[Agent] 2nd soft refusal - closing ${leadId}`);
      const lead = existingLead;
      lead.status = 'no_interest';
      await persistSimpleReply(wa, leadId, lead, replyRoute.target, randomFrom(REFUSAL_RESPONSES), () => ({}), replyRoute.options);
      return;
    }

    console.log(`[Agent] Soft refusal from ${leadId} - sending gentle pitch`);
    const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
    lead.softRefusalSent = true;
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: text, ts: Date.now() });
    await persistSimpleReply(wa, leadId, lead, replyRoute.target, randomFrom(SOFT_REFUSAL_RESPONSES), () => ({}), replyRoute.options);
    return;
  }

  if (!collectionsContext && isAmbiguousInterjection(norm)) {
    console.log(`[Agent] Ambiguous interjection from ${leadId}: "${text}"`);
    const lead = existingLead || createNewLead(leadId, displayNum, pushName, conversationPhone);
    lead.history = lead.history || [];
    lead.history.push({ role: 'user', content: text, ts: Date.now() });
    await persistSimpleReply(wa, leadId, lead, replyRoute.target, randomFrom(CLARIFICATION_RESPONSES), () => ({}), replyRoute.options);
    return;
  }

  accumulate(wa, fullJid, leadId, jidId, displayNum, text, pushName, config, replyRoute);
}

function accumulate(wa, fullJid, leadId, jidId, displayNum, text, pushName, config, replyRoute) {
  if (!messageBuffers.has(leadId)) {
    messageBuffers.set(leadId, { texts: [], pushName, fullJid, displayNum, jidId, replyRoute, timer: null });
  }

  const buffer = messageBuffers.get(leadId);
  buffer.texts.push(text);
  buffer.pushName = buffer.pushName || pushName;
  buffer.fullJid = fullJid;
  buffer.displayNum = displayNum;
  buffer.jidId = jidId;
  buffer.replyRoute = replyRoute;

  if (buffer.timer) clearTimeout(buffer.timer);
  buffer.timer = setTimeout(async () => {
    const { texts, fullJid: jid, displayNum: phone, pushName: name, jidId: rawLeadId, replyRoute: route } = buffer;
    messageBuffers.delete(leadId);
    try {
      await processConversation(wa, jid, leadId, rawLeadId, phone, texts, name, config, route);
    } catch (err) {
      console.error(`[Agent] Error processing ${leadId}:`, err.message, err.stack);
    }
  }, ANTIFLOOD_MS);
}

async function processConversation(wa, fullJid, leadId, jidId, displayNum, texts, pushName, config, replyRoute = null) {
  const combinedText = texts.join('\n');
  const conversationPhone = resolveConversationPhone(displayNum, jidId, replyRoute?.options?.inboundRoute || null);

  let lead = getLead(leadId) || createNewLead(leadId, displayNum, pushName, conversationPhone);
  const route = replyRoute || resolveReplyRoute(fullJid, '', conversationPhone, null, lead);

  if (lead.status === 'blocked' || isOperationalStopStatus(lead.status) || shouldPauseSalesLead(lead)) {
    console.log(`[Agent] Lead ${leadId} is paused with status ${lead.status}; skipping automatic reply.`);
    void recordEvent({
      leadKey: leadId,
      eventType: 'ai_reply_blocked',
      payload: { status: lead.status, reason: 'paused_status_buffered' },
    });
    return;
  }

  lead.number = leadId;
  lead.jid = fullJid;
  lead.replyTargetJid = route.target;
  lead.replyTargetSource = route.source;
  rememberLeadContactRoute(lead, {
    conversationPhone,
    displayNum,
    fullJid,
    inboundRoute: route.options?.inboundRoute || null,
  });

  if (!lead.name && pushName) lead.name = pushName;
  if (lead.campaignSentAt && !lead.campaignLoopHandled) lead.campaignLoopHandled = true;

  lead.history = lead.history || [];
  lead.history.push({ role: 'user', content: combinedText, ts: Date.now() });
  lead.lastInteraction = new Date().toISOString();
  lead.followUp1Sent = false;
  lead.followUp2Sent = false;

  await applyLatestFactsToLead(lead, {
    fullJid,
    inboundRoute: route.options?.inboundRoute || null,
    source: 'phone_extracted_from_user',
  });

  if (lead.pendingOperationalHandoff || lead.pendingOperationalEvent || lead.status === OPERATIONAL_PENDING_DATA_STATUS) {
    await handlePendingOperationalHandoff(
      wa,
      leadId,
      lead,
      route,
      config,
      { text: combinedText, historyText: combinedText },
    );
    return;
  }

  if (
    lead.status === 'awaiting_phone_for_handoff'
    || lead.status === 'handoff_client_confirmation_failed'
    || (lead.status === 'transferred' && (lead.handoffClientError || lead.handoffClientConfirmed === false))
  ) {
    await handlePendingCommercialHandoff(wa, leadId, lead, route, config);
    return;
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
    lead.stage = lead.stage || 'engaged';
    lead.conversationMode = 'collections';
    console.log(`[Agent] Collections mode active for ${leadId} via campaign ${conversationModeContext.campaignId}`);
  } else if (lead.status === 'new' || lead.status === 'cold') {
    lead.status = 'talking';
    lead.stage = lead.stage || 'engaged';
  }

  const decision = makeConversationDecision({
    text: combinedText,
    lead,
    collectionsContext: conversationModeContext,
    incomingContent: { text: combinedText, historyText: combinedText },
  });
  applyConversationDecisionToLead(lead, decision, { text: combinedText, historyText: combinedText });

  if (!conversationModeContext) {
    applySalesFactsToLead(lead, combinedText);
    const salesEvent = detectSalesEvent({
      text: combinedText,
      lead,
      phase: 'pre',
    });

    if (salesEvent) {
      console.log(`[Agent] Sales event ${salesEvent.type} for ${leadId}: ${salesEvent.reason}`);
      await handleSalesEvent(
        wa,
        leadId,
        lead,
        route,
        config,
        salesEvent,
        { text: combinedText, historyText: combinedText },
      );
      return;
    }
  }

  if (decision.operationalEvent) {
    console.log(`[Agent] Buffered operational event ${decision.operationalEvent.type} for ${leadId}: ${decision.operationalEvent.reason}`);
    await handleOperationalEventAction(
      wa,
      leadId,
      lead,
      route,
      config,
      decision.operationalEvent,
      { text: combinedText, historyText: combinedText },
    );
    return;
  }

  const alreadyTransferred = ['transferred', 'transferred_to_financial', 'transferred_to_support'].includes(lead.status);
  saveLead(leadId, lead);

  const replyContext = await buildContext(
    config,
    lead,
    alreadyTransferred,
    conversationModeContext || { conversationMode: 'sales' },
  );

  let cleanResponse = '';
  let extraction = {
    qualified: false,
    plate: lead.plate || null,
    model: lead.model || null,
    year: lead.year || null,
    name: lead.name || null,
    phone: lead.phone || null,
    profileCaptured: !!lead.profileCaptured,
  };

  if (conversationModeContext) {
    try {
      cleanResponse = sanitizeReply(await callAI(config, replyContext, { purpose: 'reply', mode: 'collections' }));
    } catch (error) {
      console.error('[Agent] Collections reply error:', error.message || error);
      return;
    }
  } else {
    const qualificationContext = await buildQualificationContext(config, lead, combinedText);

    const [replyResult, qualificationResult] = await Promise.allSettled([
      callAI(config, replyContext, { purpose: 'reply', mode: 'sales' }),
      callAI(config, qualificationContext, { purpose: 'qualification', mode: 'sales' }),
    ]);

    if (replyResult.status !== 'fulfilled') {
      console.error('[Agent] AI reply error:', replyResult.reason?.message || replyResult.reason);
      return;
    }

    cleanResponse = sanitizeReply(replyResult.value);

    if (qualificationResult.status === 'fulfilled') {
      extraction = detectAndExtract(qualificationResult.value, lead);
    } else {
      console.warn('[Agent] Qualification extraction failed:', qualificationResult.reason?.message || qualificationResult.reason);
    }

    if (extraction.plate) lead.plate = extraction.plate;
    if (extraction.model) lead.model = extraction.model;
    if (extraction.year) lead.year = extraction.year;
    if (extraction.name && extraction.name.length > 1) lead.name = extraction.name;
    if (extraction.profileCaptured) lead.profileCaptured = true;
    if (extraction.phone) {
      lead.phone = extraction.phone;
      lead.displayNumber = extraction.phone;
      lead.phoneResolved = true;
      console.log(`[Agent] Phone from extraction: ${extraction.phone}`);
    }
  }

  if (!conversationModeContext) {
    applySalesFactsToLead(lead, combinedText);
    const postSalesEvent = detectSalesEvent({
      text: combinedText,
      lead,
      modelReply: cleanResponse,
      phase: 'post',
    });

    if (postSalesEvent) {
      console.log(`[Agent] Post-AI sales event ${postSalesEvent.type} for ${leadId}: ${postSalesEvent.reason}`);
      await handleSalesEvent(
        wa,
        leadId,
        lead,
        route,
        config,
        postSalesEvent,
        { text: combinedText, historyText: combinedText },
      );
      return;
    }
  }

  console.log(`[Agent] Sending to ${route.target} (${displayNum}) via ${route.source}`);
  let delivery;
  try {
    delivery = await sendHumanized(wa, route.target, cleanResponse, combinedText, false, route.options || {});
  } catch (err) {
    delivery = {
      status: 'failed',
      messageId: null,
      targetJid: err.targetResolved || null,
      error: err.message,
    };
  }

  appendAssistantMessage(lead, cleanResponse, delivery);

  if (delivery.status === 'failed') {
    saveLead(leadId, lead);
    console.error(`[Agent] Delivery failed for ${leadId}: ${delivery.error || delivery.status}`);
    return;
  }

  if (delivery.status === 'accepted_unconfirmed' || delivery.status === 'delivery_timeout') {
    saveLead(leadId, lead);
    console.warn(`[Agent] Delivery unconfirmed for ${leadId}: ${delivery.error || delivery.status}`);
    return;
  }

  if (conversationModeContext) {
    saveLead(leadId, lead);
    return;
  }

  if (extraction.qualified && !alreadyTransferred) {
    lead.status = 'qualified';
    lead.stage = 'qualified';
    lead.qualifiedAt = new Date().toISOString();
    lead.lastQualifiedSignalAt = lead.qualifiedAt;
    saveLead(leadId, lead);
    await executeHandoff(wa, lead, config);
    return;
  }

  saveLead(leadId, lead);
}
