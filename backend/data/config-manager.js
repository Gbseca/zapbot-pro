import fs from 'fs';
import path from 'path';
import { CONFIG_FILE } from '../storage/paths.js';

export const AI_MODEL_CATALOG = Object.freeze({
  groq: Object.freeze([
    Object.freeze({
      id: 'openai/gpt-oss-120b',
      label: 'GPT-OSS 120B',
      description: 'Melhor qualidade para atendimento e raciocinio.',
      recommended: true,
    }),
    Object.freeze({
      id: 'openai/gpt-oss-20b',
      label: 'GPT-OSS 20B',
      description: 'Mais rapido para tarefas simples e classificacao.',
    }),
    Object.freeze({
      id: 'qwen/qwen3.6-27b',
      label: 'Qwen 3.6 27B',
      description: 'Boa alternativa para conversa e linguagem natural.',
    }),
    Object.freeze({
      id: 'qwen/qwen3-32b',
      label: 'Qwen 3 32B',
      description: 'Alternativa equilibrada com suporte a JSON.',
    }),
  ]),
  gemini: Object.freeze([
    Object.freeze({
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      description: 'Modelo estavel usado atualmente pelo projeto.',
      recommended: true,
    }),
    Object.freeze({
      id: 'gemini-2.5-flash-lite',
      label: 'Gemini 2.5 Flash-Lite',
      description: 'Mais leve para classificacao e alto volume.',
    }),
    Object.freeze({
      id: 'gemini-3.1-flash-lite',
      label: 'Gemini 3.1 Flash-Lite',
      description: 'Modelo rapido da geracao Gemini 3.',
    }),
    Object.freeze({
      id: 'gemini-3.5-flash',
      label: 'Gemini 3.5 Flash',
      description: 'Modelo Flash estavel mais recente.',
    }),
  ]),
});

const DEFAULT_AI_MODELS = Object.freeze({
  groq: 'openai/gpt-oss-120b',
  gemini: 'gemini-2.5-flash',
});

const DEFAULT_GROQ_API_KEY = '';
const PROVIDERS = new Set(Object.keys(AI_MODEL_CATALOG));
const PERSONALITIES = new Set(['human', 'balanced', 'robot']);
const SALES_STYLES = new Set(['aggressive', 'balanced', 'soft']);
const CONSULTOR_DISTRIBUTIONS = new Set(['alternated', 'first', 'second']);

export function getDefaultModel(provider = 'groq') {
  return DEFAULT_AI_MODELS[provider] || DEFAULT_AI_MODELS.groq;
}

export function getAIModelCatalog() {
  return Object.fromEntries(Object.entries(AI_MODEL_CATALOG).map(([provider, models]) => [
    provider,
    models.map((model) => ({ ...model })),
  ]));
}

export function isSupportedAIModel(provider, model) {
  const normalized = normalizeSecret(model);
  return (AI_MODEL_CATALOG[provider] || []).some((entry) => entry.id === normalized);
}

const defaultConfig = {
  aiEnabled: false,
  customerAgentV2Enabled: true,
  aiProvider: 'groq',
  aiModel: DEFAULT_AI_MODELS.groq,
  qualificationModel: '',
  classificationModel: '',
  geminiFallbackEnabled: false,
  groqKey: '',
  geminiKey: '',
  agentName: 'Júlia',
  companyName: 'Moove Proteção Veicular',
  companyInfo: '',
  consultors: [],
  consultorDistribution: 'alternated',
  businessHoursStart: '08:00',
  businessHoursEnd: '22:00',
  followUpEnabled: true,
  followUp1Hours: 4,
  followUp2Hours: 24,
  followUpColdHours: 48,
  reportEnabled: true,
  reportHour: '18:00',
  campaignLoopEnabled: true,
  collectionsModeEnabled: false,
  aiPersonality: 'human',
  aiAggression: 'balanced',
  sessionTimeoutMinutes: 30,
};

function normalizeSecret(value) {
  return String(value || '').trim();
}

function normalizeConfig(rawConfig = {}) {
  const merged = { ...defaultConfig, ...rawConfig };
  const provider = PROVIDERS.has(merged.aiProvider) ? merged.aiProvider : defaultConfig.aiProvider;
  const customAiModel = normalizeSecret(rawConfig.aiModel);
  const customQualificationModel = normalizeSecret(rawConfig.qualificationModel);
  const customClassificationModel = normalizeSecret(rawConfig.classificationModel);
  return {
    ...merged,
    aiProvider: provider,
    aiModel: customAiModel || getDefaultModel(provider),
    qualificationModel: customQualificationModel || '',
    classificationModel: customClassificationModel || '',
    geminiFallbackEnabled: !!merged.geminiFallbackEnabled,
  };
}

