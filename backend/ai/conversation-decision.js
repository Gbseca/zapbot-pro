import {
  applyOperationalEventToLead,
  detectOperationalEvent,
} from './collections-guard.js';

const HIGH_RISK_REPLY = 'Entendi sua reclamacao. Vou encaminhar para um atendente humano verificar seu caso com cuidado.';
const ANGRY_PAYMENT_REPLY = [
  'Entendi. Voce informou que ja pagou.',
  '',
  'Para evitar informacao errada, vou encaminhar para o financeiro conferir a baixa e pausar meu atendimento automatico por aqui.',
].join('\n');

const COLLECTIONS_STATUSES = new Set([
  'awaiting_financial_review',
  'payment_claimed',
  'receipt_received',
  'inspection_pending',
  'inspection_disputed',
  'app_blocked',
  'billing_disputed',
  'transferred_to_financial',
  'transferred_to_support',
  'human_requested',
]);

const HUMAN_STOP_STATUSES = new Set([
  'human_requested',
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

function hasPlate(text = '') {
  return /\b[A-Z]{3}\d[A-Z0-9]\d{2}\b/i.test(text);
}

function hasYear(text = '') {
  return /\b(19[8-9]\d|20[0-3]\d)\b/.test(text);
}

function hasVehicleHint(text = '') {
  return matchAny(normalizeText(text), [
    /\b(onix|gol|hb20|corolla|civic|palio|uno|strada|saveiro|hilux|s10|fox|ka|argo|kwid|renegade|compass)\b/,
    /\b(carro|moto|veiculo|caminhonete)\b/,
  ]);
}

function detectEmotion(text = '') {
  const raw = String(text || '');
  const normalized = normalizeText(raw);
  const letters = raw.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upperLetters = letters.replace(/[^A-ZÀ-Ý]/g, '');
  const upperRatio = letters.length >= 12 ? upperLetters.length / letters.length : 0;
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
  ]);

  const irritated = angry || upperRatio > 0.65 || exclamationCount >= 3 || matchAny(normalized, [
    /\bja falei\b/,
    /\bja mandei\b/,
    /\bnao tem porque\b/,
    /\bnao faz sentido\b/,
    /\bde novo\b/,
  ]);

  if (angry || (upperRatio > 0.8 && exclamationCount >= 1)) return 'angry';
  if (irritated) return 'irritated';
  if (matchAny(normalized, [/\bnao entendi\b/, /\bque mensagem\b/, /\bqual motivo\b/, /\bpor que\b/, /\bpq\b/])) {
    return 'confused';
  }
  return 'neutral';
}

function isCollectionsLike(lead = {}, collectionsContext = null) {
  return Boolean(
    collectionsContext
    || lead.conversationMode === 'collections'
    || COLLECTIONS_STATUSES.has(lead.status)
  );
}

function inferConversationMode(text, lead = {}, collectionsContext = null) {
  const normalized = normalizeText(text);
  if (isCollectionsLike(lead, collectionsContext)) return 'collections';
  if (matchAny(normalized, [
    /\bja paguei\b/,
    /\bpaguei\b/,
    /\bfoi pago\b/,
    /\besta pago\b/,
    /\bpagamento feito\b/,
    /\bpago desde\b/,
    /\bquitei\b/,
    /\bcomprovante\b/,
    /\brecibo\b/,
    /\bboleto\b/,
    /\bsegunda via\b/,
    /\bgerar boleto\b/,
    /\breenviar boleto\b/,
    /\bvencimento\b/,
    /\bregularizar\b/,
    /\bnegociar\b/,
    /\bacordo\b/,
    /\bcadastro\b/,
    /\bpendencia\b/,
    /\bfinanceiro\b/,
    /\bbaixa\b/,
    /\bliberacao\b/,
    /\bapp .*bloquead[ao]\b/,
    /\bapp bloquead[ao]\b/,
    /\baplicativo .*bloquead[ao]\b/,
    /\baplicativo bloquead[ao]\b/,
  ])) return 'collections';
  if (matchAny(normalized, [/\brevistoria\b/, /\bvistoria\b/])) return 'inspection';
  if (HUMAN_STOP_STATUSES.has(lead.status)) return 'support';
  return 'sales';
}

