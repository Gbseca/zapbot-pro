import { pathToFileURL } from 'url';

import { getDefaultModel, loadConfig, resolveEffectiveAIConfig } from '../data/config-manager.js';
import { applyDeterministicFactsToLead } from './deterministic-facts.js';
import { applyCustomerAgentTurnToLead, runCustomerAgent } from './customer-agent.js';

const FORBIDDEN_TERMS = /\b(?:seguro|seguradora|ap[oó]lice|sinistro|pr[eê]mio)s?\b/i;
const IMPOSSIBLE_PROMISES = [
  /(?:reboque|guincho).{0,35}(?:a caminho|chegando|foi acionado)/i,
  /(?:pagamento|boleto).{0,35}(?:confirmado|baixado|gerado|liberado)/i,
  /(?:app|aplicativo).{0,35}(?:liberado|desbloqueado)/i,
  /(?:consultei|verifiquei|conferi).{0,30}(?:sistema|cadastro|fipe)/i,
];

export const CUSTOMER_AGENT_EVAL_SCENARIOS = [
  { name: 'saudacao', turns: [{ message: 'bom dia td bem?', intents: ['greeting'], actions: ['respond'] }] },
  { name: 'cotacao-direta', turns: [{ message: 'quero fazer uma cotacao pro meu carro', intents: ['sales_quote'], actions: ['ask_model_year'] }] },
  { name: 'duvida-e-cotacao', turns: [{ message: 'quero cotar mas antes queria saber se cobre granizo', intents: ['coverage_question'], secondary: ['sales_quote'], actions: ['ask_model_year'], replyPattern: /granizo|fen[oô]menos da natureza/i }] },
  { name: 'preco-real', turns: [{ message: 'quanto fica pra proteger meu voyage 2015?', intents: ['sales_price_request', 'sales_quote'], actions: ['handoff_sales'] }] },
  { name: 'institucional', turns: [{ message: 'o que exatamente e a moove?', intents: ['company_question'], actions: ['respond'], replyPattern: /associa[cç][aã]o|mutualismo/i }] },
  { name: 'natureza-juridica', turns: [{ message: 'vcs sao uma seguradora?', intents: ['company_question'], actions: ['respond'], replyPattern: /associa[cç][aã]o.*(?:mutualismo|prote[cç][aã]o veicular)/i }] },
  { name: 'roubo-furto', turns: [{ message: 'se roubarem meu carro tem cobertura?', intents: ['coverage_question'], actions: ['respond'], replyPattern: /roubo|furto/i }] },
  { name: 'terceiros', turns: [{ message: 'e se eu bater no carro de outra pessoa, cobre terceiros?', intents: ['coverage_question'], actions: ['respond'], replyPattern: /terceir/i }] },
  { name: 'vidros', turns: [{ message: 'quebrou so o parabrisa, como funciona?', intents: ['coverage_question'], actions: ['respond'], replyPattern: /40%.*(?:associado|participa[cç][aã]o)|(?:associado|participa[cç][aã]o).*40%/i, forbiddenReplyPattern: /moove\s+(?:paga|cobre)\s+(?:os\s+)?40%/i }] },
  { name: 'assistencia-informativa', turns: [{ message: 'a protecao tem assistencia 24 horas e guincho?', intents: ['coverage_question'], actions: ['respond'], replyPattern: /guincho|reboque/i }] },
  { name: 'uber', turns: [{ message: 'aceita carro de uber?', intents: ['eligibility_question'], actions: ['respond', 'ask_model_year'], replyPattern: /uber|aplicativo/i }] },
  { name: 'moto', turns: [{ message: 'vcs pegam moto tbm?', intents: ['eligibility_question'], actions: ['respond', 'ask_model_year'], replyPattern: /moto/i }] },
  { name: 'caminhao', turns: [{ message: 'da pra proteger caminhao?', intents: ['eligibility_question'], actions: ['respond', 'ask_model_year'], replyPattern: /caminh[aã]o|caminh[oõ]es/i }] },
  { name: 'dois-veiculos-sem-fonte', turns: [{ message: 'posso colocar dois carros no meu nome?', intents: ['eligibility_question'], actions: ['handoff_sales'] }] },
  { name: 'idade-condutor-sem-fonte', turns: [{ message: 'meu filho de 20 anos pode dirigir o carro protegido?', intents: ['eligibility_question', 'coverage_question'], actions: ['handoff_sales'] }] },
  { name: 'territorio-sem-fonte', turns: [{ message: 'moro fora do rio, vcs atendem em qualquer estado?', intents: ['eligibility_question', 'company_question'], actions: ['handoff_sales'] }] },
  { name: 'vencimentos', turns: [{ message: 'quais dias posso escolher pro vencimento?', intents: ['company_question', 'sales_price_request'], actions: ['respond'], replyPattern: /10.*15.*20/i }] },
  { name: 'cota-participacao', turns: [{ message: 'como funciona a cota de participacao numa colisao?', intents: ['coverage_question', 'company_question'], actions: ['respond'], replyPattern: /participa[cç][aã]o|fipe/i }] },
  { name: 'boleto', turns: [{ message: 'preciso do boleto desse mes', intents: ['boleto_request'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'inadimplencia', turns: [{ message: 'to atrasado e quero resolver minha pendencia', intents: ['regularization_request'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'pagamento', turns: [{ message: 'ja paguei ontem mas ainda consta aberto', intents: ['payment_claimed', 'system_check_request'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'comprovante', turns: [{ message: 'tenho o comprovante aqui, mando pra quem?', intents: ['receipt_available'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'aplicativo', turns: [{ message: 'meu app ta bloqueado e nao entra de jeito nenhum', intents: ['app_blocked'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'evento-veiculo', turns: [{ message: 'bati o carro agora, sou associado, oq eu faco?', intents: ['event_report'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'reboque-urgente', turns: [{ message: 'meu carro parou no meio da pista preciso de um guincho agr', intents: ['assistance_request'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'cancelamento', turns: [{ message: 'quero cancelar minha protecao', intents: ['cancel_request'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'revistoria', turns: [{ message: 'paguei atrasado e falaram de revistoria, preciso resolver', intents: ['inspection_pending', 'regularization_request'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'humano', turns: [{ message: 'quero falar com uma pessoa por favor', intents: ['human_requested'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'cliente-irritado', turns: [{ message: 'essa cobranca ta errada pra caramba, resolve essa merda', intents: ['billing_disputed', 'regularization_request'], actions: ['handoff_operational'], mode: 'operational' }] },
  { name: 'zero-km', turns: [{ message: 'carro zero km precisa fazer vistoria?', intents: ['eligibility_question', 'company_question'], actions: ['respond'], replyPattern: /15 dias|isent/i }] },
  { name: 'rastreador', turns: [{ message: 'em quais carros o rastreador e obrigatorio?', intents: ['eligibility_question', 'company_question'], actions: ['respond'], replyPattern: /100[ .]?000|diesel|importad/i }] },
  { name: 'pane-mecanica', turns: [{ message: 'se o motor quebrar vcs pagam o conserto?', intents: ['coverage_question'], actions: ['respond', 'ask_model_year'], replyPattern: /n[aã]o.*(?:mec[aâ]nic|manuten[cç][aã]o|desgaste)/i }] },
  { name: 'sem-interesse', turns: [{ message: 'nao quero mais, pode parar', intents: ['no_interest'], actions: ['stop'] }] },
  { name: 'objecao-confianca', turns: [{ message: 'como eu sei que isso nao e furada?', intents: ['objection', 'company_question'], actions: ['respond', 'handoff_sales'] }] },
  { name: 'abreviacoes', turns: [{ message: 'qro saber se pega uber e qnt fica', intents: ['eligibility_question', 'sales_price_request'], actions: ['handoff_sales', 'ask_model_year'] }] },
  { name: 'agradecimento', turns: [{ message: 'blz obg pela ajuda', intents: ['thanks'], actions: ['respond'] }] },
  { name: 'identidade-assistente', turns: [{ message: 'vc e uma pessoa de verdade?', intents: ['assistant_identity'], actions: ['respond'] }] },
  { name: 'desconhecido', turns: [{ message: 'vcs deixam cachorro andar solto dentro do carro?', intents: ['unknown', 'other', 'eligibility_question', 'coverage_question'], actions: ['handoff_sales', 'clarify'] }] },
  {
    name: 'cotacao-multivolta-sem-repetir-placa',
    turns: [
      { message: 'boa tarde, quero cotar meu carro', intents: ['sales_quote'], actions: ['ask_model_year'] },
      { message: 'wolksvagen voyage 2015', intents: ['sales_quote', 'other'], actions: ['ask_plate_optional', 'handoff_sales'] },
    ],
  },
  {
    name: 'explicacao-da-placa',
    lead: {
      model: 'Voyage',
      year: '2015',
      plateRequestedAt: new Date().toISOString(),
      history: [{ role: 'assistant', content: 'A placa é opcional. Você quer informar?', ts: Date.now() }],
    },
    turns: [
      { message: 'pq vc precisa da placa?', intents: ['objection', 'other'], actions: ['respond', 'handoff_sales'], replyPattern: /placa|opcional|ve[ií]culo/i },
    ],
  },
  {
    name: 'recusa-da-placa',
    lead: {
      model: 'Voyage',
      year: '2015',
      plateRequestedAt: new Date().toISOString(),
      history: [{ role: 'assistant', content: 'A placa é opcional. Você quer informar?', ts: Date.now() }],
    },
    turns: [
      { message: 'prefiro nao passar agora', intents: ['objection', 'sales_quote'], actions: ['handoff_sales'] },
    ],
  },
  {
    name: 'duvida-multivolta',
    turns: [
      { message: 'oi, queria entender a protecao', intents: ['company_question', 'greeting'], actions: ['respond'] },
      { message: 'e cobre roubo?', intents: ['coverage_question'], actions: ['respond', 'ask_model_year'] },
      { message: 'legal, quero ver um valor', intents: ['sales_price_request', 'sales_quote'], actions: ['ask_model_year', 'handoff_sales'] },
    ],
  },
  {
    name: 'desconhecido-curto',
    turns: [
      { message: 'e cachorro?', intents: ['unknown', 'other', 'company_question', 'eligibility_question', 'coverage_question'], actions: ['handoff_sales', 'clarify'] },
    ],
  },
];

function countQuestions(value = '') {
  return (String(value).match(/\?/g) || []).length;
}

function validateTurn(turn, expected, previousReplies) {
  const failures = [];
  const detected = [turn.primaryIntent, turn.secondaryIntent].filter((intent) => intent && intent !== 'none');
  if (expected.intents && !expected.intents.some((intent) => detected.includes(intent))) {
    failures.push(`intencao ${detected.join('+') || 'ausente'}; esperado ${expected.intents.join('|')}`);
  }
  if (expected.secondary && !expected.secondary.some((intent) => turn.secondaryIntent === intent)) {
    failures.push(`intencao secundaria ${turn.secondaryIntent}; esperado ${expected.secondary.join('|')}`);
  }
  if (expected.actions && !expected.actions.includes(turn.action)) {
    failures.push(`acao ${turn.action}; esperado ${expected.actions.join('|')}`);
  }
  if (expected.mode && turn.mode !== expected.mode) failures.push(`modo ${turn.mode}; esperado ${expected.mode}`);
  if (expected.replyPattern && !expected.replyPattern.test(turn.reply)) failures.push('resposta nao tratou a duvida principal');
  if (expected.forbiddenReplyPattern && expected.forbiddenReplyPattern.test(turn.reply)) failures.push('resposta atribuiu a regra a parte errada');
  if (countQuestions(turn.reply) > 1) failures.push('mais de uma pergunta');
  if (FORBIDDEN_TERMS.test(turn.reply)) failures.push('termo proibido');
  if (IMPOSSIBLE_PROMISES.some((pattern) => pattern.test(turn.reply))) failures.push('promessa operacional impossivel');
  if (['answered', 'partial'].includes(turn.answerStatus)
    && ['company_question', 'coverage_question', 'eligibility_question', 'sales_price_request'].includes(turn.primaryIntent)
    && turn.knowledgeIds.length === 0) {
    failures.push('resposta factual sem fonte');
  }
  if (previousReplies.has(turn.reply.toLowerCase())) failures.push('resposta identica repetida na mesma conversa');
  return failures;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function loadEvaluationConfig() {
  const saved = loadConfig();
  const forcedProvider = String(process.env.AI_EVAL_PROVIDER || '').trim().toLowerCase();
  if (!['gemini', 'groq'].includes(forcedProvider)) return resolveEffectiveAIConfig(saved);
  return resolveEffectiveAIConfig({
    ...saved,
    aiProvider: forcedProvider,
    aiModel: getDefaultModel(forcedProvider),
    geminiFallbackEnabled: false,
    groqKey: forcedProvider === 'gemini' ? '' : saved.groqKey,
    geminiKey: forcedProvider === 'groq' ? '' : saved.geminiKey,
  });
}

function getRateLimitDelay(error) {
  const message = String(error?.message || error || '');
  if (!/\b429\b|rate.?limit|quota/i.test(message)) return 0;
  const match = message.match(/try again in\s*([\d.]+)\s*(ms|s)/i);
  if (!match) return 15_000;
  const value = Number(match[1]);
  return Math.ceil((match[2].toLowerCase() === 'ms' ? value : value * 1000) + 750);
}

async function runTurnWithRetry(args, print) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runCustomerAgent(args);
    } catch (error) {
      lastError = error;
      const waitMs = getRateLimitDelay(error);
      if (!waitMs || attempt === 3) break;
      print(`WAIT limite temporario da IA; nova tentativa em ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

export async function runCustomerAgentEvaluation({
  config = loadEvaluationConfig(),
  scenarios = CUSTOMER_AGENT_EVAL_SCENARIOS,
  limit = Number(process.env.AI_EVAL_LIMIT) || scenarios.length,
  offset = Number(process.env.AI_EVAL_OFFSET) || 0,
  delayMs = Number(process.env.AI_EVAL_DELAY_MS ?? 15_000),
  print = console.log,
} = {}) {
  if (!config.hasEffectiveKey) throw new Error('Nenhuma chave de IA configurada para executar a avaliacao.');
  const selected = scenarios.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
  const results = [];
  const providerCounts = {};

  for (const scenario of selected) {
    const lead = {
      number: '5511999999999',
      phone: '5511999999999',
      phoneResolved: true,
      status: 'talking',
      stage: 'engaged',
      history: [],
      ...(scenario.lead || {}),
    };
    lead.history = [...(scenario.lead?.history || [])];
    const previousReplies = new Set();
    for (const expected of scenario.turns) {
      lead.history.push({ role: 'user', content: expected.message, ts: Date.now() });
      const userHistory = lead.history
        .filter((entry) => entry.role === 'user')
        .map((entry) => entry.content)
        .join('\n');
      applyDeterministicFactsToLead(lead, userHistory);
      const startedAt = Date.now();
      try {
        const turn = await runTurnWithRetry({ config, lead, message: expected.message }, print);
        const failures = validateTurn(turn, expected, previousReplies);
        applyCustomerAgentTurnToLead(lead, turn);
        lead.history.push({ role: 'assistant', content: turn.reply, ts: Date.now() });
        previousReplies.add(turn.reply.toLowerCase());
        providerCounts[turn.provider] = (providerCounts[turn.provider] || 0) + 1;
        const result = {
          scenario: scenario.name,
          message: expected.message,
          reply: turn.reply,
          intent: turn.primaryIntent,
          secondaryIntent: turn.secondaryIntent,
          action: turn.action,
          mode: turn.mode,
          answerStatus: turn.answerStatus,
          knowledgeIds: turn.knowledgeIds,
          provider: turn.provider,
          model: turn.model,
          durationMs: Date.now() - startedAt,
          passed: failures.length === 0,
          failures,
        };
        results.push(result);
        const failureText = failures.length ? ` [${failures.join('; ')}]` : '';
        print(`${result.passed ? 'PASS' : 'FAIL'} ${scenario.name}: ${result.intent}/${result.action} (${turn.model})${failureText} - ${turn.reply}`);
      } catch (error) {
        results.push({
          scenario: scenario.name,
          message: expected.message,
          passed: false,
          failures: [`erro do provedor: ${error.message}`],
          durationMs: Date.now() - startedAt,
        });
        print(`FAIL ${scenario.name}: erro do provedor - ${error.message}`);
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  const passed = results.filter((result) => result.passed).length;
  return {
    summary: {
      scenarios: selected.length,
      turns: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length ? Number(((passed / results.length) * 100).toFixed(1)) : 0,
      providerCounts,
    },
    results,
  };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const report = await runCustomerAgentEvaluation();
  console.log(`EVAL_SUMMARY ${JSON.stringify(report.summary)}`);
  if (process.env.AI_EVAL_FULL_REPORT === 'true') console.log(JSON.stringify(report, null, 2));
  if (report.summary.failed > 0) process.exitCode = 1;
}
