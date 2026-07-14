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

export function createLeadsAccessGuard({
  tokenTtlMs = 12 * 60 * 60 * 1000,
  mutationWindowMs = 60 * 1000,
  mutationLimit = 80,
} = {}) {
  const sessions = new Map();
  const mutationBuckets = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
    for (const [key, bucket] of mutationBuckets) {
      if (bucket.resetAt <= now) mutationBuckets.delete(key);
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
    return {
      token,
      expiresAt: new Date(now + tokenTtlMs).toISOString(),
      maxAgeMs: tokenTtlMs,
    };
  }

  function validSession(req) {
    cleanup();
    const token = String(req.headers['x-leads-token'] || cookieValue(req, 'zapbot_leads_session') || '').trim();
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) return false;
    return session.ip === clientIp(req) && session.userAgent === userAgent(req);
  }

  function consumeMutation(req) {
    const key = clientIp(req);
    const now = Date.now();
    let bucket = mutationBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + mutationWindowMs };
      mutationBuckets.set(key, bucket);
    }
    if (bucket.count >= mutationLimit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, remaining: Math.max(0, mutationLimit - bucket.count) };
  }

  function middleware({ mutation = false } = {}) {
    return (req, res, next) => {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Origem da requisicao nao permitida.' });
      if (!validSession(req)) return res.status(403).json({ error: 'Sessao da Central de Leads ausente ou expirada.' });
      if (!mutation) return next();

      const rate = consumeMutation(req);
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfter));
        return res.status(429).json({ error: 'Muitas alteracoes em pouco tempo. Aguarde um instante.' });
      }
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      return next();
    };
  }

  return {
    issue,
    read: middleware(),
    mutation: middleware({ mutation: true }),
  };
}
