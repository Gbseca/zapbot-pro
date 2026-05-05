import { updateLead } from '../data/leads-manager.js';
import { listHandoffConsultants } from '../data/consultants-repository.js';
import { recordEvent } from '../data/events-repository.js';
import {
  buildClientSendOptions,
  buildWaLinkNumber,
  formatRealWhatsAppPhone,
  getLeadInternalWhatsAppId,
  getLeadRealPhone,
  normalizeRealWhatsAppPhone,
} from '../phone-utils.js';

let _consultorIndex = 0;

/**
 * Selects the next consultor based on distribution config.
 */
async function selectConsultor(config, type = 'sales') {
  const consultors = await listHandoffConsultants({ type, config });
  if (consultors.length === 0) return null;

  if (config.consultorDistribution === 'first') return consultors[0];
  if (config.consultorDistribution === 'second') return consultors[1] || consultors[0];

  // Alternated (default)
  const consultor = consultors[_consultorIndex % consultors.length];
  _consultorIndex++;
  return consultor;
}

function formatNumber(raw) {
  return formatRealWhatsAppPhone(raw);
}

function getEventLeadKey(lead = {}) {
  return lead.number || getLeadRealPhone(lead) || getLeadInternalWhatsAppId(lead) || null;
}

function resolveConsultorSendTarget(consultor = {}, routeLabel) {
  const phone = normalizeRealWhatsAppPhone(consultor.phone || consultor.number);
  if (phone) {
    return {
      target: phone,
      options: {
        forcePhoneJid: true,
        routeLabel,
        context: 'ai',
        noInternalRetry: true,
      },
    };
  }

  if (consultor.lid_jid) {
    return {
      target: consultor.lid_jid,
      options: {
        allowRawLid: true,
        forcePhoneJid: false,
        routeLabel,
        context: 'ai',
        noInternalRetry: true,
      },
    };
  }

  throw new Error(`Consultor ${consultor.name || 'sem nome'} nao tem telefone nem LID para envio.`);
}

function buildSummary(lead) {
  if (!lead.history || lead.history.length === 0) return 'Sem histórico disponível.';
  return lead.history
    .filter(h => h.role === 'user')
    .slice(0, 4)
    .map(h => h.content)
    .join(' | ')
    .substring(0, 350);
}

function yesNo(value) {
  return value ? 'Sim' : 'Nao';
}

function buildFinancialSummary(lead) {
  const structured = typeof lead.leadSummary === 'object' && lead.leadSummary ? lead.leadSummary : {};
  return lead.caseSummary
    || structured.caseSummary
    || structured.lastUserMessage
    || buildSummary(lead)
    || 'Sem resumo disponivel.';
}

function buildContactCardFields(lead) {
  const realPhone = getLeadRealPhone(lead);
  const internalId = getLeadInternalWhatsAppId(lead);
  const waLinkNumber = realPhone ? buildWaLinkNumber(realPhone) : null;
  const unresolvedWarning = realPhone
    ? ''
    : '\n*ATENCAO:* o cliente entrou por LID e o numero real ainda nao foi resolvido. Nao use wa.me com o ID interno; assuma pelo painel/conversa interna ou aguarde o cliente informar o telefone.\n';

  return {
    realPhone,
    internalId,
    waLinkNumber,
    phoneResolved: !!realPhone,
    phoneLabel: realPhone ? formatNumber(realPhone) : 'Nao resolvido',
    internalLabel: internalId || 'Nao informado',
    waLinkLabel: waLinkNumber ? `https://wa.me/${waLinkNumber}` : 'Indisponivel',
    unresolvedWarning,
  };
}