function mapOperationalIntent(type) {
  const map = {
    human_requested: 'human_requested',
    payment_claimed: 'billing_payment_claimed',
    receipt_received: 'billing_receipt_sent',
    billing_disputed: 'billing_due_date_dispute',
    app_blocked: 'billing_app_blocked',
    boleto_request: 'boleto_request',
    regularization_request: 'regularization_request',
    system_check_request: 'system_check_request',
    inspection_pending: 'inspection_requested',
    inspection_disputed: 'inspection_disputed',
    angry_customer: 'angry_customer',
    cancel_request: 'cancel_request',
  };
  return map[type] || 'general_question';
}

function actionForEvent(event, conversationMode) {
  if (!event) return 'reply';
  if (event.type === 'human_requested' || event.type === 'angry_customer' || event.type === 'cancel_request') {
    return 'handoff_support';
  }
  if (event.type === 'inspection_disputed' || event.type === 'inspection_pending' || event.type === 'app_blocked') return 'handoff_support';
  if (event.shouldNotifyHuman) return conversationMode === 'sales' ? 'handoff_support' : 'handoff_financial';
  return 'reply';
}

function forbiddenActionsFor(intent, emotion, conversationMode) {
  const actions = new Set();
  if (conversationMode !== 'sales') {
    actions.add('nao_vender_cotacao');
    actions.add('nao_pedir_modelo_ano_sem_necessidade');
    actions.add('nao_prometer_baixa_pagamento');
    actions.add('nao_prometer_liberar_app');
    actions.add('nao_dizer_que_verificou_sistema');
  }
  if (intent.includes('payment') || intent.includes('receipt') || intent.includes('billing')) {
    actions.add('nao_cobrar_novamente');
    actions.add('nao_pedir_revistoria_sem_validacao');
  }
  if (intent.includes('inspection')) {
    actions.add('nao_forcar_revistoria_se_houver_contestacao');
  }
  if (emotion === 'irritated' || emotion === 'angry') {
    actions.add('sem_emoji');
    actions.add('resposta_curta');
    actions.add('nao_discutir_com_cliente');
    actions.add('nao_fazer_pergunta_desnecessaria');
  }
  return [...actions];
}

function missingDataFor(intent, conversationMode, lead = {}, text = '') {
  const missing = [];
  if (conversationMode === 'sales') {
    if (!lead.plate && !hasPlate(text)) missing.push('plate');
    if (!lead.model && !hasVehicleHint(text)) missing.push('model');
    if (!lead.year && !hasYear(text)) missing.push('year');
    return missing;
  }

  if (intent === 'billing_payment_claimed' && !lead.receiptReceived) missing.push('receipt');
  if (intent === 'inspection_requested' && !lead.inspectionCodeMentioned) missing.push('inspection_code_or_video_status');
  if (!lead.plate && !lead.receiptReceived && !hasPlate(text)) missing.push('plate');
  return missing;
}

function inferIntent(text, conversationMode, lead = {}, collectionsContext = null) {
  const normalized = normalizeText(text);
  if (conversationMode !== 'sales') {
    if (collectionsContext?.campaignSubIntent === 'collections_app_blocked') return 'billing_app_blocked';
    if (collectionsContext?.campaignSubIntent === 'collections_inspection') return 'inspection_requested';
    if (collectionsContext?.campaignSubIntent === 'collections_receipt') return 'billing_receipt_sent';
    if (collectionsContext?.campaignSubIntent === 'collections_payment') return 'billing_payment_claimed';
    if (matchAny(normalized, [/\bregularizar\b/, /\bboleto\b/, /\bpagar\b/, /\bvencimento\b/])) {
      return 'billing_payment_claimed';
    }
    return 'general_question';
  }

  if (matchAny(normalized, [/\bcotacao\b/, /\borcamento\b/, /\bprotecao\b/, /\bseguro\b/, /\bcobertura\b/])) {
    return 'sales_quote';
  }
  if (hasPlate(text) || hasVehicleHint(text)) return 'sales_quote';
  return 'general_question';
}

