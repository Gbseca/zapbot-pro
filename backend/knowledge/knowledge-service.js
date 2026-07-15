import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { listFaqItems } from '../data/faq-repository.js';
import { KNOWLEDGE_BASE } from './knowledge-base.js';
import { getPDFKnowledgeChunks } from './pdf-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATIC_JSON_FILES = [
  'faq-moove.json',
  'coverage-rules.json',
  'operational-rules.json',
];
const STATIC_ITEM_PRIORITIES = {
  'coverage-rules.what_is_covered': 16,
  'coverage-rules.what_is_not_covered': 2,
  'coverage-rules.glass_coverage': 4,
  'knowledge-base.o-que-cobre': 14,
  'knowledge-base.o-que-nao-cobre': 2,
  'knowledge-base.cobertura-de-vidros': 2,
};
const DYNAMIC_FAQ_CACHE_MS = 30_000;
let dynamicFaqCache = { expiresAt: 0, items: [] };

const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos',
  'e', 'ela', 'ele', 'em', 'essa', 'esse', 'eu', 'isso', 'me', 'meu', 'minha',
  'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'por', 'pra', 'pro', 'que',
  'se', 'sem', 'ser', 'so', 'sou', 'tem', 'ter', 'um', 'uma', 'voces', 'voce',
  'apenas', 'funciona', 'funcionar', 'queria', 'quero',
  'gostaria', 'preciso', 'pode', 'podem', 'saber', 'antes', 'mas', 'cotar',
  'cotacao', 'orcamento', 'qro', 'qnt', 'quanto', 'fica', 'tbm', 'vcs', 'oi',
  'ola', 'oq', 'pq', 'qual', 'quais', 'significa', 'significado', 'significar',
  'entender', 'conhecer', 'explicar', 'algum', 'alguma', 'regra', 'serve',
  'servir', 'isso', 'ta', 'to', 'depois', 'entrar', 'usar', 'ajudar', 'todo',
  'tudo', 'rua', 'quando', 'ficar', 'chamar', 'ainda', 'dentro', 'rapido',
  'rapidinho', 'longe',
  'ha', 'quantos', 'existir', 'nao', 'sim', 'sei', 'realmente', 'mesmo',
  'algo', 'coisa', 'gosto', 'gostei', 'acho', 'parece', 'demais', 'fala',
  'falar', 'manda', 'mandar', 'escrito', 'olhar', 'ver',
]);

const STEM_SUFFIXES = [
  'amentos', 'imentos', 'acoes', 'mente', 'amento', 'imento', 'adoras', 'adores',
  'idades', 'ismos', 'istas', 'amento', 'ancia', 'encia', 'ando', 'endo', 'indo',
  'ados', 'adas', 'idos', 'idas', 'acao', 'cao', 'sao', 'icos', 'icas', 'ico',
  'ica', 'oso', 'osa', 'ivo', 'iva', 'ar', 'er', 'ir', 'es', 's',
];

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bchuva\s+de\s+pedra\b/g, 'granizo')
    .replace(/\b(?:ha|faz)\s+quantos?\s+anos?\b(?:\s+(?:vcs|voces|a\s+moove|a\s+empresa))?(?:\s+(?:existem?|atua|funciona))?/g, 'tempomercado')
    .replace(/\btempo\s+de\s+mercado\b/g, 'tempomercado')
    .replace(/\b(?:no|em)\s+meu\s+nome\b/g, 'titularidade')
    .replace(/\b(?:mais\s+de\s+um|varios|diversos)\s+(?:carros?|veiculos?)\b/g, 'multiplo veiculo')
    .replace(/\b(?:entrar|aderir|fazer\s+parte)\s+(?:pra|para|na|da)\s+(?:a\s+)?moove\b/g, 'adesao moove')
    .replace(/\b(?:duas|2)\s+(?:protecoes|associacoes|empresas)\b/g, 'protecao concomitante')
    .replace(/\bpara[\s-]?brisas?\b/g, 'parabrisa')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return normalizeText(value).replace(/\s+/g, '-').slice(0, 80) || 'item';
}

function stemToken(value = '') {
  let token = normalizeText(value);
  if (token.length < 5) return token;
  if (token.endsWith('oes') && token.length > 6) return `${token.slice(0, -3)}ao`;
  for (const suffix of STEM_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      token = token.slice(0, -suffix.length);
      break;
    }
  }
  return token;
}

