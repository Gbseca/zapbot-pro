const args = process.argv.slice(2);
const baseUrl = String(args.find((value) => /^https?:\/\//i.test(value)) || 'http://127.0.0.1:3001').replace(/\/$/, '');
const runSearch = args.includes('--search');
const query = process.env.AD_RESEARCH_VERIFY_QUERY || 'protecao veicular';

async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = method === 'GET' ? 4 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Falha HTTP ${response.status} em ${path}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw lastError;
}

const session = await request('/api/ad-research/session');
const headers = {
  'Content-Type': 'application/json',
  'X-Ad-Research-Token': session.token,
};
const snapshot = await request('/api/system/status/refresh', {
  method: 'POST',
  headers,
  body: JSON.stringify({ checks: ['ads'] }),
});
const collector = snapshot.adResearch?.lastCollectorCheck || {};

const report = {
  baseUrl,
  collectorReady: collector.collectorReady === true,
  collectorCode: collector.code || 'unknown',
  collectorMessage: collector.message || '',
  runtime: collector.runtime || snapshot.adResearch?.runtime || null,
};

if (report.collectorReady && runSearch) {
  const started = await request('/api/ad-research/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, country: 'BR', mode: 'exact', maxResults: 10, minimumRelevance: 0, cacheBypass: true }),
  });
  const deadline = Date.now() + 4 * 60 * 1000;
  let job = started.job;
  while (job && ['queued', 'running', 'cancelling'].includes(job.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    job = await request(`/api/ad-research/${encodeURIComponent(job.jobId)}`, { headers });
  }
  report.search = job ? {
    jobId: job.jobId,
    status: job.status,
    results: job.results?.length || 0,
    error: job.error || '',
    warnings: job.warnings || [],
    diagnostics: job.diagnostics || null,
    metrics: job.metrics || null,
  } : null;
  if (!job || !['completed', 'partial'].includes(job.status)) {
    process.exitCode = 1;
  }
}

console.log(JSON.stringify(report, null, 2));
if (!report.collectorReady) process.exitCode = 1;
