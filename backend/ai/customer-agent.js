import { getLeadRealPhone } from '../phone-utils.js';
import { getKnowledgeForMessage } from '../knowledge/knowledge-service.js';
import { callAI } from './gemini.js';
import { classifyDeterministicIntent } from './deterministic-intent.js';
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

const CUSTOMER_TYPES = new Set(['unknown', 'prospect', 'associated']);
const SALES_STAGES = new Set([
  'opening',
  'discovery',
  'education',
  'qualification',
  'objection',
  'ready_for_quote',
  'handoff',
  'operational',
  'closed',
]);

const SAFE_UNKNOWLEDGE_REPLY = 'Não encontrei essa informação confirmada na minha base. Encaminhei sua dúvida para um consultor te responder com segurança.';
const SAFE_OPERATIONAL_REPLY = 'Entendi o que você precisa. Encaminhei seu atendimento para um consultor continuar por aqui.';
const SAFE_STOP_REPLY = 'Tudo bem, sem problema. Não vou insistir. Se precisar, é só chamar.';
const SAFE_FIPE_REPLY = 'Não dá para garantir 100% da FIPE como regra geral. Encaminhei sua dúvida para um consultor confirmar as condições do seu caso.';
const SAFE_EVENT_PAYMENT_REPLY = 'Os eventos são avaliados conforme o regulamento, mas a confirmação depende da análise do caso. Encaminhei sua dúvida para um consultor explicar as condições com segurança.';
const SAFE_SALES_HANDOFF_REPLY = 'Encaminhei seu atendimento para um consultor continuar por aqui.';
const SAFE_OBJECTION_HANDOFF_REPLY = 'Entendi sua preocupação com essa condição. Encaminhei sua dúvida para um consultor esclarecer os detalhes do seu caso.';
const SAFE_OBJECTION_CONTINUATION = 'Entendo sua preocupação. O que você gostaria de esclarecer sobre esse ponto?';
const SAFE_HESITATION_REPLY = 'Sem problema. Ficou alguma dúvida que eu possa esclarecer?';
const TEMPORARY_WAIT_REPLIES = [
  'Claro, pode perguntar. Fico no aguardo.',
  'Tudo bem, pode confirmar com calma.',
  'Sem problema, aguardo você confirmar.',
];
const MODEL_YEAR_QUESTION = 'Para eu adiantar sua cotação, qual é o modelo e o ano do veículo?';
const MODEL_QUESTION = 'Para eu adiantar sua cotação, qual é o modelo do veículo?';
const YEAR_QUESTION = 'Para eu adiantar sua cotação, qual é o ano do veículo?';
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

function normalizeGeneratedList(value) {
  if (Array.isArray(value)) return value;
  const item = cleanString(value, 120);
  if (!item || /^(?:nenhum[ao]s?|n[aã]o|none|nothing|n[aã]o informado|sem informa[cç][aã]o)$/i.test(item)) return [];
  return [item];
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
  let normalized = String(value || '')
    .replace(/\bsocorro\s+m[uú]tuo\b/gi, 'mutualismo')
    .replace(/\b(?:a\s+moove\s+)?n[aã]o\s+[eé]\s+(?:uma\s+)?seguradora\s*,?\s*mas\s+sim\s+/gi, 'A Moove é ')
    .replace(/\bn[aã]o\s+somos\s+(?:uma\s+)?seguradora\s*,?\s*mas\s+sim\s+/gi, 'Somos ')
    .replace(/\bn[aã]o,\s*(?:a\s+moove\s+)?n[aã]o\s+[eé]\s+(?:uma\s+)?seguradora\b/gi, 'A Moove é uma associação de proteção veicular')
    .replace(/\b(?:a\s+moove\s+)?n[aã]o\s+[eé]\s+(?:uma\s+)?seguradora\b/gi, 'A Moove é uma associação de proteção veicular')
    .replace(/\bn[aã]o\s+somos\s+(?:uma\s+)?seguradora\s*,?\s*(?:mas\s+)?/gi, 'Somos uma associação de proteção veicular e ')
    .replace(/,\s*(?:mas\s+)?n[aã]o\s+(?:uma\s+)?seguradora\b/gi, ', com atuação baseada em mutualismo')
    .replace(/\bn[aã]o\s+(?:[eé]|se\s+trata\s+de)\s+(?:um\s+)?seguro\b/gi, 'é proteção veicular')
    .replace(/\bseguradoras?\b/gi, 'associação')
    .replace(/\bsegurados?\b/gi, 'associados')
    .replace(/\bseguros?\b/gi, 'proteção veicular')
    .replace(/\bapólices?\b/gi, 'proposta de adesão')
    .replace(/\bsinistros?\b/gi, 'eventos')
    .replace(/\bprêmios?\b/gi, 'mensalidade')
    .replace(/R\$(?=\d)/g, 'R$ ')
    .replace(/\b0800\s*100\s*1120\b/g, '0800 100 1120')
    .replace(/R\$\s*(\d+)\.\s+(\d{3})\b/g, 'R$ $1.$2');

  let associationClaimSeen = false;
  normalized = normalized.replace(
    /\b(?:a\s+moove(?:\s+proteção\s+veicular)?\s+[eé]|somos)\s+uma\s+associação(?:\s+civil)?(?:\s+sem\s+fins\s+lucrativos)?(?:\s+de\s+(?:benefícios\s+e\s+)?proteção\s+veicular)?/gi,
    (claim) => {
      if (!associationClaimSeen) {
        associationClaimSeen = true;
        return claim;
      }
      return '';
    },
  );
  normalized = normalized
    .replace(/([.!?])\s*,?\s*(?:mas|e)\s+/gi, '$1 ')
    .replace(/([.!?])\s*[,.]+/g, '$1')
    .replace(/,\s*(?:mas|e)\s+(?=[,.])/gi, '')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/(^|[.!?]\s+)([a-záéíóúâêôãõç])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/\s+/g, ' ')
    .trim();
  const mutualismMatches = normalized.match(/mutualismo/gi) || [];
  return mutualismMatches.length > 1
    ? normalized.replace(/,?\s*com atuação baseada em mutualismo/gi, '')
    : normalized;
}

function removeUnsupportedDeliveryOffers(value = '') {
  return String(value || '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/(?:posso|vou|consigo|quer que eu)\s+(?:te\s+)?(?:enviar|mandar|encaminhar|anexar).{0,60}\b(?:documento|regulamento|arquivo|pdf|link|foto)\b/i.test(sentence))
    .join(' ')
    .trim();
}

function removeUnsupportedSalesFlattery(value = '') {
  const withoutUnsupportedSentences = String(value || '')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(
      /(?:como\s+)?(?:a\s+nossa\s+)?cota[cç][aã]o\s+[eé]\s+personalizada(?:\s+de\s+acordo\s+com\s+[^,.;!?]+)?[,;]?\s*/gi,
      '',
    ))
    .map((sentence) => sentence.replace(
      /(?:na\s+moove,?\s*)?(?:prezamos|valorizamos|priorizamos)\s+(?:pela|a)\s+(?:transpar[eê]ncia|seguran[cç]a|qualidade)\s+e\s+/gi,
      '',
    ))
    .map((sentence) => sentence.replace(
      /,?\s+o\s+que\s+(?:nos\s+)?permite[^.!?]{0,80}\bproposta\s+(?:justa|ideal|vantajosa)\b/gi,
      '',
    ))
    .filter((sentence) => !/(?:[oó]tima|excelente|boa)\s+(?:escolha|iniciativa)|muito\s+popular|(?:carro|ve[ií]culo|modelo)\s+(?:excelente|incr[ií]vel|[oó]timo)|economia\s+significativa|(?:mais|muito)\s+(?:barat|econ[oô]mic)|superior\s+(?:a|[àa]s?)|an[aá]lise\s+(?:[eé]|fica)\s+(?:um\s+pouco\s+)?diferente|(?:buscamos|procuramos|nosso\s+foco\s+[eé]|focamos\s+em)\s+(?:oferecer\s+)?[^.!?]{0,100}(?:qualidade|transpar[eê]ncia|complet[ao]|seguran[cç]a|agilidade)|processo\s+(?:(?:[eé]\s+)?estruturado(?:\s+para\s+garantir)?|(?:[eé]|fica|existe\s+para|foi\s+estruturado\s+para)\s+(?:muito\s+)?(?:simples|r[aá]pido|[aá]gil|garantir\s+(?:a\s+)?(?:seguran[cç]a|transpar[eê]ncia)))|seguran[cç]a\s+e\s+agilidade|(?:esse|o)\s+per[ií]odo\s+[eé]\s+necess[aá]rio|(?:prote[cç][aã]o|valores?)\s+(?:s[aã]o\s+|[eé]\s+)?personalizad[oa]s?|valores?.{0,60}\b(?:perfil|plano)\b|garant\w*.{0,35}\b(?:prote[cç][aã]o|cobertura|pagamento|indeniza[cç][aã]o)\b/i.test(sentence))
    .filter((sentence) => !/\bproposta\s+(?:justa|ideal|vantajosa)\b/i.test(sentence))
    .filter((sentence) => !/\b(?:proteger|prote[cç][aã]o)[^.!?]{0,60}\b(?:[eé]|eh)\s+(?:essencial|fundamental)\b/i.test(sentence))
    .filter((sentence) => !/(?:esse|o)\s+per[ií]odo[^.!?]{0,45}\s+[eé]\s+necess[aá]rio/i.test(sentence))
    .filter((sentence) => !/\bprocesso[^.!?]{0,60}\s+(?:[eé]|parece)\s+(?:essencial|necess[aá]rio|indispens[aá]vel)\b/i.test(sentence))
    .filter((sentence) => !/\b(?:cota\s+de\s+participa[cç][aã]o|car[eê]ncia|regra|processo)[^.!?]{0,90}\b(?:equil[ií]brio|sustentabilidade)\b/i.test(sentence))
    .filter((sentence) => !/\bcota\s+de\s+participa[cç][aã]o[^.!?]{0,100}\b(?:fundamental|garant\w*|suporte)\b/i.test(sentence))
    .join(' ');
  return withoutUnsupportedSentences
    .replace(/,?\s+garant(?:indo|e)\s+(?:mais\s+)?transpar[eê]ncia(?:\s+em\s+todo\s+o\s+processo)?/gi, '')
    .replace(/,?\s+assegurando\s+(?:mais\s+)?(?:seguran[cç]a|agilidade|transpar[eê]ncia)(?:\s+em\s+todo\s+o\s+processo)?/gi, '')
    .replace(/\s+para\s+(?:assegurar|garantir)\s+(?:[oa]\s+)?(?:cumprimento|processo|seguran[cç]a|agilidade|transpar[eê]ncia)[^.!?]*/gi, '')
    .replace(/,?\s+visando\s+(?:a\s+)?(?:seguran[cç]a|agilidade|transpar[eê]ncia)[^.!?]*/gi, '')
    .replace(/\s+com\s+transpar[eê]ncia(?=[,.!?])/gi, '')
    .replace(/,?\s+sem\s+compromisso\b/gi, '')
    .replace(/\s+e\s+(?:seguran[cç]a|agilidade|transpar[eê]ncia)(?=[.!?])/gi, '')
    .trim();
}

