/**
 * AI Provider module — supports Groq (Llama 3.1 8B) and Google Gemini
 * Groq: free, generous limits, excellent PT-BR quality → console.groq.com
 * Gemini: free tier, requires valid project with API enabled → aistudio.google.com
 */

// ── Groq (primary recommended — no billing ever) ──────────────
async function callGroq(apiKey, { systemPrompt, history = [], userMessage }, model = 'llama-3.3-70b-versatile') {
  // FIX: Upgraded from llama-3.1-8b-instant → llama-3.3-70b-versatile
  // 70B follows instructions much better, hallucinates less, handles qualifier marker reliably.
  // Still free: ~500K tokens/day on Groq free tier (well above 8b limits for quality).
  const selectedModel = model || 'llama-3.3-70b-versatile';

  // Deduplicate last user message (prevent double-send in history)
  const dedupedHistory = history.slice(-20);
  const lastH = dedupedHistory[dedupedHistory.length - 1];
  const historyToSend = (lastH && lastH.role === 'user' && lastH.content === userMessage)
    ? dedupedHistory.slice(0, -1)
    : dedupedHistory;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...historyToSend.map(h => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      temperature: 0.65,
      max_tokens: 512,
      top_p: 0.80,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function testGroqKey(apiKey) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: 'Responda apenas: OK' }],
        max_tokens: 10,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { ok: false, message: e?.error?.message || `Erro ${res.status}` };
    }
    const d = await res.json();
    return { ok: true, message: `Groq OK — Llama 3.1 8B ativo! (${d.choices[0].message.content.trim()})` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ── Gemini (alternative — requires valid project) ───────────────
async function callGemini(apiKey, { systemPrompt, history = [], userMessage }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0.65, topP: 0.80, maxOutputTokens: 512 },
  });

  // Gemini: history excludes last user message (sent via sendMessage separately)
  const gcHistory = history
    .slice(-20)
    .filter((_, i, arr) => i < arr.length - 1)
    .map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

  const chat = model.startChat({ history: gcHistory });
  const result = await chat.sendMessage(userMessage);
  return result.response.text();
}

async function testGeminiKey(apiKey) {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent('Responda só com: OK');
    return { ok: true, message: 'Gemini OK! ' + result.response.text().trim() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ── Public exports ────────────────────────────────────────────
export async function callAI(config, context) {
  const provider = config.aiProvider || 'groq';
  const model    = config.aiModel || null; // optional model override from UI
  if (provider === 'gemini') {
    return callGemini(config.geminiKey, context);
  }
  return callGroq(config.groqKey || config.geminiKey, context, model);
}

export async function testAPIKey(provider, apiKey) {
  if (provider === 'gemini') return testGeminiKey(apiKey);
  return testGroqKey(apiKey);
}

// Keep legacy export name for compatibility
export { testGroqKey as testGeminiKey };
