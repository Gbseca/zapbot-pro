import { isValidBrazilPlate, normalizePlate } from './lead-detector.js';

const HUMAN_REPLY = [
  'Entendi. Vou encaminhar seu caso para um atendente humano verificar com cuidado.',
  '',
  'Para evitar informacao errada, vou pausar meu atendimento automatico por aqui.',
].join('\n');

const PAYMENT_CLAIMED_REPLY = [
  'Entendi. Se o pagamento ja foi feito, o consultor precisa conferir a baixa pelo financeiro.',
  '',
  'Vou encaminhar para um consultor verificar e orientar o proximo passo.',
].join('\n');

const RECEIPT_RECEIVED_REPLY = [
  'Recebi o comprovante. Vou encaminhar para conferencia do financeiro.',
  '',
  'Nao vou te pedir novo pagamento nem revistoria sem validacao interna.',
].join('\n');

const RECEIPT_AVAILABLE_REPLY = 'Perfeito. Pode me enviar o comprovante por aqui?';

const WEEKEND_DUE_REPLY = [
  'Voce tem razao em questionar.',
  '',
  'Quando o vencimento cai em fim de semana ou feriado, pode haver ajuste para o proximo dia util. Vou encaminhar para conferencia do financeiro antes de qualquer orientacao sobre pendencia ou revistoria.',
].join('\n');

const APP_BLOCKED_REPLY = [
  'Entendi. Se voce pagou e o app continua bloqueado, pode ser uma atualizacao pendente no sistema.',
  '',
  'Vou encaminhar para o setor responsavel conferir a baixa e a liberacao.',
].join('\n');

const INSPECTION_DISPUTED_REPLY = [
  'Entendi sua reclamacao.',
  '',
  'Se o pagamento nao estava atrasado, a necessidade de revistoria precisa ser conferida antes. Vou encaminhar para validacao humana.',
].join('\n');

const INSPECTION_PENDING_REPLY = [
  'Entendi. Para a revistoria, o ideal e um consultor acompanhar seu caso e confirmar o procedimento correto.',
  '',
  'Pode me passar a placa do veiculo para eu encaminhar certinho?',
].join('\n');

const BOLETO_REQUEST_REPLY = [
  'Entendi. Como boleto e regularizacao dependem de consulta do financeiro, vou encaminhar para um consultor verificar seu caso.',
  '',
  'Para anexar seu contato certinho no encaminhamento, me confirma seu WhatsApp com DDD?',
].join('\n');

const REACTIVATION_REPLY = [
  'Entendi, vou encaminhar para o setor responsavel verificar sua reativacao.',
  '',
  'Me confirma seu nome completo e WhatsApp com DDD?',
].join('\n');

const REGULARIZATION_REPLY = [
  'Entendi. Vou encaminhar para um consultor verificar a melhor forma de regularizar seu caso.',
  '',
  'Para anexar seu contato certinho no encaminhamento, me confirma seu WhatsApp com DDD?',
].join('\n');

const SYSTEM_CHECK_REPLY = [
  'Entendi. Isso depende de consulta interna do cadastro/financeiro.',
  '',
  'Vou encaminhar para um consultor verificar e dar continuidade por aqui.',
].join('\n');

const CANCEL_REQUEST_REPLY = [
  'Entendi. Vou encaminhar seu pedido para um atendente humano verificar com cuidado.',
  '',
  'Para evitar qualquer orientacao errada, vou pausar meu atendimento automatico por aqui.',
].join('\n');

const OPERATIONAL_STOP_STATUSES = new Set([
  'human_requested',
  'awaiting_financial_review',
  'payment_claimed',
  'receipt_received',
  'app_blocked',
  'billing_disputed',
  'inspection_pending',
  'inspection_disputed',
  'transferred_to_financial',
  'transferred_to_support',
  'human_taken_over',
]);

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function extractTextFromMessage(msg = {}) {
  return (
    msg.conversation
    || msg.extendedTextMessage?.text
    || msg.imageMessage?.caption
    || msg.videoMessage?.caption
    || msg.documentMessage?.caption
    || ''
  ).trim();
}