function inferFactualIntentFromKnowledgeIds(ids = []) {
  const joined = ids.join(' ').toLowerCase();
  if (/coverage-rules|o-que-cobre|o-que-nao-cobre|assistencia-24h|cobertura-de-vidros|carro-reserva|indenizacao|cota-de-participacao|beneficios-possiveis/.test(joined)) {
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
  const text = String(value || '')
    .replace(/\s+ou,?\s+se\s+preferir,?\s+posso[^.!?]{0,160}\bconsultor\b[^.!?]*/gi, '')
    .replace(/((?:posso|quer\s+que\s+eu|gostaria\s+que\s+eu|voc[eê]\s+gostaria)[^?]{0,160})\s+ou\s+(?:voc[eê]\s+)?(?:prefere|quer|gostaria)[^?]*(\?)/gi, '$1$2')
    .replace(/((?:ficou|est[aá])[^?]{0,100})\s+ou\s+(?:voc[eê]\s+)?(?:gostaria|quer|prefere)[^?]*(\?)/gi, '$1?')
    .replace(/((?:gostaria\s+de\s+(?:entender|saber|esclarecer))[^?]{0,130})\s+ou\s+(?:voc[eê]\s+)?(?:prefere|quer|gostaria)[^?]*(\?)/gi, '$1?')
    .replace(/((?:o\s+que|qual|como)[^?]{0,130})\s+ou\s+(?:existe|tem|h[aá]|gostaria)[^?]*(\?)/gi, '$1?')
    .replace(/((?:^|[.!?]\s+)gostaria\s+de\s+(?:entender|saber|esclarecer)[^.!?]{0,180})\.(?=$)/gi, '$1?')
    .trim();
  const firstQuestion = text.indexOf('?');
  if (firstQuestion === -1) return text;
  const secondQuestion = text.indexOf('?', firstQuestion + 1);
  if (secondQuestion === -1) return text;
  return text.slice(0, firstQuestion + 1).trim();
}

function limitWhatsappReply(value = '', maxLength = 520) {
  const normalized = removeUnsupportedSalesFlattery(
    removeUnsupportedDeliveryOffers(normalizeBusinessTerms(value)),
  )
    .replace(/\b(?:s[oó]\s+precisa|precisa\s+apenas)\b/gi, 'precisa')
    .replace(/\b(?:o\s+)?senhor\(a\)/gi, 'voc\u00ea')
    .replace(/\p{Extended_Pictographic}|[\uFE0F\u200D]/gu, '');
  const text = cleanString(enforceSingleQuestion(normalized), 1200);
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  const sentenceEnd = Math.max(shortened.lastIndexOf('.'), shortened.lastIndexOf('?'), shortened.lastIndexOf('!'));
  return (sentenceEnd >= 180 ? shortened.slice(0, sentenceEnd + 1) : shortened).trim();
}

function ensureVehicleDataQuestion(value = '', { model = '', year = '' } = {}) {
  const targetQuestion = model && !year
    ? YEAR_QUESTION
    : year && !model
      ? MODEL_QUESTION
      : MODEL_YEAR_QUESTION;
  const segments = String(value || '').match(/[^.!?]+[.!?]?/g) || [];
  const usefulSegments = segments.filter((segment) => {
    const normalized = segment.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (segment.includes('?')) return false;
    if (/\bmodelo\b/.test(normalized) && /\bano\b/.test(normalized)) return false;
    if (/\b(?:precis|inform|pass|saber|dizer)\w*\b/.test(normalized)
      && (/\bmodelo\b/.test(normalized) || /\bano\b/.test(normalized))) return false;
    if (/\b(?:precis|saber|conhecer)\w*\b/.test(normalized)
      && /\b(?:mais|dados|detalhes|informacoes)\b/.test(normalized)
      && /\b(?:veiculo|carro|moto)\b/.test(normalized)) return false;
    return true;
  });
  const prefix = usefulSegments.join(' ').replace(/\s+/g, ' ').trim();
  return limitWhatsappReply(prefix ? `${prefix} ${targetQuestion}` : targetQuestion);
}

function hasImpossiblePromise(value = '') {
  const normalized = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [
    /(?:reboque|guincho).{0,35}(?:a caminho|chegando|foi acionado)/,
    /(?:pagamento|boleto).{0,35}(?:confirmado|baixado|gerado|liberado)/,
    /(?:app|aplicativo).{0,35}(?:liberado|desbloqueado)/,
    /(?:consultei|verifiquei|conferi).{0,30}(?:sistema|cadastro|fipe)/,
    /(?:protecao|adesao|contrato).{0,30}(?:(?:ja\s+)?(?:esta|foi)\s+(?:ativad|aprovad|concluid)|(?:ativei|aprovei|conclui)\b)/,
  ].some((pattern) => pattern.test(normalized));
}

function isSafeGeneratedPriceHandoff(value = '') {
  const text = String(value || '');
  return /consultor|encaminh/i.test(text)
    && !/\?/.test(text)
    && !/placa/i.test(text)
    && !/R\$\s*\d/i.test(text);
}

function extractNumericClaims(value = '') {
  const matches = String(value || '').match(
    /R\$\s*\d[\d.,]*|\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?\s*(?:%|km|dias?|meses?|anos?|horas?|acionamentos?|itens?|parcelas?|di[aá]rias?|reais)\b/gi,
  ) || [];
  return matches.map((claim) => claim.toLowerCase().replace(/\s+/g, ' ').trim());
}

function normalizeNumericClaim(claim = '') {
  const normalized = String(claim || '').toLowerCase();
  const number = (normalized.match(/\d[\d.,]*/) || [''])[0]
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '');
  let unit = (normalized.match(/%|km|dias?|meses?|anos?|horas?|acionamentos?|itens?|parcelas?|di[aá]rias?|reais|r\$/) || [''])[0];
  unit = unit
    .replace(/^dia(?:s|rias|árias)?$/, 'dia')
    .replace(/^meses?$/, 'mes')
    .replace(/^anos?$/, 'ano')
    .replace(/^horas?$/, 'hora')
    .replace(/^acionamentos?$/, 'acionamento')
    .replace(/^itens?$/, 'item')
    .replace(/^parcelas?$/, 'parcela')
    .replace(/^reais$|^r\$$/, 'real');
  return `${number}:${unit || 'numero'}`;
}

function hasUnsupportedNumericClaim(reply = '', knowledge = {}, message = '') {
  const allowedText = [
    message,
    knowledge.text,
    ...(knowledge.items || []).flatMap((item) => [item.title, item.content]),
  ].filter(Boolean).join(' ');
  const allowed = new Set(extractNumericClaims(allowedText).map(normalizeNumericClaim));
  return extractNumericClaims(reply).some((claim) => !allowed.has(normalizeNumericClaim(claim)));
}

function asksForExactLimit(message = '') {
  const normalized = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\b(?:qual|quanto|qnt)\b.{0,45}\blimite\b|\blimite\b.{0,25}\b(?:quanto|qual|qnt)\b/.test(normalized);
}

function hasOnlyUnspecifiedContractLimit(knowledge = {}, knowledgeIds = []) {
  const citedText = getCitedKnowledgeText(knowledge, knowledgeIds)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const limitClauses = citedText
    .split(/[\n.;]|,\s+|\s+\|\s+/)
    .map((clause) => clause.trim())
    .filter((clause) => /\blimite\b/.test(clause));
  return limitClauses.length > 0
    && limitClauses.every((clause) => extractNumericClaims(clause).length === 0)
    && limitClauses.some((clause) => /\b(?:contratad|proposta|plano)\w*\b/.test(clause));
}

function getCitedKnowledgeText(knowledge = {}, knowledgeIds = []) {
  const citedIds = new Set(knowledgeIds.map(normalizeKnowledgeId));
  const citedItems = (knowledge.items || []).filter((item) => citedIds.has(normalizeKnowledgeId(item.id)));
  if (citedItems.length) {
    return citedItems.flatMap((item) => [item.title, item.content]).filter(Boolean).join(' ');
  }
  return String(knowledge.text || '');
}

function isAdditionalDriverEligibilityQuestion(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const asksAboutDriving = /\b(?:dirigir|dirige|conduzir|conduz|motorista)\b/.test(normalized);
  const identifiesAnotherDriver = /\b(?:filho|filha|esposa|esposo|marido|mulher|namorado|namorada|pai|mae|irmao|irma|parente|outra\s+pessoa|qualquer\s+pessoa|terceiro)\b/.test(normalized);
  const givesSpecificAge = /\b\d{2}\s*anos?\b/.test(normalized);
  return asksAboutDriving && (identifiesAnotherDriver || givesSpecificAge);
}

function hasExplicitAdditionalDriverRule(knowledge = {}, knowledgeIds = [], message = '') {
  const citedText = getCitedKnowledgeText(knowledge, knowledgeIds)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/\b(?:qualquer\s+condutor|outro\s+condutor|condutor\s+adicional|motorista\s+adicional|idade\s+minima|cnh\s+provisoria|permissao\s+para\s+dirigir)\b/.test(citedText)) {
    return true;
  }
  const normalizedMessage = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const relationship = normalizedMessage.match(/\b(filho|filha|esposa|esposo|marido|mulher|namorado|namorada|pai|mae|irmao|irma|parente)\b/)?.[1];
  if (relationship && new RegExp(`(?:\\b${relationship}\\b.{0,60}\\b(?:dirig|condu|condutor|motorista)|\\b(?:dirig|condu|condutor|motorista)\\w*.{0,60}\\b${relationship}\\b)`).test(citedText)) {
    return true;
  }
  const age = normalizedMessage.match(/\b(\d{2})\s*anos?\b/)?.[1];
  return !!age && new RegExp(`(?:\\b${age}\\s*anos?\\b.{0,60}\\b(?:dirig|condu|condutor|motorista)|\\b(?:dirig|condu|condutor|motorista)\\w*.{0,60}\\b${age}\\s*anos?\\b)`).test(citedText);
}

function hasUnsupportedPaymentAssurance(reply = '', knowledge = {}, knowledgeIds = []) {
  const normalized = String(reply || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const assuresPayment = /\b(?:a\s+moove|a\s+associacao|nos)\s+(?:realiza|faz|efetua|garante|assegura)\w*.{0,45}\b(?:pagamento|indenizacao)\b|\b(?:paga|indeniza)\w*.{0,45}\b(?:evento|associad|veiculo)\b/.test(normalized);
  if (!assuresPayment) return false;
  const citedText = getCitedKnowledgeText(knowledge, knowledgeIds)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return !/\b(?:pagamento|indenizacao|indenizar)\b/.test(citedText);
}

function isBroadEventPaymentQuestion(message = '') {
  const normalized = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(?:quanto\s+tempo|qual\s+(?:e\s+o\s+)?prazo|em\s+quantos\s+dias|qual\s+(?:e\s+o\s+)?valor|percentual)\b/.test(normalized)) {
    return false;
  }
  return /\b(?:realmente|de verdade)\b.{0,35}\b(?:pagam|paga|indeniza\w*)\b|\b(?:pagam|paga|indeniza\w*)\b.{0,45}\b(?:quando acontece|se acontecer|evento|carro|veiculo|perda|colisao)\b/.test(normalized);
}

function hasIncompleteEventPaymentAnswer(reply = '', message = '', action = 'respond') {
  if (!isBroadEventPaymentQuestion(message)) return false;
  const normalized = String(reply || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const qualifiesAnswer = /\b(?:depende|confirm\w*)\b|\b(?:nao|nunca|nem sempre)\b.{0,35}\bgarant\w*\b/.test(normalized);
  const actuallyHandsOff = ['handoff_sales', 'handoff_operational'].includes(action)
    && /\b(?:consultor|encaminh\w*)\b/.test(normalized);
  return !qualifiesAnswer && !actuallyHandsOff;
}

function isBareObjectionAcknowledgement(turn = {}) {
  if (turn.primaryIntent !== 'objection' || !['respond', 'clarify'].includes(turn.action)) return false;
  const words = String(turn.reply || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]+/g) || [];
  const acknowledgementWords = new Set([
    'a', 'ao', 'com', 'compreendo', 'entendo', 'essa', 'esse', 'faz', 'imagino', 'o',
    'preocupacao', 'que', 'sentido', 'sua', 'voce',
  ]);
  const substantiveWords = words.filter((word) => !acknowledgementWords.has(word));
  return substantiveWords.length <= 1 && !String(turn.reply || '').includes('?');
}

function needsCustomerAgentRepair(turn = {}, knowledge = {}) {
  return isBareObjectionAcknowledgement(turn)
    || turn.reply === SAFE_EVENT_PAYMENT_REPLY
    || turn.reply === SAFE_SALES_HANDOFF_REPLY
    || turn.reply === SAFE_OBJECTION_CONTINUATION
    || (turn.reply === SAFE_UNKNOWLEDGE_REPLY
      && knowledge.confidence !== 'low'
      && (knowledge.ids || []).length > 0);
}

