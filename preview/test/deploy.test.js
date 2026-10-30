'use strict';
// Hosted setup (GitHub Pages portal + Railway API): address rules, Google sign-in against a local fake Google,
// cross-origin access, and the Pages build. No real Google, Railway or GitHub service is contacted.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { siteOf } = require('../src/deploy');
const { checkClaims } = require('../src/google');
const { User, OAuthState } = require('../src/models');
const { build } = require('../scripts/build-pages');

const ARGV = ['node', 'server.js'];
const CLIENT_ID = '123-test.apps.googleusercontent.com';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// ---------- fake Google: token endpoint (RS256-signed ID tokens) + published keys ----------
const signer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });   // a key Google never published
const jwt = (claims, key = signer.privateKey, kid = 'k1') => {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + b64(claims);
  return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url');
};
let claimsFor = () => ({}), signWith = null, tokenCalls = [];
const fakeGoogle = http.createServer((req, res) => {
  if (req.url === '/certs') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
    return res.end(JSON.stringify({ keys: [{ ...signer.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }));
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const p = Object.fromEntries(new URLSearchParams(body));
    tokenCalls.push(p);
    if (req.url !== '/token' || p.grant_type !== 'authorization_code' || p.client_secret !== 'test-secret') { res.writeHead(400); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id_token: signWith ? signWith(claimsFor(p)) : jwt(claimsFor(p)), access_token: 'x' }));
  });
});

let mem, srv, base, gBase;
const PORTAL = 'http://localhost:5555/portal/';
test.before(async () => {
  await new Promise((r) => fakeGoogle.listen(0, '127.0.0.1', r));
  gBase = `http://127.0.0.1:${fakeGoogle.address().port}`;
  mem = await MongoMemoryServer.create();
  ({ server: srv } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_deploy'), PORT: '0', AUTH_PROVIDER: 'google',
    GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_AUTH_URL: gBase + '/auth', GOOGLE_TOKEN_URL: gBase + '/token',
    GOOGLE_JWKS_URL: gBase + '/certs', PORTAL_URL: PORTAL }, ARGV));
  base = `http://127.0.0.1:${srv.address().port}`;
  await User.create([
    { email: 'boss@example.com', name: 'Test Manager', role: 'Manager' },
    { email: 'ana@example.com', name: 'Ana Test', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit' } },
    { email: 'gone@example.com', name: 'Former Member', role: 'VA', active: false },
  ]);
});
test.after(async () => { srv.close(); fakeGoogle.close(); await mongoose.disconnect(); await mem.stop(); });

const cookieOf = (res, name) => (res.headers.getSetCookie().find((c) => c.startsWith(name + '=')) || '').split(';')[0];
/** Runs start → (Google) → callback for an account; returns the callback response and the session cookie. */
async function signIn(claims, { sendBrowserCookie = true, state: forceState } = {}) {
  const s = await fetch(base + '/api/auth/google/start', { redirect: 'manual' });
  assert.strictEqual(s.status, 302);
  const to = new URL(s.headers.get('location'));
  const q = Object.fromEntries(to.searchParams);
  claimsFor = () => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, nonce: q.nonce, email_verified: true, ...claims });
  const browser = cookieOf(s, 'bh_oauth');
  const cb = await fetch(`${base}/api/auth/google/callback?code=test-code&state=${encodeURIComponent(forceState || q.state)}`,
    { redirect: 'manual', headers: sendBrowserCookie ? { cookie: browser } : {} });
  return { q, to, cb, session: cookieOf(cb, 'bh_sid'), location: cb.headers.get('location') || '' };
}