function canonicalToken(token = '') {
  if (/^(?:dirig|condu|condutor|motorist)/.test(token)) return 'condutor';
  if (/^(?:filh|espos|marid|namor|parent)/.test(token)) return 'condutor';
  if (/^vans?$/.test(token)) return 'van';
  if (/^(?:carr|automov|veicul)/.test(token)) return 'veiculo';
  if (/^(?:guinch|reboq)/.test(token)) return 'reboque';
  if (/^(?:parabris|vidr|farol|faroi|lantern|retrovisor)/.test(token)) return 'vidro';
  if (/^(?:cobr|cover)/.test(token)) return 'cobertura';
  if (/^(?:aceit|peg)/.test(token)) return 'aceita';
  if (/^quebr/.test(token)) return 'quebra';
  if (/^(?:consert|repar|manuten)/.test(token)) return 'manutencao';
  if (/^(?:motor|mecan)/.test(token)) return 'mecanica';
  if (/^(?:pag|custe|ressarc)/.test(token)) return 'cobertura';
  if (/^bateri/.test(token)) return 'bateria';
  if (/^bat/.test(token)) return 'colisao';
  if (/^roub/.test(token)) return 'roubo';
  if (/^furt/.test(token)) return 'furto';
  if (/^(?:fogo|incendi)/.test(token)) return 'incendio';
  if (/^(?:alcool|bebid|embriag)/.test(token)) return 'alcool';
  if (/^chav/.test(token)) return 'chaveiro';
  if (/^(?:gasolin|combust|seca)/.test(token)) return 'pane_seca';
  if (/^(?:acion|frequen|vez)/.test(token)) return 'frequencia';
  if (/^(?:concomit|simultan)/.test(token)) return 'concomitante';
  if (/^(?:confi|golpe|furad)/.test(token)) return 'confianca';
  if (/^(?:acontec|event|ocorr)/.test(token)) return 'evento';
  if (/^(?:indeniz|ressarc|reembols|compens)/.test(token)) return 'indenizacao';
  if (/^(?:cota|franqu|particip)/.test(token)) return 'participacao';
  if (/^carenc/.test(token)) return 'carencia';
  if (/^regulament/.test(token)) return 'regulamento';
  if (/^burocr/.test(token)) return 'processo';
  if (/^(?:coli|batid|bateu|bater)/.test(token)) return 'colisao';
  if (/^incendi/.test(token)) return 'incendio';
  if (/^(?:graniz|chuva.*pedra)/.test(token)) return 'granizo';
  if (/^terceir/.test(token)) return 'terceiro';
  if (/^(?:multipl|varios|diversos)/.test(token)) return 'multiplo';
  return token;
}

const STOP_WORD_STEMS = new Set([...STOP_WORDS].map((word) => stemToken(word)));
const GENERIC_EVIDENCE_TOKENS = new Set([
  'ano', 'associacao', 'beneficio', 'cobertura', 'dia', 'empresa', 'mes', 'moove',
  'evento', 'protecao', 'valor', 'veiculo',
]);

function tokenize(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    .map(stemToken)
    .filter((token) => token.length >= 2 && !STOP_WORD_STEMS.has(token))
    .map(canonicalToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function buildTokenBigrams(tokens = []) {
  const bigrams = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] !== tokens[index + 1]) bigrams.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return [...new Set(bigrams)];
}

function tokenTrigrams(token = '') {
  if (token.length < 3) return new Set([token]);
  const grams = new Set();
  for (let index = 0; index <= token.length - 3; index += 1) {
    grams.add(token.slice(index, index + 3));
  }
  return grams;
}

function trigramSimilarity(left = '', right = '') {
  if (!left || !right) return 0;
  const a = tokenTrigrams(left);
  const b = tokenTrigrams(right);
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  return intersection / Math.max(a.size, b.size, 1);
}

function readJsonObject(fileName) {
  const filePath = path.join(__dirname, fileName);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`[Knowledge] Could not load ${fileName}: ${error.message}`);
    return {};
  }
}

function readCompanyProfile() {
  try {
    return fs.readFileSync(path.join(__dirname, 'company-profile.md'), 'utf8').trim();
  } catch (error) {
    console.warn(`[Knowledge] Could not load company profile: ${error.message}`);
    return '';
  }
}

