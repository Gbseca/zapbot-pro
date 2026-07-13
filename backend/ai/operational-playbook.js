import { getLeadRealPhone } from '../phone-utils.js';
import {
  classifyDeterministicIntent,
  isOperationalIntent,
} from './deterministic-intent.js';

const FINANCIAL_COMPATIBILITY_INTENTS = new Set([
  'billing_disputed',
  'boleto_request',
  'payment_claimed',
  'reactivation_request',
  'receipt_available',
  'receipt_received',
  'regularization_request',
  'system_check_request',
]);

const SUPPORT_COMPATIBILITY_INTENTS = new Set([
  'app_blocked',
  'assistance_request',
  'event_report',
  'inspection_pending',
]);

const TOPIC_LABELS = {
  angry_customer: 'atendimento humano',
  app_blocked: 'acesso ao aplicativo',
  assistance_request: 'reboque ou assistencia',
  billing_disputed: 'cobranca contestada',
  boleto_request: 'boleto ou forma de pagamento',
  cancel_request: 'cancelamento',
  event_report: 'evento com o veiculo',
  general_question: 'seu caso',
  human_requested: 'atendimento humano',
  inspection_pending: 'vistoria ou revistoria',
  payment_claimed: 'pagamento informado',
  reactivation_request: 'reativacao',
  receipt_available: 'comprovante',
  receipt_received: 'comprovante informado',
  regularization_request: 'regularizacao de pendencia',
  system_check_request: 'consulta do cadastro',
};

function resolveDepartment(intent) {
  if (FINANCIAL_COMPATIBILITY_INTENTS.has(intent)) return 'financial';
  if (SUPPORT_COMPATIBILITY_INTENTS.has(intent)) return 'support';
  return 'consultant';
}

function resolveIntent(text, incomingContent = {}) {
  const preferredIntent = incomingContent.preferredIntent;
  if (isOperationalIntent(preferredIntent)) return preferredIntent;

  const deterministic = incomingContent.deterministic
    || classifyDeterministicIntent(text, { contextText: incomingContent.contextText || '' });
  if (deterministic.mode === 'operational' && isOperationalIntent(deterministic.intent)) {
    return deterministic.intent;
  }
  return 'general_question';
}

function buildClientReply(intent, phoneResolved, collectionsContext = null) {
  const topic = TOPIC_LABELS[intent] || TOPIC_LABELS.general_question;

  if (intent === 'general_question' && collectionsContext) {
    return phoneResolved
      ? 'Oi! Voce esta falando com a equipe da Moove Protecao Veicular. Vou encaminhar seu atendimento para um consultor continuar por aqui.'
      : 'Oi! Voce esta falando com a equipe da Moove Protecao Veicular. Para encaminhar seu atendimento ao consultor, me confirma seu WhatsApp com DDD?';
  }

  if (phoneResolved) {
    if (intent === 'assistance_request') {
      return 'Entendi o pedido de reboque ou assistencia. Encaminhei seu atendimento para um consultor continuar por aqui.';
    }
    if (intent === 'event_report') {
      return 'Entendi o que aconteceu com o veiculo. Encaminhei seu atendimento para um consultor continuar por aqui.';
    }
    return `Entendi. Encaminhei seu atendimento sobre ${topic} para um consultor continuar por aqui.`;
  }

  if (intent === 'assistance_request') {
    return 'Entendi o pedido de reboque ou assistencia. Para encaminhar ao consultor, me confirma seu WhatsApp com DDD?';
  }
  if (intent === 'event_report') {
    return 'Entendi o que aconteceu com o veiculo. Para encaminhar ao consultor, me confirma seu WhatsApp com DDD?';
  }
  return `Entendi. Para encaminhar seu atendimento sobre ${topic} ao consultor, me confirma seu WhatsApp com DDD?`;
}

export function getNextOperationalStep(lead = {}, text = '', incomingContent = {}) {
  const intent = resolveIntent(text, incomingContent);
  const handoffDepartment = resolveDepartment(intent);
  const phoneResolved = !!getLeadRealPhone(lead);
  const requiredAction = phoneResolved ? 'execute_handoff' : 'ask_phone_ddd';

  return {
    mode: 'operational',
    step: phoneResolved ? 'human_handoff' : 'awaiting_contact_for_handoff',
    intent,
    requiredAction,
    shouldAskPhone: !phoneResolved,
    shouldHandoff: phoneResolved,
    handoffDepartment,
    shouldStopAutomation: phoneResolved,
    clientReply: buildClientReply(intent, phoneResolved, incomingContent.collectionsContext || null),
    reason: `Atendimento do tipo ${intent}; somente um consultor pode concluir o caso.`,
  };
}
