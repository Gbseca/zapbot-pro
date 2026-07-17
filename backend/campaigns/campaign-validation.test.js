import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCampaignPreflight,
  countCampaignQuestions,
  isCampaignEditLockedStatus,
  prepareCampaignAudience,
  renderCampaignText,
  sanitizeCampaignDraft,
  validateCampaignMedia,
} from './campaign-validation.js';

test('locks campaign editing for every recoverable queue status', () => {
  for (const status of ['running', 'scheduled', 'paused', 'recovering']) {
    assert.equal(isCampaignEditLockedStatus(status), true);
  }
  for (const status of ['draft', 'stopped', 'completed', 'cleared']) {
    assert.equal(isCampaignEditLockedStatus(status), false);
  }
});

function validCampaign(overrides = {}) {
  return {
    name: 'Campanha de teste',
    objective: 'Gerar conversas',
    intent: 'sales',
    audience: {
      recipients: [{ phone: '11999999999', fields: { nome: 'Ana', cidade: 'Campinas' } }],
      consentConfirmed: true,
      consentSource: 'Formulario do site',
    },
    content: {
      blocks: [{ id: 'texto', type: 'text', enabled: true, text: 'Oi, {{nome}}! Posso te contar uma novidade?' }],
      appendOptOut: true,
      optOutText: 'Para nao receber novas mensagens, responda SAIR.',
      variableDefaults: {},
    },
    delivery: {
      startMode: 'now',
      timezone: 'America/Sao_Paulo',
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      useWindow: false,
      intervalMode: 'fixed',
      intervalFixed: 10,
      flowControl: { enabled: true, maxContacts: 10, windowMinutes: 5 },
      dailyLimit: { enabled: true, max: 50 },
      frequencyCap: { enabled: true, max: 2, days: 7 },
    },
    media: {},
    ...overrides,
  };
}

test('normalizes, deduplicates and suppresses audience entries', () => {
  const result = prepareCampaignAudience({
    recipients: [
      { phone: '+55 11 99999-9999', name: 'Ana' },
      { phone: '11999999999', name: 'Duplicada' },
      { phone: '21988887777' },
      { phone: '123' },
    ],
    isSuppressed: phone => phone === '21988887777',
  });
  assert.equal(result.queuedCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.suppressedCount, 1);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.validRecipients[0].fields.nome, 'Ana');
});

test('renders recipient variables and reports unresolved values', () => {
  const rendered = renderCampaignText('Oi, {{nome}} de {{cidade}}. {{modelo}}', {
    phone: '11999999999',
    fields: { nome: 'Ana', cidade: 'Campinas' },
  });
  assert.equal(rendered.text, 'Oi, Ana de Campinas. ');
  assert.deepEqual(rendered.missing, ['modelo']);
});

test('blocks forbidden institutional terms even when accented', () => {
  const campaign = validCampaign({
    content: {
      blocks: [{ id: 'texto', type: 'text', enabled: true, text: 'Conheca nossa apólice e o prêmio.' }],
      appendOptOut: true,
    },
  });
  const preflight = buildCampaignPreflight({ campaign, waStatus: 'connected' });
  assert.equal(preflight.ok, false);
  assert.ok(preflight.blockers.some(item => item.code === 'forbidden_moove_term'));
});

test('approves a compliant campaign and warns without resending frequency-capped contacts', () => {
  const preflight = buildCampaignPreflight({
    campaign: validCampaign(),
    waStatus: 'connected',
    recentSendCount: () => 2,
  });
  assert.equal(preflight.ok, true);
  assert.equal(preflight.frequencyCapped, 1);
  assert.ok(preflight.warnings.some(item => item.code === 'frequency_capped'));
});