function buildCustomerAgentRepairContext(context = {}, turn = {}) {
  const reason = turn.reply === SAFE_EVENT_PAYMENT_REPLY
    ? 'A primeira resposta não explicou com segurança que a confirmação depende da análise do evento.'
    : turn.reply === SAFE_SALES_HANDOFF_REPLY
      ? 'A primeira resposta marcou encaminhamento, mas perguntou se o cliente queria falar com um consultor em vez de confirmar o encaminhamento.'
      : turn.reply === SAFE_UNKNOWLEDGE_REPLY
        ? 'A primeira resposta ignorou fontes relevantes que estavam disponíveis. Use somente essas fontes para responder diretamente; não diga que a informação está ausente se ela consta nelas.'
      : 'A primeira resposta apenas reconheceu a preocupação e não resolveu nem investigou a objeção.';
  return {
    ...context,
    userMessage: `${context.userMessage}\n\nREVISÃO OBRIGATÓRIA DA RESPOSTA\n${reason}\nGere novamente o objeto JSON completo. Responda diretamente com fatos das fontes quando houver base. Se a preocupação estiver vaga, faça uma única pergunta específica. Não repita uma frase genérica de acolhimento como resposta inteira.`,
  };
}

function applyFinalRepairFallback(turn = {}, lead = {}) {
  if ([SAFE_EVENT_PAYMENT_REPLY, SAFE_SALES_HANDOFF_REPLY, SAFE_UNKNOWLEDGE_REPLY].includes(turn.reply)) return turn;
  if (turn.knowledgeIds?.length && ['answered', 'partial'].includes(turn.answerStatus)) {
    return {
      ...turn,
      reply: SAFE_OBJECTION_HANDOFF_REPLY,
      mode: 'sales',
      action: 'handoff_sales',
      handoffSummary: turn.handoffSummary || buildFallbackHandoffSummary(turn.memory, lead, turn.extractedFacts),
      shouldHandoff: true,
      shouldAskPhone: !getLeadRealPhone(lead),
      shouldStopAutomation: true,
    };
  }
  return {
    ...turn,
    reply: SAFE_OBJECTION_CONTINUATION,
    primaryIntent: 'objection',
    secondaryIntent: 'none',
    mode: 'sales',
    action: 'respond',
    answerStatus: 'not_applicable',
    handoffReason: '',
    handoffSummary: '',
    shouldHandoff: false,
    shouldAskPhone: false,
    shouldStopAutomation: false,
  };
}

function hasUnsafeGeneralFipePromise(value = '', knowledge = {}, knowledgeIds = [], message = '') {
  const normalized = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const promisesFullFipe = /(?:garant|cobr|pag|receb|indeniz)\w*.{0,45}100\s*%\s*(?:da\s+)?fipe|100\s*%\s*(?:da\s+)?fipe.{0,45}(?:garant|cobr|pag|receb|indeniz)\w*/.test(normalized);
  const clearlyDeniesGuarantee = /(?:nao|nunca|nem sempre).{0,35}(?:garant|regra geral|100\s*%\s*(?:da\s+)?fipe)/.test(normalized);
  const sourceText = getCitedKnowledgeText(knowledge, knowledgeIds)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const messageText = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasSpecificGroundedCondition = /100\s*%\s*(?:da\s+)?fipe/.test(sourceText)
    && ['incendio', 'colisao', 'pane'].some((term) => (
      messageText.includes(term) && normalized.includes(term) && sourceText.includes(term)
    ));
  return promisesFullFipe && !clearlyDeniesGuarantee && !hasSpecificGroundedCondition;
}

