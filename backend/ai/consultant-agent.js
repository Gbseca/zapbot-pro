import { getAllLeads, getLeadStats, updateLead } from '../data/leads-manager.js';
import { findActiveConsultant, linkConsultantLid } from '../data/consultants-repository.js';
import { searchFaq } from '../data/faq-repository.js';
import { addLeadTag, listLeadTags } from '../data/tags-repository.js';
import { createReminder, listOpenReminders } from '../data/reminders-repository.js';
import { recordEvent } from '../data/events-repository.js';
import {
  formatRealWhatsAppPhone,
  getLeadInternalWhatsAppId,
  getLeadRealPhone,
  isLidIdentifier,
  normalizeRealWhatsAppPhone,
} from '../phone-utils.js';
import { sendTextWithConfirmation } from './humanizer.js';

const PENDING_STATUSES = new Set([
  'awaiting_phone_for_handoff',
  'handoff_client_confirmation_failed',
  'human_requested',
  'human_taken_over',
  'awaiting_financial_review',
  'payment_claimed',
  'receipt_received',
  'inspection_pending',
  'inspection_disputed',
  'app_blocked',
  'billing_disputed',
  'transferred',
  'transferred_to_financial',
  'transferred_to_support',
]);

function normalizePlate(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function firstTokenRest(text = '') {
  const trimmed = String(text || '').trim();
  const [command = '', ...rest] = trimmed.split(/\s+/);
  return { command: command.toLowerCase(), rest: rest.join(' ').trim(), tokens: rest };
}

function findLeadByQuery(query = '') {
  const raw = String(query || '').trim();
  if (!raw) return null;
  const phone = normalizeRealWhatsAppPhone(raw);
  const plate = normalizePlate(raw);
  const all = getAllLeads();

  return all.find((lead) => {
    if (phone) {
      const phones = [lead.number, lead.phone, lead.displayNumber].map(normalizeRealWhatsAppPhone).filter(Boolean);
      if (phones.includes(phone)) return true;
    }
    if (plate && normalizePlate(lead.plate) === plate) return true;
    return false;
  }) || null;
}

function leadKey(lead) {
  return lead?.number || getLeadRealPhone(lead) || getLeadInternalWhatsAppId(lead) || null;
}

function formatLeadLine(lead) {
  const phone = getLeadRealPhone(lead);
  const internalId = getLeadInternalWhatsAppId(lead);
  const label = phone ? formatRealWhatsAppPhone(phone) : 'telefone nao resolvido';
  const plate = lead.plate ? ` | placa ${lead.plate}` : '';
  const vehicle = lead.model ? ` | ${lead.model}${lead.year ? ` ${lead.year}` : ''}` : '';
  const internal = !phone && internalId ? ` | ID ${internalId}` : '';
  return `${lead.name || 'Sem nome'} - ${label}${plate}${vehicle}${internal} | status ${lead.status || 'new'}`;
}

function buildLeadSummary(lead) {
  if (!lead) return 'Lead nao encontrado.';
  const phone = getLeadRealPhone(lead);
  const internalId = getLeadInternalWhatsAppId(lead);
  const summary = lead.caseSummary
    || lead.leadSummary?.caseSummary
    || lead.leadSummary
    || (lead.history || [])
      .filter(item => item.role === 'user')
      .slice(-4)
      .map(item => item.content)
      .join(' | ')
    || 'Sem resumo operacional.';

  return [
    `Cliente: ${lead.name || 'Nao informado'}`,
    `Telefone real: ${phone ? formatRealWhatsAppPhone(phone) : 'nao resolvido'}`,
    `ID interno WhatsApp: ${internalId || 'nao informado'}`,
    `Veiculo: ${lead.model || 'nao informado'}`,
    `Ano: ${lead.year || 'nao informado'}`,
    `Placa: ${lead.plate || 'nao informada'}`,
    `Status: ${lead.status || 'new'}`,
    `Resumo: ${summary}`,
  ].join('\n');
}

function buildMenu() {
  return [
    'Modo consultor ativo.',
    '',
    'Comandos:',
    '/status',
    '/pendentes',
    '/resumo telefone_ou_placa',
    '/assumir telefone_ou_placa',
    '/liberarbot telefone_ou_placa',
    '/tag telefone_ou_placa nome_da_tag',
    '/tags telefone_ou_placa',
    '/lembrar telefone_ou_placa texto do lembrete',
    '/faq termo',
    '/doc termo',
    '/vincularconsultor 5521999999999',
  ].join('\n');
}

function parseReminder(rest = '') {
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  const target = parts[0];
  let dueAt = null;
  let textStartIndex = 1;
  if (/^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '') && /^\d{2}:\d{2}$/.test(parts[2] || '')) {
    const parsed = new Date(`${parts[1]}T${parts[2]}:00-03:00`);
    if (!Number.isNaN(parsed.getTime())) dueAt = parsed.toISOString();
    textStartIndex = 3;
  }

  return {
    target,
    dueAt,
    text: parts.slice(textStartIndex).join(' ').trim(),
  };
}

