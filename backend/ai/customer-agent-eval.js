import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import { getDefaultModel, loadConfig, resolveEffectiveAIConfig } from '../data/config-manager.js';
import { applyDeterministicFactsToLead } from './deterministic-facts.js';
import { applyCustomerAgentTurnToLead, runCustomerAgent } from './customer-agent.js';
import { CUSTOMER_AGENT_QUALITY_SCENARIOS } from './customer-agent-quality-cases.js';

const FORBIDDEN_TERMS = /\b(?:seguro|seguradora|ap[oó]lice|sinistro|pr[eê]mio)s?\b/i;
const IMPOSSIBLE_PROMISES = [
  /(?:reboque|guincho).{0,35}(?:a caminho|chegando|foi acionado)/i,
  /(?:pagamento|boleto).{0,35}(?:confirmado|baixado|gerado|liberado)/i,
  /(?:app|aplicativo).{0,35}(?:liberado|desbloqueado)/i,
  /(?:consultei|verifiquei|conferi).{0,30}(?:sistema|cadastro|fipe)/i,
];
const SEPARATE_TEAM_CLAIM = /(?:setor|equipe|time)\s+(?:financeir|de\s+suporte|do\s+suporte)|(?:encaminh\w*|direcion\w*).{0,20}(?:financeiro|suporte)|\b(?:ao|para o|pro)\s+suporte\b/i;
const SALES_PITCH = /\b(?:cota[cç][aã]o|or[cç]amento|modelo\s+e\s+ano|contrat|ades[aã]o|fechar)\b/i;
const UNSUPPORTED_DELIVERY_OFFER = /(?:posso|vou|consigo|quer que eu)\s+(?:te\s+)?(?:enviar|mandar|encaminhar|anexar).{0,60}\b(?:documento|regulamento|arquivo|pdf|link|foto)\b/i;
const UNSUPPORTED_SALES_FLATTERY = /(?:[oó]tima|excelente|boa)\s+(?:escolha|iniciativa)|muito\s+popular|(?:carro|ve[ií]culo|modelo)\s+(?:excelente|incr[ií]vel|[oó]timo)|economia\s+significativa|(?:mais|muito)\s+(?:barat|econ[oô]mic)|superior\s+(?:a|[àa]s?)|an[aá]lise\s+(?:[eé]|fica)\s+(?:um\s+pouco\s+)?diferente/i;
const PRESSURE_TACTIC = /\b(?:[uú]ltima\s+chance|agora\s+ou\s+nunca|vai\s+perder|precisa\s+fechar\s+hoje|n[aã]o\s+pode\s+deixar\s+passar)\b/i;
const UNSUPPORTED_COMMERCIAL_CLAIM = /(?:buscamos|procuramos|nosso\s+foco\s+[eé]|focamos\s+em)\s+(?:oferecer\s+)?[^.!?]{0,100}(?:qualidade|transpar[eê]ncia|complet[ao]|seguran[cç]a|agilidade)|processo\s+(?:[eé]|fica|foi\s+estruturado\s+para)\s+(?:muito\s+)?(?:simples|r[aá]pido|[aá]gil|garantir\s+(?:a\s+)?seguran[cç]a)|seguran[cç]a\s+e\s+agilidade|(?:esse|o)\s+per[ií]odo\s+[eé]\s+necess[aá]rio|(?:prote[cç][aã]o|valores?)\s+(?:s[aã]o\s+|[eé]\s+)?personalizad[oa]s?|valores?.{0,60}\b(?:perfil|plano)\b|garant\w*.{0,35}\b(?:prote[cç][aã]o|cobertura|pagamento|indeniza[cç][aã]o)\b/i;
const GENERIC_SALES_PIVOT = /\b(?:interesse\s+em\s+(?:uma\s+)?cota[cç][aã]o|gostaria\s+de\s+(?:fazer|receber)\s+(?:uma\s+)?cota[cç][aã]o|ve[ií]culo\s+que\s+(?:deseja|quer)\s+proteger|conhecer\s+mais\s+sobre\s+(?:a\s+)?prote[cç][aã]o|j[aá]\s+tem\s+(?:um\s+)?ve[ií]culo\s+em\s+mente\s+para\s+(?:cotar|proteger)|o\s+que\s+(?:voc[eê]\s+)?busca\s+para\s+(?:o\s+)?seu\s+ve[ií]culo)\b/i;
const UNSUPPORTED_VALUE_PROMISE = /\bproposta\s+(?:justa|ideal|vantajosa)\b/i;
const GENERIC_PROCESS_PIVOT = /\bgostaria\s+de\s+(?:saber|conhecer)\s+mais\s+sobre\s+como\s+funciona\s+(?:o\s+processo|(?:a\s+|nossa\s+|a\s+nossa\s+)?prote[cç][aã]o|(?:o\s+nosso\s+|nosso\s+)?(?:sistema\s+de\s+(?:mutualismo|prote[cç][aã]o)|mutualismo|associa[cç][aã]o))\b/i;
const GENERIC_OBJECTION_FOLLOWUP = /\b(?:gostaria\s+de\s+conhecer\s+mais\s+sobre\s+(?:a\s+|nossa\s+)?estrutura|(?:existe\s+)?alguma?\s+outra\s+d[uú]vida[^?]{0,80}\bfuncionamento|existe\s+algum\s+outro\s+ponto[^?]{0,80}\besclarecer|para\s+que\s+(?:eu\s+possa|voc[eê])[^?]{0,120}\bgostaria)\b/i;
const GENERIC_FACTUAL_FOLLOWUP = /\b(?:gostaria\s+de\s+saber(?:\s+mais)?|posso\s+te\s+ajudar|como\s+posso\s+te\s+ajudar|precisa\s+de\s+ajuda)\b[^?]{0,100}\b(?:outros?\s+benef[ií]cios?|outras?\s+d[uú]vidas?|mais\s+alguma\s+d[uú]vida|outras?\s+informa[cç][oõ]es?|o\s+que\s+est[aá]\s+inclu[ií]do|nossas?\s+coberturas?|algo\s+mais)\b/i;
const UNSUPPORTED_PERIOD_RATIONALE = /(?:esse|o)\s+per[ií]odo[^.!?]{0,45}\s+[eé]\s+necess[aá]rio/i;
const UNSUPPORTED_PROCESS_NECESSITY = /\bprocesso[^.!?]{0,60}\s+(?:[eé]|parece)\s+(?:essencial|necess[aá]rio|indispens[aá]vel)\b/i;
const IRRELEVANT_VEHICLE_PIVOT = /\b(?:ve[ií]culo|carro|moto|uso\s+profissional|passeio)\b[^.!?]*\?/i;
const UNREQUESTED_VEHICLE_DATA_REQUEST = /\b(?:informe|informar|me passe|pode passar|diga|envie)\b[^.!?]{0,100}\bmodelo\b[^.!?]{0,50}\bano\b/i;
const ARTIFICIAL_ADDRESS = /\b(?:senhor|senhora)\s*\(a\)/i;
const DUPLICATE_PUNCTUATION = /[.!?]\s*[,.]+/;
const UNSUPPORTED_OBJECTION_RATIONALE = /\b(?:cota[cç][aã]o\s+[eé]\s+personalizada|sem\s+compromisso|(?:prezamos|valorizamos|priorizamos)\s+(?:pela|a)\s+(?:transpar[eê]ncia|seguran[cç]a|qualidade)|(?:cota\s+de\s+participa[cç][aã]o|car[eê]ncia|regra|processo)[^.!?]{0,90}(?:equil[ií]brio|sustentabilidade)|visando\s+(?:a\s+)?(?:seguran[cç]a|agilidade|transpar[eê]ncia))\b/i;
const UNSUPPORTED_COTA_PURPOSE = /\bcota\s+de\s+participa[cç][aã]o[^.!?]{0,100}\b(?:fundamental|garant\w*|suporte)\b/i;
const COMPOUND_QUESTION = /(?:(?:posso|quer\s+que\s+eu|gostaria\s+que\s+eu|voc[eê]\s+gostaria)[^?]{0,160}\s+ou\s+(?:voc[eê]\s+)?(?:prefere|quer|gostaria)|(?:ficou|est[aá])[^?]{0,100}\s+ou\s+(?:voc[eê]\s+)?(?:gostaria|quer|prefere)|(?:gostaria\s+de\s+(?:entender|saber|esclarecer))[^?]{0,130}\s+ou\s+(?:voc[eê]\s+)?(?:prefere|quer|gostaria)|(?:o\s+que|qual|como)[^?]{0,130}\s+ou\s+(?:existe|tem|h[aá]|gostaria))[^?]*\?/i;
const COMPOUND_NEXT_STEP = /\bou,?\s+se\s+preferir,?\s+posso[^.!?]{0,160}\bconsultor\b/i;
const UNREQUESTED_COVERAGE_EXPANSION = /(?:^|[.!?]\s+)(?:al[eé]m\s+(?:disso|dele|dela),?\s+(?:tamb[eé]m\s+)?(?:cobrimos|oferecemos|inclu[ií]mos)|esse\s+benef[ií]cio[^.!?]{0,100}\btamb[eé]m\s+conta\s+com)/i;
const UNBOUNDED_ASSISTANCE_CLAIM = /\b(?:sempre que precisar|quantas vezes quiser|sem limite)\b/i;

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