function humanizeKey(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeItem({ id, title, category, content, keywords = [], source, priority = 0 }) {
  const safeContent = String(content || '').trim();
  if (!safeContent) return null;
  return {
    id: String(id || slugify(title)),
    title: String(title || id || '').trim(),
    category: String(category || 'geral').trim(),
    content: safeContent,
    keywords: Array.isArray(keywords) ? keywords.map(String).filter(Boolean) : [],
    source: String(source || 'unknown'),
    priority: Number(priority) || 0,
  };
}

function parseKnowledgeBaseSections() {
  const lines = String(KNOWLEDGE_BASE || '').split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isHeading = /━{3,}/u.test(trimmed);
    if (isHeading) {
      if (current?.content.length) sections.push(current);
      const heading = trimmed.replace(/━/gu, '').trim();
      current = { heading: heading || 'Informacoes da Moove', content: [] };
      continue;
    }
    if (current) current.content.push(trimmed);
  }
  if (current?.content.length) sections.push(current);

  return sections.map((section) => {
    const id = `knowledge-base.${slugify(section.heading)}`;
    return makeItem({
      id,
      title: section.heading,
      category: 'regulamento resumido',
      content: section.content.join('\n'),
      keywords: tokenize(section.heading),
      source: 'knowledge-base.js',
      priority: STATIC_ITEM_PRIORITIES[id] || 0,
    });
  }).filter(Boolean);
}

export function buildStaticKnowledgeCatalog() {
  const items = [];
  const profile = readCompanyProfile();
  if (profile) {
    items.push(makeItem({
      id: 'company-profile.overview',
      title: 'Perfil institucional da Moove',
      category: 'institucional',
      content: 'A Moove é uma associação civil sem fins lucrativos de proteção veicular, baseada em mutualismo e rateio de despesas entre os associados.',
      keywords: [
        'moove', 'associacao', 'mutualismo', 'rateio', 'protecao veicular',
        'confianca', 'regulamento',
      ],
      source: 'company-profile.md',
      priority: 10,
    }));
    items.push(...parseCompanyProfileItems(profile));
  }

  for (const fileName of STATIC_JSON_FILES) {
    const data = readJsonObject(fileName);
    const sourceName = fileName.replace(/\.json$/i, '');
    for (const [key, content] of Object.entries(data)) {
      const id = `${sourceName}.${key}`;
      items.push(makeItem({
        id,
        title: humanizeKey(key),
        category: humanizeKey(sourceName),
        content,
        keywords: [...tokenize(key), ...tokenize(humanizeKey(key))],
        source: fileName,
        priority: STATIC_ITEM_PRIORITIES[id] || 0,
      }));
    }
  }

  items.push(...parseKnowledgeBaseSections());
  return items.filter(Boolean);
}

function faqToKnowledgeItem(item = {}) {
  return makeItem({
    id: `faq.${item.id || slugify(item.title)}`,
    title: item.title || 'FAQ da Moove',
    category: item.category || 'faq',
    content: item.answer,
    keywords: item.keywords || [],
    source: item.source === 'supabase' ? 'faq-supabase' : 'faq-panel',
    priority: 4,
  });
}

export async function buildKnowledgeCatalog({ faqItems = null, includeDynamicFaq = true } = {}) {
  const items = buildStaticKnowledgeCatalog();
  if (!includeDynamicFaq && !Array.isArray(faqItems)) return items;

  try {
    let dynamicItems = faqItems;
    if (!Array.isArray(dynamicItems)) {
      if (Date.now() < dynamicFaqCache.expiresAt) {
        dynamicItems = dynamicFaqCache.items;
      } else {
        dynamicItems = await listFaqItems({ includeInactive: false });
        dynamicFaqCache = {
          expiresAt: Date.now() + DYNAMIC_FAQ_CACHE_MS,
          items: dynamicItems,
        };
      }
    }
    items.push(...dynamicItems.map(faqToKnowledgeItem).filter(Boolean));
  } catch (error) {
    console.warn(`[Knowledge] Dynamic FAQ unavailable: ${error.message}`);
  }
  return items;
}

