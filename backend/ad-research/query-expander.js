import { callAI } from '../ai/gemini.js';
import { resolveEffectiveAIConfig } from '../data/config-manager.js';
import { normalizeText, tokenizeText, uniqueStrings } from './utils.js';

const NICHE_PACKS = [
  {
    matches: ['protecao veicular', 'associacao veicular', 'seguro auto popular'],
    terms: [
      'protecao veicular',
      'associacao veicular',
      'seguro para carro',
      'seguro auto',
      'seguranca veicular',
      'assistencia 24 horas veicular',
      'cotacao protecao veicular',
      'rastreador veicular',
    ],
  },
  {
    matches: ['energia solar', 'placa solar'],
    terms: [
      'energia solar',
      'placa solar',
      'painel solar',
      'economia de energia',
      'kit solar residencial',
      'instalacao energia solar',
    ],
  },
  {
    matches: ['consorcio', 'consorcio auto', 'consorcio imobiliario'],
    terms: [
      'consorcio',
      'carta de credito',
      'consorcio auto',
      'consorcio imobiliario',
      'parcelas sem juros',
      'contemplacao',
    ],
  },
];

function hasResearchAI(config = {}) {
  const effective = resolveEffectiveAIConfig(config);
  return !!effective.hasEffectiveKey;
}

function getPackTerms(query) {
  const normalizedQuery = normalizeText(query);
  return NICHE_PACKS.flatMap((pack) => (
    pack.matches.some((match) => normalizedQuery.includes(match)) ? pack.terms : []
  ));
}

function buildGenericTerms(query, region = '') {
  const tokens = tokenizeText(query);
  const mainPhrase = String(query || '').trim();
  const regionText = String(region || '').trim();
  const core = tokens.slice(0, 4).join(' ');
  const regionParts = regionText
    ? uniqueStrings([
        regionText,
        regionText.split(',')[0]?.trim(),
        regionText.split('-')[0]?.trim(),
      ], 2)
    : [];

  return uniqueStrings([
    mainPhrase,
    core && `empresa de ${core}`,
    core && `${core} brasil`,
    core && `${core} online`,
    core && `${core} promocao`,
    core && `${core} especialista`,
    core && `cotacao ${core}`,
    core && `solucao ${core}`,
    ...regionParts.flatMap((regionValue) => [
      `${mainPhrase} ${regionValue}`,
      core && `${core} ${regionValue}`,
    ]),
  ], 8);
}

function buildSemanticTerms(query) {
  const tokens = tokenizeText(query);
  return uniqueStrings([
    query,
    ...tokens,
    ...tokens.map((token) => `${token} premium`),
    ...tokens.map((token) => `${token} desconto`),
    ...tokens.map((token) => `${token} confiavel`),
  ], 24);
}

async function expandWithAI({ query, region, config }) {
  const systemPrompt = [
    'Voce planeja pesquisas para a Biblioteca de Anuncios da Meta.',
    'Recebera um nicho ou objetivo comercial e deve devolver JSON puro.',
    'Pense em sinônimos comerciais, promessas, dores, nomes alternativos e termos usados por concorrentes.',
    'Nao repita termos, nao explique nada fora do JSON e foque em termos em portugues do Brasil.',
    'Responda com este formato:',
    '{"intentSummary":"", "searchTerms":[""], "semanticTerms":[""], "angles":[""]}',
  ].join(' ');

  const userMessage = [
    `Busca principal: ${query}`,
    region ? `Regiao opcional: ${region}` : 'Regiao opcional: sem filtro',
    'Monte no maximo 8 searchTerms e no maximo 16 semanticTerms.',
    'Priorize termos que ajudem a encontrar anuncios mesmo quando a palavra principal nao aparece literal.',
  ].join('\n');

  const response = await callAI(
    config,
    { systemPrompt, history: [], userMessage },
    { purpose: 'qualification' },
  );

  const parsed = JSON.parse(response || '{}');
  return {
    intentSummary: String(parsed.intentSummary || '').trim(),
    searchTerms: uniqueStrings(parsed.searchTerms || [], 8),
    semanticTerms: uniqueStrings(parsed.semanticTerms || [], 16),
    angles: uniqueStrings(parsed.angles || [], 8),
  };
}

export async function expandSearchQuery({ query, region = '', config = {} }) {
  const effectiveConfig = resolveEffectiveAIConfig(config);
  const fallbackSearchTerms = uniqueStrings([
    query,
    ...getPackTerms(query),
    ...buildGenericTerms(query, region),
  ], 8);

  const fallbackSemanticTerms = uniqueStrings([
    query,
    ...getPackTerms(query),
    ...buildSemanticTerms(query),
  ], 24);

  const expansion = {
    provider: effectiveConfig.effectiveProvider || 'groq',
    usedAI: false,
    intentSummary: '',
    angles: [],
    searchTerms: fallbackSearchTerms,
    semanticTerms: fallbackSemanticTerms,
    warnings: [],
  };

  if (!hasResearchAI(effectiveConfig)) {
    expansion.warnings.push('Busca sem IA: usando expansao heuristica local.');
    return expansion;
  }

  try {
    const aiExpansion = await expandWithAI({ query, region, config: effectiveConfig });
    expansion.usedAI = true;
    expansion.intentSummary = aiExpansion.intentSummary;
    expansion.angles = aiExpansion.angles;
    expansion.searchTerms = uniqueStrings([
      ...aiExpansion.searchTerms,
      ...fallbackSearchTerms,
    ], 8);
    expansion.semanticTerms = uniqueStrings([
      ...aiExpansion.semanticTerms,
      ...fallbackSemanticTerms,
    ], 24);
    return expansion;
  } catch (error) {
    expansion.warnings.push(`Falha na expansao por IA: ${error.message}`);
    return expansion;
  }
}
