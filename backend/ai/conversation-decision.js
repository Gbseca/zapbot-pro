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

// Fallback regex checks for isOperational
function fallbackIsOperational(text) {
  const normalized = normalizeText(text);
  return matchAny(normalized, [
    /\bja paguei\b/, /\bpaguei\b/, /\bfoi pago\b/, /\besta pago\b/, /\bpagamento feito\b/,
    /\bcomprovante\b/, /\brecibo\b/, /\bboleto\b/, /\bsegunda via\b/, /\bgerar boleto\b/,
    /\bvencimento\b/, /\breativar\b/, /\breativacao\b/, /\bprotecao suspensa\b/,
    /\bregularizar\b/, /\bnegociar\b/, /\bacordo\b/, /\bpendencia\b/, /\bfinanceiro\b/,
    /\bapp bloquead[ao]\b/, /\baplicativo bloquead[ao]\b/, /\bcancelar\b/, /\bcancelamento\b/,
    /\brevistoria\b/, /\bvistoria\b/
  ]);
}

// Fallback regex to infer intent
function fallbackInferIntent(text, isOperational) {
  const normalized = normalizeText(text);
  if (isOperational) {
    if (matchAny(normalized, [/\bcancelar\b/, /\bcancelamento\b/])) return 'cancel_request';
    if (matchAny(normalized, [/\breativar\b/, /\breativacao\b/])) return 'reactivation_request';
    if (matchAny(normalized, [/\bapp bloquead[ao]\b/, /\baplicativo bloquead[ao]\b/])) return 'app_blocked';
    if (matchAny(normalized, [/\bcomprovante\b/, /\brecibo\b/])) return 'receipt_received';
    if (matchAny(normalized, [/\bja paguei\b/, /\bpaguei\b/, /\bpagamento feito\b/])) return 'payment_claimed';
    if (matchAny(normalized, [/\bboleto\b/, /\bsegunda via\b/, /\bgerar boleto\b/])) return 'boleto_request';
    return 'general_question';
  }
  
  if (matchAny(normalized, [/\bconsultor\b/, /\bvendedor\b/, /\batendente\b/, /\bhumano\b/])) return 'sales_consultant_requested';
  if (matchAny(normalized, [/\bquanto (fica|custa|seria)\b/, /\bqual (o )?valor\b/, /\bmensalidade\b/, /\bpreco\b/])) return 'sales_price_request';
  if (matchAny(normalized, [/\bcotacao\b/, /\borcamento\b/, /\bsimulacao\b/])) return 'sales_quote';
  return 'general_question';
}

function determineRiskLevel(intent, emotion) {
  if (emotion === 'angry' || ['cancel_request', 'billing_disputed', 'angry_customer'].includes(intent)) {
    return 'alto';
  }
  if (emotion === 'irritated' || ['payment_claimed', 'app_blocked', 'inspection_disputed'].includes(intent)) {
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
} = {}) {
  const contentText = text || incomingContent.text || '';
  let isOperational = fallbackIsOperational(contentText) || lead.conversationMode === 'collections' || lead.conversationMode === 'operational';
  let detectedIntent = null;
  let emotion = 'neutral';

  // 1. Call LLM for Classification (Intent and Emotion)
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
    isOperational = fallbackIsOperational(contentText);
    detectedIntent = fallbackInferIntent(contentText, isOperational);
  }

  // Double check to make sure if user talks about boleto/inadimplência/atraso, it is classified as operational
  if (!isOperational && fallbackIsOperational(contentText)) {
    isOperational = true;
    detectedIntent = fallbackInferIntent(contentText, true);
  }

  // 2. Execute Playbook based on classification
  let playbookResult = {};
  
  if (isOperational) {
    playbookResult = getNextOperationalStep(lead, contentText, incomingContent);
  } else {
    playbookResult = getNextSalesStep(lead, contentText);
  }

  const intent = detectedIntent || playbookResult.intent || 'general_question';
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
  lead.status = decision.shouldStopAutomation ? 'human_requested' : lead.status || 'talking';
  
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
