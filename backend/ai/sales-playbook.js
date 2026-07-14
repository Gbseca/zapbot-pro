import { isValidBrazilPlate, normalizePlate } from './lead-detector.js';

// Text normalizer helper
function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

// Intent patterns
const CONSULTANT_PATTERNS = [
  /\b(consultor|vendedor|representante|comercial|especialista|humano|atendente|pessoa)\b/,
  /\bfalar com alguem\b/,
  /\bme passa para\b/,
  /\bcontato de\b/
];

const PRICE_PATTERNS = [
  /\b(quanto|qnt|qt) (fica|custa|seria|e)\b/,
  /\bqual (o )?valor\b/,
  /\bvalor mensal\b/,
  /\bmensalidade\b/,
  /\bpreco\b/,
  /\bcusta quanto\b/
];

const QUOTE_PATTERNS = [
  /\bcotacao\b/,
  /\borcamento\b/,
  /\bsimulacao\b/,
  /\b(qro|quero|queria|gostaria de) (cotar|cota|ver (uma )?protecao|fazer (uma )?cotacao)\b/,
  /\bcotar (meu|minha|um|uma|o|a)?\s*(carro|moto|veiculo)?\b/,
  /\bquero protecao\b/,
  /\bquero contratar\b/,
  /\bquero aderir\b/,
  /\bproteger meu\b/,
  /\bfaz protecao (pra|para)\b/,
  /\bprotecao (pro|pra|para o|para a) (meu|minha)\b/,
  /\bainda nao sou (cliente|associado).{0,35}\bquero pagar a protecao\b/
];

const NO_INTEREST_PATTERNS = [
  /\bnao quero\b/,
  /\bnao tenho interesse\b/,
  /\bsem interesse\b/,
  /\bdeixa pra la\b/,
  /\bnao obrigado\b/,
  /\bnao obg\b/
];

const OBJECTION_PATTERNS = [
  /\bcaro\b/,
  /\bpreco alto\b/,
  /\bmuito alto\b/,
  /\bpesado\b/,
  /\bfranquia\b/,
  /\bnao conheco\b/,
  /\boutra empresa\b/
];

const GENERAL_QUESTION_PATTERNS = [
  /\bcomo funciona\b/,
  /\bque tipo de\b/,
  /\bcobre\b/,
  /\bcobertura\b/,
  /\broubo\b/,
  /\bfurto\b/,
  /\bassistência\b/,
  /\b24h\b/,
  /\bcolisão\b/,
  /\brastreador\b/,
  /\bseguro\b/
];

const NO_PLATE_PATTERNS = [
  /\bnao (possui|tenho|tem) placa\b/,
  /\bsem placa\b/,
  /\bainda nao (tem|possui) placa\b/,
  /\bnao cadastrado\b/,
  /\bsem emplacamento\b/
];

const PLATE_REASON_PATTERNS = [
  /\b(?:por que|porque|pra que|para que)\b.{0,35}\bplaca\b/,
  /\b(?:qual|quero saber o) motivo\b.{0,30}\bplaca\b/,
  /\b(?:precisa|precisam|quer|querem|pede|pedem)\b.{0,30}\b(?:da |de |a |minha )?placa\b/,
];

const SHORT_PLATE_REASON_PATTERNS = [
  /^(?:por que|porque|pra que|para que|qual motivo)$/,
  /^(?:a |minha )?placa(?: mesmo)?$/,
];

const PLATE_PRIVACY_REFUSAL_PATTERNS = [
  /\b(?:nao quero|nao vou|nao posso|prefiro nao)\b.{0,20}\b(?:passar|informar|mandar|enviar|compartilhar|dar)\b.{0,20}\bplaca\b/,
  /\b(?:nao quero|prefiro nao)\b.{0,20}\b(?:passar|informar|mandar|enviar|compartilhar|dar)\b\s*(?:ela|isso)?\b/,
  /\b(?:pode ser|vamos|segue|continuar|continua)\b.{0,12}\bsem (?:a |minha )?placa\b/,
  /\bnao me sinto (?:confortavel|a vontade)\b.{0,30}\bplaca\b/,
];

const PLATE_SKIP_CONFIRMATION_PATTERNS = [
  /^(?:sim|pode|pode sim|ok|certo|beleza|blz|segue|pode seguir|continua|continue|pode continuar)$/,
];

const PLATE_REASON_REPLY = 'A placa ajuda o consultor a conferir os dados exatos do veiculo e evitar erro na cotacao. Se preferir nao informar agora, posso seguir so com o modelo e o ano.';

const SALES_CONTINUATION_PATTERNS = [
  /^(sim|s|ok|okay|certo|isso|pode|pode sim|quero|vamos|bora|manda|prosseguir|continuar)\b/,
  /\b(modelo|ano|placa|veiculo|carro|moto)\b/,
  /\b(19|20)\d{2}\b/,
];