function buildDocumentFrequency(catalog = []) {
  const frequency = new Map();
  for (const item of catalog) {
    const tokens = new Set(tokenize(`${item.title} ${item.category} ${item.keywords.join(' ')} ${item.content}`));
    for (const token of tokens) frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  return frequency;
}

function scoreKnowledgeItem(item, query, queryTokens, queryBigrams, documentFrequency, catalogSize) {
  const title = normalizeText(item.title);
  const category = normalizeText(item.category);
  const keywords = normalizeText(item.keywords.join(' '));
  const content = normalizeText(item.content);
  const fullText = `${title} ${category} ${keywords} ${content}`;
  const orderedDocumentTokens = tokenize(fullText);
  const documentTokens = new Set(orderedDocumentTokens);
  const metadataTokens = new Set(tokenize(`${title} ${category} ${keywords}`));
  const documentBigrams = new Set(buildTokenBigrams(orderedDocumentTokens));
  let score = 0;
  let matchedTokens = 0;
  let metadataMatches = 0;
  let matchedBigrams = 0;
  let distinctiveExactMatches = 0;
  let exactMatch = false;

  if (query.length >= 5 && fullText.includes(query)) {
    score += 24;
    exactMatch = true;
  }
  for (const token of queryTokens) {
    const frequency = documentFrequency.get(token) || 0;
    const idf = Math.log((catalogSize + 1) / (frequency + 1)) + 1;
    let tokenMatched = false;
    if (documentTokens.has(token)) {
      score += 5 * idf;
      tokenMatched = true;
      if (!/^\d+$/.test(token) && !GENERIC_EVIDENCE_TOKENS.has(token)) {
        distinctiveExactMatches += 1;
      }
    }
    if (metadataTokens.has(token)) {
      score += keywords.includes(token) ? 7 : 5;
      metadataMatches += 1;
    }

    let bestSimilarity = 0;
    for (const documentToken of documentTokens) {
      if (Math.abs(documentToken.length - token.length) > 5) continue;
      bestSimilarity = Math.max(bestSimilarity, trigramSimilarity(token, documentToken));
    }
    if (bestSimilarity >= 0.72) {
      score += bestSimilarity * 3;
      tokenMatched = true;
    }
    if (tokenMatched) matchedTokens += 1;
  }

  for (const bigram of queryBigrams) {
    if (!documentBigrams.has(bigram)) continue;
    score += 8;
    matchedBigrams += 1;
  }

  if (exactMatch || matchedTokens > 0) score += Number(item.priority) || 0;

  return {
    score,
    matchedRatio: queryTokens.length > 0 ? matchedTokens / queryTokens.length : 0,
    metadataRatio: queryTokens.length > 0 ? metadataMatches / queryTokens.length : 0,
    matchedBigramRatio: queryBigrams.length > 0 ? matchedBigrams / queryBigrams.length : 0,
    distinctiveExactMatches,
    hasUnmatchedNumeric: queryTokens.some((token) => /^\d+$/.test(token) && !documentTokens.has(token)),
    hasUnmatchedSpecific: queryTokens.some((token) => (
      !/^\d+$/.test(token)
      && !GENERIC_EVIDENCE_TOKENS.has(token)
      && !documentFrequency.has(token)
    )),
  };
}

function parseCompanyProfileItems(profile = '') {
  const sections = [];
  let current = null;
  for (const rawLine of String(profile || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^\d+\.\s+\*\*(.+?):\*\*\s*(.*)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1].trim(), content: [heading[2].trim()].filter(Boolean) };
      continue;
    }
    if (current && line && !line.startsWith('#')) current.content.push(line.replace(/^[-*]\s+/, ''));
  }
  if (current) sections.push(current);

  return sections.map((section) => {
    const id = `company-profile.${slugify(section.title)}`;
    return makeItem({
      id,
      title: section.title,
      category: 'institucional',
      content: section.content.join(' '),
      keywords: tokenize(section.title),
      source: 'company-profile.md',
      priority: /associa|rateio|mutualismo|regulamento|an[aá]lise|promessa/i.test(section.title) ? 6 : 2,
    });
  }).filter(Boolean);
}

