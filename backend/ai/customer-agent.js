import { getLeadRealPhone } from '../phone-utils.js';
import { getKnowledgeForMessage } from '../knowledge/knowledge-service.js';
import { callAI } from './gemini.js';
import {
  CUSTOMER_AGENT_ACTIONS,
  CUSTOMER_AGENT_INTENTS,
  CUSTOMER_AGENT_RESPONSE_SCHEMA,
} from './customer-agent-schema.js';

const OPERATIONAL_INTENTS = new Set([
  'human_requested',
  'assistance_request',
  'event_report',
  'boleto_request',
  'regularization_request',
  'payment_claimed',
  'receipt_available',
  'receipt_received',
  'reactivation_request',
  'cancel_request',
  'app_blocked',
  'billing_disputed',
  'inspection_pending',
  'system_check_request',
]);

const FACTUAL_INTENTS = new Set([
  'company_question',
  'coverage_question',
  'eligibility_question',
  'sales_price_request',
]);

const SAFE_UNKNOWLEDGE_REPLY = 'Não encontrei essa informação confirmada na minha base. Encaminhei sua dúvida para um consultor te responder com segurança.';
const SAFE_OPERATIONAL_REPLY = 'Entendi o que você precisa. Encaminhei seu atendimento para um consultor continuar por aqui.';
const SAFE_STOP_REPLY = 'Tudo bem, sem problema. Não vou insistir. Se precisar, é só chamar.';
const MODEL_YEAR_QUESTION = 'Para eu adiantar sua cotação, qual é o modelo e o ano do veículo?';
const PLATE_WITHHELD_REPLY = 'Certo, não precisa informar a placa agora. Encaminhei seus dados para um consultor continuar a cotação por aqui.';
const PLATE_EXPLANATION_REPLY = 'A placa ajuda apenas a identificar o veículo e organizar a cotação, mas é opcional nesta etapa.';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function cleanString(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanStringList(value, maxItems = 8, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeKnowledgeId(value = '') {
  return cleanString(value, 120)
    .replace(/^\[?\s*FONTE\s+/i, '')
    .replace(/\]\s*$/, '')
    .trim();
}

export function redactSensitiveText(value = '') {
  return String(value || '')
    .replace(/\b[A-Z]{3}[-\s]?\d[A-Z0-9][-\s]?\d{2}\b/gi, '[placa informada]')
    .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, '[CPF informado]')
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[telefone informado]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email informado]');
}

function normalizeBusinessTerms(value = '') {
  const normalized = String(value || '')
    .replace(/\bn[aã]o,\s*(?:a\s+moove\s+)?n[aã]o\s+[eé]\s+(?:uma\s+)?seguradora\b/gi, 'A Moove é uma associação de proteção veicular')
    .replace(/\b(?:a\s+moove\s+)?n[aã]o\s+[eé]\s+(?:uma\s+)?seguradora\b/gi, 'A Moove é uma associação de proteção veicular')
    .replace(/\bn[aã]o\s+somos\s+(?:uma\s+)?seguradora\b/gi, 'somos uma associação de proteção veicular')
    .replace(/,\s*(?:mas\s+)?n[aã]o\s+(?:uma\s+)?seguradora\b/gi, ', com atuação baseada em mutualismo')
    .replace(/\bn[aã]o\s+(?:[eé]|se\s+trata\s+de)\s+(?:um\s+)?seguro\b/gi, 'é proteção veicular')
    .replace(/\bseguradoras?\b/gi, 'associação')
    .replace(/\bsegurados?\b/gi, 'associados')
    .replace(/\bseguros?\b/gi, 'proteção veicular')
    .replace(/\bapólices?\b/gi, 'proposta de adesão')
    .replace(/\bsinistros?\b/gi, 'eventos')
    .replace(/\bprêmios?\b/gi, 'mensalidade');
  const mutualismMatches = normalized.match(/mutualismo/gi) || [];
  return mutualismMatches.length > 1
    ? normalized.replace(/,?\s*com atuação baseada em mutualismo/gi, '')
    : normalized;
}

