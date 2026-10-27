'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('HTTP pages survive an outage, APIs recover, and diagnostics remain private', async t => {
  process.env.DATABASE_URL = 'postgres://test:private-test-password@localhost/test';
  process.env.JWT_SECRET = 'local-test-key';
  delete process.env.CRON_SECRET;
  const db = require('../src/database');
  let attempts = 0;
  t.mock.method(db, 'initDb', async () => {
    if (++attempts === 1) throw new Error('Connection terminated unexpectedly');
  });
  const query = t.mock.method(db.pool, 'query', async () => {
    throw new Error('private database error');
  });
  const app = require('../src/server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await db.pool.end();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/login', '/register', '/app', '/reset-password']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    await response.text();
  }
  assert.equal(attempts, 0);
  for (const path of ['/api/debug/env', '/api/debug/db', '/api/debug/fix-chatid/1']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404);
    await response.text();
  }
  assert.equal(attempts, 0);
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 503);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { status: 'degraded', db: 'error' });
  const login = () => fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const unavailable = await login();
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'DATABASE_UNAVAILABLE');
  const recovered = await login();
  assert.equal(recovered.status, 400); // Auth route is reachable again.
  await recovered.json();
  assert.equal(attempts, 2);
  const cron = await fetch(base + '/api/cron/reminder');
  assert.equal(cron.status, 401);
  await cron.json();
  query.mock.mockImplementation(async () => ({ rows: [{ value: 1 }] }));
  const healthy = await fetch(base + '/api/health');
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { status: 'ok', db: 'ok' });
});