function removeUnrequestedCoverageExpansion(value = '', message = '') {
  const normalizedMessage = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(?:o\s+que\s+cobre|quais?\s+(?:coberturas?|beneficios?)|lista|tudo\s+que\s+cobre)\b/.test(normalizedMessage)) {
    return String(value || '').trim();
  }
  if (/\b(?:o\s+que|oq)\s+(?:vem|inclui|tem)\b.{0,50}\b(?:assistencia|protecao|beneficio)\b|\b(?:assistencia|protecao)\b.{0,35}\b(?:inclui\s+o\s+que|vem\s+com\s+o\s+que)\b/.test(normalizedMessage)) {
    return String(value || '').trim();
  }
  const focusedReply = String(value || '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/^al[eé]m\s+(?:disso|dele|dela),?\s+(?:tamb[eé]m\s+)?(?:cobrimos|oferecemos|inclu[ií]mos)/i.test(sentence.trim()))
    .map((sentence) => sentence.replace(/,?\s+al[eé]m\s+de\s+(?:outros?\s+)?(?:benef[ií]cios?\s+como\s+)?[^.!?]+(?=[.!?]|$)/i, ''))
    .join(' ')
    .trim();

  const assistanceTopics = [
    ['tow', /\b(?:guincho|reboque)\b/i],
    ['locksmith', /\b(?:chaveiro|chaves?)\b/i],
    ['dry', /\b(?:pane seca|gasolina|combust[ií]vel)\b/i],
    ['electric', /\bpane el[eé]trica\b/i],
    ['tire', /\b(?:troca de pneus?|pneu furado)\b/i],
    ['taxi', /\bt[aá]xi\b/i],
    ['lodging', /\bhospedagem\b/i],
  ];
  const requestedTopics = assistanceTopics.filter(([, pattern]) => pattern.test(message));
  if (requestedTopics.length !== 1) return focusedReply;

  const requestedKey = requestedTopics[0][0];
  const topicSource = '(?:guincho|reboque|chaveiro|chaves?|pane seca|pane el[eé]trica|gasolina|combust[ií]vel|troca de pneus?|pneu furado|t[aá]xi|hospedagem)';
  return focusedReply
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      const mentioned = assistanceTopics.filter(([, pattern]) => pattern.test(sentence));
      if (mentioned.length && !mentioned.some(([key]) => key === requestedKey)) return '';
      if (mentioned.length <= 1) return sentence;

      const chunks = sentence
        .replace(new RegExp(`,\\s*(?=${topicSource})`, 'gi'), '\u0000')
        .replace(new RegExp(`\\s+(?:e|que)\\s+(?:tamb[eé]m\\s+)?(?:conta\\s+com\\s+)?(?=${topicSource})`, 'gi'), '\u0000')
        .split('\u0000')
        .filter((chunk) => {
          const chunkTopics = assistanceTopics.filter(([, pattern]) => pattern.test(chunk));
          return chunkTopics.length === 0 || chunkTopics.some(([key]) => key === requestedKey);
        });
      return chunks.join(', ').replace(/\s+([.!?])/g, '$1').trim();
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

function removeUnsupportedUnlimitedAssistanceClaim(value = '', knowledge = {}, knowledgeIds = []) {
  const cited = getCitedKnowledgeText(knowledge, knowledgeIds)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!/um acionamento a cada 30 dias/.test(cited)) return String(value || '').trim();
  if (!/\b(?:sempre que precisar|quantas vezes quiser|sem limite)\b/i.test(value)) return String(value || '').trim();

  const cleaned = String(value || '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\b(?:sempre que precisar|quantas vezes quiser|sem limite)\b/i.test(sentence))
    .join(' ')
    .trim();
  const limit = 'O limite é de um acionamento a cada 30 dias.';
  return cleaned ? `${cleaned} ${limit}` : `Esse serviço está incluído na assistência 24h. ${limit}`;
}

function removeUnsupportedSystemOffer(value = '') {
  return String(value || '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\b(?:posso|gostaria\s+de|quer\s+que\s+eu|vou)\s+(?:verificar|consultar|conferir)\b[^.!?]{0,90}\b(?:sistema|cadastro|plano|ativa|ativo|contratada|contratado)\b/i.test(sentence))
    .join(' ')
    .trim();
}

function hasQuoteLanguage(value = '') {
  const normalized = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\b(?:cotacao|cotar|orcamento|preco|valor|mensalidade|caro|cara|barato|barata|aderir|associar|contratar)\b|\bdescont\w*\b|\bquanto\s+(?:custa|fica|sai)\b|\b(?:entrar|fazer parte)\b.{0,20}\b(?:moove|associacao)\b/.test(normalized);
}

function getPriorUserMessages(message = '', lead = {}) {
  const userMessages = (lead.history || [])
    .filter((entry) => entry?.role === 'user' && cleanString(entry.content, 600))
    .map((entry) => cleanString(entry.content, 600));
  if (userMessages.length > 0
    && userMessages[userMessages.length - 1] === cleanString(message, 600)) {
    userMessages.pop();
  }
  return userMessages;
}

function hasLegacyQuoteState(lead = {}) {
  return ['sales_quote', 'sales_price_request', 'sales_consultant_requested'].includes(lead.lastIntent)
    || ['qualification', 'ready_for_quote', 'handoff'].includes(lead.aiMemory?.salesStage)
    || hasQuoteLanguage(`${lead.aiMemory?.customerGoal || ''} ${lead.aiMemory?.primaryNeed || ''}`);
}

function hasActiveQuoteContext(message = '', lead = {}, primaryIntent = '', secondaryIntent = '') {
  if (['sales_quote', 'sales_price_request'].includes(primaryIntent)
    || ['sales_quote', 'sales_price_request'].includes(secondaryIntent)
    || hasQuoteLanguage(message)) return true;
  const priorUserMessages = getPriorUserMessages(message, lead);
  if (priorUserMessages.some(hasQuoteLanguage)) return true;
  return priorUserMessages.length === 0 && !(lead.history || []).length && hasLegacyQuoteState(lead);
}

function hasObservedQuoteContext(message = '', lead = {}) {
  if (hasQuoteLanguage(message)) return true;
  const priorUserMessages = getPriorUserMessages(message, lead);
  if (priorUserMessages.some(hasQuoteLanguage)) return true;
  return priorUserMessages.length === 0 && !(lead.history || []).length && hasLegacyQuoteState(lead);
}

function wasVehicleDataQuestionRecentlyAsked(lead = {}) {
  return (lead.history || []).slice(-6).some((entry) => entry?.role === 'assistant'
    && /\?/.test(String(entry.content || ''))
    && /\bmodelo\b/i.test(String(entry.content || ''))
    && /\bano\b/i.test(String(entry.content || '')));
}

function hasPendingVehicleQualification(lead = {}) {
  const memoryQuestion = [
    lead.aiMemory?.pendingQuestion,
    lead.aiMemory?.lastQuestionAsked,
  ].filter(Boolean).join(' ');
  return lead.stage === 'ask_model_year'
    || (lead.aiMemory?.salesStage === 'qualification' && /\b(?:modelo|ano)\b/i.test(memoryQuestion))
    || /\b(?:modelo|ano)\b/i.test(memoryQuestion)
    || wasVehicleDataQuestionRecentlyAsked(lead);
}

export function isTemporaryCustomerWait(message = '', lead = {}) {
  if (!hasPendingVehicleQualification(lead)) return false;
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;

  const shortPause = /^(?:calma(?: ai)?|pera(?: ai)?|perai|espera(?: ai)?|aguarda(?: ai)?|(?:so )?um momento|(?:so )?um minut(?:o|inho))(?: por favor)?$/;
  const checkingWithSomeone = /\b(?:vou|deixa eu|preciso)\s+(?:perguntar|confirmar|conferir|ver|falar)\b.{0,70}\b(?:ele|ela|filho|filha|dono|dona|proprietario|proprietaria|pai|mae|modelo|ano|dados?|informacoes?|com|pra|pro|para)\b/;
  const pauseThenCheck = /\b(?:calma|pera(?: ai)?|perai|espera(?: ai)?|aguarda(?: ai)?|(?:so )?um momento|(?:so )?um minut(?:o|inho))\b.{0,55}\b(?:vou|deixa eu|preciso)\s+(?:perguntar|confirmar|conferir|ver|falar)\b/;
  return shortPause.test(normalized)
    || checkingWithSomeone.test(normalized)
    || pauseThenCheck.test(normalized);
}

export function buildTemporaryWaitReply(lead = {}) {
  const previousReplies = new Set((lead.history || [])
    .filter((entry) => entry?.role === 'assistant')
    .slice(-8)
    .map((entry) => cleanString(entry.content, 300).toLowerCase()));
  return TEMPORARY_WAIT_REPLIES.find((reply) => !previousReplies.has(reply.toLowerCase()))
    || 'Certo, continuo aguardando sua confirmação.';
}

function resolveTemporaryWaitReply(generatedReply = '', lead = {}) {
  const candidate = removeVehicleDataQuestion(generatedReply).trim();
  const safeAcknowledgement = candidate
    && !candidate.includes('?')
    && !/\b(?:encaminh|consultor|atendente|modelo|ano|placa|cota[cç][aã]o)\b/i.test(candidate)
    && /\b(?:aguard|calma|sem pressa|pode perguntar|pode confirmar|claro|tudo bem|sem problema)\b/i.test(candidate)
    && !wasReplyAlreadySent(candidate, lead);
  return safeAcknowledgement ? candidate : buildTemporaryWaitReply(lead);
}

function hasPriorConfirmedHandoff(lead = {}) {
  return (lead.history || []).slice(-8).some((entry) => entry?.role === 'assistant'
    && /\b(?:encaminh(?:ei|ado|ada)|passei|direcionei)\b/i.test(String(entry.content || ''))
    && /\bconsultor\b/i.test(String(entry.content || '')));
}

function wasReplyAlreadySent(reply = '', lead = {}) {
  const normalizedReply = cleanString(reply, 700).toLowerCase();
  if (!normalizedReply) return false;
  return (lead.history || []).slice(-8).some((entry) => entry?.role === 'assistant'
    && cleanString(entry.content, 700).toLowerCase() === normalizedReply);
}

function isVehicleCorrectionMessage(message = '') {
  const normalized = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\b(?:corrigindo|correcao|na verdade|quer dizer)\b/.test(normalized)
    && /\b(?:19|20)\d{2}\b/.test(normalized);
}

function removeVehicleDataQuestion(value = '') {
  return String(value || '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const asksForVehicleData = /\bmodelo\b/i.test(sentence) && /\bano\b/i.test(sentence)
        && (sentence.includes('?')
          || /\b(?:informe|informar|me passe|pode passar|diga|envie)\b/i.test(sentence));
      return !asksForVehicleData;
    })
    .join(' ')
    .trim();
}

function removeGenericSalesPivot(value = '') {
  return String(value || '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !(sentence.includes('?') && /\b(?:interesse\s+em\s+(?:uma\s+)?cota[cç][aã]o|gostaria\s+de\s+(?:fazer|receber)\s+(?:uma\s+)?cota[cç][aã]o|ve[ií]culo\s+que\s+(?:deseja|quer)\s+proteger|conhecer\s+mais\s+sobre\s+(?:a\s+)?prote[cç][aã]o|j[aá]\s+tem\s+(?:um\s+)?ve[ií]culo\s+em\s+mente\s+para\s+(?:cotar|proteger)|o\s+que\s+(?:voc[eê]\s+)?busca\s+para\s+(?:o\s+)?seu\s+ve[ií]culo)\b/i.test(sentence)))
    .filter((sentence) => !(sentence.includes('?') && /\bgostaria\s+de\s+(?:saber|conhecer)\s+mais\s+sobre\s+como\s+funciona\s+(?:o\s+processo|a\s+|nossa\s+|a\s+nossa\s+)?prote[cç][aã]o\b/i.test(sentence)))
    .filter((sentence) => !(sentence.includes('?') && /\bgostaria\s+de\s+saber\s+mais\s+sobre\s+como\s+funciona\s+(?:o\s+nosso\s+|nosso\s+)?(?:sistema\s+de\s+mutualismo|mutualismo|associa[cç][aã]o)\b/i.test(sentence)))
    .filter((sentence) => !(sentence.includes('?') && /\bgostaria\s+de\s+saber\s+mais\s+sobre\s+como\s+funciona\s+(?:o\s+nosso\s+|nosso\s+)?sistema\s+de\s+prote[cç][aã]o\b/i.test(sentence)))
    .filter((sentence) => !(sentence.includes('?') && /\b(?:gostaria\s+de\s+conhecer\s+mais\s+sobre\s+(?:a\s+|nossa\s+)?estrutura|(?:existe\s+)?alguma?\s+outra\s+d[uú]vida[^?]{0,80}\bfuncionamento|existe\s+algum\s+outro\s+ponto[^?]{0,80}\besclarecer|para\s+que\s+(?:eu\s+possa|voc[eê])[^?]{0,120}\bgostaria)\b/i.test(sentence)))
    .filter((sentence) => !(sentence.includes('?') && /\b(?:gostaria\s+de\s+saber(?:\s+mais)?|posso\s+te\s+ajudar|como\s+posso\s+te\s+ajudar|precisa\s+de\s+ajuda)\b[^?]{0,100}\b(?:outros?\s+benef[ií]cios?|outras?\s+d[uú]vidas?|mais\s+alguma\s+d[uú]vida|outras?\s+informa[cç][oõ]es?|o\s+que\s+est[aá]\s+inclu[ií]do|nossas?\s+coberturas?|algo\s+mais)\b/i.test(sentence)))
    .filter((sentence) => !(sentence.includes('?') && /\b(?:ve[ií]culo|carro|moto|uso\s+profissional|passeio)\b/i.test(sentence)))
    .filter((sentence) => !(sentence.includes('?') && /\b(?:cota[cç][aã]o|cotar|or[cç]amento|verificar\s+os\s+valores?)\b/i.test(sentence)))
    .filter((sentence) => !(sentence.includes('?') && /\b(?:posso|consigo)\s+(?:te\s+)?ajudar\s+com\s+(?:mais\s+)?alguma\s+(?:informa[cç][aã]o|d[uú]vida)\b/i.test(sentence)))
    .join(' ')
    .trim();
}

function pickSafeAcknowledgement(value = '') {
  return (String(value || '').split(/(?<=[.!?])\s+/).find((sentence) => (
    /^(?:entendo|compreendo|faz sentido|certo|claro)\b/i.test(sentence.trim())
    && !/\b(?:moove|prote[cç][aã]o|cobertura|benef[ií]cio|regulamento|fipe|processo)\b/i.test(sentence)
  )) || 'Entendo que o valor é importante.').trim();
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
  const customerType = CUSTOMER_TYPES.has(value.customerType)
    ? value.customerType
    : CUSTOMER_TYPES.has(previous.customerType)
      ? previous.customerType
      : 'unknown';
  const salesStage = SALES_STAGES.has(value.salesStage)
    ? value.salesStage
    : SALES_STAGES.has(previous.salesStage)
      ? previous.salesStage
      : 'opening';
  return {
    customerGoal: cleanString(value.customerGoal || previous.customerGoal, 180),
    currentTopic: cleanString(value.currentTopic || previous.currentTopic, 120),
    customerType,
    salesStage,
    primaryNeed: cleanString(value.primaryNeed || previous.primaryNeed, 180),
    pendingQuestion: cleanString(value.pendingQuestion, 180),
    lastQuestionAsked: cleanString(value.lastQuestionAsked || previous.lastQuestionAsked, 180),
    objections: cleanStringList([
      ...normalizeGeneratedList(previous.objections),
      ...normalizeGeneratedList(value.objections),
    ], 8, 120),
    decisionFactors: cleanStringList([
      ...normalizeGeneratedList(previous.decisionFactors),
      ...normalizeGeneratedList(value.decisionFactors),
    ], 10, 120),
    answeredTopics: cleanStringList([
      ...normalizeGeneratedList(previous.answeredTopics),
      ...normalizeGeneratedList(value.answeredTopics),
    ], 12, 120),
  };
}

function normalizeExtractedFacts(value = {}, message = '') {
  const vehicleModel = cleanString(value.vehicleModel, 80);
  const yearMatch = cleanString(value.vehicleYear, 10).match(/\b(19\d{2}|20\d{2})\b/);
  const maximumYear = new Date().getFullYear() + 1;
  const normalizeComparable = (input) => String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedMessage = normalizeComparable(message);
  const messageTokens = new Set(normalizedMessage.split(' ').filter(Boolean));
  const genericModelWords = new Set([
    'carro', 'veiculo', 'moto', 'caminhao', 'familia', 'trabalho', 'uso', 'passeio',
    'meu', 'minha', 'novo', 'zero', 'km', 'sem', 'placa', 'protegido', 'protecao',
    'a', 'as', 'da', 'das', 'de', 'do', 'dos', 'o', 'os', 'para', 'um', 'uma',
    'com', 'e', 'em', 'na', 'nas', 'no', 'nos', 'por', 'pra', 'pro', 'que',
    'seu', 'seus', 'sua', 'suas', 'dele', 'dela', 'deles', 'delas', 'nosso', 'nossa',
    'adiantar', 'ajudar', 'cotar', 'cotacao', 'familiar', 'fechar', 'interesse',
    'preciso', 'proteger', 'quero', 'queria', 'valor', 'usar', 'todo', 'dia',
  ]);
  const distinctiveModelTokens = normalizeComparable(vehicleModel)
    .split(' ')
    .filter((token) => token.length >= 2 && !genericModelWords.has(token) && !/^\d{4}$/.test(token));
  const modelAppearsInMessage = !normalizedMessage
    || distinctiveModelTokens.some((token) => messageTokens.has(token));
  const vehicleYear = yearMatch
    && Number(yearMatch[1]) <= maximumYear
    && (!normalizedMessage || messageTokens.has(yearMatch[1]))
    ? yearMatch[1]
    : '';
  return {
    vehicleModel: vehicleModel.length >= 2 && modelAppearsInMessage ? vehicleModel : '',
    vehicleYear,
  };
}

function buildGroundedKnowledgeFallback(knowledge = {}, preferredIds = []) {
  const items = Array.isArray(knowledge.items) ? knowledge.items : [];
  const preferred = new Set(preferredIds.map((id) => normalizeKnowledgeId(id)).filter(Boolean));
  const source = items.find((item) => preferred.has(normalizeKnowledgeId(item?.id))) || items[0];
  if (!source?.content) return null;
  const reply = normalizeBusinessTerms(String(source.content))
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!reply) return null;
  return {
    id: normalizeKnowledgeId(source.id),
    reply: limitWhatsappReply(reply, 420),
  };
}

function buildFallbackHandoffSummary(memory = {}, lead = {}, extractedFacts = {}) {
  const model = lead.model || extractedFacts.vehicleModel;
  const year = lead.year || extractedFacts.vehicleYear;
  const parts = [
    memory.customerType === 'associated' ? 'Cliente já associado' : 'Cliente interessado na Moove',
    memory.customerGoal ? `Objetivo: ${memory.customerGoal}` : '',
    memory.primaryNeed ? `Prioridade: ${memory.primaryNeed}` : '',
    model || year ? `Veículo: ${[model, year].filter(Boolean).join(' ')}` : '',
    memory.objections?.length ? `Objeções: ${memory.objections.join('; ')}` : '',
    memory.pendingQuestion ? `Pendente: ${memory.pendingQuestion}` : '',
  ].filter(Boolean);
  return cleanString(parts.join('. '), 700);
}

const OPERATIONAL_HANDOFF_TOPICS = {
  human_requested: 'Pedido de atendimento humano',
  assistance_request: 'Assist\u00eancia urgente',
  event_report: 'Evento com o ve\u00edculo',
  boleto_request: 'Boleto ou forma de pagamento',
  regularization_request: 'Pend\u00eancia ou mensalidade em atraso',
  payment_claimed: 'Pagamento informado',
  receipt_available: 'Comprovante de pagamento',
  receipt_received: 'Comprovante de pagamento',
  reactivation_request: 'Reativa\u00e7\u00e3o',
  cancel_request: 'Cancelamento',
  app_blocked: 'Acesso ao aplicativo',
  billing_disputed: 'Cobran\u00e7a contestada',
  inspection_pending: 'Vistoria ou revistoria',
  system_check_request: 'Consulta de cadastro ou situa\u00e7\u00e3o',
};

function buildOperationalHandoffSummary(intent = '', message = '') {
  const topic = OPERATIONAL_HANDOFF_TOPICS[intent] || 'Atendimento operacional';
  const currentRequest = cleanString(normalizeBusinessTerms(redactSensitiveText(message)), 360);
  return cleanString(
    currentRequest ? `Assunto: ${topic}. Pedido atual: ${currentRequest}` : `Assunto: ${topic}.`,
    700,
  );
}

function buildSalesHandoffSummary({
  primaryIntent = '',
  secondaryIntent = '',
  message = '',
  memory = {},
  lead = {},
  extractedFacts = {},
} = {}) {
  const intents = new Set([primaryIntent, secondaryIntent]);
  const topic = intents.has('sales_price_request')
    ? 'Cotação com pedido de valor'
    : intents.has('sales_consultant_requested')
      ? 'Cliente quer concluir a adesão com um consultor'
      : intents.has('sales_quote')
        ? 'Pedido de cotação'
        : primaryIntent === 'objection'
          ? 'Objeção comercial'
          : primaryIntent === 'coverage_question'
            ? 'Dúvida sobre benefício ou cobertura'
            : primaryIntent === 'eligibility_question'
              ? 'Dúvida de elegibilidade'
              : primaryIntent === 'company_question'
                ? 'Dúvida sobre a Moove'
                : 'Atendimento comercial';
  const model = lead.model || extractedFacts.vehicleModel;
  const year = lead.year || extractedFacts.vehicleYear;
  const currentRequest = cleanString(normalizeBusinessTerms(redactSensitiveText(message)), 300);
  const parts = [
    `Assunto: ${topic}`,
    currentRequest ? `Pedido atual: ${currentRequest}` : '',
    model || year ? `Veículo: ${[model, year].filter(Boolean).join(' ')}` : '',
    memory.objections?.length ? `Objeções: ${memory.objections.join('; ')}` : '',
  ].filter(Boolean);
  return cleanString(parts.join('. '), 700);
}

function isPlateRefusal(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return [
    /\bprefiro\s+(?:nao\s+)?(?:passar|informar|mandar)(?:\s+(?:a\s+)?placa)?\b/,
    /\bnao\s+(?:quero|vou)\s+(?:passar|informar|mandar)(?:\s+(?:a\s+)?placa)?\b/,
  ].some((pattern) => pattern.test(normalized));
}

function isUnregisteredVehicleQuote(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const hasNoPlateYet = /\b(?:ainda\s+)?(?:ta|esta|ficou)?\s*sem\s+(?:a\s+)?placa\b|\b(?:ainda\s+)?n[aã]o\s+(?:tem|tenho|foi\s+emitida)\s+(?:a\s+)?placa\b/.test(normalized);
  return hasNoPlateYet && hasQuoteLanguage(message);
}

function isPlatePurposeQuestion(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(?:por\s+que|porque|pra\s+que|pq)\b.{0,45}\bplaca\b|\bplaca\b.{0,45}\b(?:por\s+que|porque|pra\s+que|pq|precisa)\b/.test(normalized);
}

function isDataPurposeQuestion(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(?:por\s+que|porque|pra\s+que|pq)\b.{0,45}\b(?:dado|dados|informacoes?)\b|\b(?:dado|dados|informacoes?)\b.{0,45}\b(?:por\s+que|porque|pra\s+que|pq|precisa|quer)\b/.test(normalized);
}

function isVehicleAppEligibilityQuestion(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const mentionsProfessionalUse = /\b(?:uber|taxi|99|aplicativo)\b/.test(normalized);
  const describesVehicleUse = /\b(?:carro|veiculo|moto|roda|rodar|trabalha|trabalhar|uso)\b/.test(normalized);
  const reportsAppFailure = /\b(?:app|aplicativo)\b.{0,35}\b(?:bloquead|travado|erro|nao\s+abre|nao\s+entra|sem\s+acesso)\b|\b(?:bloquead|travado|erro|nao\s+abre|nao\s+entra|sem\s+acesso)\b.{0,35}\b(?:app|aplicativo)\b/.test(normalized);
  return mentionsProfessionalUse && describesVehicleUse && !reportsAppFailure;
}

function hasKnownDataRequestContext(lead = {}) {
  return !!lead.plateRequestedAt
    || ['ask_model_year', 'ask_plate'].includes(lead.stage)
    || /\b(?:modelo|ano|placa|cpf|telefone|whatsapp|documento|dado)\b/i.test(
      String(lead.aiMemory?.lastQuestionAsked || lead.aiMemory?.pendingQuestion || ''),
    );
}

function isTrustObjection(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(?:golpe|furada|confiavel|confiar|confio|credibilidade)\b|\bcomo\s+sei\b.{0,45}\b(?:serio|verdade|real)\b/.test(normalized);
}

function isExistingProviderObjection(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\bja\s+(?:tenho|estou\s+com|faco)\b.{0,35}\b(?:protecao|cobertura|seguro)\b.{0,30}\b(?:outra|outro)\b.{0,20}\b(?:empresa|associacao|lugar)\b/.test(normalized)
    && !hasQuoteLanguage(message);
}

function isDelayObjection(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(?:demora|demorado|muito\s+tempo)\b|\b\d+\s+dias?\b.{0,25}\b(?:muito|demora|longo)\b/.test(normalized);
}

function isPriceObjection(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(?:caro|cara|carissimo|carissima)\b|\b(?:preco|valor|mensalidade)\b.{0,25}\b(?:alto|alta|pesado|pesada)\b|\b(?:fora\s+do\s+orcamento|nao\s+cabe|sem\s+grana|mais\s+barat[ao]|descont\w*)\b/.test(normalized);
}

function isShallowPriceObjectionReply(reply = '') {
  const normalized = String(reply || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9?\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\b(?:o que|qual coisa)\s+(?:voce\s+)?(?:acha|achou|considera)\s+(?:caro|cara)(?:\s+demais)?\??$/.test(normalized);
}

function buildPriceObjectionFallback(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/\bdescont\w*\b/.test(normalized)) {
    return 'Entendo. Qual faixa de valor faria sentido para você?';
  }
  if (/\b(?:outra|concorrente)\b.{0,35}\b(?:empresa|associacao|barat[ao])\b|\bmais\s+barat[ao]\b/.test(normalized)) {
    return 'Entendo. Qual ponto mais pesou para você nessa comparação?';
  }
  return 'Entendo. O que fez o valor parecer alto para você?';
}

function hasExplicitObjectionLanguage(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return isTrustObjection(message)
    || isExistingProviderObjection(message)
    || isDelayObjection(message)
    || isPriceObjection(message)
    || /\bnao\s+(?:entendi|gostei|confio)\b|\b(?:tenho\s+receio|me\s+preocupa|parece\s+(?:caro|burocratico|complicado))\b/.test(normalized);
}

function isSoftSalesHesitation(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return [
    /\b(?:vou|deixa eu)\s+pensar\b/,
    /\bdepois\s+(?:eu\s+)?(?:vejo|falo|decido|respondo)\b/,
    /\b(?:vejo|falo|decido|respondo)\s+depois\b/,
    /\bagora\s+nao\b|\bnao\s+(?:e|eh)\s+um\s+bom\s+momento\b/,
    /\b(?:to|estou)\s+sem\s+(?:grana|dinheiro)\b/,
    /\b(?:falar|conversar|ver)\s+com\s+(?:minha|meu|a|o)?\s*(?:esposa|marido|familia|pai|mae)\b/,
    /\bso\s+(?:estou\s+)?pesquisando\b|\bpesquisando\s+por\s+enquanto\b/,
  ].some((pattern) => pattern.test(normalized));
}

function getBareAmbiguityReply(message = '', lead = {}) {
  const history = Array.isArray(lead.history) ? lead.history : [];
  const lastEntry = history[history.length - 1];
  const priorHistory = lastEntry?.role === 'user'
    && cleanString(lastEntry.content) === cleanString(message)
    ? history.slice(0, -1)
    : history;
  const hasPriorContext = priorHistory.some((entry) => cleanString(entry?.content))
    || !!cleanString(lead.aiMemory?.currentTopic)
    || !!cleanString(lead.aiMemory?.primaryNeed);
  if (hasPriorContext) return '';

  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized && /\?/.test(String(message || ''))) return 'Pode me dizer o que voc\u00ea precisa?';
  if (/^quanto$/.test(normalized)) return 'Voc\u00ea quer saber o valor de qu\u00ea?';
  if (/^cobre$/.test(normalized)) return 'O que voc\u00ea gostaria de saber se est\u00e1 inclu\u00eddo?';
  if (/^(?:isso|e isso)$/.test(normalized)) return 'A qual ponto voc\u00ea est\u00e1 se referindo?';
  if (/^(?:deu ruim(?: aqui)?|preciso de ajuda|me ajuda|quero resolver (?:uma )?coisa)$/.test(normalized)) {
    return 'O que aconteceu?';
  }
  return '';
}

