import { callAI } from './gemini.js';
import { buildDecisionContext } from './context-builder.js';
import { getNextSalesStep } from './sales-playbook.js';
import { getNextOperationalStep } from './operational-playbook.js';
import {
  classifyDeterministicIntent,
  isOperationalIntent,
  normalizeCustomerText,
} from './deterministic-intent.js';

const COMMERCIAL_OVERRIDE_INTENTS = new Set([
  'sales_consultant_requested',
  'sales_price_request',
  'sales_quote',
]);

const VALID_LLM_INTENTS = new Set([
  'app_blocked',
  'assistance_request',
  'billing_disputed',
  'boleto_request',
  'cancel_request',
  'event_report',
  'general_question',
  'human_requested',
  'inspection_pending',
  'payment_claimed',
  'reactivation_request',
  'receipt_available',
  'receipt_received',
  'regularization_request',
  'sales_consultant_requested',
  'sales_price_request',
  'sales_quote',
  'system_check_request',
]);

function buildRecentIntentContext(lead = {}, currentText = '') {
  const recent = (lead.history || [])
    .filter((entry) => entry?.role === 'user' && entry.content)
    .slice(-2)
    .map((entry) => String(entry.content).trim())
    .filter(Boolean);
  const current = String(currentText || '').trim();
  if (current && recent[recent.length - 1] !== current) recent.push(current);
  return recent.join('\n');
}

function getInheritedOperationalIntent(lead = {}) {
  const pendingIntent = lead.pendingOperationalEvent?.type || lead.pendingOperationalEvent?.intent;
  if (isOperationalIntent(pendingIntent)) return pendingIntent;
  if (isOperationalIntent(lead.lastDetectedIntent)) return lead.lastDetectedIntent;
  if (isOperationalIntent(lead.lastIntent)) return lead.lastIntent;
  return 'general_question';
}

function determineRiskLevel(intent, emotion) {
  if (emotion === 'angry' || ['cancel_request', 'billing_disputed', 'angry_customer'].includes(intent)) {
    return 'alto';
  }
  if (emotion === 'irritated' || ['payment_claimed', 'app_blocked', 'inspection_pending', 'event_report', 'assistance_request'].includes(intent)) {
    return 'medio';
  }
  return 'baixo';
}

function buildCaseSummary(lead, decision, text) {
  const facts = [];
  const mode = decision.conversationMode === 'sales' ? 'vendas/cotacao' : 'atendimento operacional';
  facts.push(`Atendimento em modo ${mode}.`);
  if (decision.intent) facts.push(`Intencao detectada: ${decision.intent}.`);
  if (decision.emotion && decision.emotion !== 'neutral') facts.push(`Cliente aparenta estar ${decision.emotion}.`);
  if (lead.model) facts.push(`Veiculo: ${lead.model} (${lead.year || 'ano nao informado'}).`);
  if (lead.plate) facts.push(`Placa: ${lead.plate}.`);
  if (text) facts.push(`Ultima mensagem: "${String(text).slice(0, 160)}".`);
  return facts.join(' ');
}