function inferFactualIntentFromKnowledgeIds(ids = []) {
  const joined = ids.join(' ').toLowerCase();
  if (/coverage-rules|o-que-cobre|o-que-nao-cobre|assistencia-24h|cobertura-de-vidros|carro-reserva|indenizacao|cota-de-participacao/.test(joined)) {
    return 'coverage_question';
  }
  if (/accepted[-_]vehicles|veiculos-aceitos|zero[-_]km|tracker|rastreador|inspection|vistoria/.test(joined)) {
    return 'eligibility_question';
  }
  if (/company-profile|what_is_moove|is_insurance_company|phone_contact|monthly_payment|mensalidade/.test(joined)) {
    return 'company_question';
  }
  return null;
}

function enforceSingleQuestion(value = '') {
  const text = String(value || '').trim();
  const firstQuestion = text.indexOf('?');
  if (firstQuestion === -1) return text;
  const secondQuestion = text.indexOf('?', firstQuestion + 1);
  if (secondQuestion === -1) return text;
  return text.slice(0, firstQuestion + 1).trim();
}

function limitWhatsappReply(value = '', maxLength = 520) {
  const text = cleanString(enforceSingleQuestion(normalizeBusinessTerms(value)), 1200);
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  const sentenceEnd = Math.max(shortened.lastIndexOf('.'), shortened.lastIndexOf('?'), shortened.lastIndexOf('!'));
  return (sentenceEnd >= 180 ? shortened.slice(0, sentenceEnd + 1) : shortened).trim();
}

function ensureModelYearQuestion(value = '') {
  const segments = String(value || '').match(/[^.!?]+[.!?]?/g) || [];
  const usefulSegments = segments.filter((segment) => {
    const normalized = segment.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (segment.includes('?')) return false;
    if (/\bmodelo\b/.test(normalized) && /\bano\b/.test(normalized)) return false;
    return true;
  });
  const prefix = usefulSegments.join(' ').replace(/\s+/g, ' ').trim();
  return limitWhatsappReply(prefix ? `${prefix} ${MODEL_YEAR_QUESTION}` : MODEL_YEAR_QUESTION);
}

function hasImpossiblePromise(value = '') {
  const normalized = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [
    /(?:reboque|guincho).{0,35}(?:a caminho|chegando|foi acionado)/,
    /(?:pagamento|boleto).{0,35}(?:confirmado|baixado|gerado|liberado)/,
    /(?:app|aplicativo).{0,35}(?:liberado|desbloqueado)/,
    /(?:consultei|verifiquei|conferi).{0,30}(?:sistema|cadastro|fipe)/,
    /(?:protecao|adesao|contrato).{0,30}(?:ativa|aprovada|concluida)/,
  ].some((pattern) => pattern.test(normalized));
}

function parseGeneratedObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.text === undefined) return raw;
  const text = typeof raw === 'object' && raw ? raw.text : raw;
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

function normalizeMemory(value = {}, previous = {}) {
  return {
    customerGoal: cleanString(value.customerGoal || previous.customerGoal, 180),
    currentTopic: cleanString(value.currentTopic || previous.currentTopic, 120),
    pendingQuestion: cleanString(value.pendingQuestion, 180),
    objections: cleanStringList([...(previous.objections || []), ...(value.objections || [])], 8, 120),
    answeredTopics: cleanStringList([...(previous.answeredTopics || []), ...(value.answeredTopics || [])], 12, 120),
  };
}

function normalizeExtractedFacts(value = {}) {
  const vehicleModel = cleanString(value.vehicleModel, 80);
  const yearMatch = cleanString(value.vehicleYear, 10).match(/\b(19\d{2}|20\d{2})\b/);
  const maximumYear = new Date().getFullYear() + 1;
  const vehicleYear = yearMatch && Number(yearMatch[1]) <= maximumYear ? yearMatch[1] : '';
  return {
    vehicleModel: vehicleModel.length >= 2 ? vehicleModel : '',
    vehicleYear,
  };
}

function isPlateRefusal(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return [
    /\bprefiro\s+(?:nao\s+)?(?:passar|informar|mandar)(?:\s+(?:a\s+)?placa)?\b/,
    /\bnao\s+(?:quero|vou)\s+(?:passar|informar|mandar)(?:\s+(?:a\s+)?placa)?\b/,
    /\bsem\s+(?:a\s+)?placa\b/,
  ].some((pattern) => pattern.test(normalized));
}

