import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import CampaignQueue from './campaign-queue.js';
import { createCampaignStore } from './campaign-store.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-campaign-queue-'));
  t.after(() => {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  });
  return createCampaignStore({ file: path.join(root, 'campaigns.json'), mediaDirectory: path.join(root, 'media') });
}

function campaign(store, overrides = {}) {
  return store.createCampaign({
    name: 'Fila segura',
    intent: 'sales',
    audience: {
      recipients: [{ phone: '11999999999', fields: { nome: 'Ana' } }],
      consentConfirmed: true,
      consentSource: 'Formulario',
    },
    content: {
      blocks: [{ id: 'texto', type: 'text', enabled: true, text: 'Oi, {{nome}}!' }],
      appendOptOut: false,
      variableDefaults: {},
    },
    delivery: {
      startMode: 'now',
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      useWindow: false,
      intervalMode: 'fixed',
      intervalFixed: 5,
      typing: false,
      flowControl: { enabled: false },
      dailyLimit: { enabled: false },
      frequencyCap: { enabled: false },
    },
    ...overrides,
  });
}

function fakeDependencies() {
  const leads = new Map();
  return {
    leads: {
      get: key => leads.get(key) || null,
      getAll: () => [...leads.values()],
      save: (key, value) => leads.set(key, value),
    },
    findActiveConsultant: async () => null,
    upsertLidPhoneMapping: async () => null,
    leadsMap: leads,
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timeout aguardando fila.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('never retries a payload accepted without delivery confirmation', async (t) => {
  const store = fixture(t);
  const draft = campaign(store);
  store.updateCampaign(draft.id, { content: { aiRepliesEnabled: false, aiInstructions: 'Priorize a duvida atual.' } });
  let sends = 0;
  const wa = {
    getStatus: () => ({ status: 'connected' }),
    sendTyping: async () => null,
    sendCampaignBlock: async () => {
      sends += 1;
      return { messageId: `m-${sends}`, resolvedJid: '5511999999999@s.whatsapp.net', targetKind: 'jid_phone' };
    },
    waitForOutboundFinal: async messageId => ({ status: 'delivery_timeout', messageId, error: 'timeout' }),
  };
  const dependencies = fakeDependencies();
  const queue = new CampaignQueue(wa, null, { campaignStore: store, clock: () => Date.UTC(2026, 6, 16, 15), ...dependencies });
  queue.loadCampaign(draft.id);
  await queue.start();
  await waitFor(() => queue.getProgress().status === 'completed');
  assert.equal(sends, 1);
  assert.equal(queue.getProgress().queue[0].status, 'accepted_unconfirmed');
  assert.equal(store.getDailyUsage('2026-07-16'), 1);
  assert.equal(dependencies.leadsMap.size, 1);
  const seededLead = dependencies.leadsMap.get('5511999999999');
  assert.equal(seededLead.campaignVariantId, 'original');
  assert.equal(seededLead.campaignAiRepliesEnabled, false);
  assert.equal(seededLead.campaignAiInstructions, 'Priorize a duvida atual.');
});

test('restores an in-flight recipient as uncertain instead of resending it', (t) => {
  const store = fixture(t);
  const draft = campaign(store);
  store.updateCampaign(draft.id, {
    status: 'running',
    runtime: {
      currentIndex: 0,
      queue: [{
        id: 'q1',
        recipient: { phone: '11999999999', fields: { nome: 'Ana' } },
        number: '11999999999',
        normalizedNumber: '5511999999999',
        status: 'sending',
        blockResults: [],
      }],
      stats: { total: 1, pending: 1 },
    },
  });
  let sends = 0;
  const queue = new CampaignQueue({
    getStatus: () => ({ status: 'connected' }),
    sendCampaignBlock: async () => { sends += 1; },
  }, null, { campaignStore: store, ...fakeDependencies() });
  const progress = queue.getProgress();
  assert.equal(progress.status, 'recovering');
  assert.equal(progress.queue[0].status, 'accepted_unconfirmed');
  assert.equal(progress.stats.pending, 0);
  assert.equal(sends, 0);
});

test('assigns the same split-test variant to the same phone', (t) => {
  const store = fixture(t);
  const draft = campaign(store, {
    content: {
      blocks: [{ id: 'original', type: 'text', enabled: true, text: 'Original' }],
      variants: [
        { id: 'a', enabled: true, weight: 1, message: 'Variante A' },
        { id: 'b', enabled: true, weight: 1, message: 'Variante B' },
      ],
      variantMode: 'split',
      appendOptOut: false,
    },
  });
  const queue = new CampaignQueue({ getStatus: () => ({ status: 'connected' }) }, null, { campaignStore: store, ...fakeDependencies() });
  queue.loadCampaign(draft.id);
  const item = queue.queue[0];
  queue._blocksForItem(item);
  const first = item.variantId;
  queue._blocksForItem(item);
  assert.equal(item.variantId, first);
});

test('pauses before a contact when its blocks would exceed the daily payload limit', async (t) => {
  const store = fixture(t);
  const draft = campaign(store, {
    content: {
      blocks: [
        { id: 'parte-1', type: 'text', enabled: true, text: 'Primeira parte' },
        { id: 'parte-2', type: 'text', enabled: true, text: 'Segunda parte' },
      ],
      appendOptOut: false,
    },
    delivery: {
      startMode: 'now',
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      useWindow: false,
      intervalMode: 'fixed',
      intervalFixed: 5,
      typing: false,
      flowControl: { enabled: false },
      dailyLimit: { enabled: true, max: 1 },
      frequencyCap: { enabled: false },
    },
  });
  let sends = 0;
  const queue = new CampaignQueue({
    getStatus: () => ({ status: 'connected' }),
    sendCampaignBlock: async () => { sends += 1; },
  }, null, { campaignStore: store, ...fakeDependencies() });
  queue.loadCampaign(draft.id);
  await queue.start();
  await waitFor(() => queue.getProgress().status === 'paused');
  assert.equal(sends, 0);
  assert.equal(queue.getProgress().waitReason, 'daily_limit');
  assert.equal(queue.getProgress().queue[0].status, 'pending');
});

test('skips a recipient that reached the configured frequency cap', (t) => {
  const store = fixture(t);
  const previous = campaign(store);
  store.updateCampaign(previous.id, {
    status: 'completed',
    runtime: {
      queue: [{
        number: '11999999999',
        normalizedNumber: '5511999999999',
        status: 'confirmed',
        acceptedAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
      }],
    },
  });
  const next = campaign(store, {
    name: 'Nova campanha',
    delivery: {
      startMode: 'now',
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      useWindow: false,
      intervalMode: 'fixed',
      intervalFixed: 5,
      typing: false,
      flowControl: { enabled: false },
      dailyLimit: { enabled: false },
      frequencyCap: { enabled: true, max: 1, days: 7 },
    },
  });
  const queue = new CampaignQueue({ getStatus: () => ({ status: 'connected' }) }, null, { campaignStore: store, ...fakeDependencies() });
  queue.loadCampaign(next.id);
  const progress = queue.getProgress();
  assert.equal(progress.queue[0].status, 'skipped');
  assert.equal(progress.stats.skipped, 1);
  assert.match(progress.queue[0].error, /limite de frequencia/i);
});

test('sends enabled content blocks in their configured order', async (t) => {
  const store = fixture(t);
  const draft = campaign(store, {
    content: {
      blocks: [
        { id: 'abertura', type: 'text', enabled: true, text: 'Oi' },
        { id: 'escolha', type: 'poll', enabled: true, question: 'Qual opcao?', options: ['A', 'B'] },
        { id: 'fechamento', type: 'text', enabled: true, text: 'Obrigado' },
      ],
      appendOptOut: false,
    },
  });
  const sent = [];
  const queue = new CampaignQueue({
    getStatus: () => ({ status: 'connected' }),
    sendTyping: async () => null,
    sendCampaignBlock: async (_target, block) => {
      sent.push(block.type);
      return { messageId: `ordered-${sent.length}`, resolvedJid: '5511999999999@s.whatsapp.net', targetKind: 'jid_phone' };
    },
    waitForOutboundFinal: async messageId => ({ status: 'confirmed', messageId }),
  }, null, { campaignStore: store, ...fakeDependencies() });
  queue.loadCampaign(draft.id);
  await queue.start();
  await waitFor(() => queue.getProgress().status === 'completed');
  assert.deepEqual(sent, ['text', 'poll', 'text']);
  assert.equal(queue.getProgress().queue[0].status, 'confirmed');
});

test('keeps an accepted first block and records a later block as a partial failure', async (t) => {
  const store = fixture(t);
  const draft = campaign(store, {
    content: {
      blocks: [
        { id: 'parte-1', type: 'text', enabled: true, text: 'Parte 1' },
        { id: 'parte-2', type: 'text', enabled: true, text: 'Parte 2' },
      ],
      appendOptOut: false,
    },
  });
  let sends = 0;
  const queue = new CampaignQueue({
    getStatus: () => ({ status: 'connected' }),
    sendTyping: async () => null,
    sendCampaignBlock: async () => {
      sends += 1;
      if (sends === 2) throw new Error('falha controlada');
      return { messageId: 'partial-1', resolvedJid: '5511999999999@s.whatsapp.net', targetKind: 'jid_phone' };
    },
    waitForOutboundFinal: async messageId => ({ status: 'confirmed', messageId }),
  }, null, { campaignStore: store, ...fakeDependencies() });
  queue.loadCampaign(draft.id);
  await queue.start();
  await waitFor(() => queue.getProgress().status === 'completed');
  const item = queue.getProgress().queue[0];
  assert.equal(sends, 2);
  assert.equal(item.status, 'partial_failed');
  assert.equal(item.blockResults[0].status, 'confirmed');
  assert.equal(item.blockResults[1].status, 'failed');
});

test('opens a new flow-control window after the configured interval', (t) => {
  const store = fixture(t);
  const draft = campaign(store, {
    delivery: {
      startMode: 'now',
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      useWindow: false,
      intervalMode: 'fixed',
      intervalFixed: 5,
      typing: false,
      flowControl: { enabled: true, maxContacts: 1, windowMinutes: 10 },
      dailyLimit: { enabled: false },
      frequencyCap: { enabled: false },
    },
  });
  let now = Date.UTC(2026, 6, 16, 15);
  const queue = new CampaignQueue({ getStatus: () => ({ status: 'connected' }) }, null, {
    campaignStore: store,
    clock: () => now,
    ...fakeDependencies(),
  });
  queue.loadCampaign(draft.id);
  queue._recordContactAttempt();
  assert.ok(queue.getFlowWaitMs() > 0);
  now += 11 * 60 * 1000;
  assert.equal(queue.getFlowWaitMs(), 0);
  assert.equal(queue.getFlowControlSnapshot().sentInWindow, 0);
});

test('keeps a confirmed delivery when CRM context persistence fails', async (t) => {
  const store = fixture(t);
  const draft = campaign(store);
  let sends = 0;
  const dependencies = fakeDependencies();
  const queue = new CampaignQueue({
    getStatus: () => ({ status: 'connected' }),
    sendTyping: async () => null,
    sendCampaignBlock: async () => {
      sends += 1;
      return { messageId: 'crm-context-failure', resolvedJid: '5511999999999@s.whatsapp.net', targetKind: 'jid_phone' };
    },
    waitForOutboundFinal: async messageId => ({ status: 'confirmed', messageId }),
  }, null, {
    campaignStore: store,
    ...dependencies,
    findActiveConsultant: async () => { throw new Error('CRM temporariamente indisponivel'); },
  });
  queue.loadCampaign(draft.id);
  await queue.start();
  await waitFor(() => queue.getProgress().status === 'completed');
  const item = queue.getProgress().queue[0];
  assert.equal(sends, 1);
  assert.equal(item.status, 'confirmed');
  assert.match(item.contextError, /temporariamente indisponivel/i);
});

test('pauses with an internal diagnostic instead of leaving an unhandled queue failure', async (t) => {
  const store = fixture(t);
  const draft = campaign(store);
  const queue = new CampaignQueue({
    getStatus: () => { throw new Error('falha inesperada de status'); },
  }, null, { campaignStore: store, ...fakeDependencies() });
  queue.loadCampaign(draft.id);
  await queue.start();
  await waitFor(() => queue.getProgress().status === 'paused');
  assert.equal(queue.getProgress().waitReason, 'internal_error');
  assert.equal(queue.getProgress().queue[0].status, 'pending');
});

test('never counts an explicitly rejected accepted payload as confirmed', async (t) => {
  const store = fixture(t);
  const draft = campaign(store);
  let sends = 0;
  const queue = new CampaignQueue({
    getStatus: () => ({ status: 'connected' }),
    sendTyping: async () => null,
    sendCampaignBlock: async () => {
      sends += 1;
      return { messageId: 'explicit-rejection', resolvedJid: '5511999999999@s.whatsapp.net', targetKind: 'jid_phone' };
    },
    waitForOutboundFinal: async messageId => ({ status: 'failed', messageId, error: 'rejeitado pelo WhatsApp' }),
  }, null, { campaignStore: store, ...fakeDependencies() });
  queue.loadCampaign(draft.id);
  await queue.start();
  await waitFor(() => queue.getProgress().status === 'completed');
  const progress = queue.getProgress();
  assert.equal(sends, 1);
  assert.equal(progress.queue[0].status, 'failed');
  assert.equal(progress.queue[0].blockResults[0].status, 'failed');
  assert.equal(progress.stats.confirmed, 0);
  assert.equal(progress.stats.failed, 1);
});
