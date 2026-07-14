import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCustomerAgentTurnToLead,
  buildCustomerAgentContext,
  redactSensitiveText,
  runCustomerAgent,
  validateCustomerAgentTurn,
} from './customer-agent.js';

function knowledge(items = []) {
  return {
    ids: items.map((item) => item.id),
    confidence: items.length ? 'high' : 'low',
    text: items.map((item) => `[FONTE ${item.id}]\nConteudo: ${item.content}`).join('\n\n'),
  };
}

function generated(overrides = {}) {
  return JSON.stringify({
    reply: 'Posso te explicar certinho.',
    primaryIntent: 'company_question',
    secondaryIntent: 'none',
    mode: 'sales',
    action: 'respond',
    confidence: 0.9,
    emotion: 'neutral',
    answerStatus: 'answered',
    knowledgeIds: ['company.identity'],
    reasoningSummary: 'Pergunta institucional respondida pela base.',
    handoffReason: '',
    handoffSummary: '',
    memory: {
      customerGoal: 'entender a empresa',
      currentTopic: 'empresa',
      pendingQuestion: '',
      objections: [],
      answeredTopics: ['empresa'],
    },
    extractedFacts: {
      vehicleModel: '',
      vehicleYear: '',
    },
    ...overrides,
  });
}

test('keeps a grounded natural answer and a secondary quote intent', async () => {
  const turn = await runCustomerAgent({
    config: {},
    lead: { phone: '5511999999999', history: [] },
    message: 'quero cotar mas antes quero saber se cobre granizo',
    knowledge: knowledge([{ id: 'coverage.granizo', content: 'Fenomenos da natureza seguem o regulamento.' }]),
    generate: async () => ({
      text: generated({
        reply: 'Granizo entra na análise de fenômenos da natureza, conforme o regulamento. Para eu adiantar sua cotação, qual é o modelo e o ano do veículo?',
        primaryIntent: 'coverage_question',
        secondaryIntent: 'sales_quote',
        action: 'ask_model_year',
        knowledgeIds: ['coverage.granizo'],
        memory: {
          customerGoal: 'tirar dúvida e cotar',
          currentTopic: 'granizo',
          pendingQuestion: 'modelo e ano',
          objections: [],
          answeredTopics: ['granizo'],
        },
      }),
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    }),
  });

  assert.equal(turn.primaryIntent, 'coverage_question');
  assert.equal(turn.secondaryIntent, 'sales_quote');
  assert.equal(turn.action, 'ask_model_year');
  assert.match(turn.reply, /Granizo/i);
  assert.match(turn.reply, /modelo e o ano/i);
  assert.deepEqual(turn.knowledgeIds, ['coverage.granizo']);
});

test('preserves a factual answer when adding the next sales question', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Granizo faz parte dos fenômenos da natureza previstos no regulamento.',
    primaryIntent: 'coverage_question',
    secondaryIntent: 'sales_quote',
    action: 'ask_model_year',
    knowledgeIds: ['coverage.granizo'],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([{ id: 'coverage.granizo', content: 'Fenômenos da natureza conforme regulamento.' }]),
  });

  assert.match(turn.reply, /Granizo/i);
  assert.match(turn.reply, /modelo e o ano/i);
  assert.equal((turn.reply.match(/\?/g) || []).length, 1);
});

test('removes duplicate model and year requests while preserving the answer', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Sim, roubo faz parte da proteção. Posso simular o valor para o seu carro? Me diz o modelo e o ano.',
    primaryIntent: 'coverage_question',
    secondaryIntent: 'sales_quote',
    action: 'ask_model_year',
    knowledgeIds: ['coverage-rules.what_is_covered'],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([{ id: 'coverage-rules.what_is_covered', content: 'Inclui roubo.' }]),
  });

  assert.match(turn.reply, /roubo/i);
  assert.equal((turn.reply.match(/modelo/gi) || []).length, 1);
  assert.equal((turn.reply.match(/\?/g) || []).length, 1);
  assert.doesNotMatch(turn.reply, /Posso simular/i);
});

test('treats a plate explanation as an objection in the existing sales context', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'A placa ajuda a identificar o veículo, mas é opcional nesta etapa.',
    primaryIntent: 'company_question',
    action: 'respond',
    answerStatus: 'answered',
    knowledgeIds: [],
  }), {
    lead: { phone: '5511999999999', model: 'Voyage', year: '2015', plateRequestedAt: new Date().toISOString() },
    knowledge: knowledge([]),
  });

  assert.equal(turn.primaryIntent, 'objection');
  assert.equal(turn.action, 'respond');
  assert.match(turn.reply, /opcional/i);
});

