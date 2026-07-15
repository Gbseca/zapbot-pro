const OPERATIONAL_INTENTS = new Set([
  'angry_customer',
  'app_blocked',
  'assistance_request',
  'billing_disputed',
  'boleto_request',
  'cancel_request',
  'event_report',
  'human_requested',
  'inspection_pending',
  'payment_claimed',
  'reactivation_request',
  'receipt_available',
  'receipt_received',
  'regularization_request',
  'system_check_request',
]);

const INFORMATIVE_OPERATIONAL_PATTERNS = [
  /\b(?:que|qual) dia\b.{0,25}\b(?:fecha|fechamento)\b.{0,20}\bboleto\b/,
  /\b(?:a protecao|o plano|a associacao)\b.{0,35}\b(?:tem|inclui|oferece|possui)\b.{0,25}\b(?:guincho|reboque|assistencia|chaveiro)\b/,
  /\bassistencia\b.{0,35}\b(?:cobre|inclui|ajuda|oferece|tem)\b.{0,35}\b(?:pane seca|pane eletrica|gasolina|combustivel|pneu|chaveiro|guincho|reboque)\b/,
  /\b(?:quantas vezes|com que frequencia|a cada quantos dias|toda semana|todo mes)\b.{0,35}\b(?:assistencia|guincho|reboque|chaveiro|socorro)\b|\b(?:posso|pode)\b.{0,25}\b(?:chamar|usar|acionar)\b.{0,25}\bassistencia\b.{0,25}\b(?:toda semana|todo mes|quantas vezes)\b/,
  /\bquanto tempo\b.{0,35}\b(?:pagamento|indenizacao)\b.{0,25}\b(?:perda total|pt)\b/,
  /\bquantos?\s+km\b.{0,25}\b(?:guincho|reboque|assistencia)\b/,
  /\bqual (?:e |o )?(?:limite|distancia|quilometragem)\b.{0,25}\b(?:guincho|reboque|assistencia)\b/,
  /\bcomo funciona\b.{0,35}\b(?:assistencia|guincho|reboque|chaveiro|vistoria|revistoria)\b/,
  /\b(?:zero km|veiculo novo)\b.{0,25}\b(?:precisa|exige|tem)\b.{0,20}\b(?:vistoria|revistoria)\b/,
  /\b(?:vistoria|revistoria)\b.{0,20}\b(?:e obrigatoria|e exigida|precisa para (?:aderir|entrar))\b/,
  /\b(?:se|caso|quando) eu\b.{0,45}\b(?:bater|colidir|precisar|necessitar|for roubado|for furtado|tiver um evento)\b/,
  /\b(?:em caso de|quando acontece)\b.{0,35}\b(?:batida|colisao|roubo|furto|evento|pane)\b/,
  /\b(?:cobre|cobertura|protege)\b.{0,30}\b(?:roubo|furto|colisao|batida|alagamento|incendio)\b/,
  /\b(?:acidente|colisao|batida)\b.{0,20}\b(?:cobre|coberto|coberta)\b/,
];

const SALES_QUOTE_PATTERNS = [
  /\b(?:cotacao|orcamento|simulacao)\b/,
  /\b(?:cotar|contratar|aderir)\b/,
  /\b(?:quero|queria|gostaria|preciso)\b.{0,30}\b(?:protecao veicular|proteger (?:meu|minha|um|uma)|fazer uma cotacao)\b/,
  /\b(?:faz|fazer) protecao\b/,
  /\bainda nao sou (?:cliente|associado)\b.{0,45}\b(?:protecao|adesao|cotar|cotacao)\b/,
];

const SALES_PRICE_PATTERNS = [
  /\b(?:quanto|qnt|qt) (?:fica|custa|seria|e)\b/,
  /\bqual (?:o )?valor\b/,
  /\b(?:preco|valor mensal|custa quanto)\b/,
  /\bqual (?:e |o )?valor da mensalidade\b/,
];

const HUMAN_PATTERNS = [
  /\b(?:quero|preciso|gostaria de) (?:falar com |chamar )?(?:um |uma )?(?:atendente|humano|pessoa|consultor|alguem)\b/,
  /\b(?:falar|chamar) com (?:um |uma )?(?:atendente|humano|pessoa|consultor|alguem)\b/,
  /\bme passa(?:r)? (?:para|pra) (?:um |uma )?(?:atendente|humano|pessoa|consultor)\b/,
  /\bnao quero (?:falar com )?(?:robo|bot)\b/,
  /\b(?:tenho|estou com|quero resolver|preciso resolver) (?:um |uma )?(?:problema|questao|situacao|caso)\b.{0,20}\b(?:com voces|com vcs|na moove|no atendimento)\b/,
  /\b(?:chama|manda) alguem\b/,
];

