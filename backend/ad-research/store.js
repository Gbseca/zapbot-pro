import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../storage/paths.js';
import { hashText, normalizeText } from './utils.js';

const DEFAULT_STORE_FILE = process.env.AD_RESEARCH_STORE_FILE
  ? path.resolve(process.env.AD_RESEARCH_STORE_FILE)
  : path.join(DATA_DIR, 'ad-research.json');

const DEFAULT_LIMITS = Object.freeze({
  jobs: 40,
  cacheEntries: 40,
  watchlists: 30,
  favorites: 250,
  snapshots: 180,
  alerts: 180,
  feedback: 300,
});

function emptyState() {
  return {
    version: 2,
    jobs: [],
    cache: [],
    watchlists: [],
    favorites: [],
    snapshots: [],
    alerts: [],
    feedback: [],
    updatedAt: new Date().toISOString(),
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeDate(value, fallback = null) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeState(value = {}) {
  const fallback = emptyState();
  return {
    ...fallback,
    ...value,
    version: 2,
    jobs: asArray(value.jobs),
    cache: asArray(value.cache),
    watchlists: asArray(value.watchlists),
    favorites: asArray(value.favorites),
    snapshots: asArray(value.snapshots),
    alerts: asArray(value.alerts),
    feedback: asArray(value.feedback),
  };
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) return emptyState();
  try {
    return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    console.warn(`[AdResearchStore] Failed to read ${path.basename(filePath)}: ${error.message}`);
    return emptyState();
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2));
  fs.renameSync(tempPath, filePath);
}

function newestFirst(left, right) {
  return Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0);
}

function compactAd(ad = {}) {
  return {
    id: String(ad.id || ad.libraryId || ''),
    libraryId: String(ad.libraryId || ''),
    advertiserName: String(ad.advertiserName || ''),
    advertiserProfileUrl: String(ad.advertiserProfileUrl || ''),
    adText: String(ad.adText || ''),
    copySummary: String(ad.copySummary || ''),
    deliveryStart: ad.deliveryStart || null,
    deliveryAgeDays: Number(ad.deliveryAgeDays || 0),
    stabilityLabel: String(ad.stabilityLabel || ''),
    creativeCount: Number(ad.creativeCount || 0),
    multipleVersions: !!ad.multipleVersions,
    landingUrl: String(ad.landingUrl || ''),
    landingDomain: String(ad.landingDomain || ''),
    landing: clone(ad.landing || {}),
    adUrl: String(ad.adUrl || ''),
    mediaPreviewUrl: String(ad.mediaPreviewUrl || ''),
    mediaSourceUrl: String(ad.mediaSourceUrl || ''),
    mediaType: String(ad.mediaType || 'unknown'),
    mediaWidth: Number(ad.mediaWidth || 0) || null,
    mediaHeight: Number(ad.mediaHeight || 0) || null,
    mediaAspectRatio: Number(ad.mediaAspectRatio || 0) || null,
    videoDuration: Number(ad.videoDuration || 0) || null,
    ctaLabel: String(ad.ctaLabel || ''),
    strengthScore: Number(ad.strengthScore ?? ad.popularityScore ?? 0),
    strengthLabel: String(ad.strengthLabel || ''),
    strengthReasons: asArray(ad.strengthReasons).slice(0, 8),
    strengthExplanation: String(ad.strengthExplanation || ''),
    scoreBreakdown: clone(ad.scoreBreakdown || {}),
    relevanceScore: Number(ad.relevanceScore || 0),
    confidence: clone(ad.confidence || {}),
    regionLabel: String(ad.regionLabel || ''),
    regionConfidence: String(ad.regionConfidence || 'baixa'),
    regionSource: String(ad.regionSource || ''),
    matchedRegionTerms: asArray(ad.matchedRegionTerms).slice(0, 12),
    analysis: clone(ad.analysis || {}),
    compliance: clone(ad.compliance || {}),
    matchedTerms: asArray(ad.matchedTerms).slice(0, 12),
    capturedAt: ad.capturedAt || new Date().toISOString(),
  };
}