test('uses cited knowledge to recover a missed factual primary intent', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Sim, granizo está entre os fenômenos da natureza. Qual é o modelo e o ano?',
    primaryIntent: 'sales_quote',
    secondaryIntent: 'none',
    action: 'ask_model_year',
    knowledgeIds: ['coverage-rules.what_is_covered'],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([{ id: 'coverage-rules.what_is_covered', content: 'Inclui fenômenos da natureza.' }]),
  });

  assert.equal(turn.primaryIntent, 'coverage_question');
  assert.equal(turn.secondaryIntent, 'sales_quote');
});

test('accepts a valid source ID even when the model prefixes it with FONTE', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'A proteção inclui roubo e furto, conforme as regras da associação.',
    primaryIntent: 'coverage_question',
    action: 'respond',
    knowledgeIds: ['FONTE coverage-rules.what_is_covered'],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([{ id: 'coverage-rules.what_is_covered', content: 'Inclui roubo e furto.' }]),
  });

  assert.deepEqual(turn.knowledgeIds, ['coverage-rules.what_is_covered']);
  assert.equal(turn.action, 'respond');
});

test('uses accepted-vehicle sources to correct an eligibility label', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Sim, a Moove aceita caminhões.',
    primaryIntent: 'coverage_question',
    action: 'respond',
    knowledgeIds: ['faq-moove.accepted_vehicles'],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([{ id: 'faq-moove.accepted_vehicles', content: 'Aceitamos caminhões.' }]),
  });

  assert.equal(turn.primaryIntent, 'eligibility_question');
});

test('does not invert a correct denial about the company type', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Não, a Moove é uma associação de proteção veicular, não uma seguradora.',
    primaryIntent: 'company_question',
    knowledgeIds: ['company.identity'],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([{ id: 'company.identity', content: 'A Moove é uma associação.' }]),
  });

  assert.doesNotMatch(turn.reply, /n[aã]o(?:\s+[eé])?\s+(?:uma\s+)?associa[cç][aã]o/i);
  assert.match(turn.reply, /[eé] uma associa[cç][aã]o de prote[cç][aã]o veicular/i);
  assert.match(turn.reply, /mutualismo/i);
});

test('distinguishes an assistant identity question from a human handoff request', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Não sou uma pessoa; sou a assistente de atendimento da Moove.',
    primaryIntent: 'human_requested',
    mode: 'operational',
    action: 'respond',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([]),
  });

  assert.equal(turn.primaryIntent, 'assistant_identity');
  assert.equal(turn.mode, 'sales');
  assert.equal(turn.action, 'respond');
});

test('refuses an unsupported factual answer and requests a consultant handoff', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Sim, qualquer pessoa com mais de 18 anos pode dirigir.',
    primaryIntent: 'eligibility_question',
    knowledgeIds: ['made.up.source'],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([]),
  });

  assert.equal(turn.answerStatus, 'unknown');
  assert.equal(turn.action, 'handoff_sales');
  assert.doesNotMatch(turn.reply, /qualquer pessoa/i);
  assert.match(turn.reply, /não encontrei/i);
});

test('rejects a factual claim when retrieval confidence is low even with a cited ID', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Sim, atendemos em todo o Brasil.',
    primaryIntent: 'company_question',
    action: 'respond',
    knowledgeIds: ['company.identity'],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: {
      ...knowledge([{ id: 'company.identity', content: 'A Moove é uma associação.' }]),
      confidence: 'low',
    },
  });

  assert.equal(turn.action, 'handoff_sales');
  assert.equal(turn.answerStatus, 'unknown');
  assert.doesNotMatch(turn.reply, /todo o Brasil/i);
});

test('allows only one question in a WhatsApp reply', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Seu carro pode ser analisado. Qual é o modelo? E qual é o ano?',
    primaryIntent: 'sales_quote',
    answerStatus: 'not_applicable',
    action: 'ask_model_year',
    knowledgeIds: [],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([]),
  });

  assert.equal((turn.reply.match(/\?/g) || []).length, 1);
});

test('does not ask for a plate again after hesitation', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'A placa ajuda na conferência. Pode me passar a placa?',
    primaryIntent: 'sales_quote',
    answerStatus: 'not_applicable',
    action: 'ask_plate_optional',
    knowledgeIds: [],
  }), {
    lead: {
      phone: '5511999999999',
      model: 'Voyage',
      year: '2015',
      plateWithheld: true,
    },
    knowledge: knowledge([]),
  });

  assert.equal(turn.action, 'handoff_sales');
  assert.doesNotMatch(turn.reply, /placa do ve[ií]culo/i);
  assert.match(turn.reply, /n[aã]o precisa informar a placa/i);
});

test('hands off the quote when the customer explicitly refuses the optional plate', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Tudo bem. Posso seguir sem a placa?',
    primaryIntent: 'objection',
    action: 'respond',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    lead: {
      phone: '5511999999999',
      model: 'Voyage',
      year: '2015',
      plateRequestedAt: new Date().toISOString(),
    },
    message: 'prefiro não passar agora',
    knowledge: knowledge([]),
  });

  assert.equal(turn.action, 'handoff_sales');
  assert.equal(turn.plateWithheld, true);
  assert.doesNotMatch(turn.reply, /pode me passar|qual (?:é )?a placa/i);
  assert.match(turn.reply, /consultor/i);

  const lead = {};
  applyCustomerAgentTurnToLead(lead, turn);
  assert.equal(lead.plateWithheld, true);
  assert.ok(lead.plateWithheldAt);
});

