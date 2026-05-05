import { isValidBrazilPlate, normalizePlate } from './lead-detector.js';
import { normalizeRealWhatsAppPhone } from '../phone-utils.js';

const VEHICLE_STOP_WORDS = new Set([
  'meu',
  'minha',
  'carro',
  'moto',
  'veiculo',
  'modelo',
  'ano',
  'placa',
  'quero',
  'cotacao',
  'orcamento',
  'simulacao',
  'boleto',
  'regularizar',
  'pagar',
  'pagamento',
  'comprovante',
  'revistoria',
  'vistoria',
  'consultor',
  'atendente',
  'e',
  'eh',
  'um',
  'uma',
  'de',
  'do',
  'da',
  'o',
  'a',
]);

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseModel(text = '') {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function extractValidPlateFromText(text = '') {
  const tokens = String(text || '').match(/\b[A-Za-z]{3}[-\s]?\d[A-Za-z0-9][-\s]?\d{2}\b/g) || [];
  for (const token of tokens) {
    if (isValidBrazilPlate(token)) return normalizePlate(token);
  }
  return null;
}

export function extractPhoneFromText(text = '') {
  const raw = String(text || '');
  const matches = raw.match(/(?:\+?55[\s.-]?)?(?:\(?[1-9]{2}\)?[\s.-]?)9?\d{4}[\s.-]?\d{4}\b/g) || [];

  for (const match of matches) {
    const phone = normalizeRealWhatsAppPhone(match);
    if (phone) return phone;
  }

  return normalizeRealWhatsAppPhone(raw);
}

export function extractYearFromText(text = '') {
  const match = String(text || '').match(/\b(19[8-9]\d|20[0-3]\d)\b/);
  return match ? match[1] : null;
}

export function extractVehicleModelFromText(text = '') {
  const normalized = normalizeText(text);
  const year = extractYearFromText(text);
  const withoutPlate = normalized
    .replace(/\b[a-z]{3}\s*\d\s*[a-z0-9]\s*\d{2}\b/g, ' ')
    .replace(/\b(?:\+?55\s*)?(?:\(?[1-9]{2}\)?\s*)9?\d{4}\s*\d{4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const modelMatch = withoutPlate.match(/\b(?:modelo|veiculo|carro|moto)\s+(?:e|eh|um|uma)?\s*([a-z0-9][a-z0-9\s]{2,35})/);
  if (modelMatch) {
    const words = modelMatch[1]
      .split(/\s+/)
      .filter((word) => word && !VEHICLE_STOP_WORDS.has(word))
      .slice(0, 3);
    if (words.join('').length >= 3) return titleCaseModel(words.join(' '));
  }

  if (year) {
    const beforeYear = withoutPlate.split(year)[0] || '';
    const words = beforeYear
      .split(/\s+/)
      .filter((word) => word && !VEHICLE_STOP_WORDS.has(word))
      .slice(-3);
    if (words.join('').length >= 3) return titleCaseModel(words.join(' '));
  }

  return null;
}

export function buildRecentUserText(lead = {}, currentText = '', limit = 8) {
  const recent = (lead.history || [])
    .filter((entry) => entry?.role === 'user' && entry.content)
    .slice(-limit)
    .map((entry) => entry.content);

  if (currentText) recent.push(currentText);
  return recent.join('\n');
}

export function extractDeterministicFacts(text = '') {
  return {
    plate: extractValidPlateFromText(text),
    phone: extractPhoneFromText(text),
    year: extractYearFromText(text),
    model: extractVehicleModelFromText(text),
  };
}

export function applyDeterministicFactsToLead(lead, text = '', options = {}) {
  if (!lead) return {};
  const facts = extractDeterministicFacts(text);

  if (facts.plate) lead.plate = facts.plate;
  if (facts.phone) {
    lead.phone = facts.phone;
    lead.displayNumber = facts.phone;
    lead.phoneResolved = true;
  }
  if (facts.year) lead.year = facts.year;
  if (facts.model && (!lead.model || options.overwriteModel)) lead.model = facts.model;

  return facts;
}

export function hasKnownPlate(lead = {}, text = '') {
  return !!(lead.plate || extractValidPlateFromText(text));
}
