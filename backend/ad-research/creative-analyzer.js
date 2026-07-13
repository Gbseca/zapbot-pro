import { normalizeText, truncateText, uniqueStrings } from './utils.js';

const ANGLE_RULES = [
  { id: 'economia', label: 'Economia', terms: ['economize', 'desconto', 'preco', 'barato', 'custo', 'parcela', 'mensalidade'] },
  { id: 'seguranca', label: 'Tranquilidade', terms: ['tranquilidade', 'seguranca', 'protegido', 'protecao', 'imprevisto'] },
  { id: 'urgencia', label: 'Urgencia', terms: ['agora', 'hoje', 'ultima chance', 'vagas', 'tempo limitado', 'nao perca'] },
  { id: 'conveniencia', label: 'Facilidade', terms: ['facil', 'rapido', 'sem burocracia', 'online', 'pelo whatsapp', 'em minutos'] },
  { id: 'assistencia', label: 'Assistencia', terms: ['24 horas', 'reboque', 'guincho', 'assistencia', 'socorro'] },
  { id: 'autoridade', label: 'Autoridade', terms: ['especialista', 'anos de experiencia', 'mil clientes', 'avaliacao', 'lider', 'referencia'] },
  { id: 'prova_social', label: 'Prova social', terms: ['clientes', 'associados', 'depoimento', 'estrelas', 'avaliacoes', 'recomendam'] },
  { id: 'exclusividade', label: 'Exclusividade', terms: ['exclusivo', 'personalizado', 'sob medida', 'premium', 'selecionado'] },
];

const CTA_RULES = [
  { label: 'Pedir cotacao', terms: ['cotacao', 'cotar', 'simule', 'orcamento'] },
  { label: 'Chamar no WhatsApp', terms: ['whatsapp', 'chame', 'fale agora', 'mande mensagem'] },
  { label: 'Saiba mais', terms: ['saiba mais', 'conheca', 'descubra'] },
  { label: 'Cadastrar', terms: ['cadastre-se', 'inscreva-se', 'preencha'] },
  { label: 'Comprar', terms: ['compre', 'garanta', 'aproveite'] },
];

const PAIN_RULES = [
  { label: 'Imprevistos', terms: ['imprevisto', 'ficar na mao', 'problema', 'emergencia'] },
  { label: 'Custo alto', terms: ['caro', 'gastar muito', 'prejuizo', 'custo alto'] },
  { label: 'Burocracia', terms: ['burocracia', 'demora', 'complicado', 'papelada'] },
  { label: 'Inseguranca', terms: ['medo', 'inseguranca', 'preocupacao', 'risco'] },
  { label: 'Tempo', terms: ['sem tempo', 'rapido', 'agilidade', 'na hora'] },
];

const PROOF_RULES = [
  { label: 'Numero de clientes', regex: /\b\d{2,}[\s.]*(clientes|associados|pessoas|empresas)\b/i },
  { label: 'Tempo de mercado', regex: /\b\d{1,2}\s*(anos?|meses?)\s+(de|no|na)\b/i },
  { label: 'Avaliacao', regex: /\b(avaliad[oa]|estrelas?|depoimentos?|recomendad[oa])\b/i },
  { label: 'Garantia declarada', regex: /\b(garantia|garantido|comprovado)\b/i },
];

const OFFER_PATTERNS = [
  /\b\d{1,3}%\s*(?:de\s*)?(?:desconto|off)?\b/i,
  /\b(?:r\$\s*)?\d{1,5}(?:[.,]\d{2})?\s*(?:por mes|mensais|a vista|por apenas)?\b/i,
  /\b(?:gratis|gratuito|sem custo|primeira mensalidade|isencao|bonus)\b/i,
];

const URGENCY_PATTERNS = [
  /\b(hoje|agora|ultima chance|ultimas vagas|tempo limitado|so ate|encerra|corra)\b/i,
  /\b\d{1,2}\s*(horas?|dias?|vagas?)\b/i,
];

const FORBIDDEN_MOOVE_TERMS = [
  'seguro',
  'seguradora',
  'apolice',
  'sinistro',
  'premio',
];

const RISK_RULES = [
  { id: 'absolute_promise', label: 'Promessa absoluta', regex: /\b(100% garantido|garantia total|nunca mais|resultado garantido|sem nenhum risco)\b/i },
  { id: 'instant_execution', label: 'Execucao imediata sem confirmacao', regex: /\b(na hora|imediatamente|aprovacao instantanea|ativacao imediata)\b/i },
  { id: 'unsupported_superlative', label: 'Superlativo sem prova', regex: /\b(o melhor|numero 1|lider absoluto|mais barato do brasil)\b/i },
  { id: 'financial_pressure', label: 'Pressao comercial', regex: /\b(so hoje|ultima chance|nao perca de jeito nenhum|corra agora)\b/i },
];

