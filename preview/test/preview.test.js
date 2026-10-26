'use strict';
// Demo mode, configuration and startup behaviour (no database needed).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadConfig } = require('../src/config');
const net = require('net');
const { start, serverUrl, reportStartupError, printBanner } = require('../server');

const PUB = path.join(__dirname, '..', 'public');
const NO_ARGS = ['node', 'server.js'];

test('demo data is fictional, consistent and reproducible', () => {
  const demo = require('../public/demo-data'), now = new Date('2026-10-22T09:00:00Z');
  const d = demo.generate(now);
  assert.deepStrictEqual(demo.generate(now), d);
  assert.ok(d.leads.length > 40 && d.listings.length > 30 && d.calendar.length > 10);
  const leadIds = new Set(d.leads.map((l) => l.id)), listingIds = new Set(d.listings.map((l) => l.id));
  for (const v of d.calendar) { assert.ok(leadIds.has(v.leadId)); assert.ok(listingIds.has(v.listingId)); }
  for (const l of d.leads) { assert.match(l.email, /@example\.com$/); assert.match(l.phone, /^\+63 900 555 \d{4}$/); assert.match(l.code, /^DEMO-/); }
  for (const u of d.users) assert.match(u.email, /@example\.com$/);
});

test('mode selection is explicit', () => {
  assert.strictEqual(loadConfig({}, NO_ARGS).mode, 'demo');
  assert.strictEqual(loadConfig({ APP_MODE: 'demo', MONGODB_URI: 'mongodb://h/db' }, NO_ARGS).mode, 'demo');
  assert.strictEqual(loadConfig({ MONGODB_URI: 'mongodb://h/db' }, NO_ARGS).mode, 'mongo');
  assert.strictEqual(loadConfig({ MONGODB_URI: 'mongodb://h/db' }, [...NO_ARGS, '--mode=demo']).mode, 'demo');
  assert.throws(() => loadConfig({ APP_MODE: 'mongo' }, NO_ARGS), /needs MONGODB_URI/);
  assert.throws(() => loadConfig({ APP_MODE: 'mongo', MONGODB_URI: 'http://x' }, NO_ARGS), /must start with mongodb/);
  assert.throws(() => loadConfig({ APP_MODE: 'live' }, NO_ARGS), /must be "demo" or "mongo"/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }, NO_ARGS), /Demo mode is for local use only/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_MODE: 'mongo', MONGODB_URI: 'mongodb://h/db' }, NO_ARGS), /Email-and-password sign-in is for the local preview only/);
  // fully configured for Google + Pages/Railway, production is still blocked until a staging deployment is tested
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_MODE: 'mongo', MONGODB_URI: 'mongodb://h/db', HOST: '0.0.0.0', AUTH_PROVIDER: 'google',
    PUBLIC_API_URL: 'https://api.example.com', PORTAL_URL: 'https://portal.example.com/', GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'x' }, NO_ARGS),
  /Production start is still blocked: Google sign-in is required before production/);
});

test('mongo mode refuses to start when MongoDB is unreachable (no demo fallback)', async () => {
  await assert.rejects(
    start({ APP_MODE: 'mongo', MONGODB_URI: 'mongodb://user:secret@127.0.0.1:1/x', PORT: '0' }, NO_ARGS, { dbTimeoutMs: 500 }),
    (err) => /does not fall back to demo mode/.test(err.message) && !err.message.includes('secret'));
});

// Regression: Express 5's app.listen passes listen errors to its callback, so a busy port used to "start" and then crash
// with "Cannot destructure property 'port' of 'server.address(...)' as it is null", hiding EADDRINUSE.
test('startup on a busy port fails with the real cause (EADDRINUSE), not a null address', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = String(blocker.address().port);
  try {
    await assert.rejects(start({ APP_MODE: 'demo', PORT: port }, NO_ARGS), (err) => {
      assert.strictEqual(err.code, 'EADDRINUSE');
      assert.match(err.message, new RegExp(`Port ${port} is already in use`));
      assert.strictEqual(err.cause && err.cause.code, 'EADDRINUSE');
      const lines = []; reportStartupError(err, (l) => lines.push(l));
      assert.match(lines[0], /already in use/); assert.match(lines[1], /caused by: EADDRINUSE/);
      return true;
    });
  } finally { blocker.close(); }
});

test('server address may be unavailable: no crash, clear fallback', () => {
  const cfg = { host: '127.0.0.1', mode: 'demo', integrations: null, ignoredIntegrationVars: [] };
  assert.strictEqual(serverUrl({ address: () => null }, cfg), null);
  assert.strictEqual(serverUrl(null, cfg), null);
  assert.strictEqual(serverUrl({ address: () => '\\\\.\\pipe\\x' }, cfg), '\\\\.\\pipe\\x');
  assert.strictEqual(serverUrl({ address: () => ({ port: 4173 }) }, { ...cfg, host: '0.0.0.0' }), 'http://localhost:4173');
  const out = []; assert.doesNotThrow(() => printBanner({ address: () => null }, cfg, (l) => out.push(l)));
  assert.match(out[0], /address is not available/);
});