function isDeletedOrProtocolMessage(rawMsg = {}, msg = {}) {
  if (msg.protocolMessage) return true;
  if (rawMsg.messageStubType) {
    const stubText = String(rawMsg.messageStubType || '').toLowerCase();
    if (stubText.includes('revoke') || stubText.includes('delete')) return true;
  }
  return false;
}

export function extractIncomingContent(rawMsg) {
  const msg = rawMsg?.message || {};
  const isDeleted = isDeletedOrProtocolMessage(rawMsg, msg);
  if (isDeleted) {
    return {
      text: '',
      hasAttachment: false,
      attachmentType: null,
      historyText: '',
      isDeleted: true,
    };
  }

  const text = extractTextFromMessage(msg);
  const attachmentType = msg.imageMessage
    ? 'image'
    : msg.documentMessage
      ? 'document'
      : msg.videoMessage
        ? 'video'
        : msg.audioMessage
          ? 'audio'
          : null;

  return {
    text,
    hasAttachment: !!attachmentType,
    attachmentType,
    historyText: text || (attachmentType ? `[${attachmentType} enviado]` : ''),
    isDeleted: false,
  };
}

const HUMAN_REQUEST_PATTERNS = [
  /\bfalar com (um )?(atendente|humano|pessoa)\b/,
  /\bquero (um )?(atendente|humano|pessoa)\b/,
  /\bme passa(r)? para (um )?(atendente|humano|pessoa)\b/,
  /\bfalar com (um )?(consultor|vendedor|representante|comercial|especialista)\b/,
  /\bquero (um )?(consultor|vendedor|representante|comercial|especialista)\b/,
  /\bme passa(r)? para (um )?(consultor|vendedor|representante|comercial|especialista)\b/,
  /\bnao quero robo\b/,
  /\bsuporte\b/,
  /\balguem pode resolver\b/,
  /\bja falei com outro numero\b/,
  /\bquero cancelar\b/,
  /\bvou reclamar\b/,
  /\bvou denunciar\b/,
];

const CANCEL_REQUEST_PATTERNS = [
  /\bquero cancelar\b/,
  /\bcancelar\b/,
  /\bcancelamento\b/,
  /\bencerrar contrato\b/,
];

const PAYMENT_CLAIMED_PATTERNS = [
  /\bja paguei\b/,
  /\bpaguei\b/,
  /\bfoi pago\b/,
  /\besta pago\b/,
  /\btava pago\b/,
  /\bpagamento feito\b/,
  /\bpaguei via pix\b/,
  /\bpago desde\b/,
  /\bquitei\b/,
];

const RECEIPT_AVAILABLE_PATTERNS = [
  /\btenho (o )?(comprovante|recibo)\b/,
  /\bestou com (o )?(comprovante|recibo)\b/,
  /\bcomprovante eu tenho\b/,
  /\bposso mandar (o )?(comprovante|recibo)\b/,
  /\bvou enviar (o )?(comprovante|recibo)\b/,
  /\bvou mandar (o )?(comprovante|recibo)\b/,
  /\bquer que eu mande (o )?(comprovante|recibo)\b/,
  /\btenho como comprovar\b/,
];

const RECEIPT_MENTION_PATTERNS = [
  /\bcomprovante\b/,
  /\brecibo\b/,
  /\bmandei (o )?(comprovante|recibo)\b/,
  /\benviei (o )?(comprovante|recibo)\b/,
  /\bja enviei\b/,
  /\bsegue (o )?(comprovante|recibo)\b/,
  /\besta anex(o|ado)\b/,
];