test('addresses: default Pages/Railway domains refused (third-party cookies); one owned domain accepted', () => {
  const env = { APP_MODE: 'mongo', MONGODB_URI: 'mongodb://h/db', HOST: '0.0.0.0', AUTH_PROVIDER: 'google', GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 's' };
  assert.strictEqual(siteOf('blackhouse2br-hub.github.io'), 'blackhouse2br-hub.github.io');
  assert.strictEqual(siteOf('portal-api.up.railway.app'), 'portal-api.up.railway.app');
  assert.strictEqual(siteOf('api.blackhouse.com.ph'), 'blackhouse.com.ph');
  assert.throws(() => loadConfig({ ...env, PUBLIC_API_URL: 'https://x.up.railway.app', PORTAL_URL: 'https://blackhouse2br-hub.github.io/AppScriptProject/' }, ARGV),
    /different sites.*third-party cookie.*shared domains.*one domain you own/s);
  const ok = loadConfig({ ...env, PUBLIC_API_URL: 'https://api.blackhouse.com.ph', PORTAL_URL: 'https://portal.blackhouse.com.ph/' }, ARGV);
  assert.deepStrictEqual([ok.web.crossOrigin, ok.web.secureCookies, ok.web.trustProxy, ok.auth.provider], [true, true, true, 'google']);
  assert.strictEqual(ok.auth.google.redirectUri, 'https://api.blackhouse.com.ph/api/auth/google/callback');
  // without a domain: page and API both on Railway (one address, first-party cookie)
  const one = loadConfig({ ...env, PUBLIC_API_URL: 'https://portal-api.up.railway.app' }, ARGV);
  assert.deepStrictEqual([one.web.crossOrigin, one.web.secureCookies, one.auth.provider], [false, true, 'google']);
  // password sign-in only on this computer; a reachable server needs its public address, https, and Google credentials
  assert.throws(() => loadConfig({ ...env, AUTH_PROVIDER: 'password', PUBLIC_API_URL: 'https://api.example.com' }, ARGV), /local preview only/);
  assert.throws(() => loadConfig({ ...env }, ARGV), /PUBLIC_API_URL is required/);
  assert.throws(() => loadConfig({ ...env, PUBLIC_API_URL: 'http://api.example.com' }, ARGV), /must use https/);
  assert.throws(() => loadConfig({ ...env, GOOGLE_CLIENT_SECRET: '', PUBLIC_API_URL: 'https://api.example.com' }, ARGV), /needs GOOGLE_CLIENT_SECRET/);
  assert.throws(() => loadConfig({ ...env, PUBLIC_API_URL: 'https://api.example.com', GOOGLE_TOKEN_URL: 'https://evil.example/token' }, ARGV), /local mock server/);
  assert.throws(() => loadConfig({ HOST: '0.0.0.0' }, ARGV), /Demo mode has no sign-in/);
  // the local preview is unchanged: password sign-in, one address
  const local = loadConfig({ APP_MODE: 'mongo', MONGODB_URI: 'mongodb://h/db' }, ARGV);
  assert.deepStrictEqual([local.auth.provider, local.web.crossOrigin, local.web.secureCookies], ['password', false, false]);
});

test('ID token rules: issuer, audience, expiry, nonce, verified email, optional Workspace domain', () => {
  const now = Date.now(), ok = { iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: now / 1000 + 60, nonce: 'n', sub: '1', email: 'a@x.com', email_verified: true, hd: 'x.com' };
  const chk = (c, o = {}) => checkClaims({ ...ok, ...c }, { clientId: CLIENT_ID, nonce: 'n', now, ...o });
  assert.strictEqual(chk({}), '');
  assert.strictEqual(chk({ iss: 'https://evil.example' }), 'google');
  assert.strictEqual(chk({ aud: 'other.apps.googleusercontent.com' }), 'google');
  assert.strictEqual(chk({ exp: now / 1000 - 1 }), 'expired');
  assert.strictEqual(chk({ nonce: 'other' }), 'expired');
  assert.strictEqual(chk({ email_verified: false }), 'unverified');
  assert.strictEqual(chk({ hd: 'gmail.com' }, { allowedDomain: 'x.com' }), 'domain');
  assert.strictEqual(chk({}, { allowedDomain: 'x.com' }), '');
});