const EXPLICIT_HUMAN_PATTERNS = [
  /\b(?:quero|preciso|gostaria de) (?:falar com |chamar )?(?:um |uma )?(?:atendente|humano|pessoa|consultor|alguem)\b/,
  /\b(?:falar|chamar) com (?:um |uma )?(?:atendente|humano|pessoa|consultor|alguem)\b/,
  /\bme passa(?:r)? (?:para|pra) (?:um |uma )?(?:atendente|humano|pessoa|consultor)\b/,
  /\bnao quero (?:falar com )?(?:robo|bot)\b/,
  /\b(?:chama|manda) alguem\b/,
];

const ANGRY_PATTERNS = [
  /\b(?:absurdo|procon|denunciar|reclamar|processar)\b/,
  /\b(?:porra|caralho|merda|cacete)\b/,
  /\b(?:voces nao resolvem|ninguem resolve|cansei disso|palhacada)\b/,
];

function matchAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function normalizeCustomerText(value = '') {
  let text = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const replacements = [
    [/\b(?:qro|qero)\b/g, 'quero'],
    [/\b(?:presciso|presiso|precizo|prciso)\b/g, 'preciso'],
    [/\b(?:guinxo|guinxho|guicho)\b/g, 'guincho'],
    [/\b(?:bolto|boletu)\b/g, 'boleto'],
    [/\b(?:comprovant|comprovate)\b/g, 'comprovante'],
    [/\b(?:carru|carroa)\b/g, 'carro'],
    [/\broubaro\b/g, 'roubaram'],
    [/\bfurtaro\b/g, 'furtaram'],
    [/\blevaro\b/g, 'levaram'],
    [/\bcobraro\b/g, 'cobraram'],
    [/\b(?:inadiplencia|inadimplensia)\b/g, 'inadimplencia'],
    [/\b(?:inadiplente|inadimplent)\b/g, 'inadimplente'],
    [/\bpendensia\b/g, 'pendencia'],
    [/\b(?:atrazado|atrazada)\b/g, 'atrasado'],
    [/\bcapoto\b/g, 'capotou'],
    [/\b(?:paro|paroh)\b/g, 'parou'],
    [/\b(?:gasosa)\b/g, 'gasolina'],
    [/\b(?:pfv|pfvr)\b/g, 'por favor'],
    [/\bagr\b/g, 'agora'],
    [/\bdnv\b/g, 'de novo'],
    [/\b(?:vlw)\b/g, 'valeu'],
    [/\bn\b/g, 'nao'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, ' ').trim();
}

function makeResult(mode, intent, explicit, reason, emotion = 'neutral') {
  return {
    mode,
    intent,
    explicit,
    isOperational: mode === 'operational',
    reason,
    emotion,
  };
}

function detectEmotion(normalized = '', raw = '') {
  const exclamations = (String(raw || '').match(/!/g) || []).length;
  if (matchAny(normalized, ANGRY_PATTERNS) || exclamations >= 3) return 'angry';
  if (/\b(?:irritado|irritada|chateado|chateada|insatisfeito|insatisfeita)\b/.test(normalized)) return 'irritated';
  return 'neutral';
}

function getLatestCorrectionClause(normalized = '') {
  const parts = normalized
    .split(/\b(?:mas|na verdade|corrigindo|so que|quer dizer)\b/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function detectSalesIntent(normalized = '') {
  if (matchAny(normalized, SALES_PRICE_PATTERNS)) return 'sales_price_request';
  if (matchAny(normalized, SALES_QUOTE_PATTERNS)) return 'sales_quote';
  return null;
}

function stripNegatedOperationalMentions(normalized = '') {
  return normalized
    .replace(/\bnao (?:quero |preciso (?:de )?|necessito (?:de )?)?(?:um |uma )?(?:reboque|guincho|assistencia|chaveiro|socorro)\b/g, ' ')
    .replace(/\bnao (?:bati|colidi|capotei|sofri (?:um |uma )?(?:acidente|colisao|batida))\b(?: (?:o|meu|minha) (?:carro|moto|veiculo))?/g, ' ')
    .replace(/\bnao (?:roubaram|furtaram|levaram)\b(?: (?:o|meu|minha) (?:carro|moto|veiculo))?/g, ' ')
    .replace(/\b(?:meu |o )?(?:app|aplicativo) nao (?:esta |ta |ficou |foi )?(?:bloqueado|travado)\b/g, ' ')
    .replace(/\bnao (?:quero )?cancelar\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isInformationalQuestion(normalized = '') {
  return matchAny(normalized, INFORMATIVE_OPERATIONAL_PATTERNS);
}

function isExplicitConversationStop(normalized = '') {
  return /^(?:para|pare|chega)(?: (?:ai|agora|isso|com isso|por favor|porra|caralho|merda))*$/.test(normalized)
    || /\b(?:para|pare) de (?:insistir|perguntar|mandar mensagens?|me chamar)\b/.test(normalized)
    || /\b(?:me deixa em paz|nao manda mais mensagens?|nao fala mais comigo)\b/.test(normalized);
}

function classifySingle(rawText = '') {
  const normalized = normalizeCustomerText(rawText);
  const emotion = detectEmotion(normalized, rawText);
  if (!normalized) return makeResult('ambiguous', 'general_question', false, 'Mensagem sem texto.', emotion);

  if (matchAny(normalized, [
    /\b(?:ignore|desconsidere|esqueca)\b.{0,35}\b(?:regras?|instrucoes?|prompt|orientacoes?)\b/,
    /\b(?:mostra|mostre|revele|envie)\b.{0,35}\b(?:instrucoes?|prompt|regras?)\b.{0,20}\b(?:internas?)?\b/,
  ])) {
    return makeResult('sales', 'other', true, 'Tentativa de alterar ou obter instrucoes internas.', emotion);
  }

  const correctionClause = getLatestCorrectionClause(normalized);
  const correctionSalesIntent = correctionClause ? detectSalesIntent(correctionClause) : null;
  const salesIntent = detectSalesIntent(normalized);
  const explicitSalesCorrection = !!correctionSalesIntent;
  const negatedOperationalWithSales = !!salesIntent && matchAny(normalized, [
    /\bnao (?:quero|preciso de) (?:boleto|reboque|guincho|assistencia)\b/,
    /\bboleto nao\b/,
    /\b(?:app|aplicativo) nao (?:esta |ta )?(?:bloqueado|travado)\b/,
  ]);
  const salesHelpContext = !!salesIntent && matchAny(normalized, [
    /\b(?:ajuda|problema|dificuldade)\b.{0,35}\b(?:cotacao|cotar|orcamento|simulacao)\b/,
    /\b(?:consultor|atendente|humano|pessoa)\b.{0,35}\b(?:cotacao|cotar|orcamento|simulacao)\b/,
  ]);
  const salesAdhesionBill = matchAny(normalized, [
    /\b(?:boleto|pix) (?:da |de )?adesao\b/,
    /\bnao sou associado\b.{0,50}\b(?:boleto|pix|adesao)\b/,
  ]);
  const salesConsultantRequest = matchAny(normalized, [
    /\b(?:me passa|passa|quero falar|preciso falar|chama)\b.{0,35}\b(?:consultor|atendente|alguem|pessoa)\b.{0,35}\b(?:fechar|contratar|aderir|cotacao|orcamento)\b/,
    /\b(?:consultor|atendente|alguem|pessoa)\b.{0,35}\b(?:fechar|contratar|aderir|cotacao|orcamento)\b/,
  ]);

  if (matchAny(normalized, [
    /\bcancelar (?:a |essa |minha )?(?:cotacao|simulacao|proposta|orcamento)\b/,
    /\bnao quero mais (?:a |essa |minha )?(?:cotacao|simulacao|proposta|orcamento)\b/,
  ])) {
    return makeResult('sales', 'no_interest', true, 'Cliente cancelou somente a cotacao.', emotion);
  }

  if (explicitSalesCorrection || negatedOperationalWithSales || salesHelpContext || salesAdhesionBill) {
    return makeResult('sales', correctionSalesIntent || salesIntent || 'sales_quote', true, 'Pedido comercial explicito na mensagem mais recente.', emotion);
  }

  if (salesConsultantRequest) {
    return makeResult('sales', 'sales_consultant_requested', true, 'Cliente pediu consultor para concluir uma adesao.', emotion);
  }

  if (isInformationalQuestion(normalized)) {
    return makeResult('sales', 'general_question', true, 'Pergunta informativa, sem pedido operacional atual.', emotion);
  }

  const active = stripNegatedOperationalMentions(normalized);
  const paymentText = active.replace(/\bnao (?:paguei|quitei|fiz (?:o )?pagamento|fiz pix)\b/g, ' ');

  if (matchAny(active, [
    /\b(?:consulta|consultar|consulte|verifica|verificar|confere|conferir|olha|checa)\b.{0,40}\b(?:cpf|cnpj|cadastro|sistema|situacao|protecao|plano)\b/,
    /\b(?:cpf|cnpj|cadastro|sistema|situacao|protecao|plano)\b.{0,45}\b(?:consulta|consultar|consulte|verifica|verificar|confere|conferir|olha|checa)\b/,
  ])) {
    return makeResult('operational', 'system_check_request', true, 'Cliente pediu uma consulta de cadastro ou situacao que exige atendimento humano.', emotion);
  }

  if (matchAny(active, EXPLICIT_HUMAN_PATTERNS)) {
    return makeResult('operational', 'human_requested', true, 'Cliente pediu atendimento humano.', emotion);
  }

  if (/^(?:financeiro|suporte|atendimento)(?: por favor)?$/.test(active)) {
    return makeResult('operational', 'human_requested', true, 'Cliente pediu atendimento usando um nome de equipe.', emotion);
  }

  const asksAssistance = matchAny(active, [
    /\b(?:quero|preciso|necessito) (?:de )?(?:um |uma )?(?:reboque|guincho|assistencia|chaveiro|socorro)\b/,
    /\b(?:chama|chamar|aciona|acionar|solicita|solicitar|pede|pedir|manda|mandar) (?:um |uma |o |a )?(?:reboque|guincho|assistencia|chaveiro|socorro)\b/,
    /\b(?:reboque|guincho|assistencia|chaveiro|socorro) (?:urgente|agora|ja|por favor)\b/,
    /^(?:reboque|guincho|assistencia|chaveiro|socorro)(?: por favor)?$/,
    /\b(?:carro|moto|veiculo) (?:quebrou|parou|morreu|nao liga|nao pega|deu pane|esta parado|ficou parado)\b/,
    /\b(?:parou|quebrou) na estrada\b/,
    /\b(?:pane seca|pane na estrada|pneu furado|pneu furou|sem bateria|bateria acabou|bateria arriou)\b/,
    /\b(?:furei|furou) (?:o )?pneu\b/,
    /\bpneu (?:estourou|estourado)\b.{0,35}\b(?:estrada|pista|parado|agora)\b/,
    /\bquebrei na estrada\b/,
    /\b(?:to|estou|fiquei) engui[cç]ad[oa]\b/,
    /\b(?:ele|carro|moto|veiculo) (?:so )?parou\b/,
    /\b(?:tranquei|perdi) (?:a |as )?chave(?:s)?\b/,
    /\b(?:acabou|sem) (?:a )?(?:gasolina|combustivel)\b/,
    /\b(?:to|estou|fiquei) (?:parado na estrada|no prego)\b/,
  ]);
  if (asksAssistance) {
    return makeResult('operational', 'assistance_request', true, 'Pedido real de assistencia ou problema na estrada.', emotion);
  }

  if (matchAny(active, [
    /\b(?:bati|colidi|capotei|capotou|bateram)\b/,
    /\b(?:batida|colisao|acidente)\b/,
    /\b(?:saiu|sai) da pista\b/,
    /\b(?:roubaram|furtaram|levaram)\b/,
    /\b(?:meu |minha )?(?:carro|moto|veiculo) (?:foi )?(?:roubado|roubada|furtado|furtada|levado|levada)\b/,
    /\b(?:meu|minha) (?:carro|moto|veiculo) sumiu\b/,
    /\b(?:tentativa de roubo|assalto)\b/,
    /\b(?:pegou fogo|incendiou|alagou|ficou alagado|arvore caiu)\b/,
    /\b(?:perda total|deu pt)\b/,
    /\b(?:tive|sofri|aconteceu|abrir|acionar) (?:um |uma )?evento\b/,
    /\b(?:sinistro|sinistrou)\b/,
  ])) {
    return makeResult('operational', 'event_report', true, 'Cliente relatou um evento real com o veiculo.', emotion);
  }

  if (matchAny(active, [
    /\b(?:segue|enviei|mandei|anexei|estou enviando|to enviando) (?:o |um )?comprovante\b/,
    /\bcomprovante (?:enviado|anexado)\b/,
  ])) {
    return makeResult('operational', 'receipt_received', true, 'Cliente informou envio de comprovante.', emotion);
  }

  if (/\bcomprovante\b/.test(active)) {
    return makeResult('operational', 'receipt_available', true, 'Cliente mencionou comprovante sem confirmacao automatica de recebimento.', emotion);
  }

  if (matchAny(paymentText, [
    /\b(?:ja paguei|paguei|quitei|pagamento feito|pagamento realizado|pix realizado|fiz pix|fiz o pagamento)\b/,
    /\b(?:saiu|debitou) (?:da |na )?(?:conta|fatura)\b/,
    /\b(?:esta|ta|ficou|foi) pago\b/,
    /\bnao (?:deu|consta) baixa\b/,
  ])) {
    return makeResult('operational', 'payment_claimed', true, 'Cliente informou pagamento que exige conferencia humana.', emotion);
  }

  if (matchAny(active, [
    /\b(?:nao devo|nao tenho (?:debito|divida|pendencia)|nao estou (?:atrasado|inadimplente))\b/,
    /\b(?:cobranca|vencimento|valor|mensalidade) (?:errado|errada|indevido|indevida)\b/,
    /\b(?:parem|para|pare) de cobrar\b/,
    /\b(?:cobraram|cobrando) (?:errado|indevidamente|de novo)\b/,
  ])) {
    return makeResult('operational', 'billing_disputed', true, 'Cliente contestou uma cobranca.', emotion);
  }

  if (matchAny(active, [
    /\b(?:boleto|fatura|linha digitavel|codigo de barras|qr code|link de pagamento)\b/,
    /\b(?:segunda|2) via\b/,
    /\b(?:codigo|chave|copia e cola) pix\b/,
    /\b(?:me passa|manda|envia|gerar|gera) (?:o |um )?pix\b/,
    /^pix(?: por favor)?$/,
    /\bmensalidade nao (?:chegou|veio|apareceu)\b/,
    /\bcancelar (?:esse |o )?boleto\b/,
    /\b(?:trocar|alterar|mudar)\b.{0,25}\b(?:forma|meio) de pagamento\b/,
  ])) {
    return makeResult('operational', 'boleto_request', true, 'Pedido ou problema de boleto/pagamento.', emotion);
  }

  if (matchAny(active, [
    /\b(?:regularizar|negociar|quitar|fazer acordo|resolver)\b.{0,35}\b(?:pendencia|inadimplencia|debito|divida|cobranca|mensalidade)\b/,
    /\b(?:inadimplencia|inadimplente|pendencia|debito|divida|cobranca)\b/,
    /\b(?:atrasado|atrasada|vencido|vencida|venceu|em atraso|devendo)\b/,
    /\bnao paguei(?: ainda)?\b/,
    /\b(?:quero|preciso) pagar (?:a |minha |uma )?mensalidade\b/,
    /\bcomo (?:faco para|faco pra|posso) pagar\b/,
    /\b(?:onde|como|por onde) (?:eu )?(?:pago|pagar)\b.{0,25}\b(?:mensalidade|protecao|associacao)\b/,
  ])) {
    return makeResult('operational', 'regularization_request', true, 'Cliente quer resolver pendencia ou pagamento em aberto.', emotion);
  }

  if (matchAny(active, [
    /\b(?:meu |o )?(?:app|aplicativo) (?:bloqueou|travou|nao abre|nao entra|nao funciona|fica carregando|deu erro|deu pau|esta bugado|ta bugado)\b/,
    /\b(?:nao abre|nao entra|nao funciona) (?:o |no )?(?:app|aplicativo)\b/,
    /\b(?:nao consigo|esqueci)\b.{0,25}\b(?:acessar|entrar|usar|senha|login)\b.{0,20}\b(?:app|aplicativo)?\b/,
    /\b(?:erro|problema) (?:no|do) (?:app|aplicativo|login)\b/,
    /\b(?:app|aplicativo) (?:esta |ta |ficou )?(?:bloqueado|bloqueada)\b/,
  ])) {
    return makeResult('operational', 'app_blocked', true, 'Cliente relatou problema de acesso ao aplicativo.', emotion);
  }

  if (matchAny(active, [
    /\b(?:revistoria|vistoria)\b/,
    /\b(?:codigo|video|foto) (?:da |de )?(?:revistoria|vistoria)\b/,
  ])) {
    return makeResult('operational', 'inspection_pending', true, 'Cliente precisa de atendimento sobre vistoria ou revistoria.', emotion);
  }

  if (matchAny(active, [
    /\b(?:reativar|reativacao|ativa de novo|ativar de novo)\b/,
    /\bprotecao (?:esta |ta |ficou )?(?:suspensa|bloqueada|inativa)\b/,
  ])) {
    return makeResult('operational', 'reactivation_request', true, 'Cliente pediu reativacao.', emotion);
  }

  if (matchAny(active, [
    /\b(?:cancela|cancelar|cancelamento)\b/,
    /\b(?:sair|quero sair) da associacao\b/,
    /\bnao quero mais (?:ser )?associado\b/,
    /\b(?:encerrar|remover) (?:meu |o )?(?:cadastro|vinculo)\b/,
    /\btira(?:r)? (?:meu |o )?(?:carro|veiculo) (?:da protecao|do cadastro)\b/,
  ])) {
    return makeResult('operational', 'cancel_request', true, 'Cliente pediu cancelamento da associacao ou cadastro.', emotion);
  }

  if (isExplicitConversationStop(active)) {
    return makeResult('sales', 'no_interest', true, 'Cliente pediu para encerrar a conversa ou parar a abordagem.', emotion);
  }

  const humanRequest = matchAny(active, HUMAN_PATTERNS);
  if (humanRequest) {
    return makeResult('operational', 'human_requested', true, 'Cliente pediu atendimento humano.', emotion);
  }

  if (emotion === 'angry') {
    return makeResult('operational', 'angry_customer', true, 'Cliente irritado precisa de atendimento humano.', emotion);
  }

  if (salesIntent) {
    return makeResult('sales', salesIntent, true, 'Cliente demonstrou interesse comercial.', emotion);
  }

  if (matchAny(normalized, [
    /^(?:oi|ola|opa|bom dia|boa tarde|boa noite)(?: tudo bem| tudo bom| beleza)?$/,
    /^(?:obg|obrigado|obrigada|valeu)(?: viu| mesmo)?$/,
    /\b(?:como funciona|mutualismo|rateio|associacao|cobertura|cobre|roubo|furto)\b/,
  ])) {
    return makeResult('sales', 'general_question', true, 'Saudacao ou pergunta geral.', emotion);
  }

  if (matchAny(normalized, [
    /^(?:nao quero(?: mais)?|nao tenho interesse|nao preciso)(?: disso| agora| mais)?$/,
    /\bnao quero mais\b.{0,30}\b(?:pode parar|para de insistir|pare de insistir)\b/,
    /^nao preciso de (?:reboque|guincho|assistencia|chaveiro|socorro)(?: agora)?$/,
    /\bsem interesse\b/,
    /\bdeixa (?:pra|para) la\b/,
  ])) {
    return makeResult('sales', 'no_interest', true, 'Cliente recusou a abordagem comercial.', emotion);
  }

  return makeResult('ambiguous', 'general_question', false, 'Mensagem sem sinal deterministico suficiente.', emotion);
}

export function classifyDeterministicIntent(text = '', { contextText = '' } = {}) {
  const primary = classifySingle(text);
  if (primary.explicit) return primary;

  const normalized = normalizeCustomerText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!contextText || words.length === 0 || words.length > 5) return primary;

  const context = String(contextText || '').trim();
  const combined = context.endsWith(String(text || '').trim())
    ? context
    : `${context}\n${text}`;
  const contextual = classifySingle(combined);
  if (contextual.explicit && contextual.mode === 'operational') {
    return {
      ...contextual,
      reason: `${contextual.reason} Contexto recente usado para completar mensagem curta.`,
      source: 'recent_context',
    };
  }
  return primary;
}

export function isOperationalIntent(intent = '') {
  return OPERATIONAL_INTENTS.has(intent);
}