test('startup errors keep their cause and never print credentials', () => {
  const lines = [];
  const err = new Error('Could not connect to MongoDB: boom', { cause: new Error('bad auth at mongodb://user:secret@host/db') });
  reportStartupError(err, (l) => lines.push(l));
  assert.match(lines.join('\n'), /caused by: bad auth/);
  assert.doesNotMatch(lines.join('\n'), /secret/);
  // hosting configuration errors are plain messages on Railway's log, without a stack trace
  const cfgErr = []; reportStartupError(new Error('PUBLIC_API_URL is required when the server is reachable from other computers.'), (l) => cfgErr.push(l));
  assert.strictEqual(cfgErr.length, 1);
  const odd = []; reportStartupError(new TypeError('unexpected'), (l) => odd.push(l));
  assert.ok(odd.length > 1, 'unexpected errors include the stack');
});

test('demo server: static app, demo config, API off, no network allowed', async () => {
  const { server } = await start({ APP_MODE: 'demo', PORT: '0' }, NO_ARGS);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(base + '/');
    assert.strictEqual(home.status, 200);
    assert.match(home.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.match(await home.text(), /app\.js/);
    assert.match(await (await fetch(base + '/config.js')).text(), /"mode":"demo"/);
    assert.deepStrictEqual(await (await fetch(base + '/healthz')).json(), { ok: true, app: 'blackhouse-leads-portal', mode: 'demo', db: 'not used', auth: 'none' });
    const api = await fetch(base + '/api/bootstrap');
    assert.strictEqual(api.status, 404);
    assert.match((await api.json()).error, /switched off in demo mode/);
    for (const p of ['/%2e%2e/server.js', '/..%5cserver.js', '/../.env', '/.env.example']) {
      const r = await fetch(base + p);
      assert.notStrictEqual(r.status, 200, p);
      assert.doesNotMatch(await r.text(), /require\(|MONGODB_URI/);
    }
  } finally { server.close(); }
});

test('front-end scripts parse; only api-client.js makes requests, and only to /api/', () => {
  for (const f of ['app.js', 'demo-data.js', 'shared.js', 'api-client.js']) {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: f }));
    assert.doesNotMatch(src, /XMLHttpRequest|google\.script\.run|WebSocket|sendBeacon|https?:\/\//, f);
    if (f !== 'api-client.js') assert.doesNotMatch(src, /\bfetch\(/, f);
  }
  assert.match(fs.readFileSync(path.join(PUB, 'api-client.js'), 'utf8'), /\^\\\/api\\\//);
});

// Regression: the phone menu's .side-scrim sat in the .shell grid without a desktop rule hiding it, so it took the
// second column and pushed <main> below the sidebar (blank content area on desktop).
test('desktop layout: menu scrim hidden outside the phone/tablet rules, main pinned to column 2', () => {
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // drop every @media / @container block (brace-matched), leaving the always-on rules
  let base = '', i = 0;
  while (i < css.length) {
    const at = css.indexOf('@', i);
    if (at < 0 || !/^@(media|container)/.test(css.slice(at, at + 10))) { base += css.slice(i, at < 0 ? css.length : at + 1); if (at < 0) break; i = at + 1; continue; }
    base += css.slice(i, at);
    let j = css.indexOf('{', at), depth = 0;
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break; }
    i = j + 1;
  }
  const rule = (sel) => { const m = base.match(new RegExp('(^|[},])\\s*([^{}]*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{}]*)\\{([^}]*)\\}')); return m ? m[3] : ''; };
  assert.match(rule('.side-scrim'), /display:\s*none/, '.side-scrim must be hidden by default');
  assert.match(rule('.shell > main'), /grid-column:\s*2/);
  assert.match(rule('.shell > #side'), /grid-column:\s*1/);
});

test('MongoDB mode default data source is Monday.com unless MongoDB was chosen by hand', () => {
  const SH = require('../public/shared');
  assert.strictEqual(SH.defaultSource(undefined), 'monday');
  assert.strictEqual(SH.defaultSource('monday'), 'monday');
  assert.strictEqual(SH.defaultSource('mongo'), 'mongo');
  assert.strictEqual(SH.defaultSource('anything else'), 'monday');
});

test('.env files are ignored and the example has placeholders only', () => {
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gi, /^\.env$/m); assert.match(gi, /^!\.env\.example$/m);
  const ex = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(ex, /^MONGODB_URI=$/m);
});
