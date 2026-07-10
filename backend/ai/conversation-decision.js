import { callAI } from './gemini.js';
import { buildDecisionContext } from './context-builder.js';
import { getNextSalesStep } from './sales-playbook.js';
import { getNextOperationalStep } from './operational-playbook.js';

// Simple text normalizer
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

const OPERATIONAL_PATTERNS = [
  /\bja paguei\b/, /\bpaguei\b/, /\bfoi pago\b/, /\besta pago\b/, /\bpagamento feito\b/,
  /\bcomprovante\b/, /\brecibo\b/, /\bboleto\b/, /\bsegunda via\b/, /\bgerar boleto\b/,
  /\bvencimento\b/, /\bvencid[ao]\b/, /\breativar\b/, /\breativacao\b/, /\bprotecao suspensa\b/,
  /\bregularizar\b/, /\bnegociar\b/, /\bacordo\b/, /\bpendencia\b/, /\bpendente\b/,
  /\binadimplencia\b/, /\binadimplente\b/, /\batraso\b/, /\batrasad[ao]\b/,
  /\bdebito\b/, /\bdivida\b/, /\bcobranca\b/, /\bquitar\b/, /\bfinanceiro\b/,
  /\b(to|tou|estou|tava|estava) devendo\b/, /\bdevendo (uma |umas |a |as )?mensalidades?\b/,
  /\bmensalidades? (atrasad[ao]s?|pendentes?|em atraso)\b/,
  /\b(quero|preciso) acertar (isso|essa pendencia|minha pendencia|as mensalidades?)\b/,
  /\b(quero|preciso) pagar (a |minha |uma )?mensalidade\b/, /\bcomo pago (a )?mensalidade\b/,
  /\bresolver (minha |meu |a |o |uma |um )?(pendencia|inadimplencia|debito|divida|boleto|cobranca)\b/,
  /\bapp bloquead[ao]\b/, /\bapp .*bloquead[ao]\b/,
  /\baplicativo bloquead[ao]\b/, /\baplicativo .*bloquead[ao]\b/,
  /\b(app|aplicativo) (bloqueou|travou|nao abre|nao entra)\b/,
  /\bmeu (app|aplicativo) (bloqueou|travou|nao abre|nao entra)\b/,
  /\b(nao|n) consigo (acessar|entrar|usar) (o |no )?(app|aplicativo)\b/,
  /\bcancelar\b/, /\bcancelamento\b/,
  /\brevistoria\b/, /\bvistoria\b/,
  /\broubaram\b/, /\bfurtaram\b/, /\blevaram (meu|minha)\b/,
  /\b(carro|moto|veiculo) roubad[ao]\b/, /\b(carro|moto|veiculo) furtad[ao]\b/,
  /\bbati\b/, /\bbateram\b/, /\bbatida\b/, /\bacidente\b/, /\bcolidi\b/, /\bcolisao\b/,
  /\b(tive|sofri|aconteceu|abrir|abri|acionar|acionei) (um |uma )?evento\b/,
  /\bsinistro\b/, /\bsinistrou\b/,
  /\bpreciso (de )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
  /\b(chamar|acionar|solicitar|pedir) (um |uma )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
  /\b(manda|mande|mandar) (um |uma )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
  /\b(reboque|guincho|assistencia|chaveiro|socorro) (urgente|agora|pra agora|para agora)\b/,
  /\b(meu|minha) (carro|moto|veiculo) (quebrou|parou|deu pane|esta parado|esta parada|ficou parado|ficou parada)\b/,
  /\b(deu pane|pane na estrada|pneu furado|sem bateria)\b/
];

const REGULARIZATION_PATTERNS = [
  /\bregularizar\b/, /\bnegociar\b/, /\bacordo\b/, /\bpendencia\b/, /\bpendente\b/,
  /\binadimplencia\b/, /\binadimplente\b/, /\batraso\b/, /\batrasad[ao]\b/,
  /\bdebito\b/, /\bdivida\b/, /\bcobranca\b/, /\bquitar\b/,
  /\b(to|tou|estou|tava|estava) devendo\b/, /\bdevendo (uma |umas |a |as )?mensalidades?\b/,
  /\bmensalidades? (atrasad[ao]s?|pendentes?|em atraso)\b/,
  /\b(quero|preciso) acertar (isso|essa pendencia|minha pendencia|as mensalidades?)\b/,
  /\b(quero|preciso) pagar (a |minha |uma )?mensalidade\b/, /\bcomo pago (a )?mensalidade\b/,
  /\bresolver (minha |meu |a |o |uma |um )?(pendencia|inadimplencia|debito|divida|boleto|cobranca)\b/
];

