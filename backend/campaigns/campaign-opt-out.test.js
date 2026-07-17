import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRecentCampaignContact, isCampaignOptOutMessage } from './campaign-opt-out.js';

test('accepts explicit campaign opt-out phrases', () => {
  assert.equal(isCampaignOptOutMessage('SAIR'), true);
  assert.equal(isCampaignOptOutMessage('por favor pare de mandar mensagens'), true);
  assert.equal(isCampaignOptOutMessage('remover meu numero'), true);
});

test('does not confuse association cancellation or ordinary refusals with campaign opt-out', () => {
  assert.equal(isCampaignOptOutMessage('quero cancelar minha protecao veicular'), false);
  assert.equal(isCampaignOptOutMessage('nao quero fazer cotacao agora'), false);
  assert.equal(isCampaignOptOutMessage('parar o carro na oficina'), false);
});

test('requires recent campaign context', () => {
  const store = { getRecentRecipientSends: () => [] };
  assert.equal(hasRecentCampaignContact({ lead: {}, phone: '11999999999', store }), false);
  assert.equal(hasRecentCampaignContact({ lead: { campaignSentAt: new Date().toISOString() }, store }), true);
});
