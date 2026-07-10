import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyConversationDecisionToLead,
  makeConversationDecision,
} from './conversation-decision.js';
import {
  applyDeterministicFactsToLead,
  extractValidPlateFromText,
  extractVehicleModelFromText,
  extractYearFromText,
} from './deterministic-facts.js';
import { buildHumanizedReply } from './humanized-reply-builder.js';

function createLead(overrides = {}) {
  return {
    number: '5511999999999',
    phone: '5511999999999',
    displayNumber: '5511999999999',
    phoneResolved: true,
    conversationMode: 'sales',
    status: 'new',
    stage: 'new',
    history: [],
    ...overrides,
  };
}

async function decide(text, leadOverrides = {}, extra = {}) {
  const lead = createLead(leadOverrides);
  const decision = await makeConversationDecision({
    config: {},
    text,
    lead,
    incomingContent: { text, historyText: text },
    skipAI: true,
    ...extra,
  });
  return { decision, lead };
}

test('routes common informal customer messages without depending on an AI provider', async () => {
  const cases = [
    ['opa, qnt fica pra proteger um gol 2018?', 'sales', 'sales_price_request'],
    ['qro cota meu carro, cm faz?', 'sales', 'sales_quote'],
    ['quero cotar um polo zero km', 'sales', 'sales_quote'],
    ['ainda nao sou cliente, quero pagar a protecao pro meu carro', 'sales', 'sales_quote'],
    ['to devendo umas mensalidade e quero acertar isso', 'operational', 'regularization_request'],
    ['quero pagar minha mensalidade', 'operational', 'regularization_request'],
    ['qual o valor da mensalidade?', 'sales', 'sales_price_request'],
    ['preciso resolver um problema com vcs', 'operational', 'human_requested'],
    ['preciso de ajuda com meu boleto', 'operational', 'boleto_request'],
    ['na verdade ja sou associado e meu app bloqueou', 'operational', 'app_blocked'],
    ['nao devo nada, parem de cobrar', 'operational', 'billing_disputed'],
    ['que cobranca e essa caralho, eu nao devo nada', 'operational', 'billing_disputed'],
    ['preciso de reboque urgente', 'operational', 'assistance_request'],
    ['manda um guincho logo', 'operational', 'assistance_request'],
    ['roubaram minha moto agora', 'operational', 'event_report'],
    ['quero a segunda via do boleto', 'operational', 'boleto_request'],
    ['nao quero falar com robo', 'operational', 'human_requested'],
  ];

  for (const [message, expectedMode, expectedIntent] of cases) {
    const { decision } = await decide(message);
    assert.equal(decision.conversationMode, expectedMode, message);
    assert.equal(decision.intent, expectedIntent, message);
  }
});

test('latest operational issue overrides an earlier sales conversation', async () => {
  const lead = createLead({
    lastIntent: 'sales_quote',
    stage: 'ask_model_year',
    history: [
      { role: 'user', content: 'queria uma cotacao' },
      { role: 'assistant', content: 'Qual o modelo e o ano do veiculo?' },
    ],
  });
  const text = 'na verdade ja sou associado e meu app bloqueou';
  lead.history.push({ role: 'user', content: text });

  const decision = await makeConversationDecision({
    config: {},
    text,
    lead,
    incomingContent: { text, historyText: text },
    skipAI: true,
  });

  assert.equal(decision.conversationMode, 'operational');
  assert.equal(decision.intent, 'app_blocked');
  assert.equal(decision.handoffDepartment, 'support');
});

test('extracts real vehicle models and rejects conversational noise', () => {
  const cases = [
    ['opa, qnt fica pra proteger um gol 2018?', 'GOL'],
    ['e um onix 2020', 'Onix'],
    ['hb20 2021', 'HB20'],
    ['faz protecao pra moto? tenho uma biz 2020', 'BIZ'],
    ['quero cotar um polo 2026 zero km mas ainda ta sem placa', 'Polo'],
    ['quero ver uma protecao pro meu corolla', 'Corolla'],
    ['quero ver uma protecao pro meu corolla\n2022', 'Corolla'],
    ['toyota corolla cross 2023', 'Toyota Corolla Cross'],
    ['qro cota meu carro, cm faz?', null],
    ['quero cancelar minha protecao, como resolve?', null],
    ['nao quero falar com robo, chama uma pessoa', null],
    ['tenho uma duvida', null],
    ['meu carro quebrou na estrada', null],
    ['to devendo umas mensalidade', null],
  ];

  for (const [message, expected] of cases) {
    assert.equal(extractVehicleModelFromText(message), expected, message);
  }
});

test('uses the newest corrected year and plate and clears sem-placa state', () => {
  assert.equal(extractYearFromText('gol 2018\nna verdade e 2019'), '2019');
  assert.equal(extractValidPlateFromText('placa ABC1D23\ncorrigindo: placa DEF2G45'), 'DEF2G45');

  const lead = createLead({ plateUnavailable: true });
  applyDeterministicFactsToLead(lead, 'gol 2019 placa GHI3J67');
  assert.equal(lead.plate, 'GHI3J67');
  assert.equal(lead.plateUnavailable, false);
});

test('asks only the missing vehicle fact', async () => {
  const modelKnown = await decide('quero uma cotacao', { model: 'Onix' });
  assert.equal(modelKnown.decision.allowedQuestion, 'Qual o ano do veiculo?');

  const yearKnown = await decide('quero uma cotacao', { year: '2020' });
  assert.equal(yearKnown.decision.allowedQuestion, 'Qual o modelo do veiculo?');
});

test('safe deterministic replies are short and contain at most one question', async () => {
  const greeting = await buildHumanizedReply({}, {
    mode: 'sales',
    requiredAction: 'respond',
    latestUserMessage: 'bom dia, tudo bem?',
  });
  assert.equal(greeting, 'Bom dia! Tudo bem por aqui. Como posso te ajudar?');
  assert.equal((greeting.match(/\?/g) || []).length, 1);

  const thanks = await buildHumanizedReply({}, {
    mode: 'sales',
    requiredAction: 'respond',
    latestUserMessage: 'obg viu',
  });
  assert.equal(thanks, 'Por nada! Se precisar, e so chamar.');

  const question = await buildHumanizedReply({}, {
    mode: 'sales',
    requiredAction: 'ask_plate',
    allowedQuestion: 'Pode me passar a placa do veiculo?',
    latestUserMessage: 'onix 2020',
  });
  assert.equal(question, 'Pode me passar a placa do veiculo?');
});

test('collections greeting identifies Moove before the financial handoff', async () => {
  const text = 'bom dia, quem fala?';
  const { decision, lead } = await decide(text, {}, {
    collectionsContext: {
      conversationMode: 'collections',
      campaignId: 'test-campaign',
      campaignStatus: 'running',
      campaignIntent: 'collections',
    },
  });
  applyConversationDecisionToLead(lead, decision, { text });

  assert.equal(decision.conversationMode, 'operational');
  assert.equal(decision.intent, 'general_question');
  assert.match(lead.clientReply, /equipe da Moove Protecao Veicular/);
  assert.doesNotMatch(lead.clientReply, /\bseguro|seguradora|apolice|sinistro|premio\b/i);
});