function isPromptManipulationRequest(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(?:ignore|desconsidere|esqueca)\b.{0,35}\b(?:regras?|instrucoes?|prompt|orientacoes?)\b/.test(normalized)
    || /\b(?:mostra|mostre|revele|envie)\b.{0,35}\b(?:instrucoes?|prompt|regras?)\b.{0,20}\b(?:internas?)?\b/.test(normalized);
}

function isAssociationStatusOnly(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:eu )?(?:ja )?sou (?:associado|associada|cliente)(?: da moove)?$/.test(normalized)
    || /^(?:eu )?(?:ja )?faco parte (?:da moove|da associacao)$/.test(normalized);
}

function isAdhesionRequest(message = '') {
  const normalized = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\b(?:quero|gostaria de|como (?:eu )?faco(?: para| pra)?)\b.{0,35}\b(?:aderir|me associar|ser associado|entrar (?:na|pra|para a) moove|fazer parte (?:da|dessa) associacao)\b/.test(normalized)
    || /\b(?:aderir|me associar|entrar (?:na|pra|para a) moove)\b/.test(normalized);
}

function actionForLeadState(action, lead = {}) {
  const hasModelYear = !!lead.model && !!lead.year;
  if (action === 'ask_plate_optional') {
    return hasModelYear ? 'handoff_sales' : 'ask_model_year';
  }
  if (action === 'ask_model_year' && hasModelYear) {
    return 'handoff_sales';
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
  let mode = OPERATIONAL_INTENTS.has(primaryIntent) ? 'operational' : 'sales';
  let answerStatus = ['answered', 'partial', 'unknown', 'not_applicable'].includes(parsed.answerStatus)
    ? parsed.answerStatus
    : 'unknown';
  const deterministicDecision = classifyDeterministicIntent(message);
  const temporaryCustomerWait = isTemporaryCustomerWait(message, lead)
    && !(deterministicDecision.explicit && deterministicDecision.mode === 'operational');
  const deterministicOperationalIntent = deterministicDecision.explicit
    && deterministicDecision.mode === 'operational'
    ? (deterministicDecision.intent === 'angry_customer' ? 'human_requested' : deterministicDecision.intent)
    : null;
  const deterministicConversationStop = deterministicDecision.explicit
    && deterministicDecision.mode === 'sales'
    && deterministicDecision.intent === 'no_interest';
  const knowledgeIds = [...new Set(
    cleanStringList(parsed.knowledgeIds, 10, 120)
      .map(normalizeKnowledgeId)
      .filter((id) => validKnowledgeIds.has(id)),
  )];
  const extractedFacts = normalizeExtractedFacts(parsed.extractedFacts, message);
  const sourceInferredIntent = inferFactualIntentFromKnowledgeIds(knowledgeIds);
  const vehicleAppEligibility = isVehicleAppEligibilityQuestion(message)
    && knowledgeIds.some((id) => /accepted[-_]vehicles|veiculos-aceitos/.test(id));
  const additionalDriverQuestion = isAdditionalDriverEligibilityQuestion(message);
  const ambiguityReply = getBareAmbiguityReply(message, lead);
  const promptManipulation = isPromptManipulationRequest(message);
  const associationStatusOnly = isAssociationStatusOnly(message);
  const adhesionRequest = isAdhesionRequest(message);
  const trustObjection = isTrustObjection(message);
  const existingProviderObjection = isExistingProviderObjection(message);
  const regulationQuestion = /\bregulamento\b/i.test(message);
  const regulationSourceId = 'company-profile.regulamento-e-analise';
  const hasRegulationSource = regulationQuestion && validKnowledgeIds.has(regulationSourceId);

  if (vehicleAppEligibility) {
    primaryIntent = 'eligibility_question';
    secondaryIntent = 'none';
    mode = 'sales';
    if (action === 'handoff_operational') action = 'respond';
  }
  if (additionalDriverQuestion) {
    primaryIntent = 'eligibility_question';
    secondaryIntent = 'none';
    mode = 'sales';
    if (action === 'handoff_operational') action = 'handoff_sales';
  }
  if (deterministicOperationalIntent && OPERATIONAL_INTENTS.has(deterministicOperationalIntent)) {
    primaryIntent = deterministicOperationalIntent;
    secondaryIntent = 'none';
    action = 'handoff_operational';
    mode = 'operational';
    answerStatus = 'not_applicable';
  }
  if (temporaryCustomerWait) {
    primaryIntent = 'other';
    secondaryIntent = 'none';
    action = 'respond';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }
  if (deterministicConversationStop) {
    primaryIntent = 'no_interest';
    secondaryIntent = 'none';
    action = 'stop';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }
  if (ambiguityReply) {
    primaryIntent = 'unknown';
    secondaryIntent = 'none';
    action = 'clarify';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }
  if (promptManipulation) {
    primaryIntent = 'other';
    secondaryIntent = 'none';
    action = 'respond';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }
  if (associationStatusOnly) {
    primaryIntent = 'other';
    secondaryIntent = 'none';
    action = 'clarify';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }

  if (primaryIntent === 'human_requested'
    && action === 'respond'
    && /assistente\s+de\s+atendimento|n[aã]o\s+sou\s+(?:uma\s+)?pessoa/i.test(String(parsed.reply || ''))) {
    primaryIntent = 'assistant_identity';
    mode = 'sales';
  }
  const platePurposeQuestion = isPlatePurposeQuestion(message);
  const dataPurposeQuestion = isDataPurposeQuestion(message);
  const plateQuestionInKnownSalesContext = !!lead.plateRequestedAt
    && /\bplaca\b/i.test(String(parsed.reply || ''));
  if ((platePurposeQuestion || plateQuestionInKnownSalesContext)
    && !OPERATIONAL_INTENTS.has(primaryIntent)
    && action === 'respond'
  ) {
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }
  if (dataPurposeQuestion && !OPERATIONAL_INTENTS.has(primaryIntent)) {
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }
  const unregisteredVehicleQuote = isUnregisteredVehicleQuote(message);
  const plateRefused = isPlateRefusal(message)
    && (!!lead.plateRequestedAt || /\bplaca\b/i.test(message));
  const plateRefusalNeedsVehicleData = plateRefused
    && hasQuoteLanguage(message)
    && !((lead.model || extractedFacts.vehicleModel) && (lead.year || extractedFacts.vehicleYear));
  if (plateRefused) {
    primaryIntent = plateRefusalNeedsVehicleData ? 'sales_quote' : 'objection';
    secondaryIntent = 'none';
    action = plateRefusalNeedsVehicleData ? 'ask_model_year' : 'handoff_sales';
    mode = 'sales';
    answerStatus = 'not_applicable';
  }
  if (unregisteredVehicleQuote) {
    primaryIntent = 'sales_quote';
    secondaryIntent = 'none';
    action = 'ask_model_year';
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
      && !vehicleAppEligibility
      && !additionalDriverQuestion
      && FACTUAL_INTENTS.has(primaryIntent)
      && primaryIntent !== 'sales_price_request') {
      primaryIntent = sourceInferredIntent;
    }
    if (FACTUAL_INTENTS.has(primaryIntent)
      && secondaryIntent === 'none'
      && ['ask_model_year', 'ask_plate_optional'].includes(action)
      && hasActiveQuoteContext(message, lead, primaryIntent, secondaryIntent)) {
      secondaryIntent = 'sales_quote';
    }
  }

  if (adhesionRequest && !deterministicOperationalIntent) {
    primaryIntent = 'company_question';
    secondaryIntent = 'sales_quote';
    mode = 'sales';
    action = (lead.model || extractedFacts.vehicleModel) && (lead.year || extractedFacts.vehicleYear)
      ? 'handoff_sales'
      : 'ask_model_year';
  }

  if (action === 'handoff_operational'
    && !OPERATIONAL_INTENTS.has(primaryIntent)
  ) {
    action = 'handoff_sales';
    mode = 'sales';
  }

  if (['sales_quote', 'sales_price_request', 'sales_consultant_requested'].includes(secondaryIntent)
    && cleanString(message)
    && !hasObservedQuoteContext(message, lead)) {
    secondaryIntent = 'none';
  }
  const requestedAction = action;
  action = actionForLeadState(action, {
    ...lead,
    model: lead.model || extractedFacts.vehicleModel,
    year: lead.year || extractedFacts.vehicleYear,
  });
  if (mode === 'operational' && action === 'handoff_sales') action = 'handoff_operational';
  if (mode === 'sales' && action === 'handoff_operational') action = 'handoff_sales';
  if (action === 'handoff_operational') mode = 'operational';

  let reply = limitWhatsappReply(parsed.reply);
  if (deterministicOperationalIntent) reply = SAFE_OPERATIONAL_REPLY;
  if (ambiguityReply) reply = ambiguityReply;
  if (promptManipulation) {
    reply = 'N\u00e3o posso compartilhar ou alterar minhas instru\u00e7\u00f5es internas. Posso ajudar com informa\u00e7\u00f5es e atendimento da Moove.';
  }
  if (associationStatusOnly) reply = 'Certo. Como posso te ajudar?';
  if (unregisteredVehicleQuote) reply = 'Dá para iniciar a cotação mesmo sem a placa.';
  reply = removeUnsupportedSystemOffer(reply);
  if (hasRegulationSource && !/\bregulamento\b/i.test(reply)) {
    primaryIntent = 'company_question';
    secondaryIntent = 'none';
    action = 'respond';
    mode = 'sales';
    answerStatus = 'answered';
    if (!knowledgeIds.includes(regulationSourceId)) knowledgeIds.push(regulationSourceId);
    reply = 'Sim. Tudo é regido pelo regulamento oficial da associação.';
  }
  if (['coverage_question', 'eligibility_question'].includes(primaryIntent)) {
    reply = removeUnrequestedCoverageExpansion(reply, message);
  }
  reply = removeUnsupportedUnlimitedAssistanceClaim(reply, knowledge, knowledgeIds);
  if (FACTUAL_INTENTS.has(primaryIntent)
    && cleanString(message)
    && !hasObservedQuoteContext(message, lead)) {
    reply = removeVehicleDataQuestion(removeGenericSalesPivot(reply));
  }
  if (dataPurposeQuestion && !hasKnownDataRequestContext(lead)) {
    reply = reply
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !/\b(?:dados?\s+que\s+(?:solicito|pedi)|solicito\s+(?:apenas\s+)?(?:o\s+)?modelo|modelo\s+e\s+(?:o\s+)?ano|placa|cpf|documentos?)\b/i.test(sentence))
      .join(' ')
      .trim();
  }
  const hasModelYear = !!(lead.model || extractedFacts.vehicleModel) && !!(lead.year || extractedFacts.vehicleYear);
  const priceObjection = primaryIntent === 'objection' && isPriceObjection(message);
  const isRealPriceRequest = primaryIntent === 'sales_price_request'
    || (secondaryIntent === 'sales_price_request' && !priceObjection);
  const needsRealQuote = isRealPriceRequest;
  const priceReadyForHandoff = needsRealQuote && hasModelYear;
  const priceNeedsVehicleData = needsRealQuote && !hasModelYear;
  if (priceNeedsVehicleData) {
    action = 'ask_model_year';
    mode = 'sales';
    answerStatus = 'not_applicable';
    if (!/modelo/i.test(reply) || !/ano/i.test(reply) || !/\?/.test(reply)) reply = MODEL_YEAR_QUESTION;
  }
  if (priceReadyForHandoff) {
    action = 'handoff_sales';
    mode = 'sales';
    answerStatus = 'not_applicable';
    if (!isSafeGeneratedPriceHandoff(reply)) {
      reply = 'Com o modelo e o ano já consigo adiantar seu pedido. Encaminhei para um consultor preparar o valor real e continuar por aqui.';
    }
  }
  if (action === 'ask_model_year'
    && ['company_question', 'coverage_question', 'eligibility_question', 'objection'].includes(primaryIntent)
    && (!hasObservedQuoteContext(message, lead) || wasVehicleDataQuestionRecentlyAsked(lead))
    && !(!cleanString(message) && ['sales_quote', 'sales_price_request'].includes(secondaryIntent))) {
    action = 'respond';
    reply = removeVehicleDataQuestion(reply) || SAFE_OBJECTION_CONTINUATION;
  }
  if (primaryIntent === 'objection' && !hasObservedQuoteContext(message, lead)) {
    reply = removeGenericSalesPivot(reply) || SAFE_OBJECTION_CONTINUATION;
  }
  const objectionMakesFactualClaim = primaryIntent === 'objection'
    && ['answered', 'partial'].includes(answerStatus)
    && /\b(?:moove|associa[cç][aã]o|mutualismo|rateio|regulamento|vistoria|fipe|cobertura|prote[cç][aã]o|benef[ií]cio|processo|seguran[cç]a|transpar[eê]ncia)\b/i.test(reply);
  const factualAnswerNeedsEvidence = (FACTUAL_INTENTS.has(primaryIntent)
      && ['answered', 'partial'].includes(answerStatus))
    || objectionMakesFactualClaim;
  if (additionalDriverQuestion
    && !hasExplicitAdditionalDriverRule(knowledge, knowledgeIds, message)) {
    answerStatus = 'unknown';
    action = 'handoff_sales';
    mode = 'sales';
    reply = SAFE_UNKNOWLEDGE_REPLY;
  }
  if (hasUnsupportedPaymentAssurance(reply, knowledge, knowledgeIds)) {
    action = 'handoff_sales';
    mode = 'sales';
    answerStatus = 'partial';
    reply = SAFE_EVENT_PAYMENT_REPLY;
  }
  if (mode === 'sales' && hasIncompleteEventPaymentAnswer(reply, message, action)) {
    action = 'handoff_sales';
    answerStatus = 'partial';
    reply = SAFE_EVENT_PAYMENT_REPLY;
  }
  if (priceNeedsVehicleData
    && objectionMakesFactualClaim
    && (knowledgeIds.length === 0 || knowledge.confidence === 'low')) {
    answerStatus = 'not_applicable';
    reply = ensureVehicleDataQuestion(pickSafeAcknowledgement(reply), {
      model: lead.model || extractedFacts.vehicleModel,
      year: lead.year || extractedFacts.vehicleYear,
    });
  }
  if (!priceReadyForHandoff && hasUnsafeGeneralFipePromise(parsed.reply, knowledge, knowledgeIds, message)) {
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    action = 'handoff_sales';
    mode = 'sales';
    answerStatus = 'partial';
    reply = SAFE_FIPE_REPLY;
  }
  if (plateRefused) {
    reply = plateRefusalNeedsVehicleData
      ? 'Sem problema, não precisa informar a placa nesta etapa.'
      : PLATE_WITHHELD_REPLY;
  }
  if (platePurposeQuestion) {
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    action = 'respond';
    mode = 'sales';
    answerStatus = 'not_applicable';
    reply = PLATE_EXPLANATION_REPLY;
  }
  if (!plateRefused
    && lead.plateRequestedAt
    && primaryIntent === 'objection'
    && /placa/i.test(reply)
    && /rastream|assist[eê]ncia|consult(?:ei|ar)|sistema/i.test(reply)) {
    reply = PLATE_EXPLANATION_REPLY;
  }
  const softSalesHesitation = isSoftSalesHesitation(message);
  if (softSalesHesitation
    && (primaryIntent === 'no_interest'
      || primaryIntent === 'other'
      || action === 'stop'
      || (primaryIntent === 'sales_quote' && !hasQuoteLanguage(message)))) {
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    action = 'respond';
    mode = 'sales';
    answerStatus = 'not_applicable';
    reply = removeVehicleDataQuestion(reply) || SAFE_OBJECTION_CONTINUATION;
  }
  if (softSalesHesitation
    && /\b(?:at[eé]\s+mais|quando\s+quiser|estarei\s+[àa]\s+disposi[cç][aã]o|[eé]\s+s[oó]\s+chamar)\b/i.test(reply)) {
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    action = 'respond';
    mode = 'sales';
    answerStatus = 'not_applicable';
    reply = SAFE_HESITATION_REPLY;
  }
  if (hasExplicitObjectionLanguage(message)
    && !OPERATIONAL_INTENTS.has(primaryIntent)
    && primaryIntent !== 'no_interest') {
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    mode = 'sales';
    reply = removeGenericSalesPivot(reply) || SAFE_OBJECTION_CONTINUATION;
  }
  if (priceObjection && !isRealPriceRequest
    && (action === 'ask_model_year'
      || removeVehicleDataQuestion(reply) !== reply
      || isShallowPriceObjectionReply(reply)
      || (!reply.includes('?')
        && knowledgeIds.length === 0
        && !['handoff_sales', 'handoff_operational'].includes(action)))) {
    action = 'clarify';
    mode = 'sales';
    answerStatus = 'not_applicable';
    reply = buildPriceObjectionFallback(message);
  }
  if (primaryIntent === 'objection'
    && ['handoff_sales', 'handoff_operational'].includes(action)
    && (answerStatus === 'unknown' || [SAFE_OPERATIONAL_REPLY, SAFE_SALES_HANDOFF_REPLY, SAFE_UNKNOWLEDGE_REPLY].includes(reply))
    && knowledge.confidence !== 'low') {
    const groundedFallback = buildGroundedKnowledgeFallback(knowledge, knowledgeIds);
    if (groundedFallback) {
      action = 'respond';
      mode = 'sales';
      answerStatus = 'answered';
      reply = groundedFallback.reply;
      if (groundedFallback.id && !knowledgeIds.includes(groundedFallback.id)) {
        knowledgeIds.push(groundedFallback.id);
      }
    }
  }
  if (existingProviderObjection && !deterministicOperationalIntent) {
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    mode = 'sales';
    answerStatus = 'not_applicable';
    if (action !== 'respond' || /\b(?:encaminh|consultor)\w*\b/i.test(reply)) {
      action = 'respond';
      reply = 'Entendi. Qual ponto mais pesa para você ao comparar: valor, benefícios ou atendimento?';
    }
  }
  if (trustObjection && !deterministicOperationalIntent) {
    const trustSourcePattern = /company(?:-profile)?\.(?:overview|what_is_moove|o-que-e-a-moove)/i;
    const trustSourceId = knowledgeIds.find((id) => trustSourcePattern.test(id))
      || [...validKnowledgeIds].find((id) => trustSourcePattern.test(id));
    primaryIntent = 'objection';
    secondaryIntent = 'none';
    mode = 'sales';
    if (trustSourceId) {
      if (!knowledgeIds.includes(trustSourceId)) knowledgeIds.push(trustSourceId);
      action = 'respond';
      answerStatus = 'answered';
      reply = reply
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !(sentence.includes('?') && /\bconsultor\b/i.test(sentence)))
        .join(' ')
        .trim();
      if (!/\b(?:associa[cç][aã]o|mutualismo|rateio)\b/i.test(reply)
        || /n[aã]o encontrei|n[aã]o tenho essa informa[cç][aã]o/i.test(reply)) {
        reply = 'A Moove é uma associação civil sem fins lucrativos, baseada em mutualismo e rateio de despesas entre os associados.';
      }
    }
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
    && !priceNeedsVehicleData
    && factualAnswerNeedsEvidence
    && (knowledgeIds.length === 0 || knowledge.confidence === 'low')) {
    answerStatus = 'unknown';
    action = 'handoff_sales';
    mode = 'sales';
    reply = SAFE_UNKNOWLEDGE_REPLY;
  }

  if (!priceReadyForHandoff
    && !priceNeedsVehicleData
    && factualAnswerNeedsEvidence
    && answerStatus !== 'unknown'
    && asksForExactLimit(message)
    && hasOnlyUnspecifiedContractLimit(knowledge, knowledgeIds)) {
    answerStatus = 'unknown';
    action = 'handoff_sales';
    mode = 'sales';
    reply = SAFE_UNKNOWLEDGE_REPLY;
  }

  if (!priceReadyForHandoff
    && !priceNeedsVehicleData
    && factualAnswerNeedsEvidence
    && answerStatus !== 'unknown'
    && hasUnsupportedNumericClaim(reply, knowledge, message)) {
    answerStatus = 'unknown';
    action = 'handoff_sales';
    mode = 'sales';
    reply = SAFE_UNKNOWLEDGE_REPLY;
  }

  if (!priceReadyForHandoff
    && answerStatus === 'unknown'
    && (mode === 'operational' || FACTUAL_INTENTS.has(primaryIntent))) {
    action = mode === 'operational' ? 'handoff_operational' : 'handoff_sales';
    reply = mode === 'operational' ? SAFE_OPERATIONAL_REPLY : SAFE_UNKNOWLEDGE_REPLY;
  }

  if (hasImpossiblePromise(reply)) {
    action = 'handoff_operational';
    mode = 'operational';
    answerStatus = 'unknown';
    reply = SAFE_OPERATIONAL_REPLY;
  }

  if (temporaryCustomerWait) {
    primaryIntent = 'other';
    secondaryIntent = 'none';
    action = 'respond';
    mode = 'sales';
    answerStatus = 'not_applicable';
    reply = resolveTemporaryWaitReply(parsed.reply, lead);
  } else if (deterministicConversationStop) {
    primaryIntent = 'no_interest';
    secondaryIntent = 'none';
    action = 'stop';
    mode = 'sales';
    answerStatus = 'not_applicable';
    reply = SAFE_STOP_REPLY;
  }

  if (action === 'ask_model_year') {
    reply = ensureVehicleDataQuestion(reply, {
      model: lead.model || extractedFacts.vehicleModel,
      year: lead.year || extractedFacts.vehicleYear,
    });
  }
  if (action === 'handoff_sales'
    && reply.includes('?')
    && knowledgeIds.length > 0
    && ['answered', 'partial'].includes(answerStatus)) {
    const groundedAnswer = reply
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !sentence.includes('?'))
      .join(' ')
      .trim();
    if (groundedAnswer) {
      action = 'respond';
      reply = groundedAnswer;
    }
  }
  const priorConfirmedHandoff = hasPriorConfirmedHandoff(lead);
  if (action === 'handoff_operational'
    && priorConfirmedHandoff
    && wasReplyAlreadySent(reply, lead)) {
    reply = 'Recebi sua nova mensagem e encaminhei esta atualiza\u00e7\u00e3o ao consultor.';
  }
  if (action === 'handoff_sales'
    && priorConfirmedHandoff
    && wasReplyAlreadySent(reply, lead)) {
    reply = 'Recebi sua nova mensagem e tamb\u00e9m a encaminhei ao consultor para confirma\u00e7\u00e3o.';
  }
  if (action === 'handoff_sales'
    && isVehicleCorrectionMessage(message)
    && (lead.model || extractedFacts.vehicleModel)
    && (lead.year || extractedFacts.vehicleYear)) {
    const correctedVehicle = [
      lead.model || extractedFacts.vehicleModel,
      lead.year || extractedFacts.vehicleYear,
    ].filter(Boolean).join(' ');
    reply = `Certo, atualizei o ve\u00edculo para ${correctedVehicle} e encaminhei a corre\u00e7\u00e3o ao consultor.`;
  }
  if (['handoff_sales', 'handoff_operational'].includes(action)
    && (reply.includes('?')
      || !/(?:encaminh(?:ei|ado|ada)|passei|direcionei|consultor\s+(?:j[aá]\s+)?(?:recebeu|continuar[aá]|segue))/i.test(reply))) {
    reply = action === 'handoff_operational' ? SAFE_OPERATIONAL_REPLY : SAFE_SALES_HANDOFF_REPLY;
  }
  if (action === 'handoff_sales' && reply === SAFE_SALES_HANDOFF_REPLY) {
    const knownVehicle = [
      lead.model || extractedFacts.vehicleModel,
      lead.year || extractedFacts.vehicleYear,
    ].filter(Boolean).join(' ');
    if (knownVehicle) {
      reply = `Recebi os dados do ${knownVehicle} e encaminhei para um consultor continuar a cota\u00e7\u00e3o por aqui.`;
    }
  }
  if (!reply) {
    reply = action === 'handoff_operational' ? SAFE_OPERATIONAL_REPLY : SAFE_UNKNOWLEDGE_REPLY;
    action = mode === 'operational' ? 'handoff_operational' : 'handoff_sales';
  }

  const phoneResolved = !!getLeadRealPhone(lead);
  const memory = normalizeMemory(parsed.memory, lead.aiMemory || {});
  if (deterministicOperationalIntent) {
    const topic = OPERATIONAL_HANDOFF_TOPICS[deterministicOperationalIntent] || 'Atendimento operacional';
    memory.currentTopic = topic;
    memory.primaryNeed = topic;
    memory.customerGoal = topic;
    memory.salesStage = 'operational';
    memory.pendingQuestion = '';
    memory.lastQuestionAsked = '';
  }
  if (temporaryCustomerWait) {
    const previousMemory = lead.aiMemory || {};
    const pendingQuestion = !lead.model && !lead.year
      ? 'modelo e ano do veículo'
      : !lead.model
        ? 'modelo do veículo'
        : 'ano do veículo';
    memory.customerGoal = cleanString(previousMemory.customerGoal || 'fazer uma cotação', 180);
    memory.currentTopic = cleanString(previousMemory.currentTopic || 'cotação de proteção veicular', 120);
    memory.salesStage = 'qualification';
    memory.primaryNeed = cleanString(previousMemory.primaryNeed || 'receber uma cotação', 180);
    memory.pendingQuestion = cleanString(previousMemory.pendingQuestion || pendingQuestion, 180);
    memory.lastQuestionAsked = cleanString(
      previousMemory.lastQuestionAsked
        || [...(lead.history || [])].reverse().find((entry) => entry?.role === 'assistant'
          && /\b(?:modelo|ano)\b/i.test(String(entry.content || '')))?.content,
      180,
    );
  }
  if (deterministicConversationStop) {
    memory.salesStage = 'closed';
    memory.pendingQuestion = '';
    memory.lastQuestionAsked = '';
  }
  if (associationStatusOnly) {
    memory.customerType = 'associated';
    memory.currentTopic = 'atendimento de associado';
    memory.primaryNeed = '';
    memory.pendingQuestion = 'necessidade do cliente';
    memory.lastQuestionAsked = 'Como posso te ajudar?';
  }
  const shouldHandoff = action === 'handoff_sales' || action === 'handoff_operational';
  const handoffSummary = deterministicOperationalIntent
    ? buildOperationalHandoffSummary(deterministicOperationalIntent, message)
    : shouldHandoff
      ? buildSalesHandoffSummary({
          primaryIntent,
          secondaryIntent,
          message,
          memory,
          lead,
          extractedFacts,
        }) || buildFallbackHandoffSummary(memory, lead, extractedFacts)
      : '';
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
    handoffSummary,
    memory,
    extractedFacts,
    plateWithheld: plateRefused || !!lead.plateWithheld,
    shouldHandoff,
    shouldAskPhone: (action === 'handoff_sales' || action === 'handoff_operational') && !phoneResolved,
    shouldStopAutomation: action === 'stop' || action === 'handoff_sales' || action === 'handoff_operational',
    provider,
    model,
    architecture: 'customer-agent-v2',
    preservePendingQualification: temporaryCustomerWait,
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
    .map((entry) => `${entry.role === 'assistant' ? 'ASSISTENTE' : 'CLIENTE'}: ${cleanString(redactSensitiveText(entry.content), 500)}`);
  const safeLatest = cleanString(redactSensitiveText(latestMessage), 800);
  if (!entries.length || !entries[entries.length - 1].endsWith(safeLatest)) {
    entries.push(`CLIENTE: ${safeLatest}`);
  }
  return entries.join('\n');
}