function adIdentity(ad = {}) {
  return String(ad.libraryId || ad.id || hashText([
    normalizeText(ad.advertiserName),
    normalizeText(ad.adText),
    ad.landingDomain || '',
  ].join('|')));
}

function adSignature(ad = {}) {
  return hashText([
    normalizeText(ad.adText),
    ad.landingUrl || '',
    ad.mediaPreviewUrl || '',
    ad.ctaLabel || '',
  ].join('|'));
}

function diffSnapshots(previousAds = [], nextAds = []) {
  const previous = new Map(previousAds.map((ad) => [adIdentity(ad), ad]));
  const next = new Map(nextAds.map((ad) => [adIdentity(ad), ad]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, ad] of next) {
    if (!previous.has(id)) added.push(ad);
    else if (adSignature(previous.get(id)) !== adSignature(ad)) changed.push(ad);
  }
  for (const [id, ad] of previous) {
    if (!next.has(id)) removed.push(ad);
  }

  return { added, removed, changed };
}

export function createAdResearchStore({ filePath = DEFAULT_STORE_FILE, limits = {} } = {}) {
  const safeLimits = { ...DEFAULT_LIMITS, ...limits };
  let state = readState(filePath);

  function persist() {
    state.updatedAt = new Date().toISOString();
    writeState(filePath, state);
  }

  function trim() {
    state.jobs = state.jobs.sort(newestFirst).slice(0, safeLimits.jobs);
    state.cache = state.cache
      .filter((entry) => Date.parse(entry.expiresAt || 0) > Date.now())
      .sort(newestFirst)
      .slice(0, safeLimits.cacheEntries);
    state.watchlists = state.watchlists.sort(newestFirst).slice(0, safeLimits.watchlists);
    state.favorites = state.favorites.sort(newestFirst).slice(0, safeLimits.favorites);
    state.snapshots = state.snapshots.sort(newestFirst).slice(0, safeLimits.snapshots);
    state.alerts = state.alerts.sort(newestFirst).slice(0, safeLimits.alerts);
    state.feedback = state.feedback.sort(newestFirst).slice(0, safeLimits.feedback);
  }

  function saveJob(job) {
    if (!job?.jobId) return null;
    const safeJob = clone(job);
    const index = state.jobs.findIndex((item) => item.jobId === safeJob.jobId);
    if (index >= 0) state.jobs[index] = safeJob;
    else state.jobs.push(safeJob);
    trim();
    persist();
    return clone(safeJob);
  }

  function listJobs(limit = safeLimits.jobs) {
    return clone(state.jobs.sort(newestFirst).slice(0, Math.max(1, Number(limit) || safeLimits.jobs)));
  }

  function getJob(jobId) {
    return clone(state.jobs.find((job) => job.jobId === String(jobId || '')) || null);
  }

  function recoverInterruptedJobs() {
    let changed = false;
    state.jobs = state.jobs.map((job) => {
      if (!['queued', 'running', 'cancelling'].includes(job.status)) return job;
      changed = true;
      return {
        ...job,
        status: 'interrupted',
        error: 'A busca foi interrompida por uma reinicializacao do servidor.',
        updatedAt: new Date().toISOString(),
        progress: {
          ...(job.progress || {}),
          step: 'Busca interrompida',
          message: 'O servidor reiniciou antes da conclusao. Inicie a busca novamente.',
        },
      };
    });
    if (changed) persist();
  }

  function getCache(key) {
    const entry = state.cache.find((item) => item.key === key);
    if (!entry || Date.parse(entry.expiresAt || 0) <= Date.now()) return null;
    return clone(entry.payload);
  }

  function setCache(key, payload, ttlMs = 6 * 60 * 60 * 1000) {
    const now = new Date().toISOString();
    const entry = {
      key,
      payload: clone(payload),
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + Math.max(60_000, Number(ttlMs) || 0)).toISOString(),
    };
    state.cache = state.cache.filter((item) => item.key !== key);
    state.cache.push(entry);
    trim();
    persist();
    return clone(entry);
  }

  function listWatchlists() {
    return clone(state.watchlists.sort(newestFirst));
  }

  function saveWatchlist(input = {}) {
    const now = new Date().toISOString();
    const existing = state.watchlists.find((item) => item.id === input.id);
    const intervalHours = Math.min(168, Math.max(6, Number(input.intervalHours ?? existing?.intervalHours ?? 24) || 24));
    const row = {
      id: input.id || randomUUID(),
      name: String(input.name || existing?.name || input.query || 'Monitoramento').trim().slice(0, 80),
      query: String(input.query ?? existing?.query ?? '').trim().slice(0, 180),
      region: String(input.region ?? existing?.region ?? '').trim().slice(0, 100),
      country: String(input.country ?? existing?.country ?? 'BR').trim().toUpperCase().slice(0, 2) || 'BR',
      mode: String(input.mode ?? existing?.mode ?? 'broad'),
      mediaType: String(input.mediaType ?? existing?.mediaType ?? 'all'),
      sort: String(input.sort ?? existing?.sort ?? 'strength'),
      active: input.active === undefined ? existing?.active !== false : !!input.active,
      intervalHours,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt || null,
      lastJobId: existing?.lastJobId || null,
      nextRunAt: input.nextRunAt || existing?.nextRunAt || now,
    };
    if (!row.query) return null;
    state.watchlists = state.watchlists.filter((item) => item.id !== row.id);
    state.watchlists.push(row);
    trim();
    persist();
    return clone(row);
  }

  function deleteWatchlist(id) {
    const before = state.watchlists.length;
    state.watchlists = state.watchlists.filter((item) => item.id !== String(id || ''));
    state.snapshots = state.snapshots.filter((item) => item.watchlistId !== String(id || ''));
    if (state.watchlists.length !== before) persist();
    return state.watchlists.length !== before;
  }

  function listFavorites() {
    return clone(state.favorites.sort(newestFirst));
  }

  function saveFavorite(input = {}) {
    const ad = compactAd(input.ad || input);
    const adId = String(input.adId || adIdentity(ad));
    if (!adId) return null;
    const existing = state.favorites.find((item) => item.adId === adId);
    const now = new Date().toISOString();
    const row = {
      id: existing?.id || randomUUID(),
      adId,
      jobId: input.jobId || existing?.jobId || null,
      query: String(input.query || existing?.query || '').slice(0, 180),
      notes: String(input.notes ?? existing?.notes ?? '').trim().slice(0, 1200),
      tags: asArray(input.tags ?? existing?.tags).map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12),
      ad: Object.keys(ad).length ? ad : existing?.ad || {},
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    state.favorites = state.favorites.filter((item) => item.adId !== adId);
    state.favorites.push(row);
    trim();
    persist();
    return clone(row);
  }

  function deleteFavorite(adId) {
    const before = state.favorites.length;
    state.favorites = state.favorites.filter((item) => item.adId !== String(adId || ''));
    if (state.favorites.length !== before) persist();
    return state.favorites.length !== before;
  }

  function recordSnapshot({ watchlistId, job }) {
    if (!watchlistId || !job?.jobId) return null;
    const ads = asArray(job.results).slice(0, 80).map(compactAd);
    const previous = state.snapshots
      .filter((item) => item.watchlistId === watchlistId)
      .sort(newestFirst)[0] || null;
    const changes = diffSnapshots(previous?.ads || [], ads);
    const now = new Date().toISOString();
    const snapshot = {
      id: randomUUID(),
      watchlistId,
      jobId: job.jobId,
      query: job.query,
      ads,
      counts: {
        total: ads.length,
        added: changes.added.length,
        removed: changes.removed.length,
        changed: changes.changed.length,
      },
      createdAt: now,
      updatedAt: now,
    };
    state.snapshots.push(snapshot);

    if (previous && (changes.added.length || changes.removed.length || changes.changed.length)) {
      state.alerts.push({
        id: randomUUID(),
        watchlistId,
        jobId: job.jobId,
        type: 'watchlist_changes',
        title: `Mudancas detectadas em ${job.query}`,
        message: `${changes.added.length} novo(s), ${changes.changed.length} alterado(s) e ${changes.removed.length} removido(s).`,
        counts: snapshot.counts,
        adIds: {
          added: changes.added.map(adIdentity).slice(0, 20),
          changed: changes.changed.map(adIdentity).slice(0, 20),
          removed: changes.removed.map(adIdentity).slice(0, 20),
        },
        read: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    const watchlist = state.watchlists.find((item) => item.id === watchlistId);
    if (watchlist) {
      watchlist.lastRunAt = now;
      watchlist.lastJobId = job.jobId;
      watchlist.nextRunAt = new Date(Date.now() + watchlist.intervalHours * 60 * 60 * 1000).toISOString();
      watchlist.updatedAt = now;
    }

    trim();
    persist();
    return clone({ snapshot, changes });
  }

  function listSnapshots({ watchlistId = null, limit = 30 } = {}) {
    return clone(state.snapshots
      .filter((item) => !watchlistId || item.watchlistId === watchlistId)
      .sort(newestFirst)
      .slice(0, Math.max(1, Number(limit) || 30)));
  }

  function listAlerts({ unreadOnly = false, limit = 80 } = {}) {
    return clone(state.alerts
      .filter((item) => !unreadOnly || !item.read)
      .sort(newestFirst)
      .slice(0, Math.max(1, Number(limit) || 80)));
  }

  function markAlertsRead(ids = []) {
    const wanted = new Set(asArray(ids).map(String));
    const markAll = wanted.size === 0;
    let changed = false;
    state.alerts = state.alerts.map((item) => {
      if (item.read || (!markAll && !wanted.has(String(item.id)))) return item;
      changed = true;
      return { ...item, read: true, updatedAt: new Date().toISOString() };
    });
    if (changed) persist();
    return listAlerts();
  }

  function saveFeedback(input = {}) {
    const adId = String(input.adId || '').trim();
    if (!adId) return null;
    const existing = state.feedback.find((item) => item.adId === adId && item.campaignKey === String(input.campaignKey || 'default'));
    const now = new Date().toISOString();
    const row = {
      id: existing?.id || randomUUID(),
      adId,
      jobId: input.jobId || existing?.jobId || null,
      campaignKey: String(input.campaignKey || existing?.campaignKey || 'default').trim().slice(0, 80),
      outcome: String(input.outcome || existing?.outcome || 'testing').trim().slice(0, 30),
      leads: Math.max(0, Number(input.leads ?? existing?.leads ?? 0) || 0),
      conversions: Math.max(0, Number(input.conversions ?? existing?.conversions ?? 0) || 0),
      spend: Math.max(0, Number(input.spend ?? existing?.spend ?? 0) || 0),
      notes: String(input.notes ?? existing?.notes ?? '').trim().slice(0, 1200),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    state.feedback = state.feedback.filter((item) => item.id !== row.id);
    state.feedback.push(row);
    trim();
    persist();
    return clone(row);
  }

  function listFeedback({ adId = null, limit = 100 } = {}) {
    return clone(state.feedback
      .filter((item) => !adId || item.adId === adId)
      .sort(newestFirst)
      .slice(0, Math.max(1, Number(limit) || 100)));
  }

  function stats() {
    return {
      filePath,
      jobs: state.jobs.length,
      cacheEntries: state.cache.length,
      watchlists: state.watchlists.length,
      activeWatchlists: state.watchlists.filter((item) => item.active).length,
      favorites: state.favorites.length,
      snapshots: state.snapshots.length,
      unreadAlerts: state.alerts.filter((item) => !item.read).length,
      feedback: state.feedback.length,
      updatedAt: state.updatedAt,
    };
  }

  recoverInterruptedJobs();

  return {
    filePath,
    saveJob,
    listJobs,
    getJob,
    getCache,
    setCache,
    listWatchlists,
    saveWatchlist,
    deleteWatchlist,
    listFavorites,
    saveFavorite,
    deleteFavorite,
    recordSnapshot,
    listSnapshots,
    listAlerts,
    markAlertsRead,
    saveFeedback,
    listFeedback,
    stats,
  };
}
