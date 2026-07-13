import {
  clamp,
  containsWholeTerm,
  daysSince,
  hashText,
  jaccardSimilarity,
  normalizeText,
  summarizeCopyFallback,
  tokenizeText,
  truncateText,
  uniqueStrings,
} from './utils.js';
import { analyzeCreative } from './creative-analyzer.js';
import { analyzeLandingUrl } from './landing-auditor.js';

const BRAZIL_LOCATIONS = [
  { label: 'Rio de Janeiro', terms: ['rio de janeiro', 'rj'] },
  { label: 'Sao Goncalo', terms: ['sao goncalo'] },
  { label: 'Niteroi', terms: ['niteroi'] },
  { label: 'Baixada Fluminense', terms: ['baixada fluminense'] },
  { label: 'Sao Paulo', terms: ['sao paulo', 'sp'] },
  { label: 'Belo Horizonte', terms: ['belo horizonte', 'bh'] },
  { label: 'Minas Gerais', terms: ['minas gerais', 'mg'] },
  { label: 'Curitiba', terms: ['curitiba'] },
  { label: 'Parana', terms: ['parana', 'pr'] },
  { label: 'Fortaleza', terms: ['fortaleza'] },
  { label: 'Ceara', terms: ['ceara', 'ce'] },
  { label: 'Goiania', terms: ['goiania'] },
  { label: 'Goias', terms: ['goias', 'go'] },
  { label: 'Recife', terms: ['recife'] },
  { label: 'Pernambuco', terms: ['pernambuco', 'pe'] },
  { label: 'Porto Alegre', terms: ['porto alegre'] },
  { label: 'Rio Grande do Sul', terms: ['rio grande do sul', 'rs'] },
  { label: 'Brasilia', terms: ['brasilia', 'df'] },
  { label: 'Salvador', terms: ['salvador'] },
  { label: 'Bahia', terms: ['bahia', 'ba'] },
  { label: 'Vitoria', terms: ['vitoria'] },
  { label: 'Espirito Santo', terms: ['espirito santo', 'es'] },
];

function normalizeAdvertiser(value) {
  return normalizeText(value || 'anunciante');
}

function adKey(ad = {}) {
  return String(ad.libraryId || ad.id || hashText([
    ad.platform,
    normalizeAdvertiser(ad.advertiserName),
    normalizeText(ad.adText),
    ad.landingDomain,
  ].join('|')));
}

function mergeAds(previous, current) {
  const longer = String(current.adText || '').length > String(previous.adText || '').length ? current : previous;
  const other = longer === current ? previous : current;
  return {
    ...other,
    ...longer,
    id: adKey(longer),
    searchTerms: uniqueStrings([
      ...(previous.searchTerms || []),
      previous.searchTerm,
      ...(current.searchTerms || []),
      current.searchTerm,
    ].filter(Boolean), 20),
    sourcePositions: uniqueStrings([
      ...(previous.sourcePositions || []),
      previous.sourceOrder,
      ...(current.sourcePositions || []),
      current.sourceOrder,
    ].filter((value) => value !== undefined && value !== null).map(String), 20).map(Number),
  };
}

export function dedupeAds(ads = []) {
  const exact = new Map();
  for (const rawAd of ads) {
    if (!rawAd) continue;
    const ad = {
      ...rawAd,
      id: adKey(rawAd),
      searchTerms: uniqueStrings([...(rawAd.searchTerms || []), rawAd.searchTerm].filter(Boolean), 20),
    };
    const key = adKey(ad);
    exact.set(key, exact.has(key) ? mergeAds(exact.get(key), ad) : ad);
  }

  const output = [];
  for (const ad of exact.values()) {
    const advertiser = normalizeAdvertiser(ad.advertiserName);
    const nearIndex = output.findIndex((candidate) => {
      if (normalizeAdvertiser(candidate.advertiserName) !== advertiser) return false;
      if (candidate.landingDomain && ad.landingDomain && candidate.landingDomain !== ad.landingDomain) return false;
      return jaccardSimilarity(candidate.adText, ad.adText) >= 0.84;
    });
    if (nearIndex >= 0) output[nearIndex] = mergeAds(output[nearIndex], ad);
    else output.push(ad);
  }
  return output;
}