function actionForLeadState(action, lead = {}) {
  const hasModelYear = !!lead.model && !!lead.year;
  if (action === 'ask_plate_optional' && (!hasModelYear || lead.plateWithheld || lead.plateRequestedAt)) {
    return hasModelYear ? 'handoff_sales' : 'ask_model_year';
  }
  if (action === 'ask_model_year' && hasModelYear) {
    return lead.plate || lead.plateWithheld || lead.plateRequestedAt
      ? 'handoff_sales'
      : 'ask_plate_optional';
  }
  return action;
}

export function validateCustomerAgentTurn(raw, {
  lead = {},
  message = '',
  knowledge = { ids: [], confidence: 'low' },
  provider = 'unknown',
  model = 'unknown',
} = {}) {
  const parsed = parseGeneratedObject(raw);
  const validKnowledgeIds = new Set(knowledge.ids || []);
  let primaryIntent = CUSTOMER_AGENT_INTENTS.includes(parsed.primaryIntent)
    ? parsed.primaryIntent
    : 'unknown';
  let secondaryIntent = parsed.secondaryIntent === 'none' || CUSTOMER_AGENT_INTENTS.includes(parsed.secondaryIntent)
    ? parsed.secondaryIntent
    : 'none';
  let action = CUSTOMER_AGENT_ACTIONS.includes(parsed.action) ? parsed.action : 'clarify';
  let mode = parsed.mode === 'operational' || OPERATIONAL_INTENTS.has(primaryIntent)
    ? 'operational'
    : 'sales';
  let answerStatus = ['answered', 'partial', 'unknown', 'not_applicable'].includes(parsed.answerStatus)
    ? parsed.answerStatus
    : 'unknown';
  const knowledgeIds = [...new Set(
    cleanStringList(parsed.knowledgeIds, 10, 120)
      .map(normalizeKnowledgeId)
      .filter((id) => validKnowledgeIds.has(id)),
  )];
  const extractedFacts = normalizeExtractedFacts(parsed.extractedFacts);
  const sourceInferredIntent = inferFactualIntentFromKnowledgeIds(knowledgeIds);

  if (primaryIntent === 'human_requested'
    && action === 'respond'
    && /assistente\s+de\s+atendimento|n[aã]o\s+sou\s+(?:uma\s+)?pessoa/i.test(String(parsed.reply || ''))) {
    primaryIntent = 'assistant_identity';
    mode = 'sales';
  }
  if (lead.plateRequestedAt
    && primaryIntent === 'company_question'
    && action === 'respond'
    && /placa/i.test(String(parsed.reply || ''))) {
    primaryIntent = 'objection';
    answerStatus = 'not_applicable';
  }
  const plateRefused = !!lead.plateRequestedAt && isPlateRefusal(message);
  if (plateRefused) {
    primaryIntent = 'sales_quote';
    secondaryIntent = 'none';
    action = 'handoff_sales';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }

  if (primaryIntent === 'sales_quote'
    && secondaryIntent === 'none'
    && ['answered', 'partial'].includes(answerStatus)
    && knowledgeIds.length > 0) {
    primaryIntent = sourceInferredIntent || 'company_question';
    secondaryIntent = 'sales_quote';
  } else {
    if (sourceInferredIntent
      && FACTUAL_INTENTS.has(primaryIntent)
      && primaryIntent !== 'sales_price_request') {
      primaryIntent = sourceInferredIntent;
    }
    if (FACTUAL_INTENTS.has(primaryIntent)
      && secondaryIntent === 'none'
      && ['ask_model_year', 'ask_plate_optional'].includes(action)) {
      secondaryIntent = 'sales_quote';
    }
  }

  const requestedAction = action;
  action = actionForLeadState(action, {
    ...lead,
    model: lead.model || extractedFacts.vehicleModel,
    year: lead.year || extractedFacts.vehicleYear,
  });
  if (mode === 'operational' && action === 'handoff_sales') action = 'handoff_operational';
  if (action === 'handoff_operational') mode = 'operational';

  const factualAnswerNeedsEvidence = FACTUAL_INTENTS.has(primaryIntent)
    && ['answered', 'partial'].includes(answerStatus);
  let reply = limitWhatsappReply(parsed.reply);
  const hasModelYear = !!(lead.model || extractedFacts.vehicleModel) && !!(lead.year || extractedFacts.vehicleYear);
  const isRealPriceRequest = primaryIntent === 'sales_price_request' || secondaryIntent === 'sales_price_request';
  const priceReadyForHandoff = isRealPriceRequest && hasModelYear;
  if (priceReadyForHandoff) {
    action = 'handoff_sales';
    mode = 'sales';
    answerStatus = 'unknown';
    reply = `Com o modelo e o ano já consigo adiantar seu pedido. Encaminhei para um consultor preparar o valor real e continuar por aqui.`;
  }
  if (plateRefused) reply = PLATE_WITHHELD_REPLY;
  if (!plateRefused
    && lead.plateRequestedAt
    && primaryIntent === 'objection'
    && /placa/i.test(reply)
    && /rastream|assist[eê]ncia|consult(?:ei|ar)|sistema/i.test(reply)) {
    reply = PLATE_EXPLANATION_REPLY;
  }
  if (primaryIntent === 'no_interest' && action === 'stop') {
    mode = 'sales';
    answerStatus = 'not_applicable';
    reply = SAFE_STOP_REPLY;
  }
  if (!priceReadyForHandoff && requestedAction === 'ask_plate_optional' && action === 'handoff_sales' && (lead.plateWithheld || lead.plateRequestedAt)) {
    reply = PLATE_WITHHELD_REPLY;
  }
  if (!priceReadyForHandoff
    && factualAnswerNeedsEvidence
    && (knowledgeIds.length === 0 || knowledge.confidence === 'low')) {
    answerStatus = 'unknown';
    action = 'handoff_sales';
    mode = 'sales';
    reply = SAFE_UNKNOWLEDGE_REPLY;
  }

  if (!priceReadyForHandoff && answerStatus === 'unknown' && !['greeting', 'thanks', 'no_interest'].includes(primaryIntent)) {
    action = mode === 'operational' ? 'handoff_operational' : 'handoff_sales';
    reply = mode === 'operational' ? SAFE_OPERATIONAL_REPLY : SAFE_UNKNOWLEDGE_REPLY;
  }

  if (hasImpossiblePromise(reply)) {
    action = 'handoff_operational';
    mode = 'operational';
    answerStatus = 'unknown';
    reply = SAFE_OPERATIONAL_REPLY;
  }

  if (action === 'ask_model_year') reply = ensureModelYearQuestion(reply);
  if (!reply) {
    reply = action === 'handoff_operational' ? SAFE_OPERATIONAL_REPLY : SAFE_UNKNOWLEDGE_REPLY;
    action = mode === 'operational' ? 'handoff_operational' : 'handoff_sales';
  }

  const phoneResolved = !!getLeadRealPhone(lead);
  return {
    reply,
    primaryIntent,
    secondaryIntent,
    mode,
    action,
    confidence: clamp(parsed.confidence, 0, 1),
    emotion: ['neutral', 'confused', 'interested', 'hesitant', 'irritated', 'angry'].includes(parsed.emotion)
      ? parsed.emotion
      : 'neutral',
    answerStatus,
    knowledgeIds,
    reasoningSummary: cleanString(parsed.reasoningSummary, 240),
    handoffReason: cleanString(parsed.handoffReason, 240),
    handoffSummary: cleanString(parsed.handoffSummary, 700),
    memory: normalizeMemory(parsed.memory, lead.aiMemory || {}),
    extractedFacts,
    plateWithheld: plateRefused || !!lead.plateWithheld,
    shouldHandoff: action === 'handoff_sales' || action === 'handoff_operational',
    shouldAskPhone: (action === 'handoff_sales' || action === 'handoff_operational') && !phoneResolved,
    shouldStopAutomation: action === 'stop' || action === 'handoff_sales' || action === 'handoff_operational',
    provider,
    model,
    architecture: 'customer-agent-v2',
  };
}

