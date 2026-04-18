import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, 'leads.json');

function ensureDir() {
  const dir = path.dirname(LEADS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadAll() {
  if (!fs.existsSync(LEADS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveAll(data) {
  ensureDir();
  fs.writeFileSync(LEADS_FILE, JSON.stringify(data, null, 2));
}

export function getLead(number) {
  return loadAll()[number] || null;
}

export function saveLead(number, leadData) {
  const all = loadAll();
  all[number] = { ...leadData, updatedAt: new Date().toISOString() };
  saveAll(all);
}

export function updateLead(number, updates) {
  const all = loadAll();
  if (all[number]) {
    all[number] = { ...all[number], ...updates, updatedAt: new Date().toISOString() };
    saveAll(all);
    return all[number];
  }
  return null;
}

export function getAllLeads() {
  return Object.values(loadAll()).sort((a, b) =>
    new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
  );
}

export function deleteLead(number) {
  const all = loadAll();
  delete all[number];
  saveAll(all);
}

export function clearAllLeads() {
  saveAll({});
}

export function exportLeadsCSV() {
  const leads = getAllLeads();
  const headers = ['Número', 'Nome', 'Modelo', 'Placa', 'Status', 'Criado em', 'Atualizado em', 'Transferido para'];
  const rows = leads.map(l => [
    l.number,
    l.name || '',
    l.model || '',
    l.plate || '',
    l.status,
    l.createdAt ? new Date(l.createdAt).toLocaleString('pt-BR') : '',
    l.updatedAt ? new Date(l.updatedAt).toLocaleString('pt-BR') : '',
    l.transferredTo || '',
  ]);
  return [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
}

export function getLeadStats() {
  const leads = getAllLeads();
  const today = new Date().toDateString();
  const todayLeads = leads.filter(l => new Date(l.createdAt).toDateString() === today);
  const qualified = leads.filter(l => l.status === 'qualified' || l.status === 'transferred');
  const todayQualified = todayLeads.filter(l => l.status === 'qualified' || l.status === 'transferred');
  const conversationRate = todayLeads.length > 0
    ? Math.round((todayQualified.length / todayLeads.length) * 100) : 0;
  return {
    total: leads.length,
    todayTotal: todayLeads.length,
    talking: leads.filter(l => l.status === 'talking').length,
    qualified: qualified.length,
    todayQualified: todayQualified.length,
    transferred: leads.filter(l => l.status === 'transferred').length,
    cold: leads.filter(l => l.status === 'cold').length,
    blocked: leads.filter(l => l.status === 'blocked').length,
    no_interest: leads.filter(l => l.status === 'no_interest').length, // FIX [4]
    conversationRate,
  };
}
