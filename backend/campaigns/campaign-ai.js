import { callAI } from '../ai/gemini.js';
import { resolveEffectiveAIConfig } from '../data/config-manager.js';

const ACTIONS = new Set(['compose', 'improve', 'shorten', 'natural', 'variants', 'review']);
const FORBIDDEN_TERMS = /\b(seguro|seguradora|apolice|sinistro|premio)\b/i;

function normalizeForPolicy(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function cleanText(value, maxLength = 4000) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .trim()
    .slice(0, maxLength);
}

function parseJson(raw) {
  const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function deterministicResult(action, input = {}) {
  const original = cleanText(input.message || input.prompt);
  const objective = cleanText(input.objective || 'iniciar uma conversa', 180);
  const audience = cleanText(input.audience || 'contatos que autorizaram mensagens', 180);
  const base = original || `Oi, {{nome}}! A Moove tem uma novidade pensada para voce. Posso te contar em uma mensagem curta?`;

  if (action === 'shorten') {
    const sentences = base.split(/(?<=[.!?])\s+/).filter(Boolean);
    return { message: cleanText(sentences.slice(0, 2).join(' ') || base, 700), variants: [], review: [] };
  }
  if (action === 'natural') {
    return { message: base.replace(/prezado\(a\)/gi, 'Oi').replace(/venho por meio desta/gi, 'quero te contar'), variants: [], review: [] };
  }
  if (action === 'variants') {
    return {
      message: base,
      variants: [
        { id: 'direta', name: 'Direta', message: base, weight: 1 },
        { id: 'conversa', name: 'Conversa', message: `Oi, {{nome}}! Tudo bem? ${base.replace(/^oi[^!?.]*[!?.]?\s*/i, '')}`, weight: 1 },
        { id: 'curta', name: 'Curta', message: cleanText(base.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '), 500), weight: 1 },
      ],
      review: [],
    };
  }
  if (action === 'review') {
    const review = [];
    if (!base.includes('{{nome}}')) review.push({ severity: 'info', message: 'Considere usar {{nome}} quando a coluna estiver preenchida.' });
    if (base.length > 700) review.push({ severity: 'warning', message: 'A mensagem esta longa para uma primeira abordagem.' });
    if (!/[?]$/.test(base)) review.push({ severity: 'info', message: 'Uma pergunta simples pode facilitar a resposta do contato.' });
    if (FORBIDDEN_TERMS.test(normalizeForPolicy(base))) review.push({ severity: 'error', message: 'Ha um termo proibido pelas regras institucionais da Moove.' });
    return { message: base, variants: [], review };
  }
  if (action === 'improve') {
    return { message: base, variants: [], review: [{ severity: 'info', message: 'Versao revisada com foco em clareza e uma unica acao.' }] };
  }
  return {
    message: `Oi, {{nome}}! Tudo bem? A Moove quer ${objective} com ${audience}. Posso te explicar de forma bem rapida?`,
    variants: [],
    review: [],
  };
}

function sanitizeResult(result, fallback) {
  const message = cleanText(result?.message || fallback.message);
  const variants = Array.isArray(result?.variants)
    ? result.variants.slice(0, 5).map((variant, index) => ({
      id: cleanText(variant?.id || `variante-${index + 1}`, 80),
      name: cleanText(variant?.name || `Variante ${index + 1}`, 80),
      message: cleanText(variant?.message),
      weight: Math.max(1, Math.min(100, Number(variant?.weight) || 1)),
    })).filter(variant => variant.message)
    : fallback.variants;
  const review = Array.isArray(result?.review)
    ? result.review.slice(0, 12).map(item => ({
      severity: ['error', 'warning', 'info'].includes(item?.severity) ? item.severity : 'info',
      message: cleanText(item?.message, 300),
    })).filter(item => item.message)
    : fallback.review;
  return { message, variants, review };
}

export async function runCampaignAI({ config = {}, action = 'compose', input = {} } = {}) {
  const safeAction = ACTIONS.has(action) ? action : 'compose';
  const fallback = deterministicResult(safeAction, input);
  const effective = resolveEffectiveAIConfig(config);
  if (!effective.hasEffectiveKey) return { ...fallback, source: 'deterministic' };

  const systemPrompt = `Voce e o redator de campanhas da Moove Protecao Veicular.

Crie mensagens de WhatsApp humanas, curtas, claras e respeitosas. A Moove e uma associacao de protecao veicular baseada em mutualismo e rateio, nao uma seguradora.
Nunca use os termos seguro, seguradora, apolice, sinistro ou premio. Use protecao veicular, associacao, evento, cota de participacao, rateio e vistoria.
Nao invente preco, prazo, desconto, cobertura, disponibilidade, atendimento concluido ou promessa operacional.
Use no maximo uma pergunta por mensagem. Preserve variaveis no formato {{nome}}. Nao crie urgencia falsa.
Responda apenas JSON valido: {"message":"texto","variants":[{"id":"id","name":"nome","message":"texto","weight":1}],"review":[{"severity":"error|warning|info","message":"texto"}]}.
Para review, nao reescreva sem necessidade e preencha review. Para variants, gere de 2 a 4 versoes realmente diferentes.`;

  const userMessage = JSON.stringify({
    action: safeAction,
    objective: cleanText(input.objective, 180),
    audience: cleanText(input.audience, 180),
    tone: cleanText(input.tone || 'humano e direto', 80),
    message: cleanText(input.message),
    prompt: cleanText(input.prompt, 800),
  });

  try {
    const raw = await callAI(config, { systemPrompt, history: [], userMessage }, { purpose: 'reply' });
    const parsed = parseJson(raw);
    if (!parsed) throw new Error('Resposta da IA fora do formato esperado.');
    const result = sanitizeResult(parsed, fallback);
    if ([result.message, ...result.variants.map(item => item.message)].some(text => FORBIDDEN_TERMS.test(normalizeForPolicy(text)))) {
      throw new Error('Resposta da IA contrariou os termos institucionais.');
    }
    return { ...result, source: 'ai' };
  } catch (error) {
    return { ...fallback, source: 'deterministic', warning: cleanText(error.message, 240) };
  }
}

export const CAMPAIGN_AI_ACTIONS = Object.freeze([...ACTIONS]);