function resolveOperationalHandoff(event = {}, lead = {}) {
  const eventType = event.type || lead.lastDetectedIntent || lead.lastIntent || '';
  if (eventType === 'payment_claimed') {
    return {
      title: 'ATENDIMENTO FINANCEIRO / PAGAMENTO INFORMADO',
      status: 'transferred_to_financial',
      action: 'Conferir baixa do pagamento, localizar boleto e orientar o cliente.',
    };
  }

  if (eventType === 'receipt_received') {
    return {
      title: 'ATENDIMENTO FINANCEIRO / COMPROVANTE RECEBIDO',
      status: 'transferred_to_financial',
      action: 'Validar comprovante e conferir baixa do pagamento antes de nova orientacao.',
    };
  }

  if (eventType === 'boleto_request') {
    return {
      title: 'ATENDIMENTO FINANCEIRO / BOLETO',
      status: 'transferred_to_financial',
      action: 'Verificar cadastro/pendencia e enviar a orientacao correta sobre boleto.',
    };
  }

  if (eventType === 'regularization_request') {
    return {
      title: 'ATENDIMENTO FINANCEIRO / REGULARIZACAO',
      status: 'transferred_to_financial',
      action: 'Verificar pendencia e orientar regularizacao conforme o caso real do cliente.',
    };
  }

  if (eventType === 'system_check_request') {
    return {
      title: 'ATENDIMENTO OPERACIONAL / CONSULTA INTERNA',
      status: 'transferred_to_financial',
      action: 'Consultar cadastro/pendencia no sistema e orientar o cliente sem promessas automaticas.',
    };
  }

  if (eventType === 'app_blocked') {
    return {
      title: 'ATENDIMENTO SUPORTE / APP BLOQUEADO',
      status: 'transferred_to_support',
      action: 'Verificar baixa/liberacao do app e orientar o cliente.',
    };
  }

  if (eventType === 'billing_disputed') {
    return {
      title: 'ATENDIMENTO FINANCEIRO / COBRANCA CONTESTADA',
      status: 'transferred_to_financial',
      action: 'Conferir vencimento, pendencia e regra aplicada antes de responder o cliente.',
    };
  }

  if (eventType === 'inspection_disputed' || eventType === 'inspection_pending') {
    return {
      title: eventType === 'inspection_disputed' ? 'ATENDIMENTO DE REVISTORIA / CONTESTACAO' : 'ATENDIMENTO DE REVISTORIA',
      status: 'transferred_to_support',
      action: 'Acompanhar revistoria do cliente e confirmar proximos passos conforme o caso real.',
    };
  }

  if (eventType === 'human_requested' || lead.status === 'human_requested') {
    return {
      title: 'ATENDIMENTO HUMANO SOLICITADO',
      status: 'human_requested',
      action: 'Assumir a conversa e pausar o atendimento automatico.',
    };
  }

  return {
    title: 'ATENDIMENTO FINANCEIRO / REGULARIZACAO',
    status: 'transferred_to_financial',
    action: 'Conferir baixa do pagamento e pendencias antes de orientar o cliente.',
  };
}

export async function executeFinancialHandoff(wa, lead, config, event = {}) {
  const consultor = await selectConsultor(config, 'support');
  if (!consultor) {
    console.warn('[Handoff] No consultor configured - skipping financial notification');
    await recordEvent({
      leadKey: getEventLeadKey(lead),
      eventType: 'handoff_failed',
      payload: { type: 'financial', reason: 'no_consultant_configured' },
    });
    return;
  }

  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const contact = buildContactCardFields(lead);
  const status = lead.status || event.status || 'awaiting_financial_review';
  const reason = event.reason || lead.operationalReason || 'Atendimento operacional de cobranca.';
  const handoff = resolveOperationalHandoff(event, lead);

  const consultorMsg =
    `*${handoff.title} - ZapBot Pro*\n` +
    `------------------------------\n` +
    `*Cliente:* ${lead.name || 'Nao informado'}\n` +
    `*Telefone real:* ${contact.phoneLabel}\n` +
    `*ID interno WhatsApp:* ${contact.internalLabel}\n` +
    `*Telefone resolvido:* ${contact.phoneResolved ? 'sim' : 'nao'}\n` +
    `*Placa:* ${lead.plate || 'Nao informada'}\n` +
    `*Status:* ${status}\n` +
    `*Motivo:* ${reason}\n` +
    `*Pagamento informado:* ${yesNo(lead.paymentClaimed)}\n` +
    `*Data do pagamento:* ${lead.paymentDate || 'Nao informada'}\n` +
    `*Valor informado:* ${lead.paymentAmount || 'Nao informado'}\n` +
    `*Comprovante enviado:* ${yesNo(lead.receiptReceived)}\n` +
    `*App bloqueado:* ${yesNo(lead.appBlocked)}\n` +
    `*Revistoria questionada:* ${yesNo(lead.inspectionDisputed)}\n` +
    `*Recebeu codigo de revistoria:* ${yesNo(lead.inspectionCodeMentioned)}\n` +
    `*Enviou video/fotos:* ${yesNo(lead.inspectionMediaSent)}\n` +
    contact.unresolvedWarning +
    `\n*Resumo da conversa:*\n${buildFinancialSummary(lead)}\n` +
    `\n*Acao sugerida:* ${handoff.action}\n` +
    `\nEncaminhado em: ${now}\n` +
    `------------------------------\n` +
    `Link wa.me:\n${contact.waLinkLabel}`;

  const consultorTarget = resolveConsultorSendTarget(consultor, 'agent_financial_handoff');
  console.log(`[Handoff] Notifying financial/consultor: ${consultor.name} -> target="${consultorTarget.target}"`);
  await recordEvent({
    leadKey: getEventLeadKey(lead),
    eventType: 'handoff_started',
    payload: { type: 'financial', consultant: consultor.name, consultant_phone: consultor.phone || consultor.number },
  });

  try {
    await wa.sendMessage(consultorTarget.target, consultorMsg, null, consultorTarget.options);
    updateLead(lead.number, {
      status: handoff.status,
      operationalStatus: status,
      financialTransferredAt: new Date().toISOString(),
      financialTransferredTo: consultor.number || null,
      financialTransferredToName: consultor.name || null,
      stage: handoff.status,
    });
    console.log(`[Handoff] Financial notification sent: ${consultor.name} (${consultorTarget.target})`);
    await recordEvent({
      leadKey: getEventLeadKey(lead),
      eventType: 'handoff_success',
      payload: { type: 'financial', consultant: consultor.name, status: handoff.status },
    });
  } catch (err) {
    console.error(`[Handoff] FAILED financial notification ${consultor.name} (${consultorTarget.target}): ${err.message}`);
    await recordEvent({
      leadKey: getEventLeadKey(lead),
      eventType: 'handoff_failed',
      payload: { type: 'financial', consultant: consultor.name, error: err.message },
    });
  }
}