function riskLevelFor({ event, emotion, intent }) {
  if (
    emotion === 'angry'
    || event?.type === 'human_requested'
    || event?.type === 'angry_customer'
    || intent === 'billing_due_date_dispute'
    || intent === 'billing_receipt_sent'
    || intent === 'inspection_disputed'
  ) {
    return 'alto';
  }
  if (emotion === 'irritated' || intent.startsWith('billing_') || intent.startsWith('inspection_')) {
    return 'medio';
  }
  return 'baixo';
}

function buildAngryEvent(conversationMode) {
  return {
    type: 'angry_customer',
    status: conversationMode === 'sales' ? 'human_requested' : 'awaiting_financial_review',
    stage: 'human_requested',
    reply: HIGH_RISK_REPLY,
    reason: 'Cliente demonstrou irritacao alta ou risco de reclamacao.',
    shouldNotifyHuman: true,
    shouldStopAutomation: true,
    lastIntent: 'angry_customer',
    lastObjection: 'angry_customer',
    conversationMode,
  };
}

function escalateAngryOperationalEvent(event, emotion) {
  if (!event || emotion !== 'angry') return event;
  if (event.type !== 'payment_claimed' && event.type !== 'inspection_pending') return event;

  return {
    ...event,
    status: event.type === 'inspection_pending' ? 'inspection_disputed' : 'awaiting_financial_review',
    stage: 'awaiting_financial_review',
    reply: event.type === 'payment_claimed' ? ANGRY_PAYMENT_REPLY : HIGH_RISK_REPLY,
    reason: `${event.reason} Cliente demonstrou irritacao alta.`,
    shouldNotifyHuman: true,
    shouldStopAutomation: true,
    lastIntent: event.type === 'payment_claimed' ? 'billing_payment_claimed' : 'inspection_disputed',
    lastObjection: 'angry_customer',
  };
}

function buildCaseSummary(lead, decision, content = {}) {
  const facts = [];
  const mode = decision.conversationMode === 'sales' ? 'vendas/cotacao' : 'cobranca/regularizacao';
  facts.push(`Atendimento em modo ${mode}.`);
  if (decision.intent) facts.push(`Intencao detectada: ${decision.intent}.`);
  if (decision.emotion && decision.emotion !== 'neutral') facts.push(`Cliente aparenta estar ${decision.emotion}.`);
  if (decision.operationalEvent?.reason) facts.push(decision.operationalEvent.reason);
  if (lead.paymentClaimed) facts.push('Cliente informou pagamento.');
  if (lead.receiptReceived) facts.push('Comprovante recebido ou mencionado.');
  if (lead.paymentDate) facts.push(`Data informada: ${lead.paymentDate}.`);
  if (lead.paymentAmount) facts.push(`Valor informado: ${lead.paymentAmount}.`);
  if (lead.appBlocked) facts.push('Cliente relatou app bloqueado.');
  if (lead.billingDisputed) facts.push('Cliente contestou cobranca/vencimento.');
  if (lead.inspectionDisputed) facts.push('Cliente contestou revistoria.');
  if (content.historyText || content.text) facts.push(`Ultima mensagem: "${String(content.historyText || content.text).slice(0, 180)}".`);
  if (decision.nextAction) facts.push(`Proximo passo: ${decision.nextAction}.`);
  return facts.join(' ');
}