const BILLING_DISPUTE_PATTERNS = [
  /\bnao esta atrasad[ao]\b/,
  /\bnao estou atrasad[ao]\b/,
  /\bainda nao venceu\b/,
  /\bnao venceu\b/,
  /\bvenc(e|imento) (caiu|foi) (no )?(sabado|domingo|feriado)\b/,
  /\bproximo dia util\b/,
  /\bsabado\b/,
  /\bdomingo\b/,
  /\bferiado\b/,
  /\bisso esta errado\b/,
  /\bcobranca errada\b/,
];

const BOLETO_REQUEST_PATTERNS = [
  /\bboleto pendente\b/,
  /\btratar (um )?boleto\b/,
  /\bquero (o )?boleto\b/,
  /\bquero pagar (o )?boleto\b/,
  /\bpagar (o )?boleto\b/,
  /\bpreciso (do|de um|da) boleto\b/,
  /\bme manda (o )?boleto\b/,
  /\bme envia (o )?boleto\b/,
  /\benvie (meu|o )?boleto\b/,
  /\bver (meu |o |os )?boleto(s)?\b/,
  /\bconsultar (meu |o |os )?boleto(s)?\b/,
  /\breenviar (o )?boleto\b/,
  /\bsegunda via\b/,
  /\bgerar boleto\b/,
  /\bmandar boleto\b/,
];

const REGULARIZATION_PATTERNS = [
  /\bquero regularizar\b/,
  /\bquero pagar\b/,
  /\bpreciso pagar\b/,
  /\bregularizar\b/,
  /\bnegociar\b/,
  /\bacordo\b/,
  /\bcomo pago\b/,
  /\bcomo faco para pagar\b/,
];

const REACTIVATION_PATTERNS = [
  /\breativar (minha |a )?protecao\b/,
  /\bquero reativar\b/,
  /\breativacao\b/,
  /\bprote[cç][aã]o suspensa\b/,
  /\bminha protecao (esta|ta|foi) suspensa\b/,
  /\bvoltar com (a )?protecao\b/,
  /\bliberar (minha |a )?protecao\b/,
];

const SYSTEM_CHECK_PATTERNS = [
  /\bverificar (meu )?(cadastro|contrato|pendencia|situacao)\b/,
  /\bconsultar (meu )?(cadastro|contrato|pendencia|situacao)\b/,
  /\btem pendencia\b/,
  /\bpendencia(s)?\b/,
  /\bpendente\b/,
  /\bbaixa\b/,
  /\bliberacao\b/,
  /\bliberar\b/,
  /\bfinanceiro\b/,
  /\bmeu cadastro\b/,
];

const APP_BLOCKED_PATTERNS = [
  /\bapp bloquead[ao]\b/,
  /\bapp .*bloquead[ao]\b/,
  /\baplicativo bloquead[ao]\b/,
  /\baplicativo .*bloquead[ao]\b/,
  /\bmeu app nao (abre|entra|funciona)\b/,
  /\bnao consigo acessar (o )?app\b/,
  /\bliberar (o )?app\b/,
];

const INSPECTION_PATTERNS = [
  /\brevistoria\b/,
  /\bvistoria\b/,
];

const INSPECTION_DISPUTE_HINTS = [
  /\bnao (tem|tenho|precisa|preciso)\b/,
  /\bpor que\b/,
  /\bpq\b/,
  /\berrad[ao]\b/,
  /\bindevid[ao]\b/,
  /\bquestion/,
  /\breclama/,
];

const INSPECTION_PROGRESS_HINTS = [
  /\bquero fazer\b/,
  /\bcomo faco\b/,
  /\bpreciso fazer\b/,
  /\bja fiz\b/,
  /\bnao consigo\b/,
  /\bcodigo\b/,
  /\bmandei (o )?(video|foto|arquivo)\b/,
  /\benviei (o )?(video|foto|arquivo)\b/,
  /\bvideo\b/,
  /\bfoto\b/,
];

