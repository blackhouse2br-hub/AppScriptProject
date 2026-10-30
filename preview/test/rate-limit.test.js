'use strict';
// Limits on the routes reachable without signing in (src/rateLimit.js): generous per address (an office shares one),
// tighter per signing link, bounded memory, 429 with Retry-After. Fictional data, local only.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { OAuthState } = require('../src/models');
const { createLimiter } = require('../src/rateLimit');

test('the limiter: fixed windows, the wait in seconds, and at most maxKeys keys kept', () => {
  let t = 0; const take = createLimiter({ max: 3, windowMs: 60e3, maxKeys: 100, now: () => t });
  assert.deepStrictEqual([take('a'), take('a'), take('a')], [0, 0, 0]);
  assert.strictEqual(take('a'), 60, 'the 4th waits for the window');
  assert.strictEqual(take('b'), 0, 'another key is separate');
  t = 59e3; assert.strictEqual(take('a'), 1);
  t = 60e3; assert.strictEqual(take('a'), 0, 'a new window');
  for (let i = 0; i < 1000; i++) take('k' + i);   // a wide spread of addresses: memory stays bounded
  t = 61e3; assert.strictEqual(take('a'), 0, 'the oldest keys were dropped, not the limit enforced wrongly');
});

let mem, server, base;
test.before(async () => {
  mem = await MongoMemoryServer.create();
  ({ server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_rl'), PORT: '0', AUTH_PROVIDER: 'google',
    GOOGLE_CLIENT_ID: '123-test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fake-secret' }, ['node', 'server.js']));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await mongoose.disconnect(); await mem.stop(); });

test('Google sign-in start: an office signing in is fine; a flood from one address stops at 60 per 10 minutes (no unbounded records)', async () => {
  for (let i = 0; i < 60; i++) assert.strictEqual((await fetch(base + '/api/auth/google/start', { redirect: 'manual' })).status, 302);
  const r = await fetch(base + '/api/auth/google/start', { redirect: 'manual' });
  assert.strictEqual(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.match(await r.text(), /Too many sign-in attempts from this connection/);
  assert.strictEqual(await OAuthState.countDocuments(), 60, 'refused starts write nothing');
});

test('the signing page: limited per link, so one signing link can\'t be hammered', async () => {
  const link = base + '/sign/' + 'A'.repeat(43);
  let last;
  for (let i = 0; i < 61; i++) last = await fetch(link);
  assert.strictEqual(last.status, 429, 'the 61st view of one link within 10 minutes');
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.strictEqual((await fetch(base + '/sign/' + 'B'.repeat(43))).status, 404, 'another link (same address) still answers');
});