function resolveValueByPriority(savedValue, envValue, fallbackValue = '') {
  return normalizeSecret(savedValue) || normalizeSecret(envValue) || normalizeSecret(fallbackValue);
}

function getSource(savedValue, envValue, fallbackValue = '') {
  if (normalizeSecret(savedValue)) return 'saved';
  if (normalizeSecret(envValue)) return 'env';
  if (normalizeSecret(fallbackValue)) return 'default';
  return 'missing';
}

function getEnvGroqKey(env = process.env) {
  return env.GROQ_API_KEY || env.GROQ_KEY || '';
}

function getEnvGeminiKey(env = process.env) {
  return env.GEMINI_API_KEY || env.GEMINI_KEY || env.GOOGLE_API_KEY || '';
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseBoolean(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${field} deve ser verdadeiro ou falso.`);
  return value;
}

function parseInteger(value, field, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`${field} deve estar entre ${min} e ${max}.`);
  }
  return parsed;
}

function parseText(value, field, maxLength, { allowBlank = true } = {}) {
  if (typeof value !== 'string') throw new TypeError(`${field} deve ser texto.`);
  const parsed = value.trim();
  if (!allowBlank && !parsed) throw new TypeError(`${field} nao pode ficar vazio.`);
  if (parsed.length > maxLength) throw new TypeError(`${field} excede ${maxLength} caracteres.`);
  return parsed;
}

function parseTime(value, field) {
  const parsed = parseText(value, field, 5, { allowBlank: false });
  const match = /^(\d{2}):(\d{2})$/.exec(parsed);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new TypeError(`${field} deve usar o formato HH:MM.`);
  }
  return parsed;
}

function parseModel(value, provider, field, { allowBlank = false } = {}) {
  const parsed = parseText(value, field, 120, { allowBlank });
  if (!parsed && allowBlank) return '';
  if (!isSupportedAIModel(provider, parsed)) {
    throw new TypeError(`${field} nao esta disponivel para ${provider}.`);
  }
  return parsed;
}

function parseConsultors(value) {
  if (!Array.isArray(value)) throw new TypeError('consultors deve ser uma lista.');
  if (value.length > 20) throw new TypeError('Cadastre no maximo 20 consultores.');
  const seen = new Set();
  const consultors = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const number = String(item.number || '').replace(/\D/g, '');
    if (!number) continue;
    if (number.length < 10 || number.length > 15) throw new TypeError('Telefone de consultor invalido.');
    if (seen.has(number)) continue;
    seen.add(number);
    consultors.push({
      name: parseText(String(item.name || 'Consultor'), 'Nome do consultor', 80, { allowBlank: false }),
      number,
    });
  }
  return consultors;
}

export function sanitizeAIConfigUpdates(input = {}, currentConfig = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Configuracao invalida.');
  }

  const current = normalizeConfig(currentConfig);
  const updates = {};
  const requestedProvider = hasOwn(input, 'aiProvider')
    ? parseText(input.aiProvider, 'aiProvider', 20, { allowBlank: false })
    : current.aiProvider;
  if (!PROVIDERS.has(requestedProvider)) throw new TypeError('Provedor de IA invalido.');

  if (hasOwn(input, 'aiProvider')) updates.aiProvider = requestedProvider;
  if (hasOwn(input, 'aiModel')) updates.aiModel = parseModel(input.aiModel, requestedProvider, 'Modelo principal');
  if (hasOwn(input, 'qualificationModel')) {
    updates.qualificationModel = parseModel(input.qualificationModel, requestedProvider, 'Modelo de qualificacao', { allowBlank: true });
  }
  if (hasOwn(input, 'classificationModel')) {
    updates.classificationModel = parseModel(input.classificationModel, requestedProvider, 'Modelo de classificacao', { allowBlank: true });
  }

  if (hasOwn(input, 'aiProvider') && requestedProvider !== current.aiProvider) {
    if (!hasOwn(input, 'aiModel')) updates.aiModel = getDefaultModel(requestedProvider);
    if (!hasOwn(input, 'qualificationModel')) updates.qualificationModel = '';
    if (!hasOwn(input, 'classificationModel')) updates.classificationModel = '';
  }

  const booleanFields = [
    'aiEnabled',
    'geminiFallbackEnabled',
    'followUpEnabled',
    'reportEnabled',
    'campaignLoopEnabled',
    'collectionsModeEnabled',
  ];
  for (const field of booleanFields) {
    if (hasOwn(input, field)) updates[field] = parseBoolean(input[field], field);
  }

  if (input.clearGroqKey === true) updates.groqKey = '';
  if (input.clearGeminiKey === true) updates.geminiKey = '';
  for (const field of ['groqKey', 'geminiKey']) {
    if (!hasOwn(input, field)) continue;
    const key = parseText(input[field], field, 512);
    if (key) updates[field] = key;
  }

  if (hasOwn(input, 'agentName')) updates.agentName = parseText(input.agentName, 'Nome do agente', 80);
  if (hasOwn(input, 'companyName')) updates.companyName = parseText(input.companyName, 'Nome da empresa', 120);
  if (hasOwn(input, 'companyInfo')) updates.companyInfo = parseText(input.companyInfo, 'Informacoes operacionais', 4000);
  if (hasOwn(input, 'consultors')) updates.consultors = parseConsultors(input.consultors);

  if (hasOwn(input, 'consultorDistribution')) {
    const distribution = parseText(input.consultorDistribution, 'Distribuicao de consultores', 20, { allowBlank: false });
    if (!CONSULTOR_DISTRIBUTIONS.has(distribution)) throw new TypeError('Distribuicao de consultores invalida.');
    updates.consultorDistribution = distribution;
  }

  for (const field of ['businessHoursStart', 'businessHoursEnd', 'reportHour']) {
    if (hasOwn(input, field)) updates[field] = parseTime(input[field], field);
  }

  const numberFields = {
    followUp1Hours: [1, 72],
    followUp2Hours: [1, 168],
    followUpColdHours: [24, 720],
    sessionTimeoutMinutes: [5, 240],
  };
  for (const [field, [min, max]] of Object.entries(numberFields)) {
    if (hasOwn(input, field)) updates[field] = parseInteger(input[field], field, min, max);
  }

  if (hasOwn(input, 'aiPersonality')) {
    const personality = parseText(input.aiPersonality, 'Tom de conversa', 20, { allowBlank: false });
    if (!PERSONALITIES.has(personality)) throw new TypeError('Tom de conversa invalido.');
    updates.aiPersonality = personality;
  }
  if (hasOwn(input, 'aiAggression')) {
    const salesStyle = parseText(input.aiAggression, 'Conducao comercial', 20, { allowBlank: false });
    if (!SALES_STYLES.has(salesStyle)) throw new TypeError('Conducao comercial invalida.');
    updates.aiAggression = salesStyle;
  }

  return updates;
}

export function maskSecret(value) {
  const secret = normalizeSecret(value);
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}...`;
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function resolveEffectiveAIConfig(rawConfig = {}, env = process.env) {
  const config = normalizeConfig(rawConfig);
  const effectiveProvider = config.aiProvider || defaultConfig.aiProvider;
  const envGroqKey = getEnvGroqKey(env);
  const envGeminiKey = getEnvGeminiKey(env);
  const effectiveGroqKey = resolveValueByPriority(config.groqKey, envGroqKey, DEFAULT_GROQ_API_KEY);
  const effectiveGeminiKey = resolveValueByPriority(config.geminiKey, envGeminiKey);
  const effectiveAiModel = config.aiModel || getDefaultModel(effectiveProvider);
  const effectiveQualificationModel = config.qualificationModel || effectiveAiModel;
  const effectiveClassificationModel = config.classificationModel || effectiveQualificationModel;
  const groqKeySource = getSource(config.groqKey, envGroqKey, DEFAULT_GROQ_API_KEY);
  const geminiKeySource = getSource(config.geminiKey, envGeminiKey);
  const hasEffectiveGroqKey = !!effectiveGroqKey;
  const hasEffectiveGeminiKey = !!effectiveGeminiKey;
  const effectiveKey = effectiveProvider === 'gemini' ? effectiveGeminiKey : effectiveGroqKey;
  const effectiveKeySource = effectiveProvider === 'gemini' ? geminiKeySource : groqKeySource;

  return {
    ...config,
    effectiveProvider,
    effectiveAiModel,
    effectiveQualificationModel,
    effectiveClassificationModel,
    effectiveGroqKey,
    effectiveGeminiKey,
    groqKeySource,
    geminiKeySource,
    hasEffectiveGroqKey,
    hasEffectiveGeminiKey,
    effectiveKey,
    effectiveKeySource,
    hasEffectiveKey: !!effectiveKey,
  };
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return normalizeConfig();
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
  } catch {
    return normalizeConfig();
  }
}

export function saveConfig(newConfig) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const normalized = normalizeConfig({ ...loadConfig(), ...newConfig });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}