test('Google sign-in: team members only, with their existing role; PKCE + browser-bound state', async () => {
  tokenCalls = [];
  const r = await signIn({ sub: 'g-ana', email: 'Ana@Example.com' });
  assert.strictEqual(r.to.origin + r.to.pathname, gBase + '/auth');
  assert.strictEqual(r.q.client_id, CLIENT_ID); assert.strictEqual(r.q.code_challenge_method, 'S256'); assert.strictEqual(r.q.scope, 'openid email profile');
  assert.ok(!JSON.stringify(r.q).includes('test-secret'), 'the client secret never goes to the browser');
  assert.strictEqual(r.cb.status, 303); assert.strictEqual(r.location, PORTAL);
  // PKCE: the verifier sent to Google matches the challenge from the start step
  const v = tokenCalls[0].code_verifier;
  assert.strictEqual(crypto.createHash('sha256').update(v).digest('base64url'), r.q.code_challenge);
  const me = await (await fetch(base + '/api/session', { headers: { cookie: r.session } })).json();
  assert.deepStrictEqual([me.user.email, me.user.role, me.user.vaLabel, me.user.modules.leads], ['ana@example.com', 'VA', 'Ana', 'edit']);
  assert.ok(!('googleSub' in me.user) && !('passwordHash' in me.user));
  assert.strictEqual((await User.findOne({ email: 'ana@example.com' }).select('+googleSub')).googleSub, 'g-ana');
  assert.strictEqual(await OAuthState.countDocuments(), 0, 'each sign-in attempt is used once');
  // HttpOnly, SameSite=Strict session; the state cookie is cleared
  const set = r.cb.headers.getSetCookie().join('\n');
  assert.match(set, /bh_sid=[\w-]+; Path=\/; HttpOnly; SameSite=Strict/); assert.match(set, /bh_oauth=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);
});

test('Google sign-in refusals: not on the team, removed, other Google account, wrong browser, replay, Google errors', async () => {
  const refused = (r, code) => { assert.strictEqual(r.location, PORTAL + '#signin-error=' + code); assert.strictEqual(r.session, ''); };
  refused(await signIn({ sub: 'g-x', email: 'stranger@example.com' }), 'not_member');
  refused(await signIn({ sub: 'g-gone', email: 'gone@example.com' }), 'not_member');
  refused(await signIn({ sub: 'g-someone-else', email: 'ana@example.com' }), 'mismatch');     // ana is linked to g-ana
  refused(await signIn({ sub: 'g-boss', email: 'boss@example.com', email_verified: false }), 'unverified');
  refused(await signIn({ sub: 'g-boss', email: 'boss@example.com' }, { sendBrowserCookie: false }), 'expired');
  refused(await signIn({ sub: 'g-boss', email: 'boss@example.com', aud: 'someone-else.apps.googleusercontent.com' }), 'google');
  // a token not signed by Google's published key (forged, or a tampered payload) is refused
  signWith = (c) => jwt(c, stranger.privateKey);
  refused(await signIn({ sub: 'g-boss', email: 'boss@example.com' }), 'google');
  signWith = (c) => { const [h, , s] = jwt({ ...c, email: 'ana@example.com' }).split('.'); return [h, b64(c), s].join('.'); };
  refused(await signIn({ sub: 'g-boss', email: 'boss@example.com' }), 'google');
  signWith = null;
  const first = await signIn({ sub: 'g-boss', email: 'boss@example.com' });
  assert.ok(first.session);
  const replay = await fetch(`${base}/api/auth/google/callback?code=test-code&state=${encodeURIComponent(first.q.state)}`, { redirect: 'manual' });
  assert.strictEqual(replay.headers.get('location'), PORTAL + '#signin-error=expired');
  const denied = await fetch(`${base}/api/auth/google/callback?error=access_denied&state=x`, { redirect: 'manual' });
  assert.strictEqual(denied.headers.get('location'), PORTAL + '#signin-error=cancelled');
});

test('Google server: no password sign-in; members are added without passwords; email change unlinks and signs out', async () => {
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: 'boss@example.com', password: 'x'.repeat(12) }) });
  assert.strictEqual(login.status, 404);
  assert.deepStrictEqual(await (await fetch(base + '/api/auth/methods')).json(), { provider: 'google' });
  assert.match(await (await fetch(base + '/config.js')).text(), /"auth":"google"/);
  const boss = (await signIn({ sub: 'g-boss', email: 'boss@example.com' })).session;
  const post = (url, body, method = 'POST') => fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: boss, origin: 'http://localhost:5555' }, body: JSON.stringify(body) });
  const add = await post('/api/team', { email: 'cora@example.com', name: 'Cora New', role: 'Broker', modules: { calendar: 'view' } });
  assert.strictEqual(add.status, 201);
  const cora = (await signIn({ sub: 'g-cora', email: 'cora@example.com' })).session;
  assert.strictEqual((await fetch(base + '/api/session', { headers: { cookie: cora } })).status, 200);
  const id = (await add.json()).user.id;
  assert.strictEqual((await post('/api/team/' + id, { email: 'cora.new@example.com', name: 'Cora New', role: 'Broker', modules: { calendar: 'view' } }, 'PATCH')).status, 200);
  assert.strictEqual((await fetch(base + '/api/session', { headers: { cookie: cora } })).status, 401, 'signed out after the email change');
  assert.strictEqual((await User.findById(id).select('+googleSub')).googleSub, undefined);
  // removing a member ends their access on the next request
  const ana = (await signIn({ sub: 'g-ana', email: 'ana@example.com' })).session;
  const anaId = (await User.findOne({ email: 'ana@example.com' }))._id;
  assert.strictEqual((await post('/api/team/' + anaId, {}, 'DELETE')).status, 200);
  assert.strictEqual((await fetch(base + '/api/session', { headers: { cookie: ana } })).status, 401);
});