function makeKnowledgePromptSafe(value = '') {
  return String(value || '')
    .replace(/Associa[cç][aã]o,?\s+n[aã]o\s+Seguradora:?/gi, 'Natureza associativa:')
    .replace(/Nunca\s+deve\s+ser\s+tratada\s+como\s+seguradora/gi, 'Deve ser apresentada como associação de proteção veicular')
    .replace(/N[aã]o,?\s+(?:a\s+Moove\s+)?n[aã]o\s+[eé]\s+(?:uma\s+)?seguradora\.?\s*(?:Somos\s+)?/gi, 'A Moove é ')
    .replace(/(?:A\s+Moove\s+)?n[aã]o\s+[eé]\s+(?:uma\s+)?seguradora/gi, 'A Moove é uma associação de proteção veicular')
    .replace(/n[aã]o\s+possui\s+seguro/gi, 'oferece proteção veicular')
    .replace(/e\s+n[aã]o\s+["“]?seguros?["”]?/gi, 'e oferece proteção veicular')
    .replace(/\bseguradoras?\b/gi, 'associação')
    .replace(/\bsegurados?\b/gi, 'associados')
    .replace(/\bseguros?\b/gi, 'proteção veicular')
    .replace(/\bap[oó]lices?\b/gi, 'proposta de adesão')
    .replace(/\bsinistros?\b/gi, 'eventos')
    .replace(/\bpr[eê]mios?\b/gi, 'mensalidade')
    .replace(/\s+/g, ' ')
    .trim();
}