const ACTIVE_SALES_INTENTS = new Set([
  'sales_quote',
  'sales_price_request',
  'sales_consultant_requested',
]);

// Verify if plate is in standard Brazilian format
function extractValidPlate(text = '') {
  const tokens = String(text || '').match(/\b[A-Za-z]{3}[-\s]?\d[A-Za-z0-9][-\s]?\d{2}\b/g) || [];
  for (const token of tokens) {
    if (isValidBrazilPlate(token)) return normalizePlate(token);
  }
  return null;
}

function shouldContinueFromSalesHistory(lead = {}, normalized = '', rawText = '') {
  if (!ACTIVE_SALES_INTENTS.has(lead.lastIntent)) return false;
  if (extractValidPlate(rawText)) return true;
  if (lead.stage === 'ask_model_year') {
    const words = normalized.split(/\s+/).filter(Boolean);
    const isBareVehicleAnswer = words.length >= 1
      && words.length <= 5
      && /[a-z]/.test(normalized)
      && !/\b(cotacao|cotar|cota|orcamento|simulacao|preco|valor|protecao|obg|valeu)\b/.test(normalized);
    if (isBareVehicleAnswer) return true;
  }
  return matchAny(normalized, SALES_CONTINUATION_PATTERNS);
}

function getModelYearQuestion(hasModel, hasYear) {
  if (!hasModel && !hasYear) return 'Qual o modelo e o ano do veiculo?';
  if (!hasModel) return 'Qual o modelo do veiculo?';
  return 'Qual o ano do veiculo?';
}

function isWaitingForPlate(lead = {}) {
  return lead.stage === 'ask_plate'
    || lead.operationalStatus === 'ask_plate'
    || (Array.isArray(lead.missingData) && lead.missingData.includes('plate'));
}

function asksWhyPlate(lead = {}, normalized = '') {
  if (matchAny(normalized, PLATE_REASON_PATTERNS)) return true;
  return isWaitingForPlate(lead) && matchAny(normalized, SHORT_PLATE_REASON_PATTERNS);
}

function declinesPlateSharing(lead = {}, normalized = '') {
  if (matchAny(normalized, PLATE_PRIVACY_REFUSAL_PATTERNS)) return true;
  if (lead.stage !== 'explain_plate_request') return false;
  return matchAny(normalized, PLATE_SKIP_CONFIRMATION_PATTERNS);
}