test('cross-origin access: only the portal origin gets CORS (with cookies); others are blocked', async () => {
  const pre = (origin) => fetch(base + '/api/team', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  const ok = await pre('http://localhost:5555');
  assert.strictEqual(ok.status, 204);
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'http://localhost:5555');
  assert.strictEqual(ok.headers.get('access-control-allow-credentials'), 'true');
  const evil = await pre('https://evil.example');
  assert.strictEqual(evil.status, 403); assert.strictEqual(evil.headers.get('access-control-allow-origin'), null);
  const get = await fetch(base + '/api/auth/methods', { headers: { origin: 'https://evil.example' } });
  assert.strictEqual(get.headers.get('access-control-allow-origin'), null);
  const boss = (await signIn({ sub: 'g-boss', email: 'boss@example.com' })).session;
  const csrf = await fetch(base + '/api/templates', { method: 'POST', headers: { 'content-type': 'application/json', cookie: boss, origin: 'https://evil.example' }, body: '{}' });
  assert.strictEqual(csrf.status, 403);
  // this server is the API only: its address forwards to the portal, and the page files are not served here
  const home = await fetch(base + '/', { redirect: 'manual' });
  assert.strictEqual(home.status, 302); assert.strictEqual(home.headers.get('location'), PORTAL);
  assert.strictEqual((await fetch(base + '/app.js')).status, 404);
});

