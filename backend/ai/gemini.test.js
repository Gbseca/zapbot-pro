import test from 'node:test';
import assert from 'node:assert/strict';

import { callAI } from './gemini.js';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
  },
  required: ['reply'],
};

function response({ ok = true, status = 200, payload = {}, retryAfter = null } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function groqSuccess(content = '{"reply":"ok"}') {
  return response({ payload: { choices: [{ message: { content } }] } });
}

function config(model = 'openai/gpt-oss-120b') {
  return {
    aiProvider: 'groq',
    aiModel: model,
    groqKey: 'test-groq-key',
    geminiKey: '',
  };
}

const context = {
  systemPrompt: 'Retorne JSON.',
  history: [],
  userMessage: 'Oi',
};

test('sends a strict JSON schema to supported Groq models', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return groqSuccess();
  };
  try {
    const result = await callAI(config(), context, {
      purpose: 'customer_agent',
      responseSchema: RESPONSE_SCHEMA,
      returnMetadata: true,
    });

    assert.equal(result.model, 'openai/gpt-oss-120b');
    assert.equal(requests[0].response_format.type, 'json_schema');
    assert.equal(requests[0].response_format.json_schema.schema.type, 'object');
    assert.equal(requests[0].response_format.json_schema.schema.additionalProperties, false);
    assert.equal(requests[0].reasoning_effort, 'low');
    assert.equal(requests[0].max_tokens, 650);
  } finally {
    global.fetch = originalFetch;
  }
});

test('falls back to GPT OSS 20B when the primary Groq model is rate limited', async () => {
  const originalFetch = global.fetch;
  const models = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    models.push(body.model);
    if (models.length === 1) {
      return response({
        ok: false,
        status: 429,
        retryAfter: '4',
        payload: { error: { message: 'rate limit reached' } },
      });
    }
    return groqSuccess();
  };
  try {
    const result = await callAI(config(), context, {
      purpose: 'customer_agent',
      responseSchema: RESPONSE_SCHEMA,
      returnMetadata: true,
    });

    assert.deepEqual(models, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
    assert.equal(result.model, 'openai/gpt-oss-20b');
  } finally {
    global.fetch = originalFetch;
  }
});

test('falls back when a Groq model cannot satisfy the strict response schema', async () => {
  const originalFetch = global.fetch;
  const models = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    models.push(body.model);
    if (models.length === 1) {
      return response({
        ok: false,
        status: 400,
        payload: { error: { message: 'json_validate_failed: output does not match the expected schema' } },
      });
    }
    return groqSuccess();
  };
  try {
    const result = await callAI(config(), context, {
      purpose: 'customer_agent',
      responseSchema: RESPONSE_SCHEMA,
      returnMetadata: true,
    });

    assert.deepEqual(models, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
    assert.equal(result.model, 'openai/gpt-oss-20b');
  } finally {
    global.fetch = originalFetch;
  }
});

test('salvages a nearly valid strict-schema generation for the local validator', async () => {
  const originalFetch = global.fetch;
  const partial = '{"reply":"Posso ajudar.","primaryIntent":"other"}';
  global.fetch = async () => response({
    ok: false,
    status: 400,
    payload: {
      error: {
        code: 'json_validate_failed',
        message: 'output does not match the expected schema',
        failed_generation: partial,
      },
    },
  });
  try {
    const result = await callAI(config(), context, {
      purpose: 'customer_agent',
      responseSchema: RESPONSE_SCHEMA,
      returnMetadata: true,
    });

    assert.equal(result.text, partial);
    assert.equal(result.model, 'openai/gpt-oss-120b');
  } finally {
    global.fetch = originalFetch;
  }
});

test('uses Qwen as the third free Groq layer and keeps JSON mode', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length < 3) {
      return response({ ok: false, status: 429, payload: { error: { message: 'rate limit reached' } } });
    }
    return groqSuccess();
  };
  try {
    const result = await callAI(config(), context, {
      purpose: 'customer_agent',
      responseSchema: RESPONSE_SCHEMA,
      returnMetadata: true,
    });

    assert.deepEqual(requests.map((request) => request.model), [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.6-27b',
    ]);
    assert.equal(requests[2].response_format.type, 'json_object');
    assert.equal(requests[2].reasoning_effort, 'none');
    assert.equal(result.model, 'qwen/qwen3.6-27b');
  } finally {
    global.fetch = originalFetch;
  }
});

test('uses Llama 70B as the fourth free Groq layer', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length < 4) {
      return response({ ok: false, status: 429, payload: { error: { message: 'rate limit reached' } } });
    }
    return groqSuccess();
  };
  try {
    const result = await callAI(config(), context, {
      purpose: 'customer_agent',
      responseSchema: RESPONSE_SCHEMA,
      returnMetadata: true,
    });

    assert.deepEqual(requests.map((request) => request.model), [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.6-27b',
      'llama-3.3-70b-versatile',
    ]);
    assert.equal(requests[3].response_format.type, 'json_object');
    assert.equal(result.model, 'llama-3.3-70b-versatile');
  } finally {
    global.fetch = originalFetch;
  }
});