export function makeConversationDecision({
  text = '',
  lead = {},
  collectionsContext = null,
  incomingContent = {},
} = {}) {
  const contentText = text || incomingContent.text || '';
  const collectionsLike = isCollectionsLike(lead, collectionsContext);
  const conversationMode = inferConversationMode(contentText, lead, collectionsContext);
  const detectorContext = collectionsLike || conversationMode === 'collections' || conversationMode === 'inspection' || conversationMode === 'support'
    ? (collectionsContext || { conversationMode: 'collections', campaignSubIntent: lead.campaignSubIntent || 'collections_unknown' })
    : null;
  const emotion = detectEmotion(contentText);
  let operationalEvent = detectOperationalEvent({
    text: contentText,
    hasAttachment: incomingContent.hasAttachment,
    attachmentType: incomingContent.attachmentType,
    collectionsContext: detectorContext,
  });
  operationalEvent = escalateAngryOperationalEvent(operationalEvent, emotion);

  if (!operationalEvent && (emotion === 'angry') && conversationMode !== 'sales') {
    operationalEvent = buildAngryEvent(conversationMode);
  }

  if (operationalEvent) {
    operationalEvent.conversationMode = operationalEvent.conversationMode || conversationMode;
  }

  const intent = operationalEvent
    ? mapOperationalIntent(operationalEvent.type)
    : inferIntent(contentText, conversationMode, lead, collectionsContext);
  const nextAction = operationalEvent
    ? actionForEvent(operationalEvent, conversationMode)
    : (missingDataFor(intent, conversationMode, lead, contentText).length ? 'ask_missing_data' : 'reply');
  const missingData = missingDataFor(intent, conversationMode, lead, contentText);
  const forbiddenActions = forbiddenActionsFor(intent, emotion, conversationMode);
  const riskLevel = riskLevelFor({ event: operationalEvent, emotion, intent });

  return {
    intent,
    emotion,
    conversationMode,
    nextAction,
    shouldStopAfterReply: !!operationalEvent?.shouldStopAutomation,
    missingData,
    forbiddenActions,
    notes: operationalEvent?.reason || 'Decisao feita por regras locais antes da resposta generativa.',
    riskLevel,
    operationalEvent,
  };
}

export function applyConversationDecisionToLead(lead, decision, content = {}) {
  if (!lead || !decision) return lead;

  if (decision.operationalEvent) {
    applyOperationalEventToLead(lead, decision.operationalEvent, content);
  } else {
    lead.conversationMode = decision.conversationMode || lead.conversationMode || 'sales';
    lead.lastIntent = decision.intent || lead.lastIntent || null;
    lead.lastObjection = decision.intent?.includes('objection') ? decision.intent : lead.lastObjection || null;
  }

  const now = new Date().toISOString();
  lead.customerEmotion = decision.emotion || 'neutral';
  lead.lastDetectedIntent = decision.intent || lead.lastDetectedIntent || null;
  lead.missingData = decision.missingData || [];
  lead.forbiddenActions = decision.forbiddenActions || [];
  lead.operationalStatus = decision.nextAction || lead.operationalStatus || null;
  lead.riskLevel = decision.riskLevel || lead.riskLevel || 'baixo';
  lead.decisionNotes = decision.notes || lead.decisionNotes || '';
  lead.caseSummary = buildCaseSummary(lead, decision, content);

  const existingSummary = typeof lead.leadSummary === 'object' && lead.leadSummary
    ? lead.leadSummary
    : {};
  lead.leadSummary = {
    ...existingSummary,
    conversationMode: lead.conversationMode || decision.conversationMode,
    status: lead.status,
    stage: lead.stage,
    intent: decision.intent,
    emotion: decision.emotion,
    riskLevel: lead.riskLevel,
    missingData: lead.missingData,
    forbiddenActions: lead.forbiddenActions,
    reason: decision.notes,
    caseSummary: lead.caseSummary,
    lastUserMessage: content.historyText || content.text || existingSummary.lastUserMessage || '',
    updatedAt: now,
  };

  return lead;
}
