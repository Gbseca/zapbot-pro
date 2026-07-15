import net from 'net';
import { lookup } from 'dns/promises';
import { getDomainFromUrl, normalizeText, truncateText } from './utils.js';

const MAX_BODY_BYTES = 320_000;
const MAX_REDIRECTS = 3;

function isPrivateIpv4(address = '') {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] >= 224) return true;
  return false;
}
function isPrivateIpv6(address = '') {
  const normalized = address.toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.');
}

function isPrivateAddress(address = '') {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function validatePublicUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('URL de destino invalida.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Apenas destinos HTTP ou HTTPS podem ser analisados.');
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error('Destino nao permitido.');

  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error('O destino aponta para uma rede privada e foi bloqueado por seguranca.');
  }
  return parsed;
}

function joinAbortSignals(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Tempo limite ao analisar o destino.')), timeoutMs);
  timeout.unref?.();
  const abort = () => controller.abort(externalSignal?.reason || new Error('Analise cancelada.'));
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.('abort', abort);
    },
  };
}

async function readLimitedBody(response, maxBytes = MAX_BODY_BYTES) {
  if (!response.body?.getReader) return truncateText(await response.text(), maxBytes);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let total = 0;
  let output = '';
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    output += decoder.decode(value, { stream: true });
    if (total >= maxBytes) break;
  }
  await reader.cancel().catch(() => {});
  output += decoder.decode();
  return output.slice(0, maxBytes);
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html = '') {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return truncateText(stripHtml(title), 180);
}

function extractDescription(html = '') {
  const match = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  return truncateText(stripHtml(match?.[1] || ''), 260);
}

function countMatches(value = '', pattern) {
  return (String(value).match(pattern) || []).length;
}

export function analyzeLandingUrl(value = '') {
  try {
    const parsed = new URL(value);
    const params = parsed.searchParams;
    const isWhatsApp = /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/i.test(parsed.hostname);
    return {
      valid: ['http:', 'https:'].includes(parsed.protocol),
      domain: getDomainFromUrl(value),
      protocol: parsed.protocol.replace(':', ''),
      isHttps: parsed.protocol === 'https:',
      isWhatsApp,
      hasUtm: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].some((key) => params.has(key)),
      utm: Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
        .filter((key) => params.has(key))
        .map((key) => [key, params.get(key)])),
      pathDepth: parsed.pathname.split('/').filter(Boolean).length,
    };
  } catch {
    return {
      valid: false,
      domain: '',
      protocol: '',
      isHttps: false,
      isWhatsApp: false,
      hasUtm: false,
      utm: {},
      pathDepth: 0,
    };
  }
}

export async function auditLandingPage(url, { signal = null, timeoutMs = 8_000 } = {}) {
  const startedAt = Date.now();
  const joined = joinAbortSignals(signal, Math.min(15_000, Math.max(2_000, Number(timeoutMs) || 8_000)));
  let currentUrl = String(url || '').trim();
  const redirects = [];

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const parsed = await validatePublicUrl(currentUrl);
      const response = await fetch(parsed, {
        redirect: 'manual',
        signal: joined.signal,
        headers: {
          'user-agent': 'MoOve-IA-AdResearch/1.0 (+landing-page-audit)',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.3',
        },
      });

      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        const nextUrl = new URL(response.headers.get('location'), parsed).toString();
        redirects.push({ status: response.status, from: parsed.toString(), to: nextUrl });
        currentUrl = nextUrl;
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const html = /text\/html|application\/xhtml\+xml/i.test(contentType)
        ? await readLimitedBody(response)
        : '';
      const normalized = normalizeText(html);
      const urlInfo = analyzeLandingUrl(parsed.toString());
      const whatsappLinks = countMatches(html, /https?:\/\/(?:wa\.me|api\.whatsapp\.com|(?:www\.)?whatsapp\.com)\//gi);
      const formCount = countMatches(html, /<form\b/gi);
      const inputCount = countMatches(html, /<input\b/gi);
      const ctaSignals = ['fale conosco', 'whatsapp', 'saiba mais', 'solicite', 'cotacao', 'orcamento', 'cadastre-se']
        .filter((term) => normalized.includes(normalizeText(term)));

      return {
        ok: response.ok,
        status: response.status,
        finalUrl: parsed.toString(),
        domain: urlInfo.domain,
        title: extractTitle(html),
        description: extractDescription(html),
        contentType,
        redirects,
        responseTimeMs: Date.now() - startedAt,
        isHttps: urlInfo.isHttps,
        hasUtm: urlInfo.hasUtm,
        utm: urlInfo.utm,
        whatsappLinks,
        formCount,
        inputCount,
        ctaSignals,
        tracking: {
          metaPixel: /connect\.facebook\.net|fbq\s*\(/i.test(html),
          googleTag: /googletagmanager\.com|gtag\s*\(/i.test(html),
          googleAnalytics: /google-analytics\.com|analytics\.google\.com/i.test(html),
        },
        warnings: [
          !urlInfo.isHttps ? 'Destino sem HTTPS.' : '',
          !formCount && !whatsappLinks ? 'Nenhum formulario ou link de WhatsApp foi encontrado no HTML inicial.' : '',
          !urlInfo.hasUtm ? 'URL sem parametros UTM.' : '',
        ].filter(Boolean),
        checkedAt: new Date().toISOString(),
      };
    }
    throw new Error('O destino excedeu o limite de redirecionamentos.');
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: currentUrl,
      domain: getDomainFromUrl(currentUrl),
      redirects,
      responseTimeMs: Date.now() - startedAt,
      error: error?.name === 'AbortError' ? 'A analise do destino excedeu o tempo limite.' : error.message,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    joined.close();
  }
}
