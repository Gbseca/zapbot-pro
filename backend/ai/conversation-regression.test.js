import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyConversationDecisionToLead,
  makeConversationDecision,
} from './conversation-decision.js';
import {
  applyDeterministicFactsToLead,
  buildRecentUserText,
  extractPhoneFromText,
  extractValidPlateFromText,
  extractVehicleModelFromText,
  extractYearFromText,
} from './deterministic-facts.js';
import { classifyDeterministicIntent } from './deterministic-intent.js';
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

test('routes a broad set of critical operational messages immediately', async () => {
  const groups = {
    assistance_request: [
      'quero um guincho',
      'quero reboque',
      'chama um guincho',
      'aciona o reboque',
      'aciona a assistencia 24h',
      'o carro quebrou',
      'o carro parou na estrada',
      'meu veiculo nao liga',
      'meu carro nao pega',
      'deu pane seca',
      'furei o pneu',
      'a bateria acabou',
      'tranquei a chave dentro do carro',
      'acabou a gasolina',
      'to parado na estrada',
      'qro guincho agr',
      'presciso de guinxo',
      'meu carro morreu',
      'to no prego',
      'quebrei na estrada',
      'a bateria arriou',
      'reboque',
    ],
    event_report: [
      'bati o carro',
      'bateram no meu carro',
      'meu carro capotou',
      'saiu da pista',
      'roubaram meu carro',
      'minha moto foi furtada',
      'levaram meu veiculo',
      'meu carro sumiu',
      'teve tentativa de roubo',
      'fui assaltado e levaram o carro',
      'o carro pegou fogo',
      'meu veiculo alagou',
      'uma arvore caiu no carro',
      'deu perda total',
      'o carro deu pt',
      'roubaro minha moto',
      'furtaro meu carro',
      'levaro meu veiculo',
      'capoto na estrada',
    ],
    boleto_request: [
      'preciso do boleto',
      'manda a segunda via',
      'minha fatura nao chegou',
      'manda a linha digitavel',
      'preciso do codigo de barras',
      'me passa o pix',
      'manda o qr code',
      'quero um link de pagamento',
      'bolto pfv',
      'pix pfv',
    ],
    payment_claimed: [
      'ja paguei',
      'fiz o pagamento',
      'fiz pix ontem',
      'o valor saiu da conta',
      'debitou da conta',
      'eu quitei ontem',
      'pix realizado',
      'paguei mas nao deu baixa',
      'ta pago',
    ],
    regularization_request: [
      'quero resolver minha inadimplencia',
      'estou inadimplente',
      'tenho uma pendencia',
      'to atrasado',
      'minha mensalidade venceu',
      'to atrazado e inadiplente',
      'estou devendo mensalidade',
      'quero quitar minha divida',
      'preciso negociar meu debito',
      'como faco pra pagar a mensalidade',
    ],
    app_blocked: [
      'meu app nao funciona',
      'o aplicativo fica carregando',
      'esqueci a senha do app',
      'ta dando erro no login',
      'meu aplicativo ta bugado',
      'o app deu pau',
      'nao consigo entrar no aplicativo',
      'nao abre o app',
      'meu app esta bloqueado',
    ],
    cancel_request: [
      'quero cancelar minha protecao',
      'quero sair da associacao',
      'nao quero mais ser associado',
      'quero encerrar meu cadastro',
      'tira meu carro da protecao',
      'qro cancela',
    ],
    reactivation_request: [
      'quero reativar minha protecao',
      'ativa de novo pra mim',
      'ativa dnv',
      'minha protecao esta suspensa',
    ],
    inspection_pending: [
      'preciso fazer a revistoria',
      'quero agendar a vistoria',
      'minha revistoria esta pendente',
      'nao recebi o codigo da vistoria',
    ],
    human_requested: [
      'nao quero falar com robo',
      'chama alguem',
      'quero um atendente',
      'preciso resolver um problema com voces',
      'me passa pra uma pessoa',
      'financeiro por favor',
      'suporte',
    ],
  };

  for (const [expectedIntent, messages] of Object.entries(groups)) {
    for (const message of messages) {
      const { decision } = await decide(message);
      assert.equal(decision.conversationMode, 'operational', message);
      assert.equal(decision.intent, expectedIntent, message);
      assert.equal(decision.shouldHandoff, true, message);
      assert.equal(decision.shouldStopAutomation, true, message);
    }
  }
});

