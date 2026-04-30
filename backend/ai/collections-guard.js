const HUMAN_REPLY = [
  'Entendi. Vou encaminhar seu caso para um atendente humano verificar com cuidado.',
  '',
  'Para evitar informacao errada, vou pausar meu atendimento automatico por aqui.',
].join('\n');

const PAYMENT_CLAIMED_REPLY = [
  'Entendi. Se o pagamento ja foi feito, o correto e o financeiro conferir a baixa antes de qualquer nova orientacao.',
  '',
  'Pode me enviar o comprovante aqui, se ainda nao enviou?',
].join('\n');

const RECEIPT_RECEIVED_REPLY = [
  'Recebi o comprovante. Vou encaminhar para conferencia do financeiro.',
  '',
  'Nao vou te pedir novo pagamento nem revistoria sem validacao interna.',
].join('\n');

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
  'Entendi. Para a revistoria, preciso confirmar alguns dados antes de encaminhar corretamente.',
  '',
  'Pode me informar a placa do veiculo?',
].join('\n');

export const OPERATIONAL_STOP_STATUSES = new Set([
  'human_requested',
  'awaiting_financial_review',
  'receipt_received',
  'app_blocked',
  'billing_disputed',
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

export function extractIncomingContent(rawMsg) {
  const msg = rawMsg?.message || {};
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
  };
}

const HUMAN_REQUEST_PATTERNS = [
  /\bfalar com (um )?(atendente|humano|pessoa)\b/,
  /\bquero (um )?(atendente|humano|pessoa)\b/,
  /\bme passa(r)? para (um )?(atendente|humano|pessoa)\b/,
  /\bnao quero robo\b/,
  /\bsuporte\b/,
  /\balguem pode resolver\b/,
  /\bja falei com outro numero\b/,
  /\bquero cancelar\b/,
  /\bvou reclamar\b/,
  /\bvou denunciar\b/,
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

const RECEIPT_PATTERNS = [
  /\bcomprovante\b/,
  /\brecibo\b/,
  /\bsegue (o )?(comprovante|recibo)\b/,
  /\bmandei (o )?(comprovante|recibo)\b/,
  /\benviei (o )?(comprovante|recibo)\b/,
  /\bja enviei\b/,
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

export function detectOperationalEvent({ text = '', hasAttachment = false, attachmentType = null, collectionsContext = null } = {}) {
  const normalized = normalizeText(text);

  if (matchAny(normalized, HUMAN_REQUEST_PATTERNS)) {
    return makeEvent('human_requested', {
      status: 'human_requested',
      stage: 'human_requested',
      reply: HUMAN_REPLY,
      reason: 'Cliente pediu atendimento humano ou escalacao.',
      lastObjection: 'human_request',
    });
  }

  if (!collectionsContext) return null;

  const hasReceiptLanguage = matchAny(normalized, RECEIPT_PATTERNS);
  if (hasAttachment || hasReceiptLanguage) {
    return makeEvent('receipt_received', {
      status: 'receipt_received',
      reply: RECEIPT_RECEIVED_REPLY,
      reason: hasAttachment
        ? `Cliente enviou anexo em modo cobranca (${attachmentType || 'midia'}).`
        : 'Cliente informou ou mencionou comprovante.',
      paymentClaimed: true,
      receiptReceived: true,
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

  const mentionsInspection = matchAny(normalized, INSPECTION_PATTERNS);
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

  if (matchAny(normalized, PAYMENT_CLAIMED_PATTERNS)) {
    return makeEvent('payment_claimed', {
      status: 'payment_claimed',
      stage: 'payment_claimed',
      reply: PAYMENT_CLAIMED_REPLY,
      reason: 'Cliente informou que o pagamento ja foi feito.',
      shouldNotifyHuman: false,
      shouldStopAutomation: false,
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
      shouldNotifyHuman: false,
      shouldStopAutomation: false,
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
  if (event.receiptReceived) lead.receiptReceived = true;
  if (event.appBlocked) lead.appBlocked = true;
  if (event.billingDisputed) lead.billingDisputed = true;
  if (event.inspectionDisputed) lead.inspectionDisputed = true;
  if (event.inspectionPending) lead.inspectionPending = true;
  if (event.paymentDate) lead.paymentDate = event.paymentDate;
  if (event.paymentAmount) lead.paymentAmount = event.paymentAmount;

  lead.leadSummary = {
    ...existingSummary,
    conversationMode: lead.conversationMode,
    status: lead.status,
    stage: lead.stage,
    reason: event.reason,
    lastUserMessage: content.historyText || content.text || '',
    paymentClaimed: !!lead.paymentClaimed,
    receiptReceived: !!lead.receiptReceived,
    paymentDate: lead.paymentDate || null,
    paymentAmount: lead.paymentAmount || null,
    appBlocked: !!lead.appBlocked,
    billingDisputed: !!lead.billingDisputed,
    inspectionPending: !!lead.inspectionPending,
    inspectionDisputed: !!lead.inspectionDisputed,
    updatedAt: now,
  };

  return lead;
}
