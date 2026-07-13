import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { DATA_DIR } from '../storage/paths.js';
import {
  buildMetaAdUrl,
  buildMetaSearchUrl,
  decodeTrackingUrl,
  getDomainFromUrl,
  hashText,
  normalizeText,
  parseLooseDate,
  truncateText,
  uniqueStrings,
} from './utils.js';

const DIAGNOSTIC_DIR = path.join(DATA_DIR, 'ad-research-diagnostics');
const LIBRARY_ID_PATTERN = /(?:identificacao da biblioteca|library id)\s*:?\s*(\d{6,})/i;
const STARTED_PATTERN = /(?:veiculacao iniciada em|started running on)\s+(.+)/i;
const CREATIVE_COUNT_PATTERN = /(\d+)\s+(?:anuncios|ads)\s+(?:usam|use|using)\s+(?:esse|este|this)?\s*criativo/i;
const TERMINAL_STATUSES = new Set(['blocked', 'auth_wall', 'page_structure_changed']);

const UI_NOISE = new Set([
  'ativo',
  'active',
  'plataformas',
  'platforms',
  'abrir menu suspenso',
  'open dropdown menu',
  'ver detalhes do anuncio',
  'see ad details',
  'patrocinado',
  'sponsored',
  'meta',
  'biblioteca de anuncios',
  'ad library',
]);

const CTA_LABELS = [
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
  'obter oferta',
  'get offer',
];

const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-setuid-sandbox',
  '--no-sandbox',
];

function createCollectorError(code, message, cause = null, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.cause = cause || null;
  Object.assign(error, details);
  return error;
}

function abortError(signal) {
  return createCollectorError('aborted', signal?.reason?.message || 'Pesquisa cancelada.');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

async function wait(ms, signal) {
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener?.('abort', abort);
    const finish = () => {
      cleanup();
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError(signal));
    };
    timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', abort, { once: true });
    timer.unref?.();
  });
  throwIfAborted(signal);
}

export function classifyCollectorError(error) {
  const originalMessage = String(error?.cause?.message || error?.message || error || 'Falha desconhecida no coletor.');
  const normalized = originalMessage.toLowerCase();
  if (typeof error?.code === 'string' && error.code) {
    const fatal = ['browser_missing', 'system_libs_missing'].includes(error.code);
    return { code: error.code, fatal, originalMessage, message: error.message || originalMessage };
  }
  if (normalized.includes('executable doesn') || normalized.includes('browser executable')) {
    return {
      code: 'browser_missing',
      fatal: true,
      originalMessage,
      message: 'O Chromium do Playwright nao esta instalado neste ambiente.',
    };
  }
  if (/error while loading shared libraries|libatk|libnss3|glib|host system is missing dependencies/.test(normalized)) {
    return {
      code: 'system_libs_missing',
      fatal: true,
      originalMessage,
      message: 'O Linux nao tem todas as bibliotecas exigidas pelo Chromium.',
    };
  }
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return {
      code: 'timeout',
      fatal: false,
      originalMessage,
      message: 'A Biblioteca de Anuncios da Meta demorou demais para responder.',
    };
  }
  if (normalized.includes('net::') || normalized.includes('navigation')) {
    return {
      code: 'navigation_failed',
      fatal: false,
      originalMessage,
      message: 'Nao foi possivel abrir a Biblioteca de Anuncios da Meta nesta tentativa.',
    };
  }
  return {
    code: 'collector_error',
    fatal: false,
    originalMessage,
    message: originalMessage,
  };
}

export function inspectCollectorRuntime() {
  let bundledExecutablePath = '';
  try {
    bundledExecutablePath = chromium.executablePath();
  } catch {
    bundledExecutablePath = '';
  }
  const configuredExecutablePath = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '').trim();
  const systemCandidates = process.platform === 'linux'
    ? ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : [];
  const candidates = [configuredExecutablePath, bundledExecutablePath, ...systemCandidates].filter(Boolean);
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate)) || bundledExecutablePath || configuredExecutablePath;
  const source = executablePath && executablePath === configuredExecutablePath
    ? 'configured'
    : executablePath && executablePath === bundledExecutablePath
      ? 'playwright'
      : executablePath
        ? 'system'
        : 'missing';
  return {
    executablePath,
    executablePresent: !!executablePath && fs.existsSync(executablePath),
    executableSource: source,
    configuredExecutablePath,
    bundledExecutablePath,
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || path.dirname(path.dirname(bundledExecutablePath || executablePath || '')),
    diagnosticDir: DIAGNOSTIC_DIR,
  };
}