function hasRepeatedSentence(value = '') {
  const sentences = String(value || '')
    .split(/[.!?]+/)
    .map((sentence) => sentence.toLowerCase().replace(/[^a-z0-9áéíóúâêôãõç\s]/gi, '').replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 18);
  return new Set(sentences).size !== sentences.length;
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
  return words.filter((word) => !acknowledgementWords.has(word)).length <= 1
    && !String(turn.reply || '').includes('?');
}

export function validateEvaluationTurn(turn, expected = {}, previousReplies = new Set(), lead = {}) {
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
  for (const pattern of expected.requiredReplyPatterns || []) {
    if (!pattern.test(turn.reply)) failures.push(`resposta sem requisito ${pattern}`);
  }
  for (const pattern of expected.forbiddenReplyPatterns || []) {
    if (pattern.test(turn.reply)) failures.push(`resposta contem trecho proibido ${pattern}`);
  }
  if (countQuestions(turn.reply) > 1) failures.push('mais de uma pergunta');
  if (expected.mustAskExactlyOne && countQuestions(turn.reply) !== 1) failures.push('deveria fazer exatamente uma pergunta');
  if (expected.questionUnlessHandoff
    && !['handoff_sales', 'handoff_operational'].includes(turn.action)
    && countQuestions(turn.reply) !== 1) {
    failures.push('objecao ficou sem uma pergunta util');
  }
  if (expected.mustNotAsk && countQuestions(turn.reply) > 0) failures.push('fez pergunta quando deveria apenas responder');
  if (FORBIDDEN_TERMS.test(turn.reply)) failures.push('termo proibido');
  if (IMPOSSIBLE_PROMISES.some((pattern) => pattern.test(turn.reply))) failures.push('promessa operacional impossivel');
  if (SEPARATE_TEAM_CLAIM.test(turn.reply)) failures.push('inventou equipe separada de atendimento');
  if (UNSUPPORTED_DELIVERY_OFFER.test(turn.reply)) failures.push('ofereceu envio que o atendimento nao executa');
  if (UNSUPPORTED_SALES_FLATTERY.test(turn.reply)) failures.push('usou elogio comercial artificial sem fonte');
  if (PRESSURE_TACTIC.test(turn.reply)) failures.push('usou pressao ou urgencia artificial');
  if (UNSUPPORTED_COMMERCIAL_CLAIM.test(turn.reply)) failures.push('inventou justificativa ou vantagem comercial');
  if (UNSUPPORTED_VALUE_PROMISE.test(turn.reply)) failures.push('prometeu uma proposta favoravel sem fonte');
  if (UNSUPPORTED_PERIOD_RATIONALE.test(turn.reply)) failures.push('inventou justificativa para o prazo');
  if (UNSUPPORTED_PROCESS_NECESSITY.test(turn.reply)) failures.push('inventou necessidade do processo');
  if (UNSUPPORTED_OBJECTION_RATIONALE.test(turn.reply)) failures.push('inventou justificativa para contornar a objecao');
  if (UNSUPPORTED_COTA_PURPOSE.test(turn.reply)) failures.push('inventou finalidade para a cota de participacao');
  if (UNBOUNDED_ASSISTANCE_CLAIM.test(turn.reply)) failures.push('prometeu uso de assistencia sem respeitar o limite');
  if (COMPOUND_QUESTION.test(turn.reply)) failures.push('juntou duas perguntas em uma frase');
  if (COMPOUND_NEXT_STEP.test(turn.reply)) failures.push('ofereceu dois proximos passos na mesma frase');
  if (isBareObjectionAcknowledgement(turn)) failures.push('resposta apenas reconheceu a objecao sem trata-la');
  if (expected.noGenericSalesPivot && (GENERIC_SALES_PIVOT.test(turn.reply) || GENERIC_PROCESS_PIVOT.test(turn.reply) || GENERIC_OBJECTION_FOLLOWUP.test(turn.reply) || GENERIC_FACTUAL_FOLLOWUP.test(turn.reply))) failures.push('desviou a resposta para uma pergunta comercial generica');
  if (expected.noGenericSalesPivot && IRRELEVANT_VEHICLE_PIVOT.test(turn.reply)) failures.push('desviou a objecao para qualificacao de veiculo');
  if (turn.action !== 'ask_model_year' && UNREQUESTED_VEHICLE_DATA_REQUEST.test(turn.reply)) failures.push('pediu modelo e ano fora da acao de qualificacao');
  if (ARTIFICIAL_ADDRESS.test(turn.reply)) failures.push('usou tratamento artificial com genero entre parenteses');
  if (DUPLICATE_PUNCTUATION.test(turn.reply)) failures.push('resposta com pontuacao duplicada');
  if (/\p{Extended_Pictographic}/u.test(turn.reply)) failures.push('resposta com emoji desnecessario');
  if (expected.noSalesPitch && SALES_PITCH.test(turn.reply)) failures.push('tentou vender em atendimento operacional');
  if (expected.noUnrequestedCoverageList && UNREQUESTED_COVERAGE_EXPANSION.test(turn.reply)) failures.push('listou coberturas que nao foram perguntadas');
  if (turn.reply.length > (expected.maxLength || 520)) failures.push('resposta longa demais');
  if (/^[a-záéíóúâêôãõç]/.test(turn.reply)) failures.push('resposta inicia com minuscula');
  if (/[.!?]\s+[a-záéíóúâêôãõç]/.test(turn.reply)) failures.push('frase apos pontuacao inicia com minuscula');
  if (/R\$\s*\d+\.\s+\d{3}\b/.test(turn.reply)) failures.push('valor com formatacao quebrada');
  if (hasRepeatedSentence(turn.reply)) failures.push('repetiu frase na mesma resposta');
  if (turn.action === 'ask_model_year') {
    const modelKnown = !!(lead.model || turn.extractedFacts?.vehicleModel);
    const yearKnown = !!(lead.year || turn.extractedFacts?.vehicleYear);
    const questionText = (turn.reply.match(/[^.!?]*\?/g) || []).join(' ');
    if (!modelKnown && !/modelo/i.test(questionText)) failures.push('nao pediu o modelo que falta');
    if (!yearKnown && !/ano/i.test(questionText)) failures.push('nao pediu o ano que falta');
    if (modelKnown && /modelo/i.test(questionText)) failures.push('repetiu pedido de modelo ja respondido');
    if (yearKnown && /ano/i.test(questionText)) failures.push('repetiu pedido de ano ja respondido');
    if (countQuestions(turn.reply) !== 1) failures.push('coleta de modelo e ano sem uma pergunta unica');
  }
  if (['handoff_sales', 'handoff_operational'].includes(turn.action)) {
    if (/\?/.test(turn.reply)) failures.push('encaminhamento perguntou em vez de confirmar');
    if (!/(?:encaminh(?:ei|ado|ada)|passei|direcionei|consultor\s+(?:j[aá]\s+)?(?:recebeu|continuar[aá]|segue))/i.test(turn.reply)) failures.push('encaminhamento sem confirmacao clara ao cliente');
    if (!String(turn.handoffSummary || '').trim()) failures.push('encaminhamento sem resumo para o consultor');
  } else if (/encaminh(?:ei|ado)|consultor\s+(?:vai|continuar)/i.test(turn.reply)) {
    failures.push('afirmou encaminhamento sem acao de handoff');
  }
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
  const forcedModel = String(process.env.AI_EVAL_MODEL || '').trim();
  if (!['gemini', 'groq'].includes(forcedProvider)) return resolveEffectiveAIConfig(saved);
  return resolveEffectiveAIConfig({
    ...saved,
    aiProvider: forcedProvider,
    aiModel: forcedModel || getDefaultModel(forcedProvider),
    geminiFallbackEnabled: false,
    groqKey: forcedProvider === 'gemini' ? '' : saved.groqKey,
    geminiKey: forcedProvider === 'groq' ? '' : saved.geminiKey,
  });
}