function extractPlate(text = '') {
  const tokens = String(text || '').match(/\b[A-Za-z]{3}[-\s]?\d[A-Za-z0-9][-\s]?\d{2}\b/g) || [];
  for (const token of tokens) {
    if (isValidBrazilPlate(token)) return normalizePlate(token);
  }
  return null;
}

function extractPaymentAmount(text = '') {
  const match = String(text).match(/(?:r\$\s*)?\b\d{1,5}(?:[,.]\d{2})\b/i);
  return match ? match[0].trim() : null;
}

function extractPaymentDate(text = '') {
  const normalized = normalizeText(text);
  const keywordMatch = normalized.match(/\b(hoje|ontem|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/);
  if (keywordMatch) return keywordMatch[1];
  const dateMatch = String(text).match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);
  return dateMatch ? dateMatch[0] : null;
}

function hasClearReceiptData(text = '') {
  const normalized = normalizeText(text);
  const amount = extractPaymentAmount(text);
  const date = extractPaymentDate(text);
  const transactionHint = matchAny(normalized, [
    /\b(id|codigo|cod|autenticacao|transacao|protocolo|comprovante|e2e)\b/,
    /\bpix\b/,
  ]);
  const longIdentifier = /\b[A-Z0-9]{8,}\b/i.test(String(text || '').replace(/\s+/g, ' '));
  return !!(amount && date && (transactionHint || longIdentifier));
}

function makeEvent(type, overrides = {}) {
  const base = {
    type,
    status: type,
    stage: 'awaiting_financial_review',
    reply: '',
    reason: '',
    shouldNotifyHuman: true,
    shouldStopAutomation: true,
    lastIntent: type,
    lastObjection: null,
  };
  return { ...base, ...overrides };
}

export function isOperationalStopStatus(status) {
  return OPERATIONAL_STOP_STATUSES.has(status);
}

function hasStandaloneOperationalIntent(normalized = '') {
  return [
    REACTIVATION_PATTERNS,
    BOLETO_REQUEST_PATTERNS,
    REGULARIZATION_PATTERNS,
    SYSTEM_CHECK_PATTERNS,
    APP_BLOCKED_PATTERNS,
    PAYMENT_CLAIMED_PATTERNS,
    RECEIPT_AVAILABLE_PATTERNS,
    RECEIPT_MENTION_PATTERNS,
    BILLING_DISPUTE_PATTERNS,
  ].some((patterns) => matchAny(normalized, patterns));
}

