import { GoogleGenerativeAI } from '@google/generative-ai';

let _client = null;
let _lastKey = null;

function getClient(apiKey) {
  if (!_client || _lastKey !== apiKey) {
    _client = new GoogleGenerativeAI(apiKey);
    _lastKey = apiKey;
  }
  return _client;
}

export async function callGemini(apiKey, { systemPrompt, history = [], userMessage }) {
  const genAI = getClient(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.85,      // Criativo mas controlado
      topP: 0.95,
      maxOutputTokens: 1024,
    },
  });

  // Convert to Gemini format (skip last user message, it goes as sendMessage)
  const gcHistory = history
    .filter((_, i) => i < history.length - 1) // All but last
    .map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

  const chat = model.startChat({ history: gcHistory });
  const result = await chat.sendMessage(userMessage);
  return result.response.text();
}

export async function testGeminiKey(apiKey) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent('Responda só com: OK');
    const text = result.response.text();
    return { ok: true, message: 'API Key válida! ' + text.trim() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
