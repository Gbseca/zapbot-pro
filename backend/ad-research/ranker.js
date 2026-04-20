import {
  clamp,
  daysSince,
  hashText,
  normalizeText,
  roundNumber,
  summarizeCopyFallback,
  tokenizeText,
  truncateText,
} from './utils.js';

const CTA_HINTS = [
  'clique',
  'saiba mais',
  'whatsapp',
  'fale agora',
  'cadastre-se',
  'solicite',
  'simule',
  'cotacao',
  'orcamento',
  'ligue',
  'garanta',
  'aproveite',
  'desconto',
  'promocao',
  'sem consulta',
  'sem juros',
];

const BRAZIL_REGION_HINTS = [
  'rio de janeiro',
  'sao goncalo',
  'niteroi',
  'baixada',
  'sao paulo',
  'belo horizonte',
  'curitiba',
  'fortaleza',
  'goiania',
  'recife',
  'porto alegre',
  'brasilia',
  'rj',
  'sp',
  'mg',
  'pr',
  'pe',
  'ba',
  'rs',
  'es',
];

function normalizeAdvertiser(value) {
  return normalizeText(value || 'anunciante');
}

function createFallbackId(ad) {
  return hashText(`${ad.platform}|${ad.advertiserName}|${ad.adText}|${ad.landingDomain}`);
}

function dedupeAds(ads = []) {
  const deduped = new Map();

  for (const ad of ads) {
    const key = ad.libraryId || ad.id || createFallbackId(ad);
    const previous = deduped.get(key);
    if (!previous) {
      deduped.set(key, { ...ad, id: key });
      continue;
    }

    const previousLength = String(previous.adText || '').length;
    const currentLength = String(ad.adText || '').length;
    if (currentLength > previousLength) {
      deduped.set(key, { ...previous, ...ad, id: key });
    }
  }

  return Array.from(deduped.values());
}

function similarityScore(searchTokens, semanticTokens, adText) {
  const haystack = normalizeText(adText);
  const matches = searchTokens.filter((token) => haystack.includes(token));
  const semanticMatches = semanticTokens.filter((token) => haystack.includes(token));
  const tokenBase = searchTokens.length ? matches.length / searchTokens.length : 0;
  const semanticBase = semanticTokens.length ? semanticMatches.length / semanticTokens.length : 0;
  const phraseBoost = matches.length >= 2 ? 16 : matches.length >= 1 ? 8 : 0;
  return clamp(Math.round((tokenBase * 70) + (semanticBase * 30) + phraseBoost), 0, 100);
}

function commercialStrengthScore(adText) {
  const normalized = normalizeText(adText);
  const hintMatches = CTA_HINTS.filter((hint) => normalized.includes(hint)).length;
  const urgencySignals = (normalized.match(/!|agora|hoje|ultimas|últimas|economize|gratis|gratis|sem custo/gi) || []).length;
  const questions = (adText.match(/\?/g) || []).length;
  return clamp(Math.round((hintMatches * 11) + (urgencySignals * 5) + (questions * 4)), 10, 100);
}

function inferRegion(ad, requestedRegion = '') {
  const text = normalizeText([
    ad.adText,
    ad.advertiserName,
    ad.landingDomain,
  ].join(' '));

  if (requestedRegion) {
    const regionTokens = tokenizeText(requestedRegion).filter((token) => token.length >= 2);
    const hits = regionTokens.filter((token) => text.includes(token));

    if (regionTokens.length && hits.length === regionTokens.length) {
      return {
        regionLabel: requestedRegion,
        regionConfidence: 'alta',
        regionSource: 'Menção direta na copy ou destino.',
        regionalFit: 100,
      };
    }

    if (hits.length >= Math.max(1, Math.ceil(regionTokens.length / 2))) {
      return {
        regionLabel: requestedRegion,
        regionConfidence: 'media',
        regionSource: 'Sinais parciais de localidade encontrados.',
        regionalFit: 68,
      };
    }

    return {
      regionLabel: 'Nao confirmado',
      regionConfidence: 'baixa',
      regionSource: 'Sem confirmacao publica suficiente na Meta.',
      regionalFit: 18,
    };
  }

  const detected = BRAZIL_REGION_HINTS.find((hint) => text.includes(hint));
  if (detected) {
    return {
      regionLabel: detected.toUpperCase() === detected ? detected : detected.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      regionConfidence: 'media',
      regionSource: 'Localidade inferida pela copy ou dominio.',
      regionalFit: null,
    };
  }

  return {
    regionLabel: 'Nao identificado',
    regionConfidence: 'baixa',
    regionSource: 'Nenhum sinal regional forte encontrado.',
    regionalFit: null,
  };
}

function buildMatchReason(ad, query, relevantTerms = []) {
  const matches = relevantTerms.filter((term) => normalizeText(ad.adText).includes(normalizeText(term)));
  if (matches.length) {
    return `Apareceu porque conversa com "${matches.slice(0, 3).join('", "')}".`;
  }
  return `Apareceu por afinidade com o nicho pesquisado: ${truncateText(query, 80)}.`;
}

function buildPopularityReasons(scores, requestedRegion) {
  const reasons = [];

  if (scores.relevance >= 72) reasons.push('copy muito alinhada ao nicho');
  if (scores.advertiser >= 65) reasons.push('anunciante apareceu forte em varias buscas');
  if (scores.creative >= 60) reasons.push('mais de um criativo ou variacao ativa');
  if (scores.stability >= 55) reasons.push('indicio de anuncio rodando por mais tempo');
  if (requestedRegion && scores.region >= 60) reasons.push('forte aderencia regional');
  if (scores.commercial >= 65) reasons.push('estrutura comercial clara e CTA forte');

  return reasons.slice(0, 3);
}

