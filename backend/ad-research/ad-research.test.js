import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildChromiumLaunchOptions, inspectCollectorRuntime, parseMetaCandidate } from './meta-collector.js';
import { dedupeAds, rankAds, sortRankedAds } from './ranker.js';
import {
  analyzeCompliance,
  buildCampaignToolkit,
  buildResearchInsights,
  buildUtmUrl,
} from './creative-analyzer.js';
import { analyzeLandingUrl } from './landing-auditor.js';
import { createAdResearchStore } from './store.js';
import { createAdResearchAccessGuard } from './access-guard.js';

function fixtureAd(overrides = {}) {
  return {
    id: '1234567890',
    libraryId: '1234567890',
    advertiserName: 'Clube Auto',
    adText: 'Protecao veicular com assistencia 24 horas. Peca sua cotacao pelo WhatsApp.',
    deliveryStart: '2026-01-10T00:00:00.000Z',
    creativeCount: 3,
    multipleVersions: true,
    ctaLabel: 'Enviar mensagem',
    landingUrl: 'https://example.com/protecao?utm_source=meta',
    landingDomain: 'example.com',
    adUrl: 'https://www.facebook.com/ads/library/?q=1234567890',
    mediaPreviewUrl: 'https://cdn.example.com/ad.jpg',
    mediaType: 'image',
    searchTerm: 'protecao veicular',
    searchTerms: ['protecao veicular'],
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('parses current Portuguese Meta labels with accents and media', () => {
  const parsed = parseMetaCandidate({
    text: [
      'Identificação da biblioteca: 9876543210',
      'Veiculação iniciada em 10 de janeiro de 2026',
      'Clube Auto Brasil',
      'Patrocinado',
      'Proteção veicular com assistência 24 horas para o seu carro.',
      '3 anúncios usam esse criativo',
      'Enviar mensagem',
    ].join('\n'),
    top: 100,
    links: [
      { text: 'Clube Auto Brasil', href: 'https://www.facebook.com/clubeauto' },
      { text: 'Destino', href: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fcotacao' },
    ],
    media: [{
      type: 'video',
      src: 'https://cdn.example.com/video.mp4',
      poster: 'https://cdn.example.com/poster.jpg',
      width: 1080,
      height: 1920,
      duration: 21,
    }],
  }, 'protecao veicular');

  assert.equal(parsed.libraryId, '9876543210');
  assert.equal(parsed.advertiserName, 'Clube Auto Brasil');
  assert.equal(parsed.deliveryStart, '2026-01-10T00:00:00.000Z');
  assert.equal(parsed.creativeCount, 3);
  assert.equal(parsed.mediaType, 'video');
  assert.equal(parsed.mediaAspectRatio, 0.56);
  assert.match(parsed.adText, /Proteção veicular/);
  assert.equal(parsed.landingDomain, 'example.com');
});

test('deduplicates near-identical ads and aggregates matched search terms', () => {
  const ads = dedupeAds([
    fixtureAd({ id: '1', libraryId: '1', searchTerm: 'protecao veicular' }),
    fixtureAd({
      id: '2',
      libraryId: '2',
      searchTerm: 'assistencia veicular',
      adText: 'Protecao veicular com assistencia 24 horas. Peca agora sua cotacao pelo WhatsApp.',
    }),
  ]);
  assert.equal(ads.length, 1);
  assert.deepEqual(new Set(ads[0].searchTerms), new Set(['protecao veicular', 'assistencia veicular']));
});

test('uses whole location terms and does not infer SP from especialista', () => {
  const [ad] = rankAds([
    fixtureAd({
      adText: 'Fale com um especialista em protecao veicular e receba orientacao.',
      landingUrl: 'https://example.com',
    }),
  ], {
    query: 'protecao veicular',
    region: '',
    searchTerms: ['protecao veicular'],
    semanticTerms: ['assistencia'],
  });
  assert.equal(ad.regionLabel, 'Nao identificado');

  const [regional] = rankAds([
    fixtureAd({ adText: 'Atendimento em Sao Paulo para protecao veicular.' }),
  ], {
    query: 'protecao veicular',
    region: 'Sao Paulo',
    searchTerms: ['protecao veicular'],
    semanticTerms: [],
  });
  assert.equal(regional.regionConfidence, 'alta');
});

test('returns explainable estimated strength without claiming impressions', () => {
  const [ad] = rankAds([fixtureAd()], {
    query: 'protecao veicular',
    searchTerms: ['protecao veicular'],
    semanticTerms: ['assistencia 24 horas'],
  });
  assert.ok(ad.strengthScore >= 0 && ad.strengthScore <= 100);
  assert.equal(ad.popularityScore, ad.strengthScore);
  assert.match(ad.popularityExplanation, /estimativa/i);
  assert.ok(ad.scoreBreakdown.relevance >= 0);
  assert.ok(['alta', 'media', 'baixa'].includes(ad.confidence.label));
});

test('sorts missing delivery dates last and accepts a managed Chromium path', () => {
  const sorted = sortRankedAds([
    { id: 'missing', deliveryStart: null },
    { id: 'newer', deliveryStart: '2026-05-01T00:00:00.000Z' },
    { id: 'older', deliveryStart: '2025-05-01T00:00:00.000Z' },
  ], 'oldest');
  assert.deepEqual(sorted.map((item) => item.id), ['older', 'newer', 'missing']);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-chromium-path-'));
  const executable = path.join(tempDir, process.platform === 'win32' ? 'chrome.exe' : 'chromium');
  const previous = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  try {
    fs.writeFileSync(executable, 'fixture');
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = executable;
    const runtime = inspectCollectorRuntime();
    assert.equal(runtime.executablePresent, true);
    assert.equal(runtime.executablePath, executable);
    assert.equal(runtime.executableSource, 'configured');
    assert.equal(buildChromiumLaunchOptions(runtime).executablePath, executable);
    assert.equal(buildChromiumLaunchOptions(runtime).timeout, 30_000);
    assert.equal(buildChromiumLaunchOptions({
      executablePresent: true,
      executableSource: 'playwright',
      executablePath: '/playwright/full-chrome',
    }).executablePath, undefined);
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    else process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = previous;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('builds creative intelligence, safe campaign variants and UTM links', () => {
  const ad = rankAds([fixtureAd()], {
    query: 'protecao veicular',
    searchTerms: ['protecao veicular'],
    semanticTerms: ['assistencia'],
  })[0];
  const insights = buildResearchInsights([ad], { query: 'protecao veicular' });
  const toolkit = buildCampaignToolkit({ ad, query: 'protecao veicular' });
  assert.equal(insights.totalAds, 1);
  assert.equal(toolkit.variants.length, 3);
  assert.equal(toolkit.matrix.length, 6);
  toolkit.variants.forEach((variant) => assert.equal(variant.compliance.safe, true));

  const unsafe = analyzeCompliance('Seguro 100% garantido sem nenhum risco', { niche: 'protecao veicular' });
  assert.equal(unsafe.safe, false);
  assert.ok(unsafe.risks.length >= 2);

  const utm = buildUtmUrl('https://moove.example/cotacao', {
    utm_campaign: 'teste_a',
    utm_content: 'video_1',
  });
  const info = analyzeLandingUrl(utm);
  assert.equal(info.hasUtm, true);
  assert.equal(info.utm.utm_campaign, 'teste_a');
});

test('persists jobs, favorites, watchlist snapshots and change alerts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-ad-store-'));
  const filePath = path.join(tempDir, 'store.json');
  try {
    const store = createAdResearchStore({ filePath });
    const job = {
      jobId: 'job-1',
      status: 'completed',
      query: 'protecao veicular',
      results: [fixtureAd()],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveJob(job);
    const watchlist = store.saveWatchlist({ query: job.query, intervalHours: 6 });
    store.recordSnapshot({ watchlistId: watchlist.id, job });
    assert.equal(store.listAlerts().length, 0);

    const changedJob = {
      ...job,
      jobId: 'job-2',
      results: [fixtureAd({ adText: `${fixtureAd().adText} Condicao atualizada.` })],
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    store.saveJob(changedJob);
    store.recordSnapshot({ watchlistId: watchlist.id, job: changedJob });
    assert.equal(store.listAlerts().length, 1);
    assert.equal(store.listAlerts()[0].counts.changed, 1);

    store.saveFavorite({
      jobId: job.jobId,
      ad: fixtureAd({
        strengthExplanation: 'Forca estimada por estabilidade.',
        scoreBreakdown: { relevance: 80, stability: 72 },
        confidence: { score: 88, label: 'alta' },
      }),
      notes: 'Referencia de gancho',
      tags: ['video'],
    });
    assert.equal(store.listFavorites()[0].notes, 'Referencia de gancho');
    assert.equal(store.listFavorites()[0].ad.scoreBreakdown.stability, 72);
    assert.equal(store.listFavorites()[0].ad.confidence.label, 'alta');

    const reloaded = createAdResearchStore({ filePath });
    assert.equal(reloaded.getJob('job-2').query, 'protecao veicular');
    assert.equal(reloaded.listFavorites().length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('issues automatic same-origin sessions and rate-limits heavy searches', () => {
  const guard = createAdResearchAccessGuard({ searchLimit: 1, mutationLimit: 2, windowMs: 60_000 });
  const req = {
    headers: {
      host: 'zapbot.test',
      origin: 'https://zapbot.test',
      'user-agent': 'test-browser',
    },
    socket: { remoteAddress: '203.0.113.10' },
  };
  const session = guard.issue(req);
  assert.ok(session.token);
  req.headers['x-ad-research-token'] = session.token;

  let nextCalls = 0;
  const firstResponse = { setHeader() {}, status() { return this; }, json() { return this; } };
  guard.search(req, firstResponse, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);

  let statusCode = 0;
  const secondResponse = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json() { return this; },
  };
  guard.search(req, secondResponse, () => { nextCalls += 1; });
  assert.equal(statusCode, 429);
  assert.equal(nextCalls, 1);

  delete req.headers['x-ad-research-token'];
  req.headers.cookie = `other=value; zapbot_ad_session=${encodeURIComponent(session.token)}`;
  let readCalls = 0;
  guard.read(req, secondResponse, () => { readCalls += 1; });
  assert.equal(readCalls, 1);
});