export function getNextSalesStep(lead, text, options = {}) {
  const normalized = normalizeText(text);
  const plateReasonQuestion = asksWhyPlate(lead, normalized);
  const repeatedPlateConcern = plateReasonQuestion && !!lead.plateReasonExplainedAt;
  const newPlateSkip = declinesPlateSharing(lead, normalized) || repeatedPlateConcern;
  const plateWithheld = !!lead.plateWithheld || newPlateSkip;
  const declaresNoPlate = matchAny(normalized, NO_PLATE_PATTERNS);
  const plateText = extractValidPlate(text);
  
  // 1. Detect Intent
  const preferredIntent = [
    'general_question',
    'no_interest',
    'sales_consultant_requested',
    'sales_price_request',
    'sales_quote',
  ].includes(options.preferredIntent) ? options.preferredIntent : null;
  let intent = preferredIntent || 'general_question';
  if (newPlateSkip && !lead.plateWithheld) {
    intent = 'plate_declined';
  } else if (plateReasonQuestion) {
    intent = 'plate_reason_question';
  } else if (preferredIntent) {
    intent = preferredIntent;
  } else if (matchAny(normalized, CONSULTANT_PATTERNS)) {
    intent = 'sales_consultant_requested';
  } else if (matchAny(normalized, NO_INTEREST_PATTERNS)) {
    intent = 'no_interest';
  } else if (matchAny(normalized, OBJECTION_PATTERNS)) {
    intent = 'objection_detected';
  } else if (matchAny(normalized, PRICE_PATTERNS)) {
    intent = 'sales_price_request';
  } else if (matchAny(normalized, QUOTE_PATTERNS)) {
    intent = 'sales_quote';
  } else if (matchAny(normalized, GENERAL_QUESTION_PATTERNS)) {
    intent = 'general_question';
  } else if (lead.history && lead.history.length > 0 && shouldContinueFromSalesHistory(lead, normalized, text)) {
    // Continue a sales flow only when the latest message looks like an answer to that flow.
    intent = lead.lastIntent || 'general_question';
  }

  // 2. Identify missing data
  const hasModel = !!lead.model;
  const hasYear = !!lead.year;
  const hasPlate = !!(lead.plate && isValidBrazilPlate(lead.plate))
    || !!lead.plateUnavailable
    || declaresNoPlate
    || plateWithheld;
  
  const missingData = [];
  if (!hasModel) missingData.push('model');
  if (!hasYear) missingData.push('year');
  if (!hasPlate) missingData.push('plate');

  const hasMinData = hasModel && hasYear && hasPlate;

  // 3. Check if phone is resolved
  // Real phone should be set in lead.phone or lead.displayNumber (if Baileys returns it)
  // Check if we need to request a phone number
  const isPhoneResolved = !!(lead.phone && lead.phone.length >= 10) || !!(lead.displayNumber && lead.displayNumber.length >= 10);

  // 5. State/Step Logic
  let step = 'new_lead';
  let requiredAction = 'respond';
  let allowedQuestion = null;
  let shouldHandoff = false;
  let shouldStopAutomation = false;
  let clientReply = '';
  let reason = 'Início de conversa com novo lead.';

  // If client requested consultant/human
  if (intent === 'sales_consultant_requested') {
    step = 'consultant_requested';
    if (!isPhoneResolved) {
      requiredAction = 'ask_ddd_phone';
      allowedQuestion = 'Me passa seu WhatsApp com DDD para eu encaminhar ao consultor responsável?';
      reason = 'Cliente pediu consultor, solicitando telefone com DDD.';
    } else {
      requiredAction = 'execute_handoff';
      shouldHandoff = true;
      shouldStopAutomation = true;
      reason = 'Cliente pediu consultor, encaminhando para o time comercial.';
    }
  } 
  // Explain the purpose of the plate instead of repeating the collection question.
  else if (intent === 'plate_reason_question') {
    step = 'explain_plate_request';
    requiredAction = 'explain_plate_request';
    clientReply = PLATE_REASON_REPLY;
    reason = 'Cliente perguntou por que a placa e solicitada; explicar a finalidade e oferecer continuidade sem ela.';
  }
  // Respect a privacy refusal and continue with the quote using model and year.
  else if (intent === 'plate_declined') {
    if (!hasModel || !hasYear) {
      step = 'ask_model_year';
      requiredAction = 'ask_model_year';
      allowedQuestion = getModelYearQuestion(hasModel, hasYear);
      reason = 'Cliente preferiu nao informar a placa; ainda faltam modelo ou ano.';
    } else {
      step = 'quote_ready_for_handoff';
      requiredAction = 'execute_handoff';
      shouldHandoff = true;
      shouldStopAutomation = true;
      reason = 'Cliente preferiu nao informar a placa; cotacao sera encaminhada com modelo e ano.';
    }
  }
  // If client is refusing or has no interest
  else if (intent === 'no_interest') {
    step = 'no_interest';
    requiredAction = 'stop_automation';
    shouldStopAutomation = true;
    reason = 'Cliente declarou não ter interesse.';
  } 
  // If client has objections
  else if (intent === 'objection_detected') {
    step = 'objection_detected';
    requiredAction = 'respond_objection';
    reason = 'Cliente apresentou objeção de valor ou confiança.';
  }
  // Price request
  else if (intent === 'sales_price_request') {
    step = 'price_requested';
    if (hasMinData) {
      requiredAction = 'execute_handoff';
      shouldHandoff = true;
      shouldStopAutomation = true;
      reason = 'Cliente pediu preço e já temos dados suficientes. Encaminhando.';
    } else {
      // Need data to get price
      if (!hasModel || !hasYear) {
        requiredAction = 'ask_model_year';
        allowedQuestion = getModelYearQuestion(hasModel, hasYear);
        reason = 'Cliente pediu preço. Solicitando modelo e ano.';
      } else {
        requiredAction = 'ask_plate';
        allowedQuestion = 'Me passa a placa do veículo para eu puxar os dados e te mandar certinho?';
        reason = 'Cliente pediu preço. Já temos modelo e ano, solicitando placa.';
      }
    }
  }
  // Quote / Simulation / Active flow
  else if (intent === 'sales_quote' || declaresNoPlate || plateText) {
    step = 'quote_interest_detected';
    
    if (hasMinData) {
      step = 'quote_ready_for_handoff';
      requiredAction = 'execute_handoff';
      shouldHandoff = true;
      shouldStopAutomation = true;
      reason = 'Cotação pronta para handoff. Todos os dados coletados.';
    } else {
      if (!hasModel || !hasYear) {
        step = 'ask_model_year';
        requiredAction = 'ask_model_year';
        allowedQuestion = getModelYearQuestion(hasModel, hasYear);
        reason = 'Aguardando modelo e ano do veículo para cotação.';
      } else {
        step = 'ask_plate';
        requiredAction = 'ask_plate';
        allowedQuestion = 'Pode me passar a placa do veículo?';
        reason = 'Modelo e ano conhecidos. Solicitando a placa para fechar cotação.';
      }
    }
  }
  // FAQ / General doubts
  else {
    step = 'answer_general_question';
    requiredAction = 'respond';
    reason = 'Respondendo dúvida geral de cobertura ou funcionamento.';
  }

  return {
    mode: 'sales',
    step,
    intent,
    missingData,
    requiredAction,
    allowedQuestion,
    clientReply,
    plateWithheld,
    shouldHandoff,
    shouldStopAutomation,
    tone: 'comercial_leve',
    reason
  };
}
