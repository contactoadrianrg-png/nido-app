'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('an empty database does not create an administrator with default credentials', async t => {
  process.env.DATABASE_URL = 'postgres://test@localhost/test';
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.TELEGRAM_BOT_TOKEN;
  const db = require('../src/database');
  const queries = [];
  t.mock.method(db.pool, 'query', async sql => {
    queries.push(sql);
    return { rows: [{ c: 0 }] };
  });
  t.mock.method(console, 'log', () => {});
  await db.initDb();
  assert.ok(queries.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS users')));
  assert.ok(!queries.some(sql => sql.includes('INSERT INTO users')));
  delete process.env.DATABASE_URL;
  const count = queries.length;
  await assert.rejects(db.initDb(), /DATABASE_URL no configurada/);
  assert.equal(queries.length, count);
  await db.pool.end();
});