function buildLeadSnapshot(lead = {}) {
  return {
    vehicleModel: lead.model || '',
    vehicleYear: lead.year || '',
    plateKnown: !!lead.plate,
    plateWithheld: !!lead.plateWithheld,
    plateAskedBefore: !!lead.plateRequestedAt || lead.stage === 'ask_plate',
    phoneResolved: !!getLeadRealPhone(lead),
    currentStatus: lead.status || 'new',
    currentStage: lead.stage || 'new',
    previousIntent: lead.lastIntent || '',
    memory: lead.aiMemory || {},
  };
}

function buildRecentConversation(lead = {}, latestMessage = '') {
  const entries = (lead.history || [])
    .filter((entry) => entry?.content)
    .slice(-10)
    .map((entry) => `${entry.role === 'assistant' ? 'ASSISTENTE' : 'CLIENTE'}: ${redactSensitiveText(entry.content)}`);
  const safeLatest = redactSensitiveText(latestMessage);
  if (!entries.length || !entries[entries.length - 1].endsWith(safeLatest)) {
    entries.push(`CLIENTE: ${safeLatest}`);
  }
  return entries.join('\n');
}

export function buildCustomerAgentContext({ config = {}, lead = {}, message = '', knowledge = {} } = {}) {
  const agentName = config.agentName || 'Júlia';
  const companyName = config.companyName || 'Moove Proteção Veicular';
  const systemPrompt = `Você é ${agentName}, assistente de atendimento e vendas da ${companyName} no WhatsApp.

MISSÃO
- Entender o que o cliente realmente quer, responder dúvidas sobre a Moove e conduzir interessados até um consultor fechar a adesão.
- Você é a inteligência principal da conversa. Escreva respostas novas e adequadas ao contexto; não imite um menu ou roteiro rígido.
- Quando houver pergunta e interesse em cotação na mesma mensagem, responda a pergunta primeiro e depois avance a cotação com no máximo uma pergunta.
- Reconheça uma intenção principal e, quando existir, uma intenção secundária.
- REGRA DE PRIORIDADE: se houver dúvida factual e cotação juntas, a dúvida factual é sempre primaryIntent e sales_quote é secondaryIntent.

VERDADE E CONHECIMENTO
- Toda afirmação factual sobre a empresa, benefícios, regras, valores, cobertura, elegibilidade ou procedimentos deve estar sustentada por uma ou mais fontes fornecidas.
- Copie os IDs exatos das fontes usadas para knowledgeIds. Nunca mostre esses IDs ao cliente.
- Se a informação não estiver nas fontes, não complete com conhecimento geral e não suponha. Use answerStatus=unknown e encaminhe para um consultor.
- Uma fonte pode sustentar apenas o que ela realmente diz. Não acrescente condições, garantias ou exceções inexistentes.

CONVERSA E VENDA
- Português brasileiro natural, humano, curto e apropriado ao jeito do cliente. Adapte-se a abreviações e linguagem informal sem exagerar.
- Normalmente use de uma a três frases curtas. Não use listas, salvo se o cliente pedir comparação ou detalhes.
- Responda somente o necessário para a pergunta atual; não despeje tabelas ou todas as regras quando um resumo resolve.
- Faça no máximo UMA pergunta por mensagem e nunca repita uma pergunta respondida.
- Não desvie uma dúvida para cotação antes de responder. Depois de responder, proponha o próximo passo comercial com leveza quando fizer sentido.
- Explique por que a Moove pode ser uma ótima escolha usando diferenciais presentes nas fontes. Não afirme superioridade absoluta sem prova.
- Se o cliente quiser cotação e faltarem modelo ou ano, use ask_model_year. Se ele pedir preço real e modelo e ano já forem conhecidos, use handoff_sales; não peça placa antes de encaminhar. A placa nunca é obrigatória e não pode virar barreira.
- A placa serve apenas para identificar o veículo e organizar a cotação. Não diga que ela serve para consultar sistema, rastreamento, assistência, cadastro ou valores. Se o cliente não quiser informá-la, encaminhe a cotação sem insistir.
- Se o cliente estiver pronto, pedir preço real, pedir consultor ou já fornecer os dados principais, use handoff_sales.
- Para objeções, responda a preocupação específica antes de sugerir o próximo passo.
- Se o cliente recusar claramente, use stop e não insista.
- Se ele apenas recusar a cotação ou pedir para parar, confirme que não vai insistir. Não diga que abriu cancelamento, solicitação ou encaminhamento. Cancelamento da proteção de um associado é outra intenção e exige handoff_operational.
- Se o cliente perguntar o preço real ou "quanto fica", não responda com cota de participação, franquia ou outra taxa que ele não perguntou. Peça modelo e ano ou encaminhe ao consultor, conforme os dados já conhecidos.

SEGURANÇA
- A Moove é uma associação de proteção veicular, não uma seguradora.
- Nunca use na resposta: seguro, seguradora, apólice, sinistro ou prêmio.
- Nunca invente preço, desconto, FIPE, aprovação, ativação ou contratação concluída.
- Nunca diga que consultou cadastro ou sistema se não existe resultado de ferramenta.
- Nunca prometa reboque a caminho, pagamento baixado, boleto gerado ou aplicativo liberado.
- Boleto, cobrança, inadimplência, pagamento, cancelamento, aplicativo, vistoria pendente, evento ocorrido, assistência atual ou pedido humano exigem handoff_operational.
- Não existem equipes separadas de suporte ou financeiro. Todo encaminhamento é para um consultor.
- Se a ação for handoff_sales ou handoff_operational, escreva reply como confirmação curta para ser enviada SOMENTE depois que o backend confirmar a entrega ao consultor.
- Se perguntarem se você é humana, diga apenas que é a assistente de atendimento da Moove; não finja ser uma pessoa.
- Para perguntas sobre sua identidade, use primaryIntent=assistant_identity e action=respond. Não trate isso como pedido de atendimento humano.
- Preencha extractedFacts somente com modelo e ano que o cliente realmente informou. Use strings vazias quando ele não informou.

AÇÕES
- respond: responder sem coletar dado agora.
- ask_model_year: responder o que foi perguntado e pedir modelo e ano em uma única pergunta.
- ask_plate_optional: explicar a utilidade e perguntar a placa sem obrigar.
- handoff_sales: encaminhar interesse comercial, dúvida sem resposta ou cliente pronto.
- handoff_operational: encaminhar caso operacional ou crítico.
- stop: encerrar respeitosamente.
- clarify: fazer uma única pergunta curta quando a mensagem for realmente ambígua.

FORMATO JSON OBRIGATÓRIO
- Retorne somente um objeto JSON válido, sem markdown e sem texto fora dele.
- primaryIntent e secondaryIntent usam apenas: ${CUSTOMER_AGENT_INTENTS.join(', ')}. secondaryIntent pode ser none.
- action usa apenas: ${CUSTOMER_AGENT_ACTIONS.join(', ')}.
- mode: sales ou operational. confidence: número de 0 a 1. emotion: neutral, confused, interested, hesitant, irritated ou angry.
- answerStatus: answered, partial, unknown ou not_applicable. knowledgeIds é uma lista de IDs exatos.
- Inclua todas estas chaves: reply, primaryIntent, secondaryIntent, mode, action, confidence, emotion, answerStatus, knowledgeIds, reasoningSummary, handoffReason, handoffSummary, memory, extractedFacts.
- memory contém EXATAMENTE customerGoal, currentTopic, pendingQuestion, objections e answeredTopics. Não inclua currentStage, previousIntent ou qualquer outra chave.
- extractedFacts contém vehicleModel e vehicleYear; use strings vazias quando ausentes.`;

  const userMessage = `ESTADO ATUAL DO ATENDIMENTO
${JSON.stringify(buildLeadSnapshot(lead), null, 2)}

CONFIANÇA DA BUSCA DE CONHECIMENTO: ${knowledge.confidence || 'low'}
FONTES DISPONÍVEIS
${knowledge.text || '(nenhuma fonte confirmou o assunto)'}

CONVERSA RECENTE
${buildRecentConversation(lead, message) || '(sem histórico)'}

ÚLTIMA MENSAGEM A RESPONDER
${redactSensitiveText(message)}`;

  return { systemPrompt, history: [], userMessage };
}