test('sanitizes draft fields, block identifiers and preserves the recipient name', () => {
  const draft = sanitizeCampaignDraft({
    name: '  Julho\u200B  ',
    audience: { recipients: [{ phone: '11999999999', name: 'A\u202Ena', secret: 'ignorado' }] },
    content: { blocks: [{ id: 'texto\" onfocus=\"alert(1)', type: 'text', text: 'Oi\u200B Ana\u202E' }] },
    delivery: { allowedWeekdays: [1, 1, 9], intervalFixed: '30' },
  });
  assert.equal(draft.name, 'Julho');
  assert.equal(draft.audience.recipients[0].fields.nome, 'Ana');
  assert.deepEqual(draft.delivery.allowedWeekdays, [1]);
  assert.equal(draft.delivery.intervalFixed, 30);
  assert.equal(draft.content.blocks[0].id, 'texto-onfocus-alert-1');
  assert.equal(draft.content.blocks[0].text, 'Oi Ana');
});

test('blocks more than one question in the same outbound message, including variants', () => {
  const campaign = validCampaign({
    content: {
      blocks: [{ id: 'texto', type: 'text', enabled: true, text: 'Quer conhecer a Moove? Posso explicar agora?' }],
      variants: [{ id: 'b', name: 'B', enabled: true, message: 'Tudo bem? Quer uma cotacao?' }],
      variantMode: 'split',
      appendOptOut: true,
      optOutText: 'Para nao receber novas mensagens, responda SAIR.',
    },
  });
  const preflight = buildCampaignPreflight({ campaign, waStatus: 'connected' });
  assert.equal(countCampaignQuestions(campaign.content.blocks[0].text), 2);
  assert.equal(preflight.ok, false);
  assert.equal(preflight.blockers.filter(item => item.code === 'multiple_questions').length, 2);
});

test('validates media kind, extension, mime type and per-kind size', () => {
  assert.equal(validateCampaignMedia({
    buffer: Buffer.from('%PDF-1.7\n'),
    fileName: 'apresentacao.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    kind: 'document',
  }, 'document'), '');
  assert.match(validateCampaignMedia({
    buffer: Buffer.from('<svg></svg>'),
    fileName: 'imagem.svg',
    mimeType: 'image/svg+xml',
    size: 1024,
  }, 'image'), /nao permitido/i);
  assert.match(validateCampaignMedia({
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    fileName: 'foto.jpg',
    mimeType: 'application/octet-stream',
    size: 1024,
  }, 'image'), /nao corresponde/i);
  assert.match(validateCampaignMedia({
    buffer: Buffer.from('ID3'),
    fileName: 'audio.mp3',
    mimeType: 'audio/mpeg',
    size: (16 * 1024 * 1024) + 1,
  }, 'audio'), /16 MB/i);
  assert.match(validateCampaignMedia({
    buffer: Buffer.from('isto nao e uma imagem'),
    fileName: 'foto.jpg',
    mimeType: 'image/jpeg',
    size: 21,
  }, 'image'), /conteudo do arquivo/i);
});

test('preflight validates media used by an A/B variant', () => {
  const campaign = validCampaign({
    content: {
      blocks: [{ id: 'texto', type: 'text', enabled: true, text: 'Oi, {{nome}}!' }],
      variants: [{
        id: 'midia-b',
        name: 'Midia B',
        enabled: true,
        blocks: [{ id: 'imagem-b', type: 'image', enabled: true, mediaId: 'missing', caption: 'Oi, {{nome}}!' }],
      }],
      variantMode: 'split',
      appendOptOut: true,
      optOutText: 'Para nao receber novas mensagens, responda SAIR.',
      variableDefaults: {},
    },
  });
  const preflight = buildCampaignPreflight({ campaign, waStatus: 'connected' });
  assert.equal(preflight.ok, false);
  assert.ok(preflight.blockers.some(item => item.code === 'media_missing' && item.details?.versionId === 'midia-b'));
});

test('blocks a daily limit that cannot finish one recipient', () => {
  const campaign = validCampaign({
    content: {
      blocks: [
        { id: 'parte-1', type: 'text', enabled: true, text: 'Parte 1' },
        { id: 'parte-2', type: 'text', enabled: true, text: 'Parte 2' },
      ],
      appendOptOut: false,
    },
    delivery: {
      ...validCampaign().delivery,
      dailyLimit: { enabled: true, max: 1 },
    },
  });
  const preflight = buildCampaignPreflight({ campaign, waStatus: 'connected' });
  assert.equal(preflight.ok, false);
  assert.ok(preflight.blockers.some(item => item.code === 'daily_limit_below_contact'));
});
