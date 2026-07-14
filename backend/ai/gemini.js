/**
 * AI provider module - supports Groq and Google Gemini.
 * Reply and qualification can use different models.
 */

import { getDefaultModel, resolveEffectiveAIConfig } from '../data/config-manager.js';

const GEMINI_RATE_LIMIT_COOLDOWN_MS = 65_000;
const GROQ_BACKUP_MODELS = ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];
let geminiCooldownUntil = 0;

function shortProviderError(error) {
  return String(error?.message || error || 'erro desconhecido').split('\n')[0].slice(0, 320);
}

function isRateLimitError(error) {
  return /\b429\b|too many requests|quota|resource_exhausted|rate.?limit/i.test(String(error?.message || error || ''));
}

function shouldTryGroqBackup(error) {
  return isRateLimitError(error)
    || /model.{0,80}(?:not found|decommission|deprecated|permission|unavailable)|json_validate_failed|does not match the expected schema|failed_generation|\b404\b|\b403\b/i.test(String(error?.message || error || ''));
}

function resolveModel(config, purpose = 'reply') {
  const effective = resolveEffectiveAIConfig(config);
  const provider = effective.effectiveProvider || 'groq';
  if (purpose === 'decision' && effective.effectiveClassificationModel) {
    return effective.effectiveClassificationModel;
  }
  if (purpose === 'qualification' && effective.effectiveQualificationModel) {
    return effective.effectiveQualificationModel;
  }
  return effective.effectiveAiModel || getDefaultModel(provider);
}

function buildHistory(history = []) {
  return history.slice(-18);
}

function resolveGenerationSettings(options = {}) {
  const purpose = options.purpose || 'reply';
  const mode = options.mode || 'sales';
  const jsonMode = purpose === 'qualification'
    || purpose === 'decision'
    || purpose === 'customer_agent';

  if (jsonMode) {
    return {
      jsonMode: true,
      temperature: purpose === 'customer_agent' ? 0.35 : 0.15,
      topP: purpose === 'customer_agent' ? 0.7 : 0.4,
      maxTokens: purpose === 'customer_agent' ? 750 : purpose === 'decision' ? 512 : 300,
    };
  }

  if (purpose === 'case_summary') {
    return {
      jsonMode: false,
      temperature: 0.25,
      topP: 0.55,
      maxTokens: 500,
    };
  }

  if (mode === 'collections') {
    return {
      jsonMode: false,
      temperature: 0.32,
      topP: 0.65,
      maxTokens: 300,
    };
  }

  return {
    jsonMode: false,
    temperature: 0.55,
    topP: 0.8,
    maxTokens: 512,
  };
}

function toJsonSchema(value) {
  if (Array.isArray(value)) return value.map(toJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'type' && typeof item === 'string') normalized[key] = item.toLowerCase();
    else normalized[key] = toJsonSchema(item);
  }
  if (normalized.type === 'object') normalized.additionalProperties = false;
  return normalized;
}

function supportsGroqJsonSchema(model = '') {
  return /^openai\/gpt-oss-(?:20b|120b)$/i.test(String(model));
}

