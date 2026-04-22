import { randomUUID } from 'crypto';
import { callAI } from './ai/gemini.js';
import { resolveEffectiveAIConfig } from './data/config-manager.js';
import { normalizePhone } from './ai/lead-detector.js';

const ACTIVE_COLLECTIONS_STATUSES = new Set(['running', 'paused']);

const COLLECTIONS_KEYWORDS = [
  'atraso',
  'inadimplente',
  'inadimplencia',
  'pendencia',
  'pendente',
  'debito',
  'debito em aberto',
  'boleto',
  'pagamento',
  'vencimento',
  'regularizar',
  'regularizacao',
  'reativar',
  'reativacao',
  'suspensao',
  'em aberto',
  'segunda via',
  'financeiro',
  'quitar',
  'quitacao',
];

const EXISTING_CUSTOMER_KEYWORDS = [
  'seu cadastro',
  'sua associacao',
  'sua adesao',
  'seu plano',
  'seu contrato',
  'seu veiculo',
  'nosso financeiro',
  'sua mensalidade',
  'mensalidade',
  'cliente',
  'associado',
];

const SALES_KEYWORDS = [
  'cotacao',
  'cotar',
  'protecao',
  'seguro',
  'rastreador',
  'assistencia',
  'adesao',
  'plano',
  'beneficios',
  'quero te apresentar',
  'fazer sua protecao',
  'contratar',
  'simulacao',
];

function createEmptyCampaignState() {
  return {
    campaignId: '',
    status: 'idle',
    message: '',
    normalizedRecipients: [],
    intent: 'sales',
    intentConfidence: 'baixa',
    intentReason: 'Nenhuma campanha ativa carregada.',
    intentSource: 'none',
    updatedAt: new Date().toISOString(),
  };
}

const activeCampaign = createEmptyCampaignState();