function termMatchScore(query, searchTerms, semanticTerms, fullText) {
  const queryTokens = uniqueStrings(tokenizeText(query).filter((token) => token.length >= 3), 16);
  const semanticTokens = uniqueStrings(semanticTerms.flatMap((term) => tokenizeText(term)).filter((token) => token.length >= 3), 32);
  const normalized = normalizeText(fullText);
  const queryMatches = queryTokens.filter((token) => containsWholeTerm(normalized, token));
  const semanticMatches = semanticTokens.filter((token) => containsWholeTerm(normalized, token));
  const matchedTerms = uniqueStrings(searchTerms.filter((term) => containsWholeTerm(normalized, term)), 12);
  const queryCoverage = queryTokens.length ? queryMatches.length / queryTokens.length : 0;
  const semanticCoverage = semanticTokens.length ? semanticMatches.length / semanticTokens.length : 0;
  const phraseBoost = containsWholeTerm(normalized, query) ? 20 : matchedTerms.length ? 10 : 0;
  const score = clamp(Math.round(queryCoverage * 62 + semanticCoverage * 18 + phraseBoost), 0, 100);
  return { score, matchedTerms, queryMatches, semanticMatches };
}

function stabilityScore(deliveryStart) {
  const activeDays = daysSince(deliveryStart);
  if (activeDays === null) return { score: 32, activeDays: null, label: 'data desconhecida' };
  if (activeDays >= 180) return { score: 100, activeDays, label: 'mais de 6 meses ativo' };
  if (activeDays >= 90) return { score: 88, activeDays, label: 'mais de 3 meses ativo' };
  if (activeDays >= 45) return { score: 76, activeDays, label: 'mais de 45 dias ativo' };
  if (activeDays >= 21) return { score: 62, activeDays, label: 'mais de 3 semanas ativo' };
  if (activeDays >= 7) return { score: 46, activeDays, label: 'mais de 1 semana ativo' };
  return { score: 28, activeDays, label: 'anuncio recente' };
}

function inferRegion(ad, requestedRegion = '') {
  const fullText = [ad.adText, ad.advertiserName, ad.landingDomain].join(' ');
  const requestedTokens = tokenizeText(requestedRegion).filter((token) => token.length >= 3);
  if (requestedTokens.length) {
    const hits = requestedTokens.filter((token) => containsWholeTerm(fullText, token));
    if (hits.length === requestedTokens.length) {
      return {
        regionLabel: requestedRegion,
        regionConfidence: 'alta',
        regionSource: 'Todos os termos regionais aparecem na copy, anunciante ou dominio.',
        regionalFit: 100,
        matchedRegionTerms: hits,
      };
    }
    if (hits.length >= Math.max(1, Math.ceil(requestedTokens.length / 2))) {
      return {
        regionLabel: requestedRegion,
        regionConfidence: 'media',
        regionSource: 'Parte dos termos regionais aparece em sinais publicos do anuncio.',
        regionalFit: 62,
        matchedRegionTerms: hits,
      };
    }
    return {
      regionLabel: 'Nao confirmado',
      regionConfidence: 'baixa',
      regionSource: 'A segmentacao real nao e publica e a copy nao confirmou a regiao informada.',
      regionalFit: 18,
      matchedRegionTerms: [],
    };
  }

  const location = BRAZIL_LOCATIONS.find((item) => item.terms.some((term) => containsWholeTerm(fullText, term)));
  return location
    ? {
        regionLabel: location.label,
        regionConfidence: 'media',
        regionSource: 'Localidade inferida por mencao inteira na copy, anunciante ou dominio.',
        regionalFit: null,
        matchedRegionTerms: location.terms.filter((term) => containsWholeTerm(fullText, term)),
      }
    : {
        regionLabel: 'Nao identificado',
        regionConfidence: 'baixa',
        regionSource: 'Nenhum sinal regional confiavel foi encontrado. Isso nao revela a segmentacao real.',
        regionalFit: null,
        matchedRegionTerms: [],
      };
}

