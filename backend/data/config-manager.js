// config-manager.js — v3 — added personality, aggression, sessionTimeout
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'config.json');

const defaultConfig = {
  aiEnabled: false,
  aiProvider: 'groq',           // 'groq' (recommended) | 'gemini'
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
  // ── Phase 3: new personality/behavior controls ──
  aiPersonality: 'human',       // 'human' | 'balanced' | 'robot'
  aiAggression: 'balanced',     // 'aggressive' | 'balanced' | 'soft'
  sessionTimeoutMinutes: 30,    // minutes of inactivity before session history is cleared
};

export function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { ...defaultConfig };
  try {
    return { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
  } catch {
    return { ...defaultConfig };
  }
}

export function saveConfig(newConfig) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...loadConfig(), ...newConfig }, null, 2));
}