test('Railway hosts page + API on one address (no custom domain): first-party Secure cookie, Google sign-in, page served', async () => {
  const { createApp } = require('../src/app');
  const cfg = loadConfig({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_deploy'), HOST: '0.0.0.0', PORT: '8080', PUBLIC_API_URL: 'https://appscriptproject-production.up.railway.app',
    GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'test-secret', NODE_ENV: 'staging' }, ARGV);
  assert.deepStrictEqual([cfg.auth.provider, cfg.web.crossOrigin, cfg.web.secureCookies, cfg.web.trustProxy, cfg.web.portalUrl], ['google', false, true, true, '/']);
  assert.strictEqual(cfg.auth.google.redirectUri, 'https://appscriptproject-production.up.railway.app/api/auth/google/callback');
  const s = await new Promise((r) => { const x = createApp(cfg).listen(0, '127.0.0.1', () => r(x)); });
  try {
    const b = `http://127.0.0.1:${s.address().port}`;
    const home = await fetch(b + '/');
    assert.strictEqual(home.status, 200); assert.match(await home.text(), /app\.js/);
    assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.deepStrictEqual(await (await fetch(b + '/config.js')).text(), 'window.BH_CONFIG = {"mode":"mongo","apiBase":"","auth":"google"};\n');
    assert.deepStrictEqual(await (await fetch(b + '/healthz')).json(), { ok: true, app: 'blackhouse-leads-portal', mode: 'mongo', db: 'connected', auth: 'google' });
    const start = await fetch(b + '/api/auth/google/start', { redirect: 'manual' });
    assert.match(start.headers.getSetCookie().join(';'), /^__Host-bh_oauth=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
    assert.strictEqual(new URL(start.headers.get('location')).searchParams.get('redirect_uri'), cfg.auth.google.redirectUri);
    assert.strictEqual((await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@b.co","password":"xxxxxxxxxxxx"}' })).status, 404);
  } finally { s.close(); }
  // NODE_ENV=production is still refused with the same, complete settings (the production guard stays on)
  assert.throws(() => loadConfig({ APP_MODE: 'mongo', MONGODB_URI: 'mongodb://h/db', HOST: '0.0.0.0', PUBLIC_API_URL: 'https://appscriptproject-production.up.railway.app',
    GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 's', NODE_ENV: 'production' }, ARGV), /Production start refused/);
});

test('GitHub Pages redirect: published only after the Railway portal checks out; plain HTML, no script or settings', async () => {
  const { buildRedirect } = require('../scripts/build-pages');
  const live = await (await fetch(base + '/healthz')).json();   // the real server's answer (Google, MongoDB, connected)
  const healthz = (body, status = 200) => async () => ({ status, json: async () => body });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-redirect-'));
  try {
    const r = await buildRedirect({ app: 'https://appscriptproject-production.up.railway.app', out, fetchImpl: healthz(live) });
    assert.strictEqual(r.target, 'https://appscriptproject-production.up.railway.app/');
    assert.deepStrictEqual(r.files.sort(), ['.nojekyll', '404.html', 'index.html']);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(html, /http-equiv="refresh" content="0; url=https:\/\/appscriptproject-production\.up\.railway\.app\/"/);
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /<script|BH_CONFIG|api\//i);
    // nothing is published unless /healthz answers as the portal, in MongoDB mode, with Google and a connected database
    const bad = [[{ ...live, app: 'other' }, /did not answer as the Blackhouse Leads Portal/], [{ ...live, mode: 'demo' }, /"demo" mode/],
      [{ ...live, auth: 'password' }, /does not use Google sign-in/], [{ ...live, ok: false, db: 'disconnected' }, /database as "disconnected"/]];
    for (const [body, re] of bad) {
      fs.rmSync(out, { recursive: true, force: true });
      await assert.rejects(buildRedirect({ app: 'https://x.up.railway.app', out, fetchImpl: healthz(body) }), re);
      assert.ok(!fs.existsSync(path.join(out, 'index.html')));
    }
    await assert.rejects(buildRedirect({ app: 'http://x.up.railway.app', out, verify: false }), /https/);
    await assert.rejects(buildRedirect({ app: 'https://x.up.railway.app/portal', out, verify: false }), /just the origin/);
    await assert.rejects(buildRedirect({ app: 'https://x.up.railway.app', out, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), /Could not reach/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('GitHub Pages build: public settings only, CSP for the API, same-site check, secret scan', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pages-'));
  try {
    const r = build({ api: 'https://api.blackhouse.com.ph', portal: 'https://portal.blackhouse.com.ph/', out });
    assert.deepStrictEqual(r.config, { mode: 'mongo', apiBase: 'https://api.blackhouse.com.ph', auth: 'google' });
    assert.ok(r.files.includes('config.js') && r.files.includes('index.html') && r.files.includes('.nojekyll'));
    assert.ok(!r.files.some((f) => /\.env|server|\.test\./.test(f)));
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(html, /http-equiv="Content-Security-Policy" content="[^"]*connect-src https:\/\/api\.blackhouse\.com\.ph/);
    assert.throws(() => build({ api: 'https://x.up.railway.app', portal: 'https://blackhouse2br-hub.github.io/AppScriptProject/', out }), /different sites/);
    assert.throws(() => build({ api: 'http://api.blackhouse.com.ph', portal: 'https://portal.blackhouse.com.ph/', out }), /https/);
    // the scan stops a build that would publish a credential
    const { SECRET_PATTERNS } = require('../scripts/build-pages');
    for (const s of ['mongodb+srv://u:p@h/db', 'GOCSPX-abcdef', 'MONDAY_TOKEN=abc']) assert.ok(SECRET_PATTERNS.some((re) => re.test(s)), s);
    for (const f of r.files) assert.ok(!SECRET_PATTERNS.some((re) => re.test(fs.readFileSync(path.join(out, f), 'utf8'))), f);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('split hosting (portal on another address): the API still serves published project pages\' one script', async () => {
  const r = await fetch(base + '/project-page.js');
  assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(await r.text(), /project_inquiry/);
  assert.strictEqual((await fetch(base + '/app.js')).status, 404, 'the portal itself is not served here');
});