test('honors negations, corrections and informational questions', async () => {
  const cases = [
    ['nao quero boleto, quero cotacao', 'sales', 'sales_quote'],
    ['boleto nao, quero cotar', 'sales', 'sales_quote'],
    ['nao preciso de reboque', 'sales', 'no_interest'],
    ['nao bati o carro, ele so parou', 'operational', 'assistance_request'],
    ['nao roubaram, perdi a chave', 'operational', 'assistance_request'],
    ['nao paguei ainda, preciso do boleto', 'operational', 'boleto_request'],
    ['nao paguei ainda, como faco pra pagar', 'operational', 'regularization_request'],
    ['meu app nao esta bloqueado, quero cotacao', 'sales', 'sales_quote'],
    ['quero cancelar esse boleto e gerar outro', 'operational', 'boleto_request'],
    ['quero cancelar a cotacao', 'sales', 'no_interest'],
    ['preciso de ajuda para fazer cotacao', 'sales', 'sales_quote'],
    ['tenho problema para preencher a cotacao', 'sales', 'sales_quote'],
    ['quero falar com consultor para cotacao', 'sales', 'sales_quote'],
    ['nao sou associado, preciso do boleto de adesao', 'sales', 'sales_quote'],
    ['a protecao tem guincho?', 'sales', 'general_question'],
    ['quantos km de reboque eu tenho?', 'sales', 'general_question'],
    ['como funciona a assistencia 24h?', 'sales', 'general_question'],
    ['se eu bater o carro, o que acontece?', 'sales', 'general_question'],
    ['quando eu precisar de guincho como funciona?', 'sales', 'general_question'],
    ['acidente e coberto?', 'sales', 'general_question'],
  ];

  for (const [message, expectedMode, expectedIntent] of cases) {
    const { decision } = await decide(message);
    assert.equal(decision.conversationMode, expectedMode, message);
    assert.equal(decision.intent, expectedIntent, message);
    if (expectedIntent === 'sales_quote') {
      assert.equal(decision.shouldStopAutomation, false, message);
      assert.match(decision.nextAction, /ask_model_year|ask_plate|execute_handoff/, message);
    }
  }
});

test('uses recent context only to complete short messages', async () => {
  const splitLead = createLead({
    history: [{ role: 'user', content: 'meu carro', ts: Date.now() - 1000 }],
  });
  const split = await makeConversationDecision({
    config: {},
    text: 'parou',
    lead: splitLead,
    incomingContent: { text: 'parou', historyText: 'parou' },
    skipAI: true,
  });
  assert.equal(split.conversationMode, 'operational');
  assert.equal(split.intent, 'assistance_request');

  const corrected = await decide('na verdade quero cotacao', {
    conversationMode: 'operational',
    lastIntent: 'boleto_request',
    pendingOperationalHandoff: true,
    pendingOperationalEvent: { type: 'boleto_request' },
  });
  assert.equal(corrected.decision.conversationMode, 'sales');
  assert.equal(corrected.decision.intent, 'sales_quote');
});

