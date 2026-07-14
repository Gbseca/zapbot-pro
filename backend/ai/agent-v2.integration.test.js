import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapbot-agent-v2-test-'));
const dataDir = path.join(storageDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
process.env.APP_STORAGE_DIR = storageDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';

fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
  aiEnabled: true,
  customerAgentV2Enabled: true,
  aiProvider: 'groq',
  aiModel: 'openai/gpt-oss-120b',
  groqKey: 'test-key',
  businessHoursStart: '00:00',
  businessHoursEnd: '23:59',
  consultors: [],
}, null, 2));

const { handleIncomingMessage } = await import('./agent.js');
const { getLead } = await import('../data/leads-manager.js');

class MockWhatsApp {
  constructor() {
    this.messages = [];
  }

  resolvePhone(value = '') {
    return String(value).split('@')[0].split(':')[0].replace(/\D/g, '') || null;
  }

  getInboundRouteContext() {
    return null;
  }

  async sendTyping() {}

  async sendMessage(target, message) {
    this.messages.push({ target: String(target), message: String(message) });
    return {
      status: 'confirmed',
      messageId: `v2-${this.messages.length}`,
      resolvedJid: String(target),
    };
  }
}

function textMessage(phone, text) {
  return {
    key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
    pushName: 'Cliente V2',
    message: { conversation: text },
  };
}

async function waitFor(check, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Tempo esgotado aguardando processamento do agente v2.');
}

after(() => {
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test('uses one structured AI call and sends its grounded answer through the real agent path', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    const content = JSON.stringify({
      reply: 'Granizo está entre os fenômenos da natureza previstos pela Moove. Qual é o modelo e o ano do seu veículo?',
      primaryIntent: 'coverage_question',
      secondaryIntent: 'sales_quote',
      mode: 'sales',
      action: 'ask_model_year',
      confidence: 0.96,
      emotion: 'interested',
      answerStatus: 'answered',
      knowledgeIds: ['coverage-rules.what_is_covered'],
      reasoningSummary: 'Respondeu a dúvida antes de avançar a cotação.',
      handoffReason: '',
      handoffSummary: '',
      memory: {
        customerGoal: 'tirar dúvida sobre granizo e cotar',
        currentTopic: 'granizo',
        pendingQuestion: 'modelo e ano',
        objections: [],
        answeredTopics: ['granizo'],
      },
      extractedFacts: { vehicleModel: '', vehicleYear: '' },
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    };
  };

  try {
    const phone = '5511987654991';
    const wa = new MockWhatsApp();
    await handleIncomingMessage(wa, textMessage(phone, 'quero cotar, mas antes: cobre granizo?'));
    await waitFor(() => wa.messages.length > 0);

    assert.equal(fetchCalls, 1);
    assert.equal(wa.messages.length, 1);
    assert.match(wa.messages[0].message, /Granizo/i);
    assert.match(wa.messages[0].message, /modelo e o ano/i);

    const lead = getLead(phone);
    assert.equal(lead.aiArchitecture, 'customer-agent-v2');
    assert.equal(lead.lastIntent, 'coverage_question');
    assert.equal(lead.secondaryIntent, 'sales_quote');
    assert.deepEqual(lead.aiKnowledgeIds, ['coverage-rules.what_is_covered']);
    assert.equal(lead.aiMemory.customerGoal, 'tirar dúvida sobre granizo e cotar');
  } finally {
    global.fetch = originalFetch;
  }
});
