/**
 * AI provider module — supports Groq and Google Gemini.
 * Reply and qualification can use different models.
 */

import { getDefaultModel } from '../data/config-manager.js';

function resolveModel(config, purpose = 'reply') {
  const provider = config.aiProvider || 'groq';
  if (purpose === 'qualification' && config.qualificationModel) {
    return config.qualificationModel;
  }
  return config.aiModel || getDefaultModel(provider);
}

function buildHistory(history = []) {
  return history.slice(-18);
}

async function callGroq(apiKey, { systemPrompt, history = [], userMessage }, options = {}) {
  const jsonMode = options.purpose === 'qualification';
  const messages = [
    { role: 'system', content: systemPrompt },
    ...buildHistory(history).map(h => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content,
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

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function testGroqKey(apiKey, model = getDefaultModel('groq')) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Responda apenas: OK' }],
        max_tokens: 10,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, message: err?.error?.message || `Erro ${res.status}` };
    }

    const data = await res.json();
    const label = model === 'llama-3.1-8b-instant' ? 'Groq OK — Llama 3.1 8B ativo!' : `Groq OK — ${model} ativo!`;
    return { ok: true, message: `${label} (${data.choices?.[0]?.message?.content?.trim() || 'OK'})` };
  } catch (err) {
    return { ok: false, message: err.message };
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

  const gcHistory = buildHistory(history).map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));

  const chat = model.startChat({ history: gcHistory });
  const result = await chat.sendMessage(userMessage);
  return result.response.text().trim();
}

async function testGeminiKey(apiKey, model = getDefaultModel('gemini')) {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({ model });
    const result = await gm.generateContent('Responda só com: OK');
    return { ok: true, message: `Gemini OK — ${model} ativo! (${result.response.text().trim()})` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export async function callAI(config, context, options = {}) {
  const provider = config.aiProvider || 'groq';
  const purpose = options.purpose || 'reply';
  const model = options.model || resolveModel(config, purpose);

  if (provider === 'gemini') {
    return callGemini(config.geminiKey, context, { ...options, model, purpose });
  }

  return callGroq(config.groqKey, context, { ...options, model, purpose });
}

export async function testAPIKey(provider, apiKey, model) {
  if (provider === 'gemini') return testGeminiKey(apiKey, model || getDefaultModel('gemini'));
  return testGroqKey(apiKey, model || getDefaultModel('groq'));
}