export function buildKnowledgeQuery(message = '', lead = {}) {
  const latest = cleanString(message, 600);
  const normalized = latest.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = normalized.match(/[a-z0-9]+/g) || [];
  const needsContext = words.length <= 4
    || /^(?:e|mas|isso|essa|esse|tambem|nesse caso|e se|como assim|por que|pq|quanto)\b/.test(normalized);
  if (!needsContext) return latest;

  const previousUserMessage = [...(lead.history || [])]
    .reverse()
    .find((entry) => entry?.role === 'user'
      && entry.content
      && cleanString(entry.content, 600) !== latest)?.content;
  const contextParts = [
    latest,
    lead.aiMemory?.currentTopic,
    previousUserMessage,
  ].map((part) => cleanString(part, 600)).filter(Boolean);
  return [...new Set(contextParts)].join(' | ');
}

export function buildCustomerAgentContext({ config = {}, lead = {}, message = '', knowledge = {} } = {}) {
  const agentName = config.agentName || 'Júlia';
  const companyName = config.companyName || 'Moove Proteção Veicular';
  const personalityGuidance = {
    human: 'Fale de modo caloroso e espontaneo, adaptando o vocabulario ao cliente sem exagerar em girias e sem fingir ser humana.',
    balanced: 'Fale de modo cordial, profissional e natural, mantendo clareza e proximidade.',
    robot: 'Fale de modo direto, objetivo e economico, sem perder educacao ou contexto.',
  }[config.aiPersonality] || 'Fale de modo caloroso e espontaneo, sem exagerar em girias e sem fingir ser humana.';
  const salesGuidance = {
    aggressive: 'Conducao proativa: sugira cedo o menor proximo passo util quando houver interesse real, sem pressionar, criar urgencia ou atropelar duvidas.',
    balanced: 'Conducao consultiva: entenda a necessidade, responda a barreira atual e avance de forma natural, sem pressao.',
    soft: 'Conducao cautelosa: priorize duvidas e confianca, oferecendo o proximo passo apenas quando o cliente demonstrar abertura.',
  }[config.aiAggression] || 'Conducao consultiva: entenda a necessidade, responda a barreira atual e avance de forma natural, sem pressao.';
  const configuredCompanyInfo = cleanString(config.companyInfo, 4000);
  const campaignContext = lead.campaignId
    ? {
      name: cleanString(lead.campaignName, 120),
      objective: cleanString(lead.campaignObjective, 160),
      openingMessage: cleanString(redactSensitiveText(lead.campaignMessage || lead.lastCampaignMessage), 1200),
      guidance: cleanString(redactSensitiveText(lead.campaignAiInstructions), 1000),
    }
    : null;
  const systemPrompt = `Você é ${agentName}, assistente de atendimento e vendas da ${companyName} no WhatsApp.

OBJETIVO E INTENÇÃO
- Entenda a necessidade real, responda dúvidas e conduza interessados até o consultor. Crie cada resposta para o contexto; não use menu, script rígido ou frase decorada.
- Registre uma intenção principal e, se houver, uma secundária. Dúvida factual junto com cotação: a dúvida é principal e sales_quote é secundária.
- company_question: empresa, associação, contato, adesão e vencimento. coverage_question: benefícios, assistência e regras de eventos. eligibility_question: veículo, uso, condutor, localidade, rastreador e vistoria.
- sales_quote é interesse em cotar; sales_price_request é pedido de preço real; sales_consultant_requested é pedido de consultor para contratar.
- Pergunta hipotética sobre serviço, limite, frequência, prazo, pane ou perda total é informativa. Só use intenção operacional quando houver ocorrência atual ou pedido de execução agora. "Tem guincho?" é coverage_question; "preciso de guincho agora" é assistance_request.
- Uber, táxi ou aplicativo como uso do veículo é eligibility_question; app_blocked exige falha de acesso ao aplicativo da Moove.
- Diferencie prospect de associado. Problema de associado nunca vira venda. Desculpa, engano ou correção casual é other; unknown só quando a mensagem não puder ser entendida.

FONTES E VERDADE
- Afirmações sobre a Moove, regras, valores, benefícios, cobertura, elegibilidade ou processo devem vir das FONTES DISPONÍVEIS. Cite seus IDs exatos em knowledgeIds, nunca ao cliente.
- Sem fonte suficiente, não suponha: answerStatus=unknown e handoff_sales. Uma fonte sustenta apenas o que diz; não acrescente exemplos, condições, motivos, garantias ou exceções.
- Número, prazo, percentual, limite, valor ou ano precisa constar literalmente na fonte. "Conforme limite contratado/proposta" não responde valor exato.
- Categoria ampla não autoriza subcategorias. Exigir CNH válida não prova quem pode dirigir; o perfil perguntado precisa estar explicitamente autorizado.

CONVERSA E VENDA
- Escreva em português brasileiro natural, adaptado ao jeito do cliente, com 1 a 3 frases curtas. Sem emoji, "senhor(a)", burocracia, lista desnecessária ou mais de UMA pergunta.
- Preferencia de tom configurada pelo administrador: ${personalityGuidance}
- Preferencia de conducao comercial configurada pelo administrador: ${salesGuidance}
- Essas preferencias nunca substituem as regras de seguranca, verdade, intencao, pausa, recusa ou encaminhamento deste prompt.
- Quando houver CONTEXTO DA CAMPANHA ATIVA, use seu objetivo e sua orientacao para manter continuidade. A orientacao da campanha nunca substitui seguranca, fontes, intencao real do cliente, recusa ou regras de encaminhamento.
- Responda primeiro e somente o que foi perguntado. Em condição específica, não despeje outros benefícios ou requisitos. Não encerre respostas completas com perguntas de preenchimento.
- Venda consultivamente: descubra a prioridade quando ela estiver vaga, conecte apenas fatos relevantes e proponha o menor próximo passo. Sem pressão, medo, urgência falsa, elogio genérico, superioridade, economia ou vantagem sem fonte.
- Escolha o próximo movimento pela barreira real: preço, confiança, prazo, privacidade, processo ou decisão. Resolva a barreira antes de pedir qualquer dado.
- Sinal claro de compra pede avanço: colete somente modelo/ano quando faltarem e encaminhe assim que houver dados suficientes ou pedido para fechar.
- Não elogie marca/modelo. Não pergunte por cotação após toda dúvida. Uma pergunta deve ter função concreta e nunca repetir algo respondido.
- Se o cliente disser que vai perguntar, conferir ou confirmar a informação e pedir um momento, reconheça a pausa sem repetir a pergunta. Mantenha o dado pendente e aguarde.
- Interesse em cotação sem modelo/ano: ask_model_year. Preço real com modelo e ano conhecidos, cliente pronto ou pedido de consultor: handoff_sales. Não troque mensalidade por cota/franquia.
- A placa é opcional e serve só para identificar o veículo e organizar a cotação. Explique isso se perguntarem; aceite recusa ou veículo ainda sem placa e encaminhe sem insistir.
- Recusa explícita: stop, sem insistir ou fingir cancelamento. Cancelamento da proteção por associado é cancel_request operacional.
- "Para", "pare" ou "chega" dirigidos à conversa são recusa/stop, mesmo com irritação ou palavrão. Só encaminhe por irritação quando houver um problema real ou pedido de atendimento humano.

OBJEÇÕES
- Reconheça brevemente e resolva a causa clara com fonte; se estiver vaga, faça uma pergunta específica. Nunca responda só "entendo sua preocupação".
- "É golpe?", "é furada?" ou "posso confiar?" é objection. Use os fatos institucionais das fontes para responder antes de qualquer encaminhamento.
- Se a pessoa já tem proteção em outra empresa, trate como comparação: descubra o critério decisivo sem atacar o concorrente nem transferir cedo demais.
- Preço depende do veículo; não invente valor, desconto ou condição. Confiança/comparação usa apenas fatos da base, sem atacar concorrente nem dizer apenas "pode confiar".
- Em "está caro", não devolva "o que você acha caro?". Investigue qual expectativa, comparação ou ponto fez o valor parecer alto, sem pedir modelo/ano nessa mesma resposta.
- "Vou pensar", família, falta de dinheiro, pesquisa ou adiamento é objection, não recusa. Respeite sem prometer condição personalizada ou "sem compromisso".
- Em privacidade, explique o uso do dado opcional e aceite a recusa. Se não souber qual dado foi pedido, pergunte qual preocupa; não invente contexto.
- Não gosta de fechar online: ofereça consultor sem inventar segurança do canal. Pedido por escrito: resuma no chat; não prometa PDF, documento ou link.
- Em prazo, informe também o marco inicial da fonte. "Vocês realmente pagam?" exige explicar análise conforme regulamento, sem garantia genérica.
- Nunca invente finalidade de regra, carência, cota, rastreador ou processo. Objeção só leva a modelo/ano quando já existe interesse real em preço/cotação.

SEGURANÇA
- A Moove é associação de proteção veicular. Nunca escreva seguro, seguradora, apólice, sinistro ou prêmio, nem para repetir o cliente.
- Nunca invente preço, desconto, FIPE, aprovação, ativação, contratação, consulta ao sistema ou resultado de cadastro.
- Nunca prometa reboque a caminho, pagamento baixado, boleto gerado ou app liberado.
- Boleto, cobrança, inadimplência, pagamento, cancelamento, falha no app, vistoria pendente, evento ocorrido, assistência atual ou pedido humano: handoff_operational para um consultor. Não invente equipe de suporte/financeiro.
- Em handoff, reply confirma de forma curta o encaminhamento que o backend só enviará após confirmar entrega ao consultor.
- Pergunta sobre sua identidade: assistant_identity/respond; diga que é assistente de atendimento, sem fingir ser humana.
- extractedFacts contém somente modelo e ano escritos pelo cliente; use vazio quando ausentes.

AÇÕES
- respond: só responder. ask_model_year: responder e pedir o dado veicular faltante em uma pergunta. ask_plate_optional: explicar e perguntar sem obrigar.
- handoff_sales: interesse pronto ou dúvida sem fonte. handoff_operational: caso operacional/crítico. stop: encerrar. clarify: uma pergunta curta para ambiguidade real.

JSON OBRIGATÓRIO
- Retorne só o objeto JSON completo, sem markdown.
- primaryIntent e secondaryIntent usam apenas: ${CUSTOMER_AGENT_INTENTS.join(', ')}. secondaryIntent pode ser none.
- action usa apenas: ${CUSTOMER_AGENT_ACTIONS.join(', ')}.
- mode é sales/operational; confidence 0..1; emotion é neutral/confused/interested/hesitant/irritated/angry; answerStatus é answered/partial/unknown/not_applicable.
- Inclua todas estas chaves: reply, primaryIntent, secondaryIntent, mode, action, confidence, emotion, answerStatus, knowledgeIds, reasoningSummary, handoffReason, handoffSummary, memory, extractedFacts.
- memory contém EXATAMENTE customerGoal, currentTopic, customerType, salesStage, primaryNeed, pendingQuestion, lastQuestionAsked, objections, decisionFactors, answeredTopics. Preserve fatos válidos e atualize pendências.
- extractedFacts contém vehicleModel e vehicleYear.`;

  const userMessage = `ESTADO ATUAL DO ATENDIMENTO
${JSON.stringify(buildLeadSnapshot(lead), null, 2)}

CONFIANÇA DA BUSCA DE CONHECIMENTO: ${knowledge.confidence || 'low'}
INFORMACOES OPERACIONAIS CONFIGURADAS PELO ADMINISTRADOR
${configuredCompanyInfo || '(nenhuma informacao operacional adicional)'}

CONTEXTO DA CAMPANHA ATIVA
${campaignContext ? JSON.stringify(campaignContext, null, 2) : '(esta conversa nao foi iniciada por uma campanha)'}

FONTES DISPONÍVEIS
${String(knowledge.text || '').trim().slice(0, 6000) || '(nenhuma fonte confirmou o assunto)'}

CONVERSA RECENTE
${buildRecentConversation(lead, message) || '(sem histórico)'}

ÚLTIMA MENSAGEM A RESPONDER
${cleanString(redactSensitiveText(message), 800)}`;

  return { systemPrompt, history: [], userMessage };
}