function computePopularityScore(scores, requestedRegion) {
  const weightedParts = [
    { value: scores.relevance, weight: 30 },
    { value: scores.advertiser, weight: 20 },
    { value: scores.creative, weight: 20 },
    { value: scores.stability, weight: 15 },
    { value: requestedRegion ? scores.region : null, weight: 10 },
    { value: scores.commercial, weight: 5 },
  ].filter((part) => Number.isFinite(part.value));

  const totalWeight = weightedParts.reduce((sum, part) => sum + part.weight, 0) || 1;
  const totalScore = weightedParts.reduce((sum, part) => sum + (part.value * part.weight), 0);
  return clamp(Math.round(totalScore / totalWeight), 0, 100);
}

export function sortRankedAds(results = [], sort = 'popular') {
  const list = [...results];

  if (sort === 'recent') {
    return list.sort((left, right) => {
      const leftDate = Date.parse(left.deliveryStart || 0);
      const rightDate = Date.parse(right.deliveryStart || 0);
      return rightDate - leftDate || right.relevanceScore - left.relevanceScore;
    });
  }

  if (sort === 'relevant') {
    return list.sort((left, right) => (
      right.relevanceScore - left.relevanceScore
      || right.popularityScore - left.popularityScore
      || right.metaImpressionHint - left.metaImpressionHint
    ));
  }

  return list.sort((left, right) => (
    right.popularityScore - left.popularityScore
    || right.metaImpressionHint - left.metaImpressionHint
    || right.relevanceScore - left.relevanceScore
  ));
}

export function rankAds(rawAds = [], { query, region = '', searchTerms = [], semanticTerms = [], sort = 'popular' }) {
  const dedupedAds = dedupeAds(rawAds);
  const advertisers = new Map();
  const creativeFingerprints = new Map();

  dedupedAds.forEach((ad) => {
    const advertiserKey = normalizeAdvertiser(ad.advertiserName);
    advertisers.set(advertiserKey, (advertisers.get(advertiserKey) || 0) + 1);

    const fingerprint = hashText(`${advertiserKey}|${normalizeText(ad.adText).split(' ').slice(0, 18).join(' ')}`);
    creativeFingerprints.set(fingerprint, (creativeFingerprints.get(fingerprint) || 0) + 1);
  });

  const maxAdvertiserRecurrence = Math.max(1, ...advertisers.values());
  const maxCreativeRecurrence = Math.max(1, ...creativeFingerprints.values());
  const maxActiveDays = Math.max(14, ...dedupedAds.map((ad) => daysSince(ad.deliveryStart) || 0));
  const maxSourceOrder = Math.max(1, dedupedAds.length);
  const flattenedTerms = [...searchTerms, ...semanticTerms];

  const ranked = dedupedAds.map((ad, index) => {
    const advertiserKey = normalizeAdvertiser(ad.advertiserName);
    const fingerprint = hashText(`${advertiserKey}|${normalizeText(ad.adText).split(' ').slice(0, 18).join(' ')}`);
    const fullText = [ad.advertiserName, ad.adText, ad.landingDomain].join(' ');
    const relevance = similarityScore(
      searchTerms.map((term) => normalizeText(term)),
      semanticTerms.map((term) => normalizeText(term)),
      fullText,
    );

    const advertiser = clamp(Math.round((advertisers.get(advertiserKey) || 1) / maxAdvertiserRecurrence * 100), 18, 100);
    const explicitCreativeSignal = Math.min(4, Number(ad.creativeCount || 1));
    const recurringCreativeSignal = creativeFingerprints.get(fingerprint) || 1;
    const creative = clamp(Math.round((((explicitCreativeSignal + recurringCreativeSignal) / (maxCreativeRecurrence + 4)) * 100)), 20, 100);

    const activeDays = daysSince(ad.deliveryStart);
    const stability = activeDays === null ? 38 : clamp(Math.round((activeDays / maxActiveDays) * 100), 18, 100);
    const regionInfo = inferRegion(ad, region);
    const commercial = commercialStrengthScore(ad.adText);
    const metaImpressionHint = clamp(100 - Math.round((index / maxSourceOrder) * 100), 10, 100);

    const scoreMap = {
      relevance,
      advertiser,
      creative,
      stability,
      region: regionInfo.regionalFit,
      commercial,
    };

    const popularityReasons = buildPopularityReasons(scoreMap, region);

    return {
      ...ad,
      copySummary: summarizeCopyFallback(ad.adText),
      copyToClipboardText: ad.copyToClipboardText || ad.adText,
      relevanceScore: relevance,
      popularityScore: computePopularityScore(scoreMap, region),
      popularityReasons,
      popularityExplanation: popularityReasons.length
        ? `Apareceu no topo porque tem ${popularityReasons.join(', ')}.`
        : 'Apareceu no topo pela combinacao entre nicho, constancia e forca comercial.',
      regionLabel: regionInfo.regionLabel,
      regionConfidence: regionInfo.regionConfidence,
      regionSource: regionInfo.regionSource,
      matchReason: buildMatchReason(ad, query, flattenedTerms),
      metaImpressionHint,
      capturedAt: ad.capturedAt || new Date().toISOString(),
      deliveryStart: ad.deliveryStart || null,
      deliveryAgeDays: activeDays,
    };
  });

  return sortRankedAds(ranked, sort);
}