test('asks only for WhatsApp when an operational contact is unresolved', async () => {
  const unresolved = await decide('preciso de reboque', {
    number: '123456789012345',
    phone: null,
    displayNumber: null,
    phoneResolved: false,
  });
  assert.equal(unresolved.decision.shouldAskPhone, true);
  assert.equal(unresolved.decision.shouldHandoff, false);
  assert.equal((unresolved.decision.clientReply.match(/\?/g) || []).length, 1);
  assert.match(unresolved.decision.clientReply, /WhatsApp com DDD/i);
  assert.doesNotMatch(unresolved.decision.clientReply, /modelo|ano|placa/i);

  const resolved = await decide('preciso de reboque');
  assert.equal(resolved.decision.shouldAskPhone, false);
  assert.equal(resolved.decision.shouldHandoff, true);
  assert.equal((resolved.decision.clientReply.match(/\?/g) || []).length, 0);
});

test('rejects CPF, CNPJ, repeated digits and numbers assembled across messages', () => {
  assert.equal(extractPhoneFromText('meu CPF e 123.456.789-09'), null);
  assert.equal(extractPhoneFromText('12345678909'), null);
  assert.equal(extractPhoneFromText('CNPJ 12.345.678/0001-95'), null);
  assert.equal(extractPhoneFromText('99999-9999\n99999-9999'), null);
  assert.equal(extractPhoneFromText('meu whats e 11 98765-4321'), '5511987654321');
  assert.equal(extractPhoneFromText('antigo 11911112222\ncorreto 21987654321'), '5521987654321');

  const recent = buildRecentUserText({
    history: [{ role: 'user', content: '21987654321' }],
  }, '21987654321');
  assert.equal(recent, '21987654321');
});

test('safe operational replies never use prohibited terms or make execution promises', async () => {
  const messages = [
    'preciso de reboque',
    'bati o carro',
    'quero boleto',
    'ja paguei',
    'meu app esta bloqueado',
    'quero cancelar',
  ];
  for (const message of messages) {
    const { decision } = await decide(message);
    assert.doesNotMatch(decision.clientReply, /\bseguro|seguradora|apolice|sinistro|premio\b/i, message);
    assert.doesNotMatch(decision.clientReply, /\bfinanceiro|suporte|setor responsavel\b/i, message);
    assert.doesNotMatch(decision.clientReply, /a caminho|pagamento confirmado|app liberado|dei baixa|verifiquei no sistema/i, message);
    assert.ok(decision.clientReply.length <= 180, message);
  }
});

test('direct classifier exposes deterministic operational intent without provider calls', () => {
  const result = classifyDeterministicIntent('que cobranca e essa porra, chama alguem');
  assert.equal(result.mode, 'operational');
  assert.equal(result.intent, 'human_requested');
  assert.equal(result.emotion, 'angry');
});

test('keeps the commercial quote flow intact for real sales interest', async () => {
  const lead = createLead();

  const quote = await makeConversationDecision({
    config: {},
    text: 'quero fazer uma cotacao',
    lead,
    incomingContent: { text: 'quero fazer uma cotacao', historyText: 'quero fazer uma cotacao' },
    skipAI: true,
  });
  applyConversationDecisionToLead(lead, quote, { text: 'quero fazer uma cotacao' });
  assert.equal(quote.conversationMode, 'sales');
  assert.equal(quote.nextAction, 'ask_model_year');

  applyDeterministicFactsToLead(lead, 'gol 2020');
  const vehicle = await makeConversationDecision({
    config: {},
    text: 'gol 2020',
    lead,
    incomingContent: { text: 'gol 2020', historyText: 'gol 2020' },
    skipAI: true,
  });
  applyConversationDecisionToLead(lead, vehicle, { text: 'gol 2020' });
  assert.equal(vehicle.conversationMode, 'sales');
  assert.equal(vehicle.nextAction, 'ask_plate');

  applyDeterministicFactsToLead(lead, 'placa ABC1D23');
  const ready = await makeConversationDecision({
    config: {},
    text: 'placa ABC1D23',
    lead,
    incomingContent: { text: 'placa ABC1D23', historyText: 'placa ABC1D23' },
    skipAI: true,
  });
  assert.equal(ready.conversationMode, 'sales');
  assert.equal(ready.nextAction, 'execute_handoff');
  assert.equal(ready.shouldHandoff, true);
});
