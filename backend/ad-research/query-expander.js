import { callAI } from '../ai/gemini.js';
import { resolveEffectiveAIConfig } from '../data/config-manager.js';
import { normalizeText, tokenizeText, uniqueStrings } from './utils.js';

const SEARCH_MODES = new Set(['broad', 'exact', 'advertiser']);

const NICHE_PACKS = [
  {
    matches: ['protecao veicular', 'associacao veicular', 'assistencia veicular'],
    terms: [
      'protecao veicular',
      'associacao de protecao veicular',
      'assistencia 24 horas veicular',
      'cotacao protecao veicular',
      'rastreador veicular',
      'beneficios para veiculos',
    ],
    semantic: ['tranquilidade', 'reboque', 'guincho', 'colisao', 'roubo e furto', 'atendimento 24 horas'],
  },
  {
    matches: ['energia solar', 'placa solar', 'painel solar'],
    terms: ['energia solar', 'painel solar residencial', 'economia de energia', 'instalacao solar', 'kit solar'],
    semantic: ['conta de luz', 'economia mensal', 'geracao propria', 'energia renovavel'],
  },
  {
    matches: ['consorcio', 'carta de credito'],
    terms: ['consorcio', 'consorcio de veiculos', 'carta de credito', 'consorcio imobiliario', 'contemplacao'],
    semantic: ['parcelas', 'planejamento', 'compra programada', 'lance'],
  },
  {
    matches: ['rastreador', 'rastreamento veicular'],
    terms: ['rastreador veicular', 'rastreamento de veiculos', 'localizador veicular', 'monitoramento veicular'],
    semantic: ['aplicativo de rastreamento', 'localizacao em tempo real', 'antifurto'],
  },
];

function safeMode(value) {
  return SEARCH_MODES.has(value) ? value : 'broad';
}

function getMatchingPacks(query) {
  const normalized = normalizeText(query);
  return NICHE_PACKS.filter((pack) => pack.matches.some((match) => normalized.includes(match)));
}

function buildFallbackTerms(query, region, mode) {
  const main = String(query || '').trim();
  if (mode === 'exact') return [main];
  if (mode === 'advertiser') {
    return uniqueStrings([main, `${main} oficial`, `${main} brasil`], 3);
  }

  const packs = getMatchingPacks(query);
  const tokens = tokenizeText(query).filter((token) => token.length >= 3);
  const core = tokens.slice(0, 5).join(' ');
  const location = String(region || '').split(',')[0]?.trim();

  return uniqueStrings([
    main,
    ...packs.flatMap((pack) => pack.terms),
    core && `empresa de ${core}`,
    core && `cotacao ${core}`,
    location && `${main} ${location}`,
  ].filter(Boolean), 6);
}

function buildFallbackSemantic(query) {
  const packs = getMatchingPacks(query);
  const tokens = tokenizeText(query).filter((token) => token.length >= 3);
  return uniqueStrings([
    query,
    ...tokens,
    ...packs.flatMap((pack) => pack.semantic),
    ...packs.flatMap((pack) => pack.terms),
  ], 24);
}

function parseJsonObject(value = '') {
  const text = String(value || '').trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('A IA nao devolveu um objeto JSON valido.');
  return JSON.parse(unfenced.slice(start, end + 1));
}

async function expandWithAI({ query, region, objective, config }) {
  const systemPrompt = [
    'Voce planeja pesquisas na Biblioteca de Anuncios da Meta para inteligencia competitiva.',
    'Devolva apenas JSON valido, sem markdown.',
    'Crie termos realmente usados por anunciantes brasileiros, evitando palavras genericas como online, premium ou promocao quando nao agregarem intencao.',
    'Nao repita termos e nao invente nomes de empresas.',
    'Formato: {"intentSummary":"", "searchTerms":[""], "semanticTerms":[""], "angles":[""]}.',
  ].join(' ');

  const userMessage = [
    `Nicho ou busca: ${query}`,
    region ? `Regiao de interesse: ${region}` : 'Regiao: Brasil sem cidade obrigatoria',
    objective ? `Objetivo de campanha: ${objective}` : '',
    'Use no maximo 5 termos de pesquisa, 16 termos semanticos e 8 angulos.',
  ].filter(Boolean).join('\n');

  const response = await callAI(
    config,
    { systemPrompt, history: [], userMessage },
    { purpose: 'qualification' },
  );
  const parsed = parseJsonObject(response);
  return {
    intentSummary: String(parsed.intentSummary || '').trim(),
    searchTerms: uniqueStrings(parsed.searchTerms || [], 5),
    semanticTerms: uniqueStrings(parsed.semanticTerms || [], 16),
    angles: uniqueStrings(parsed.angles || [], 8),
  };
}

export async function expandSearchQuery({
  query,
  region = '',
  mode = 'broad',
  objective = '',
  config = {},
} = {}) {
  const safeSearchMode = safeMode(mode);
  const effectiveConfig = resolveEffectiveAIConfig(config);
  const fallbackSearchTerms = buildFallbackTerms(query, region, safeSearchMode);
  const fallbackSemanticTerms = buildFallbackSemantic(query);
  const expansion = {
    provider: effectiveConfig.effectiveProvider || 'local',
    usedAI: false,
    mode: safeSearchMode,
    intentSummary: '',
    angles: [],
    searchTerms: fallbackSearchTerms,
    semanticTerms: fallbackSemanticTerms,
    warnings: [],
  };

  if (safeSearchMode !== 'broad') return expansion;
  if (!effectiveConfig.hasEffectiveKey) {
    expansion.warnings.push('Expansao local usada porque nao ha uma chave de IA disponivel.');
    return expansion;
  }

  try {
    const aiExpansion = await expandWithAI({
      query,
      region,
      objective,
      config: effectiveConfig,
    });
    expansion.usedAI = true;
    expansion.intentSummary = aiExpansion.intentSummary;
    expansion.angles = aiExpansion.angles;
    expansion.searchTerms = uniqueStrings([
      query,
      ...aiExpansion.searchTerms,
      ...fallbackSearchTerms,
    ], 6);
    expansion.semanticTerms = uniqueStrings([
      ...aiExpansion.semanticTerms,
      ...fallbackSemanticTerms,
    ], 24);
  } catch (error) {
    expansion.warnings.push(`A expansao por IA falhou e a busca local foi mantida: ${error.message}`);
  }

  return expansion;
}

export { SEARCH_MODES };