export function buildChromiumLaunchOptions(runtime = inspectCollectorRuntime()) {
  const managedExecutable = runtime.executablePresent && runtime.executableSource !== 'playwright'
    ? runtime.executablePath
    : '';
  return {
    headless: true,
    args: CHROMIUM_ARGS,
    timeout: 30_000,
    ...(managedExecutable ? { executablePath: managedExecutable } : {}),
  };
}

async function launchMetaBrowser() {
  try {
    return await chromium.launch(buildChromiumLaunchOptions());
  } catch (error) {
    const classified = classifyCollectorError(error);
    throw createCollectorError(classified.code, classified.message, error);
  }
}

async function createMetaContext(browser) {
  const context = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1440, height: 1100 },
    colorScheme: 'light',
    extraHTTPHeaders: { 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7' },
  });
  await context.route('**/*', async (route) => {
    const resourceType = route.request().resourceType();
    if (['font', 'media'].includes(resourceType)) await route.abort();
    else await route.continue();
  });
  return context;
}

function cleanLines(text = '') {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isNoise(value = '') {
  const normalized = normalizeText(value);
  if (!normalized || UI_NOISE.has(normalized)) return true;
  if (/^\d+:\d+\s*\/\s*\d+:\d+$/.test(normalized)) return true;
  if (/^(anuncio|ad)\s+\d+\s+de\s+\d+$/.test(normalized)) return true;
  return false;
}

function extractLibraryId(text = '') {
  return normalizeText(text).match(LIBRARY_ID_PATTERN)?.[1] || '';
}

function extractDeliveryDate(lines = []) {
  for (const line of lines) {
    const match = normalizeText(line).match(STARTED_PATTERN);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function extractCreativeCount(text = '') {
  const match = normalizeText(text).match(CREATIVE_COUNT_PATTERN);
  const count = Number(match?.[1] || 1);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

function pickAdvertiserName(lines = [], links = []) {
  const sponsoredIndex = lines.findIndex((line) => ['patrocinado', 'sponsored'].includes(normalizeText(line)));
  if (sponsoredIndex > 0) {
    for (let index = sponsoredIndex - 1; index >= Math.max(0, sponsoredIndex - 5); index -= 1) {
      const line = lines[index];
      const normalized = normalizeText(line);
      if (isNoise(line) || LIBRARY_ID_PATTERN.test(normalized) || STARTED_PATTERN.test(normalized)) continue;
      return truncateText(line, 120);
    }
  }
  for (const link of links) {
    const label = String(link?.text || '').trim();
    const normalized = normalizeText(label);
    if (!label || isNoise(label) || LIBRARY_ID_PATTERN.test(normalized) || STARTED_PATTERN.test(normalized)) continue;
    return truncateText(label, 120);
  }
  return 'Anunciante nao identificado';
}

function findCtaLabel(lines = []) {
  return lines.find((line) => CTA_LABELS.includes(normalizeText(line))) || '';
}

function extractAdText(lines = [], advertiserName = '') {
  const sponsoredIndex = lines.findIndex((line) => ['patrocinado', 'sponsored'].includes(normalizeText(line)));
  const startIndex = sponsoredIndex >= 0 ? sponsoredIndex + 1 : 0;
  const output = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeText(line);
    if (isNoise(line) || normalizeText(advertiserName) === normalized) continue;
    if (LIBRARY_ID_PATTERN.test(normalized) || STARTED_PATTERN.test(normalized)) continue;
    if (/transparencia e informacoes do anuncio|transparency and ad information/.test(normalized)) continue;
    if (/esse anuncio tem varias versoes|this ad has multiple versions/.test(normalized)) continue;
    if (CREATIVE_COUNT_PATTERN.test(normalized)) continue;
    if (CTA_LABELS.includes(normalized) && output.length) break;
    if (/^https?:\/\//.test(line) || /^[\w.-]+\.(com|com\.br|net|org)(\/|$)/i.test(line)) continue;
    output.push(line);
    if (output.join(' ').length >= 1400) break;
  }
  return truncateText(output.join('\n').trim(), 1300);
}

function decodeLinks(links = []) {
  const external = [];
  const advertiser = [];
  for (const link of links) {
    if (!link?.href) continue;
    let href = link.href;
    try {
      href = new URL(href, 'https://www.facebook.com').toString();
    } catch {
      continue;
    }
    const decoded = decodeTrackingUrl(href) || href;
    if (/facebook\.com\/ads\/library/i.test(href)) continue;
    if (/facebook\.com/i.test(href) && !/l\.facebook\.com/i.test(href)) advertiser.push(href);
    else if (decoded && !/facebook\.com/i.test(decoded)) external.push(decoded);
  }
  return {
    advertiserProfileUrl: uniqueStrings(advertiser, 3)[0] || '',
    landingUrl: uniqueStrings(external, 5)[0] || '',
  };
}

function selectMedia(media = []) {
  const useful = media.filter((item) => {
    const width = Number(item.width || 0);
    const height = Number(item.height || 0);
    return (item.src || item.poster) && width >= 120 && height >= 80;
  });
  const selected = useful.find((item) => item.type === 'video') || useful[0] || null;
  if (!selected) return {
    mediaType: 'unknown',
    mediaPreviewUrl: '',
    mediaSourceUrl: '',
    mediaWidth: null,
    mediaHeight: null,
    mediaAspectRatio: null,
    videoDuration: null,
  };
  const width = Number(selected.width || 0) || null;
  const height = Number(selected.height || 0) || null;
  return {
    mediaType: selected.type || 'image',
    mediaPreviewUrl: selected.poster || selected.src || '',
    mediaSourceUrl: selected.src || '',
    mediaWidth: width,
    mediaHeight: height,
    mediaAspectRatio: width && height ? Math.round((width / height) * 100) / 100 : null,
    videoDuration: Number.isFinite(Number(selected.duration)) && Number(selected.duration) > 0 ? Number(selected.duration) : null,
  };
}

export function parseMetaCandidate(candidate = {}, searchTerm = '', { country = 'BR' } = {}) {
  const text = String(candidate.text || '').trim();
  if (!text) return null;
  const libraryId = extractLibraryId(text);
  if (!libraryId) return null;
  const lines = cleanLines(text);
  const advertiserName = pickAdvertiserName(lines, candidate.links || []);
  const deliveryStartRaw = extractDeliveryDate(lines);
  const adText = extractAdText(lines, advertiserName);
  const ctaLabel = findCtaLabel(lines);
  const decodedLinks = decodeLinks(candidate.links || []);
  const media = selectMedia(candidate.media || []);
  const creativeCount = extractCreativeCount(text);

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
    creativeCount,
    multipleVersions: /varias versoes|multiple versions/.test(normalizeText(text)),
    ctaLabel,
    landingUrl: decodedLinks.landingUrl,
    landingDomain: getDomainFromUrl(decodedLinks.landingUrl),
    adUrl: buildMetaAdUrl(libraryId, country),
    searchTerm,
    searchTerms: searchTerm ? [searchTerm] : [],
    sourceOrder: Number(candidate.top) || 0,
    capturedAt: new Date().toISOString(),
    rawSnippet: truncateText(text, 1600),
    ...media,
  };
}

async function dismissCookiePrompt(page) {
  const labels = [
    /permitir todos os cookies/i,
    /allow all cookies/i,
    /permitir todos/i,
    /allow all/i,
  ];
  for (const label of labels) {
    try {
      const button = page.getByRole('button', { name: label }).first();
      if (await button.isVisible({ timeout: 700 })) {
        await button.click({ timeout: 1_500 });
        return true;
      }
    } catch {
      // Consent prompts vary by session and country.
    }
  }
  return false;
}

async function pageSnapshot(page) {
  const [title, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''),
  ]);
  return {
    title,
    bodyText: truncateText(bodyText, 12_000),
    normalized: normalizeText(`${title} ${bodyText}`),
    url: page.url(),
  };
}

function classifyPageState(snapshot) {
  const text = snapshot.normalized;
  const url = snapshot.url.toLowerCase();
  if (/captcha|checkpoint|temporarily blocked|bloqueado temporariamente|atividade incomum|unusual activity/.test(text + url)) {
    return { code: 'blocked', message: 'A Meta bloqueou temporariamente a navegacao automatizada ou exibiu um desafio.' };
  }
  if (/login|entrar no facebook|log in to facebook|inicie sessao/.test(text) && /login|checkpoint/.test(url + text.slice(0, 500))) {
    return { code: 'auth_wall', message: 'A Meta exibiu uma tela de login antes dos resultados.' };
  }
  if (/nenhum anuncio corresponde|nenhum resultado|no ads match|no results found|nao encontramos anuncios/.test(text)) {
    return { code: 'no_results', message: 'Nenhum anuncio ativo foi encontrado para esse termo.' };
  }
  return { code: 'ok', message: 'Pagina da Meta carregada.' };
}

async function extractVisibleCandidates(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s:.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const idPattern = /(?:identificacao da biblioteca|library id)\s*:?\s*(\d{6,})/i;
    const byId = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      const normalizedNode = normalize(node.nodeValue);
      const id = normalizedNode.match(idPattern)?.[1];
      if (id) {
        let element = node.parentElement;
        let best = null;
        for (let depth = 0; element && depth < 12; depth += 1, element = element.parentElement) {
          const text = (element.innerText || '').trim();
          const normalizedText = normalize(text);
          const ids = normalizedText.match(new RegExp(idPattern.source, 'gi')) || [];
          const rect = element.getBoundingClientRect();
          const hasAdSignals = /patrocinado|sponsored|veiculacao iniciada|started running/.test(normalizedText);
          if (ids.length === 1 && hasAdSignals && rect.width >= 280 && rect.height >= 140 && text.length <= 8_000) {
            best = element;
            if (rect.height >= 300) break;
          }
        }

        if (best) {
          const rect = best.getBoundingClientRect();
          const links = Array.from(best.querySelectorAll('a[href]')).slice(0, 24).map((anchor) => ({
            href: anchor.getAttribute('href') || '',
            text: (anchor.innerText || anchor.getAttribute('aria-label') || '').trim(),
          }));
          const images = Array.from(best.querySelectorAll('img')).slice(0, 12).map((image) => ({
            type: 'image',
            src: image.currentSrc || image.src || '',
            poster: '',
            width: image.naturalWidth || image.width || 0,
            height: image.naturalHeight || image.height || 0,
            alt: image.alt || '',
            duration: null,
          }));
          const videos = Array.from(best.querySelectorAll('video')).slice(0, 8).map((video) => ({
            type: 'video',
            src: video.currentSrc || video.src || video.querySelector('source')?.src || '',
            poster: video.poster || '',
            width: video.videoWidth || video.clientWidth || 0,
            height: video.videoHeight || video.clientHeight || 0,
            alt: video.getAttribute('aria-label') || '',
            duration: Number.isFinite(video.duration) ? video.duration : null,
          }));
          const candidate = {
            id,
            top: rect.top + window.scrollY,
            text: (best.innerText || '').trim(),
            links,
            media: [...videos, ...images],
          };
          const previous = byId.get(id);
          if (!previous || candidate.text.length < previous.text.length) byId.set(id, candidate);
        }
      }
      node = walker.nextNode();
    }
    return Array.from(byId.values());
  });
}

