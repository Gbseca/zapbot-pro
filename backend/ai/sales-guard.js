import { isValidBrazilPlate, normalizePlate } from './lead-detector.js';

const PRICE_REPLY = 'Eu nao consigo calcular o valor exato por aqui. Para nao te passar valor errado, vou encaminhar para um consultor preparar a cotacao com os dados do veiculo.';
const READY_REPLY = 'Recebi os dados principais. Vou encaminhar para um consultor preparar sua cotacao e continuar o atendimento por aqui.';
const CONSULTANT_REPLY = 'Claro. Vou encaminhar para um consultor continuar seu atendimento por aqui.';
const CONTRACT_REPLY = 'Essa etapa precisa ser finalizada com um consultor. Vou encaminhar para ele continuar com seguranca.';
const HANDOFF_FAILED_REPLY = 'Tentei encaminhar automaticamente, mas nao consegui confirmar o envio para o consultor agora. Vou deixar seu atendimento registrado para o time verificar.';

export const SALES_STOP_STATUSES = new Set([
  'transferred',
  'human_taken_over',
]);

const QUOTE_PATTERNS = [
  /\bquero (fazer )?(uma )?cotacao\b/,
  /\bfazer (uma )?cotacao\b/,
  /\bcotacao\b/,
  /\borcamento\b/,
  /\bsimulacao\b/,
  /\bquero protecao\b/,
  /\bquero contratar\b/,
  /\bquero aderir\b/,
];

const PRICE_PATTERNS = [
  /\bquanto (fica|custa|seria|e)\b/,
  /\bqual (o )?valor\b/,
  /\bvalor mensal\b/,
  /\bmensalidade\b/,
  /\bpreco\b/,
  /\bcusta quanto\b/,
];

const CONSULTANT_PATTERNS = [
  /\bquero falar com (um )?(consultor|vendedor|representante|comercial|especialista|humano|atendente|pessoa)\b/,
  /\bfalar com (um )?(consultor|vendedor|representante|comercial|especialista|humano|atendente|pessoa)\b/,
  /\bme passa(r)? para (um )?(consultor|vendedor|representante|comercial|especialista|humano|atendente|pessoa)\b/,
  /\bmanda (o )?contato do consultor\b/,
  /\bcontato do consultor\b/,
  /\bconsultor\b/,
  /\bvendedor\b/,
  /\brepresentante\b/,
  /\bespecialista\b/,
  /\batendente\b/,
  /\bhumano\b/,
];

const CONTRACT_PATTERNS = [
  /\bquero contratar\b/,
  /\bquero fechar\b/,
  /\bfechar contrato\b/,
  /\bfinalizar contratacao\b/,
  /\bcontratar agora\b/,
  /\bpode ativar\b/,
  /\bativa (a )?protecao\b/,
];

const FORBIDDEN_PRICE_PATTERNS = [
  /\br\$\s*\d+/i,
  /\b\d{2,5}(?:[,.]\d{2})?\s*(reais|por mes|mensal|mensais)\b/i,
  /\bmensalidade (e|fica|seria|de)\b/i,
  /\bcotacao (e|fica|seria|de)\b/i,
  /\b(cotacao|mensalidade|valor)\D{0,20}\d{2,5}\b/i,
  /\bvalor final\b/i,
];

const FORBIDDEN_ACTION_PATTERNS = [
  /\bverifiquei\b/i,
  /\bconsultei\b/i,
  /\bcalculei\b/i,
  /\bfipe\b/i,
  /\bsistema\b/i,
  /\bcadastro aprovado\b/i,
  /\bcontratacao (foi )?(realizada|concluida|finalizada)\b/i,
  /\bprotecao ativada\b/i,
  /\bagora (voce )?e associado\b/i,
  /\bboleto gerado\b/i,
  /\benviarei? por e-?mail\b/i,
  /\bvoce recebera (um )?e-?mail\b/i,
];

const GENERATED_HANDOFF_PATTERNS = [
  /\bvou (te )?(transferir|passar|encaminhar) (para|pra) (um )?consultor\b/i,
  /\bestou (te )?(transferindo|encaminhando)\b/i,
  /\bconsultor (vai|ira) (entrar em contato|continuar|te chamar)\b/i,
  /\baguarde (um )?momento\b/i,
];

const VEHICLE_STOP_WORDS = new Set([
  'meu',
  'minha',
  'carro',
  'moto',
  'veiculo',
  'modelo',
  'ano',
  'placa',
  'quero',
  'cotacao',
  'orcamento',
  'simulacao',
  'fazer',
  'quanto',
  'fica',
  'valor',
  'contratar',
  'protecao',
  'e',
  'eh',
  'um',
  'uma',
  'de',
  'do',
  'da',
  'o',
  'a',
]);

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