function creativeScore(ad, analysis) {
  let score = 25;
  if (Number(ad.creativeCount || 1) > 1) score += Math.min(30, Number(ad.creativeCount) * 6);
  if (ad.multipleVersions) score += 14;
  if (ad.mediaPreviewUrl) score += 10;
  if (ad.mediaType === 'video') score += 8;
  if (analysis.hook) score += 5;
  if (analysis.ctas?.length) score += 5;
  return clamp(score, 0, 100);
}

function commercialScore(analysis = {}) {
  return clamp(
    18
      + Math.min(24, (analysis.ctas?.length || 0) * 12)
      + Math.min(18, (analysis.offers?.length || 0) * 9)
      + Math.min(18, (analysis.proof?.length || 0) * 9)
      + Math.min(12, (analysis.pains?.length || 0) * 6)
      + (analysis.hook ? 10 : 0),
    0,
    100,
  );
}

function parsingConfidence(ad, relevance, regionInfo) {
  const fields = [
    !!ad.libraryId,
    !!ad.advertiserName && normalizeAdvertiser(ad.advertiserName) !== 'anunciante nao identificado',
    !!ad.adText,
    !!ad.deliveryStart,
    !!ad.adUrl,
    !!ad.mediaPreviewUrl,
  ];
  const fieldScore = fields.filter(Boolean).length / fields.length * 70;
  const relevancePart = Math.min(20, relevance * 0.2);
  const regionPart = regionInfo.regionConfidence === 'alta' ? 10 : regionInfo.regionConfidence === 'media' ? 6 : 2;
  const score = clamp(Math.round(fieldScore + relevancePart + regionPart), 0, 100);
  return {
    score,
    label: score >= 78 ? 'alta' : score >= 52 ? 'media' : 'baixa',
    parsedFields: fields.filter(Boolean).length,
    totalFields: fields.length,
  };
}

function weightedStrength(parts, hasRegion) {
  const weights = {
    relevance: hasRegion ? 38 : 42,
    stability: 15,
    creative: 15,
    advertiser: 10,
    commercial: hasRegion ? 12 : 18,
    region: hasRegion ? 10 : 0,
  };
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 1;
  const total = Object.entries(weights).reduce((sum, [key, weight]) => sum + (Number(parts[key] || 0) * weight), 0);
  return { score: clamp(Math.round(total / totalWeight), 0, 100), weights };
}

function strengthReasons(parts, context) {
  const reasons = [];
  if (parts.relevance >= 72) reasons.push('alta aderencia ao nicho');
  if (parts.stability >= 76) reasons.push('tempo ativo consistente');
  if (parts.creative >= 68) reasons.push('variedade de criativos');
  if (parts.advertiser >= 70) reasons.push('anunciante recorrente na coleta');
  if (parts.commercial >= 70) reasons.push('estrutura comercial clara');
  if (context.hasRegion && parts.region >= 62) reasons.push('sinal regional compativel');
  return reasons.slice(0, 4);
}