/**
 * Executes the commercial handoff. Consultant notification happens before
 * client confirmation, so the bot never claims a fake transfer.
 */
export async function executeHandoff(wa, lead, config, options = {}) {
  const consultor = await selectConsultor(config, 'sales');

  if (!consultor) {
    const error = new Error('Nenhum consultor configurado para handoff comercial.');
    updateLead(lead.number, {
      handoffError: error.message,
      handoffFailedAt: new Date().toISOString(),
    });
    console.warn('[Handoff] No consultor configured - commercial handoff aborted');
    await recordEvent({
      leadKey: getEventLeadKey(lead),
      eventType: 'handoff_failed',
      payload: { type: 'sales', reason: 'no_consultant_configured' },
    });
    throw error;
  }

  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const contact = buildContactCardFields(lead);
  const handoffReason = options.reason || lead.salesHandoffReason || 'Lead comercial pronto para cotacao.';
  const consultorMsg =
    `*NOVO LEAD QUALIFICADO - ZapBot Pro*\n` +
    `------------------------------\n` +
    `*Cliente:* ${lead.name || 'Nao informado'}\n` +
    `*Telefone real:* ${contact.phoneLabel}\n` +
    `*ID interno WhatsApp:* ${contact.internalLabel}\n` +
    `*Telefone resolvido:* ${contact.phoneResolved ? 'sim' : 'nao'}\n` +
    `*Veiculo:* ${lead.model || 'Nao informado'}\n` +
    `*Ano:* ${lead.year || 'Nao informado'}\n` +
    `*Placa:* ${lead.plate || 'Nao informada'}\n` +
    `*Motivo:* ${handoffReason}\n` +
    contact.unresolvedWarning +
    `\n*Resumo da conversa:*\n${lead.caseSummary || lead.leadSummary?.caseSummary || buildSummary(lead)}\n` +
    `\n*Acao sugerida:* preparar cotacao real e continuar o atendimento com o cliente.\n` +
    `\nQualificado em: ${now}\n` +
    `------------------------------\n` +
    `Link wa.me:\n${contact.waLinkLabel}`;

  const consultorTarget = resolveConsultorSendTarget(consultor, 'agent_handoff_consultor');
  console.log(`[Handoff] Notifying consultor: ${consultor.name} -> target="${consultorTarget.target}"`);
  await recordEvent({
    leadKey: getEventLeadKey(lead),
    eventType: 'handoff_started',
    payload: { type: 'sales', consultant: consultor.name, consultant_phone: consultor.phone || consultor.number },
  });
  await wa.sendMessage(consultorTarget.target, consultorMsg, null, consultorTarget.options);
  console.log(`[Handoff] Consultor notified: ${consultor.name} (${consultorTarget.target})`);

  const clientMessage = options.clientMessage
    || `Recebi os dados principais${lead.name ? `, ${lead.name}` : ''}. Vou encaminhar para um consultor preparar sua cotacao e continuar o atendimento por aqui.`;
  const handoffClientTarget = lead.replyTargetJid || getLeadRealPhone(lead) || lead.jid;
  const clientSendOptions = {
    ...buildClientSendOptions(handoffClientTarget, options.clientSendOptions || {}),
    routeLabel: 'agent_handoff_client',
    context: 'ai',
    noInternalRetry: true,
  };

  let clientNotified = true;
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
  try {
    await wa.sendMessage(handoffClientTarget, clientMessage, null, clientSendOptions);
  } catch (err) {
    clientNotified = false;
    console.warn(`[Handoff] Consultant was notified, but client confirmation failed: ${err.message}`);
  }

  const finalStatus = clientNotified ? 'transferred' : 'handoff_client_confirmation_failed';
  updateLead(lead.number, {
    status: finalStatus,
    stage: finalStatus,
    transferredAt: new Date().toISOString(),
    transferredTo: consultor.number || null,
    transferredToName: consultor.name || null,
    handoffReason,
    handoffClientConfirmed: clientNotified,
    handoffClientError: clientNotified ? null : 'Falha ao confirmar o encaminhamento para o cliente.',
    handoffClientFailedAt: clientNotified ? null : new Date().toISOString(),
  });

  await recordEvent({
    leadKey: getEventLeadKey(lead),
    eventType: clientNotified ? 'handoff_success' : 'handoff_failed',
    payload: {
      type: 'sales',
      consultant: consultor.name,
      status: finalStatus,
      clientNotified,
    },
  });

  return {
    ok: true,
    consultorNotified: true,
    clientNotified,
    status: finalStatus,
    consultor,
  };
}