export async function runCustomerAgent({
  config = {},
  lead = {},
  message = '',
  knowledge = null,
  generate = callAI,
} = {}) {
  const resolvedKnowledge = knowledge || await getKnowledgeForMessage(buildKnowledgeQuery(message, lead));
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
  const validationContext = {
    lead,
    message,
    knowledge: resolvedKnowledge,
    provider: metadata.provider,
    model: metadata.model,
  };
  const firstTurn = validateCustomerAgentTurn(metadata.text, validationContext);
  if (!needsCustomerAgentRepair(firstTurn, resolvedKnowledge)) return firstTurn;

  try {
    const repaired = await generate(config, buildCustomerAgentRepairContext(context, firstTurn), {
      purpose: 'customer_agent',
      mode: 'sales',
      responseSchema: CUSTOMER_AGENT_RESPONSE_SCHEMA,
      returnMetadata: true,
    });
    const repairedMetadata = repaired && typeof repaired === 'object' && repaired.text !== undefined
      ? repaired
      : { text: repaired, provider: metadata.provider, model: metadata.model };
    const repairedTurn = validateCustomerAgentTurn(repairedMetadata.text, {
      ...validationContext,
      provider: repairedMetadata.provider,
      model: repairedMetadata.model,
    });
    return needsCustomerAgentRepair(repairedTurn, resolvedKnowledge)
      ? applyFinalRepairFallback(repairedTurn, lead)
      : repairedTurn;
  } catch {
    return applyFinalRepairFallback(firstTurn, lead);
  }
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
    step: turn.preservePendingQualification ? 'ask_model_year' : (stepMap[turn.action] || 'answer_question'),
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