export function detectOperationalEvent({ text = '', hasAttachment = false, attachmentType = null, collectionsContext = null } = {}) {
  const normalized = normalizeText(text);
  const mentionsInspection = matchAny(normalized, INSPECTION_PATTERNS);

  if (matchAny(normalized, CANCEL_REQUEST_PATTERNS)) {
    return makeEvent('cancel_request', {
      status: 'human_requested',
      stage: 'human_requested',
      reply: CANCEL_REQUEST_REPLY,
      reason: 'Cliente pediu cancelamento ou encerramento.',
      lastObjection: 'cancel_request',
    });
  }

  if (matchAny(normalized, HUMAN_REQUEST_PATTERNS)) {
    return makeEvent('human_requested', {
      status: 'human_requested',
      stage: 'human_requested',
      reply: HUMAN_REPLY,
      reason: 'Cliente pediu atendimento humano ou escalacao.',
      lastObjection: 'human_request',
    });
  }

  if (!collectionsContext && !hasStandaloneOperationalIntent(normalized)) return null;

  if (mentionsInspection && (hasAttachment || matchAny(normalized, INSPECTION_PROGRESS_HINTS))) {
    return makeEvent('inspection_pending', {
      status: 'inspection_pending',
      stage: 'inspection_pending',
      reply: hasAttachment
        ? 'Recebi. Vou encaminhar para um consultor acompanhar sua revistoria e dar continuidade por aqui.'
        : INSPECTION_PENDING_REPLY,
      reason: hasAttachment
        ? `Cliente enviou midia/anexo em conversa de revistoria (${attachmentType || 'midia'}).`
        : 'Cliente pediu orientacao ou acompanhamento de revistoria.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      inspectionPending: true,
      inspectionMediaSent: hasAttachment || matchAny(normalized, [/\bvideo\b/, /\bfoto\b/]),
      inspectionCodeMentioned: matchAny(normalized, [/\bcodigo\b/]),
    });
  }

  const hasReceiptEvidence = hasAttachment || hasClearReceiptData(text);
  if (hasReceiptEvidence) {
    return makeEvent('receipt_received', {
      status: 'receipt_received',
      reply: RECEIPT_RECEIVED_REPLY,
      reason: hasAttachment
        ? `Cliente enviou anexo em modo cobranca (${attachmentType || 'midia'}).`
        : 'Cliente enviou dados claros de comprovante.',
      paymentClaimed: true,
      receiptReceived: true,
    });
  }

  if (matchAny(normalized, RECEIPT_AVAILABLE_PATTERNS) || matchAny(normalized, RECEIPT_MENTION_PATTERNS)) {
    return makeEvent('receipt_available', {
      status: 'awaiting_financial_review',
      stage: 'awaiting_financial_review',
      reply: 'Perfeito. Vou encaminhar para um consultor orientar o envio do comprovante e continuar seu atendimento.',
      reason: 'Cliente informou que tem comprovante, mas ainda nao enviou anexo ou dados suficientes.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      lastIntent: 'receipt_available',
      paymentClaimed: true,
      receiptAvailable: true,
    });
  }

  if (matchAny(normalized, APP_BLOCKED_PATTERNS)) {
    return makeEvent('app_blocked', {
      status: 'app_blocked',
      reply: APP_BLOCKED_REPLY,
      reason: 'Cliente relatou aplicativo bloqueado ou sem acesso.',
      appBlocked: true,
      lastObjection: 'app_blocked',
    });
  }

  if (mentionsInspection && matchAny(normalized, INSPECTION_DISPUTE_HINTS)) {
    return makeEvent('inspection_disputed', {
      status: 'inspection_disputed',
      reply: INSPECTION_DISPUTED_REPLY,
      reason: 'Cliente contestou a necessidade de revistoria.',
      inspectionDisputed: true,
      lastObjection: 'inspection_disputed',
    });
  }

  if (matchAny(normalized, BILLING_DISPUTE_PATTERNS)) {
    return makeEvent('billing_disputed', {
      status: 'billing_disputed',
      reply: WEEKEND_DUE_REPLY,
      reason: 'Cliente contestou vencimento, atraso, fim de semana ou feriado.',
      billingDisputed: true,
      lastObjection: 'billing_disputed',
    });
  }

  if (matchAny(normalized, BOLETO_REQUEST_PATTERNS)) {
    return makeEvent('boleto_request', {
      status: 'awaiting_financial_review',
      stage: 'awaiting_financial_review',
      reply: BOLETO_REQUEST_REPLY,
      reason: 'Cliente pediu boleto, segunda via ou reenvio de cobranca.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      lastIntent: 'boleto_request',
    });
  }

  if (matchAny(normalized, REACTIVATION_PATTERNS)) {
    return makeEvent('reactivation_request', {
      status: 'awaiting_financial_review',
      stage: 'awaiting_financial_review',
      reply: REACTIVATION_REPLY,
      reason: 'Cliente pediu reativacao da protecao ou informou protecao suspensa.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      lastIntent: 'reactivation_request',
    });
  }

  if (matchAny(normalized, REGULARIZATION_PATTERNS)) {
    return makeEvent('regularization_request', {
      status: 'awaiting_financial_review',
      stage: 'awaiting_financial_review',
      reply: REGULARIZATION_REPLY,
      reason: 'Cliente pediu regularizacao, negociacao ou acordo.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      lastIntent: 'regularization_request',
    });
  }

  if (matchAny(normalized, SYSTEM_CHECK_PATTERNS)) {
    return makeEvent('system_check_request', {
      status: 'awaiting_financial_review',
      stage: 'awaiting_financial_review',
      reply: SYSTEM_CHECK_REPLY,
      reason: 'Cliente pediu verificacao que depende de cadastro, financeiro ou sistema interno.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      lastIntent: 'system_check_request',
    });
  }

  if (matchAny(normalized, PAYMENT_CLAIMED_PATTERNS)) {
    return makeEvent('payment_claimed', {
      status: 'awaiting_financial_review',
      stage: 'awaiting_financial_review',
      reply: PAYMENT_CLAIMED_REPLY,
      reason: 'Cliente informou que o pagamento ja foi feito.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      lastIntent: 'payment_claimed',
      paymentClaimed: true,
      paymentDate: extractPaymentDate(text),
      paymentAmount: extractPaymentAmount(text),
    });
  }

  if (mentionsInspection) {
    return makeEvent('inspection_pending', {
      status: 'inspection_pending',
      stage: 'inspection_pending',
      reply: INSPECTION_PENDING_REPLY,
      reason: 'Conversa de cobranca menciona revistoria sem contestacao clara.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      inspectionPending: true,
    });
  }

  return null;
}

