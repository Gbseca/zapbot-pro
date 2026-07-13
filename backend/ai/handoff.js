import { saveLead } from '../data/leads-manager.js';
import {
  listConsultants,
  listHandoffConsultants,
} from '../data/consultants-repository.js';
import { recordEvent } from '../data/events-repository.js';
import {
  buildClientSendOptions,
  buildWaLinkNumber,
  formatRealWhatsAppPhone,
  getLeadInternalWhatsAppId,
  getLeadRealPhone,
  normalizeRealWhatsAppPhone,
} from '../phone-utils.js';

let consultantIndex = 0;

async function listOrderedConsultants(config, type = 'sales') {
  const consultants = type === 'operational'
    ? await listConsultants({ config, includeInactive: false })
    : await listHandoffConsultants({ type, config });
  if (consultants.length <= 1) return consultants;

  if (config.consultorDistribution === 'first') return consultants;
  if (config.consultorDistribution === 'second') {
    return [consultants[1] || consultants[0], ...consultants.filter((_, index) => index !== 1)];
  }

  const start = consultantIndex % consultants.length;
  consultantIndex += 1;
  return [...consultants.slice(start), ...consultants.slice(0, start)];
}

function getLeadKey(lead = {}) {
  return lead.number || getLeadRealPhone(lead) || getLeadInternalWhatsAppId(lead) || null;
}

function persistLead(lead = {}) {
  const key = getLeadKey(lead);
  if (key) saveLead(key, lead);
  return key;
}

function resolveConsultantTarget(consultant = {}, routeLabel = 'agent_consultant_handoff') {
  const phone = normalizeRealWhatsAppPhone(consultant.phone || consultant.number);
  if (phone) {
    return {
      target: phone,
      options: {
        forcePhoneJid: true,
        routeLabel,
        context: 'ai',
      },
    };
  }

  if (consultant.lid_jid) {
    return {
      target: consultant.lid_jid,
      options: {
        allowRawLid: true,
        forcePhoneJid: false,
        routeLabel,
        context: 'ai',
      },
    };
  }

  throw new Error(`Consultor ${consultant.name || 'sem nome'} nao tem contato valido.`);
}

