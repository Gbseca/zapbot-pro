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
  /\bquanto (fica|custa|seria|e)\b/,
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
  /\bquero protecao\b/,
  /\bquero contratar\b/,
  /\bquero aderir\b/,
  /\bproteger meu\b/
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

// Verify if plate is in standard Brazilian format
function extractValidPlate(text = '') {
  const tokens = String(text || '').match(/\b[A-Za-z]{3}[-\s]?\d[A-Za-z0-9][-\s]?\d{2}\b/g) || [];
  for (const token of tokens) {
    if (isValidBrazilPlate(token)) return normalizePlate(token);
  }
  return null;
}

export function getNextSalesStep(lead, text) {
  const normalized = normalizeText(text);
  
  // 1. Detect Intent
  let intent = 'general_question';
  if (matchAny(normalized, CONSULTANT_PATTERNS)) {
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
  } else if (lead.history && lead.history.length > 0) {
    // If we have history, infer from the flow, but default to general context
    intent = lead.lastIntent || 'general_question';
  }

  // 2. Identify missing data
  const hasModel = !!lead.model;
  const hasYear = !!lead.year;
  const hasPlate = !!(lead.plate && isValidBrazilPlate(lead.plate)) || !!lead.plateUnavailable;
  
  const missingData = [];
  if (!hasModel) missingData.push('model');
  if (!hasYear) missingData.push('year');
  if (!hasPlate) missingData.push('plate');

  const hasMinData = hasModel && hasYear && hasPlate;

  // 3. Check plate unavailability in client response
  const declaresNoPlate = matchAny(normalized, NO_PLATE_PATTERNS);
  const plateText = extractValidPlate(text);

  // 4. Check if phone is resolved
  // Real phone should be set in lead.phone or lead.displayNumber (if Baileys returns it)
  // Check if we need to request a phone number
  const isPhoneResolved = !!(lead.phone && lead.phone.length >= 10) || !!(lead.displayNumber && lead.displayNumber.length >= 10);

  // 5. State/Step Logic
  let step = 'new_lead';
  let requiredAction = 'respond';
  let allowedQuestion = null;
  let shouldHandoff = false;
  let shouldStopAutomation = false;
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
        allowedQuestion = 'Qual o modelo e o ano do veículo?';
        reason = 'Cliente pediu preço. Solicitando modelo e ano.';
      } else {
        requiredAction = 'ask_plate';
        allowedQuestion = 'Me passa a placa do veículo para eu puxar os dados e te mandar certinho?';
        reason = 'Cliente pediu preço. Já temos modelo e ano, solicitando placa.';
      }
    }
  }
  // Quote / Simulation / Active flow
  else if (intent === 'sales_quote' || declaresNoPlate || plateText || (hasModel && hasYear)) {
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
        allowedQuestion = 'Qual o modelo e o ano do veículo?';
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
    shouldHandoff,
    shouldStopAutomation,
    tone: 'comercial_leve',
    reason
  };
}
