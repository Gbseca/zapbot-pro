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
  'queria',
  'gostaria',
  'qro',
  'cota',
  'cotar',
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
  'opa',
  'qnt',
  'qt',
  'cm',
  'faz',
  'ver',
  'pro',
  'tenho',
  'possuo',
  'tipo',
  'familia',
  'familiar',
  'pai',
  'mae',
  'esposo',
  'esposa',
  'marido',
  'mulher',
  'filho',
  'filha',
  'trabalho',
  'empresa',
  'passeio',
  'particular',
  'pessoal',
  'uso',
  'diario',
  'popular',
  'novo',
  'nova',
  'usado',
  'usada',
  'financiado',
  'financiada',
  'hatch',
  'sedan',
  'suv',
  'pickup',
  'picape',
  'duvida',
  'duvidas',
  'questao',
  'situacao',
  'coisa',
  'pessoa',
  'resolve',
  'resolver',
  'como',
  'falar',
  'robo',
  'cancelar',
  'cancelamento',
  'aqui',
  'voces',
  'estrada',
  'quebrou',
  'parou',
  'parado',
  'parada',
  'pane',
  'pneu',
  'furado',
  'bateria',
  'guincho',
  'reboque',
  'assistencia',
  'chaveiro',
  'socorro',
  'urgente',
  'agora',
  'acionar',
  'solicitar',
  'pedir',
  'chamar',
  'liberar',
  'acesso',
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
    .map((part) => (
      part.length <= 3 || /\d/.test(part)
        ? part.toUpperCase()
        : part[0].toUpperCase() + part.slice(1).toLowerCase()
    ))
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
    /\b(to|tou|estou|tava|estava) devendo\b/,
    /\bdevendo (uma |umas |a |as )?mensalidades?\b/,
    /\brevistoria\b/,
    /\bvistoria\b/,
    /\bapp\b.*\bbloquead[ao]\b/,
    /\b(app|aplicativo) (bloqueou|travou|nao abre|nao entra)\b/,
    /\b(nao|n) consigo (acessar|entrar|usar) (o |no )?(app|aplicativo)\b/,
    /\bpreciso (de )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
    /\b(chamar|acionar|solicitar|pedir) (um |uma )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
    /\b(manda|mande|mandar) (um |uma )?(reboque|guincho|assistencia|chaveiro|socorro)\b/,
    /\b(reboque|guincho|assistencia|chaveiro|socorro) (urgente|agora|pra agora|para agora)\b/,
    /\b(meu|minha) (carro|moto|veiculo) (quebrou|parou|deu pane|esta parado|esta parada|ficou parado|ficou parada)\b/,
    /\b(deu pane|pane na estrada|pneu furado|sem bateria)\b/,
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
    /\bsinistro\b/,
    /\bsinistrou\b/,
    /\bcancelar\b/,
    /\bcancelamento\b/,
    /\bnao quero (falar com )?(robo|atendente)\b/,
    /\b(falar|chamar|passar) (com |para )?(um |uma )?(atendente|humano|pessoa|consultor)\b/,
    /\b(quero|preciso) resolver ((um|uma) )?(problema|questao|situacao|caso)\b/,
    /\bsuporte\b/,
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
    .sort((a, b) => (
      Number(b.nearPlateKeyword) - Number(a.nearPlateKeyword)
      || b.index - a.index
    ));

  for (const candidate of candidates) {
    if (looksLikeModelYearToken(candidate.token, raw, candidate.index)) continue;
    if (isValidBrazilPlate(candidate.token)) return normalizePlate(candidate.token);
  }
  return null;
}

export function extractPhoneFromText(text = '') {
  const raw = String(text || '');
  const lines = raw.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean).reverse();

  for (const line of lines) {
    const normalizedLine = normalizeText(line);
    const hasDocumentLabel = /\b(?:cpf|cnpj|documento)\b/.test(normalizedLine);
    const lineDigits = line.replace(/\D/g, '');
    if (hasDocumentLabel || isCpfDigits(lineDigits) || isCnpjDigits(lineDigits)) continue;
    const matches = Array.from(line.matchAll(/(?:\+?55[ .-]?)?(?:\(?[1-9]{2}\)?[ .-]?)9?\d{4}[ .-]?\d{4}\b/g)).reverse();

    for (const match of matches) {
      const digits = String(match[0] || '').replace(/\D/g, '');
      if (hasDocumentLabel || isCpfDigits(digits) || isCnpjDigits(digits)) continue;

      const phone = normalizeRealWhatsAppPhone(match[0]);
      if (!phone) continue;
      const local = phone.slice(2);
      if (/^(\d)\1+$/.test(local)) continue;
      return phone;
    }
  }

  return null;
}

