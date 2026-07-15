import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAIModelCatalog,
  getDefaultModel,
  maskSecret,
  resolveEffectiveAIConfig,
  sanitizeAIConfigUpdates,
} from './config-manager.js';

test('publishes a provider-scoped model catalog with supported defaults', () => {
  const catalog = getAIModelCatalog();
  assert.ok(catalog.groq.some((model) => model.id === getDefaultModel('groq')));
  assert.ok(catalog.gemini.some((model) => model.id === getDefaultModel('gemini')));
  assert.notEqual(catalog.groq, getAIModelCatalog().groq);
});

test('sanitizes the complete AI settings contract and ignores derived client fields', () => {
  const updates = sanitizeAIConfigUpdates({
    aiProvider: 'groq',
    aiModel: 'openai/gpt-oss-120b',
    qualificationModel: 'openai/gpt-oss-20b',
    classificationModel: '',
    aiEnabled: false,
    geminiFallbackEnabled: true,
    agentName: '  Julia  ',
    companyName: ' Moove Protecao Veicular ',
    companyInfo: ' Regional RJ ',
    consultors: [
      { name: ' Gabriel ', number: '(21) 99999-0000' },
      { name: 'Duplicado', number: '21999990000' },
    ],
    consultorDistribution: 'alternated',
    businessHoursStart: '08:00',
    businessHoursEnd: '22:00',
    reportHour: '18:00',
    followUpEnabled: true,
    followUp1Hours: 4,
    followUp2Hours: 24,
    followUpColdHours: 48,
    reportEnabled: true,
    campaignLoopEnabled: true,
    collectionsModeEnabled: false,
    aiPersonality: 'human',
    aiAggression: 'balanced',
    sessionTimeoutMinutes: 30,
    hasEffectiveKey: true,
    effectiveKey: 'must-not-be-saved',
  });

  assert.equal(updates.agentName, 'Julia');
  assert.deepEqual(updates.consultors, [{ name: 'Gabriel', number: '21999990000' }]);
  assert.equal('hasEffectiveKey' in updates, false);
  assert.equal('effectiveKey' in updates, false);
});

test('switching providers selects a compatible default and clears specialized models', () => {
  const updates = sanitizeAIConfigUpdates({ aiProvider: 'gemini' }, {
    aiProvider: 'groq',
    aiModel: 'openai/gpt-oss-120b',
    qualificationModel: 'openai/gpt-oss-20b',
    classificationModel: 'qwen/qwen3-32b',
  });
  assert.equal(updates.aiModel, getDefaultModel('gemini'));
  assert.equal(updates.qualificationModel, '');
  assert.equal(updates.classificationModel, '');
});

test('rejects unsupported models, invalid times and out-of-range automation values', () => {
  assert.throws(
    () => sanitizeAIConfigUpdates({ aiModel: 'made-up-model' }, { aiProvider: 'groq' }),
    /nao esta disponivel/,
  );
  assert.throws(() => sanitizeAIConfigUpdates({ reportHour: '29:90' }), /HH:MM/);
  assert.throws(() => sanitizeAIConfigUpdates({ followUp1Hours: 0 }), /entre 1 e 72/);
});

test('supports explicit saved-key removal without accepting blank accidental overwrites', () => {
  const clear = sanitizeAIConfigUpdates({ clearGroqKey: true, groqKey: '' });
  assert.equal(clear.groqKey, '');
  const untouched = sanitizeAIConfigUpdates({ groqKey: '   ' });
  assert.equal('groqKey' in untouched, false);
});

test('keeps secrets masked and resolves saved keys before environment keys', () => {
  const effective = resolveEffectiveAIConfig({
    aiProvider: 'groq',
    groqKey: 'gsk_saved_12345678',
    geminiKey: '',
  }, {
    GROQ_API_KEY: 'gsk_env_87654321',
    GEMINI_API_KEY: 'gemini_env_12345678',
  });
  assert.equal(effective.effectiveGroqKey, 'gsk_saved_12345678');
  assert.equal(effective.groqKeySource, 'saved');
  assert.equal(effective.geminiKeySource, 'env');
  assert.equal(maskSecret(effective.effectiveGroqKey), 'gsk_...5678');
});