const HUMAN_OR_SUPPORT_PATTERNS = [
  /\bfalar com (um )?(atendente|humano|pessoa|consultor)\b/,
  /\bquero (um )?(atendente|humano|pessoa|consultor)\b/,
  /\bme passa(r)? para (um )?(atendente|humano|pessoa|consultor)\b/,
  /\bnao quero robo\b/,
  /\bnao quero falar com robo\b/,
  /\bsuporte\b/,
  /\bpreciso (de )?ajuda\b/,
  /\btenho (um )?problema\b/,
  /\bestou com (um )?problema\b/,
  /\bquero resolver ((um|uma) )?(coisa|questao|situacao|problema|caso)\b/,
  /\bpreciso resolver ((um|uma) )?(coisa|questao|situacao|problema|caso)\b/
];

const APP_BLOCKED_PATTERNS = [
  /\bapp bloquead[ao]\b/, /\bapp .*bloquead[ao]\b/,
  /\baplicativo bloquead[ao]\b/, /\baplicativo .*bloquead[ao]\b/,
  /\b(app|aplicativo) (bloqueou|travou|nao abre|nao entra)\b/,
  /\bmeu (app|aplicativo) (bloqueou|travou|nao abre|nao entra)\b/,
  /\b(nao|n) consigo (acessar|entrar|usar|entra) (o |no )?(app|aplicativo)\b/
];

const BILLING_DISPUTE_PATTERNS = [
  /\bnao devo\b/,
  /\bnao tenho (debito|divida|pendencia)\b/,
  /\bnao estou (atrasad[ao]|inadimplente)\b/,
  /\b(cobranca|vencimento|valor) errad[ao]\b/,
  /\bparem? de cobrar\b/
];

const SALES_PRICE_PATTERNS = [
  /\b(quanto|qnt|qt) (fica|custa|seria|e)\b/,
  /\bqual (o )?valor\b/,
  /\bvalor mensal\b/,
  /\bmensalidade\b/,
  /\bpreco\b/,
  /\bcusta quanto\b/
];

const SALES_QUOTE_PATTERNS = [
  /\b(cotacao|orcamento|simulacao)\b/,
  /\b(qro|quero|queria|gostaria de) (cotar|cota|ver (uma )?protecao|fazer (uma )?cotacao)\b/,
  /\bcotar (meu|minha|um|uma|o|a)?\s*(carro|moto|veiculo)?\b/,
  /\b(quero|queria) (protecao|contratar|aderir)\b/,
  /\bproteger meu\b/,
  /\bfaz protecao (pra|para)\b/,
  /\bainda nao sou (cliente|associado).{0,35}\bquero pagar a protecao\b/
];

const EVENT_PATTERNS = [
  /\broubaram\b/, /\bfurtaram\b/, /\blevaram (meu|minha)\b/,
  /\b(carro|moto|veiculo) roubad[ao]\b/, /\b(carro|moto|veiculo) furtad[ao]\b/,
  /\bbati\b/, /\bbateram\b/, /\bbatida\b/, /\bacidente\b/, /\bcolidi\b/, /\bcolisao\b/,
  /\b(tive|sofri|aconteceu|abrir|abri|acionar|acionei) (um |uma )?evento\b/,
  /\bsinistro\b/, /\bsinistrou\b/
];

const ASSISTANCE_REQUEST_PATTERNS = [
  /\bpreciso (de )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
  /\b(chamar|acionar|solicitar|pedir) (um |uma )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
  /\b(manda|mande|mandar) (um |uma )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
  /\b(reboque|guincho|assistencia|chaveiro|socorro) (urgente|agora|pra agora|para agora)\b/,
  /\b(meu|minha) (carro|moto|veiculo) (quebrou|parou|deu pane|esta parado|esta parada|ficou parado|ficou parada)\b/,
  /\b(deu pane|pane na estrada|pneu furado|sem bateria)\b/
];

// Fallback regex checks for isOperational
function fallbackIsOperational(text) {
  const normalized = normalizeText(text);
  return matchAny(normalized, OPERATIONAL_PATTERNS)
    || matchAny(normalized, HUMAN_OR_SUPPORT_PATTERNS)
    || matchAny(normalized, BILLING_DISPUTE_PATTERNS);
}

function isDeterministicSalesGeneral(text = '') {
  const normalized = normalizeText(text);
  return /^(oi|ola|opa|bom dia|boa tarde|boa noite)( tudo bem| tudo bom| tudo joia| td bem| td joia| beleza)?$/.test(normalized)
    || /^(obg|obrigado|obrigada|valeu|vlw)( viu| mesmo| ta)?$/.test(normalized)
    || /\b(como funciona|mutualismo|rateio|associacao)\b/.test(normalized)
    || /\b(cobre|cobertura|roubo|furto)\b/.test(normalized)
    || /\b(assistencia|reboque|guincho|chaveiro|24h)\b/.test(normalized)
    || /\b(seguro|seguradora|apolice|sinistro|premio)\b/.test(normalized);
}