test('replaces an invented plate purpose with the safe optional explanation', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Preciso da placa para consultar o sistema de rastreamento e assistência.',
    primaryIntent: 'company_question',
    action: 'respond',
    answerStatus: 'answered',
    knowledgeIds: [],
  }), {
    lead: {
      phone: '5511999999999',
      model: 'Voyage',
      year: '2015',
      plateRequestedAt: new Date().toISOString(),
    },
    message: 'por que precisa da placa?',
    knowledge: knowledge([]),
  });

  assert.equal(turn.primaryIntent, 'objection');
  assert.doesNotMatch(turn.reply, /sistema|rastreamento|assist[eê]ncia/i);
  assert.match(turn.reply, /identificar o ve[ií]culo/i);
  assert.match(turn.reply, /opcional/i);
});

test('blocks impossible operational promises', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Pronto, o reboque já está a caminho.',
    primaryIntent: 'assistance_request',
    mode: 'operational',
    action: 'handoff_operational',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([]),
  });

  assert.equal(turn.action, 'handoff_operational');
  assert.doesNotMatch(turn.reply, /a caminho/i);
  assert.match(turn.reply, /consultor/i);
});

test('does not invent a cancellation when a prospect only asks the sales conversation to stop', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Entendido, sua solicitação de cancelamento será encaminhada.',
    primaryIntent: 'no_interest',
    action: 'stop',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    lead: { phone: '5511999999999' },
    message: 'não quero mais, pode parar',
    knowledge: knowledge([]),
  });

  assert.equal(turn.action, 'stop');
  assert.doesNotMatch(turn.reply, /cancel|encaminh|solicita[cç][aã]o/i);
  assert.match(turn.reply, /n[aã]o vou insistir/i);
});

test('redacts customer identifiers before they reach the model context', () => {
  const redacted = redactSensitiveText('Meu CPF 123.456.789-10, placa ABC1D23 e telefone 21987654321');
  assert.doesNotMatch(redacted, /123\.456|ABC1D23|21987654321/);

  const context = buildCustomerAgentContext({
    config: {},
    lead: { history: [{ role: 'user', content: 'placa ABC1D23' }] },
    message: 'me liga no 21987654321',
    knowledge: knowledge([]),
  });
  assert.doesNotMatch(context.userMessage, /ABC1D23|21987654321/);
});

test('persists memory, source and handoff summary on the lead', () => {
  const lead = {};
  applyCustomerAgentTurnToLead(lead, {
    architecture: 'customer-agent-v2',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    confidence: 0.91,
    answerStatus: 'answered',
    knowledgeIds: ['company.identity'],
    primaryIntent: 'company_question',
    secondaryIntent: 'sales_quote',
    emotion: 'interested',
    mode: 'sales',
    action: 'handoff_sales',
    handoffSummary: 'Cliente entendeu a empresa e quer cotar.',
    handoffReason: 'Interesse comercial confirmado.',
    memory: { customerGoal: 'cotar', currentTopic: 'empresa', pendingQuestion: '', objections: [], answeredTopics: ['empresa'] },
  });

  assert.equal(lead.aiArchitecture, 'customer-agent-v2');
  assert.equal(lead.aiProviderLastUsed, 'gemini');
  assert.equal(lead.secondaryIntent, 'sales_quote');
  assert.match(lead.handoffSummary, /quer cotar/i);
});

test('captures model and year supplied by the customer', () => {
  const turn = validateCustomerAgentTurn(generated({
    primaryIntent: 'sales_quote',
    action: 'handoff_sales',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
    extractedFacts: {
      vehicleModel: 'Volkswagen Voyage',
      vehicleYear: '2015',
    },
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([]),
  });
  const lead = {};
  applyCustomerAgentTurnToLead(lead, turn);

  assert.equal(lead.model, 'Volkswagen Voyage');
  assert.equal(lead.year, '2015');
});

test('hands a real price request to a consultant without asking for the plate', () => {
  const turn = validateCustomerAgentTurn(generated({
    reply: 'Pode me passar a placa para eu calcular?',
    primaryIntent: 'sales_price_request',
    action: 'ask_plate_optional',
    answerStatus: 'unknown',
    knowledgeIds: [],
    extractedFacts: {
      vehicleModel: 'Voyage',
      vehicleYear: '2015',
    },
  }), {
    lead: { phone: '5511999999999' },
    knowledge: knowledge([]),
  });

  assert.equal(turn.action, 'handoff_sales');
  assert.doesNotMatch(turn.reply, /placa/i);
  assert.match(turn.reply, /consultor/i);
});
