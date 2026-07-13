import { randomBytes } from 'crypto';

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function userAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 300);
}

function requestHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
}

function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const pair of raw.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function sameOrigin(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === requestHost(req);
  } catch {
    return false;
  }
}

export function createAdResearchAccessGuard({
  tokenTtlMs = 12 * 60 * 60 * 1000,
  windowMs = 10 * 60 * 1000,
  searchLimit = 4,
  mutationLimit = 40,
} = {}) {
  const tokens = new Map();
  const buckets = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [token, entry] of tokens) {
      if (entry.expiresAt <= now) tokens.delete(token);
    }
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function issue(req) {
    cleanup();
    if (!sameOrigin(req)) return null;
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    tokens.set(token, {
      ip: clientIp(req),
      userAgent: userAgent(req),
      createdAt: now,
      expiresAt: now + tokenTtlMs,
    });
    return { token, expiresAt: new Date(now + tokenTtlMs).toISOString(), maxAgeMs: tokenTtlMs };
  }

  function validateToken(req) {
    cleanup();
    const token = String(req.headers['x-ad-research-token'] || cookieValue(req, 'zapbot_ad_session') || '').trim();
    const entry = tokens.get(token);
    if (!entry || entry.expiresAt <= Date.now()) return false;
    return entry.ip === clientIp(req) && entry.userAgent === userAgent(req);
  }

  function consume(req, kind) {
    const limit = kind === 'search' ? searchLimit : mutationLimit;
    const key = `${clientIp(req)}:${kind}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }
    bucket.count += 1;
    return { allowed: true, remaining: Math.max(0, limit - bucket.count) };
  }

  function middleware(kind = 'mutation') {
    return (req, res, next) => {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Origem da requisicao nao permitida.' });
      if (!validateToken(req)) return res.status(403).json({ error: 'Sessao da Pesquisa Ads ausente ou expirada.' });
      if (kind === 'read') return next();
      const rate = consume(req, kind);
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        return res.status(429).json({ error: 'Limite de operacoes atingido. Aguarde alguns minutos antes de tentar novamente.' });
      }
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      return next();
    };
  }

  return {
    issue,
    read: middleware('read'),
    search: middleware('search'),
    mutation: middleware('mutation'),
    stats() {
      cleanup();
      return { sessions: tokens.size, rateBuckets: buckets.size };
    },
  };
}
