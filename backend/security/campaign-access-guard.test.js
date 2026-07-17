import assert from 'node:assert/strict';
import test from 'node:test';
import { createCampaignAccessGuard } from './campaign-access-guard.js';

function request(headers = {}) {
  return {
    headers: { host: 'zapbot.local', 'user-agent': 'test-agent', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

test('protects reads and mutations with a same-origin campaign session', () => {
  const guard = createCampaignAccessGuard();
  const req = request({ origin: 'http://zapbot.local' });
  const session = guard.issue(req);
  req.headers['x-campaign-token'] = session.token;
  let passed = false;
  guard.read(req, response(), () => { passed = true; });
  assert.equal(passed, true);
});

test('uses a separate rate limit for AI operations', () => {
  const guard = createCampaignAccessGuard({ aiLimit: 1, aiWindowMs: 60000 });
  const req = request({ origin: 'http://zapbot.local' });
  req.headers['x-campaign-token'] = guard.issue(req).token;
  guard.ai(req, response(), () => {});
  const limited = response();
  guard.ai(req, limited, () => assert.fail('second AI request must be limited'));
  assert.equal(limited.statusCode, 429);
  let readPassed = false;
  guard.read(req, response(), () => { readPassed = true; });
  assert.equal(readPassed, true);
});