function extractValidPlate(text = '') {
  const tokens = String(text || '').match(/\b[A-Za-z]{3}[-\s]?\d[A-Za-z0-9][-\s]?\d{2}\b/g) || [];
  for (const token of tokens) {
    if (isValidBrazilPlate(token)) return normalizePlate(token);
  }
  return null;
}

function extractInvalidPlateCandidate(text = '') {
  const raw = String(text || '');
  const explicit = raw.match(/placa\s*(?:e|eh|é|:)?\s*([A-Za-z0-9-]{5,9})/i);
  const candidate = explicit?.[1] || null;
  if (candidate && !isValidBrazilPlate(candidate)) return candidate.toUpperCase();

  const onlyCandidate = raw.trim().match(/^[A-Za-z0-9-]{6,9}$/);
  if (onlyCandidate && /[A-Za-z]/.test(onlyCandidate[0]) && /\d/.test(onlyCandidate[0]) && !isValidBrazilPlate(onlyCandidate[0])) {
    return onlyCandidate[0].toUpperCase();
  }

  return null;
}

function extractYear(text = '') {
  const match = String(text || '').match(/\b(19[8-9]\d|20[0-3]\d)\b/);
  return match ? match[1] : null;
}

function titleCaseModel(text = '') {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractVehicleModel(text = '') {
  const normalized = normalizeText(text);
  const year = extractYear(text);
  const withoutPlate = normalized
    .replace(/\b[a-z]{3}\d[a-z0-9]\d{2}\b/g, ' ')
    .replace(/\bplaca\s+\w+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (year) {
    const beforeYear = withoutPlate.split(year)[0] || '';
    const words = beforeYear
      .split(/\s+/)
      .filter((word) => word && !VEHICLE_STOP_WORDS.has(word))
      .slice(-3);
    if (words.join('').length >= 3) return titleCaseModel(words.join(' '));
  }

  const modelMatch = withoutPlate.match(/\b(?:modelo|veiculo|carro|moto)\s+(?:e|eh|um|uma)?\s*([a-z0-9][a-z0-9\s]{2,35})/);
  if (modelMatch) {
    const words = modelMatch[1]
      .split(/\s+/)
      .filter((word) => word && !VEHICLE_STOP_WORDS.has(word))
      .slice(0, 3);
    if (words.join('').length >= 3) return titleCaseModel(words.join(' '));
  }

  return null;
}

export function isSalesStopStatus(status) {
  return SALES_STOP_STATUSES.has(status);
}

export function applySalesFactsToLead(lead, text = '') {
  if (!lead) return lead;
  const plate = extractValidPlate(text);
  const year = extractYear(text);
  const model = extractVehicleModel(text);

  if (plate) lead.plate = plate;
  if (year) lead.year = year;
  if (model && !lead.model) lead.model = model;
  if (!lead.conversationMode) lead.conversationMode = 'sales';
  return lead;
}

export function getSalesQualificationState(lead = {}, text = '') {
  const validPlate = extractValidPlate(text) || (isValidBrazilPlate(lead.plate) ? normalizePlate(lead.plate) : null);
  const invalidPlate = !validPlate ? extractInvalidPlateCandidate(text) : null;
  const model = lead.model || extractVehicleModel(text) || null;
  const year = lead.year || extractYear(text) || null;
  const missingData = [];

  if (!model) missingData.push('model');
  if (!year) missingData.push('year');
  if (!validPlate) missingData.push('plate');

  return {
    plate: validPlate,
    invalidPlate,
    model,
    year,
    missingData,
    hasMinimumData: !!(validPlate && model && year),
  };
}

function missingReply(missingData, reason = 'quote') {
  const missing = new Set(missingData);
  if (missing.has('model') && missing.has('year')) {
    if (reason === 'price') {
      return 'Eu nao consigo calcular o valor exato por aqui. Para o consultor preparar certinho, me passa o modelo e ano do veiculo?';
    }
    if (reason === 'consultant') {
      return 'Claro. Para eu encaminhar com contexto, me passa o modelo e ano do veiculo?';
    }
    return 'Consigo te ajudar sim. Me passa o modelo e ano do veiculo?';
  }

  if (missing.has('plate')) {
    return 'Boa. Falta so a placa para eu encaminhar ao consultor.';
  }

  if (missing.has('model')) return 'Boa. Me passa o modelo do veiculo?';
  if (missing.has('year')) return 'Boa. Me passa o ano do veiculo?';
  return READY_REPLY;
}

function makeSalesEvent(type, overrides = {}) {
  return {
    type,
    status: 'talking',
    stage: 'engaged',
    reply: '',
    reason: '',
    shouldHandoff: false,
    shouldStopAutomation: false,
    lastIntent: type,
    ...overrides,
  };
}

function inspectGeneratedReply(reply = '') {
  if (!reply) return null;
  if (matchAny(reply, FORBIDDEN_PRICE_PATTERNS)) return 'forbidden_price';
  if (matchAny(reply, FORBIDDEN_ACTION_PATTERNS)) return 'forbidden_action';
  if (matchAny(reply, GENERATED_HANDOFF_PATTERNS)) return 'generated_handoff';
  return null;
}

export function detectSalesEvent({
  text = '',
  lead = {},
  modelReply = '',
  phase = 'pre',
} = {}) {
  const normalized = normalizeText(text);
  const state = getSalesQualificationState(lead, text);
  const generatedIssue = phase === 'post' ? inspectGeneratedReply(modelReply) : null;
  const quoteRequested = matchAny(normalized, QUOTE_PATTERNS);
  const priceRequested = matchAny(normalized, PRICE_PATTERNS);
  const consultantRequested = matchAny(normalized, CONSULTANT_PATTERNS);
  const contractRequested = matchAny(normalized, CONTRACT_PATTERNS);
  const repeatedConsultantRequest = !!lead.salesConsultantRequestedAt || lead.lastIntent === 'sales_consultant_requested';

  if (state.invalidPlate) {
    return makeSalesEvent('invalid_plate', {
      reply: 'Essa placa parece nao estar no formato correto. Pode conferir e me mandar de novo? Exemplo: ABC1D23.',
      reason: `Placa fora do padrao brasileiro: ${state.invalidPlate}.`,
      invalidPlate: state.invalidPlate,
    });
  }

  if (phase === 'pre' && state.hasMinimumData && [
    'sales_quote_requested',
    'forbidden_price_request',
    'sales_consultant_requested',
    'contract_request',
  ].includes(lead.lastIntent)) {
    return makeSalesEvent('sales_ready_for_handoff', {
      status: 'qualified',
      stage: 'qualified',
      reply: READY_REPLY,
      clientMessage: READY_REPLY,
      reason: 'Cliente completou os dados minimos apos interesse comercial.',
      shouldHandoff: true,
      shouldStopAutomation: true,
    });
  }

  if (generatedIssue) {
    if (state.hasMinimumData || generatedIssue === 'generated_handoff') {
      return makeSalesEvent(generatedIssue === 'generated_handoff' ? 'sales_generated_handoff' : 'sales_ready_for_handoff', {
        status: 'qualified',
        stage: 'qualified',
        reply: generatedIssue === 'forbidden_price' ? PRICE_REPLY : READY_REPLY,
        clientMessage: generatedIssue === 'forbidden_action' ? CONTRACT_REPLY : READY_REPLY,
        reason: `Resposta generativa bloqueada por seguranca comercial: ${generatedIssue}.`,
        shouldHandoff: true,
        shouldStopAutomation: true,
      });
    }

    return makeSalesEvent(generatedIssue, {
      reply: generatedIssue === 'forbidden_price'
        ? missingReply(state.missingData, 'price')
        : missingReply(state.missingData, 'quote'),
      reason: `Resposta generativa substituida por seguranca comercial: ${generatedIssue}.`,
      forbiddenGeneratedIssue: generatedIssue,
    });
  }

  if (consultantRequested) {
    if (state.hasMinimumData || repeatedConsultantRequest) {
      return makeSalesEvent('sales_consultant_requested', {
        status: state.hasMinimumData ? 'qualified' : 'talking',
        stage: state.hasMinimumData ? 'qualified' : 'engaged',
        reply: CONSULTANT_REPLY,
        clientMessage: CONSULTANT_REPLY,
        reason: state.hasMinimumData
          ? 'Cliente pediu consultor e ja ha dados suficientes.'
          : 'Cliente insistiu em falar com consultor mesmo sem dados completos.',
        shouldHandoff: true,
        shouldStopAutomation: true,
      });
    }

    return makeSalesEvent('sales_consultant_requested', {
      reply: missingReply(state.missingData, 'consultant'),
      reason: 'Cliente pediu consultor, mas ainda faltam dados basicos para contexto.',
      salesConsultantRequested: true,
    });
  }

  if (contractRequested) {
    if (state.hasMinimumData) {
      return makeSalesEvent('contract_request', {
        status: 'qualified',
        stage: 'qualified',
        reply: CONTRACT_REPLY,
        clientMessage: CONTRACT_REPLY,
        reason: 'Cliente tentou contratar/finalizar. Contratacao exige consultor.',
        shouldHandoff: true,
        shouldStopAutomation: true,
      });
    }

    return makeSalesEvent('contract_request', {
      reply: `${CONTRACT_REPLY}\n\n${missingReply(state.missingData, 'quote')}`,
      reason: 'Cliente tentou contratar, mas faltam dados minimos para encaminhar cotacao.',
    });
  }

  if (priceRequested) {
    if (state.hasMinimumData) {
      return makeSalesEvent('forbidden_price_request', {
        status: 'qualified',
        stage: 'qualified',
        reply: PRICE_REPLY,
        clientMessage: PRICE_REPLY,
        reason: 'Cliente pediu preco; IA nao pode calcular cotacao.',
        shouldHandoff: true,
        shouldStopAutomation: true,
      });
    }

    return makeSalesEvent('forbidden_price_request', {
      reply: missingReply(state.missingData, 'price'),
      reason: 'Cliente pediu preco, mas faltam dados minimos para cotacao.',
    });
  }

  if (quoteRequested) {
    if (state.hasMinimumData) {
      return makeSalesEvent('sales_ready_for_handoff', {
        status: 'qualified',
        stage: 'qualified',
        reply: READY_REPLY,
        clientMessage: READY_REPLY,
        reason: 'Cliente pediu cotacao e ja ha modelo, ano e placa valida.',
        shouldHandoff: true,
        shouldStopAutomation: true,
      });
    }

    return makeSalesEvent('sales_quote_requested', {
      reply: missingReply(state.missingData, 'quote'),
      reason: 'Cliente pediu cotacao; coletar dados minimos antes do consultor.',
    });
  }

  if (phase === 'post' && state.hasMinimumData) {
    return makeSalesEvent('sales_ready_for_handoff', {
      status: 'qualified',
      stage: 'qualified',
      reply: READY_REPLY,
      clientMessage: READY_REPLY,
      reason: 'Dados minimos de cotacao completos: modelo, ano e placa valida.',
      shouldHandoff: true,
      shouldStopAutomation: true,
    });
  }

  return null;
}

export function applySalesEventToLead(lead, event, content = {}) {
  if (!lead || !event) return lead;
  const now = new Date().toISOString();
  lead.conversationMode = 'sales';
  lead.lastIntent = event.lastIntent || event.type;
  lead.stage = event.stage || lead.stage || 'engaged';
  lead.status = event.status || lead.status || 'talking';
  lead.operationalStatus = event.shouldHandoff ? 'handoff_sales' : 'ask_vehicle_data';
  lead.salesHandoffReason = event.reason || lead.salesHandoffReason || null;
  lead.lastSalesEventAt = now;

  if (event.salesConsultantRequested) lead.salesConsultantRequestedAt = now;
  if (event.invalidPlate) lead.invalidPlate = event.invalidPlate;
  if (event.forbiddenGeneratedIssue) lead.forbiddenGeneratedIssue = event.forbiddenGeneratedIssue;

  const existingSummary = typeof lead.leadSummary === 'object' && lead.leadSummary ? lead.leadSummary : {};
  lead.leadSummary = {
    ...existingSummary,
    conversationMode: 'sales',
    status: lead.status,
    stage: lead.stage,
    intent: event.type,
    reason: event.reason,
    missingData: getSalesQualificationState(lead, content.text || content.historyText || '').missingData,
    caseSummary: [
      'Atendimento comercial/cotacao.',
      event.reason || '',
      lead.model ? `Modelo: ${lead.model}.` : '',
      lead.year ? `Ano: ${lead.year}.` : '',
      lead.plate ? `Placa: ${lead.plate}.` : '',
      content.historyText || content.text ? `Ultima mensagem: "${String(content.historyText || content.text).slice(0, 180)}".` : '',
    ].filter(Boolean).join(' '),
    updatedAt: now,
  };

  return lead;
}

export function markSalesHandoffFailure(lead, error) {
  if (!lead) return lead;
  lead.status = 'handoff_failed';
  lead.stage = 'handoff_failed';
  lead.handoffError = error?.message || String(error || 'Falha no handoff comercial.');
  lead.handoffFailedAt = new Date().toISOString();
  return lead;
}

export function getSalesHandoffFailedReply() {
  return HANDOFF_FAILED_REPLY;
}
