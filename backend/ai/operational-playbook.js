import { isValidBrazilPlate, normalizePlate } from './lead-detector.js';

// Text normalizer helper
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

// Check emotion - irritation count
function detectEmotion(text = '') {
  const normalized = normalizeText(text);
  const raw = String(text || '');
  const exclamationCount = (raw.match(/!/g) || []).length;
  
  const angry = matchAny(normalized, [
    /\bvou denunciar\b/,
    /\bvou reclamar\b/,
    /\bprocon\b/,
    /\babsurdo\b/,
    /\bnao quero robo\b/,
    /\bisso esta errado\b/,
    /\bsegunda vez\b/,
    /\bvoces ficam\b/,
    /\bparar de mandar\b/,
    /\bpara de mandar\b/
  ]);

  if (angry || exclamationCount >= 3) return 'angry';
  return 'neutral';
}

// Patterns mapped to operational events
const BOLETO_PATTERNS = [
  /\bboleto\b/,
  /\bsegunda via\b/,
  /\bgerar boleto\b/,
  /\bcodigo pix\b/,
  /\bcodigo de barras\b/,
  /\bchave pix\b/
];

const REGULARIZATION_PATTERNS = [
  /\bregularizar\b/,
  /\bpendencia\b/,
  /\bpendente\b/,
  /\bacordo\b/,
  /\bnegociar\b/,
  /\bquitar\b/,
  /\bresolver (minha |meu |a |o |uma |um )?(pendencia|inadimplencia|debito|divida|boleto|cobranca)\b/,
  /\bdevo\b/,
  /\bdebito\b/,
  /\bdivida\b/,
  /\bcobranca\b/,
  /\batraso\b/,
  /\batrasad[ao]\b/,
  /\binadimplencia\b/,
  /\binadimplente\b/
];

const PAYMENT_CLAIMED_PATTERNS = [
  /\bja paguei\b/,
  /\bpaguei\b/,
  /\bfoi pago\b/,
  /\besta pago\b/,
  /\btava pago\b/,
  /\bpagamento feito\b/,
  /\bpaguei via pix\b/
];

const RECEIPT_PATTERNS = [
  /\bcomprovante\b/,
  /\brecibo\b/,
  /\bmandei\b/,
  /\benviei\b/
];

const REACTIVATION_PATTERNS = [
  /\breativar\b/,
  /\breativacao\b/,
  /\bprote[cç][aã]o suspensa\b/,
  /\bsuspensa\b/,
  /\breativa (a )?protecao\b/
];

const APP_BLOCKED_PATTERNS = [
  /\bapp bloquead[ao]\b/,
  /\bapp .*bloquead[ao]\b/,
  /\baplicativo bloquead[ao]\b/,
  /\baplicativo .*bloquead[ao]\b/,
  /\bmeu app nao\b/,
  /\bnao consigo acessar (o )?(app|aplicativo)\b/
];

const CANCEL_PATTERNS = [
  /\bcancelar\b/,
  /\bcancelamento\b/,
  /\bencerrar contrato\b/
];

const BILLING_DISPUTE_PATTERNS = [
  /\bnao esta atrasad[ao]\b/,
  /\bnao estou atrasad[ao]\b/,
  /\bainda nao venceu\b/,
  /\bnao venceu\b/,
  /\bvencimento errado\b/,
  /\bcobranca errada\b/,
  /\bisso esta errado\b/
];

const INSPECTION_PATTERNS = [
  /\brevistoria\b/,
  /\bvistoria\b/
];

const HUMAN_PATTERNS = [
  /\bfalar com (um )?(atendente|humano|pessoa|consultor)\b/,
  /\bquero (um )?(atendente|humano|pessoa|consultor)\b/,
  /\bme passa(r)? para (um )?(atendente|humano|pessoa|consultor)\b/,
  /\bhumano\b/,
  /\batendente\b/,
  /\bconsultor\b/,
  /\batendimento humano\b/,
  /\bquero falar com alguem\b/,
  /\bnao quero robo\b/,
  /\bsuporte\b/,
  /\bpreciso (de )?ajuda\b/,
  /\btenho (um )?problema\b/,
  /\bestou com (um )?problema\b/,
  /\bquero resolver (uma )?(coisa|questao|situacao|problema|caso)\b/,
  /\bpreciso resolver (uma )?(coisa|questao|situacao|problema|caso)\b/
];

function buildResolvedHumanReply(handoffDepartment) {
  if (handoffDepartment === 'support') {
    return 'Entendi. Vou encaminhar seu atendimento para o suporte continuar por aqui.';
  }
  if (handoffDepartment === 'financial') {
    return 'Entendi. Vou encaminhar seu atendimento para o financeiro continuar por aqui.';
  }
  return 'Entendi. Vou chamar uma pessoa para continuar seu atendimento por aqui.';
}

