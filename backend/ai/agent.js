import { loadConfig, resolveEffectiveAIConfig } from '../data/config-manager.js';
import { getAllLeads, getLead, saveLead } from '../data/leads-manager.js';
import { recoverLeadWhenCustomerReturns } from '../data/lead-lifecycle-service.js';
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
import { buildHumanizedReply } from './humanized-reply-builder.js';
import { getRelevantKnowledge } from './knowledge-retriever.js';
import { getNextSalesStep } from './sales-playbook.js';
import {
  applySalesEventToLead,
  applySalesFactsToLead,
  detectSalesEvent,
  getCoverageInfoReply,
  getSalesHandoffFailedReply,
  isCoverageInfoQuestion,
  isSalesStopStatus,
  markSalesHandoffFailure,
} from './sales-guard.js';
import {
  applyDeterministicFactsToLead,
  buildRecentUserText,
} from './deterministic-facts.js';
import {
  classifyDeterministicIntent,
  normalizeCustomerText,
} from './deterministic-intent.js';
import { recordEvent } from '../data/events-repository.js';
import { resolvePhoneByLid, upsertLidPhoneMapping } from '../data/lid-phone-map-repository.js';

const messageBuffers = new Map();
const sessionTimers = new Map();
const ANTIFLOOD_MS = 3500;

function shouldRunSalesQualification(decision, text = '', facts = {}) {
  if (decision?.conversationMode !== 'sales' || decision.shouldHandoff) return false;
  if (decision.nextAction !== 'ask_model_year') return false;
  if (facts.model || facts.year || facts.plate || facts.phone) return false;

  const normalized = normalizeText(text);
  if (!normalized || normalized.split(/\s+/).length > 5) return false;
  if (/^(sim|nao|ok|certo|blz|beleza|obg|valeu)$/.test(normalized)) return false;
  if (/\b(cotacao|cotar|cota|orcamento|simulacao|preco|valor|protecao|contratar)\b/.test(normalized)) return false;
  if (/^(oi|ola|opa|bom dia|boa tarde|boa noite)\b/.test(normalized)) return false;
  return /[a-z]/.test(normalized);
}

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

const ASK_PHONE_FOR_HANDOFF_REPLY = 'Para anexar seu contato certinho no encaminhamento ao consultor, me confirma seu WhatsApp com DDD?';
const ASK_PHONE_FOR_HANDOFF_FORMAT_REPLY = 'Para eu encaminhar corretamente para o consultor, preciso do WhatsApp com DDD. Pode me enviar nesse formato? Exemplo: 21999999999.';
const HANDOFF_RECOVERY_REPLY = 'Recebi seus dados, mas tive uma falha ao confirmar o encaminhamento por aqui. Para anexar seu contato certinho, me confirma seu WhatsApp com DDD?';
const OPERATIONAL_CONTACT_RECEIVED_REPLY = 'Perfeito, recebi seu contato. Encaminhei seu atendimento para um consultor continuar por aqui.';
const OPERATIONAL_HANDOFF_FAILED_REPLY = 'Entendi seu pedido, mas nao consegui avisar o consultor agora. Seu atendimento ficou registrado para acompanhamento manual.';
const OPERATIONAL_PENDING_DATA_STATUS = 'awaiting_operational_data';
const OPERATIONAL_PENDING_CONTACT_STATUS = 'awaiting_contact_for_handoff';

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

  if (facts.phone) {
    lead.phoneResolutionSource = lead.phoneResolutionSource || source;
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
  return event.type || event.intent || event.lastIntent || '';
}

function shouldRequirePhoneBeforeOperationalHandoff(event = {}, lead = {}, config = {}) {
  if (getLeadRealPhone(lead)) return false;
  if (config.allowHandoffWithoutPhone === true || process.env.WA_ALLOW_HANDOFF_WITHOUT_PHONE === 'true') return false;

  return true;
}

function shouldRequireNameBeforeOperationalHandoff(event = {}, lead = {}) {
  // Alteração solicitada: não pedir o nome para handoff operacional, apenas o telefone.
  return false;
}

function shouldRequireContactBeforeOperationalHandoff(event = {}, lead = {}, config = {}) {
  return shouldRequirePhoneBeforeOperationalHandoff(event, lead, config)
    || shouldRequireNameBeforeOperationalHandoff(event, lead);
}

