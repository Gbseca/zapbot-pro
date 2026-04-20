// config-manager.js — v4 — models, personality, aggression, session timeout
import fs from 'fs';
import path from 'path';
import { CONFIG_FILE } from '../storage/paths.js';

export const DEFAULT_AI_MODELS = {
  groq: 'llama-3.1-8b-instant',
  gemini: 'gemini-2.5-flash',
};

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
  return {
    ...merged,
    aiProvider: provider,
    aiModel: merged.aiModel || getDefaultModel(provider),
    qualificationModel: merged.qualificationModel || '',
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
