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
    return reply.trim().replace(/^"|"$/g, ''); // Clean up any wrapping quotes
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
    return allowedQuestion || 'Como posso te ajudar com o veículo hoje?';
  }
}