function sanitizeCustomerText(value = '') {
  return String(value || '')
    .replace(/\bseguradoras?\b/gi, 'associacao')
    .replace(/\bseguros?\b/gi, 'protecao veicular')
    .replace(/\bap[oó]lices?\b/gi, 'termo de adesao')
    .replace(/\bsinistros?\b/gi, 'evento')
    .replace(/\bpr[eê]mios?\b/gi, 'mensalidade')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLatestUserMessage(lead = {}) {
  const historyMessage = [...(lead.history || [])]
    .reverse()
    .find((entry) => entry?.role === 'user' && entry.content)?.content;
  return sanitizeCustomerText(
    lead.leadSummary?.lastUserMessage
    || historyMessage
    || lead.operationalReason
    || '',
  ).slice(0, 240);
}

function buildRecentUserSummary(lead = {}) {
  return (lead.history || [])
    .filter((entry) => entry?.role === 'user' && entry.content)
    .slice(-3)
    .map((entry) => sanitizeCustomerText(entry.content))
    .filter(Boolean)
    .join(' | ')
    .slice(0, 360);
}

function buildContact(lead = {}) {
  const phone = getLeadRealPhone(lead);
  const internalId = getLeadInternalWhatsAppId(lead);
  const waLink = phone ? buildWaLinkNumber(phone) : null;
  return {
    phone,
    phoneLabel: phone ? formatRealWhatsAppPhone(phone) : 'Nao resolvido',
    internalId,
    waLink,
  };
}

function getEventType(event = {}, lead = {}) {
  return event.type || event.intent || event.lastIntent || lead.lastDetectedIntent || lead.lastIntent || 'human_requested';
}

function buildOperationalIntentLabel(event = {}, lead = {}) {
  const labels = {
    angry_customer: 'cliente irritado pediu atendimento',
    app_blocked: 'problema de acesso ao aplicativo',
    assistance_request: 'pedido de reboque ou assistencia',
    billing_disputed: 'contestacao de cobranca',
    boleto_request: 'boleto ou forma de pagamento',
    cancel_request: 'cancelamento',
    event_report: 'evento ocorrido com o veiculo',
    human_requested: 'atendimento humano',
    inspection_pending: 'vistoria ou revistoria',
    payment_claimed: 'pagamento informado',
    reactivation_request: 'reativacao',
    receipt_available: 'comprovante mencionado',
    receipt_received: 'comprovante informado como enviado',
    regularization_request: 'regularizacao de pendencia',
    system_check_request: 'consulta de cadastro',
  };
  return labels[getEventType(event, lead)] || 'atendimento solicitado';
}

function buildOperationalExtraLines(lead = {}) {
  const lines = [];
  if (lead.plate) lines.push(`*Placa:* ${lead.plate}`);
  if (lead.paymentDate) lines.push(`*Pagamento informado:* ${lead.paymentDate}${lead.paymentAmount ? ` | ${lead.paymentAmount}` : ''}`);
  if (lead.receiptReceived) lines.push('*Comprovante:* cliente informou que enviou');
  if (lead.appBlocked) lines.push('*Aplicativo:* problema de acesso');
  if (lead.inspectionPending || lead.inspectionDisputed) lines.push('*Revistoria:* precisa de acompanhamento');
  return lines;
}

function resolveOperationalHandoff(event = {}, lead = {}) {
  const type = getEventType(event, lead);
  const map = {
    angry_customer: ['ATENDIMENTO HUMANO PRIORITARIO', 'human_requested', 'Assumir a conversa e acolher o cliente.'],
    app_blocked: ['ATENDIMENTO / APLICATIVO', 'transferred_to_support', 'Verificar o acesso ao aplicativo e orientar o cliente.'],
    assistance_request: ['ATENDIMENTO / REBOQUE OU ASSISTENCIA', 'transferred_to_support', 'Assumir imediatamente e confirmar com o cliente o procedimento aplicavel.'],
    billing_disputed: ['ATENDIMENTO / COBRANCA CONTESTADA', 'transferred_to_financial', 'Conferir a cobranca antes de orientar o cliente.'],
    boleto_request: ['ATENDIMENTO / BOLETO', 'transferred_to_financial', 'Verificar o cadastro e orientar a forma correta de pagamento.'],
    cancel_request: ['ATENDIMENTO / CANCELAMENTO', 'human_requested', 'Assumir a conversa e tratar o pedido de cancelamento.'],
    event_report: ['ATENDIMENTO / EVENTO COM VEICULO', 'transferred_to_support', 'Assumir imediatamente e orientar os proximos passos do evento.'],
    human_requested: ['ATENDIMENTO HUMANO SOLICITADO', 'human_requested', 'Assumir a conversa e manter a automacao pausada.'],
    inspection_pending: ['ATENDIMENTO / REVISTORIA', 'transferred_to_support', 'Acompanhar a revistoria e confirmar os proximos passos.'],
    payment_claimed: ['ATENDIMENTO / PAGAMENTO INFORMADO', 'transferred_to_financial', 'Conferir o pagamento informado antes de responder.'],
    reactivation_request: ['ATENDIMENTO / REATIVACAO', 'transferred_to_financial', 'Verificar a reativacao e retornar ao cliente.'],
    receipt_available: ['ATENDIMENTO / COMPROVANTE', 'transferred_to_financial', 'Orientar ou conferir o comprovante mencionado pelo cliente.'],
    receipt_received: ['ATENDIMENTO / COMPROVANTE', 'transferred_to_financial', 'Conferir o comprovante informado pelo cliente.'],
    regularization_request: ['ATENDIMENTO / REGULARIZACAO', 'transferred_to_financial', 'Verificar a pendencia e orientar a regularizacao.'],
    system_check_request: ['ATENDIMENTO / CONSULTA DE CADASTRO', 'transferred_to_financial', 'Consultar o cadastro antes de orientar o cliente.'],
  };
  const [title, status, action] = map[type]
    || ['ATENDIMENTO HUMANO SOLICITADO', 'human_requested', 'Assumir a conversa e entender o pedido do cliente.'];
  return { title, status, action, type };
}

function buildOperationalConsultantMessage(lead, event, handoff) {
  const contact = buildContact(lead);
  const latestMessage = getLatestUserMessage(lead) || 'Nao informada';
  const recentSummary = buildRecentUserSummary(lead);
  const lines = [
    `*${handoff.title}*`,
    `*Cliente:* ${lead.name || 'Nao informado'}`,
    `*WhatsApp:* ${contact.phoneLabel}`,
    `*Intencao:* ${buildOperationalIntentLabel(event, lead)}`,
    `*Ultima mensagem:* ${latestMessage}`,
  ];

  if (!contact.phone && contact.internalId) lines.push(`*ID interno:* ${contact.internalId}`);
  if (recentSummary && recentSummary !== latestMessage) lines.push(`*Contexto recente:* ${recentSummary}`);
  lines.push(...buildOperationalExtraLines(lead));
  lines.push(`*Acao:* ${handoff.action}`);
  lines.push(contact.waLink ? `*Abrir conversa:* https://wa.me/${contact.waLink}` : '*Abrir conversa:* pelo painel/conversa atual');
  return lines.join('\n');
}

export async function executeFinancialHandoff(wa, lead, config, event = {}) {
  const leadKey = persistLead(lead);
  const handoff = resolveOperationalHandoff(event, lead);
  const consultants = await listOrderedConsultants(config, 'operational');

  lead.handoffAttemptedAt = new Date().toISOString();
  lead.operationalStatus = 'notifying_consultant';
  persistLead(lead);

  if (consultants.length === 0) {
    const error = 'Nenhum consultor configurado para atendimentos.';
    Object.assign(lead, {
      status: 'handoff_failed',
      stage: 'handoff_failed',
      operationalStatus: 'handoff_failed',
      handoffError: error,
      handoffFailedAt: new Date().toISOString(),
    });
    persistLead(lead);
    await recordEvent({
      leadKey,
      eventType: 'handoff_failed',
      payload: { type: 'operational', intent: handoff.type, reason: 'no_consultant_configured' },
    });
    return { ok: false, consultorNotified: false, status: 'handoff_failed', error };
  }

  let lastError = null;
  for (const consultant of consultants) {
    try {
      const target = resolveConsultantTarget(consultant, 'agent_operational_handoff');
      const message = buildOperationalConsultantMessage(lead, event, handoff);
      await recordEvent({
        leadKey,
        eventType: 'handoff_started',
        payload: { type: 'operational', intent: handoff.type, consultant: consultant.name },
      });
      await wa.sendMessage(target.target, message, null, target.options);

      Object.assign(lead, {
        status: handoff.status,
        stage: handoff.status,
        operationalStatus: 'consultant_notified',
        transferredAt: new Date().toISOString(),
        transferredTo: consultant.phone || consultant.number || null,
        transferredToName: consultant.name || null,
        financialTransferredAt: new Date().toISOString(),
        financialTransferredTo: consultant.phone || consultant.number || null,
        financialTransferredToName: consultant.name || null,
        handoffError: null,
        handoffClientConfirmed: false,
      });
      persistLead(lead);
      await recordEvent({
        leadKey,
        eventType: 'handoff_success',
        payload: { type: 'operational', intent: handoff.type, consultant: consultant.name, status: handoff.status },
      });
      return {
        ok: true,
        consultorNotified: true,
        status: handoff.status,
        consultor: consultant,
      };
    } catch (error) {
      lastError = error;
      console.error(`[Handoff] Failed to notify ${consultant.name || 'consultor'}: ${error.message}`);
    }
  }

  const errorMessage = lastError?.message || 'Falha ao avisar o consultor.';
  Object.assign(lead, {
    status: 'handoff_failed',
    stage: 'handoff_failed',
    operationalStatus: 'handoff_failed',
    handoffError: errorMessage,
    handoffFailedAt: new Date().toISOString(),
  });
  persistLead(lead);
  await recordEvent({
    leadKey,
    eventType: 'handoff_failed',
    payload: { type: 'operational', intent: handoff.type, error: errorMessage },
  });
  return { ok: false, consultorNotified: false, status: 'handoff_failed', error: errorMessage };
}

function buildSalesConsultantMessage(lead = {}) {
  const contact = buildContact(lead);
  return [
    '*COTACAO SOLICITADA*',
    `*Cliente:* ${lead.name || 'Nao informado'}`,
    `*WhatsApp:* ${contact.phoneLabel}`,
    '*Intencao:* cotacao de protecao veicular',
    `*Veiculo:* ${lead.model || 'Nao informado'}`,
    `*Ano:* ${lead.year || 'Nao informado'}`,
    `*Placa:* ${lead.plate || (lead.plateUnavailable ? 'nao possui placa' : 'Nao informada')}`,
    '*Acao:* preparar a cotacao real e continuar o atendimento',
    contact.waLink ? `*Abrir conversa:* https://wa.me/${contact.waLink}` : '*Abrir conversa:* pelo painel/conversa atual',
  ].join('\n');
}

export async function executeHandoff(wa, lead, config, options = {}) {
  const leadKey = persistLead(lead);
  const consultants = await listOrderedConsultants(config, 'sales');
  if (consultants.length === 0) {
    const error = new Error('Nenhum consultor configurado para cotacoes.');
    Object.assign(lead, {
      status: 'handoff_failed',
      stage: 'handoff_failed',
      handoffError: error.message,
      handoffFailedAt: new Date().toISOString(),
    });
    persistLead(lead);
    await recordEvent({ leadKey, eventType: 'handoff_failed', payload: { type: 'sales', reason: 'no_consultant_configured' } });
    throw error;
  }

  let consultant = null;
  let lastError = null;
  for (const candidate of consultants) {
    try {
      const target = resolveConsultantTarget(candidate, 'agent_sales_handoff');
      await recordEvent({ leadKey, eventType: 'handoff_started', payload: { type: 'sales', consultant: candidate.name } });
      await wa.sendMessage(target.target, buildSalesConsultantMessage(lead), null, target.options);
      consultant = candidate;
      break;
    } catch (error) {
      lastError = error;
      console.error(`[Handoff] Failed to notify ${candidate.name || 'consultor'} about sales lead: ${error.message}`);
    }
  }

  if (!consultant) {
    const error = lastError || new Error('Falha ao avisar o consultor.');
    Object.assign(lead, {
      status: 'handoff_failed',
      stage: 'handoff_failed',
      handoffError: error.message,
      handoffFailedAt: new Date().toISOString(),
    });
    persistLead(lead);
    await recordEvent({ leadKey, eventType: 'handoff_failed', payload: { type: 'sales', error: error.message } });
    throw error;
  }

  const clientMessage = options.clientMessage
    || `Recebi os dados principais${lead.name ? `, ${lead.name}` : ''}. Encaminhei para um consultor preparar sua cotacao e continuar por aqui.`;
  const clientTarget = lead.replyTargetJid || getLeadRealPhone(lead) || lead.jid;
  const clientOptions = {
    ...buildClientSendOptions(clientTarget, options.clientSendOptions || {}),
    routeLabel: 'agent_handoff_client',
    context: 'ai',
  };

  let clientNotified = true;
  let clientError = null;
  try {
    await wa.sendMessage(clientTarget, clientMessage, null, clientOptions);
  } catch (error) {
    clientNotified = false;
    clientError = error.message;
  }

  const status = clientNotified ? 'transferred' : 'handoff_client_confirmation_failed';
  Object.assign(lead, {
    status,
    stage: status,
    transferredAt: new Date().toISOString(),
    transferredTo: consultant.phone || consultant.number || null,
    transferredToName: consultant.name || null,
    handoffReason: options.reason || lead.salesHandoffReason || 'Cotacao solicitada.',
    handoffClientConfirmed: clientNotified,
    handoffClientError: clientError,
    handoffClientFailedAt: clientNotified ? null : new Date().toISOString(),
  });
  persistLead(lead);
  await recordEvent({
    leadKey,
    eventType: clientNotified ? 'handoff_success' : 'handoff_failed',
    payload: { type: 'sales', consultant: consultant.name, status, clientNotified },
  });

  return { ok: true, consultorNotified: true, clientNotified, status, consultor: consultant };
}
