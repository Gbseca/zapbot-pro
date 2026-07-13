import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-agent-test-'));
const dataDir = path.join(storageDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
process.env.APP_STORAGE_DIR = storageDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.WA_ALLOW_HANDOFF_WITHOUT_PHONE = 'false';

const consultant = {
  name: 'Consultor Chefe',
  number: '5521999990000',
  phone: '5521999990000',
  active: true,
  receive_sales: true,
  receive_support: true,
};

function writeConfig(overrides = {}) {
  const config = {
    aiEnabled: true,
    aiProvider: 'gemini',
    geminiKey: 'test-key-not-used',
    businessHoursStart: '23:59',
    businessHoursEnd: '00:00',
    consultorDistribution: 'first',
    consultors: [consultant],
    ...overrides,
  };
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(config, null, 2));
}

writeConfig();

const { handleIncomingMessage } = await import('./agent.js');
const { executeHandoff } = await import('./handoff.js');
const { getAllLeads, getLead } = await import('../data/leads-manager.js');

class MockWhatsApp {
  constructor({ failConsultant = false } = {}) {
    this.messages = [];
    this.failConsultant = failConsultant;
    this.sequence = 0;
  }

  resolvePhone(value = '') {
    const raw = String(value || '');
    if (raw.includes('@lid')) return null;
    return raw.split('@')[0].split(':')[0].replace(/\D/g, '') || null;
  }

  getInboundRouteContext() {
    return null;
  }

  async sendTyping() {}

  async sendMessage(target, message, _image, options = {}) {
    if (this.failConsultant && String(target) === consultant.phone) {
      throw new Error('consultant delivery failed');
    }
    this.sequence += 1;
    const record = {
      sequence: this.sequence,
      target: String(target),
      message: String(message),
      options,
    };
    this.messages.push(record);
    return {
      status: 'confirmed',
      messageId: `mock-${this.sequence}`,
      resolvedJid: String(target),
    };
  }
}

function textMessage(phone, text) {
  return {
    key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
    pushName: 'Cliente Teste',
    message: { conversation: text },
  };
}

function lidTextMessage(lid, text) {
  return {
    key: { remoteJid: `${lid}@lid`, fromMe: false },
    pushName: 'Cliente LID',
    message: { conversation: text },
  };
}

