'use strict';
// NODE_ENV=production starts only when each condition of src/production.js holds (config only; nothing is started).
const test = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { CHECKLIST_ACK, mongoHost } = require('../src/production');

const ARGV = ['node', 'server.js'];
// a complete, fictional production configuration
const OK = { APP_MODE: 'mongo', NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://app:fake@cluster0.example.mongodb.net/bh', HOST: '0.0.0.0', PORT: '8080',
  PUBLIC_API_URL: 'https://portal.example.com', AUTH_PROVIDER: 'google', GOOGLE_CLIENT_ID: '1-x.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fake',
  KPI_REVIEWER_TOBY_EMAIL: 'toby@example.com', KPI_REVIEWER_JONJO_EMAIL: 'jonjo@example.com', PRODUCTION_CHECKLIST_ACK: CHECKLIST_ACK };
const refused = (env, re) => assert.throws(() => loadConfig(env, ARGV), (e) => /^Production start refused: /.test(e.message) && re.test(e.message) && !/fake|cluster0/.test(e.message));

test('production starts when every condition holds: Google sign-in, secure cookies, trusted proxy', () => {
  const c = loadConfig(OK, ARGV);
  assert.strictEqual(c.production, true);
  assert.deepStrictEqual([c.auth.provider, c.web.secureCookies, c.web.trustProxy, c.web.apiOrigin], ['google', true, true, 'https://portal.example.com']);
});

test('each missing condition refuses production, naming the variable and never a value', () => {
  refused({ ...OK, PRODUCTION_CHECKLIST_ACK: '' }, /PRODUCTION_CHECKLIST_ACK=DEPLOYMENT\.md-before-production-v1/);
  refused({ ...OK, PRODUCTION_CHECKLIST_ACK: 'DEPLOYMENT.md-before-production-v0' }, /PRODUCTION_CHECKLIST_ACK/);
  refused({ ...OK, KPI_REVIEWER_JONJO_EMAIL: '' }, /KPI_REVIEWER_JONJO_EMAIL must be set/);
  refused({ ...OK, KPI_REVIEWER_TOBY_EMAIL: '', KPI_REVIEWER_JONJO_EMAIL: '' }, /KPI_REVIEWER_TOBY_EMAIL and KPI_REVIEWER_JONJO_EMAIL/);
  refused({ ...OK, MONGODB_URI: 'mongodb://127.0.0.1:27017/bh' }, /MONGODB_URI points at this computer/);
  refused({ ...OK, MONGODB_URI: 'mongodb://user:pw@localhost/bh' }, /MONGODB_URI/);
  for (const k of ['MONDAY_API_URL', 'RESPOND_API_URL', 'GOOGLE_AUTH_URL', 'GOOGLE_REVOKE_URL']) refused({ ...OK, [k]: 'http://127.0.0.1:9/x' }, new RegExp(k + ' is for local tests only'));
  refused({ ...OK, LOI_SIGNING: 'on' }, /LOI_SIGN_SECRET/);
  refused({ ...OK, LOI_SIGNING: 'on', LOI_SIGN_SECRET: 'short' }, /LOI_SIGN_SECRET/);
  assert.strictEqual(loadConfig({ ...OK, LOI_SIGNING: 'on', LOI_SIGN_SECRET: 'x'.repeat(40) }, ARGV).storage.signing, true);
});

test('what stays refused before these checks: demo mode, password sign-in, a local address', () => {
  assert.throws(() => loadConfig({ ...OK, APP_MODE: 'demo' }, ARGV), /Demo mode/);
  assert.throws(() => loadConfig({ ...OK, AUTH_PROVIDER: 'password' }, ARGV), /Email-and-password sign-in is for the local preview only/);
  assert.throws(() => loadConfig({ ...OK, HOST: '127.0.0.1', PUBLIC_API_URL: '' }, ARGV), /Email-and-password|Production start refused: production requires HOST=0\.0\.0\.0/);
  assert.throws(() => loadConfig({ ...OK, GOOGLE_CLIENT_SECRET: '' }, ARGV), /GOOGLE_CLIENT_SECRET/);
});

test('the database host is read from the URI', () => {
  assert.strictEqual(mongoHost('mongodb+srv://u:p@cluster0.abc.mongodb.net/db?x=1'), 'cluster0.abc.mongodb.net');
  assert.strictEqual(mongoHost('mongodb://127.0.0.1:27017,127.0.0.2/db'), '127.0.0.1');
  assert.strictEqual(mongoHost('mongodb://[::1]:27017/db'), '::1');
});