function getRateLimitDelay(error) {
  const message = String(error?.message || error || '');
  const retryable = /\b429\b|rate.?limit|quota|resource_exhausted|\b503\b|high demand|unavailable|overloaded/i.test(message);
  if (!retryable) return 0;
  const maxWaitMs = Math.min(300_000, Math.max(1_000, Number(process.env.AI_EVAL_MAX_RETRY_WAIT_MS) || 60_000));
  const compound = message.match(/try again in\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?/i);
  if (compound && (compound[1] || compound[2])) {
    const milliseconds = ((Number(compound[1]) || 0) * 60_000) + ((Number(compound[2]) || 0) * 1000);
    return Math.min(maxWaitMs, Math.ceil(milliseconds + 750));
  }
  const milliseconds = message.match(/try again in\s*([\d.]+)\s*ms/i);
  if (milliseconds) return Math.min(maxWaitMs, Math.ceil(Number(milliseconds[1]) + 750));
  return Math.min(maxWaitMs, /\b503\b|high demand|unavailable|overloaded/i.test(message) ? 5_000 : 30_000);
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
  const nameFilter = String(process.env.AI_EVAL_FILTER || '').trim();
  const filteredScenarios = nameFilter
    ? scenarios.filter((scenario) => scenario.name.includes(nameFilter))
    : scenarios;
  const selected = filteredScenarios.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
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
    for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex += 1) {
      const expected = scenario.turns[turnIndex];
      lead.history.push({ role: 'user', content: expected.message, ts: Date.now() });
      const userHistory = lead.history
        .filter((entry) => entry.role === 'user')
        .map((entry) => entry.content)
        .join('\n');
      applyDeterministicFactsToLead(lead, userHistory);
      const startedAt = Date.now();
      try {
        const turn = await runTurnWithRetry({ config, lead, message: expected.message }, print);
        const failures = validateEvaluationTurn(turn, expected, previousReplies, lead);
        applyCustomerAgentTurnToLead(lead, turn);
        lead.history.push({ role: 'assistant', content: turn.reply, ts: Date.now() });
        previousReplies.add(turn.reply.toLowerCase());
        providerCounts[turn.provider] = (providerCounts[turn.provider] || 0) + 1;
        const result = {
          scenario: scenario.name,
          turnIndex,
          message: expected.message,
          reply: turn.reply,
          intent: turn.primaryIntent,
          secondaryIntent: turn.secondaryIntent,
          action: turn.action,
          mode: turn.mode,
          answerStatus: turn.answerStatus,
          knowledgeIds: turn.knowledgeIds,
          extractedFacts: turn.extractedFacts,
          handoffSummary: turn.handoffSummary,
          memory: turn.memory,
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
      writeReport(buildEvaluationReport(selected, results, providerCounts, true));
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  return buildEvaluationReport(selected, results, providerCounts, false);
}

function buildEvaluationReport(selected = [], results = [], providerCounts = {}, inProgress = false) {
  const passed = results.filter((result) => result.passed).length;
  return {
    inProgress,
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

function writeReport(report, reportPath = process.env.AI_EVAL_REPORT_PATH) {
  if (!reportPath) return;
  const absolutePath = path.resolve(reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(tempPath, absolutePath);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const suite = String(process.env.AI_EVAL_SUITE || 'baseline').trim().toLowerCase();
  const scenarios = suite === 'quality'
    ? CUSTOMER_AGENT_QUALITY_SCENARIOS
    : suite === 'all'
      ? [...CUSTOMER_AGENT_EVAL_SCENARIOS, ...CUSTOMER_AGENT_QUALITY_SCENARIOS]
      : CUSTOMER_AGENT_EVAL_SCENARIOS;
  const report = await runCustomerAgentEvaluation({ scenarios });
  writeReport(report);
  console.log(`EVAL_SUMMARY ${JSON.stringify(report.summary)}`);
  if (process.env.AI_EVAL_FULL_REPORT === 'true') console.log(JSON.stringify(report, null, 2));
  if (report.summary.failed > 0) process.exitCode = 1;
}