// Fallback regex to infer intent
function fallbackInferIntent(text, isOperational) {
  const normalized = normalizeText(text);
  if (isOperational) {
    if (matchAny(normalized, [/\bcancelar\b/, /\bcancelamento\b/])) return 'cancel_request';
    if (matchAny(normalized, EVENT_PATTERNS)) return 'event_report';
    if (matchAny(normalized, ASSISTANCE_REQUEST_PATTERNS)) return 'assistance_request';
    if (matchAny(normalized, [/\breativar\b/, /\breativacao\b/])) return 'reactivation_request';
    if (matchAny(normalized, APP_BLOCKED_PATTERNS)) return 'app_blocked';
    if (matchAny(normalized, BILLING_DISPUTE_PATTERNS)) return 'billing_disputed';
    if (matchAny(normalized, [/\bcomprovante\b/, /\brecibo\b/])) return 'receipt_received';
    if (matchAny(normalized, [/\bja paguei\b/, /\bpaguei\b/, /\bpagamento feito\b/])) return 'payment_claimed';
    if (matchAny(normalized, [/\bboleto\b/, /\bsegunda via\b/, /\bgerar boleto\b/])) return 'boleto_request';
    if (matchAny(normalized, REGULARIZATION_PATTERNS)) return 'regularization_request';
    if (matchAny(normalized, HUMAN_OR_SUPPORT_PATTERNS)) return 'human_requested';
    return 'general_question';
  }
  
  if (matchAny(normalized, [/\bconsultor\b/, /\bvendedor\b/, /\batendente\b/, /\bhumano\b/])) return 'sales_consultant_requested';
  if (matchAny(normalized, SALES_PRICE_PATTERNS)) return 'sales_price_request';
  if (matchAny(normalized, SALES_QUOTE_PATTERNS)) return 'sales_quote';
  return 'general_question';
}

function determineRiskLevel(intent, emotion) {
  if (emotion === 'angry' || ['cancel_request', 'billing_disputed', 'angry_customer'].includes(intent)) {
    return 'alto';
  }
  if (emotion === 'irritated' || ['payment_claimed', 'app_blocked', 'inspection_disputed', 'event_report', 'assistance_request'].includes(intent)) {
    return 'medio';
  }
  return 'baixo';
}

function buildCaseSummary(lead, decision, text) {
  const facts = [];
  const mode = decision.conversationMode === 'sales' ? 'vendas/cotação' : 'cobrança/operacional';
  facts.push(`Atendimento em modo ${mode}.`);
  if (decision.intent) facts.push(`Intenção detectada: ${decision.intent}.`);
  if (decision.emotion && decision.emotion !== 'neutral') facts.push(`Cliente aparenta estar ${decision.emotion}.`);
  if (lead.model) facts.push(`Veículo: ${lead.model} (${lead.year || 'ano não informado'}).`);
  if (lead.plate) facts.push(`Placa: ${lead.plate}.`);
  facts.push(`Última mensagem: "${text.slice(0, 100)}".`);
  return facts.join(' ');
}

