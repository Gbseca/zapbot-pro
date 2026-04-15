import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'config.json');

const defaultConfig = {
  aiEnabled: false,
  geminiKey: '',
  agentName: 'Júlia',
  companyName: '',
  companyInfo: '',
  consultors: [],
  consultorDistribution: 'alternated', // alternated | first | second
  businessHoursStart: '08:00',
  businessHoursEnd: '22:00',
  followUpEnabled: true,
  followUp1Hours: 4,
  followUp2Hours: 24,
  followUpColdHours: 48,
  reportEnabled: true,
  reportHour: '18:00',
  campaignLoopEnabled: true,
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
