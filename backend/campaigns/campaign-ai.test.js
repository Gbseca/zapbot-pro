import assert from 'node:assert/strict';
import test from 'node:test';
import { runCampaignAI } from './campaign-ai.js';

test('removes invisible and bidirectional control characters from deterministic output', async () => {
  const result = await runCampaignAI({
    config: {},
    action: 'natural',
    input: { message: 'Oi\u200B, A\u202Ena!\u2060 Tudo bem?' },
  });

  assert.equal(result.source, 'deterministic');
  assert.equal(result.message, 'Oi, Ana! Tudo bem?');
});

test('removes hidden controls before building deterministic variants', async () => {
  const result = await runCampaignAI({
    config: {},
    action: 'variants',
    input: { message: 'Novidade\u200F para voce.' },
  });

  assert.equal(result.source, 'deterministic');
  assert.equal(result.message, 'Novidade para voce.');
  assert.ok(result.variants.length >= 2);
  assert.ok(result.variants.every(variant => !/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/.test(variant.message)));
});