export function applyOperationalEventToLead(lead, event, content = {}) {
  const now = new Date().toISOString();
  const existingSummary = typeof lead.leadSummary === 'object' && lead.leadSummary
    ? lead.leadSummary
    : {};

  lead.status = event.status;
  lead.stage = event.stage || event.status;
  lead.conversationMode = event.conversationMode || lead.conversationMode || 'collections';
  lead.lastIntent = event.lastIntent || event.type;
  lead.lastObjection = event.lastObjection || lead.lastObjection || null;
  lead.operationalReason = event.reason;
  lead.lastOperationalEventAt = now;

  if (event.paymentClaimed) lead.paymentClaimed = true;
  if (event.receiptAvailable) lead.receiptAvailable = true;
  if (event.receiptReceived) lead.receiptReceived = true;
  if (event.appBlocked) lead.appBlocked = true;
  if (event.billingDisputed) lead.billingDisputed = true;
  if (event.inspectionDisputed) lead.inspectionDisputed = true;
  if (event.inspectionPending) lead.inspectionPending = true;
  if (event.inspectionMediaSent) lead.inspectionMediaSent = true;
  if (event.inspectionCodeMentioned) lead.inspectionCodeMentioned = true;
  if (event.paymentDate) lead.paymentDate = event.paymentDate;
  if (event.paymentAmount) lead.paymentAmount = event.paymentAmount;
  const detectedPlate = extractPlate(content.historyText || content.text || '');
  if (detectedPlate && !lead.plate) lead.plate = detectedPlate;

  lead.leadSummary = {
    ...existingSummary,
    conversationMode: lead.conversationMode,
    status: lead.status,
    stage: lead.stage,
    reason: event.reason,
    lastUserMessage: content.historyText || content.text || '',
    paymentClaimed: !!lead.paymentClaimed,
    receiptAvailable: !!lead.receiptAvailable,
    receiptReceived: !!lead.receiptReceived,
    paymentDate: lead.paymentDate || null,
    paymentAmount: lead.paymentAmount || null,
    appBlocked: !!lead.appBlocked,
    billingDisputed: !!lead.billingDisputed,
    inspectionPending: !!lead.inspectionPending,
    inspectionDisputed: !!lead.inspectionDisputed,
    inspectionMediaSent: !!lead.inspectionMediaSent,
    inspectionCodeMentioned: !!lead.inspectionCodeMentioned,
    updatedAt: now,
  };

  return lead;
}