export async function runCustomerAgent({
  config = {},
  lead = {},
  message = '',
  knowledge = null,
  generate = callAI,
} = {}) {
  const resolvedKnowledge = knowledge || await getKnowledgeForMessage(message);
  const context = buildCustomerAgentContext({ config, lead, message, knowledge: resolvedKnowledge });
  const generated = await generate(config, context, {
    purpose: 'customer_agent',
    mode: 'sales',
    responseSchema: CUSTOMER_AGENT_RESPONSE_SCHEMA,
    returnMetadata: true,
  });
  const metadata = generated && typeof generated === 'object' && generated.text !== undefined
    ? generated
    : { text: generated, provider: 'injected', model: 'injected' };
  return validateCustomerAgentTurn(metadata.text, {
    lead,
    message,
    knowledge: resolvedKnowledge,
    provider: metadata.provider,
    model: metadata.model,
  });
}

export function applyCustomerAgentTurnToLead(lead = {}, turn = {}) {
  const now = new Date().toISOString();
  lead.aiMemory = turn.memory || lead.aiMemory || {};
  lead.aiArchitecture = turn.architecture || 'customer-agent-v2';
  lead.aiProviderLastUsed = turn.provider || null;
  lead.aiModelLastUsed = turn.model || null;
  lead.aiConfidence = turn.confidence;
  lead.aiAnswerStatus = turn.answerStatus;
  lead.aiKnowledgeIds = turn.knowledgeIds || [];
  lead.aiDecisionReason = turn.reasoningSummary || '';
  lead.lastIntent = turn.primaryIntent || 'unknown';
  lead.lastDetectedIntent = lead.lastIntent;
  lead.secondaryIntent = turn.secondaryIntent === 'none' ? null : turn.secondaryIntent;
  lead.customerEmotion = turn.emotion || 'neutral';
  lead.conversationMode = turn.mode || 'sales';
  lead.operationalStatus = turn.action || 'respond';
  lead.lastAgentTurnAt = now;
  if (!lead.model && turn.extractedFacts?.vehicleModel) lead.model = turn.extractedFacts.vehicleModel;
  if (!lead.year && turn.extractedFacts?.vehicleYear) lead.year = turn.extractedFacts.vehicleYear;
  if (turn.handoffSummary) lead.handoffSummary = turn.handoffSummary;
  if (turn.handoffReason) lead.pendingHandoffReason = turn.handoffReason;
  if (turn.action === 'ask_plate_optional') lead.plateRequestedAt = now;
  if (turn.plateWithheld) {
    lead.plateWithheld = true;
    lead.plateWithheldAt = lead.plateWithheldAt || now;
  }
  return lead;
}