function firstSentence(text = '', maxLength = 150) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  return truncateText(sentence, maxLength);
}
function matchTerms(normalized, rules) {
  return rules
    .filter((rule) => rule.terms.some((term) => normalized.includes(normalizeText(term))))
    .map((rule) => rule.label);
}

function extractMatches(text, patterns, limit = 4) {
  const matches = [];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[0]) matches.push(match[0].trim());
  }
  return uniqueStrings(matches, limit);
}

function inferFunnelStage(normalized = '', cta = '') {
  const combined = `${normalized} ${normalizeText(cta)}`;
  if (/compre|contrate|garanta|cadastre|cotacao|orcamento|whatsapp/.test(combined)) return 'conversao';
  if (/compare|beneficio|vantagem|como funciona|saiba mais/.test(combined)) return 'consideracao';
  return 'descoberta';
}

export function analyzeCompliance(text = '', { niche = '' } = {}) {
  const normalized = normalizeText(text);
  const nicheNormalized = normalizeText(niche);
  const isVehicleProtection = /protecao veicular|associacao veicular|assistencia veicular/.test(`${normalized} ${nicheNormalized}`);
  const terminology = isVehicleProtection
    ? FORBIDDEN_MOOVE_TERMS.filter((term) => new RegExp(`\\b${term}s?\\b`, 'i').test(normalized))
    : [];
  const risks = RISK_RULES
    .filter((rule) => rule.regex.test(normalized))
    .map((rule) => ({ id: rule.id, label: rule.label }));

  if (terminology.length) {
    risks.push({
      id: 'business_terminology',
      label: `Terminologia inadequada para a Moove: ${terminology.join(', ')}`,
    });
  }

  return {
    safe: risks.length === 0,
    riskLevel: risks.length >= 3 ? 'alto' : risks.length ? 'medio' : 'baixo',
    risks,
    terminology,
  };
}

export function analyzeCreative(ad = {}, { query = '' } = {}) {
  const text = String(ad.adText || '');
  const normalized = normalizeText(`${text} ${ad.ctaLabel || ''}`);
  const angles = matchTerms(normalized, ANGLE_RULES);
  const pains = matchTerms(normalized, PAIN_RULES);
  const ctaMatches = matchTerms(normalized, CTA_RULES);
  const proof = PROOF_RULES.filter((rule) => rule.regex.test(text)).map((rule) => rule.label);
  const offers = extractMatches(text, OFFER_PATTERNS);
  const urgency = extractMatches(text, URGENCY_PATTERNS);
  const compliance = analyzeCompliance(text, { niche: query });

  return {
    hook: firstSentence(text),
    angles: angles.length ? angles : ['Beneficio geral'],
    pains,
    offers,
    proof,
    urgency,
    ctas: uniqueStrings([ad.ctaLabel, ...ctaMatches].filter(Boolean), 5),
    funnelStage: inferFunnelStage(normalized, ad.ctaLabel),
    wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
    hasQuestion: /\?/.test(text),
    hasPrice: /(?:r\$\s*)?\d{1,5}(?:[.,]\d{2})?/.test(text),
    compliance,
  };
}