export function sortRankedAds(results = [], sort = 'strength') {
  const safeSort = sort === 'popular' ? 'strength' : sort;
  const list = [...results];
  const dateValue = (value, fallback) => {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  if (safeSort === 'recent') {
    return list.sort((left, right) => dateValue(right.deliveryStart, 0) - dateValue(left.deliveryStart, 0) || right.relevanceScore - left.relevanceScore);
  }
  if (safeSort === 'oldest') {
    return list.sort((left, right) => dateValue(left.deliveryStart, Number.MAX_SAFE_INTEGER) - dateValue(right.deliveryStart, Number.MAX_SAFE_INTEGER));
  }
  if (safeSort === 'relevant') {
    return list.sort((left, right) => right.relevanceScore - left.relevanceScore || right.strengthScore - left.strengthScore);
  }
  if (safeSort === 'advertiser') {
    return list.sort((left, right) => String(left.advertiserName).localeCompare(String(right.advertiserName)) || right.strengthScore - left.strengthScore);
  }
  return list.sort((left, right) => right.strengthScore - left.strengthScore || right.relevanceScore - left.relevanceScore);
}

export function rankAds(rawAds = [], {
  query,
  region = '',
  searchTerms = [],
  semanticTerms = [],
  sort = 'strength',
  minimumRelevance = 0,
} = {}) {
  const deduped = dedupeAds(rawAds);
  const advertiserCounts = new Map();
  const advertiserCoverage = new Map();

  deduped.forEach((ad) => {
    const key = normalizeAdvertiser(ad.advertiserName);
    advertiserCounts.set(key, (advertiserCounts.get(key) || 0) + 1);
    const coverage = advertiserCoverage.get(key) || new Set();
    (ad.searchTerms || []).forEach((term) => coverage.add(normalizeText(term)));
    advertiserCoverage.set(key, coverage);
  });
  const maxAdCount = Math.max(1, ...advertiserCounts.values());
  const maxCoverage = Math.max(1, ...Array.from(advertiserCoverage.values()).map((set) => set.size));

  const ranked = deduped.map((ad) => {
    const fullText = [ad.advertiserName, ad.adText, ad.landingDomain].join(' ');
    const termInfo = termMatchScore(query, searchTerms, semanticTerms, fullText);
    const analysis = analyzeCreative(ad, { query });
    const regionInfo = inferRegion(ad, region);
    const stability = stabilityScore(ad.deliveryStart);
    const advertiserKey = normalizeAdvertiser(ad.advertiserName);
    const adCount = advertiserCounts.get(advertiserKey) || 1;
    const queryCoverage = advertiserCoverage.get(advertiserKey)?.size || 1;
    const advertiser = clamp(Math.round(((adCount / maxAdCount) * 55) + ((queryCoverage / maxCoverage) * 45)), 12, 100);
    const creative = creativeScore(ad, analysis);
    const commercial = commercialScore(analysis);
    const parts = {
      relevance: termInfo.score,
      stability: stability.score,
      creative,
      advertiser,
      commercial,
      region: regionInfo.regionalFit,
    };
    const strength = weightedStrength(parts, !!region);
    const reasons = strengthReasons(parts, { hasRegion: !!region });
    const confidence = parsingConfidence(ad, termInfo.score, regionInfo);
    const landing = analyzeLandingUrl(ad.landingUrl);

    return {
      ...ad,
      id: adKey(ad),
      copySummary: ad.copySummary || summarizeCopyFallback(ad.adText),
      copyToClipboardText: ad.copyToClipboardText || ad.adText,
      searchTerms: uniqueStrings(ad.searchTerms || [], 20),
      matchedTerms: uniqueStrings([...termInfo.matchedTerms, ...(ad.searchTerms || [])], 16),
      relevanceScore: termInfo.score,
      strengthScore: strength.score,
      popularityScore: strength.score,
      strengthLabel: strength.score >= 78 ? 'forte' : strength.score >= 55 ? 'promissor' : 'exploratorio',
      scoreBreakdown: {
        relevance: parts.relevance,
        stability: parts.stability,
        creative: parts.creative,
        advertiser: parts.advertiser,
        commercial: parts.commercial,
        region: Number.isFinite(parts.region) ? parts.region : null,
        weights: strength.weights,
      },
      strengthReasons: reasons,
      popularityReasons: reasons,
      strengthExplanation: reasons.length
        ? `Forca estimada por ${reasons.join(', ')}.`
        : 'Forca estimada com sinais publicos limitados; valide o criativo antes de usar como referencia.',
      popularityExplanation: 'Este score e uma estimativa comparativa, nao um dado de impressoes ou vendas da Meta.',
      advertiserStats: { adCount, queryCoverage },
      regionLabel: regionInfo.regionLabel,
      regionConfidence: regionInfo.regionConfidence,
      regionSource: regionInfo.regionSource,
      matchedRegionTerms: regionInfo.matchedRegionTerms,
      deliveryAgeDays: stability.activeDays,
      stabilityLabel: stability.label,
      analysis,
      compliance: analysis.compliance,
      landing,
      confidence,
      matchReason: termInfo.matchedTerms.length
        ? `Encontrado por ${termInfo.matchedTerms.slice(0, 4).join(', ')}.`
        : `Afinidade textual estimada com ${truncateText(query, 80)}.`,
      capturedAt: ad.capturedAt || new Date().toISOString(),
    };
  });

  return sortRankedAds(ranked.filter((ad) => ad.relevanceScore >= Math.max(0, Number(minimumRelevance) || 0)), sort);
}
