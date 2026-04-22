/**
 * AI provider module - supports Groq and Google Gemini.
 * Reply and qualification can use different models.
 */

import { getDefaultModel, resolveEffectiveAIConfig } from '../data/config-manager.js';

function resolveModel(config, purpose = 'reply') {
  const effective = resolveEffectiveAIConfig(config);
  const provider = effective.effectiveProvider || 'groq';
  if (purpose === 'qualification' && effective.qualificationModel) {
    return effective.qualificationModel;
  }
  return effective.effectiveAiModel || getDefaultModel(provider);
}

function buildHistory(history = []) {
  return history.slice(-18);
}

async function callGroq(apiKey, { systemPrompt, history = [], userMessage }, options = {}) {
  const jsonMode = options.purpose === 'qualification';
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
    temperature: jsonMode ? 0.15 : 0.55,
    max_tokens: jsonMode ? 256 : 512,
    top_p: jsonMode ? 0.4 : 0.8,
  };

  if (jsonMode) {
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
  const jsonMode = options.purpose === 'qualification';
  const generationConfig = {
    temperature: jsonMode ? 0.15 : 0.55,
    topP: jsonMode ? 0.4 : 0.8,
    maxOutputTokens: jsonMode ? 256 : 512,
  };

  if (jsonMode) {
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

  return callGroq(effective.effectiveGroqKey, context, { ...options, model, purpose });
}

export async function testAPIKey(provider, apiKey, model) {
  if (provider === 'gemini') return testGeminiKey(apiKey, model || getDefaultModel('gemini'));
  return testGroqKey(apiKey, model || getDefaultModel('groq'));
}
