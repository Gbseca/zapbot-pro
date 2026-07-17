import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCampaignStore } from './campaign-store.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-campaign-store-'));
  t.after(() => {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  });
  return {
    root,
    file: path.join(root, 'campaigns.json'),
    mediaDirectory: path.join(root, 'media'),
  };
}

test('persists drafts, nested delivery updates and history', (t) => {
  const paths = fixture(t);
  const store = createCampaignStore(paths);
  const campaign = store.createCampaign({
    name: 'Julho',
    audience: { recipients: [{ phone: '11999999999', fields: { nome: 'Ana' } }] },
    delivery: { frequencyCap: { max: 3 } },
  });
  assert.equal(campaign.name, 'Julho');
  assert.equal(campaign.delivery.frequencyCap.max, 3);
  assert.equal(campaign.delivery.frequencyCap.days, 7);

  store.updateCampaign(campaign.id, { delivery: { frequencyCap: { days: 14 } } });
  const reloaded = createCampaignStore(paths).getCampaign(campaign.id);
  assert.equal(reloaded.delivery.frequencyCap.max, 3);
  assert.equal(reloaded.delivery.frequencyCap.days, 14);
  assert.equal(reloaded.audience.recipients[0].fields.nome, 'Ana');
});

test('stores media safely and removes individual files or the whole draft', (t) => {
  const paths = fixture(t);
  const store = createCampaignStore(paths);
  const campaign = store.createCampaign({ name: 'Com imagem' });
  const media = store.saveMedia(campaign.id, {
    buffer: Buffer.from('fake-image'),
    originalname: '../../foto campanha.jpg',
    mimetype: 'image/jpeg',
    kind: 'image',
  });
  const resolved = store.getMedia(campaign.id, media.id);
  assert.ok(resolved.absolutePath.startsWith(path.resolve(paths.mediaDirectory)));
  assert.equal(resolved.kind, 'image');
  assert.equal(resolved.buffer, undefined);
  assert.equal(store.getMedia(campaign.id, media.id, { includeBuffer: true }).buffer.toString('utf8'), 'fake-image');
  assert.equal(fs.readFileSync(resolved.absolutePath, 'utf8'), 'fake-image');
  assert.equal(store.removeMedia(campaign.id, media.id), true);
  assert.equal(fs.existsSync(resolved.absolutePath), false);
  assert.equal(store.getMedia(campaign.id, media.id), null);
  assert.equal(store.removeMedia(campaign.id, media.id), false);

  const replacement = store.saveMedia(campaign.id, {
    buffer: Buffer.from('replacement-image'),
    originalname: 'nova-foto.jpg',
    mimetype: 'image/jpeg',
  });
  const replacementPath = store.getMedia(campaign.id, replacement.id).absolutePath;
  store.deleteCampaign(campaign.id);
  assert.equal(fs.existsSync(replacementPath), false);
});

test('normalizes suppressions and persistent daily usage', (t) => {
  const paths = fixture(t);
  const store = createCampaignStore(paths);
  store.addSuppression('+55 (11) 98888-7777', { source: 'test' });
  assert.equal(store.isSuppressed('11988887777'), true);
  assert.equal(store.isSuppressed('5511988887777'), true);
  assert.throws(() => store.addSuppression('123'), /invalido/i);
  assert.equal(store.incrementDailyUsage(2, '2026-07-16'), 2);
  assert.equal(createCampaignStore(paths).getDailyUsage('2026-07-16'), 2);
});

test('finds an active campaign that can be recovered', (t) => {
  const paths = fixture(t);
  const store = createCampaignStore(paths);
  const campaign = store.createCampaign({ name: 'Recuperavel' });
  store.updateCampaign(campaign.id, { status: 'running' });
  assert.equal(createCampaignStore(paths).getRecoverableCampaign().id, campaign.id);
});
