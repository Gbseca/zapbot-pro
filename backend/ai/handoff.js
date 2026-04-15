import { updateLead } from '../data/leads-manager.js';

let _consultorIndex = 0;

/**
 * Selects the next consultor based on distribution config.
 */
function selectConsultor(config) {
  const consultors = config.consultors || [];
  if (consultors.length === 0) return null;

  if (config.consultorDistribution === 'first') return consultors[0];
  if (config.consultorDistribution === 'second') return consultors[1] || consultors[0];

  // Alternated (default)
  const consultor = consultors[_consultorIndex % consultors.length];
  _consultorIndex++;
  return consultor;
}

function formatNumber(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
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

/**
 * Executes the handoff:
 * 1. Sends farewell to client
 * 2. Sends lead card to consultor
 * 3. Marks lead as transferred
 */
export async function executeHandoff(wa, lead, config) {
  const consultor = selectConsultor(config);

  // 1. Farewell to client (humanized — wait a bit before this one)
  await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
  const farewellMsg = `Perfeito${lead.name ? `, ${lead.name}` : ''}! 🙌\n\nJá anotei tudo aqui. Um dos nossos consultores vai entrar em contato com você em breve com as melhores opções${lead.model ? ` pra o seu ${lead.model}` : ''}.\n\nQualquer dúvida é só falar! 😊`;
  // Use stored fullJid if available (handles non-standard WhatsApp JIDs)
  const clientTarget = lead.jid || lead.number;
  await wa.sendMessage(clientTarget, farewellMsg, null);

  // 2. Notify consultor
  if (consultor) {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const consultorMsg =
      `🔔 *NOVO LEAD QUALIFICADO — ZapBot Pro*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Nome:* ${lead.name || 'Não informado'}\n` +
      `📱 *WhatsApp:* ${formatNumber(lead.displayNumber || lead.number)}\n` +
      `🚗 *Veículo:* ${lead.model || 'Não informado'}\n` +
      `🔑 *Placa:* ${lead.plate || 'Não informada'}\n` +
      `\n💬 *Resumo da conversa:*\n${buildSummary(lead)}\n` +
      `\n⏰ Qualificado em: ${now}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👆 Abrir conversa:\nhttps://wa.me/${lead.displayNumber || lead.number}`;

    // Normalize consultor number
    const cNum = String(consultor.number).replace(/\D/g, '');
    await wa.sendMessage(cNum, consultorMsg, null);
  }

  // 3. Mark lead
  updateLead(lead.number, {
    status: 'transferred',
    transferredAt: new Date().toISOString(),
    transferredTo: consultor?.number || null,
    transferredToName: consultor?.name || null,
  });
}
