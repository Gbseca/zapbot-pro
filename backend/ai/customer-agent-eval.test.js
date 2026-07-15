import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOMER_AGENT_EVAL_SCENARIOS,
  validateEvaluationTurn,
} from './customer-agent-eval.js';
import { CUSTOMER_AGENT_QUALITY_SCENARIOS } from './customer-agent-quality-cases.js';

function turn(overrides = {}) {
  return {
    reply: 'A proteção inclui assistência 24 horas, conforme as condições da associação.',
    primaryIntent: 'coverage_question',
    secondaryIntent: 'none',
    action: 'respond',
    mode: 'sales',
    answerStatus: 'answered',
    knowledgeIds: ['coverage.assistance'],
    handoffSummary: '',
    ...overrides,
  };
}

test('quality corpus is broad, unique and includes multi-turn conversations', () => {
  const names = CUSTOMER_AGENT_QUALITY_SCENARIOS.map((scenario) => scenario.name);
  const turns = CUSTOMER_AGENT_QUALITY_SCENARIOS.reduce(
    (total, scenario) => total + scenario.turns.length,
    0,
  );

  assert.ok(CUSTOMER_AGENT_QUALITY_SCENARIOS.length >= 190);
  assert.ok(turns >= 200);
  assert.equal(new Set(names).size, names.length);
  assert.ok(CUSTOMER_AGENT_QUALITY_SCENARIOS.some((scenario) => scenario.turns.length >= 3));
  assert.ok(CUSTOMER_AGENT_EVAL_SCENARIOS.length >= 40);
});

test('accepts a concise, grounded customer answer', () => {
  const failures = validateEvaluationTurn(turn(), {
    intents: ['coverage_question'],
    actions: ['respond'],
    replyPattern: /assistência 24 horas/i,
  });

  assert.deepEqual(failures, []);
});

test('detects sales pitch and impossible promise in operational handoff', () => {
  const failures = validateEvaluationTurn(turn({
    reply: 'O guincho já está a caminho. Depois fazemos sua cotação.',
    primaryIntent: 'assistance_request',
    action: 'handoff_operational',
    mode: 'operational',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
    handoffSummary: 'Associado parado na pista e solicitando guincho.',
  }), {
    intents: ['assistance_request'],
    actions: ['handoff_operational'],
    mode: 'operational',
    noSalesPitch: true,
  });

  assert.ok(failures.includes('promessa operacional impossivel'));
  assert.ok(failures.includes('tentou vender em atendimento operacional'));
});

test('detects missing consultant summary and repeated sentence', () => {
  const failures = validateEvaluationTurn(turn({
    reply: 'Encaminhei para um consultor. Encaminhei para um consultor.',
    primaryIntent: 'human_requested',
    action: 'handoff_operational',
    mode: 'operational',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    intents: ['human_requested'],
    actions: ['handoff_operational'],
  });

  assert.ok(failures.includes('repetiu frase na mesma resposta'));
  assert.ok(failures.includes('encaminhamento sem resumo para o consultor'));
});

test('detects malformed money and a repeated question from the same conversation', () => {
  const previousReplies = new Set(['qual é o modelo e o ano do veículo?']);
  const failures = validateEvaluationTurn(turn({
    reply: 'Qual é o modelo e o ano do veículo? O limite é R$ 1. 900.',
    primaryIntent: 'sales_quote',
    action: 'ask_model_year',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    intents: ['sales_quote'],
    actions: ['ask_model_year'],
  }, previousReplies);

  assert.ok(failures.includes('valor com formatacao quebrada'));
});

test('detects an objection response that only acknowledges the concern', () => {
  const failures = validateEvaluationTurn(turn({
    reply: 'Entendo sua preocupação com o prazo.',
    primaryIntent: 'objection',
    action: 'respond',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    intents: ['objection'],
    actions: ['respond'],
  });

  assert.ok(failures.includes('resposta apenas reconheceu a objecao sem trata-la'));
});

test('detects a compound question and an unsupported favorable-value promise', () => {
  const failures = validateEvaluationTurn(turn({
    reply: 'Isso permite uma proposta justa. Posso explicar melhor ou prefere falar com um consultor?',
    primaryIntent: 'objection',
    action: 'respond',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    intents: ['objection'],
    actions: ['respond'],
  });

  assert.ok(failures.includes('prometeu uma proposta favoravel sem fonte'));
  assert.ok(failures.includes('juntou duas perguntas em uma frase'));
});

test('detects invented process necessity and an irrelevant vehicle pivot', () => {
  const failures = validateEvaluationTurn(turn({
    reply: 'Esse processo é essencial. Você procura veículo de passeio ou uso profissional?',
    primaryIntent: 'objection',
    action: 'respond',
    answerStatus: 'not_applicable',
    knowledgeIds: [],
  }), {
    intents: ['objection'],
    actions: ['respond'],
    noGenericSalesPivot: true,
  });

  assert.ok(failures.includes('inventou necessidade do processo'));
  assert.ok(failures.includes('desviou a objecao para qualificacao de veiculo'));
});

test('detects an unlimited assistance promise and a generic factual follow-up', () => {
  const failures = validateEvaluationTurn(turn({
    reply: 'A assistência inclui troca de pneu sempre que precisar. Gostaria de saber sobre outras coberturas ou precisa de ajuda com algo mais?',
  }), {
    intents: ['coverage_question'],
    actions: ['respond'],
    noGenericSalesPivot: true,
  });

  assert.ok(failures.includes('prometeu uso de assistencia sem respeitar o limite'));
  assert.ok(failures.includes('desviou a resposta para uma pergunta comercial generica'));
});
