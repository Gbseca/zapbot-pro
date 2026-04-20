import { chromium } from 'playwright';
import {
  buildMetaAdUrl,
  buildMetaSearchUrl,
  decodeTrackingUrl,
  getDomainFromUrl,
  hashText,
  parseLooseDate,
  normalizeText,
  truncateText,
} from './utils.js';

const LIBRARY_ID_REGEX = /(?:Identifica(?:cao|ção)\s+da\s+biblioteca|Library\s+ID)\s*:?\s*(\d{6,})/i;
const STARTED_REGEX = /(?:Veiculacao\s+iniciada\s+em|Veiculação\s+iniciada\s+em|Started\s+running\s+on)\s+([^\n]+)/i;
const CREATIVE_COUNT_REGEX = /(\d+)\s+(?:anuncios|anúncios|ads)\s+usam\s+esse\s+criativo/i;
const UI_NOISE_LINES = new Set([
  'ativo',
  'active',
  'plataformas',
  'platforms',
  'abrir menu suspenso',
  'open dropdown menu',
  'ver detalhes do anuncio',
  'ver detalhes do anúncio',
  'see ad details',
  'patrocinado',
  'sponsored',
  'meta',
]);

function isUiNoiseLine(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (UI_NOISE_LINES.has(normalized)) return true;
  if (/^\d+:\d+\s*\/\s*\d+:\d+$/.test(normalized)) return true;
  if (normalized === '0 00 / 0 00') return true;
  return false;
}

function pickAdvertiserName(lines, links = []) {
  const sponsoredIndex = lines.findIndex((line) => ['patrocinado', 'sponsored'].includes(normalizeText(line)));
  if (sponsoredIndex > 0) {
    for (let index = sponsoredIndex - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (isUiNoiseLine(line) || LIBRARY_ID_REGEX.test(line) || STARTED_REGEX.test(line)) continue;
      return line.trim();
    }
  }

  for (const link of links) {
    const text = String(link?.text || '').trim();
    if (!text || isUiNoiseLine(text)) continue;
    if (LIBRARY_ID_REGEX.test(text) || STARTED_REGEX.test(text)) continue;
    return text;
  }

  for (const line of lines) {
    if (isUiNoiseLine(line) || LIBRARY_ID_REGEX.test(line) || STARTED_REGEX.test(line)) continue;
    return line.trim();
  }

  return 'Anunciante nao identificado';
}

function findCtaLabel(lines) {
  return lines.find((line) => {
    const normalized = normalizeText(line);
    return [
      'saiba mais',
      'learn more',
      'enviar mensagem',
      'send message',
      'fale conosco',
      'whatsapp',
      'comprar agora',
      'buy now',
      'solicitar agora',
      'cadastre-se',
      'inscreva-se',
    ].includes(normalized);
  }) || '';
}

function extractAdText(lines, advertiserName = '') {
  const cleanLines = lines
    .map((line) => line.trim())
    .filter(Boolean);

  const sponsoredIndex = cleanLines.findIndex((line) => ['patrocinado', 'sponsored'].includes(normalizeText(line)));
  const startedIndex = cleanLines.findIndex((line) => STARTED_REGEX.test(line));
  const libraryIndex = cleanLines.findIndex((line) => LIBRARY_ID_REGEX.test(line));
  const startIndex = sponsoredIndex >= 0
    ? sponsoredIndex + 1
    : startedIndex >= 0
      ? startedIndex + 1
      : libraryIndex >= 0
        ? libraryIndex + 1
        : 0;
  const collected = [];

  for (let index = startIndex; index < cleanLines.length; index += 1) {
    const line = cleanLines[index];
    const normalized = normalizeText(line);

    if (!normalized || isUiNoiseLine(line)) continue;
    if (normalizeText(advertiserName) === normalized) continue;
    if ([
      'transparencia e informacoes do anuncio',
      'transparency and ad information',
    ].includes(normalized)) {
      continue;
    }

    if (
      normalized === 'saiba mais'
      || normalized === 'learn more'
      || normalized === 'enviar mensagem'
      || normalized === 'send message'
      || normalized === 'whatsapp'
      || normalized === 'ver mais'
      || normalized === 'see ad details'
      || normalized === 'enviar mensagem pelo whatsapp'
      || normalized.endsWith('.com')
      || normalized.startsWith('esse anuncio tem varias versoes')
      || normalized.startsWith('this ad has multiple versions')
      || CREATIVE_COUNT_REGEX.test(line)
    ) {
      break;
    }

    if (LIBRARY_ID_REGEX.test(line) || STARTED_REGEX.test(line)) continue;

    collected.push(line);
    if (collected.join(' ').length >= 1200) break;
  }

  return truncateText(collected.join('\n').trim(), 1100);
}

function decodeLinks(links = []) {
  const externalLinks = [];
  const advertiserLinks = [];

  for (const link of links) {
    if (!link?.href) continue;
    const href = link.href.startsWith('http') ? link.href : `https://www.facebook.com${link.href}`;
    const decoded = decodeTrackingUrl(href) || href;

    if (/facebook\.com\/ads\/library/i.test(href)) continue;

    if (/facebook\.com/i.test(href) && !/l\.facebook\.com/i.test(href)) {
      advertiserLinks.push(href);
      continue;
    }

    if (decoded && !/facebook\.com/i.test(decoded)) {
      externalLinks.push(decoded);
    }
  }

  return {
    advertiserProfileUrl: advertiserLinks[0] || '',
    landingUrl: externalLinks[0] || '',
  };
}

