import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-leads-test-'));
process.env.APP_STORAGE_DIR = storageRoot;

const manager = await import(`./leads-manager.js?test=${Date.now()}`);
const dataDir = path.join(storageRoot, 'data');

function resetStorage() {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}

test('derives operator-facing stages without mixing campaign sends with conversations', () => {
  assert.equal(manager.deriveLeadPipelineStage({ status: 'new', source: 'campaign', history: [] }), 'waiting');
  assert.equal(manager.deriveLeadPipelineStage({ status: 'talking', history: [{ role: 'user', content: 'oi' }] }), 'active');
  assert.equal(manager.deriveLeadPipelineStage({ status: 'qualified', history: [] }), 'qualified');
  assert.equal(manager.deriveLeadPipelineStage({ status: 'cold', history: [] }), 'closed');
  assert.equal(manager.deriveLeadPipelineStage({
    status: 'human_requested',
    crmStage: 'closed',
    history: [{ role: 'user', content: 'preciso de ajuda' }],
  }), 'attention');
  assert.equal(manager.toLeadSummary({ status: 'payment_claimed' }).automationPaused, true);
  assert.equal(manager.toLeadSummary({ status: 'transferred' }).automationPaused, true);
  assert.equal(manager.toLeadSummary({ status: 'awaiting_phone_for_handoff' }).automationPaused, false);
});

test('preserves lead fields and emits a notification only when a customer responds', () => {
  resetStorage();
  const events = [];
  const unsubscribe = manager.subscribeLeadEvents((event) => events.push(event));

  manager.saveLead('5511999999999', {
    status: 'new',
    source: 'campaign',
    campaignSentAt: new Date().toISOString(),
    history: [{ role: 'assistant', content: 'Ola' }],
    createdAt: new Date().toISOString(),
  });
  manager.updateLead('5511999999999', {
    status: 'talking',
    history: [
      { role: 'assistant', content: 'Ola' },
      { role: 'user', content: 'quero saber mais' },
    ],
  });

  const lead = manager.getLead('5511999999999');
  assert.equal(lead.source, 'campaign');
  assert.equal(lead.status, 'talking');
  assert.equal(events[0].notification, null);
  assert.equal(events[1].notification.kind, 'new_conversation');
  assert.equal(events[1].overview.counts.active, 1);
  assert.equal(events[1].overview.counts.waiting, 0);
  unsubscribe();
});

test('critical lead events notify globally without exposing customer data', () => {
  resetStorage();
  const events = [];
  const unsubscribe = manager.subscribeLeadEvents((event) => events.push(event));

  manager.saveLead('5511988887777', {
    name: 'Cliente reservado',
    status: 'talking',
    history: [{ role: 'user', content: 'mensagem confidencial' }],
  });
  events.length = 0;
  manager.updateLead('5511988887777', { status: 'app_blocked' });

  assert.equal(events.length, 1);
  assert.equal(events[0].notification.kind, 'attention_required');
  const payload = JSON.stringify(events[0]);
  assert.doesNotMatch(payload, /5511988887777|Cliente reservado|mensagem confidencial/);
  unsubscribe();
});

test('bulk CRM moves do not alter the automation status', () => {
  resetStorage();
  manager.saveLead('one', { status: 'talking', history: [{ role: 'user', content: 'oi' }] });
  manager.saveLead('two', { status: 'qualified', history: [{ role: 'user', content: 'cotacao' }] });

  const result = manager.bulkUpdateLeads(['one', 'two'], { crmStage: 'closed' }, { origin: 'dashboard' });
  assert.equal(result.updated, 2);
  assert.equal(manager.getLead('one').status, 'talking');
  assert.equal(manager.getLead('two').status, 'qualified');
  assert.equal(manager.deriveLeadPipelineStage(manager.getLead('one')), 'closed');
});

test('delete, bulk delete and clear move records to a recoverable trash', () => {
  resetStorage();
  manager.saveLead('one', { status: 'new', history: [] });
  manager.saveLead('two', { status: 'talking', history: [{ role: 'user', content: 'oi' }] });
  manager.saveLead('three', { status: 'cold', history: [] });

  assert.equal(manager.deleteLead('one', { origin: 'dashboard' }), true);
  assert.equal(manager.bulkDeleteLeads(['two'], { origin: 'dashboard' }).deleted, 1);
  assert.equal(manager.getAllLeads().length, 1);
  assert.equal(manager.getDeletedLeads().length, 2);

  const restored = manager.restoreDeletedLeads(['one'], { origin: 'dashboard' });
  assert.equal(restored.restored, 1);
  assert.equal(manager.getLead('one').number, 'one');
  assert.equal(manager.clearAllLeads({ origin: 'dashboard' }), 2);
  assert.equal(manager.getAllLeads().length, 0);
  assert.equal(manager.getDeletedLeads().length, 3);
});

test('summary and CSV exports are compact and correctly escaped', () => {
  resetStorage();
  manager.saveLead('one', {
    status: 'talking',
    name: 'Cliente "Teste"',
    history: [{ role: 'user', content: 'quero uma cotacao' }],
  });
  const summary = manager.getAllLeads({ summary: true })[0];
  assert.equal(summary.pipelineStage, 'active');
  assert.equal(summary.hasCustomerMessage, true);
  assert.equal(Object.hasOwn(summary, 'history'), false);
  assert.match(manager.exportLeadsCSV(), /Cliente ""Teste""/);
});

test.after(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});
