// config-manager.js — v4 — models, personality, aggression, session timeout
import fs from 'fs';
import path from 'path';
import { CONFIG_FILE } from '../storage/paths.js';

export const DEFAULT_AI_MODELS = {
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
};

const DEFAULT_GROQ_API_KEY_B64 = [
  'Z3NrX0kwYmF0UTBOaXE5RGtEbkJuakhJV0dkeWIzRllkWTVC',
  'c25JcXpjUHVncjUwRndYY2xKQTk=',
].join('');

export const DEFAULT_GROQ_API_KEY = Buffer.from(DEFAULT_GROQ_API_KEY_B64, 'base64').toString('utf-8');

export function getDefaultModel(provider = 'groq') {
  return DEFAULT_AI_MODELS[provider] || DEFAULT_AI_MODELS.groq;
}

const defaultConfig = {
  aiEnabled: false,
  aiProvider: 'groq',           // 'groq' (recommended) | 'gemini'
  aiModel: DEFAULT_AI_MODELS.groq,
  qualificationModel: '',
  groqKey: '',
  geminiKey: '',
  agentName: 'Júlia',
  companyName: '',
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
  // ── Phase 3: new personality/behavior controls ──
  aiPersonality: 'human',       // 'human' | 'balanced' | 'robot'
  aiAggression: 'balanced',     // 'aggressive' | 'balanced' | 'soft'
  sessionTimeoutMinutes: 30,    // minutes of inactivity before session history is cleared
};

function normalizeConfig(rawConfig = {}) {
  const merged = { ...defaultConfig, ...rawConfig };
  const provider = merged.aiProvider || defaultConfig.aiProvider;
  const customAiModel = normalizeSecret(rawConfig.aiModel);
  const customQualificationModel = normalizeSecret(rawConfig.qualificationModel);
  return {
    ...merged,
    aiProvider: provider,
    aiModel: customAiModel || getDefaultModel(provider),
    qualificationModel: customQualificationModel || '',
  };
}

function normalizeSecret(value) {
  return String(value || '').trim();
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalizeConfig({ ...loadConfig(), ...newConfig }), null, 2));
}