async function sendConsultantReply(wa, route, text) {
  return sendTextWithConfirmation(wa, route.target, text, {
    ...(route.options || {}),
    context: 'consultant',
    routeLabel: 'consultant_command',
    noInternalRetry: true,
    disableDeliveryRecovery: true,
  });
}

export function isConsultantLinkCommand(text = '') {
  return String(text || '').trim().toLowerCase().startsWith('/vincularconsultor');
}

export async function resolveConsultantForRoute({ phone = null, lidJid = null, config } = {}) {
  return findActiveConsultant({ phone, lidJid, config });
}

export async function handleConsultantMessage({
  wa,
  consultant = null,
  message = '',
  route,
  config,
  inboundRoute = null,
  fullJid = '',
} = {}) {
  const text = String(message || '').trim();
  const { command, rest, tokens } = firstTokenRest(text);
  const consultantPhone = consultant?.phone || normalizeRealWhatsAppPhone(rest) || null;
  const consultantLabel = consultant?.name || consultantPhone || inboundRoute?.lidJid || fullJid || 'consultor';

  await recordEvent({
    leadKey: consultantPhone || inboundRoute?.lidJid || fullJid || null,
    eventType: consultant ? 'consultant_message_received' : 'consultant_not_matched',
    payload: { command: command || 'message', consultant: consultantLabel },
  });
  if (consultant) {
    await recordEvent({
      leadKey: consultantPhone || consultant.lid_jid || null,
      eventType: 'consultant_detected',
      payload: {
        consultant: consultantLabel,
        source: consultant.source || 'unknown',
        phone: consultantPhone,
        lid_jid: consultant.lid_jid || inboundRoute?.lidJid || null,
      },
    });
  }

  if (!command.startsWith('/')) {
    await sendConsultantReply(wa, route, 'Voce esta em modo consultor. Envie /menu para ver os comandos disponiveis.');
    return { handled: true };
  }

  let reply = '';

  if (command === '/menu') {
    reply = buildMenu();
  } else if (command === '/status') {
    const stats = getLeadStats();
    const leads = getAllLeads();
    const unresolved = leads.filter(lead => !getLeadRealPhone(lead) && getLeadInternalWhatsAppId(lead)).length;
    const pending = leads.filter(lead => PENDING_STATUSES.has(lead.status)).length;
    const waStatus = typeof wa.getStatus === 'function' ? wa.getStatus() : {};
    reply = [
      'Status do ZapBot Pro:',
      `WhatsApp: ${waStatus.status || 'desconhecido'}`,
      `Leads totais: ${stats.total}`,
      `Conversas ativas: ${stats.talking}`,
      `Aguardando acao humana: ${pending}`,
      `Telefone nao resolvido: ${unresolved}`,
      `Ultima recomendacao WhatsApp: ${waStatus.outboundDiagnostics?.recommendation || 'sem alerta'}`,
    ].join('\n');
  } else if (command === '/pendentes') {
    const leads = getAllLeads().filter(lead => PENDING_STATUSES.has(lead.status)).slice(0, 8);
    const reminders = await listOpenReminders({ consultantPhone, limit: 5 });
    const leadLines = leads.length
      ? leads.map((lead, index) => `${index + 1}. ${formatLeadLine(lead)}`).join('\n')
      : 'Nenhum lead pendente.';
    const reminderLines = reminders.length
      ? reminders.map((reminder, index) => `${index + 1}. ${reminder.lead_key}: ${reminder.reminder_text}${reminder.due_at ? ` (${new Date(reminder.due_at).toLocaleString('pt-BR')})` : ''}`).join('\n')
      : 'Nenhum lembrete aberto.';
    reply = `Pendencias:\n${leadLines}\n\nLembretes:\n${reminderLines}`;
  } else if (command === '/resumo') {
    const lead = findLeadByQuery(rest);
    reply = lead ? buildLeadSummary(lead) : 'Nao encontrei lead por esse telefone ou placa.';
  } else if (command === '/assumir') {
    const lead = findLeadByQuery(rest);
    if (!lead) {
      reply = 'Nao encontrei lead por esse telefone ou placa.';
    } else {
      updateLead(lead.number, {
        status: 'human_taken_over',
        stage: 'human_taken_over',
        humanTakenOverAt: new Date().toISOString(),
        humanTakenOverBy: consultantPhone || consultantLabel,
      });
      await recordEvent({ leadKey: leadKey(lead), eventType: 'consultant_took_over', payload: { consultant: consultantLabel } });
      reply = 'Atendimento assumido. A IA vai ficar pausada para esse lead.';
    }
  } else if (command === '/liberarbot') {
    const lead = findLeadByQuery(rest);
    if (!lead) {
      reply = 'Nao encontrei lead por esse telefone ou placa.';
    } else {
      const nextStatus = Array.isArray(lead.history) && lead.history.length > 0 ? 'talking' : 'new';
      updateLead(lead.number, {
        status: nextStatus,
        stage: nextStatus,
        humanTakenOverAt: null,
        humanTakenOverBy: null,
      });
      await recordEvent({ leadKey: leadKey(lead), eventType: 'consultant_released_bot', payload: { consultant: consultantLabel, nextStatus } });
      reply = `Bot liberado para esse lead. Status atual: ${nextStatus}.`;
    }
  } else if (command === '/tag') {
    const target = tokens[0] || '';
    const tag = tokens.slice(1).join(' ');
    const lead = findLeadByQuery(target);
    if (!lead || !tag) {
      reply = 'Uso: /tag telefone_ou_placa nome_da_tag';
    } else {
      const saved = await addLeadTag({ leadKey: leadKey(lead), tag, createdBy: consultantPhone || consultantLabel });
      reply = saved ? `Tag adicionada: ${saved.tag}` : 'Nao consegui adicionar a tag.';
    }
  } else if (command === '/tags') {
    const lead = findLeadByQuery(rest);
    if (!lead) {
      reply = 'Nao encontrei lead por esse telefone ou placa.';
    } else {
      const tags = await listLeadTags(leadKey(lead));
      reply = tags.length ? `Tags:\n${tags.map(item => `- ${item.tag}`).join('\n')}` : 'Esse lead ainda nao tem tags.';
    }
  } else if (command === '/lembrar') {
    const parsed = parseReminder(rest);
    const lead = parsed ? findLeadByQuery(parsed.target) : null;
    if (!parsed || !lead || !parsed.text) {
      reply = 'Uso: /lembrar telefone_ou_placa texto do lembrete';
    } else {
      const reminder = await createReminder({
        lead_key: leadKey(lead),
        consultant_phone: consultantPhone,
        reminder_text: parsed.text,
        due_at: parsed.dueAt,
      });
      reply = reminder ? 'Lembrete salvo. Ele vai aparecer em /pendentes.' : 'Nao consegui salvar o lembrete.';
    }
  } else if (command === '/faq' || command === '/doc') {
    if (!rest) {
      reply = `Uso: ${command} termo`;
    } else {
      const matches = await searchFaq(rest, { limit: 2 });
      reply = matches.length
        ? matches.map(item => `*${item.title || item.category || 'FAQ'}*\n${item.answer}`).join('\n\n')
        : 'Nao encontrei nada sobre esse termo na base cadastrada.';
    }
  } else if (command === '/vincularconsultor') {
    const phone = tokens[0] || rest;
    const lidJid = inboundRoute?.lidJid || (isLidIdentifier(fullJid) ? fullJid : null);
    if (!lidJid) {
      reply = 'Este WhatsApp nao chegou por LID, entao nao ha vinculo tecnico para salvar.';
    } else {
      const linked = await linkConsultantLid({ phone, lidJid, config });
      reply = linked
        ? `Pronto, vinculei este WhatsApp ao consultor ${linked.name}. Agora suas mensagens entram em modo consultor.`
        : 'Nao encontrei esse telefone na lista de consultores ativos.';
    }
  } else {
    reply = 'Comando nao reconhecido. Envie /menu para ver os comandos disponiveis.';
  }

  await recordEvent({
    leadKey: consultantPhone || inboundRoute?.lidJid || fullJid || null,
    eventType: 'consultant_command_executed',
    payload: { command, consultant: consultantLabel },
  });
  await sendConsultantReply(wa, route, reply);
  return { handled: true };
}