function parseLlmDecision(raw = '') {
  const parsed = JSON.parse(raw);
  const intent = VALID_LLM_INTENTS.has(parsed.intent) ? parsed.intent : 'general_question';
  const emotion = ['neutral', 'angry', 'irritated'].includes(parsed.emotion) ? parsed.emotion : 'neutral';
  return {
    isOperational: !!parsed.isOperational,
    intent,
    emotion,
  };
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
  const deterministic = classifyDeterministicIntent(contentText, {
    contextText: buildRecentIntentContext(lead, contentText),
  });
  const normalizedContent = normalizeCustomerText(contentText);
  const explicitCommercialOverride = deterministic.mode === 'sales'
    && deterministic.explicit
    && (
      COMMERCIAL_OVERRIDE_INTENTS.has(deterministic.intent)
      || (deterministic.intent === 'no_interest' && /\b(?:cotacao|orcamento|simulacao|proposta)\b/.test(normalizedContent))
    );
  const inheritedOperational = !explicitCommercialOverride && (
    lead.conversationMode === 'collections'
    || lead.conversationMode === 'operational'
    || !!lead.pendingOperationalHandoff
    || !!lead.pendingOperationalEvent
    || !!collectionsContext
  );

  let isOperational = deterministic.mode === 'operational' || inheritedOperational;
  let detectedIntent = deterministic.mode === 'operational'
    ? deterministic.intent
    : inheritedOperational
      ? getInheritedOperationalIntent(lead)
      : deterministic.intent || 'general_question';
  let emotion = deterministic.emotion || 'neutral';

  const preferredSalesIntent = deterministic.mode === 'sales' && deterministic.explicit
    ? deterministic.intent
    : null;
  const salesPreview = isOperational ? null : getNextSalesStep(lead, contentText, { preferredIntent: preferredSalesIntent });
  if (!isOperational && detectedIntent === 'general_question' && salesPreview?.intent) {
    detectedIntent = salesPreview.intent;
  }

  const shouldUseLlm = !skipAI
    && !deterministic.explicit
    && !inheritedOperational;

  if (shouldUseLlm) {
    try {
      const context = buildDecisionContext(lead, contentText);
      const llmDecision = parseLlmDecision(await callAI(config, context, { purpose: 'decision' }));
      isOperational = llmDecision.isOperational;
      detectedIntent = llmDecision.intent;
      emotion = llmDecision.emotion;
      console.log(`[Decision LLM] operational=${isOperational} intent=${detectedIntent} emotion=${emotion}`);
    } catch (error) {
      console.warn(`[Decision] LLM classification failed: ${error.message}. Deterministic fallback retained.`);
    }
  }

  if (deterministic.mode === 'operational') {
    isOperational = true;
    detectedIntent = deterministic.intent;
  } else if (explicitCommercialOverride) {
    isOperational = false;
    detectedIntent = deterministic.intent;
  }

  let playbookResult;
  if (isOperational) {
    playbookResult = getNextOperationalStep(lead, contentText, {
      ...incomingContent,
      collectionsContext,
      preferredIntent: detectedIntent,
      deterministic,
    });
  } else {
    playbookResult = getNextSalesStep(lead, contentText, { preferredIntent: detectedIntent });
  }

  const playbookIntent = playbookResult.intent || 'general_question';
  const intent = detectedIntent && detectedIntent !== 'general_question'
    ? detectedIntent
    : playbookIntent;
  const riskLevel = determineRiskLevel(intent, emotion);
  const nextAction = playbookResult.requiredAction || 'respond';
  const forbiddenActions = playbookResult.mode === 'sales'
    ? ['nao_calcular_cotacao', 'nao_inventar_preco', 'nao_dizer_que_verificou_sistema']
    : ['nao_vender_cotacao', 'nao_prometer_baixa_pagamento', 'nao_prometer_liberar_app', 'nao_prometer_assistencia_a_caminho'];

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
    notes: playbookResult.reason || deterministic.reason || 'Processado pelo playbook.',
    handoffDepartment: playbookResult.handoffDepartment || 'consultant',
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
      intent: decision.intent,
      status: 'awaiting_financial_review',
      stage: 'awaiting_financial_review',
      reply: decision.clientReply || '',
      reason: decision.notes || 'Cliente aguardando encaminhamento ao consultor.',
      shouldNotifyHuman: true,
      shouldStopAutomation: true,
      lastIntent: decision.intent,
      conversationMode: decision.conversationMode,
      handoffDepartment: decision.handoffDepartment,
    };
    lead.pendingHandoffReason = decision.notes || lead.pendingHandoffReason || null;
  } else if (decision.shouldStopAutomation) {
    lead.status = 'human_requested';
  } else {
    lead.status = lead.status || 'talking';
  }

  if (decision.shouldHandoff) {
    lead.shouldHandoff = true;
    lead.handoffDepartment = decision.handoffDepartment;
  }
  if (decision.clientReply) lead.clientReply = decision.clientReply;

  lead.caseSummary = buildCaseSummary(lead, decision, content.text || '');
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
    updatedAt: now,
  };

  return lead;
}