function topCounts(values = [], limit = 8) {
  const counts = new Map();
  values.flat().filter(Boolean).forEach((value) => {
    const label = String(value).trim();
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit);
}

export function buildResearchInsights(results = [], { query = '' } = {}) {
  const ads = Array.isArray(results) ? results : [];
  const analyses = ads.map((ad) => ad.analysis || analyzeCreative(ad, { query }));
  const advertisers = topCounts(ads.map((ad) => ad.advertiserName), 10);
  const formats = topCounts(ads.map((ad) => ad.mediaType || 'desconhecido'), 8);
  const angles = topCounts(analyses.map((item) => item.angles || []), 10);
  const ctas = topCounts(analyses.map((item) => item.ctas || []), 10);
  const offers = topCounts(analyses.map((item) => item.offers || []), 10);
  const pains = topCounts(analyses.map((item) => item.pains || []), 10);
  const riskyAds = ads.filter((ad, index) => !(ad.compliance || analyses[index]?.compliance)?.safe).length;
  const commonAngleKeys = new Set(angles.filter((item) => item.count >= Math.max(2, Math.ceil(ads.length * 0.25))).map((item) => item.label));
  const opportunityAngles = ['Economia', 'Tranquilidade', 'Urgencia', 'Facilidade', 'Assistencia', 'Autoridade', 'Prova social', 'Exclusividade']
    .filter((label) => !commonAngleKeys.has(label))
    .slice(0, 5);

  return {
    query,
    totalAds: ads.length,
    advertisers,
    formats,
    angles,
    ctas,
    offers,
    pains,
    riskyAds,
    opportunityAngles,
    generatedAt: new Date().toISOString(),
  };
}

function isVehicleProtectionQuery(query = '') {
  return /protecao veicular|associacao veicular|assistencia veicular|carro protegido/.test(normalizeText(query));
}

export function buildCampaignToolkit({ ad = {}, query = '', objective = 'gerar conversas' } = {}) {
  const analysis = ad.analysis || analyzeCreative(ad, { query });
  const mainAngle = analysis.angles?.[0] || 'Beneficio principal';
  const safeProtection = isVehicleProtectionQuery(query);
  const niche = String(query || 'sua solucao').trim();

  const variants = safeProtection
    ? [
        {
          name: 'Tranquilidade',
          headline: 'Protecao veicular para dirigir com mais tranquilidade',
          primaryText: 'Imprevistos acontecem. Conheca uma associacao de protecao veicular com atendimento humano e beneficios para o dia a dia.',
          cta: 'Pedir cotacao',
        },
        {
          name: 'Assistencia',
          headline: 'Seu veiculo acompanhado quando voce precisar',
          primaryText: 'Conte com protecao veicular e assistencia para lidar com imprevistos. Fale com um consultor e conheca as condicoes.',
          cta: 'Falar no WhatsApp',
        },
        {
          name: 'Clareza',
          headline: 'Entenda a protecao ideal para o seu veiculo',
          primaryText: 'Receba uma orientacao clara sobre beneficios, participacao e funcionamento da associacao antes de decidir.',
          cta: 'Saiba mais',
        },
      ]
    : [
        {
          name: 'Beneficio direto',
          headline: `${niche}: uma escolha mais simples para o seu objetivo`,
          primaryText: `Descubra uma forma pratica de ${niche.toLowerCase()} com orientacao clara e atendimento humano.`,
          cta: 'Saiba mais',
        },
        {
          name: 'Dor e solucao',
          headline: `Menos complicacao para quem busca ${niche.toLowerCase()}`,
          primaryText: `Transforme uma necessidade comum em um proximo passo simples. Conheca a proposta e tire suas duvidas.`,
          cta: 'Falar com especialista',
        },
        {
          name: 'Comparacao',
          headline: `Compare antes de escolher ${niche.toLowerCase()}`,
          primaryText: `Veja os pontos que realmente importam e escolha com mais clareza, sem promessas exageradas.`,
          cta: 'Conhecer opcoes',
        },
      ];

  const matrix = [
    { test: 'A', variable: 'Gancho', control: mainAngle, variation: 'Pergunta curta ligada a dor principal', metric: 'CTR' },
    { test: 'B', variable: 'Oferta', control: 'Beneficio principal', variation: 'Orientacao personalizada', metric: 'Conversas iniciadas' },
    { test: 'C', variable: 'Prova', control: 'Sem prova', variation: 'Prova verificavel ou depoimento autorizado', metric: 'Taxa de conversa' },
    { test: 'D', variable: 'CTA', control: 'Saiba mais', variation: 'Falar no WhatsApp', metric: 'Cliques para WhatsApp' },
    { test: 'E', variable: 'Formato', control: 'Imagem unica', variation: 'Video curto ou carrossel', metric: 'CTR e retencao' },
    { test: 'F', variable: 'Publico', control: 'Mensagem ampla', variation: 'Mensagem por contexto do veiculo', metric: 'Custo por conversa' },
  ];

  return {
    sourceAdId: ad.id || ad.libraryId || null,
    query,
    objective,
    inspiration: {
      angle: mainAngle,
      hookType: analysis.hasQuestion ? 'pergunta' : 'declaracao',
      funnelStage: analysis.funnelStage,
    },
    variants: variants.map((variant) => ({
      ...variant,
      compliance: analyzeCompliance(`${variant.headline} ${variant.primaryText}`, { niche: query }),
    })),
    matrix,
    note: 'As variacoes sao originais e usam apenas a estrutura estrategica observada, sem copiar a redacao do concorrente.',
    generatedAt: new Date().toISOString(),
  };
}

export function buildCrossPlatformLinks(query = '', region = 'BR') {
  const term = String(query || '').trim();
  const encoded = encodeURIComponent(term);
  const country = String(region || 'BR').trim().toUpperCase();
  return {
    meta: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(country)}&q=${encoded}&search_type=keyword_unordered`,
    google: `https://adstransparency.google.com/?region=${encodeURIComponent(country)}&query=${encoded}`,
    tiktok: `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=${encodeURIComponent(country)}&keyword=${encoded}`,
  };
}

export function buildUtmUrl(url = '', values = {}) {
  try {
    const parsed = new URL(url);
    const defaults = {
      utm_source: values.utm_source || 'meta',
      utm_medium: values.utm_medium || 'paid_social',
      utm_campaign: values.utm_campaign || 'campanha',
      utm_content: values.utm_content || 'criativo_a',
      utm_term: values.utm_term || '',
    };
    Object.entries(defaults).forEach(([key, value]) => {
      if (String(value || '').trim()) parsed.searchParams.set(key, String(value).trim());
    });
    return parsed.toString();
  } catch {
    return '';
  }
}
