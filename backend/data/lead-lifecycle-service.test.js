import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-lifecycle-test-'));
process.env.APP_STORAGE_DIR = storageRoot;

const manager = await import(`./leads-manager.js?lifecycle-test=${Date.now()}`);
const lifecycle = await import(`./lead-lifecycle-service.js?test=${Date.now()}`);
const reminders = await import(`./reminders-repository.js?test=${Date.now()}`);
const dataDir = path.join(storageRoot, 'data');

function resetStorage() {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}

test('archives reminders, restores them for review and resumes only on command', async () => {
  resetStorage();
  manager.saveLead('5511944411111', {
    phone: '5511944411111',
    status: 'talking',
    history: [{ role: 'user', content: 'preciso de ajuda', ts: Date.now() }],
  });
  await reminders.createReminder({
    lead_key: '5511944411111',
    reminder_text: 'Retorno de teste',
    due_at: new Date(Date.now() - 3600000).toISOString(),
  });

  const archived = await lifecycle.archiveLeads(['5511944411111'], { origin: 'dashboard' });
  assert.equal(archived.deleted, 1);
  assert.equal((await reminders.listOpenReminders({ limit: 10 })).length, 0);
  assert.equal((await reminders.getLatestOpenReminderForLead('5511944411111')).paused, true);

  const restored = await lifecycle.restoreLeads(['5511944411111'], { origin: 'dashboard' });
  assert.equal(restored.restored, 1);
  const pendingReview = await reminders.getLatestOpenReminderForLead('5511944411111');
  assert.equal(pendingReview.paused, true);
  assert.equal(pendingReview.review_required, true);

  await reminders.resumeRemindersForLead('5511944411111');
  assert.equal((await reminders.listOpenReminders({ limit: 10 })).length, 1);
});

test('does not create a paused reminder state when the lead has no reminder', async () => {
  resetStorage();
  manager.saveLead('5511944422222', {
    phone: '5511944422222',
    status: 'talking',
    history: [{ role: 'user', content: 'oi', ts: Date.now() }],
  });

  const archived = await lifecycle.archiveLeads(['5511944422222'], { origin: 'dashboard' });
  assert.equal(archived.deleted, 1);
  assert.equal(archived.remindersPaused, 0);
  assert.equal(archived.reminderCount, 0);
  assert.equal(reminders.getReminderState('5511944422222'), null);

  await lifecycle.restoreLeads(['5511944422222'], { origin: 'dashboard' });
  assert.equal(reminders.getReminderState('5511944422222'), null);
});

test('permanent deletion purges the trashed lead and its reminder', async () => {
  resetStorage();
  manager.saveLead('5511933311111', { phone: '5511933311111', status: 'new', history: [] });
  await reminders.createReminder({
    lead_key: '5511933311111',
    reminder_text: 'Nao deve permanecer',
    due_at: new Date(Date.now() + 3600000).toISOString(),
  });
  await lifecycle.archiveLeads(['5511933311111'], { origin: 'dashboard' });
  const result = await lifecycle.deleteLeadsPermanently(['5511933311111'], { origin: 'dashboard' });

  assert.equal(result.permanentlyDeleted, 1);
  assert.equal(manager.getDeletedLead('5511933311111'), null);
  assert.equal(await reminders.getLatestOpenReminderForLead('5511933311111'), null);
  assert.ok(result.backup.backupId);
});

test('historical reclassification uses current deterministic intent rules without messaging customers', async () => {
  resetStorage();
  manager.saveLead('5511922211111', {
    phone: '5511922211111',
    status: 'talking',
    lastIntent: 'general_question',
    history: [{ role: 'user', content: 'manda a segunda via do boleto pfv', ts: Date.now() }],
  });

  const result = await lifecycle.reclassifyHistoricalLeads();
  const lead = manager.getLead('5511922211111');
  assert.equal(result.updated, 1);
  assert.equal(lead.lastIntent, 'boleto_request');
  assert.equal(lead.history.length, 1);
});

test.after(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});