async function callGroq(apiKey, { systemPrompt, history = [], userMessage }, options = {}) {
  const settings = resolveGenerationSettings(options);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...buildHistory(history).map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const body = {
    model: options.model,
    messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    top_p: settings.topP,
  };

  if (settings.jsonMode) {
    body.response_format = options.responseSchema && supportsGroqJsonSchema(options.model)
      ? {
          type: 'json_schema',
          json_schema: {
            name: 'customer_agent_response',
            strict: true,
            schema: toJsonSchema(options.responseSchema),
          },
        }
      : { type: 'json_object' };
  }

  if (/^openai\/gpt-oss-/i.test(String(options.model)) && options.purpose === 'customer_agent') {
    body.reasoning_effort = 'low';
    body.reasoning_format = 'hidden';
  } else if (/^qwen\/qwen3/i.test(String(options.model)) && options.purpose === 'customer_agent') {
    body.reasoning_effort = 'none';
    body.reasoning_format = 'hidden';
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const retryAfter = response.headers.get('retry-after');
    throw new Error(`Groq ${response.status}: ${errorText}${retryAfter ? ` Retry after ${retryAfter}s.` : ''}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callGroqResilient(apiKey, context, options = {}) {
  const models = [...new Set([options.model, ...GROQ_BACKUP_MODELS].filter(Boolean))];
  let lastError = null;
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      const text = await callGroq(apiKey, context, { ...options, model });
      return { text, model };
    } catch (error) {
      lastError = error;
      const nextModel = models[index + 1];
      if (!nextModel || !shouldTryGroqBackup(error)) throw error;
      console.warn(`[AI] Groq model ${model} unavailable; using ${nextModel}: ${shortProviderError(error)}`);
    }
  }
  throw lastError;
}

async function testGroqKey(apiKey, model = getDefaultModel('groq')) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Responda apenas: OK' }],
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      return { ok: false, message: errorPayload?.error?.message || `Erro ${response.status}` };
    }

    const data = await response.json();
    const label = `Groq OK - ${model} ativo!`;
    return { ok: true, message: `${label} (${data.choices?.[0]?.message?.content?.trim() || 'OK'})` };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function callGemini(apiKey, { systemPrompt, history = [], userMessage }, options = {}) {
  const { GoogleGenAI } = await import('@google/genai');
  const settings = resolveGenerationSettings(options);
  const generationConfig = {
    temperature: settings.temperature,
    topP: settings.topP,
    maxOutputTokens: settings.maxTokens,
    systemInstruction: systemPrompt,
  };

  if (settings.jsonMode) {
    generationConfig.responseMimeType = 'application/json';
    if (options.responseSchema) generationConfig.responseSchema = options.responseSchema;
  }

  const ai = new GoogleGenAI({ apiKey });
  const contents = [
    ...buildHistory(history).map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
  const response = await ai.models.generateContent({
    model: options.model,
    contents,
    config: generationConfig,
  });
  return String(response.text || '').trim();
}

async function testGeminiKey(apiKey, model = getDefaultModel('gemini')) {
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: 'Responda so com: OK',
      config: { maxOutputTokens: 10, temperature: 0 },
    });
    return { ok: true, message: `Gemini OK - ${model} ativo! (${String(response.text || '').trim()})` };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function formatCallResult(text, provider, model, options = {}) {
  if (!options.returnMetadata) return text;
  return { text, provider, model };
}

export async function callAI(config, context, options = {}) {
  const effective = resolveEffectiveAIConfig(config);
  const provider = effective.effectiveProvider || 'groq';
  const purpose = options.purpose || 'reply';
  const model = options.model || resolveModel(effective, purpose);

  if (provider === 'gemini') {
    const groqFallbackOptions = {
      ...options,
      model: getDefaultModel('groq'),
      purpose,
    };

    if (effective.effectiveGroqKey && Date.now() < geminiCooldownUntil) {
      const result = await callGroqResilient(effective.effectiveGroqKey, context, groqFallbackOptions);
      return formatCallResult(result.text, 'groq', result.model, options);
    }

    try {
      const text = await callGemini(effective.effectiveGeminiKey, context, { ...options, model, purpose });
      return formatCallResult(text, 'gemini', model, options);
    } catch (error) {
      if (!effective.effectiveGroqKey) throw error;

      if (isRateLimitError(error)) {
        geminiCooldownUntil = Date.now() + GEMINI_RATE_LIMIT_COOLDOWN_MS;
      }
      console.warn(`[AI] Gemini failed for ${purpose}; using Groq fallback: ${shortProviderError(error)}`);
      try {
        const result = await callGroqResilient(effective.effectiveGroqKey, context, groqFallbackOptions);
        return formatCallResult(result.text, 'groq', result.model, options);
      } catch (fallbackError) {
        throw new Error(
          `Gemini failed: ${shortProviderError(error)}; Groq fallback failed: ${shortProviderError(fallbackError)}`,
        );
      }
    }
  }

  try {
    const result = await callGroqResilient(effective.effectiveGroqKey, context, { ...options, model, purpose });
    return formatCallResult(result.text, 'groq', result.model, options);
  } catch (error) {
    if (effective.geminiFallbackEnabled && effective.effectiveGeminiKey) {
      console.warn(`[AI] Groq failed for ${purpose}; using Gemini fallback: ${error.message}`);
      const fallbackModel = getDefaultModel('gemini');
      const text = await callGemini(effective.effectiveGeminiKey, context, {
        ...options,
        model: fallbackModel,
        purpose,
      });
      return formatCallResult(text, 'gemini', fallbackModel, options);
    }
    throw error;
  }
}

export async function testAPIKey(provider, apiKey, model) {
  if (provider === 'gemini') return testGeminiKey(apiKey, model || getDefaultModel('gemini'));
  return testGroqKey(apiKey, model || getDefaultModel('groq'));
}
