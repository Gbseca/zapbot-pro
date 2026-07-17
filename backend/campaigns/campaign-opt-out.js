const EXACT_OPT_OUT = new Set([
  'sair',
  'stop',
  'descadastrar',
  'parar mensagens',
  'pare as mensagens',
  'nao quero receber mensagens',
  'nao quero mais mensagens',
  'remover meu numero',
  'retirar meu numero',
  'cancelar mensagens',
  'cancelar campanha',
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isCampaignOptOutMessage(value) {
  const text = normalize(value);
  if (EXACT_OPT_OUT.has(text)) return true;
  if (text.length > 100) return false;
  return /^(?:por favor )?(?:pare|parar|cancele|cancelar|remova|remover|retire|retirar) (?:de )?(?:me )?(?:mandar|enviar|receber)? ?(?:essas |as |novas )?(?:mensagens|campanhas)(?: por favor)?$/.test(text);
}

export function hasRecentCampaignContact({ lead = null, phone = '', store, now = Date.now(), days = 90 } = {}) {
  const leadTimestamp = new Date(lead?.campaignSentAt || 0).getTime();
  const since = now - (Math.max(1, Number(days) || 90) * 24 * 60 * 60 * 1000);
  if (Number.isFinite(leadTimestamp) && leadTimestamp >= since) return true;
  if (!store || !phone) return false;
  return store.getRecentRecipientSends(phone, new Date(since).toISOString()).length > 0;
}