function isCpfDigits(value = '') {
  const rawDigits = String(value || '').replace(/\D/g, '');
  const digits = rawDigits.length === 13 && rawDigits.startsWith('55') ? rawDigits.slice(2) : rawDigits;
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;

  const calculate = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculate(9) === Number(digits[9]) && calculate(10) === Number(digits[10]);
}

function isCnpjDigits(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const calculate = (baseLength) => {
    const weights = baseLength === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13]);
}

export function extractYearFromText(text = '') {
  const matches = Array.from(String(text || '').matchAll(/\b(19[8-9]\d|20[0-3]\d)\b/g));
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
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

function cleanModelCandidate(value = '') {
  const words = normalizeText(value)
    .split(/\s+/)
    .filter((word) => word && !isModelNoiseWord(word))
    .slice(0, 5);
  const candidate = words.join(' ');
  if (candidate.replace(/\s+/g, '').length < 2) return null;
  if (!/[a-z]/i.test(candidate)) return null;
  return titleCaseModel(candidate);
}

function extractModelFromLine(line = '') {
  if (!line
    || /\b(?:cpf|cnpj|documento|rg)\b/i.test(line)
    || isCoverageLikeText(line)
    || isMultiVehicleText(line)
    || isOperationalLikeText(line)) {
    return null;
  }

  const normalized = normalizeText(line)
    .replace(/\b(?:\+?55\s*)?(?:\(?[1-9]{2}\)?\s*)9?\d{4}\s*\d{4}\b/g, ' ')
    .replace(/\b[a-z]{3}\d[a-z0-9]\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const year = extractYearFromText(normalized);
  const beforeYear = year ? normalized.slice(0, normalized.lastIndexOf(year)).trim() : normalized;
  const explicitPatterns = [
    /\b(?:modelo|veiculo)\s+(?:e|eh)?\s*(?:um|uma)?\s*([a-z0-9][a-z0-9\s]{1,45})$/,
    /\b(?:meu|minha)\s+(?:carro|moto|veiculo)\s+(?:e|eh)\s+([a-z0-9][a-z0-9\s]{1,45})$/,
    /\b(?:pro|pra|para o|para a)\s+(?:meu|minha)\s+((?!(?:carro|moto|veiculo|protecao|duvida|pendencia|mensalidade|pessoa|situacao|questao|coisa|problema)\b)[a-z0-9][a-z0-9\s]{1,45})$/,
    /\b(?:meu|minha)\s+((?!(?:carro|moto|veiculo|protecao|duvida|pendencia|mensalidade|pessoa|situacao|questao|coisa|problema)\b)[a-z0-9][a-z0-9\s]{1,45})$/,
  ];

  if (year) {
    explicitPatterns.push(
      /\b(?:tenho|possuo|e|eh)\s+(?:um|uma)\s+([a-z0-9][a-z0-9\s]{1,45})$/,
      /\b(?:um|uma)\s+((?!(?:carro|moto|veiculo|problema)\b)[a-z0-9][a-z0-9\s]{1,45})$/,
    );
  }

  for (const pattern of explicitPatterns) {
    const match = beforeYear.match(pattern);
    const candidate = cleanModelCandidate(match?.[1] || '');
    if (candidate) return candidate;
  }

  if (!year) return null;
  return cleanModelCandidate(beforeYear.split(/\s+/).slice(-5).join(' '));
}

export function extractVehicleModelFromText(text = '') {
  const lines = String(text || '')
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    const model = extractModelFromLine(line);
    if (model) return model;
  }

  return null;
}

export function buildRecentUserText(lead = {}, currentText = '', limit = 8) {
  const recent = (lead.history || [])
    .filter((entry) => entry?.role === 'user' && entry.content)
    .slice(-limit)
    .map((entry) => entry.content);

  const current = String(currentText || '').trim();
  if (current && String(recent[recent.length - 1] || '').trim() !== current) recent.push(current);
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
  const latestLine = String(text || '')
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop() || '';
  const explicitVehicleCorrection = /\b(?:corrigindo|correcao|na verdade|quer dizer)\b/i.test(
    normalizeText(latestLine),
  );

  if (facts.plate) lead.plate = facts.plate;
  if (facts.plate) lead.plateUnavailable = false;
  if (facts.plate) lead.plateWithheld = false;
  if (facts.phone) {
    lead.phone = facts.phone;
    lead.displayNumber = facts.phone;
    lead.phoneResolved = true;
  }
  if (facts.year) lead.year = facts.year;
  if (facts.model && (!lead.model || options.overwriteModel || explicitVehicleCorrection)) lead.model = facts.model;
  if (facts.vehicleType) lead.vehicleType = facts.vehicleType;
  if (facts.vehiclePower) lead.vehiclePower = facts.vehiclePower;
  if (facts.plateUnavailable) lead.plateUnavailable = true;

  return facts;
}

export function hasKnownPlate(lead = {}, text = '') {
  return !!(lead.plate || extractValidPlateFromText(text));
}