export async function makeConversationDecision({
  config,
  text = '',
  lead = {},
  collectionsContext = null,
  incomingContent = {},
  skipAI = false,
} = {}) {
  const contentText = text || incomingContent.text || '';
  const latestOperationalSignal = fallbackIsOperational(contentText);
  const hasOperationalSignal = latestOperationalSignal
    || lead.conversationMode === 'collections'
    || lead.conversationMode === 'operational'
    || !!collectionsContext;
  let isOperational = hasOperationalSignal;
  const fallbackIntent = fallbackInferIntent(contentText, hasOperationalSignal);
  const salesPreview = hasOperationalSignal ? null : getNextSalesStep(lead, contentText);
  const hasSpecificDeterministicIntent = latestOperationalSignal
    || (salesPreview?.intent && salesPreview.intent !== 'general_question')
    || (!hasOperationalSignal && isDeterministicSalesGeneral(contentText));
  let detectedIntent = hasOperationalSignal
    ? fallbackIntent
    : salesPreview?.intent || fallbackIntent;
  let emotion = 'neutral';

  // Explicit operational and commercial phrases are safer and cheaper to route deterministically.
  // The LLM remains available for genuinely ambiguous messages.
  if (!skipAI && !hasSpecificDeterministicIntent) {
    try {
      const context = buildDecisionContext(lead, contentText);
      const resultText = await callAI(config, context, { purpose: 'decision' });
      const decision = JSON.parse(resultText);

      isOperational = !!decision.isOperational;
      detectedIntent = decision.intent;
      emotion = decision.emotion || 'neutral';

      console.log(`[Decision LLM] Classified operational: ${isOperational}, intent: ${detectedIntent}, emotion: ${emotion}`);
    } catch (err) {
      console.warn(`[Decision] LLM classification failed: ${err.message}. Using fallback regex.`);
      isOperational = hasOperationalSignal;
      detectedIntent = fallbackInferIntent(contentText, isOperational);
    }
  }

  // Double check to make sure if user talks about boleto/inadimplência/atraso, it is classified as operational
  if (!isOperational && hasOperationalSignal) {
    isOperational = true;
    detectedIntent = fallbackInferIntent(contentText, true);
  }

  // 2. Execute Playbook based on classification
  let playbookResult = {};
  
  if (isOperational) {
    playbookResult = getNextOperationalStep(lead, contentText, {
      ...incomingContent,
      collectionsContext,
    });
  } else {
    playbookResult = getNextSalesStep(lead, contentText);
  }

  const hasSpecificPlaybookIntent = playbookResult.intent && playbookResult.intent !== 'general_question';
  const intent = playbookResult.mode === 'operational' && hasSpecificPlaybookIntent
    ? playbookResult.intent
    : detectedIntent && detectedIntent !== 'general_question'
      ? detectedIntent
      : playbookResult.intent || detectedIntent || 'general_question';
  const riskLevel = determineRiskLevel(intent, emotion);
  const nextAction = playbookResult.requiredAction || 'respond';

  // Prepare standard forbidden actions list
  const forbiddenActions = [];
  if (playbookResult.mode === 'sales') {
    forbiddenActions.push('nao_calcular_cotacao', 'nao_inventar_preco', 'nao_dizer_que_verificou_sistema');
  } else {
    forbiddenActions.push('nao_vender_cotacao', 'nao_prometer_baixa_pagamento', 'nao_prometer_liberar_app');
  }

  return {
    intent,
    emotion,
    conversationMode: playbookResult.mode,
    step: playbookResult.step,
    nextAction,
    shouldHandoff: !!playbookResult.shouldHandoff,
    shouldAskPhone: !!playbookResult.shouldAskPhone,
    shouldStopAutomation: !!playbookResult.shouldStopAutomation,
    missingData: playbookResult.missingData || [],
    forbiddenActions,
    riskLevel,
    allowedQuestion: playbookResult.allowedQuestion || null,
    clientReply: playbookResult.clientReply || '',
    notes: playbookResult.reason || 'Processado pelo Playbook.',
    handoffDepartment: playbookResult.handoffDepartment || 'consultant'
  };
}

export function applyConversationDecisionToLead(lead, decision, content = {}) {
  if (!lead || !decision) return lead;

  const now = new Date().toISOString();
  
  lead.conversationMode = decision.conversationMode;
  lead.lastIntent = decision.intent;
  lead.lastDetectedIntent = decision.intent;
  lead.customerEmotion = decision.emotion;
  lead.missingData = decision.missingData;
  lead.forbiddenActions = decision.forbiddenActions;
  lead.operationalStatus = decision.nextAction;
  lead.riskLevel = decision.riskLevel;
  lead.decisionNotes = decision.notes;
  lead.stage = decision.step;
  if (decision.conversationMode === 'operational' && decision.shouldAskPhone) {
    lead.status = 'awaiting_contact_for_handoff';
    lead.stage = 'awaiting_contact_for_handoff';
    lead.pendingOperationalHandoff = true;
    lead.pendingOperationalEvent = {
      type: decision.intent,
      status: 'awaiting_financial_review',
      stage: 'awaiting_financial_review',
      reply: decision.clientReply || '',
      reason: decision.notes || 'Cliente aguardando encaminhamento operacional.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      lastIntent: decision.intent,
      conversationMode: decision.conversationMode,
    };
    lead.pendingHandoffReason = decision.notes || lead.pendingHandoffReason || null;
  } else {
    lead.status = decision.shouldStopAutomation ? 'human_requested' : lead.status || 'talking';
  }
  
  // Custom properties for Handoff checks
  if (decision.shouldHandoff) {
    lead.shouldHandoff = true;
    lead.handoffDepartment = decision.handoffDepartment;
  }

  // Store clientReply preview in lead
  if (decision.clientReply) {
    lead.clientReply = decision.clientReply;
  }

  lead.caseSummary = buildCaseSummary(lead, decision, content.text || '');

  // Update leadSummary object
  const existingSummary = typeof lead.leadSummary === 'object' && lead.leadSummary ? lead.leadSummary : {};
  lead.leadSummary = {
    ...existingSummary,
    conversationMode: lead.conversationMode,
    status: lead.status,
    stage: lead.stage,
    intent: decision.intent,
    emotion: decision.emotion,
    riskLevel: lead.riskLevel,
    missingData: lead.missingData,
    forbiddenActions: lead.forbiddenActions,
    reason: decision.notes,
    caseSummary: lead.caseSummary,
    lastUserMessage: content.text || existingSummary.lastUserMessage || '',
    updatedAt: now
  };

  return lead;
}
