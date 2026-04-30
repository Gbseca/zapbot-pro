/**
 * AI provider module - supports Groq and Google Gemini.
 * Reply and qualification can use different models.
 */

import { getDefaultModel, resolveEffectiveAIConfig } from '../data/config-manager.js';

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
  const jsonMode = purpose === 'qualification' || purpose === 'decision';

  if (jsonMode) {
    return {
      jsonMode: true,
      temperature: 0.15,
      topP: 0.4,
      maxTokens: purpose === 'decision' ? 512 : 300,
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
    body.response_format = { type: 'json_object' };
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
    throw new Error(`Groq ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
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
    const label = model === 'llama-3.3-70b-versatile'
      ? 'Groq OK - Llama 3.3 70B ativo!'
      : `Groq OK - ${model} ativo!`;
    return { ok: true, message: `${label} (${data.choices?.[0]?.message?.content?.trim() || 'OK'})` };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function callGemini(apiKey, { systemPrompt, history = [], userMessage }, options = {}) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const settings = resolveGenerationSettings(options);
  const generationConfig = {
    temperature: settings.temperature,
    topP: settings.topP,
    maxOutputTokens: settings.maxTokens,
  };

  if (settings.jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: options.model,
    systemInstruction: systemPrompt,
    generationConfig,
  });

  const chatHistory = buildHistory(history).map((item) => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.content }],
  }));

  const chat = model.startChat({ history: chatHistory });
  const result = await chat.sendMessage(userMessage);
  return result.response.text().trim();
}

async function testGeminiKey(apiKey, model = getDefaultModel('gemini')) {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelClient = genAI.getGenerativeModel({ model });
    const result = await modelClient.generateContent('Responda so com: OK');
    return { ok: true, message: `Gemini OK - ${model} ativo! (${result.response.text().trim()})` };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export async function callAI(config, context, options = {}) {
  const effective = resolveEffectiveAIConfig(config);
  const provider = effective.effectiveProvider || 'groq';
  const purpose = options.purpose || 'reply';
  const model = options.model || resolveModel(effective, purpose);

  if (provider === 'gemini') {
    return callGemini(effective.effectiveGeminiKey, context, { ...options, model, purpose });
  }

  try {
    return await callGroq(effective.effectiveGroqKey, context, { ...options, model, purpose });
  } catch (error) {
    if (effective.geminiFallbackEnabled && effective.effectiveGeminiKey) {
      console.warn(`[AI] Groq failed for ${purpose}; using Gemini fallback: ${error.message}`);
      return callGemini(effective.effectiveGeminiKey, context, {
        ...options,
        model: getDefaultModel('gemini'),
        purpose,
      });
    }
    throw error;
  }
}

export async function testAPIKey(provider, apiKey, model) {
  if (provider === 'gemini') return testGeminiKey(apiKey, model || getDefaultModel('gemini'));
  return testGroqKey(apiKey, model || getDefaultModel('groq'));
}
