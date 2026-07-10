import { callAI } from './gemini.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildSalesHandoffReply(lead = {}) {
  const facts = [];
  if (lead.model) facts.push(`Veiculo: ${lead.model}`);
  if (lead.year) facts.push(`Ano: ${lead.year}`);
  if (lead.plate) facts.push(`Placa: ${lead.plate}`);

  if (facts.length > 0) {
    return [
      'Recebi os dados principais. Vou encaminhar para um consultor preparar sua cotacao real e continuar por aqui.',
      '',
      ...facts,
    ].join('\n');
  }

  return 'Entendi. Vou encaminhar para um consultor continuar seu atendimento por aqui.';
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FORBIDDEN_REPLY_TERMS = /\b(seguro|seguradora|ap[oó]lice|sinistro|pr[eê]mio)\b/i;

function isLikelyIncompleteReply(reply = '') {
  const cleaned = String(reply || '').trim().replace(/[“”"']+$/g, '').trim();
  if (!cleaned) return true;
  if (/[,:;]$/.test(cleaned)) return true;

  const normalized = normalizeText(cleaned);
  if (/\b(a|o|as|os|e|de|do|da|dos|das|em|para|pra|por|com|ou|que|onde|se|como)$/i.test(normalized)) {
    return cleaned.length > 45;
  }

  return cleaned.length > 80 && !/[.!?)]$/.test(cleaned);
}

function hasTooManyQuestions(reply = '') {
  return (String(reply || '').match(/\?/g) || []).length > 1;
}

function isShortGreeting(normalized = '') {
  return /^(oi|ola|opa|bom dia|boa tarde|boa noite)( tudo bem| tudo bom| tudo joia| td bem| td joia| beleza)?$/.test(normalized);
}

function isShortThanks(normalized = '') {
  return /^(obg|obrigado|obrigada|valeu|vlw)( viu| mesmo| ta| tá)?$/.test(normalized);
}

function hasDeterministicSafeTopic(normalized = '') {
  return isShortGreeting(normalized)
    || isShortThanks(normalized)
    || /como funciona|mutualismo|rateio|associacao/.test(normalized)
    || /roubo|furto/.test(normalized)
    || /assistencia|reboque|guincho|chaveiro|24h/.test(normalized)
    || /seguro|seguradora|apolice|sinistro|premio/.test(normalized);
}

function buildSafeSalesFallback({ latestUserMessage = '', allowedQuestion = null } = {}) {
  const normalized = normalizeText(latestUserMessage);

  if (isShortThanks(normalized)) {
    return 'Por nada! Se precisar, e so chamar.';
  }

  if (isShortGreeting(normalized)) {
    const greeting = normalized.startsWith('bom dia')
      ? 'Bom dia!'
      : normalized.startsWith('boa tarde')
        ? 'Boa tarde!'
        : normalized.startsWith('boa noite')
          ? 'Boa noite!'
          : 'Oi!';
    return `${greeting} Tudo bem por aqui. Como posso te ajudar?`;
  }

  if (/como funciona|mutualismo|rateio|associacao/.test(normalized)) {
    return 'A Moove trabalha com protecao veicular em modelo de associacao e rateio. Um consultor pode te explicar os detalhes certinho por aqui.';
  }

  if (/roubo|furto/.test(normalized)) {
    return 'Sim, a protecao pode incluir roubo e furto conforme as regras do plano. Um consultor confirma os detalhes certinho por aqui.';
  }

  if (/assistencia|reboque|guincho|chaveiro|24h/.test(normalized)) {
    return 'Sim, existe assistencia 24h com servicos como reboque, conforme as regras do plano. Se for para acionar agora, encaminho para o suporte.';
  }

  if (/seguro|seguradora|apolice|sinistro|premio/.test(normalized)) {
    return 'A Moove trabalha com protecao veicular em modelo de associacao e rateio. Se voce ja e associado e teve um evento, encaminho para o atendimento responsavel.';
  }

  return allowedQuestion || 'Me conta se voce quer entender a protecao ou fazer uma cotacao.';
}

export async function buildHumanizedReply(config, {
  mode = 'sales',
  step = '',
  intent = '',
  lead = {},
  latestUserMessage = '',
  requiredAction = '',
  allowedQuestion = null,
  companyRules = null,
  relevantKnowledge = '',
  tone = 'comercial_leve'
} = {}) {
  if (mode === 'operational' && lead.clientReply) {
    return lead.clientReply;
  }

  if (mode === 'sales' && requiredAction === 'execute_handoff') {
    return buildSalesHandoffReply(lead);
  }

  if (mode === 'sales' && requiredAction === 'stop_automation') {
    return 'Tudo bem, sem problema. Nao vou insistir. Se precisar, e so chamar.';
  }

  if (
    mode === 'sales'
    && allowedQuestion
    && ['ask_model_year', 'ask_plate', 'ask_ddd_phone'].includes(requiredAction)
  ) {
    return allowedQuestion;
  }

  if (
    mode === 'sales'
    && requiredAction === 'respond'
    && hasDeterministicSafeTopic(normalizeText(latestUserMessage))
  ) {
    return buildSafeSalesFallback({ latestUserMessage, allowedQuestion });
  }

  let activeRules = companyRules;
  if (!activeRules || Object.keys(activeRules).length === 0) {
    try {
      const rulesPath = path.join(__dirname, '..', 'knowledge', 'company-rules.json');
      if (fs.existsSync(rulesPath)) {
        activeRules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
      }
    } catch (e) {
      console.warn('[Reply Builder] Failed to load company rules file:', e.message);
    }
  }
  activeRules = activeRules || {};
  
  // Format rules for the prompt
  const safetyRulesText = Array.isArray(activeRules.safety_rules)
    ? activeRules.safety_rules.map(r => `- ${r}`).join('\n')
    : '';

  const forbiddenTermsText = Array.isArray(activeRules.forbidden_terms)
    ? activeRules.forbidden_terms.join(', ')
    : 'seguro, seguradora, apólice, sinistro, prêmio';

  const preferredTermsText = activeRules.preferred_terms
    ? Object.entries(activeRules.preferred_terms).map(([k, v]) => `- Use "${v}" no lugar de "${k}"`).join('\n')
    : '';

  const systemPrompt = `Você é um atendente humano da Moove Proteção Veicular chamado ${config.agentName || 'Júlia'} respondendo a um cliente no WhatsApp.
Sua missão é responder à última mensagem do cliente de forma extremamente natural, curta e conversacional.

=== DIRETRIZES DE ESTILO (WhatsApp Humano) ===
- Escreva de forma fluida, como se estivesse digitando no celular.
- Use frases curtas. Nunca mande textos longos ou listas longas.
- Português brasileiro natural, sem formalidade excessiva (NÃO use termos como "Prezado", "Prezada", "Caro cliente", "Estamos à disposição").
- Faça apenas UMA pergunta por mensagem (se necessário). Nunca faça mais de uma pergunta de uma vez.
- Não repita perguntas que o cliente já respondeu anteriormente na conversa.
- Tom de voz: ${tone === 'comercial_leve' ? 'Comercial leve e amigável' : 'Operacional direto, empático e calmo'}.
- Regra de Emojis: 
  * Se o modo for "operational" (financeiro, cobrança, boleto, bloqueio de app, cancelamento, etc.) ou se o cliente estiver irritado: ZERO emojis.
  * Se o modo for "sales" e o tom for leve: no máximo 1 emoji discreto por mensagem.

=== REGRAS DE NEGÓCIO DA MOOVE ===
${safetyRulesText}
${preferredTermsText}
- TERMOS PROIBIDOS (NUNCA utilize em hipótese alguma): ${forbiddenTermsText}

=== AÇÃO ATUAL REQUERIDA ===
Você DEVE focar sua resposta em realizar a seguinte ação:
- Ação Requerida: ${requiredAction}
- Pergunta Autorizada: ${allowedQuestion || 'Nenhuma pergunta adicional no momento.'}

=== CONHECIMENTO DISPONÍVEL ===
Use apenas as informações abaixo se precisar responder a alguma dúvida:
${relevantKnowledge || 'Nenhum conhecimento extra necessário para esta ação.'}

Instrução Final: Escreva APENAS a mensagem que será enviada para o cliente. Não inclua observações, tags, introduções ou explicações adicionais.`;

  const userMessage = `Última mensagem do cliente: "${latestUserMessage || ''}"
Histórico recente da conversa:
${(lead.history || []).slice(-6).map(h => `${h.role === 'assistant' ? 'Assistente' : 'Cliente'}: ${h.content}`).join('\n')}`;

  const context = {
    systemPrompt,
    history: [], // Let humanized builder process context cleanly within the instructions to avoid model overriding step logic
    userMessage
  };

  try {
    const reply = await callAI(config, context, { purpose: 'reply', mode });
    const cleaned = reply.trim().replace(/^"|"$/g, ''); // Clean up any wrapping quotes
    if (
      mode === 'sales'
      && (FORBIDDEN_REPLY_TERMS.test(cleaned) || isLikelyIncompleteReply(cleaned) || hasTooManyQuestions(cleaned))
    ) {
      return buildSafeSalesFallback({ latestUserMessage, allowedQuestion });
    }
    return cleaned;
  } catch (err) {
    console.error('[Reply Builder] Error calling AI for humanized reply:', err.message);
    // Return standard playbook fallback reply on failure
    if (mode === 'operational' && lead.clientReply) {
      return lead.clientReply;
    }
    if (mode === 'sales' && requiredAction === 'execute_handoff') {
      return buildSalesHandoffReply(lead);
    }
    if (mode === 'sales' && requiredAction === 'stop_automation') {
      return 'Tudo bem, sem problema. Nao vou insistir. Se precisar, e so chamar.';
    }
    if (mode === 'sales') {
      return buildSafeSalesFallback({ latestUserMessage, allowedQuestion });
    }
    return allowedQuestion || 'Como posso te ajudar com o veículo hoje?';
  }
}