function parseCandidate(candidate, searchTerm) {
  const text = String(candidate.text || '').trim();
  if (!text) return null;

  const libraryId = text.match(LIBRARY_ID_REGEX)?.[1];
  if (!libraryId) return null;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const advertiserName = pickAdvertiserName(lines, candidate.links);
  const deliveryStartRaw = text.match(STARTED_REGEX)?.[1]?.trim() || '';
  const creativeCount = Number(text.match(CREATIVE_COUNT_REGEX)?.[1] || 1);
  const multipleVersions = /varias versoes|várias versões|multiple versions/i.test(normalizeText(text));
  const adText = extractAdText(lines, advertiserName);
  const ctaLabel = findCtaLabel(lines);
  const decodedLinks = decodeLinks(candidate.links);
  const landingDomain = getDomainFromUrl(decodedLinks.landingUrl);

  return {
    id: libraryId || `meta-${hashText(`${advertiserName}|${adText}`)}`,
    libraryId,
    platform: 'Meta Ads',
    advertiserName,
    advertiserProfileUrl: decodedLinks.advertiserProfileUrl,
    adText,
    copyToClipboardText: adText,
    deliveryStart: parseLooseDate(deliveryStartRaw),
    deliveryStartRaw,
    creativeCount: Number.isFinite(creativeCount) && creativeCount > 0 ? creativeCount : 1,
    multipleVersions,
    ctaLabel,
    landingUrl: decodedLinks.landingUrl,
    landingDomain,
    adUrl: buildMetaAdUrl(libraryId),
    searchTerm,
    sourceOrder: Number(candidate.top) || 0,
    capturedAt: new Date().toISOString(),
    rawSnippet: truncateText(text, 1400),
  };
}

async function dismissCookiePrompt(page) {
  const selectors = [
    'text="Permitir todos os cookies"',
    'text="Allow all cookies"',
    'text="Permitir todos"',
    'text="Allow all"',
  ];

  for (const selector of selectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1200 })) {
        await button.click({ timeout: 1200 });
        return;
      }
    } catch {
      // Ignore transient consent modals.
    }
  }
}

async function extractVisibleCandidates(page) {
  return page.evaluate(({ libraryIdPattern, creativeCountPattern }) => {
    const libraryRegex = new RegExp(libraryIdPattern, 'i');
    const creativeRegex = new RegExp(creativeCountPattern, 'i');
    const elements = Array.from(document.querySelectorAll('article, div, section'));
    const byId = new Map();

    for (const element of elements) {
      const text = (element.innerText || '').trim();
      if (!text || !libraryRegex.test(text)) continue;

      const rect = element.getBoundingClientRect();
      if (rect.width < 260 || rect.height < 120) continue;

      const libraryId = text.match(libraryRegex)?.[1];
      if (!libraryId) continue;

      const absoluteTop = rect.top + window.scrollY;
      const links = Array.from(element.querySelectorAll('a'))
        .slice(0, 14)
        .map((anchor) => ({
          href: anchor.getAttribute('href') || '',
          text: (anchor.innerText || '').trim(),
        }))
        .filter((link) => link.href);

      const candidate = {
        id: libraryId,
        top: absoluteTop,
        text,
        links,
      };

      const previous = byId.get(libraryId);
      if (!previous) {
        byId.set(libraryId, candidate);
        continue;
      }

      const previousSignal = previous.text.length - (creativeRegex.test(previous.text) ? 40 : 0);
      const currentSignal = candidate.text.length - (creativeRegex.test(candidate.text) ? 40 : 0);
      if (currentSignal < previousSignal) {
        byId.set(libraryId, candidate);
      }
    }

    return Array.from(byId.values());
  }, {
    libraryIdPattern: LIBRARY_ID_REGEX.source,
    creativeCountPattern: CREATIVE_COUNT_REGEX.source,
  });
}

export async function collectMetaAds({ searchTerm, country = 'BR', limit = 14, onProgress }) {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      locale: 'pt-BR',
      viewport: { width: 1440, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    const searchUrl = buildMetaSearchUrl({ query: searchTerm, country });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await dismissCookiePrompt(page);

    const candidatesById = new Map();
    let stableRounds = 0;

    for (let round = 0; round < 10; round += 1) {
      const candidates = await extractVisibleCandidates(page);

      for (const candidate of candidates) {
        const previous = candidatesById.get(candidate.id);
        if (!previous || String(candidate.text || '').length < String(previous.text || '').length) {
          candidatesById.set(candidate.id, candidate);
        }
      }

      onProgress?.({
        searchTerm,
        collected: candidatesById.size,
        message: `Coletando anuncios em "${searchTerm}"`,
      });

      if (candidatesById.size >= limit) {
        stableRounds += 1;
        if (stableRounds >= 2) break;
      }

      const beforeHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.mouse.wheel(0, 2600);
      await page.waitForTimeout(1400);
      const afterHeight = await page.evaluate(() => document.body.scrollHeight);
      if (afterHeight === beforeHeight) {
        stableRounds += 1;
        if (stableRounds >= 2) break;
      } else {
        stableRounds = 0;
      }
    }

    const ads = Array.from(candidatesById.values())
      .sort((left, right) => Number(left.top || 0) - Number(right.top || 0))
      .map((candidate) => parseCandidate(candidate, searchTerm))
      .filter((ad) => ad && ad.adText)
      .slice(0, limit);

    await context.close();

    return {
      platform: 'Meta Ads',
      searchTerm,
      searchUrl,
      ads,
      rawCount: candidatesById.size,
    };
  } finally {
    await browser.close();
  }
}