export function customerAgentTurnToDecision(turn = {}, lead = {}) {
  const stepMap = {
    respond: 'answer_question',
    ask_model_year: 'ask_model_year',
    ask_plate_optional: 'ask_plate',
    handoff_sales: 'qualified',
    handoff_operational: 'human_handoff',
    stop: 'no_interest',
    clarify: 'clarify_intent',
  };
  return {
    intent: turn.primaryIntent || 'unknown',
    secondaryIntent: turn.secondaryIntent || 'none',
    emotion: turn.emotion || 'neutral',
    conversationMode: turn.mode || 'sales',
    step: stepMap[turn.action] || 'answer_question',
    nextAction: turn.action || 'respond',
    shouldHandoff: !!turn.shouldHandoff && !turn.shouldAskPhone,
    shouldAskPhone: !!turn.shouldAskPhone,
    shouldStopAutomation: !!turn.shouldStopAutomation,
    missingData: [
      ...(!lead.model ? ['model'] : []),
      ...(!lead.year ? ['year'] : []),
    ],
    forbiddenActions: [
      'nao_inventar_informacao',
      'nao_prometer_execucao',
      'nao_usar_termos_proibidos',
    ],
    riskLevel: ['angry', 'irritated'].includes(turn.emotion) || turn.mode === 'operational' ? 'alto' : 'baixo',
    allowedQuestion: null,
    clientReply: turn.reply || '',
    notes: turn.handoffReason || turn.reasoningSummary || 'Decidido pelo customer-agent-v2.',
    handoffDepartment: 'consultant',
    knowledgeIds: turn.knowledgeIds || [],
    handoffSummary: turn.handoffSummary || '',
    plateWithheld: !!turn.plateWithheld,
  };
}