async function executeHandoffLegacy(wa, lead, config, options = {}) {
  const consultor = await selectConsultor(config, 'sales');

  if (!consultor) {
    const error = new Error('Nenhum consultor configurado para handoff comercial.');
    updateLead(lead.number, {
      handoffError: error.message,
      handoffFailedAt: new Date().toISOString(),
    });
    console.warn('[Handoff] No consultor configured - commercial handoff aborted');
    throw error;
  }

  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const contactPhone = lead.phone || lead.displayNumber || lead.number;
  const waLinkNumber = buildWaLinkNumber(contactPhone);
  const handoffReason = options.reason || lead.salesHandoffReason || 'Lead comercial pronto para cotacao.';
  const consultorMsg =
    `*NOVO LEAD QUALIFICADO - ZapBot Pro*\n` +
    `------------------------------\n` +
    `*Nome:* ${lead.name || 'Nao informado'}\n` +
    `*WhatsApp:* ${formatNumber(contactPhone)}\n` +
    `*Veiculo:* ${lead.model || 'Nao informado'}\n` +
    `*Ano:* ${lead.year || 'Nao informado'}\n` +
    `*Placa:* ${lead.plate || 'Nao informada'}\n` +
    `*Motivo do handoff:* ${handoffReason}\n` +
    `\n*Resumo da conversa:*\n${lead.caseSummary || lead.leadSummary?.caseSummary || buildSummary(lead)}\n` +
    `\n*Acao sugerida:* preparar cotacao real e continuar o atendimento com o cliente.\n` +
    `\nQualificado em: ${now}\n` +
    `------------------------------\n` +
    `Abrir conversa:\nhttps://wa.me/${waLinkNumber}`;

  let cNum = String(consultor.number).replace(/\D/g, '');
  if (cNum.startsWith('0')) cNum = cNum.substring(1);

  console.log(`[Handoff] Notifying consultor: ${consultor.name} -> raw="${consultor.number}" clean="${cNum}"`);
  await wa.sendMessage(cNum, consultorMsg, null, {
    forcePhoneJid: true,
    routeLabel: 'agent_handoff_consultor',
    context: 'ai',
    noInternalRetry: true,
  });
  console.log(`[Handoff] Consultor notified: ${consultor.name} (${cNum})`);

  updateLead(lead.number, {
    status: 'transferred',
    stage: 'transferred',
    transferredAt: new Date().toISOString(),
    transferredTo: consultor.number || null,
    transferredToName: consultor.name || null,
    handoffReason,
  });

  const clientMessage = options.clientMessage
    || `Recebi os dados principais${lead.name ? `, ${lead.name}` : ''}. Vou encaminhar para um consultor preparar sua cotacao e continuar o atendimento por aqui.`;
  const handoffClientTarget = lead.replyTargetJid || lead.phone || lead.displayNumber || lead.number || lead.jid;

  let clientNotified = true;
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
  try {
    await wa.sendMessage(handoffClientTarget, clientMessage, null, {
      forcePhoneJid: true,
      routeLabel: 'agent_handoff_client',
      context: 'ai',
      noInternalRetry: true,
    });
  } catch (err) {
    clientNotified = false;
    updateLead(lead.number, {
      handoffClientError: err.message,
      handoffClientFailedAt: new Date().toISOString(),
    });
    console.warn(`[Handoff] Consultant was notified, but client confirmation failed: ${err.message}`);
  }

  return {
    ok: true,
    consultorNotified: true,
    clientNotified,
    consultor,
  };

  // 1. Farewell to client (humanized — wait a bit before this one)
  await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
  const farewellMsg = `Perfeito${lead.name ? `, ${lead.name}` : ''}! 🙌\n\nJá anotei tudo aqui. Um dos nossos consultores vai entrar em contato com você em breve com as melhores opções${lead.model ? ` pra o seu ${lead.model}` : ''}.\n\nQualquer dúvida é só falar! 😊`;
  // Prefer the same fast reply target chosen by the agent instead of raw @lid.
  const clientTarget = lead.replyTargetJid || lead.phone || lead.displayNumber || lead.number || lead.jid;
  await wa.sendMessage(clientTarget, farewellMsg, null, { forcePhoneJid: true, routeLabel: 'agent_handoff_client', context: 'ai', noInternalRetry: true });

  // 2. Notify consultor
  if (consultor) {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const contactPhone = lead.phone || lead.displayNumber || lead.number;
    const waLinkNumber = buildWaLinkNumber(contactPhone);
    let consultorMsg =
      `🔔 *NOVO LEAD QUALIFICADO — ZapBot Pro*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Nome:* ${lead.name || 'Não informado'}\n` +
      `📱 *WhatsApp:* ${formatNumber(contactPhone)}\n` +
      `🚗 *Veículo:* ${lead.model || 'Não informado'}\n` +
      `🔑 *Placa:* ${lead.plate || 'Não informada'}\n` +
      `\n💬 *Resumo da conversa:*\n${buildSummary(lead)}\n` +
      `\n⏰ Qualificado em: ${now}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👆 Abrir conversa:\nhttps://wa.me/${waLinkNumber}`;

    consultorMsg = consultorMsg.replace('*Placa:*', `*Ano:* ${lead.year || 'Nao informado'}\n*Placa:*`);

    // Normalize consultor number: strip non-digits + remove leading zero if present
    let cNum = String(consultor.number).replace(/\D/g, '');
    if (cNum.startsWith('0')) cNum = cNum.substring(1); // remove leading zero (021xxx → 21xxx)
    // buildJid adds 55 if not present → "21xxx" → "5521xxx@s.whatsapp.net"

    console.log(`[Handoff] Notifying consultor: ${consultor.name} → raw="${consultor.number}" clean="${cNum}"`);

    try {
      await wa.sendMessage(cNum, consultorMsg, null, { forcePhoneJid: true, routeLabel: 'agent_handoff_consultor', context: 'ai', noInternalRetry: true });
      console.log(`[Handoff] ✅ Consultor notified: ${consultor.name} (${cNum})`);
    } catch (err) {
      console.error(`[Handoff] ❌ FAILED to notify consultor ${consultor.name} (${cNum}): ${err.message}`);
    }
  } else {
    console.warn('[Handoff] ⚠️ No consultor configured — skipping consultant notification');
  }

  // 3. Mark lead
  updateLead(lead.number, {
    status: 'transferred',
    transferredAt: new Date().toISOString(),
    transferredTo: consultor?.number || null,
    transferredToName: consultor?.name || null,
  });
}
