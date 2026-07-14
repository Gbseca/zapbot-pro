import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadsAccessGuard } from './leads-access-guard.js';

function request(headers = {}) {
  return {
    headers: {
      host: 'zapbot.local',
      'user-agent': 'test-agent',
      ...headers,
    },
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

test('issues a same-origin session and validates it for reads', () => {
  const guard = createLeadsAccessGuard();
  const req = request({ origin: 'http://zapbot.local' });
  const session = guard.issue(req);
  assert.ok(session.token);
  req.headers['x-leads-token'] = session.token;
  const res = response();
  let passed = false;
  guard.read(req, res, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(res.statusCode, 200);
});

test('rejects cross-origin sessions and missing tokens', () => {
  const guard = createLeadsAccessGuard();
  assert.equal(guard.issue(request({ origin: 'https://attacker.example' })), null);
  const res = response();
  guard.read(request({ origin: 'http://zapbot.local' }), res, () => assert.fail('must not pass'));
  assert.equal(res.statusCode, 403);
});

test('rate limits repeated mutations without blocking reads', () => {
  const guard = createLeadsAccessGuard({ mutationLimit: 1, mutationWindowMs: 60000 });
  const req = request({ origin: 'http://zapbot.local' });
  const session = guard.issue(req);
  req.headers['x-leads-token'] = session.token;
  guard.mutation(req, response(), () => {});
  const limited = response();
  guard.mutation(req, limited, () => assert.fail('second mutation must be limited'));
  assert.equal(limited.statusCode, 429);
  let readPassed = false;
  guard.read(req, response(), () => { readPassed = true; });
  assert.equal(readPassed, true);
});