function rememberPendingOperationalHandoff(lead, event = {}) {
  lead.pendingOperationalHandoff = true;
  lead.pendingOperationalEvent = {
    ...event,
    type: event.type || event.intent || event.lastIntent || lead.lastIntent,
    reply: event.reply || '',
    reason: event.reason || event.notes || '',
  };
  lead.pendingHandoffReason = event.reason || event.notes || lead.pendingHandoffReason || null;
  lead.conversationMode = event.conversationMode || lead.conversationMode || 'collections';
  return lead;
}

function clearPendingOperationalHandoff(lead) {
  delete lead.pendingOperationalHandoff;
  delete lead.pendingOperationalEvent;
  delete lead.pendingHandoffReason;
  return lead;
}

function buildOperationalPhoneRequest(lead = {}, event = {}) {
  const type = getOperationalEventType(event);
  const prefix = lead.plate ? `Recebi a placa ${lead.plate}. ` : '';
  if (type === 'receipt_received') {
    return `${prefix}Entendi que voce informou o envio do comprovante. Para encaminhar ao consultor, me confirma seu WhatsApp com DDD?`;
  }
  return `${prefix}${ASK_PHONE_FOR_HANDOFF_REPLY}`;
}

function buildOperationalContactRequest(lead = {}, event = {}, config = {}) {
  const needsPhone = shouldRequirePhoneBeforeOperationalHandoff(event, lead, config);
  return needsPhone ? buildOperationalPhoneRequest(lead, event) : '';
}

function buildOperationalReply(event = {}, lead = {}) {
  const type = getOperationalEventType(event);
  if (type === 'assistance_request') return 'Entendi o pedido de reboque ou assistencia. Encaminhei seu atendimento para um consultor continuar por aqui.';
  if (type === 'event_report') return 'Entendi o que aconteceu com o veiculo. Encaminhei seu atendimento para um consultor continuar por aqui.';
  return event.clientReply || event.reply || 'Entendi. Encaminhei seu atendimento para um consultor continuar por aqui.';
}