function normalizeMessage(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeRecipient(raw) {
  return normalizePhone(raw) || null;
}

function normalizeRecipients(numbers = []) {
  const seen = new Set();
  const output = [];

  for (const number of numbers) {
    const normalized = normalizeRecipient(number);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function countKeywordHits(text, keywords = []) {
  return keywords.filter((keyword) => text.includes(keyword));
}

function parseJsonObject(rawText = '') {
  const cleaned = String(rawText || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function classifyCampaignIntentHeuristically(message = '') {
  const normalized = normalizeMessage(message);
  if (!normalized) {
    return {
      intent: 'sales',
      intentConfidence: 'baixa',
      intentReason: 'Campanha sem texto suficiente para inferir contexto especial.',
      intentSource: 'heuristic',
      uncertain: true,
    };
  }

  const collectionsHits = countKeywordHits(normalized, COLLECTIONS_KEYWORDS);
  const customerHits = countKeywordHits(normalized, EXISTING_CUSTOMER_KEYWORDS);
  const salesHits = countKeywordHits(normalized, SALES_KEYWORDS);

  const collectionsScore = (collectionsHits.length * 2) + customerHits.length;
  const salesScore = salesHits.length;

  if (collectionsScore >= 5) {
    return {
      intent: 'collections',
      intentConfidence: 'alta',
      intentReason: `Heuristica detectou varios sinais de cobranca: ${collectionsHits.slice(0, 4).join(', ')}.`,
      intentSource: 'heuristic',
      uncertain: false,
    };
  }

  if (collectionsScore >= 3) {
    return {
      intent: 'collections',
      intentConfidence: 'media',
      intentReason: `Heuristica detectou campanha de regularizacao com base em ${collectionsHits.concat(customerHits).slice(0, 4).join(', ')}.`,
      intentSource: 'heuristic',
      uncertain: false,
    };
  }

  if (collectionsHits.length >= 1 || customerHits.length >= 2) {
    return {
      intent: 'collections',
      intentConfidence: 'baixa',
      intentReason: 'Campanha com alguns sinais de cobranca, mas ainda ambigua.',
      intentSource: 'heuristic',
      uncertain: true,
    };
  }

  if (salesScore >= 2) {
    return {
      intent: 'sales',
      intentConfidence: 'media',
      intentReason: `Heuristica detectou linguagem comercial: ${salesHits.slice(0, 3).join(', ')}.`,
      intentSource: 'heuristic',
      uncertain: false,
    };
  }

  return {
    intent: 'sales',
    intentConfidence: 'baixa',
    intentReason: 'Campanha sem sinais suficientes de cobranca; mantendo modo comercial por seguranca.',
    intentSource: 'heuristic',
    uncertain: true,
  };
}

function setActiveCampaignState(nextState = {}) {
  const merged = {
    ...createEmptyCampaignState(),
    ...activeCampaign,
    ...nextState,
    updatedAt: new Date().toISOString(),
  };

  activeCampaign.campaignId = merged.campaignId;
  activeCampaign.status = merged.status;
  activeCampaign.message = merged.message;
  activeCampaign.normalizedRecipients = merged.normalizedRecipients;
  activeCampaign.intent = merged.intent;
  activeCampaign.intentConfidence = merged.intentConfidence;
  activeCampaign.intentReason = merged.intentReason;
  activeCampaign.intentSource = merged.intentSource;
  activeCampaign.updatedAt = merged.updatedAt;
  return getActiveCampaign();
}

function hasAIKey(config = {}) {
  return !!resolveEffectiveAIConfig(config).hasEffectiveKey;
}

async function classifyCampaignIntentWithAI(message = '', config = {}) {
  if (!message || !hasAIKey(config)) return null;

  const systemPrompt = `Voce classifica mensagens de campanha de WhatsApp.

Responda APENAS JSON valido com:
{
  "intent": "collections" | "sales",
  "confidence": "alta" | "media" | "baixa",
  "reason": "texto curto"
}

Classifique como collections somente quando a mensagem for claramente de cobranca, regularizacao, pagamento em atraso, boleto, pendencia financeira ou reativacao de cliente ja existente.
Se houver duvida, responda sales.`;

  try {
    const raw = await callAI(
      config,
      {
        systemPrompt,
        history: [],
        userMessage: `Mensagem da campanha:\n${message}`,
      },
      { purpose: 'qualification' },
    );

    const parsed = parseJsonObject(raw);
    if (!parsed) return null;

    const normalizedIntent = String(parsed.intent || '').trim().toLowerCase();
    const normalizedConfidence = String(parsed.confidence || '').trim().toLowerCase();
    const confidence = ['alta', 'media', 'baixa'].includes(normalizedConfidence)
      ? normalizedConfidence
      : 'baixa';

    return {
      intent: normalizedIntent === 'collections' ? 'collections' : 'sales',
      intentConfidence: confidence,
      intentReason: String(parsed.reason || 'Classificacao inferida pela IA da campanha ativa.').trim(),
      intentSource: 'ai',
      uncertain: false,
    };
  } catch (error) {
    console.warn('[CampaignState] AI campaign intent fallback failed:', error.message);
    return null;
  }
}

async function maybeRefineIntentWithAI(campaignId, message, config) {
  const aiResult = await classifyCampaignIntentWithAI(message, config);
  if (!aiResult) return;
  if (activeCampaign.campaignId !== campaignId) return;

  setActiveCampaignState({
    intent: aiResult.intent,
    intentConfidence: aiResult.intentConfidence,
    intentReason: aiResult.intentReason,
    intentSource: aiResult.intentSource,
  });
}

export function registerActiveCampaign({ message = '', numbers = [], config = {} } = {}) {
  const classification = classifyCampaignIntentHeuristically(message);
  const snapshot = setActiveCampaignState({
    campaignId: randomUUID(),
    status: 'idle',
    message: String(message || '').trim(),
    normalizedRecipients: normalizeRecipients(numbers),
    intent: classification.intent,
    intentConfidence: classification.intentConfidence,
    intentReason: classification.intentReason,
    intentSource: classification.intentSource,
  });

  if (classification.uncertain) {
    void maybeRefineIntentWithAI(snapshot.campaignId, snapshot.message, config);
  }

  return snapshot;
}

export function updateActiveCampaignStatus(status = 'idle') {
  if (!activeCampaign.campaignId) return getActiveCampaign();
  return setActiveCampaignState({ status: String(status || 'idle').trim() || 'idle' });
}

export function clearActiveCampaign(reason = 'Campanha limpa.') {
  return setActiveCampaignState({
    ...createEmptyCampaignState(),
    intentReason: reason || 'Campanha limpa.',
  });
}

export function getActiveCampaign() {
  return {
    campaignId: activeCampaign.campaignId,
    status: activeCampaign.status,
    message: activeCampaign.message,
    normalizedRecipients: [...activeCampaign.normalizedRecipients],
    intent: activeCampaign.intent,
    intentConfidence: activeCampaign.intentConfidence,
    intentReason: activeCampaign.intentReason,
    intentSource: activeCampaign.intentSource,
    updatedAt: activeCampaign.updatedAt,
  };
}

export function getCollectionsContextForPhone(phone, config = {}) {
  if (!config.collectionsModeEnabled) return null;
  if (!activeCampaign.campaignId) return null;
  if (!ACTIVE_COLLECTIONS_STATUSES.has(activeCampaign.status)) return null;
  if (activeCampaign.intent !== 'collections') return null;

  const normalizedPhone = normalizeRecipient(phone);
  if (!normalizedPhone) return null;
  if (!activeCampaign.normalizedRecipients.includes(normalizedPhone)) return null;

  return {
    conversationMode: 'collections',
    campaignId: activeCampaign.campaignId,
    campaignStatus: activeCampaign.status,
    campaignMessage: activeCampaign.message,
    campaignIntent: activeCampaign.intent,
    campaignIntentConfidence: activeCampaign.intentConfidence,
    campaignIntentReason: activeCampaign.intentReason,
    normalizedRecipient: normalizedPhone,
  };
}