after(() => {
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test('persists the lead and notifies the consultant before confirming a critical handoff', async () => {
  writeConfig();
  const wa = new MockWhatsApp();
  const phone = '5511987654001';

  await handleIncomingMessage(wa, textMessage(phone, 'preciso de reboque agora'));

  assert.equal(wa.messages.length, 2);
  assert.equal(wa.messages[0].target, consultant.phone);
  assert.equal(wa.messages[1].target, phone);
  assert.match(wa.messages[0].message, /Intencao:\* pedido de reboque ou assistencia/i);
  assert.match(wa.messages[0].message, /Ultima mensagem:\* preciso de reboque agora/i);
  assert.doesNotMatch(wa.messages[1].message, /a caminho/i);

  const lead = getLead(phone);
  assert.ok(lead);
  assert.equal(lead.lastIntent, 'assistance_request');
  assert.equal(lead.status, 'transferred_to_support');
  assert.equal(lead.transferredTo, consultant.phone);
  assert.equal(lead.handoffClientConfirmed, true);
});

test('asks only for WhatsApp on unresolved LID and then completes the same handoff', async () => {
  writeConfig();
  const wa = new MockWhatsApp();
  const lid = '123456789012345';

  await handleIncomingMessage(wa, lidTextMessage(lid, 'quero a segunda via do boleto'));
  assert.equal(wa.messages.length, 1);
  assert.equal(wa.messages[0].target, `${lid}@lid`);
  assert.match(wa.messages[0].message, /WhatsApp com DDD/i);
  assert.equal((wa.messages[0].message.match(/\?/g) || []).length, 1);
  assert.doesNotMatch(wa.messages[0].message, /modelo|ano|placa/i);

  await handleIncomingMessage(wa, lidTextMessage(lid, 'meu whats e 21987654321'));
  assert.equal(wa.messages.length, 3);
  assert.equal(wa.messages[1].target, consultant.phone);
  assert.equal(wa.messages[2].target, `${lid}@lid`);

  const lead = getLead(lid);
  assert.ok(lead);
  assert.equal(lead.phone, '5521987654321');
  assert.equal(lead.lastIntent, 'boleto_request');
  assert.equal(lead.status, 'transferred_to_financial');
});

test('critical routing bypasses business hours for different operational intents', async () => {
  writeConfig({ businessHoursStart: '23:59', businessHoursEnd: '00:00' });
  const wa = new MockWhatsApp();
  const scenarios = [
    ['5511987654011', 'bati o carro', 'evento ocorrido com o veiculo'],
    ['5511987654012', 'meu app nao funciona', 'problema de acesso ao aplicativo'],
    ['5511987654013', 'ja paguei ontem', 'pagamento informado'],
    ['5511987654014', 'quero cancelar minha protecao', 'cancelamento'],
    ['5511987654015', 'estou inadimplente', 'regularizacao de pendencia'],
  ];

  for (const [phone, message, intentLabel] of scenarios) {
    const before = wa.messages.length;
    await handleIncomingMessage(wa, textMessage(phone, message));
    const sent = wa.messages.slice(before);
    assert.equal(sent.length, 2, message);
    assert.equal(sent[0].target, consultant.phone, message);
    assert.equal(sent[1].target, phone, message);
    assert.match(sent[0].message, new RegExp(intentLabel, 'i'), message);
    assert.doesNotMatch(sent[1].message, /horario de atendimento/i, message);
  }
});

test('routes operations to the active listed consultant without a separate support team', async () => {
  writeConfig({
    consultors: [{ ...consultant, receive_support: false }],
  });
  const wa = new MockWhatsApp();
  const phone = '5511987654019';

  await handleIncomingMessage(wa, textMessage(phone, 'tive um sinistro com o carro'));

  assert.equal(wa.messages.length, 2);
  assert.equal(wa.messages[0].target, consultant.phone);
  assert.doesNotMatch(wa.messages[0].message, /\bseguro|seguradora|apolice|sinistro|premio\b/i);
  assert.equal(getLead(phone).lastIntent, 'event_report');
});

test('does not claim a transfer when no consultant is configured', async () => {
  writeConfig({ consultors: [] });
  const wa = new MockWhatsApp();
  const phone = '5511987654021';

  await handleIncomingMessage(wa, textMessage(phone, 'preciso de guincho'));

  assert.equal(wa.messages.length, 1);
  assert.equal(wa.messages[0].target, phone);
  assert.match(wa.messages[0].message, /nao consegui avisar o consultor/i);
  assert.doesNotMatch(wa.messages[0].message, /encaminhei|a caminho/i);
  const lead = getLead(phone);
  assert.ok(lead);
  assert.equal(lead.status, 'handoff_failed');
});

test('persists a delivery failure and gives the client a truthful response', async () => {
  writeConfig();
  const wa = new MockWhatsApp({ failConsultant: true });
  const phone = '5511987654031';

  await handleIncomingMessage(wa, textMessage(phone, 'manda meu boleto'));

  assert.equal(wa.messages.length, 1);
  assert.equal(wa.messages[0].target, phone);
  assert.match(wa.messages[0].message, /nao consegui avisar o consultor/i);
  const lead = getLead(phone);
  assert.ok(lead);
  assert.equal(lead.status, 'handoff_failed');
  assert.match(lead.handoffError, /consultant delivery failed/i);
});

test('ignores media-only messages and handles a caption as ordinary text', async () => {
  writeConfig();
  const wa = new MockWhatsApp();
  const mediaPhone = '5511987654041';

  await handleIncomingMessage(wa, {
    key: { remoteJid: `${mediaPhone}@s.whatsapp.net`, fromMe: false },
    message: { audioMessage: { mimetype: 'audio/ogg' } },
  });
  await handleIncomingMessage(wa, {
    key: { remoteJid: `${mediaPhone}@s.whatsapp.net`, fromMe: false },
    message: { imageMessage: { mimetype: 'image/jpeg' } },
  });
  assert.equal(wa.messages.length, 0);
  assert.equal(getAllLeads().some((lead) => lead.number === mediaPhone), false);

  const captionPhone = '5511987654042';
  await handleIncomingMessage(wa, {
    key: { remoteJid: `${captionPhone}@s.whatsapp.net`, fromMe: false },
    pushName: 'Cliente Legenda',
    message: { imageMessage: { mimetype: 'image/jpeg', caption: 'bati o carro' } },
  });
  assert.equal(wa.messages.length, 2);
  assert.equal(wa.messages[0].target, consultant.phone);
  assert.equal(getLead(captionPhone).lastIntent, 'event_report');
});

test('keeps commercial handoff ordered and sends a single client confirmation', async () => {
  writeConfig();
  const wa = new MockWhatsApp();
  const phone = '5511987654051';
  const lead = {
    number: phone,
    phone,
    displayNumber: phone,
    phoneResolved: true,
    replyTargetJid: phone,
    name: 'Cliente Cotacao',
    model: 'Gol',
    year: '2020',
    plate: 'ABC1D23',
    history: [{ role: 'user', content: 'quero uma cotacao' }],
  };

  const result = await executeHandoff(wa, lead, JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')));

  assert.equal(result.ok, true);
  assert.equal(wa.messages.length, 2);
  assert.equal(wa.messages[0].target, consultant.phone);
  assert.equal(wa.messages[1].target, phone);
  assert.match(wa.messages[0].message, /cotacao de protecao veicular/i);
  assert.equal(getLead(phone).status, 'transferred');
});