function buildOperationalContactReceivedReply(event = {}) {
  const type = getOperationalEventType(event);
  if (type === 'assistance_request') return 'Perfeito, recebi seu contato. Encaminhei o pedido de reboque ou assistencia para um consultor continuar por aqui.';
  if (type === 'event_report') return 'Perfeito, recebi seu contato. Encaminhei o atendimento sobre o veiculo para um consultor continuar por aqui.';
  if (type === 'reactivation_request') return OPERATIONAL_CONTACT_RECEIVED_REPLY;
  if (type === 'boleto_request') return 'Perfeito, recebi seu contato. Encaminhei o pedido de boleto para um consultor continuar por aqui.';
  if (type === 'regularization_request') return 'Perfeito, recebi seu contato. Encaminhei seu pedido de regularizacao para um consultor continuar por aqui.';
  return OPERATIONAL_CONTACT_RECEIVED_REPLY;
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
    `Atendimento operacional. Intencao: ${getOperationalEventType(event) || 'nao identificada'}.`,
    event.reason || lead.operationalReason || '',
    lead.plate ? `Placa informada: ${lead.plate}.` : '',
    getLeadRealPhone(lead) ? `Telefone real resolvido: ${getLeadRealPhone(lead)}.` : 'Telefone real ainda nao resolvido.',
    lead.paymentClaimed ? 'Cliente informou pagamento.' : '',
    lead.receiptReceived ? 'Comprovante recebido.' : '',
    !lead.receiptReceived && lead.receiptAvailable ? 'Cliente informou que tem comprovante, mas ainda nao enviou.' : '',
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

function buildSalesVehicleConfirmation(lead = {}) {
  const plateText = lead.plate
    || (lead.plateUnavailable ? 'veiculo sem placa' : '')
    || (lead.plateWithheld ? 'nao informada nesta etapa' : '');
  if (!lead.model || !lead.year || !plateText) return '';
  return [
    'Recebi:',
    `Veiculo: ${lead.model}`,
    `Ano: ${lead.year}`,
    `Placa: ${plateText}`,
  ].join('\n');
}

function buildSalesHandoffClientMessage(lead = {}, { phoneJustProvided = false } = {}) {
  const intro = phoneJustProvided
    ? 'Perfeito, recebi seus dados. Encaminhei para um consultor preparar sua cotacao real e continuar seu atendimento por aqui.'
    : 'Recebi os dados principais. Encaminhei para um consultor preparar sua cotacao real e continuar seu atendimento por aqui.';
  const facts = buildSalesVehicleConfirmation(lead);
  return facts ? `${intro}\n\n${facts}` : intro;
}

function isReceiptCorrectionText(text = '') {
  const normalized = normalizeText(text);
  return [
    /como voce recebeu/,
    /como recebeu/,
    /nao enviei (o )?comprovante/,
    /nao mandei (o )?comprovante/,
    /eu nao enviei/,
    /eu nao mandei/,
    /voce entendeu errado/,
    /entendeu errado/,
    /me expressei errado/,
  ].some((pattern) => pattern.test(normalized));
}

function isFollowUpNudgeText(text = '') {
  const normalized = normalizeText(text);
  return [
    /^boa tarde\??$/,
    /^bom dia\??$/,
    /^boa noite\??$/,
    /\bparou\b/,
    /\bcade\b/,
    /\bcad[eê]\b/,
    /\bta ai\b/,
    /\besta ai\b/,
    /\bme responde\b/,
  ].some((pattern) => pattern.test(normalized));
}

function buildRecoveryReply(lead = {}, text = '') {
  if (isReceiptCorrectionText(text)) {
    lead.receiptReceived = false;
    lead.receiptAvailable = true;
    if (getLeadRealPhone(lead)) {
      return 'Voce esta certo, eu me expressei mal. Voce disse que tem o comprovante, mas ainda nao enviou. Ja recebi seu telefone e vou encaminhar o atendimento corretamente para um consultor.';
    }
    return 'Voce esta certo, eu me expressei mal. Voce disse que tem o comprovante, mas ainda nao enviou. Para anexar seu contato certinho no encaminhamento, me confirma seu WhatsApp com DDD?';
  }

  if (getLeadRealPhone(lead)) {
    return 'Seu atendimento ficou registrado. Vou encaminhar para um consultor verificar e dar continuidade por aqui.';
  }
  return ASK_PHONE_FOR_HANDOFF_FORMAT_REPLY;
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

  // A LID recebido identifica a conversa exata. Responder pelo numero associado
  // pode ser aceito pelo servidor do WhatsApp sem chegar ao mesmo chat.
  if (isLidJid(fullJid)) {
    return {
      target: fullJid,
      options: {
        ...commonOptions,
        allowRawLid: true,
        forcePhoneJid: false,
        disableDeliveryRecovery: true,
        routeLabel: 'agent_inbound_lid',
      },
      source: 'inboundLid',
    };
  }

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

function titleCaseName(value = '') {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.length <= 2 ? part.toLowerCase() : part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractCustomerNameFromText(text = '') {
  const withoutPhone = String(text || '')
    .replace(/(?:\+?55[\s.-]?)?(?:\(?[1-9]{2}\)?[\s.-]?)9?\d{4}[\s.-]?\d{4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const explicit = withoutPhone.match(/\b(?:meu nome (?:e|eh|é)|sou(?: o| a)?|nome completo (?:e|eh|é))\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{4,80})/i);
  const candidate = (explicit?.[1] || withoutPhone)
    .replace(/[^\p{L}\s'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = candidate
    .split(/\s+/)
    .filter((word) => /^[\p{L}][\p{L}'.-]{1,}$/u.test(word));
  const normalized = normalizeText(candidate);
  const blocked = [
    'boa tarde',
    'bom dia',
    'boa noite',
    'quero reativar',
    'reativar minha protecao',
    'quero pagar',
    'quero boleto',
    'boleto pendente',
  ].some((term) => normalized.includes(term));

  if (blocked || words.length < 2 || words.length > 6) return null;
  return titleCaseName(words.join(' '));
}

function applyCustomerNameFromText(lead, text = '') {
  const name = extractCustomerNameFromText(text);
  if (!name) return null;
  lead.name = name;
  lead.nameConfirmed = true;
  lead.nameSource = 'user';
  return name;
}

function hasConfirmedOperationalName(lead = {}) {
  if (lead.nameConfirmed && lead.name) return true;
  const words = String(lead.name || '').trim().split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

function isLikelyIncompleteReply(reply = '') {
  const cleaned = String(reply || '')
    .trim()
    .replace(/[“”"']+$/g, '')
    .trim();
  if (!cleaned) return true;
  if (/[,:;]$/.test(cleaned)) return true;

  const normalized = normalizeText(cleaned);
  return [
    /\b(a|e|de|do|da|dos|das|em|para|pra|por|com|ou|que)$/i,
    /\bem caso de$/i,
    /\bo equivalente a$/i,
    /\ba gente calcula$/i,
    /\bsim em caso de$/i,
    /\broubo ou$/i,
    /\bfurt(o|a) ou$/i,
  ].some((pattern) => pattern.test(normalized));
}

function buildIncompleteReplyFallback(lead = {}, latestUserText = '', mode = 'sales') {
  if (mode === 'sales' && isCoverageInfoQuestion(latestUserText)) {
    return getCoverageInfoReply(latestUserText);
  }

  if (mode === 'collections') {
    return 'Vou reformular para nao te passar informacao incompleta. Esse caso precisa de conferencia, entao vou encaminhar para um consultor dar continuidade.';
  }

  if (lead?.model || lead?.year || lead?.plate || lead?.plateUnavailable) {
    return 'Vou reformular para nao ficar incompleto. Posso te ajudar com informacoes gerais e, se voce quiser uma cotacao real, encaminho para um consultor com os dados do veiculo.';
  }

  return 'Vou reformular para nao ficar incompleto. Me diz se voce quer entender melhor a protecao ou fazer uma cotacao.';
}

function ensureCompleteReply(reply, {
  lead = {},
  latestUserText = '',
  mode = 'sales',
} = {}) {
  if (!isLikelyIncompleteReply(reply)) return reply;
  const fallback = buildIncompleteReplyFallback(lead, latestUserText, mode);
  console.warn(`[Agent] Incomplete AI reply replaced. original="${String(reply || '').slice(0, 120)}"`);
  return fallback;
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
  let delivery;
  try {
    delivery = await sendSingleReplyTracked(wa, target, reply, sendOptions);
    appendAssistantMessage(lead, reply, delivery);
    Object.assign(lead, extraUpdates(delivery));
  } catch (err) {
    delivery = {
      status: 'failed',
      targetJid: err.targetResolved || null,
      error: err.message,
    };
    appendAssistantMessage(lead, reply, delivery);
  }
  saveLead(leadId, lead);
  return delivery;
}

function touchLeadForIncoming(lead, {
  leadId,
  fullJid,
  replyRoute,
  conversationPhone = null,
  displayNum = null,
  inboundRoute = null,
  pushName = null,
  text = '',
} = {}) {
  lead.number = leadId;
  lead.jid = fullJid;
  lead.replyTargetJid = replyRoute.target;
  lead.replyTargetSource = replyRoute.source;
  rememberLeadContactRoute(lead, { conversationPhone, displayNum, fullJid, inboundRoute });
  if (!lead.name && pushName) lead.name = pushName;
  lead.history = lead.history || [];
  if (text) lead.history.push({ role: 'user', content: text, ts: Date.now() });
  lead.lastInteraction = new Date().toISOString();
  return lead;
}

function applyPendingIntentCorrection(lead, text = '') {
  if (!lead?.pendingOperationalHandoff && !lead?.pendingOperationalEvent) return null;

  const classification = classifyDeterministicIntent(text);
  const normalized = normalizeCustomerText(text);
  const commercialCorrection = classification.mode === 'sales'
    && classification.explicit
    && (
      ['sales_quote', 'sales_price_request', 'sales_consultant_requested'].includes(classification.intent)
      || (/\b(?:cotacao|orcamento|simulacao|proposta)\b/.test(normalized) && classification.intent === 'no_interest')
    );

  if (commercialCorrection) {
    clearPendingOperationalHandoff(lead);
    lead.conversationMode = 'sales';
    lead.status = 'talking';
    lead.stage = 'engaged';
    lead.operationalStatus = null;
    lead.shouldHandoff = false;
    lead.lastIntent = classification.intent;
    lead.lastDetectedIntent = classification.intent;
    delete lead.clientReply;
    return 'sales';
  }

  if (classification.mode === 'operational' && classification.explicit) {
    lead.pendingOperationalHandoff = true;
    lead.pendingOperationalEvent = {
      ...(lead.pendingOperationalEvent || {}),
      type: classification.intent,
      intent: classification.intent,
      lastIntent: classification.intent,
      reason: classification.reason,
      reply: '',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
    };
    lead.lastIntent = classification.intent;
    lead.lastDetectedIntent = classification.intent;
    return 'operational';
  }

  return null;
}

async function handleAwaitingPhonePriority(wa, {
  leadId,
  lead,
  route,
  config,
  fullJid,
  inboundRoute,
  conversationPhone = null,
  displayNum = null,
  pushName = null,
  incomingContent = {},
} = {}) {
  const text = incomingContent.historyText || incomingContent.text || '';
  const correction = applyPendingIntentCorrection(lead, text);
  if (correction === 'sales') {
    saveLead(leadId, lead);
    return false;
  }

  touchLeadForIncoming(lead, {
    leadId,
    fullJid,
    replyRoute: route,
    conversationPhone,
    displayNum,
    inboundRoute,
    pushName,
    text,
  });

  await applyLatestFactsToLead(lead, {
    currentText: text,
    fullJid,
    inboundRoute,
    source: 'phone_extracted_from_user',
  });
  applyCustomerNameFromText(lead, text);

  const pendingOperational = lead.pendingOperationalHandoff || lead.pendingOperationalEvent || lead.conversationMode === 'collections' || lead.status === OPERATIONAL_PENDING_CONTACT_STATUS;
  const pendingOperationalEvent = lead.pendingOperationalEvent || {
    type: lead.lastIntent || 'regularization_request',
    reason: lead.pendingHandoffReason || lead.operationalReason || 'Cliente aguardava encaminhamento operacional.',
  };

  if (pendingOperational && shouldRequireContactBeforeOperationalHandoff(pendingOperationalEvent, lead, config)) {
    lead.status = OPERATIONAL_PENDING_CONTACT_STATUS;
    lead.stage = OPERATIONAL_PENDING_CONTACT_STATUS;
    lead.operationalStatus = OPERATIONAL_PENDING_CONTACT_STATUS;
    saveLead(leadId, lead);
    const reply = isReceiptCorrectionText(text)
      ? buildRecoveryReply(lead, text)
      : buildOperationalContactRequest(lead, pendingOperationalEvent, config);
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      reply,
      () => ({}),
      route.options,
    );
    return true;
  }

  if (!getLeadRealPhone(lead)) {
    lead.status = 'awaiting_phone_for_handoff';
    lead.stage = 'awaiting_phone_for_handoff';
    lead.phoneResolved = false;
    saveLead(leadId, lead);
    const reply = isReceiptCorrectionText(text)
      ? buildRecoveryReply(lead, text)
      : ASK_PHONE_FOR_HANDOFF_FORMAT_REPLY;
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      reply,
      () => ({}),
      route.options,
    );
    return true;
  }

  lead.phoneResolutionSource = 'phone_extracted_from_user';
  saveLead(leadId, lead);

  if (lead.pendingOperationalHandoff || lead.pendingOperationalEvent || lead.conversationMode === 'collections') {
    if (lead.pendingOperationalEvent && !lead.pendingOperationalEvent.shouldNotifyHuman) {
      lead.pendingOperationalEvent = {
        ...lead.pendingOperationalEvent,
        shouldNotifyHuman: true,
        shouldStopAutomation: true,
        reason: lead.pendingOperationalEvent.reason || 'Cliente aguardava encaminhamento operacional.',
      };
    }
    await handlePendingOperationalHandoff(
      wa,
      leadId,
      lead,
      route,
      config,
      {
        text,
        historyText: text,
        phoneJustProvided: true,
        clientConfirmationReply: buildOperationalContactReceivedReply(lead.pendingOperationalEvent),
      },
    );
    return true;
  }

  await handlePendingCommercialHandoff(wa, leadId, lead, route, config, { phoneJustProvided: true });
  return true;
}

async function handlePausedLeadRecovery(wa, {
  leadId,
  lead,
  route,
  fullJid,
  inboundRoute,
  conversationPhone = null,
  displayNum = null,
  pushName = null,
  incomingContent = {},
} = {}) {
  const text = incomingContent.historyText || incomingContent.text || '';
  if (!isReceiptCorrectionText(text) && !isFollowUpNudgeText(text)) return false;

  touchLeadForIncoming(lead, {
    leadId,
    fullJid,
    replyRoute: route,
    conversationPhone,
    displayNum,
    inboundRoute,
    pushName,
    text,
  });
  await applyLatestFactsToLead(lead, {
    currentText: text,
    fullJid,
    inboundRoute,
    source: 'phone_extracted_from_user',
  });

  const reply = buildRecoveryReply(lead, text);
  lead.recoveryReplySentAt = new Date().toISOString();
  saveLead(leadId, lead);
  await persistSimpleReply(wa, leadId, lead, route.target, reply, () => ({}), route.options);
  return true;
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
      clientMessage: buildSalesHandoffClientMessage(lead),
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

async function handlePendingCommercialHandoff(wa, leadId, lead, route, config, options = {}) {
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
      clientMessage: buildSalesHandoffClientMessage(lead, { phoneJustProvided: !!options.phoneJustProvided }),
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
  const shouldNotifyHuman = event.shouldNotifyHuman
    ?? !!(event.shouldHandoff || event.shouldAskPhone || event.conversationMode === 'operational');

  if (!shouldNotifyHuman) {
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      event.reply || buildOperationalReply(event, lead),
      () => ({}),
      route.options,
    );
    return true;
  }

  rememberPendingOperationalHandoff(lead, event);

  if (shouldRequireContactBeforeOperationalHandoff(event, lead, config)) {
    lead.status = OPERATIONAL_PENDING_CONTACT_STATUS;
    lead.stage = OPERATIONAL_PENDING_CONTACT_STATUS;
    lead.phoneResolved = !!getLeadRealPhone(lead);
    lead.operationalStatus = OPERATIONAL_PENDING_CONTACT_STATUS;
    saveLead(leadId, lead);
    await persistSimpleReply(
      wa,
      leadId,
      lead,
      route.target,
      buildOperationalContactRequest(lead, event, config),
      () => ({}),
      route.options,
    );
    return true;
  }

  lead.status = event.status || lead.status || 'awaiting_financial_review';
  lead.stage = event.stage || lead.stage || lead.status;
  lead.operationalStatus = 'handoff_ready';
  refreshOperationalCaseSummary(lead, event, content);
  saveLead(leadId, lead);

  const handoffResult = await executeFinancialHandoff(wa, lead, config, event);
  clearPendingOperationalHandoff(lead);
  const reply = handoffResult.ok
    ? content.clientConfirmationReply || buildOperationalReply(event, lead) || event.reply
    : OPERATIONAL_HANDOFF_FAILED_REPLY;
  const delivery = await persistSimpleReply(
    wa,
    leadId,
    lead,
    route.target,
    reply,
    () => ({}),
    route.options,
  );
  lead.handoffClientConfirmed = handoffResult.ok && delivery?.status !== 'failed';
  if (!lead.handoffClientConfirmed && handoffResult.ok) {
    lead.handoffClientError = delivery?.error || 'Falha ao confirmar o encaminhamento para o cliente.';
  }
  saveLead(leadId, lead);
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
  const inboundLidJid = resolveInboundLidJid(fullJid, inboundRoute);
  const recoveredLead = await recoverLeadWhenCustomerReturns({
    preferredKey: conversationPhone || jidId,
    identifiers: [
      conversationPhone,
      displayNum,
      jidId,
      fullJid,
      fullJidAlt,
      inboundLidJid,
      inboundRoute?.mappedPhone,
      ...(inboundRoute?.phoneCandidates || []),
    ],
  });
  const { leadId, lead: leadFromStore } = recoveredLead
    ? { leadId: recoveredLead.key, lead: recoveredLead.lead }
    : resolveLeadIdentity(jidId, conversationPhone, fullJid);
  const replyRoute = resolveReplyRoute(fullJid, fullJidAlt, conversationPhone, inboundRoute, leadFromStore);
  const incomingContent = extractIncomingContent(rawMsg);
  const text = incomingContent.text;
  const pushName = rawMsg.pushName || null;

  if (incomingContent.isDeleted) {
    console.log(`[Agent] Ignoring deleted/protocol message from ${displayNum} (jid: ${fullJid})`);
    return;
  }

  if (!incomingContent.text) {
    console.log(`[Agent] Ignoring message without text from ${displayNum} (jid: ${fullJid})`);
    return;
  }

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
    console.warn(`[Agent] No API key for "${provider}"; deterministic routing remains active.`);
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
  let collectionsContext = resolveConversationModeContext(config, existingLead, conversationPhone, jidId);

  if (existingLead?.status === 'awaiting_phone_for_handoff' || existingLead?.status === OPERATIONAL_PENDING_CONTACT_STATUS) {
    const handled = await handleAwaitingPhonePriority(wa, {
      leadId,
      lead: existingLead,
      route: replyRoute,
      config,
      fullJid,
      inboundRoute,
      conversationPhone,
      displayNum,
      pushName,
      incomingContent,
    });
    if (handled) return;
    collectionsContext = resolveConversationModeContext(config, existingLead, conversationPhone, jidId);
  }

  if (existingLead && (isOperationalStopStatus(existingLead.status) || shouldPauseSalesLead(existingLead))) {
    const recovered = await handlePausedLeadRecovery(wa, {
      leadId,
      lead: existingLead,
      route: replyRoute,
      fullJid,
      inboundRoute,
      conversationPhone,
      displayNum,
      pushName,
      incomingContent,
    });
    if (recovered) return;
  }

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

  const decision = await makeConversationDecision({
    config,
    text,
    lead: decisionLeadSeed,
    collectionsContext,
    incomingContent,
    skipAI: true,
  });

  if (decision.shouldStopAutomation || decision.shouldHandoff || decision.shouldAskPhone) {
    console.log(`[Agent] Fast-path trigger for ${leadId}: intent=${decision.intent}, handoff=${decision.shouldHandoff}`);
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
    applyDeterministicFactsToLead(lead, buildRecentUserText(lead, incomingContent.historyText, 8));
    applyConversationDecisionToLead(lead, decision, incomingContent);
    saveLead(leadId, lead);

    if (decision.conversationMode === 'operational') {
      await handleOperationalEventAction(
        wa,
        leadId,
        lead,
        replyRoute,
        config,
        decision,
        incomingContent,
      );
      return;
    }

    if (decision.shouldHandoff) {
      try {
        await executeHandoff(wa, lead, config, {
          reason: decision.notes,
          clientMessage: buildSalesHandoffClientMessage(lead),
          clientSendOptions: replyRoute.options,
        });
      } catch (error) {
        markSalesHandoffFailure(lead, error);
        await persistSimpleReply(
          wa,
          leadId,
          lead,
          replyRoute.target,
          getSalesHandoffFailedReply(),
          () => ({ handoffError: error.message }),
          replyRoute.options,
        );
      }
      return;
    }

    const relevantKnowledge = getRelevantKnowledge(decision.intent, incomingContent.historyText, decision.conversationMode);
    const cleanResponse = await buildHumanizedReply(config, {
      mode: decision.conversationMode,
      step: decision.step,
      intent: decision.intent,
      lead,
      latestUserMessage: incomingContent.historyText,
      requiredAction: decision.nextAction,
      allowedQuestion: decision.allowedQuestion,
      relevantKnowledge,
      tone: decision.conversationMode === 'sales' ? 'comercial_leve' : 'operacional'
    });

    console.log(`[Agent] Sending fast-path response to ${replyRoute.target}`);
    let delivery;
    try {
      delivery = await sendHumanized(wa, replyRoute.target, cleanResponse, incomingContent.historyText, false, replyRoute.options || {});
    } catch (err) {
      delivery = {
        status: 'failed',
        messageId: null,
        targetJid: err.targetResolved || null,
        error: err.message,
      };
    }
    appendAssistantMessage(lead, cleanResponse, delivery);
    saveLead(leadId, lead);
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

  const latestFacts = await applyLatestFactsToLead(lead, {
    fullJid,
    inboundRoute: route.options?.inboundRoute || null,
    source: 'phone_extracted_from_user',
  });

  applyCustomerNameFromText(lead, combinedText);

  if (lead.pendingOperationalHandoff || lead.pendingOperationalEvent || lead.status === OPERATIONAL_PENDING_DATA_STATUS || lead.status === OPERATIONAL_PENDING_CONTACT_STATUS) {
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

  const decision = await makeConversationDecision({
    config,
    text: combinedText,
    lead,
    collectionsContext: conversationModeContext,
    incomingContent: { text: combinedText, historyText: combinedText },
  });
  applyConversationDecisionToLead(lead, decision, { text: combinedText, historyText: combinedText });

  // 1. Data extraction if in sales mode (not handed off yet)
  let extraction = { qualified: false };
  if (shouldRunSalesQualification(decision, combinedText, latestFacts)) {
    const qualificationContext = await buildQualificationContext(config, lead, combinedText);
    try {
      const qualificationResult = await callAI(config, qualificationContext, { purpose: 'qualification', mode: 'sales' });
      extraction = detectAndExtract(qualificationResult, lead);
      
      if (extraction.plate) lead.plate = extraction.plate;
      if (extraction.model) lead.model = extraction.model;
      if (extraction.year) lead.year = extraction.year;
      if (extraction.name && extraction.name.length > 1) lead.name = extraction.name;
      if (extraction.profileCaptured) lead.profileCaptured = true;
      if (extraction.phone) {
        lead.phone = extraction.phone;
        lead.displayNumber = extraction.phone;
        lead.phoneResolved = true;
      }
      
      // Update state machine parameters after data extraction
      const updatedPlaybook = getNextSalesStep(lead, combinedText);
      decision.step = updatedPlaybook.step;
      decision.nextAction = updatedPlaybook.requiredAction;
      decision.shouldHandoff = updatedPlaybook.shouldHandoff;
      decision.shouldStopAutomation = updatedPlaybook.shouldStopAutomation;
      decision.allowedQuestion = updatedPlaybook.allowedQuestion;
      decision.missingData = updatedPlaybook.missingData;
      
      applyConversationDecisionToLead(lead, decision, { text: combinedText, historyText: combinedText });
    } catch (err) {
      console.warn('[Agent] Qualification extraction failed:', err.message);
    }
  }

  if (
    decision.conversationMode === 'operational'
    && (decision.shouldHandoff || decision.shouldAskPhone || decision.shouldStopAutomation)
  ) {
    saveLead(leadId, lead);
    await handleOperationalEventAction(
      wa,
      leadId,
      lead,
      route,
      config,
      decision,
      { text: combinedText, historyText: combinedText },
    );
    return;
  }

  if (decision.conversationMode === 'sales' && decision.shouldHandoff) {
    lead.status = 'qualified';
    lead.stage = 'qualified';
    lead.qualifiedAt = new Date().toISOString();
    saveLead(leadId, lead);
    try {
      await executeHandoff(wa, lead, config, {
        reason: decision.notes,
        clientMessage: buildSalesHandoffClientMessage(lead),
        clientSendOptions: route.options,
      });
    } catch (error) {
      markSalesHandoffFailure(lead, error);
      await persistSimpleReply(
        wa,
        leadId,
        lead,
        route.target,
        getSalesHandoffFailedReply(),
        () => ({ handoffError: error.message }),
        route.options,
      );
    }
    return;
  }

  // 2. Fetch relevant knowledge
  const relevantKnowledge = getRelevantKnowledge(decision.intent, combinedText, decision.conversationMode);

  // 3. Generate humanized reply
  const cleanResponse = await buildHumanizedReply(config, {
    mode: decision.conversationMode,
    step: decision.step,
    intent: decision.intent,
    lead,
    latestUserMessage: combinedText,
    requiredAction: decision.nextAction,
    allowedQuestion: decision.allowedQuestion,
    relevantKnowledge,
    tone: decision.conversationMode === 'sales' ? 'comercial_leve' : 'operacional'
  });

  // 4. Send reply
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

  saveLead(leadId, lead);
}
