import { isValidBrazilPlate, normalizePlate } from './lead-detector.js';
import { normalizeRealWhatsAppPhone } from '../phone-utils.js';

const VEHICLE_STOP_WORDS = new Set([
  'meu',
  'minha',
  'qual',
  'quanto',
  'fica',
  'ficaria',
  'custa',
  'custaria',
  'valor',
  'mensalidade',
  'proteger',
  'protecao',
  'pra',
  'para',
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
  'ontem',
  'hoje',
  'preciso',
  'ajuda',
  'faco',
  'fazer',
  'problema',
  'aqui',
  'voces',
  'consigo',
  'acessar',
  'entrar',
  'usar',
  'aplicativo',
  'app',
  'bloqueado',
  'bloqueada',
  'roubaram',
  'furtaram',
  'levaram',
  'bati',
  'bateram',
  'batida',
  'acidente',
  'colidi',
  'colisao',
  'evento',
  'for',
  'fosse',
  'roubado',
  'roubo',
  'furto',
  'perca',
  'perder',
  'recebo',
  'receber',
  'funciona',
  'pago',
  'preco',
  'comprei',
  'ele',
  'etc',
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

const NO_PLATE_PATTERNS = [
  /\bnao (possui|tenho|tem) placa\b/,
  /\bsem placa\b/,
  /\bainda nao (tem|possui) placa\b/,
];

const SCOOTER_PATTERNS = [
  /\bscooter\b/,
  /\bmoto eletrica\b/,
  /\bciclomotor\b/,
  /\bpatinete\b/,
];

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

function isModelNoiseWord(word = '') {
  return VEHICLE_STOP_WORDS.has(word)
    || /^(19|20)\d{2}$/.test(word)
    || /^[a-z]{3}\d[a-z0-9]\d{2}$/.test(word);
}

function isCoverageLikeText(text = '') {
  const normalized = normalizeText(text);
  return [
    /\bperda total\b/,
    /\broubo\b/,
    /\bfurto\b/,
    /\bfipe\b/,
    /\b100\s*%\b/,
    /\bcobertura\b/,
    /\bcobre\b/,
    /\bcoberto\b/,
    /\bindeniza/,
    /\bparticipacao\b/,
    /\bprotecao veicular\b/,
    /\bmutualismo\b/,
    /\bcomo funciona\b/,
    /\bpago o mesmo (preco|valor)\b/,
    /\bmesmo (preco|valor) que (eu )?comprei\b/,
    /\bquanto eu pago\b/,
  ].some((pattern) => pattern.test(normalized));
}

function isMultiVehicleText(text = '') {
  const normalized = normalizeText(text);
  return [
    /\bcarro\b.*\b(scooter|moto)\b/,
    /\b(scooter|moto)\b.*\bcarro\b/,
    /\bdois veiculos\b/,
  ].some((pattern) => pattern.test(normalized));
}

function isOperationalLikeText(text = '') {
  const normalized = normalizeText(text);
  return [
    /\bboleto\b/,
    /\bcomprovante\b/,
    /\bpagamento\b/,
    /\bpaguei\b/,
    /\binadimpl/,
    /\bpendencia\b/,
    /\bregularizar\b/,
    /\brevistoria\b/,
    /\bvistoria\b/,
    /\bapp\b.*\bbloquead[ao]\b/,
    /\b(nao|n) consigo (acessar|entrar|usar) (o |no )?(app|aplicativo)\b/,
    /\broubaram\b/,
    /\bfurtaram\b/,
    /\blevaram (meu|minha)\b/,
    /\b(carro|moto|veiculo) roubad[ao]\b/,
    /\b(carro|moto|veiculo) furtad[ao]\b/,
    /\bbati\b/,
    /\bbateram\b/,
    /\bbatida\b/,
    /\bacidente\b/,
    /\bcolidi\b/,
    /\bcolisao\b/,
    /\b(tive|sofri|aconteceu|abrir|abri|acionar|acionei) (um |uma )?evento\b/,
  ].some((pattern) => pattern.test(normalized));
}

function hasPlateKeywordBefore(text = '', index = 0) {
  const before = normalizeText(String(text || '').slice(Math.max(0, index - 28), index));
  return /\bplaca\b/.test(before);
}

function looksLikeModelYearToken(rawToken = '', fullText = '', index = 0) {
  const compact = String(rawToken || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const hasSeparator = /[A-Za-z]{3}[-\s]+\d/.test(rawToken);
  if (!hasSeparator) return false;
  if (!/^[A-Z]{3}(19|20)\d{2}$/.test(compact)) return false;
  return !hasPlateKeywordBefore(fullText, index);
}

export function extractValidPlateFromText(text = '') {
  const raw = String(text || '');
  const matches = Array.from(raw.matchAll(/\b[A-Za-z]{3}[-\s]?\d[A-Za-z0-9][-\s]?\d{2}\b/g));
  const candidates = matches
    .map((match) => ({
      token: match[0],
      index: match.index || 0,
      nearPlateKeyword: hasPlateKeywordBefore(raw, match.index || 0),
    }))
    .sort((a, b) => Number(b.nearPlateKeyword) - Number(a.nearPlateKeyword));

  for (const candidate of candidates) {
    if (looksLikeModelYearToken(candidate.token, raw, candidate.index)) continue;
    if (isValidBrazilPlate(candidate.token)) return normalizePlate(candidate.token);
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

export function extractVehicleTypeFromText(text = '') {
  const normalized = normalizeText(text);
  if (SCOOTER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return normalized.includes('eletrica') ? 'scooter_eletrica' : 'scooter';
  }
  if (/\bmoto\b/.test(normalized)) return 'moto';
  if (/\bcarro\b/.test(normalized)) return 'carro';
  return null;
}

export function extractVehiclePowerFromText(text = '') {
  const match = String(text || '').match(/\b\d{2,5}\s*w\b/i);
  return match ? match[0].replace(/\s+/g, '').toUpperCase() : null;
}

export function hasNoPlateStatement(text = '') {
  const normalized = normalizeText(text);
  return NO_PLATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function extractVehicleModelFromText(text = '') {
  if (isCoverageLikeText(text)) return null;
  if (isMultiVehicleText(text)) return null;
  if (isOperationalLikeText(text)) return null;
  const normalized = normalizeText(text);
  const year = extractYearFromText(text);
  const withoutPlate = normalized
    .replace(/\b(?:\+?55\s*)?(?:\(?[1-9]{2}\)?\s*)9?\d{4}\s*\d{4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const modelMatch = withoutPlate.match(/\b(?:modelo|veiculo|carro|moto)\s+(?:e|eh|um|uma)?\s*([a-z0-9][a-z0-9\s]{2,35})/);
  if (modelMatch) {
    const words = modelMatch[1]
      .split(/\s+/)
      .filter((word) => word && !isModelNoiseWord(word))
      .slice(0, 3);
    if (words.join('').length >= 3) return titleCaseModel(words.join(' '));
  }

  if (year) {
    const beforeYear = withoutPlate.split(year)[0] || '';
    const words = beforeYear
      .split(/\s+/)
      .filter((word) => word && !isModelNoiseWord(word))
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
    vehicleType: extractVehicleTypeFromText(text),
    vehiclePower: extractVehiclePowerFromText(text),
    plateUnavailable: hasNoPlateStatement(text),
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
  if (facts.vehicleType) lead.vehicleType = facts.vehicleType;
  if (facts.vehiclePower) lead.vehiclePower = facts.vehiclePower;
  if (facts.plateUnavailable) lead.plateUnavailable = true;

  return facts;
}

export function hasKnownPlate(lead = {}, text = '') {
  return !!(lead.plate || extractValidPlateFromText(text));
}
