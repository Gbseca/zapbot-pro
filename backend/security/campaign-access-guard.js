import { randomBytes, timingSafeEqual } from 'crypto';

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
    try { return decodeURIComponent(pair.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

function sameOrigin(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === requestHost(req); } catch { return false; }
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCampaignAccessGuard({
  tokenTtlMs = 12 * 60 * 60 * 1000,
  mutationWindowMs = 60 * 1000,
  mutationLimit = 80,
  aiWindowMs = 10 * 60 * 1000,
  aiLimit = 20,
} = {}) {
  const sessions = new Map();
  const buckets = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function issue(req) {
    cleanup();
    if (!sameOrigin(req)) return null;
    const now = Date.now();
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, {
      ip: clientIp(req),
      userAgent: userAgent(req),
      expiresAt: now + tokenTtlMs,
    });
    return { token, expiresAt: new Date(now + tokenTtlMs).toISOString(), maxAgeMs: tokenTtlMs };
  }

  function validSession(req) {
    cleanup();
    const supplied = String(req.headers['x-campaign-token'] || cookieValue(req, 'zapbot_campaign_session') || '').trim();
    if (!supplied) return false;
    const session = [...sessions.entries()].find(([token]) => constantTimeEqual(token, supplied))?.[1];
    if (!session || session.expiresAt <= Date.now()) return false;
    return session.ip === clientIp(req) && session.userAgent === userAgent(req);
  }

  function consume(req, kind) {
    const isAI = kind === 'ai';
    const windowMs = isAI ? aiWindowMs : mutationWindowMs;
    const limit = isAI ? aiLimit : mutationLimit;
    const key = `${clientIp(req)}:${kind}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, remaining: Math.max(0, limit - bucket.count) };
  }

  function middleware(kind = 'read') {
    return (req, res, next) => {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Origem da requisicao nao permitida.' });
      if (!validSession(req)) return res.status(403).json({ error: 'Sessao do Estudio de Campanhas ausente ou expirada.' });
      if (kind === 'read') return next();
      const rate = consume(req, kind);
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfter));
        return res.status(429).json({ error: 'Muitas operacoes em pouco tempo. Aguarde um instante.' });
      }
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      return next();
    };
  }

  return {
    issue,
    read: middleware('read'),
    mutation: middleware('mutation'),
    ai: middleware('ai'),
    stats() {
      cleanup();
      return { sessions: sessions.size, rateBuckets: buckets.size };
    },
  };
}
