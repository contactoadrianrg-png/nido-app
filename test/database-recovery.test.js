'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabaseMiddleware } = require('../src/middleware/database');

function request(middleware) {
  const response = {
    headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
  return middleware({}, response, () => { response.passed = true; }).then(() => response);
}

test('recovers on the next request after a rejected database initialization', async () => {
  let attempts = 0;
  const middleware = createDatabaseMiddleware(async () => {
    if (++attempts === 1) throw new Error('private provider error');
  });
  const failed = await request(middleware);
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.code, 'DATABASE_UNAVAILABLE');
  assert.equal(failed.headers['Retry-After'], '5');
  assert.ok(!JSON.stringify(failed.body).includes('private provider error'));
  assert.equal((await request(middleware)).passed, true);
  assert.equal((await request(middleware)).passed, true);
  assert.equal(attempts, 2);
});

test('concurrent requests share initialization and can all retry after failure', async () => {
  let rejectFirst;
  let attempts = 0;
  const middleware = createDatabaseMiddleware(() => {
    attempts++;
    if (attempts === 1) return new Promise((_, reject) => { rejectFirst = reject; });
  });
  const pending = [request(middleware), request(middleware), request(middleware)];
  await Promise.resolve();
  assert.equal(attempts, 1);
  rejectFirst(new Error('database restarting'));
  assert.ok((await Promise.all(pending)).every(response => response.statusCode === 503));
  const recovered = await Promise.all([request(middleware), request(middleware)]);
  assert.ok(recovered.every(response => response.passed));
  assert.equal(attempts, 2);
});
