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
  'ola', 'entender', 'conhecer', 'explicar',
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
  if (/^(?:carr|automov|veicul)/.test(token)) return 'veiculo';
  if (/^(?:guinch|reboq)/.test(token)) return 'reboque';
  if (/^(?:parabris|vidr)/.test(token)) return 'vidro';
  if (/^cobr/.test(token)) return 'cobertura';
  if (/^(?:aceit|peg)/.test(token)) return 'aceita';
  if (/^quebr/.test(token)) return 'quebra';
  if (/^(?:consert|repar|manuten)/.test(token)) return 'manutencao';
  return token;
}

function tokenize(value = '') {
  return normalizeText(value)
    .split(' ')
    .map(stemToken)
    .map(canonicalToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
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

  return sections.map((section) => makeItem({
    id: `knowledge-base.${slugify(section.heading)}`,
    title: section.heading,
    category: 'regulamento resumido',
    content: section.content.join('\n'),
    keywords: tokenize(section.heading),
    source: 'knowledge-base.js',
  })).filter(Boolean);
}

export function buildStaticKnowledgeCatalog() {
  const items = [];
  const profile = readCompanyProfile();
  if (profile) {
    items.push(makeItem({
      id: 'company-profile.overview',
      title: 'Perfil institucional da Moove',
      category: 'institucional',
      content: 'A Moove é uma associação civil sem fins lucrativos de proteção veicular, baseada em mutualismo e rateio de despesas entre os associados. Não é uma seguradora.',
      keywords: ['moove', 'associacao', 'mutualismo', 'rateio', 'protecao veicular'],
      source: 'company-profile.md',
      priority: 10,
    }));
    items.push(makeItem({
      id: 'company-profile.agent-details',
      title: 'Detalhes institucionais e orientações da Moove',
      category: 'institucional',
      content: profile,
      keywords: ['beneficios', 'vistoria', 'adesao', 'regulamento', 'mutualismo'],
      source: 'company-profile.md',
    }));
  }

  for (const fileName of STATIC_JSON_FILES) {
    const data = readJsonObject(fileName);
    const sourceName = fileName.replace(/\.json$/i, '');
    for (const [key, content] of Object.entries(data)) {
      items.push(makeItem({
        id: `${sourceName}.${key}`,
        title: humanizeKey(key),
        category: humanizeKey(sourceName),
        content,
        keywords: [...tokenize(key), ...tokenize(humanizeKey(key))],
        source: fileName,
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

function scoreKnowledgeItem(item, query, queryTokens, documentFrequency, catalogSize) {
  const title = normalizeText(item.title);
  const keywords = normalizeText(item.keywords.join(' '));
  const content = normalizeText(item.content);
  const fullText = `${title} ${keywords} ${content}`;
  const documentTokens = new Set(tokenize(fullText));
  let score = 0;
  let matchedTokens = 0;
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
    }
    if (title.includes(token)) score += 5;
    if (keywords.includes(token)) score += 7;

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

  if (exactMatch || matchedTokens > 0) score += Number(item.priority) || 0;

  return {
    score,
    matchedRatio: queryTokens.length > 0 ? matchedTokens / queryTokens.length : 0,
  };
}

function isBaselineItem(item = {}) {
  return item.id === 'company-profile.overview';
}

export function retrieveKnowledge(query, catalog = [], {
  maxItems = 6,
  maxChars = 5500,
  minimumScore = 2.5,
} = {}) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = [...new Set(tokenize(normalizedQuery))];
  const documentFrequency = buildDocumentFrequency(catalog);
  const ranked = catalog
    .map((item) => ({ item, ...scoreKnowledgeItem(
      item,
      normalizedQuery,
      queryTokens,
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

  for (const entry of ranked.filter(({ item }) => isBaselineItem(item)).slice(0, 2)) addItem(entry);
  for (const entry of ranked) {
    if (selected.length >= maxItems) break;
    if (entry.score < minimumScore && !isBaselineItem(entry.item)) continue;
    addItem(entry);
  }

  const bestTopical = ranked.find(({ item }) => !isBaselineItem(item)) || { score: 0, matchedRatio: 0 };
  const bestTopicalScore = bestTopical.score;
  const items = selected.map(({ item, score }) => ({ ...item, score: Number(score.toFixed(2)) }));
  const text = items.map((item) => [
    `[FONTE ${item.id}]`,
    `Titulo: ${item.title}`,
    `Conteudo: ${item.content}`,
  ].join('\n')).join('\n\n');

  return {
    query: String(query || ''),
    items,
    text,
    ids: items.map((item) => item.id),
    confidence: bestTopicalScore >= 10 && bestTopical.matchedRatio >= 0.5
      ? 'high'
      : bestTopicalScore >= minimumScore
        && (bestTopical.matchedRatio >= 0.34 || queryTokens.length <= 2)
        ? 'medium'
        : 'low',
    topScore: Number(bestTopicalScore.toFixed(2)),
    matchedRatio: Number(bestTopical.matchedRatio.toFixed(2)),
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
