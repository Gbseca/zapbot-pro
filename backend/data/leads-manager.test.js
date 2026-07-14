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

test('automatically restores a trashed contact without duplicating the lead', () => {
  resetStorage();
  const events = [];
  const unsubscribe = manager.subscribeLeadEvents((event) => events.push(event));
  manager.saveLead('5511987651234', {
    phone: '5511987651234',
    status: 'blocked',
    crmStage: 'closed',
    history: [{ role: 'user', content: 'conversa antiga', ts: 10 }],
  });
  manager.deleteLead('5511987651234', { origin: 'dashboard', reason: 'manual_delete' });
  events.length = 0;

  const recovered = manager.recoverDeletedLeadForIncoming({
    preferredKey: '5511987651234',
    identifiers: ['5511987651234', '5511987651234@s.whatsapp.net'],
  });

  assert.equal(recovered.key, '5511987651234');
  assert.equal(manager.getDeletedLeads().length, 0);
  assert.equal(manager.getAllLeads().length, 1);
  assert.equal(recovered.lead.status, 'new');
  assert.equal(recovered.lead.crmStage, 'attention');
  assert.equal(recovered.lead.history[0].content, 'conversa antiga');
  assert.equal(recovered.lead.returnedFromTrashCount, 1);
  assert.equal(events.at(-1).notification.kind, 'returned_from_trash');
  unsubscribe();
});

test('restoring over an active duplicate merges history into one phone record', () => {
  resetStorage();
  manager.saveLead('legacy-lid', {
    phone: '5511977711111',
    status: 'cold',
    history: [{ role: 'user', content: 'registro antigo', ts: 1 }],
  });
  manager.deleteLead('legacy-lid', { origin: 'dashboard' });
  manager.saveLead('5511977711111', {
    phone: '5511977711111',
    status: 'talking',
    history: [{ role: 'user', content: 'registro atual', ts: 2 }],
  });

  const result = manager.restoreDeletedLeads(['legacy-lid'], { origin: 'dashboard' });
  const active = manager.getLead('5511977711111');
  assert.equal(result.merged, 1);
  assert.equal(manager.getAllLeads().length, 1);
  assert.equal(manager.getDeletedLeads().length, 0);
  assert.deepEqual(active.history.map((item) => item.content), ['registro antigo', 'registro atual']);
  assert.deepEqual(result.referenceMoves, [{ from: 'legacy-lid', to: '5511977711111' }]);
});

test('detects and manually merges duplicate phone records', () => {
  resetStorage();
  manager.saveLead('first', { phone: '5511966611111', name: 'Primeiro', history: [{ role: 'user', content: 'um', ts: 1 }] });
  manager.saveLead('second', { phone: '5511966611111', name: 'Segundo', history: [{ role: 'user', content: 'dois', ts: 2 }] });
  assert.equal(manager.getDuplicateLeadGroups().length, 1);

  const result = manager.mergeActiveLeads(['first', 'second'], { targetNumber: 'first', origin: 'dashboard' });
  assert.equal(result.merged, 2);
  assert.equal(manager.getAllLeads().length, 1);
  assert.equal(manager.getLead('first').history.length, 2);
  assert.equal(manager.getDuplicateLeadGroups().length, 0);
});

test('supports permanent deletion, retention and internal notes', () => {
  resetStorage();
  manager.updateLeadSettings({ trashRetentionDays: 30 });
  manager.saveLead('one', { phone: '5511955511111', history: [] });
  const note = manager.addInternalNote('one', 'Cliente prefere retorno pela manha.');
  assert.equal(manager.getLead('one').internalNotes[0].id, note.id);
  assert.equal(manager.deleteInternalNote('one', note.id), true);
  manager.deleteLead('one', { origin: 'dashboard' });
  assert.ok(manager.getDeletedLead('one').trashExpiresAt);
  const result = manager.permanentlyDeleteLeads(['one'], { origin: 'dashboard' });
  assert.equal(result.permanentlyDeleted, 1);
  assert.equal(manager.getDeletedLeads().length, 0);
});

test('internal notes do not reset the waiting time of an urgent lead', () => {
  resetStorage();
  const waitingSince = new Date(Date.now() - 40 * 60000).toISOString();
  fs.writeFileSync(path.join(dataDir, 'leads.json'), JSON.stringify({
    legacy: {
      number: 'legacy',
      phone: '5511911111111',
      status: 'human_requested',
      lastInteraction: waitingSince,
      updatedAt: waitingSince,
      history: [{ role: 'user', content: 'preciso de ajuda', ts: Date.now() - 40 * 60000 }],
    },
  }));

  assert.equal(manager.getAllLeads({ summary: true })[0].attentionOverdue, true);
  manager.addInternalNote('legacy', 'Consultor acompanhando o atendimento.');
  const summary = manager.getAllLeads({ summary: true })[0];
  assert.equal(summary.attentionOverdue, true);
  assert.ok(summary.attentionWaitingMinutes >= 39);
  assert.equal(manager.getLead('legacy').attentionStartedAt, waitingSince);
});

test.after(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});