function safeDiagnosticName(value = '') {
  const base = normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'collector';
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${base}`;
}

async function saveDiagnostic(page, code, searchTerm, error = null) {
  if (!page) return null;
  try {
    fs.mkdirSync(DIAGNOSTIC_DIR, { recursive: true });
    const base = safeDiagnosticName(`${code}-${searchTerm}`);
    const screenshotName = `${base}.png`;
    const reportName = `${base}.json`;
    const snapshot = await pageSnapshot(page);
    await page.screenshot({ path: path.join(DIAGNOSTIC_DIR, screenshotName), fullPage: false }).catch(() => {});
    fs.writeFileSync(path.join(DIAGNOSTIC_DIR, reportName), JSON.stringify({
      code,
      searchTerm,
      error: error?.message || null,
      title: snapshot.title,
      url: snapshot.url,
      bodyText: snapshot.bodyText,
      createdAt: new Date().toISOString(),
    }, null, 2));
    return { screenshot: screenshotName, report: reportName };
  } catch (diagnosticError) {
    console.warn('[AdResearch] Failed to save collector diagnostic:', diagnosticError.message);
    return null;
  }
}

async function preparePage(context, signal) {
  throwIfAborted(signal);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const abort = () => page.close().catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  return {
    page,
    close: async () => {
      signal?.removeEventListener?.('abort', abort);
      await page.close().catch(() => {});
    },
  };
}

async function collectWithContext(context, {
  searchTerm,
  country = 'BR',
  mode = 'broad',
  mediaType = 'all',
  limit = 20,
  signal = null,
  onProgress = null,
} = {}) {
  const holder = await preparePage(context, signal);
  const { page } = holder;
  const searchUrl = buildMetaSearchUrl({ query: searchTerm, country, mode, mediaType });
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await wait(1_800, signal);
    await dismissCookiePrompt(page);
    await wait(700, signal);

    let snapshot = await pageSnapshot(page);
    let pageState = classifyPageState(snapshot);
    if (TERMINAL_STATUSES.has(pageState.code)) {
      const diagnostic = await saveDiagnostic(page, pageState.code, searchTerm);
      throw createCollectorError(pageState.code, pageState.message, null, { diagnostic });
    }
    if (pageState.code === 'no_results') {
      return { platform: 'Meta Ads', searchTerm, searchUrl, ads: [], rawCount: 0, pageState };
    }

    const candidatesById = new Map();
    let stableRounds = 0;
    let previousSize = 0;
    for (let round = 0; round < 12; round += 1) {
      throwIfAborted(signal);
      const candidates = await extractVisibleCandidates(page);
      candidates.forEach((candidate) => {
        const previous = candidatesById.get(candidate.id);
        if (!previous || candidate.text.length < previous.text.length) candidatesById.set(candidate.id, candidate);
      });
      onProgress?.({
        searchTerm,
        collected: candidatesById.size,
        round: round + 1,
        message: `Coletando anuncios em "${searchTerm}"`,
      });

      if (candidatesById.size >= limit) stableRounds += 1;
      else if (candidatesById.size === previousSize) stableRounds += 1;
      else stableRounds = 0;
      if (stableRounds >= 2 && (candidatesById.size >= limit || round >= 4)) break;
      previousSize = candidatesById.size;

      const beforeHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.mouse.wheel(0, 2800);
      await wait(1_150, signal);
      const afterHeight = await page.evaluate(() => document.body.scrollHeight);
      if (afterHeight === beforeHeight && round >= 3) stableRounds += 1;
    }

    snapshot = await pageSnapshot(page);
    pageState = classifyPageState(snapshot);
    if (candidatesById.size === 0 && pageState.code !== 'no_results') {
      const diagnostic = await saveDiagnostic(page, 'page_structure_changed', searchTerm);
      throw createCollectorError(
        'page_structure_changed',
        'A pagina abriu, mas a estrutura dos anuncios nao foi reconhecida. Um diagnostico foi salvo automaticamente.',
        null,
        { diagnostic },
      );
    }

    const ads = Array.from(candidatesById.values())
      .sort((left, right) => Number(left.top || 0) - Number(right.top || 0))
      .map((candidate) => parseMetaCandidate(candidate, searchTerm, { country }))
      .filter((ad) => ad && (ad.adText || ad.mediaPreviewUrl))
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 20)));

    return {
      platform: 'Meta Ads',
      searchTerm,
      searchUrl,
      ads,
      rawCount: candidatesById.size,
      pageState: { code: 'ok', message: 'Coleta concluida.' },
    };
  } catch (error) {
    if (signal?.aborted || error?.code === 'aborted') throw abortError(signal);
    if (!error?.diagnostic) error.diagnostic = await saveDiagnostic(page, error?.code || 'collector_error', searchTerm, error);
    const classified = classifyCollectorError(error);
    throw createCollectorError(classified.code, classified.message, error, { diagnostic: error.diagnostic || null });
  } finally {
    await holder.close();
  }
}

export async function createMetaCollectorSession({ signal = null } = {}) {
  throwIfAborted(signal);
  const browser = await launchMetaBrowser();
  const context = await createMetaContext(browser);
  let closed = false;

  return {
    runtime: inspectCollectorRuntime(),
    async preflight() {
      const holder = await preparePage(context, signal);
      try {
        await holder.page.goto('https://www.facebook.com/ads/library/', {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        await wait(1_000, signal);
        await dismissCookiePrompt(holder.page);
        const snapshot = await pageSnapshot(holder.page);
        const pageState = classifyPageState(snapshot);
        if (TERMINAL_STATUSES.has(pageState.code)) {
          const diagnostic = await saveDiagnostic(holder.page, pageState.code, 'preflight');
          throw createCollectorError(pageState.code, pageState.message, null, { diagnostic });
        }
        return {
          collectorReady: true,
          code: 'ok',
          fatal: false,
          message: 'Chromium pronto e Biblioteca da Meta acessivel.',
          runtime: inspectCollectorRuntime(),
        };
      } finally {
        await holder.close();
      }
    },
    collect(options) {
      if (closed) throw createCollectorError('collector_closed', 'A sessao do coletor ja foi encerrada.');
      return collectWithContext(context, { ...options, signal: options?.signal || signal });
    },
    async close() {
      if (closed) return;
      closed = true;
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

export async function preflightMetaCollector() {
  let session;
  try {
    session = await createMetaCollectorSession();
    return await session.preflight();
  } catch (error) {
    const classified = classifyCollectorError(error);
    return {
      collectorReady: false,
      code: classified.code,
      fatal: classified.fatal,
      message: classified.message,
      originalMessage: classified.originalMessage,
      diagnostic: error?.diagnostic || null,
      runtime: inspectCollectorRuntime(),
    };
  } finally {
    await session?.close().catch(() => {});
  }
}

export async function collectMetaAds(options = {}) {
  let session;
  try {
    session = await createMetaCollectorSession({ signal: options.signal });
    return await session.collect(options);
  } finally {
    await session?.close().catch(() => {});
  }
}
