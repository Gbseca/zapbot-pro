import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAdResearchService } from './service.js';
import { createAdResearchStore } from './store.js';

function adFor(term, suffix = 'a') {
  return {
    id: `${term.replace(/\W/g, '')}-${suffix}`,
    libraryId: `${Date.now()}${suffix === 'a' ? '1' : '2'}`,
    advertiserName: 'Clube Teste',
    adText: `${term} com assistencia 24 horas e atendimento pelo WhatsApp.`,
    deliveryStart: '2026-01-10T00:00:00.000Z',
    creativeCount: 2,
    multipleVersions: true,
    ctaLabel: 'Enviar mensagem',
    landingUrl: 'https://example.com/cotacao',
    landingDomain: 'example.com',
    adUrl: 'https://facebook.com/ads/library',
    mediaType: 'image',
    mediaPreviewUrl: 'https://example.com/image.jpg',
    searchTerm: term,
    searchTerms: [term],
    capturedAt: new Date().toISOString(),
  };
}

async function waitForFinal(service, jobId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = service.getJob(jobId);
    if (['completed', 'partial', 'failed', 'cancelled'].includes(job?.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`Job ${jobId} did not finish in time.`);
}

function createHarness({ slow = false } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-ad-service-'));
  const store = createAdResearchStore({ filePath: path.join(tempDir, 'store.json') });
  const stats = { launches: 0, active: 0, maxActive: 0, collects: 0, closed: 0, version: 1 };
  const collectorFactory = async ({ signal }) => {
    stats.launches += 1;
    stats.active += 1;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    return {
      async preflight() {
        return { collectorReady: true, code: 'ok', message: 'ready' };
      },
      async collect({ searchTerm }) {
        stats.collects += 1;
        if (slow) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 500);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const error = new Error('cancelled');
              error.code = 'aborted';
              reject(error);
            }, { once: true });
          });
        } else {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return { ads: [adFor(searchTerm, String(stats.version))], rawCount: 1 };
      },
      async close() {
        stats.closed += 1;
        stats.active -= 1;
      },
    };
  };
  const service = createAdResearchService({
    loadConfig: () => ({ aiEnabled: false, groqKey: '', geminiKey: '' }),
    broadcast: () => {},
    store,
    collectorFactory,
    schedulerIntervalMs: 86_400_000,
  });
  return {
    service,
    store,
    stats,
    cleanup() {
      service.shutdown();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('runs searches sequentially, reuses one browser per job and caches results', async () => {
  const harness = createHarness();
  try {
    const first = harness.service.startSearch({ query: 'protecao veicular', mode: 'exact' });
    const second = harness.service.startSearch({ query: 'rastreamento veicular', mode: 'exact' });
    const [firstDone, secondDone] = await Promise.all([
      waitForFinal(harness.service, first.jobId),
      waitForFinal(harness.service, second.jobId),
    ]);
    assert.equal(firstDone.status, 'completed');
    assert.equal(secondDone.status, 'completed');
    assert.equal(harness.stats.maxActive, 1);
    assert.equal(harness.stats.launches, 2);
    assert.equal(firstDone.metrics.browserLaunches, 1);

    const cached = harness.service.startSearch({ query: 'protecao veicular', mode: 'exact' });
    const cachedDone = await waitForFinal(harness.service, cached.jobId);
    assert.equal(cachedDone.metrics.cacheHit, true);
    assert.equal(harness.stats.launches, 2);
  } finally {
    harness.cleanup();
  }
});
test('cancels a running search and closes its browser session', async () => {
  const harness = createHarness({ slow: true });
  try {
    const job = harness.service.startSearch({ query: 'protecao veicular', mode: 'exact' });
    const deadline = Date.now() + 2_000;
    while (harness.service.getJob(job.jobId).status !== 'running' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    harness.service.cancelSearch(job.jobId);
    const done = await waitForFinal(harness.service, job.jobId);
    assert.equal(done.status, 'cancelled');
    assert.equal(harness.stats.closed, 1);
  } finally {
    harness.cleanup();
  }
});

test('runs watchlists, records snapshots and detects changed ads', async () => {
  const harness = createHarness();
  try {
    const watchlist = harness.service.createWatchlist({
      name: 'Concorrentes locais',
      query: 'protecao veicular',
      mode: 'exact',
      intervalHours: 6,
    });
    const first = harness.service.runWatchlist(watchlist.id);
    await waitForFinal(harness.service, first.jobId);
    assert.equal(harness.service.listSnapshots({ watchlistId: watchlist.id }).length, 1);
    assert.equal(harness.service.listAlerts().length, 0);

    harness.stats.version = 2;
    const second = harness.service.runWatchlist(watchlist.id);
    await waitForFinal(harness.service, second.jobId);
    assert.equal(harness.service.listSnapshots({ watchlistId: watchlist.id }).length, 2);
    assert.equal(harness.service.listAlerts().length, 1);
  } finally {
    harness.cleanup();
  }
});