export function retrieveKnowledge(query, catalog = [], {
  maxItems = 2,
  maxChars = 4200,
  minimumScore = 2.5,
} = {}) {
  let normalizedQuery = normalizeText(query);
  if (/^(?:me )?(?:explica|explique|fala|fale)(?: ai)? como funciona(?: isso)?$/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} moove associacao mutualismo rateio protecao veicular`;
  }
  if (/\bregulamento\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} regulamento oficial associacao analise tecnica`;
  }
  if (/\badesao\b|\b(?:aderir|associar|contratar)\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} vistoria proposta ativacao`;
  }
  if (/\bmoove\b/.test(normalizedQuery)
    && /\b(?:explica|explicar|resume|resumo|rapidinho|fala|falar)\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} associacao mutualismo rateio`;
  }
  if (/\b(?:escolher|escolheria|diferencial|vantagem|vale a pena)\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} associacao mutualismo cobertura assistencia beneficios`;
  }
  if (/\b(?:parabrisa|vidro|farol|farois|lanterna|retrovisor)\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} beneficio cobertura vidros participacao acionamento`;
  }
  if (/\b(?:guincho|reboque)\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} assistencia 24h reboque raio distancia`;
  }
  if (/\b(?:uber|taxi|aplicativo)\b/.test(normalizedQuery)
    && /\b(?:carro|veiculo|moto|roda|trabalha|uso)\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} veiculos aceitos uso aplicativo profissional`;
  }
  if (/\b(?:bater|bati|batida|colisao|capotamento|roubo|furto|incendio|fogo|granizo|parabrisa|vidro|farol|lanterna|retrovisor)\b/.test(normalizedQuery)
    && !/\b(?:cobre|cobertura|inclui|entra)\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} cobertura`;
  }
  if (/\b(?:paga|pagam|receb|ressarc|indeniz)\w*\b/.test(normalizedQuery)
    && /\b(?:acontec|evento|ocorr|colisao|roubo|furto|incendio)\w*\b/.test(normalizedQuery)) {
    normalizedQuery = `${normalizedQuery} indenizacao regulamento analise`;
  }
  const orderedQueryTokens = tokenize(normalizedQuery);
  const queryTokens = [...new Set(orderedQueryTokens)];
  const queryBigrams = buildTokenBigrams(orderedQueryTokens);
  const documentFrequency = buildDocumentFrequency(catalog);
  const ranked = catalog
    .map((item) => ({ item, ...scoreKnowledgeItem(
      item,
      normalizedQuery,
      queryTokens,
      queryBigrams,
      documentFrequency,
      catalog.length,
    ) }))
    .sort((left, right) => right.score - left.score);

  const selected = [];
  const selectedIds = new Set();
  let usedChars = 0;

  const addItem = (entry) => {
    if (!entry?.item || selectedIds.has(entry.item.id)) return;
    const serializedLength = entry.item.content.length + entry.item.title.length + 80;
    if (selected.length > 0 && usedChars + serializedLength > maxChars) return;
    selected.push(entry);
    selectedIds.add(entry.item.id);
    usedChars += serializedLength;
  };

  for (const entry of ranked) {
    if (selected.length >= maxItems) break;
    if (entry.score < minimumScore) continue;
    const supportsSpecificQuestion = !entry.hasUnmatchedSpecific || entry.distinctiveExactMatches >= 1;
    const hasEnoughTopicalEvidence = supportsSpecificQuestion && (entry.matchedRatio >= 0.6
      || (entry.matchedRatio >= 0.5
        && (entry.metadataRatio >= 0.34 || entry.matchedBigramRatio > 0))
      || (queryTokens.length <= 2
        && entry.matchedRatio >= 0.5
        && (entry.distinctiveExactMatches >= 1
          || (queryTokens.length === 1 && !entry.hasUnmatchedSpecific)))
      || (entry.distinctiveExactMatches >= 1
        && entry.matchedRatio >= 0.2
        && (!entry.hasUnmatchedNumeric || entry.distinctiveExactMatches >= 2)));
    if (!hasEnoughTopicalEvidence) continue;
    addItem(entry);
  }

  const bestTopical = ranked[0] || { score: 0, matchedRatio: 0 };
  const bestTopicalScore = bestTopical.score;
  const bestSupportsSpecificQuestion = !bestTopical.hasUnmatchedSpecific
    || bestTopical.distinctiveExactMatches >= 1;
  const hasStrongCoverage = bestSupportsSpecificQuestion && (bestTopical.matchedRatio >= 0.75
    || (bestTopical.matchedRatio >= 0.6
      && (bestTopical.metadataRatio >= 0.34 || bestTopical.matchedBigramRatio > 0))
    || bestTopical.distinctiveExactMatches >= 2);
  const hasUsableCoverage = bestSupportsSpecificQuestion && (bestTopical.matchedRatio >= 0.6
    || (bestTopical.matchedRatio >= 0.5
      && (bestTopical.metadataRatio >= 0.34 || bestTopical.matchedBigramRatio > 0))
    || (queryTokens.length <= 2
      && bestTopical.matchedRatio >= 0.5
      && (bestTopical.distinctiveExactMatches >= 1
        || (queryTokens.length === 1 && !bestTopical.hasUnmatchedSpecific)))
    || (bestTopical.distinctiveExactMatches >= 1
      && bestTopical.matchedRatio >= 0.2
      && (!bestTopical.hasUnmatchedNumeric || bestTopical.distinctiveExactMatches >= 2)));
  const items = selected.map(({ item, score }) => ({ ...item, score: Number(score.toFixed(2)) }));
  const text = items.map((item) => [
    `[FONTE ${item.id}]`,
    `Titulo: ${item.title}`,
    `Conteudo: ${makeKnowledgePromptSafe(item.content)}`,
  ].join('\n')).join('\n\n');

  return {
    query: String(query || ''),
    items,
    text,
    ids: items.map((item) => item.id),
    confidence: bestTopicalScore >= 10 && hasStrongCoverage
      ? 'high'
      : bestTopicalScore >= minimumScore && hasUsableCoverage
        ? 'medium'
        : 'low',
    topScore: Number(bestTopicalScore.toFixed(2)),
    matchedRatio: Number(bestTopical.matchedRatio.toFixed(2)),
    metadataRatio: Number((bestTopical.metadataRatio || 0).toFixed(2)),
    matchedBigramRatio: Number((bestTopical.matchedBigramRatio || 0).toFixed(2)),
  };
}

export async function getKnowledgeForMessage(query, options = {}) {
  const catalog = await buildKnowledgeCatalog(options);
  const pdfChunks = Array.isArray(options.pdfChunks)
    ? options.pdfChunks
    : getPDFKnowledgeChunks();
  catalog.push(...pdfChunks.map((chunk) => makeItem({
    id: `pdf.${slugify(chunk.filename)}.${Number(chunk.index) || 1}`,
    title: `${chunk.filename} - trecho ${Number(chunk.index) || 1}`,
    category: 'documentos oficiais',
    content: chunk.text,
    keywords: tokenize(chunk.filename),
    source: 'pdf-cache',
    priority: 3,
  })).filter(Boolean));
  return retrieveKnowledge(query, catalog, options);
}