export function getNextOperationalStep(lead, text, incomingContent = {}) {
  const normalized = normalizeText(text);
  const emotion = detectEmotion(text);
  const hasAttachment = !!incomingContent.hasAttachment;

  // 1. Detect Specific Operational Intent
  let intent = 'general_question';
  let handoffDepartment = 'financial';

  if (matchAny(normalized, CANCEL_PATTERNS)) {
    intent = 'cancel_request';
    handoffDepartment = 'consultant';
  } else if (matchAny(normalized, HUMAN_PATTERNS)) {
    intent = 'human_requested';
    handoffDepartment = 'consultant';
  } else if (emotion === 'angry') {
    intent = 'angry_customer';
    handoffDepartment = 'consultant';
  } else if (hasAttachment || matchAny(normalized, RECEIPT_PATTERNS)) {
    intent = 'receipt_received';
    handoffDepartment = 'financial';
  } else if (matchAny(normalized, PAYMENT_CLAIMED_PATTERNS)) {
    intent = 'payment_claimed';
    handoffDepartment = 'financial';
  } else if (matchAny(normalized, APP_BLOCKED_PATTERNS)) {
    intent = 'app_blocked';
    handoffDepartment = 'support';
  } else if (matchAny(normalized, BILLING_DISPUTE_PATTERNS)) {
    intent = 'billing_disputed';
    handoffDepartment = 'financial';
  } else if (matchAny(normalized, INSPECTION_PATTERNS)) {
    intent = 'inspection_pending';
    handoffDepartment = 'support';
  } else if (matchAny(normalized, BOLETO_PATTERNS)) {
    intent = 'boleto_request';
    handoffDepartment = 'financial';
  } else if (matchAny(normalized, REGULARIZATION_PATTERNS)) {
    intent = 'regularization_request';
    handoffDepartment = 'financial';
  } else if (matchAny(normalized, REACTIVATION_PATTERNS)) {
    intent = 'reactivation_request';
    handoffDepartment = 'financial';
  }

  // 2. Check if phone is resolved
  const isPhoneResolved = !!(lead.phone && lead.phone.length >= 10) || !!(lead.displayNumber && lead.displayNumber.length >= 10);

  // 3. Operational rules: operational cases go to human review only.
  let requiredAction = isPhoneResolved ? 'execute_handoff' : 'ask_phone_ddd';
  let shouldAskPhone = !isPhoneResolved;
  let shouldHandoff = isPhoneResolved;
  let shouldStopAutomation = isPhoneResolved;
  let clientReply = isPhoneResolved
    ? buildResolvedHumanReply(handoffDepartment)
    : 'Entendi. Vou chamar uma pessoa do setor responsavel para continuar. Me confirma seu WhatsApp com DDD?';
  let reason = `Atendimento operacional do tipo ${intent}.`;

  // Define client replies template / suggestions (will be finalized/humanized by reply builder if needed, or sent directly)
  if (intent === 'boleto_request') {
    clientReply = isPhoneResolved 
      ? 'Entendi. Vou encaminhar o pedido do seu boleto/segunda via para o setor financeiro confirmar os detalhes.'
      : 'Claro, eu te ajudo com isso. Pra encaminhar certinho pro consultor, me confirma seu WhatsApp com DDD?';
  } else if (intent === 'payment_claimed') {
    clientReply = isPhoneResolved
      ? 'Entendi. Vou encaminhar para a conferência do financeiro conferir a baixa.'
      : 'Entendi. Pra evitar informação errada, vou encaminhar pra conferência do setor responsável. Me confirma seu WhatsApp com DDD?';
  } else if (intent === 'receipt_received') {
    clientReply = isPhoneResolved
      ? 'Comprovante recebido. Vou passar para o financeiro fazer a conferência da baixa.'
      : 'Obrigado pelo comprovante. Me confirma seu WhatsApp com DDD para eu encaminhar ao financeiro?';
  } else if (intent === 'app_blocked') {
    clientReply = isPhoneResolved
      ? 'Entendi. Isso do aplicativo bloqueado precisa ser verificado pelo nosso suporte técnico.'
      : 'Entendi. Isso precisa ser conferido pelo suporte/financeiro. Me confirma seu WhatsApp com DDD pra eu encaminhar certinho?';
  } else if (intent === 'cancel_request') {
    clientReply = isPhoneResolved
      ? 'Entendi. Vou encaminhar seu pedido de cancelamento para um atendente responsável verificar com cuidado.'
      : 'Entendi. Cancelamento precisa ser tratado com um consultor responsável. Me confirma seu WhatsApp com DDD pra eu encaminhar?';
  } else if (intent === 'billing_disputed') {
    clientReply = isPhoneResolved
      ? 'Compreendo a contestação. Vou passar os detalhes para conferência do setor financeiro analisar.'
      : 'Entendi. Vou encaminhar essa contestação de valores para o financeiro analisar. Me passa seu WhatsApp com DDD?';
  } else if (intent === 'reactivation_request') {
    clientReply = isPhoneResolved
      ? 'Certo, solicitação de reativação identificada. Vou encaminhar para o consultor financeiro responsável.'
      : 'Vou encaminhar o pedido de reativação para o financeiro. Me passa seu WhatsApp com DDD?';
  } else if (intent === 'angry_customer' || intent === 'human_requested') {
    clientReply = isPhoneResolved
      ? 'Entendido. Estou pausando o atendimento do robô e passando para um atendente humano continuar por aqui.'
      : 'Entendi. Vou te passar para um atendente humano continuar o atendimento. Me confirma seu WhatsApp com DDD?';
  } else {
    // Default fallback operational
    clientReply = isPhoneResolved
      ? 'Entendi. Vou passar seu atendimento operacional para o consultor responsável.'
      : 'Entendi. Pra eu encaminhar pro consultor do setor correto, me confirma seu WhatsApp com DDD?';
  }

  clientReply = isPhoneResolved
    ? buildResolvedHumanReply(handoffDepartment)
    : 'Entendi. Vou chamar uma pessoa do setor responsavel para continuar. Me confirma seu WhatsApp com DDD?';

  // Irritated client rule: remove emojis (handled in clientReply formatting or reply-builder)
  return {
    mode: 'operational',
    step: 'human_handoff',
    intent,
    requiredAction,
    shouldAskPhone,
    shouldHandoff,
    handoffDepartment,
    shouldStopAutomation,
    clientReply,
    reason
  };
}
